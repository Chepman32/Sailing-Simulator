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

export type WhalePhase = "cruise" | "tail_rise" | "tail_strike" | "dive";

export const WHALE_MIN_BOAT_DISTANCE = 50;
export const WHALE_MAX_BOAT_DISTANCE = 100;
const WHALE_SPAWN_MARGIN = 16;

export function isWhaleWithinBoatRange(distance: number): boolean {
  return (
    Number.isFinite(distance) &&
    distance >= WHALE_MIN_BOAT_DISTANCE &&
    distance <= WHALE_MAX_BOAT_DISTANCE
  );
}

export function whaleSpawnDistance(randomUnit: number): number {
  const bounded = Math.max(0, Math.min(1, randomUnit));
  const minimum = WHALE_MIN_BOAT_DISTANCE + WHALE_SPAWN_MARGIN;
  const maximum = WHALE_MAX_BOAT_DISTANCE - WHALE_SPAWN_MARGIN;
  return minimum + (maximum - minimum) * bounded;
}

export function whaleOrbitHeading(
  relativeX: number,
  relativeZ: number,
  orbitDirection: number,
  preferredDistance: number,
): number {
  const distance = Math.max(0.001, Math.hypot(relativeX, relativeZ));
  const radialX = relativeX / distance;
  const radialZ = relativeZ / distance;
  const direction = orbitDirection < 0 ? -1 : 1;
  const tangentX = direction * radialZ;
  const tangentZ = -direction * radialX;
  const radialCorrection = Math.max(-0.72, Math.min(0.72, (preferredDistance - distance) / 20));
  return Math.atan2(
    tangentX + radialX * radialCorrection,
    tangentZ + radialZ * radialCorrection,
  );
}

export const WHALE_PHASE_DURATION: Record<WhalePhase, number> = {
  cruise: 18,
  tail_rise: 3.2,
  tail_strike: 0.86,
  dive: 5.6,
};

export const WHALE_TAIL_IMPACT_ARM_CLEARANCE = 0.18;
export const WHALE_TAIL_SPLASH_INTENSITY = 5;
// The ocean intentionally stays translucent near the yacht.  Keep the whale
// invisible below this depth, then use a short, dithered fade at the local
// water plane so a submerged body cannot read through the surface.
export const WHALE_SUBMERGED_FADE_START = -0.72;
export const WHALE_SURFACE_REVEAL_CLEARANCE = 0.16;

export type WhaleTailSlapPose = {
  bodyDepth: number;
  bodyPitch: number;
  tailFlex: number;
  impact: boolean;
};

export function whaleTailSlapPose(phase: WhalePhase, progress: number): WhaleTailSlapPose {
  const bounded = Math.max(0, Math.min(1, progress));
  const smooth = bounded * bounded * (3 - 2 * bounded);

  switch (phase) {
    case "tail_rise":
      return {
        bodyDepth: -6.72 + smooth * 0.46,
        bodyPitch: smooth * 0.056,
        tailFlex: smooth * 0.78,
        impact: false,
      };
    case "tail_strike": {
      const strike = Math.pow(bounded, 1.55);
      return {
        bodyDepth: -6.26 - smooth * 0.48,
        bodyPitch: 0.056 - smooth * 0.04,
        tailFlex: 0.78 - strike * 1.18,
        impact: bounded >= 0.3,
      };
    }
    case "dive":
      return {
        bodyDepth: -6.74 - smooth * 1.62,
        bodyPitch: 0.02 + Math.sin(Math.PI * bounded) * 0.05,
        tailFlex: -0.34 * (1 - smooth),
        impact: false,
      };
    case "cruise":
      return { bodyDepth: -6.72, bodyPitch: 0, tailFlex: 0, impact: false };
  }
}

export function whaleSurfaceVisibility(clearance: number): number {
  if (!Number.isFinite(clearance)) return 0;
  const span = WHALE_SURFACE_REVEAL_CLEARANCE - WHALE_SUBMERGED_FADE_START;
  const bounded = Math.max(0, Math.min(1, (clearance - WHALE_SUBMERGED_FADE_START) / span));
  return bounded * bounded * (3 - 2 * bounded);
}

export function didWhaleFlukeStrike(
  phase: WhalePhase,
  armed: boolean,
  previousClearance: number,
  clearance: number,
): boolean {
  return (
    phase === "tail_strike" &&
    armed &&
    Number.isFinite(previousClearance) &&
    Number.isFinite(clearance) &&
    previousClearance > 0 &&
    clearance <= 0
  );
}

export function nextWhalePhase(phase: WhalePhase): WhalePhase {
  switch (phase) {
    case "cruise":
      return "tail_rise";
    case "tail_rise":
      return "tail_strike";
    case "tail_strike":
      return "dive";
    case "dive":
      return "cruise";
  }
}
