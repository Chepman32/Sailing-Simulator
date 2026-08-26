import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import { damp } from "../math";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import {
  forwardBiasedHeading,
  stepSwimmerKinematics,
  stepVerticalMotion,
  swimmerBank,
  swimmerPitch,
  type SwimmerKinematics,
  type SwimmerLimits,
} from "./SwimmerDynamics";
import {
  createAnimatedVisual,
  headingTo,
  setRandomAnimationTime,
  type AnimatedVisual,
} from "./WildlifeModel";

const SHARK_LIMITS: SwimmerLimits = {
  minSpeed: 1.8,
  maxSpeed: 3.65,
  acceleration: 0.42,
  deceleration: 0.58,
  maxTurnRate: 0.24,
  maxYawAcceleration: 0.16,
  turnResponse: 0.62,
};

type Shark = {
  root: THREE.Group;
  visual: AnimatedVisual;
  position: THREE.Vector3;
  target: THREE.Vector3;
  motion: SwimmerKinematics;
  age: number;
  waypointAge: number;
  waypointDuration: number;
  initialized: boolean;
  depthPhase: number;
};

export class SharkController {
  private readonly shark?: Shark;
  private readonly steering = new THREE.Vector3();
  private readonly avoidance = new THREE.Vector3();
  private readonly holdingPoint = new THREE.Vector3();

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    assets: AssetManager,
  ) {
    const asset = assets.animated("shark");
    if (!asset) return;
    const visual = createAnimatedVisual(
      asset,
      { targetSize: 5.6, measureAxis: "z", castShadow: false },
      [/^swimming$/i, /swim/i],
    );
    setRandomAnimationTime(visual, 0.95);
    visual.model.name = "Rigged_Shark";
    const root = new THREE.Group();
    root.name = "Inertial_Shark_Cruise_Root";
    root.rotation.order = "YXZ";
    root.add(visual.model);
    group.add(root);
    this.shark = {
      root,
      visual,
      position: root.position,
      target: new THREE.Vector3(),
      motion: {
        heading: 0,
        yawRate: 0,
        speed: 2.45,
        velocityX: 0,
        velocityZ: 2.45,
        verticalSpeed: 0,
      },
      age: 0,
      waypointAge: 0,
      waypointDuration: 15,
      initialized: false,
      depthPhase: Math.random() * Math.PI * 2,
    };
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    const shark = this.shark;
    if (!shark) return;
    shark.age += delta;
    shark.waypointAge += delta;
    if (animationDelta > 0) shark.visual.mixer?.update(animationDelta * (0.76 + shark.motion.speed * 0.12));

    if (!shark.initialized) this.initialize(shark, physics);
    if (shark.position.distanceToSquared(physics.position) > 160 * 160) {
      shark.initialized = false;
      this.initialize(shark, physics);
    }
    if (shark.position.distanceToSquared(shark.target) < 7 * 7 || shark.waypointAge >= shark.waypointDuration) {
      this.chooseWaypoint(shark, physics);
    }

    const distanceToVessel = shark.position.distanceTo(physics.position);
    const desiredHeading = this.steeredHeading(shark, headingTo(shark.position, shark.target), physics);
    const targetSpeed = distanceToVessel < 12 ? 3.15 : 2.45;
    stepSwimmerKinematics(shark.motion, desiredHeading, targetSpeed, delta, SHARK_LIMITS);
    shark.position.x += shark.motion.velocityX * delta;
    shark.position.z += shark.motion.velocityZ * delta;

    const surface = this.ocean.sample(shark.position.x, shark.position.z).height;
    const targetDepth = surface - 1.58 + Math.sin(shark.age * 0.32 + shark.depthPhase) * 0.16;
    shark.position.y = stepVerticalMotion(
      shark.position.y,
      shark.motion,
      targetDepth,
      delta,
      4.1,
      4.3,
      2.4,
    );

    shark.root.rotation.y = shark.motion.heading;
    shark.root.rotation.x = damp(
      shark.root.rotation.x,
      swimmerPitch(shark.motion.verticalSpeed, shark.motion.speed, 0.11),
      2.8,
      delta,
    );
    shark.root.rotation.z = damp(
      shark.root.rotation.z,
      swimmerBank(shark.motion.yawRate, shark.motion.speed, 0.14),
      2.7,
      delta,
    );
  }

  dispose(): void {
    if (!this.shark) return;
    this.shark.visual.mixer?.stopAllAction();
    this.group.remove(this.shark.root);
  }

  private initialize(shark: Shark, physics: VesselPhysics): void {
    const angle = 0.35 + Math.random() * Math.PI * 2;
    const radius = 36 + Math.random() * 12;
    shark.position
      .copy(physics.position)
      .add(this.avoidance.set(Math.sin(angle) * radius, -1.55, Math.cos(angle) * radius));
    shark.motion.heading = angle + Math.PI + (Math.random() - 0.5) * 0.24;
    shark.motion.yawRate = 0;
    shark.motion.verticalSpeed = 0;
    shark.motion.velocityX = Math.sin(shark.motion.heading) * shark.motion.speed;
    shark.motion.velocityZ = Math.cos(shark.motion.heading) * shark.motion.speed;
    shark.root.rotation.set(0, shark.motion.heading, 0, "YXZ");
    shark.initialized = true;
    this.chooseWaypoint(shark, physics);
  }

  private chooseWaypoint(shark: Shark, physics: VesselPhysics): void {
    const distanceToVessel = shark.position.distanceTo(physics.position);
    const holdingRadius = 32;
    const radialHeading = Math.atan2(
      shark.position.x - physics.position.x,
      shark.position.z - physics.position.z,
    );
    const desiredRadius = distanceToVessel < 20 ? holdingRadius + 12 : holdingRadius;
    this.holdingPoint.set(
      physics.position.x + Math.sin(radialHeading + 0.58) * desiredRadius,
      0,
      physics.position.z + Math.cos(radialHeading + 0.58) * desiredRadius,
    );
    const requested = headingTo(shark.position, this.holdingPoint);
    const correctionLimit = distanceToVessel > 82 || distanceToVessel < 18 ? 0.42 : 0.28;
    const baseCourse = forwardBiasedHeading(shark.motion.heading, requested, correctionLimit);
    const course = baseCourse + (Math.random() - 0.5) * 0.12;
    const travel = 34 + Math.random() * 22;
    shark.target.set(
      shark.position.x + Math.sin(course) * travel,
      -1.55,
      shark.position.z + Math.cos(course) * travel,
    );
    shark.waypointAge = 0;
    shark.waypointDuration = 13 + Math.random() * 7;
  }

  private steeredHeading(shark: Shark, requestedHeading: number, physics: VesselPhysics): number {
    this.steering.set(Math.sin(requestedHeading), 0, Math.cos(requestedHeading));
    const distanceToVessel = shark.position.distanceTo(physics.position);
    if (distanceToVessel < 14) {
      this.avoidance.copy(shark.position).sub(physics.position).setY(0);
      const length = this.avoidance.length();
      if (length > 0.001) {
        const weight = ((14 - distanceToVessel) / 14) * 1.65;
        this.steering.addScaledVector(this.avoidance.multiplyScalar(1 / length), weight);
      }
    }
    if (this.steering.lengthSq() < 0.0001) return shark.motion.heading;
    this.steering.normalize();
    return Math.atan2(this.steering.x, this.steering.z);
  }
}
