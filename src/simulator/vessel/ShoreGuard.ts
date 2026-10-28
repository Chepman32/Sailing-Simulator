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
export const GUARD_BASE_LOOKAHEAD = 15;
export const GUARD_LOOKAHEAD_PER_SPEED = 5.5;
/** Helm (|rudder|) above which the player counts as steering for himself. */
export const ACTIVE_HELM = 0.3;
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

/**
 * How closely the guard lets the yacht come to a coast. A coast shoals out
 * ahead of the waterline, so the guard keeps well off it and takes her well
 * out before handing back. (Near a ship's side `updateShipGuard` is used.)
 */
export type GuardProfile = {
  /** Room the hull edge keeps from the obstacle, m. */
  margin: number;
  /** Look-ahead at rest and per m/s of speed, m. */
  baseLookAhead: number;
  lookAheadPerSpeed: number;
  /** Distance off (hull centre) before the helm is handed back, and its cap after repeats. */
  release: number;
  maxRelease: number;
  /** Hand back only when pointing away from the obstacle. */
  handBackSeaward: boolean;
};

export const SHORE_PROFILE: GuardProfile = {
  margin: GUARD_MARGIN,
  baseLookAhead: GUARD_BASE_LOOKAHEAD,
  lookAheadPerSpeed: GUARD_LOOKAHEAD_PER_SPEED,
  release: RELEASE_CLEARANCE,
  maxRelease: MAX_RELEASE_CLEARANCE,
  handBackSeaward: true,
};

/** Room ahead below which the yacht backs off before turning, and the room that ends it. */
const BACKING_START = 2.5;
const BACKING_END = 9;
const SWEEP_STEP = 1.25;
/**
 * A manoeuvre that has crept along the beach this long without turning out
 * to sea is abandoned for the seaward turn (or a back-off): the yacht must
 * never be held against a coast by her own guard.
 */
export const STALL_SECONDS = 5;

/** Leading edges of the hull outline: [starboard, forward] in metres. */
const BOW_EDGE: readonly (readonly [number, number])[] = [
  [-1.8, 4.7], [0, 4.4], [1.8, 4.7], [-1.9, 2.2], [1.9, 2.2],
];
const STERN_EDGE: readonly (readonly [number, number])[] = [
  [-1.8, -4.6], [1.8, -4.6], [-1.9, -2.2], [1.9, -2.2],
];

/** Farthest edge point from the yacht's centre, m. */
const HULL_REACH = Math.max(...[...BOW_EDGE, ...STERN_EDGE].map(([side, ahead]) => Math.hypot(side, ahead)));

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
  /** Seconds the manoeuvre has made no headway out to sea (see `STALL_SECONDS`). */
  stallTime: number;
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
    stallTime: 0,
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
  margin = GUARD_MARGIN,
): number {
  // Open water: one sample at the yacht says the whole sweep is clear. The
  // clearance is a first-order distance estimate, so a generous safety
  // factor keeps this exact in practice; it spares hundreds of coastline
  // evaluations per step on the open sea.
  if (shore(x, z, scratchNormal) > (distance + HULL_REACH) * 1.3 + margin + 6) return distance;
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
      if (shore(px, pz, scratchNormal) < margin) return Math.max(0, travelled - SWEEP_STEP);
    }
  }
  return distance;
}

export function guardLookAhead(speed: number, profile: GuardProfile = SHORE_PROFILE): number {
  return profile.baseLookAhead + Math.max(0, speed) * profile.lookAheadPerSpeed;
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
  margin = GUARD_MARGIN,
): { heading: number; run: number; offset: number } {
  let best = { heading: body.heading, run: -1, offset: 0 };
  for (let index = 1; index <= OFFSET_COUNT; index += 1) {
    const offset = index * OFFSET_STEP;
    const heading = wrap(body.heading + side * offset);
    const run = hullFreeRun(shore, body.position.x, body.position.z, heading, lookAhead, 1, margin);
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
  profile: GuardProfile = SHORE_PROFILE,
): SimulatorControls {
  const output = guard.output;
  output.throttle = controls.throttle;
  output.rudder = controls.rudder;
  output.sailTrim = controls.sailTrim;

  const fx = Math.sin(body.heading);
  const fz = Math.cos(body.heading);
  const forwardSpeed = body.velocity.x * fx + body.velocity.z * fz;
  const lookAhead = guardLookAhead(Math.max(forwardSpeed, 0), profile);
  const margin = profile.margin;
  // Sweep along the course and along where the present swing will take the
  // bow in a couple of seconds, so a yacht turning in is caught early.
  const swing = clamp(body.yawRate * 2, -0.8, 0.8);
  const ahead = Math.min(
    hullFreeRun(shore, body.position.x, body.position.z, body.heading, lookAhead, 1, margin),
    Math.abs(swing) > 0.05 ? hullFreeRun(shore, body.position.x, body.position.z, body.heading + swing, lookAhead, 1, margin) + 2 : lookAhead,
  );
  const drivingAhead = forwardSpeed > 0.25 || (engineRunning && controls.throttle > 0.05) || controls.sailTrim > 0.2;
  guard.urgency = clamp(1 - ahead / lookAhead, 0, 1);
  if (!guard.active) guard.sinceRelease += delta;

  // Backing toward a beach: stop backing before the transoms reach it.
  if (!guard.active && forwardSpeed < -0.2) {
    const astern = hullFreeRun(shore, body.position.x, body.position.z, body.heading, 6 + -forwardSpeed * 4, -1, margin);
    if (astern < 6 + -forwardSpeed * 4) {
      output.throttle = Math.max(controls.throttle, engineRunning ? 0.15 : 0);
      output.rudder = controls.rudder * 0.3;
    }
    return output;
  }

  // A helmsman already turning away from the coast keeps the helm: the guard
  // only steps in when his own turn will not clear it, or it is too close
  // to leave to him. (Taking the wheel from someone who is already avoiding
  // the beach made the rudder feel dead.)
  const playerSide = Math.abs(controls.rudder) >= ACTIVE_HELM ? Math.sign(controls.rudder) : 0;
  const playerClears =
    playerSide !== 0 &&
    hullFreeRun(shore, body.position.x, body.position.z, body.heading + playerSide * 0.7, lookAhead, 1, margin) >= lookAhead * 0.8 &&
    ahead > lookAhead * 0.35;

  if (!guard.active) {
    if (!(ahead < lookAhead && drivingAhead && (forwardSpeed > 0.1 || ahead < lookAhead * 0.6))) return output;
    if (playerClears) return output;
    // Engage: turn to whichever side clears with the smaller turn and more room.
    const port = escapeOnSide(shore, body, -1, lookAhead, margin);
    const starboard = escapeOnSide(shore, body, 1, lookAhead, margin);
    const score = (option: { run: number; offset: number }): number => option.run / lookAhead - option.offset * 0.12;
    // A helmsman already turning one way keeps turning that way when it helps.
    const preference = clamp(controls.rudder * 0.15 + body.yawRate * 0.4, -0.15, 0.15);
    const choice = score(starboard) + preference >= score(port) - preference ? starboard : port;
    guard.turnSide = choice === starboard ? 1 : -1;
    guard.escapeHeading = choice.heading;
    guard.active = true;
    guard.releaseClearance =
      guard.sinceRelease < REPEAT_WINDOW
        ? Math.min(profile.maxRelease, guard.releaseClearance + profile.release * 0.6)
        : profile.release;
    guard.engagedTime = 0;
    guard.backing = false;
    guard.turned = 0;
    guard.stallTime = 0;
    guard.previousHeading = body.heading;
  }

  guard.engagedTime += delta;
  // Which way round is the short way out to sea.
  const offshoreNow = shore(body.position.x, body.position.z, coastNormal);
  const seaSide = Math.sign(wrap(Math.atan2(coastNormal.x, coastNormal.z) - body.heading)) || guard.turnSide;
  // The helmsman turning the short way out to sea is right: the guard turns
  // with him instead of wrestling the wheel the long way round.
  if (playerSide !== 0 && playerSide === seaSide && guard.turnSide !== playerSide) {
    guard.turnSide = playerSide;
    guard.turned = 0;
    guard.stallTime = 0;
    guard.escapeHeading = escapeOnSide(shore, body, playerSide, lookAhead, margin).heading;
  }
  // Creeping along the beach without getting out: turn the short way out,
  // and if that is already the way, back off first to make room.
  const creeping = forwardSpeed < 1.6 && offshoreNow < guard.releaseClearance && Math.abs(wrap(guard.escapeHeading - body.heading)) > 0.45;
  guard.stallTime = creeping ? guard.stallTime + delta : Math.max(0, guard.stallTime - delta * 2);
  if (guard.stallTime > STALL_SECONDS) {
    guard.stallTime = 0;
    guard.turned = 0;
    if (guard.turnSide !== seaSide) {
      guard.turnSide = seaSide;
      guard.escapeHeading = escapeOnSide(shore, body, seaSide, lookAhead, margin).heading;
    } else if (engineRunning) {
      guard.backing = true;
    }
  }
  guard.turned += Math.abs(wrap(body.heading - guard.previousHeading));
  guard.previousHeading = body.heading;
  // Refresh the escape heading, always on the same side.
  const escape = escapeOnSide(shore, body, guard.turnSide, lookAhead, margin);
  if (escape.run >= lookAhead || escape.run > hullFreeRun(shore, body.position.x, body.position.z, guard.escapeHeading, lookAhead, 1, margin) + 1) {
    guard.escapeHeading = escape.heading;
  }
  const offshore = shore(body.position.x, body.position.z, coastNormal);
  // Clear ahead but still close in: bear away from the coast, not just along it.
  if (offshore < guard.releaseClearance && ahead >= lookAhead) {
    const seaward = Math.atan2(coastNormal.x, coastNormal.z);
    const outward = wrap(seaward + clamp(wrap(body.heading - seaward), -0.8, 0.8));
    if (hullFreeRun(shore, body.position.x, body.position.z, outward, lookAhead, 1, margin) >= lookAhead) guard.escapeHeading = outward;
  }
  const error = wrap(guard.escapeHeading - body.heading);

  // Hand back only when heading out to sea with the coast well astern, so a
  // helmsman turning straight back has room to be caught again in good time.
  const seawardness = fx * coastNormal.x + fz * coastNormal.z;
  const clear =
    ahead >= lookAhead && Math.abs(error) < 0.22 && offshore >= guard.releaseClearance && (seawardness > 0.5 || !profile.handBackSeaward);
  // Clear water ahead and the helmsman steering again: hand the helm back
  // without waiting to be pointed out to sea.
  const handBack = ahead >= lookAhead && playerSide !== 0 && guard.engagedTime > 0.6;
  if ((clear && guard.engagedTime > MINIMUM_ENGAGEMENT) || handBack) {
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
    if (guard.backing && (ahead >= Math.min(BACKING_END, lookAhead) || Math.abs(error) < 0.45)) guard.backing = false;
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
      output.throttle = ahead > profile.margin + 2.8 ? Math.max(brake, Math.min(0.45, Math.max(0.45, playerAhead))) : brake;
      output.rudder = forwardSpeed < -0.3 ? -steer : steer;
    }
  } else {
    output.rudder = steer;
    // Under sail: ease the sheets in proportion to the danger.
    output.sailTrim = clamp(controls.sailTrim - guard.urgency * 0.9, 0.2, 1);
  }
  // The helmsman turning the same way as the guard, only harder, gets his
  // way: the wheel never feels dead while he is doing the right thing.
  if (!guard.backing && playerSide !== 0 && Math.sign(output.rudder) === playerSide && Math.abs(controls.rudder) > Math.abs(output.rudder)) {
    output.rudder = controls.rudder;
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

/** Room the hull edge keeps from a ship's side: a helmsman may lie a couple of metres off. */
export const SHIP_GUARD_MARGIN = 1.2;
/** Seconds of closing speed the ship guard looks ahead, beyond the distance to stop. */
const SHIP_GUARD_HORIZON = 1.6;
/** Deceleration the yacht can count on to stop her closing speed (astern, or turning), m/s². */
const SHIP_GUARD_BRAKING = 0.45;

/** Room a yacht closing on a ship's side at `closing` m/s needs to stop short of it, m. */
export function shipStoppingRoom(closing: number): number {
  const speed = Math.max(0, closing);
  return speed * SHIP_GUARD_HORIZON + (speed * speed) / (2 * SHIP_GUARD_BRAKING) + 0.4;
}
const SHIP_EDGE: readonly (readonly [number, number])[] = [...BOW_EDGE, ...STERN_EDGE];
const shipNormal = { x: 0, z: 1 };

/**
 * The helmsman's reflex beside a ship. A ship's side is a steel wall in deep
 * water: the yacht may come alongside to a couple of metres, so the guard
 * does nothing until the hull is about to touch (closing on it within
 * `SHIP_GUARD_HORIZON` seconds of `SHIP_GUARD_MARGIN`). Then it brings her
 * parallel to the side, the short way round, backing off first if her bow is
 * pressed against it, and hands the helm back as soon as she has stopped
 * closing. It never takes her away from the ship.
 */
export function updateShipGuard(
  guard: ShoreGuardState,
  body: PlanarBody,
  controls: SimulatorControls,
  engineRunning: boolean,
  hull: ShoreSampler,
  delta: number,
): SimulatorControls {
  const output = guard.output;
  output.throttle = controls.throttle;
  output.rudder = controls.rudder;
  output.sailTrim = controls.sailTrim;
  if (!guard.active) guard.sinceRelease += delta;

  const fx = Math.sin(body.heading);
  const fz = Math.cos(body.heading);
  const rx = fz;
  const rz = -fx;
  // The point of the hull outline nearest the side, its normal and how fast it closes.
  let nearest = Infinity;
  let nX = 0;
  let nZ = 1;
  let closing = 0;
  for (const [side, ahead] of SHIP_EDGE) {
    const offX = rx * side + fx * ahead;
    const offZ = rz * side + fz * ahead;
    const clearance = hull(body.position.x + offX, body.position.z + offZ, shipNormal);
    if (clearance >= nearest) continue;
    nearest = clearance;
    nX = shipNormal.x;
    nZ = shipNormal.z;
    const pointVx = body.velocity.x + body.yawRate * offZ;
    const pointVz = body.velocity.z - body.yawRate * offX;
    closing = -(pointVx * nX + pointVz * nZ);
  }
  const room = nearest - SHIP_GUARD_MARGIN;
  guard.urgency = clamp(1 - room / 6, 0, 1) * (closing > 0 ? 1 : 0.3);

  if (!guard.active) {
    if (!(closing > 0.12 && room < shipStoppingRoom(closing))) return output;
    guard.active = true;
    guard.engagedTime = 0;
    guard.backing = false;
    guard.turned = 0;
    guard.stallTime = 0;
    guard.previousHeading = body.heading;
  }
  guard.engagedTime += delta;

  // Parallel to the side, whichever way along it is the smaller turn.
  const along = Math.atan2(-nZ, nX);
  const options = [along, wrap(along + Math.PI)];
  const target = Math.abs(wrap(options[0]! - body.heading)) <= Math.abs(wrap(options[1]! - body.heading)) ? options[0]! : options[1]!;
  guard.escapeHeading = target;
  const error = wrap(target - body.heading);
  const forwardSpeed = body.velocity.x * fx + body.velocity.z * fz;
  // Bow into the side: back off before turning.
  const facing = -(fx * nX + fz * nZ);
  if (engineRunning && !guard.backing && room < 1 && facing > 0.5) guard.backing = true;
  if (guard.backing && (room > 2.5 || facing < 0.35)) guard.backing = false;

  const steer = clamp(error * 2.4 - body.yawRate * 1.1, -1, 1);
  if (guard.backing) {
    output.throttle = -0.6;
    output.rudder = forwardSpeed < -0.2 ? -steer : 0;
  } else {
    output.rudder = forwardSpeed < -0.3 ? -steer : steer;
    if (engineRunning) {
      // Closing too fast to turn clear: full astern while the rudders still
      // bite. Otherwise enough way for the rudders, never driving at the side.
      const braking = closing > 0.4 && room < shipStoppingRoom(closing) - 0.4;
      output.throttle = braking ? -0.7 : clamp(controls.throttle, -0.6, room < 1.5 ? 0.3 : 0.6);
    } else {
      output.sailTrim = clamp(controls.sailTrim - guard.urgency * 0.9, 0.2, 1);
    }
  }
  // The helmsman turning the same way, only harder, gets his way.
  const playerSide = Math.abs(controls.rudder) >= ACTIVE_HELM ? Math.sign(controls.rudder) : 0;
  if (!guard.backing && playerSide !== 0 && Math.sign(output.rudder) === playerSide && Math.abs(controls.rudder) > Math.abs(output.rudder)) {
    output.rudder = controls.rudder;
  }
  // No longer closing on the side (or lying parallel to it): hand back.
  const settled = closing < 0.05 && (Math.abs(error) < 0.3 || room > 3);
  if (!guard.backing && guard.engagedTime > 0.4 && settled) {
    guard.active = false;
    guard.sinceRelease = 0;
    output.throttle = controls.throttle;
    output.rudder = controls.rudder;
    output.sailTrim = controls.sailTrim;
  }
  return output;
}
