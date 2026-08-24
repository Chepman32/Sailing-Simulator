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
};

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
  private readonly particles: Particle[] = [];
  private readonly particleGeometry: THREE.BufferGeometry;
  private readonly particlePositions: Float32Array;
  private readonly particlePoints: THREE.Points;
  private spawnRemainder = 0;
  private lastVisualUpdate = Number.NEGATIVE_INFINITY;

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
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
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

    const particleCount = Math.round(220 * quality.foamDensity);
    this.particlePositions = new Float32Array(particleCount * 3);
    this.particlePositions.fill(-9999);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute("position", new THREE.BufferAttribute(this.particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xdffaff,
      size: 0.18,
      map: this.foam,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
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
      });
    }
  }

  fixedUpdate(delta: number, physics: VesselPhysics, controls: SimulatorControls, time: number): void {
    const speed = Math.abs(physics.telemetry.forwardSpeed);
    if (speed > 0.65 && this.lastSample.distanceToSquared(physics.position) > 0.62 * 0.62) {
      this.lastSample.copy(physics.position);
      const right = physics.right;
      const wakeStrength = Math.min(1, speed / 13) * (0.72 + Math.abs(controls.rudder) * 0.5);
      [-1.52, 1.52].forEach((offset) => {
        this.hullSamples.unshift({
          position: physics.position.clone().addScaledVector(right, offset).addScaledVector(physics.forward, -4.05),
          heading: physics.heading,
          born: time,
          strength: wakeStrength,
        });
      });
      if (Math.abs(controls.throttle) > 0.06) {
        this.propSamples.unshift({
          position: physics.position.clone().addScaledVector(physics.forward, -4.5),
          heading: physics.heading,
          born: time,
          strength: Math.min(1, Math.abs(controls.throttle) * 0.72 + speed / 35),
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
  }

  update(time: number): void {
    if (time - this.lastVisualUpdate < 1 / 30) return;
    this.lastVisualUpdate = time;
    this.updateInstances(this.hullWake, this.hullSamples, time, false);
    this.updateInstances(this.propWake, this.propSamples, time, true);
  }

  splash(position: THREE.Vector3, intensity = 1): void {
    const count = Math.round(11 + intensity * 12);
    for (let index = 0; index < count; index += 1) {
      const particle = this.nextParticle();
      if (!particle) break;
      const angle = Math.random() * Math.PI * 2;
      const radial = 1.2 + Math.random() * 2.4 * intensity;
      particle.active = true;
      particle.position.copy(position);
      particle.velocity.set(Math.cos(angle) * radial, 2.1 + Math.random() * 3.1, Math.sin(angle) * radial);
      particle.life = 0;
      particle.maxLife = 0.55 + Math.random() * 0.7;
    }
  }

  reset(): void {
    this.hullSamples.length = 0;
    this.propSamples.length = 0;
    this.hullWake.count = 0;
    this.propWake.count = 0;
    this.lastVisualUpdate = Number.NEGATIVE_INFINITY;
    this.lastSample.set(Number.POSITIVE_INFINITY, 0, 0);
    this.particles.forEach((particle) => {
      particle.active = false;
    });
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.hullWake.geometry.dispose();
    (Array.isArray(this.hullWake.material) ? this.hullWake.material : [this.hullWake.material])
      .forEach((material) => material.dispose());
    this.propWake.geometry.dispose();
    (Array.isArray(this.propWake.material) ? this.propWake.material : [this.propWake.material])
      .forEach((material) => material.dispose());
    this.particleGeometry.dispose();
    (this.particlePoints.material as THREE.Material).dispose();
    this.foam.dispose();
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
      const width = (prop ? 0.7 : 0.42) + normalized * (prop ? 2.6 : 2.1);
      const length = (prop ? 1.4 : 1.1) + normalized * 2.7;
      const oceanHeight = this.ocean.sample(sample.position.x, sample.position.z).height;
      this.scratchPosition.copy(sample.position);
      this.scratchPosition.y = oceanHeight + 0.045;
      this.quaternion.setFromAxisAngle(this.yAxis, sample.heading);
      this.scale.set(width, 1, length);
      this.matrix.compose(this.scratchPosition, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      const brightness = Math.max(0, 1 - normalized) * sample.strength;
      mesh.setColorAt(index, this.scratchColor.setRGB(brightness * 0.76, brightness * 0.95, brightness));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
      } else {
        this.particlePositions[offset] = -9999;
        this.particlePositions[offset + 1] = -9999;
        this.particlePositions[offset + 2] = -9999;
      }
    });
    (this.particleGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  private nextParticle(): Particle | undefined {
    return this.particles.find((particle) => !particle.active);
  }
}
