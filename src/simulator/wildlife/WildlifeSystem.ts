import * as THREE from "three";
import type { AssetManager } from "../core/AssetManager";
import { distanceFromWaterline, waterDepthAt } from "../environment/IslandMath";
import type { OceanSystem } from "../environment/OceanSystem";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import type { VesselPhysics } from "../vessel/VesselPhysics";
import type { DolphinObstacle } from "./DolphinBehavior";
import { DolphinController } from "./DolphinController";
import { GullFlockController } from "./GullFlockController";
import { ReefFishController } from "./ReefFishController";
import { SharkController } from "./SharkController";
import type { MarineWorld, VesselState, WaterEffects } from "./WaterContact";
import { WhaleBreachController } from "./WhaleBreachController";
import { WhaleController } from "./WhaleController";
import type { PhotoSubject } from "../camera/PhotoDirector";

export type WildlifeCounts = {
  dolphins: number;
  /** Sharks, each patrolling on its own (default 1). */
  sharks?: number;
  gulls: number;
  fishDensity: number;
};

/**
 * Owns every animal and the shared view of the world they live in: the
 * rendered wave surface, the bathymetry, the yacht and each other. Larger
 * animals are stepped first so smaller ones can keep clear of them.
 */
export class WildlifeSystem {
  readonly group = new THREE.Group();
  private readonly marineGroup = new THREE.Group();
  private readonly dolphins: DolphinController;
  private readonly sharks: SharkController[];
  private readonly whales: WhaleController;
  private readonly breach: WhaleBreachController;
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
      shoreDistance: distanceFromWaterline,
    };
    this.whales = new WhaleController(this.marineGroup, ocean, this.world, assets, effects);
    this.sharks = Array.from({ length: Math.max(1, counts.sharks ?? 1) }, () => new SharkController(this.marineGroup, ocean, this.world, assets, effects));
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
    // The distant breacher flies through the air, so it lives outside the
    // underwater group (it shows in the water's mirror); it is still seen
    // through the water whenever it is below the surface.
    this.breach = new WhaleBreachController(this.group, ocean, this.world, assets, effects);
    this.breach.materials.forEach((material) => underwater.apply(material));
    this.fish = new ReefFishController(this.marineGroup, ocean, assets, underwater, counts.fishDensity);
    // Gulls rest head to wind; the trade wind's mean direction is enough for that.
    const windLength = Math.hypot(6.8, 4.2);
    this.gulls = new GullFlockController(
      this.group,
      assets,
      counts.gulls,
      { surfaceHeight: (x, z) => ocean.sample(x, z).height, windX: 6.8 / windLength, windZ: 4.2 / windLength },
      { splash: (position, intensity, kind, velocity) => effects.splash(position, intensity, kind, velocity), ripple: (position, strength) => effects.ripple(position, strength) },
    );
  }

  /** Everything that lives under the surface (left out of the water's mirror). */
  get underwater(): THREE.Object3D {
    return this.marineGroup;
  }

  update(delta: number, physics: VesselPhysics, camera: THREE.Camera): void {
    const vessel = this.vessel;
    vessel.x = physics.position.x;
    vessel.z = physics.position.z;
    vessel.heading = physics.heading;
    vessel.speed = Math.max(0, physics.telemetry.forwardSpeed);

    this.whales.update(delta, vessel, camera);
    this.breach.update(delta, vessel, camera);
    const whale = this.whales.obstacle();
    this.sharkObstacles.length = 0;
    if (whale) this.sharkObstacles.push({ x: whale.position.x, z: whale.position.z, radius: whale.radius });
    // Each shark gives way to the whale and to the sharks updated before it.
    for (const shark of this.sharks) {
      shark.update(delta, vessel, this.sharkObstacles, camera);
      const body = shark.obstacle();
      if (body) this.sharkObstacles.push({ x: body.position.x, z: body.position.z, radius: body.radius * 2 });
    }

    this.dolphinObstacles.length = 0;
    if (whale) {
      this.dolphinObstacles.push({ x: whale.position.x, y: whale.position.y, z: whale.position.z, radius: whale.radius });
    }
    for (const controller of this.sharks) {
      const shark = controller.obstacle();
      if (shark) this.dolphinObstacles.push({ x: shark.position.x, y: shark.position.y, z: shark.position.z, radius: shark.radius });
    }
    this.dolphins.update(delta, vessel, this.dolphinObstacles, camera);

    this.predators.length = 0;
    this.dolphins.collectPositions(this.predators);
    for (const shark of this.sharks) shark.collectPositions(this.predators);
    this.fish.update(delta, physics, camera, this.predators);

    // Gull clips are sampled at about 30 Hz; their flight is integrated every frame.
    this.gullClock = Math.min(0.12, this.gullClock + delta);
    const gullAnimation = this.gullClock >= 1 / 30 ? this.gullClock : 0;
    if (gullAnimation > 0) this.gullClock = 0;
    this.gulls.update(delta, physics, gullAnimation);
  }

  /** Calls given by gulls disturbed on the water or taking off, since the last call. */
  consumeGullCalls(): { position: THREE.Vector3; variant: number }[] {
    return this.gulls.calls.splice(0);
  }

  /** Direction toward the dominant light, for the sun through the gulls' wings. */
  setLightDirection(direction: THREE.Vector3): void {
    this.gulls.setLightDirection(direction);
  }

  /** Where each gull is flying, for their calls. */
  get gullPositions(): readonly THREE.Vector3[] {
    return this.gulls.positions;
  }

  /**
   * What is worth a picture right now (photo mode, see `PhotoDirector`): a
   * breach, a whale at the surface, leaping dolphins, a shark's fin.
   */
  collectPhotoSubjects(out: PhotoSubject[]): PhotoSubject[] {
    out.length = 0;
    const breach = this.breach.breaching;
    if (breach) out.push({ kind: "breach", x: breach.x, y: Math.max(0, breach.y), z: breach.z, size: 34 });
    const whale = this.whales.obstacle();
    const phase = this.whales.phase;
    if (whale && (phase === "surface" || phase === "prepare_tail_slap" || phase === "tail_slap")) {
      out.push({ kind: "whale", x: whale.position.x, y: 0, z: whale.position.z, size: 26 });
    }
    for (const controller of this.sharks) {
      const shark = controller.obstacle();
      if (shark && controller.state?.phase === "fin_show") {
        out.push({ kind: "shark", x: shark.position.x, y: 0, z: shark.position.z, size: 9 });
        break;
      }
    }
    let leaping = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const agent of this.dolphins.agents) {
      if (agent.phase !== "leap" && agent.phase !== "airborne" && agent.phase !== "reentry") continue;
      leaping += 1;
      x += agent.motion.x;
      y += agent.motion.y;
      z += agent.motion.z;
    }
    if (leaping > 0) out.push({ kind: "dolphins", x: x / leaping, y: Math.max(0, y / leaping), z: z / leaping, size: 9 + leaping * 1.5 });
    return out;
  }

  /** Current whale phase, for diagnostics. */
  get whalePhase(): string | undefined {
    return this.whales.phase;
  }

  dispose(): void {
    this.dolphins.dispose();
    for (const shark of this.sharks) shark.dispose();
    this.whales.dispose();
    this.breach.dispose();
    this.fish.dispose();
    this.gulls.dispose();
    this.scene.remove(this.group);
  }
}
