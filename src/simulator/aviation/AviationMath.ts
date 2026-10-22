import { clamp, smoothstep, TAU } from "../math";

export type RandomSource = () => number;

export type LightAircraftKind = "seaplane" | "banner";

export type LowPassMode = "flyby" | "orbit";

export type LowPassPlan = {
  kind: LightAircraftKind;
  mode: LowPassMode;
  startX: number;
  startZ: number;
  heading: number;
  turnRate: number;
  altitude: number;
  speed: number;
  duration: number;
  /** +1 when the yacht is on the aircraft's starboard (+X) side at closest approach. */
  observerSide: 1 | -1;
  /** Orbit only: seconds at which the banked turn starts and ends, and its rate. */
  turnStart: number;
  turnEnd: number;
  orbitTurnRate: number;
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
export const LOW_PASS_ALTITUDE_MIN = 40;
export const LOW_PASS_ALTITUDE_MAX = 75;
export const LOW_PASS_SPEED_MIN = 38;
export const LOW_PASS_SPEED_MAX = 48;
export const LOW_PASS_HALF_LENGTH = 1300;
export const LOW_PASS_OFFSET_MIN = 35;
export const LOW_PASS_OFFSET_MAX = 160;
export const LOW_PASS_FIRST_DELAY = 14;
export const LOW_PASS_INTERVAL_MIN = 28;
export const LOW_PASS_INTERVAL_MAX = 70;
export const LOW_PASS_MAX_TURN_RATE = 0.012;
export const GRAVITY = 9.81;
/** Steepest bank flown (about 43 degrees), a firm sightseeing turn. */
export const MAX_BANK = 0.75;
// Sightseeing orbit: a banked circle around the yacht entered and left on
// tangents, so the aircraft shows its planform without ever overflying it.
export const ORBIT_RADIUS_MIN = 110;
export const ORBIT_RADIUS_MAX = 170;
export const ORBIT_SPEED_MIN = 35;
export const ORBIT_SPEED_MAX = 40;
export const ORBIT_SWEEP_MIN = Math.PI * 1.1;
export const ORBIT_SWEEP_MAX = Math.PI * 1.7;
export const ORBIT_ENTRY_LENGTH = 1150;
export const ORBIT_EXIT_LENGTH = 1250;
/** Seconds over which the aircraft rolls into and out of the turn. */
export const ORBIT_ROLL_TIME = 4;

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
export const CONTRAIL_SPREAD_RATE = 1.5;
export const CONTRAIL_LIFETIME_MIN = 75;
export const CONTRAIL_LIFETIME_MAX = 150;
export const CONTRAIL_SAMPLE_SPACING = 11;
/** Wavelength (sky-layer meters) of the periodic puffs an ageing contrail forms. */
export const CONTRAIL_CROW_WAVELENGTH = 24;

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
    mode: "flyby",
    turnStart: 0,
    turnEnd: 0,
    orbitTurnRate: 0,
  };
}

/** Plans a sightseeing circle of the focus by the floatplane. */
export function planOrbit(random: RandomSource, focusX: number, focusZ: number): LowPassPlan {
  const radius = range(random, ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX);
  const speed = range(random, ORBIT_SPEED_MIN, ORBIT_SPEED_MAX);
  const direction: 1 | -1 = random() < 0.5 ? 1 : -1;
  const sweep = range(random, ORBIT_SWEEP_MIN, ORBIT_SWEEP_MAX);
  const entryAngle = random() * TAU;
  // A point on the circle is focus + R (sin a, cos a); flying with increasing
  // a means heading a + PI/2, i.e. a right (clockwise from above) turn.
  const heading = entryAngle + (direction * Math.PI) / 2;
  const entryX = focusX + Math.sin(entryAngle) * radius;
  const entryZ = focusZ + Math.cos(entryAngle) * radius;
  const turnStart = ORBIT_ENTRY_LENGTH / speed;
  const turnEnd = turnStart + (sweep * radius) / speed;
  return {
    kind: "seaplane",
    mode: "orbit",
    startX: entryX - Math.sin(heading) * ORBIT_ENTRY_LENGTH,
    startZ: entryZ - Math.cos(heading) * ORBIT_ENTRY_LENGTH,
    heading,
    turnRate: 0,
    altitude: range(random, 40, 62),
    speed,
    duration: turnEnd + ORBIT_EXIT_LENGTH / speed,
    // The circle's centre (the yacht) is always on the inside of the turn.
    observerSide: direction,
    turnStart,
    turnEnd,
    orbitTurnRate: (direction * speed) / radius,
  };
}

/** Commanded turn rate (rad/s, positive = right) at a time into the pass. */
export function lowPassTurnRate(plan: LowPassPlan, elapsed: number): number {
  if (plan.mode !== "orbit") return plan.turnRate;
  const half = ORBIT_ROLL_TIME / 2;
  // Rolling in centred on the tangent point keeps the flown circle centred
  // on the planned one to within a few meters.
  const rolledIn = smoothstep(plan.turnStart - half, plan.turnStart + half, elapsed);
  const rolledOut = smoothstep(plan.turnEnd - half, plan.turnEnd + half, elapsed);
  return plan.orbitTurnRate * (rolledIn - rolledOut);
}

/**
 * Light-air turbulence: a smooth, bounded disturbance in roll, pitch and
 * height (radians, radians, meters) from incommensurate sines.
 */
export function turbulence(time: number, seed: number): { roll: number; pitch: number; heave: number } {
  return {
    roll: 0.022 * Math.sin(time * 1.31 + seed) + 0.012 * Math.sin(time * 2.93 + seed * 2.1) + 0.006 * Math.sin(time * 6.1 + seed * 0.7),
    pitch: 0.012 * Math.sin(time * 1.73 + seed * 1.3) + 0.006 * Math.sin(time * 4.4 + seed * 0.4),
    heave: 0.6 * Math.sin(time * 0.91 + seed) + 0.25 * Math.sin(time * 2.2 + seed * 1.7),
  };
}

/** Coordinated-turn bank angle for a given speed and turn rate. */
export function coordinatedBank(speed: number, turnRate: number): number {
  return clamp(Math.atan((speed * turnRate) / GRAVITY), -MAX_BANK, MAX_BANK);
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
 * Strength in [0, 1] of the Crow instability: after tens of seconds the two
 * trailing vortices link up and the line pinches into a chain of puffs.
 * Mirrored in GLSL.
 */
export function crowInstability(age: number): number {
  return smoothstep(18, 55, age);
}

/**
 * Frequency ratio heard from a moving source. radialSpeed is positive while
 * the source approaches the listener.
 */
export function dopplerRatio(radialSpeed: number): number {
  const approach = clamp(radialSpeed, -SPEED_OF_SOUND * 0.5, SPEED_OF_SOUND * 0.5);
  return SPEED_OF_SOUND / (SPEED_OF_SOUND - approach);
}

/**
 * Extra travel time (seconds) of the sound that bounces off the sea compared
 * with the direct path, using the image source below the surface. Mixing the
 * two gives the sweeping comb-filter "phasing" of a real low flyby.
 */
export function waterReflectionDelay(horizontalDistance: number, sourceHeight: number, listenerHeight: number): number {
  const horizontal = Math.max(0, horizontalDistance);
  const source = Math.max(0, sourceHeight);
  const listener = Math.max(0.2, listenerHeight);
  const direct = Math.hypot(horizontal, source - listener);
  const reflected = Math.hypot(horizontal, source + listener);
  return (reflected - direct) / SPEED_OF_SOUND;
}

/** Inverse-distance loudness with a near-field clamp, in [0, 1]. */
export function distanceGain(distance: number, referenceDistance: number): number {
  return clamp(referenceDistance / Math.max(referenceDistance, distance), 0, 1);
}

/** Air absorption: distant aircraft lose their high harmonics first. */
export function airAbsorptionCutoff(distance: number): number {
  return 650 + 4200 * Math.exp(-Math.max(0, distance) / 260);
}
