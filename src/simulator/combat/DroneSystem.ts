import * as THREE from "three";
import { distanceFromWaterline } from "../environment/IslandMath";
import type { OceanSample } from "../environment/OceanMath";
import type { WakeSystem } from "../vessel/WakeSystem";
import type { CombatEffects } from "./CombatEffects";
import {
  BURST_PAUSE,
  BURST_RATE,
  BURST_ROUNDS,
  droneCondition,
  droneToWorld,
  DOME_CENTRE,
  FIRE_RANGE,
  hitChance,
  JET_CENTRES,
  SALVAGE_VALUE,
  SCRAP_VALUE,
  SHOT_HEARD,
  SPOTTED,
  stepSuspicion,
  strikeDrone,
  WINCH_REACH,
  WINCH_SECONDS,
  type DroneCondition,
  type DroneDamage,
  type DronePose,
  type HitZone,
} from "./CombatMath";
import { PatrolBoatTemplate, type CrewSeat } from "./PatrolBoatModel";
import { DroneTemplate, type DroneParts } from "./DroneModel";

/**
 * Aquilon's drones at sea: their beat, how they find the yacht and fight
 * her, what the player's rounds do to them, and hauling a blinded one
 * alongside. One `DroneSystem` owns every drone; the story spawns and
 * removes them by group (see `StorySystem`).
 *
 * Behaviours (docs/campaign/gameplay.md):
 * - `patrol`: a beat round its post; grows suspicious of what it hears and
 *   sees (the yacht's signature), then hunts her and circles her firing
 *   bursts. Losing her, it searches where she was last, then goes back.
 * - `pass`: crosses on a line and leaves; never attacks (a demonstration).
 * - `strike`: the prologue's interceptors: told where she is, they close in
 *   firing and nothing the player has can stop them.
 */

export type DroneBehaviour = "patrol" | "pass" | "strike" | "ram" | "chase";

export type DroneSpec = {
  group: string;
  behaviour: DroneBehaviour;
  count: number;
  centre: { x: number; z: number };
  beat: number;
  line?: readonly [{ x: number; z: number }, { x: number; z: number }];
  /** Seconds before a lost drone of the group comes back (ambient patrols); none: it does not. */
  respawn?: number;
  /** Where it starts exactly, and heading which way (else on its beat, or for a strike or a ram off the yacht). */
  start?: { x: number; z: number; heading: number };
  /** Its top speed, m/s. */
  speed?: number;
  /**
   * A crewed boat (Vanguard's patrol boat, her crew aboard) rather than an
   * uncrewed drone. `chase`: she follows the yacht from astern, her gunner
   * firing now and then, until the story calls her off (`withdraw`).
   */
  crewed?: boolean;
};

/** A boat's crew, made by the simulator once the figures are in (see `DroneSystem.crew`). */
export type DroneCrew = { update(delta: number, aim: THREE.Vector3 | null): void; dispose(): void };

type Mode = "patrol" | "search" | "attack" | "pass" | "ram" | "disabled" | "sinking";

type Drone = {
  serial: number;
  spec: DroneSpec;
  number: string;
  parts: DroneParts;
  pose: DronePose;
  speed: number;
  mode: Mode;
  condition: DroneCondition;
  damage: DroneDamage;
  suspicion: number;
  lastSeen: { x: number; z: number } | null;
  searchTime: number;
  waypoint: { x: number; z: number };
  orbit: number;
  orbitTurn: number;
  turretYaw: number;
  burst: number;
  burstClock: number;
  cooldown: number;
  sinkTime: number;
  trailOdometer: number;
  sprayClock: number;
  smokeClock: number;
  sparkClock: number;
  /** Seconds of winching done (salvage). */
  winched: number;
  scanPhase: number;
  invulnerable: boolean;
  /** Her crew's figures (a crewed boat, once they could be made), and where they stand. */
  crew: DroneCrew | null;
  seats: readonly CrewSeat[];
};

export type DroneEvent =
  | { type: "spotted"; group: string }
  | { type: "rammed"; group: string }
  | { type: "disabled"; group: string }
  | { type: "stopped"; group: string }
  | { type: "destroyed"; group: string }
  | { type: "salvaged"; group: string; value: number }
  | { type: "scrap"; group: string; value: number };

/** What the world tells the drones each frame. */
export type DroneWorld = {
  yacht: { x: number; y: number; z: number; heading: number; speed: number };
  /** The skipper is aboard her (a yacht left at anchor is left alone). */
  crewed: boolean;
  /** How far off the yacht can be picked up now (`yachtSignature().reach`). */
  reach: number;
  night: number;
  waves: number;
  rain: number;
  haze: number;
  windX: number;
  windZ: number;
  sample: (x: number, z: number) => OceanSample;
};

export type DroneHit = { point: THREE.Vector3; fromX: number; fromZ: number };

export type DroneContact = { x: number; y: number; z: number; group: string; number: string; hostile: boolean; aware: boolean; condition: DroneCondition; mode: Mode; salvage: number };

/** Patrol and attack speeds, m/s. */
const PATROL_SPEED = 7.5;
const HUNT_SPEED = 16.5;
const ORBIT_SPEED = 12.5;
const PASS_SPEED = 12;
/** The circle a drone fights at, m from the yacht. */
const STANDOFF = 150;
const STRIKE_STANDOFF = 95;
/** A chasing boat keeps this far astern of her. */
const CHASE_STANDOFF = 42;
/** Open water a drone keeps from any shore, m. */
const SHORE_KEEP = 38;
/** A drone in contact keeps her at least this far (it is looking right at her). */
const CONTACT_REACH = 380;
const SINK_TIME = 7;
/** Seconds the scrap of a sunk drone floats to be picked up, and how near counts. */
const SCRAP_FLOAT = 150;
const SCRAP_REACH = 32;

let serials = 0;

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function hashNumber(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export class DroneSystem {
  readonly group = new THREE.Group();
  private readonly template = new DroneTemplate();
  private patrolTemplate: PatrolBoatTemplate | null = null;
  /** Makes a crewed boat's crew (figures standing at `seats` in her frame), or null until it can. */
  crew: ((root: THREE.Group, seats: readonly CrewSeat[]) => DroneCrew | null) | null = null;
  private readonly drones: Drone[] = [];
  private readonly events: DroneEvent[] = [];
  private readonly hits: DroneHit[] = [];
  private readonly shots: { x: number; y: number; z: number; near: { x: number; y: number; z: number } | null }[] = [];
  private readonly pending: { spec: DroneSpec; at: number }[] = [];
  private readonly scrap: { x: number; z: number; group: string; until: number; pieces: THREE.Mesh[] }[] = [];
  private readonly scrapGeometry = new THREE.BoxGeometry(0.9, 0.18, 0.6);
  private readonly scrapMaterial = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.7, metalness: 0.3 });
  private time = 0;
  private readonly muzzle = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly scratch = { x: 0, y: 0, z: 0 };
  private readonly scratchVector = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly effects: CombatEffects,
    private readonly wake: WakeSystem,
  ) {
    this.group.name = "AquilonDrones";
    scene.add(this.group);
  }

  /** Puts a group's drones on the water (`yacht`: kept clear of her, or for a strike, set off ahead of her). */
  spawn(spec: DroneSpec, yacht: { x: number; z: number; heading: number }): void {
    for (let index = 0; index < spec.count; index += 1) this.add(spec, index, yacht);
  }

  has(group: string): boolean {
    return this.drones.some((drone) => drone.spec.group === group) || this.pending.some((entry) => entry.spec.group === group);
  }

  /** Takes a drone's model out of the scene (its geometry and materials are the template's, kept). */
  private discard(drone: Drone): void {
    drone.parts.root.removeFromParent();
    drone.crew?.dispose();
    drone.crew = null;
  }

  /**
   * A crewed group gives up: each boat turns for `(x, z)` and is gone once
   * there (or out of sight on the way), firing no more.
   */
  withdraw(group: string, x: number, z: number): void {
    for (const drone of this.drones) {
      if (drone.spec.group !== group || drone.mode === "sinking") continue;
      drone.spec = { ...drone.spec, behaviour: "pass", line: [{ x: drone.pose.x, z: drone.pose.z }, { x, z }] };
      drone.mode = "pass";
      drone.burst = 0;
    }
  }

  private setLeds(drone: Drone, material: THREE.Material): void {
    for (const mesh of drone.parts.ledMeshes) if (mesh.material !== material) mesh.material = material;
  }

  /** Takes a group off the water at once (the story has moved on). */
  remove(group: string): void {
    for (let index = this.drones.length - 1; index >= 0; index -= 1) {
      const drone = this.drones[index]!;
      if (drone.spec.group !== group) continue;
      this.discard(drone);
      this.drones.splice(index, 1);
    }
    for (let index = this.pending.length - 1; index >= 0; index -= 1) if (this.pending[index]!.spec.group === group) this.pending.splice(index, 1);
  }

  clear(): void {
    for (const drone of this.drones) this.discard(drone);
    this.drones.length = 0;
    this.pending.length = 0;
    for (const wreck of this.scrap) for (const piece of wreck.pieces) piece.removeFromParent();
    this.scrap.length = 0;
  }

  /** Groups currently on the water or waiting to come back. */
  groups(): Set<string> {
    const out = new Set<string>();
    for (const drone of this.drones) out.add(drone.spec.group);
    for (const entry of this.pending) out.add(entry.spec.group);
    return out;
  }

  private add(spec: DroneSpec, index: number, yacht: { x: number; z: number; heading: number }): void {
    const crewed = spec.crewed === true;
    const number = `${crewed ? "VN" : "AQ"}-${String((hashNumber(spec.group) + index * 7) % 90 + 10)}`;
    let seats: readonly CrewSeat[] = [];
    let parts: DroneParts;
    if (crewed) {
      this.patrolTemplate ??= new PatrolBoatTemplate();
      const boat = this.patrolTemplate.build(number);
      parts = boat;
      seats = boat.seats;
    } else {
      parts = this.template.build(number);
    }
    const start = this.startPoint(spec, index, yacht);
    const pose: DronePose = { x: start.x, y: 0, z: start.z, heading: start.heading, pitch: 0, roll: 0 };
    const drone: Drone = {
      serial: (serials += 1),
      spec,
      number,
      parts,
      pose,
      speed: spec.behaviour === "strike" || spec.behaviour === "ram" ? (spec.speed ?? HUNT_SPEED) : 0,
      mode: spec.behaviour === "pass" ? "pass" : spec.behaviour === "strike" || spec.behaviour === "chase" ? "attack" : spec.behaviour === "ram" ? "ram" : "patrol",
      condition: "fighting",
      damage: { dome: 0, jets: 0, hull: 0 },
      suspicion: spec.behaviour === "strike" || spec.behaviour === "chase" ? SPOTTED : 0,
      lastSeen: null,
      searchTime: 0,
      waypoint: { x: start.x, z: start.z },
      orbit: Math.random() * Math.PI * 2,
      orbitTurn: index % 2 === 0 ? 1 : -1,
      turretYaw: 0,
      burst: 0,
      burstClock: 0,
      cooldown: 2 + Math.random() * 2,
      sinkTime: 0,
      trailOdometer: 0,
      sprayClock: 0,
      smokeClock: 0,
      sparkClock: 0,
      winched: 0,
      scanPhase: Math.random() * 6,
      invulnerable: spec.behaviour === "strike" || spec.behaviour === "ram" || spec.behaviour === "chase",
      crew: null,
      seats,
    };
    if (drone.mode === "patrol") drone.waypoint = this.patrolPoint(spec, yacht);
    parts.root.position.set(pose.x, 0, pose.z);
    this.group.add(parts.root);
    this.drones.push(drone);
  }

  private startPoint(spec: DroneSpec, index: number, yacht: { x: number; z: number; heading: number }): { x: number; z: number; heading: number } {
    if (spec.start) return { x: spec.start.x + index * 12, z: spec.start.z + index * 12, heading: spec.start.heading };
    if (spec.behaviour === "ram") {
      // Out of the dusk off her beam, a little ahead, coming straight in.
      const bearing = yacht.heading - Math.PI / 2 + 0.25;
      const x = yacht.x + Math.sin(bearing) * 230;
      const z = yacht.z + Math.cos(bearing) * 230;
      return { x, z, heading: Math.atan2(yacht.x - x, yacht.z - z) };
    }
    if (spec.behaviour === "pass" && spec.line) {
      const [from, to] = spec.line;
      const offset = index * 60;
      const heading = Math.atan2(to.x - from.x, to.z - from.z);
      return { x: from.x - Math.sin(heading) * offset, z: from.z - Math.cos(heading) * offset, heading };
    }
    if (spec.behaviour === "strike") {
      // Ahead of her, either bow, coming in.
      const toward = Math.atan2(spec.centre.x - yacht.x, spec.centre.z - yacht.z);
      const bearing = toward + (index % 2 === 0 ? 0.42 : -0.42);
      const x = yacht.x + Math.sin(bearing) * 950;
      const z = yacht.z + Math.cos(bearing) * 950;
      return { x, z, heading: Math.atan2(yacht.x - x, yacht.z - z) };
    }
    const point = this.patrolPoint(spec, yacht, 520);
    return { ...point, heading: Math.random() * Math.PI * 2 };
  }

  /** A point of the beat in open water, preferring ones well away from the yacht. */
  private patrolPoint(spec: DroneSpec, yacht: { x: number; z: number }, keepAway = 0): { x: number; z: number } {
    let best = { x: spec.centre.x, z: spec.centre.z };
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = spec.beat * Math.sqrt(0.2 + Math.random() * 0.8);
      const x = spec.centre.x + Math.sin(angle) * radius;
      const z = spec.centre.z + Math.cos(angle) * radius;
      const room = distanceFromWaterline(x, z);
      if (room < SHORE_KEEP + 15) continue;
      const away = Math.hypot(x - yacht.x, z - yacht.z);
      const score = (keepAway > 0 ? Math.min(away, keepAway * 1.5) : 0) + Math.min(room, 120) * 0.5 + Math.random() * 40;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
    return best;
  }

  /** Everything that happened since the last call. */
  consumeEvents(): DroneEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** The rounds that struck the yacht since the last call. */
  consumeHits(): DroneHit[] {
    return this.hits.splice(0, this.hits.length);
  }

  /** Where drones fired from since the last call (for the guns' sound), and where a miss whipped close by her. */
  consumeShots(): { x: number; y: number; z: number; near: { x: number; y: number; z: number } | null }[] {
    return this.shots.splice(0, this.shots.length);
  }

  /** The drones, for the screen's markers and the sound of their engines. */
  contacts(out: DroneContact[] = []): DroneContact[] {
    out.length = 0;
    for (const drone of this.drones) {
      out.push({
        x: drone.pose.x,
        y: drone.pose.y + 1.4,
        z: drone.pose.z,
        group: drone.spec.group,
        number: drone.number,
        hostile: drone.spec.behaviour !== "pass",
        aware: drone.mode === "attack",
        condition: drone.condition,
        mode: drone.mode,
        salvage: drone.winched / WINCH_SECONDS,
      });
    }
    return out;
  }

  /** The engines heard: position and how hard each runs (0 when stopped or sinking). */
  engines(out: { x: number; y: number; z: number; speed: number }[] = []): { x: number; y: number; z: number; speed: number }[] {
    out.length = 0;
    for (const drone of this.drones) {
      if (drone.mode === "disabled" || drone.mode === "sinking" || drone.condition === "stopped") continue;
      out.push({ x: drone.pose.x, y: drone.pose.y + 0.6, z: drone.pose.z, speed: drone.speed });
    }
    return out;
  }

  /** How alarmed the drones are: the highest suspicion, and whether one is attacking. */
  alarm(): { suspicion: number; attacking: boolean } {
    let suspicion = 0;
    let attacking = false;
    for (const drone of this.drones) {
      if (drone.spec.behaviour === "pass" || drone.mode === "disabled" || drone.mode === "sinking") continue;
      suspicion = Math.max(suspicion, Math.min(1, drone.suspicion));
      if (drone.mode === "attack") attacking = true;
    }
    return { suspicion, attacking };
  }

  /** A blinded drone within the winch's reach of (x, z): how far it has been hauled (0…1), or −1 if there is none. */
  salvageable(x: number, z: number): number {
    for (const drone of this.drones) {
      if (drone.condition !== "blind" || drone.mode === "sinking") continue;
      if (Math.hypot(drone.pose.x - x, drone.pose.z - z) > WINCH_REACH) continue;
      return drone.winched / WINCH_SECONDS;
    }
    return -1;
  }

  /** How far along a line (the camera's aim) the first drone lies, or null: nothing is struck. */
  aimDistance(origin: THREE.Vector3, dir: THREE.Vector3, reach: number): number | null {
    let best: number | null = null;
    for (const drone of this.drones) {
      if (drone.mode === "sinking") continue;
      const strike = strikeDrone(origin, dir, drone.pose, reach);
      if (strike && (best === null || strike.distance < best)) best = strike.distance;
    }
    return best;
  }

  /** The poses of the drones afloat (for a touch's aim). */
  poses(): DronePose[] {
    return this.drones.filter((drone) => drone.mode !== "sinking").map((drone) => drone.pose);
  }

  /** The nearest drone of a group, for the story's waypoint. */
  find(group: string): { x: number; y: number; z: number; heading: number } | null {
    const drone = this.drones.find((entry) => entry.spec.group === group && entry.mode !== "sinking");
    return drone ? { x: drone.pose.x, y: drone.pose.y + 2, z: drone.pose.z, heading: drone.pose.heading } : null;
  }

  /** Winches the nearest blinded drone in reach for `delta` seconds; true while there is one to winch. */
  winch(x: number, z: number, delta: number): boolean {
    let best: Drone | null = null;
    let distance = WINCH_REACH;
    for (const drone of this.drones) {
      if (drone.condition !== "blind" || drone.mode === "sinking") continue;
      const away = Math.hypot(drone.pose.x - x, drone.pose.z - z);
      if (away <= distance) {
        best = drone;
        distance = away;
      }
    }
    if (!best) return false;
    best.winched += delta;
    // Hauled toward her, a little at a time.
    const pull = Math.min(1, delta * 1.5);
    const dx = x - best.pose.x;
    const dz = z - best.pose.z;
    const length = Math.hypot(dx, dz) || 1;
    if (length > 6) {
      best.pose.x += (dx / length) * pull * 2;
      best.pose.z += (dz / length) * pull * 2;
    }
    if (best.winched >= WINCH_SECONDS) {
      this.events.push({ type: "salvaged", group: best.spec.group, value: SALVAGE_VALUE });
      this.lose(best);
    }
    return true;
  }

  /** Stops winching (the key let go): what was hauled stays hauled. */
  releaseWinch(): void {
    // Nothing to undo: progress is kept on the drone.
  }

  /**
   * A round from `origin` along unit `dir`: what it strikes (a drone's
   * part, with the point), or null. The shot is heard by the drones near.
   * `power` 0 (a pistol's) glances off wherever it strikes.
   */
  shoot(origin: THREE.Vector3, dir: THREE.Vector3, reach = 900, power = 1): { zone: HitZone; point: THREE.Vector3; armour: boolean; condition: DroneCondition } | null {
    // Heard: the drones near know where she is.
    for (const drone of this.drones) {
      if (drone.mode === "disabled" || drone.mode === "sinking" || drone.spec.behaviour === "pass") continue;
      if (Math.hypot(drone.pose.x - origin.x, drone.pose.z - origin.z) > SHOT_HEARD) continue;
      drone.suspicion = Math.max(drone.suspicion, 0.75);
      drone.lastSeen = { x: origin.x, z: origin.z };
      if (drone.mode === "patrol") {
        drone.mode = "search";
        drone.searchTime = 0;
      }
    }
    let best: { drone: Drone; zone: HitZone; distance: number } | null = null;
    for (const drone of this.drones) {
      if (drone.mode === "sinking") continue;
      const strike = strikeDrone(origin, dir, drone.pose, reach);
      if (strike && (!best || strike.distance < best.distance)) best = { drone, ...strike };
    }
    if (!best) return null;
    const { drone, zone } = best;
    const point = new THREE.Vector3().copy(dir).multiplyScalar(best.distance).add(origin);
    const before = drone.condition;
    let armour = zone === "hull";
    if (drone.invulnerable || power <= 0) {
      armour = true;
    } else if (zone === "dome") {
      if (drone.condition !== "blind") drone.damage.dome += 1;
      else armour = true;
    } else if (zone === "jet") {
      drone.damage.jets += 1;
    } else {
      drone.damage.hull += 1;
    }
    drone.condition = droneCondition(drone.damage);
    // Struck, it knows exactly where the shot came from.
    if (drone.condition === "fighting" || drone.condition === "stopped") {
      if (drone.spec.behaviour !== "pass") {
        if (drone.mode !== "attack") this.events.push({ type: "spotted", group: drone.spec.group });
        drone.suspicion = Math.max(drone.suspicion, SPOTTED);
        drone.mode = "attack";
        drone.lastSeen = { x: origin.x, z: origin.z };
      }
    }
    if (drone.condition !== before) this.changed(drone, before, point);
    this.effects.sparks(point, armour ? 9 : 14, armour ? 0.8 : 1);
    return { zone, point, armour, condition: drone.condition };
  }

  private changed(drone: Drone, before: DroneCondition, at: THREE.Vector3): void {
    if (drone.condition === "blind") {
      drone.mode = "disabled";
      drone.suspicion = 0;
      this.setLeds(drone, this.template.ledDead);
      drone.parts.domeMesh.material = this.template.domeBroken;
      this.effects.explosion(at, 0.18);
      this.events.push({ type: "disabled", group: drone.spec.group });
    } else if (drone.condition === "stopped") {
      this.events.push({ type: "stopped", group: drone.spec.group });
      this.effects.sparks(at, 20, 1);
    } else if (drone.condition === "wrecked") {
      void before;
      drone.mode = "sinking";
      drone.sinkTime = 0;
      this.setLeds(drone, this.template.ledDead);
      drone.parts.hullMesh.material = this.template.hullBurnt;
      this.scratchVector.set(drone.pose.x, drone.pose.y + 1, drone.pose.z);
      this.effects.explosion(this.scratchVector, 1);
      this.wake.splash(this.scratchVector.setY(drone.pose.y), 4, "slap");
      this.events.push({ type: "destroyed", group: drone.spec.group });
      // Scrap left floating.
      const pieces: THREE.Mesh[] = [];
      for (let index = 0; index < 4; index += 1) {
        const piece = new THREE.Mesh(this.scrapGeometry, this.scrapMaterial);
        piece.position.set(drone.pose.x + (Math.random() - 0.5) * 8, drone.pose.y, drone.pose.z + (Math.random() - 0.5) * 8);
        piece.rotation.y = Math.random() * Math.PI;
        this.group.add(piece);
        pieces.push(piece);
      }
      this.scrap.push({ x: drone.pose.x, z: drone.pose.z, group: drone.spec.group, until: this.time + SCRAP_FLOAT, pieces });
    }
  }

  /** Takes a drone out of the world for good; an ambient group's comes back later. */
  private lose(drone: Drone): void {
    this.discard(drone);
    const index = this.drones.indexOf(drone);
    if (index >= 0) this.drones.splice(index, 1);
    if (drone.spec.respawn !== undefined) this.pending.push({ spec: { ...drone.spec, count: 1 }, at: this.time + drone.spec.respawn });
  }

  update(delta: number, world: DroneWorld): void {
    this.time += delta;
    // The diodes breathe at rest and flicker in a fight (shared by every drone).
    const calm = 1.6 + Math.sin(this.time * 2.4) * 0.5;
    const alert = 1.6 + Math.sin(this.time * 14) * 0.9;
    this.template.ledCalm.color.setRGB(calm, 0.12, 0.1);
    this.template.ledAlert.color.setRGB(alert, 0.12, 0.1);
    const yacht = world.yacht;
    // Ambient patrols come back after a while, out of sight.
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const entry = this.pending[index]!;
      if (this.time < entry.at) continue;
      this.pending.splice(index, 1);
      this.add(entry.spec, 0, yacht);
    }
    // Scrap: picked up by sailing through it, or lost.
    for (let index = this.scrap.length - 1; index >= 0; index -= 1) {
      const wreck = this.scrap[index]!;
      const gone = this.time > wreck.until;
      const taken = !gone && Math.hypot(wreck.x - yacht.x, wreck.z - yacht.z) < SCRAP_REACH;
      for (const piece of wreck.pieces) {
        const surface = world.sample(piece.position.x, piece.position.z).height;
        piece.position.y = surface + 0.02;
        piece.position.x += world.windX * 0.01 * delta;
        piece.position.z += world.windZ * 0.01 * delta;
      }
      if (gone || taken) {
        for (const piece of wreck.pieces) piece.removeFromParent();
        this.scrap.splice(index, 1);
        if (taken) this.events.push({ type: "scrap", group: wreck.group, value: SCRAP_VALUE });
      }
    }
    for (let index = this.drones.length - 1; index >= 0; index -= 1) this.updateDrone(this.drones[index]!, delta, world);
  }

  private updateDrone(drone: Drone, delta: number, world: DroneWorld): void {
    const yacht = world.yacht;
    const pose = drone.pose;
    // An empty yacht is not sensed at all; the prologue's interceptors know where she is regardless.
    const knows = drone.spec.behaviour === "strike" || drone.spec.behaviour === "chase";
    const distance = world.crewed || knows ? Math.hypot(yacht.x - pose.x, yacht.z - pose.z) : Infinity;
    let goal: { x: number; z: number } | null = null;
    let speedGoal = 0;

    // --- Senses and mind ----------------------------------------------------
    if (drone.mode === "patrol" || drone.mode === "search" || drone.mode === "attack") {
      const contact = drone.mode === "attack" ? Math.max(world.reach, CONTACT_REACH * (1 - 0.35 * world.night) * (1 - 0.4 * world.haze)) : world.reach;
      const before = drone.suspicion;
      if (!knows) drone.suspicion = stepSuspicion(drone.suspicion, distance, contact, delta);
      if (distance < contact) drone.lastSeen = { x: yacht.x, z: yacht.z };
      if (drone.mode !== "attack" && drone.suspicion >= SPOTTED) {
        drone.mode = "attack";
        this.events.push({ type: "spotted", group: drone.spec.group });
      } else if (drone.mode === "patrol" && drone.suspicion > 0.45 && before <= 0.45) {
        drone.mode = "search";
        drone.searchTime = 0;
      } else if (drone.mode === "attack" && drone.suspicion < 0.35 && !knows) {
        drone.mode = "search";
        drone.searchTime = 0;
      }
    }

    // --- Where it goes ------------------------------------------------------
    const mobile = drone.condition === "fighting";
    switch (drone.mode) {
      case "patrol": {
        if (Math.hypot(drone.waypoint.x - pose.x, drone.waypoint.z - pose.z) < 45) drone.waypoint = this.patrolPoint(drone.spec, yacht);
        goal = drone.waypoint;
        speedGoal = PATROL_SPEED;
        break;
      }
      case "search": {
        drone.searchTime += delta;
        const seen = drone.lastSeen ?? drone.waypoint;
        if (Math.hypot(seen.x - pose.x, seen.z - pose.z) > 60) {
          goal = seen;
          speedGoal = 13;
        } else {
          // Circling where she was.
          drone.orbit += delta * 0.18 * drone.orbitTurn;
          goal = { x: seen.x + Math.sin(drone.orbit) * 90, z: seen.z + Math.cos(drone.orbit) * 90 };
          speedGoal = 9;
        }
        if (drone.searchTime > 40) {
          drone.mode = "patrol";
          drone.suspicion = Math.min(drone.suspicion, 0.3);
          drone.waypoint = this.patrolPoint(drone.spec, yacht);
        }
        break;
      }
      case "attack": {
        if (drone.spec.behaviour === "chase") {
          // In her wake, a little off her quarter, closing only slowly: a bigger engine, but the helmsman is careful.
          const astern = { x: yacht.x - Math.sin(yacht.heading) * CHASE_STANDOFF + Math.cos(yacht.heading) * 9 * drone.orbitTurn, z: yacht.z - Math.cos(yacht.heading) * CHASE_STANDOFF - Math.sin(yacht.heading) * 9 * drone.orbitTurn };
          goal = astern;
          const gap = Math.hypot(astern.x - pose.x, astern.z - pose.z);
          speedGoal = Math.min(drone.spec.speed ?? HUNT_SPEED, yacht.speed + Math.min(6, gap * 0.08));
          break;
        }
        const standoff = drone.spec.behaviour === "strike" ? STRIKE_STANDOFF : STANDOFF;
        if (distance > standoff * 2.2) {
          goal = { x: yacht.x, z: yacht.z };
          speedGoal = drone.spec.speed ?? HUNT_SPEED;
          drone.orbit = Math.atan2(pose.x - yacht.x, pose.z - yacht.z);
        } else {
          drone.orbit += (delta * ORBIT_SPEED * drone.orbitTurn) / standoff;
          goal = { x: yacht.x + Math.sin(drone.orbit) * standoff, z: yacht.z + Math.cos(drone.orbit) * standoff };
          speedGoal = ORBIT_SPEED;
        }
        break;
      }
      case "ram": {
        // At her, leading her a little, flat out; at her side, the blow.
        const lead = Math.min(2.5, distance / Math.max(8, drone.speed));
        goal = { x: yacht.x + Math.sin(yacht.heading) * yacht.speed * lead, z: yacht.z + Math.cos(yacht.heading) * yacht.speed * lead };
        speedGoal = drone.spec.speed ?? HUNT_SPEED;
        if (distance < 7) {
          this.events.push({ type: "rammed", group: drone.spec.group });
          this.scratchVector.set((pose.x + yacht.x) / 2, yacht.y + 0.8, (pose.z + yacht.z) / 2);
          this.effects.explosion(this.scratchVector, 0.5);
          this.wake.splash(this.scratchVector.setY(yacht.y), 4, "slap");
          drone.mode = "disabled";
          drone.speed *= 0.2;
        }
        break;
      }
      case "pass": {
        const to = drone.spec.line?.[1] ?? drone.spec.centre;
        goal = to;
        speedGoal = PASS_SPEED;
        if (Math.hypot(to.x - pose.x, to.z - pose.z) < 40) {
          this.lose(drone);
          return;
        }
        break;
      }
      case "disabled":
      case "sinking":
        break;
    }
    if (!mobile) speedGoal = 0;

    // --- Steering, round the islands ---------------------------------------
    if (goal && mobile) {
      let want = Math.atan2(goal.x - pose.x, goal.z - pose.z);
      if (drone.mode !== "ram") want = this.avoidShore(pose, want);
      const error = wrapAngle(want - pose.heading);
      const turn = (0.35 + Math.min(0.55, drone.speed / 18)) * delta;
      pose.heading = wrapAngle(pose.heading + Math.max(-turn, Math.min(turn, error)));
      // Slow into a hard turn.
      speedGoal *= 1 - Math.min(0.45, Math.abs(error) * 0.35);
    }
    const accel = speedGoal > drone.speed ? 3.2 : drone.condition === "fighting" ? 4.5 : 1.2;
    drone.speed += Math.max(-accel * delta, Math.min(accel * delta, speedGoal - drone.speed));
    const step = drone.speed * delta;
    pose.x += Math.sin(pose.heading) * step;
    pose.z += Math.cos(pose.heading) * step;
    if (!mobile) {
      // Adrift: the wind sets it slowly to leeward.
      pose.x += world.windX * 0.012 * delta;
      pose.z += world.windZ * 0.012 * delta;
      pose.heading = wrapAngle(pose.heading + Math.sin(this.time * 0.13 + drone.serial) * 0.05 * delta);
    }

    // --- On the water ------------------------------------------------------
    const surface = world.sample(pose.x, pose.z);
    const fore = world.sample(pose.x + Math.sin(pose.heading) * 3.5, pose.z + Math.cos(pose.heading) * 3.5).height;
    const aft = world.sample(pose.x - Math.sin(pose.heading) * 3.5, pose.z - Math.cos(pose.heading) * 3.5).height;
    const side = world.sample(pose.x + Math.cos(pose.heading) * 1.2, pose.z - Math.sin(pose.heading) * 1.2).height;
    const planing = Math.min(1, drone.speed / 14);
    let sink = 0;
    if (drone.mode === "sinking") {
      drone.sinkTime += delta;
      sink = Math.pow(drone.sinkTime / SINK_TIME, 1.6) * 3.4;
      if (drone.sinkTime > SINK_TIME) {
        this.lose(drone);
        return;
      }
    }
    const pitchGoal = Math.atan2(fore - aft, 7) + planing * 0.07 + (drone.mode === "sinking" ? -drone.sinkTime * 0.06 : 0);
    const rollGoal = Math.atan2(side - surface.height, 1.2) * 0.8 + (drone.mode === "sinking" ? drone.sinkTime * 0.05 : 0);
    pose.pitch += (pitchGoal - pose.pitch) * Math.min(1, delta * 4);
    pose.roll += (rollGoal - pose.roll) * Math.min(1, delta * 4);
    pose.y = surface.height - 0.12 + planing * 0.18 - sink;
    const root = drone.parts.root;
    root.position.set(pose.x, pose.y, pose.z);
    root.rotation.set(-pose.pitch, pose.heading, pose.roll, "YXZ");
    // The diodes, the scanner and the lights.
    drone.scanPhase += delta * (drone.mode === "attack" ? 5.5 : 2.2);
    drone.parts.scanner.rotation.y = drone.scanPhase;
    drone.parts.lights.visible = world.night > 0.35 && drone.condition !== "wrecked";
    if (drone.condition === "fighting" || drone.condition === "stopped") this.setLeds(drone, drone.mode === "attack" ? this.template.ledAlert : this.template.ledCalm);

    // --- Its wake ----------------------------------------------------------
    drone.trailOdometer += step;
    if (drone.speed > 2 && drone.trailOdometer > 2.4) {
      drone.trailOdometer = 0;
      this.scratchVector.set(pose.x - Math.sin(pose.heading) * 4.4, surface.height, pose.z - Math.cos(pose.heading) * 4.4);
      this.wake.trail(this.scratchVector, pose.heading, Math.min(1, drone.speed / 14), 1.1);
    }
    drone.sprayClock -= delta;
    if (drone.speed > 6 && drone.sprayClock <= 0) {
      drone.sprayClock = 0.07;
      // The rooster tail off the jets, and spray off the bow.
      for (const jet of JET_CENTRES) {
        droneToWorld({ x: jet.x, y: jet.y + 0.1, z: jet.z - 0.3 }, pose, this.scratch);
        this.scratchVector.set(this.scratch.x, this.scratch.y, this.scratch.z);
        this.muzzle.set(-Math.sin(pose.heading) * drone.speed * 0.45, 2.2 + planing * 2.5, -Math.cos(pose.heading) * drone.speed * 0.45);
        this.wake.shed(this.scratchVector, this.muzzle, 2, 0.16);
      }
    }

    // --- Smoke and sparks of damage ----------------------------------------
    drone.smokeClock -= delta;
    if (drone.condition !== "fighting" && drone.smokeClock <= 0) {
      drone.smokeClock = drone.mode === "sinking" ? 0.06 : 0.22;
      const strength = drone.mode === "sinking" ? 1 : drone.condition === "blind" ? 0.35 : 0.5;
      droneToWorld(drone.condition === "stopped" ? { x: 0, y: 0.6, z: -4 } : { x: DOME_CENTRE.x, y: DOME_CENTRE.y, z: DOME_CENTRE.z }, pose, this.scratch);
      this.scratchVector.set(this.scratch.x, this.scratch.y, this.scratch.z);
      this.effects.smokeFrom(this.scratchVector, strength, world.windX, world.windZ);
      if (drone.mode === "sinking") this.effects.fire(this.scratchVector, 1);
    }
    if (drone.condition === "blind") {
      drone.sparkClock -= delta;
      if (drone.sparkClock <= 0) {
        drone.sparkClock = 0.4 + Math.random() * 1.6;
        droneToWorld(DOME_CENTRE, pose, this.scratch);
        this.effects.sparks(this.scratchVector.set(this.scratch.x, this.scratch.y, this.scratch.z), 6, 0.9);
      }
    }

    // --- The gun -----------------------------------------------------------
    const local = Math.atan2(yacht.x - pose.x, yacht.z - pose.z) - pose.heading;
    const aimed = drone.mode === "attack" && drone.condition !== "blind" && drone.condition !== "wrecked";
    const yawGoal = aimed ? wrapAngle(local) : 0;
    const yawError = wrapAngle(yawGoal - drone.turretYaw);
    drone.turretYaw = wrapAngle(drone.turretYaw + Math.max(-2.4 * delta, Math.min(2.4 * delta, yawError)));
    drone.parts.turret.rotation.y = drone.turretYaw;
    if (drone.seats.length > 0) {
      if (!drone.crew && this.crew) drone.crew = this.crew(drone.parts.root, drone.seats);
      drone.crew?.update(delta, aimed ? this.target.set(yacht.x, yacht.y + 1.2, yacht.z) : null);
    }
    if (!aimed) {
      drone.burst = 0;
      return;
    }
    drone.cooldown -= delta;
    if (drone.burst <= 0) {
      if (drone.cooldown > 0 || distance > FIRE_RANGE || Math.abs(yawError) > 0.25 || !this.clearShot(pose, yacht)) return;
      drone.burst = BURST_ROUNDS;
      drone.burstClock = 0;
    }
    drone.burstClock -= delta;
    while (drone.burst > 0 && drone.burstClock <= 0) {
      drone.burstClock += 1 / BURST_RATE;
      drone.burst -= 1;
      this.fireRound(drone, world, distance);
      if (drone.burst === 0) drone.cooldown = (BURST_PAUSE[0] + Math.random() * (BURST_PAUSE[1] - BURST_PAUSE[0])) * (drone.spec.behaviour === "chase" ? 2.2 : 1);
    }
  }

  private fireRound(drone: Drone, world: DroneWorld, distance: number): void {
    const yacht = world.yacht;
    drone.parts.muzzle.getWorldPosition(this.muzzle);
    const chase = drone.spec.behaviour === "chase";
    const chance = hitChance(distance, yacht.speed, world.waves, world.night, world.rain, drone.spec.behaviour === "strike") * (chase ? 0.35 : 1);
    const hit = Math.random() < chance;
    const sin = Math.sin(yacht.heading);
    const cos = Math.cos(yacht.heading);
    if (hit) {
      const across = (Math.random() - 0.5) * 2.6;
      const along = (Math.random() - 0.5) * 7.5;
      this.target.set(yacht.x + cos * across + sin * along, yacht.y + 0.5 + Math.random() * 1.6, yacht.z - sin * across + cos * along);
      this.hits.push({ point: this.target.clone(), fromX: drone.pose.x, fromZ: drone.pose.z });
    } else {
      // Short, wide or over: into the sea round her.
      const angle = Math.random() * Math.PI * 2;
      const off = 4 + Math.random() * 16;
      const x = yacht.x + Math.sin(angle) * off;
      const z = yacht.z + Math.cos(angle) * off;
      this.target.set(x, world.sample(x, z).height, z);
      this.wake.splash(this.target, 0.28, "entry", undefined, false);
    }
    this.effects.tracer(this.muzzle, this.target, true);
    this.effects.flash(this.muzzle, 0.75);
    const close = !hit && Math.hypot(this.target.x - yacht.x, this.target.z - yacht.z) < 9;
    this.shots.push({ x: this.muzzle.x, y: this.muzzle.y, z: this.muzzle.z, near: close ? { x: (this.target.x + yacht.x) / 2, y: yacht.y + 1.6, z: (this.target.z + yacht.z) / 2 } : null });
  }

  /** No island between the drone and the yacht. */
  private clearShot(pose: DronePose, yacht: { x: number; z: number }): boolean {
    for (let step = 1; step < 6; step += 1) {
      const t = step / 6;
      if (distanceFromWaterline(pose.x + (yacht.x - pose.x) * t, pose.z + (yacht.z - pose.z) * t) < -1) return false;
    }
    return true;
  }

  /** Bends a wanted heading away from land ahead. */
  private avoidShore(pose: DronePose, want: number): number {
    const probe = (angle: number, reach: number) => distanceFromWaterline(pose.x + Math.sin(angle) * reach, pose.z + Math.cos(angle) * reach);
    const here = distanceFromWaterline(pose.x, pose.z);
    if (here < SHORE_KEEP * 0.6) {
      // Too close: straight out, along the slope of the shore distance.
      const gx = distanceFromWaterline(pose.x + 3, pose.z) - here;
      const gz = distanceFromWaterline(pose.x, pose.z + 3) - here;
      return Math.atan2(gx, gz);
    }
    if (Math.min(probe(want, 45), probe(want, 90)) > SHORE_KEEP) return want;
    for (let swing = 0.35; swing < Math.PI; swing += 0.35) {
      if (Math.min(probe(want + swing, 45), probe(want + swing, 90)) > SHORE_KEEP) return want + swing;
      if (Math.min(probe(want - swing, 45), probe(want - swing, 90)) > SHORE_KEEP) return want - swing;
    }
    return want + Math.PI;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
    this.template.dispose();
    this.patrolTemplate?.dispose();
    this.scrapGeometry.dispose();
    this.scrapMaterial.dispose();
  }
}
