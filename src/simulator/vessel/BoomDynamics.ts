import { clamp } from "../math";

/**
 * The main boom as a damped pendulum on its sheet.
 *
 * Angles are signed: positive swings the boom toward starboard. The physics
 * decides how far the crew has eased the sheet and which side the wind fills
 * the sail from; the boom follows with inertia. When the wind crosses the
 * stern (a gybe) the sail fills from the other side all at once and the boom
 * slams across, which the sheet stops abruptly.
 */

export type BoomState = {
  angle: number;
  rate: number;
};

/** Largest boom angle the shrouds allow, in radians. */
export const MAX_BOOM_ANGLE = 1.38;
/** The boom never sits exactly on the centreline while the sail draws. */
export const MIN_BOOM_ANGLE = 0.1;
/** A boom crossing from further out than this is gybing, not tacking. */
export const GYBE_ANGLE = 0.55;
/** Angular speed in rad/s above which the sheet snubbing the boom is a slam. */
export const SLAM_RATE = 1.1;

const SETTLE_FREQUENCY = 2.4;
const SETTLE_DAMPING = 0.62;
const GYBE_FREQUENCY = 5.2;
const GYBE_DAMPING = 0.24;
const MAX_RATE = 6;

export function createBoomState(angle = 0.3): BoomState {
  return { angle, rate: 0 };
}

/**
 * Where the sheet holds the boom.
 * @param sheetAngle Boom angle off the centreline chosen by the sail trim, in radians.
 * @param leewardSide +1 when the sail fills toward starboard, −1 toward port.
 * @param luff 0 drawing … 1 flogging head to wind.
 * @param time Simulation time, which phases the flogging.
 */
export function boomTarget(sheetAngle: number, leewardSide: number, luff: number, time: number): number {
  const side = leewardSide >= 0 ? 1 : -1;
  const eased = clamp(sheetAngle, MIN_BOOM_ANGLE, MAX_BOOM_ANGLE);
  // A flogging sail shakes the boom on its sheet.
  const flog = luff * (Math.sin(time * 9.1) * 0.05 + Math.sin(time * 15.7) * 0.025);
  return side * eased + flog;
}

/**
 * Advances the boom and reports the strength of any slam against the sheet
 * in [0, 1]; zero when nothing slammed this step.
 */
export function stepBoom(state: BoomState, target: number, delta: number): number {
  const dt = clamp(delta, 0, 0.05);
  if (dt <= 0) return 0;
  const gybing = Math.abs(state.angle) > GYBE_ANGLE && Math.sign(target) !== Math.sign(state.angle);
  const frequency = gybing ? GYBE_FREQUENCY : SETTLE_FREQUENCY;
  const damping = gybing ? GYBE_DAMPING : SETTLE_DAMPING;
  const previousRate = state.rate;
  const acceleration =
    (target - state.angle) * frequency * frequency - state.rate * 2 * damping * frequency;
  state.rate = clamp(state.rate + acceleration * dt, -MAX_RATE, MAX_RATE);
  state.angle = clamp(state.angle + state.rate * dt, -MAX_BOOM_ANGLE, MAX_BOOM_ANGLE);
  if (Math.abs(state.angle) >= MAX_BOOM_ANGLE && Math.sign(state.rate) === Math.sign(state.angle)) {
    state.rate = 0;
  }
  // The sheet comes taut: the boom was swinging fast and has just stopped.
  const reversed = previousRate !== 0 && Math.sign(state.rate) !== Math.sign(previousRate);
  if (reversed && Math.abs(previousRate) > SLAM_RATE && Math.abs(state.angle) > GYBE_ANGLE * 0.6) {
    return clamp((Math.abs(previousRate) - SLAM_RATE) / 3, 0.15, 1);
  }
  return 0;
}

/**
 * Pose for the boom pivot group. The authored sail and boom sit at
 * `authoredAngle` (signed like every boom angle); swinging to the other side
 * mirrors them across the centreline so the sail's camber always faces
 * leeward.
 */
export function boomPivotPose(angle: number, authoredAngle: number): { rotationY: number; mirror: number } {
  const side = angle >= 0 ? 1 : -1;
  const authoredSide = authoredAngle >= 0 ? 1 : -1;
  return { rotationY: side * Math.abs(authoredAngle) - angle, mirror: side * authoredSide };
}
