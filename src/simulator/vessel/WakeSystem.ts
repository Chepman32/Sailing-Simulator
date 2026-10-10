import * as THREE from "three";
import type { QualitySettings } from "../core/QualityManager";
import type { EnvironmentPalette } from "../environment/EnvironmentPalette";
import type { OceanSystem } from "../environment/OceanSystem";
import { MEAN_WIND_X, MEAN_WIND_Z } from "../environment/WindMath";
import type { SimulatorControls } from "../types";
import type { VesselPhysics } from "./VesselPhysics";
import { StampKind, WakeField } from "./WakeField";

type WakeSample = {
  position: THREE.Vector3;
  heading: number;
  born: number;
  strength: number;
  /** Sideways spread of a diverging bow wave, in m/s at birth. */
  driftX: number;
  driftZ: number;
  /** Bow-wave samples are narrower than the turbulent stern track. */
  bow: boolean;
  /** Distance the yacht had travelled when this sample was laid, metres. */
  odometer: number;
  /** Track length this sample stands for, metres (its share of the overlap). */
  spacing: number;
};

/** tan 19.47°: half-angle of the Kelvin wedge behind any displacement hull. */
export const KELVIN_TANGENT = Math.tan((19.47 * Math.PI) / 180);

/** Distance the yacht travels between wake samples, metres. */
export function wakeSampleSpacing(speed: number): number {
  return Math.min(1, Math.max(0.28, Math.abs(speed) * 0.14));
}

/** Seconds a stern track and a propeller wash stay visible. */
export const HULL_TRACK_LIFE = 12;
export const PROP_TRACK_LIFE = 8;
/** Gaussian along-track width of one stamp, metres: overlapping stamps are normalised by it. */
const TRACK_SIGMA = 1.0;
const SQRT_PI = Math.sqrt(Math.PI);

function fract(value: number): number {
  return value - Math.floor(value);
}

/** Below this speed the bows part the water without throwing a wave. */
export const BOW_WAVE_MIN_SPEED = 1.1;
/** Speed in m/s at which the bows begin to throw spray. */
export const BOW_SPRAY_MIN_SPEED = 2.1;

/** Bow spray droplets per second for a given speed and rudder angle. */
export function bowSprayRate(speed: number, rudder: number): number {
  return Math.max(0, Math.abs(speed) - BOW_SPRAY_MIN_SPEED) * (2.6 + Math.abs(rudder) * 1.6);
}

type Particle = {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  /** Air drag per second; fine mist is held up far more than droplets. */
  drag: number;
  gravity: number;
  opacity: number;
  /** Growth of the sprite over its life, as a fraction of its size. */
  growth: number;
  /** Mist drifts with the wind instead of falling back into the sea. */
  mist: boolean;
};

type SplashDecal = {
  active: boolean;
  position: THREE.Vector3;
  life: number;
  maxLife: number;
  delay: number;
  startRadius: number;
  endRadius: number;
  brightness: number;
  /** Decal heading and length/width ratio; trails are drawn out along the motion. */
  heading: number;
  stretch: number;
};

type CrownSheet = {
  active: boolean;
  position: THREE.Vector3;
  heading: number;
  life: number;
  maxLife: number;
  radius: number;
  height: number;
  seed: number;
};

export type WakeEmission = {
  emitHull: boolean;
  emitProp: boolean;
  hullStrength: number;
  propStrength: number;
};

/**
 * How a body met the surface. Each throws water differently:
 *
 * - `entry`: a body diving in head first opens a cavity whose rim rises as a
 *   crown and falls back;
 * - `exit`: a body leaving the water drags a sheet of water up along itself,
 *   thrown forward along its path;
 * - `slap`: a broad, flat blow (a fluke on the surface) blasts water out
 *   radially and leaves a wide, long-lived foam field;
 * - `breath`: a back or fin breaking the surface at swimming speed;
 * - `blow`: a whale's exhalation, a column of mist that drifts downwind.
 */
export type SplashKind = "entry" | "exit" | "slap" | "breath" | "blow";

export type SplashProfile = {
  dropletCount: number;
  ringCount: number;
  foamPatchCount: number;
  radialVelocity: number;
  verticalVelocity: number;
  radius: number;
  spread: number;
  particleSize: number;
  /** Fraction of the spray thrown along the body's own velocity. */
  directional: number;
  /** Seconds the foam field lasts. */
  foamLife: number;
  /** Seconds a foam ring takes to expand and fade. */
  ringLife: number;
  /** Crown sheet radius and height in metres; zero when there is none. */
  crownRadius: number;
  crownHeight: number;
  /** Mist puffs for a blow. */
  mistCount: number;
  /** Strength of the ring waves and slick drawn into the ocean itself. */
  impactStrength: number;
};

export function calculateWakeEmission(speed: number, throttle: number, rudder: number): WakeEmission {
  const absoluteSpeed = Math.abs(speed);
  const absoluteThrottle = Math.abs(throttle);
  const emitHull = absoluteSpeed > 0.06;
  const emitProp = absoluteThrottle > 0.04;
  return {
    emitHull,
    emitProp,
    hullStrength: emitHull
      ? THREE.MathUtils.clamp(0.48 + absoluteSpeed / 7.5 + Math.abs(rudder) * 0.18, 0, 1)
      : 0,
    propStrength: emitProp
      ? THREE.MathUtils.clamp(0.52 + absoluteThrottle * 0.48 + absoluteSpeed / 22, 0, 1)
      : 0,
  };
}

/**
 * Spray, foam and waves produced by one contact with the surface.
 * `intensity` is the contact's energy on a scale where a dolphin re-entering
 * at speed is about 1 and a whale's fluke slap about 5.
 */
export function calculateSplashProfile(intensity: number, kind: SplashKind = "entry"): SplashProfile {
  const strength = THREE.MathUtils.clamp(intensity, 0.05, 6);
  const scaled = Math.max(0.25, strength);
  // Heavier impacts throw more water, not bigger drops: spray is many fine
  // droplets plus a soft cloud of mist that gives the splash its volume.
  const base: SplashProfile = {
    dropletCount: Math.round(12 + scaled * 42),
    ringCount: Math.max(1, Math.round(2 + scaled)),
    foamPatchCount: Math.max(1, Math.round(2 + scaled * 1.4)),
    radialVelocity: 1.3 + scaled * 1.2,
    verticalVelocity: 2.4 + scaled * 1.15,
    radius: 3 + scaled * 2.2,
    spread: 0.55 + scaled * 0.46,
    particleSize: 0.1 + scaled * 0.045,
    directional: 0.25,
    foamLife: 2.4 + Math.pow(scaled, 1.35) * 1.9,
    ringLife: 1.6 + Math.min(1.6, scaled * 0.3),
    crownRadius: 0.3 + scaled * 0.42,
    crownHeight: 0.35 + scaled * 0.55,
    mistCount: scaled >= 1.2 ? Math.round(scaled * 4) : 0,
    impactStrength: scaled,
  };
  switch (kind) {
    case "entry":
      return base;
    case "exit":
      // Most of the water rides up with the body; the crown is a low skirt.
      return {
        ...base,
        dropletCount: Math.round(base.dropletCount * 0.62),
        ringCount: Math.max(1, Math.round(base.ringCount * 0.6)),
        foamPatchCount: Math.max(1, Math.round(base.foamPatchCount * 0.55)),
        radialVelocity: base.radialVelocity * 0.55,
        directional: 0.75,
        mistCount: Math.round(base.mistCount * 0.5),
        foamLife: base.foamLife * 0.7,
        crownRadius: base.crownRadius * 0.7,
        crownHeight: base.crownHeight * 0.45,
        impactStrength: scaled * 0.55,
      };
    case "slap":
      // A broad flat blow: water is driven out sideways and high, and the
      // churned patch it leaves lingers long after the spray has fallen.
      return {
        ...base,
        dropletCount: Math.round(base.dropletCount * 1.12),
        ringCount: base.ringCount + 2,
        foamPatchCount: base.foamPatchCount + 3,
        radialVelocity: base.radialVelocity * 1.25,
        verticalVelocity: base.verticalVelocity * 1.08,
        radius: base.radius * 1.12,
        mistCount: Math.round(scaled * 6),
        directional: 0.1,
        foamLife: base.foamLife * 1.25,
        ringLife: base.ringLife * 1.5,
        crownRadius: base.crownRadius * 1.35,
        crownHeight: base.crownHeight * 1.4,
      };
    case "breath":
      return {
        ...base,
        dropletCount: Math.round(4 + scaled * 14),
        ringCount: 1,
        foamPatchCount: 1,
        radialVelocity: 0.6 + scaled * 0.7,
        verticalVelocity: 0.9 + scaled * 0.9,
        radius: 0.9 + scaled * 1.1,
        spread: 0.2 + scaled * 0.2,
        particleSize: 0.08 + scaled * 0.05,
        directional: 0.6,
        mistCount: 0,
        foamLife: 1.6 + scaled * 0.8,
        crownRadius: 0,
        crownHeight: 0,
        impactStrength: scaled * 0.35,
      };
    case "blow":
      // From a dolphin's quick chuff to a whale's column several metres tall.
      return {
        ...base,
        dropletCount: 0,
        ringCount: 0,
        foamPatchCount: 0,
        verticalVelocity: 2.6 + strength * 2,
        spread: 0.1 + strength * 0.1,
        particleSize: 0.14 + strength * 0.24,
        directional: 0,
        crownRadius: 0,
        crownHeight: 0,
        mistCount: Math.round(4 + strength * 8),
        impactStrength: 0,
      };
  }
}

/** Extra size of a splash's mist puffs for heavier impacts, metres. */
function strengthSize(intensity: number): number {
  return Math.min(0.9, Math.max(0, intensity) * 0.16);
}

/** Mist from a whale's blow drifts downwind at roughly this speed. */
const MIST_DRIFT_SPEED = 2.4;
const WIND_LENGTH = Math.hypot(MEAN_WIND_X, MEAN_WIND_Z);
const WIND_DIRECTION_X = MEAN_WIND_X / WIND_LENGTH;
const WIND_DIRECTION_Z = MEAN_WIND_Z / WIND_LENGTH;

const CROWN_SEGMENTS = 32;
const CROWN_RINGS = 5;

/**
 * Unit crown: an open sheet parametrised by angle and height fraction. The
 * vertex shader shapes it into the wall of water thrown up around a body
 * entering the sea, from the per-instance age, radius and height.
 */
function createCrownGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const params: number[] = [];
  const positions: number[] = [];
  for (let ring = 0; ring <= CROWN_RINGS; ring += 1) {
    for (let segment = 0; segment <= CROWN_SEGMENTS; segment += 1) {
      const angle = (segment / CROWN_SEGMENTS) * Math.PI * 2;
      params.push(angle, ring / CROWN_RINGS);
      positions.push(Math.cos(angle), ring / CROWN_RINGS, Math.sin(angle));
    }
  }
  const indices: number[] = [];
  const row = CROWN_SEGMENTS + 1;
  for (let ring = 0; ring < CROWN_RINGS; ring += 1) {
    for (let segment = 0; segment < CROWN_SEGMENTS; segment += 1) {
      const a = ring * row + segment;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("crownParam", new THREE.Float32BufferAttribute(params, 2));
  geometry.setIndex(indices);
  // The shader moves every vertex; a generous bound keeps culling honest.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 14);
  return geometry;
}

const crownVertexShader = /* glsl */ `
  attribute vec2 crownParam;
  attribute vec4 crownState;
  varying float vAlpha;
  varying vec2 vParam;
  varying float vSeed;
  void main() {
    float age = crownState.x;
    float radius = crownState.y;
    float height = crownState.z;
    float seed = crownState.w;
    float angle = crownParam.x;
    float level = crownParam.y;
    // The rim breaks into fingers of water of uneven height.
    float fingers = 0.7 + 0.22 * sin(angle * 7.0 + seed * 6.1) * sin(angle * 3.0 - seed * 2.3)
      + 0.1 * sin(angle * 13.0 + seed * 4.7);
    // The wall shoots up, then its top falls back while its foot spreads.
    float rise = sin(min(age * 2.1, 1.0) * 1.5707963);
    float collapse = smoothstep(0.42, 1.0, age);
    float top = height * fingers * rise * (1.0 - collapse * 0.88);
    float spread = radius * (0.5 + 0.8 * (1.0 - (1.0 - age) * (1.0 - age)));
    float flare = 1.0 + level * (0.3 + 0.45 * age);
    vec3 local = vec3(cos(angle) * spread * flare, level * top - 0.04, sin(angle) * spread * flare);
    vec4 world = modelMatrix * instanceMatrix * vec4(local, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    vAlpha = (1.0 - smoothstep(0.5, 1.0, age)) * smoothstep(0.0, 0.05, age);
    vParam = crownParam;
    vSeed = seed;
  }
`;

const crownFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying vec2 vParam;
  varying float vSeed;
  void main() {
    // Streaks run up the sheet; it thins and tears toward the rim.
    float streak = 0.5 + 0.5 * sin(vParam.x * 23.0 + vSeed * 9.0) * sin(vParam.x * 9.0 - vSeed * 3.0 + vParam.y * 2.6);
    float rim = 1.0 - smoothstep(0.5, 1.0, vParam.y);
    float foot = smoothstep(0.0, 0.14, vParam.y);
    float alpha = vAlpha * (0.12 + 0.62 * streak * streak) * (0.3 + 0.7 * rim) * foot * 0.62;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor * (0.92 + 0.22 * (1.0 - vParam.y)), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class WakeSystem {
  private readonly group = new THREE.Group();
  private readonly field: WakeField;
  private readonly hullCapacity: number;
  private readonly propCapacity: number;
  private readonly hullSamples: WakeSample[] = [];
  private readonly propSamples: WakeSample[] = [];
  private readonly lastSample = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly matrix = new THREE.Matrix4();
  private readonly focus = new THREE.Vector3();
  private odometer = 0;
  private speed = 0;
  private readonly quaternion = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly scale = new THREE.Vector3();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly litColor = new THREE.Color(1, 1, 1);
  private readonly rings: SplashDecal[] = [];
  private readonly foamPatches: SplashDecal[] = [];
  private readonly particles: Particle[] = [];
  private readonly particleGeometry: THREE.BufferGeometry;
  private readonly particlePositions: Float32Array;
  private readonly particleSizes: Float32Array;
  private readonly particleOpacities: Float32Array;
  private readonly particlePoints: THREE.Points;
  private readonly particleKinds: Float32Array;
  private readonly crowns: CrownSheet[] = [];
  private readonly crownMesh: THREE.InstancedMesh;
  private readonly crownState: THREE.InstancedBufferAttribute;
  private readonly trails: SplashDecal[] = [];
  private spawnRemainder = 0;
  private lastVisualUpdate = Number.NEGATIVE_INFINITY;
  private lastSampleTime = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ocean: OceanSystem,
    quality: QualitySettings,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.group.name = "PhysicalWakeSystem";
    scene.add(this.group);
    const capacity = Math.round(145 * quality.foamDensity);
    // Two stern tracks plus two diverging bow waves.
    this.hullCapacity = capacity * 4;
    this.propCapacity = capacity;
    const splashCapacity = Math.max(18, Math.round(36 * quality.foamDensity));
    const foamCapacity = Math.max(12, Math.round(24 * quality.foamDensity));
    for (let index = 0; index < splashCapacity; index += 1) this.rings.push(this.createSplashDecal());
    for (let index = 0; index < foamCapacity; index += 1) this.foamPatches.push(this.createSplashDecal());
    const trailCapacity = Math.max(24, Math.round(64 * quality.foamDensity));
    for (let index = 0; index < trailCapacity; index += 1) this.trails.push(this.createSplashDecal());

    // The wake is drawn into the water itself (see WakeField). Its texture
    // resolution follows quality; the area follows the yacht.
    const resolution = quality.foamDensity >= 0.85 ? 512 : quality.foamDensity >= 0.6 ? 384 : 256;
    this.field = new WakeField(
      renderer,
      resolution,
      150,
      this.hullCapacity + this.propCapacity + splashCapacity + foamCapacity + trailCapacity,
    );
    ocean.setWakeField(this.field.target.texture, this.field.area, this.field.texel);

    const particleCount = Math.max(280, Math.round(520 * quality.foamDensity));
    this.particlePositions = new Float32Array(particleCount * 3);
    this.particleSizes = new Float32Array(particleCount);
    this.particleOpacities = new Float32Array(particleCount);
    this.particleKinds = new Float32Array(particleCount);
    this.particlePositions.fill(-9999);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute("position", new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute("particleSize", new THREE.BufferAttribute(this.particleSizes, 1));
    this.particleGeometry.setAttribute("particleOpacity", new THREE.BufferAttribute(this.particleOpacities, 1));
    this.particleGeometry.setAttribute("particleKind", new THREE.BufferAttribute(this.particleKinds, 1));
    const particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        sprayColor: { value: new THREE.Color(0xdffaff) },
      },
      vertexShader: `
        attribute float particleSize;
        attribute float particleOpacity;
        attribute float particleKind;
        varying float vOpacity;
        varying float vKind;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          // Mist puffs may grow large on screen; droplets stay small.
          gl_PointSize = clamp(particleSize * 420.0 / max(1.0, -viewPosition.z), 1.5, mix(26.0, 160.0, particleKind));
          vOpacity = particleOpacity;
          vKind = particleKind;
        }
      `,
      fragmentShader: `
        uniform vec3 sprayColor;
        varying float vOpacity;
        varying float vKind;
        void main() {
          // A droplet cloud has a dense core and a soft edge; mist is soft throughout.
          float radius = length(gl_PointCoord - 0.5) * 2.0;
          float droplet = (1.0 - smoothstep(0.0, 1.0, radius)) * 0.8;
          float mist = exp(-radius * radius * 3.2) * (1.0 - smoothstep(0.85, 1.0, radius));
          float alpha = mix(droplet, mist, vKind) * vOpacity * 0.85;
          if (alpha < 0.015) discard;
          gl_FragColor = vec4(sprayColor, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });
    this.particlePoints = new THREE.Points(this.particleGeometry, particleMaterial);
    this.particlePoints.frustumCulled = false;
    this.particlePoints.renderOrder = 5;
    this.group.add(this.particlePoints);
    for (let index = 0; index < particleCount; index += 1) {
      this.particles.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0.2,
        drag: 0.55,
        gravity: 9.81,
        opacity: 1,
        growth: 0.28,
        mist: false,
      });
    }

    // Walls of water thrown up by entries and slaps.
    const crownCapacity = Math.max(3, Math.round(7 * quality.foamDensity));
    const crownGeometry = createCrownGeometry();
    this.crownState = new THREE.InstancedBufferAttribute(new Float32Array(crownCapacity * 4), 4);
    this.crownState.setUsage(THREE.DynamicDrawUsage);
    crownGeometry.setAttribute("crownState", this.crownState);
    const crownMaterial = new THREE.ShaderMaterial({
      name: "SplashCrown",
      uniforms: { uColor: { value: new THREE.Color(0xe4f8ff) } },
      vertexShader: crownVertexShader,
      fragmentShader: crownFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    this.crownMesh = new THREE.InstancedMesh(crownGeometry, crownMaterial, crownCapacity);
    this.crownMesh.count = 0;
    this.crownMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.crownMesh.frustumCulled = false;
    this.crownMesh.renderOrder = 6;
    this.group.add(this.crownMesh);
    for (let index = 0; index < crownCapacity; index += 1) {
      this.crowns.push({
        active: false,
        position: new THREE.Vector3(),
        heading: 0,
        life: 0,
        maxLife: 1,
        radius: 1,
        height: 1,
        seed: 0,
      });
    }

  }

  fixedUpdate(delta: number, physics: VesselPhysics, controls: SimulatorControls, time: number): void {
    const speed = Math.abs(physics.telemetry.forwardSpeed);
    this.speed = speed;
    this.odometer += speed * delta;
    this.focus.copy(physics.position);
    const emission = calculateWakeEmission(speed, controls.throttle, controls.rudder);
    const sampleDeltaX = this.lastSample.x - physics.position.x;
    const sampleDeltaZ = this.lastSample.z - physics.position.z;
    // Sample by horizontal travel. Heave alone must not stack repeated foam
    // decals at the same x/z position while the yacht rides a wave.
    const sampleDistance = sampleDeltaX * sampleDeltaX + sampleDeltaZ * sampleDeltaZ;
    const maximumInterval = speed < 0.12 ? 0.55 : 0.22;
    // Samples are spaced by distance; faster yachts space them wider so the
    // bounded pool still holds the whole twelve seconds of wake.
    const sampleSpacing = wakeSampleSpacing(speed);
    const shouldSample =
      (emission.emitHull || emission.emitProp) &&
      (sampleDistance > sampleSpacing * sampleSpacing || time - this.lastSampleTime >= maximumInterval);
    if (shouldSample) {
      const spacing = Number.isFinite(sampleDistance) ? THREE.MathUtils.clamp(Math.sqrt(sampleDistance), 0.05, 1.5) : 0.28;
      this.lastSample.copy(physics.position);
      this.lastSampleTime = time;
      const right = physics.right;
      if (emission.emitHull) {
        [-1.52, 1.52].forEach((offset) => {
          this.hullSamples.unshift({
            position: physics.position.clone().addScaledVector(right, offset).addScaledVector(physics.forward, -3.92),
            heading: physics.heading,
            born: time,
            strength: emission.hullStrength,
            driftX: 0,
            driftZ: 0,
            bow: false,
            odometer: this.odometer,
            spacing,
          });
        });
        if (speed > BOW_WAVE_MIN_SPEED) {
          // Each bow sheds a wave that peels away from the track at the
          // Kelvin angle, drawing the V that marks a displacement hull.
          const direction = Math.sign(physics.telemetry.forwardSpeed) || 1;
          // Each crest moves out sideways at v·tan 19.5°, so the arms of the V
          // lie on the Kelvin angle whatever the speed.
          const spread = KELVIN_TANGENT * speed;
          const bowStrength = emission.hullStrength * THREE.MathUtils.smoothstep(speed, BOW_WAVE_MIN_SPEED, 3.4);
          [-1, 1].forEach((side) => {
            this.hullSamples.unshift({
              position: physics.position
                .clone()
                .addScaledVector(right, side * 1.95)
                .addScaledVector(physics.forward, direction * 3.3),
              heading: physics.heading + side * direction * 0.34,
              born: time,
              strength: bowStrength,
              driftX: right.x * side * spread,
              driftZ: right.z * side * spread,
              bow: true,
              odometer: this.odometer,
              spacing,
            });
          });
        }
      }
      if (emission.emitProp) {
        this.propSamples.unshift({
          position: physics.position.clone().addScaledVector(physics.forward, -4.5),
          heading: physics.heading,
          born: time,
          strength: emission.propStrength,
          driftX: 0,
          driftZ: 0,
          bow: false,
          odometer: this.odometer,
          spacing,
        });
      }
      this.hullSamples.length = Math.min(this.hullSamples.length, this.hullCapacity);
      this.propSamples.length = Math.min(this.propSamples.length, this.propCapacity);
    }

    const sprayRate = bowSprayRate(speed, controls.rudder);
    this.spawnRemainder += sprayRate * delta;
    while (this.spawnRemainder >= 1) {
      this.spawnBowParticle(physics, speed);
      this.spawnRemainder -= 1;
    }
    this.updateParticles(delta);
    this.ageDecals(this.rings, delta);
    this.ageDecals(this.foamPatches, delta);
    this.ageDecals(this.trails, delta);
    this.updateCrowns(delta);
  }

  /** Redraws the wake field, at most thirty times a second. */
  update(time: number): void {
    if (time - this.lastVisualUpdate < 1 / 30) return;
    this.lastVisualUpdate = time;
    this.field.begin(this.focus.x, this.focus.z);
    this.stampTracks(this.hullSamples, time, false);
    this.stampTracks(this.propSamples, time, true);
    this.stampDecals();
    this.field.render(this.renderer);
  }

  /**
   * Foam and spray are lit surfaces: they dim at dusk and take on moonlight
   * instead of glowing at a fixed brightness.
   */
  setEnvironment(palette: EnvironmentPalette): void {
    const red = palette.ambientColor[0] * 1.1 + palette.lightColor[0] * 0.24;
    const green = palette.ambientColor[1] * 1.1 + palette.lightColor[1] * 0.24;
    const blue = palette.ambientColor[2] * 1.1 + palette.lightColor[2] * 0.24;
    if (Math.abs(red - this.litColor.r) + Math.abs(green - this.litColor.g) + Math.abs(blue - this.litColor.b) < 1e-4) {
      return;
    }
    this.litColor.setRGB(red, green, blue, THREE.LinearSRGBColorSpace);
    ((this.crownMesh.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).copy(this.litColor);
    ((this.particlePoints.material as THREE.ShaderMaterial).uniforms.sprayColor.value as THREE.Color).copy(
      this.litColor,
    );
  }

  /**
   * Throws water where a body met the surface.
   *
   * @param position contact point on the water, not the body's centre
   * @param intensity contact energy (dolphin re-entry ≈ 1, fluke slap ≈ 5)
   * @param kind how the body met the surface
   * @param velocity the body's velocity at contact; spray follows it
   */
  /** Root of every wake and splash visual (left out of the water's mirror). */
  get object(): THREE.Object3D {
    return this.group;
  }

  splash(position: THREE.Vector3, intensity = 1, kind: SplashKind = "entry", velocity?: THREE.Vector3): void {
    const profile = calculateSplashProfile(intensity, kind);
    const surface = this.ocean.sample(position.x, position.z).height;
    const speed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;
    const alongX = speed > 0.01 && velocity ? velocity.x / speed : 0;
    const alongZ = speed > 0.01 && velocity ? velocity.z / speed : 0;

    for (let index = 0; index < profile.dropletCount; index += 1) {
      const particle = this.nextParticle();
      if (!particle) break;
      const angle = Math.random() * Math.PI * 2;
      const radial = profile.radialVelocity * (0.35 + Math.random() * 0.82);
      particle.active = true;
      particle.mist = false;
      particle.position.set(
        position.x + (Math.random() - 0.5) * profile.spread * 2,
        surface + 0.02,
        position.z + (Math.random() - 0.5) * profile.spread * 2,
      );
      // Part of the spray is carried along the body's own path.
      const carried = Math.random() < profile.directional ? speed * (0.35 + Math.random() * 0.45) : 0;
      particle.velocity.set(
        Math.cos(angle) * radial + alongX * carried,
        profile.verticalVelocity * (0.45 + Math.random() * 0.6),
        Math.sin(angle) * radial + alongZ * carried,
      );
      particle.life = 0;
      particle.maxLife = 0.82 + Math.random() * 1.05 + Math.min(0.7, intensity * 0.14);
      particle.size = profile.particleSize * (0.5 + Math.random() * 0.75);
      particle.drag = 0.55;
      particle.gravity = 9.81;
      particle.opacity = 1;
      particle.growth = 0.28;
    }

    const blow = kind === "blow";
    for (let index = 0; index < profile.mistCount; index += 1) {
      const particle = this.nextParticle();
      if (!particle) break;
      particle.active = true;
      particle.mist = true;
      if (blow) {
        // A blow is a column: puffs leave the blowhole over half a second.
        particle.position.set(
          position.x + (Math.random() - 0.5) * profile.spread,
          Math.max(position.y, surface) + 0.05,
          position.z + (Math.random() - 0.5) * profile.spread,
        );
        const lift = profile.verticalVelocity * (0.45 + Math.random() * 0.75);
        particle.velocity.set((Math.random() - 0.5) * 1.1, lift, (Math.random() - 0.5) * 1.1);
        particle.life = -Math.random() * 0.55;
        particle.maxLife = 2.6 + Math.random() * 1.8;
        particle.size = profile.particleSize * (0.55 + Math.random() * 0.7);
        particle.opacity = 0.42 + Math.random() * 0.2;
        particle.growth = 2.6;
      } else {
        // Fine spray hanging over a splash: the cloud that gives it volume.
        const angle = Math.random() * Math.PI * 2;
        const reach = profile.spread * (0.4 + Math.random());
        particle.position.set(position.x + Math.cos(angle) * reach, surface + 0.2, position.z + Math.sin(angle) * reach);
        particle.velocity.set(
          Math.cos(angle) * profile.radialVelocity * 0.35,
          profile.verticalVelocity * (0.25 + Math.random() * 0.45),
          Math.sin(angle) * profile.radialVelocity * 0.35,
        );
        particle.life = -Math.random() * 0.12;
        particle.maxLife = 1.4 + Math.random() * 1.2;
        particle.size = 0.5 + Math.random() * 0.4 + strengthSize(intensity);
        particle.opacity = 0.32 + Math.random() * 0.18;
        particle.growth = 1.8;
      }
      particle.drag = 1.15;
      particle.gravity = blow ? 0.9 : 2.2;
    }

    for (let index = 0; index < profile.ringCount; index += 1) {
      const ring = this.nextSplashDecal(this.rings);
      if (!ring) break;
      ring.active = true;
      ring.position.copy(position);
      ring.life = 0;
      ring.delay = index * (kind === "slap" ? 0.16 : 0.09);
      ring.maxLife = profile.ringLife + index * 0.2 + Math.min(0.95, intensity * 0.19);
      ring.startRadius = 0.45 + index * 0.22;
      ring.endRadius = profile.radius * (0.72 + index * 0.12);
      // Small splashes leave faint rings; a fluke slap a bright, wide one.
      ring.brightness = Math.max(0.5, 1 - index * 0.09) * Math.min(1, 0.4 + intensity * 0.14);
      ring.heading = 0;
      ring.stretch = 1;
    }

    for (let index = 0; index < profile.foamPatchCount; index += 1) {
      const patch = this.nextSplashDecal(this.foamPatches);
      if (!patch) break;
      const angle = Math.random() * Math.PI * 2;
      const offset = profile.spread * Math.sqrt(Math.random());
      patch.active = true;
      patch.position.copy(position);
      patch.position.x += Math.cos(angle) * offset + alongX * profile.directional * index * 0.4;
      patch.position.z += Math.sin(angle) * offset + alongZ * profile.directional * index * 0.4;
      patch.life = 0;
      patch.delay = index * 0.07;
      // Fresh foam is bright; the field it leaves fades slowly.
      patch.maxLife = profile.foamLife * (0.75 + Math.random() * 0.4);
      patch.startRadius = 0.7 + index * 0.25;
      patch.endRadius = profile.radius * (0.48 + Math.random() * 0.2);
      patch.brightness = 0.72 + Math.random() * 0.2;
      patch.heading = Math.random() * Math.PI * 2;
      patch.stretch = 1 + Math.random() * 0.35;
    }

    if (profile.crownRadius > 0) {
      const crown = this.crowns.find((candidate) => !candidate.active);
      if (crown) {
        crown.active = true;
        crown.position.set(position.x, surface, position.z);
        crown.heading = Math.random() * Math.PI * 2;
        crown.life = 0;
        crown.maxLife = 0.9 + Math.sqrt(profile.crownHeight) * 0.55;
        crown.radius = profile.crownRadius;
        crown.height = profile.crownHeight;
        crown.seed = Math.random() * 10;
      }
    }

    this.ocean.addImpact(position.x, position.z, profile.impactStrength);
  }

  /**
   * Water streaming off a body that has just left the sea: droplets that
   * start with the body's velocity and fall back.
   */
  shed(position: THREE.Vector3, velocity: THREE.Vector3, count: number, size = 0.12): void {
    for (let index = 0; index < count; index += 1) {
      const particle = this.nextParticle();
      if (!particle) return;
      particle.active = true;
      particle.mist = false;
      particle.position.set(
        position.x + (Math.random() - 0.5) * 0.5,
        position.y - Math.random() * 0.2,
        position.z + (Math.random() - 0.5) * 0.5,
      );
      particle.velocity.set(
        velocity.x * (0.4 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.8,
        velocity.y * (0.3 + Math.random() * 0.4) - Math.random() * 0.6,
        velocity.z * (0.4 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.8,
      );
      particle.life = 0;
      particle.maxLife = 0.9 + Math.random() * 0.9;
      particle.size = size * (0.6 + Math.random() * 0.8);
      particle.drag = 0.4;
      particle.gravity = 9.81;
      particle.opacity = 0.85;
      particle.growth = 0.1;
    }
  }

  /** Ring waves and a slick without spray, such as a diving whale's footprint. */
  ripple(position: THREE.Vector3, strength: number): void {
    this.ocean.addImpact(position.x, position.z, strength);
  }

  /**
   * A short foam streak where something cuts the surface while moving: a
   * shark's dorsal fin, a dolphin's back. Callers space them by distance.
   */
  trail(position: THREE.Vector3, heading: number, strength: number, width = 0.45): void {
    const decal = this.nextSplashDecal(this.trails) ?? this.oldestDecal(this.trails);
    if (!decal) return;
    const bounded = THREE.MathUtils.clamp(strength, 0, 1);
    decal.active = true;
    decal.position.copy(position);
    decal.life = 0;
    decal.delay = 0;
    decal.maxLife = 2.6 + bounded * 3;
    decal.startRadius = width * 0.6;
    decal.endRadius = width * (1.6 + bounded * 1.2);
    decal.brightness = 0.35 + bounded * 0.5;
    decal.heading = heading;
    decal.stretch = 2.2;
  }

  reset(): void {
    this.hullSamples.length = 0;
    this.propSamples.length = 0;
    this.odometer = 0;
    this.lastVisualUpdate = Number.NEGATIVE_INFINITY;
    this.lastSampleTime = Number.NEGATIVE_INFINITY;
    this.lastSample.set(Number.POSITIVE_INFINITY, 0, 0);
    this.particles.forEach((particle) => {
      particle.active = false;
    });
    this.particlePositions.fill(-9999);
    this.particleSizes.fill(0);
    this.particleOpacities.fill(0);
    (this.particleGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeometry.getAttribute("particleSize") as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeometry.getAttribute("particleOpacity") as THREE.BufferAttribute).needsUpdate = true;
    this.rings.forEach((ring) => {
      ring.active = false;
    });
    this.foamPatches.forEach((patch) => {
      patch.active = false;
    });
    this.trails.forEach((trail) => {
      trail.active = false;
    });
    this.crowns.forEach((crown) => {
      crown.active = false;
    });
    this.crownMesh.count = 0;
    this.ocean.clearImpacts();
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.field.dispose();
    this.particleGeometry.dispose();
    (this.particlePoints.material as THREE.Material).dispose();
    this.crownMesh.geometry.dispose();
    (this.crownMesh.material as THREE.Material).dispose();
  }

  /**
   * Stamps the hull tracks, the diverging bow waves and the propeller wash
   * into the wake field.
   */
  private stampTracks(samples: WakeSample[], time: number, prop: boolean): void {
    const life = prop ? PROP_TRACK_LIFE : HULL_TRACK_LIFE;
    while (samples.length > 0 && time - samples[samples.length - 1].born >= life) samples.pop();
    const speed = this.speed;
    // Transverse waves travel with the yacht, so their wavenumber is g / v².
    const transverse = THREE.MathUtils.smoothstep(speed, 1.2, 3.6);
    const wavenumber = speed > 0.5 ? Math.min(6, 9.81 / (speed * speed)) : 0;
    for (const sample of samples) {
      const age = time - sample.born;
      const normalized = Math.min(1, age / life);
      // Overlapping stamps are weighted by the track length each stands for,
      // so the wake's density does not depend on how often it was sampled.
      const share = sample.spacing / (TRACK_SIGMA * SQRT_PI);
      const fresh = Math.exp(-age * (sample.bow ? 1.0 : prop ? 0.7 : 0.5));
      const lingering = Math.pow(1 - normalized, 1.5);
      const grain = fract(Math.sin(sample.born * 91.7 + sample.position.x * 3.1) * 43758.5453);
      if (sample.bow) {
        // The diverging wave slows as it spreads: integrate a decaying drift.
        const travelled = age;
        const x = sample.position.x + sample.driftX * travelled;
        const z = sample.position.z + sample.driftZ * travelled;
        const amplitude = 0.11 * sample.strength * Math.exp(-age * 0.13) * share * 2.2;
        this.field.push(
          x,
          z,
          sample.heading,
          StampKind.BowWave,
          1.4 + normalized * 1.6,
          2.4 + normalized * 2.4,
          sample.strength * fresh * share * 1.4 * THREE.MathUtils.smoothstep(speed, 2.2, 4.5),
          sample.strength * lingering * share * 0.35,
          amplitude,
        );
        continue;
      }
      const behind = this.odometer - sample.odometer;
      const width = (prop ? 1.0 : 0.85) + normalized * (prop ? 2.2 : 1.9) + (prop ? 0 : behind * 0.05);
      // White water right behind the transoms that collapses within seconds,
      // then thin streaks of bubbles.
      const foam = sample.strength * (fresh * 1.5 + lingering * 0.16) * share * (0.6 + grain * 0.8);
      const slick = sample.strength * lingering * share * (prop ? 1.3 : 1.0);
      if (prop) {
        this.field.push(sample.position.x, sample.position.z, sample.heading, StampKind.PropWash, width, 1.6, foam * 1.1, slick);
        continue;
      }
      // Transverse crests spread to the Kelvin wedge (19.5°) behind the stern.
      const wedge = 1.6 + behind * 0.35;
      const amplitude = 0.14 * transverse * sample.strength * share * Math.exp(-age * 0.1) / (1 + behind / 40);
      this.field.push(
        sample.position.x,
        sample.position.z,
        sample.heading,
        StampKind.Track,
        Math.max(width, wedge),
        1.5,
        foam * (width / Math.max(width, wedge)),
        slick,
        amplitude,
        wavenumber * 1.5,
        wavenumber * behind,
      );
    }
  }

  /** Splash foam, fin trails and ring waves. */
  private stampDecals(): void {
    for (const decal of this.foamPatches) this.stampDecal(decal, StampKind.Foam);
    for (const decal of this.trails) this.stampDecal(decal, StampKind.Foam);
    for (const decal of this.rings) this.stampDecal(decal, StampKind.Ring);
  }

  private stampDecal(decal: SplashDecal, kind: StampKind): void {
    if (!decal.active) return;
    const age = decal.life - decal.delay;
    if (age < 0) return;
    const normalized = Math.min(1, age / decal.maxLife);
    const ring = kind === StampKind.Ring;
    const expansion = ring ? 1 - Math.pow(1 - normalized, 2.2) : normalized * normalized * (3 - 2 * normalized);
    const radius = THREE.MathUtils.lerp(decal.startRadius, decal.endRadius, expansion);
    const fade = Math.pow(1 - normalized, ring ? 1.15 : 1.6);
    if (ring) {
      // A ring of crests, steep while it is small and flattening as it grows.
      const amplitude = 0.05 * decal.brightness * fade;
      this.field.push(decal.position.x, decal.position.z, 0, kind, radius * 1.3, radius * 1.3, decal.brightness * fade * 0.5, 0, amplitude, 9 * radius);
      return;
    }
    this.field.push(
      decal.position.x,
      decal.position.z,
      decal.heading,
      kind,
      radius,
      radius * decal.stretch,
      decal.brightness * fade * 1.6,
      decal.brightness * Math.pow(1 - normalized, 0.8) * 0.8,
    );
  }

  private ageDecals(decals: SplashDecal[], delta: number): void {
    for (const decal of decals) {
      if (!decal.active) continue;
      decal.life += delta;
      if (decal.life - decal.delay >= decal.maxLife) decal.active = false;
    }
  }

  private createSplashDecal(): SplashDecal {
    return {
      active: false,
      position: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      delay: 0,
      startRadius: 0.5,
      endRadius: 4,
      brightness: 1,
      heading: 0,
      stretch: 1,
    };
  }

  private nextSplashDecal(decals: SplashDecal[]): SplashDecal | undefined {
    return decals.find((decal) => !decal.active);
  }

  private oldestDecal(decals: SplashDecal[]): SplashDecal | undefined {
    let oldest: SplashDecal | undefined;
    for (const decal of decals) {
      if (!oldest || decal.life / decal.maxLife > oldest.life / oldest.maxLife) oldest = decal;
    }
    return oldest;
  }

  private updateCrowns(delta: number): void {
    let count = 0;
    for (const crown of this.crowns) {
      if (!crown.active) continue;
      crown.life += delta;
      if (crown.life >= crown.maxLife) {
        crown.active = false;
        continue;
      }
      this.scratchPosition.copy(crown.position);
      // The foot of the wall stays on the moving surface.
      this.scratchPosition.y = this.ocean.sample(crown.position.x, crown.position.z).height;
      this.quaternion.setFromAxisAngle(this.yAxis, crown.heading);
      this.scale.set(1, 1, 1);
      this.matrix.compose(this.scratchPosition, this.quaternion, this.scale);
      this.crownMesh.setMatrixAt(count, this.matrix);
      this.crownState.setXYZW(count, crown.life / crown.maxLife, crown.radius, crown.height, crown.seed);
      count += 1;
    }
    this.crownMesh.count = count;
    this.crownMesh.instanceMatrix.needsUpdate = true;
    this.crownState.needsUpdate = true;
  }

  private spawnBowParticle(physics: VesselPhysics, speed: number): void {
    const particle = this.nextParticle();
    if (!particle) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    particle.active = true;
    particle.position
      .copy(physics.position)
      .addScaledVector(physics.forward, 4.48)
      .addScaledVector(physics.right, side * (1.45 + Math.random() * 0.28));
    particle.position.y += 0.05;
    particle.velocity
      .copy(physics.right)
      .multiplyScalar(side * (0.9 + Math.random() * 1.5))
      .addScaledVector(physics.forward, -0.25 * speed)
      .setY(1.4 + Math.random() * Math.min(4.8, speed * 0.22));
    particle.life = 0;
    particle.maxLife = 0.5 + Math.random() * 0.8;
    particle.size = 0.12 + Math.random() * 0.16;
    particle.drag = 0.55;
    particle.gravity = 9.81;
    particle.opacity = 1;
    particle.growth = 0.28;
    particle.mist = false;
  }

  private updateParticles(delta: number): void {
    this.particles.forEach((particle, index) => {
      if (particle.active) {
        particle.life += delta;
        if (particle.life >= 0) {
          particle.velocity.y -= particle.gravity * delta;
          particle.velocity.multiplyScalar(Math.exp(-particle.drag * delta));
          if (particle.mist) {
            // The breeze takes the cloud downwind.
            const blend = 1 - Math.exp(-0.9 * delta);
            particle.velocity.x += (WIND_DIRECTION_X * MIST_DRIFT_SPEED - particle.velocity.x) * blend;
            particle.velocity.z += (WIND_DIRECTION_Z * MIST_DRIFT_SPEED - particle.velocity.z) * blend;
          }
          particle.position.addScaledVector(particle.velocity, delta);
          const waterHeight = this.ocean.sample(particle.position.x, particle.position.z).height;
          if (particle.life >= particle.maxLife || (particle.velocity.y < 0 && particle.position.y <= waterHeight)) {
            particle.active = false;
          }
        }
      }
      const offset = index * 3;
      if (particle.active && particle.life >= 0) {
        this.particlePositions[offset] = particle.position.x;
        this.particlePositions[offset + 1] = particle.position.y;
        this.particlePositions[offset + 2] = particle.position.z;
        const normalizedAge = THREE.MathUtils.clamp(particle.life / particle.maxLife, 0, 1);
        this.particleSizes[index] = particle.size * (1 + normalizedAge * particle.growth);
        this.particleOpacities[index] = Math.pow(1 - normalizedAge, particle.mist ? 1.3 : 0.65) * particle.opacity
          * (particle.mist ? Math.min(1, normalizedAge * 8) : 1);
        this.particleKinds[index] = particle.mist ? 1 : 0;
      } else {
        this.particlePositions[offset] = -9999;
        this.particlePositions[offset + 1] = -9999;
        this.particlePositions[offset + 2] = -9999;
        this.particleSizes[index] = 0;
        this.particleOpacities[index] = 0;
      }
    });
    (this.particleGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeometry.getAttribute("particleSize") as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeometry.getAttribute("particleOpacity") as THREE.BufferAttribute).needsUpdate = true;
    (this.particleGeometry.getAttribute("particleKind") as THREE.BufferAttribute).needsUpdate = true;
  }

  private nextParticle(): Particle | undefined {
    return this.particles.find((particle) => !particle.active);
  }
}
