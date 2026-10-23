/** Pure audio design constants and helpers, testable without Web Audio. */

export type SpatialPoint = { x: number; y: number; z: number };

export type HornKind = "container" | "lng" | "tanker" | "cruise";

export type HornProfile = {
  /** Fundamental frequencies in Hz; more than one sounds a chime/chord horn. */
  tones: readonly number[];
  /** Prolonged blast length in seconds (COLREGs: 4–6 s). */
  duration: number;
  /** Strength of the brassy formant band that carries on small speakers. */
  formant: number;
};

/**
 * Large ships sound low air/steam horns. Their 70–140 Hz fundamentals do not
 * reproduce on phone speakers, so each horn is built from rich sawtooth
 * harmonics plus a formant band around 300–700 Hz that keeps the timbre
 * recognisable at any playback size.
 */
export const HORN_PROFILES: Record<HornKind, HornProfile> = {
  container: { tones: [82], duration: 4.6, formant: 1 },
  lng: { tones: [74], duration: 5.2, formant: 0.9 },
  tanker: { tones: [69], duration: 5.6, formant: 0.85 },
  cruise: { tones: [110, 138.6], duration: 4.2, formant: 1.1 },
};

/** Ship's bell partials: frequency ratio to the strike tone, level, decay (s). */
export const BELL_PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 0.32, 3.4],
  [1, 0.55, 2.6],
  [1.19, 0.34, 2.1],
  [1.5, 0.22, 1.7],
  [2, 0.42, 1.5],
  [2.52, 0.2, 1.1],
  [3.01, 0.14, 0.8],
  [4.17, 0.09, 0.5],
  [5.43, 0.05, 0.35],
];

export const BELL_STRIKE_HZ = 820;

/** Distant sounds lose their highs over open water. */
export function airAbsorptionCutoff(distance: number): number {
  return Math.max(900, 18000 / (1 + Math.max(0, distance) / 140));
}

/** WebAudio "inverse" distance model, mirrored for tests and loop culling. */
export function inverseDistanceGain(distance: number, refDistance: number, rolloff: number): number {
  const d = Math.max(distance, refDistance);
  return refDistance / (refDistance + rolloff * (d - refDistance));
}

export function distanceBetween(a: SpatialPoint, b: SpatialPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
