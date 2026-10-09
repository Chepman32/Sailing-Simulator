import * as THREE from "three";
import type { LightingMode } from "../types";
import { damp } from "../math";
import { deriveTimeOfDay, type TimeOfDayState } from "./EnvironmentMath";
import { deriveEnvironmentPalette, type EnvironmentPalette } from "./EnvironmentPalette";
import type { OceanSystem } from "./OceanSystem";
import { applySkyPalette, setLinearColor, type SkyUniforms } from "./SkyUniforms";
import { skyFragmentShader, skyVertexShader } from "./shaders/skyShader";

/** Half extent of the sun shadow frustum: just enough to hold the yacht. */
const SHADOW_EXTENT = 17;
/** Night-factor change that triggers a new lighting capture. */
const CAPTURE_THRESHOLD = 0.025;
const CAPTURE_INTERVAL = 0.22;
const CAPTURE_SIZE = 128;

function radialTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.14, "rgba(255,250,224,.82)");
  gradient.addColorStop(0.42, "rgba(255,226,160,.2)");
  gradient.addColorStop(1, "rgba(255,210,120,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function starTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, "rgba(215,232,255,.95)");
  gradient.addColorStop(0.32, "rgba(150,190,255,.28)");
  gradient.addColorStop(1, "rgba(120,170,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

/** Soft lunar maria so the moon reads as a body rather than a flat disc. */
function moonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  context.fillStyle = "#f4f4ee";
  context.fillRect(0, 0, 256, 128);
  let seed = 4129;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let index = 0; index < 46; index += 1) {
    const x = random() * 256;
    const y = 18 + random() * 92;
    const radius = 5 + random() * 22;
    const shade = context.createRadialGradient(x, y, 0, x, y, radius);
    const darkness = 0.1 + random() * 0.2;
    shade.addColorStop(0, `rgba(96,104,122,${darkness})`);
    shade.addColorStop(1, "rgba(96,104,122,0)");
    context.fillStyle = shade;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

export class EnvironmentSystem {
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly skyUniforms: SkyUniforms;
  private readonly skyDetail: THREE.IUniform<number> = { value: 1 };
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly sunCore: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly sunHalo: THREE.Sprite;
  private readonly moon: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly moonHalo: THREE.Sprite;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly sunDirection = new THREE.Vector3();
  private readonly moonDirection = new THREE.Vector3();
  private readonly celestialLightDirection = new THREE.Vector3();
  private readonly fogColor = new THREE.Color();
  private readonly glowTexture = radialTexture();
  private readonly starsTexture = starTexture();
  private readonly moonMap = moonTexture();
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
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.captureScene.add(this.captureSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const starPositions = new Float32Array(1100 * 3);
    let seed = 9187;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let index = 0; index < 1100; index += 1) {
      const azimuth = random() * Math.PI * 2;
      const elevation = 0.08 + random() * 1.35;
      const radius = 875;
      starPositions[index * 3] = Math.cos(azimuth) * Math.cos(elevation) * radius;
      starPositions[index * 3 + 1] = Math.sin(elevation) * radius;
      starPositions[index * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * radius;
    }
    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starsMaterial = new THREE.PointsMaterial({
      color: 0xdceaff,
      map: this.starsTexture,
      size: 2.15,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      alphaTest: 0.02,
      fog: false,
    });
    this.stars = new THREE.Points(starsGeometry, starsMaterial);
    this.stars.name = "DepthTestedStars";
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -80;
    scene.add(this.stars);

    // The solar disc is brighter than white so the tone mapper and the bloom
    // pass treat it as a light source. It still writes and tests depth, so a
    // sail or the mast occludes it.
    this.sunCore = new THREE.Mesh(
      new THREE.SphereGeometry(11, 32, 20),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true, depthWrite: true, fog: false }),
    );
    this.sunCore.name = "DepthCorrectSunCore";
    scene.add(this.sunCore);

    this.sunHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffe2a8,
        transparent: true,
        opacity: 0.4,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.sunHalo.scale.set(96, 96, 1);
    this.sunHalo.name = "OccludedSunGlow";
    scene.add(this.sunHalo);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(12, 40, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, map: this.moonMap, depthTest: true, depthWrite: true, fog: false }),
    );
    this.moon.name = "Moon";
    scene.add(this.moon);
    this.moonHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0x91baff,
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.moonHalo.scale.set(118, 118, 1);
    this.moonHalo.name = "MoonHalo";
    scene.add(this.moonHalo);

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

  /** Direction toward the dominant light (sun by day, moon by night). */
  /** Sky dome and celestial bodies; the ocean reflects these analytically. */
  get celestial(): THREE.Object3D[] {
    return [this.sky, this.stars, this.sunCore, this.sunHalo, this.moon, this.moonHalo];
  }

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
    this.nightFactor = damp(this.nightFactor, this.mode === "night" ? 1 : 0, 1.7, delta);
    this.state = deriveTimeOfDay(this.nightFactor);
    this.palette = deriveEnvironmentPalette(this.state);
    const night = this.state.nightFactor;
    const palette = this.palette;

    // The sun stands ahead of the opening view and down the wind, so the
    // glitter path lies in front of a yacht reaching or running.
    const sunHorizontal = Math.cos(this.state.sunElevation);
    this.sunDirection.set(0.62 * sunHorizontal, Math.sin(this.state.sunElevation), 0.785 * sunHorizontal).normalize();
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

    if (camera) {
      this.sky.position.copy(camera.position);
      this.stars.position.copy(camera.position);
      this.sunCore.position.copy(camera.position).addScaledVector(this.sunDirection, 730);
      this.sunHalo.position.copy(this.sunCore.position);
      this.moon.position.copy(camera.position).addScaledVector(this.moonDirection, 710);
      this.moon.lookAt(camera.position);
      this.moonHalo.position.copy(this.moon.position);
    }

    const sunOpacity = 1 - Math.pow(night, 0.65);
    this.sunCore.visible = sunOpacity > 0.025 && this.state.sunElevation > -0.06;
    this.sunCore.material.color.setRGB(
      palette.sunColor[0] * 14,
      palette.sunColor[1] * 14,
      palette.sunColor[2] * 14,
      THREE.LinearSRGBColorSpace,
    );
    (this.sunHalo.material as THREE.SpriteMaterial).opacity = this.sunCore.visible ? sunOpacity * 0.4 : 0;
    this.moon.visible = night > 0.04;
    this.moon.material.color.setRGB(2.3, 2.45, 2.75, THREE.LinearSRGBColorSpace);
    (this.moonHalo.material as THREE.SpriteMaterial).opacity = this.state.starVisibility * 0.55;
    this.stars.material.opacity = this.state.starVisibility * 0.94;

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
      this.stars,
      this.sunCore,
      this.sunHalo,
      this.moon,
      this.moonHalo,
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
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.sunCore.geometry.dispose();
    this.sunCore.material.dispose();
    this.moon.geometry.dispose();
    this.moon.material.dispose();
    (this.sunHalo.material as THREE.SpriteMaterial).dispose();
    (this.moonHalo.material as THREE.SpriteMaterial).dispose();
    this.sunLight.shadow.map?.dispose();
    this.glowTexture.dispose();
    this.starsTexture.dispose();
    this.moonMap.dispose();
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
