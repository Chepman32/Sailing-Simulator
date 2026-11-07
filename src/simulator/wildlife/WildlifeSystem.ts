import { beginPatrol } from "./SharkBehavior";
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

/** Seconds the sea's animals take to go deep before a storm (and to come back). */
export const STORM_LEAVE = 12;
/** How deep they go: well past what the water lets anyone see. */
const STORM_DEPTH = 60;
/** `WeatherSample.storm` above which they leave (a storm is 0.82, a downpour 0.38)… */
export const STORM_LEAVE_ABOVE = 0.55;
/** …and below which they come back. */
export const STORM_RETURN_BELOW = 0.45;

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
  /** 0 … 1: how far the sea's animals have gone from a storm (see `setStorm`). */
  private stormAway = 0;
  private stormLeaving = false;

  constructor(
    private readonly scene: THREE.Scene,
    ocean: OceanSystem,
    assets: AssetManager,
    counts: WildlifeCounts,
    underwater: UnderwaterLight,
    surfaceEffects: WaterEffects,
  ) {
    // Splashes, fin trails and blows stop as soon as the animals start to
    // leave: from then on they are going down, not breaking the surface.
    const calm = () => this.stormAway < 0.02;
    const effects: WaterEffects = {
      splash: (position, intensity, kind, velocity) => {
        if (calm()) surfaceEffects.splash(position, intensity, kind, velocity);
      },
      trail: (position, heading, strength, width) => {
        if (calm()) surfaceEffects.trail(position, heading, strength, width);
      },
      shed: (position, velocity, count, size) => {
        if (calm()) surfaceEffects.shed(position, velocity, count, size);
      },
      ripple: (position, strength) => {
        if (calm()) surfaceEffects.ripple(position, strength);
      },
    };
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
    // A leap already in the air when a storm comes still lands with its splash.
    this.breach = new WhaleBreachController(this.group, ocean, this.world, assets, surfaceEffects);
    this.breach.materials.forEach((material) => underwater.apply(material));
    this.fish = new ReefFishController(this.marineGroup, ocean, assets, underwater, counts.fishDensity);
    // Gulls rest head to wind; the trade wind's mean direction is enough for that.
    const windLength = Math.hypot(6.8, 4.2);
    this.gulls = new GullFlockController(
      this.group,
      assets,
      counts.gulls,
      { surfaceHeight: (x, z) => ocean.sample(x, z).height, windX: 6.8 / windLength, windZ: 4.2 / windLength },
      { splash: (position, intensity, kind, velocity) => surfaceEffects.splash(position, intensity, kind, velocity), ripple: (position, strength) => surfaceEffects.ripple(position, strength) },
    );
  }

  private readonly swimmerState = { depth: 0 };

  /** Moves the pod and the sharks that are far from (x, z) to about 45 m off, where a swimmer cannot yet see them. */
  private gatherRound(x: number, z: number, depth: number): void {
    const place = (fromX: number, fromZ: number, distance: number): { x: number; z: number } | null => {
      const base = Math.atan2(fromX - x, fromZ - z);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const angle = base + (attempt % 2 === 0 ? 1 : -1) * Math.ceil(attempt / 2) * 0.6;
        const px = x + Math.sin(angle) * distance;
        const pz = z + Math.cos(angle) * distance;
        if (this.world.seabedDepth(px, pz) > 4) return { x: px, z: pz };
      }
      return null;
    };
    const pod = this.dolphins.pod;
    if (pod && Math.hypot(pod.centreX - x, pod.centreZ - z) > 90) {
      const spot = place(pod.centreX, pod.centreZ, 45);
      if (spot) {
        const dx = spot.x - pod.centreX;
        const dz = spot.z - pod.centreZ;
        pod.centreX += dx;
        pod.centreZ += dz;
        for (const agent of pod.agents) {
          agent.motion.x += dx;
          agent.motion.z += dz;
        }
      }
    }
    for (const shark of this.sharks) {
      const agent = shark.state;
      if (!agent || Math.hypot(agent.motion.x - x, agent.motion.z - z) < 80) continue;
      const spot = place(agent.motion.x, agent.motion.z, 48 + Math.random() * 10);
      if (!spot) continue;
      agent.motion.x = spot.x;
      agent.motion.z = spot.z;
      agent.motion.y = -Math.min(this.world.seabedDepth(spot.x, spot.z) - 1.5, Math.max(1.5, depth + 1));
      agent.motion.heading = Math.atan2(x - spot.x, z - spot.z);
      beginPatrol(agent, { x, z, heading: 0, speed: 0, swimmer: { depth } }, Math.random);
    }
  }

  /** Everything that lives under the surface (left out of the water's mirror). */
  get underwater(): THREE.Object3D {
    return this.marineGroup;
  }

  /**
   * @param swimmer the skipper while he is in the water (where, how deep,
   *   which way he looks): the whale, the sharks and the dolphins then keep
   *   round him, within sight through the water, instead of round the yacht.
   */
  update(delta: number, physics: VesselPhysics, camera: THREE.Camera, swimmer: { x: number; z: number; depth: number; heading: number } | null = null): void {
    const vessel = this.vessel;
    if (swimmer) {
      // Just gone into the water: animals far off are brought in, out of his
      // sight, to come and look at him (they would take minutes otherwise).
      if (!vessel.swimmer) this.gatherRound(swimmer.x, swimmer.z, swimmer.depth);
      vessel.x = swimmer.x;
      vessel.z = swimmer.z;
      vessel.heading = swimmer.heading;
      vessel.speed = 0;
      this.swimmerState.depth = swimmer.depth;
      vessel.swimmer = this.swimmerState;
    } else {
      vessel.x = physics.position.x;
      vessel.z = physics.position.z;
      vessel.heading = physics.heading;
      vessel.speed = Math.max(0, physics.telemetry.forwardSpeed);
      vessel.swimmer = null;
    }

    // In a storm the whales, sharks, dolphins and fish go deep and stay
    // there: they sink out of sight over STORM_LEAVE seconds, and come
    // back up the same way once it has blown over.
    const step = Math.min(Math.max(delta, 0), 0.1) / STORM_LEAVE;
    this.stormAway = this.stormLeaving ? Math.min(1, this.stormAway + step) : Math.max(0, this.stormAway - step);
    const sink = this.stormAway * this.stormAway * (3 - 2 * this.stormAway);
    this.marineGroup.position.y = -sink * STORM_DEPTH;
    this.marineGroup.visible = this.stormAway < 1;
    if (this.stormAway < 1) this.updateMarine(delta, physics, camera);

    // Gull clips are sampled at about 30 Hz; their flight is integrated every frame.
    this.gullClock = Math.min(0.12, this.gullClock + delta);
    const gullAnimation = this.gullClock >= 1 / 30 ? this.gullClock : 0;
    if (gullAnimation > 0) this.gullClock = 0;
    this.gulls.update(delta, physics, gullAnimation);
  }

  /**
   * Storm strength from the weather (`WeatherSample.storm`): from a storm on
   * (with some hysteresis, so a squall on the edge does not send them up and
   * down) the sea is left to the waves.
   */
  setStorm(storm: number): void {
    if (storm > STORM_LEAVE_ABOVE) this.stormLeaving = true;
    else if (storm < STORM_RETURN_BELOW) this.stormLeaving = false;
  }

  /** 1 when the sea's animals are about, 0 when a storm has sent them all deep. */
  get presence(): number {
    return 1 - this.stormAway;
  }

  private updateMarine(delta: number, physics: VesselPhysics, camera: THREE.Camera): void {
    const vessel = this.vessel;
    this.whales.update(delta, vessel, camera);
    // A breach is a leap into the air: none once the animals are leaving
    // (one already in the air is let finish).
    if (this.stormAway === 0 || this.breach.breaching) this.breach.update(delta, vessel, camera);
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
  }

  /** Calls given by gulls disturbed on the water or taking off, since the last call. */
  consumeGullCalls(): { position: THREE.Vector3; variant: number }[] {
    return this.gulls.calls.splice(0);
  }

  /**
   * 0 by day … 1 at night: the shows (a shark's fin, a breach) come a little
   * less often after dark, but still come, since at night the fin and its
   * wake are all that can be seen of a shark.
   */
  setNight(night: number): void {
    this.world.rarity = 1 + Math.min(1, Math.max(0, night)) * 0.3;
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
    if (this.stormAway > 0) return out;
    const breach = this.breach.breaching;
    if (breach) out.push({ kind: "breach", x: breach.x, y: Math.max(0, breach.y), z: breach.z, size: 34 });
    const whale = this.whales.obstacle();
    const phase = this.whales.phase;
    if (whale && (phase === "surface" || phase === "prepare_tail_slap" || phase === "tail_slap" || phase === "pass_under")) {
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

  /**
   * Distance from (x, y, z) to the nearest large animal's body (negative
   * inside) and the direction out of it in `normal`: a whale, a shark or a
   * dolphin, each a capsule along its spine. A swimmer is pushed off them.
   */
  bodyClearance(x: number, y: number, z: number, normal: { x: number; y: number; z: number }): number {
    let best = Number.POSITIVE_INFINITY;
    const consider = (cx: number, cy: number, cz: number, fx: number, fy: number, fz: number, half: number, radius: number) => {
      // Quick reject before the segment test.
      if (Math.abs(x - cx) > half + radius + 2 || Math.abs(z - cz) > half + radius + 2 || Math.abs(y - cy) > half + radius + 2) return;
      const t = Math.max(-half, Math.min(half, (x - cx) * fx + (y - cy) * fy + (z - cz) * fz));
      const px = x - (cx + fx * t);
      const py = y - (cy + fy * t);
      const pz = z - (cz + fz * t);
      const length = Math.hypot(px, py, pz);
      const distance = length - radius;
      if (distance >= best) return;
      best = distance;
      if (length > 1e-6) {
        normal.x = px / length;
        normal.y = py / length;
        normal.z = pz / length;
      } else {
        normal.x = 0;
        normal.y = 1;
        normal.z = 0;
      }
    };
    const fromRoot = (root: THREE.Object3D | undefined, half: number, radius: number) => {
      if (!root || !root.visible) return;
      const e = root.matrixWorld.elements;
      const length = Math.hypot(e[8]!, e[9]!, e[10]!) || 1;
      consider(e[12]!, e[13]!, e[14]!, e[8]! / length, e[9]! / length, e[10]! / length, half, radius);
    };
    // Lengths as the models are sized (`WHALE_LENGTH`, `SHARK_LENGTH`, `DOLPHIN_LENGTH`), the girth tapered in.
    fromRoot(this.whales.body, 7.6, 2.1);
    for (const shark of this.sharks) fromRoot(shark.body, 2.2, 0.5);
    for (const agent of this.dolphins.agents) {
      const m = agent.motion;
      const c = Math.cos(m.pitch);
      consider(m.x, m.y, m.z, Math.sin(m.heading) * c, Math.sin(m.pitch), Math.cos(m.heading) * c, 1.05, 0.32);
    }
    return best;
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
