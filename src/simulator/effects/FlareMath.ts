import { clamp, smoothstep } from "../math";

/**
 * A parachute signal flare, in numbers.
 *
 * Fired from the cockpit, the rocket climbs on its motor for a couple of
 * seconds, a little downwind of straight up, to about 160 m. At the top it
 * ejects the star under a small parachute: the star ignites with a flash,
 * burns fiercely for some eight seconds, flickering as it burns, and drifts
 * down and away with the wind, then gutters out. The smoke it leaves hangs
 * in the air for a while longer, lit red or green from inside while the star
 * burns. Pure numbers; `FlareSystem` draws it and the environment takes its
 * light.
 */

export type FlareColor = "red" | "green";

/** Linear colour of each star (a red flare is deep red with some orange). */
export const FLARE_RGB: Record<FlareColor, readonly [number, number, number]> = {
  red: [1, 0.12, 0.05],
  green: [0.16, 1, 0.3],
};

/** Seconds the rocket climbs. */
export const FLARE_RISE = 2.3;
/** Height the star is ejected at, m. */
export const FLARE_APEX = 160;
/** The star burns from the apex until this age, then gutters out. */
export const FLARE_BURN_END = 10.5;
/** Seconds it takes to die out. */
export const FLARE_FADE = 1.6;
/** Age at which the star is out. */
export const FLARE_LIFE = FLARE_BURN_END + FLARE_FADE;
/** The smoke trail lingers this long after launch. */
export const FLARE_SMOKE_LIFE = 26;
/** Sink rate under the parachute, m/s. */
export const FLARE_SINK = 4.2;
/** How far from vertical the rocket leans downwind, as a fraction of the climb. */
export const FLARE_LEAN = 0.12;
/** Fraction of the wind the parachute drifts with. */
export const FLARE_DRIFT = 0.85;
/** At most this many flares in the air at once (more replace the oldest). */
export const MAX_FLARES = 3;
/** Shortest time between two launches, s (the gun needs reloading). */
export const FLARE_RELOAD = 1.2;

export type FlareLaunch = {
  /** Launch point (the yacht's cockpit), m. */
  x: number;
  y: number;
  z: number;
  /** Unit horizontal direction the rocket leans toward (downwind). */
  leanX: number;
  leanZ: number;
  /** Wind the parachute drifts with, m/s. */
  windX: number;
  windZ: number;
  /** Per-flare random seed, for the flicker. */
  seed: number;
};

export type FlarePoint = { x: number; y: number; z: number };

/** Height above the launch point at `age`, m. */
export function flareHeight(age: number): number {
  if (age <= 0) return 0;
  if (age < FLARE_RISE) {
    // Decelerating climb: fast off the launcher, slowing to the apex.
    const t = age / FLARE_RISE;
    return FLARE_APEX * (1 - (1 - t) * (1 - t));
  }
  return Math.max(0, FLARE_APEX - (age - FLARE_RISE) * FLARE_SINK);
}

/** Position of the flare (the rocket, then the star) at `age`. */
export function flarePosition(launch: FlareLaunch, age: number, out: FlarePoint): FlarePoint {
  const climb = flareHeight(age);
  const rise = Math.min(age, FLARE_RISE) / FLARE_RISE;
  // The lean is spent during the climb; afterwards the parachute drifts.
  const lean = FLARE_APEX * FLARE_LEAN * rise * rise;
  const drift = Math.max(0, age - FLARE_RISE) * FLARE_DRIFT;
  out.x = launch.x + launch.leanX * lean + launch.windX * drift;
  out.y = launch.y + climb;
  out.z = launch.z + launch.leanZ * lean + launch.windZ * drift;
  return out;
}

/** Deterministic flicker, 0.78…1.08: a burning star is never steady. */
export function flareFlicker(age: number, seed: number): number {
  const a = Math.sin(age * 23.1 + seed * 7.3) * 0.5 + 0.5;
  const b = Math.sin(age * 37.7 + seed * 3.1 + 1.7) * 0.5 + 0.5;
  const c = Math.sin(age * 9.3 + seed * 11.9 + 4.2) * 0.5 + 0.5;
  return 0.78 + 0.3 * (a * 0.4 + b * 0.35 + c * 0.25);
}

/**
 * Light of the flare at `age`, 0…~1.1: the small spark of the motor while it
 * climbs, the ignition flash at the apex, the long burn and the dying out.
 */
export function flareBrightness(age: number, seed: number): number {
  if (age <= 0 || age >= FLARE_LIFE) return 0;
  if (age < FLARE_RISE) return 0.07 + 0.05 * smoothstep(0, 0.4, age);
  const sinceIgnition = age - FLARE_RISE;
  const ignite = smoothstep(0, 0.35, sinceIgnition);
  const out = 1 - smoothstep(FLARE_BURN_END, FLARE_LIFE, age);
  return Math.max(0.07 * out, ignite * out * flareFlicker(age, seed));
}

/**
 * How strongly a flare `distance` metres away lights a surface, relative to
 * the light right under a flare at the apex (1). Inverse square, softened
 * close in so it never blows up.
 */
export function flareIllumination(brightness: number, distance: number): number {
  const reference = FLARE_APEX * FLARE_APEX + 2500;
  return Math.max(0, brightness) * (reference / (distance * distance + 2500));
}

/**
 * How much of a flare's light reaches the scene against the light already
 * there: brilliant at night, a red speck against the day.
 */
export function flareSceneWeight(nightFactor: number): number {
  return 0.04 + 0.96 * smoothstep(0.25, 0.85, clamp(nightFactor, 0, 1));
}

/** Smoke opacity of a puff left `age` seconds ago, 0…1. */
export function smokeOpacity(age: number): number {
  if (age <= 0 || age >= FLARE_SMOKE_LIFE) return 0;
  return smoothstep(0, 0.3, age) * (1 - smoothstep(FLARE_SMOKE_LIFE * 0.35, FLARE_SMOKE_LIFE, age));
}

/** Smoke puff radius after `age` seconds, m (it spreads as it drifts). */
export function smokeRadius(age: number): number {
  return 0.8 + Math.sqrt(Math.max(0, age)) * 2.2;
}
