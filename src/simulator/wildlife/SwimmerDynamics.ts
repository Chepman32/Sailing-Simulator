import { clamp } from "../math";

export type SwimmerKinematics = {
  heading: number;
  yawRate: number;
  speed: number;
  velocityX: number;
  velocityZ: number;
  verticalSpeed: number;
};

export type SwimmerLimits = {
  minSpeed: number;
  maxSpeed: number;
  acceleration: number;
  deceleration: number;
  maxTurnRate: number;
  maxYawAcceleration: number;
  turnResponse: number;
};

export function shortestAngleDifference(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function forwardBiasedHeading(current: number, requested: number, maxDeviation: number): number {
  return current + clamp(shortestAngleDifference(current, requested), -maxDeviation, maxDeviation);
}

export function stepSwimmerKinematics(
  state: SwimmerKinematics,
  desiredHeading: number,
  desiredSpeed: number,
  delta: number,
  limits: SwimmerLimits,
): void {
  const dt = clamp(delta, 0, 0.05);
  if (dt <= 0) return;

  const headingError = shortestAngleDifference(state.heading, desiredHeading);
  const targetYawRate = clamp(
    headingError * limits.turnResponse,
    -limits.maxTurnRate,
    limits.maxTurnRate,
  );
  const yawAcceleration = clamp(
    (targetYawRate - state.yawRate) / dt,
    -limits.maxYawAcceleration,
    limits.maxYawAcceleration,
  );
  state.yawRate += yawAcceleration * dt;

  const previousError = headingError;
  state.heading += state.yawRate * dt;
  const nextError = shortestAngleDifference(state.heading, desiredHeading);
  if (previousError !== 0 && Math.sign(previousError) !== Math.sign(nextError)) {
    state.heading = desiredHeading;
    state.yawRate *= 0.18;
  }
  state.heading = Math.atan2(Math.sin(state.heading), Math.cos(state.heading));

  const targetSpeed = clamp(desiredSpeed, limits.minSpeed, limits.maxSpeed);
  const speedChange = targetSpeed - state.speed;
  const rate = speedChange >= 0 ? limits.acceleration : limits.deceleration;
  state.speed += clamp(speedChange, -rate * dt, rate * dt);
  state.speed = clamp(state.speed, limits.minSpeed, limits.maxSpeed);

  // A swimming animal produces thrust along its body axis. Strong lateral
  // hydrodynamic damping keeps the velocity forward-only while yaw inertia
  // produces a finite turn radius instead of sideways or tail-first motion.
  state.velocityX = Math.sin(state.heading) * state.speed;
  state.velocityZ = Math.cos(state.heading) * state.speed;
}

export function stepVerticalMotion(
  positionY: number,
  state: SwimmerKinematics,
  targetY: number,
  delta: number,
  stiffness: number,
  damping: number,
  maxAcceleration: number,
): number {
  const dt = clamp(delta, 0, 0.05);
  const acceleration = clamp(
    (targetY - positionY) * stiffness - state.verticalSpeed * damping,
    -maxAcceleration,
    maxAcceleration,
  );
  state.verticalSpeed += acceleration * dt;
  return positionY + state.verticalSpeed * dt;
}

export function swimmerPitch(verticalSpeed: number, forwardSpeed: number, limit: number): number {
  return clamp(-Math.atan2(verticalSpeed, Math.max(0.1, forwardSpeed)), -limit, limit);
}

export function swimmerBank(yawRate: number, speed: number, limit: number): number {
  return clamp(-Math.atan2(yawRate * speed, 9.81) * 0.72, -limit, limit);
}
