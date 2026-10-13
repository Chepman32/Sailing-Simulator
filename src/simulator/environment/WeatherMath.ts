import { clamp, smoothstep } from "../math";

/**
 * Weather as pure, testable numbers.
 *
 * A weather *kind* (clear … hurricane) is a preset: how much cloud, how hard it
 * rains, how strong the wind blows and how high the sea runs. The present
 * weather is a `WeatherSample` that eases toward the preset of the chosen
 * kind, so a front arrives and passes over tens of seconds instead of
 * switching. The kind comes either from the player (manual mode) or from the
 * deterministic planner below (auto mode).
 *
 * Nothing here knows about the renderer: the sea (`OceanMath.setSeaScale`), the
 * yacht's wind, the sky palette, the rain and the sound each read the sample.
 */

export type WeatherKind = "clear" | "cloudy" | "overcast" | "rain" | "downpour" | "storm" | "hurricane";

/** Mildest to wildest; the position in this list is the weather's severity. */
export const WEATHER_KINDS: readonly WeatherKind[] = [
  "clear",
  "cloudy",
  "overcast",
  "rain",
  "downpour",
  "storm",
  "hurricane",
];

export type WeatherMode = "auto" | "manual";

export type WeatherSample = {
  /** Fraction of the sky the cloud shader fills, 0…1. */
  cloudCover: number;
  /** 0 fair … 1 fully overcast: dims the sun, greys the sky. */
  overcast: number;
  /** Precipitation, 0 dry … 1 torrential. */
  rain: number;
  /** True-wind speed relative to the trade wind (1 = about 15 kn). */
  wind: number;
  /** Sea state scale for `OceanMath.setSeaScale` (1 = the trade-wind sea). */
  waves: number;
  /** Gloom and thunder: darkens sky, clouds and water; lightning above 0.5. */
  storm: number;
  /** How much sooner crests break into whitecaps, 0…~0.45. */
  breaking: number;
  /** Mist and spray hanging over the sea: how much visibility is lost, 0…1. */
  haze: number;
};

export const FAIR_CLOUD_COVER = 0.25;
export const OVERCAST_CLOUD_COVER = 0.68;

export const WEATHER_PRESETS: Readonly<Record<WeatherKind, Readonly<WeatherSample>>> = {
  clear: { cloudCover: FAIR_CLOUD_COVER, overcast: 0, rain: 0, wind: 1, waves: 1, storm: 0, breaking: 0, haze: 0 },
  cloudy: { cloudCover: 0.5, overcast: 0.22, rain: 0, wind: 1.06, waves: 1.12, storm: 0, breaking: 0, haze: 0 },
  overcast: { cloudCover: 0.74, overcast: 0.65, rain: 0, wind: 1.18, waves: 1.35, storm: 0.03, breaking: 0.02, haze: 0.05 },
  rain: { cloudCover: 0.82, overcast: 0.8, rain: 0.45, wind: 1.32, waves: 1.75, storm: 0.14, breaking: 0.06, haze: 0.22 },
  downpour: { cloudCover: 0.9, overcast: 0.92, rain: 0.85, wind: 1.6, waves: 2.4, storm: 0.38, breaking: 0.12, haze: 0.5 },
  storm: { cloudCover: 0.94, overcast: 1, rain: 0.9, wind: 2.4, waves: 3.3, storm: 0.82, breaking: 0.26, haze: 0.58 },
  hurricane: { cloudCover: 0.97, overcast: 1, rain: 1, wind: 3.3, waves: 4.5, storm: 1, breaking: 0.42, haze: 0.74 },
};

/** Time constants (s) with which each quantity eases toward its preset. */
const RATE: Readonly<Record<keyof WeatherSample, number>> = {
  cloudCover: 5,
  overcast: 5,
  rain: 4.5,
  wind: 6,
  waves: 10,
  storm: 5,
  breaking: 8,
  haze: 6,
};

const FIELDS = Object.keys(RATE) as (keyof WeatherSample)[];

export function createWeather(kind: WeatherKind = "clear"): WeatherSample {
  return { ...WEATHER_PRESETS[kind] };
}

export function isWeatherKind(value: unknown): value is WeatherKind {
  return typeof value === "string" && (WEATHER_KINDS as readonly string[]).includes(value);
}

export function weatherSeverity(kind: WeatherKind): number {
  return WEATHER_KINDS.indexOf(kind);
}

/** Fair-weather cumulus slowly thicken and thin; overcast skies do not. */
function fairBreathing(time: number): number {
  return Math.sin(time * 0.021 + 1.3) * 0.035 + Math.sin(time * 0.0067 + 4.1) * 0.03;
}

/** Jumps straight to a kind's weather (start-up, tests). */
export function settleWeather(state: WeatherSample, kind: WeatherKind, time = 0): WeatherSample {
  Object.assign(state, WEATHER_PRESETS[kind]);
  state.cloudCover = clamp(state.cloudCover + fairBreathing(time) * (1 - state.overcast), 0.12, 0.98);
  return state;
}

/** Eases the present weather toward `kind` over `delta` seconds. */
export function stepWeather(state: WeatherSample, kind: WeatherKind, delta: number, time: number): WeatherSample {
  const target = WEATHER_PRESETS[kind];
  const step = clamp(delta, 0, 1);
  for (const field of FIELDS) {
    let goal = target[field];
    if (field === "cloudCover") goal += fairBreathing(time) * (1 - target.overcast);
    state[field] += (goal - state[field]) * (1 - Math.exp(-step / RATE[field]));
  }
  state.cloudCover = clamp(state.cloudCover, 0.12, 0.98);
  return state;
}

// --- Automatic weather ---------------------------------------------------------

function hash(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

/** The first spell cannot come before this: every session opens under a clear sky. */
export const AUTO_FIRST_CHANGE = 480;
export const AUTO_SEGMENT_MIN = 180;
export const AUTO_SEGMENT_SPAN = 160;
/** Storms and hurricanes wait until the session is well under way. */
export const AUTO_SEVERE_AFTER = 900;

/**
 * Chance of each next weather (columns, mildest first) after the present one
 * (rows). Weather moves along the severity ladder and favours calm: the sea
 * is fair most of the time, a storm is an event, a hurricane rare.
 */
const AUTO_TRANSITIONS: readonly (readonly number[])[] = [
  [0.46, 0.3, 0.12, 0.12, 0, 0, 0],
  [0.32, 0.2, 0.28, 0.2, 0, 0, 0],
  [0.16, 0.24, 0.2, 0.3, 0.1, 0, 0],
  [0.08, 0.14, 0.24, 0.2, 0.22, 0.12, 0],
  [0, 0.06, 0.22, 0.3, 0.12, 0.18, 0.12],
  [0, 0, 0.16, 0.3, 0.24, 0.14, 0.16],
  [0, 0, 0.12, 0.3, 0.33, 0.25, 0],
];

const segmentStart: number[] = [0];
const segmentLevel: number[] = [0];

function segmentLength(index: number): number {
  return index === 0 ? AUTO_FIRST_CHANGE : AUTO_SEGMENT_MIN + hash(index, 5) * AUTO_SEGMENT_SPAN;
}

/** The weather the planner has in store at `time` seconds into the session. */
export function autoWeatherKind(time: number): WeatherKind {
  const t = Math.max(0, time);
  let last = segmentStart.length - 1;
  while (segmentStart[last]! + segmentLength(last) <= t) {
    const row = AUTO_TRANSITIONS[segmentLevel[last]!]!;
    const start = segmentStart[last]! + segmentLength(last);
    const draw = hash(last + 1, 6);
    let cumulative = 0;
    let next = row.length - 1;
    for (let level = 0; level < row.length; level += 1) {
      cumulative += row[level]!;
      if (draw < cumulative) {
        next = level;
        break;
      }
    }
    // The wildest weather stays away from the start of a session.
    if (start < AUTO_SEVERE_AFTER) next = Math.min(next, weatherSeverity("downpour"));
    segmentStart.push(start);
    segmentLevel.push(next);
    last += 1;
  }
  // Binary search the segment holding t.
  let low = 0;
  let high = last;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (segmentStart[middle]! <= t) low = middle;
    else high = middle - 1;
  }
  return WEATHER_KINDS[segmentLevel[low]!]!;
}

// --- Lightning -------------------------------------------------------------------

const LIGHTNING_SLOT = 7;

/**
 * Brightness (0…1) of the lightning at `time`. Flashes only happen in a real
 * storm (`storm` above 0.5) and come in two quick strokes at irregular times;
 * more often the wilder it is. A closed-form function of time, so it is
 * reproducible and needs no state.
 */
export function lightningFlash(time: number, storm: number): number {
  if (storm < 0.5) return 0;
  const intensity = smoothstep(0.5, 1, storm);
  const slot = Math.floor(time / LIGHTNING_SLOT);
  let flash = 0;
  // A flash can start in the previous slot and still be fading in this one.
  for (let index = slot - 1; index <= slot; index += 1) {
    if (index < 0 || hash(index, 11) > 0.38 + 0.4 * intensity) continue;
    const start = index * LIGHTNING_SLOT + hash(index, 12) * (LIGHTNING_SLOT - 1.2);
    const first = time - start;
    const second = time - start - 0.17 - hash(index, 13) * 0.12;
    if (first >= 0 && first < 1.2) flash = Math.max(flash, Math.exp(-first * 11));
    if (second >= 0 && second < 1.2) flash = Math.max(flash, 0.8 * Math.exp(-second * 8));
  }
  return flash * (0.6 + 0.4 * intensity);
}
