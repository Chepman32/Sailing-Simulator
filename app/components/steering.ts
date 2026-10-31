/** Device-tilt steering helpers (pure where possible, for tests). */

export const STEERING_STORAGE_KEY = "sailing-simulator-steering-v1";
/** Degrees of tilt (from the calibrated neutral) that give full rudder. */
export const TILT_FULL_RUDDER_DEGREES = 32;
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

/**
 * The screen's rotation from the device's natural orientation, degrees
 * (0, 90, 180, 270). `screen.orientation` where there is one; older iOS
 * Safari only has the legacy `window.orientation` (−90, 0, 90, 180).
 */
export function screenAngle(): number {
  const modern = typeof screen !== "undefined" ? screen.orientation?.angle : undefined;
  const legacy = typeof window !== "undefined" ? (window as unknown as { orientation?: number }).orientation : undefined;
  const angle = typeof modern === "number" ? modern : typeof legacy === "number" ? legacy : 0;
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

/**
 * Steering-wheel angle of the phone from gravity, degrees: the direction of
 * gravity in the plane of the screen, measured in screen axes (x right, y up
 * as the user sees it). Turning the phone like a wheel turns this angle,
 * whether the phone is held upright or tilted back, in portrait or in
 * landscape. Only the change from a captured neutral matters, so the
 * opposite sign iOS gives `accelerationIncludingGravity` does not (a sign
 * flip is a half turn, which cancels in the difference). Null when the phone
 * lies too flat for the angle to mean anything.
 */
export function gravityRollDegrees(ax: number | null, ay: number | null, angle: number): number | null {
  if (ax === null || ay === null) return null;
  const theta = (angle * Math.PI) / 180;
  const sx = ax * Math.cos(theta) + ay * Math.sin(theta);
  const sy = -ax * Math.sin(theta) + ay * Math.cos(theta);
  if (Math.hypot(sx, sy) < 2.5) return null;
  return (Math.atan2(sx, sy) * 180) / Math.PI;
}

/** Difference of two angles in degrees, wrapped to −180…180. */
export function angleDifference(degrees: number, from: number): number {
  return ((((degrees - from) % 360) + 540) % 360) - 180;
}

/**
 * Rudder from the wheel angle: turning the phone clockwise (to the right)
 * steers to starboard. Gravity seen from the device turns the other way, so
 * the sign is reversed.
 */
export function wheelToRudder(rollDegrees: number, neutralDegrees: number): number {
  return tiltToRudder(-angleDifference(rollDegrees, neutralDegrees), 0);
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

type PermissionedMotion = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/**
 * iOS requires an explicit, gesture-initiated permission request, for motion
 * (the gravity the wheel angle is read from) and for orientation (the
 * fallback). Both requests are started inside the tap, before any await.
 */
export async function requestTiltPermission(): Promise<boolean> {
  const hasMotion = typeof DeviceMotionEvent !== "undefined";
  const hasOrientation = typeof DeviceOrientationEvent !== "undefined";
  if (!hasMotion && !hasOrientation) return false;
  const motion = hasMotion ? (DeviceMotionEvent as PermissionedMotion) : null;
  const orientation = hasOrientation ? (DeviceOrientationEvent as PermissionedOrientation) : null;
  const requests: Promise<boolean>[] = [];
  for (const constructor of [motion, orientation]) {
    if (!constructor || typeof constructor.requestPermission !== "function") continue;
    requests.push(constructor.requestPermission().then((state) => state === "granted", () => false));
  }
  if (requests.length === 0) return true;
  const answers = await Promise.all(requests);
  return answers.some(Boolean);
}
