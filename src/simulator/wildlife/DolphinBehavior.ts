import { clamp, smoothstep } from "../math";
import {
  createSwimmer3D,
  pitchTowardDepth,
  shortestAngleDifference,
  stepSwimmer3D,
  stepSwimmerAtDepth,
  type DepthControl,
  type Swimmer3D,
  type Swimmer3DLimits,
} from "./SwimmerDynamics";
import type { MarineWorld, VesselState } from "./WaterContact";

/**
 * Behaviour of a pod of bottlenose dolphins.
 *
 * The pod as a whole roams, escorts the yacht, rides its bow pressure wave
 * or crosses ahead of it, depending on how fast the yacht is moving. Each
 * dolphin then has its own state:
 *
 *   cruise → accelerate → approach_surface → leap → airborne → reentry → dive → recover → cruise
 *
 * A leap is one physical motion. The dolphin runs up at depth, pitches up
 * and drives through the surface; from the moment its rostrum breaks the
 * water it follows a ballistic arc under gravity with its body along the
 * path; it re-enters head first and its own momentum carries it down before
 * it levels out, slowing through the water.
 *
 * Leaps are strictly speed gated. A dolphin only decides to leap while it is
 * already swimming fast in an excited pod, and only leaves the water if it
 * has actually reached leaping speed; otherwise it levels off. A calm pod
 * around a slow or stopped yacht never leaps.
 */

export type DolphinPhase =
  | "cruise"
  | "accelerate"
  | "approach_surface"
  | "leap"
  | "airborne"
  | "reentry"
  | "dive"
  | "recover";

export type LeapVariant = "low_fast" | "high_arc" | "acrobatic";
export type PodMode = "roam" | "escort" | "bow_ride" | "cross";

/** Body length of the normalised model, metres. */
export const DOLPHIN_LENGTH = 2.7;
/** Body points in the dolphin frame (y up, z forward), metres. */
export const DOLPHIN_ROSTRUM = { y: 0.02, z: 1.36 } as const;
export const DOLPHIN_BLOWHOLE = { y: 0.23, z: 0.83 } as const;
export const DOLPHIN_DORSAL_TIP = { y: 0.55, z: 0.2 } as const;
export const DOLPHIN_FLUKE = { y: -0.12, z: -1.25 } as const;

/** The yacht must be making this much way for the pod to become playful. */
export const DOLPHIN_PLAY_VESSEL_SPEED = 1.8;
/** A dolphin only commits to a leap while already swimming at least this fast. */
export const DOLPHIN_LEAP_ENTRY_SPEED = 2.4;
/** And only leaves the water at this speed or more. */
export const DOLPHIN_LEAP_MIN_SPEED = 6;
export const DOLPHIN_MAX_SPEED = 10.5;
/** Water depth needed beneath a leap. */
export const DOLPHIN_LEAP_MIN_WATER = 7;

const GRAVITY = 9.81;

export const DOLPHIN_LIMITS: Swimmer3DLimits = {
  minSpeed: 1.2,
  maxSpeed: 7.5,
  acceleration: 1.1,
  deceleration: 1.3,
  maxTurnRate: 0.75,
  maxYawAcceleration: 0.9,
  turnResponse: 1.1,
  minTurnRadius: 3.2,
  maxPitch: 0.55,
  maxPitchRate: 0.55,
  maxPitchAcceleration: 1.4,
  pitchResponse: 1.4,
};

/** Sprinting and leaping: far harder acceleration and pitch authority. */
export const DOLPHIN_BURST_LIMITS: Swimmer3DLimits = {
  ...DOLPHIN_LIMITS,
  maxSpeed: DOLPHIN_MAX_SPEED,
  acceleration: 2.8,
  deceleration: 2.2,
  maxTurnRate: 0.45,
  minTurnRadius: 9,
  maxPitch: 1.2,
  maxPitchRate: 1.25,
  maxPitchAcceleration: 3.6,
  pitchResponse: 2.6,
};

/** Station keeping under the waves: quick enough to ride the swell, never overshooting. */
const CRUISE_DEPTH: DepthControl = { frequency: 4, maxVerticalSpeed: 1.8, maxVerticalAcceleration: 7 };
const cruiseDepth: DepthControl = { ...CRUISE_DEPTH };

const DIVE_LIMITS: Swimmer3DLimits = { ...DOLPHIN_BURST_LIMITS, deceleration: 1.6 };
/** Reused every step: cruise limits widened to whatever a leap left the dolphin with. */
const cruiseLimits: Swimmer3DLimits = { ...DOLPHIN_LIMITS };

export type LeapPlan = {
  variant: LeapVariant;
  /** Speed to reach before pitching up. */
  speed: number;
  /** Path angle to leave the water at. */
  exitAngle: number;
  /** Depth of the run-up. */
  runDepth: number;
  /** Full rolls about the long axis in the air (spinner leaps). */
  spins: number;
  /** Partner dolphins starting the same leap together. */
  paired: boolean;
};

export type DolphinAgent = {
  id: number;
  motion: Swimmer3D;
  /** Ballistic velocity while out of the water. */
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  phase: DolphinPhase;
  elapsed: number;
  cooldown: number;
  plan: LeapPlan | null;
  /** Seconds until this dolphin joins a partner's leap; negative when idle. */
  joinIn: number;
  joinPlan: LeapPlan | null;
  /** Predicted time out of the water, for timing a spin. */
  airDuration: number;
  airTime: number;
  roll: number;
  /** Fluke beat. */
  strokePhase: number;
  strokeAmplitude: number;
  /** Body curvature along the length (1/m), positive arching nose-down. */
  curvature: number;
  lateralCurvature: number;
  breathClock: number;
  breathing: number;
  /** Surface height above the dolphin last step, for keeping station under it. */
  previousSurface: number;
  /** A burst of speed ahead of the pod, a dolphin playing. */
  surge: number;
  surgeClock: number;
  /** Individual character. */
  speedBias: number;
  depthBias: number;
  slotLateral: number;
  slotAlong: number;
  playfulness: number;
  wander: number;
  /** Statistics, for tests and tuning. */
  leaps: number;
  lastLaunchSpeed: number;
};

export type DolphinPod = {
  agents: DolphinAgent[];
  mode: PodMode;
  modeClock: number;
  /** Side the pod is escorting on or crossing toward. */
  side: number;
  centreX: number;
  centreZ: number;
  wander: number;
};

export type DolphinObstacle = { x: number; y: number; z: number; radius: number };

export type RandomSource = () => number;

function between(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random();
}

export function createDolphinPod(
  count: number,
  vessel: VesselState,
  world: MarineWorld,
  random: RandomSource,
): DolphinPod {
  const forwardX = Math.sin(vessel.heading);
  const forwardZ = Math.cos(vessel.heading);
  const side = random() < 0.5 ? -1 : 1;
  const agents: DolphinAgent[] = [];
  for (let index = 0; index < count; index += 1) {
    const lateral = side * (9 + index * 2.2);
    const along = 6 - index * 2.4;
    const x = vessel.x + forwardX * along + forwardZ * lateral;
    const z = vessel.z + forwardZ * along - forwardX * lateral;
    const y = world.surfaceHeight(x, z) - 1.2;
    agents.push({
      id: index,
      motion: createSwimmer3D(x, y, z, vessel.heading, Math.max(2, vessel.speed)),
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      phase: "cruise",
      elapsed: 0,
      cooldown: between(random, 4, 9) + index * 2,
      plan: null,
      joinIn: -1,
      joinPlan: null,
      airDuration: 1,
      airTime: 0,
      roll: 0,
      strokePhase: random() * Math.PI * 2,
      strokeAmplitude: 1,
      curvature: 0,
      lateralCurvature: 0,
      breathClock: between(random, 2, 8),
      breathing: 0,
      previousSurface: Number.NaN,
      surge: 0,
      surgeClock: between(random, 3, 9),
      speedBias: between(random, -0.25, 0.25),
      depthBias: between(random, -0.15, 0.2),
      slotLateral: index % 2 === 0 ? 1 : -1,
      slotAlong: index,
      playfulness: between(random, 0.75, 1.25),
      wander: random() * 50,
      leaps: 0,
      lastLaunchSpeed: 0,
    });
  }
  return {
    agents,
    mode: vessel.speed >= DOLPHIN_PLAY_VESSEL_SPEED ? "escort" : "roam",
    modeClock: between(random, 12, 20),
    side,
    centreX: vessel.x + forwardZ * side * 22,
    centreZ: vessel.z - forwardX * side * 22,
    wander: random() * 100,
  };
}

/** World position of a point given in the dolphin frame (ignores roll). */
export function dolphinPoint(
  motion: Swimmer3D,
  local: { y: number; z: number },
  target: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const cosPitch = Math.cos(motion.pitch);
  const sinPitch = Math.sin(motion.pitch);
  const sinHeading = Math.sin(motion.heading);
  const cosHeading = Math.cos(motion.heading);
  target.x = motion.x + sinHeading * (cosPitch * local.z - sinPitch * local.y);
  target.y = motion.y + sinPitch * local.z + cosPitch * local.y;
  target.z = motion.z + cosHeading * (cosPitch * local.z - sinPitch * local.y);
  return target;
}

const scratchPoint = { x: 0, y: 0, z: 0 };

function clearance(agent: DolphinAgent, local: { y: number; z: number }, world: MarineWorld): number {
  dolphinPoint(agent.motion, local, scratchPoint);
  return scratchPoint.y - world.surfaceHeight(scratchPoint.x, scratchPoint.z);
}

/** True when the pod is excited enough by the yacht's speed to play. */
export function isPlayful(vesselSpeed: number): boolean {
  return vesselSpeed >= DOLPHIN_PLAY_VESSEL_SPEED;
}

/** Whether a cruising dolphin may commit to a leap now. */
export function canCommitToLeap(agent: DolphinAgent, vesselSpeed: number, waterDepth: number): boolean {
  return (
    agent.phase === "cruise" &&
    agent.cooldown <= 0 &&
    isPlayful(vesselSpeed) &&
    agent.motion.speed >= DOLPHIN_LEAP_ENTRY_SPEED &&
    waterDepth >= DOLPHIN_LEAP_MIN_WATER
  );
}

/**
 * Depth the run-up must start from so the dolphin can rotate to its exit
 * angle before its rostrum reaches the surface: pitching up at rate ω while
 * moving at v climbs v·(1 − cos θ)/ω, and the rostrum sits ahead of the
 * centre by half a body length.
 */
export function leapRunDepth(speed: number, exitAngle: number): number {
  const pitchRate = 0.85;
  const climb = (speed * (1 - Math.cos(exitAngle))) / pitchRate;
  return clamp(climb + DOLPHIN_ROSTRUM.z * Math.sin(exitAngle) * 0.5 + 0.45, 1.2, 4.6);
}

export function chooseLeapPlan(random: RandomSource, speed: number): LeapPlan {
  const roll = random();
  const plan = (variant: LeapVariant, leapSpeed: number, exitAngle: number, spins: number): LeapPlan => ({
    variant,
    speed: leapSpeed,
    exitAngle,
    runDepth: leapRunDepth(leapSpeed, exitAngle),
    spins,
    paired: false,
  });
  if (roll < 0.09 && speed >= 5) {
    // Rare: a spinner leap, high and steep with one or two full rolls.
    return plan("acrobatic", between(random, 9.8, DOLPHIN_MAX_SPEED), between(random, 1, 1.12), random() < 0.7 ? 1 : 2);
  }
  if (roll < 0.52) {
    // Porpoising: a long, low, fast arc just clearing the water.
    return plan("low_fast", between(random, 7.8, 9), between(random, 0.5, 0.62), 0);
  }
  return plan("high_arc", between(random, 8.8, 10), between(random, 0.78, 0.94), 0);
}

function enter(agent: DolphinAgent, phase: DolphinPhase): void {
  agent.phase = phase;
  agent.elapsed = 0;
}

/** Advances the whole pod by one step. */
export function stepDolphinPod(
  pod: DolphinPod,
  world: MarineWorld,
  vessel: VesselState,
  obstacles: readonly DolphinObstacle[],
  delta: number,
  random: RandomSource,
): void {
  const dt = clamp(delta, 0, 0.05);
  if (dt <= 0) return;
  updatePodMode(pod, vessel, dt, random);
  for (const agent of pod.agents) stepDolphin(agent, pod, world, vessel, obstacles, dt, random);
}

function updatePodMode(pod: DolphinPod, vessel: VesselState, dt: number, random: RandomSource): void {
  pod.modeClock -= dt;
  pod.wander += dt;
  const playful = isPlayful(vessel.speed);
  if (!playful && vessel.speed < 1) {
    if (pod.mode !== "roam") {
      pod.mode = "roam";
      pod.modeClock = between(random, 20, 35);
    }
  } else if (pod.mode === "roam" && vessel.speed >= 1) {
    pod.mode = "escort";
    pod.modeClock = between(random, 15, 25);
  }
  if (pod.mode === "bow_ride" && vessel.speed < DOLPHIN_PLAY_VESSEL_SPEED - 0.4) {
    pod.mode = "escort";
    pod.modeClock = between(random, 12, 20);
  }
  if (pod.modeClock <= 0 && pod.mode !== "roam") {
    const roll = random();
    if (playful && roll < 0.45) pod.mode = "bow_ride";
    else if (roll < 0.72) pod.mode = "escort";
    else pod.mode = "cross";
    if (pod.mode === "escort" && random() < 0.4) pod.side *= -1;
    pod.modeClock = pod.mode === "cross" ? between(random, 9, 14) : between(random, 18, 34);
  }
  if (pod.mode === "cross" && pod.modeClock <= 0.5) {
    pod.mode = "escort";
    pod.side *= -1;
    pod.modeClock = between(random, 15, 25);
  }
  // A roaming pod drifts around the yacht at a respectful distance.
  if (pod.mode === "roam") {
    const dx = pod.centreX - vessel.x;
    const dz = pod.centreZ - vessel.z;
    const distance = Math.hypot(dx, dz) || 1;
    const desired = 26 + Math.sin(pod.wander * 0.05) * 8;
    const tangentX = (dz / distance) * pod.side;
    const tangentZ = (-dx / distance) * pod.side;
    const radial = (desired - distance) * 0.08;
    pod.centreX += (tangentX * 1.8 + (dx / distance) * radial) * dt;
    pod.centreZ += (tangentZ * 1.8 + (dz / distance) * radial) * dt;
  }
}

/** Slot of a dolphin around the yacht for the pod's current mode. */
function slotFor(
  agent: DolphinAgent,
  pod: DolphinPod,
  vessel: VesselState,
): { x: number; z: number; depth: number; speed: number } {
  const forwardX = Math.sin(vessel.heading);
  const forwardZ = Math.cos(vessel.heading);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  const rank = agent.slotAlong;
  let along = 0;
  let lateral = 0;
  let depth = 1.2;
  let speed = vessel.speed;
  switch (pod.mode) {
    case "bow_ride":
      // In the pressure wave just ahead of each bow, never under the hulls.
      along = 5.7 + (rank % 2) * 1.1 + Math.floor(rank / 2) * 1.6;
      lateral = agent.slotLateral * (0.7 + (rank % 3) * 0.55);
      depth = 0.65 + rank * 0.08;
      speed = vessel.speed;
      break;
    case "escort":
      along = 3 - rank * 2.6 + Math.sin(agent.wander * 0.21) * 2;
      lateral = pod.side * (6.5 + rank * 1.8 + Math.sin(agent.wander * 0.13) * 1.2);
      depth = 0.7 + agent.depthBias * 0.5;
      speed = vessel.speed;
      break;
    case "cross":
      along = 20 + rank * 2.2;
      lateral = pod.side * (16 + rank * 2);
      depth = 0.8 + agent.depthBias * 0.5;
      speed = Math.max(vessel.speed + 1.6, 3.5);
      break;
    case "roam": {
      const angle = agent.id * 2.1 + agent.wander * 0.05;
      return {
        x: pod.centreX + Math.cos(angle) * (3 + rank * 1.4),
        z: pod.centreZ + Math.sin(angle) * (3 + rank * 1.4),
        depth: 0.85 + agent.depthBias * 0.5,
        speed: 2.2 + agent.speedBias,
      };
    }
  }
  return {
    x: vessel.x + forwardX * along + rightX * lateral,
    z: vessel.z + forwardZ * along + rightZ * lateral,
    depth,
    speed,
  };
}

function stepDolphin(
  agent: DolphinAgent,
  pod: DolphinPod,
  world: MarineWorld,
  vessel: VesselState,
  obstacles: readonly DolphinObstacle[],
  dt: number,
  random: RandomSource,
): void {
  agent.elapsed += dt;
  agent.cooldown -= dt;
  agent.wander += dt;
  const motion = agent.motion;

  if (agent.phase === "leap" || agent.phase === "airborne" || agent.phase === "reentry") {
    stepBallistic(agent, world, dt);
  } else {
    stepSwimming(agent, pod, world, vessel, obstacles, dt, random);
  }
  keepClearOfHull(agent, vessel, dt);
  const floor = -(world.seabedDepth(motion.x, motion.z) - 0.6);
  if (motion.y < floor) {
    motion.y = floor;
    motion.pitch = Math.max(motion.pitch, 0);
  }
  stepBody(agent, dt);
}

function stepSwimming(
  agent: DolphinAgent,
  pod: DolphinPod,
  world: MarineWorld,
  vessel: VesselState,
  obstacles: readonly DolphinObstacle[],
  dt: number,
  random: RandomSource,
): void {
  const motion = agent.motion;
  const surface = world.surfaceHeight(motion.x, motion.z);
  const waterDepth = world.seabedDepth(motion.x, motion.z);
  let desiredHeading = motion.heading;
  let desiredPitch = 0;
  let desiredSpeed = motion.speed;
  let limits = DOLPHIN_LIMITS;
  // Cruising dolphins hold a depth under the moving surface; sprinting and
  // leaping ones steer by pitch.
  let depthTarget: number | null = null;
  const surfaceRate = Number.isFinite(agent.previousSurface) ? (surface - agent.previousSurface) / dt : 0;
  agent.previousSurface = surface;

  switch (agent.phase) {
    case "cruise":
    case "recover": {
      const slot = slotFor(agent, pod, vessel);
      // Pursue the slot while matching the yacht's own velocity.
      const vesselVX = Math.sin(vessel.heading) * vessel.speed;
      const vesselVZ = Math.cos(vessel.heading) * vessel.speed;
      const dx = slot.x - motion.x;
      const dz = slot.z - motion.z;
      const gain = pod.mode === "roam" ? 0.25 : 0.45;
      let wantX = (pod.mode === "roam" ? 0 : vesselVX) + dx * gain;
      let wantZ = (pod.mode === "roam" ? 0 : vesselVZ) + dz * gain;
      if (pod.mode === "roam" && Math.hypot(wantX, wantZ) < slot.speed) {
        // A roaming dolphin keeps swimming, circling its spot.
        const circle = motion.heading + 0.35;
        wantX += Math.sin(circle) * slot.speed * 0.8;
        wantZ += Math.cos(circle) * slot.speed * 0.8;
      }
      const steer = avoidance(agent, obstacles, vessel);
      wantX += steer.x;
      wantZ += steer.z;
      desiredHeading = Math.atan2(wantX, wantZ);
      const playful = isPlayful(vessel.speed) && pod.mode !== "roam";
      // Playful dolphins surge ahead and drop back; calm ones simply keep station.
      agent.surgeClock -= dt;
      if (agent.surgeClock <= 0) {
        agent.surge = playful ? between(random, 1.6, 3) * agent.playfulness : 0;
        agent.surgeClock = agent.surge > 0 ? between(random, 3, 5.5) : between(random, 5, 11);
        if (agent.surge === 0 && playful) agent.surgeClock = between(random, 3, 8);
      } else if (agent.surgeClock < 1.5) {
        agent.surge *= 1 - dt;
      }
      const catchUp = Math.min(3.5, Math.hypot(dx, dz) * 0.12);
      // A calm pod never races: it keeps a relaxed pace even when falling behind.
      const calmCeiling = Math.min(4.2, Math.max(3.4, vessel.speed + 2.2));
      desiredSpeed = clamp(
        Math.hypot(wantX, wantZ) + agent.speedBias + agent.surge + (pod.mode === "roam" ? 0 : catchUp * 0.3),
        pod.mode === "roam" ? 1.6 : 2,
        pod.mode === "roam" ? 3.4 : playful ? 7.2 : calmCeiling,
      );
      // After a leap the dolphin is still fast and steep: let the water slow
      // and level it at the normal rates instead of clamping.
      const steep = Math.abs(motion.pitch) > DOLPHIN_LIMITS.maxPitch - 0.02;
      cruiseLimits.maxSpeed = Math.max(DOLPHIN_LIMITS.maxSpeed, motion.speed);
      cruiseLimits.maxPitch = Math.max(DOLPHIN_LIMITS.maxPitch, Math.abs(motion.pitch));
      cruiseLimits.maxPitchRate = steep ? DOLPHIN_BURST_LIMITS.maxPitchRate : DOLPHIN_LIMITS.maxPitchRate;
      cruiseLimits.maxPitchAcceleration = steep ? DOLPHIN_BURST_LIMITS.maxPitchAcceleration : DOLPHIN_LIMITS.maxPitchAcceleration;
      cruiseLimits.maxTurnRate = DOLPHIN_LIMITS.maxTurnRate;
      limits = cruiseLimits;
      // Breathing: every so often the dolphin rises until its blowhole clears.
      agent.breathClock -= dt;
      if (agent.breathClock <= 0 && agent.breathing <= 0) {
        agent.breathing = 1.6;
        agent.breathClock = pod.mode === "roam" ? between(random, 5, 10) : between(random, 3.5, 7);
      }
      agent.breathing = Math.max(0, agent.breathing - dt);
      // Breathing, the back and dorsal fin roll clear of the water.
      let breathDepth = agent.breathing > 0 ? 0.26 : slot.depth;
      // Crossing the yacht's track, a dolphin goes under the hulls, not through them.
      if (headingForHull(agent, vessel)) breathDepth = Math.max(breathDepth, DOLPHIN_HULL_ZONE.draft + 0.6);
      depthTarget = surface - Math.min(breathDepth, Math.max(0.3, waterDepth - 0.8));

      if (agent.phase === "recover" && agent.elapsed > 2.2) {
        enter(agent, "cruise");
        agent.cooldown = between(random, 5, 12) / agent.playfulness;
      }
      if (agent.phase === "cruise") {
        if (agent.joinIn >= 0) {
          agent.joinIn -= dt;
          if (agent.joinIn < 0 && agent.joinPlan) {
            beginAccelerate(agent, agent.joinPlan);
            agent.joinPlan = null;
          }
        } else if (canCommitToLeap(agent, vessel.speed, waterDepth) && clearOfHullForLeap(agent, vessel)) {
          const rate = (0.035 + 0.05 * smoothstep(DOLPHIN_PLAY_VESSEL_SPEED, 4.5, vessel.speed)) * agent.playfulness;
          if (random() < rate * dt) {
            const plan = chooseLeapPlan(random, motion.speed);
            const partner = plan.variant !== "acrobatic" && random() < 0.45 ? nearestCruisingPartner(agent, pod) : undefined;
            if (partner) {
              plan.paired = true;
              partner.joinPlan = {
                ...plan,
                speed: clamp(plan.speed + between(random, -0.25, 0.25), 7, DOLPHIN_MAX_SPEED),
                exitAngle: plan.exitAngle + between(random, -0.04, 0.04),
                paired: true,
              };
              partner.joinIn = between(random, 0.08, 0.3);
            }
            beginAccelerate(agent, plan);
          }
        }
      }
      break;
    }
    case "accelerate": {
      const plan = agent.plan!;
      limits = DOLPHIN_BURST_LIMITS;
      desiredSpeed = plan.speed;
      desiredHeading = motion.heading + avoidanceTurn(agent, obstacles, vessel);
      const runY = surface - plan.runDepth;
      desiredPitch = pitchTowardDepth(motion.y, runY, motion.speed, 1.5, 2.2, 0.5);
      const ready = motion.speed >= plan.speed * 0.96 && motion.y < surface - plan.runDepth * 0.85;
      if (ready) enter(agent, "approach_surface");
      else if (agent.elapsed > 5) abortLeap(agent, random);
      break;
    }
    case "approach_surface": {
      const plan = agent.plan!;
      limits = DOLPHIN_BURST_LIMITS;
      desiredSpeed = plan.speed;
      desiredPitch = plan.exitAngle;
      const rostrum = clearance(agent, DOLPHIN_ROSTRUM, world);
      // Too slow with the surface half a metre off: give up while there is
      // still water to level off in, rather than coasting out of the sea.
      if (rostrum >= -0.6 && motion.speed < DOLPHIN_LEAP_MIN_SPEED) {
        abortLeap(agent, random);
      } else if (rostrum >= 0) {
        if (motion.speed >= DOLPHIN_LEAP_MIN_SPEED && motion.pitch > 0.2) launch(agent);
        else abortLeap(agent, random);
      } else if (agent.elapsed > 2.6) {
        abortLeap(agent, random);
      }
      break;
    }
    case "dive": {
      // Momentum carries the dolphin down; it levels out and pulls up while
      // the water slows it from leaping speed to cruising speed.
      limits = DIVE_LIMITS;
      desiredSpeed = Math.max(4, vessel.speed + 1);
      const levelY = surface - 1.6;
      desiredPitch = agent.elapsed < 0.25 ? motion.pitch : pitchTowardDepth(motion.y, levelY, motion.speed, 1.1, 3, 0.7);
      if (agent.elapsed > 0.8 && Math.abs(motion.pitch) < 0.12) enter(agent, "recover");
      else if (agent.elapsed > 3) enter(agent, "recover");
      break;
    }
    default:
      break;
  }

  if (depthTarget !== null) {
    cruiseDepth.maxVerticalSpeed = Math.max(CRUISE_DEPTH.maxVerticalSpeed, Math.abs(motion.verticalSpeed));
    stepSwimmerAtDepth(motion, desiredHeading, depthTarget, desiredSpeed, dt, limits, cruiseDepth, clamp(surfaceRate, -1.5, 1.5));
  } else {
    stepSwimmer3D(motion, desiredHeading, desiredPitch, desiredSpeed, dt, limits);
  }

  // Outside a leap the body cannot coast out of the sea: a swimmer rising
  // faster than it planned meets the surface and slides along under it.
  const leaping = agent.phase === "leap" || agent.phase === "airborne" || agent.phase === "reentry";
  if (!leaping) {
    const ceiling = world.surfaceHeight(motion.x, motion.z) - 0.04;
    if (motion.y > ceiling) {
      motion.y = ceiling;
      if (motion.verticalSpeed > 0) motion.verticalSpeed = 0;
      if (motion.pitch > 0) motion.pitch *= 0.5;
    }
  }
}

function nearestCruisingPartner(agent: DolphinAgent, pod: DolphinPod): DolphinAgent | undefined {
  let best: DolphinAgent | undefined;
  let bestDistance = 6;
  for (const other of pod.agents) {
    if (other === agent || other.phase !== "cruise" || other.joinIn >= 0) continue;
    const distance = Math.hypot(other.motion.x - agent.motion.x, other.motion.z - agent.motion.z);
    const aligned = Math.cos(shortestAngleDifference(other.motion.heading, agent.motion.heading)) > 0.9;
    if (distance < bestDistance && aligned && other.motion.speed >= DOLPHIN_LEAP_ENTRY_SPEED - 0.6) {
      best = other;
      bestDistance = distance;
    }
  }
  return best;
}

function beginAccelerate(agent: DolphinAgent, plan: LeapPlan): void {
  agent.plan = plan;
  agent.breathing = 0;
  enter(agent, "accelerate");
}

function abortLeap(agent: DolphinAgent, random: RandomSource): void {
  agent.plan = null;
  agent.cooldown = between(random, 3, 6);
  enter(agent, "recover");
}

function launch(agent: DolphinAgent): void {
  const motion = agent.motion;
  const horizontal = motion.speed * Math.cos(motion.pitch);
  agent.velocityX = Math.sin(motion.heading) * horizontal;
  agent.velocityZ = Math.cos(motion.heading) * horizontal;
  agent.velocityY = motion.speed * Math.sin(motion.pitch);
  agent.lastLaunchSpeed = motion.speed;
  agent.leaps += 1;
  // Until the rostrum returns to the water, roughly twice the climb time.
  agent.airDuration = Math.max(0.35, (1.84 * agent.velocityY) / GRAVITY);
  agent.airTime = 0;
  motion.yawRate = 0;
  motion.pitchRate = 0;
  enter(agent, "leap");
}

/** Out of the water the body only falls; its axis follows the path. */
function stepBallistic(agent: DolphinAgent, world: MarineWorld, dt: number): void {
  const motion = agent.motion;
  const drag = Math.exp(-0.02 * dt);
  agent.velocityX *= drag;
  agent.velocityZ *= drag;
  agent.velocityY = agent.velocityY * drag - GRAVITY * dt;
  motion.x += agent.velocityX * dt;
  motion.y += agent.velocityY * dt;
  motion.z += agent.velocityZ * dt;
  const horizontal = Math.hypot(agent.velocityX, agent.velocityZ);
  motion.speed = Math.hypot(horizontal, agent.velocityY);
  const previousPitch = motion.pitch;
  motion.pitch = Math.atan2(agent.velocityY, Math.max(0.01, horizontal));
  motion.pitchRate = (motion.pitch - previousPitch) / dt;
  agent.airTime += dt;

  const fluke = clearance(agent, DOLPHIN_FLUKE, world);
  const rostrum = clearance(agent, DOLPHIN_ROSTRUM, world);
  if (agent.phase === "leap" && (fluke > 0 || agent.velocityY <= 0)) {
    enter(agent, "airborne");
  } else if (agent.phase === "airborne" && rostrum < 0 && agent.velocityY < 0) {
    enter(agent, "reentry");
  } else if (agent.phase === "reentry" && (fluke < -0.1 || agent.elapsed > 0.7)) {
    // Fully in: the swimmer takes over with the momentum it entered with.
    motion.speed = Math.min(DOLPHIN_MAX_SPEED, motion.speed);
    enter(agent, "dive");
    agent.plan = null;
  }
}

/** Lateral steering away from the yacht, other animals and pod mates. */
function avoidance(
  agent: DolphinAgent,
  obstacles: readonly DolphinObstacle[],
  vessel: VesselState,
): { x: number; z: number } {
  let x = 0;
  let z = 0;
  const motion = agent.motion;
  for (const obstacle of obstacles) {
    const dx = motion.x - obstacle.x;
    const dz = motion.z - obstacle.z;
    const distance = Math.hypot(dx, dz) || 0.001;
    const reach = obstacle.radius + 7;
    if (distance < reach) {
      const push = ((reach - distance) / reach) * 6;
      x += (dx / distance) * push;
      z += (dz / distance) * push;
    }
  }
  const dx = motion.x - vessel.x;
  const dz = motion.z - vessel.z;
  const distance = Math.hypot(dx, dz) || 0.001;
  if (distance < 7) {
    const push = ((7 - distance) / 7) * 2.5;
    x += (dx / distance) * push;
    z += (dz / distance) * push;
  }
  return { x, z };
}

function avoidanceTurn(agent: DolphinAgent, obstacles: readonly DolphinObstacle[], vessel: VesselState): number {
  const steer = avoidance(agent, obstacles, vessel);
  if (Math.hypot(steer.x, steer.z) < 0.01) return 0;
  const away = Math.atan2(steer.x, steer.z);
  return clamp(shortestAngleDifference(agent.motion.heading, away) * 0.3, -0.4, 0.4);
}

/** Vessel-frame position: lateral (starboard positive) and along (bow positive). */
function vesselFrame(x: number, z: number, vessel: VesselState): { lateral: number; along: number } {
  const forwardX = Math.sin(vessel.heading);
  const forwardZ = Math.cos(vessel.heading);
  const dx = x - vessel.x;
  const dz = z - vessel.z;
  return { lateral: dx * forwardZ - dz * forwardX, along: dx * forwardX + dz * forwardZ };
}

/** Hulls, keels and rudders of the catamaran in the vessel frame (centre of each animal must stay out). */
export const YACHT_HULL_BOX = { halfBeam: 2.2, bow: 4.7, stern: -4.5, draft: 1.3 } as const;
/** The same box with the clearance dolphins keep from it. */
export const DOLPHIN_HULL_ZONE = { halfBeam: 2.7, bow: 5.1, stern: -4.9, draft: 1.75 } as const;

/**
 * Whether the dolphin is in, or within about a second and a half of, the
 * water the hulls occupy, judged from its velocity relative to the yacht.
 */
function headingForHull(agent: DolphinAgent, vessel: VesselState): boolean {
  const motion = agent.motion;
  const horizontal = motion.speed * Math.cos(motion.pitch);
  const relativeX = Math.sin(motion.heading) * horizontal - Math.sin(vessel.heading) * vessel.speed;
  const relativeZ = Math.cos(motion.heading) * horizontal - Math.cos(vessel.heading) * vessel.speed;
  const zone = DOLPHIN_HULL_ZONE;
  for (const ahead of [0, 0.4, 0.8, 1.2, 1.6]) {
    const frame = vesselFrame(motion.x + relativeX * ahead, motion.z + relativeZ * ahead, vessel);
    if (
      Math.abs(frame.lateral) < zone.halfBeam + 1.2 &&
      frame.along < zone.bow + 1.5 &&
      frame.along > zone.stern - 1.5
    ) {
      return true;
    }
  }
  return false;
}

function clearOfHullForLeap(agent: DolphinAgent, vessel: VesselState): boolean {
  const frame = vesselFrame(agent.motion.x, agent.motion.z, vessel);
  return Math.abs(frame.lateral) > 3.2 || frame.along > DOLPHIN_HULL_ZONE.bow + 0.4;
}

/**
 * Hard constraint: a dolphin can never be inside the yacht. Steering keeps
 * them clear; this only resolves the rare case where the yacht turns onto
 * one, by easing it out along the shortest way.
 */
function keepClearOfHull(agent: DolphinAgent, vessel: VesselState, dt: number): void {
  const motion = agent.motion;
  const frame = vesselFrame(motion.x, motion.z, vessel);
  const zone = DOLPHIN_HULL_ZONE;
  const depth = -motion.y;
  if (Math.abs(frame.lateral) >= zone.halfBeam || frame.along >= zone.bow || frame.along <= zone.stern || depth >= zone.draft) {
    return;
  }
  const forwardX = Math.sin(vessel.heading);
  const forwardZ = Math.cos(vessel.heading);
  const outLateral = zone.halfBeam - Math.abs(frame.lateral);
  const outBow = zone.bow - frame.along;
  const outDown = zone.draft - depth;
  const smallest = Math.min(outLateral, outBow, outDown);
  // Never a jump: the correction is no faster than a dolphin can swim.
  const step = HULL_ESCAPE_SPEED * dt;
  if (smallest === outDown) {
    motion.y -= Math.min(outDown, step);
    motion.verticalSpeed = Math.min(motion.verticalSpeed, 0);
  } else if (smallest === outBow) {
    const move = Math.min(outBow, step);
    motion.x += forwardX * move;
    motion.z += forwardZ * move;
  } else {
    const side = Math.sign(frame.lateral) || 1;
    const move = Math.min(outLateral, step);
    motion.x += forwardZ * side * move;
    motion.z += -forwardX * side * move;
  }
}

/** Speed at which a dolphin caught by a turning yacht slips out of her way. */
const HULL_ESCAPE_SPEED = 4.5;

/** Fluke beat, body arching and spin. */
function stepBody(agent: DolphinAgent, dt: number): void {
  const motion = agent.motion;
  const airborne = agent.phase === "leap" || agent.phase === "airborne" || agent.phase === "reentry";
  // Tail-beat frequency rises with speed; strokes stop in the air.
  const frequency = clamp(0.55 + 0.36 * motion.speed, 0.8, 3.8);
  agent.strokePhase += Math.PI * 2 * frequency * dt;
  let amplitude = 1;
  if (agent.phase === "accelerate" || agent.phase === "approach_surface") amplitude = 1.35;
  else if (airborne) amplitude = 0;
  else if (agent.phase === "dive") amplitude = agent.elapsed < 0.45 ? 0.25 : 1.1;
  else if (agent.phase === "recover") amplitude = 1.15;
  else amplitude = clamp(0.75 + agent.surge * 0.12, 0.75, 1.15);
  const rate = airborne ? 14 : 3;
  agent.strokeAmplitude += (amplitude - agent.strokeAmplitude) * (1 - Math.exp(-rate * dt));

  // The body follows the curve of its path: an arc in the air, a bend into a turn.
  const speedSquared = Math.max(4, motion.speed * motion.speed);
  const targetCurvature = airborne
    ? (GRAVITY * Math.cos(motion.pitch)) / speedSquared
    : clamp(-motion.pitchRate / Math.max(1, motion.speed), -0.35, 0.35);
  agent.curvature += (targetCurvature - agent.curvature) * (1 - Math.exp(-10 * dt));
  const lateral = clamp(motion.yawRate / Math.max(1, motion.speed), -0.3, 0.3);
  agent.lateralCurvature += (lateral - agent.lateralCurvature) * (1 - Math.exp(-6 * dt));

  // Spinner leaps complete their rolls by the time the head re-enters.
  const spins = agent.plan?.spins ?? 0;
  if (airborne && spins > 0) {
    const progress = smoothstep(0.06, 0.94, agent.airTime / Math.max(0.3, agent.airDuration));
    agent.roll = Math.PI * 2 * spins * progress;
  } else {
    // A completed roll is upright again; then bank gently into turns.
    agent.roll = Math.atan2(Math.sin(agent.roll), Math.cos(agent.roll));
    const banked = clamp(-motion.yawRate * motion.speed * 0.09, -0.45, 0.45);
    agent.roll += (banked - agent.roll) * (1 - Math.exp(-6 * dt));
  }
}
