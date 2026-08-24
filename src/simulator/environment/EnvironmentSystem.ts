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
    float sunScatter = pow(max(dot(direction, normalize(uSunDirection)), 0.0), 10.0);
    sky += sunScatter * mix(vec3(1.0, 0.54, 0.22), vec3(0.14, 0.21, 0.38), uNight) * (1.0 - uNight) * 0.28;
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
  gradient.addColorStop(0.16, "rgba(255,248,211,.95)");
  gradient.addColorStop(0.5, "rgba(255,221,145,.24)");
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

export class EnvironmentSystem {
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly skyUniforms: Record<string, THREE.IUniform>;
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly sunCore: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly sunHalo: THREE.Sprite;
  private readonly moon: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly moonHalo: THREE.Sprite;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly sunDirection = new THREE.Vector3();
  private readonly moonDirection = new THREE.Vector3();
  private readonly skyColor = new THREE.Color();
  private readonly horizonColor = new THREE.Color();
  private readonly nightSkyColor = new THREE.Color(0x020817);
  private readonly nightHorizonColor = new THREE.Color(0x0a1731);
  private readonly sunsetColor = new THREE.Color(0xff9b58);
  private readonly moonlightColor = new THREE.Color(0x8eb9ff);
  private readonly nightHemisphereColor = new THREE.Color(0x21385e);
  private readonly nightGroundColor = new THREE.Color(0x020815);
  private readonly glowTexture = radialTexture();
  private readonly starsTexture = starTexture();
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
      new THREE.SphereGeometry(920, 48, 24),
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

    this.sunCore = new THREE.Mesh(
      new THREE.SphereGeometry(13, 32, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, depthTest: true, depthWrite: true }),
    );
    this.sunCore.name = "DepthCorrectSunCore";
    scene.add(this.sunCore);

    this.sunHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffd98d,
        transparent: true,
        opacity: 0.54,
        depthTest: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    );
    this.sunHalo.scale.set(92, 92, 1);
    this.sunHalo.name = "OccludedSunGlow";
    scene.add(this.sunHalo);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 20),
      new THREE.MeshStandardMaterial({ color: 0xe3ebfa, roughness: 0.82, emissive: 0x18233d, emissiveIntensity: 0.3 }),
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
        blending: THREE.NormalBlending,
      }),
    );
    this.moonHalo.scale.set(68, 68, 1);
    this.moonHalo.name = "MoonHalo";
    scene.add(this.moonHalo);

    this.sunLight = new THREE.DirectionalLight(0xfff2d2, 3.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.left = -55;
    this.sunLight.shadow.camera.right = 55;
    this.sunLight.shadow.camera.top = 55;
    this.sunLight.shadow.camera.bottom = -55;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 260;
    this.sunLight.shadow.bias = -0.00018;
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
    this.moonDirection
      .set(-0.67152 * moonHorizontal, Math.sin(this.state.moonElevation), 0.74099 * moonHorizontal)
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
    this.moon.position.copy(camera.position).addScaledVector(this.moonDirection, 710);
    this.moonHalo.position.copy(this.moon.position);

    const sunOpacity = 1 - Math.pow(night, 0.65);
    this.sunCore.visible = sunOpacity > 0.025;
    this.sunCore.material.color.set(0xfff0b0).lerp(this.sunsetColor, night * 0.45);
    (this.sunHalo.material as THREE.SpriteMaterial).opacity = sunOpacity * 0.54;
    this.moon.visible = night > 0.04;
    (this.moonHalo.material as THREE.SpriteMaterial).opacity = this.state.starVisibility * 0.32;
    this.stars.material.opacity = this.state.starVisibility * 0.94;

    this.sunLight.position.copy(focus).addScaledVector(this.sunDirection, 110);
    this.sunLight.target.position.copy(focus);
    this.sunLight.intensity = 3.2 - night * 2.82;
    this.sunLight.color.set(0xfff2d2).lerp(this.moonlightColor, night);
    this.hemisphere.intensity = 1.25 - night * 0.83;
    this.hemisphere.color.set(0xbfeaff).lerp(this.nightHemisphereColor, night);
    this.hemisphere.groundColor.set(0x275960).lerp(this.nightGroundColor, night);
    this.ambient.intensity = 0.32 - night * 0.12;
    this.renderer.toneMappingExposure = this.state.exposure;

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.horizonColor);
      this.scene.fog.density = 0.00115 + night * 0.00045;
    }
    this.scene.background = this.skyColor;
    this.ocean.setEnvironment(night, this.sunDirection, this.horizonColor);
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
    (this.moonHalo.material as THREE.SpriteMaterial).dispose();
    this.glowTexture.dispose();
    this.starsTexture.dispose();
  }
}
