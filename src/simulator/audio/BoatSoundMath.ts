import { clamp, smoothstep } from "../math";

/**
 * How loud each layer of the yacht's own sound is, from what she is doing.
 *
 * Moored or drifting, the water only laps and slaps at the hulls. As she
 * gathers way the bows begin to cut the water: a soft rush that fills out
 * with speed, and above 6–8 knots a powerful tearing of water with bursts of
 * spray as she meets each wave. The wind sings in the rigging when it pipes
 * up, the sail flogs whenever it luffs (going about, or head to wind), and
 * the winches ratchet while the sheet is trimmed. A gust is heard before it
 * arrives and swells everything it touches. Pure numbers; `BoatVoices`
 * plays them.
 */

export type BoatSoundState = {
  /** Speed through the water, knots. */
  knots: number;
  /** Sea state scale (1 = the trade-wind sea). */
  waves: number;
  /** Apparent wind, knots. */
  apparentWind: number;
  /** Gust event under way and approaching, 0…1 (see `gustEvent`). */
  gust: number;
  gustApproaching: number;
  /** How much the sail luffs, 0 drawing … 1 flogging. */
  luff: number;
  /** Rate of change of the sheet, per second (+ trimming in, − easing). */
  trimRate: number;
};

export type BoatSoundLevels = {
  /** Water slapping the hulls at rest and at low speed, and slaps a second. */
  slap: number;
  slapRate: number;
  /** The bow wave's rush, and the low-pass that opens with speed (Hz). */
  rush: number;
  rushTone: number;
  /** Spray thrown off the bows at speed, and bursts a second. */
  spray: number;
  sprayRate: number;
  /** Wind singing in the shrouds, and the hum's pitch (Hz). */
  rigging: number;
  riggingPitch: number;
  /** Sail flogging, and flaps a second. */
  flog: number;
  flogRate: number;
  /** Multiplier on the wind bed while a gust comes and blows. */
  windSwell: number;
  /** Winch ratchet clicks a second (0 = silent), and the softer slip of an eased sheet. */
  winchClicks: number;
  sheetSlip: number;
};

/** Speed above which the bows start to tear the water and throw spray, knots. */
export const SPRAY_START_KNOTS = 6;
export const SPRAY_FULL_KNOTS = 8.5;

export function boatSoundLevels(state: BoatSoundState): BoatSoundLevels {
  const knots = Math.max(0, Number.isFinite(state.knots) ? state.knots : 0);
  const sea = clamp((state.waves - 1) / 3, 0, 1);
  const wind = Math.max(0, state.apparentWind);
  const gust = clamp(state.gust, 0, 1);
  const approaching = clamp(state.gustApproaching, 0, 1);
  const rushLevel = smoothstep(1.2, 9.5, knots);
  const spray = smoothstep(SPRAY_START_KNOTS, SPRAY_FULL_KNOTS, knots) * (0.65 + 0.35 * sea);
  const trim = Number.isFinite(state.trimRate) ? state.trimRate : 0;
  return {
    slap: (1 - smoothstep(3, 7.5, knots)) * (0.55 + 0.45 * sea) + 0.08,
    slapRate: 0.7 + knots * 0.12 + sea * 0.8,
    rush: Math.pow(rushLevel, 1.4) * (0.85 + 0.15 * sea),
    rushTone: 700 + 4300 * smoothstep(1.5, 12, knots),
    spray,
    sprayRate: spray > 0 ? 0.9 + (knots - SPRAY_START_KNOTS) * 0.45 + sea * 0.8 : 0,
    rigging: smoothstep(10, 24, wind) * (0.7 + 0.3 * gust) + gust * 0.25 * smoothstep(6, 14, wind),
    riggingPitch: 520 + wind * 22 + gust * 60,
    flog: clamp(state.luff, 0, 1) * smoothstep(4, 14, wind),
    flogRate: 3.5 + wind * 0.22,
    windSwell: 1 + gust * 0.9 + approaching * 0.45,
    winchClicks: trim > 0.03 ? 7 + trim * 55 : 0,
    sheetSlip: trim < -0.03 ? clamp(-trim * 2.2, 0, 1) : 0,
  };
}

/**
 * The sail filling with a crack as it comes onto the new tack: it flogged
 * hard (luff above 0.55) within the last 2.5 s and now draws (below 0.25).
 * Returns the strength of the bang (0 = none) given the luff history.
 */
export function sailFillCrack(peakLuffRecently: number, luff: number, apparentWind: number): number {
  if (peakLuffRecently < 0.55 || luff > 0.25) return 0;
  return clamp(apparentWind / 16, 0.25, 1);
}
