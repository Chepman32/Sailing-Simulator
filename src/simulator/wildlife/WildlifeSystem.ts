import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import { DolphinController } from "./DolphinController";
import { FishSchoolController } from "./FishSchoolController";
import { GullFlockController } from "./GullFlockController";
import { SharkController } from "./SharkController";
import { WhaleController } from "./WhaleController";

export class WildlifeSystem {
  private readonly group = new THREE.Group();
  private readonly dolphins: DolphinController;
  private readonly sharks: SharkController;
  private readonly whales: WhaleController;
  private readonly fish: FishSchoolController;
  private readonly gulls: GullFlockController;
  private animationAccumulator = 0;

  constructor(
    private readonly scene: THREE.Scene,
    ocean: OceanSystem,
    assets: AssetManager,
    count: number,
    onSplash: (position: THREE.Vector3, intensity: number) => void,
  ) {
    this.group.name = "External_GLTF_Wildlife_System";
    scene.add(this.group);
    this.dolphins = new DolphinController(this.group, ocean, assets, count, onSplash);
    this.sharks = new SharkController(this.group, ocean, assets);
    this.whales = new WhaleController(this.group, ocean, assets, onSplash);
    this.fish = new FishSchoolController(this.group, ocean, assets, count);
    this.gulls = new GullFlockController(this.group, assets, count);
  }

  update(delta: number, physics: VesselPhysics): void {
    this.animationAccumulator = Math.min(0.12, this.animationAccumulator + delta);
    const animationDelta = this.animationAccumulator >= 1 / 30 ? this.animationAccumulator : 0;
    if (animationDelta > 0) this.animationAccumulator = 0;
    this.dolphins.update(delta, physics, animationDelta);
    this.sharks.update(delta, physics, animationDelta);
    this.whales.update(delta, physics, animationDelta);
    this.fish.update(delta, physics, animationDelta);
    this.gulls.update(delta, physics, animationDelta);
  }

  dispose(): void {
    this.dolphins.dispose();
    this.sharks.dispose();
    this.whales.dispose();
    this.fish.dispose();
    this.gulls.dispose();
    this.scene.remove(this.group);
  }
}
