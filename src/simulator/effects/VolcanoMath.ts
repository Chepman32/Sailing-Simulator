import { clamp, smoothstep } from "../math";

/**
 * A volcano's moods, in numbers: the plume it breathes all the time, and the
 * eruptions that come every minute or so — a boom, a fountain of glowing
 * bombs, a darker burst of ash — on a schedule fixed by the volcano's seed,
 * so every visit sees the same mountain keep its own rhythm. Pure;
 * `VolcanoSystem` draws it and the sound and the camera follow it.
 */

/** Seconds between the starts of two eruption slots. */
export const ERUPTION_SLOT = 46;
/** How long an eruption's fountain lasts, s. */
export const ERUPTION_LENGTH = 7;
/** Heights the plume rises to before it spreads downwind, m. */
export const PLUME_TOP = 260;
/** Seconds a plume puff lives. */
export const PLUME_LIFE = 70;
/** Bombs in one eruption. */
export const BOMBS = 36;

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type Eruption = {
  /** Seconds since this eruption began (≥ 0), or −1 when quiet. */
  age: number;
  /** Strength of this eruption, 0.5…1. */
  strength: number;
  /** Index of the slot, a seed for the bombs. */
  slot: number;
};

/**
 * The eruption under way at `time` for a volcano with `seed`, if any: about
 * three slots in four erupt, at a random moment within the slot.
 */
export function eruptionAt(time: number, seed: number, out: Eruption): Eruption {
  out.age = -1;
  out.strength = 0;
  out.slot = 0;
  // The current slot, and the one before (an eruption late in a slot runs on).
  const slot = Math.floor(time / ERUPTION_SLOT);
  for (const candidate of [slot, slot - 1]) {
    if (hash(candidate, seed * 131 + 7) > 0.75) continue;
    const start = candidate * ERUPTION_SLOT + hash(candidate, seed * 17 + 3) * (ERUPTION_SLOT - ERUPTION_LENGTH - 6);
    const age = time - start;
    if (age >= 0 && age < ERUPTION_LENGTH + 6) {
      out.age = age;
      out.strength = 0.5 + 0.5 * hash(candidate, seed * 29 + 11);
      out.slot = candidate;
      return out;
    }
  }
  return out;
}

/** How hard the crater glows: a steady breath, flaring with an eruption. */
export function craterGlow(time: number, eruption: Eruption): number {
  const breath = 0.55 + 0.15 * Math.sin(time * 0.7) + 0.08 * Math.sin(time * 2.3 + 1.1);
  if (eruption.age < 0) return breath;
  const flare = smoothstep(0, 0.4, eruption.age) * (1 - smoothstep(ERUPTION_LENGTH * 0.5, ERUPTION_LENGTH + 5, eruption.age));
  return breath + flare * 1.6 * eruption.strength;
}

export type PlumePoint = { x: number; y: number; z: number; radius: number; opacity: number };

/**
 * Where a plume puff is `age` seconds after leaving the crater: it rises
 * fast at first, slows as it cools and spreads, and the wind bends it over
 * more the higher it gets. `phase` (0…1) frays the column.
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

/**
 * A lava bomb `age` seconds after it was thrown: ballistic, at a few tens of
 * metres a second, out of the crater in a cone. Returns false once it has
 * fallen back below the rim height minus `drop`.
 */
export function bombFlight(age: number, index: number, slot: number, out: PlumePoint, drop = 70): boolean {
  const launch = (index % 12) * 0.35 + hash(index, slot) * 0.6;
  const t = age - launch;
  if (t < 0) return false;
  const azimuth = hash(index * 3 + 1, slot) * Math.PI * 2;
  const tilt = 0.15 + hash(index * 5 + 2, slot) * 0.45;
  const speed = 40 + hash(index * 7 + 3, slot) * 36;
  const horizontal = Math.sin(tilt) * speed;
  out.x = Math.cos(azimuth) * horizontal * t;
  out.z = Math.sin(azimuth) * horizontal * t;
  out.y = Math.cos(tilt) * speed * t - 4.9 * t * t;
  out.radius = 2.6 + hash(index * 11, slot) * 2.8;
  // Glowing yellow-white as it leaves, cooling to a dull red.
  out.opacity = clamp(1 - t / 9, 0, 1);
  return out.y > -drop && out.opacity > 0;
}
