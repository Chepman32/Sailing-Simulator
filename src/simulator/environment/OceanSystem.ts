import * as THREE from "three";
import type { QualitySettings } from "../core/QualityManager";
import { OCEAN_WAVES, sampleOcean, type OceanSample } from "./OceanMath";

const OCEAN_SIZE = 1800;
const FOCUSED_GRID_SCALE = 140;
const DAY_DEEP = new THREE.Color(0x036ba9);
const DAY_SHALLOW = new THREE.Color(0x35cce2);
const NIGHT_DEEP = new THREE.Color(0x072a52);
const NIGHT_SHALLOW = new THREE.Color(0x155e87);

function glsl(value: number): string {
  return value.toFixed(6);
}

const waveDisplacement = OCEAN_WAVES.map(
  (wave) => `
    offset += gerstnerOffset(
      vec2(${glsl(wave.directionX)}, ${glsl(wave.directionZ)}),
      ${glsl(wave.amplitude)},
      ${glsl(wave.wavelength)},
      ${glsl(wave.speed)},
      ${glsl(wave.steepness)},
      worldBase,
      slope,
      crestEnergy
    );`,
).join("");

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vCrest;
  varying float vWaveHeight;

  const float PI = 3.141592653589793;

  vec3 gerstnerOffset(
    vec2 direction,
    float amplitude,
    float wavelength,
    float speed,
    float steepness,
    vec3 worldBase,
    inout vec2 slope,
    inout float crestEnergy
  ) {
    vec2 d = normalize(direction);
    float k = 2.0 * PI / wavelength;
    float omega = sqrt(9.81 * k) * speed;
    float phase = k * dot(d, worldBase.xz) - omega * uTime;
    float wave = sin(phase);
    float cosine = cos(phase);
    slope += amplitude * k * d * cosine;
    crestEnergy += max(wave, 0.0) * amplitude;
    return vec3(
      d.x * steepness * amplitude * cosine,
      amplitude * wave,
      d.y * steepness * amplitude * cosine
    );
  }

  void main() {
    vec3 worldBase = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 offset = vec3(0.0);
    vec2 slope = vec2(0.0);
    float crestEnergy = 0.0;
    ${waveDisplacement}

    vec3 world = worldBase + offset;
    vWorldPosition = world;
    vWorldNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
    vCrest = smoothstep(0.24, 0.53, crestEnergy);
    vWaveHeight = offset.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunDirection;
  uniform float uNight;
  uniform float uTime;
  uniform float uFoamDensity;
  uniform float uDetail;
  uniform vec3 uVesselPosition;
  uniform vec2 uVesselForward;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vCrest;
  varying float vWaveHeight;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 local = fract(p);
    local = local * local * (3.0 - 2.0 * local);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  void main() {
    vec3 geometricNormal = normalize(vWorldNormal);

    vec2 microSlope = vec2(0.0);
    vec2 directionA = normalize(vec2(0.86, 0.51));
    vec2 directionB = normalize(vec2(-0.37, 0.93));
    vec2 directionC = normalize(vec2(0.68, -0.73));
    microSlope += directionA * cos(dot(vWorldPosition.xz, directionA) * 2.4 + uTime * 1.72) * 0.034;
    microSlope += directionB * cos(dot(vWorldPosition.xz, directionB) * 4.9 - uTime * 2.18) * 0.021;
    microSlope += directionC * cos(dot(vWorldPosition.xz, directionC) * 9.2 + uTime * 2.86) * 0.009 * smoothstep(0.45, 0.9, uDetail);
    vec3 normal = normalize(geometricNormal + vec3(-microSlope.x, 0.0, -microSlope.y));

    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float nDotV = clamp(dot(normal, viewDirection), 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - nDotV, 5.0);

    vec3 reflectedDirection = reflect(-viewDirection, normal);
    float reflectedElevation = smoothstep(-0.08, 0.72, reflectedDirection.y);
    vec3 reflectedSky = mix(uSkyColor * 0.78, uSkyColor * 1.16, reflectedElevation);

    float cameraDistance = length(cameraPosition.xz - vWorldPosition.xz);
    float opticalDepth = clamp(0.12 + (1.0 - nDotV) * 0.52 + cameraDistance * 0.00042, 0.0, 0.9);
    float broadVariation = valueNoise(vWorldPosition.xz * 0.075 + vec2(uTime * 0.018, -uTime * 0.012));
    vec3 transmitted = mix(uShallowColor, uDeepColor, opticalDepth + (broadVariation - 0.5) * 0.07);

    float causticA = sin(vWorldPosition.x * 1.15 + uTime * 0.62);
    float causticB = sin(vWorldPosition.z * 1.42 - uTime * 0.74);
    float caustic = smoothstep(0.15, 0.94, causticA * causticB) * (1.0 - fresnel) * (1.0 - uNight);
    transmitted += vec3(0.08, 0.17, 0.16) * caustic * 0.18;

    vec3 color = mix(transmitted, reflectedSky, clamp(0.035 + fresnel * 0.9, 0.0, 0.94));
    float crestLight = smoothstep(0.08, 0.36, vWaveHeight) * max(dot(normalize(uSunDirection), normal), 0.0);
    color += mix(vec3(0.10, 0.22, 0.20), vec3(0.04, 0.08, 0.16), uNight) * crestLight * 0.24;

    vec3 halfDirection = normalize(viewDirection + normalize(uSunDirection));
    float nDotH = max(dot(normal, halfDirection), 0.0);
    float broadGlint = pow(nDotH, mix(72.0, 42.0, uNight)) * 0.22;
    float sharpGlint = pow(nDotH, mix(420.0, 180.0, uNight)) * 1.08;
    color += (broadGlint + sharpGlint) * mix(vec3(1.0, 0.88, 0.64), vec3(0.56, 0.72, 1.0), uNight);

    // A broken, wave-driven moon path extending from the viewer toward the moon.
    // This is deliberately broader than the high-frequency Blinn glints above:
    // real moonlight reads as a long field of separate highlights, not one spot.
    vec2 cameraToSurface = vWorldPosition.xz - cameraPosition.xz;
    vec2 surfaceDirection = cameraToSurface / max(length(cameraToSurface), 0.001);
    vec2 celestialDirection = normalize(uSunDirection.xz);
    float moonPathAxis = pow(max(dot(surfaceDirection, celestialDirection), 0.0), 42.0);
    float moonPathRange = smoothstep(4.0, 32.0, cameraDistance) * (1.0 - smoothstep(720.0, 1080.0, cameraDistance));
    float moonRipple = 0.5 + 0.5 * sin(cameraDistance * 0.34 + broadVariation * 7.0 - uTime * 0.28);
    float moonBreakup = valueNoise(vWorldPosition.xz * 0.31 + vec2(uTime * 0.055, -uTime * 0.021));
    float moonSparkles = smoothstep(0.36, 0.82, moonRipple * 0.54 + moonBreakup * 0.68);
    float moonSpecular = 0.24 + pow(nDotH, 18.0) * 1.65;
    float moonWalk = uNight * moonPathAxis * moonPathRange * moonSparkles * moonSpecular;
    color += vec3(0.62, 0.77, 1.0) * moonWalk * 0.82;

    float foamNoise;
    if (uDetail > 0.55) {
      foamNoise = valueNoise(vWorldPosition.xz * 0.68 + vec2(uTime * 0.04, -uTime * 0.03));
    } else {
      foamNoise = 0.5 + 0.5 * sin(vWorldPosition.x * 0.52 + vWorldPosition.z * 0.67 + uTime * 0.08);
    }
    float slopeFoam = smoothstep(0.065, 0.16, 1.0 - geometricNormal.y);
    float foam = vCrest * slopeFoam * smoothstep(0.48, 0.76, foamNoise) * uFoamDensity;
    color = mix(color, vec3(0.82, 0.96, 0.99), foam * (1.0 - uNight * 0.48));

    vec2 vesselForward = normalize(uVesselForward);
    vec2 vesselRight = vec2(vesselForward.y, -vesselForward.x);
    vec2 relativeToVessel = vWorldPosition.xz - uVesselPosition.xz;
    vec2 vesselSpace = vec2(dot(relativeToVessel, vesselRight), dot(relativeToVessel, vesselForward));
    float portShape = max(abs((vesselSpace.x + 1.55) / 0.7), abs(vesselSpace.y / 4.35));
    float starboardShape = max(abs((vesselSpace.x - 1.55) / 0.7), abs(vesselSpace.y / 4.35));
    float portShadow = 1.0 - smoothstep(0.56, 1.0, portShape);
    float starboardShadow = 1.0 - smoothstep(0.56, 1.0, starboardShape);
    float hullShadow = max(portShadow, starboardShadow);
    color *= 1.0 - hullShadow * mix(0.2, 0.12, uNight);

    float alpha = mix(0.48, 0.9, smoothstep(0.02, 0.72, fresnel));
    alpha += foam * 0.2 + hullShadow * 0.07 + uNight * 0.06;
    float dither = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(color + dither, clamp(alpha, 0.46, 0.96));
  }
`;

function createFocusedOceanGeometry(segments: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const halfExtent = OCEAN_SIZE / 2;
  const focusCoordinate = (coordinate: number): number => {
    const normalized = THREE.MathUtils.clamp(coordinate / halfExtent, -1, 1);
    const magnitude = Math.abs(normalized);
    return Math.sign(normalized) * (
      FOCUSED_GRID_SCALE * magnitude +
      (halfExtent - FOCUSED_GRID_SCALE) * magnitude * magnitude * magnitude
    );
  };

  for (let index = 0; index < positions.count; index += 1) {
    positions.setX(index, focusCoordinate(positions.getX(index)));
    positions.setZ(index, focusCoordinate(positions.getZ(index)));
  }
  positions.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

export class OceanSystem {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private time = 0;
  private segments: number;

  constructor(scene: THREE.Scene, quality: QualitySettings) {
    this.uniforms = {
      uTime: { value: 0 },
      uDeepColor: { value: DAY_DEEP.clone() },
      uShallowColor: { value: DAY_SHALLOW.clone() },
      uSkyColor: { value: new THREE.Color(0x8ed9f2) },
      uSunDirection: { value: new THREE.Vector3(0.4, 0.8, -0.3) },
      uNight: { value: 0 },
      uFoamDensity: { value: quality.foamDensity },
      uDetail: { value: quality.foamDensity },
      uVesselPosition: { value: new THREE.Vector3() },
      uVesselForward: { value: new THREE.Vector2(0, 1) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(createFocusedOceanGeometry(quality.oceanSegments), material);
    this.segments = quality.oceanSegments;
    this.mesh.name = "GPU_Ocean_World_Space_Gerstner";
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  sample(x: number, z: number): OceanSample {
    return sampleOcean(x, z, this.time);
  }

  update(time: number, focus: THREE.Vector3, heading = 0): void {
    this.time = time;
    this.uniforms.uTime.value = time;
    (this.uniforms.uVesselPosition.value as THREE.Vector3).copy(focus);
    (this.uniforms.uVesselForward.value as THREE.Vector2).set(Math.sin(heading), Math.cos(heading));
    this.mesh.position.x = Math.round(focus.x / 120) * 120;
    this.mesh.position.z = Math.round(focus.z / 120) * 120;
  }

  setEnvironment(night: number, sunDirection: THREE.Vector3, skyColor: THREE.Color): void {
    this.uniforms.uNight.value = night;
    (this.uniforms.uSunDirection.value as THREE.Vector3).copy(sunDirection);
    (this.uniforms.uSkyColor.value as THREE.Color).copy(skyColor);
    (this.uniforms.uDeepColor.value as THREE.Color).lerpColors(DAY_DEEP, NIGHT_DEEP, night);
    (this.uniforms.uShallowColor.value as THREE.Color).lerpColors(DAY_SHALLOW, NIGHT_SHALLOW, night);
  }

  setQuality(quality: QualitySettings): void {
    this.uniforms.uFoamDensity.value = quality.foamDensity;
    this.uniforms.uDetail.value = quality.foamDensity;
    if (quality.oceanSegments === this.segments) return;
    const previousGeometry = this.mesh.geometry;
    this.mesh.geometry = createFocusedOceanGeometry(quality.oceanSegments);
    this.segments = quality.oceanSegments;
    previousGeometry.dispose();
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export { OCEAN_WAVES };
