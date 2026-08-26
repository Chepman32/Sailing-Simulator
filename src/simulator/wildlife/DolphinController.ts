import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import { clamp, damp } from "../math";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import {
  forwardBiasedHeading,
  shortestAngleDifference,
  stepSwimmerKinematics,
  stepVerticalMotion,
  swimmerBank,
  swimmerPitch,
  type SwimmerKinematics,
  type SwimmerLimits,
} from "./SwimmerDynamics";
import { canStartBreach, DOLPHIN_STATE_DURATION, nextDolphinState, type DolphinState } from "./WildlifeState";
import { createAnimatedVisual, headingTo, setRandomAnimationTime, type AnimatedVisual } from "./WildlifeModel";

const DOLPHIN_LIMITS: SwimmerLimits = {
  minSpeed: 4.8,
  maxSpeed: 9.2,
  acceleration: 1.15,
  deceleration: 1.45,
  maxTurnRate: 0.42,
  maxYawAcceleration: 0.38,
  turnResponse: 0.9,
};

const GRAVITY = 9.81;

type Dolphin = {
  root: THREE.Group;
  visual: AnimatedVisual;
  motion: SwimmerKinematics;
  state: DolphinState;
  stateElapsed: number;
  cooldown: number;
  jumpElapsed: number;
  side: number;
  phase: number;
  target: THREE.Vector3;
  waypointAge: number;
  waypointDuration: number;
  initialized: boolean;
  jumpOrigin: THREE.Vector3;
  jumpDirection: THREE.Vector3;
  jumpHeading: number;
  jumpSpeed: number;
  splashTriggered: boolean;
};

export class DolphinController {
  private readonly dolphins: Dolphin[] = [];
  private readonly target = new THREE.Vector3();
  private readonly jumpPosition = new THREE.Vector3();
  private readonly steering = new THREE.Vector3();
  private readonly avoidance = new THREE.Vector3();
  private readonly separation = new THREE.Vector3();

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    assets: AssetManager,
    count: number,
    private readonly onSplash: (position: THREE.Vector3, intensity: number) => void,
  ) {
    for (let index = 0; index < count; index += 1) {
      this.dolphins.push(this.createDolphin(assets, index));
    }
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    this.dolphins.forEach((dolphin, index) => {
      const animationRate = dolphin.state === "swim" ? 1 : dolphin.state === "approach" ? 1.16 : 0.94;
      if (animationDelta > 0) dolphin.visual.mixer?.update(animationDelta * animationRate);
      dolphin.stateElapsed += delta;
      dolphin.cooldown -= delta;
      dolphin.waypointAge += delta;

      if (dolphin.state === "swim") {
        this.updateSwim(dolphin, index, delta, physics);
        if (
          canStartBreach(physics.telemetry.forwardSpeed, dolphin.cooldown) &&
          this.canApproachForBreach(dolphin, physics)
        ) {
          this.transition(dolphin, "approach");
        }
      } else if (dolphin.state === "approach") {
        this.updateApproach(dolphin, delta, physics);
        const targetHeading = headingTo(dolphin.root.position, this.target);
        const aligned = Math.cos(shortestAngleDifference(dolphin.motion.heading, targetHeading)) > 0.9;
        const closeEnough = dolphin.root.position.distanceToSquared(this.target) < 11 * 11;
        if (dolphin.stateElapsed >= DOLPHIN_STATE_DURATION.approach && aligned && closeEnough) {
          this.beginJump(dolphin);
        } else if (dolphin.stateElapsed > 3.1) {
          dolphin.cooldown = 4 + Math.random() * 3;
          this.transition(dolphin, "swim");
        }
      } else if (
        dolphin.state === "breach_ascent" ||
        dolphin.state === "airborne" ||
        dolphin.state === "reentry"
      ) {
        this.updateJump(dolphin, delta);
        const duration = DOLPHIN_STATE_DURATION[dolphin.state];
        if (dolphin.stateElapsed >= duration) this.transition(dolphin, nextDolphinState(dolphin.state));
      } else if (dolphin.state === "splash") {
        if (!dolphin.splashTriggered) {
          dolphin.splashTriggered = true;
          this.onSplash(dolphin.root.position, 0.8);
        }
        this.updateDive(dolphin, delta, 0.72);
        if (dolphin.stateElapsed >= DOLPHIN_STATE_DURATION.splash) this.transition(dolphin, "dive");
      } else if (dolphin.state === "dive") {
        this.updateDive(dolphin, delta, 1.8);
        if (dolphin.stateElapsed >= DOLPHIN_STATE_DURATION.dive) {
          dolphin.cooldown = 8 + index * 3.4 + Math.random() * 5;
          this.transition(dolphin, "swim");
        }
      }
    });
  }

  dispose(): void {
    this.dolphins.forEach((dolphin) => {
      dolphin.visual.mixer?.stopAllAction();
      this.group.remove(dolphin.root);
    });
    this.dolphins.length = 0;
  }

  private createDolphin(assets: AssetManager, index: number): Dolphin {
    const visual = createAnimatedVisual(
      assets.dolphin(),
      {
        targetSize: 2.8,
        measureAxis: "x",
        // This rig's rostrum points along +X; the runtime forward axis is +Z.
        yaw: -Math.PI / 2,
        castShadow: false,
      },
      [/swim/i],
    );
    setRandomAnimationTime(visual, 1.85 + index * 0.14);
    visual.model.name = `Rigged_Dolphin_${index + 1}`;
    const root = new THREE.Group();
    root.rotation.order = "YXZ";
    root.add(visual.model);
    this.group.add(root);

    const initialSpeed = 6.4 + index * 0.45 + Math.random() * 0.4;
    return {
      root,
      visual,
      motion: {
        heading: 0,
        yawRate: 0,
        speed: initialSpeed,
        velocityX: 0,
        velocityZ: initialSpeed,
        verticalSpeed: 0,
      },
      state: "swim",
      stateElapsed: 0,
      cooldown: 5 + index * 4,
      jumpElapsed: 0,
      side: index % 2 === 0 ? -1 : 1,
      phase: index * 2.4,
      target: new THREE.Vector3(),
      waypointAge: 0,
      waypointDuration: 8,
      initialized: false,
      jumpOrigin: new THREE.Vector3(),
      jumpDirection: new THREE.Vector3(0, 0, 1),
      jumpHeading: 0,
      jumpSpeed: 7.8,
      splashTriggered: false,
    };
  }

  private updateSwim(dolphin: Dolphin, index: number, delta: number, physics: VesselPhysics): void {
    if (!dolphin.initialized || dolphin.root.position.distanceToSquared(physics.position) > 150 * 150) {
      this.initialize(dolphin, index, physics);
    }
    if (
      dolphin.root.position.distanceToSquared(dolphin.target) < 8 * 8 ||
      dolphin.waypointAge >= dolphin.waypointDuration ||
      dolphin.root.position.distanceToSquared(physics.position) > 72 * 72
    ) {
      this.chooseWaypoint(dolphin, index, physics);
    }

    const desiredHeading = this.steeredHeading(
      dolphin,
      headingTo(dolphin.root.position, dolphin.target),
      physics,
    );
    const distanceToVessel = dolphin.root.position.distanceTo(physics.position);
    const cruiseSpeed = 6.6 + index * 0.48 + (distanceToVessel < 8 ? 0.7 : 0);
    stepSwimmerKinematics(dolphin.motion, desiredHeading, cruiseSpeed, delta, DOLPHIN_LIMITS);
    this.advance(dolphin, delta);

    const surface = this.ocean.sample(dolphin.root.position.x, dolphin.root.position.z).height;
    const targetDepth = surface - 0.72 + Math.sin(dolphin.stateElapsed * 0.7 + dolphin.phase) * 0.06;
    dolphin.root.position.y = stepVerticalMotion(
      dolphin.root.position.y,
      dolphin.motion,
      targetDepth,
      delta,
      7.2,
      5.1,
      4.8,
    );
    this.applyUnderwaterOrientation(dolphin, delta, 0.16, 0.17);
  }

  private initialize(dolphin: Dolphin, index: number, physics: VesselPhysics): void {
    dolphin.root.position
      .copy(physics.position)
      .addScaledVector(physics.right, dolphin.side * (10 + index * 2.6))
      .addScaledVector(physics.forward, 4 - index * 2.2);
    dolphin.root.position.y = this.ocean.sample(dolphin.root.position.x, dolphin.root.position.z).height - 0.72;
    dolphin.motion.heading = physics.heading + dolphin.side * (0.1 + index * 0.035);
    dolphin.motion.yawRate = 0;
    dolphin.motion.verticalSpeed = 0;
    dolphin.motion.velocityX = Math.sin(dolphin.motion.heading) * dolphin.motion.speed;
    dolphin.motion.velocityZ = Math.cos(dolphin.motion.heading) * dolphin.motion.speed;
    dolphin.root.rotation.set(0, dolphin.motion.heading, 0, "YXZ");
    dolphin.initialized = true;
    this.chooseWaypoint(dolphin, index, physics);
  }

  private chooseWaypoint(dolphin: Dolphin, index: number, physics: VesselPhysics): void {
    this.target
      .copy(physics.position)
      .addScaledVector(physics.forward, 24 + index * 4.5)
      .addScaledVector(physics.right, dolphin.side * (10 + index * 2.8));
    const formationHeading = headingTo(dolphin.root.position, this.target);
    const gentleCorrection = forwardBiasedHeading(dolphin.motion.heading, formationHeading, 0.38);
    const wander = Math.sin(dolphin.phase + dolphin.stateElapsed * 0.18) * 0.07 + (Math.random() - 0.5) * 0.12;
    const course = gentleCorrection + wander;
    const distance = 38 + Math.random() * 18;
    dolphin.target.set(
      dolphin.root.position.x + Math.sin(course) * distance,
      0,
      dolphin.root.position.z + Math.cos(course) * distance,
    );
    dolphin.target.y = this.ocean.sample(dolphin.target.x, dolphin.target.z).height - 0.72;
    dolphin.waypointAge = 0;
    dolphin.waypointDuration = 7.5 + Math.random() * 3.5;
  }

  private steeredHeading(
    dolphin: Dolphin,
    requestedHeading: number,
    physics: VesselPhysics,
  ): number {
    this.steering.set(Math.sin(requestedHeading), 0, Math.cos(requestedHeading));
    const distanceToVessel = dolphin.root.position.distanceTo(physics.position);
    if (distanceToVessel < 10) {
      this.avoidance.copy(dolphin.root.position).sub(physics.position).setY(0);
      const length = this.avoidance.length();
      if (length > 0.001) {
        const weight = ((10 - distanceToVessel) / 10) * 1.5;
        this.steering.addScaledVector(this.avoidance.multiplyScalar(1 / length), weight);
      }
    }

    this.separation.set(0, 0, 0);
    this.dolphins.forEach((other) => {
      if (other === dolphin || !other.initialized) return;
      const distanceSquared = dolphin.root.position.distanceToSquared(other.root.position);
      if (distanceSquared <= 0.001 || distanceSquared >= 5.5 * 5.5) return;
      this.avoidance.copy(dolphin.root.position).sub(other.root.position).setY(0);
      const distance = Math.sqrt(distanceSquared);
      this.separation.addScaledVector(this.avoidance, (5.5 - distance) / (5.5 * distance));
    });
    this.steering.addScaledVector(this.separation, 1.15);
    if (this.steering.lengthSq() < 0.0001) return dolphin.motion.heading;
    this.steering.normalize();
    return Math.atan2(this.steering.x, this.steering.z);
  }

  private canApproachForBreach(dolphin: Dolphin, physics: VesselPhysics): boolean {
    const distance = dolphin.root.position.distanceTo(physics.position);
    if (distance < 6 || distance > 34) return false;
    return Math.cos(shortestAngleDifference(dolphin.motion.heading, physics.heading)) > 0.72;
  }

  private updateApproach(dolphin: Dolphin, delta: number, physics: VesselPhysics): void {
    this.target
      .copy(physics.position)
      .addScaledVector(physics.right, dolphin.side * 4.3)
      .addScaledVector(physics.forward, 7.5);
    this.target.y = this.ocean.sample(this.target.x, this.target.z).height - 0.2;
    const desiredHeading = this.steeredHeading(
      dolphin,
      headingTo(dolphin.root.position, this.target),
      physics,
    );
    stepSwimmerKinematics(dolphin.motion, desiredHeading, 8.4, delta, DOLPHIN_LIMITS);
    this.advance(dolphin, delta);
    dolphin.root.position.y = stepVerticalMotion(
      dolphin.root.position.y,
      dolphin.motion,
      this.target.y,
      delta,
      8.5,
      5.4,
      6,
    );
    this.applyUnderwaterOrientation(dolphin, delta, 0.18, 0.17);
  }

  private beginJump(dolphin: Dolphin): void {
    dolphin.jumpOrigin.copy(dolphin.root.position);
    dolphin.jumpDirection.set(Math.sin(dolphin.motion.heading), 0, Math.cos(dolphin.motion.heading));
    dolphin.jumpHeading = dolphin.motion.heading;
    dolphin.jumpSpeed = clamp(dolphin.motion.speed, 7.2, 8.8);
    dolphin.jumpElapsed = 0;
    dolphin.splashTriggered = false;
    dolphin.motion.verticalSpeed = GRAVITY * (
      DOLPHIN_STATE_DURATION.breach_ascent +
      DOLPHIN_STATE_DURATION.airborne +
      DOLPHIN_STATE_DURATION.reentry
    ) * 0.5;
    this.transition(dolphin, "breach_ascent");
  }

  private updateJump(dolphin: Dolphin, delta: number): void {
    dolphin.jumpElapsed += delta;
    const totalDuration =
      DOLPHIN_STATE_DURATION.breach_ascent + DOLPHIN_STATE_DURATION.airborne + DOLPHIN_STATE_DURATION.reentry;
    const t = clamp(dolphin.jumpElapsed / totalDuration, 0, 1);
    const travel = dolphin.jumpSpeed * totalDuration;
    this.jumpPosition.copy(dolphin.jumpOrigin).addScaledVector(dolphin.jumpDirection, travel * t);
    const waterHeight = this.ocean.sample(this.jumpPosition.x, this.jumpPosition.z).height;
    const arcHeight = 0.5 * GRAVITY * totalDuration * totalDuration * t * (1 - t);
    const verticalSpeed = GRAVITY * totalDuration * (0.5 - t);
    this.jumpPosition.y = waterHeight + arcHeight - 0.14;
    dolphin.root.position.copy(this.jumpPosition);
    dolphin.motion.verticalSpeed = verticalSpeed;
    dolphin.motion.velocityX = dolphin.jumpDirection.x * dolphin.jumpSpeed;
    dolphin.motion.velocityZ = dolphin.jumpDirection.z * dolphin.jumpSpeed;
    dolphin.root.rotation.y = dolphin.jumpHeading;
    dolphin.root.rotation.x = damp(
      dolphin.root.rotation.x,
      swimmerPitch(verticalSpeed, dolphin.jumpSpeed, 0.72),
      9,
      delta,
    );
    dolphin.root.rotation.z = damp(dolphin.root.rotation.z, 0, 6, delta);
  }

  private updateDive(dolphin: Dolphin, delta: number, depth: number): void {
    stepSwimmerKinematics(dolphin.motion, dolphin.jumpHeading, 6.4, delta, DOLPHIN_LIMITS);
    this.advance(dolphin, delta);
    const targetDepth = this.ocean.sample(dolphin.root.position.x, dolphin.root.position.z).height - depth;
    dolphin.root.position.y = stepVerticalMotion(
      dolphin.root.position.y,
      dolphin.motion,
      targetDepth,
      delta,
      9,
      4.2,
      8.5,
    );
    this.applyUnderwaterOrientation(dolphin, delta, 0.38, 0.08);
  }

  private applyUnderwaterOrientation(
    dolphin: Dolphin,
    delta: number,
    pitchLimit: number,
    bankLimit: number,
  ): void {
    dolphin.root.rotation.y = dolphin.motion.heading;
    dolphin.root.rotation.x = damp(
      dolphin.root.rotation.x,
      swimmerPitch(dolphin.motion.verticalSpeed, dolphin.motion.speed, pitchLimit),
      4.8,
      delta,
    );
    dolphin.root.rotation.z = damp(
      dolphin.root.rotation.z,
      swimmerBank(dolphin.motion.yawRate, dolphin.motion.speed, bankLimit),
      4.2,
      delta,
    );
  }

  private transition(dolphin: Dolphin, state: DolphinState): void {
    dolphin.state = state;
    dolphin.stateElapsed = 0;
    if (state === "splash") dolphin.motion.verticalSpeed = Math.min(dolphin.motion.verticalSpeed, -3.2);
    if (state === "swim") dolphin.waypointAge = Number.POSITIVE_INFINITY;
  }

  private advance(dolphin: Dolphin, delta: number): void {
    dolphin.root.position.x += dolphin.motion.velocityX * delta;
    dolphin.root.position.z += dolphin.motion.velocityZ * delta;
  }
}
