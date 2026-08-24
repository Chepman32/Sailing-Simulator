export type DolphinState =
  | "swim"
  | "approach"
  | "breach_ascent"
  | "airborne"
  | "reentry"
  | "splash"
  | "dive";

export const DOLPHIN_STATE_DURATION: Record<DolphinState, number> = {
  swim: Number.POSITIVE_INFINITY,
  approach: 1.25,
  breach_ascent: 0.42,
  airborne: 0.42,
  reentry: 0.46,
  splash: 0.16,
  dive: 1.05,
};

export function nextDolphinState(state: DolphinState): DolphinState {
  switch (state) {
    case "swim":
      return "approach";
    case "approach":
      return "breach_ascent";
    case "breach_ascent":
      return "airborne";
    case "airborne":
      return "reentry";
    case "reentry":
      return "splash";
    case "splash":
      return "dive";
    case "dive":
      return "swim";
  }
}

export function canStartBreach(forwardSpeed: number, cooldown: number): boolean {
  return forwardSpeed >= 6.2 && cooldown <= 0;
}

export type WhalePhase = "cruise" | "surface" | "dive";

export const WHALE_PHASE_DURATION: Record<WhalePhase, number> = {
  cruise: 22,
  surface: 8,
  dive: 6,
};

export function nextWhalePhase(phase: WhalePhase): WhalePhase {
  switch (phase) {
    case "cruise":
      return "surface";
    case "surface":
      return "dive";
    case "dive":
      return "cruise";
  }
}
