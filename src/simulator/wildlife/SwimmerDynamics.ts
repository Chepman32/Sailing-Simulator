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

/**
 * A swimmer moving in three dimensions. Thrust acts along the body axis, so
 * the velocity is always `speed` along (heading, pitch): the animal can only
 * travel head first, and every change of direction is a finite turn.
 *
 * `pitch` is the path angle, positive when climbing (nose up).
 */
export type Swimmer3D = {
  x: number;
  y: number;
  z: number;
  heading: number;
  yawRate: number;
  pitch: number;
  pitchRate: number;
  speed: number;
  /** Vertical velocity, m/s; always consistent with the path angle and speed. */
  verticalSpeed: number;
};

/** Depth holding for heavy swimmers: a critically damped approach with bounded effort. */
export type DepthControl = {
  /** Natural frequency of the approach, rad/s; lower is lazier. */
  frequency: number;
  maxVerticalSpeed: number;
  maxVerticalAcceleration: number;
};

export type Swimmer3DLimits = SwimmerLimits & {
  /** Tightest horizontal turn, in metres; a body cannot pivot in place. */
  minTurnRadius: number;
  maxPitch: number;
  maxPitchRate: number;
  maxPitchAcceleration: number;
  pitchResponse: number;
};

export function createSwimmer3D(x: number, y: number, z: number, heading: number, speed: number): Swimmer3D {
  return { x, y, z, heading, yawRate: 0, pitch: 0, pitchRate: 0, speed, verticalSpeed: 0 };
}

/** Fastest turn the swimmer can make at its current speed. */
export function turnRateLimit(speed: number, limits: Swimmer3DLimits): number {
  return Math.min(limits.maxTurnRate, Math.max(0, speed) / Math.max(0.1, limits.minTurnRadius));
}

/**
 * Advances heading, path angle, speed and position by one step. Yaw and
 * pitch rates change with bounded acceleration; the turn rate is limited by
 * the turning radius at the current speed.
 */
export function stepSwimmer3D(
  state: Swimmer3D,
  desiredHeading: number,
  desiredPitch: number,
  desiredSpeed: number,
  delta: number,
  limits: Swimmer3DLimits,
): void {
  const dt = clamp(delta, 0, 0.05);
  if (dt <= 0) return;
  stepHeadingAndSpeed(state, desiredHeading, desiredSpeed, dt, limits);

  const pitchTarget = clamp(desiredPitch, -limits.maxPitch, limits.maxPitch);
  const targetPitchRate = clamp(
    (pitchTarget - state.pitch) * limits.pitchResponse,
    -limits.maxPitchRate,
    limits.maxPitchRate,
  );
  const pitchStep = clamp(
    targetPitchRate - state.pitchRate,
    -limits.maxPitchAcceleration * dt,
    limits.maxPitchAcceleration * dt,
  );
  state.pitchRate += pitchStep;
  state.pitch = clamp(state.pitch + state.pitchRate * dt, -limits.maxPitch, limits.maxPitch);
  state.verticalSpeed = Math.sin(state.pitch) * state.speed;

  const horizontal = state.speed * Math.cos(state.pitch);
  state.x += Math.sin(state.heading) * horizontal * dt;
  state.z += Math.cos(state.heading) * horizontal * dt;
  state.y += state.verticalSpeed * dt;
}

/**
 * Heavy swimmers (whales, sharks) hold depth rather than steer by pitch: the
 * vertical motion is a critically damped approach to `targetY` with bounded
 * vertical speed and acceleration, so a change of depth never overshoots.
 * The body's path angle is then whatever that vertical speed implies at the
 * current forward speed. At very low speed the remainder is hovering, as a
 * nearly stationary whale sculling with its flippers.
 */
export function stepSwimmerAtDepth(
  state: Swimmer3D,
  desiredHeading: number,
  targetY: number,
  desiredSpeed: number,
  delta: number,
  limits: Swimmer3DLimits,
  control: DepthControl,
  targetVelocity = 0,
): void {
  const dt = clamp(delta, 0, 0.05);
  if (dt <= 0) return;
  stepHeadingAndSpeed(state, desiredHeading, desiredSpeed, dt, limits);

  // `targetVelocity` lets a swimmer keep station under a moving surface
  // without lagging behind it.
  const omega = control.frequency;
  const acceleration = clamp(
    omega * omega * (targetY - state.y) + 2 * omega * (targetVelocity - state.verticalSpeed),
    -control.maxVerticalAcceleration,
    control.maxVerticalAcceleration,
  );
  state.verticalSpeed = clamp(
    state.verticalSpeed + acceleration * dt,
    -control.maxVerticalSpeed,
    control.maxVerticalSpeed,
  );
  const previousPitch = state.pitch;
  const pathAngle = Math.atan2(state.verticalSpeed, Math.max(0.35, state.speed));
  state.pitch = clamp(pathAngle, -limits.maxPitch, limits.maxPitch);
  state.pitchRate = (state.pitch - previousPitch) / dt;

  const horizontal = state.speed * Math.cos(state.pitch);
  state.x += Math.sin(state.heading) * horizontal * dt;
  state.z += Math.cos(state.heading) * horizontal * dt;
  state.y += state.verticalSpeed * dt;
}

function stepHeadingAndSpeed(
  state: Swimmer3D,
  desiredHeading: number,
  desiredSpeed: number,
  dt: number,
  limits: Swimmer3DLimits,
): void {
  const maxTurn = turnRateLimit(state.speed, limits);
  const headingError = shortestAngleDifference(state.heading, desiredHeading);
  const targetYawRate = clamp(headingError * limits.turnResponse, -maxTurn, maxTurn);
  const yawStep = clamp(targetYawRate - state.yawRate, -limits.maxYawAcceleration * dt, limits.maxYawAcceleration * dt);
  state.yawRate = clamp(state.yawRate + yawStep, -maxTurn, maxTurn);
  const previousError = headingError;
  state.heading += state.yawRate * dt;
  const nextError = shortestAngleDifference(state.heading, desiredHeading);
  if (previousError !== 0 && Math.sign(previousError) !== Math.sign(nextError) && Math.abs(nextError) < 0.05) {
    state.heading = desiredHeading;
    state.yawRate *= 0.5;
  }
  state.heading = Math.atan2(Math.sin(state.heading), Math.cos(state.heading));

  const targetSpeed = clamp(desiredSpeed, limits.minSpeed, limits.maxSpeed);
  const speedChange = targetSpeed - state.speed;
  const rate = speedChange >= 0 ? limits.acceleration : limits.deceleration;
  state.speed = clamp(state.speed + clamp(speedChange, -rate * dt, rate * dt), limits.minSpeed, limits.maxSpeed);
}

/**
 * Path angle that brings a swimmer to `targetY` smoothly: a vertical speed
 * proportional to the remaining distance, capped, then expressed as the
 * climb angle at the current speed.
 */
export function pitchTowardDepth(
  y: number,
  targetY: number,
  speed: number,
  responsiveness: number,
  maxVerticalSpeed: number,
  maxPitch: number,
): number {
  const verticalSpeed = clamp((targetY - y) * responsiveness, -maxVerticalSpeed, maxVerticalSpeed);
  const ratio = clamp(verticalSpeed / Math.max(0.2, speed), -Math.sin(maxPitch), Math.sin(maxPitch));
  return Math.asin(ratio);
}
