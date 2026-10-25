import * as THREE from "three";
import { AudioSystem } from "./audio/AudioSystem";
import { CameraController } from "./camera/CameraController";
import { AssetManager } from "./core/AssetManager";
import { PostProcessing } from "./core/PostProcessing";
import { QualityManager } from "./core/QualityManager";
import { contextRecovery, FlatFrameWatch, type PixelSample } from "./core/RenderHealth";
import { ShipShadows } from "./ships/ShipShadows";
import { PhotoDirector, photoShot, type PhotoShot, type PhotoSubject } from "./camera/PhotoDirector";
import { FlareCamera } from "./camera/FlareCamera";
import { GpuTimer } from "./core/GpuTimer";
import { AUTO_GPU_TARGET_MS, GpuGovernor } from "./core/RenderBudget";
import { RenderLoop } from "./core/RenderLoop";
import { EnvironmentSystem } from "./environment/EnvironmentSystem";
import type { TimeOfDayState } from "./environment/EnvironmentMath";
import { IslandSystem } from "./environment/IslandSystem";
import { distanceFromWaterline, islandsInCell, worldCell } from "./environment/IslandMath";
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
  QualityChoice,
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
import { FlareSystem } from "./effects/FlareSystem";
import type { FlareColor } from "./effects/FlareMath";
import { LootSystem, type LootPickup } from "./effects/LootSystem";
import { BOTTLE_MESSAGES, isSailColor, LOOT_SHORE_CLEARANCE, lootContents, SAIL_COLORS, type SailColor } from "./effects/LootMath";
import { createFlamingo } from "./effects/LootModels";
import { NEUTRAL_GRADE, RadioSystem, type RadioStationId } from "./audio/RadioSystem";
import { VolcanoSystem } from "./effects/VolcanoSystem";
import { PoiSystem } from "./effects/PoiSystem";
import { DISCOVERY_RANGE, POI_CLEARANCE } from "./effects/PoiMath";
import { findOpenWater, RESCUE_CLEARANCE } from "./vessel/RescueMath";
import { AircraftSystem } from "./aircraft/AircraftSystem";
import { ExploredSea, Track } from "./map/ChartMath";
import { poiInCell, poisAround, POI_CELL, type PlaceKind, type Poi } from "./effects/PoiMath";
import type { LootKind } from "./effects/LootMath";

const STORAGE_KEY = "sailing-simulator-pro-preferences-v2";
/** The explored sea is saved apart from the preferences: it changes often and grows. */
const CHART_KEY = "sailing-simulator-chart-v1";
/** Discoveries remembered (the logbook and the chart's marks). */
const MAX_DISCOVERIES = 256;

export type ChartIsland = {
  id: number;
  x: number;
  z: number;
  radius: number;
  scaleZ: number;
  seed: number;
  lobe: number;
  height: number;
  volcano: boolean;
};
export type ChartPlace = { key: string; kind: PlaceKind; x: number; z: number; discovered: boolean };
/** What the chart shows of the sea within a rectangle (see `Simulator.chart`). */
export type ChartFeatures = {
  yacht: { x: number; z: number; heading: number };
  wind: { x: number; z: number };
  islands: ChartIsland[];
  places: ChartPlace[];
  loot: { kind: LootKind; x: number; z: number }[];
  explored: ExploredSea;
  track: Track;
  night: number;
};
/** Picked-up things remembered across visits (the oldest are forgotten and float again). */
const MAX_REMEMBERED_LOOT = 400;
/** Things afloat nearer than this are pointed out in the interface, metres. */
const NEAREST_LOOT_RANGE = 340;
/** Held fast this long, she is offered a tow. */
const STUCK_SECONDS = 6;
/** Colour of an eruption's light on the scene (linear). */
const ERUPTION_RGB = [1, 0.36, 0.09] as const;

function isCoarseInputDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
}

/** Edge of the ships' shadow atlas for a preset (0: none). */
function shipShadowSize(preset: string): number {
  return preset === "low" ? 0 : 2048;
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
  private shipShadows?: ShipShadows;
  private readonly shipImpact = new THREE.Vector3();
  private readonly helmPoint = new THREE.Vector3();
  private readonly sampleSurface = (x: number, z: number) => this.ocean.sample(x, z);
  private camera!: CameraController;
  private input!: InputController;
  private touch!: TouchControls;
  private post!: PostProcessing;
  private reflection?: OceanReflection;
  private rain!: RainSystem;
  private flares!: FlareSystem;
  private loot!: LootSystem;
  private radio?: RadioSystem;
  private volcanoes!: VolcanoSystem;
  private aircraft!: AircraftSystem;
  private places!: PoiSystem;
  /** The chart: the sea seen so far, and the yacht's track. */
  readonly explored = new ExploredSea();
  readonly track = new Track();
  private chartDirty = false;
  private chartSavedAt = 0;
  private readonly chartPoiCache = new Map<string, Poi | null>();
  /** Squares charted by the earlier chart (150 m, "column,row"), carried into the fog on first load. */
  private legacyChart: string[] = [];
  private readonly obstacleNormal = { x: 0, z: 1 };
  private readonly listenerPoint = new THREE.Vector3();
  /** The image's mood grade as it eases toward the station's. */
  private readonly grade = {
    gain: [1, 1, 1] as number[],
    shadows: [0, 0, 0] as number[],
    saturation: 1,
    vignette: 0,
  };
  private deckFlamingo?: THREE.Group;
  private nearestLoot: SimulationSnapshot["nearestLoot"] = null;
  private readonly seenMessages = new Set<string>();
  /** Seconds she has made no way while hard by a shore, a hull or a reef. */
  private stuckTime = 0;
  private readonly flareLaunchPoint = new THREE.Vector3();
  private readonly splashPoint = new THREE.Vector3();
  private mirrorHidden: THREE.Object3D[] = [];
  private readonly mirrorList: THREE.Object3D[] = [];
  private audio!: AudioSystem;
  private readonly listenerForward = new THREE.Vector3();
  private readonly listenerUp = new THREE.Vector3();
  private readonly bellPoint = new THREE.Vector3();
  private readonly hornPoint = new THREE.Vector3();
  private readonly underwater = new UnderwaterLight();
  private loop!: RenderLoop;
  private readonly shoreSplash = new THREE.Vector3();
  private resizeObserver?: ResizeObserver;
  private elapsed = 0;
  private frameDelta = 1 / 60;
  /** The preset the player chose by hand, if any: the only one remembered between visits. */
  /** null = automatic: the only mode that changes the level (and render scale) by itself. */
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
    this.loadChart();
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
    this.radio = new RadioSystem({
      shanty: (playing) => this.audio.setShanty(playing),
      tuning: () => this.audio.radioStatic(),
      changed: () => {
        if (this.initialized) this.hud.emit(this.snapshot());
      },
      failed: (station) => this.options.onRadioFailed?.(station),
    });
    this.radio.setMuted(!this.state.soundEnabled);
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
        this.shipShadows?.setSize(shipShadowSize(preset));
        this.governor.reset();
        this.resize();
        this.reflection?.setScale(this.quality.settings.reflectionScale, this.renderer.domElement.width, this.renderer.domElement.height);
        this.persistState();
      });
      this.state.quality = this.quality.current;
      this.applyQualityMode();
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
      // The nearest ships cast their own sun shadows (a depth atlas; off on the low preset).
      this.shipShadows = new ShipShadows(this.renderer, this.ocean.shipShadow, shipShadowSize(this.quality.current));
      this.ships = new ShipSystem(
        this.scene,
        this.underwater,
        distanceFromWaterline,
        Math.random,
        this.quality.current !== "low",
        (material) => this.shipShadows?.patch(material),
      );
      this.ships.prebuild();
      // The strange places: volcanoes (islands with fire), the barge, the wreck, the monolith.
      this.volcanoes = new VolcanoSystem(this.scene, (island, radial, angle) => this.islands.terrainSurfaceHeight(island, radial, angle));
      this.places = new PoiSystem(
        this.scene,
        this.ocean,
        this.underwater,
        (x, z) => distanceFromWaterline(x, z) > POI_CLEARANCE,
        new Set(this.state.discoveredPlaces),
      );
      // Ships' sides and the places' footprints are obstacles the guard steers round.
      this.physics.hullClearance = (x, z, normal) => {
        let nearest = this.ships.hullClearance(x, z, normal);
        const place = this.places.clearance(x, z, this.obstacleNormal);
        if (place < nearest) {
          nearest = place;
          normal.x = this.obstacleNormal.x;
          normal.z = this.obstacleNormal.z;
        }
        // Piers off the islands' beaches.
        const pier = this.islands.structureClearance(x, z, this.obstacleNormal);
        if (pier < nearest) {
          nearest = pier;
          normal.x = this.obstacleNormal.x;
          normal.z = this.obstacleNormal.z;
        }
        return nearest;
      };
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
          sharks: this.quality.settings.sharkCount,
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
      this.camera.steadyHelm = this.state.steadyHelmView;
      this.post = new PostProcessing(this.renderer, this.scene, this.camera.camera, this.quality.settings);
      this.reflection = new OceanReflection(this.quality.settings.reflectionScale);
      this.rain = new RainSystem(this.scene, this.quality.settings.rainDrops);
      this.flares = new FlareSystem(this.scene);
      this.aircraft = new AircraftSystem(this.scene);
      this.loot = new LootSystem(
        this.scene,
        this.ocean,
        this.underwater,
        new Set(this.state.collectedLoot),
        (x, z) => this.lootIsOpen(x, z),
      );
      this.applySailColor();
      this.updateDeckFlamingo();
      this.mirrorHidden = [
        this.ocean.mesh,
        this.wake.object,
        this.wildlife.underwater,
        this.rain.object,
        ...this.environment.celestial,
        ...this.vessel.mirrorSkipped,
        // The places and the things afloat are left out of the planar mirror:
        // it would draw them all a second time.
        this.places.group,
        this.loot.group,
      ];
      this.input = new InputController(this.state.controls, {
        engineRunning: () => this.state.engineRunning,
        startEngine: () => {
          this.setEngineRunning(true);
          this.options.onKeyAction?.("engine-on");
        },
      });
      this.input.autoCenter = this.state.autoCenterHelm;
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

  /** The helm slider or wheel was let go. */
  releaseRudder(): void {
    this.input?.releaseRudder();
  }

  /** At the helm: a steady, level view (default) or the full motion of the boat. */
  setSteadyHelmView(enabled: boolean): void {
    this.state.steadyHelmView = enabled;
    if (this.camera) this.camera.steadyHelm = enabled;
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  /** Whether the helm returns amidships by itself when let go (saved). */
  setAutoCenterHelm(enabled: boolean): void {
    this.state.autoCenterHelm = enabled;
    if (this.input) this.input.autoCenter = enabled;
    this.persistState();
    this.hud.emit(this.snapshot());
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

  setQuality(choice: QualityChoice): void {
    this.chosenQuality = choice === "auto" ? null : choice;
    if (choice !== "auto") this.quality?.setPreset(choice);
    this.applyQualityMode();
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  /** Automatic mode holds ~30 fps; a chosen preset is left exactly as chosen. */
  private applyQualityMode(): void {
    const automatic = this.chosenQuality === null;
    this.quality?.setAdaptive(automatic);
    this.governor.target = AUTO_GPU_TARGET_MS;
    this.governor.reset();
    if (this.initialized) this.resize();
  }

  setSoundEnabled(enabled: boolean): void {
    this.state.soundEnabled = enabled;
    this.radio?.setMuted(!enabled);
    this.audio?.setEnabled(enabled);
    if (enabled) void this.audio?.resumeFromGesture();
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  private lastTrim = Number.NaN;
  private trimRate = 0;
  private readonly sailingState = { luff: 0, trimRate: 0, gust: 0, gustApproaching: 0 };

  /** What the sail and the wind are doing, for the yacht's sounds (winches, flogging, gusts). */
  private sailingSound(delta: number): { luff: number; trimRate: number; gust: number; gustApproaching: number } {
    const trim = this.physics.guard.output.sailTrim;
    const rate = Number.isFinite(this.lastTrim) && delta > 0 ? (trim - this.lastTrim) / delta : 0;
    this.lastTrim = trim;
    this.trimRate += (rate - this.trimRate) * Math.min(1, delta * 12);
    const telemetry = this.physics.telemetry;
    this.sailingState.luff = telemetry.sailLuff;
    this.sailingState.trimRate = this.trimRate;
    this.sailingState.gust = telemetry.gust;
    this.sailingState.gustApproaching = telemetry.gustApproaching;
    return this.sailingState;
  }

  /** Photo mode: the camera turns to whatever is worth a picture by itself. */
  setPhotoMode(enabled: boolean): void {
    this.photoMode = enabled;
    this.photo.setEnabled(enabled && this.photoAutoTarget);
    this.photoInteractions = this.camera?.interactions ?? 0;
    this.hud.emit(this.snapshot());
  }

  /** Photo mode's own switch: whether the camera turns to events by itself. */
  setPhotoAutoTarget(enabled: boolean): void {
    this.photoAutoTarget = enabled;
    this.photo.setEnabled(this.photoMode && enabled);
    this.photoInteractions = this.camera?.interactions ?? 0;
    this.hud.emit(this.snapshot());
  }

  /** A JPEG of the next frame drawn (the interface is never part of the canvas). */
  capturePhoto(): Promise<Blob | null> {
    if (!this.initialized) return Promise.resolve(null);
    return new Promise((resolve) => this.pendingCaptures.push(resolve));
  }

  private photoMode = false;
  private photoAutoTarget = true;
  private readonly pendingCaptures: Array<(blob: Blob | null) => void> = [];

  private readonly photo = new PhotoDirector();
  /** The pull-back shot of a flare just fired (takes precedence over the photo director). */
  private readonly flareCamera = new FlareCamera();
  private flareCameraInteractions = 0;
  private readonly photoSubjects: PhotoSubject[] = [];
  private readonly photoShotState: PhotoShot = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 50 };
  private photoInteractions = 0;

  private directPhoto(delta: number): void {
    const photo = this.photo;
    if (!photo.enabled && photo.weight <= 0) return;
    if (this.camera.interactions !== this.photoInteractions) {
      this.photoInteractions = this.camera.interactions;
      photo.userLooked();
    }
    const yacht = this.physics.position;
    for (const subject of this.wildlife.collectPhotoSubjects(this.photoSubjects)) photo.offer(subject, yacht.x, yacht.z);
    photo.update(delta);
    if (photo.subject) photoShot(photo.subject, yacht.x, yacht.y, yacht.z, this.photoShotState, this.physics.heading);
    this.camera.direct(this.photoShotState, photo.blend);
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

  /**
   * Fires a signal flare from the cockpit. False while the gun reloads (a
   * second or so between shots) or before the scene is up.
   */
  launchFlare(color: FlareColor): boolean {
    if (!this.initialized) return false;
    const point = this.flareLaunchPoint.copy(this.physics.position).addScaledVector(this.physics.forward, -3.4);
    point.y += 2.6;
    const wind = this.physics.wind;
    if (!this.flares.launch(color, point.x, point.y, point.z, wind.x, wind.z)) return false;
    this.audio.flareLaunch();
    // The camera pulls back to show the whole flight.
    const launch = this.flares.lastLaunch;
    if (launch) {
      this.flareCameraInteractions = this.camera.interactions;
      this.flareCamera.start(launch, this.camera.camera.position, this.physics.heading);
    }
    return true;
  }

  /** Hoists a sail colour the player has found (white is always there). */
  setSailColor(color: string): void {
    if (!isSailColor(color) || !this.state.unlockedSails.includes(color)) return;
    this.state.sailColor = color;
    this.applySailColor();
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  private applySailColor(): void {
    const color: SailColor = isSailColor(this.state.sailColor) ? this.state.sailColor : "white";
    this.vessel?.setSailColor(SAIL_COLORS[color]);
  }

  /** The first flamingo hauled aboard rides on the foredeck from then on. */
  private updateDeckFlamingo(): void {
    if (this.state.flamingos <= 0 || this.deckFlamingo || !this.vessel) return;
    this.deckFlamingo = createFlamingo(this.loot.sharedMaterials, this.loot.sharedGeometries);
    this.deckFlamingo.position.set(0.15, 0.62, 3.3);
    this.deckFlamingo.rotation.y = 0.4;
    this.deckFlamingo.scale.setScalar(0.62);
    this.vessel.root.add(this.deckFlamingo);
  }

  /** Something hauled aboard: what was in it, and what it changes. */
  private takeLoot(pickup: LootPickup): void {
    const state = this.state;
    state.collectedLoot.push(pickup.item.key);
    if (state.collectedLoot.length > MAX_REMEMBERED_LOOT) state.collectedLoot.splice(0, state.collectedLoot.length - MAX_REMEMBERED_LOOT);
    const contents = lootContents(pickup.item, state.unlockedSails.filter(isSailColor));
    this.audio.chime();
    this.splashPoint.set(pickup.x, pickup.y, pickup.z);
    this.wake.splash(this.splashPoint, 0.6, "slap");
    if (contents.kind === "bottle" && "sailColor" in contents) {
      state.unlockedSails = [...state.unlockedSails, contents.sailColor];
      this.options.onDiscovery?.({ kind: "bottle", key: "sail", sailColor: contents.sailColor });
    } else if (contents.kind === "bottle") {
      // A message not read before in this voyage, if there is one.
      let message: string = contents.message;
      if (this.seenMessages.has(message)) message = BOTTLE_MESSAGES.find((entry) => !this.seenMessages.has(entry)) ?? message;
      this.seenMessages.add(message);
      this.options.onDiscovery?.({ kind: "bottle", key: message });
    } else if (contents.kind === "crate") {
      state.doubloons += contents.coins;
      this.options.onDiscovery?.({ kind: "crate", key: contents.cargo, coins: contents.coins });
    } else {
      state.flamingos += 1;
      this.options.onDiscovery?.({ kind: "flamingo", key: "flamingo", first: state.flamingos === 1 });
      this.updateDeckFlamingo();
    }
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  /**
   * Tunes the radio (null: off). Call inside the player's tap or key press;
   * it starts the sound too if the player has not yet.
   */
  setRadio(station: RadioStationId | null): void {
    if (!station) {
      this.radio?.off();
      return;
    }
    if (!this.state.soundEnabled) this.setSoundEnabled(true);
    if (!this.audio.isArmed) void this.audio.startFromUser();
    this.radio?.play(station);
  }

  /** Next or previous station round the dial. */
  stepRadio(direction: 1 | -1): void {
    if (!this.state.soundEnabled) this.setSoundEnabled(true);
    if (!this.audio.isArmed) void this.audio.startFromUser();
    this.radio?.step(direction);
  }

  setRadioVolume(volume: number): void {
    this.radio?.setVolume(volume);
  }

  get radioVolume(): number {
    return this.radio?.level ?? 0.7;
  }

  /** Eases the image toward the playing station's mood. */
  private easeGrade(delta: number): void {
    const target = this.radio?.grade ?? NEUTRAL_GRADE;
    const k = 1 - Math.exp(-delta / 0.6);
    const grade = this.grade;
    for (let index = 0; index < 3; index += 1) {
      grade.gain[index]! += (target.gain[index]! - grade.gain[index]!) * k;
      grade.shadows[index]! += (target.shadows[index]! - grade.shadows[index]!) * k;
    }
    grade.saturation += (target.saturation - grade.saturation) * k;
    grade.vignette += (target.vignette - grade.vignette) * k;
    this.post.setGrade(grade.gain, grade.shadows, grade.saturation, grade.vignette);
  }

  /** Volcanoes and the other places: animation, sound, discoveries, the camera. */
  private updatePlaces(delta: number): void {
    const yacht = this.physics.position;
    const wind = this.physics.wind;
    const night = this.environmentState.nightFactor;
    const camera = this.camera.camera;
    this.volcanoes.update(
      this.elapsed,
      yacht.x,
      yacht.z,
      wind.x,
      wind.z,
      this.environment.current.palette,
      this.environment.lightDirection,
      night,
      camera.position,
    );
    const roar = this.volcanoes.roar;
    this.audio.setEruptionRoar(roar ? camera.position.distanceTo(roar.position) : Infinity, roar?.level ?? 0, roar?.position ?? camera.position);
    for (const eruption of this.volcanoes.consumeEruptions()) {
      // The boom arrives at the speed of sound; the photographer turns to it.
      const distance = camera.position.distanceTo(this.listenerPoint.set(eruption.x, eruption.y, eruption.z));
      const listenerYaw = Math.atan2(this.listenerForward.x, this.listenerForward.z);
      const azimuth = Math.atan2(eruption.x - camera.position.x, eruption.z - camera.position.z);
      const delay = thunderDelay(distance);
      if (delay !== null) this.audio.thunder(distance * 0.8, delay, -Math.sin(azimuth - listenerYaw));
      this.photo.offer({ kind: "eruption", x: eruption.x, y: eruption.y + 60, z: eruption.z, size: 260 }, yacht.x, yacht.z);
    }
    const crater = this.volcanoes.nearestCrater;
    const island = this.volcanoes.nearestIsland;
    if (crater && island && this.volcanoes.nearestEruption > 0.05) {
      this.photo.offer({ kind: "eruption", x: crater.x, y: crater.y + 60, z: crater.z, size: 260 }, yacht.x, yacht.z);
    }
    if (island && distanceFromWaterline(yacht.x, yacht.z) < DISCOVERY_RANGE.volcano) {
      const shore = Math.hypot(yacht.x - island.centerX, (yacht.z - island.centerZ) / island.scaleZ) - island.beachRadius;
      const key = `volcano:${island.id}`;
      if (shore < DISCOVERY_RANGE.volcano && !this.state.discoveredPlaces.includes(key)) this.discover(key, "volcano");
    }
    this.places.update(delta, yacht.x, yacht.z, night, wind.x, wind.z, this.audio.partyBeat);
    for (const poi of this.places.consumeDiscoveries()) this.discover(`${poi.kind}:${poi.id}`, poi.kind);
    const barge = this.places.nearest("barge", yacht.x, yacht.z);
    this.audio.setParty(barge ? camera.position.distanceTo(this.listenerPoint.set(barge.poi.x, 4, barge.poi.z)) : Infinity, this.listenerPoint);
    const monolith = this.places.nearest("monolith", yacht.x, yacht.z);
    this.audio.setMonolith(monolith ? camera.position.distanceTo(this.listenerPoint.set(monolith.poi.x, 6, monolith.poi.z)) : Infinity, this.listenerPoint);
  }

  private watchStuck(delta: number): void {
    const telemetry = this.physics.telemetry;
    const yacht = this.physics.position;
    if (telemetry.speedKnots > 0.9) {
      this.stuckTime = 0;
      return;
    }
    const hemmed =
      telemetry.grounding > 0.05 ||
      this.islands.shoreClearance(yacht.x, yacht.z, this.obstacleNormal) < 6 ||
      (this.physics.hullClearance?.(yacht.x, yacht.z, this.obstacleNormal) ?? 1e6) < 6;
    // Only when the player is trying to get somewhere (lying alongside on purpose is not stuck).
    const controls = this.state.controls;
    const trying = telemetry.grounding > 0.05 || (this.state.engineRunning ? Math.abs(controls.throttle) > 0.15 : controls.sailTrim > 0.45);
    const wasStuck = this.stuckTime > STUCK_SECONDS;
    this.stuckTime = hemmed && trying && telemetry.speedKnots < 0.45 ? this.stuckTime + delta : Math.max(0, this.stuckTime - delta * 2);
    if (wasStuck !== this.stuckTime > STUCK_SECONDS) this.hud.emit(this.snapshot());
  }

  /** Lifts the fog around the yacht and lays her track; saves the chart now and then. */
  private updateChart(): void {
    const yacht = this.physics.position;
    if (this.explored.reveal(yacht.x, yacht.z)) this.chartDirty = true;
    this.track.add(yacht.x, yacht.z);
    if (this.chartDirty && this.elapsed - this.chartSavedAt > 6) this.saveChart();
  }

  private saveChart(): void {
    this.chartDirty = false;
    this.chartSavedAt = this.elapsed;
    try {
      localStorage.setItem(CHART_KEY, this.explored.serialize());
    } catch {
      // Storage full or blocked: the chart still works for this visit.
    }
  }

  private loadChart(): void {
    try {
      this.explored.restore(localStorage.getItem(CHART_KEY));
    } catch {
      this.explored.restore(null);
    }
    // The sea charted before this chart existed stays charted.
    for (const key of this.legacyChart) {
      const [column, row] = key.split(",").map(Number);
      if (Number.isFinite(column) && Number.isFinite(row)) this.explored.markPoint((column! + 0.5) * 150, (row! + 0.5) * 150);
    }
    if (this.legacyChart.length > 0) this.chartDirty = true;
    this.legacyChart = [];
  }

  /** The yacht's position on the chart, once the voyage is running. */
  chartCentre(): { x: number; z: number } | null {
    return this.initialized ? { x: this.physics.position.x, z: this.physics.position.z } : null;
  }

  /** How many places the logbook holds. */
  get discoveredCount(): number {
    return this.state.discoveredPlaces.length;
  }

  /**
   * Everything the chart draws within the rectangle [x0, x1] × [z0, z1]
   * (metres, world): the islands, the places (with whether each was found),
   * the floating finds near the yacht, the explored sea and her track.
   */
  chart(x0: number, z0: number, x1: number, z1: number): ChartFeatures | null {
    if (!this.initialized) return null;
    const yacht = this.physics.position;
    const discovered = new Set(this.state.discoveredPlaces);
    const islands: ChartIsland[] = [];
    const places: ChartPlace[] = [];
    // At most 48 × 48 cells (58 km): the chart never shows more than that.
    const c0 = Math.max(worldCell(x0) - 1, worldCell((x0 + x1) / 2) - 24);
    const c1 = Math.min(worldCell(x1) + 1, worldCell((x0 + x1) / 2) + 24);
    const r0 = Math.max(worldCell(z0) - 1, worldCell((z0 + z1) / 2) - 24);
    const r1 = Math.min(worldCell(z1) + 1, worldCell((z0 + z1) / 2) + 24);
    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) {
        for (const island of islandsInCell(column, row)) {
          const reach = island.beachRadius * Math.max(1, island.scaleZ) * 1.3;
          if (island.centerX + reach < x0 || island.centerX - reach > x1 || island.centerZ + reach < z0 || island.centerZ - reach > z1) continue;
          islands.push({
            id: island.id,
            x: island.centerX,
            z: island.centerZ,
            radius: island.beachRadius,
            scaleZ: island.scaleZ,
            seed: island.seed,
            lobe: island.lobe,
            height: island.height,
            volcano: Boolean(island.volcano),
          });
          if (island.volcano) {
            const key = `volcano:${island.id}`;
            places.push({ key, kind: "volcano", x: island.centerX, z: island.centerZ, discovered: discovered.has(key) });
          }
        }
      }
    }
    const isOpen = (x: number, z: number) => distanceFromWaterline(x, z) > POI_CLEARANCE;
    const consider = (poi: Poi | null) => {
      if (!poi || poi.x < x0 - 50 || poi.x > x1 + 50 || poi.z < z0 - 50 || poi.z > z1 + 50) return;
      const key = `${poi.kind}:${poi.id}`;
      places.push({ key, kind: poi.kind, x: poi.x, z: poi.z, discovered: discovered.has(key) });
    };
    if (!this.chartPoiCache.has("home")) {
      for (const poi of poisAround(0, 0, 1200, isOpen).filter((entry) => entry.id.startsWith("home-"))) this.chartPoiCache.set(poi.id, poi);
      this.chartPoiCache.set("home", null);
    }
    for (const [id, poi] of this.chartPoiCache) if (id.startsWith("home-")) consider(poi);
    const half = 12;
    const pc = Math.floor(((x0 + x1) / 2) / POI_CELL + 0.5);
    const pr = Math.floor(((z0 + z1) / 2) / POI_CELL + 0.5);
    for (let row = Math.max(Math.floor(z0 / POI_CELL + 0.5), pr - half); row <= Math.min(Math.floor(z1 / POI_CELL + 0.5), pr + half); row += 1) {
      for (let column = Math.max(Math.floor(x0 / POI_CELL + 0.5), pc - half); column <= Math.min(Math.floor(x1 / POI_CELL + 0.5), pc + half); column += 1) {
        const id = `${column}:${row}`;
        let poi = this.chartPoiCache.get(id);
        if (poi === undefined) {
          poi = poiInCell(column, row, isOpen);
          if (this.chartPoiCache.size > 4000) this.chartPoiCache.clear();
          this.chartPoiCache.set(id, poi);
        }
        consider(poi);
      }
    }
    return {
      yacht: { x: yacht.x, z: yacht.z, heading: this.physics.heading },
      wind: { x: this.physics.wind.x, z: this.physics.wind.z },
      islands,
      places,
      loot: this.loot.items.map((item) => ({ kind: item.kind, x: item.x, z: item.z })),
      explored: this.explored,
      track: this.track,
      night: this.environmentState.nightFactor,
    };
  }

  /** The floatplane and the airliners: their flight, their sound, the photographer. */
  private updateAircraft(delta: number): void {
    const yacht = this.physics.position;
    const camera = this.camera.camera;
    const pixelAngle = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, this.renderer.domElement.height);
    this.aircraft.update(this.elapsed, delta, yacht.x, yacht.z, camera.position, this.environment.current.palette, this.environmentState.nightFactor, pixelAngle, this.environment.lightDirection);
    const low = this.aircraft.lowPlane;
    this.audio.setLowPlane(low.active, low.position, low.velocity, delta);
    const jet = this.aircraft.airlinerSound;
    this.audio.setAirliner(jet.active, jet.position, jet.distance);
    if (low.active && low.position.distanceTo(yacht) < 1100) {
      this.photo.offer({ kind: "plane", x: low.position.x, y: low.position.y, z: low.position.z, size: low.kind === "banner" ? 60 : 24 }, yacht.x, yacht.z);
    }
  }

  private discover(key: string, kind: string): void {
    if (this.state.discoveredPlaces.includes(key)) return;
    this.state.discoveredPlaces = [...this.state.discoveredPlaces, key].slice(-MAX_DISCOVERIES);
    this.audio.chime();
    this.options.onDiscovery?.({ kind: "poi", key: kind, first: !this.state.discoveredPlaces.some((entry) => entry !== key && entry.startsWith(`${kind}:`)) });
    this.persistState();
    this.hud.emit(this.snapshot());
  }

  /** Points the camera back at the yacht, behind her (the view a lost player wants). */
  recenterCamera(): void {
    this.camera?.recenter();
  }

  /**
   * Tows a stuck yacht to the nearest open water, pointing away from what
   * she was stuck on, at rest. Returns false if she is already clear (or
   * nothing was found).
   */
  rescueBoat(): boolean {
    if (!this.initialized) return false;
    const yacht = this.physics.position;
    const clearance = (x: number, z: number, normal: { x: number; z: number }): number => {
      const shore = this.islands.shoreClearance(x, z, normal);
      const hull = this.physics.hullClearance?.(x, z, this.obstacleNormal) ?? 1e6;
      if (hull < shore) {
        normal.x = this.obstacleNormal.x;
        normal.z = this.obstacleNormal.z;
        return hull;
      }
      return shore;
    };
    // Already in open water and making way: nothing to tow.
    if (clearance(yacht.x, yacht.z, this.obstacleNormal) >= RESCUE_CLEARANCE && this.stuckTime <= STUCK_SECONDS) return false;
    const spot = findOpenWater(yacht.x, yacht.z, clearance);
    if (!spot) return false;
    this.physics.relocate(spot.x, spot.z, spot.heading);
    this.stuckTime = 0;
    this.wake.reset();
    this.state.controls.throttle = 0;
    this.state.controls.rudder = 0;
    this.camera.recenter();
    this.camera.snap();
    this.hud.emit(this.snapshot());
    return true;
  }

  /**
   * Sounds the yacht's air horn or strikes the bell — buttons that exist to
   * make a sound, so they start the sound if the player has not yet (but
   * never against a sound switched off). A ship within hail answers the horn.
   */
  async playSignal(signal: "horn" | "bell"): Promise<"played" | "muted"> {
    if (!this.state.soundEnabled) return "muted";
    if (!this.audio.isReady()) await this.audio.startFromUser();
    if (signal === "horn") {
      this.audio.airHorn();
      if (this.initialized) this.ships.answerHorn(this.physics.position.x, this.physics.position.z);
    } else {
      this.audio.bell();
      if (this.initialized) this.vessel.strikeBell();
    }
    return "played";
  }

  /** Whether the player has started sound in this page (horn and bell need it). */
  get soundStarted(): boolean {
    return Boolean(this.audio?.isArmed);
  }

  /** Starts the voyage again from the start, as on arrival (what was found stays found). */
  reset(): void {
    if (!this.initialized) return;
    this.physics.reset();
    this.flares.clear();
    this.flareCamera.stop();
    this.wake.reset();
    this.state.controls.throttle = 0;
    this.state.controls.rudder = 0;
    this.camera.recenter();
    this.camera.snap();
    this.hud.emit(this.snapshot());
  }

  dispose(): void {
    if (this.chartDirty) this.saveChart();
    this.pendingCaptures.splice(0).forEach((resolve) => resolve(null));
    this.loop?.dispose();
    this.resizeObserver?.disconnect();
    this.touch?.dispose();
    this.input?.dispose();
    this.radio?.dispose();
    this.audio?.dispose();
    this.wildlife?.dispose();
    this.ships?.dispose();
    this.post?.dispose();
    this.reflection?.dispose();
    this.shipShadows?.dispose();
    this.gpuTimer?.dispose();
    setShoalField(null);
    this.rain?.dispose(this.scene);
    this.flares?.dispose();
    this.loot?.dispose();
    this.volcanoes?.dispose();
    this.aircraft?.dispose();
    this.places?.dispose();
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
    this.islands.setNight(this.environmentState.nightFactor);
    this.islands.update(this.elapsed, this.environment.currentWeather.wind, this.physics.position.x, this.physics.position.z);
    // The helm camera looks out through the skipper's eyes: he steps out of its way.
    this.vessel.setCrewVisible(
      (this.state.cameraMode !== "helm" || this.flareCamera.blend > 0.3 || this.photo.blend > 0.3) &&
        this.camera.camera.position.distanceToSquared(this.vessel.worldPoint(this.vessel.helmEye, this.helmPoint)) > 1.2,
    );
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
    if (this.flareCamera.running) {
      // A drag or a zoom by the player hands the camera straight back.
      if (this.camera.interactions !== this.flareCameraInteractions) this.flareCamera.cancel();
      this.flareCamera.update(delta, (x, z) => this.ocean.sample(x, z).height);
      this.camera.direct(this.flareCamera.shot, this.flareCamera.blend);
    } else {
      this.directPhoto(delta);
    }
    this.environment.setWeatherKind(this.currentWeatherKind());
    // The brightest flare in the air lights the scene; failing that, an
    // erupting volcano does (an orange light from its crater).
    const flare = this.flares.brightest();
    const eruptionLight = flare ? null : this.volcanoes.eruptionLight;
    if (flare) this.environment.setFlare(flare.position, flare.brightness, flare.rgb);
    else if (eruptionLight) this.environment.setFlare(eruptionLight.position, eruptionLight.brightness, ERUPTION_RGB);
    else this.environment.setFlare(null, 0, ERUPTION_RGB);
    this.environmentState = this.environment.update(
      delta,
      this.camera.camera,
      this.physics.position,
      this.elapsed,
    );
    this.applyWeather();
    // A gust is seen coming across the water from upwind, then is all round her.
    {
      const telemetry = this.physics.telemetry;
      const wind = this.physics.wind;
      const length = Math.hypot(wind.x, wind.z) || 1;
      const reach = (1 - telemetry.gustApproaching) * 110 * (telemetry.gust > 0.02 ? 0 : 1);
      this.ocean.setGustPatch(
        this.physics.position.x - (wind.x / length) * reach,
        this.physics.position.z - (wind.z / length) * reach,
        150,
        Math.max(telemetry.gust, telemetry.gustApproaching) * 0.7,
      );
    }
    this.wake.setEnvironment(this.environment.current.palette);
    this.easeGrade(delta);
    {
      const camera = this.camera.camera;
      const pixelScale = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      this.flares.update(delta, this.environment.current.palette.ambientColor, pixelScale);
    }
    {
      const yacht = this.physics.position;
      this.loot.setNight(this.environmentState.nightFactor);
      this.loot.update(delta, yacht.x, yacht.z, this.physics.heading, this.physics.wind.x, this.physics.wind.z);
      for (const pickup of this.loot.consumePickups()) this.takeLoot(pickup);
      this.nearestLoot = this.loot.nearest(yacht.x, yacht.z, this.physics.heading, NEAREST_LOOT_RANGE);
    }
    this.updatePlaces(delta);
    this.updateChart();
    this.updateAircraft(delta);
    this.watchStuck(delta);
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
      this.sailingSound(delta),
    );
    // Positional sound: the camera is the listener; the gulls call from where they fly.
    const camera = this.camera.camera;
    camera.getWorldDirection(this.listenerForward);
    this.listenerUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.vessel.signalPoints(this.bellPoint, this.hornPoint);
    this.audio.setSignalPoints(this.bellPoint, this.hornPoint);
    this.audio.setListener({ position: camera.position, forward: this.listenerForward, up: this.listenerUp });
    this.audio.updateGulls(delta, this.wildlife.gullPositions);
    for (const call of this.wildlife.consumeGullCalls()) this.audio.gullCallAt(call.position, call.variant);
    this.audio.updateShips(this.ships.soundSources);
    for (const horn of this.ships.consumeHorns()) {
      this.audio.shipHorn(horn.position, horn.signal, horn.length);
      // In photo mode a ship sounding her horn is worth turning round for.
      this.photo.offer({ kind: "horn", x: horn.position.x, y: 8, z: horn.position.z, size: horn.length * 0.75 }, this.physics.position.x, this.physics.position.z);
    }
    this.hud.update(delta, () => this.snapshot());
  }

  private lootIsOpen(x: number, z: number): boolean {
    return distanceFromWaterline(x, z) > LOOT_SHORE_CLEARANCE && this.places.clearance(x, z, this.obstacleNormal) > 40;
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
    this.shipShadows?.render(this.scene, this.ships.ships, this.ships.roots, this.camera.camera.position, this.environment.lightDirection);
    this.renderReflection();
    this.post.render(this.frameDelta, this.elapsed);
    if (this.pendingCaptures.length > 0) {
      const resolvers = this.pendingCaptures.splice(0);
      // toBlob copies the drawing buffer synchronously, right after the draw,
      // so no preserveDrawingBuffer is needed.
      this.renderer.domElement.toBlob((blob) => resolvers.forEach((resolve) => resolve(blob)), "image/jpeg", 0.92);
    }
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
    if (this.chosenQuality !== null) return;
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
      qualityChoice: this.chosenQuality ?? "auto",
      soundEnabled: this.state.soundEnabled,
      audioReady: this.audio?.isReady() ?? false,
      engineRunning: this.state.engineRunning,
      shoreGuardActive: this.physics?.guard.active ?? false,
      engineMuted: this.state.engineMuted,
      autoCenterHelm: this.state.autoCenterHelm,
      steadyHelmView: this.state.steadyHelmView,
      sailColor: this.state.sailColor,
      unlockedSails: this.state.unlockedSails,
      doubloons: this.state.doubloons,
      flamingos: this.state.flamingos,
      discoveredPlaces: this.state.discoveredPlaces,
      nearestLoot: this.nearestLoot,
      gust: telemetry?.gust ?? 0,
      stuck: this.stuckTime > STUCK_SECONDS,
      radioStation: this.radio?.station ?? null,
      radioBuffering: this.radio?.buffering ?? false,
      positionX: this.physics?.position.x ?? 0,
      positionZ: this.physics?.position.z ?? 0,
      photoAutoTarget: this.photoAutoTarget,
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
      if (chosen === "low" || chosen === "medium" || chosen === "high") {
        // A phone keeps a chosen preset too, but never the high one.
        base.quality = this.coarseDevice && chosen === "high" ? "medium" : chosen;
        this.chosenQuality = base.quality;
      }
      if (typeof saved.soundEnabled === "boolean") base.soundEnabled = saved.soundEnabled;
      if (typeof saved.engineMuted === "boolean") base.engineMuted = saved.engineMuted;
      // The helm now stays where it is put unless the player asks otherwise:
      // only the newer field (written once a player chose) is honoured; the
      // old `autoCenterHelm` was saved for everyone and is ignored.
      const helmReturn = (saved as { helmReturnsToCentre?: unknown }).helmReturnsToCentre;
      if (typeof helmReturn === "boolean") base.autoCenterHelm = helmReturn;
      if (typeof saved.steadyHelmView === "boolean") base.steadyHelmView = saved.steadyHelmView;
      const strings = (value: unknown, limit: number): string[] =>
        Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(-limit) : [];
      const unlocked = strings(saved.unlockedSails, 16).filter(isSailColor);
      base.unlockedSails = Array.from(new Set(["white", ...unlocked]));
      if (isSailColor(saved.sailColor) && base.unlockedSails.includes(saved.sailColor)) base.sailColor = saved.sailColor;
      if (typeof saved.doubloons === "number" && Number.isFinite(saved.doubloons)) base.doubloons = Math.max(0, Math.floor(saved.doubloons));
      if (typeof saved.flamingos === "number" && Number.isFinite(saved.flamingos)) base.flamingos = Math.max(0, Math.floor(saved.flamingos));
      base.discoveredPlaces = strings(saved.discoveredPlaces, MAX_DISCOVERIES);
      base.collectedLoot = strings(saved.collectedLoot, MAX_REMEMBERED_LOOT);
      this.legacyChart = strings((saved as { exploredCells?: unknown }).exploredCells, 6000);
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
        helmReturnsToCentre: this.state.autoCenterHelm,
        steadyHelmView: this.state.steadyHelmView,
        sailColor: this.state.sailColor,
        unlockedSails: this.state.unlockedSails,
        doubloons: this.state.doubloons,
        flamingos: this.state.flamingos,
        discoveredPlaces: this.state.discoveredPlaces,
        collectedLoot: this.state.collectedLoot.slice(-MAX_REMEMBERED_LOOT),
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
