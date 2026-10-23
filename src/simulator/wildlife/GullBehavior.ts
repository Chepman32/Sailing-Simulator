import { clamp, smoothstep } from "../math";

/**
 * How a gull flies, as a pure function of its state, the sea and the yacht.
 *
 *   soar ──→ follow (the yacht is under way: hang over her wake)
 *     │ ──→ skim   (a long glide a metre or two above the waves)
 *     │ ──→ dive   (climb, fold, plunge for a fish) ──→ rest
 *     │ ──→ land   (glide down and settle on the water) ──→ rest (ride the swell)
 *     └──← takeoff ←── rest (run along the surface into the wind, flapping hard)
 *
 * Flight is a forward-only airspeed with a bounded turn rate; the bank is
 * that of a coordinated turn (tan bank = V·ω/g), so a gull leans into every
 * turn by exactly as much as the turn needs. Gulls flap in bouts and glide
 * between them; they flap harder to climb, to accelerate and to take off,
 * and fold their wings to dive. The wing pose (flap phase and amount,
 * dihedral, fold) is part of the state, for the rig to show.
 */

export type GullMode = "soar" | "follow" | "skim" | "dive" | "land" | "rest" | "takeoff";

export type GullState = {
  mode: GullMode;
  modeTime: number;
  /** Seconds this mode is planned to last. */
  modeLength: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  yawRate: number;
  /** Flight path angle (positive climbing) and bank (positive right wing down), radians. */
  pitch: number;
  bank: number;
  /** Airspeed along the heading and vertical speed, m/s. */
  speed: number;
  climb: number;
  /** Circle the bird soars around, its radius and direction (+1 clockwise from above). */
  centerX: number;
  centerZ: number;
  radius: number;
  direction: number;
  altitude: number;
  /** Station behind the yacht when following: metres astern, to the side, above. */
  followBack: number;
  followSide: number;
  followHeight: number;
  /** Wing beat: phase 0–1, beats per second, how hard (0 glide … 1 full stroke). */
  flapPhase: number;
  flapRate: number;
  flap: number;
  /** Wings folded back against the body, 0 spread … 1 folded. */
  fold: number;
  /** Seconds before the bird will dive again. */
  diveCooldown: number;
  seed: number;
};

export type GullWorld = {
  surfaceHeight(x: number, z: number): number;
  /** Direction the wind blows toward, unit vector in x and z. */
  windX: number;
  windZ: number;
};

export type GullVessel = { x: number; z: number; heading: number; speed: number };

export type GullEvent = "splash" | "takeoff" | "alarm" | null;

export type RandomSource = () => number;

/** Gravity, for the coordinated bank angle. */
const GRAVITY = 9.81;
/** Cruising airspeed of a large gull, and its slowest and fastest, m/s. */
export const GULL_CRUISE_SPEED = 10;
export const GULL_MIN_SPEED = 6.5;
export const GULL_MAX_SPEED = 17;
/** Steepest bank in a turn, radians. */
export const GULL_MAX_BANK = 0.85;
/** Fastest change of turn rate, rad/s². */
const GULL_YAW_ACCELERATION = 2.4;
/** Height of the body's centre above the water when a gull sits on it, metres. */
export const GULL_FLOAT_HEIGHT = 0.1;
/** A resting gull lets the yacht come this close before it takes off, metres. */
export const GULL_ALARM_DISTANCE = 14;
/** Wing beats per second in cruising flight and at take-off. */
export const GULL_BEAT_FREQUENCY = 2.4;
export const GULL_TAKEOFF_BEAT_FREQUENCY = 3.6;

const between = (random: RandomSource, min: number, max: number): number => min + (max - min) * random();
const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export function createGullState(index: number, random: RandomSource): GullState {
  return {
    mode: "soar",
    modeTime: 0,
    modeLength: between(random, 15, 40),
    x: 0,
    y: 14,
    z: 0,
    heading: index * 1.3,
    yawRate: 0,
    pitch: 0,
    bank: 0,
    speed: GULL_CRUISE_SPEED,
    climb: 0,
    centerX: 0,
    centerZ: 0,
    radius: between(random, 18, 38),
    direction: index % 2 === 0 ? 1 : -1,
    altitude: between(random, 10, 22),
    followBack: between(random, 8, 22),
    followSide: between(random, -9, 9),
    followHeight: between(random, 5, 11),
    flapPhase: random(),
    flapRate: GULL_BEAT_FREQUENCY,
    flap: 0.6,
    fold: 0,
    diveCooldown: between(random, 20, 60),
    seed: random() * 100,
  };
}

/** Places a bird on its circle around the yacht (at the start, or after it was left far behind). */
export function placeGull(state: GullState, vessel: GullVessel, index: number, count: number): void {
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  state.centerX = vessel.x + (index % 2 === 0 ? 14 : -14);
  state.centerZ = vessel.z + 20;
  state.x = state.centerX + Math.sin(angle) * state.radius;
  state.z = state.centerZ + Math.cos(angle) * state.radius;
  state.y = state.altitude;
  state.heading = angle + state.direction * Math.PI * 0.5;
  state.mode = "soar";
  state.modeTime = 0;
  state.speed = GULL_CRUISE_SPEED;
  state.climb = 0;
  state.fold = 0;
}

function enter(state: GullState, mode: GullMode, length: number): void {
  state.mode = mode;
  state.modeTime = 0;
  state.modeLength = length;
}

/** The next thing to do after soaring for a while. */
function chooseNext(state: GullState, vessel: GullVessel, random: RandomSource): void {
  const roll = random();
  if (vessel.speed > 2.2 && roll < 0.55) {
    enter(state, "follow", between(random, 25, 60));
    return;
  }
  if (state.diveCooldown <= 0 && roll < 0.75) {
    enter(state, "dive", 20);
    state.altitude = between(random, 12, 17);
    state.diveCooldown = between(random, 50, 120);
    return;
  }
  if (roll < 0.85) {
    enter(state, "skim", between(random, 6, 12));
    return;
  }
  if (vessel.speed < 2 && roll < 0.93) {
    enter(state, "land", 25);
    return;
  }
  enter(state, "soar", between(random, 15, 40));
  state.altitude = between(random, 9, 24);
  state.radius = between(random, 16, 40);
  if (random() < 0.3) state.direction = -state.direction;
}

/**
 * Turns toward `targetHeading` no faster than a bank of {@link GULL_MAX_BANK}
 * allows at this speed, with bounded change of turn rate.
 */
function steer(state: GullState, targetHeading: number, gain: number, dt: number): void {
  const maxRate = (GRAVITY * Math.tan(GULL_MAX_BANK)) / Math.max(state.speed, 1);
  const wanted = clamp(wrap(targetHeading - state.heading) * gain, -maxRate, maxRate);
  state.yawRate += clamp(wanted - state.yawRate, -GULL_YAW_ACCELERATION * dt, GULL_YAW_ACCELERATION * dt);
  state.heading = wrap(state.heading + state.yawRate * dt);
}

/** Climbs or sinks toward `targetY` with bounded vertical acceleration. */
function holdAltitude(state: GullState, targetY: number, maxClimb: number, maxSink: number, dt: number): void {
  const wanted = clamp((targetY - state.y) * 0.6, -maxSink, maxClimb);
  state.climb += clamp(wanted - state.climb, -3 * dt, 3 * dt);
}

/**
 * One step of one gull. `flock` are the other birds' positions, kept at a
 * few metres. Returns an event for the effects: a splash when it hits the
 * water, a take-off, an alarm call when the yacht disturbs it.
 */
export function stepGull(
  state: GullState,
  world: GullWorld,
  vessel: GullVessel,
  flock: readonly { x: number; y: number; z: number }[],
  delta: number,
  random: RandomSource,
): GullEvent {
  const dt = clamp(delta, 0, 0.1);
  if (dt <= 0) return null;
  state.modeTime += dt;
  state.diveCooldown = Math.max(0, state.diveCooldown - dt);
  const surface = world.surfaceHeight(state.x, state.z);
  let event: GullEvent = null;
  let targetSpeed = GULL_CRUISE_SPEED;
  // How hard the bird works: bouts of flapping between glides, more when it
  // climbs or speeds up.
  const bout = Math.sin(state.modeTime * 0.9 + state.seed) > -0.1 ? 1 : 0;
  let effort = 0;
  let foldTarget = 0;

  switch (state.mode) {
    case "soar": {
      // Circle a point that drifts with the yacht.
      const ease = 1 - Math.exp(-0.08 * dt);
      state.centerX += (vessel.x - state.centerX) * ease;
      state.centerZ += (vessel.z - state.centerZ) * ease;
      const dx = state.x - state.centerX;
      const dz = state.z - state.centerZ;
      const radial = Math.atan2(dx, dz);
      const error = Math.hypot(dx, dz) - state.radius;
      steer(state, radial + state.direction * (Math.PI * 0.5 + clamp(error * 0.04, -0.6, 0.6)), 1.6, dt);
      // Gentle undulation: rising on one side of the circle, sinking on the other.
      holdAltitude(state, surface + state.altitude + Math.sin(radial * 1 + state.seed) * 2, 1.6, 1.4, dt);
      effort = 0.25 * bout + Math.max(0, state.climb) * 0.3;
      if (state.modeTime > state.modeLength) chooseNext(state, vessel, random);
      break;
    }
    case "follow": {
      // A station over the wake: astern, a little to one side, above deck.
      const sternX = vessel.x - Math.sin(vessel.heading) * state.followBack + Math.cos(vessel.heading) * state.followSide;
      const sternZ = vessel.z - Math.cos(vessel.heading) * state.followBack - Math.sin(vessel.heading) * state.followSide;
      const dx = sternX - state.x;
      const dz = sternZ - state.z;
      const distance = Math.hypot(dx, dz);
      const ahead = dx * Math.sin(state.heading) + dz * Math.cos(state.heading);
      // Too slow to hover: overtaking birds weave and fall back.
      const weave = ahead < -4 ? Math.sin(state.modeTime * 0.7 + state.seed) * 0.9 : 0;
      steer(state, Math.atan2(dx, dz) + weave, 2.2, dt);
      targetSpeed = clamp(vessel.speed + distance * 0.25, GULL_MIN_SPEED, GULL_MAX_SPEED);
      holdAltitude(state, surface + state.followHeight, 2, 1.5, dt);
      effort = 0.2 + clamp((targetSpeed - state.speed) * 0.2, 0, 0.6) * bout;
      if (state.modeTime > state.modeLength || vessel.speed < 1.5) enter(state, "soar", between(random, 15, 30));
      break;
    }
    case "skim": {
      // Down to a metre or two over the waves on a straight, slightly curving line.
      steer(state, state.heading + Math.sin(state.modeTime * 0.4 + state.seed) * 0.3, 0.8, dt);
      holdAltitude(state, surface + 1.6, 1.5, 2.2, dt);
      targetSpeed = 12;
      effort = state.modeTime < 2 ? 0 : 0.15 * bout;
      if (state.modeTime > state.modeLength) {
        enter(state, "soar", between(random, 15, 35));
        state.altitude = between(random, 10, 20);
      }
      break;
    }
    case "dive": {
      // Climb over the yacht's water, then fold and fall.
      if (state.modeTime < 8 && state.y < surface + state.altitude - 0.5) {
        steer(state, Math.atan2(vessel.x - state.x, vessel.z - state.z) + 0.8 * state.direction, 1.2, dt);
        holdAltitude(state, surface + state.altitude, 2.4, 1, dt);
        effort = 0.55;
      } else {
        // Wings swept back, nose down, gathering speed until it hits the water.
        foldTarget = 0.85;
        state.climb += clamp(-9 - state.climb, -12 * dt, 12 * dt);
        targetSpeed = 6;
        steer(state, state.heading, 0.5, dt);
        if (state.y + state.climb * dt <= surface + GULL_FLOAT_HEIGHT) {
          state.y = surface + GULL_FLOAT_HEIGHT;
          event = "splash";
          enter(state, "rest", between(random, 6, 16));
          state.speed = 0.4;
          state.climb = 0;
        }
      }
      break;
    }
    case "land": {
      // A long, slowing glide down into the wind, legs forward, and a soft touchdown.
      const intoWind = Math.atan2(-world.windX, -world.windZ);
      steer(state, intoWind, 0.9, dt);
      holdAltitude(state, surface - 0.5, 0.5, 1.6, dt);
      targetSpeed = GULL_MIN_SPEED;
      effort = state.y < surface + 2 ? 0.3 : 0;
      if (state.y + state.climb * dt <= surface + 0.35 || state.modeTime > state.modeLength) {
        state.y = surface + GULL_FLOAT_HEIGHT;
        event = "splash";
        enter(state, "rest", between(random, 12, 35));
        state.speed = 0.5;
        state.climb = 0;
      }
      break;
    }
    case "rest": {
      // Afloat: riding the swell, slowly turning head to wind, paddling.
      foldTarget = 1;
      const intoWind = Math.atan2(-world.windX, -world.windZ);
      state.heading = wrap(state.heading + clamp(wrap(intoWind - state.heading), -0.3 * dt, 0.3 * dt));
      state.yawRate = 0;
      state.speed += (0.3 - state.speed) * (1 - Math.exp(-dt));
      state.climb = 0;
      state.x += Math.sin(state.heading) * state.speed * dt;
      state.z += Math.cos(state.heading) * state.speed * dt;
      state.y = surface + GULL_FLOAT_HEIGHT;
      const near = Math.hypot(vessel.x - state.x, vessel.z - state.z) < GULL_ALARM_DISTANCE + vessel.speed * 2;
      if (near || state.modeTime > state.modeLength) {
        enter(state, "takeoff", 4);
        event = near ? "alarm" : "takeoff";
        state.heading = near ? Math.atan2(state.x - vessel.x, state.z - vessel.z) : intoWind;
      }
      break;
    }
    case "takeoff": {
      // Running along the surface on hard, fast strokes until airborne.
      effort = 1;
      targetSpeed = GULL_CRUISE_SPEED;
      steer(state, state.heading, 0.5, dt);
      const airborne = state.speed > 5.5;
      holdAltitude(state, airborne ? surface + 8 : surface + GULL_FLOAT_HEIGHT, 1.8, 0.5, dt);
      if (!airborne) state.y = Math.max(state.y, surface + GULL_FLOAT_HEIGHT);
      if (state.modeTime > state.modeLength && state.y > surface + 4) {
        enter(state, "soar", between(random, 20, 40));
        state.altitude = between(random, 10, 20);
      }
      break;
    }
  }

  if (state.mode !== "rest") {
    // Keep a few metres from the other birds.
    for (const other of flock) {
      const dx = state.x - other.x;
      const dy = state.y - other.y;
      const dz = state.z - other.z;
      const gap = Math.hypot(dx, dy, dz);
      if (gap > 0.01 && gap < 4) {
        const push = (4 - gap) * 0.6 * dt;
        state.x += (dx / gap) * push;
        state.z += (dz / gap) * push;
      }
    }
    // Speed: flapping accelerates, gliding trades height for speed.
    const thrust = (effort * 2.2 - 0.6 - state.climb * 0.35) * dt;
    state.speed = clamp(state.speed + clamp(targetSpeed - state.speed, -1.5 * dt, 1.5 * dt) + thrust * 0.5, 0.3, GULL_MAX_SPEED);
    if (state.mode !== "takeoff" && state.mode !== "dive" && state.mode !== "land") state.speed = Math.max(state.speed, GULL_MIN_SPEED);
    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z += Math.cos(state.heading) * state.speed * dt;
    state.y += state.climb * dt;
    // Never into the sea except on purpose.
    if (state.mode !== "dive" && state.mode !== "takeoff" && state.mode !== "land") state.y = Math.max(state.y, surface + 0.8);
  }

  // Attitude: coordinated bank, path angle, wing pose.
  const bankTarget = state.mode === "rest" ? 0 : Math.atan((state.speed * state.yawRate) / GRAVITY);
  state.bank += (clamp(bankTarget, -GULL_MAX_BANK, GULL_MAX_BANK) - state.bank) * (1 - Math.exp(-6 * dt));
  const pathAngle = state.mode === "rest" ? 0 : Math.atan2(state.climb, Math.max(state.speed, 0.5));
  state.pitch += (pathAngle * (state.mode === "dive" ? 1 : 0.6) - state.pitch) * (1 - Math.exp(-5 * dt));
  const flapTarget = state.mode === "rest" ? 0 : clamp(effort, 0, 1);
  state.flap += (flapTarget - state.flap) * (1 - Math.exp(-4 * dt));
  state.fold += (foldTarget - state.fold) * (1 - Math.exp(-5 * dt));
  const rate = state.mode === "takeoff" ? GULL_TAKEOFF_BEAT_FREQUENCY : GULL_BEAT_FREQUENCY * (0.85 + 0.3 * state.flap);
  state.flapRate += (rate - state.flapRate) * (1 - Math.exp(-3 * dt));
  // A gliding wing settles at the top of its stroke rather than freezing mid-beat.
  const beating = state.flap > 0.05 || (state.flapPhase > 0.02 && state.flapPhase < 0.98);
  if (beating) state.flapPhase = (state.flapPhase + state.flapRate * dt) % 1;
  return event;
}

/** Whether a bird has been left too far behind the yacht and should be placed near her again. */
export function gullLost(state: GullState, vessel: GullVessel): boolean {
  return Math.hypot(state.x - vessel.x, state.z - vessel.z) > 220;
}

/** Dihedral of a gliding wing: the shoulder lifted, the hand drooping a little (the gull's "M"). */
export function glideDihedral(state: GullState): { shoulder: number; hand: number } {
  const glide = 1 - smoothstep(0.1, 0.6, state.flap);
  return { shoulder: 0.14 * glide * (1 - state.fold), hand: -0.12 * glide * (1 - state.fold) };
}
