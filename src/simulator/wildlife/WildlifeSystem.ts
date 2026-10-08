import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { waterDepthAt } from "../environment/IslandMath";
import type { OceanSystem } from "../environment/OceanSystem";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import type { DolphinObstacle } from "./DolphinBehavior";
import { DolphinController } from "./DolphinController";
import { GullFlockController } from "./GullFlockController";
import { ReefFishController } from "./ReefFishController";
import { SharkController } from "./SharkController";
import type { MarineWorld, VesselState, WaterEffects } from "./WaterContact";
import { WhaleController } from "./WhaleController";

export type WildlifeCounts = {
  dolphins: number;
  gulls: number;
  fishDensity: number;
};

/**
 * Owns every animal and the shared view of the world they live in: the
 * rendered wave surface, the bathymetry, the yacht and each other. Larger
 * animals are stepped first so smaller ones can keep clear of them.
 */
export class WildlifeSystem {
  private readonly group = new THREE.Group();
  private readonly marineGroup = new THREE.Group();
  private readonly dolphins: DolphinController;
  private readonly sharks: SharkController;
  private readonly whales: WhaleController;
  private readonly fish: ReefFishController;
  private readonly gulls: GullFlockController;
  private readonly predators: THREE.Vector3[] = [];
  private readonly vessel: VesselState = { x: 0, z: 0, heading: 0, speed: 0 };
  private readonly dolphinObstacles: DolphinObstacle[] = [];
  private readonly sharkObstacles: { x: number; z: number; radius: number }[] = [];
  private readonly world: MarineWorld;
  private gullClock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    ocean: OceanSystem,
    assets: AssetManager,
    counts: WildlifeCounts,
    underwater: UnderwaterLight,
    effects: WaterEffects,
  ) {
    this.group.name = "External_GLTF_Wildlife_System";
    this.marineGroup.name = "Marine_Wildlife";
    this.group.add(this.marineGroup);
    scene.add(this.group);
    this.world = {
      surfaceHeight: (x, z) => ocean.sample(x, z).height,
      orbitalHeight: (x, z, depth) => ocean.sample(x, z, depth).height,
      seabedDepth: waterDepthAt,
    };
    this.whales = new WhaleController(this.marineGroup, ocean, this.world, assets, effects);
    this.sharks = new SharkController(this.marineGroup, ocean, this.world, assets, effects);
    this.dolphins = new DolphinController(this.marineGroup, ocean, this.world, assets, counts.dolphins, effects);
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
    this.fish = new ReefFishController(this.marineGroup, ocean, assets, underwater, counts.fishDensity);
    this.gulls = new GullFlockController(this.group, assets, counts.gulls);
  }

  update(delta: number, physics: VesselPhysics, camera: THREE.Camera): void {
    const vessel = this.vessel;
    vessel.x = physics.position.x;
    vessel.z = physics.position.z;
    vessel.heading = physics.heading;
    vessel.speed = Math.max(0, physics.telemetry.forwardSpeed);

    this.whales.update(delta, vessel, camera);
    const whale = this.whales.obstacle();
    this.sharkObstacles.length = 0;
    if (whale) this.sharkObstacles.push({ x: whale.position.x, z: whale.position.z, radius: whale.radius });
    this.sharks.update(delta, vessel, this.sharkObstacles, camera);

    this.dolphinObstacles.length = 0;
    if (whale) {
      this.dolphinObstacles.push({ x: whale.position.x, y: whale.position.y, z: whale.position.z, radius: whale.radius });
    }
    const shark = this.sharks.obstacle();
    if (shark) {
      this.dolphinObstacles.push({ x: shark.position.x, y: shark.position.y, z: shark.position.z, radius: shark.radius });
    }
    this.dolphins.update(delta, vessel, this.dolphinObstacles, camera);

    this.predators.length = 0;
    this.dolphins.collectPositions(this.predators);
    this.sharks.collectPositions(this.predators);
    this.fish.update(delta, physics, camera, this.predators);

    // Gull clips are sampled at about 30 Hz; their flight is integrated every frame.
    this.gullClock = Math.min(0.12, this.gullClock + delta);
    const gullAnimation = this.gullClock >= 1 / 30 ? this.gullClock : 0;
    if (gullAnimation > 0) this.gullClock = 0;
    this.gulls.update(delta, physics, gullAnimation);
  }

  /** Current whale phase, for diagnostics. */
  get whalePhase(): string | undefined {
    return this.whales.phase;
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
