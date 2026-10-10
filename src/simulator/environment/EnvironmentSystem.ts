import * as THREE from "three";
import type { LightingMode } from "../types";
import { clamp } from "../math";
import { deriveTimeOfDay, type TimeOfDayState } from "./EnvironmentMath";
import { deriveEnvironmentPalette, type EnvironmentPalette } from "./EnvironmentPalette";
import type { OceanSystem } from "./OceanSystem";
import { applySkyPalette, setLinearColor, type SkyUniforms } from "./SkyUniforms";
import { skyFragmentShader, skyVertexShader } from "./shaders/skyShader";
import { sampleWeather, type WeatherSample } from "./WeatherMath";

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
/** HDR radiance of the solar disc relative to the sun's tint. */
const SUN_DISC_RADIANCE = 16;

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
  private readonly weather: WeatherSample = { cloudCover: 0.25, overcast: 0 };
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
  private nightFactor = 0;
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
    scene.fog = new THREE.FogExp2(0x91cddb, 0.00105);
    scene.environmentIntensity = 0.85;
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

  /** Direction toward the dominant light (sun by day, moon by night). */
  get lightDirection(): THREE.Vector3 {
    return this.celestialLightDirection;
  }

  get current(): { state: TimeOfDayState; palette: EnvironmentPalette } {
    return { state: this.state, palette: this.palette };
  }

  setMode(mode: LightingMode): void {
    this.mode = mode;
  }

  setSkyDetail(detail: number): void {
    this.skyDetail.value = detail;
  }

  update(delta: number, camera: THREE.Camera | null, focus: THREE.Vector3, time: number): TimeOfDayState {
    // A steady march through dusk or dawn, eased at both ends.
    this.transition = clamp(
      this.transition + (this.mode === "night" ? 1 : -1) * (delta / TRANSITION_SECONDS),
      0,
      1,
    );
    this.nightFactor = this.transition * this.transition * (3 - 2 * this.transition);
    this.state = deriveTimeOfDay(this.nightFactor);
    sampleWeather(time, this.weather);
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
    this.skyUniforms.uCloudTime.value = time;
    this.ocean.setEnvironment(palette);

    if (camera) this.sky.position.copy(camera.position);

    // The disc sinks into the sea at sunset: the dome is centred on the camera,
    // so the horizon line itself cuts it.
    const sunUp = (1 - Math.pow(night, 0.65)) * (this.state.sunElevation > -0.03 ? 1 : 0);
    // Near the horizon the disc is seen through a long, hazy path: dimmer, so
    // its red-orange survives the tone curve instead of clipping to white.
    const sunRadiance = SUN_DISC_RADIANCE * sunUp * (1 - 0.82 * palette.twilight);
    this.sunDisc.value.setRGB(
      palette.sunColor[0] * sunRadiance,
      palette.sunColor[1] * sunRadiance,
      palette.sunColor[2] * sunRadiance,
      THREE.LinearSRGBColorSpace,
    );
    const moonUp = clamp((night - 0.04) / 0.3, 0, 1) * (this.state.moonElevation > -0.02 ? 1 : 0);
    this.moonDisc.value.setRGB(2.1 * moonUp, 2.25 * moonUp, 2.5 * moonUp, THREE.LinearSRGBColorSpace);
    this.starLight.value = this.state.starVisibility;

    this.sunLight.position.copy(focus).addScaledVector(this.celestialLightDirection, 60);
    this.sunLight.target.position.copy(focus);
    setLinearColor(this.sunLight.color, palette.lightColor);
    this.sunLight.intensity = 1;
    setLinearColor(this.hemisphere.color, palette.ambientColor);
    this.hemisphere.groundColor.setRGB(
      palette.deepWater[0] * 2 + palette.ambientColor[0] * 0.12,
      palette.deepWater[1] * 2 + palette.ambientColor[1] * 0.12,
      palette.deepWater[2] * 2 + palette.ambientColor[2] * 0.12,
      THREE.LinearSRGBColorSpace,
    );
    this.hemisphere.intensity = 0.55;
    this.renderer.toneMappingExposure = this.state.exposure;

    setLinearColor(this.fogColor, palette.horizon);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.fogColor);
      this.scene.fog.density = 0.00105 + night * 0.0001;
    }
    this.scene.background = this.fogColor;

    this.captureCooldown -= delta;
    const settled = Math.abs(night - (this.mode === "night" ? 1 : 0)) < 0.004;
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

  private captureLighting(night: number): void {
    const palette = this.palette;
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
