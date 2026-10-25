import * as THREE from "three";
import type { LightingMode } from "../types";
import { clamp } from "../math";
import { CYCLE_DAY_START, CYCLE_NIGHT_START, dayCycleState, deriveTimeOfDay, type TimeOfDayState } from "./EnvironmentMath";
import { deriveEnvironmentPalette, LIGHTNING_COLOR, litByLightning, type EnvironmentPalette } from "./EnvironmentPalette";
import type { OceanSystem } from "./OceanSystem";
import { applySkyPalette, setLinearColor, type SkyUniforms } from "./SkyUniforms";
import { skyFragmentShader, skyVertexShader } from "./shaders/skyShader";
import { createWeather, settleWeather, stepWeather, type WeatherKind, type WeatherSample } from "./WeatherMath";
import { LightningSystem, type StrikeEvent } from "./LightningSystem";
import { flareIllumination, flareSceneWeight } from "../effects/FlareMath";

/** Half extent of the sun shadow frustum: just enough to hold the yacht. */
const SHADOW_EXTENT = 17;
/** Night-factor change that triggers a new lighting capture. */
const CAPTURE_THRESHOLD = 0.025;
const CAPTURE_INTERVAL = 0.22;
const CAPTURE_SIZE = 128;
/**
 * Seconds a full day-to-night (or night-to-day) change takes. Slow enough to
 * watch the sun set into a red horizon or rise out of one.
 */
const TRANSITION_SECONDS = 11;
/** HDR radiance of the solar disc at dusk, relative to the palette's sun tint. */
const SUN_DISC_RADIANCE = 2.0;
/**
 * Scene-linear colour at the centre of the noon sun disc. Solved through the
 * ACES curve (exposure 1.08) to land on a hot tropical yellow, sRGB about
 * (255, 230, 130), with a deep-gold limb (255, 200, 70) in the sky shader.
 * Blue must stay at zero: any blue, and any brighter value, and the curve
 * bleaches the disc to white. Bright enough for the bloom, which then halos
 * it in the same yellow.
 */
export const SUN_DISC_GOLD = [3.0, 1.06, 0.0] as const;

export class EnvironmentSystem {
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly skyUniforms: SkyUniforms;
  private readonly skyDetail: THREE.IUniform<number> = { value: 1 };
  private readonly sunDisc: THREE.IUniform<THREE.Color> = { value: new THREE.Color() };
  private readonly moonDisc: THREE.IUniform<THREE.Color> = { value: new THREE.Color() };
  private readonly starLight: THREE.IUniform<number> = { value: 0 };
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly sunDirection = new THREE.Vector3();
  private readonly moonDirection = new THREE.Vector3();
  private readonly celestialLightDirection = new THREE.Vector3();
  private readonly fogColor = new THREE.Color();
  private readonly weather: WeatherSample = createWeather("clear");
  private weatherKind: WeatherKind = "clear";
  private settleWeatherNext = true;
  private flash = 0;
  private readonly lightningSystem: LightningSystem;
  private cloudClock = 0;
  private readonly flashColor = new THREE.Color();
  private readonly keyDirection = new THREE.Vector3();
  /** The palette without the lightning (for the sky and its captured light). */
  private skyPalette!: EnvironmentPalette;
  private readonly flashDirection = new THREE.Vector3(0, 1, 0);
  /** The brightest signal flare in the air (see `setFlare`). */
  private readonly flarePosition = new THREE.Vector3(0, 100, 0);
  private readonly flareDirection = new THREE.Vector3(0, 1, 0);
  private readonly flareColor = new THREE.Color();
  private flareRgb: readonly [number, number, number] = [0, 0, 0];
  private flareBrightness = 0;
  /** Flare light falling on the yacht right now, weighed against the sky's. */
  private flareLight = 0;
  // Image-based lighting: the analytic sky is captured into a prefiltered
  // cube so PBR materials reflect and are lit by the sky that is on screen.
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly captureScene = new THREE.Scene();
  private readonly captureSky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly captureBelowColor = new THREE.Color();
  private captureTarget: THREE.WebGLRenderTarget | null = null;
  private capturedNight = Number.NaN;
  private captureCooldown = 0;
  private mode: LightingMode = "day";
  /** The automatic day cycle: time-of-day follows `cycleTime` instead of the mode. */
  private autoCycle = false;
  private cycleTime = CYCLE_DAY_START;
  private nightFactor = 0;
  private goalNight = 0;
  /** Linear progress from day (0) to night (1). */
  private transition = 0;
  private state: TimeOfDayState = deriveTimeOfDay(0);
  private palette: EnvironmentPalette = deriveEnvironmentPalette(this.state);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly ocean: OceanSystem,
  ) {
    this.skyUniforms = ocean.skyUniforms;
    this.skyUniforms.uSunDirection.value = this.sunDirection;
    this.skyUniforms.uMoonDirection.value = this.moonDirection;
    this.skyUniforms.uLightDirection.value = this.celestialLightDirection;

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(920, 48, 24),
      new THREE.ShaderMaterial({
        name: "AnalyticSky",
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader,
        uniforms: {
          ...this.skyUniforms,
          uSkyDetail: this.skyDetail,
          uBelowColor: { value: new THREE.Color() },
          uBelowMix: { value: 0 },
          uSunDisc: this.sunDisc,
          uMoonDisc: this.moonDisc,
          uStars: this.starLight,
          uCelestial: { value: 1 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.name = "UnifiedSkyDome";
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    scene.add(this.sky);

    this.captureSky = new THREE.Mesh(
      new THREE.SphereGeometry(40, 32, 16),
      new THREE.ShaderMaterial({
        name: "AnalyticSkyCapture",
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader,
        uniforms: {
          ...this.skyUniforms,
          uSkyDetail: { value: 0 },
          uBelowColor: { value: this.captureBelowColor },
          uBelowMix: { value: 1 },
          // The lighting capture leaves the bodies out: the directional
          // light already carries the sun and the moon.
          uSunDisc: this.sunDisc,
          uMoonDisc: this.moonDisc,
          uStars: this.starLight,
          uCelestial: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.captureScene.add(this.captureSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.lightningSystem = new LightningSystem(scene);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.left = -SHADOW_EXTENT;
    this.sunLight.shadow.camera.right = SHADOW_EXTENT;
    this.sunLight.shadow.camera.top = SHADOW_EXTENT;
    this.sunLight.shadow.camera.bottom = -SHADOW_EXTENT;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 120;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.035;
    this.sunLight.shadow.radius = 2.5;
    scene.add(this.sunLight, this.sunLight.target);
    // Most ambient light now comes from the sky capture; the hemisphere light
    // only lifts shadowed faces that the low-resolution capture under-lights.
    this.hemisphere = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(this.hemisphere);
    scene.fog = new THREE.FogExp2(0x91cddb, 0.0008);
    scene.environmentIntensity = 0.5;
    this.update(0, null, new THREE.Vector3(), 0);
  }

  /** Sky dome, with the sun, moon and stars in it; the ocean reflects it analytically. */
  get celestial(): THREE.Object3D[] {
    return [this.sky];
  }

  /** Current weather (cloud cover and overcast), for sound and anything else that cares. */
  get currentWeather(): Readonly<WeatherSample> {
    return this.weather;
  }

  /** Lightning light on the scene right now, 0…~1.6. */
  get lightning(): number {
    return this.flash;
  }

  /** Strikes that began since the last call: distance and bearing, for the thunder. */
  consumeStrikes(): StrikeEvent[] {
    return this.lightningSystem.consumeStrikes();
  }

  /** Whether it is (or is becoming) night, for the interface while the cycle runs by itself. */
  get isNight(): boolean {
    return this.transition > 0.5;
  }

  /**
   * The brightest signal flare burning (`brightness` 0 for none): its light
   * swings the key light toward it and tints the sea, the sails and the
   * foam in its colour — as lightning does, without adding a light.
   */
  setFlare(position: THREE.Vector3 | null, brightness: number, rgb: readonly [number, number, number]): void {
    this.flareBrightness = position ? Math.max(0, brightness) : 0;
    if (position) this.flarePosition.copy(position);
    this.flareRgb = rgb;
  }

  /** The weather the sky is easing toward. */
  setWeatherKind(kind: WeatherKind, immediate = false): void {
    this.weatherKind = kind;
    if (immediate) this.settleWeatherNext = true;
  }

  /**
   * Turns the automatic day cycle on or off. Turning it on continues from the
   * time of day on show, so nothing jumps.
   */
  setAutoCycle(enabled: boolean): void {
    if (enabled === this.autoCycle) return;
    this.autoCycle = enabled;
    if (enabled) this.cycleTime = this.transition >= 0.5 ? CYCLE_NIGHT_START : CYCLE_DAY_START;
  }

  /** Direction toward the dominant light (sun by day, moon by night). */
  get lightDirection(): THREE.Vector3 {
    return this.celestialLightDirection;
  }

  get current(): { state: TimeOfDayState; palette: EnvironmentPalette } {
    return { state: this.state, palette: this.palette };
  }

  setMode(mode: LightingMode): void {
    this.mode = mode;
    // Choosing day or night while the cycle runs restarts it from there.
    if (this.autoCycle) this.cycleTime = mode === "night" ? CYCLE_NIGHT_START : CYCLE_DAY_START;
  }

  setSkyDetail(detail: number): void {
    this.skyDetail.value = detail;
  }

  update(delta: number, camera: THREE.Camera | null, focus: THREE.Vector3, time: number): TimeOfDayState {
    // A steady march through dusk or dawn, eased at both ends. In the
    // automatic cycle the goal moves with the clock; a manual choice (or a jump
    // of the cycle) is caught up at the quick manual pace.
    let goal = this.mode === "night" ? 1 : 0;
    let sunArc = 0;
    if (this.autoCycle) {
      this.cycleTime += delta;
      const cycle = dayCycleState(this.cycleTime);
      goal = cycle.progress;
      sunArc = cycle.sunArc;
    }
    const maxStep = delta / TRANSITION_SECONDS;
    this.transition = clamp(this.transition + clamp(goal - this.transition, -maxStep, maxStep), 0, 1);
    this.nightFactor = this.transition * this.transition * (3 - 2 * this.transition);
    this.goalNight = goal * goal * (3 - 2 * goal);
    this.state = deriveTimeOfDay(this.nightFactor, sunArc);
    if (this.settleWeatherNext) {
      settleWeather(this.weather, this.weatherKind, time);
      this.settleWeatherNext = false;
    } else {
      stepWeather(this.weather, this.weatherKind, delta, time);
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      const light = this.lightningSystem.update(time, this.weather.storm, this.weather.haze, camera, this.renderer.domElement.height);
      // The eye holds a flash for a moment; a return stroke lasting a few
      // milliseconds must not fall between two frames and be lost.
      this.flash = Math.max(light.scene, this.flash * Math.exp(-delta / 0.08));
      this.skyUniforms.uFlash.value = light.sky;
      this.skyUniforms.uFlashFocus.value = light.focus;
      this.skyUniforms.uFlashDirection.value.copy(light.direction);
      // The bolt lights the cloud deck above it: the light comes from high up.
      this.flashDirection.set(light.direction.x * 0.6, Math.max(0.75, light.direction.y), light.direction.z * 0.6).normalize();
    }
    this.palette = deriveEnvironmentPalette(this.state, this.weather);
    const night = this.state.nightFactor;
    const palette = this.palette;

    // The sun stands ahead of the opening view and down the wind, so the
    // glitter path lies in front of a yacht reaching or running.
    const sunHorizontal = Math.cos(this.state.sunElevation);
    this.sunDirection.set(0.45 * sunHorizontal, Math.sin(this.state.sunElevation), 0.893 * sunHorizontal).normalize();
    const moonHorizontal = Math.cos(this.state.moonElevation);
    const moonAzimuth = THREE.MathUtils.degToRad(12);
    this.moonDirection
      .set(
        Math.sin(moonAzimuth) * moonHorizontal,
        Math.sin(this.state.moonElevation),
        Math.cos(moonAzimuth) * moonHorizontal,
      )
      .normalize();
    this.celestialLightDirection.copy(this.sunDirection).lerp(this.moonDirection, palette.moonBlend).normalize();
    // A light below the horizon would shine up through the sea.
    if (this.celestialLightDirection.y < 0.06) {
      this.celestialLightDirection.y = 0.06;
      this.celestialLightDirection.normalize();
    }

    applySkyPalette(this.skyUniforms, palette, night);
    // Everything else sees the flash: sea, islands, ships, rain and haze.
    const lit = { ...litByLightning(palette, this.flash) };
    this.skyPalette = palette;
    this.palette = lit;
    // Clouds race across the sky in a gale.
    this.cloudClock += delta * this.weather.wind;
    this.skyUniforms.uCloudTime.value = this.cloudClock;
    // A flare: the light it throws on the yacht (and on the sea around her).
    const flareWeight = flareSceneWeight(night) * this.flareBrightness;
    this.flareLight = flareWeight > 0 ? flareIllumination(1, this.flarePosition.distanceTo(focus)) * flareWeight : 0;
    if (this.flareLight > 0.002) {
      const [fr, fg, fb] = this.flareRgb;
      const tint = this.flareLight;
      lit.ambientColor = [lit.ambientColor[0] + fr * tint * 0.1, lit.ambientColor[1] + fg * tint * 0.1, lit.ambientColor[2] + fb * tint * 0.1];
      lit.horizon = [lit.horizon[0] + fr * tint * 0.03, lit.horizon[1] + fg * tint * 0.03, lit.horizon[2] + fb * tint * 0.03];
      lit.rainLight = [lit.rainLight[0] + fr * tint * 0.5, lit.rainLight[1] + fg * tint * 0.5, lit.rainLight[2] + fb * tint * 0.5];
    }
    this.ocean.setFlare(
      this.flarePosition.x,
      this.flarePosition.y,
      this.flarePosition.z,
      flareWeight * 1.8,
      this.flareRgb[0],
      this.flareRgb[1],
      this.flareRgb[2],
    );
    this.ocean.setEnvironment(lit);

    if (camera) this.sky.position.copy(camera.position);

    // The disc sinks into the sea at sunset: the dome is centred on the camera,
    // so the horizon line itself cuts it.
    const sunUp = (1 - Math.pow(night, 0.65)) * (this.state.sunElevation > -0.03 ? 1 : 0);
    // Near the horizon the disc is seen through a long, hazy path: dimmer, so
    // its red-orange survives the tone curve instead of clipping to white.
    const sunDim = sunUp * (1 - 0.6 * this.weather.overcast);
    // A saturated tropical gold by day (the white-hot palette colour clipped
    // the disc to white), easing into the palette's dimmer orange at dusk.
    const goldMix = clamp(palette.twilight * 1.1, 0, 1);
    const duskRadiance = SUN_DISC_RADIANCE * (1 - 0.82 * palette.twilight);
    this.sunDisc.value.setRGB(
      (SUN_DISC_GOLD[0] + (palette.sunColor[0] * duskRadiance - SUN_DISC_GOLD[0]) * goldMix) * sunDim,
      (SUN_DISC_GOLD[1] + (palette.sunColor[1] * duskRadiance - SUN_DISC_GOLD[1]) * goldMix) * sunDim,
      (SUN_DISC_GOLD[2] + (palette.sunColor[2] * duskRadiance - SUN_DISC_GOLD[2]) * goldMix) * sunDim,
      THREE.LinearSRGBColorSpace,
    );
    const moonUp = clamp((night - 0.04) / 0.3, 0, 1) * (this.state.moonElevation > -0.02 ? 1 : 0);
    this.moonDisc.value.setRGB(1.12 * moonUp, 1.2 * moonUp, 1.34 * moonUp, THREE.LinearSRGBColorSpace);
    this.starLight.value = this.state.starVisibility;

    // A flash outshines the storm-dimmed sun: for that instant the key light
    // swings toward the strike, high over the clouds, and its shadows with it.
    // (The sun light is reused rather than a light added, so materials keep
    // one directional light and nothing recompiles when a storm begins.)
    const flashShare = clamp(this.flash * 1.6, 0, 1);
    this.keyDirection.copy(this.celestialLightDirection).lerp(this.flashDirection, flashShare);
    // So does a flare, as far as it outshines the moon.
    const flareKey = this.flareLight * 1.4;
    if (flareKey > 0.002) {
      const moonKey = (palette.lightColor[0] + palette.lightColor[1] + palette.lightColor[2]) / 3;
      this.flareDirection.copy(this.flarePosition).sub(focus).normalize();
      this.keyDirection.normalize().lerp(this.flareDirection, flareKey / (flareKey + moonKey * 0.8));
    }
    this.keyDirection.normalize();
    this.sunLight.position.copy(focus).addScaledVector(this.keyDirection, 60);
    this.sunLight.target.position.copy(focus);
    setLinearColor(this.sunLight.color, palette.lightColor);
    // Direct sun is several times the sky's light on a clear day; with a
    // weaker key the sky fill tints every white surface blue and flattens it.
    this.sunLight.intensity = 1.3;
    // Lightning: a cold light from above the clouds, for an instant as
    // bright as day, and the sky's own light (the environment) flares too.
    if (this.flash > 0.005) {
      this.flashColor.setRGB(LIGHTNING_COLOR[0], LIGHTNING_COLOR[1], LIGHTNING_COLOR[2], THREE.LinearSRGBColorSpace);
      this.sunLight.color.add(this.flashColor.multiplyScalar(this.flash * 1.9));
    }
    if (flareKey > 0.002) {
      this.flareColor.setRGB(this.flareRgb[0], this.flareRgb[1], this.flareRgb[2], THREE.LinearSRGBColorSpace);
      this.sunLight.color.add(this.flareColor.multiplyScalar(flareKey));
    }
    this.scene.environmentIntensity = 0.5 + this.flash * 1.1;
    setLinearColor(this.hemisphere.color, lit.ambientColor);
    this.hemisphere.groundColor.setRGB(
      palette.deepWater[0] * 2 + palette.ambientColor[0] * 0.12,
      palette.deepWater[1] * 2 + palette.ambientColor[1] * 0.12,
      palette.deepWater[2] * 2 + palette.ambientColor[2] * 0.12,
      THREE.LinearSRGBColorSpace,
    );
    this.hemisphere.intensity = 0.3 + this.flash * 1.2;
    // Storm light is dark; a little more exposure keeps the sea readable.
    this.renderer.toneMappingExposure = this.state.exposure * (1 + 0.16 * this.weather.storm);

    setLinearColor(this.fogColor, lit.horizon);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = (0.0008 + night * 0.0001) * (1 + this.weather.haze * 3.4);
    }
    this.scene.background = this.fogColor;

    this.captureCooldown -= delta;
    const settled = Math.abs(night - this.goalNight) < 0.004;
    const drift = Math.abs(night - this.capturedNight);
    if (
      Number.isNaN(this.capturedNight) ||
      (drift > CAPTURE_THRESHOLD && this.captureCooldown <= 0) ||
      (settled && drift > 0.0005)
    ) {
      this.captureLighting(night);
    }
    return this.state;
  }

  setShadowMapSize(size: number): void {
    this.sunLight.shadow.mapSize.set(size, size);
    this.sunLight.shadow.map?.dispose();
    this.sunLight.shadow.map = null;
  }

  dispose(): void {
    const objects: THREE.Object3D[] = [
      this.sky,
      this.sunLight,
      this.sunLight.target,
      this.hemisphere,
    ];
    objects.forEach((object) => this.scene.remove(object));
    this.lightningSystem.dispose(this.scene);
    this.scene.environment = null;
    this.scene.background = null;
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.captureSky.geometry.dispose();
    this.captureSky.material.dispose();
    this.captureTarget?.dispose();
    this.captureTarget = null;
    this.pmrem.dispose();
    this.sunLight.shadow.map?.dispose();
  }

  /** Forgets the lighting capture (the GPU lost it); the next update draws it again. */
  invalidateLighting(): void {
    this.capturedNight = Number.NaN;
    this.captureCooldown = 0;
  }

  private captureLighting(night: number): void {
    const palette = this.skyPalette ?? this.palette;
    this.captureBelowColor.setRGB(
      palette.deepWater[0] * (palette.ambientColor[0] + 0.25 * palette.lightColor[0]) + palette.horizon[0] * 0.08,
      palette.deepWater[1] * (palette.ambientColor[1] + 0.25 * palette.lightColor[1]) + palette.horizon[1] * 0.08,
      palette.deepWater[2] * (palette.ambientColor[2] + 0.25 * palette.lightColor[2]) + palette.horizon[2] * 0.08,
      THREE.LinearSRGBColorSpace,
    );
    const next = this.pmrem.fromScene(this.captureScene, 0, 0.1, 100, { size: CAPTURE_SIZE });
    this.scene.environment = next.texture;
    this.captureTarget?.dispose();
    this.captureTarget = next;
    this.capturedNight = night;
    this.captureCooldown = CAPTURE_INTERVAL;
  }
}
