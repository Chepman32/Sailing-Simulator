/**
 * Deterministic true-wind model.
 *
 * Real breeze is never steady: it arrives in gusts and lulls a few tens of
 * seconds apart and slowly oscillates in direction. The yacht answers both, so
 * a helmsman feels the boat power up, heel and want to round up, then settle.
 *
 * The model is a closed-form function of simulation time. It has no hidden
 * state, which keeps the fixed-step integration reproducible at any step size.
 */

export type WindSample = {
  /** Direction the air is moving toward, world X component (m/s). */
  x: number;
  /** Direction the air is moving toward, world Z component (m/s). */
  z: number;
  speed: number;
  /** Gust factor relative to the mean wind speed. */
  gust: number;
  /** The gust event under way: 0 none … 1 at its height (see `gustEvent`). */
  squall?: number;
  /** A gust about to arrive (0…1 over the seconds before it), for its sound and its dark patch on the water. */
  approaching?: number;
};

/** Mean true wind: about 8 m/s (15.5 kn) blowing toward +X/+Z. */
export const MEAN_WIND_X = 6.8;
export const MEAN_WIND_Z = 4.2;
export const MEAN_WIND_SPEED = Math.hypot(MEAN_WIND_X, MEAN_WIND_Z);
export const MEAN_WIND_HEADING = Math.atan2(MEAN_WIND_X, MEAN_WIND_Z);

export const MIN_GUST_FACTOR = 0.76;
export const MAX_GUST_FACTOR = 1.55;

/** Gust events are drawn from time slots of this length, seconds. */
export const GUST_SLOT = 34;
/** Seconds a gust takes to arrive in full, to hold, and to die away. */
export const GUST_RISE = 2.6;
export const GUST_FADE = 4.5;
/** Seconds before a gust in which it can be heard and seen coming. */
export const GUST_WARNING = 3.5;

function gustHash(index: number, salt: number): number {
  const value = Math.sin(index * 91.7 + salt * 47.3) * 24634.6345;
  return value - Math.floor(value);
}

/**
 * The gust event at `time`: a real puff arrives as one event — heard coming
 * across the water, then the sail loads up, the yacht heels and picks up
 * speed, then it eases. About two slots in three hold one, at a random moment
 * in the slot, 20–45 % stronger than the mean, held for 4–9 s.
 * Returns the extra wind factor, its 0…1 envelope and the approach warning.
 */
export function gustEvent(time: number): { extra: number; envelope: number; approaching: number } {
  let extra = 0;
  let envelope = 0;
  let approaching = 0;
  const slot = Math.floor(time / GUST_SLOT);
  for (let index = slot - 1; index <= slot; index += 1) {
    if (index < 0 || gustHash(index, 1) > 0.68) continue;
    const start = index * GUST_SLOT + gustHash(index, 2) * (GUST_SLOT - 16);
    const hold = 4 + gustHash(index, 3) * 5;
    const strength = 0.2 + gustHash(index, 4) * 0.25;
    const age = time - start;
    if (age < -GUST_WARNING || age > GUST_RISE + hold + GUST_FADE) continue;
    if (age < 0) {
      approaching = Math.max(approaching, 1 + age / GUST_WARNING);
      continue;
    }
    const rise = Math.min(1, age / GUST_RISE);
    const fade = 1 - Math.max(0, Math.min(1, (age - GUST_RISE - hold) / GUST_FADE));
    const level = rise * rise * (3 - 2 * rise) * fade * fade * (3 - 2 * fade);
    if (level > envelope) {
      envelope = level;
      extra = strength * level;
    }
  }
  return { extra, envelope, approaching };
}
export const MAX_WIND_SHIFT = 0.16;

/**
 * @param scale Weather's multiplier on the mean wind (1 = the trade wind). Gusts
 *   stay proportional, so a gale is as gusty, in relative terms, as a breeze.
 */
export function sampleWind(time: number, target: WindSample, scale = 1): WindSample {
  // Incommensurate periods: the pattern does not audibly or visibly repeat.
  const slow = Math.sin(time * 0.071 + 0.6);
  const medium = Math.sin(time * 0.193 + 2.1);
  const fast = Math.sin(time * 0.47 + 4.4);
  const event = gustEvent(time);
  const gust = Math.min(
    MAX_GUST_FACTOR,
    Math.max(MIN_GUST_FACTOR, 1 + slow * 0.09 + medium * 0.065 + fast * 0.035 + event.extra),
  );
  const shift = Math.max(
    -MAX_WIND_SHIFT,
    Math.min(MAX_WIND_SHIFT, Math.sin(time * 0.043 + 1.3) * 0.1 + Math.sin(time * 0.131 + 0.2) * 0.05),
  );
  const heading = MEAN_WIND_HEADING + shift;
  const speed = MEAN_WIND_SPEED * gust * Math.max(0, scale);
  target.x = Math.sin(heading) * speed;
  target.z = Math.cos(heading) * speed;
  target.speed = speed;
  target.gust = gust;
  target.squall = event.envelope;
  target.approaching = event.approaching;
  return target;
}
