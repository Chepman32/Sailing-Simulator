import { clamp, smoothstep } from "../math";

/**
 * Aircraft over the sea, in numbers.
 *
 * Low over the water, every couple of minutes a light floatplane comes by —
 * a sightseeing flight, or one towing an advertising banner — at 120–260 m,
 * passing a few hundred metres from the yacht with a lazy S-turn, banking
 * into each turn as a real aeroplane must (bank = atan(v·ω / g)). High
 * above, airliners cruise at 9.5–11.5 km and 230 m/s, drawing contrails
 * that form a little behind the engines, lengthen with the flight, spread
 * and drift with the wind aloft and slowly dissipate — quickly in dry air,
 * over minutes when the air is near ice saturation. Pure; `AircraftSystem`
 * draws them, `AudioSystem` gives the floatplane its engine.
 */

export const GRAVITY = 9.81;

/** Low passes: seconds between two, and the first one after the start. */
export const LOW_PASS_GAP = [80, 160] as const;
export const FIRST_LOW_PASS = 35;
/** Half the length of a low pass (it starts and ends this far from its closest point), m. */
export const LOW_PASS_HALF = 2600;

export type LowPassKind = "banner" | "tour";

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

/** Where the low pass is `time` s after it began (time outside [0, duration] extrapolates). */
export function lowPassPose(pass: LowPass, time: number, out: AircraftPose): AircraftPose {
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
  // Half the time the air is moist: contrails that linger and spread for minutes.
  const persistence = random() < 0.5 ? 25 + random() * 35 : 140 + random() * 160;
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
