import * as THREE from "three";
import { clamp, damp, lerpAngle } from "../math";
import type { OceanSample } from "../environment/OceanMath";
import type { SimulatorControls } from "../types";

export type OceanSampler = {
  sample: (x: number, z: number) => OceanSample;
};

export type IslandPhysics = {
  depthAt: (x: number, z: number) => number;
  avoidanceForce: (position: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3) => THREE.Vector3;
  constrainToWater: (position: THREE.Vector3, velocity: THREE.Vector3) => boolean;
  nearestShoreDirection: (position: THREE.Vector3, target: THREE.Vector3) => THREE.Vector3;
};

export type VesselTelemetry = {
  forwardSpeed: number;
  speedKnots: number;
  apparentWindSpeed: number;
  apparentWindAngle: number;
  depth: number;
  heel: number;
};

const BUOYANCY_POINTS = [
  [-1.55, 4.15],
  [1.55, 4.15],
  [-1.55, 2.05],
  [1.55, 2.05],
  [-1.55, 0],
  [1.55, 0],
  [-1.55, -2.1],
  [1.55, -2.1],
  [-1.55, -4.05],
  [1.55, -4.05],
] as const;

export class VesselPhysics {
  readonly position = new THREE.Vector3(0, 0.46, 0);
  readonly velocity = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, 1);
  readonly right = new THREE.Vector3(1, 0, 0);
  heading = 0;
  yawRate = 0;
  pitch = 0;
  roll = 0;
  heaveVelocity = 0;
  telemetry: VesselTelemetry = {
    forwardSpeed: 0,
    speedKnots: 0,
    apparentWindSpeed: 7.2,
    apparentWindAngle: 0.6,
    depth: 18,
    heel: 0,
  };

  private readonly mass = 6200;
  private readonly yawInertia = 112000;
  private readonly wind = new THREE.Vector3(6.8, 0, 4.2);
  private readonly apparentWind = new THREE.Vector3();
  private readonly force = new THREE.Vector3();
  private readonly avoidance = new THREE.Vector3();
  private readonly shoreDirection = new THREE.Vector3();
  private waveRollTarget = 0;
  private previousSurfaceTarget = 0.46;
  private surfaceTargetReady = false;

  constructor(
    private readonly ocean: OceanSampler,
    private readonly islands: IslandPhysics,
  ) {}

  fixedUpdate(delta: number, controls: SimulatorControls): void {
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));

    const forwardSpeed = this.velocity.dot(this.forward);
    const lateralSpeed = this.velocity.dot(this.right);
    this.apparentWind.copy(this.wind).sub(this.velocity);
    const apparentForward = this.apparentWind.dot(this.forward);
    const apparentRight = this.apparentWind.dot(this.right);
    const apparentWindSpeed = Math.hypot(apparentForward, apparentRight);
    const apparentWindAngle = Math.atan2(apparentRight, apparentForward);

    this.force.set(0, 0, 0);
    const throttle = clamp(controls.throttle, -1, 1);
    const propellerForce = throttle * (throttle < 0 ? 41000 : 76000);
    this.force.addScaledVector(this.forward, propellerForce);

    const windAngle = Math.abs(apparentWindAngle);
    const noGo = smoothNoGo(windAngle);
    const sailEfficiency = Math.sin(Math.min(Math.PI, windAngle)) * noGo * clamp(controls.sailTrim, 0.2, 1);
    const sailForce = 0.5 * 1.225 * 72 * apparentWindSpeed * apparentWindSpeed * sailEfficiency * 0.88;
    this.force.addScaledVector(this.forward, sailForce);
    this.force.addScaledVector(this.right, Math.sign(apparentRight || 1) * sailForce * 0.11);

    const forwardDrag = -Math.sign(forwardSpeed) * forwardSpeed * forwardSpeed * 44;
    const lateralDrag = -lateralSpeed * Math.abs(lateralSpeed) * 980 - lateralSpeed * 1750;
    this.force.addScaledVector(this.forward, forwardDrag);
    this.force.addScaledVector(this.right, lateralDrag);

    this.islands.avoidanceForce(this.position, this.velocity, this.avoidance);
    this.force.addScaledVector(this.avoidance, this.mass);
    this.velocity.addScaledVector(this.force, delta / this.mass);

    const rudderEffect = clamp(Math.abs(forwardSpeed) / 2.2, 0, 1);
    const rudderTorque = controls.rudder * forwardSpeed * Math.abs(forwardSpeed) * 510 * rudderEffect;
    const avoidanceYaw = this.forward.x * this.avoidance.z - this.forward.z * this.avoidance.x;
    this.yawRate += (rudderTorque / this.yawInertia + avoidanceYaw * 0.72 - this.yawRate * 1.42) * delta;
    this.yawRate = clamp(this.yawRate, -0.72, 0.72);
    this.heading += this.yawRate * delta;
    this.position.addScaledVector(this.velocity, delta);

    const collided = this.islands.constrainToWater(this.position, this.velocity);
    if (collided) {
      this.islands.nearestShoreDirection(this.position, this.shoreDirection);
      const safeHeading = Math.atan2(this.shoreDirection.x, this.shoreDirection.z);
      this.heading = lerpAngle(this.heading, safeHeading, 0.42);
      this.yawRate *= 0.3;
    }

    this.updateBuoyancy(delta, Math.abs(forwardSpeed));
    const speed = this.velocity.length();
    const heelTarget = clamp(
      -Math.sign(apparentRight || 1) * sailForce / 27000 - controls.rudder * forwardSpeed * 0.008,
      -0.26,
      0.26,
    );
    this.roll = damp(this.roll, clamp(heelTarget + this.waveRollTarget, -0.3, 0.3), 2.8, delta);
    this.telemetry.forwardSpeed = forwardSpeed;
    this.telemetry.speedKnots = speed * 1.943844;
    this.telemetry.apparentWindSpeed = apparentWindSpeed;
    this.telemetry.apparentWindAngle = apparentWindAngle;
    this.telemetry.depth = this.islands.depthAt(this.position.x, this.position.z);
    this.telemetry.heel = this.roll;

    if (!Number.isFinite(this.position.x + this.position.y + this.position.z + this.heading)) {
      this.reset();
    }
  }

  reset(): void {
    this.position.set(0, 0.46, 0);
    this.velocity.set(0, 0, 0);
    this.heading = 0;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.heaveVelocity = 0;
    this.waveRollTarget = 0;
    this.previousSurfaceTarget = 0.46;
    this.surfaceTargetReady = false;
  }

  private updateBuoyancy(delta: number, forwardSpeed: number): void {
    let averageHeight = 0;
    let bowHeight = 0;
    let sternHeight = 0;
    let portHeight = 0;
    let starboardHeight = 0;
    let bowCount = 0;
    let sternCount = 0;
    let portCount = 0;
    let starboardCount = 0;

    for (const [offsetX, offsetZ] of BUOYANCY_POINTS) {
      const worldX = this.position.x + this.right.x * offsetX + this.forward.x * offsetZ;
      const worldZ = this.position.z + this.right.z * offsetX + this.forward.z * offsetZ;
      const height = this.ocean.sample(worldX, worldZ).height;
      averageHeight += height;
      if (offsetZ > 2) { bowHeight += height; bowCount += 1; }
      if (offsetZ < -2) { sternHeight += height; sternCount += 1; }
      if (offsetX < 0) { portHeight += height; portCount += 1; }
      if (offsetX > 0) { starboardHeight += height; starboardCount += 1; }
    }

    averageHeight /= BUOYANCY_POINTS.length;
    bowHeight /= Math.max(1, bowCount);
    sternHeight /= Math.max(1, sternCount);
    portHeight /= Math.max(1, portCount);
    starboardHeight /= Math.max(1, starboardCount);

    const dynamicSquat = clamp(forwardSpeed * forwardSpeed * 0.0015, 0, 0.08);
    const targetY = averageHeight + 0.46 - dynamicSquat;
    if (!this.surfaceTargetReady) {
      this.previousSurfaceTarget = targetY;
      this.surfaceTargetReady = true;
    }
    const surfaceVelocity = clamp((targetY - this.previousSurfaceTarget) / Math.max(delta, 1e-4), -1.6, 1.6);
    this.previousSurfaceTarget = targetY;
    const heaveAcceleration = (targetY - this.position.y) * 10.8 + (surfaceVelocity - this.heaveVelocity) * 5.6;
    this.heaveVelocity += heaveAcceleration * delta;
    this.heaveVelocity = clamp(this.heaveVelocity, -2.2, 2.2);
    this.position.y += this.heaveVelocity * delta;
    // Vessel.root uses +Z as the bow and applies rotation.z = -roll.
    // These signs align the hulls with the sampled surface plane.
    const pitchTarget = clamp(-Math.atan2(bowHeight - sternHeight, 8.2), -0.17, 0.17);
    this.waveRollTarget = clamp(-Math.atan2(starboardHeight - portHeight, 3.1), -0.18, 0.18);
    this.pitch = damp(this.pitch, pitchTarget, 4.1, delta);
  }
}

function smoothNoGo(angle: number): number {
  const low = 0.32;
  const high = 0.76;
  const t = clamp((angle - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}
