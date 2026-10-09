import { clamp, smoothstep } from "../math";
import type { TimeOfDayState } from "./EnvironmentMath";
import { FAIR_CLOUD_COVER, type WeatherSample } from "./WeatherMath";

/**
 * Art direction for the whole scene, derived from the single time-of-day
 * state. Every colour is scene-linear RGB so the sky dome, the ocean, the
 * image-based lighting and the analytic lights all agree.
 *
 * This module is pure: it is unit-tested and shared with the shader preview
 * tooling, and it is the only place day, dusk and night colours are defined.
 */

export type Rgb = [number, number, number];

export type EnvironmentPalette = {
  zenith: Rgb;
  horizon: Rgb;
  /** Tint of the solar disc and the scattering around it. */
  sunColor: Rgb;
  /** Irradiance of the dominant light (sun by day, moon by night). */
  lightColor: Rgb;
  /** Sky irradiance reaching horizontal surfaces such as water and foam. */
  ambientColor: Rgb;
  cloudLit: Rgb;
  cloudShade: Rgb;
  cloudCover: number;
  deepWater: Rgb;
  shallowWater: Rgb;
  sand: Rgb;
  scatter: Rgb;
  /** 0 by day and at night, 1 while the sun is on the horizon. */
  twilight: number;
  /** Blend from sun (0) to moon (1) as the dominant light. */
  moonBlend: number;
  /** Scalar brightness of the dominant light relative to noon. */
  daylight: number;
};

const DAY_ZENITH: Rgb = [0.03, 0.19, 0.62];
const DAY_HORIZON: Rgb = [0.3, 0.55, 0.86];
const NIGHT_ZENITH: Rgb = [0.006, 0.018, 0.056];
const NIGHT_HORIZON: Rgb = [0.03, 0.072, 0.15];
const DUSK_HORIZON: Rgb = [0.95, 0.42, 0.17];
const DUSK_ZENITH: Rgb = [0.07, 0.13, 0.36];

const NOON_SUN: Rgb = [1.0, 0.935, 0.79];
const DUSK_SUN: Rgb = [1.0, 0.5, 0.2];
const MOONLIGHT: Rgb = [0.56, 0.69, 1.0];

const DAY_AMBIENT: Rgb = [0.46, 0.52, 0.6];
const NIGHT_AMBIENT: Rgb = [0.05, 0.076, 0.125];

const DAY_CLOUD_LIT: Rgb = [1.06, 1.03, 0.98];
const DAY_CLOUD_SHADE: Rgb = [0.47, 0.55, 0.68];
const DUSK_CLOUD_LIT: Rgb = [1.05, 0.56, 0.3];
const DUSK_CLOUD_SHADE: Rgb = [0.2, 0.17, 0.27];
const NIGHT_CLOUD_LIT: Rgb = [0.17, 0.215, 0.31];
const NIGHT_CLOUD_SHADE: Rgb = [0.03, 0.046, 0.078];

export const SUN_IRRADIANCE = 3.2;
export const MOON_IRRADIANCE = 0.62;

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

function scale(color: Rgb, factor: number): Rgb {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

function greyed(color: Rgb, amount: number): Rgb {
  const luminance = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  return mix(color, [luminance * 1.05, luminance * 1.08, luminance * 1.14], amount);
}

const FAIR_WEATHER: WeatherSample = { cloudCover: FAIR_CLOUD_COVER, overcast: 0 };

export function deriveEnvironmentPalette(state: TimeOfDayState, weather: WeatherSample = FAIR_WEATHER): EnvironmentPalette {
  const night = clamp(state.nightFactor, 0, 1);
  // A cloudy spell softens and dims the light and greys the sky; fair
  // weather leaves the palette untouched.
  const overcast = clamp(weather.overcast, 0, 1);
  // The sun is within roughly a hand's width of the horizon.
  const twilight = Math.exp(-Math.pow(state.sunElevation / 0.2, 2));
  const sunUp = smoothstep(-0.1, 0.12, state.sunElevation);
  const moonBlend = smoothstep(0.35, 0.78, night);

  const zenith = greyed(mix(mix(DAY_ZENITH, NIGHT_ZENITH, night), DUSK_ZENITH, twilight * 0.5), overcast * 0.45);
  const horizon = greyed(mix(mix(DAY_HORIZON, NIGHT_HORIZON, night), DUSK_HORIZON, twilight * 0.62), overcast * 0.35);
  const sunColor = mix(NOON_SUN, DUSK_SUN, clamp(twilight * 1.1, 0, 1));

  const sunLight = scale(sunColor, SUN_IRRADIANCE * sunUp);
  const moonLight = scale(MOONLIGHT, MOON_IRRADIANCE * smoothstep(0.02, 0.4, state.moonElevation));
  const lightColor = scale(mix(sunLight, moonLight, moonBlend), 1 - overcast * 0.45);
  const daylight = clamp((lightColor[0] + lightColor[1] + lightColor[2]) / (3 * SUN_IRRADIANCE * 0.9), 0, 1);

  const ambientColor = greyed(
    mix(mix(DAY_AMBIENT, NIGHT_AMBIENT, night), scale(DUSK_HORIZON, 0.34), twilight * 0.45),
    overcast * 0.3,
  );
  const cloudLit = scale(mix(mix(DAY_CLOUD_LIT, NIGHT_CLOUD_LIT, night), DUSK_CLOUD_LIT, twilight * 0.8), 1 - overcast * 0.22);
  const cloudShade = scale(
    mix(mix(DAY_CLOUD_SHADE, NIGHT_CLOUD_SHADE, night), DUSK_CLOUD_SHADE, twilight * 0.7),
    1 - overcast * 0.3,
  );

  return {
    zenith,
    horizon,
    sunColor,
    lightColor,
    ambientColor,
    cloudLit,
    cloudShade,
    cloudCover: clamp(weather.cloudCover - night * 0.04, 0, 1),
    deepWater: [0.004, 0.032, 0.095],
    shallowWater: [0.03, 0.5, 0.52],
    sand: [0.8, 0.72, 0.5],
    scatter: [0.05, 0.78, 0.56],
    twilight,
    moonBlend,
    daylight,
  };
}
