import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import { WHALE_PHASE_DURATION, nextWhalePhase, type WhalePhase } from "./WildlifeState";
import {
  createAnimatedVisual,
  headingTo,
  moveAngle,
  setRandomAnimationTime,
  type AnimatedVisual,
} from "./WildlifeModel";

type Whale = {
  root: THREE.Group;
  visual: AnimatedVisual;
  position: THREE.Vector3;
  target: THREE.Vector3;
  heading: number;
  speed: number;
  age: number;
  phase: WhalePhase;
  phaseElapsed: number;
  waypointAge: number;
  waypointDuration: number;
  initialized: boolean;
  surfacedSplash: boolean;
};

export class WhaleController {
  private readonly whale?: Whale;

  constructor(
    private readonly group: THREE.Group,
    private readonly ocean: OceanSystem,
    assets: AssetManager,
    private readonly onSplash: (position: THREE.Vector3, intensity: number) => void,
  ) {
    const asset = assets.animated("whale");
    if (!asset) return;
    const visual = createAnimatedVisual(
      asset,
      { targetSize: 18, measureAxis: "z", castShadow: false },
      [/^swimming$/i, /swim/i],
    );
    setRandomAnimationTime(visual, 0.78);
    visual.model.name = "Rigged_Blue_Whale";
    const root = new THREE.Group();
    root.name = "Whale_State_Root";
    root.rotation.order = "YXZ";
    root.add(visual.model);
    group.add(root);
    this.whale = {
      root,
      visual,
      position: root.position,
      target: new THREE.Vector3(),
      heading: 0,
      speed: 2.05,
      age: 0,
      phase: "cruise",
      phaseElapsed: Math.random() * 8,
      waypointAge: 0,
      waypointDuration: 20,
      initialized: false,
      surfacedSplash: false,
    };
  }

  update(delta: number, physics: VesselPhysics, animationDelta = delta): void {
    const whale = this.whale;
    if (!whale) return;
    whale.age += delta;
    whale.phaseElapsed += delta;
    whale.waypointAge += delta;
    if (animationDelta > 0) whale.visual.mixer?.update(animationDelta * 0.82);

    if (!whale.initialized) this.initialize(whale, physics);
    if (whale.position.distanceToSquared(physics.position) > 260 * 260) {
      whale.initialized = false;
      this.initialize(whale, physics);
    }
    if (whale.phaseElapsed >= WHALE_PHASE_DURATION[whale.phase]) this.transition(whale, nextWhalePhase(whale.phase));
    if (whale.position.distanceTo(whale.target) < 8 || whale.waypointAge >= whale.waypointDuration) {
      this.chooseWaypoint(whale, physics);
    }

    const desiredHeading = headingTo(whale.position, whale.target);
    const previousHeading = whale.heading;
    whale.heading = moveAngle(whale.heading, desiredHeading, delta * 0.14);
    whale.position.x += Math.sin(whale.heading) * whale.speed * delta;
    whale.position.z += Math.cos(whale.heading) * whale.speed * delta;
    const surface = this.ocean.sample(whale.position.x, whale.position.z).height;
    const targetY = surface + this.phaseDepth(whale);
    whale.position.y = THREE.MathUtils.damp(whale.position.y, targetY, 0.75, delta);

    if (whale.phase === "surface" && !whale.surfacedSplash && whale.position.y > surface - 1.65) {
      whale.surfacedSplash = true;
      this.onSplash(whale.position, 0.52);
    }
    const turn = Math.atan2(Math.sin(whale.heading - previousHeading), Math.cos(whale.heading - previousHeading));
    whale.root.rotation.y = whale.heading;
    whale.root.rotation.x = THREE.MathUtils.damp(
      whale.root.rotation.x,
      whale.phase === "dive" ? 0.1 : whale.phase === "surface" ? -0.035 : 0,
      1.2,
      delta,
    );
    whale.root.rotation.z = THREE.MathUtils.damp(whale.root.rotation.z, -turn * 8, 1.4, delta);
  }

  dispose(): void {
    if (!this.whale) return;
    this.whale.visual.mixer?.stopAllAction();
    this.group.remove(this.whale.root);
  }

  private initialize(whale: Whale, physics: VesselPhysics): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = 70 + Math.random() * 22;
    whale.position
      .copy(physics.position)
      .add(new THREE.Vector3(Math.sin(angle) * radius, -4.5, Math.cos(angle) * radius));
    whale.heading = angle + Math.PI * 0.5;
    whale.root.rotation.y = whale.heading;
    whale.initialized = true;
    this.chooseWaypoint(whale, physics);
  }

  private chooseWaypoint(whale: Whale, physics: VesselPhysics): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = 58 + Math.random() * 38;
    whale.target
      .copy(physics.position)
      .add(new THREE.Vector3(Math.sin(angle) * radius, -3.5, Math.cos(angle) * radius));
    whale.waypointAge = 0;
    whale.waypointDuration = 24 + Math.random() * 16;
  }

  private phaseDepth(whale: Whale): number {
    const progress = THREE.MathUtils.clamp(whale.phaseElapsed / WHALE_PHASE_DURATION[whale.phase], 0, 1);
    const smooth = progress * progress * (3 - 2 * progress);
    if (whale.phase === "surface") return THREE.MathUtils.lerp(-3.6, -1.05, smooth);
    if (whale.phase === "dive") return THREE.MathUtils.lerp(-1.05, -4.8, smooth);
    return -3.6 + Math.sin(whale.age * 0.22) * 0.32;
  }

  private transition(whale: Whale, phase: WhalePhase): void {
    whale.phase = phase;
    whale.phaseElapsed = 0;
    if (phase === "surface") whale.surfacedSplash = false;
  }
}
