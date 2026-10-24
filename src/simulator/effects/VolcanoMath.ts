import { clamp, smoothstep } from "../math";

/**
 * A volcano's moods, in numbers.
 *
 * Between eruptions it breathes a plume of steam and gas. About once a
 * minute it erupts: a blast (a flash and a ring of shocked air), a fountain
 * of incandescent bombs that arc out of the crater and tumble down the
 * cone, a dark ash column that rushes up hundreds of metres, slows,
 * mushrooms into an umbrella and is carried off by the wind, and in a
 * strong eruption a collapse of hot ash rolling down the flanks. Everything
 * is a function of time and the volcano's seed, so it plays the same at any
 * frame rate and every visit sees the mountain keep its own rhythm. Pure;
 * `VolcanoSystem` draws it and the sound and the camera follow it.
 */

/** Seconds between the starts of two eruption slots. */
export const ERUPTION_SLOT = 62;
/** How long the lava fountain plays, s. */
export const ERUPTION_LENGTH = 9;
/** How long the vent feeds the ash column, s. */
export const ASH_EMIT = 13;
/** How long an eruption's column hangs in the sky, s (less than a slot). */
export const COLUMN_LIFE = 56;
/** Height the steady plume rises to, m. */
export const PLUME_TOP = 230;
/** Seconds a plume puff lives. */
export const PLUME_LIFE = 70;
/** Lava bombs in one fountain, and small sparks. */
export const BOMBS = 150;
export const SPARKS = 120;
/** Puffs in an ash column, a collapse and the shock ring. */
export const ASH_PUFFS = 190;
export const COLLAPSE_PUFFS = 28;
export const SHOCK_PUFFS = 20;
export const GRAVITY = 9.81;

export function eruptionHash(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const hash = eruptionHash;

export type Eruption = {
  /** Seconds since this eruption began (≥ 0), or −1 when quiet. */
  age: number;
  /** Strength of this eruption, 0.5…1. */
  strength: number;
  /** Index of the slot, a seed for the bombs. */
  slot: number;
};

/**
 * The eruption whose column is in the sky at `time` for a volcano with
 * `seed`, if any: about five slots in six erupt, early in the slot.
 */
export function eruptionAt(time: number, seed: number, out: Eruption): Eruption {
  out.age = -1;
  out.strength = 0;
  out.slot = 0;
  const slot = Math.floor(time / ERUPTION_SLOT);
  if (hash(slot, seed * 131 + 7) > 0.84) return out;
  const start = slot * ERUPTION_SLOT + hash(slot, seed * 17 + 3) * (ERUPTION_SLOT - COLUMN_LIFE);
  const age = time - start;
  if (age >= 0 && age < COLUMN_LIFE) {
    out.age = age;
    out.strength = 0.5 + 0.5 * hash(slot, seed * 29 + 11);
    out.slot = slot;
  }
  return out;
}

/** Whether the fountain (and the roar) is going: the first `ERUPTION_LENGTH` s. */
export function fountainActivity(eruption: Eruption): number {
  if (eruption.age < 0) return 0;
  return smoothstep(0, 0.3, eruption.age) * (1 - smoothstep(ERUPTION_LENGTH - 2, ERUPTION_LENGTH + 2, eruption.age)) * eruption.strength;
}

/** How hard the crater glows: a steady breath, flaring with an eruption. */
export function craterGlow(time: number, eruption: Eruption): number {
  const breath = 0.55 + 0.15 * Math.sin(time * 0.7) + 0.08 * Math.sin(time * 2.3 + 1.1);
  if (eruption.age < 0) return breath;
  // The blast flash, then the fountain's light, flickering.
  const flash = Math.exp(-eruption.age / 0.25) * 2.2;
  const flicker = 0.85 + 0.15 * Math.sin(eruption.age * 17.3) * Math.sin(eruption.age * 7.1);
  return breath + (flash + fountainActivity(eruption) * 1.8 * flicker) * eruption.strength;
}

export type PlumePoint = { x: number; y: number; z: number; radius: number; opacity: number };

/**
 * Where a steady-plume puff is `age` seconds after leaving the crater: it
 * rises fast at first, slows as it cools and spreads, and the wind bends it
 * over more the higher it gets. `phase` (0…1) frays the column.
 */
export function plumePuff(age: number, phase: number, windX: number, windZ: number, out: PlumePoint): PlumePoint {
  const t = clamp(age / PLUME_LIFE, 0, 1);
  const settle = 12;
  const rise = PLUME_TOP * (1 - Math.exp(-age / settle));
  // Carried at the wind's full speed once it stops rising: a long trail.
  const drift = age - settle * (1 - Math.exp(-age / settle));
  const wander = Math.sqrt(age) * 2.4;
  out.x = windX * drift + Math.sin(phase * 40 + age * 0.08) * wander;
  out.y = rise + Math.sin(phase * 23 + age * 0.05) * wander * 0.6;
  out.z = windZ * drift + Math.cos(phase * 53 + age * 0.07) * wander;
  out.radius = 8 + Math.sqrt(age) * 5.5 + t * 34;
  out.opacity = smoothstep(0, 2.5, age) * Math.pow(1 - t, 1.6);
  return out;
}

export type AshPoint = PlumePoint & {
  /** 1 just out of the vent … 0 old and dilute (for its darkness and glow). */
  fresh: number;
};

/**
 * Where puff `index` of an eruption's ash column is `age` s after the blast.
 * Puffs leave the vent over `ASH_EMIT` s as a jet that decelerates as it
 * entrains air (height approaches v₀τ), keeps rising slowly as a buoyant
 * column, and near its top spreads out sideways into an umbrella that the
 * wind carries away. Radius grows with height, as a real column widens.
 */
export function ashPuff(age: number, index: number, slot: number, strength: number, windX: number, windZ: number, out: AshPoint): AshPoint {
  const emitted = (index / ASH_PUFFS) * ASH_EMIT * (0.85 + 0.15 * hash(index, slot + 5));
  const a = age - emitted;
  out.opacity = 0;
  out.fresh = 0;
  if (a <= 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.radius = 0;
    return out;
  }
  const v0 = (45 + 40 * strength) * (0.8 + 0.4 * hash(index * 3, slot));
  const tau = 7;
  const top = v0 * tau;
  const height = top * (1 - Math.exp(-a / tau)) + 1.4 * a;
  const level = clamp(height / top, 0, 1.4);
  const umbrella = smoothstep(0.6, 1, level);
  const azimuth = hash(index * 7 + 1, slot) * Math.PI * 2;
  const offset = (hash(index * 11 + 2, slot) - 0.5) * (5 + height * 0.1) + umbrella * (18 + a * 4.5) * (0.5 + hash(index * 13 + 4, slot));
  const drift = a * (0.12 + 0.88 * smoothstep(0, 1, level));
  const wander = Math.sqrt(a) * 2.2;
  out.x = Math.cos(azimuth) * offset + windX * drift + Math.sin(index * 1.7 + a * 0.3) * wander;
  out.z = Math.sin(azimuth) * offset + windZ * drift + Math.cos(index * 2.3 + a * 0.27) * wander;
  // The umbrella is flatter than the column under it.
  out.y = height - umbrella * hash(index * 17 + 6, slot) * 45;
  out.radius = 12 + height * 0.12 + Math.sqrt(a) * 3.5 + umbrella * 10;
  out.opacity = smoothstep(0, 0.5, a) * (1 - smoothstep(COLUMN_LIFE * 0.4, COLUMN_LIFE, age));
  out.fresh = Math.exp(-a / 9);
  return out;
}

/**
 * Puff `index` of a collapse: hot ash spilling over the rim and rolling
 * down the flank at tens of metres a second, slowing as it spreads. Gives
 * the distance down the slope from the rim (m) in `out.x`, the azimuth in
 * `out.z`, the puff's radius and opacity. Only strong eruptions collapse.
 */
export function collapsePuff(age: number, index: number, slot: number, strength: number, out: PlumePoint): PlumePoint {
  out.opacity = 0;
  if (strength < 0.72) return out;
  const start = 1.6 + hash(index, slot + 17) * 3;
  const t = age - start;
  if (t <= 0) return out;
  // Two or three lobes down different gullies.
  const lobe = Math.floor(hash(index * 5, slot + 3) * 3);
  out.z = hash(lobe, slot + 41) * Math.PI * 2 + (hash(index, slot + 43) - 0.5) * 0.35;
  const speed = 28 + 12 * hash(index * 3, slot + 7);
  out.x = speed * 6 * (1 - Math.exp(-t / 6));
  out.y = 0;
  out.radius = 7 + out.x * 0.12 + t * 1.1;
  out.opacity = smoothstep(0, 0.6, t) * (1 - smoothstep(12, 34, t));
  return out;
}

export type Ember = { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number };

/**
 * Bomb `index` of the fountain, `age` s after the blast: launched at some
 * moment of the fountain at 30–90 m/s in a cone up to ~25° off vertical,
 * then ballistic. Returns false before launch; `out.t` is its flight time.
 * (Where it lands is up to the caller, who knows the cone.)
 */
export function bombFlight(age: number, index: number, slot: number, out: Ember, sparks = false): boolean {
  const launch = hash(index, slot + (sparks ? 101 : 0)) * ERUPTION_LENGTH * 0.92;
  const t = age - launch;
  if (t < 0) return false;
  const azimuth = hash(index * 3 + 1, slot) * Math.PI * 2;
  const tilt = (sparks ? 0.55 : 0.42) * Math.sqrt(hash(index * 5 + 2, slot));
  const speed = sparks ? 14 + hash(index * 7 + 3, slot) * 26 : 32 + hash(index * 7 + 3, slot) * 58;
  const horizontal = Math.sin(tilt) * speed;
  const vertical = Math.cos(tilt) * speed;
  out.vx = Math.cos(azimuth) * horizontal;
  out.vz = Math.sin(azimuth) * horizontal;
  out.vy = vertical - GRAVITY * t;
  out.x = out.vx * t;
  out.z = out.vz * t;
  out.y = vertical * t - 0.5 * GRAVITY * t * t;
  out.t = t;
  return true;
}

/** How hot a bomb still is after `t` s of flight (1 white-hot … 0 dark). */
export function emberHeat(t: number, sparks = false): number {
  return clamp(1 - t / (sparks ? 2.6 : 9), 0, 1);
}

/** The shock ring of the blast: puff `index` at `age` s (offset from the crater, m). */
export function shockPuff(age: number, index: number, out: PlumePoint): PlumePoint {
  const azimuth = (index / SHOCK_PUFFS) * Math.PI * 2;
  const reach = 340 * (1 - Math.exp(-age / 0.45));
  out.x = Math.cos(azimuth) * reach;
  out.z = Math.sin(azimuth) * reach;
  out.y = 20 + reach * 0.18;
  out.radius = 18 + reach * 0.12;
  out.opacity = smoothstep(0, 0.08, age) * (1 - smoothstep(0.35, 1.3, age)) * 0.45;
  return out;
}
