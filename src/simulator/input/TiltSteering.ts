import { clamp } from "../math";

/** Device tilt (degrees) that commands full rudder. */
export const TILT_FULL_RUDDER_DEGREES = 28;
/** Tilt below this is ignored so a hand-held phone does not wander. */
export const TILT_DEAD_ZONE_DEGREES = 4;

/**
 * Maps DeviceOrientation angles to a normalized rudder command in [-1, 1].
 *
 * The world "up" vector expressed in device axes (x right, y toward the top
 * edge, z out of the screen) follows from the W3C Z-X'-Y'' Euler angles as
 * (-sin gamma cos beta, sin beta, cos gamma cos beta). Its component along the
 * screen's current horizontal axis measures how far the phone is rolled like
 * a steering wheel, whether it is held flat or upright and in any screen
 * orientation. Rolling clockwise (right edge down) steers to starboard.
 */
export function tiltToRudder(beta: number | null, gamma: number | null, screenAngle: number): number {
  if (beta === null || gamma === null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return 0;
  const b = (beta * Math.PI) / 180;
  const g = (gamma * Math.PI) / 180;
  const upX = -Math.sin(g) * Math.cos(b);
  const upY = Math.sin(b);
  const angle = ((Math.round(screenAngle / 90) * 90) % 360 + 360) % 360;
  // Screen-right axis in device coordinates for each content rotation.
  const upAlongScreenRight = angle === 90 ? -upY : angle === 180 ? -upX : angle === 270 ? upY : upX;
  const roll = (Math.asin(clamp(-upAlongScreenRight, -1, 1)) * 180) / Math.PI;
  const magnitude = Math.max(0, Math.abs(roll) - TILT_DEAD_ZONE_DEGREES);
  return clamp((Math.sign(roll) * magnitude) / (TILT_FULL_RUDDER_DEGREES - TILT_DEAD_ZONE_DEGREES), -1, 1);
}

/** Rudder command from a horizontal swipe across a control of the given width. */
export function swipeToRudder(startRudder: number, deltaX: number, width: number): number {
  return clamp(startRudder + (deltaX / Math.max(80, width * 0.55)), -1, 1);
}
