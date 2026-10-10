import { clamp, smoothstep } from "../math";
import type { SimulatorControls } from "../types";
import type { PlanarBody, ShoreSampler } from "./ShoreContact";

/**
 * Collision avoidance for the yacht near islands: a helmsman's reflex that the
 * player cannot switch off.
 *
 * Every fixed step the guard sweeps the hulls' leading edge along the course
 * over the distance the yacht needs to stop or turn at her current speed. If
 * that sweep meets the shallows, it takes the helm:
 *
 * 1. it picks an escape heading toward open water, turning to whichever side
 *    clears soonest, and then keeps that side for the whole manoeuvre so it can
 *    never dither or circle in front of the beach;
 * 2. it steers for that heading with the real rudders, using a burst of
 *    propeller wash when the yacht is slow so the bow swings round in her own
 *    length, and slows her (astern if needed) in proportion to the room left;
 * 3. under sail it eases the sheets to take the drive off while turning;
 * 4. once the course ahead is clear and she is on the escape heading, it gives
 *    the helm back; the player's own throttle then brings the speed back.
 *
 * The guard only ever changes the commands the physics receives. Forces,
 * inertia and turning circle are those of the boat, so the avoidance looks
 * like seamanship, not a push. `ShoreContact` remains the physical boundary
 * for anything the guard cannot prevent (drifting with the engine off).
 */

/** Room the hull edge keeps from the rendered waterline. */
export const GUARD_MARGIN = 3.2;
/** Fixed look-ahead and look-ahead per m/s of speed, metres. */
export const GUARD_BASE_LOOKAHEAD = 20;
export const GUARD_LOOKAHEAD_PER_SPEED = 7;
/** Seconds the guard holds the helm at least, once engaged. */
const MINIMUM_ENGAGEMENT = 1.6;
/** Distance off the coast (hull centre) before the helm is handed back. */
const RELEASE_CLEARANCE = 16;
/**
 * A helmsman who turns straight back in gets taken further out each time, so
 * the yacht never shuffles back and forth in front of the beach.
 */
const REPEAT_WINDOW = 12;
const MAX_RELEASE_CLEARANCE = 34;
/** Room ahead below which the yacht backs off before turning, and the room that ends it. */
const BACKING_START = 2.5;
const BACKING_END = 9;
const SWEEP_STEP = 1.25;

/** Leading edges of the hull outline: [starboard, forward] in metres. */
const BOW_EDGE: readonly (readonly [number, number])[] = [
  [-1.8, 4.7], [0, 4.4], [1.8, 4.7], [-1.9, 2.2], [1.9, 2.2],
];
const STERN_EDGE: readonly (readonly [number, number])[] = [
  [-1.8, -4.6], [1.8, -4.6], [-1.9, -2.2], [1.9, -2.2],
];

export type ShoreGuardState = {
  active: boolean;
  /** +1 turning to starboard, −1 to port; fixed while engaged. */
  turnSide: number;
  escapeHeading: number;
  engagedTime: number;
  /** 0 nothing ahead … 1 the shallows at the bow. */
  urgency: number;
  /** Heading turned through since engaging, radians, to catch a full circle. */
  turned: number;
  previousHeading: number;
  /** Backing off the beach before turning (engine only). */
  backing: boolean;
  /** Seconds since the guard last handed the helm back. */
  sinceRelease: number;
  /** Open water the yacht must reach before the helm is handed back, metres. */
  releaseClearance: number;
  /** Commands actually given to the physics this step. */
  readonly output: SimulatorControls;
};

export function createShoreGuard(): ShoreGuardState {
  return {
    active: false,
    turnSide: 1,
    escapeHeading: 0,
    engagedTime: 0,
    urgency: 0,
    turned: 0,
    previousHeading: 0,
    backing: false,
    sinceRelease: Number.POSITIVE_INFINITY,
    releaseClearance: RELEASE_CLEARANCE,
    output: { throttle: 0, rudder: 0, sailTrim: 1 },
  };
}

const scratchNormal = { x: 0, z: 1 };
/** Outward shore normal at the yacht, kept apart from the sweep's scratch. */
const coastNormal = { x: 0, z: 1 };

/**
 * Metres the hull can travel along `heading` (astern when `direction` is −1)
 * before any point of its leading edge comes within `GUARD_MARGIN` of the
 * shore, up to `distance`.
 */
export function hullFreeRun(
  shore: ShoreSampler,
  x: number,
  z: number,
  heading: number,
  distance: number,
  direction = 1,
): number {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const rx = fz;
  const rz = -fx;
  const edge = direction >= 0 ? BOW_EDGE : STERN_EDGE;
  for (let travelled = 0; travelled <= distance; travelled += SWEEP_STEP) {
    const along = travelled * direction;
    for (const [side, ahead] of edge) {
      const px = x + rx * side + fx * (ahead + along);
      const pz = z + rz * side + fz * (ahead + along);
      if (shore(px, pz, scratchNormal) < GUARD_MARGIN) return Math.max(0, travelled - SWEEP_STEP);
    }
  }
  return distance;
}

export function guardLookAhead(speed: number): number {
  return GUARD_BASE_LOOKAHEAD + Math.max(0, speed) * GUARD_LOOKAHEAD_PER_SPEED;
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const OFFSET_STEP = 0.2;
const OFFSET_COUNT = 16;

/** Best escape heading on one side: the smallest turn that clears, else the most room. */
function escapeOnSide(
  shore: ShoreSampler,
  body: PlanarBody,
  side: number,
  lookAhead: number,
): { heading: number; run: number; offset: number } {
  let best = { heading: body.heading, run: -1, offset: 0 };
  for (let index = 1; index <= OFFSET_COUNT; index += 1) {
    const offset = index * OFFSET_STEP;
    const heading = wrap(body.heading + side * offset);
    const run = hullFreeRun(shore, body.position.x, body.position.z, heading, lookAhead);
    if (run >= lookAhead) return { heading, run, offset };
    if (run > best.run + 0.5) best = { heading, run, offset };
  }
  return best;
}

/**
 * Decides this step's commands. `controls` are the player's; the result is
 * written to `guard.output` and returned. Pure apart from `guard`.
 */
export function updateShoreGuard(
  guard: ShoreGuardState,
  body: PlanarBody,
  controls: SimulatorControls,
  engineRunning: boolean,
  shore: ShoreSampler,
  delta: number,
): SimulatorControls {
  const output = guard.output;
  output.throttle = controls.throttle;
  output.rudder = controls.rudder;
  output.sailTrim = controls.sailTrim;

  const fx = Math.sin(body.heading);
  const fz = Math.cos(body.heading);
  const forwardSpeed = body.velocity.x * fx + body.velocity.z * fz;
  const lookAhead = guardLookAhead(Math.max(forwardSpeed, 0));
  // Sweep along the course and along where the present swing will take the
  // bow in a couple of seconds, so a yacht turning in is caught early.
  const swing = clamp(body.yawRate * 2, -0.8, 0.8);
  const ahead = Math.min(
    hullFreeRun(shore, body.position.x, body.position.z, body.heading, lookAhead),
    Math.abs(swing) > 0.05 ? hullFreeRun(shore, body.position.x, body.position.z, body.heading + swing, lookAhead) + 2 : lookAhead,
  );
  const drivingAhead = forwardSpeed > 0.25 || (engineRunning && controls.throttle > 0.05) || controls.sailTrim > 0.2;
  guard.urgency = clamp(1 - ahead / lookAhead, 0, 1);
  if (!guard.active) guard.sinceRelease += delta;

  // Backing toward a beach: stop backing before the transoms reach it.
  if (!guard.active && forwardSpeed < -0.2) {
    const astern = hullFreeRun(shore, body.position.x, body.position.z, body.heading, 6 + -forwardSpeed * 4, -1);
    if (astern < 6 + -forwardSpeed * 4) {
      output.throttle = Math.max(controls.throttle, engineRunning ? 0.15 : 0);
      output.rudder = controls.rudder * 0.3;
    }
    return output;
  }

  if (!guard.active) {
    if (!(ahead < lookAhead && drivingAhead && (forwardSpeed > 0.1 || ahead < lookAhead * 0.6))) return output;
    // Engage: turn to whichever side clears with the smaller turn and more room.
    const port = escapeOnSide(shore, body, -1, lookAhead);
    const starboard = escapeOnSide(shore, body, 1, lookAhead);
    const score = (option: { run: number; offset: number }): number => option.run / lookAhead - option.offset * 0.12;
    // A helmsman already turning one way keeps turning that way when it helps.
    const preference = clamp(controls.rudder * 0.15 + body.yawRate * 0.4, -0.15, 0.15);
    const choice = score(starboard) + preference >= score(port) - preference ? starboard : port;
    guard.turnSide = choice === starboard ? 1 : -1;
    guard.escapeHeading = choice.heading;
    guard.active = true;
    guard.releaseClearance =
      guard.sinceRelease < REPEAT_WINDOW
        ? Math.min(MAX_RELEASE_CLEARANCE, guard.releaseClearance + 10)
        : RELEASE_CLEARANCE;
    guard.engagedTime = 0;
    guard.backing = false;
    guard.turned = 0;
    guard.previousHeading = body.heading;
  }

  guard.engagedTime += delta;
  guard.turned += Math.abs(wrap(body.heading - guard.previousHeading));
  guard.previousHeading = body.heading;
  // Refresh the escape heading, always on the same side.
  const escape = escapeOnSide(shore, body, guard.turnSide, lookAhead);
  if (escape.run >= lookAhead || escape.run > hullFreeRun(shore, body.position.x, body.position.z, guard.escapeHeading, lookAhead) + 1) {
    guard.escapeHeading = escape.heading;
  }
  const offshore = shore(body.position.x, body.position.z, coastNormal);
  // Clear ahead but still close in: bear away from the coast, not just along it.
  if (offshore < guard.releaseClearance && ahead >= lookAhead) {
    const seaward = Math.atan2(coastNormal.x, coastNormal.z);
    const outward = wrap(seaward + clamp(wrap(body.heading - seaward), -0.8, 0.8));
    if (hullFreeRun(shore, body.position.x, body.position.z, outward, lookAhead) >= lookAhead) guard.escapeHeading = outward;
  }
  const error = wrap(guard.escapeHeading - body.heading);

  // Hand back only when heading out to sea with the coast well astern, so a
  // helmsman turning straight back has room to be caught again in good time.
  const seawardness = fx * coastNormal.x + fz * coastNormal.z;
  const clear =
    ahead >= lookAhead && Math.abs(error) < 0.22 && offshore >= guard.releaseClearance && seawardness > 0.5;
  if (clear && guard.engagedTime > MINIMUM_ENGAGEMENT) {
    guard.active = false;
    guard.sinceRelease = 0;
    return output;
  }

  // Helm: steer for the escape heading, damped by the turn rate.
  const steer = clamp(error * 2.4 - body.yawRate * 1.1, -1, 1);
  // Room left decides the speed: enough way for the rudders, never a crash.
  const room = Math.max(0, ahead - 3);
  const safeSpeed = clamp(room * 0.45, 0, 4.5);
  if (engineRunning) {
    // Very close and still facing the beach: back off first, then turn. The
    // decision is latched so the yacht does not shuffle back and forth.
    if (!guard.backing && ahead < BACKING_START && Math.abs(error) > 0.6) guard.backing = true;
    if (guard.backing && (ahead >= BACKING_END || Math.abs(error) < 0.45)) guard.backing = false;
    if (guard.backing) {
      output.throttle = -0.6;
      output.rudder = forwardSpeed < -0.2 ? -steer : 0;
    } else {
      // A propeller kick keeps water over the rudders, so she pivots in
      // little more than her own length even from rest.
      const playerAhead = Math.max(0, controls.throttle);
      const brake = clamp(0.45 + (safeSpeed - forwardSpeed) * 0.6, -0.7, Math.max(0.45, playerAhead));
      // With room to turn, keep the propellers driving: slowing down would
      // only take the bite out of the rudders.
      output.throttle = ahead > 6 ? Math.max(brake, Math.min(0.45, Math.max(0.45, playerAhead))) : brake;
      output.rudder = forwardSpeed < -0.3 ? -steer : steer;
    }
  } else {
    output.rudder = steer;
    // Under sail: ease the sheets in proportion to the danger.
    output.sailTrim = clamp(controls.sailTrim - guard.urgency * 0.9, 0.2, 1);
  }
  // A full circle in front of the beach means the turn cannot be made this
  // way: try the other side.
  if (guard.turned > Math.PI * 2) {
    guard.turnSide = -guard.turnSide;
    guard.turned = 0;
  }
  guard.urgency = Math.max(guard.urgency, smoothstep(0.1, 1.2, Math.abs(error)) * 0.5);
  return output;
}
