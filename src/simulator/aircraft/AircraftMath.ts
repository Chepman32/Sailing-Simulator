import { clamp, smoothstep } from "../math";

/**
 * Aircraft over the sea, in numbers.
 *
 * Low over the water, every minute or so a light plane comes by: a
 * floatplane on a sightseeing flight or towing an advertising banner at
 * 120–260 m, passing a few hundred metres from the yacht with a lazy S-turn,
 * banking into each turn as a real aeroplane must (bank = atan(v·ω / g));
 * or, by day, an aerobatic monoplane screaming past at 45–70 m trailing
 * display smoke, which rolls right round its line of flight in a barrel
 * roll as it passes the yacht (`STUNT_ROLL`). High
 * above, airliners cruise at 9.5–11.5 km and 230 m/s, drawing contrails
 * that form a little behind the engines, lengthen with the flight, spread
 * and drift with the wind aloft and slowly dissipate — quickly in dry air,
 * over minutes when the air is near ice saturation. Pure; `AircraftSystem`
 * draws them, `AudioSystem` gives the floatplane its engine.
 */

export const GRAVITY = 9.81;

/** Low passes: seconds from the end of one to the start of the next, and the first one after the start. */
export const LOW_PASS_GAP = [18, 45] as const;
export const FIRST_LOW_PASS = 12;
/** Half the length of a low pass (it starts and ends this far from its closest point), m. */
export const LOW_PASS_HALF = 1700;

export type LowPassKind = "banner" | "tour" | "stunt";

/**
 * The aerobatic plane's barrel roll: the aircraft flies a corkscrew round its
 * line of flight while rolling once right round, the path a circle of
 * `radius` metres seen end-on, over `seconds` (eased in and out), centred on
 * the point of the pass nearest the yacht.
 */
export const STUNT_ROLL = { radius: 24, seconds: 4.4 } as const;
/** The display smoke is on this far either side of the roll, m along the track. */
export const STUNT_SMOKE_REACH = 700;

export type LowPass = {
  kind: LowPassKind;
  /** Closest point of the straight track to the yacht, at the pass's start time. */
  centerX: number;
  centerZ: number;
  /** Track heading (radians, 0 toward +Z, growing toward +X). */
  heading: number;
  altitude: number;
  speed: number;
  /** Amplitude (m) and wavelength (m) of the lazy S-turn across the track. */
  weave: number;
  wavelength: number;
  /** Seconds from the start of the pass to its end. */
  duration: number;
  /** Which banner text (index), and a seed for the livery. */
  seed: number;
};

/** A deterministic generator (mulberry32). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plans a low pass near the yacht at (x, z): a straight track with an S-turn
 * passing 250–900 m from her, so it crosses her view rather than her mast.
 */
export function planLowPass(x: number, z: number, random: () => number, kind: LowPassKind): LowPass {
  const heading = random() * Math.PI * 2;
  const miss = (250 + random() * 650) * (random() < 0.5 ? -1 : 1);
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  if (kind === "stunt") {
    // Low, fast and straight, close enough for the roll to read.
    const stuntMiss = (130 + random() * 130) * Math.sign(miss);
    const stuntSpeed = 72 + random() * 10;
    return {
      kind,
      centerX: x + rightX * stuntMiss,
      centerZ: z + rightZ * stuntMiss,
      heading,
      altitude: 45 + random() * 25,
      speed: stuntSpeed,
      weave: 0,
      wavelength: 3000,
      duration: (2 * LOW_PASS_HALF) / stuntSpeed,
      // Even seeds roll to the right, odd ones to the left.
      seed: Math.floor(random() * 1e6),
    };
  }
  const speed = kind === "banner" ? 36 + random() * 6 : 46 + random() * 10;
  return {
    kind,
    centerX: x + rightX * miss,
    centerZ: z + rightZ * miss,
    heading,
    altitude: kind === "banner" ? 120 + random() * 60 : 160 + random() * 100,
    speed,
    weave: 60 + random() * 120,
    wavelength: 2400 + random() * 1600,
    duration: (2 * LOW_PASS_HALF) / speed,
    seed: Math.floor(random() * 1e6),
  };
}

export type AircraftPose = {
  x: number;
  y: number;
  z: number;
  /** Heading of the nose (radians), pitch (nose up +) and bank (right wing down +). */
  heading: number;
  pitch: number;
  bank: number;
  /** Velocity, m/s. */
  vx: number;
  vy: number;
  vz: number;
};

/** Roll angle of the barrel roll at distance `s` along the track (0 at the closest point), radians, 0…2π. */
export function stuntRollAngle(pass: LowPass, s: number): number {
  const half = (pass.speed * STUNT_ROLL.seconds) / 2;
  return Math.PI * 2 * smoothstep(-half, half, s);
}

const stuntScratch = { x: 0, y: 0, z: 0 };

/** A point of the stunt plane's corkscrew `s` metres along its track. */
function stuntPoint(pass: LowPass, s: number, out: { x: number; y: number; z: number }): number {
  const phi = stuntRollAngle(pass, s);
  const direction = pass.seed % 2 === 0 ? 1 : -1;
  const forwardX = Math.sin(pass.heading);
  const forwardZ = Math.cos(pass.heading);
  const rightX = Math.cos(pass.heading);
  const rightZ = -Math.sin(pass.heading);
  // A barrel roll: up and over to the rolling side, round the line of flight.
  const lateral = direction * STUNT_ROLL.radius * Math.sin(phi);
  out.x = pass.centerX + forwardX * s + rightX * lateral;
  out.z = pass.centerZ + forwardZ * s + rightZ * lateral;
  out.y = pass.altitude + STUNT_ROLL.radius * (1 - Math.cos(phi));
  return phi * direction;
}

/** The aerobatic plane's pose: on its corkscrew, nose along the path, rolled through the barrel roll. */
function stuntPose(pass: LowPass, time: number, out: AircraftPose): AircraftPose {
  const s = -LOW_PASS_HALF + pass.speed * time;
  const step = 1.5;
  const roll = stuntPoint(pass, s, out);
  stuntPoint(pass, s + step, stuntScratch);
  const dx = stuntScratch.x - out.x;
  const dy = stuntScratch.y - out.y;
  const dz = stuntScratch.z - out.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  // The path is slightly longer than the track through the roll; speed is along the path.
  const speed = pass.speed * (length / step);
  out.vx = (dx / length) * speed;
  out.vy = (dy / length) * speed;
  out.vz = (dz / length) * speed;
  out.heading = Math.atan2(dx, dz);
  out.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  out.bank = roll;
  return out;
}

/** Whether the aerobatic plane's display smoke is on at `time` s into its pass. */
export function stuntSmokeOn(pass: LowPass, time: number): boolean {
  const s = -LOW_PASS_HALF + pass.speed * time;
  return pass.kind === "stunt" && Math.abs(s) < STUNT_SMOKE_REACH;
}

/** Where the low pass is `time` s after it began (time outside [0, duration] extrapolates). */
export function lowPassPose(pass: LowPass, time: number, out: AircraftPose): AircraftPose {
  if (pass.kind === "stunt") return stuntPose(pass, time, out);
  const s = -LOW_PASS_HALF + pass.speed * time;
  const k = (Math.PI * 2) / pass.wavelength;
  const lateral = pass.weave * Math.sin(s * k);
  // Slope of the track across itself, and its rate of turn.
  const slope = pass.weave * k * Math.cos(s * k);
  const curvature = -pass.weave * k * k * Math.sin(s * k);
  const forwardX = Math.sin(pass.heading);
  const forwardZ = Math.cos(pass.heading);
  const rightX = Math.cos(pass.heading);
  const rightZ = -Math.sin(pass.heading);
  out.x = pass.centerX + forwardX * s + rightX * lateral;
  out.z = pass.centerZ + forwardZ * s + rightZ * lateral;
  // A gentle climb and descent over the pass, a few metres.
  out.y = pass.altitude + 12 * Math.sin(time * 0.05 + pass.seed);
  const crab = Math.atan(slope);
  out.heading = pass.heading + crab;
  const norm = Math.hypot(1, slope);
  out.vx = ((forwardX + rightX * slope) / norm) * pass.speed;
  out.vz = ((forwardZ + rightZ * slope) / norm) * pass.speed;
  out.vy = 12 * 0.05 * Math.cos(time * 0.05 + pass.seed);
  // Turn rate ω = v · κ (κ the track's curvature): bank into the turn.
  const kappa = curvature / Math.pow(norm, 3);
  out.bank = Math.atan((pass.speed * pass.speed * kappa) / GRAVITY);
  out.pitch = 0.035 + Math.atan2(out.vy, pass.speed);
  return out;
}

/** The pass is on: it started and has not yet flown out of sight. */
export function lowPassActive(pass: LowPass, time: number): boolean {
  return time >= 0 && time <= pass.duration;
}

// --- Airliners and contrails ----------------------------------------------------

export type Airliner = {
  /** Where it was when it appeared, m (world), and when (s). */
  startX: number;
  startZ: number;
  startTime: number;
  heading: number;
  altitude: number;
  speed: number;
  /** Seconds a contrail segment lasts (short in dry air, minutes near saturation). */
  persistence: number;
  /** Seconds after which it has crossed the sky. */
  duration: number;
  seed: number;
};

/** Airliners cruise this far out at most (they appear and leave at this range), m. */
export const AIRLINER_RANGE = 34000;
export const AIRLINER_SPEED = 232;

/**
 * Plans an airliner crossing the sky over (x, z): it appears at the edge of
 * `AIRLINER_RANGE` on a straight track passing within 0–14 km of the yacht.
 */
export function planAirliner(x: number, z: number, time: number, random: () => number): Airliner {
  const heading = random() * Math.PI * 2;
  const miss = (random() * 2 - 1) * 14000;
  const along = Math.sqrt(Math.max(0, AIRLINER_RANGE * AIRLINER_RANGE - miss * miss));
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  const speed = AIRLINER_SPEED * (0.94 + random() * 0.1);
  // Half the time the air is moist: contrails that linger and spread for a couple of minutes.
  const persistence = random() < 0.5 ? 30 + random() * 35 : 90 + random() * 70;
  return {
    startX: x + rightX * miss - forwardX * along,
    startZ: z + rightZ * miss - forwardZ * along,
    startTime: time,
    heading,
    altitude: 9500 + random() * 2000,
    speed,
    persistence,
    duration: (2 * along) / speed,
    seed: Math.floor(random() * 1e6),
  };
}

export function airlinerPosition(plane: Airliner, time: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const travelled = (time - plane.startTime) * plane.speed;
  out.x = plane.startX + Math.sin(plane.heading) * travelled;
  out.y = plane.altitude;
  out.z = plane.startZ + Math.cos(plane.heading) * travelled;
  return out;
}

/**
 * A contrail segment `age` s old: its width (m) and opacity. It forms about
 * a second behind the engines (the gap where the exhaust is still too warm
 * to freeze), is densest for the first few seconds, then spreads as a
 * turbulent plume and thins until it is gone after `persistence` s.
 */
export function contrailShape(age: number, persistence: number): { width: number; opacity: number } {
  const width = 8 + 9 * Math.sqrt(Math.max(0, age)) + Math.max(0, age) * 0.9;
  const formed = smoothstep(0.35, 1.6, age);
  const fade = 1 - smoothstep(persistence * 0.35, persistence, age);
  const thinning = 1 / (1 + age / 40);
  return { width, opacity: clamp(formed * fade * (0.55 + 0.45 * thinning), 0, 1) };
}

/** Wind aloft (jet stream), m/s: it carries the contrails sideways as they age. */
export const WIND_ALOFT = { x: 14, z: -6 };
