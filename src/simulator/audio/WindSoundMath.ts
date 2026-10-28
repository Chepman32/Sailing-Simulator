import { clamp, smoothstep } from "../math";

/**
 * How the wind sounds, from the weather (pure numbers; `AudioSystem` plays
 * them).
 *
 * On a fair day the wind is barely there: a faint, low breath of air that
 * the yacht's own speed only freshens a little (twenty knots under power on
 * a calm day is a breeze past the ears, not a gale). A real blow is another
 * sound altogether, built in layers as a storm is heard at sea:
 *
 * - **roar**: the deep, broadband rumble of a gale over the water, its
 *   lowpass opening as the gusts strike;
 * - **howl**: the wind moaning through the rigging and over the hulls, a
 *   pair of resonant bands whose pitch slides up and down with each gust;
 * - **shriek**: in a hurricane, the shrouds screaming high and thin;
 * - **spindrift**: the hiss of spray torn off the crests.
 *
 * Everything swells and eases with the gusts (`gust`, `gustApproaching`) and
 * a slow wander of its own, so a storm never sounds like a steady noise.
 */

export type WindSoundInput = {
  /** True wind over the sea, m/s. */
  trueWind: number;
  /** Apparent wind at the yacht, m/s. */
  apparentWind: number;
  /** Storm intensity of the weather, 0…1. */
  storm: number;
  /** Wind of the weather relative to the trade wind (1 fair … 3.3 hurricane). */
  windScale: number;
  /** A gust under way, and one approaching, 0…1. */
  gust: number;
  gustApproaching: number;
  /** The wind's own slow wander, −1…1. */
  wander: number;
};

export type WindSoundLevels = {
  /** The fair-weather breath of air, and its band's centre (Hz). */
  breeze: number;
  breezeTone: number;
  /** The gale's roar, and its lowpass (Hz). */
  roar: number;
  roarTone: number;
  /** Moaning in the rigging, and its pitch (Hz). */
  howl: number;
  howlPitch: number;
  /** The shrouds screaming in a hurricane, and its pitch (Hz). */
  shriek: number;
  shriekPitch: number;
  /** Spray torn off the crests. */
  spindrift: number;
};

/** How stormy the wind is, 0 (fair) … 1 (hurricane). */
export function windFury(storm: number, windScale: number): number {
  return clamp(Math.max(smoothstep(1.3, 3.0, windScale), clamp(storm, 0, 1) * 0.95), 0, 1);
}

export function windSoundLevels(input: WindSoundInput): WindSoundLevels {
  const trueWind = Math.max(0, Number.isFinite(input.trueWind) ? input.trueWind : 0);
  const apparent = Math.max(0, Number.isFinite(input.apparentWind) ? input.apparentWind : 0);
  const fury = windFury(input.storm, input.windScale);
  const wander = clamp(input.wander, -1, 1);
  const gusty = clamp(0.5 + 0.5 * wander + clamp(input.gust, 0, 1) * 0.6 + clamp(input.gustApproaching, 0, 1) * 0.3, 0, 1.5);
  return {
    breeze:
      (0.0022 + 0.0038 * smoothstep(4, 11, trueWind) + 0.0028 * smoothstep(9, 20, apparent)) * (0.85 + 0.25 * gusty) +
      fury * 0.012,
    breezeTone: 300 + 260 * smoothstep(4, 14, Math.max(trueWind, apparent * 0.7)),
    roar: Math.pow(fury, 1.2) * 0.13 * (0.7 + 0.4 * gusty),
    roarTone: 160 + 220 * fury + 170 * gusty * fury,
    howl: smoothstep(0.3, 1, fury) * 0.045 * (0.45 + 0.75 * gusty),
    howlPitch: 240 + 220 * fury + 130 * gusty + 40 * wander,
    shriek: smoothstep(0.75, 1, fury) * 0.012 * (0.4 + gusty),
    shriekPitch: 1500 + 600 * gusty,
    spindrift: smoothstep(0.45, 1, fury) * 0.03 * (0.6 + 0.5 * gusty),
  };
}

/** The wind's own slow wander at `time` seconds, −1…1: a few incommensurate swells. */
export function windWander(time: number): number {
  return clamp(0.55 * Math.sin(time * 0.37 + 1.3) + 0.3 * Math.sin(time * 0.91 + 0.2) + 0.15 * Math.sin(time * 2.3 + 2.9), -1, 1);
}
