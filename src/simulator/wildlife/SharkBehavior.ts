import { clamp, smoothstep } from "../math";
import {
  createSwimmer3D,
  shortestAngleDifference,
  stepSwimmerAtDepth,
  type DepthControl,
  type Swimmer3D,
  type Swimmer3DLimits,
} from "./SwimmerDynamics";
import { headingTowardDeepWater, type MarineWorld, type VesselState } from "./WaterContact";

/**
 * Behaviour of a large shark.
 *
 * A shark is mostly a shape under the water: it patrols wide circles, cruises
 * with slow changes of course, comes in to look at the yacht and turns away,
 * and drops into the deep where it disappears. Rarely it passes right under
 * the hulls, sometimes followed by a sudden burst of speed; occasionally it
 * rises until its dorsal fin cuts the surface for a few seconds. It never
 * jumps, never chases the yacht for long, never turns on the spot.
 *
 *   cruise ⇄ patrol → investigate → approach → accelerate → retreat → deep_swim → cruise
 *                 ↘ fin_show ↗
 */

export type SharkPhase =
  | "cruise"
  | "patrol"
  | "investigate"
  | "approach"
  | "accelerate"
  | "retreat"
  | "deep_swim"
  | "fin_show";

export const SHARK_LENGTH = 5.6;
/** Body points in the shark frame (y up, z forward), metres. */
export const SHARK_DORSAL_TIP = { y: 0.98, z: 0.05 } as const;
export const SHARK_CAUDAL_TIP = { y: 0.76, z: -2.75 } as const;
export const SHARK_BELLY = 0.9;

/** Depth of the body centre while showing the dorsal fin. */
export const SHARK_FIN_SHOW_DEPTH = 0.62;
/** Below this the hulls and keels can never be touched. */
export const SHARK_UNDER_KEEL_DEPTH = 3.8;
export const SHARK_DEEP_DEPTH = { min: 7.5, max: 10 } as const;
/** Minimum seconds between two close passes and two fin displays. */
export const SHARK_CLOSE_PASS_COOLDOWN = 80;
export const SHARK_FIN_SHOW_COOLDOWN = 30;
export const SHARK_HIDE_DISTANCE = 110;

export const SHARK_LIMITS: Swimmer3DLimits = {
  minSpeed: 0.9,
  maxSpeed: 5,
  acceleration: 0.35,
  deceleration: 0.42,
  maxTurnRate: 0.3,
  maxYawAcceleration: 0.16,
  turnResponse: 0.7,
  minTurnRadius: 4.8,
  maxPitch: 0.28,
  maxPitchRate: 0.12,
  maxPitchAcceleration: 0.12,
  pitchResponse: 0.8,
};

/** A burst: strong thrust, but a wide turning circle at speed. */
export const SHARK_BURST_LIMITS: Swimmer3DLimits = {
  ...SHARK_LIMITS,
  acceleration: 2.4,
  maxTurnRate: 0.2,
  minTurnRadius: 10,
};

const CALM_DEPTH: DepthControl = { frequency: 0.45, maxVerticalSpeed: 0.55, maxVerticalAcceleration: 0.2 };
const STARTLED_DEPTH: DepthControl = { frequency: 1.1, maxVerticalSpeed: 1.4, maxVerticalAcceleration: 0.9 };

export type SharkAgent = {
  motion: Swimmer3D;
  phase: SharkPhase;
  elapsed: number;
  duration: number;
  depth: number;
  centreX: number;
  centreZ: number;
  radius: number;
  direction: number;
  passX: number;
  passZ: number;
  passHeading: number;
  /** Lateral offset of a close pass from the yacht's centreline. */
  passOffset: number;
  wander: number;
  sinceClosePass: number;
  sinceFinShow: number;
  boldness: number;
  /** Tail beat, and how hard it is working (0–1). */
  strokePhase: number;
  strokeEffort: number;
  /** Filtered forward acceleration, m/s². */
  acceleration: number;
  lateralCurvature: number;
  closePasses: number;
  hiddenMoves: number;
  /** Vertical excursion of the water around the shark, added to its depth keeping. */
  heave: number;
};

export type RandomSource = () => number;

function between(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random();
}

export function createSharkAgent(
  vessel: VesselState,
  random: RandomSource,
): SharkAgent {
  const angle = random() * Math.PI * 2;
  const radius = between(random, 26, 38);
  const x = vessel.x + Math.sin(angle) * radius;
  const z = vessel.z + Math.cos(angle) * radius;
  return {
    motion: createSwimmer3D(x, -between(random, 6, 8), z, angle + Math.PI * 0.5, 1.3),
    phase: "deep_swim",
    elapsed: 0,
    duration: between(random, 6, 12),
    depth: 7,
    centreX: vessel.x,
    centreZ: vessel.z,
    radius: 30,
    direction: random() < 0.5 ? -1 : 1,
    passX: x,
    passZ: z,
    passHeading: 0,
    passOffset: 0,
    wander: random() * 100,
    sinceClosePass: 40,
    sinceFinShow: 30,
    boldness: between(random, 0.35, 0.85),
    strokePhase: random() * Math.PI * 2,
    strokeEffort: 0.5,
    acceleration: 0,
    lateralCurvature: 0,
    closePasses: 0,
    hiddenMoves: 0,
    heave: 0,
  };
}

function enter(agent: SharkAgent, phase: SharkPhase, duration: number): void {
  agent.phase = phase;
  agent.elapsed = 0;
  agent.duration = duration;
}

/** Picks what to do next after a calm phase ends. */
function nextCalmPhase(agent: SharkAgent, vessel: VesselState, random: RandomSource, distance: number): void {
  const canPass = agent.sinceClosePass > SHARK_CLOSE_PASS_COOLDOWN && distance < 70;
  const canShowFin =
    agent.sinceFinShow > SHARK_FIN_SHOW_COOLDOWN && distance > 18 && distance < 110 && -agent.motion.y < 6;
  const roll = random();
  if (canShowFin && roll < 0.4) {
    beginFinShow(agent, vessel, random);
  } else if (canPass && roll < 0.4 + 0.12 * agent.boldness) {
    beginInvestigate(agent, random);
  } else if (roll < 0.42) {
    beginPatrol(agent, vessel, random);
  } else if (roll < 0.62) {
    beginInvestigate(agent, random);
  } else if (roll < 0.8) {
    enter(agent, "cruise", between(random, 14, 26));
    agent.depth = between(random, 1.7, 2.8);
  } else if (roll < 0.86 && distance < 60) {
    enter(agent, "accelerate", between(random, 1.8, 2.8));
  } else {
    enter(agent, "deep_swim", between(random, 8, 14));
    agent.depth = between(random, SHARK_DEEP_DEPTH.min, SHARK_DEEP_DEPTH.max);
  }
}

function beginPatrol(agent: SharkAgent, vessel: VesselState, random: RandomSource): void {
  const angle = random() * Math.PI * 2;
  const offset = between(random, 12, 30);
  agent.centreX = vessel.x + Math.sin(angle) * offset;
  agent.centreZ = vessel.z + Math.cos(angle) * offset;
  agent.radius = between(random, 18, 32);
  agent.direction = random() < 0.5 ? -1 : 1;
  agent.depth = between(random, 1.8, 2.9);
  enter(agent, "patrol", between(random, 22, 40));
}

function beginInvestigate(agent: SharkAgent, random: RandomSource): void {
  agent.direction = random() < 0.5 ? -1 : 1;
  agent.depth = between(random, 1.5, 2.2);
  enter(agent, "investigate", between(random, 12, 20));
}

function beginFinShow(agent: SharkAgent, vessel: VesselState, random: RandomSource): void {
  agent.sinceFinShow = 0;
  agent.direction = random() < 0.5 ? -1 : 1;
  agent.depth = SHARK_FIN_SHOW_DEPTH;
  agent.centreX = vessel.x;
  agent.centreZ = vessel.z;
  agent.radius = between(random, 24, 40);
  // The time it takes to come up at a calm pace, then a few seconds of fin.
  const rise = Math.max(0, -agent.motion.y - SHARK_FIN_SHOW_DEPTH) / 0.45;
  enter(agent, "fin_show", rise + between(random, 8, 14));
}

/** Points the pass at where the yacht will be, a little to one side of her centreline. */
function aimPass(agent: SharkAgent, vessel: VesselState, distance: number): void {
  const arrival = distance / 1.9;
  const lead = Math.min(vessel.speed * arrival, 40);
  const forwardX = Math.sin(vessel.heading);
  const forwardZ = Math.cos(vessel.heading);
  agent.passX = vessel.x + forwardX * lead + forwardZ * agent.passOffset;
  agent.passZ = vessel.z + forwardZ * lead - forwardX * agent.passOffset;
  agent.passHeading = Math.atan2(agent.passX - agent.motion.x, agent.passZ - agent.motion.z);
}

function beginClosePass(agent: SharkAgent, vessel: VesselState, random: RandomSource): void {
  const motion = agent.motion;
  const distance = Math.hypot(vessel.x - motion.x, vessel.z - motion.z);
  agent.passOffset = between(random, -2.2, 2.2);
  aimPass(agent, vessel, distance);
  agent.depth = between(random, SHARK_UNDER_KEEL_DEPTH, SHARK_UNDER_KEEL_DEPTH + 0.9);
  agent.sinceClosePass = 0;
  agent.closePasses += 1;
  enter(agent, "approach", between(random, 18, 26));
}

export function stepShark(
  agent: SharkAgent,
  world: MarineWorld,
  vessel: VesselState,
  avoid: readonly { x: number; z: number; radius: number }[],
  delta: number,
  random: RandomSource,
): void {
  const dt = clamp(delta, 0, 0.05);
  if (dt <= 0) return;
  const motion = agent.motion;
  agent.elapsed += dt;
  agent.wander += dt;
  agent.sinceClosePass += dt;
  agent.sinceFinShow += dt;
  const toVesselX = vessel.x - motion.x;
  const toVesselZ = vessel.z - motion.z;
  const distance = Math.hypot(toVesselX, toVesselZ);
  const depthNow = -motion.y;

  // A shark that has wandered off is quietly brought back while out of sight:
  // past this distance a body more than a metre down cannot be seen.
  if (distance > SHARK_HIDE_DISTANCE && depthNow > 1 && agent.phase !== "fin_show") {
    relocate(agent, vessel, world, random);
  }

  // --- Phase logic ---------------------------------------------------------
  switch (agent.phase) {
    case "cruise":
    case "patrol":
    case "deep_swim":
      if (agent.elapsed >= agent.duration) nextCalmPhase(agent, vessel, random, distance);
      break;
    case "investigate":
      if (agent.elapsed >= agent.duration) {
        const canPass = agent.sinceClosePass > SHARK_CLOSE_PASS_COOLDOWN;
        const roll = random();
        if (canPass && roll < 0.3 + 0.25 * agent.boldness) beginClosePass(agent, vessel, random);
        else if (roll < 0.75) beginPatrol(agent, vessel, random);
        else beginRetreat(agent, random);
      }
      break;
    case "approach": {
      // Done once the shark is well past the point it aimed for.
      const along = (motion.x - agent.passX) * Math.sin(agent.passHeading) + (motion.z - agent.passZ) * Math.cos(agent.passHeading);
      if (along > 14 || agent.elapsed >= agent.duration) {
        if (random() < 0.55) enter(agent, "accelerate", between(random, 2, 3.2));
        else beginRetreat(agent, random);
      }
      break;
    }
    case "accelerate":
      if (agent.elapsed >= agent.duration) beginRetreat(agent, random);
      break;
    case "retreat":
      if (agent.elapsed >= agent.duration) {
        if (random() < 0.6) {
          enter(agent, "deep_swim", between(random, 8, 14));
          agent.depth = between(random, SHARK_DEEP_DEPTH.min, SHARK_DEEP_DEPTH.max);
        } else {
          enter(agent, "cruise", between(random, 14, 24));
          agent.depth = between(random, 1.7, 2.8);
        }
      }
      break;
    case "fin_show":
      if (agent.elapsed >= agent.duration) {
        enter(agent, "cruise", between(random, 12, 22));
        agent.depth = between(random, 2, 3.2);
      }
      break;
  }

  // --- Steering ------------------------------------------------------------
  let desiredHeading = motion.heading;
  let desiredSpeed = 1.3;
  let limits = SHARK_LIMITS;
  switch (agent.phase) {
    case "cruise": {
      const meander = Math.sin(agent.wander * 0.07) * 0.5 + Math.sin(agent.wander * 0.031 + 2) * 0.4;
      desiredHeading = motion.heading + meander * 0.25;
      // Stay in the yacht's general area without following her.
      if (distance > 55) desiredHeading = blend(desiredHeading, Math.atan2(toVesselX, toVesselZ), smoothstep(55, 95, distance));
      desiredSpeed = 1.45;
      break;
    }
    case "patrol":
    case "fin_show": {
      if (agent.phase === "fin_show") {
        // The circle drifts with the yacht so the fin stays in view.
        agent.centreX += (vessel.x - agent.centreX) * (1 - Math.exp(-0.2 * dt));
        agent.centreZ += (vessel.z - agent.centreZ) * (1 - Math.exp(-0.2 * dt));
      }
      const dx = motion.x - agent.centreX;
      const dz = motion.z - agent.centreZ;
      const radial = Math.hypot(dx, dz) || 1;
      const tangentX = (dz / radial) * agent.direction;
      const tangentZ = (-dx / radial) * agent.direction;
      const correction = clamp((agent.radius - radial) / 10, -0.8, 0.8);
      desiredHeading = Math.atan2(tangentX + (dx / radial) * correction, tangentZ + (dz / radial) * correction);
      desiredSpeed = agent.phase === "fin_show" ? 1.5 : 1.25 + Math.sin(agent.wander * 0.11) * 0.15;
      break;
    }
    case "investigate": {
      // Spiral in on the yacht, then hold a slow circle about 14 m out.
      const away = Math.atan2(-toVesselX, -toVesselZ);
      const ringAngle = away + agent.direction * 0.7;
      const ring = clamp(distance - 6, 14, 40);
      const targetX = vessel.x + Math.sin(ringAngle) * ring;
      const targetZ = vessel.z + Math.cos(ringAngle) * ring;
      desiredHeading = Math.atan2(targetX - motion.x, targetZ - motion.z);
      desiredSpeed = 1.15;
      break;
    }
    case "approach":
      // Curve in on where the yacht will be, then commit to a straight run
      // under her for the last dozen metres.
      if (distance > 12) aimPass(agent, vessel, distance);
      desiredHeading = agent.passHeading;
      desiredSpeed = 1.9;
      break;
    case "accelerate":
      limits = SHARK_BURST_LIMITS;
      desiredHeading = motion.heading + Math.sin(agent.wander * 0.9) * 0.15;
      desiredSpeed = 4.6;
      break;
    case "retreat":
      desiredHeading = blend(motion.heading, Math.atan2(-toVesselX, -toVesselZ) + agent.direction * 0.4, 0.6);
      desiredSpeed = 2.2 - smoothstep(0, agent.duration, agent.elapsed) * 0.7;
      break;
    case "deep_swim":
      desiredHeading = motion.heading + Math.sin(agent.wander * 0.05) * 0.2;
      if (distance > 90) desiredHeading = blend(desiredHeading, Math.atan2(toVesselX, toVesselZ), 0.5);
      desiredSpeed = 1.15;
      break;
  }

  // Never stay close to the yacht unless passing well under her keels.
  if (distance < 16 && agent.phase !== "approach" && agent.phase !== "accelerate") {
    desiredHeading = blend(desiredHeading, Math.atan2(-toVesselX, -toVesselZ), smoothstep(16, 7, distance));
  }
  for (const obstacle of avoid) {
    const dx = motion.x - obstacle.x;
    const dz = motion.z - obstacle.z;
    const separation = Math.hypot(dx, dz);
    if (separation < obstacle.radius + 10) {
      desiredHeading = blend(desiredHeading, Math.atan2(dx, dz), smoothstep(obstacle.radius + 10, obstacle.radius, separation));
    }
  }
  // Shoal water: turn back toward the open sea.
  const deepWater = headingTowardDeepWater(world, motion.x, motion.z, desiredHeading, 22, 5.5);
  if (deepWater !== null) desiredHeading = deepWater;

  // --- Depth ---------------------------------------------------------------
  const seabed = world.seabedDepth(motion.x, motion.z);
  let depth = Math.min(agent.depth, Math.max(1.2, seabed - SHARK_BELLY - 0.8));
  if (distance < 10) depth = Math.max(depth, SHARK_UNDER_KEEL_DEPTH);
  const targetY = -depth;
  // A yacht closing in makes the shark sound quickly.
  const startled = distance < 14 && depthNow < SHARK_UNDER_KEEL_DEPTH;
  const previousSpeed = motion.speed;
  stepSwimmerAtDepth(motion, desiredHeading, targetY, desiredSpeed, dt, limits, startled ? STARTLED_DEPTH : CALM_DEPTH);
  // Near the surface the body rides the swell; deep down it barely moves.
  agent.heave = world.orbitalHeight(motion.x, motion.z, Math.max(0, -motion.y));
  // The keels draw about 1.2 m and the fin stands a metre above the body:
  // under the yacht the shark is pushed down, at a swimming rate, never snapped.
  if (distance < 9 && -motion.y < SHARK_UNDER_KEEL_DEPTH - 1) motion.y -= 1.6 * dt;

  // --- Body ----------------------------------------------------------------
  const acceleration = (motion.speed - previousSpeed) / dt;
  agent.acceleration += (acceleration - agent.acceleration) * (1 - Math.exp(-4 * dt));
  // Tail beats quicken and deepen with speed and with effort; a decelerating
  // shark glides with barely a stroke.
  const frequency = 0.3 + 0.28 * motion.speed + Math.max(0, agent.acceleration) * 0.12;
  agent.strokePhase += Math.PI * 2 * frequency * dt;
  const effort = clamp(
    0.48 + motion.speed * 0.09 + Math.max(0, agent.acceleration) * 0.28 - Math.max(0, -agent.acceleration) * 0.6,
    0.3,
    1,
  );
  agent.strokeEffort += (effort - agent.strokeEffort) * (1 - Math.exp(-3 * dt));
  const curvature = clamp((motion.yawRate / Math.max(0.6, motion.speed)) * 0.8, -0.16, 0.16);
  agent.lateralCurvature += (curvature - agent.lateralCurvature) * (1 - Math.exp(-3 * dt));
}

function beginRetreat(agent: SharkAgent, random: RandomSource): void {
  agent.direction = random() < 0.5 ? -1 : 1;
  agent.depth = between(random, 6, 8.5);
  enter(agent, "retreat", between(random, 8, 13));
}

function blend(from: number, to: number, weight: number): number {
  return from + shortestAngleDifference(from, to) * clamp(weight, 0, 1);
}

function relocate(agent: SharkAgent, vessel: VesselState, world: MarineWorld, random: RandomSource): void {
  const forwardX = Math.sin(vessel.heading);
  const forwardZ = Math.cos(vessel.heading);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const ahead = between(random, 40, 65);
    const lateral = between(random, -45, 45);
    const x = vessel.x + forwardX * ahead + forwardZ * lateral;
    const z = vessel.z + forwardZ * ahead - forwardX * lateral;
    if (world.seabedDepth(x, z) < 12) continue;
    agent.motion.x = x;
    agent.motion.z = z;
    agent.motion.y = -between(random, 6, 7.5);
    // Coming back up toward the yacht from the deep, out of sight.
    agent.motion.heading = Math.atan2(vessel.x - x, vessel.z - z) + between(random, -0.6, 0.6);
    agent.motion.yawRate = 0;
    agent.motion.pitch = 0;
    agent.motion.pitchRate = 0;
    agent.hiddenMoves += 1;
    beginPatrol(agent, vessel, random);
    return;
  }
}
