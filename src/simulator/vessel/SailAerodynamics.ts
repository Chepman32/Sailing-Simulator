import { clamp, smoothstep } from "../math";

/**
 * Sail aerodynamics for the catamaran's combined main and jib.
 *
 * The sails are treated as one thin, cambered aerofoil whose sheet angle is
 * chosen by an attentive crew: the boom is eased until the sail meets the
 * apparent wind at the requested angle of attack, limited by the tightest
 * sheeting angle the rig allows and by the shrouds when running. The helm's
 * "sail trim" control therefore keeps its established meaning (more trim, more
 * power) while the resulting forces follow a real lift/drag polar:
 *
 * - head to wind the sail cannot reach a positive angle of attack and luffs;
 * - close-hauled and reaching it works attached, with a high lift/drag ratio;
 * - broad-reaching it stalls progressively;
 * - running it is a drag device square to the wind.
 */

export const AIR_DENSITY = 1.225;
export const SAIL_AREA = 72;
export const MIN_SHEET_ANGLE = 0.24;
export const MAX_SHEET_ANGLE = 1.5;
export const STALL_ANGLE = 0.3;
export const MAX_LIFT_COEFFICIENT = 1.45;
const MIN_TRIM_ATTACK = 0.05;
const FULL_TRIM_ATTACK = 0.28;
const MIN_TRIM_EXPOSURE = 0.5;

export type SailCoefficients = {
  lift: number;
  drag: number;
};

export type SailState = {
  /** Boom angle off the centreline in radians, always positive. */
  sheetAngle: number;
  /** Angle between the sail chord and the apparent wind in radians. */
  angleOfAttack: number;
  /** Aerodynamic lift, perpendicular to the apparent wind (N). */
  lift: number;
  /** Aerodynamic drag, along the apparent wind (N). */
  drag: number;
  /** 1 when the sail is flogging head to wind, 0 when it is drawing. */
  luff: number;
  /** 0 attached flow … 1 fully stalled. */
  stall: number;
};

export function sailCoefficients(angleOfAttack: number, target: SailCoefficients): SailCoefficients {
  const alpha = clamp(angleOfAttack, 0, Math.PI / 2);
  const attached = MAX_LIFT_COEFFICIENT * Math.sin((Math.PI / 2) * Math.min(1, alpha / STALL_ANGLE));
  // Past the stall the sail behaves like a flat plate.
  const plate = 1.12 * Math.sin(2 * alpha);
  const stalled = smoothstep(STALL_ANGLE, 0.56, alpha);
  const lift = attached + (plate - attached) * stalled;
  const separation = smoothstep(0.17, 0.66, alpha);
  const sine = Math.sin(alpha);
  const drag = 0.07 + 0.1 * attached * attached * (1 - stalled) + 1.2 * sine * sine * separation;
  target.lift = lift;
  target.drag = drag;
  return target;
}

const scratchCoefficients: SailCoefficients = { lift: 0, drag: 0 };

/**
 * @param apparentWindAngle Unsigned angle the apparent wind comes from,
 *   0 = dead ahead, π = dead astern.
 * @param apparentWindSpeed m/s.
 * @param trim Helm control in [0.2, 1].
 */
export function solveSail(
  apparentWindAngle: number,
  apparentWindSpeed: number,
  trim: number,
  target: SailState,
): SailState {
  const angle = clamp(Math.abs(apparentWindAngle), 0, Math.PI);
  const power = clamp((clamp(trim, 0.2, 1) - 0.2) / 0.8, 0, 1);
  const requestedAttack = MIN_TRIM_ATTACK + (FULL_TRIM_ATTACK - MIN_TRIM_ATTACK) * power;
  const sheetAngle = clamp(angle - requestedAttack, MIN_SHEET_ANGLE, MAX_SHEET_ANGLE);
  const angleOfAttack = angle - sheetAngle;
  const coefficients = sailCoefficients(angleOfAttack, scratchCoefficients);
  // A luffing sail produces no useful lift but still flogs and drags.
  const drawing = smoothstep(0, 0.07, angleOfAttack);
  // Easing the sheets right off also twists the head of the sail open and
  // spills wind, which is the only way to depower once the sail has stalled.
  const exposure = MIN_TRIM_EXPOSURE + (1 - MIN_TRIM_EXPOSURE) * power;
  const dynamicPressure = 0.5 * AIR_DENSITY * SAIL_AREA * exposure * apparentWindSpeed * apparentWindSpeed;
  target.sheetAngle = sheetAngle;
  target.angleOfAttack = angleOfAttack;
  target.lift = dynamicPressure * coefficients.lift * drawing;
  target.drag = dynamicPressure * (coefficients.drag + (1 - drawing) * 0.06);
  target.luff = 1 - drawing;
  target.stall = smoothstep(STALL_ANGLE, 0.7, angleOfAttack);
  return target;
}

export function createSailState(): SailState {
  return { sheetAngle: MIN_SHEET_ANGLE, angleOfAttack: 0, lift: 0, drag: 0, luff: 1, stall: 0 };
}
