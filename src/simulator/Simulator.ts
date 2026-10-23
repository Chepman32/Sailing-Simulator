import * as THREE from "three";
import { AudioSystem } from "./audio/AudioSystem";
import { CameraController } from "./camera/CameraController";
import { PhotoDirector, type InterestPoint } from "./camera/PhotoDirector";
import { AssetManager } from "./core/AssetManager";
import { initialAutoLevel, QualityManager } from "./core/QualityManager";
import { RenderLoop } from "./core/RenderLoop";
import { FlareSystem } from "./effects/FlareSystem";
import { EnvironmentSystem } from "./environment/EnvironmentSystem";
import type { TimeOfDayState } from "./environment/EnvironmentMath";
import { IslandSystem } from "./environment/IslandSystem";
import { OceanSystem } from "./environment/OceanSystem";
import { VolcanoSystem } from "./environment/VolcanoSystem";
import { InputController } from "./input/InputController";
import { TouchControls } from "./input/TouchControls";
import { compassBearingDegrees } from "./math";
import { applyEnginePower, createSimulatorState, type SimulatorState } from "./state";
import { ShipTrafficSystem } from "./traffic/ShipTrafficSystem";
import type {
  CameraMode,
  DiscoveryNotice,
  LightingMode,
  PointOfInterestKind,
  QualityPreset,
  SimulationSnapshot,
  SimulatorOptions,
} from "./types";
import { HudController } from "./ui/HudController";
import { Vessel } from "./vessel/Vessel";
import { VesselPhysics } from "./vessel/VesselPhysics";
import { WakeSystem } from "./vessel/WakeSystem";
import { WildlifeSystem } from "./wildlife/WildlifeSystem";
import {
  DISCOVERY_CELL_SIZE,
  DISCOVERY_GRID_SIZE,
  DISCOVERY_STORAGE_KEY,
  DiscoveryState,
} from "./world/Discovery";
import { PointsOfInterestSystem } from "./world/PointsOfInterestSystem";
import { COLLECTIBLES, ISLANDS, POINTS_OF_INTEREST, WORLD_EXTENT, type IslandDefinition } from "./world/WorldLayout";

const STORAGE_KEY = "sailing-simulator-pro-preferences-v2";
/** Pause photo auto-targeting this long after the user drags the camera. */
const PHOTO_MANUAL_OVERRIDE_SECONDS = 8;

function isCoarseInputDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage must not interrupt the session.
  }
}

/** Data the React chart needs; references are stable and must not be mutated. */
export type MapState = {
  extent: number;
  cellSize: number;
  gridSize: number;
  cells: Uint8Array;
  islands: readonly IslandDefinition[];
  places: ReadonlyArray<{ id: string; kind: PointOfInterestKind; x: number; z: number; discovered: boolean }>;
  collectibles: ReadonlyArray<{ id: string; kind: "bottle" | "crate"; x: number; z: number; spotted: boolean; collected: boolean }>;
  yacht: { x: number; z: number; heading: number };
  ships: ReadonlyArray<{ x: number; z: number; heading: number; length: number }>;
};

export class Simulator {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly assets: AssetManager;
  private readonly state: SimulatorState;
  private readonly hud: HudController;
  private readonly discovery = new DiscoveryState();
  private readonly photoDirector = new PhotoDirector();
  private readonly interestPoints: InterestPoint[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly scratchForward = new THREE.Vector3();
  private quality!: QualityManager;
  private ocean!: OceanSystem;
  private environment!: EnvironmentSystem;
  private islands!: IslandSystem;
  private volcano?: VolcanoSystem;
  private pointsOfInterest!: PointsOfInterestSystem;
  private physics!: VesselPhysics;
  private vessel!: Vessel;
  private wake!: WakeSystem;
  private wildlife!: WildlifeSystem;
  private ships!: ShipTrafficSystem;
  private flares!: FlareSystem;
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
  private photoMode = false;
  private photoAutoTarget = true;
  private manualOverride = 0;
  private discoveryTimer = 0;
  private persistTimer = 0;
  private persistedRevision = -1;
  private lastDiscovery: DiscoveryNotice | null = null;
  private discoverySerial = 0;
  private readonly pendingCaptures: Array<(blob: Blob | null) => void> = [];
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
    this.discovery.restore(readStorage(DISCOVERY_STORAGE_KEY));
    this.persistedRevision = this.discovery.revision;
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
    // Two scenes share one frame: ships first, then the world. Clearing is
    // done once per frame by render().
    this.renderer.autoClear = false;
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
      this.quality = new QualityManager(
        this.renderer,
        this.state.quality,
        this.coarseDevice,
        initialAutoLevel(this.coarseDevice, window.matchMedia("(max-width: 1100px)").matches),
        (preset) => {
          this.state.quality = preset;
          this.applyQualitySettings();
          this.persistState();
          this.hud.emit(this.snapshot());
        },
      );
      await this.assets.load();
      this.ocean = new OceanSystem(this.scene, this.quality.settings);
      this.environment = new EnvironmentSystem(this.scene, this.renderer, this.ocean);
      this.environment.setMode(this.state.lightingMode);
      this.islands = new IslandSystem(this.scene, this.assets);
      const volcanoIsland = ISLANDS.find((island) => island.kind === "volcano");
      if (volcanoIsland) {
        this.volcano = new VolcanoSystem(this.scene, volcanoIsland, this.quality.settings.smokeParticles, {
          onExplosion: (position, strength) => this.audio?.playEruption(position, strength),
        });
      }
      this.pointsOfInterest = new PointsOfInterestSystem(this.scene, this.ocean, this.discovery);
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
          this.audio?.splash(intensity, position);
        },
        (position) => this.wake.foamTrail(position, 1.1),
      );
      this.ships = new ShipTrafficSystem(this.scene, this.renderer, this.ocean, this.quality.settings.shipShadowMapSize, this.physics.position, {
        onHorn: (position, kind) => this.audio?.playHorn(position, kind),
      });
      this.flares = new FlareSystem(this.scene, {
        launch: (position) => this.audio?.playFlareLaunch(position),
        burst: (position) => this.audio?.playFlareBurst(position),
        burn: (position, duration) => this.audio?.startFlareBurn(position, duration),
      });
      this.applyQualitySettings();
      this.camera = new CameraController(this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight), this.ocean);
      this.camera.setMode(this.state.cameraMode);
      this.input = new InputController(this.state.controls, () => this.reset());
      this.touch = new TouchControls(this.canvas, {
        orbit: (x, y) => {
          this.noteManualCamera();
          this.camera.orbit(x, y);
        },
        zoom: (delta) => {
          this.noteManualCamera();
          this.camera.zoom(delta);
        },
        recenter: () => {
          if (!this.options.onSceneDoubleTap?.()) this.camera.recenter();
        },
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

  /** Strike the ship's bell; heard from wherever the camera is. */
  ringBell(): void {
    if (!this.initialized) return;
    this.vessel.ringBell();
    this.audio.playBell(this.vessel.bellWorldPosition(this.scratch));
  }

  /** Fire a red parachute flare from the skipper's pistol. */
  fireFlare(): boolean {
    if (!this.initialized || !this.flares.ready) return false;
    const muzzle = this.vessel.prepareFlareLaunch(this.scratch);
    // Launch from just above the cockpit so the rocket clears the rig.
    muzzle.y = Math.max(muzzle.y, this.physics.position.y + 2.2);
    const launched = this.flares.launch(muzzle);
    this.hud.emit(this.snapshot());
    return launched;
  }

  /** Photo mode hides the interface; auto targeting directs the camera. */
  setPhotoMode(active: boolean): void {
    this.photoMode = active;
    this.manualOverride = 0;
    this.photoDirector.reset();
    if (!active) this.camera?.setDirectedShot(null);
    this.hud.emit(this.snapshot());
  }

  setPhotoAutoTarget(enabled: boolean): void {
    this.photoAutoTarget = enabled;
    this.manualOverride = 0;
    this.photoDirector.reset();
    if (!enabled) this.camera?.setDirectedShot(null);
    this.hud.emit(this.snapshot());
  }

  /** Resolve with a JPEG of the next rendered frame (UI is never in the canvas). */
  capturePhoto(): Promise<Blob | null> {
    if (!this.initialized) return Promise.resolve(null);
    return new Promise((resolve) => this.pendingCaptures.push(resolve));
  }

  getMapState(): MapState {
    return {
      extent: WORLD_EXTENT,
      cellSize: DISCOVERY_CELL_SIZE,
      gridSize: DISCOVERY_GRID_SIZE,
      cells: this.discovery.cells,
      islands: ISLANDS,
      places: POINTS_OF_INTEREST.map((place) => ({
        id: place.id,
        kind: place.kind,
        x: place.x,
        z: place.z,
        discovered: this.discovery.places.has(place.id),
      })),
      collectibles: COLLECTIBLES.map((item) => ({
        id: item.id,
        kind: item.kind,
        x: item.x,
        z: item.z,
        spotted: this.discovery.spotted.has(item.id),
        collected: this.discovery.collected.has(item.id),
      })),
      yacht: { x: this.physics?.position.x ?? 0, z: this.physics?.position.z ?? 0, heading: this.physics?.heading ?? 0 },
      ships: this.ships?.positions ?? [],
    };
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
    this.flares?.dispose();
    this.ships?.dispose();
    this.wildlife?.dispose();
    this.wake?.dispose();
    this.vessel?.dispose();
    this.pointsOfInterest?.dispose();
    this.volcano?.dispose();
    this.islands?.dispose();
    this.environment?.dispose();
    this.ocean?.dispose(this.scene);
    this.assets.dispose();
    this.renderer.dispose();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.pendingCaptures.splice(0).forEach((resolve) => resolve(null));
    if (this.initialized) this.saveDiscovery();
    this.initialized = false;
  }

  private applyQualitySettings(): void {
    const settings = this.quality.settings;
    this.environment?.setShadowMapSize(settings.shadowMapSize);
    this.environment?.setShadowsEnabled(settings.shadows);
    this.ocean?.setQuality(settings);
    this.ships?.setShadowMapSize(settings.shipShadowMapSize);
  }

  private noteManualCamera(): void {
    if (this.photoMode) this.manualOverride = PHOTO_MANUAL_OVERRIDE_SECONDS;
  }

  private readonly fixedUpdate = (fixedDelta: number): void => {
    this.elapsed += fixedDelta;
    this.ocean.update(this.elapsed, this.physics.position, this.physics.heading);
    this.input.update(fixedDelta);
    if (!this.state.engineRunning) this.state.controls.throttle = 0;
    this.physics.fixedUpdate(fixedDelta, this.state.controls);
    this.ships.fixedUpdate(fixedDelta, this.physics.position);
    this.ships.constrainVessel(this.physics.position, this.physics.velocity);
    this.wake.fixedUpdate(fixedDelta, this.physics, this.state.controls, this.elapsed);
  };

  private readonly update = (delta: number): void => {
    const night = this.environmentState.nightFactor;
    this.ocean.update(this.elapsed, this.physics.position, this.physics.heading);
    this.islands.update(this.elapsed, this.physics.position, night);
    this.vessel.update(this.physics, this.state.controls, this.elapsed, delta, night);
    this.wildlife.update(delta, this.physics);
    this.wake.update(this.elapsed);
    this.flares.update(delta, night);
    this.updateDiscovery(delta, night);
    this.updatePhotoDirector(delta);
    this.camera.update(delta, this.physics);
    this.environmentState = this.environment.update(delta, this.camera.camera, this.physics.position);
    const lighting = this.environment.lighting;
    this.ships.update(this.elapsed, this.camera.camera, lighting);
    if (this.volcano) {
      const fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog.density : 0.00115;
      this.volcano.update(delta, this.camera.camera, lighting, fog);
      this.islands.setLavaGlow(this.volcano.lavaGlow);
    }
    this.updateAudio(delta);
    this.hud.update(delta, () => this.snapshot());
  };

  private updateDiscovery(delta: number, night: number): void {
    const picked = this.pointsOfInterest.update(this.elapsed, delta, this.physics.position, night);
    for (const id of picked) {
      const event = this.discovery.collect(id);
      if (!event) continue;
      const item = COLLECTIBLES.find((candidate) => candidate.id === id);
      this.audio.playCollect();
      this.notify(id, item?.kind ?? "bottle");
    }
    this.discoveryTimer -= delta;
    if (this.discoveryTimer <= 0) {
      this.discoveryTimer = 0.4;
      for (const event of this.discovery.observe(this.physics.position.x, this.physics.position.z)) {
        const place = POINTS_OF_INTEREST.find((candidate) => candidate.id === event.id);
        if (place) this.notify(place.id, place.kind);
      }
    }
    this.persistTimer -= delta;
    if (this.persistTimer <= 0 && this.discovery.revision !== this.persistedRevision) {
      this.persistTimer = 4;
      this.saveDiscovery();
    }
  }

  private notify(id: string, kind: PointOfInterestKind): void {
    this.discoverySerial += 1;
    this.lastDiscovery = { id, kind, serial: this.discoverySerial };
    this.hud.emit(this.snapshot());
  }

  private saveDiscovery(): void {
    this.persistedRevision = this.discovery.revision;
    writeStorage(DISCOVERY_STORAGE_KEY, this.discovery.serialize());
  }

  private updatePhotoDirector(delta: number): void {
    this.manualOverride = Math.max(0, this.manualOverride - delta);
    if (!this.photoMode || !this.photoAutoTarget || this.manualOverride > 0) {
      this.camera.setDirectedShot(null);
      return;
    }
    const points = this.interestPoints;
    points.length = 0;
    this.wildlife.collectInterest(points);
    this.ships.collectInterest(points, this.physics.position);
    this.volcano?.collectInterest(points);
    this.flares.collectInterest(points);
    this.pointsOfInterest.collectInterest(points, this.physics.position);
    const shot = this.photoDirector.update(
      delta,
      points,
      { position: this.physics.position, heading: this.physics.heading },
      {
        waterHeightAt: (x, z) => this.ocean.sample(x, z).height,
        terrainHeightAt: (x, z) => this.islands.terrainHeightAt(x, z),
        sunDirection: this.environment.lighting.sunDirection,
      },
    );
    this.camera.setDirectedShot(shot);
  }

  private updateAudio(delta: number): void {
    const camera = this.camera.camera;
    camera.getWorldPosition(this.scratch);
    camera.getWorldDirection(this.scratchForward);
    this.audio.setListener(this.scratch, this.scratchForward);
    const yacht = this.physics.position;
    const party = this.pointsOfInterest.partyCenter;
    this.audio.setAmbient("party", party, yacht.distanceTo(party) < 700 ? 1 : 0);
    const monolith = this.pointsOfInterest.monolithCenter;
    this.audio.setAmbient("monolith", monolith, yacht.distanceTo(monolith) < 260 ? 1 : 0);
    if (this.volcano) {
      const crater = this.volcano.crater;
      this.audio.setAmbient("volcano", crater, yacht.distanceTo(crater) < 1600 ? 0.25 + this.volcano.lavaGlow * 0.75 : 0);
    }
    this.audio.update(
      delta,
      Math.abs(this.physics.telemetry.forwardSpeed),
      this.state.controls.throttle,
      this.physics.telemetry.apparentWindSpeed,
    );
  }

  private readonly render = (): void => {
    this.renderer.clear();
    // Ships first: they write depth so the translucent ocean drawn afterwards
    // tints their submerged hulls correctly.
    this.renderer.render(this.ships.scene, this.camera.camera);
    this.renderer.render(this.scene, this.camera.camera);
    if (this.pendingCaptures.length > 0) {
      const resolvers = this.pendingCaptures.splice(0);
      // toBlob snapshots the drawing buffer synchronously, before the browser
      // composites and clears it, so preserveDrawingBuffer is not needed.
      this.canvas.toBlob((blob) => resolvers.forEach((resolve) => resolve(blob)), "image/jpeg", 0.92);
    }
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
      headingDegrees: compassBearingDegrees(this.physics?.heading ?? 0),
      heelDegrees: THREE.MathUtils.radToDeg(telemetry?.heel ?? 0),
      apparentWindKnots: (telemetry?.apparentWindSpeed ?? 7.2) * 1.943844,
      apparentWindAngle: THREE.MathUtils.radToDeg(telemetry?.apparentWindAngle ?? 0.6),
      rudderDegrees: this.state.controls.rudder * 35,
      throttle: this.state.controls.throttle,
      sailTrim: this.state.controls.sailTrim,
      cameraMode: this.state.cameraMode,
      lightingMode: this.state.lightingMode,
      quality: this.state.quality,
      qualityLevel: this.quality?.level ?? "high",
      soundEnabled: this.state.soundEnabled,
      audioReady: this.audio?.isReady() ?? false,
      engineRunning: this.state.engineRunning,
      engineMuted: this.state.engineMuted,
      fps: this.fps,
      status: this.status,
      positionX: this.physics?.position.x ?? 0,
      positionZ: this.physics?.position.z ?? 0,
      collected: this.discovery.collected.size,
      collectibleTotal: COLLECTIBLES.length,
      discovered: this.discovery.places.size,
      discoverableTotal: POINTS_OF_INTEREST.length,
      mapRevision: this.discovery.revision,
      lastDiscovery: this.lastDiscovery,
      photoAutoTarget: this.photoAutoTarget,
      photoSubject: this.photoMode ? this.photoDirector.subject : null,
      flareReady: this.flares?.ready ?? false,
    };
  }

  private loadState(): SimulatorState {
    const base = createSimulatorState();
    try {
      const saved = JSON.parse(readStorage(STORAGE_KEY) ?? "{}") as Partial<SimulatorState>;
      if (["day", "night"].includes(saved.lightingMode ?? "")) base.lightingMode = saved.lightingMode!;
      if (["chase", "helm", "orbit", "drone"].includes(saved.cameraMode ?? "")) base.cameraMode = saved.cameraMode!;
      if (["auto", "low", "medium", "high"].includes(saved.quality ?? "")) {
        // A saved high budget is not blindly restored on phones and tablets.
        base.quality = this.coarseDevice && saved.quality === "high" ? "medium" : saved.quality!;
      }
      if (typeof saved.soundEnabled === "boolean") base.soundEnabled = saved.soundEnabled;
      if (typeof saved.engineMuted === "boolean") base.engineMuted = saved.engineMuted;
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore blocked storage.
      }
    }
    return base;
  }

  private persistState(): void {
    writeStorage(
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
