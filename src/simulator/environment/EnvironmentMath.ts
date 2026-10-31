import { clamp } from "../math";

/** Extra elevation (rad) the sun reaches at the top of its arc in the automatic cycle. */
export const SUN_ARC_HEIGHT = 0.3;

/** Height of the moon at full night, radians (about 12°). */
export const MOON_NIGHT_ELEVATION = 0.215;

export type TimeOfDayState = {
  normalizedTime: number;
  sunElevation: number;
  moonElevation: number;
  exposure: number;
  starVisibility: number;
  nightFactor: number;
};

/**
 * @param nightFactor 0 day … 1 night.
 * @param sunArc 0…1: how far the sun has climbed above its late-afternoon
 *   station (the automatic day cycle sends it up toward midday and back).
 */
export function deriveTimeOfDay(nightFactor: number, sunArc = 0): TimeOfDayState {
  const night = clamp(nightFactor, 0, 1);
  const arc = clamp(sunArc, 0, 1);
  return {
    normalizedTime: 0.5 + night * 0.5,
    // An afternoon sun about 29° up: high enough for the deep blue of the
    // sea seen from above and short shadows on deck, low enough to lay a
    // glitter path toward the opening view. Going to night it sets through a
    // full sunset, crossing the horizon about halfway, as before.
    sunElevation: 0.5 + arc * SUN_ARC_HEIGHT - night * 0.86 - night * night * night * 0.2,
    // The moon rides low, about 12° up at full night: in the frame of the
    // usual views (the chase camera sees only some 20° above the horizon,
    // so a moon 30° up was never on screen) and laying a long silver path
    // across the sea toward the yacht.
    moonElevation: -0.28 + night * (MOON_NIGHT_ELEVATION + 0.28),
    exposure: 1.08 - night * 0.24,
    starVisibility: Math.pow(night, 1.6),
    nightFactor: night,
  };
}

// --- Automatic day cycle ---------------------------------------------------------

/** Seconds of full day, of dusk, of night and of dawn in the automatic cycle. */
export const DAY_HOLD_SECONDS = 150;
export const DUSK_SECONDS = 75;
export const NIGHT_HOLD_SECONDS = 110;
export const DAWN_SECONDS = 75;
export const DAY_CYCLE_SECONDS = DAY_HOLD_SECONDS + DUSK_SECONDS + NIGHT_HOLD_SECONDS + DAWN_SECONDS;
/** Cycle time at which the night proper begins, and the day proper. */
export const CYCLE_NIGHT_START = DAY_HOLD_SECONDS + DUSK_SECONDS;
export const CYCLE_DAY_START = 0;

/**
 * Where the automatic cycle stands at `cycleTime`: the linear day-to-night
 * progress (0 day … 1 night, rising through dusk and falling through dawn)
 * and the sun's climb above its usual station during the day.
 */
export function dayCycleState(cycleTime: number): { progress: number; sunArc: number } {
  const t = ((cycleTime % DAY_CYCLE_SECONDS) + DAY_CYCLE_SECONDS) % DAY_CYCLE_SECONDS;
  if (t < DAY_HOLD_SECONDS) return { progress: 0, sunArc: Math.sin((Math.PI * t) / DAY_HOLD_SECONDS) };
  if (t < CYCLE_NIGHT_START) return { progress: (t - DAY_HOLD_SECONDS) / DUSK_SECONDS, sunArc: 0 };
  if (t < CYCLE_NIGHT_START + NIGHT_HOLD_SECONDS) return { progress: 1, sunArc: 0 };
  return { progress: 1 - (t - CYCLE_NIGHT_START - NIGHT_HOLD_SECONDS) / DAWN_SECONDS, sunArc: 0 };
}
