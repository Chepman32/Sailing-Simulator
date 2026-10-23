import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import { clamp, damp } from "../math";
import type { InterestPoint } from "../camera/PhotoDirector";
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
import {
  nextSharkPhase,
  SHARK_FIN_ORBIT_RADIUS,
  SHARK_FIN_START_DISTANCE,
  sharkPhaseDuration,
  sharkRootDepth,
  type SharkPhase,
} from "./WildlifeState";

const SHARK_LIMITS: SwimmerLimits = {
  minSpeed: 1.8,
  maxSpeed: 3.65,
  acceleration: 0.42,
  deceleration: 0.58,
  maxTurnRate: 0.24,
  maxYawAcceleration: 0.16,
  turnResponse: 0.62,
};

/** A fin pass may briefly sprint to keep pace with a slow-moving yacht. */
const SHARK_FIN_LIMITS: SwimmerLimits = {
  ...SHARK_LIMITS,
  maxSpeed: 4.8,
  acceleration: 0.55,
};

const FIN_TRAIL_INTERVAL = 0.28;

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
  phase: SharkPhase;
  phaseAge: number;
  phaseDuration: number;
  orbitDirection: number;
  finTop: number;
  trailTimer: number;
};

export class SharkController {
  private readonly shark?: Shark;
  private readonly steering = new THREE.Vector3();
  private readonly avoidance = new THREE.Vector3();
  private readonly holdingPoint = new THREE.Vector3();
  private readonly finPoint = new THREE.Vector3();

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    assets: AssetManager,
    private readonly onFinWake?: (position: THREE.Vector3) => void,
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
    // The dorsal fin is the highest point of the centred model.
    const finTop = Math.max(0.35, new THREE.Box3().setFromObject(visual.model).max.y);
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
      phase: "patrol",
      phaseAge: 0,
      // The first fin pass comes soon after the scene starts.
      phaseDuration: 9,
      orbitDirection: 1,
      finTop,
      trailTimer: 0,
    };
  }

  get phase(): SharkPhase | undefined {
    return this.shark?.phase;
  }

  collectInterest(points: InterestPoint[]): void {
    const shark = this.shark;
    if (!shark || shark.phase !== "fin" || shark.phaseAge < shark.phaseDuration * 0.15) return;
    points.push({ kind: "shark", position: shark.position, radius: 3.5, priority: 4 });
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    const shark = this.shark;
    if (!shark) return;
    shark.age += delta;
    shark.waypointAge += delta;
    shark.phaseAge += delta;
    if (animationDelta > 0) shark.visual.mixer?.update(animationDelta * (0.76 + shark.motion.speed * 0.12));

    if (!shark.initialized) this.initialize(shark, physics);
    if (shark.position.distanceToSquared(physics.position) > 160 * 160) {
      shark.initialized = false;
      this.initialize(shark, physics);
    }

    const distanceToVessel = shark.position.distanceTo(physics.position);
    this.advancePhase(shark, distanceToVessel);

    let desiredHeading: number;
    let targetSpeed: number;
    let limits = SHARK_LIMITS;
    if (shark.phase === "fin") {
      desiredHeading = this.orbitHeading(shark, physics);
      targetSpeed = clamp(Math.abs(physics.telemetry.forwardSpeed) + 1.2, 2.6, 4.6);
      limits = SHARK_FIN_LIMITS;
    } else if (shark.phase === "approach") {
      desiredHeading = this.approachHeading(shark, physics);
      targetSpeed = 3.4;
    } else {
      if (shark.position.distanceToSquared(shark.target) < 7 * 7 || shark.waypointAge >= shark.waypointDuration) {
        this.chooseWaypoint(shark, physics);
      }
      desiredHeading = headingTo(shark.position, shark.target);
      targetSpeed = distanceToVessel < 12 ? 3.15 : 2.45;
    }
    desiredHeading = this.steeredHeading(shark, desiredHeading, physics, shark.phase === "fin" ? 9 : 14);
    stepSwimmerKinematics(shark.motion, desiredHeading, targetSpeed, delta, limits);
    shark.position.x += shark.motion.velocityX * delta;
    shark.position.z += shark.motion.velocityZ * delta;

    const surface = this.ocean.sample(shark.position.x, shark.position.z).height;
    const progress = shark.phaseAge / Math.max(0.001, shark.phaseDuration);
    const breathing = shark.phase === "fin" ? 0.03 : 0.16;
    const targetDepth = surface - sharkRootDepth(shark.phase, progress, shark.finTop) + Math.sin(shark.age * 0.32) * breathing;
    shark.position.y = stepVerticalMotion(shark.position.y, shark.motion, targetDepth, delta, 4.1, 4.3, 2.4);

    shark.root.rotation.y = shark.motion.heading;
    shark.root.rotation.x = damp(
      shark.root.rotation.x,
      swimmerPitch(shark.motion.verticalSpeed, shark.motion.speed, 0.11),
      2.8,
      delta,
    );
    // A shark cruising at the surface keeps its fin upright: almost no bank.
    const bankLimit = shark.phase === "fin" ? 0.05 : 0.14;
    shark.root.rotation.z = damp(
      shark.root.rotation.z,
      swimmerBank(shark.motion.yawRate, shark.motion.speed, bankLimit),
      2.7,
      delta,
    );

    if (shark.phase === "fin" && shark.position.y + shark.finTop > surface + 0.05) {
      shark.trailTimer -= delta;
      if (shark.trailTimer <= 0) {
        shark.trailTimer = FIN_TRAIL_INTERVAL;
        this.finPoint.set(shark.position.x, surface + 0.03, shark.position.z);
        this.onFinWake?.(this.finPoint);
      }
    }
  }

  dispose(): void {
    if (!this.shark) return;
    this.shark.visual.mixer?.stopAllAction();
    this.group.remove(this.shark.root);
  }

  private advancePhase(shark: Shark, distanceToVessel: number): void {
    const reachedYacht = shark.phase === "approach" && distanceToVessel < SHARK_FIN_START_DISTANCE;
    if (!reachedYacht && shark.phaseAge < shark.phaseDuration) return;
    shark.phase = nextSharkPhase(shark.phase);
    shark.phaseAge = 0;
    shark.phaseDuration = sharkPhaseDuration(shark.phase, Math.random());
    if (shark.phase === "fin") shark.orbitDirection = Math.random() < 0.5 ? -1 : 1;
  }

  /** Head for a point abeam of the yacht on the shark's own side. */
  private approachHeading(shark: Shark, physics: VesselPhysics): number {
    const side = Math.sign(
      (shark.position.x - physics.position.x) * physics.right.x + (shark.position.z - physics.position.z) * physics.right.z,
    ) || 1;
    this.holdingPoint
      .copy(physics.position)
      .addScaledVector(physics.right, side * SHARK_FIN_ORBIT_RADIUS)
      .addScaledVector(physics.forward, 6);
    const requested = headingTo(shark.position, this.holdingPoint);
    return forwardBiasedHeading(shark.motion.heading, requested, 0.9);
  }

  /** Follow a circle around the yacht, leading the shark along its tangent. */
  private orbitHeading(shark: Shark, physics: VesselPhysics): number {
    const angle = Math.atan2(shark.position.x - physics.position.x, shark.position.z - physics.position.z);
    const lead = angle + shark.orbitDirection * 0.55;
    this.holdingPoint.set(
      physics.position.x + Math.sin(lead) * SHARK_FIN_ORBIT_RADIUS + physics.velocity.x * 2,
      0,
      physics.position.z + Math.cos(lead) * SHARK_FIN_ORBIT_RADIUS + physics.velocity.z * 2,
    );
    return headingTo(shark.position, this.holdingPoint);
  }

  private initialize(shark: Shark, physics: VesselPhysics): void {
    const angle = 0.35 + Math.random() * Math.PI * 2;
    const radius = 36 + Math.random() * 12;
    shark.position
      .copy(physics.position)
      .add(this.avoidance.set(Math.sin(angle) * radius, -shark.finTop - 1, Math.cos(angle) * radius));
    shark.motion.heading = angle + Math.PI + (Math.random() - 0.5) * 0.24;
    shark.motion.yawRate = 0;
    shark.motion.verticalSpeed = 0;
    shark.motion.velocityX = Math.sin(shark.motion.heading) * shark.motion.speed;
    shark.motion.velocityZ = Math.cos(shark.motion.heading) * shark.motion.speed;
    shark.root.rotation.set(0, shark.motion.heading, 0, "YXZ");
    shark.initialized = true;
    if (shark.phase === "fin" || shark.phase === "dive") {
      shark.phase = "patrol";
      shark.phaseAge = 0;
      shark.phaseDuration = sharkPhaseDuration("patrol", Math.random());
    }
    this.chooseWaypoint(shark, physics);
  }

  private chooseWaypoint(shark: Shark, physics: VesselPhysics): void {
    const distanceToVessel = shark.position.distanceTo(physics.position);
    const holdingRadius = 40;
    const radialHeading = Math.atan2(
      shark.position.x - physics.position.x,
      shark.position.z - physics.position.z,
    );
    const desiredRadius = distanceToVessel < 24 ? holdingRadius + 12 : holdingRadius;
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

  private steeredHeading(shark: Shark, requestedHeading: number, physics: VesselPhysics, clearance: number): number {
    this.steering.set(Math.sin(requestedHeading), 0, Math.cos(requestedHeading));
    const distanceToVessel = shark.position.distanceTo(physics.position);
    if (distanceToVessel < clearance) {
      this.avoidance.copy(shark.position).sub(physics.position).setY(0);
      const length = this.avoidance.length();
      if (length > 0.001) {
        const weight = ((clearance - distanceToVessel) / clearance) * 1.65;
        this.steering.addScaledVector(this.avoidance.multiplyScalar(1 / length), weight);
      }
    }
    if (this.steering.lengthSq() < 0.0001) return shark.motion.heading;
    this.steering.normalize();
    return Math.atan2(this.steering.x, this.steering.z);
  }
}
