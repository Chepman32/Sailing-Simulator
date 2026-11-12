import * as THREE from "three";
import { ActorBody, restPose, type BodyPose } from "./ActorBody";
import { ActorBrain, GUARD_TUNING, hitChance, sightOf, type Bark, type Senses, type Vec2 } from "./ActorBrain";
import type { ActorLook, GunKind } from "./ActorLooks";
import type { LevelSystem } from "../level/LevelSystem";
import type { WorldPoint } from "../level/LevelBuilder";

/**
 * The story's people on their feet: guards at their posts and on their
 * rounds, the people of a scene, a companion. Each has a body
 * (`ActorBody`, built when the figure models are in and he is near enough
 * to see) and, if he has a will of his own, a brain (`ActorBrain`). This
 * system gives the brain its senses (what a guard sees of the player, what
 * he hears, what his squad's radio says), carries out its intent (walking
 * the level's ways, ducking behind cover, firing), resolves the rounds
 * either way, and tells the story what happened (`ActorEvent`).
 */

export type Routine =
  /** Stands at his spawn, now and then glancing round. */
  | { kind: "stand" }
  /** Walks a level route, pausing at each point. */
  | { kind: "patrol"; route: string; pause?: number }
  /** Goes between spots, staying a while at each (carrying papers, a can). */
  | { kind: "work"; spots: readonly string[]; dwell: number }
  /** Sits (at a console, on the floor of a cell). */
  | { kind: "sit"; seat?: number }
  /** Nothing of his own: the story moves him. */
  | { kind: "hold" };

export type ActorSpec = {
  id: string;
  /** The cast id his lines go out under (a speaking part), else the actor's own id. */
  character?: string;
  look: ActorLook;
  gun?: GunKind | null;
  faction: "hostile" | "ally" | "neutral";
  /** Where he is put: a level spot (`level:spot`). */
  spawn: string;
  routine: Routine;
  /** Guards who share a radio. */
  squad?: string;
  /** Hit points, a pistol round taking 34 to the body. */
  health?: number;
  /** 0…1.5, how well he shoots. */
  skill?: number;
  /** He cannot be killed in this mission (a companion, the commander on his gallery). */
  immortal?: boolean;
  /** He never gives up. */
  stubborn?: boolean;
  /** What he says, by occasion (each said once). */
  barks?: Partial<Record<Bark, readonly { ru: string; en: string }[]>>;
};

export type ActorEvent =
  | { kind: "down"; id: string; lethal: boolean; by: "player" | "ally" | "takedown" }
  | { kind: "surrender"; id: string }
  | { kind: "alert"; level: "quiet" | "suspicious" | "combat" }
  | { kind: "bark"; id: string; character: string; text: { ru: string; en: string } }
  | { kind: "shotAt"; id: string }
  | { kind: "playerHit"; id: string; damage: number };

export type ActorHost = {
  /** What a walker stands on (the storey at `feetY`). */
  ground(x: number, z: number, feetY?: number): number;
  /** The natural ground (terrain, sea floor), for a line of sight over a hill. */
  terrain(x: number, z: number): number;
  /** The figure model and its clips, or null until loaded. */
  model(model: "man" | "woman"): { scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] } | null;
  /** The player on foot: feet, eyes, speed, crouched; null when not on foot (at a wheel). */
  player(): { x: number; y: number; z: number; eye: number; speed: number; crouched: boolean; boat: boolean } | null;
  /** A round struck the player. */
  hurtPlayer(damage: number, fromX: number, fromZ: number): void;
  /** Daylight 1 … night 0.3. */
  light(): number;
  effects: {
    flash(at: THREE.Vector3, size: number): void;
    tracer(from: THREE.Vector3, to: THREE.Vector3): void;
    impact(at: THREE.Vector3, material: string): void;
  };
  /** A gunshot heard by the player, from `at`. */
  shotSound(kind: GunKind, at: THREE.Vector3): void;
  event(event: ActorEvent): void;
  /** The difficulty: 0.7 easy, 1 normal, 1.3 hard. */
  skill(): number;
};

type Status = "active" | "down" | "surrendered";

type Actor = {
  spec: ActorSpec;
  body: ActorBody | null;
  brain: ActorBrain | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Ground speed now, m/s. */
  speed: number;
  health: number;
  status: Status;
  pose: BodyPose;
  /** Where the story sends him (overrides his routine), with pace and what to do there. */
  order: { goal: Vec2; pace: "walk" | "run" | "creep"; face?: number; then?: Partial<BodyPose> } | null;
  /** His routine's progress: the route point he heads for, how long he has stood. */
  leg: number;
  dwell: number;
  /** A path through the level's ways, and the point of it he heads for. */
  path: Vec2[];
  pathGoal: Vec2 | null;
  pathClock: number;
  /** Cover he has taken (or is making for). */
  coverSpot: WorldPoint | null;
  /** Hits taken lately (a flinch), and shots fired (recoil). */
  flinch: number;
  recoil: number;
  /** The companion: who he follows, and his own fight. */
  follow: { leader: "player"; distance: number } | null;
  companionClock: number;
  /** Lines said once already. */
  said: Set<string>;
  /** Seconds since the player last shot at or near him (he is under fire). */
  underFire: number;
  hitFrom: Vec2 | null;
  shotAt: Vec2 | null;
  /** Seconds since a squad radio report went out from him. */
  reported: boolean;
  dropAmmo: boolean;
};

const DRAW_RANGE = 220;
const scratch = new THREE.Vector3();
const scratch2 = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const target = new THREE.Vector3();

export class ActorSystem {
  readonly group = new THREE.Group();
  private readonly actors = new Map<string, Actor>();
  private alert: "quiet" | "suspicious" | "combat" = "quiet";
  private readonly noises: { x: number; z: number; loudness: number; kind: "shot" | "step" | "impact" | "voice"; age: number }[] = [];
  private readonly reports = new Map<string, { at: Vec2; delay: number; combat: boolean }>();
  /** Ammunition lying where guards fell: rounds and where. */
  readonly pickups: { x: number; y: number; z: number; rounds: number }[] = [];
  private elapsed = 0;

  constructor(
    private readonly host: ActorHost,
    private readonly levels: LevelSystem,
  ) {
    this.group.name = "StoryActors";
  }

  // --- The roster --------------------------------------------------------------

  has(id: string): boolean {
    return this.actors.has(id);
  }

  ids(): string[] {
    return [...this.actors.keys()];
  }

  /** Puts a person in the world (at his spawn, or at `at`), on his routine. `status` restores one already dealt with. */
  spawn(spec: ActorSpec, at: WorldPoint | null = null, status: Status = "active"): void {
    if (this.actors.has(spec.id)) return;
    const spot = at ?? this.levels.spot(spec.spawn);
    if (!spot) return;
    const hostileOrAlly = spec.faction === "hostile";
    const actor: Actor = {
      spec,
      body: null,
      brain: hostileOrAlly ? new ActorBrain(GUARD_TUNING, !spec.stubborn) : null,
      x: spot.x,
      y: spot.y,
      z: spot.z,
      yaw: spot.yaw,
      speed: 0,
      health: spec.health ?? 100,
      status,
      pose: restPose(),
      order: null,
      leg: 0,
      dwell: 0,
      path: [],
      pathGoal: null,
      pathClock: 0,
      coverSpot: null,
      flinch: 0,
      recoil: 0,
      follow: null,
      companionClock: 0,
      said: new Set(),
      underFire: 99,
      hitFrom: null,
      shotAt: null,
      reported: false,
      dropAmmo: false,
    };
    actor.y = this.host.ground(spot.x, spot.z, spot.y + 0.3);
    if (status === "down") {
      actor.pose.down = 1;
      actor.brain?.knockDown();
    } else if (status === "surrendered") {
      actor.pose.surrender = 1;
      actor.brain?.release("surrender");
    }
    if (spec.routine.kind === "sit") {
      actor.pose.sit = 1;
      actor.pose.seat = spec.routine.seat ?? 0.48;
    }
    if (spec.routine.kind === "hold") actor.brain?.script();
    this.actors.set(spec.id, actor);
  }

  remove(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.body?.dispose();
    this.actors.delete(id);
  }

  clear(): void {
    for (const id of [...this.actors.keys()]) this.remove(id);
    this.pickups.length = 0;
    this.noises.length = 0;
    this.reports.clear();
    this.alert = "quiet";
  }

  status(id: string): Status | null {
    return this.actors.get(id)?.status ?? null;
  }

  /** Where he is (feet) and faces, or null. */
  where(id: string): { x: number; y: number; z: number; yaw: number } | null {
    const actor = this.actors.get(id);
    return actor ? { x: actor.x, y: actor.y, z: actor.z, yaw: actor.yaw } : null;
  }

  /** His head (for a camera to look at), or his feet + 1.6 m before he is drawn. */
  headOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const actor = this.actors.get(id);
    if (!actor) return null;
    if (actor.body) return out.copy(actor.body.head);
    return out.set(actor.x, actor.y + 1.6 - actor.pose.crouch * 0.4, actor.z);
  }

  get alertLevel(): "quiet" | "suspicious" | "combat" {
    return this.alert;
  }

  /** How many of a squad still stand (not down, not given up). */
  standing(squad: string): number {
    let count = 0;
    for (const actor of this.actors.values()) if (actor.spec.squad === squad && actor.status === "active") count += 1;
    return count;
  }

  // --- The story's hand ---------------------------------------------------------

  /** Puts him at a spot at once. */
  place(id: string, at: WorldPoint): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.x = at.x;
    actor.z = at.z;
    actor.y = this.host.ground(at.x, at.z, at.y + 0.3);
    actor.yaw = at.yaw;
    actor.path = [];
    actor.pathGoal = null;
  }

  /** Sends him somewhere (a spot) at a pace; he stops there facing its way, posed as `then` says. */
  order(id: string, at: WorldPoint, pace: "walk" | "run" | "creep" = "walk", then?: Partial<BodyPose>): void {
    const actor = this.actors.get(id);
    if (!actor || actor.status !== "active") return;
    actor.order = { goal: { x: at.x, z: at.z }, pace, face: at.yaw, then };
    actor.brain?.script();
    actor.path = [];
    actor.pathGoal = null;
  }

  /** Lets him go back to his own will (his routine, or the fight if there is one). */
  release(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.order = null;
    if (actor.status === "active") actor.brain?.release(this.alert === "combat" ? "combat" : "routine");
    if (this.alert === "combat") actor.brain?.alarm(this.lastAlarm ?? { x: actor.x, z: actor.z }, true);
  }

  /** Changes a pose by hand (sitting down, hands up, talking). */
  pose(id: string, pose: Partial<BodyPose>): void {
    const actor = this.actors.get(id);
    if (actor) Object.assign(actor.pose, pose);
  }

  /** Makes him a companion of the player, keeping about `distance` behind. */
  setFollow(id: string, on: boolean, distance = 4): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.follow = on ? { leader: "player", distance } : null;
    if (on) actor.order = null;
  }

  /** The whole squad is told the intruder is at `at` (a tripped alarm, the commander's arrival). */
  alarmSquad(squad: string, at: Vec2, combat: boolean): void {
    for (const actor of this.actors.values()) if (actor.spec.squad === squad && actor.status === "active") actor.brain?.alarm(at, combat);
    if (combat) this.lastAlarm = { ...at };
  }

  private lastAlarm: Vec2 | null = null;

  // --- The player's hand ---------------------------------------------------------

  /**
   * A round from the player: from `origin` along unit `dir`. The first thing
   * it strikes — a person (the head counts double) or the level — within
   * `range`; who was hit, and where the round stopped. `power` 0 does no harm.
   */
  playerShot(origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number): { id: string | null; at: THREE.Vector3; material: string } {
    const wall = this.levels.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, (solid) => solid.stopsRounds !== false);
    let limit = wall ? wall.t : range;
    let best: { actor: Actor; t: number; head: boolean } | null = null;
    for (const actor of this.actors.values()) {
      if (!actor.body || actor.status === "down") continue;
      for (const [centre, radius, head] of [
        [actor.body.head, 0.14, true],
        [actor.body.chest, 0.26, false],
        [actor.body.hips, 0.22, false],
      ] as const) {
        const t = raySphere(origin, dir, centre, radius);
        if (t !== null && t < limit) {
          limit = t;
          best = { actor, t, head };
        }
      }
    }
    // Every guard near the round's path hears it go by.
    this.noise(origin.x, origin.z, 1, "shot");
    for (const actor of this.actors.values()) {
      if (actor.status !== "active" || actor.spec.faction !== "hostile") continue;
      scratch.set(actor.x, actor.y + 1.4, actor.z);
      const along = scratch.sub(origin).dot(dir);
      if (along < 0 || along > limit + 2) continue;
      const miss = scratch2.copy(origin).addScaledVector(dir, along).distanceTo(target.set(actor.x, actor.y + 1.4, actor.z));
      if (miss < 3.5) {
        actor.shotAt = { x: origin.x, z: origin.z };
        actor.underFire = 0;
      }
    }
    const at = origin.clone().addScaledVector(dir, limit);
    if (best) {
      const actor = best.actor;
      if (damage > 0) this.hurt(actor, best.head ? damage * 3 : damage, { x: origin.x, z: origin.z }, "player");
      return { id: actor.spec.id, at, material: "flesh" };
    }
    return { id: null, at, material: wall?.solid.material ?? "ground" };
  }

  /** A guard within reach who has not seen the player and has his back to him, for a takedown; else null. */
  takedownTarget(x: number, z: number): string | null {
    for (const actor of this.actors.values()) {
      if (actor.status !== "active" || actor.spec.faction !== "hostile" || !actor.brain) continue;
      if (actor.brain.state === "combat") continue;
      const distance = Math.hypot(actor.x - x, actor.z - z);
      if (distance > 1.5) continue;
      // Behind him: the player is off his facing by more than 100°.
      const toPlayer = Math.atan2(x - actor.x, z - actor.z);
      const off = Math.abs(Math.atan2(Math.sin(toPlayer - actor.yaw), Math.cos(toPlayer - actor.yaw)));
      if (off > 1.75 || actor.pose.sit > 0.5) return actor.spec.id;
    }
    return null;
  }

  /** The player puts a guard down quietly (out cold, not dead). */
  takedown(id: string): void {
    const actor = this.actors.get(id);
    if (!actor || actor.status !== "active") return;
    this.knockDown(actor, false, "takedown");
  }

  /** Picks up ammunition lying within reach; the rounds taken. */
  pickUp(x: number, z: number, reach = 1.6): number {
    let rounds = 0;
    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index]!;
      if (Math.hypot(pickup.x - x, pickup.z - z) > reach) continue;
      rounds += pickup.rounds;
      this.pickups.splice(index, 1);
    }
    return rounds;
  }

  /** A noise in the world (a footfall, a voice, the player's own shot), heard by guards near. */
  noise(x: number, z: number, loudness: number, kind: "shot" | "step" | "impact" | "voice"): void {
    this.noises.push({ x, z, loudness, kind, age: 0 });
  }

  // --- Each frame -----------------------------------------------------------------

  update(dt: number, camera: THREE.Vector3): void {
    this.elapsed += dt;
    const player = this.host.player();
    for (const noise of this.noises) noise.age += dt;
    for (let index = this.noises.length - 1; index >= 0; index -= 1) if (this.noises[index]!.age > 0.25) this.noises.splice(index, 1);
    // The radio: a report from one in a fight reaches the squad after a moment.
    for (const [squad, report] of this.reports) {
      report.delay -= dt;
      if (report.delay > 0) continue;
      this.alarmSquad(squad, report.at, report.combat);
      this.reports.delete(squad);
    }
    let anyCombat = false;
    let anySuspicious = false;
    for (const actor of this.actors.values()) {
      this.think(actor, dt, player);
      this.move(actor, dt);
      this.draw(actor, dt, camera);
      if (actor.brain && actor.status === "active") {
        if (actor.brain.state === "combat") anyCombat = true;
        else if (actor.brain.state === "suspicious" || actor.brain.state === "search") anySuspicious = true;
      }
    }
    const level = anyCombat ? "combat" : anySuspicious ? "suspicious" : "quiet";
    if (level !== this.alert) {
      this.alert = level;
      this.host.event({ kind: "alert", level });
    }
  }

  private think(actor: Actor, dt: number, player: ReturnType<ActorHost["player"]>): void {
    actor.flinch = Math.max(0, actor.flinch - dt * 3);
    actor.recoil = Math.max(0, actor.recoil - dt * 8);
    actor.underFire += dt;
    if (actor.status === "down") {
      actor.pose.down = Math.min(1, actor.pose.down + dt * 2.2);
      actor.speed = 0;
      return;
    }
    if (actor.status === "surrendered") {
      actor.pose.surrender = Math.min(1, actor.pose.surrender + dt * 2.5);
      actor.pose.ready = 0;
      actor.speed = 0;
      if (player) actor.pose.aim = target.set(player.x, player.y + 1.6, player.z).clone();
      return;
    }
    if (actor.follow) {
      this.companion(actor, dt, player);
      return;
    }
    const brain = actor.brain;
    if (!brain || actor.order) {
      this.obey(actor, dt);
      return;
    }
    const senses = this.sense(actor, player);
    const home = this.routineGoal(actor, dt);
    const intent = brain.think(dt, senses, home);
    actor.hitFrom = null;
    actor.shotAt = null;
    // Report to the squad when the fight starts (once).
    if (brain.state === "combat" && !actor.reported && actor.spec.squad && brain.lastKnown) {
      actor.reported = true;
      if (!this.reports.has(actor.spec.squad)) this.reports.set(actor.spec.squad, { at: { ...brain.lastKnown }, delay: 1.6, combat: true });
    }
    if (brain.state === "surrender" && actor.status === "active") {
      actor.status = "surrendered";
      actor.body?.dropGun(scratch.set(actor.x + Math.sin(actor.yaw) * 0.6, actor.y, actor.z + Math.cos(actor.yaw) * 0.6));
      this.host.event({ kind: "surrender", id: actor.spec.id });
    }
    for (const bark of brain.barks.splice(0)) this.bark(actor, bark);
    // The intent, into motion and pose.
    actor.pose.ready += ((intent.ready ? 1 : 0) - actor.pose.ready) * Math.min(1, dt * 5);
    actor.pose.crouch += ((intent.crouch ? 1 : 0) - actor.pose.crouch) * Math.min(1, dt * 5);
    actor.pose.aim = intent.aim ? new THREE.Vector3(intent.aim.x, this.aimHeight(intent.aim, player), intent.aim.z) : null;
    let goal = intent.goal;
    if (intent.cover && brain.lastKnown) {
      goal = this.coverFor(actor, brain.lastKnown, goal);
    }
    this.steer(actor, goal, intent.pace, dt);
    if (intent.fire && player) this.fire(actor, player);
  }

  private aimHeight(at: Vec2, player: ReturnType<ActorHost["player"]>): number {
    if (player && Math.hypot(player.x - at.x, player.z - at.z) < 3) return player.y + (player.crouched ? 0.9 : 1.35);
    return this.host.ground(at.x, at.z) + 1.2;
  }

  /** What a guard takes in this frame. */
  private sense(actor: Actor, player: ReturnType<ActorHost["player"]>): Senses {
    const senses: Senses = {
      sight: 0,
      player: { x: 0, z: 0 },
      heard: null,
      body: null,
      report: null,
      hitFrom: actor.hitFrom,
      shotAt: actor.underFire < 0.3 ? actor.shotAt ?? null : null,
      squadStanding: actor.spec.squad ? this.standing(actor.spec.squad) : 1,
      distance: 999,
      health: actor.health / (actor.spec.health ?? 100),
    };
    const eyeY = actor.y + 1.6 - actor.pose.crouch * 0.45 - actor.pose.sit * 0.45;
    if (player && !player.boat) {
      senses.player = { x: player.x, z: player.z };
      const dx = player.x - actor.x;
      const dz = player.z - actor.z;
      const distance = Math.hypot(dx, dz);
      senses.distance = distance;
      if (distance < 80) {
        let off = Math.atan2(dx, dz) - actor.yaw;
        off = Math.atan2(Math.sin(off), Math.cos(off));
        const targetY = player.y + (player.crouched ? 0.9 : 1.4);
        const clear = this.levels.canSee(actor.x, eyeY, actor.z, player.x, targetY, player.z) && this.overGround(actor.x, eyeY, actor.z, player.x, targetY, player.z);
        senses.sight = sightOf({
          distance,
          angle: off,
          clear,
          crouched: player.crouched,
          moving: player.speed,
          alert: actor.brain !== null && actor.brain.state !== "routine",
          light: this.host.light(),
        });
        // Footfalls, near.
        const step = player.crouched ? 0 : player.speed > 3.5 ? 0.55 : player.speed > 0.5 ? 0.3 : 0;
        if (step > 0 && distance < (player.speed > 3.5 ? 9 : 4)) senses.heard = { at: { x: player.x, z: player.z }, loudness: step * (1 - distance / 10), kind: "step" };
      }
    }
    for (const noise of this.noises) {
      const distance = Math.hypot(noise.x - actor.x, noise.z - actor.z);
      const reach = noise.kind === "shot" ? 90 : noise.kind === "impact" ? 25 : 10;
      const loudness = noise.loudness * (1 - distance / reach);
      if (loudness > (senses.heard?.loudness ?? 0)) senses.heard = { at: { x: noise.x, z: noise.z }, loudness, kind: noise.kind };
    }
    // A mate lying in plain view.
    for (const other of this.actors.values()) {
      if (other === actor || other.status !== "down" || other.spec.squad !== actor.spec.squad) continue;
      const distance = Math.hypot(other.x - actor.x, other.z - actor.z);
      if (distance > 22) continue;
      let off = Math.atan2(other.x - actor.x, other.z - actor.z) - actor.yaw;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) < 1.1 && this.levels.canSee(actor.x, eyeY, actor.z, other.x, other.y + 0.3, other.z)) {
        senses.body = { x: other.x, z: other.z };
        break;
      }
    }
    return senses;
  }

  /** Whether the line between two points clears the hills (the natural ground) along it. */
  private overGround(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.min(24, Math.floor(length / 3));
    for (let index = 1; index < steps; index += 1) {
      const t = index / steps;
      if (this.host.terrain(ax + (bx - ax) * t, az + (bz - az) * t) > ay + (by - ay) * t - 0.1) return false;
    }
    return true;
  }

  /** Where his routine takes him now (his post, the next point of his round), or null to stay. */
  private routineGoal(actor: Actor, dt: number): Vec2 | null {
    const routine = actor.spec.routine;
    if (routine.kind === "patrol") {
      const route = this.levels.route(routine.route);
      if (!route || route.length === 0) return null;
      const point = route[actor.leg % route.length]!;
      if (Math.hypot(point.x - actor.x, point.z - actor.z) < 0.6) {
        actor.dwell += dt;
        if (actor.dwell > (routine.pause ?? 3)) {
          actor.dwell = 0;
          actor.leg += 1;
        }
        return null;
      }
      return point;
    }
    if (routine.kind === "work") {
      const spot = this.levels.spot(routine.spots[actor.leg % routine.spots.length]!);
      if (!spot) return null;
      if (Math.hypot(spot.x - actor.x, spot.z - actor.z) < 0.6) {
        actor.dwell += dt;
        if (actor.dwell > routine.dwell) {
          actor.dwell = 0;
          actor.leg += 1;
        }
        return null;
      }
      return spot;
    }
    const home = this.levels.spot(actor.spec.spawn);
    if (!home) return null;
    return Math.hypot(home.x - actor.x, home.z - actor.z) > 0.8 ? home : null;
  }

  /** A scripted walk to the story's spot; there, the pose it asks for. */
  private obey(actor: Actor, dt: number): void {
    const order = actor.order;
    if (!order) {
      actor.speed = 0;
      return;
    }
    const distance = Math.hypot(order.goal.x - actor.x, order.goal.z - actor.z);
    if (distance < 0.35) {
      actor.speed = 0;
      if (order.face !== undefined) actor.yaw = turnToward(actor.yaw, order.face, dt * 4);
      if (order.then) Object.assign(actor.pose, order.then);
      return;
    }
    actor.pose.crouch += ((order.pace === "creep" ? 1 : 0) - actor.pose.crouch) * Math.min(1, dt * 5);
    this.steer(actor, order.goal, order.pace, dt);
  }

  /**
   * The companion: near the player, crouching when he crouches; in a fight,
   * to cover near him and firing back (sparingly: he will not fight the
   * player's fight for him, but a guard shooting at the player may go down).
   */
  private companion(actor: Actor, dt: number, player: ReturnType<ActorHost["player"]>): void {
    if (!player || player.boat) {
      actor.speed = 0;
      return;
    }
    const follow = actor.follow!;
    const dx = actor.x - player.x;
    const dz = actor.z - player.z;
    const distance = Math.hypot(dx, dz);
    const combat = this.alert === "combat";
    actor.pose.crouch += ((player.crouched || combat ? 1 : 0) - actor.pose.crouch) * Math.min(1, dt * 4);
    let goal: Vec2 | null = null;
    if (distance > follow.distance + 1.5) {
      // A place a little behind and to the side of the player.
      const back = Math.max(1, follow.distance);
      goal = { x: player.x + (dx / distance) * back, z: player.z + (dz / distance) * back };
    }
    // The nearest hostile in a fight, to watch and to fire at.
    let threat: Actor | null = null;
    let threatDistance = 45;
    for (const other of this.actors.values()) {
      if (other.status !== "active" || other.spec.faction !== "hostile" || other.brain?.state !== "combat") continue;
      const d = Math.hypot(other.x - actor.x, other.z - actor.z);
      if (d < threatDistance && this.levels.canSee(actor.x, actor.y + 1.3, actor.z, other.x, other.y + 1.3, other.z)) {
        threat = other;
        threatDistance = d;
      }
    }
    if (combat && threat) {
      goal = this.coverFor(actor, { x: threat.x, z: threat.z }, goal ?? { x: actor.x, z: actor.z });
      actor.pose.ready += (1 - actor.pose.ready) * Math.min(1, dt * 5);
      actor.pose.aim = new THREE.Vector3(threat.x, threat.y + 1.2, threat.z);
      actor.companionClock -= dt;
      if (actor.companionClock <= 0) {
        actor.companionClock = 1.8 + Math.random() * 1.6;
        this.flashShot(actor, actor.pose.aim);
        // Only a threat to the player: a guard who is firing at him.
        if (threat.recoil > 0 || threat.underFire < 4) {
          if (Math.random() < 0.3) this.hurt(threat, 60, { x: actor.x, z: actor.z }, "ally");
        }
      }
    } else {
      actor.pose.ready += (0.15 - actor.pose.ready) * Math.min(1, dt * 3);
      actor.pose.aim = distance < 8 ? new THREE.Vector3(player.x, player.y + 1.5, player.z) : null;
    }
    this.steer(actor, goal, distance > 12 ? "run" : player.crouched ? "creep" : "walk", dt);
  }

  /** Cover between him and the threat near `near` (or where he is), else `near` itself. */
  private coverFor(actor: Actor, threat: Vec2, near: Vec2 | null): Vec2 | null {
    const around = near ?? { x: actor.x, z: actor.z };
    if (actor.coverSpot && Math.hypot(actor.coverSpot.x - around.x, actor.coverSpot.z - around.z) < 10 && this.levels.floorAt(actor.coverSpot.x, actor.coverSpot.z, actor.y + 0.5) > -100) {
      if (this.coveredFrom(actor.coverSpot, threat)) return actor.coverSpot;
    }
    let best: WorldPoint | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const spot of this.levels.coversNear(around.x, around.z, 14)) {
      // Not one another guard holds.
      let taken = false;
      for (const other of this.actors.values()) if (other !== actor && other.coverSpot === spot) taken = true;
      if (taken || !this.coveredFrom(spot, threat)) continue;
      const score = Math.hypot(spot.x - actor.x, spot.z - actor.z) + Math.abs(Math.hypot(spot.x - threat.x, spot.z - threat.z) - 16) * 0.4;
      if (score < bestScore) {
        bestScore = score;
        best = spot;
      }
    }
    actor.coverSpot = best;
    return best ?? near;
  }

  private coveredFrom(spot: WorldPoint, threat: Vec2): boolean {
    return !this.levels.canSee(spot.x, spot.y + 0.9, spot.z, threat.x, this.host.ground(threat.x, threat.z) + 1.4, threat.z);
  }

  /** Walks him toward `goal` along the level (straight where he can, sliding along walls). */
  private steer(actor: Actor, goal: Vec2 | null, pace: "walk" | "run" | "creep", dt: number): void {
    if (!goal || Math.hypot(goal.x - actor.x, goal.z - actor.z) < 0.4) {
      actor.speed += (0 - actor.speed) * Math.min(1, dt * 8);
      if (actor.pose.aim) actor.yaw = turnToward(actor.yaw, Math.atan2(actor.pose.aim.x - actor.x, actor.pose.aim.z - actor.z), dt * 3.5);
      return;
    }
    const wanted = pace === "run" ? 3.6 : pace === "creep" ? 1.1 : 1.35;
    actor.speed += (wanted - actor.speed) * Math.min(1, dt * 4);
    // The way there: straight if nothing stands between, else along the level's way-points.
    actor.pathClock -= dt;
    if (!actor.pathGoal || Math.hypot(actor.pathGoal.x - goal.x, actor.pathGoal.z - goal.z) > 1.5 || actor.pathClock <= 0) {
      actor.pathGoal = { ...goal };
      actor.pathClock = 2.5;
      const goalY = this.host.ground(goal.x, goal.z, actor.y + 3);
      const straight = Math.abs(goalY - actor.y) < 1.2 && this.levels.canSee(actor.x, actor.y + 0.6, actor.z, goal.x, goalY + 0.6, goal.z);
      actor.path = straight ? [] : this.levels.path(actor.x, actor.y, actor.z, goal.x, goalY, goal.z).map((point) => ({ x: point.x, z: point.z }));
    }
    while (actor.path.length > 0 && Math.hypot(actor.path[0]!.x - actor.x, actor.path[0]!.z - actor.z) < 0.6) actor.path.shift();
    const next = actor.path[0] ?? goal;
    const heading = Math.atan2(next.x - actor.x, next.z - actor.z);
    // Faces where he goes, unless aiming while he moves (then he sidesteps).
    const facing = actor.pose.aim && actor.pose.ready > 0.5 ? Math.atan2(actor.pose.aim.x - actor.x, actor.pose.aim.z - actor.z) : heading;
    actor.yaw = turnToward(actor.yaw, facing, dt * 5);
    const step = actor.speed * dt;
    const tryMove = (angle: number): boolean => {
      const nx = actor.x + Math.sin(angle) * step;
      const nz = actor.z + Math.cos(angle) * step;
      const ny = this.host.ground(nx, nz, actor.y);
      if (ny - actor.y > 0.45) return false;
      if (this.levels.blocked(nx, nz, ny, 0.3, actor.pose.crouch > 0.5 ? 1.2 : 1.8)) return false;
      actor.x = nx;
      actor.z = nz;
      actor.y = ny;
      return true;
    };
    if (!tryMove(heading) && !tryMove(heading + 0.7) && !tryMove(heading - 0.7) && !tryMove(heading + 1.5) && !tryMove(heading - 1.5)) actor.speed *= 0.5;
  }

  private move(actor: Actor, dt: number): void {
    // Settle onto whatever is underfoot (a step down, a stair).
    const ground = this.host.ground(actor.x, actor.z, actor.y);
    if (Number.isFinite(ground)) actor.y += (ground - actor.y) * Math.min(1, dt * 12);
    actor.pose.speed = actor.speed;
    actor.pose.flinch = actor.flinch;
    actor.pose.recoil = actor.recoil;
  }

  private draw(actor: Actor, dt: number, camera: THREE.Vector3): void {
    const distance = Math.hypot(actor.x - camera.x, actor.z - camera.z);
    if (!actor.body) {
      if (distance > DRAW_RANGE) return;
      const model = this.host.model(actor.spec.look.model);
      if (!model) return;
      try {
        actor.body = new ActorBody(model.scene, model.animations, actor.spec.look, actor.spec.gun ?? null);
      } catch (error) {
        console.warn("A story figure could not be built.", error);
        return;
      }
      if (actor.status === "down") actor.body.dropGun(null);
      this.group.add(actor.body.root);
    }
    actor.body.root.visible = distance < DRAW_RANGE + 40;
    if (!actor.body.root.visible) return;
    actor.body.update(dt, actor.x, actor.y, actor.z, actor.yaw, actor.pose);
  }

  private fire(actor: Actor, player: NonNullable<ReturnType<ActorHost["player"]>>): void {
    const body = actor.body;
    if (!body || !body.hasGun) return;
    actor.recoil = 1;
    const aimPoint = target.set(player.x, player.y + (player.crouched ? 0.9 : 1.3), player.z);
    muzzle.copy(body.muzzle);
    const distance = muzzle.distanceTo(aimPoint);
    const covered = player.crouched && this.levels.blocked(player.x, player.z, player.y, 1.2, 1.0);
    const chance = hitChance({
      distance,
      targetMoving: player.speed,
      targetCrouched: player.crouched,
      targetCovered: covered || !this.levels.canSee(muzzle.x, muzzle.y, muzzle.z, aimPoint.x, aimPoint.y, aimPoint.z),
      shooterMoving: actor.speed > 0.6,
      skill: (actor.spec.skill ?? 1) * this.host.skill(),
    });
    const kind = actor.spec.gun ?? "carbine";
    this.host.effects.flash(muzzle, kind === "carbine" ? 0.5 : 0.35);
    this.host.shotSound(kind, muzzle);
    this.noise(actor.x, actor.z, 1, "shot");
    if (Math.random() < chance) {
      this.host.effects.tracer(muzzle, aimPoint);
      const damage = kind === "carbine" ? 16 : 12;
      this.host.hurtPlayer(damage, actor.x, actor.z);
      this.host.event({ kind: "playerHit", id: actor.spec.id, damage });
    } else {
      // A miss: past him, into whatever is behind.
      const direction = scratch.subVectors(aimPoint, muzzle).normalize();
      direction.x += (Math.random() - 0.5) * 0.08;
      direction.y += (Math.random() - 0.3) * 0.06;
      direction.z += (Math.random() - 0.5) * 0.08;
      direction.normalize();
      const hit = this.levels.raycast(muzzle.x, muzzle.y, muzzle.z, direction.x, direction.y, direction.z, distance + 30);
      const end = hit ? scratch2.set(hit.x, hit.y, hit.z) : scratch2.copy(muzzle).addScaledVector(direction, distance + 30);
      this.host.effects.tracer(muzzle, end);
      if (hit) this.host.effects.impact(end, hit.solid.material ?? "concrete");
    }
  }

  /** The companion's shot, for the look and the sound. */
  private flashShot(actor: Actor, at: THREE.Vector3): void {
    const body = actor.body;
    if (!body) return;
    actor.recoil = 1;
    muzzle.copy(body.muzzle);
    this.host.effects.flash(muzzle, 0.5);
    this.host.effects.tracer(muzzle, at);
    this.host.shotSound(actor.spec.gun ?? "carbine", muzzle);
  }

  private hurt(actor: Actor, damage: number, from: Vec2, by: "player" | "ally"): void {
    if (actor.status === "down") return;
    if (actor.spec.immortal) {
      actor.flinch = 1;
      return;
    }
    actor.health -= damage;
    actor.flinch = 1;
    actor.hitFrom = { ...from };
    if (actor.status === "surrendered" && damage > 0) {
      this.knockDown(actor, true, by);
      return;
    }
    if (actor.health <= 0) this.knockDown(actor, true, by);
  }

  private knockDown(actor: Actor, lethal: boolean, by: "player" | "ally" | "takedown"): void {
    actor.status = "down";
    actor.brain?.knockDown();
    actor.order = null;
    actor.follow = null;
    actor.pose.ready = 0;
    actor.pose.surrender = 0;
    actor.pose.sit = 0;
    actor.pose.fallBack = Math.random() < 0.6;
    if (actor.spec.gun) {
      // His magazine for the taking.
      this.pickups.push({ x: actor.x + Math.sin(actor.yaw) * 0.5, y: actor.y, z: actor.z + Math.cos(actor.yaw) * 0.5, rounds: actor.spec.gun === "pistol" ? 12 : 8 });
    }
    actor.body?.dropGun(scratch.set(actor.x + Math.sin(actor.yaw + 0.8) * 0.7, actor.y, actor.z + Math.cos(actor.yaw + 0.8) * 0.7));
    this.host.event({ kind: "down", id: actor.spec.id, lethal, by });
  }

  private bark(actor: Actor, bark: Bark): void {
    const lines = actor.spec.barks?.[bark];
    if (!lines || lines.length === 0 || actor.said.has(bark)) return;
    actor.said.add(bark);
    const text = lines[Math.floor(Math.random() * lines.length)]!;
    this.host.event({ kind: "bark", id: actor.spec.id, character: actor.spec.character ?? actor.spec.id, text });
  }

  /** Every actor's status, for a checkpoint. */
  statuses(): Record<string, Status> {
    const out: Record<string, Status> = {};
    for (const [id, actor] of this.actors) out[id] = actor.status;
    return out;
  }

  /** The bodies as seen (for a scene's camera): the actor's root, or null. */
  bodyOf(id: string): THREE.Object3D | null {
    return this.actors.get(id)?.body?.root ?? null;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}

function turnToward(current: number, wanted: number, step: number): number {
  let delta = wanted - current;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  return current + Math.max(-step, Math.min(step, delta));
}

/** The distance along a ray (unit `dir`) to a sphere, or null. */
function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, centre: THREE.Vector3, radius: number): number | null {
  const ox = origin.x - centre.x;
  const oy = origin.y - centre.y;
  const oz = origin.z - centre.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}
