import { clamp } from "../math";
import { shortestAngleDifference } from "./SwimmerDynamics";
import type { MarineWorld } from "./WaterContact";

/**
 * How swimmers keep off islands.
 *
 * Two layers, like a real animal's senses and the physical world:
 *
 * 1. `steerClearOfShallows` looks ahead along a fan of headings, as far as the
 *    animal needs to turn away at its current speed and turning radius, and
 *    chooses the heading closest to where it wants to go whose whole run stays
 *    in water deep enough for its body. The look-ahead grows with speed, so a
 *    fast dolphin starts its turn early and the avoidance reads as a deliberate
 *    change of course rather than a bounce. It also reports how urgent the
 *    situation is, so the caller can ease off the speed.
 * 2. `confineToDeepWater` is the hard limit: if a body nevertheless reaches
 *    water too shallow for it (a yacht pushed it there, a slot moved onshore),
 *    it is eased back toward the open sea at no more than a swimming speed,
 *    never teleported. Land itself is therefore unreachable.
 *
 * Both use the same bathymetry the ocean shader shades and the rendered
 * waterline, so what the animal avoids is what the player sees: the beach and
 * the sloping underwater shelf around it.
 */

export type ShallowsSteering = {
  /** Heading to swim toward. */
  heading: number;
  /** 0 when the way ahead is clear, 1 when the shallows are right ahead. */
  urgency: number;
};

export type ShoreAvoidanceProfile = {
  /** Water this animal needs under it, metres. */
  minDepth: number;
  /** Tightest turn the animal can make, metres. */
  turnRadius: number;
  /** Shortest look-ahead, metres. */
  minLookAhead: number;
  /** Seconds of travel to look ahead on top of the turn. */
  lookTime: number;
};

export const DOLPHIN_SHORE: ShoreAvoidanceProfile = { minDepth: 2.6, turnRadius: 4.5, minLookAhead: 12, lookTime: 2.6 };
export const SHARK_SHORE: ShoreAvoidanceProfile = { minDepth: 5.5, turnRadius: 7, minLookAhead: 22, lookTime: 4 };
export const WHALE_SHORE: ShoreAvoidanceProfile = { minDepth: 13.5, turnRadius: 26, minLookAhead: 70, lookTime: 10 };

/** Distance a swimmer looks ahead at `speed`. */
export function shoreLookAhead(speed: number, profile: ShoreAvoidanceProfile): number {
  return Math.max(profile.minLookAhead, profile.turnRadius * 2.2 + Math.max(0, speed) * profile.lookTime);
}

const SAMPLES = 9;

/**
 * Metres along `heading` from (x, z) before the water becomes shallower than
 * `minDepth`, or `lookAhead` when the whole run is clear.
 */
export function freeRun(
  world: MarineWorld,
  x: number,
  z: number,
  heading: number,
  lookAhead: number,
  minDepth: number,
): number {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  for (let index = 1; index <= SAMPLES; index += 1) {
    // Denser near the animal, where a miss would matter most.
    const fraction = (index / SAMPLES) ** 1.35;
    const distance = lookAhead * fraction;
    if (world.seabedDepth(x + sin * distance, z + cos * distance) < minDepth) {
      return lookAhead * ((index - 1) / SAMPLES) ** 1.35;
    }
  }
  return lookAhead;
}

const OFFSETS = [0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.1, -1.1, 1.45, -1.45, 1.85, -1.85, 2.3, -2.3, 2.8, -2.8, Math.PI];

/**
 * Heading as close as possible to `desired` whose run ahead stays in deep
 * enough water, considering where the body is pointing now (it cannot pivot).
 */
export function steerClearOfShallows(
  world: MarineWorld,
  x: number,
  z: number,
  currentHeading: number,
  desired: number,
  speed: number,
  profile: ShoreAvoidanceProfile,
  out: ShallowsSteering,
): ShallowsSteering {
  const lookAhead = shoreLookAhead(speed, profile);
  const ahead = freeRun(world, x, z, currentHeading, lookAhead, profile.minDepth);
  out.urgency = clamp(1 - ahead / lookAhead, 0, 1);

  // Already over water that is too shallow: the only good way is deeper.
  if (world.seabedDepth(x, z) < profile.minDepth) {
    out.heading = deeperHeading(world, x, z, currentHeading);
    out.urgency = 1;
    return out;
  }
  const wanted = freeRun(world, x, z, desired, lookAhead, profile.minDepth);
  if (wanted >= lookAhead && ahead >= lookAhead * 0.45) {
    out.heading = desired;
    return out;
  }
  let best = desired;
  let bestScore = score(wanted, lookAhead, 0, shortestAngleDifference(currentHeading, desired));
  for (const offset of OFFSETS) {
    const candidate = desired + offset;
    const run = freeRun(world, x, z, candidate, lookAhead, profile.minDepth);
    const candidateScore = score(run, lookAhead, offset, shortestAngleDifference(currentHeading, candidate));
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  out.heading = Math.atan2(Math.sin(best), Math.cos(best));
  return out;
}

/**
 * Clear run matters most; then staying close to the wish; then not having to
 * swing the body round. A fully clear heading always beats a blocked one.
 */
function score(run: number, lookAhead: number, fromDesired: number, fromCurrent: number): number {
  const clear = run / lookAhead;
  return clear * 2 + (clear >= 1 ? 1 : 0) - (Math.abs(fromDesired) / Math.PI) * 0.6 - (Math.abs(fromCurrent) / Math.PI) * 0.35;
}

/** Direction in which the sea gets deeper fastest (away from the coast on land). */
function deeperHeading(world: MarineWorld, x: number, z: number, fallback: number): number {
  const step = 2;
  let gx = world.seabedDepth(x + step, z) - world.seabedDepth(x - step, z);
  let gz = world.seabedDepth(x, z + step) - world.seabedDepth(x, z - step);
  if (Math.hypot(gx, gz) < 1e-4) {
    // On the flat beach the depth no longer changes: use the coastline itself.
    gx = world.shoreDistance(x + step, z) - world.shoreDistance(x - step, z);
    gz = world.shoreDistance(x, z + step) - world.shoreDistance(x, z - step);
  }
  if (Math.hypot(gx, gz) < 1e-6) return fallback;
  return Math.atan2(gx, gz);
}

/** Scratch result so callers need not allocate. */
export function createShallowsSteering(heading = 0): ShallowsSteering {
  return { heading, urgency: 0 };
}

/**
 * Hard limit: eases a body that has reached water shallower than `minDepth`
 * back toward deep water, no faster than `escapeSpeed`. Returns the distance
 * moved this step (0 when the body was fine).
 */
export function confineToDeepWater(
  world: MarineWorld,
  position: { x: number; z: number },
  minDepth: number,
  escapeSpeed: number,
  delta: number,
): number {
  const depth = world.seabedDepth(position.x, position.z);
  if (depth >= minDepth) return 0;
  const step = 1;
  let gx = world.seabedDepth(position.x + step, position.z) - world.seabedDepth(position.x - step, position.z);
  let gz = world.seabedDepth(position.x, position.z + step) - world.seabedDepth(position.x, position.z - step);
  let slope = Math.hypot(gx, gz) / (2 * step);
  if (slope < 0.02) {
    gx = world.shoreDistance(position.x + step, position.z) - world.shoreDistance(position.x - step, position.z);
    gz = world.shoreDistance(position.x, position.z + step) - world.shoreDistance(position.x, position.z - step);
    slope = 0.46;
  }
  const length = Math.hypot(gx, gz);
  if (!(length > 1e-6)) return 0;
  const needed = (minDepth - depth) / Math.max(slope, 0.05);
  const move = Math.min(needed, Math.max(0, escapeSpeed) * Math.max(0, delta));
  position.x += (gx / length) * move;
  position.z += (gz / length) * move;
  return move;
}
