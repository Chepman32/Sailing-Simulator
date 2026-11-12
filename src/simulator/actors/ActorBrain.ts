/**
 * What a person in the story does next, from what he has seen and heard: a
 * guard at his post, a guard who heard something and goes to look, a guard
 * in a fight, one who has had enough; a companion keeping near the player.
 * Free of three.js and of the scene: the senses come in as numbers, the
 * intentions go out as numbers (`ActorSystem` moves the body and fires the
 * gun). M01's rules, set out in its script:
 *
 * - suspicion before certainty: a glimpse makes him look, a voice comes
 *   first ("Слышали?"), a search goes to the last known place and dies away
 *   if nothing more is found;
 * - in a fight he takes cover, moves in short rushes, gives a wounded mate
 *   a hand, never charges a gun with bare hands, never shoots without a
 *   moment to make out his target;
 * - the last of a group, cut off and outgunned, may throw down his weapon.
 */

export type Vec2 = { x: number; z: number };

export type BrainState = "routine" | "suspicious" | "search" | "combat" | "down" | "surrender" | "scripted" | "follow";

export type Alertness = "quiet" | "suspicious" | "combat";

export type Senses = {
  /** How plainly he makes out the player now (0 not at all … 1 in full view, near). */
  sight: number;
  /** Where the player is (whether seen or not; read only when seen or heard). */
  player: Vec2;
  /** The loudest thing heard this frame, with how loud it was where he stands (0…1), or null. */
  heard: { at: Vec2; loudness: number; kind: "shot" | "step" | "impact" | "voice" } | null;
  /** A mate lying where he can see him, or null. */
  body: Vec2 | null;
  /** The squad's radio: a contact reported somewhere, or null. */
  report: Vec2 | null;
  /** He has just been hit, from where. */
  hitFrom: Vec2 | null;
  /** He is under fire (rounds passing near), from where. */
  shotAt: Vec2 | null;
  /** How many of his squad still stand, and how near the player is, m. */
  squadStanding: number;
  distance: number;
  /** His health, 0…1. */
  health: number;
};

export type Intent = {
  /** Where to go (null: stay), how fast, crouched or not. */
  goal: Vec2 | null;
  pace: "walk" | "run" | "creep";
  crouch: boolean;
  /** Where to look and point the gun (null: where he walks). */
  aim: Vec2 | null;
  /** Gun up (at the shoulder) and whether to fire this frame. */
  ready: boolean;
  fire: boolean;
  /** Seek cover near the goal (the system picks the spot). */
  cover: boolean;
};

/** What he says, by occasion (the system turns a key into the actor's line, once each). */
export type Bark =
  | "noticed"
  | "contact"
  | "firstShot"
  | "lost"
  | "manDown"
  | "wounded"
  | "surrender"
  | "regroup"
  | "searchEnd";

export type BrainTuning = {
  /** Seconds of full view before he is sure (a glimpse makes him only suspicious). */
  recognise: number;
  /** Seconds he needs, once sure and with a line of fire, before his first shot. */
  firstShotDelay: number;
  /** Seconds between shots of a burst, and between bursts. */
  shotInterval: number;
  burst: number;
  burstPause: number;
  /** Seconds a search lasts without anything new. */
  searchTime: number;
  /** Health under which he looks to give up, if he is the last. */
  surrenderHealth: number;
};

export const GUARD_TUNING: BrainTuning = {
  recognise: 1.35,
  firstShotDelay: 0.9,
  shotInterval: 0.16,
  burst: 3,
  burstPause: 1.5,
  searchTime: 26,
  surrenderHealth: 0.75,
};

export class ActorBrain {
  state: BrainState = "routine";
  /** How sure he is that someone is there (0…1; 1: certain). */
  suspicion = 0;
  /** Where he believes the intruder is, and since when he has not seen him. */
  lastKnown: Vec2 | null = null;
  unseenFor = 0;
  private stateTime = 0;
  private aimTime = 0;
  private burstLeft = 0;
  private shotClock = 0;
  private rushClock = 0;
  private covering = true;
  /** Lines due, said by the system and cleared. */
  readonly barks: Bark[] = [];
  private said = new Set<Bark>();

  constructor(
    readonly tuning: BrainTuning = GUARD_TUNING,
    /** Whether this one may surrender (a commander does not, a companion is never asked). */
    readonly canSurrender = true,
  ) {}

  get alertness(): Alertness {
    if (this.state === "combat") return "combat";
    if (this.state === "suspicious" || this.state === "search") return "suspicious";
    return "quiet";
  }

  private bark(key: Bark, once = true): void {
    if (once && this.said.has(key)) return;
    this.said.add(key);
    this.barks.push(key);
  }

  private enter(state: BrainState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
    if (state === "combat") {
      this.aimTime = 0;
      this.burstLeft = 0;
      this.shotClock = 0;
    }
  }

  /** Down for good (or out cold). */
  knockDown(): void {
    this.enter("down");
  }

  /** The story takes him (a scene, an order): no will of his own until `release`. */
  script(): void {
    this.enter("scripted");
  }

  release(state: BrainState = "routine"): void {
    this.enter(state);
  }

  /** Told by the squad's radio that the intruder is at `at`. */
  alarm(at: Vec2, combat: boolean): void {
    if (this.state === "down" || this.state === "surrender" || this.state === "scripted") return;
    this.lastKnown = { ...at };
    this.unseenFor = 0;
    if (combat) {
      this.suspicion = 1;
      this.enter("combat");
    } else if (this.state === "routine") {
      this.suspicion = Math.max(this.suspicion, 0.5);
      this.enter("search");
    }
  }

  /**
   * One frame: senses in, intent out. `home` is where his routine has him
   * (his post, the next point of his round).
   */
  think(dt: number, senses: Senses, home: Vec2 | null): Intent {
    this.stateTime += dt;
    const intent: Intent = { goal: home, pace: "walk", crouch: false, aim: null, ready: false, fire: false, cover: false };
    if (this.state === "down" || this.state === "scripted") {
      intent.goal = null;
      return intent;
    }
    if (this.state === "surrender") {
      intent.goal = null;
      intent.aim = senses.player;
      return intent;
    }

    // --- What he takes in -------------------------------------------------
    const seen = senses.sight > 0.02;
    if (seen) {
      // A glimpse adds a little; full view near, a lot.
      const rate = senses.sight / this.tuning.recognise;
      this.suspicion = Math.min(1, this.suspicion + rate * dt * (this.state === "combat" || this.state === "search" ? 2.2 : 1));
      this.lastKnown = { ...senses.player };
      this.unseenFor = 0;
    } else {
      this.unseenFor += dt;
      // Doubt creeps back while nothing more is seen (slowly in a fight).
      const fade = this.state === "combat" ? 0.012 : this.state === "search" ? 0.025 : 0.08;
      this.suspicion = Math.max(0, this.suspicion - fade * dt);
    }
    if (senses.hitFrom || senses.shotAt) {
      this.suspicion = 1;
      this.lastKnown = { ...(senses.hitFrom ?? senses.shotAt)! };
      if (this.state !== "combat") this.bark("firstShot");
      this.enter("combat");
    }
    if (senses.heard) {
      const { kind, loudness, at } = senses.heard;
      if (kind === "shot" && loudness > 0.05) {
        this.suspicion = 1;
        this.lastKnown = { ...at };
        if (this.state !== "combat") this.bark("firstShot");
        this.enter("combat");
      } else if (loudness > 0.25 && this.state === "routine") {
        this.suspicion = Math.max(this.suspicion, 0.45);
        this.lastKnown = { ...at };
        this.bark("noticed");
        this.enter("suspicious");
      }
    }
    if (senses.body && this.state !== "combat") {
      this.suspicion = Math.max(this.suspicion, 0.8);
      this.lastKnown = { ...senses.body };
      this.bark("manDown");
      this.enter("search");
    }
    if (senses.report && this.state === "routine") {
      this.lastKnown = { ...senses.report };
      this.suspicion = Math.max(this.suspicion, 0.6);
      this.enter("search");
    }

    // --- Rising alarm -------------------------------------------------------
    if (this.state === "routine" && this.suspicion > 0.3) {
      this.bark("noticed");
      this.enter("suspicious");
    }
    // Sure, and (if only just roused) having looked a moment longer: a challenge, a beat, then the gun up.
    if ((this.state === "search" || (this.state === "suspicious" && this.stateTime > 3)) && this.suspicion >= 1) {
      this.bark("contact");
      this.enter("combat");
    }

    // --- Giving up --------------------------------------------------------
    if (this.state === "combat" && this.canSurrender && senses.squadStanding <= 1 && senses.distance < 12 && senses.health <= this.tuning.surrenderHealth && seen) {
      this.bark("surrender");
      this.enter("surrender");
      intent.goal = null;
      return intent;
    }

    switch (this.state) {
      case "routine":
        return intent;
      case "suspicious": {
        // He stops, looks toward it; if it does not come again, back to his post.
        intent.goal = this.stateTime > 2.5 && this.lastKnown ? this.lastKnown : null;
        intent.aim = this.lastKnown;
        intent.ready = true;
        if (this.suspicion < 0.12 && this.stateTime > 6) this.enter("routine");
        return intent;
      }
      case "search": {
        intent.goal = this.lastKnown;
        intent.aim = this.lastKnown;
        intent.ready = true;
        intent.pace = "walk";
        if (this.unseenFor > this.tuning.searchTime && this.stateTime > this.tuning.searchTime) {
          this.bark("searchEnd");
          this.suspicion = 0;
          this.enter("routine");
        }
        return intent;
      }
      case "combat":
        return this.fight(dt, senses, seen, intent);
      default:
        return intent;
    }
  }

  private fight(dt: number, senses: Senses, seen: boolean, intent: Intent): Intent {
    intent.ready = true;
    intent.aim = this.lastKnown;
    intent.crouch = this.covering;
    if (!seen && this.unseenFor > 15) {
      // Lost him: say so, and hunt where he was.
      this.bark("lost");
      this.enter("search");
      intent.goal = this.lastKnown;
      return intent;
    }
    // Short rushes from cover to cover toward where he was, never straight at him.
    this.rushClock -= dt;
    if (this.rushClock <= 0) {
      this.covering = !this.covering;
      this.rushClock = this.covering ? 3.5 + ((this.stateTime * 7.3) % 2.5) : 1.4;
    }
    intent.cover = true;
    intent.goal = this.covering ? null : this.lastKnown;
    intent.pace = this.covering ? "creep" : "run";
    if (senses.health < 0.5) {
      this.bark("wounded");
      intent.goal = null;
      intent.crouch = true;
    }
    // The gun: a moment to make him out, then bursts.
    if (seen) this.aimTime += dt;
    else this.aimTime = Math.max(0, this.aimTime - dt * 2);
    this.shotClock -= dt;
    if (seen && this.aimTime >= this.tuning.firstShotDelay && this.shotClock <= 0 && (this.covering || senses.distance < 25)) {
      if (this.burstLeft <= 0) this.burstLeft = this.tuning.burst;
      intent.fire = true;
      this.burstLeft -= 1;
      this.shotClock = this.burstLeft > 0 ? this.tuning.shotInterval : this.tuning.burstPause * (0.8 + ((this.stateTime * 3.1) % 0.6));
    }
    return intent;
  }
}

/**
 * How plainly a guard makes out the player: in his field of view, within
 * reach, not hidden; less for a crouching or still player, more for one
 * running. 0…1.
 */
export function sightOf(options: {
  /** From the guard's eyes to the player: distance, m, and the angle off his facing, rad. */
  distance: number;
  angle: number;
  /** A clear line between them. */
  clear: boolean;
  crouched: boolean;
  moving: number;
  /** The guard is on his guard already (eyes wider, field wider). */
  alert: boolean;
  /** Daylight 1 … night 0.3. */
  light: number;
}): number {
  if (!options.clear) return 0;
  const half = options.alert ? 1.3 : 1.0;
  if (Math.abs(options.angle) > half) {
    // Out of the corner of the eye only very near and moving.
    if (options.distance > 4 || options.moving < 1.5) return 0;
    return 0.25;
  }
  const reach = (options.alert ? 60 : 40) * options.light * (options.crouched ? 0.55 : 1);
  if (options.distance > reach) return 0;
  const near = 1 - options.distance / reach;
  const centre = 1 - Math.abs(options.angle) / half;
  const motion = options.crouched ? 0.6 + Math.min(0.4, options.moving * 0.25) : 0.85 + Math.min(0.35, options.moving * 0.08);
  return Math.min(1, near * near * 1.6 * (0.55 + 0.45 * centre) * motion + (options.distance < 2.2 ? 0.6 : 0));
}

/**
 * The chance that a round from a guard strikes its mark: worse far off, at a
 * moving or crouched target, from a running shooter, at one in cover;
 * `skill` scales it (the difficulty, the shooter).
 */
export function hitChance(options: { distance: number; targetMoving: number; targetCrouched: boolean; targetCovered: boolean; shooterMoving: boolean; skill: number }): number {
  let chance = 0.5 * Math.exp(-options.distance / 26);
  chance *= 1 - Math.min(0.5, options.targetMoving * 0.09);
  if (options.targetCrouched) chance *= 0.7;
  if (options.targetCovered) chance *= 0.25;
  if (options.shooterMoving) chance *= 0.45;
  return Math.min(0.85, Math.max(0, chance * options.skill));
}
