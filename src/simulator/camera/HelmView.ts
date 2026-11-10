import * as THREE from "three";

/**
 * The helmsman's head: how the eyes are turned while he stands at the wheel.
 *
 * His eyes are carried exactly with the yacht, and so is his head for every
 * quick movement of hers: slamming through chop at speed, a gust laying her
 * over, the helm put hard across. Only her *slow* swing over the swell is
 * taken out by his neck, which keeps the horizon about level. So the view
 * is her own attitude, turned to face forward, with a slowly changing
 * correction and his look on top:
 *
 *     view = yacht · faceForward · neck(slow roll, slow pitch) · look
 *
 * Everything to the right of `yacht` changes slowly (or by the mouse), so
 * the wheel, the pod and the compass a hand's breadth from the eye stand
 * still in the view however she is thrown about.
 *
 * (It used to be put together from her angles one by one: heading, then her
 * pitch less the neck's share plus the look, then her roll less the neck's.
 * That is the same thing only while she does not roll: a quick roll then
 * turned the axis the look and the neck's pitch were taken about, and the
 * whole station swung sideways in the view by `roll × (look pitch + neck
 * pitch)`, some ten or twenty pixels at every wave at speed.)
 */

/** Share of the yacht's slow roll and pitch the helmsman's head goes with (the rest the neck takes out). */
export const HEAD_ROLL_SHARE = 0.3;
export const HEAD_PITCH_SHARE = 0.45;
/** In the steady view (a setting, on by default) the neck takes out nearly all of it. */
export const STEADY_PITCH_SHARE = HEAD_PITCH_SHARE * 0.15;
export const STEADY_ROLL_SHARE = HEAD_ROLL_SHARE * 0.1;

/**
 * How quickly the helmsman's head follows the yacht's pitch and roll (1/s):
 * slower motion than this the neck takes out, quicker the head shares. At
 * rest and under sail it is 1.6 (the swell's swing, seconds long, is taken
 * out). At speed she meets the waves faster, so what was a slow swing
 * becomes a beat of one or two a second: a neck that tried to take that out
 * would have the station bobbing in the view with every wave. The faster
 * she goes, the slower the motion that still counts as slow (0.45 at 20 kn).
 */
export function headSwingRate(speed: number): number {
  const fast = Math.min(1, Math.max(0, (Math.abs(speed) - 3) / 7));
  return 1.6 - 1.15 * fast * fast * (3 - 2 * fast);
}

const FACE_FORWARD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const scratch = new THREE.Quaternion();

/**
 * The camera's orientation at the helm, into `out`.
 *
 * - `yacht`: her attitude (the root's quaternion: heading, pitch, roll as drawn);
 * - `slowPitch`, `slowRoll`: her pitch and roll, low-passed at `headSwingRate` (radians, her own signs);
 * - `pitchShare`, `rollShare`: how much of that slow swing the head keeps (0 level … 1 rigid with her);
 * - `lookYaw`, `lookPitch`: where he looks (radians; a positive pitch looks down).
 */
export function helmViewQuaternion(
  out: THREE.Quaternion,
  yacht: THREE.Quaternion,
  slowPitch: number,
  slowRoll: number,
  pitchShare: number,
  rollShare: number,
  lookYaw: number,
  lookPitch: number,
): THREE.Quaternion {
  out.copy(yacht).multiply(FACE_FORWARD);
  // Facing forward, her roll is a turn about the view's own axis (+roll) and
  // her pitch a turn about its side axis (−pitch): the neck undoes its share.
  out.multiply(scratch.setFromAxisAngle(AXIS_Z, -(1 - rollShare) * slowRoll));
  out.multiply(scratch.setFromAxisAngle(AXIS_X, (1 - pitchShare) * slowPitch));
  out.multiply(scratch.setFromAxisAngle(AXIS_Y, lookYaw));
  out.multiply(scratch.setFromAxisAngle(AXIS_X, -lookPitch));
  return out;
}
