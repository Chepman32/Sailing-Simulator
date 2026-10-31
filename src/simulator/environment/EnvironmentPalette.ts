import { clamp, smoothstep } from "../math";
import type { TimeOfDayState } from "./EnvironmentMath";
import { createWeather, type WeatherSample } from "./WeatherMath";

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
  /** Colour in which falling rain catches the light. */
  rainLight: Rgb;
  /** Strong sunshine actually shining now, 0…1 (fair weather, the sun well up). */
  sunshine: number;
};

const DAY_ZENITH: Rgb = [0.018, 0.15, 0.66];
const DAY_HORIZON: Rgb = [0.24, 0.5, 0.9];
const NIGHT_ZENITH: Rgb = [0.006, 0.018, 0.056];
const NIGHT_HORIZON: Rgb = [0.03, 0.072, 0.15];
const DUSK_HORIZON: Rgb = [0.95, 0.42, 0.17];
const DUSK_ZENITH: Rgb = [0.07, 0.13, 0.36];

const NOON_SUN: Rgb = [1.0, 0.935, 0.79];
/**
 * A blazing tropical day: a deep, saturated cobalt overhead fading to a
 * clean, bright blue at the horizon (no lavender haze), and a hot, golden
 * sun that outshines the sky's blue fill.
 */
const SUNNY_ZENITH: Rgb = [0.006, 0.085, 0.68];
const SUNNY_HORIZON: Rgb = [0.19, 0.47, 0.96];
const SUNNY_SUN: Rgb = [1.0, 0.87, 0.64];
const SUNNY_AMBIENT: Rgb = [0.5, 0.58, 0.68];
const DUSK_SUN: Rgb = [1.0, 0.5, 0.2];
const MOONLIGHT: Rgb = [0.56, 0.69, 1.0];

const DAY_AMBIENT: Rgb = [0.46, 0.52, 0.6];
const NIGHT_AMBIENT: Rgb = [0.05, 0.076, 0.125];

const DAY_CLOUD_LIT: Rgb = [1.06, 1.03, 0.98];
const DAY_CLOUD_SHADE: Rgb = [0.47, 0.55, 0.68];
const DUSK_CLOUD_LIT: Rgb = [1.05, 0.56, 0.3];
const DUSK_CLOUD_SHADE: Rgb = [0.2, 0.17, 0.27];
/**
 * Night clouds are grey-black shapes against the starlit blue: their moonlit
 * tops a little above the sky's brightness, their bodies below it (the
 * moon's silver lining on the edges nearest it is added in the sky shader).
 */
const NIGHT_CLOUD_LIT: Rgb = [0.084, 0.095, 0.122];
const NIGHT_CLOUD_SHADE: Rgb = [0.008, 0.011, 0.02];

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

const FAIR_WEATHER: WeatherSample = createWeather("clear");

export function deriveEnvironmentPalette(state: TimeOfDayState, weather: WeatherSample = FAIR_WEATHER): EnvironmentPalette {
  const night = clamp(state.nightFactor, 0, 1);
  // A cloudy spell softens and dims the light and greys the sky; fair
  // weather leaves the palette untouched.
  const overcast = clamp(weather.overcast, 0, 1);
  // A storm goes further than a grey day: the sky, the clouds and the water
  // darken to slate and the sun is all but lost.
  const storm = clamp(weather.storm, 0, 1);
  // The sun is within roughly a hand's width of the horizon.
  const twilight = Math.exp(-Math.pow(state.sunElevation / 0.2, 2));
  const sunUp = smoothstep(-0.1, 0.12, state.sunElevation);
  const moonBlend = smoothstep(0.35, 0.78, night);
  // Sunshine is a daytime thing: it fades through dusk with the sun.
  const sunshine = clamp(weather.sunshine ?? 0, 0, 1) * (1 - night) * (1 - twilight * 0.85) * smoothstep(0.04, 0.3, state.sunElevation);

  const zenith = scale(
    greyed(mix(mix(mix(DAY_ZENITH, SUNNY_ZENITH, sunshine), NIGHT_ZENITH, night), DUSK_ZENITH, twilight * 0.5), overcast * 0.45 + storm * 0.4),
    1 - storm * 0.55,
  );
  const horizon = scale(
    greyed(mix(mix(mix(DAY_HORIZON, SUNNY_HORIZON, sunshine), NIGHT_HORIZON, night), DUSK_HORIZON, twilight * 0.62), overcast * 0.35 + storm * 0.4),
    1 - storm * 0.45,
  );
  const sunColor = mix(mix(NOON_SUN, SUNNY_SUN, sunshine), DUSK_SUN, clamp(twilight * 1.1, 0, 1));

  // Full sunshine: half as much direct light again as a merely fair sky.
  const sunLight = scale(sunColor, SUN_IRRADIANCE * sunUp * (1 + 0.5 * sunshine));
  const moonLight = scale(MOONLIGHT, MOON_IRRADIANCE * smoothstep(0.02, 0.22, state.moonElevation));
  const lightColor = scale(mix(sunLight, moonLight, moonBlend), (1 - overcast * 0.45) * (1 - storm * 0.38));
  const daylight = clamp((lightColor[0] + lightColor[1] + lightColor[2]) / (3 * SUN_IRRADIANCE * 0.9), 0, 1);

  const ambientColor = scale(
    greyed(mix(mix(mix(DAY_AMBIENT, SUNNY_AMBIENT, sunshine), NIGHT_AMBIENT, night), scale(DUSK_HORIZON, 0.34), twilight * 0.45), overcast * 0.3),
    1 - storm * 0.3,
  );
  const cloudLit = scale(
    mix(mix(DAY_CLOUD_LIT, NIGHT_CLOUD_LIT, night), DUSK_CLOUD_LIT, twilight * 0.8),
    (1 - overcast * 0.22) * (1 - storm * 0.5),
  );
  const cloudShade = scale(
    mix(mix(DAY_CLOUD_SHADE, NIGHT_CLOUD_SHADE, night), DUSK_CLOUD_SHADE, twilight * 0.7),
    (1 - overcast * 0.3) * (1 - storm * 0.62),
  );
  // Under a heavy sky the water turns from blue to slate green.
  // In full sun the open sea glows a luminous ultramarine.
  const deepWater = mix(
    mix([0.0035, 0.026, 0.08], [0.006, 0.05, 0.13], sunshine),
    [0.007, 0.03, 0.044],
    clamp(overcast * 0.35 + storm * 0.65, 0, 1),
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
    deepWater,
    // In full sun the shallows glow a vivid turquoise.
    shallowWater: mix([0.03, 0.5, 0.52], [0.02, 0.6, 0.6], sunshine),
    sand: [0.8, 0.72, 0.5],
    scatter: [0.05, 0.78, 0.56],
    twilight,
    moonBlend,
    daylight,
    rainLight: [
      Math.min(1.2, ambientColor[0] * 1.15 + lightColor[0] * 0.07),
      Math.min(1.2, ambientColor[1] * 1.15 + lightColor[1] * 0.07),
      Math.min(1.2, ambientColor[2] * 1.15 + lightColor[2] * 0.07),
    ],
    sunshine,
  };
}

/** Colour of lightning light: a cold blue-white. */
export const LIGHTNING_COLOR: Rgb = [0.78, 0.86, 1.0];

/**
 * The palette while a lightning flash lights the scene (`flash` about 0…1.6):
 * the light from the cloud deck floods every horizontal surface (ambient),
 * the haze and the rain, so sea, islands, ships and squalls all leap out of
 * the dark for an instant. The sky is lit separately (`uFlash`).
 */
export function litByLightning(palette: EnvironmentPalette, flash: number): EnvironmentPalette {
  const light = Math.max(0, flash);
  if (light <= 0) return palette;
  const add = (base: Rgb, amount: number): Rgb => [
    base[0] + LIGHTNING_COLOR[0] * light * amount,
    base[1] + LIGHTNING_COLOR[1] * light * amount,
    base[2] + LIGHTNING_COLOR[2] * light * amount,
  ];
  return {
    ...palette,
    ambientColor: add(palette.ambientColor, 1.25),
    horizon: add(palette.horizon, 0.45),
    rainLight: add(palette.rainLight, 1.6),
    cloudLit: add(palette.cloudLit, 0.5),
    cloudShade: add(palette.cloudShade, 0.35),
  };
}
