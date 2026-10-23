/**
 * Eruption cycle of the volcano. Pure so the timing and intensity envelope can
 * be tested without WebGL:
 *
 * quiet (light steam) → rumble (glow rises) → eruption (ash column, lava bombs,
 * explosions) → waning (ash thins, lava cools) → quiet
 */
export type VolcanoPhase = "quiet" | "rumble" | "eruption" | "waning";

export const VOLCANO_PHASE_DURATION: Record<VolcanoPhase, readonly [number, number]> = {
  quiet: [70, 120],
  rumble: [6, 6],
  eruption: [24, 32],
  waning: [18, 18],
};

/** The first eruption comes soon after loading so it is not missed. */
export const VOLCANO_FIRST_QUIET_SECONDS = 30;

export type VolcanoActivity = {
  /** Lava emission 0…1. */
  lava: number;
  /** Dark ash puffs per second. */
  ash: number;
  /** Pale steam puffs per second. */
  steam: number;
  /** Incandescent bombs per second. */
  bombs: number;
  /** Upward launch speed of new ash, m/s. */
  plumeSpeed: number;
};

export function nextVolcanoPhase(phase: VolcanoPhase): VolcanoPhase {
  switch (phase) {
    case "quiet":
      return "rumble";
    case "rumble":
      return "eruption";
    case "eruption":
      return "waning";
    case "waning":
      return "quiet";
  }
}

export function volcanoPhaseDuration(phase: VolcanoPhase, randomUnit: number): number {
  const [minimum, maximum] = VOLCANO_PHASE_DURATION[phase];
  return minimum + (maximum - minimum) * Math.max(0, Math.min(1, randomUnit));
}

export function volcanoActivity(phase: VolcanoPhase, progress: number): VolcanoActivity {
  const t = Math.max(0, Math.min(1, progress));
  switch (phase) {
    case "quiet":
      return { lava: 0.12, ash: 0, steam: 0.55, bombs: 0, plumeSpeed: 5 };
    case "rumble":
      return { lava: 0.12 + 0.4 * t, ash: 0.6 * t, steam: 0.9, bombs: 0, plumeSpeed: 8 };
    case "eruption": {
      // A violent opening blast that settles into a sustained column.
      const opening = Math.exp(-t * 6);
      return { lava: 1, ash: 3.2 + 2.6 * opening, steam: 0.6, bombs: 9 + 26 * opening, plumeSpeed: 22 + 14 * opening };
    }
    case "waning":
      return { lava: 1 - 0.75 * t, ash: 2.2 * (1 - t), steam: 0.8, bombs: 2 * (1 - t), plumeSpeed: 12 - 6 * t };
  }
}
