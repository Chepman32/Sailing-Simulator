import * as THREE from "three";
import { AudioSystem } from "./audio/AudioSystem";
import { CameraController } from "./camera/CameraController";
import { AssetManager } from "./core/AssetManager";
import { PostProcessing } from "./core/PostProcessing";
import { QualityManager } from "./core/QualityManager";
import { contextRecovery, FlatFrameWatch, type PixelSample } from "./core/RenderHealth";
import { GpuTimer } from "./core/GpuTimer";
import { GpuGovernor } from "./core/RenderBudget";
import { RenderLoop } from "./core/RenderLoop";
import { EnvironmentSystem } from "./environment/EnvironmentSystem";
import type { TimeOfDayState } from "./environment/EnvironmentMath";
import { IslandSystem } from "./environment/IslandSystem";
import { distanceFromWaterline } from "./environment/IslandMath";
import { OceanReflection } from "./environment/OceanReflection";
import { OceanSystem } from "./environment/OceanSystem";
import { setShoalField, significantWaveHeight } from "./environment/OceanMath";
import { stormShoalAt } from "./environment/SurfMath";
import { RainSystem } from "./environment/RainSystem";
import { thunderDelay } from "./environment/LightningMath";
import { autoWeatherKind, isWeatherKind, type WeatherKind, type WeatherMode } from "./environment/WeatherMath";
import { UnderwaterLight } from "./environment/UnderwaterLight";
import { helmFromRudder, InputController } from "./input/InputController";
import { TouchControls } from "./input/TouchControls";
import { smoothstep } from "./math";
import { compassBearing } from "./vessel/HelmInstruments";
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
import { ShipSystem } from "./ships/ShipSystem";

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
  private gpuTimer?: GpuTimer;
  private readonly flatWatch = new FlatFrameWatch();
  private nextProbe = 0;
  private column = new Uint8Array(4);
  private contextLostAt = Number.NaN;
  private restoreRequested = false;
  private recoveryTimer?: number;
  private readonly governor = new GpuGovernor();
  private ocean!: OceanSystem;
  private environment!: EnvironmentSystem;
  private islands!: IslandSystem;
  private physics!: VesselPhysics;
  private vessel!: Vessel;
  private wake!: WakeSystem;
  private wildlife!: WildlifeSystem;
  private ships!: ShipSystem;
  private readonly shipImpact = new THREE.Vector3();
  private readonly helmPoint = new THREE.Vector3();
  private readonly sampleSurface = (x: number, z: number) => this.ocean.sample(x, z);
  private camera!: CameraController;
  private input!: InputController;
  private touch!: TouchControls;
  private post!: PostProcessing;
  private reflection?: OceanReflection;
  private rain!: RainSystem;
  private mirrorHidden: THREE.Object3D[] = [];
  private readonly mirrorList: THREE.Object3D[] = [];
  private audio!: AudioSystem;
  private readonly listenerForward = new THREE.Vector3();
  private readonly listenerUp = new THREE.Vector3();
  private readonly underwater = new UnderwaterLight();
  private loop!: RenderLoop;
  private readonly shoreSplash = new THREE.Vector3();
  private resizeObserver?: ResizeObserver;
  private elapsed = 0;
  private frameDelta = 1 / 60;
  /** The preset the player chose by hand, if any: the only one remembered between visits. */
  private chosenQuality: QualityPreset | null = null;
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
      // The HDR pipeline renders into its own multisampled target, so a
      // multisampled canvas would only add a full-screen resolve every frame.
      // Only a desktop that starts on the low preset draws to the canvas.
      antialias: !this.coarseDevice && this.state.quality === "low",
      alpha: false,
      depth: true,
      stencil: false,
      // Let a laptop with two GPUs stay on the efficient one; adaptive quality
      // handles a slower GPU, and the discrete one is what spins up the fans.
      powerPreference: "default",
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
        // three.js bakes shadow support into each program: after shadows are
        // switched on or off every lit material must be rebuilt, or a session
        // that dropped to the low preset and climbed back keeps no shadows.
        if (this.quality.shadowsChanged) {
          this.scene.traverse((object) => {
            const material = (object as THREE.Mesh).material;
            if (!material) return;
            (Array.isArray(material) ? material : [material]).forEach((entry) => (entry.needsUpdate = true));
          });
        }
        this.environment?.setShadowMapSize(this.quality.settings.shadowMapSize);
        this.environment?.setSkyDetail(this.quality.settings.skyDetail);
        this.ocean?.setQuality(this.quality.settings);
        this.islands?.setDrawScale(preset === "low" ? 0.7 : 1);
        this.rain?.setDrops(this.quality.settings.rainDrops);
        this.post?.setQuality(this.quality.settings);
        this.governor.reset();
        this.resize();
        this.reflection?.setScale(this.quality.settings.reflectionScale, this.renderer.domElement.width, this.renderer.domElement.height);
        this.persistState();
      });
      this.state.quality = this.quality.current;
      this.gpuTimer = new GpuTimer(this.renderer.getContext());
      this.resize();
      await this.assets.load();
      this.ocean = new OceanSystem(this.scene, this.quality.settings);
      // The storm swell dies out over the island shelves, for the CPU sampler as for the GPU.
      setShoalField(stormShoalAt);
      this.environment = new EnvironmentSystem(this.scene, this.renderer, this.ocean);
      this.environment.setMode(this.state.lightingMode);
      this.environment.setAutoCycle(this.state.autoTime);
      this.environment.setWeatherKind(this.currentWeatherKind(), true);
      this.environment.setShadowMapSize(this.quality.settings.shadowMapSize);
      this.environment.setSkyDetail(this.quality.settings.skyDetail);
      this.islands = new IslandSystem(
        this.scene,
        this.assets,
        this.underwater,
        this.ocean.skyUniforms as unknown as Record<string, THREE.IUniform>,
        Math.max(1024, this.quality.settings.shadowMapSize),
      );
      this.islands.setDrawScale(this.quality.current === "low" ? 0.7 : 1);
      this.physics = new VesselPhysics(this.ocean, this.islands);
      // Merchant ships and liners passing at a distance, or lying at anchor.
      this.ships = new ShipSystem(this.scene, this.underwater, distanceFromWaterline, Math.random, this.quality.current !== "low");
      this.ships.prebuild();
      this.physics.hullClearance = this.ships.hullClearance;
      this.ocean.setShips(this.ships.ships);
      this.vessel = new Vessel(this.scene, this.assets, this.underwater);
      this.vessel.setChartTraffic(this.ships.ships);
      this.wake = new WakeSystem(this.scene, this.ocean, this.quality.settings, this.renderer);
      this.wildlife = new WildlifeSystem(
        this.scene,
        this.ocean,
        this.assets,
        {
          dolphins: this.quality.settings.dolphinCount,
          gulls: this.quality.settings.wildlifeCount,
          fishDensity: this.quality.settings.fishDensity,
        },
        this.underwater,
        {
          splash: (position, intensity, kind, velocity) => {
            this.wake.splash(position, intensity, kind, velocity);
            const distance = this.camera ? this.camera.camera.position.distanceTo(position) : 0;
            this.audio?.splash(intensity, kind, distance, position);
          },
          trail: (position, heading, strength, width) => this.wake.trail(position, heading, strength, width),
          shed: (position, velocity, count, size) => this.wake.shed(position, velocity, count, size),
          ripple: (position, strength) => this.wake.ripple(position, strength),
        },
      );
      this.camera = new CameraController(this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight), this.ocean);
      this.camera.setMode(this.state.cameraMode);
      this.post = new PostProcessing(this.renderer, this.scene, this.camera.camera, this.quality.settings);
      this.reflection = new OceanReflection(this.quality.settings.reflectionScale);
      this.rain = new RainSystem(this.scene, this.quality.settings.rainDrops);
      this.mirrorHidden = [
        this.ocean.mesh,
        this.wake.object,
        this.wildlife.underwater,
        this.rain.object,
        ...this.environment.celestial,
        ...this.vessel.mirrorSkipped,
      ];
      this.input = new InputController(this.state.controls, () => this.reset());
      this.touch = new TouchControls(this.canvas, {
        orbit: (x, y) => this.camera.orbit(x, y),
        zoom: (delta) => this.camera.zoom(delta),
        recenter: () => {
          if (!this.options.onSceneDoubleTap?.()) this.camera.recenter();
        },
      });
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
      this.resize();
      await this.prewarmShaders();
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
    // Choosing day or night by hand takes the time of day off automatic.
    this.state.autoTime = false;
    this.environment?.setAutoCycle(false);
    this.state.lightingMode = mode;
    this.environment?.setMode(mode);
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  /** Lets the time of day run through day, dusk, night and dawn by itself. */
  setAutoTime(enabled: boolean): void {
    this.state.autoTime = enabled;
    this.environment?.setAutoCycle(enabled);
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  /** Automatic weather follows the planner; manual keeps the weather the player chose. */
  setWeatherMode(mode: WeatherMode): void {
    this.state.weatherMode = mode;
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  /** Chooses the weather. Picking one by hand switches to manual mode. */
  setWeather(kind: WeatherKind): void {
    this.state.weather = kind;
    this.state.weatherMode = "manual";
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
    this.chosenQuality = preset;
    this.quality?.setPreset(preset);
    this.persistState();
  }

  setSoundEnabled(enabled: boolean): void {
    this.state.soundEnabled = enabled;
    this.audio?.setEnabled(enabled);
    if (enabled) void this.audio?.resumeFromGesture();
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  /** Resumes sound the player has already started (no-op before that). */
  resumeAudioFromGesture(): void {
    void this.audio?.resumeFromGesture();
  }

  /** The player asked for sound: start it inside this gesture. */
  startAudioFromUser(): void {
    void this.audio?.startFromUser();
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
    this.camera.snap();
    this.hud.emit(this.snapshot());
  }

  dispose(): void {
    this.loop?.dispose();
    this.resizeObserver?.disconnect();
    this.touch?.dispose();
    this.input?.dispose();
    this.audio?.dispose();
    this.wildlife?.dispose();
    this.ships?.dispose();
    this.post?.dispose();
    this.reflection?.dispose();
    this.gpuTimer?.dispose();
    setShoalField(null);
    this.rain?.dispose(this.scene);
    this.wake?.dispose();
    this.vessel?.dispose();
    this.islands?.dispose();
    this.environment?.dispose();
    this.ocean?.dispose(this.scene);
    this.assets.dispose();
    this.renderer.dispose();
    window.clearInterval(this.recoveryTimer);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.initialized = false;
  }

  private readonly fixedUpdate = (fixedDelta: number): void => {
    this.elapsed += fixedDelta;
    this.ocean.update(this.elapsed, this.physics.position, this.physics.heading, this.physics.telemetry.forwardSpeed);
    this.input.update(fixedDelta);
    if (!this.state.engineRunning) this.state.controls.throttle = 0;
    this.ships.fixedUpdate(fixedDelta, this.elapsed, this.physics.position, this.physics.heading, this.physics.wind);
    this.physics.fixedUpdate(fixedDelta, this.state.controls, this.state.engineRunning);
    // A ship's side is a wall: the yacht rebounds from it.
    const shipHit = this.ships.resolveContact(this.physics, this.shipImpact);
    if (shipHit > 0.35) {
      this.shipImpact.y = this.ocean.sample(this.shipImpact.x, this.shipImpact.z).height;
      const intensity = Math.min(3, 0.6 + shipHit * 0.8);
      this.wake.splash(this.shipImpact, intensity, "slap");
      this.audio.splash(intensity, "slap", this.camera.camera.position.distanceTo(this.shipImpact));
    }
    // Wake and visuals follow what the helm actually does, guard included.
    this.wake.fixedUpdate(fixedDelta, this.physics, this.physics.guard.output, this.elapsed);
    const impact = this.physics.telemetry.shoreImpact;
    if (impact > 0.25) {
      // The bows strike the shelf: spray off the bow and a dull thump.
      this.shoreSplash.copy(this.physics.position).addScaledVector(this.physics.forward, 4.4);
      this.shoreSplash.y = this.ocean.sample(this.shoreSplash.x, this.shoreSplash.z).height;
      const intensity = Math.min(3, 0.6 + impact * 0.7);
      this.wake.splash(this.shoreSplash, intensity, "slap");
      this.audio.splash(intensity, "slap", this.camera.camera.position.distanceTo(this.shoreSplash));
    }
  };

  private readonly update = (delta: number, _elapsed = 0, alpha = 1): void => {
    // The yacht is drawn between her last two physics steps, not at the latest
    // one, so frames that get no step or two steps do not make her judder.
    this.physics.blendPose(alpha);
    try {
      this.updateFrame(delta);
    } finally {
      this.physics.restorePose();
    }
  };

  private updateFrame(delta: number): void {
    this.frameDelta = delta;
    this.ocean.update(this.elapsed, this.physics.position, this.physics.heading, this.physics.telemetry.forwardSpeed);
    this.islands.update(this.elapsed, this.environment.currentWeather.wind, this.physics.position.x, this.physics.position.z);
    this.vessel.update(this.physics, this.physics.guard.output, this.elapsed, delta, this.environmentState.nightFactor, {
      camera: this.camera.camera,
      lightDirection: this.environment.lightDirection,
      palette: this.environment.current.palette,
      engineRunning: this.state.engineRunning,
      // The displays are only redrawn while someone could read them.
      helmReadable:
        this.state.cameraMode === "helm" ||
        this.camera.camera.position.distanceToSquared(this.vessel.worldPoint(this.vessel.helmEye, this.helmPoint)) < 64,
    });
    const slam = this.vessel.consumeBoomSlam();
    if (slam > 0) this.audio.boomSlam(slam);
    this.ships.update(delta, this.sampleSurface);
    this.wildlife.update(delta, this.physics, this.camera.camera);
    this.wake.update(this.elapsed);
    this.camera.update(delta, this.physics, { root: this.vessel.root, eye: this.vessel.helmEye });
    this.environment.setWeatherKind(this.currentWeatherKind());
    this.environmentState = this.environment.update(
      delta,
      this.camera.camera,
      this.physics.position,
      this.elapsed,
    );
    this.applyWeather();
    this.wake.setEnvironment(this.environment.current.palette);
    // Palm shadows on the sand follow the sun, softer under the moon.
    this.islands.updateShadows(
      this.renderer,
      this.environment.lightDirection,
      0.82 * (1 - this.environmentState.nightFactor * 0.45),
      this.physics.position.x,
      this.physics.position.z,
    );
    this.underwater.setPalette(this.environment.current.palette);
    this.ships.setNight(this.environmentState.nightFactor);
    this.wildlife.setLightDirection(this.environment.lightDirection);
    this.underwater.setTime(this.elapsed);
    this.audio.update(
      delta,
      Math.abs(this.physics.telemetry.forwardSpeed),
      this.physics.telemetry.engineShaft,
      this.physics.telemetry.apparentWindSpeed,
      this.environment.currentWeather,
    );
    // Positional sound: the camera is the listener; the gulls call from where they fly.
    const camera = this.camera.camera;
    camera.getWorldDirection(this.listenerForward);
    this.listenerUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.audio.setListener({ position: camera.position, forward: this.listenerForward, up: this.listenerUp });
    this.audio.updateGulls(delta, this.wildlife.gullPositions);
    for (const call of this.wildlife.consumeGullCalls()) this.audio.gullCallAt(call.position, call.variant);
    this.audio.updateShips(this.ships.soundSources);
    for (const horn of this.ships.consumeHorns()) this.audio.shipHorn(horn.position, horn.signal, horn.length);
    this.hud.update(delta, () => this.snapshot());
  }

  /**
   * Compiles every shader program before the first visible frame, so nothing
   * hitches the first time a lamp, a splash, the moon or a fish appears.
   * `compileAsync` visits every material whether or not its object is
   * currently visible; one render through the active pipeline then builds
   * the shadow-depth and post-processing programs.
   */
  private async prewarmShaders(): Promise<void> {
    try {
      this.update(1 / 60);
      const previousTarget = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.post.sceneTarget);
      await this.renderer.compileAsync(this.scene, this.camera.camera);
      this.renderer.setRenderTarget(previousTarget);
      this.render();
    } catch (error) {
      console.warn("Shader prewarm skipped; programs will compile on first use.", error);
    }
  }

  private readonly render = (): void => {
    const timer = this.gpuTimer;
    if (timer?.available) {
      const gpuMs = timer.poll();
      if (gpuMs !== null) this.observeGpu(gpuMs);
      timer.begin();
    }
    this.renderReflection();
    this.post.render(this.frameDelta, this.elapsed);
    timer?.end();
    this.watchFrame();
  };

  /**
   * Every second or so reads a few pixels of the finished frame. Sky above
   * sea never comes out as one flat colour, so three such readings in a row
   * mean the view has silently broken (a poisoned buffer, a target the GPU
   * dropped): the render targets are freed and drawn from scratch.
   */
  private watchFrame(): void {
    if (this.elapsed < this.nextProbe) return;
    this.nextProbe = this.elapsed + 1.5;
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) return;
    // Underwater the whole view is one tint by design.
    if (this.camera.camera.position.y < 0.2) {
      this.flatWatch.reset();
      return;
    }
    const width = this.renderer.domElement.width;
    const height = this.renderer.domElement.height;
    if (width < 8 || height < 8) return;
    // One column through the middle of the frame: sky, horizon and sea.
    const samples: PixelSample[] = [];
    const column = this.column.length >= height * 4 ? this.column : (this.column = new Uint8Array(height * 4));
    gl.readPixels(Math.floor(width / 2), 0, 1, height, gl.RGBA, gl.UNSIGNED_BYTE, column);
    for (const v of [0.12, 0.3, 0.45, 0.65, 0.85, 0.92]) {
      const row = Math.floor(v * height) * 4;
      samples.push([column[row]!, column[row + 1]!, column[row + 2]!]);
    }
    if (this.flatWatch.observe(samples)) {
      console.warn("The frame came out as one flat colour; rebuilding the render targets.");
      this.rebuildView();
    }
  }

  /** Frees and redraws everything the GPU holds that is not geometry: targets, captures, shadow maps. */
  private rebuildView(): void {
    this.post.rebuild();
    this.reflection?.dispose();
    this.reflection?.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
    this.environment?.invalidateLighting();
    this.islands?.invalidateShadows();
    this.governor.reset();
    this.flatWatch.reset();
    this.resize();
  }

  /** GPU time of a finished frame: eases the render scale, and the preset if that is not enough. */
  private observeGpu(gpuMs: number): void {
    const verdict = this.governor.observe(gpuMs, this.elapsed, this.frameDelta);
    if (verdict === "scaled") this.resize();
    else if (verdict !== "steady") this.quality.observeGpu(verdict);
  }

  /**
   * The mirror image needs the HDR pipeline's linear render target format;
   * without it (low preset, or no half-float targets) the sea reflects the
   * sky alone.
   */
  private renderReflection(): void {
    const reflection = this.reflection;
    if (!reflection) return;
    // A gale's sea is too rough and too broken to hold a mirror image: the
    // yacht and the islands would show as a smear. The second scene render
    // that draws it is switched off from a storm on, which is also when the
    // frame is dearest (the whole sky is cloud, the sea is at its steepest).
    const calmSea = 1 - smoothstep(0.45, 0.75, this.environment.currentWeather.storm);
    if (this.post.enabled && this.quality.settings.reflectionScale > 0 && calmSea > 0.02) {
      this.mirrorList.length = 0;
      this.mirrorList.push(...this.mirrorHidden, ...this.islands.farFromMirror);
      reflection.render(this.renderer, this.scene, this.camera.camera, this.mirrorList);
      this.ocean.setReflection(
        reflection.active ? reflection.target.texture : null,
        reflection.textureMatrix,
        0.92 * calmSea,
        reflection.target.width,
        reflection.target.height,
      );
    } else {
      this.ocean.setReflection(null, reflection.textureMatrix, 0);
    }
  }

  private readonly onFps = (fps: number, frameCap = 60): void => {
    this.fps = fps;
    this.quality.observeFps(fps, frameCap);
  };

  private readonly resize = (): void => {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    if (this.quality) this.renderer.setPixelRatio(this.quality.pixelRatioFor(width, height, this.governor.scale));
    this.renderer.setSize(width, height, false);
    this.camera?.resize(width, height);
    this.post?.setSize(width, height);
    this.reflection?.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
    this.ships?.setPixelRatio(this.renderer.getPixelRatio());
  };

  /** The weather the sky should be heading for: the player's choice, or the planner's. */
  private currentWeatherKind(): WeatherKind {
    return this.state.weatherMode === "manual" ? this.state.weather : autoWeatherKind(this.elapsed);
  }

  /**
   * Hands the present weather to everything it touches: the sea's height and
   * roughness, the wind on the yacht and the palms, the rain, the thunder.
   */
  private applyWeather(): void {
    const weather = this.environment.currentWeather;
    this.ocean.setWeather(weather);
    this.physics.windScale = weather.wind;
    this.rain.update(
      this.elapsed,
      this.camera.camera,
      weather.rain,
      this.physics.wind,
      this.environment.current.palette.rainLight,
    );
    // Thunder follows each strike by the time its sound takes to cross the
    // water, from where it struck: a close one cracks almost at once, a far
    // one rumbles in half a minute later.
    const forward = this.listenerForward;
    const listenerYaw = Math.atan2(forward.x, forward.z);
    for (const strike of this.environment.consumeStrikes()) {
      const delay = thunderDelay(strike.distance);
      if (delay === null) continue;
      // Looking along +Z the camera's right is −X, so a strike turned toward
      // +X from the view lies to the left.
      this.audio.thunder(strike.distance, delay, -Math.sin(strike.azimuth - listenerYaw));
    }
  }

  private snapshot(): SimulationSnapshot {
    const telemetry = this.physics?.telemetry;
    return {
      speedKnots: telemetry?.speedKnots ?? 0,
      depthMeters: telemetry?.depth ?? 18,
      headingDegrees: compassBearing(this.physics?.heading ?? 0),
      heelDegrees: THREE.MathUtils.radToDeg(telemetry?.heel ?? 0),
      apparentWindKnots: (telemetry?.apparentWindSpeed ?? 8) * 1.943844,
      apparentWindAngle: THREE.MathUtils.radToDeg(telemetry?.apparentWindAngle ?? 1),
      // The HUD speaks the player's terms: positive is a starboard helm.
      rudderDegrees: helmFromRudder(this.state.controls.rudder) * 35,
      throttle: this.state.controls.throttle,
      sailTrim: this.state.controls.sailTrim,
      cameraMode: this.state.cameraMode,
      lightingMode: this.state.autoTime && this.environment ? (this.environment.isNight ? "night" : "day") : this.state.lightingMode,
      autoTime: this.state.autoTime,
      weatherMode: this.state.weatherMode,
      weather: this.state.weather,
      weatherNow: this.environment ? this.currentWeatherKind() : this.state.weather,
      waveHeight: significantWaveHeight(),
      trueWindKnots: (telemetry?.trueWindSpeed ?? 8) * 1.943844,
      quality: this.state.quality,
      soundEnabled: this.state.soundEnabled,
      audioReady: this.audio?.isReady() ?? false,
      engineRunning: this.state.engineRunning,
      shoreGuardActive: this.physics?.guard.active ?? false,
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
      if (typeof saved.autoTime === "boolean") base.autoTime = saved.autoTime;
      if (["auto", "manual"].includes(saved.weatherMode ?? "")) base.weatherMode = saved.weatherMode!;
      if (isWeatherKind(saved.weather)) base.weather = saved.weather;
      // Only a preset the player picked is remembered. The automatic fallback
      // used to be saved too, so a single slow moment (or a session paced
      // down while another app had the focus) left every later visit on the
      // low preset; the old `quality` field is therefore ignored.
      const chosen = (saved as { qualityChoice?: string }).qualityChoice;
      if (!this.coarseDevice && (chosen === "low" || chosen === "medium" || chosen === "high")) {
        base.quality = chosen;
        this.chosenQuality = chosen;
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
        autoTime: this.state.autoTime,
        weatherMode: this.state.weatherMode,
        weather: this.state.weather,
        cameraMode: this.state.cameraMode,
        qualityChoice: this.chosenQuality ?? undefined,
        soundEnabled: this.state.soundEnabled,
        engineMuted: this.state.engineMuted,
      }),
    );
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.loop?.stop();
    this.status = "paused";
    this.contextLostAt = performance.now();
    this.restoreRequested = false;
    // Some browsers (phones above all) never send "restored" by themselves:
    // ask for it, and if that fails too, tell the player to reload.
    window.clearInterval(this.recoveryTimer);
    this.recoveryTimer = window.setInterval(this.checkRecovery, 500);
  };

  private readonly checkRecovery = (): void => {
    if (Number.isNaN(this.contextLostAt)) {
      window.clearInterval(this.recoveryTimer);
      return;
    }
    const step = contextRecovery((performance.now() - this.contextLostAt) / 1000, this.restoreRequested);
    if (step === "restore") {
      this.restoreRequested = true;
      const loseContext = this.renderer.getContext().getExtension("WEBGL_lose_context");
      try {
        loseContext?.restoreContext();
      } catch {
        // The context was not lost by that extension; the reload below is the fallback.
      }
    } else if (step === "reload") {
      window.clearInterval(this.recoveryTimer);
      this.options.onError?.("Graphics context was lost and could not be restored. Reload the page to continue.");
    }
  };

  private readonly onContextRestored = (): void => {
    window.clearInterval(this.recoveryTimer);
    this.contextLostAt = Number.NaN;
    // The GPU forgot every texture and target. three.js uploads textures and
    // programs again by itself; what it cannot know is the content of the
    // render-to-texture buffers and the timer queries.
    this.gpuTimer?.dispose();
    this.gpuTimer = new GpuTimer(this.renderer.getContext());
    this.rebuildView();
    this.status = "running";
    this.nextProbe = this.elapsed + 3;
    this.loop?.start();
  };
}
