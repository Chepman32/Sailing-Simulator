import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import type { OceanSystem } from "../environment/OceanSystem";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import { DolphinController } from "./DolphinController";
import { GullFlockController } from "./GullFlockController";
import { ReefFishController } from "./ReefFishController";
import { SharkController } from "./SharkController";
import { WhaleController } from "./WhaleController";

export class WildlifeSystem {
  private readonly group = new THREE.Group();
  private readonly marineGroup = new THREE.Group();
  private readonly dolphins: DolphinController;
  private readonly sharks: SharkController;
  private readonly whales: WhaleController;
  private readonly fish: ReefFishController;
  private readonly gulls: GullFlockController;
  private readonly predators: THREE.Vector3[] = [];
  private animationAccumulator = 0;

  constructor(
    private readonly scene: THREE.Scene,
    ocean: OceanSystem,
    assets: AssetManager,
    count: number,
    fishDensity: number,
    underwater: UnderwaterLight,
    onSplash: (position: THREE.Vector3, intensity: number) => void,
  ) {
    this.group.name = "External_GLTF_Wildlife_System";
    this.marineGroup.name = "Marine_Wildlife";
    this.group.add(this.marineGroup);
    scene.add(this.group);
    this.dolphins = new DolphinController(this.marineGroup, ocean, assets, count, onSplash);
    this.sharks = new SharkController(this.marineGroup, ocean, assets);
    this.whales = new WhaleController(this.marineGroup, ocean, assets, onSplash);
    // Everything that swims is seen through water; the reef fish apply the
    // same treatment to their own instanced material.
    const treated = new Set<THREE.Material>();
    this.marineGroup.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (treated.has(material)) return;
        treated.add(material);
        underwater.apply(material);
      });
    });
    this.fish = new ReefFishController(this.marineGroup, ocean, assets, underwater, fishDensity);
    this.gulls = new GullFlockController(this.group, assets, count);
  }

  update(delta: number, physics: VesselPhysics, camera: THREE.Camera): void {
    this.animationAccumulator = Math.min(0.12, this.animationAccumulator + delta);
    const animationDelta = this.animationAccumulator >= 1 / 30 ? this.animationAccumulator : 0;
    if (animationDelta > 0) this.animationAccumulator = 0;
    this.dolphins.update(delta, physics, animationDelta);
    this.sharks.update(delta, physics, animationDelta);
    this.whales.update(delta, physics, animationDelta);
    this.predators.length = 0;
    this.dolphins.collectPositions(this.predators);
    this.sharks.collectPositions(this.predators);
    this.fish.update(delta, physics, camera, this.predators);
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
