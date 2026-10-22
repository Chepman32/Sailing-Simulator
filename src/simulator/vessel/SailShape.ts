import { clamp, smoothstep } from "../math";

/**
 * Pure sail-shape rules shared by the visual sail system and its tests.
 *
 * apparentWindAngle follows VesselPhysics: it is the direction the apparent
 * air flow moves toward, measured from the bow. Air moving toward starboard
 * (positive angle) means the wind blows from port, so the sails set to
 * starboard (leeward). The angle the wind comes FROM, off the bow, is
 * PI - |apparentWindAngle|.
 */

export const MAX_BOOM_ANGLE = 1.32;
export const MIN_BOOM_ANGLE = 0.07;
export const MAX_CAMBER_RATIO = 0.13;
export const DRAFT_POSITION = 0.4;
export const IRONS_ANGLE = 0.62;

export function windFromBow(apparentWindAngle: number): number {
  return Math.PI - Math.min(Math.PI, Math.abs(apparentWindAngle));
}

export function leewardSide(apparentWindAngle: number): 1 | -1 {
  return apparentWindAngle >= 0 ? 1 : -1;
}

/**
 * Boom angle off the centerline toward leeward. A trimmed sail keeps a modest
 * angle of attack to the apparent wind; easing the sheet (lower trim) lets it
 * swing further out.
 */
export function boomAngle(apparentWindAngle: number, trim: number): number {
  const from = windFromBow(apparentWindAngle);
  const trimmed = from * 0.5 - 0.16;
  const eased = (1 - clamp(trim, 0.2, 1)) * 0.42;
  return clamp(trimmed + eased, MIN_BOOM_ANGLE, MAX_BOOM_ANGLE);
}

/** 0 when the sail is luffing (head to wind or no breeze), 1 when fully drawing. */
export function sailFill(apparentWindAngle: number, apparentWindSpeed: number, trim: number): number {
  const drawing = smoothstep(IRONS_ANGLE * 0.7, IRONS_ANGLE * 1.25, windFromBow(apparentWindAngle));
  const breeze = smoothstep(0.8, 6.5, apparentWindSpeed);
  const sheet = 0.45 + 0.55 * smoothstep(0.2, 0.75, clamp(trim, 0.2, 1));
  return clamp(drawing * breeze * sheet, 0, 1);
}

/**
 * Camber (belly) depth as a fraction of local chord. Wind fills the sail; a
 * hard-sheeted sail is flatter than a slightly eased one at the same fill.
 */
export function camberRatio(fill: number, trim: number): number {
  const flattening = 1 - 0.28 * smoothstep(0.75, 1, trim);
  return MAX_CAMBER_RATIO * clamp(fill, 0, 1) * flattening;
}

/**
 * Chordwise camber profile in [0, 1], zero at luff and leech, maximum at the
 * draft position (40% aft), like a real sail section.
 */
export function camberProfile(chordPosition: number): number {
  const u = clamp(chordPosition, 0, 1);
  const exponent = Math.log(0.5) / Math.log(DRAFT_POSITION);
  return Math.sin(Math.PI * Math.pow(u, exponent));
}

/** Leech twist (radians) at a height fraction: the head opens more when eased. */
export function leechTwist(height: number, trim: number): number {
  return clamp(height, 0, 1) * (0.1 + (1 - clamp(trim, 0.2, 1)) * 0.22);
}
