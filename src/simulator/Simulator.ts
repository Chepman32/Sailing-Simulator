import * as THREE from "three";
import { AudioSystem } from "./audio/AudioSystem";
import { CameraController } from "./camera/CameraController";
import { AssetManager } from "./core/AssetManager";
import { QualityManager } from "./core/QualityManager";
import { RenderLoop } from "./core/RenderLoop";
import { EnvironmentSystem } from "./environment/EnvironmentSystem";
import type { TimeOfDayState } from "./environment/EnvironmentMath";
import { IslandSystem } from "./environment/IslandSystem";
import { OceanSystem } from "./environment/OceanSystem";
import { InputController } from "./input/InputController";
import { TouchControls } from "./input/TouchControls";
import { wrapDegrees } from "./math";
import { applyEnginePower, createSimulatorState, type SimulatorState } from "./state";
import type {
  CameraMode,
  LightingMode,
  QualityPreset,
  SimulationSnapshot,
  SimulatorOptions,
} from "./types";
import { HudController } from "./ui/HudController";
import { Vessel } from "./vessel/Vessel";
import { VesselPhysics } from "./vessel/VesselPhysics";
import { WakeSystem } from "./vessel/WakeSystem";
import { WildlifeSystem } from "./wildlife/WildlifeSystem";

const STORAGE_KEY = "sailing-simulator-pro-preferences-v2";

function isCoarseInputDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
}

export class Simulator {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly assets: AssetManager;
  private readonly state: SimulatorState;
  private readonly hud: HudController;
  private quality!: QualityManager;
  private ocean!: OceanSystem;
  private environment!: EnvironmentSystem;
  private islands!: IslandSystem;
  private physics!: VesselPhysics;
  private vessel!: Vessel;
  private wake!: WakeSystem;
  private wildlife!: WildlifeSystem;
  private camera!: CameraController;
  private input!: InputController;
  private touch!: TouchControls;
  private audio!: AudioSystem;
  private loop!: RenderLoop;
  private resizeObserver?: ResizeObserver;
  private elapsed = 0;
  private fps = 60;
  private status: SimulationSnapshot["status"] = "loading";
  private initialized = false;
  private readonly coarseDevice = isCoarseInputDevice();
  private environmentState: TimeOfDayState = {
    normalizedTime: 0.5,
    sunElevation: 0.72,
    moonElevation: -0.28,
    exposure: 1.08,
    starVisibility: 0,
    nightFactor: 0,
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: SimulatorOptions = {},
  ) {
    this.state = this.loadState();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.coarseDevice,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x0c7ba6, 1);
    this.assets = new AssetManager(options.onLoading);
    this.hud = new HudController(options.onSnapshot);
    // Install the gesture listeners before asset loading begins. On iOS the
    // first trusted tap is often made while the loading screen is still up;
    // creating AudioSystem later would lose that one chance to unlock audio.
    this.audio = new AudioSystem(() => {
      if (this.initialized) this.hud.emit(this.snapshot());
    });
    this.audio.setEnabled(this.state.soundEnabled);
    this.audio.setEngineRunning(this.state.engineRunning);
    this.audio.setEngineMuted(this.state.engineMuted);
    canvas.addEventListener("webglcontextlost", this.onContextLost, false);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored, false);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      this.quality = new QualityManager(this.renderer, this.state.quality, (preset) => {
        this.state.quality = preset;
        this.environment?.setShadowMapSize(this.quality.settings.shadowMapSize);
        this.ocean?.setQuality(this.quality.settings);
        this.persistState();
      });
      this.state.quality = this.quality.current;
      await this.assets.load();
      this.ocean = new OceanSystem(this.scene, this.quality.settings);
      this.environment = new EnvironmentSystem(this.scene, this.renderer, this.ocean);
      this.environment.setMode(this.state.lightingMode);
      this.environment.setShadowMapSize(this.quality.settings.shadowMapSize);
      this.islands = new IslandSystem(this.scene, this.assets);
      this.physics = new VesselPhysics(this.ocean, this.islands);
      this.vessel = new Vessel(this.scene, this.assets);
      this.wake = new WakeSystem(this.scene, this.ocean, this.quality.settings);
      this.wildlife = new WildlifeSystem(
        this.scene,
        this.ocean,
        this.assets,
        this.quality.settings.wildlifeCount,
        (position, intensity) => {
          this.wake.splash(position, intensity);
          this.audio?.splash(intensity);
        },
      );
      this.camera = new CameraController(this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight), this.ocean);
      this.camera.setMode(this.state.cameraMode);
      this.input = new InputController(this.state.controls, () => this.reset());
      this.touch = new TouchControls(this.canvas, {
        orbit: (x, y) => this.camera.orbit(x, y),
        zoom: (delta) => this.camera.zoom(delta),
        recenter: () => this.camera.recenter(),
      });
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
      this.resize();
      this.loop = new RenderLoop({
        fixedUpdate: this.fixedUpdate,
        update: this.update,
        render: this.render,
        onFps: this.onFps,
        onPauseChange: (paused) => {
          this.status = paused ? "paused" : "running";
          this.hud.emit(this.snapshot());
        },
      });
      this.initialized = true;
      this.status = "running";
      this.hud.emit(this.snapshot());
      this.loop.start();
    } catch (error) {
      this.status = "error";
      const message = error instanceof Error ? error.message : "The simulator could not start.";
      this.options.onError?.(message);
      this.hud.emit(this.snapshot());
      throw error;
    }
  }

  setRudder(value: number): void {
    this.input?.setRudder(value);
  }

  centerRudder(): void {
    this.input?.centerRudder();
  }

  setThrottle(value: number): void {
    this.input?.setThrottle(value);
  }

  setSailTrim(value: number): void {
    this.state.controls.sailTrim = THREE.MathUtils.clamp(value, 0.2, 1);
  }

  setLightingMode(mode: LightingMode): void {
    this.state.lightingMode = mode;
    this.environment?.setMode(mode);
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  setCameraMode(mode: CameraMode): void {
    this.state.cameraMode = mode;
    this.camera?.setMode(mode);
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  setQuality(preset: QualityPreset): void {
    this.quality?.setPreset(preset);
  }

  setSoundEnabled(enabled: boolean): void {
    this.state.soundEnabled = enabled;
    this.audio?.setEnabled(enabled);
    if (enabled) void this.audio?.resumeFromGesture();
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  resumeAudioFromGesture(): void {
    void this.audio?.resumeFromGesture();
  }

  setEngineMuted(muted: boolean): void {
    this.state.engineMuted = muted;
    this.audio?.setEngineMuted(muted);
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  setEngineRunning(running: boolean): void {
    applyEnginePower(this.state, running);
    this.audio?.setEngineMuted(this.state.engineMuted);
    this.audio?.setEngineRunning(running);
    // Engine running is session-only, but starting may clear a stale persisted
    // engine mute preference and that correction must survive the next reload.
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  reset(): void {
    if (!this.initialized) return;
    this.physics.reset();
    this.wake.reset();
    this.state.controls.throttle = 0;
    this.state.controls.rudder = 0;
    this.camera.recenter();
    this.hud.emit(this.snapshot());
  }

  dispose(): void {
    this.loop?.dispose();
    this.resizeObserver?.disconnect();
    this.touch?.dispose();
    this.input?.dispose();
    this.audio?.dispose();
    this.wildlife?.dispose();
    this.wake?.dispose();
    this.vessel?.dispose();
    this.islands?.dispose();
    this.environment?.dispose();
    this.ocean?.dispose(this.scene);
    this.assets.dispose();
    this.renderer.dispose();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.initialized = false;
  }

  private readonly fixedUpdate = (fixedDelta: number): void => {
    this.elapsed += fixedDelta;
    this.ocean.update(this.elapsed, this.physics.position, this.physics.heading);
    this.input.update(fixedDelta);
    if (!this.state.engineRunning) this.state.controls.throttle = 0;
    this.physics.fixedUpdate(fixedDelta, this.state.controls);
    this.wake.fixedUpdate(fixedDelta, this.physics, this.state.controls, this.elapsed);
  };

  private readonly update = (delta: number): void => {
    this.ocean.update(this.elapsed, this.physics.position, this.physics.heading);
    this.islands.update(this.elapsed);
    this.vessel.update(this.physics, this.state.controls, this.elapsed, delta, this.environmentState.nightFactor);
    this.wildlife.update(delta, this.physics);
    this.wake.update(this.elapsed);
    this.camera.update(delta, this.physics);
    this.environmentState = this.environment.update(delta, this.camera.camera, this.physics.position);
    this.audio.update(
      delta,
      Math.abs(this.physics.telemetry.forwardSpeed),
      this.state.controls.throttle,
      this.physics.telemetry.apparentWindSpeed,
    );
    this.hud.update(delta, () => this.snapshot());
  };

  private readonly render = (): void => {
    this.renderer.render(this.scene, this.camera.camera);
  };

  private readonly onFps = (fps: number): void => {
    this.fps = fps;
    this.quality.observeFps(fps);
  };

  private readonly resize = (): void => {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera?.resize(width, height);
  };

  private snapshot(): SimulationSnapshot {
    const telemetry = this.physics?.telemetry;
    return {
      speedKnots: telemetry?.speedKnots ?? 0,
      depthMeters: telemetry?.depth ?? 18,
      headingDegrees: wrapDegrees(THREE.MathUtils.radToDeg(this.physics?.heading ?? 0)),
      heelDegrees: THREE.MathUtils.radToDeg(telemetry?.heel ?? 0),
      apparentWindKnots: (telemetry?.apparentWindSpeed ?? 7.2) * 1.943844,
      apparentWindAngle: THREE.MathUtils.radToDeg(telemetry?.apparentWindAngle ?? 0.6),
      rudderDegrees: this.state.controls.rudder * 35,
      throttle: this.state.controls.throttle,
      sailTrim: this.state.controls.sailTrim,
      cameraMode: this.state.cameraMode,
      lightingMode: this.state.lightingMode,
      quality: this.state.quality,
      soundEnabled: this.state.soundEnabled,
      audioReady: this.audio?.isReady() ?? false,
      engineRunning: this.state.engineRunning,
      engineMuted: this.state.engineMuted,
      fps: this.fps,
      status: this.status,
    };
  }

  private loadState(): SimulatorState {
    const base = createSimulatorState();
    const compact = window.matchMedia("(max-width: 1100px)").matches;
    base.quality = this.coarseDevice ? "low" : compact ? "medium" : "high";
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<SimulatorState>;
      if (["day", "night"].includes(saved.lightingMode ?? "")) base.lightingMode = saved.lightingMode!;
      if (["chase", "helm", "orbit", "drone"].includes(saved.cameraMode ?? "")) base.cameraMode = saved.cameraMode!;
      if (!this.coarseDevice && ["low", "medium", "high"].includes(saved.quality ?? "")) {
        base.quality = saved.quality!;
      }
      if (typeof saved.soundEnabled === "boolean") base.soundEnabled = saved.soundEnabled;
      if (typeof saved.engineMuted === "boolean") base.engineMuted = saved.engineMuted;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    return base;
  }

  private persistState(): void {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lightingMode: this.state.lightingMode,
        cameraMode: this.state.cameraMode,
        quality: this.state.quality,
        soundEnabled: this.state.soundEnabled,
        engineMuted: this.state.engineMuted,
      }),
    );
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.loop?.stop();
    this.status = "paused";
    this.options.onError?.("Graphics context was lost. Recovery will be attempted automatically.");
  };

  private readonly onContextRestored = (): void => {
    this.status = "running";
    this.loop?.start();
  };
}
