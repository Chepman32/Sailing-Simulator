import { clamp, smoothstep } from "../math";
import { GRAVITY } from "./DiverMath";

/**
 * The skipper going over the side, as a short script in first person.
 *
 * Seen through his eyes: his hands let go of the wheel and come off the rim,
 * he turns outboard, takes a step to the edge of the aft deck, crouches with
 * his arms swung back, and jumps feet first, arms up, out past the hull into
 * the sea. Up to the moment his eyes go under, everything is in the yacht's
 * own frame (she is hove-to, barely moving, and the half second in the air is
 * too short for her motion to show); from there he is a swimmer in the world.
 *
 * Coordinates are vessel space (+Z the bow, +X the starboard side, which as
 * the player sees her is on the left), offsets from where he stands at the
 * wheel. Pure numbers; `Skipper.leap` poses the figure and `DiverController`
 * runs the clock.
 */

/** Seconds from the key to control in the water. */
export const LEAP_SECONDS = 3;
/** When his feet leave the deck, s. */
export const LEAP_TAKEOFF = 1.72;
/** Which way he turns to: outboard (+X) and a little aft, radians from facing the bow. */
export const LEAP_TURN = 1.85;
/** Speed of the jump: out along where he faces, and up, m/s. */
export const LEAP_OUT_SPEED = 2.5;
export const LEAP_UP_SPEED = 3.1;
/** Where he takes off from, relative to his place at the wheel (vessel space, m). */
export const LEAP_EDGE_X = 0.36;
export const LEAP_EDGE_Z = 0.1;

export type LeapPose = {
  /** 0 both hands on the rim … 1 off it. */
  release: number;
  /** Heading of his body, radians from the bow (toward +X positive). */
  turn: number;
  /** His feet, relative to where he stood at the wheel (vessel space, m). */
  x: number;
  y: number;
  z: number;
  /** Knees bent, 0 standing … 1 a deep crouch. */
  crouch: number;
  /** Arms: −1 swung back for the spring … 0 at his sides … 1 thrown up over his head. */
  arms: number;
  /** Legs drawn up in the air, 0 … 1. */
  tuck: number;
  /** Where he looks, relative to his body: pitch up positive, yaw toward +X positive (rad). */
  lookPitch: number;
  lookYaw: number;
  /** Feet off the deck. */
  airborne: boolean;
};

export function createLeapPose(): LeapPose {
  return { release: 0, turn: 0, x: 0, y: 0, z: 0, crouch: 0, arms: 0, tuck: 0, lookPitch: 0, lookYaw: 0, airborne: false };
}

/** Eases from a to b as t runs from t0 to t1. */
function span(t: number, t0: number, t1: number, a: number, b: number): number {
  return a + (b - a) * smoothstep(t0, t1, t);
}

/** The pose `t` seconds after he lets go (t ≥ 0; the flight continues past the script's end). */
export function leapPose(t: number, out: LeapPose = createLeapPose()): LeapPose {
  // Hands off the wheel first, the head following them down and up again.
  out.release = smoothstep(0.12, 0.85, t);
  // He turns while stepping out from behind the wheel: a step aside, then
  // to the edge of the deck, toward the open side.
  out.turn = span(t, 0.6, 1.25, 0, LEAP_TURN);
  const toEdge = smoothstep(0.7, 1.5, t);
  out.x = LEAP_EDGE_X * toEdge;
  out.z = LEAP_EDGE_Z * smoothstep(0.6, 1.0, t);
  out.y = 0;
  // The spring: knees bend, arms swing back; then up and out.
  const load = smoothstep(1.28, 1.62, t);
  const fire = smoothstep(LEAP_TAKEOFF - 0.12, LEAP_TAKEOFF + 0.05, t);
  out.crouch = load * (1 - fire);
  out.arms = -load * (1 - fire) + fire * span(t, LEAP_TAKEOFF + 0.25, LEAP_TAKEOFF + 0.7, 1, 0.55);
  // Eyes: on his hands at the wheel, then out over the side, then down at
  // the water rushing up.
  out.lookPitch = span(t, 0.0, 0.5, -0.74, -0.8) + span(t, 0.62, 1.2, 0, 0.78) + span(t, 1.3, LEAP_TAKEOFF + 0.25, 0, -0.42);
  out.lookYaw = span(t, 0.45, 0.85, 0, 0.35) * (1 - smoothstep(0.9, 1.3, t));
  out.airborne = t >= LEAP_TAKEOFF;
  out.tuck = 0;
  if (out.airborne) {
    const flight = t - LEAP_TAKEOFF;
    const along = LEAP_OUT_SPEED * flight;
    out.x += Math.sin(LEAP_TURN) * along;
    out.z += Math.cos(LEAP_TURN) * along;
    out.y = LEAP_UP_SPEED * flight - 0.5 * GRAVITY * flight * flight;
    // Knees up over the top of the arc, straight again to enter feet first.
    out.tuck = Math.sin(clamp(flight / 0.62, 0, 1) * Math.PI) * 0.55;
  }
  return out;
}

/** Velocity of his body in the air at `t`, vessel space (m/s). */
export function leapVelocity(t: number, out: { x: number; y: number; z: number }) {
  const flight = Math.max(0, t - LEAP_TAKEOFF);
  out.x = Math.sin(LEAP_TURN) * LEAP_OUT_SPEED;
  out.z = Math.cos(LEAP_TURN) * LEAP_OUT_SPEED;
  out.y = LEAP_UP_SPEED - GRAVITY * flight;
  return out;
}
