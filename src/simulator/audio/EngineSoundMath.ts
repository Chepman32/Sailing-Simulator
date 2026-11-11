import { clamp } from "../math";

/**
 * The engine heard from where the camera is.
 *
 * The diesel sits low in the yacht's quarters, so standing at the helm it is
 * a steady presence under everything else, from a chase camera a dozen
 * metres astern it is clearly quieter, and from a drone or an orbit a
 * hundred metres out it is a distant mutter under the sea and the wind. The
 * level follows the inverse distance law past a near zone (the helm is never
 * louder than the reference), the air and the water between dull its high
 * end, and it comes from the yacht's side of the picture.
 */

/** Distance at and inside which the engine is heard at full level, metres. */
export const ENGINE_NEAR_DISTANCE = 5;
/** Quietest the engine ever gets before it is simply too far to matter (the bus is muted below it). */
export const ENGINE_FLOOR = 0.012;

/** Level of the engine (0…1) heard `distance` metres away. */
export function engineDistanceGain(distance: number): number {
  const d = Math.max(ENGINE_NEAR_DISTANCE, Number.isFinite(distance) ? distance : 1e6);
  // About −5 dB per doubling: a little gentler than a point source in free
  // air, since the hull and the water around it radiate the sound as well.
  const gain = Math.pow(ENGINE_NEAR_DISTANCE / d, 0.85);
  return gain < ENGINE_FLOOR ? 0 : gain;
}

/** Cut-off of the low-pass that stands for the air and the hull in between, Hz. */
export function engineAirCutoff(distance: number): number {
  const d = Math.max(0, Number.isFinite(distance) ? distance : 1e6);
  return clamp(14000 / (1 + d / 18), 380, 14000);
}

/**
 * Stereo position of the engine (−1 left … 1 right) from the listener's
 * right-hand direction and the direction to the engine, both horizontal.
 * Narrowed, so it never comes from one speaker only; centred close in.
 */
export function enginePan(rightX: number, rightZ: number, toX: number, toZ: number): number {
  const length = Math.hypot(toX, toZ);
  const rightLength = Math.hypot(rightX, rightZ);
  if (length < 0.5 || rightLength < 1e-6) return 0;
  const side = (toX * rightX + toZ * rightZ) / (length * rightLength);
  const closeness = clamp((length - 1.5) / 6, 0, 1);
  return clamp(side * 0.7 * closeness, -0.7, 0.7);
}
