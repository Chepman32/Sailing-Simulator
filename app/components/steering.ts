/** Device-tilt steering helpers (pure where possible, for tests). */

export const STEERING_STORAGE_KEY = "sailing-simulator-steering-v1";
/** Degrees of tilt (from the calibrated neutral) that give full rudder. */
export const TILT_FULL_RUDDER_DEGREES = 28;
/** Ignore tiny hand tremors around neutral. */
export const TILT_DEAD_ZONE_DEGREES = 2.5;
/** Horizontal swipe distance across the wheel for full rudder travel. */
export const SWIPE_FULL_RUDDER_PIXELS = 110;

type OrientationSample = { beta: number | null; gamma: number | null };

/**
 * Roll of the device as the user sees it. In portrait the left/right tilt is
 * `gamma`; in landscape the same physical motion is reported through `beta`,
 * with the sign depending on which way the phone was turned.
 */
export function screenRollDegrees(sample: OrientationSample, screenAngle: number): number {
  const angle = ((Math.round(screenAngle / 90) * 90) % 360 + 360) % 360;
  if (angle === 90) return sample.beta ?? 0;
  if (angle === 270) return -(sample.beta ?? 0);
  if (angle === 180) return -(sample.gamma ?? 0);
  return sample.gamma ?? 0;
}

/** Map a roll angle relative to neutral onto the normalised rudder range. */
export function tiltToRudder(rollDegrees: number, neutralDegrees: number): number {
  const relative = rollDegrees - neutralDegrees;
  if (Math.abs(relative) < TILT_DEAD_ZONE_DEGREES) return 0;
  const signed = relative - Math.sign(relative) * TILT_DEAD_ZONE_DEGREES;
  return Math.max(-1, Math.min(1, signed / (TILT_FULL_RUDDER_DEGREES - TILT_DEAD_ZONE_DEGREES)));
}

/** Rudder after a horizontal drag across the wheel indicator. */
export function swipeToRudder(startRudder: number, deltaPixels: number): number {
  return Math.max(-1, Math.min(1, startRudder + deltaPixels / SWIPE_FULL_RUDDER_PIXELS));
}

type PermissionedOrientation = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/** iOS requires an explicit, gesture-initiated permission request. */
export async function requestTiltPermission(): Promise<boolean> {
  if (typeof DeviceOrientationEvent === "undefined") return false;
  const constructor = DeviceOrientationEvent as PermissionedOrientation;
  if (typeof constructor.requestPermission !== "function") return true;
  try {
    return (await constructor.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
