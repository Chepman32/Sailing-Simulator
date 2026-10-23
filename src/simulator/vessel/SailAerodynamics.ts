import { clamp, smoothstep } from "../math";

/**
 * Mainsail and staysail (jib) are modelled as one combined force source for the
 * physics, but each keeps its own area and visual set so the rendered sails can
 * fill, twist and luff from the same numbers that push the yacht.
 */
export const MAINSAIL_AREA = 46;
export const JIB_AREA = 26;
export const TOTAL_SAIL_AREA = MAINSAIL_AREA + JIB_AREA;
const AIR_DENSITY = 1.225;
const SAIL_FORCE_EFFICIENCY = 0.88;

export type SailState = {
  /** 0…1 power factor including no-go attenuation and trim. */
  efficiency: number;
  /** Forward drive in newtons. */
  force: number;
  /** Side force in newtons, positive toward starboard (+X). */
  lateralForce: number;
  /** Leeward side: +1 starboard (+X), -1 port. */
  side: number;
  /** Boom angle from the centreline, radians (always positive). */
  mainSheetAngle: number;
  /** Jib clew angle from the centreline, radians (always positive). */
  jibSheetAngle: number;
  /** Maximum belly depth as a fraction of the local chord. */
  mainCamber: number;
  jibCamber: number;
  /** Upper-leech twist, radians. */
  twist: number;
  /** 0 = sails full and quiet, 1 = fully luffing / flogging. */
  luffing: number;
};

/** Soft gate that removes drive when the apparent wind is from dead astern. */
export function smoothNoGo(angle: number): number {
  return smoothstep(0.32, 0.76, angle);
}

/**
 * `apparentWindAngle` follows VesselPhysics: the angle of the apparent air
 * motion relative to the bow (0 = air moving forward, ±π = air from dead ahead).
 */
export function computeSailState(apparentWindAngle: number, apparentWindSpeed: number, trim: number): SailState {
  const windAngle = Math.abs(apparentWindAngle);
  const sheet = clamp(trim, 0.2, 1);
  const noGo = smoothNoGo(windAngle);
  const efficiency = Math.sin(Math.min(Math.PI, windAngle)) * noGo * sheet;
  const totalForce = 0.5 * AIR_DENSITY * TOTAL_SAIL_AREA * apparentWindSpeed * apparentWindSpeed * efficiency * SAIL_FORCE_EFFICIENCY;
  const side = apparentWindAngle >= 0 ? 1 : -1;

  // Angle the wind comes FROM, measured from the bow: 0 head to wind, π dead run.
  const windFrom = Math.PI - windAngle;
  const optimalBoom = clamp((windFrom - 0.32) * 0.5, 0.07, 1.32);
  // An eased sheet lets the boom swing further out than optimal.
  const mainSheetAngle = clamp(optimalBoom * (1.32 - sheet * 0.32), 0.07, 1.4);
  const jibSheetAngle = clamp(mainSheetAngle * 0.82, 0.14, 1.05);

  const headToWind = 1 - smoothstep(0.38, 0.72, windFrom);
  const lightAir = 1 - smoothstep(0.6, 2.2, apparentWindSpeed);
  const eased = 1 - smoothstep(0.2, 0.34, sheet);
  const luffing = clamp(Math.max(headToWind, lightAir, eased * 0.7), 0, 1);

  const load = clamp(apparentWindSpeed / 8, 0.35, 1.2);
  const filled = 1 - luffing * 0.85;
  // A tighter sheet flattens the main slightly while the load deepens it.
  const mainCamber = filled * (0.075 + (1 - sheet) * 0.035 + load * 0.035);
  const jibCamber = filled * (0.085 + load * 0.04);
  const twist = 0.08 + (1 - sheet) * 0.22 + luffing * 0.1;

  return {
    efficiency,
    force: totalForce,
    lateralForce: side * totalForce * 0.11,
    side,
    mainSheetAngle,
    jibSheetAngle,
    mainCamber,
    jibCamber,
    twist,
    luffing,
  };
}
