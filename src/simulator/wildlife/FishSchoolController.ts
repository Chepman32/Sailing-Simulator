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

type FishSchool = {
  root: THREE.Group;
  visual: AnimatedVisual;
  target: THREE.Vector3;
  heading: number;
  speed: number;
  age: number;
  waypointAge: number;
  waypointDuration: number;
  initialized: boolean;
  phase: number;
};

export class FishSchoolController {
  private readonly schools: FishSchool[] = [];
  private readonly away = new THREE.Vector3();

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    assets: AssetManager,
    count: number,
  ) {
    const schoolCount = THREE.MathUtils.clamp(count, 1, 2);
    for (let index = 0; index < schoolCount; index += 1) {
      const asset = assets.animated("fishSchool");
      if (!asset) break;
      const visual = createAnimatedVisual(
        asset,
        { targetSize: 1.1, measureAxis: "longest", castShadow: false },
        [/^animation$/i, /swim/i],
      );
      setRandomAnimationTime(visual, 0.72 + index * 0.08);
      visual.model.name = `Rigged_Tropical_Fish_School_${index + 1}`;
      const root = new THREE.Group();
      root.name = `Fish_School_Root_${index + 1}`;
      root.rotation.order = "YXZ";
      root.add(visual.model);
      group.add(root);
      this.schools.push({
        root,
        visual,
        target: new THREE.Vector3(),
        heading: index * Math.PI,
        speed: 0.85 + index * 0.18,
        age: 0,
        waypointAge: 0,
        waypointDuration: 12,
        initialized: false,
        phase: index * 2.7 + Math.random() * 1.5,
      });
    }
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    this.schools.forEach((school, index) => {
      school.age += delta;
      school.waypointAge += delta;
      if (animationDelta > 0) school.visual.mixer?.update(animationDelta * (0.72 + school.speed * 0.18));
      if (!school.initialized) this.initialize(school, physics, index);
      if (school.root.position.distanceToSquared(physics.position) > 110 * 110) {
        school.initialized = false;
        this.initialize(school, physics, index);
      }
      if (school.root.position.distanceTo(school.target) < 3 || school.waypointAge >= school.waypointDuration) {
        this.chooseWaypoint(school, physics, index);
      }

      let desiredHeading = headingTo(school.root.position, school.target);
      const vesselDistance = school.root.position.distanceTo(physics.position);
      if (vesselDistance < 9) {
        this.away.copy(school.root.position).sub(physics.position);
        desiredHeading = Math.atan2(this.away.x, this.away.z);
        school.speed = THREE.MathUtils.damp(school.speed, 2.3, 3, delta);
      } else {
        school.speed = THREE.MathUtils.damp(school.speed, 0.9 + index * 0.12, 0.65, delta);
      }

      const previousHeading = school.heading;
      school.heading = moveAngle(school.heading, desiredHeading, delta * 0.52);
      school.root.position.x += Math.sin(school.heading) * school.speed * delta;
      school.root.position.z += Math.cos(school.heading) * school.speed * delta;
      const surface = this.ocean.sample(school.root.position.x, school.root.position.z).height;
      const targetDepth = surface - 1.75 + Math.sin(school.age * 0.42 + school.phase) * 0.38;
      school.root.position.y = THREE.MathUtils.damp(school.root.position.y, targetDepth, 1.4, delta);
      const turn = Math.atan2(Math.sin(school.heading - previousHeading), Math.cos(school.heading - previousHeading));
      school.root.rotation.y = school.heading;
      school.root.rotation.x = Math.sin(school.age * 0.35 + school.phase) * 0.035;
      school.root.rotation.z = THREE.MathUtils.damp(school.root.rotation.z, -turn * 6.2, 2.4, delta);
    });
  }

  dispose(): void {
    this.schools.forEach((school) => {
      school.visual.mixer?.stopAllAction();
      this.group.remove(school.root);
    });
    this.schools.length = 0;
  }

  private initialize(school: FishSchool, physics: VesselPhysics, index: number): void {
    const angle = 0.8 + index * Math.PI * 1.2 + Math.random() * 0.8;
    const radius = 20 + index * 8 + Math.random() * 8;
    school.root.position
      .copy(physics.position)
      .add(new THREE.Vector3(Math.sin(angle) * radius, -1.8, Math.cos(angle) * radius));
    school.heading = angle + Math.PI * 0.5;
    school.root.rotation.y = school.heading;
    school.initialized = true;
    this.chooseWaypoint(school, physics, index);
  }

  private chooseWaypoint(school: FishSchool, physics: VesselPhysics, index: number): void {
    const bearing = school.heading + (Math.random() - 0.5) * 1.25;
    const distance = 14 + Math.random() * 17;
    school.target
      .copy(school.root.position)
      .add(new THREE.Vector3(Math.sin(bearing) * distance, 0, Math.cos(bearing) * distance));
    if (school.target.distanceTo(physics.position) > 65) {
      const angle = index * Math.PI + Math.random() * 1.8;
      school.target
        .copy(physics.position)
        .add(new THREE.Vector3(Math.sin(angle) * 28, -1.8, Math.cos(angle) * 28));
    }
    school.waypointAge = 0;
    school.waypointDuration = 11 + Math.random() * 8;
  }
}
