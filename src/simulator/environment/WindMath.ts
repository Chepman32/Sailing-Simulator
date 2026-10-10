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
};

/** Mean true wind: about 8 m/s (15.5 kn) blowing toward +X/+Z. */
export const MEAN_WIND_X = 6.8;
export const MEAN_WIND_Z = 4.2;
export const MEAN_WIND_SPEED = Math.hypot(MEAN_WIND_X, MEAN_WIND_Z);
export const MEAN_WIND_HEADING = Math.atan2(MEAN_WIND_X, MEAN_WIND_Z);

export const MIN_GUST_FACTOR = 0.76;
export const MAX_GUST_FACTOR = 1.26;
export const MAX_WIND_SHIFT = 0.16;

export function sampleWind(time: number, target: WindSample): WindSample {
  // Incommensurate periods: the pattern does not audibly or visibly repeat.
  const slow = Math.sin(time * 0.071 + 0.6);
  const medium = Math.sin(time * 0.193 + 2.1);
  const fast = Math.sin(time * 0.47 + 4.4);
  const gust = Math.min(
    MAX_GUST_FACTOR,
    Math.max(MIN_GUST_FACTOR, 1 + slow * 0.12 + medium * 0.085 + fast * 0.045),
  );
  const shift = Math.max(
    -MAX_WIND_SHIFT,
    Math.min(MAX_WIND_SHIFT, Math.sin(time * 0.043 + 1.3) * 0.1 + Math.sin(time * 0.131 + 0.2) * 0.05),
  );
  const heading = MEAN_WIND_HEADING + shift;
  const speed = MEAN_WIND_SPEED * gust;
  target.x = Math.sin(heading) * speed;
  target.z = Math.cos(heading) * speed;
  target.speed = speed;
  target.gust = gust;
  return target;
}
