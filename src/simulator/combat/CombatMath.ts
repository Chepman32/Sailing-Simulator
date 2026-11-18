/**
 * The rules of the fight at sea, in numbers (docs/campaign/gameplay.md):
 * how loud and how visible the yacht is, how a drone grows suspicious and
 * finds her, where a rifle round strikes a drone and what that does, how
 * often a drone's burst hits her and what it costs her. Pure.
 *
 * Stealth is an advantage, never a condition: a quiet approach lets the
 * player choose when the fight starts, and nothing here ends a mission
 * because she was seen.
 */

// --- The yacht's signature ----------------------------------------------------

export type SignatureInput = {
  /** The diesel is running. */
  engineRunning: boolean;
  /** Shaft speed, 0…1 (the throttle as the engine has answered it). */
  shaft: number;
  /** Speed through the water, m/s. */
  speed: number;
  /** How hot the engine still is, 0…1 (it cools for a minute after it stops). */
  engineHeat: number;
  /** 0 day … 1 night. */
  night: number;
  /** Haze and fog, 0…1. */
  haze: number;
  /** Rain, 0…1. */
  rain: number;
  /** Storm, 0…1 (spray and breaking seas hide her). */
  storm: number;
};

/** Each channel as a reach: how far off a drone can pick her up by it, m. */
export type Signature = { noise: number; heat: number; sight: number; reach: number };

/** A diesel at full revs is heard about 1.2 km off; idling, a third of that. */
export const ENGINE_HEARD_IDLE = 380;
export const ENGINE_HEARD_FULL = 1250;
/** A running or still-warm engine shows on infra-red this far off. */
export const HEAT_SEEN = 700;
/** The yacht under sail in clear daylight is made out this far off. */
export const SAIL_SEEN = 260;

export function yachtSignature(input: SignatureInput): Signature {
  const shaft = Math.min(1, Math.abs(input.shaft));
  const noise = input.engineRunning ? ENGINE_HEARD_IDLE + (ENGINE_HEARD_FULL - ENGINE_HEARD_IDLE) * shaft : input.speed * 9;
  const heat = HEAT_SEEN * Math.max(input.engineRunning ? 1 : 0, Math.min(1, input.engineHeat));
  // Seen: worse at night, in haze, rain and breaking seas; never below a few dozen metres.
  const sight =
    SAIL_SEEN *
    (1 - 0.48 * input.night) *
    (1 - 0.5 * input.haze) *
    (1 - 0.3 * input.rain) *
    (1 - 0.3 * input.storm) +
    18;
  return { noise, heat, sight, reach: Math.max(noise, heat, sight) };
}

/** The engine warms in a few seconds of running and cools over a minute when it stops. */
export function stepEngineHeat(heat: number, running: boolean, delta: number): number {
  return running ? Math.min(1, heat + delta / 4) : Math.max(0, heat - delta / 60);
}

// --- Suspicion -----------------------------------------------------------------

/** Suspicion at which a drone knows where she is and attacks. */
export const SPOTTED = 1;

/**
 * A drone's suspicion after `delta` seconds with her `distance` metres off:
 * it climbs the faster the deeper she is inside its reach (from a few
 * seconds close in to ten or more at the edge) and drains away out of it.
 */
export function stepSuspicion(suspicion: number, distance: number, reach: number, delta: number): number {
  if (distance < reach) {
    const depth = 1 - distance / reach;
    return Math.min(1.5, suspicion + delta * (0.08 + depth * 0.55));
  }
  return Math.max(0, suspicion - delta * 0.06);
}

/** A rifle shot is heard this far off: shooting tells every drone near where she is. */
export const SHOT_HEARD = 650;

// --- Where a round strikes a drone ---------------------------------------------

/**
 * The drone's parts in its own frame: x to port (+X is the model's left,
 * the same as the yacht's), y up, z forward; metres, origin at the waterline
 * amidships.
 */
export const DRONE_LENGTH = 8.6;
export const DRONE_BEAM = 2.5;
export const DOME_CENTRE = { x: 0, y: 1.92, z: 0.15 } as const;
export const DOME_RADIUS = 0.46;
export const JET_CENTRES = [
  { x: 0.62, y: 0.12, z: -4.25 },
  { x: -0.62, y: 0.12, z: -4.25 },
] as const;
export const JET_RADIUS = 0.34;
/** The hull as a box: half sizes, centre. */
export const HULL_HALF = { x: 1.26, y: 0.72, z: 4.3 } as const;
export const HULL_CENTRE = { x: 0, y: 0.38, z: 0 } as const;
/** The weapon station on the foredeck (armoured: it counts as hull). */
export const TURRET_CENTRE = { x: 0, y: 1.25, z: 2.1 } as const;

export type HitZone = "dome" | "jet" | "hull";

/** Hits to blind (the dome), to stop (both jets together), to sink (on the armour). */
export const DOME_HITS = 3;
export const JET_HITS = 4;
export const HULL_HITS = 26;

type Vec = { x: number; y: number; z: number };

function raySphere(origin: Vec, dir: Vec, centre: Vec, radius: number): number {
  const ox = origin.x - centre.x;
  const oy = origin.y - centre.y;
  const oz = origin.z - centre.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  const near = -b - root;
  if (near >= 0) return near;
  const far = -b + root;
  return far >= 0 ? 0 : Infinity;
}

function rayBox(origin: Vec, dir: Vec, centre: Vec, half: Vec): number {
  let near = -Infinity;
  let far = Infinity;
  for (const axis of ["x", "y", "z"] as const) {
    const o = origin[axis] - centre[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(o) > half[axis]) return Infinity;
      continue;
    }
    let t1 = (-half[axis] - o) / d;
    let t2 = (half[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return Infinity;
  }
  if (far < 0) return Infinity;
  return Math.max(0, near);
}

/** A drone's pose: position of its waterline origin, heading (forward (sin h, cos h)), pitch (bow up +) and roll (to port +), rad. */
export type DronePose = { x: number; y: number; z: number; heading: number; pitch: number; roll: number };

/** Turns a world vector into the drone's frame (inverse of yaw·pitch·roll). */
function toLocal(v: Vec, pose: DronePose, out: Vec): Vec {
  // Undo the heading (about y).
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  const x1 = v.x * ch - v.z * sh;
  const z1 = v.x * sh + v.z * ch;
  // Undo the pitch (about x; bow up is a rotation of −pitch about +x in this frame).
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  const y2 = v.y * cp - z1 * sp;
  const z2 = v.y * sp + z1 * cp;
  // Undo the roll (about z).
  const cr = Math.cos(pose.roll);
  const sr = Math.sin(pose.roll);
  out.x = x1 * cr + y2 * sr;
  out.y = -x1 * sr + y2 * cr;
  out.z = z2;
  return out;
}

/** Turns a point of the drone's frame into the world. */
export function droneToWorld(local: Vec, pose: DronePose, out: Vec): Vec {
  const cr = Math.cos(pose.roll);
  const sr = Math.sin(pose.roll);
  const x1 = local.x * cr - local.y * sr;
  const y1 = local.x * sr + local.y * cr;
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  const y2 = y1 * cp + local.z * sp;
  const z2 = -y1 * sp + local.z * cp;
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  out.x = x1 * ch + z2 * sh + pose.x;
  out.y = y2 + pose.y;
  out.z = -x1 * sh + z2 * ch + pose.z;
  return out;
}

const scratchOrigin = { x: 0, y: 0, z: 0 };
const scratchDir = { x: 0, y: 0, z: 0 };
const scratchRel = { x: 0, y: 0, z: 0 };

/**
 * Where a ray (a rifle round: `origin`, unit `dir`) strikes a drone: the
 * part and the distance along the ray, or null for a miss. The dome and the
 * jets stand proud of the hull, so a round that finds them finds them first.
 */
export function strikeDrone(origin: Vec, dir: Vec, pose: DronePose, reach = 900): { zone: HitZone; distance: number } | null {
  scratchRel.x = origin.x - pose.x;
  scratchRel.y = origin.y - pose.y;
  scratchRel.z = origin.z - pose.z;
  toLocal(scratchRel, pose, scratchOrigin);
  toLocal(dir, pose, scratchDir);
  const dome = raySphere(scratchOrigin, scratchDir, DOME_CENTRE, DOME_RADIUS);
  let jet = Infinity;
  for (const centre of JET_CENTRES) jet = Math.min(jet, raySphere(scratchOrigin, scratchDir, centre, JET_RADIUS));
  const hull = Math.min(rayBox(scratchOrigin, scratchDir, HULL_CENTRE, HULL_HALF), raySphere(scratchOrigin, scratchDir, TURRET_CENTRE, 0.45));
  // The dome and the jets stand proud of the hull: a round that finds them
  // finds them first (the jets only from astern, where they stick out).
  const part = Math.min(dome, jet);
  if (part <= reach && part <= hull + 0.05) return { zone: dome <= jet ? "dome" : "jet", distance: part };
  if (hull <= reach) return { zone: "hull", distance: hull };
  return null;
}

/** What a drone has taken. */
export type DroneDamage = { dome: number; jets: number; hull: number };

export type DroneCondition = "fighting" | "blind" | "stopped" | "wrecked";

/** What the hits add up to: blinded (salvageable), dead in the water (still shooting), or sunk (scrap). */
export function droneCondition(damage: DroneDamage): DroneCondition {
  if (damage.hull >= HULL_HITS) return "wrecked";
  if (damage.dome >= DOME_HITS) return "blind";
  if (damage.jets >= JET_HITS) return "stopped";
  return "fighting";
}

// --- A drone's fire -----------------------------------------------------------

/** Rounds in a burst, rounds a second in it, and the pause between bursts, s. */
export const BURST_ROUNDS = 6;
export const BURST_RATE = 9;
export const BURST_PAUSE: readonly [number, number] = [2.3, 3.4];
/** Beyond this the drone does not open fire, m. */
export const FIRE_RANGE = 460;
/** Hull lost to one round that strikes her. */
export const HULL_PER_HIT = 0.018;

/**
 * The chance a single round of a burst strikes the yacht: good close in,
 * poor at the edge of its range, worse against a fast yacht in a seaway,
 * at night or in rain. The prologue's interceptors (`sure`) are told where
 * she is and do not miss much.
 */
export function hitChance(distance: number, yachtSpeed: number, waves: number, night: number, rain: number, sure = false): number {
  if (distance > FIRE_RANGE) return 0;
  if (sure) return 0.62;
  const range = 1 - 0.72 * Math.min(1, Math.max(0, (distance - 90) / (FIRE_RANGE - 90)));
  const motion = 1 - 0.38 * Math.min(1, yachtSpeed / 12);
  const sea = 1 - 0.3 * Math.min(1, waves / 3);
  const sight = 1 - 0.25 * night - 0.2 * rain;
  return Math.max(0.04, 0.58 * range * motion * sea * sight);
}

// --- What damage does to the yacht ---------------------------------------------

/** Below half her hull she leaks: heavier, slower; this is what is left of her speed. */
export function leakSpeedFactor(hull: number): number {
  if (hull >= 0.5) return 1;
  return 1 - Math.min(0.42, (0.5 - hull) * 0.84);
}

/** Below a quarter she smokes from the stern. */
export const SMOKING_HULL = 0.25;

/** A round from astern (the shooter within a radian of dead astern) may also stop the engine: `random` is a draw in 0…1. */
export function engineKnockedOut(shooterBearingFromStern: number, random: number): boolean {
  return Math.abs(shooterBearingFromStern) < 1 && random < 0.035;
}

/** A blinded drone hauled alongside is worth this much on the black market; its scrap a fifth of that. */
export const SALVAGE_VALUE = 300;
export const SCRAP_VALUE = 60;
/** How near the winch reaches, m (yacht centre to drone). */
export const WINCH_REACH = 25;
/** Seconds of winching to haul one aboard. */
export const WINCH_SECONDS = 3.5;
