import * as THREE from "three";
import type { QualitySettings } from "../core/QualityManager";
import type { EnvironmentPalette } from "../environment/EnvironmentPalette";
import type { OceanSystem } from "../environment/OceanSystem";
import type { SimulatorControls } from "../types";
import type { VesselPhysics } from "./VesselPhysics";

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
};

/**
 * Opacity of one wake decal. A dozen or more decals overlap at any point of
 * a track, so each contributes only a little.
 */
export const WAKE_LAYER_GAIN = 0.3;

/**
 * Foam lies over the water; it does not add light to it. Each decal's fade is
 * carried in its instance colour, so the fade is moved into alpha here and the
 * decal is composited "over" the sea. Unlike additive blending this cannot
 * blow out where decals overlap, and it looks the same with or without the
 * HDR pipeline.
 */
function useInstanceFadeAsAlpha(material: THREE.MeshBasicMaterial): void {
  material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       #ifdef USE_COLOR
         float decalFade = max(vColor.r, max(vColor.g, vColor.b));
         diffuseColor.rgb /= max(decalFade, 0.0001);
         diffuseColor.a *= clamp(decalFade, 0.0, 1.0);
       #endif`,
    );
  };
  material.customProgramCacheKey = () => "foam-decal-v2";
}

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
};

export type WakeEmission = {
  emitHull: boolean;
  emitProp: boolean;
  hullStrength: number;
  propStrength: number;
};

export type SplashProfile = {
  dropletCount: number;
  ringCount: number;
  foamPatchCount: number;
  radialVelocity: number;
  verticalVelocity: number;
  radius: number;
  spread: number;
  particleSize: number;
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

export function calculateSplashProfile(intensity: number): SplashProfile {
  const strength = THREE.MathUtils.clamp(intensity, 0.25, 5);
  return {
    dropletCount: Math.round(12 + strength * 48),
    ringCount: Math.max(1, Math.round(2 + strength)),
    foamPatchCount: Math.max(1, Math.round(2 + strength * 1.4)),
    radialVelocity: 1.4 + strength * 1.6,
    verticalVelocity: 2.8 + strength * 2.1,
    radius: 3 + strength * 2.2,
    spread: 0.55 + strength * 0.46,
    particleSize: 0.16 + strength * 0.105,
  };
}

/**
 * Aerated water is a lace of bubbles, not a soft glow. The texture is built
 * from many small speckles whose density falls off toward the edge, so
 * overlapping decals read as churned foam.
 */
function foamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const base = context.createRadialGradient(64, 64, 2, 64, 64, 62);
  base.addColorStop(0, "rgba(255,255,255,.34)");
  base.addColorStop(0.45, "rgba(236,250,255,.16)");
  base.addColorStop(1, "rgba(220,244,255,0)");
  context.fillStyle = base;
  context.fillRect(0, 0, 128, 128);
  let seed = 7331;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let index = 0; index < 520; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.pow(random(), 0.72) * 58;
    const x = 64 + Math.cos(angle) * distance;
    const y = 64 + Math.sin(angle) * distance;
    const falloff = 1 - distance / 60;
    const radius = 0.8 + random() * 3.4 * (0.4 + falloff);
    const speck = context.createRadialGradient(x, y, 0, x, y, radius);
    const opacity = (0.16 + random() * 0.5) * Math.max(0, falloff);
    speck.addColorStop(0, `rgba(255,255,255,${opacity})`);
    speck.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = speck;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return new THREE.CanvasTexture(canvas);
}

function splashRingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 63);
  gradient.addColorStop(0, "rgba(225,251,255,0)");
  gradient.addColorStop(0.48, "rgba(225,251,255,0)");
  gradient.addColorStop(0.6, "rgba(238,254,255,.9)");
  gradient.addColorStop(0.72, "rgba(191,239,248,.34)");
  gradient.addColorStop(1, "rgba(170,224,238,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class WakeSystem {
  private readonly group = new THREE.Group();
  private readonly hullWake: THREE.InstancedMesh;
  private readonly propWake: THREE.InstancedMesh;
  private readonly hullCapacity: number;
  private readonly propCapacity: number;
  private readonly hullSamples: WakeSample[] = [];
  private readonly propSamples: WakeSample[] = [];
  private readonly lastSample = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly scale = new THREE.Vector3();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();
  private readonly litColor = new THREE.Color(1, 1, 1);
  private readonly foam = foamTexture();
  private readonly ringTexture = splashRingTexture();
  private readonly splashRings: THREE.InstancedMesh;
  private readonly splashFoam: THREE.InstancedMesh;
  private readonly rings: SplashDecal[] = [];
  private readonly foamPatches: SplashDecal[] = [];
  private readonly particles: Particle[] = [];
  private readonly particleGeometry: THREE.BufferGeometry;
  private readonly particlePositions: Float32Array;
  private readonly particleSizes: Float32Array;
  private readonly particleOpacities: Float32Array;
  private readonly particlePoints: THREE.Points;
  private spawnRemainder = 0;
  private lastVisualUpdate = Number.NEGATIVE_INFINITY;
  private lastSampleTime = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ocean: OceanSystem,
    quality: QualitySettings,
  ) {
    this.group.name = "PhysicalWakeSystem";
    scene.add(this.group);
    const capacity = Math.round(145 * quality.foamDensity);
    // Two stern tracks plus two diverging bow waves.
    this.hullCapacity = capacity * 4;
    this.propCapacity = capacity;
    const plane = new THREE.PlaneGeometry(1, 1.9);
    plane.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xe9fdff,
      map: this.foam,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    useInstanceFadeAsAlpha(material);
    this.hullWake = new THREE.InstancedMesh(plane, material, this.hullCapacity);
    this.hullWake.count = 0;
    // Per-instance colour carries each decal's fade. Creating the attribute
    // up front lets the first compiled program include it.
    this.hullWake.setColorAt(0, this.scratchColor.setRGB(0, 0, 0));
    this.hullWake.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.hullWake.frustumCulled = false;
    this.hullWake.renderOrder = 4;
    this.group.add(this.hullWake);

    const propMaterial = material.clone();
    useInstanceFadeAsAlpha(propMaterial);
    this.propWake = new THREE.InstancedMesh(plane.clone(), propMaterial, this.propCapacity);
    this.propWake.count = 0;
    this.propWake.setColorAt(0, this.scratchColor.setRGB(0, 0, 0));
    this.propWake.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.propWake.frustumCulled = false;
    this.propWake.renderOrder = 4;
    this.group.add(this.propWake);

    const splashCapacity = Math.max(18, Math.round(36 * quality.foamDensity));
    const splashPlane = new THREE.PlaneGeometry(1, 1);
    splashPlane.rotateX(-Math.PI / 2);
    const splashMaterial = new THREE.MeshBasicMaterial({
      color: 0xe9fdff,
      map: this.ringTexture,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    useInstanceFadeAsAlpha(splashMaterial);
    this.splashRings = new THREE.InstancedMesh(splashPlane, splashMaterial, splashCapacity);
    this.splashRings.count = 0;
    this.splashRings.setColorAt(0, this.scratchColor.setRGB(0, 0, 0));
    this.splashRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splashRings.frustumCulled = false;
    this.splashRings.renderOrder = 6;
    this.group.add(this.splashRings);

    const foamCapacity = Math.max(12, Math.round(24 * quality.foamDensity));
    const foamMaterial = splashMaterial.clone();
    foamMaterial.map = this.foam;
    foamMaterial.opacity = 0.72;
    useInstanceFadeAsAlpha(foamMaterial);
    this.splashFoam = new THREE.InstancedMesh(splashPlane.clone(), foamMaterial, foamCapacity);
    this.splashFoam.count = 0;
    this.splashFoam.setColorAt(0, this.scratchColor.setRGB(0, 0, 0));
    this.splashFoam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splashFoam.frustumCulled = false;
    this.splashFoam.renderOrder = 5;
    this.group.add(this.splashFoam);
    for (let index = 0; index < splashCapacity; index += 1) this.rings.push(this.createSplashDecal());
    for (let index = 0; index < foamCapacity; index += 1) this.foamPatches.push(this.createSplashDecal());

    const particleCount = Math.max(280, Math.round(520 * quality.foamDensity));
    this.particlePositions = new Float32Array(particleCount * 3);
    this.particleSizes = new Float32Array(particleCount);
    this.particleOpacities = new Float32Array(particleCount);
    this.particlePositions.fill(-9999);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute("position", new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute("particleSize", new THREE.BufferAttribute(this.particleSizes, 1));
    this.particleGeometry.setAttribute("particleOpacity", new THREE.BufferAttribute(this.particleOpacities, 1));
    const particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        sprayColor: { value: new THREE.Color(0xdffaff) },
      },
      vertexShader: `
        attribute float particleSize;
        attribute float particleOpacity;
        varying float vOpacity;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = clamp(particleSize * 420.0 / max(1.0, -viewPosition.z), 1.5, 46.0);
          vOpacity = particleOpacity;
        }
      `,
      fragmentShader: `
        uniform vec3 sprayColor;
        varying float vOpacity;
        void main() {
          // A droplet cloud: dense core, soft edge.
          float radius = length(gl_PointCoord - 0.5) * 2.0;
          float alpha = (1.0 - smoothstep(0.1, 1.0, radius)) * vOpacity * 0.85;
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
      });
    }
  }

  fixedUpdate(delta: number, physics: VesselPhysics, controls: SimulatorControls, time: number): void {
    const speed = Math.abs(physics.telemetry.forwardSpeed);
    const emission = calculateWakeEmission(speed, controls.throttle, controls.rudder);
    const sampleDeltaX = this.lastSample.x - physics.position.x;
    const sampleDeltaZ = this.lastSample.z - physics.position.z;
    // Sample by horizontal travel. Heave alone must not stack repeated foam
    // decals at the same x/z position while the yacht rides a wave.
    const sampleDistance = sampleDeltaX * sampleDeltaX + sampleDeltaZ * sampleDeltaZ;
    const maximumInterval = speed < 0.12 ? 0.55 : 0.22;
    const shouldSample =
      (emission.emitHull || emission.emitProp) &&
      (sampleDistance > 0.28 * 0.28 || time - this.lastSampleTime >= maximumInterval);
    if (shouldSample) {
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
          });
        });
        if (speed > BOW_WAVE_MIN_SPEED) {
          // Each bow sheds a wave that peels away from the track at the
          // Kelvin angle, drawing the V that marks a displacement hull.
          const direction = Math.sign(physics.telemetry.forwardSpeed) || 1;
          const spread = Math.min(1.5, 0.34 * speed);
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
    this.updateSplashDecals(this.splashRings, this.rings, delta, true);
    this.updateSplashDecals(this.splashFoam, this.foamPatches, delta, false);
  }

  update(time: number): void {
    if (time - this.lastVisualUpdate < 1 / 30) return;
    this.lastVisualUpdate = time;
    this.updateInstances(this.hullWake, this.hullSamples, time, false);
    this.updateInstances(this.propWake, this.propSamples, time, true);
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
    [this.hullWake, this.propWake, this.splashRings, this.splashFoam].forEach((mesh) => {
      (mesh.material as THREE.MeshBasicMaterial).color.copy(this.litColor);
    });
    ((this.particlePoints.material as THREE.ShaderMaterial).uniforms.sprayColor.value as THREE.Color).copy(
      this.litColor,
    );
  }

  splash(position: THREE.Vector3, intensity = 1): void {
    const profile = calculateSplashProfile(intensity);
    for (let index = 0; index < profile.dropletCount; index += 1) {
      const particle = this.nextParticle();
      if (!particle) break;
      const angle = Math.random() * Math.PI * 2;
      const radial = profile.radialVelocity * (0.35 + Math.random() * 0.82);
      particle.active = true;
      particle.position.copy(position);
      particle.position.x += (Math.random() - 0.5) * profile.spread * 2;
      particle.position.z += (Math.random() - 0.5) * profile.spread * 2;
      particle.velocity.set(
        Math.cos(angle) * radial,
        profile.verticalVelocity * (0.52 + Math.random() * 0.72),
        Math.sin(angle) * radial,
      );
      particle.life = 0;
      particle.maxLife = 0.82 + Math.random() * 1.05 + Math.min(0.7, intensity * 0.14);
      particle.size = profile.particleSize * (0.62 + Math.random() * 0.9);
    }

    for (let index = 0; index < profile.ringCount; index += 1) {
      const ring = this.nextSplashDecal(this.rings);
      if (!ring) break;
      ring.active = true;
      ring.position.copy(position);
      ring.life = 0;
      ring.delay = index * 0.09;
      ring.maxLife = 1.6 + index * 0.2 + Math.min(0.95, intensity * 0.19);
      ring.startRadius = 0.45 + index * 0.22;
      ring.endRadius = profile.radius * (0.72 + index * 0.12);
      ring.brightness = Math.max(0.58, 1 - index * 0.09);
    }

    for (let index = 0; index < profile.foamPatchCount; index += 1) {
      const patch = this.nextSplashDecal(this.foamPatches);
      if (!patch) break;
      const angle = Math.random() * Math.PI * 2;
      const offset = profile.spread * Math.sqrt(Math.random());
      patch.active = true;
      patch.position.copy(position);
      patch.position.x += Math.cos(angle) * offset;
      patch.position.z += Math.sin(angle) * offset;
      patch.life = 0;
      patch.delay = index * 0.07;
      patch.maxLife = 2 + Math.random() * 0.9 + Math.min(0.9, intensity * 0.18);
      patch.startRadius = 0.7 + index * 0.25;
      patch.endRadius = profile.radius * (0.48 + Math.random() * 0.2);
      patch.brightness = 0.72 + Math.random() * 0.2;
    }
  }

  reset(): void {
    this.hullSamples.length = 0;
    this.propSamples.length = 0;
    this.hullWake.count = 0;
    this.propWake.count = 0;
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
    this.splashRings.count = 0;
    this.splashFoam.count = 0;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.hullWake.geometry.dispose();
    (Array.isArray(this.hullWake.material) ? this.hullWake.material : [this.hullWake.material])
      .forEach((material) => material.dispose());
    this.propWake.geometry.dispose();
    (Array.isArray(this.propWake.material) ? this.propWake.material : [this.propWake.material])
      .forEach((material) => material.dispose());
    this.splashRings.geometry.dispose();
    (Array.isArray(this.splashRings.material) ? this.splashRings.material : [this.splashRings.material])
      .forEach((material) => material.dispose());
    this.splashFoam.geometry.dispose();
    (Array.isArray(this.splashFoam.material) ? this.splashFoam.material : [this.splashFoam.material])
      .forEach((material) => material.dispose());
    this.particleGeometry.dispose();
    (this.particlePoints.material as THREE.Material).dispose();
    this.foam.dispose();
    this.ringTexture.dispose();
  }

  private updateInstances(mesh: THREE.InstancedMesh, samples: WakeSample[], time: number, prop: boolean): void {
    const life = prop ? 8 : 12;
    while (samples.length > 0 && time - samples[samples.length - 1].born >= life) samples.pop();
    const capacity = prop ? this.propCapacity : this.hullCapacity;
    const activeCount = Math.min(samples.length, capacity);
    mesh.count = activeCount;
    for (let index = 0; index < activeCount; index += 1) {
      const sample = samples[index];
      const age = time - sample.born;
      const normalized = Math.min(1, age / life);
      const width = sample.bow
        ? 0.5 + normalized * 1.5
        : (prop ? 1.15 : 0.92) + normalized * (prop ? 2.75 : 2.25);
      const length = sample.bow ? 2.1 + normalized * 2.6 : (prop ? 1.75 : 1.55) + normalized * 2.9;
      // The diverging wave slows as it spreads: integrate a decaying drift.
      const travelled = (1 - Math.exp(-age * 0.3)) / 0.3;
      this.scratchPosition.copy(sample.position);
      this.scratchPosition.x += sample.driftX * travelled;
      this.scratchPosition.z += sample.driftZ * travelled;
      const oceanHeight = this.ocean.sample(this.scratchPosition.x, this.scratchPosition.z).height;
      this.scratchPosition.y = oceanHeight + 0.11;
      // Many decals overlap along a track. Giving each its own turn, size and
      // weight makes the sum read as churned, patchy foam, not a painted band.
      const grainA = fract(Math.sin(sample.born * 91.7 + sample.position.x * 3.1) * 43758.5453);
      const grainB = fract(Math.sin(sample.born * 37.3 + sample.position.z * 5.7) * 24634.6345);
      this.quaternion.setFromAxisAngle(this.yAxis, sample.heading + (grainA - 0.5) * (sample.bow ? 0.3 : 1.1));
      this.scale.set(width * (0.8 + grainB * 0.5), 1, length * (0.8 + grainA * 0.45));
      this.matrix.compose(this.scratchPosition, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      // Fresh foam is dense and collapses quickly; a faint slick lingers.
      const fresh = Math.exp(-age * (sample.bow ? 1.1 : prop ? 0.75 : 0.55));
      const lingering = Math.pow(Math.max(0, 1 - normalized), 1.6) * 0.3;
      const fade = fresh * 0.7 + lingering;
      const brightness =
        fade * (0.45 + sample.strength * 0.55) * (0.45 + grainB * 1.1) * (sample.bow ? WAKE_LAYER_GAIN * 0.8 : WAKE_LAYER_GAIN);
      mesh.setColorAt(index, this.scratchColor.setRGB(brightness * 0.82, brightness * 0.97, brightness));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private updateSplashDecals(
    mesh: THREE.InstancedMesh,
    decals: SplashDecal[],
    delta: number,
    ring: boolean,
  ): void {
    let activeCount = 0;
    decals.forEach((decal) => {
      if (!decal.active) return;
      decal.life += delta;
      const age = decal.life - decal.delay;
      if (age < 0) return;
      if (age >= decal.maxLife) {
        decal.active = false;
        return;
      }

      const normalized = age / decal.maxLife;
      const expansion = ring
        ? 1 - Math.pow(1 - normalized, 2.2)
        : normalized * normalized * (3 - 2 * normalized);
      const radius = THREE.MathUtils.lerp(decal.startRadius, decal.endRadius, expansion);
      this.scratchPosition.copy(decal.position);
      this.scratchPosition.y = this.ocean.sample(decal.position.x, decal.position.z).height + (ring ? 0.065 : 0.052);
      this.quaternion.identity();
      this.scale.set(radius * 2, 1, radius * 2);
      this.matrix.compose(this.scratchPosition, this.quaternion, this.scale);
      mesh.setMatrixAt(activeCount, this.matrix);
      const fade = Math.pow(Math.max(0, 1 - normalized), ring ? 1.15 : 1.6);
      const brightness = decal.brightness * fade;
      mesh.setColorAt(
        activeCount,
        this.scratchColor.setRGB(brightness * 0.8, brightness * 0.96, brightness),
      );
      activeCount += 1;
    });
    mesh.count = activeCount;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
    };
  }

  private nextSplashDecal(decals: SplashDecal[]): SplashDecal | undefined {
    return decals.find((decal) => !decal.active);
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
  }

  private updateParticles(delta: number): void {
    this.particles.forEach((particle, index) => {
      if (particle.active) {
        particle.life += delta;
        particle.velocity.y -= 9.81 * delta;
        particle.velocity.multiplyScalar(Math.exp(-0.55 * delta));
        particle.position.addScaledVector(particle.velocity, delta);
        const waterHeight = this.ocean.sample(particle.position.x, particle.position.z).height;
        if (particle.life >= particle.maxLife || (particle.velocity.y < 0 && particle.position.y <= waterHeight)) {
          particle.active = false;
        }
      }
      const offset = index * 3;
      if (particle.active) {
        this.particlePositions[offset] = particle.position.x;
        this.particlePositions[offset + 1] = particle.position.y;
        this.particlePositions[offset + 2] = particle.position.z;
        const normalizedAge = THREE.MathUtils.clamp(particle.life / particle.maxLife, 0, 1);
        this.particleSizes[index] = particle.size * (1 + normalizedAge * 0.28);
        this.particleOpacities[index] = Math.pow(1 - normalizedAge, 0.65);
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
  }

  private nextParticle(): Particle | undefined {
    return this.particles.find((particle) => !particle.active);
  }
}
