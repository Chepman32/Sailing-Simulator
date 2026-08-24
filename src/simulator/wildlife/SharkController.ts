import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import {
  createAnimatedVisual,
  headingTo,
  moveAngle,
  setRandomAnimationTime,
  type AnimatedVisual,
} from "./WildlifeModel";

type Shark = {
  root: THREE.Group;
  visual: AnimatedVisual;
  position: THREE.Vector3;
  target: THREE.Vector3;
  heading: number;
  speed: number;
  age: number;
  waypointAge: number;
  waypointDuration: number;
  initialized: boolean;
  depthPhase: number;
};

export class SharkController {
  private readonly shark?: Shark;
  private readonly avoidance = new THREE.Vector3();

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
      [/swimming/i, /shark/i, /swim/i],
    );
    setRandomAnimationTime(visual, 0.95);
    visual.model.name = "Rigged_Shark";
    const root = new THREE.Group();
    root.name = "Shark_Cruise_Root";
    root.rotation.order = "YXZ";
    root.add(visual.model);
    group.add(root);
    this.shark = {
      root,
      visual,
      position: root.position,
      target: new THREE.Vector3(),
      heading: 0,
      speed: 2.5,
      age: 0,
      waypointAge: 0,
      waypointDuration: 12,
      initialized: false,
      depthPhase: Math.random() * Math.PI * 2,
    };
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    const shark = this.shark;
    if (!shark) return;
    shark.age += delta;
    shark.waypointAge += delta;
    if (animationDelta > 0) shark.visual.mixer?.update(animationDelta * (0.82 + shark.speed * 0.11));

    if (!shark.initialized) this.initialize(shark, physics);
    if (shark.position.distanceToSquared(physics.position) > 160 * 160) {
      shark.initialized = false;
      this.initialize(shark, physics);
    }
    const targetDistance = shark.position.distanceTo(shark.target);
    if (targetDistance < 4.5 || shark.waypointAge >= shark.waypointDuration) {
      this.chooseWaypoint(shark, physics);
    }

    let desiredHeading = headingTo(shark.position, shark.target);
    const distanceToVessel = shark.position.distanceTo(physics.position);
    if (distanceToVessel < 10) {
      this.avoidance.copy(shark.position).sub(physics.position);
      const avoidHeading = Math.atan2(this.avoidance.x, this.avoidance.z);
      const influence = THREE.MathUtils.clamp((10 - distanceToVessel) / 5, 0, 1);
      const difference = Math.atan2(Math.sin(avoidHeading - desiredHeading), Math.cos(avoidHeading - desiredHeading));
      desiredHeading += difference * influence;
      shark.speed = THREE.MathUtils.damp(shark.speed, 3.6, 2.2, delta);
    } else {
      shark.speed = THREE.MathUtils.damp(shark.speed, 2.55, 0.8, delta);
    }

    const previousHeading = shark.heading;
    shark.heading = moveAngle(shark.heading, desiredHeading, delta * 0.48);
    shark.position.x += Math.sin(shark.heading) * shark.speed * delta;
    shark.position.z += Math.cos(shark.heading) * shark.speed * delta;
    const surface = this.ocean.sample(shark.position.x, shark.position.z).height;
    const targetDepth = surface - 1.45 + Math.sin(shark.age * 0.45 + shark.depthPhase) * 0.22;
    shark.position.y = THREE.MathUtils.damp(shark.position.y, targetDepth, 1.7, delta);

    const turn = Math.atan2(Math.sin(shark.heading - previousHeading), Math.cos(shark.heading - previousHeading));
    shark.root.rotation.y = shark.heading;
    shark.root.rotation.x = THREE.MathUtils.damp(shark.root.rotation.x, 0, 2.5, delta);
    shark.root.rotation.z = THREE.MathUtils.damp(shark.root.rotation.z, -turn * 7.2, 3.1, delta);
  }

  dispose(): void {
    if (!this.shark) return;
    this.shark.visual.mixer?.stopAllAction();
    this.group.remove(this.shark.root);
  }

  private initialize(shark: Shark, physics: VesselPhysics): void {
    const angle = 0.35 + Math.random() * Math.PI * 2;
    const radius = 34 + Math.random() * 12;
    shark.position
      .copy(physics.position)
      .add(new THREE.Vector3(Math.sin(angle) * radius, -1.5, Math.cos(angle) * radius));
    shark.heading = angle + Math.PI + (Math.random() - 0.5) * 0.5;
    shark.root.rotation.y = shark.heading;
    shark.initialized = true;
    this.chooseWaypoint(shark, physics);
  }

  private chooseWaypoint(shark: Shark, physics: VesselPhysics): void {
    const vesselDistance = shark.position.distanceTo(physics.position);
    const baseAngle = vesselDistance < 58
      ? Math.atan2(shark.position.x - physics.position.x, shark.position.z - physics.position.z) + Math.PI
      : shark.heading;
    const angle = baseAngle + (Math.random() - 0.5) * 1.15;
    const radius = 14 + Math.random() * 20;
    shark.target
      .copy(physics.position)
      .add(new THREE.Vector3(Math.sin(angle) * radius, -1.5, Math.cos(angle) * radius));
    shark.waypointAge = 0;
    shark.waypointDuration = 10 + Math.random() * 8;
  }
}
