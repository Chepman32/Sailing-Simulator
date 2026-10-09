import { clamp, smoothstep } from "../math";

/**
 * Tropical trade-wind weather as a pure, deterministic function of time.
 *
 * Fair weather is the rule: a scattering of small cumulus (cover about a
 * quarter of the sky) drifting downwind, so the sun and moon are in clear sky
 * nearly all of the time. Now and then a cloudy spell builds over half a
 * minute, lasts a minute or two and clears again. The first spell cannot come
 * before `FIRST_SPELL` seconds, so every session opens under a clear sky.
 */

export type WeatherSample = {
  /** Fraction of the sky the cloud shader fills, 0…1. */
  cloudCover: number;
  /** 0 fair … 1 fully overcast: dims the sun, greys the sky. */
  overcast: number;
};

export const FAIR_CLOUD_COVER = 0.25;
export const OVERCAST_CLOUD_COVER = 0.68;
/** Length of one weather cycle; at most one spell occurs in each. */
export const SPELL_PERIOD = 480;
/** Share of cycles that bring a cloudy spell. */
export const SPELL_CHANCE = 0.4;
export const FIRST_SPELL = SPELL_PERIOD;
const RAMP = 35;

function hash(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

export function sampleWeather(time: number, target: WeatherSample = { cloudCover: 0, overcast: 0 }): WeatherSample {
  const t = Math.max(0, time);
  // Fair-weather breathing: the cumulus field slowly thickens and thins.
  const fair =
    FAIR_CLOUD_COVER + Math.sin(t * 0.021 + 1.3) * 0.035 + Math.sin(t * 0.0067 + 4.1) * 0.03;
  const cycle = Math.floor(t / SPELL_PERIOD);
  let overcast = 0;
  if (cycle >= 1 && hash(cycle, 1) < SPELL_CHANCE) {
    const length = 70 + hash(cycle, 2) * 80;
    const start = cycle * SPELL_PERIOD + 40 + hash(cycle, 3) * (SPELL_PERIOD - length - 2 * RAMP - 80);
    const peak = 0.65 + hash(cycle, 4) * 0.35;
    overcast = peak * smoothstep(start, start + RAMP, t) * (1 - smoothstep(start + RAMP + length, start + 2 * RAMP + length, t));
  }
  target.overcast = clamp(overcast, 0, 1);
  target.cloudCover = clamp(fair + (OVERCAST_CLOUD_COVER - fair) * target.overcast, 0.12, 0.8);
  return target;
}
