import * as THREE from "three";
import type { QualitySettings } from "../core/QualityManager";
import type { OceanSystem } from "../environment/OceanSystem";
import type { SimulatorControls } from "../types";
import type { VesselPhysics } from "./VesselPhysics";

type WakeSample = {
  position: THREE.Vector3;
  heading: number;
  born: number;
  strength: number;
};

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

function foamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const gradient = context.createRadialGradient(64, 32, 2, 64, 32, 62);
  gradient.addColorStop(0, "rgba(255,255,255,.95)");
  gradient.addColorStop(0.32, "rgba(222,251,255,.62)");
  gradient.addColorStop(0.7, "rgba(178,235,246,.18)");
  gradient.addColorStop(1, "rgba(160,220,240,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 64);
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
    this.hullCapacity = capacity * 2;
    this.propCapacity = capacity;
    const plane = new THREE.PlaneGeometry(1, 1.9);
    plane.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xe9fdff,
      map: this.foam,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      toneMapped: false,
    });
    this.hullWake = new THREE.InstancedMesh(plane, material, this.hullCapacity);
    this.hullWake.count = 0;
    this.hullWake.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.hullWake.frustumCulled = false;
    this.hullWake.renderOrder = 4;
    this.group.add(this.hullWake);

    this.propWake = new THREE.InstancedMesh(plane.clone(), material.clone(), this.propCapacity);
    this.propWake.count = 0;
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
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexColors: true,
    });
    this.splashRings = new THREE.InstancedMesh(splashPlane, splashMaterial, splashCapacity);
    this.splashRings.count = 0;
    this.splashRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splashRings.frustumCulled = false;
    this.splashRings.renderOrder = 6;
    this.group.add(this.splashRings);

    const foamCapacity = Math.max(12, Math.round(24 * quality.foamDensity));
    const foamMaterial = splashMaterial.clone();
    foamMaterial.map = this.foam;
    foamMaterial.opacity = 0.72;
    this.splashFoam = new THREE.InstancedMesh(splashPlane.clone(), foamMaterial, foamCapacity);
    this.splashFoam.count = 0;
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
        pointTexture: { value: this.foam },
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
        uniform sampler2D pointTexture;
        uniform vec3 sprayColor;
        varying float vOpacity;
        void main() {
          vec4 spray = texture2D(pointTexture, gl_PointCoord);
          float softEdge = 1.0 - smoothstep(0.68, 1.0, length(gl_PointCoord - 0.5) * 2.0);
          float alpha = spray.a * softEdge * vOpacity;
          if (alpha < 0.015) discard;
          gl_FragColor = vec4(sprayColor * (0.78 + spray.rgb * 0.36), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
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
          });
        });
      }
      if (emission.emitProp) {
        this.propSamples.unshift({
          position: physics.position.clone().addScaledVector(physics.forward, -4.5),
          heading: physics.heading,
          born: time,
          strength: emission.propStrength,
        });
      }
      this.hullSamples.length = Math.min(this.hullSamples.length, this.hullCapacity);
      this.propSamples.length = Math.min(this.propSamples.length, this.propCapacity);
    }

    const sprayRate = Math.max(0, speed - 3.2) * (1.1 + Math.abs(controls.rudder) * 0.7);
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
      const width = (prop ? 1.15 : 0.92) + normalized * (prop ? 2.75 : 2.25);
      const length = (prop ? 1.75 : 1.55) + normalized * 2.9;
      const oceanHeight = this.ocean.sample(sample.position.x, sample.position.z).height;
      this.scratchPosition.copy(sample.position);
      this.scratchPosition.y = oceanHeight + 0.11;
      this.quaternion.setFromAxisAngle(this.yAxis, sample.heading);
      this.scale.set(width, 1, length);
      this.matrix.compose(this.scratchPosition, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      const fade = Math.pow(Math.max(0, 1 - normalized), 1.25);
      const brightness = fade * (0.55 + sample.strength * 0.45);
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
