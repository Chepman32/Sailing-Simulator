import * as THREE from "three";
import type { LightingMode } from "../types";
import { damp } from "../math";
import { deriveTimeOfDay, type TimeOfDayState } from "./EnvironmentMath";
import type { OceanSystem } from "./OceanSystem";

const skyVertexShader = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDirection = normalize(world.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const skyFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDirection;
  uniform float uNight;
  varying vec3 vWorldDirection;

  void main() {
    vec3 direction = normalize(vWorldDirection);
    float vertical = smoothstep(-0.18, 0.82, direction.y);
    vec3 sky = mix(uHorizon, uZenith, pow(vertical, 0.62));
    float sunAlignment = max(dot(direction, normalize(uSunDirection)), 0.0);
    float sunScatter = pow(sunAlignment, 10.0);
    // A warm, golden aureole around the tropical sun.
    float aureole = pow(sunAlignment, 42.0);
    // Mix toward gold rather than adding light: adding warm light to a blue
    // sky sums to white and made the tropical sun read as a white disc.
    sky = mix(sky, vec3(1.0, 0.9, 0.64), sunScatter * 0.32 * (1.0 - uNight));
    sky = mix(sky, vec3(1.0, 0.82, 0.38), aureole * 0.78 * (1.0 - uNight));
    sky += sunScatter * vec3(0.14, 0.21, 0.38) * uNight * 0.1;
    float lowerHaze = smoothstep(0.18, -0.12, abs(direction.y));
    sky = mix(sky, uHorizon, lowerHaze * 0.3);
    gl_FragColor = vec4(sky, 1.0);
  }
`;

function radialTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, "rgba(255,255,255,.82)");
  gradient.addColorStop(0.36, "rgba(255,255,255,.22)");
  gradient.addColorStop(0.7, "rgba(255,255,255,.05)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
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

export class EnvironmentSystem {
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly skyUniforms: Record<string, THREE.IUniform>;
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly sunCore: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly sunHalo: THREE.Sprite;
  private readonly sunCorona: THREE.Sprite;
  private readonly moon: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly moonHalo: THREE.Sprite;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly sunDirection = new THREE.Vector3();
  private readonly moonDirection = new THREE.Vector3();
  private readonly celestialLightDirection = new THREE.Vector3();
  private readonly skyColor = new THREE.Color();
  private readonly horizonColor = new THREE.Color();
  private readonly nightSkyColor = new THREE.Color(0x061a3a);
  private readonly nightHorizonColor = new THREE.Color(0x17395f);
  private readonly sunsetColor = new THREE.Color(0xff9b58);
  private readonly moonlightColor = new THREE.Color(0xa9cfff);
  private readonly nightHemisphereColor = new THREE.Color(0x526f9f);
  private readonly nightGroundColor = new THREE.Color(0x0b2035);
  private readonly nightAmbientColor = new THREE.Color(0x789bc8);
  private readonly glowTexture = radialTexture();
  private readonly starsTexture = starTexture();
  // Linear values: these output as a saturated golden yellow in sRGB.
  private readonly sunCoreDay = new THREE.Color(1, 0.66, 0.12);
  private readonly sunCoreSet = new THREE.Color(1, 0.55, 0.22);
  private mode: LightingMode = "day";
  private nightFactor = 0;
  private state: TimeOfDayState = deriveTimeOfDay(0);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly ocean: OceanSystem,
  ) {
    this.skyUniforms = {
      uZenith: { value: new THREE.Color(0x159ce0) },
      uHorizon: { value: new THREE.Color(0xbdeaf5) },
      uSunDirection: { value: this.sunDirection },
      uNight: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      // Large enough that ships and the volcano beyond 1 km stay in front of it.
      new THREE.SphereGeometry(2400, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader,
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.name = "UnifiedSkyDome";
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    scene.add(this.sky);

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
    });
    this.stars = new THREE.Points(starsGeometry, starsMaterial);
    this.stars.name = "DepthTestedStars";
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -80;
    scene.add(this.stars);

    // The tropical sun is a saturated golden disc. It bypasses tone mapping and
    // fog (which used to wash it out to white) but still writes depth, so a
    // sail or mast in front of it occludes the disc and both glows.
    this.sunCore = new THREE.Mesh(
      new THREE.SphereGeometry(15, 32, 20),
      new THREE.MeshBasicMaterial({ color: this.sunCoreDay, depthTest: true, depthWrite: true, fog: false, toneMapped: false }),
    );
    this.sunCore.name = "DepthCorrectSunCore";
    scene.add(this.sunCore);

    this.sunHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffd23c,
        transparent: true,
        opacity: 0.8,
        depthTest: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        // Normal blending keeps the glow golden; additive saturated it to white.
        blending: THREE.NormalBlending,
      }),
    );
    this.sunHalo.scale.set(105, 105, 1);
    this.sunHalo.name = "OccludedSunGlow";
    scene.add(this.sunHalo);
    this.sunCorona = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffb03a,
        transparent: true,
        opacity: 0.16,
        depthTest: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sunCorona.scale.set(420, 420, 1);
    this.sunCorona.name = "OccludedSunCorona";
    scene.add(this.sunCorona);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(12, 40, 24),
      new THREE.MeshBasicMaterial({ color: 0xf7f9ff, depthTest: true, depthWrite: true, fog: false, toneMapped: false }),
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
        toneMapped: false,
      }),
    );
    this.moonHalo.scale.set(108, 108, 1);
    this.moonHalo.name = "MoonHalo";
    scene.add(this.moonHalo);

    this.sunLight = new THREE.DirectionalLight(0xfff0c8, 3.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.left = -55;
    this.sunLight.shadow.camera.right = 55;
    this.sunLight.shadow.camera.top = 55;
    this.sunLight.shadow.camera.bottom = -55;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 260;
    this.sunLight.shadow.bias = -0.00018;
    this.sunLight.shadow.normalBias = 0.02;
    scene.add(this.sunLight, this.sunLight.target);
    this.hemisphere = new THREE.HemisphereLight(0xbfeaff, 0x275960, 1.25);
    this.ambient = new THREE.AmbientLight(0x9bc5da, 0.32);
    scene.add(this.hemisphere, this.ambient);
    scene.fog = new THREE.FogExp2(0x91cddb, 0.00115);
  }

  setMode(mode: LightingMode): void {
    this.mode = mode;
  }

  update(delta: number, camera: THREE.Camera, focus: THREE.Vector3): TimeOfDayState {
    this.nightFactor = damp(this.nightFactor, this.mode === "night" ? 1 : 0, 1.7, delta);
    this.state = deriveTimeOfDay(this.nightFactor);
    const night = this.state.nightFactor;

    this.sunDirection.set(0.64, Math.sin(this.state.sunElevation), -0.58).normalize();
    const moonHorizontal = Math.cos(this.state.moonElevation);
    const moonAzimuth = THREE.MathUtils.degToRad(12);
    this.moonDirection
      .set(
        Math.sin(moonAzimuth) * moonHorizontal,
        Math.sin(this.state.moonElevation),
        Math.cos(moonAzimuth) * moonHorizontal,
      )
      .normalize();
    this.celestialLightDirection
      .copy(this.sunDirection)
      .lerp(this.moonDirection, THREE.MathUtils.smoothstep(night, 0.35, 0.78))
      .normalize();
    this.skyColor.set(0x159ce0).lerp(this.nightSkyColor, night);
    this.horizonColor.set(0xbdeaf5).lerp(this.nightHorizonColor, night);
    (this.skyUniforms.uZenith.value as THREE.Color).copy(this.skyColor);
    (this.skyUniforms.uHorizon.value as THREE.Color).copy(this.horizonColor);
    this.skyUniforms.uNight.value = night;

    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.sunCore.position.copy(camera.position).addScaledVector(this.sunDirection, 730);
    this.sunHalo.position.copy(this.sunCore.position);
    this.sunCorona.position.copy(this.sunCore.position);
    this.moon.position.copy(camera.position).addScaledVector(this.moonDirection, 710);
    this.moonHalo.position.copy(this.moon.position);

    const sunOpacity = 1 - Math.pow(night, 0.65);
    this.sunCore.visible = sunOpacity > 0.025;
    this.sunCore.material.color.copy(this.sunCoreDay).lerp(this.sunCoreSet, Math.min(1, night * 1.6));
    (this.sunHalo.material as THREE.SpriteMaterial).opacity = sunOpacity * 0.8;
    (this.sunCorona.material as THREE.SpriteMaterial).opacity = sunOpacity * 0.16;
    this.moon.visible = night > 0.04;
    (this.moonHalo.material as THREE.SpriteMaterial).opacity = this.state.starVisibility * 0.72;
    this.stars.material.opacity = this.state.starVisibility * 0.94;

    this.sunLight.position.copy(focus).addScaledVector(this.celestialLightDirection, 110);
    this.sunLight.target.position.copy(focus);
    this.sunLight.intensity = THREE.MathUtils.lerp(3.2, 1.25, night);
    this.sunLight.color.set(0xfff0c8).lerp(this.moonlightColor, night);
    this.hemisphere.intensity = THREE.MathUtils.lerp(1.25, 0.78, night);
    this.hemisphere.color.set(0xbfeaff).lerp(this.nightHemisphereColor, night);
    this.hemisphere.groundColor.set(0x275960).lerp(this.nightGroundColor, night);
    this.ambient.color.set(0x9bc5da).lerp(this.nightAmbientColor, night);
    this.ambient.intensity = THREE.MathUtils.lerp(0.32, 0.38, night);
    this.renderer.toneMappingExposure = this.state.exposure;

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.horizonColor);
      this.scene.fog.density = 0.00115 + night * 0.0001;
    }
    // The sky dome covers the frame. A clear colour (instead of
    // scene.background) lets the ship pass render first without being wiped.
    this.renderer.setClearColor(this.horizonColor, 1);
    this.ocean.setEnvironment(night, this.celestialLightDirection, this.horizonColor);
    return this.state;
  }

  /** Lighting the separate ship render pass mirrors each frame. */
  get lighting(): {
    sunDirection: THREE.Vector3;
    sunColor: THREE.Color;
    sunIntensity: number;
    hemisphere: THREE.HemisphereLight;
    ambient: THREE.AmbientLight;
    nightFactor: number;
    skyColor: THREE.Color;
    horizonColor: THREE.Color;
  } {
    return {
      sunDirection: this.celestialLightDirection,
      sunColor: this.sunLight.color,
      sunIntensity: this.sunLight.intensity,
      hemisphere: this.hemisphere,
      ambient: this.ambient,
      nightFactor: this.state.nightFactor,
      skyColor: this.skyColor,
      horizonColor: this.horizonColor,
    };
  }

  setShadowsEnabled(enabled: boolean): void {
    this.sunLight.castShadow = enabled;
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
      this.sunCorona,
      this.moon,
      this.moonHalo,
      this.sunLight,
      this.sunLight.target,
      this.hemisphere,
      this.ambient,
    ];
    objects.forEach((object) => this.scene.remove(object));
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.sunCore.geometry.dispose();
    this.sunCore.material.dispose();
    this.moon.geometry.dispose();
    this.moon.material.dispose();
    (this.sunHalo.material as THREE.SpriteMaterial).dispose();
    (this.sunCorona.material as THREE.SpriteMaterial).dispose();
    (this.moonHalo.material as THREE.SpriteMaterial).dispose();
    this.glowTexture.dispose();
    this.starsTexture.dispose();
  }
}
