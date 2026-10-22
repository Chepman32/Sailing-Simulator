import { clamp, smoothstep, TAU } from "../math";

export type RandomSource = () => number;

export type LightAircraftKind = "seaplane" | "banner";

export type LowPassPlan = {
  kind: LightAircraftKind;
  startX: number;
  startZ: number;
  heading: number;
  turnRate: number;
  altitude: number;
  speed: number;
  duration: number;
  /** +1 when the yacht is on the aircraft's starboard (+X) side at closest approach. */
  observerSide: 1 | -1;
};

export type AirlinerRoute = {
  startX: number;
  startZ: number;
  heading: number;
  altitude: number;
  speed: number;
  duration: number;
  contrailLifetime: number;
};

// Low-level sightseeing and banner-tow passes. Distances are simulator meters;
// the sea-level scene is compressed, so these altitudes read as a low pass.
export const LOW_PASS_ALTITUDE_MIN = 68;
export const LOW_PASS_ALTITUDE_MAX = 112;
export const LOW_PASS_SPEED_MIN = 38;
export const LOW_PASS_SPEED_MAX = 48;
export const LOW_PASS_HALF_LENGTH = 1300;
export const LOW_PASS_OFFSET_MIN = 55;
export const LOW_PASS_OFFSET_MAX = 230;
export const LOW_PASS_FIRST_DELAY = 14;
export const LOW_PASS_INTERVAL_MIN = 28;
export const LOW_PASS_INTERVAL_MAX = 70;
export const LOW_PASS_MAX_TURN_RATE = 0.012;
export const GRAVITY = 9.81;

// High-altitude traffic lives in a parallax-compressed sky layer. The layer
// follows the focus horizontally by AIRLINER_LAYER_FOLLOW, so a 600 m layer
// moves against the sea like traffic at roughly 10 km.
export const AIRLINER_ALTITUDE_MIN = 520;
export const AIRLINER_ALTITUDE_MAX = 640;
export const AIRLINER_SPEED_MIN = 12;
export const AIRLINER_SPEED_MAX = 17;
export const AIRLINER_ROUTE_HALF_LENGTH = 1250;
export const AIRLINER_ROUTE_OFFSET_MAX = 520;
export const AIRLINER_INTERVAL_MIN = 38;
export const AIRLINER_INTERVAL_MAX = 95;
export const AIRLINER_LAYER_FOLLOW = 0.94;
export const AIRLINER_VISUAL_SCALE = 0.16;

// Contrails: a young trail is a narrow bright line that forms a short distance
// behind each engine, then spreads by turbulent diffusion, drifts with the
// upper-level wind, breaks into patches, and dissipates.
export const CONTRAIL_FORMATION_TIME = 0.55;
export const CONTRAIL_INITIAL_WIDTH = 0.42;
export const CONTRAIL_SPREAD_RATE = 0.95;
export const CONTRAIL_LIFETIME_MIN = 75;
export const CONTRAIL_LIFETIME_MAX = 150;
export const CONTRAIL_SAMPLE_SPACING = 11;

export const SPEED_OF_SOUND = 343;

function range(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random();
}

export function nextLowPassDelay(random: RandomSource): number {
  return range(random, LOW_PASS_INTERVAL_MIN, LOW_PASS_INTERVAL_MAX);
}

export function nextAirlinerDelay(random: RandomSource): number {
  return range(random, AIRLINER_INTERVAL_MIN, AIRLINER_INTERVAL_MAX);
}

/**
 * Plans a straight-ish pass whose closest approach is beside the focus. The
 * aircraft starts LOW_PASS_HALF_LENGTH meters before that point so it enters
 * from the haze instead of appearing near the yacht.
 */
export function planLowPass(random: RandomSource, focusX: number, focusZ: number, kind: LightAircraftKind): LowPassPlan {
  const heading = random() * TAU;
  const side: 1 | -1 = random() < 0.5 ? 1 : -1;
  const offset = range(random, LOW_PASS_OFFSET_MIN, LOW_PASS_OFFSET_MAX);
  const speed = range(random, LOW_PASS_SPEED_MIN, LOW_PASS_SPEED_MAX) * (kind === "banner" ? 0.86 : 1);
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  // Starboard of heading h is (cos h, -sin h) with +Z forward and +X right.
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  // Put the closest-approach point on the aircraft's port or starboard side.
  const closestX = focusX - rightX * offset * side;
  const closestZ = focusZ - rightZ * offset * side;
  return {
    kind,
    startX: closestX - forwardX * LOW_PASS_HALF_LENGTH,
    startZ: closestZ - forwardZ * LOW_PASS_HALF_LENGTH,
    heading,
    turnRate: range(random, -LOW_PASS_MAX_TURN_RATE, LOW_PASS_MAX_TURN_RATE),
    altitude: range(random, LOW_PASS_ALTITUDE_MIN, LOW_PASS_ALTITUDE_MAX) * (kind === "banner" ? 0.82 : 1),
    speed,
    duration: (LOW_PASS_HALF_LENGTH * 2) / speed,
    observerSide: side,
  };
}

/** Coordinated-turn bank angle for a given speed and turn rate. */
export function coordinatedBank(speed: number, turnRate: number): number {
  return clamp(Math.atan((speed * turnRate) / GRAVITY), -0.6, 0.6);
}

/** Smooth fade-in/out at the ends of a pass so aircraft never pop. */
export function lowPassVisibility(elapsed: number, duration: number): number {
  return smoothstep(0, 6, elapsed) * (1 - smoothstep(duration - 6, duration, elapsed));
}

/** Plans an airliner route in sky-layer coordinates around the layer origin. */
export function planAirlinerRoute(random: RandomSource): AirlinerRoute {
  const heading = random() * TAU;
  const offset = range(random, -AIRLINER_ROUTE_OFFSET_MAX, AIRLINER_ROUTE_OFFSET_MAX);
  const speed = range(random, AIRLINER_SPEED_MIN, AIRLINER_SPEED_MAX);
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const centerX = Math.cos(heading) * offset;
  const centerZ = -Math.sin(heading) * offset;
  return {
    startX: centerX - forwardX * AIRLINER_ROUTE_HALF_LENGTH,
    startZ: centerZ - forwardZ * AIRLINER_ROUTE_HALF_LENGTH,
    heading,
    altitude: range(random, AIRLINER_ALTITUDE_MIN, AIRLINER_ALTITUDE_MAX),
    speed,
    duration: (AIRLINER_ROUTE_HALF_LENGTH * 2) / speed,
    contrailLifetime: range(random, CONTRAIL_LIFETIME_MIN, CONTRAIL_LIFETIME_MAX),
  };
}

/** Full width of one engine's contrail at a given age. Mirrored in GLSL. */
export function contrailWidth(age: number): number {
  return CONTRAIL_INITIAL_WIDTH + CONTRAIL_SPREAD_RATE * Math.sqrt(Math.max(0, age));
}

/** Peak opacity of a contrail segment at a given age. Mirrored in GLSL. */
export function contrailOpacity(age: number, lifetime: number): number {
  if (age < 0 || age >= lifetime) return 0;
  const formation = smoothstep(0, CONTRAIL_FORMATION_TIME, age);
  const dissipation = 1 - smoothstep(lifetime * 0.3, lifetime, age);
  // Spreading conserves ice mass, so a wider trail is optically thinner.
  const thinning = Math.pow(CONTRAIL_INITIAL_WIDTH * 2.4 / (contrailWidth(age) + CONTRAIL_INITIAL_WIDTH * 1.4), 0.32);
  return clamp(formation * dissipation * thinning, 0, 1);
}

/**
 * Frequency ratio heard from a moving source. radialSpeed is positive while
 * the source approaches the listener.
 */
export function dopplerRatio(radialSpeed: number): number {
  const approach = clamp(radialSpeed, -SPEED_OF_SOUND * 0.5, SPEED_OF_SOUND * 0.5);
  return SPEED_OF_SOUND / (SPEED_OF_SOUND - approach);
}

/** Inverse-distance loudness with a near-field clamp, in [0, 1]. */
export function distanceGain(distance: number, referenceDistance: number): number {
  return clamp(referenceDistance / Math.max(referenceDistance, distance), 0, 1);
}

/** Air absorption: distant aircraft lose their high harmonics first. */
export function airAbsorptionCutoff(distance: number): number {
  return 650 + 4200 * Math.exp(-Math.max(0, distance) / 260);
}
