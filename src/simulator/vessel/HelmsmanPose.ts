/**
 * Pure posing rules for the helmsman standing at the starboard wheel. The
 * figure itself is built in `Helmsman.ts`; everything numeric lives here so
 * it can be tested without WebGL.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Fraction of the hull's heel and pitch the helmsman's upper body counters to stay upright. */
export const HELMSMAN_HEEL_COMPENSATION = 0.78;
export const HELMSMAN_PITCH_COMPENSATION = 0.5;
/** Largest lean of the upper body against the boat, radians. */
export const HELMSMAN_MAX_LEAN = 0.32;
/** Grip angles on the rim, measured from its top: about ten and two o'clock. */
export const HELMSMAN_GRIP_ANGLE = 0.95;
/** How far the hands follow the turning rim before they slide along it, radians. */
export const HELMSMAN_GRIP_FOLLOW = 0.75;

/** Upper body roll and pitch (in vessel space) that keep the helmsman near vertical. */
export function helmsmanLean(roll: number, pitch: number, time: number): { roll: number; pitch: number } {
  const clamp = (value: number) => Math.max(-HELMSMAN_MAX_LEAN, Math.min(HELMSMAN_MAX_LEAN, value));
  return {
    // A slow sway, so a figure on a calm sea still looks alive.
    roll: clamp(roll * HELMSMAN_HEEL_COMPENSATION + Math.sin(time * 1.3) * 0.016),
    pitch: clamp(-pitch * HELMSMAN_PITCH_COMPENSATION + Math.sin(time * 0.9 + 1.1) * 0.01),
  };
}

/**
 * Where the two hands hold the rim, as angles from the rim's top in the
 * wheel's own plane. The hands turn with the wheel for small corrections and
 * slide around it beyond that, so they never cross at full lock.
 */
export function gripAngles(wheelAngle: number): { left: number; right: number } {
  const follow = Math.max(-HELMSMAN_GRIP_FOLLOW, Math.min(HELMSMAN_GRIP_FOLLOW, wheelAngle));
  return { left: HELMSMAN_GRIP_ANGLE + follow, right: -HELMSMAN_GRIP_ANGLE + follow };
}

/**
 * Two-bone inverse kinematics: the elbow (or knee) position for a limb from
 * `root` reaching `target`, bending toward `pole`. A target out of reach is
 * pulled in along the reach direction, so the limb straightens instead of
 * stretching. Writes into `out` and returns the reached end point distance.
 */
export function solveTwoBone(root: Vec3, target: Vec3, upper: number, lower: number, pole: Vec3, out: Vec3): number {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let dz = target.z - root.z;
  let distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) {
    dx = 0;
    dy = -1;
    dz = 0;
    distance = 1e-6;
  } else {
    dx /= distance;
    dy /= distance;
    dz /= distance;
  }
  const reach = Math.max(Math.abs(upper - lower) + 1e-4, Math.min(upper + lower - 1e-4, distance));
  // Law of cosines: distance along the reach line to the foot of the joint, and the joint's height off it.
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  // Bend direction: the pole with its component along the reach removed.
  let px = pole.x - root.x;
  let py = pole.y - root.y;
  let pz = pole.z - root.z;
  const dot = px * dx + py * dy + pz * dz;
  px -= dx * dot;
  py -= dy * dot;
  pz -= dz * dot;
  let length = Math.hypot(px, py, pz);
  if (length < 1e-6) {
    // Pole on the reach line: bend downward, or sideways for a vertical reach.
    px = Math.abs(dy) > 0.9 ? 1 : 0;
    py = Math.abs(dy) > 0.9 ? 0 : -1;
    pz = 0;
    const d = px * dx + py * dy + pz * dz;
    px -= dx * d;
    py -= dy * d;
    pz -= dz * d;
    length = Math.hypot(px, py, pz);
  }
  out.x = root.x + dx * along + (px / length) * height;
  out.y = root.y + dy * along + (py / length) * height;
  out.z = root.z + dz * along + (pz / length) * height;
  return reach;
}
