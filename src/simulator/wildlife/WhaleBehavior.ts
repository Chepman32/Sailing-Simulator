import { clamp, smoothstep } from "../math";
import {
  createSwimmer3D,
  shortestAngleDifference,
  stepSwimmerAtDepth,
  type DepthControl,
  type Swimmer3D,
  type Swimmer3DLimits,
} from "./SwimmerDynamics";
import { confineToDeepWater, createShallowsSteering, WHALE_SHORE, steerClearOfShallows } from "./ShoreAvoidance";
import type { MarineWorld, VesselState } from "./WaterContact";

const shallows = createShallowsSteering();

/**
 * Behaviour of one large baleen whale.
 *
 * A whale spends most of its life out of sight. It cruises deep, comes up
 * slowly, breathes two or three times with only its back and blowhole
 * breaking the surface, and dives again. Occasionally, after surfacing, it
 * lobtails: it slows, tips its head down, lifts its peduncle until the flukes
 * stand clear of the water, and brings them down on the surface, once or a
 * few times, before sounding.
 *
 *   deep_swim → ascend → surface → prepare_tail_slap → tail_slap → submerge → cooldown → deep_swim
 *                                └──────────────(no slap)───────────────↗
 *
 * Everything here is pure and works in the whale's own frame: the body is
 * the 18 m rigged model, its root at the model centre, +Z toward the head.
 * The tail is a chain of three joints whose bends follow their targets
 * through damped springs, stiff at the root and laggier toward the flukes,
 * so a stroke starts in the body and whips through to the tip.
 */

export type WhalePhase =
  | "deep_swim"
  | "ascend"
  | "surface"
  | "prepare_tail_slap"
  | "tail_slap"
  | "submerge"
  | "cooldown";

export const WHALE_LENGTH = 18;
/** Body top above the model centre, at the dorsal ridge. */
export const WHALE_DORSAL_HEIGHT = 2.14;
/** Belly and flipper tips below the model centre. */
export const WHALE_KEEL_DEPTH = 1.85;
/** Blowhole in the whale frame (y up, z forward), metres. */
export const WHALE_BLOWHOLE = { y: 1.95, z: 5.4 } as const;

/**
 * Tail chain measured from the rigged model's rest pose (whale frame).
 * Pivot of the first tail joint, then each segment's length and its
 * resting elevation (positive when the segment rises toward the tail).
 */
export const WHALE_TAIL_ROOT = { y: 0.89, z: 0.99 } as const;
export const WHALE_TAIL_SEGMENTS = [
  { length: 2.91, restElevation: -0.169 },
  { length: 4.15, restElevation: -0.256 },
  { length: 4.06, restElevation: -0.402 },
] as const;
/** Where the fluke blade sits on the last segment: distance along it and lift off its line. */
export const WHALE_FLUKE_CENTRE = { along: 2.5, lift: 0.3 } as const;
export const WHALE_FLUKE_TIP = { along: 3.3, lift: 0.25 } as const;

/**
 * The model rests with its tail drooping. These bends straighten most of
 * the droop while swimming, as a whale holds its peduncle in line.
 */
export const WHALE_NEUTRAL_BENDS = [0.12, 0.06, 0.1] as const;

/** Physical bend limits of each tail joint, radians (positive lifts the tail). */
export const WHALE_BEND_LIMITS = [
  { min: -0.3, max: 0.42 },
  { min: -0.42, max: 0.6 },
  { min: -0.68, max: 0.75 },
] as const;

/** Model-centre depths, metres below the surface. */
export const WHALE_DEEP_DEPTH = { min: 9.5, max: 11.5 } as const;
export const WHALE_SURFACE_BREATH_DEPTH = 1.84;
export const WHALE_SURFACE_REST_DEPTH = 2.85;
export const WHALE_LOBTAIL_DEPTH = 3.35;
/**
 * Hard limit on the model centre: with the dorsal ridge 2.14 m above it, at
 * most about half a metre of back can ever clear the mean surface.
 */
export const WHALE_SHALLOWEST_DEPTH = 1.6;

/** No whale event happens closer than this to the yacht, or farther. */
export const WHALE_EVENT_MIN_DISTANCE = 26;
export const WHALE_EVENT_MAX_DISTANCE = 80;
/** A whale this far from the yacht while hidden at depth is moved ahead of it. */
export const WHALE_RELOCATE_DISTANCE = 280;
export const WHALE_HIDDEN_DEPTH = 7.5;

export const WHALE_LIMITS: Swimmer3DLimits = {
  minSpeed: 0.25,
  maxSpeed: 2.7,
  acceleration: 0.12,
  deceleration: 0.2,
  maxTurnRate: 0.075,
  maxYawAcceleration: 0.022,
  turnResponse: 0.35,
  minTurnRadius: 28,
  maxPitch: 0.26,
  maxPitchRate: 0.055,
  maxPitchAcceleration: 0.03,
  pitchResponse: 0.6,
};

/** Minimum time between two lobtailing displays, seconds. */
export const WHALE_SLAP_COOLDOWN = 50;

type TailJoint = { angle: number; rate: number };

export type WhaleSlapPlan = {
  /** Slaps in this display. */
  count: number;
  /** Slaps already delivered. */
  delivered: number;
  /** 0.8–1.2: how hard the flukes come down. */
  force: number;
  /** 0.85–1.1: how high the flukes are lifted. */
  lift: number;
  /** Head-down body angle while lobtailing. */
  bodyAngle: number;
};

export type TailSlapStage = "rise" | "hold" | "downstroke" | "follow" | "relift";

export type WhaleAgent = {
  motion: Swimmer3D;
  phase: WhalePhase;
  elapsed: number;
  /** Planned length of the current phase, seconds. */
  duration: number;
  /** Seconds since the last lobtail began; large when there has been none. */
  sinceSlap: number;
  encounters: number;
  surfacingsWithoutSlap: number;
  /** Breaths taken in the current surfacing, and the clock for the next one. */
  breaths: number;
  plannedBreaths: number;
  breathClock: number;
  /** Target depth of the model centre for the current breath cycle. */
  surfaceDepth: number;
  slap: WhaleSlapPlan;
  stage: TailSlapStage;
  stageElapsed: number;
  flukeUp: boolean;
  /** Head-down pose angle on top of the swimming path, and its rate. */
  bodyAngle: number;
  bodyAngleRate: number;
  tail: TailJoint[];
  /** Fluke beat phase and its amplitude (0–1). */
  strokePhase: number;
  strokeAmplitude: number;
  /** Side of the yacht the encounter is staged on. */
  side: number;
  wander: number;
  rendezvousX: number;
  rendezvousZ: number;
  relocated: boolean;
  /**
   * Vertical excursion of the water around the whale. The body rides it on
   * top of its own depth keeping: fully at the surface, hardly at depth.
   */
  heave: number;
  /** Nose-up tilt the swell gives the body: a long whale lies along the waves. */
  wavePitch: number;
};

export type WhalePose = {
  /** Head-down pitch of the whole body on top of the path angle. */
  bodyAngle: number;
  /** Procedural bend of each tail joint, including the neutral straightening. */
  bends: [number, number, number];
  /** Weight of the authored secondary motion (flippers). */
  secondaryWeight: number;
};

export type RandomSource = () => number;

function between(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random();
}

export function createWhaleAgent(x: number, z: number, heading: number, random: RandomSource): WhaleAgent {
  const depth = between(random, WHALE_DEEP_DEPTH.min, WHALE_DEEP_DEPTH.max);
  return {
    motion: createSwimmer3D(x, -depth, z, heading, 1.8),
    phase: "deep_swim",
    elapsed: 0,
    // The first encounter comes soon after the scene opens.
    duration: between(random, 6, 10),
    sinceSlap: Number.POSITIVE_INFINITY,
    encounters: 0,
    surfacingsWithoutSlap: 0,
    breaths: 0,
    plannedBreaths: 2,
    breathClock: 0,
    surfaceDepth: WHALE_SURFACE_REST_DEPTH,
    slap: { count: 1, delivered: 0, force: 1, lift: 1, bodyAngle: 0.3 },
    stage: "rise",
    stageElapsed: 0,
    flukeUp: false,
    bodyAngle: 0,
    bodyAngleRate: 0,
    tail: WHALE_TAIL_SEGMENTS.map(() => ({ angle: 0, rate: 0 })),
    strokePhase: random() * Math.PI * 2,
    strokeAmplitude: 0.7,
    side: random() < 0.5 ? -1 : 1,
    wander: random() * 100,
    rendezvousX: x,
    rendezvousZ: z,
    relocated: false,
    heave: 0,
    wavePitch: 0,
  };
}

/** World height of the model centre: its depth keeping plus the water's heave. */
export function whaleWorldY(agent: WhaleAgent): number {
  return agent.motion.y + agent.heave;
}

function enter(agent: WhaleAgent, phase: WhalePhase, duration: number): void {
  agent.phase = phase;
  agent.elapsed = 0;
  agent.duration = duration;
}

/**
 * Advances the whale by `delta` seconds. Returns true on the frame a phase
 * changes, which the controller uses for one-shot effects.
 */
export function stepWhale(
  agent: WhaleAgent,
  world: MarineWorld,
  vessel: VesselState,
  delta: number,
  random: RandomSource,
): boolean {
  const dt = clamp(delta, 0, 0.05);
  if (dt <= 0) return false;
  agent.elapsed += dt;
  agent.sinceSlap += dt;
  agent.wander += dt;
  const startPhase = agent.phase;
  const motion = agent.motion;
  const toVesselX = vessel.x - motion.x;
  const toVesselZ = vessel.z - motion.z;
  const vesselDistance = Math.hypot(toVesselX, toVesselZ);
  const depth = -motion.y;

  // --- Phase logic ---------------------------------------------------------
  switch (agent.phase) {
    case "deep_swim":
    case "cooldown": {
      // A whale cannot keep pace with a yacht under way. Once one has been
      // left well astern, hidden at depth, it is moved ahead to meet her.
      const astern =
        (motion.x - vessel.x) * Math.sin(vessel.heading) + (motion.z - vessel.z) * Math.cos(vessel.heading) < -60;
      const leftBehind = vessel.speed > 2 && astern && vesselDistance > 70;
      if ((vesselDistance > WHALE_RELOCATE_DISTANCE || leftBehind) && depth > WHALE_HIDDEN_DEPTH) {
        relocateAhead(agent, vessel, world, random);
      }
      if (agent.phase === "cooldown" && agent.elapsed >= agent.duration) {
        enter(agent, "deep_swim", between(random, 8, 16));
      } else if (
        agent.phase === "deep_swim" &&
        agent.elapsed >= agent.duration &&
        goodMomentToSurface(agent, vessel) &&
        world.seabedDepth(motion.x, motion.z) > 13
      ) {
        enter(agent, "ascend", between(random, 13, 18));
      }
      break;
    }
    case "ascend":
      if (depth <= WHALE_SURFACE_REST_DEPTH + 0.35 || agent.elapsed > agent.duration + 10) {
        enter(agent, "surface", 0);
        agent.breaths = 0;
        agent.plannedBreaths = random() < 0.55 ? 2 : 3;
        agent.breathClock = between(random, 0.5, 2);
        agent.surfaceDepth = WHALE_SURFACE_REST_DEPTH;
      }
      break;
    case "surface": {
      agent.breathClock -= dt;
      if (agent.breathClock <= 0) {
        if (agent.surfaceDepth > WHALE_SURFACE_BREATH_DEPTH + 0.1) {
          // Rise to breathe: the blowhole and a sliver of back clear the water.
          agent.surfaceDepth = WHALE_SURFACE_BREATH_DEPTH;
          agent.breathClock = between(random, 3.4, 4.6);
        } else {
          agent.breaths += 1;
          agent.surfaceDepth = WHALE_SURFACE_REST_DEPTH;
          agent.breathClock = between(random, 4.5, 7);
        }
      }
      const tooClose = vesselDistance < WHALE_EVENT_MIN_DISTANCE - 10;
      const done = agent.breaths >= agent.plannedBreaths && agent.surfaceDepth > WHALE_SURFACE_BREATH_DEPTH + 0.1;
      if (tooClose || (done && agent.breathClock < 2)) {
        // The first encounter almost always shows the display; later ones
        // become likelier the longer the whale has gone without one.
        const slapChance = agent.encounters === 0 ? 0.9 : Math.min(0.95, 0.65 + 0.2 * agent.surfacingsWithoutSlap);
        const slapAllowed =
          !tooClose &&
          agent.sinceSlap >= WHALE_SLAP_COOLDOWN &&
          vesselDistance <= WHALE_EVENT_MAX_DISTANCE + 50 &&
          world.seabedDepth(motion.x, motion.z) > 10;
        if (slapAllowed && random() < slapChance) {
          beginLobtail(agent, random);
        } else {
          beginSubmerge(agent, random, !tooClose && random() < 0.4);
        }
      }
      break;
    }
    case "prepare_tail_slap":
    case "tail_slap":
      stepLobtail(agent, dt, random, vesselDistance);
      break;
    case "submerge":
      if (agent.elapsed >= agent.duration) {
        agent.encounters += 1;
        agent.surfacingsWithoutSlap = agent.sinceSlap < agent.elapsed + 30 ? 0 : agent.surfacingsWithoutSlap + 1;
        enter(agent, "cooldown", between(random, 18, 30));
      }
      break;
  }

  // --- Steering ------------------------------------------------------------
  const targetDepth = phaseDepth(agent, world);
  let desiredHeading = motion.heading;
  let desiredSpeed = 1.7;
  if (agent.phase === "deep_swim" || agent.phase === "cooldown") {
    // Converge on a meeting point off the yacht's bow quarter, so that a
    // whale coming up surfaces where it can be seen, not under the yacht.
    const forwardX = Math.sin(vessel.heading);
    const forwardZ = Math.cos(vessel.heading);
    // Ahead by about the time an ascent and a breath take, so a moving
    // yacht arrives abeam as the whale comes up.
    const lead = clamp(vessel.speed * 26, 0, 140);
    const offset = agent.phase === "cooldown" ? 70 : 42;
    agent.rendezvousX = vessel.x + forwardX * lead + forwardZ * agent.side * offset;
    agent.rendezvousZ = vessel.z + forwardZ * lead - forwardX * agent.side * offset;
    const toRendezvous = Math.atan2(agent.rendezvousX - motion.x, agent.rendezvousZ - motion.z);
    const meander = Math.sin(agent.wander * 0.045) * 0.35 + Math.sin(agent.wander * 0.017 + 1.3) * 0.25;
    const distance = Math.hypot(agent.rendezvousX - motion.x, agent.rendezvousZ - motion.z);
    desiredHeading = distance > 25 ? toRendezvous + meander * 0.5 : motion.heading + meander * 0.2;
    desiredSpeed = clamp(1.35 + distance / 120, 1.35, 2.5);
  } else if (agent.phase === "ascend" || agent.phase === "surface") {
    // Coming up across a moving yacht's path: hold course and slow down.
    desiredSpeed = agent.phase === "ascend" ? 1.35 : 1.15;
    desiredHeading = motion.heading + Math.sin(agent.wander * 0.06) * 0.15;
    if (vessel.speed < 1.5) {
      // Near a stopped yacht the whale swings past her on a wide circle,
      // turning the way it is already heading.
      const radial = Math.max(1, vesselDistance);
      const awayX = -toVesselX / radial;
      const awayZ = -toVesselZ / radial;
      const across = Math.sin(motion.heading) * awayZ - Math.cos(motion.heading) * awayX;
      const turn = across >= 0 ? 1 : -1;
      const correction = clamp((62 - vesselDistance) / 25, -0.8, 0.8);
      desiredHeading = Math.atan2(awayZ * turn + awayX * correction, -awayX * turn + awayZ * correction);
    }
  } else if (agent.phase === "prepare_tail_slap" || agent.phase === "tail_slap") {
    desiredSpeed = 0.3;
  } else if (agent.phase === "submerge") {
    desiredSpeed = 1.6;
  }
  // Keep clear of the yacht and of shoal water.
  if (vesselDistance < 55 && agent.phase !== "prepare_tail_slap" && agent.phase !== "tail_slap") {
    const away = Math.atan2(-toVesselX, -toVesselZ);
    const weight = smoothstep(55, 22, vesselDistance);
    desiredHeading = blendHeading(desiredHeading, away, weight);
  }
  // Reef shelves and beaches: an 18 m whale needs deep water well ahead.
  steerClearOfShallows(world, motion.x, motion.z, motion.heading, desiredHeading, motion.speed, WHALE_SHORE, shallows);
  desiredHeading = shallows.heading;
  desiredSpeed *= 1 - shallows.urgency * 0.4;

  // Depth is kept relative to the mean surface; the waves carry the body on top.
  const seabedLimit = -(world.seabedDepth(motion.x, motion.z) - WHALE_KEEL_DEPTH - 1);
  // The seabed may squeeze the whale upward, but never out of the sea.
  const targetY = Math.min(Math.max(-targetDepth, seabedLimit), -WHALE_SHALLOWEST_DEPTH);
  // An 18 m body climbing steeply would lift its head metres clear of the
  // water; near the surface a whale levels off and drifts up.
  const control = depthControl(agent.phase);
  scratchControl.frequency = control.frequency;
  scratchControl.maxVerticalAcceleration = control.maxVerticalAcceleration;
  scratchControl.hoverSpeed = control.hoverSpeed;
  scratchControl.maxVerticalSpeed =
    targetY > motion.y
      ? // A slow whale drifts up even more gently, or its path would tilt the head out.
        clamp(0.08 + 0.09 * (-motion.y - WHALE_SHALLOWEST_DEPTH), 0.08, control.maxVerticalSpeed) *
        clamp(motion.speed / 1.4, 0.45, 1)
      : control.maxVerticalSpeed;
  stepSwimmerAtDepth(motion, desiredHeading, targetY, desiredSpeed, dt, WHALE_LIMITS, scratchControl);
  // Hard limit: never onto the shelf or the beach, never by a jump.
  confineToDeepWater(world, motion, WHALE_SHORE.minDepth * 0.75, 1.5, dt);
  if (motion.y > -WHALE_SHALLOWEST_DEPTH) {
    motion.y = -WHALE_SHALLOWEST_DEPTH;
    motion.verticalSpeed = Math.min(0, motion.verticalSpeed);
  }
  const waterDepth = Math.max(0, -motion.y);
  agent.heave = world.orbitalHeight(motion.x, motion.z, waterDepth);
  const forwardX = Math.sin(motion.heading) * 5;
  const forwardZ = Math.cos(motion.heading) * 5;
  const ahead = world.orbitalHeight(motion.x + forwardX, motion.z + forwardZ, waterDepth);
  const astern = world.orbitalHeight(motion.x - forwardX, motion.z - forwardZ, waterDepth);
  agent.wavePitch = Math.atan2(ahead - astern, 10);

  // --- Body pose -----------------------------------------------------------
  stepPose(agent, dt);
  return agent.phase !== startPhase;
}

/** How briskly the whale changes depth: lazily at depth, deliberately at the surface. */
const DEEP_DEPTH_CONTROL: DepthControl = { frequency: 0.32, maxVerticalSpeed: 0.5, maxVerticalAcceleration: 0.06 };
const SURFACE_DEPTH_CONTROL: DepthControl = { frequency: 0.95, maxVerticalSpeed: 0.55, maxVerticalAcceleration: 0.28 };
const LOBTAIL_DEPTH_CONTROL: DepthControl = { frequency: 0.7, maxVerticalSpeed: 0.4, maxVerticalAcceleration: 0.16, hoverSpeed: 1.2 };

const scratchControl: DepthControl = { ...DEEP_DEPTH_CONTROL };

function depthControl(phase: WhalePhase): DepthControl {
  switch (phase) {
    case "surface":
      return SURFACE_DEPTH_CONTROL;
    case "prepare_tail_slap":
    case "tail_slap":
    case "submerge":
      return LOBTAIL_DEPTH_CONTROL;
    default:
      return DEEP_DEPTH_CONTROL;
  }
}

/**
 * Whether surfacing now would put the whale in view: a stopped yacht must be
 * at a comfortable distance; a moving one must be due to pass at one in
 * about the time an ascent takes.
 */
function goodMomentToSurface(agent: WhaleAgent, vessel: VesselState): boolean {
  const motion = agent.motion;
  const relativeX = motion.x - vessel.x;
  const relativeZ = motion.z - vessel.z;
  const distance = Math.hypot(relativeX, relativeZ);
  const horizontal = motion.speed * Math.cos(motion.pitch);
  const velocityX = Math.sin(motion.heading) * horizontal - Math.sin(vessel.heading) * vessel.speed;
  const velocityZ = Math.cos(motion.heading) * horizontal - Math.cos(vessel.heading) * vessel.speed;
  const closing = velocityX * velocityX + velocityZ * velocityZ;
  if (closing < 1e-4) return false;
  const timeToClosest = -(relativeX * velocityX + relativeZ * velocityZ) / closing;
  if (vessel.speed < 1.5) {
    // A stopped yacht: come up at a comfortable distance on a course that
    // will not carry the whale into her during the next minute.
    const horizon = clamp(timeToClosest, 0, 60);
    const closest = Math.hypot(relativeX + velocityX * horizon, relativeZ + velocityZ * horizon);
    return (
      distance >= WHALE_EVENT_MIN_DISTANCE + 12 &&
      distance <= WHALE_EVENT_MAX_DISTANCE - 10 &&
      closest >= WHALE_EVENT_MIN_DISTANCE + 12
    );
  }
  const closest = Math.hypot(relativeX + velocityX * timeToClosest, relativeZ + velocityZ * timeToClosest);
  return timeToClosest > 8 && timeToClosest < 45 && closest >= WHALE_EVENT_MIN_DISTANCE && closest <= 100;
}

function blendHeading(from: number, to: number, weight: number): number {
  return from + shortestAngleDifference(from, to) * clamp(weight, 0, 1);
}

function phaseDepth(agent: WhaleAgent, world: MarineWorld): number {
  const seabed = world.seabedDepth(agent.motion.x, agent.motion.z);
  const deepest = Math.max(4, seabed - WHALE_KEEL_DEPTH - 1);
  switch (agent.phase) {
    case "deep_swim":
    case "cooldown":
      return Math.min(deepest, (WHALE_DEEP_DEPTH.min + WHALE_DEEP_DEPTH.max) / 2 + Math.sin(agent.wander * 0.03) * 0.8);
    case "ascend":
      return WHALE_SURFACE_REST_DEPTH;
    case "surface":
      return agent.surfaceDepth;
    case "prepare_tail_slap":
    case "tail_slap":
      return WHALE_LOBTAIL_DEPTH;
    case "submerge": {
      // A sounding whale pivots at the surface before it goes down.
      const progress = agent.elapsed / agent.duration;
      const descent = agent.flukeUp ? smoothstep(0.35, 1, progress) : smoothstep(0, 1, progress);
      return Math.min(deepest, (agent.flukeUp ? 2.6 : WHALE_SURFACE_REST_DEPTH) + descent * 7.8);
    }
  }
}

function beginLobtail(agent: WhaleAgent, random: RandomSource): void {
  const roll = random();
  agent.slap = {
    count: roll < 0.4 ? 1 : roll < 0.8 ? 2 : 3,
    delivered: 0,
    force: between(random, 0.82, 1.18),
    lift: between(random, 0.86, 1.08),
    bodyAngle: between(random, 0.26, 0.35),
  };
  agent.sinceSlap = 0;
  agent.stage = "rise";
  agent.stageElapsed = 0;
  enter(agent, "prepare_tail_slap", between(random, 5.5, 7));
}

function beginSubmerge(agent: WhaleAgent, random: RandomSource, flukeUp: boolean): void {
  agent.flukeUp = flukeUp;
  enter(agent, "submerge", between(random, 8, 11));
}

/** Lobtailing: rise, hold, strike, follow through, and lift again for the next slap. */
function stepLobtail(agent: WhaleAgent, dt: number, random: RandomSource, vesselDistance: number): void {
  agent.stageElapsed += dt;
  // A yacht closing in ends the display before the flukes come down near it.
  if (vesselDistance < WHALE_EVENT_MIN_DISTANCE - 10 && agent.stage !== "downstroke" && agent.stage !== "follow") {
    beginSubmerge(agent, random, false);
    return;
  }
  if (agent.phase === "prepare_tail_slap") {
    agent.stage = "rise";
    if (agent.elapsed >= agent.duration && raisedTail(agent)) {
      enter(agent, "tail_slap", 0);
      agent.stage = "hold";
      agent.stageElapsed = 0;
      agent.duration = between(random, 0.25, 0.7);
    }
    return;
  }
  switch (agent.stage) {
    case "hold":
    case "relift":
      if (agent.stageElapsed >= agent.duration && raisedTail(agent)) {
        agent.stage = "downstroke";
        agent.stageElapsed = 0;
      }
      break;
    case "downstroke":
      if (agent.stageElapsed >= 0.95) {
        agent.stage = "follow";
        agent.stageElapsed = 0;
        agent.slap.delivered += 1;
      }
      break;
    case "follow":
      if (agent.stageElapsed >= 0.8) {
        const another = agent.slap.delivered < agent.slap.count && vesselDistance > WHALE_EVENT_MIN_DISTANCE - 8;
        if (another) {
          agent.stage = "relift";
          agent.stageElapsed = 0;
          agent.duration = between(random, 2.2, 3);
          agent.slap.force = clamp(agent.slap.force * between(random, 0.85, 1.12), 0.75, 1.25);
          agent.slap.lift = clamp(agent.slap.lift * between(random, 0.82, 1.02), 0.75, 1.1);
        } else {
          beginSubmerge(agent, random, false);
        }
      }
      break;
    case "rise":
      break;
  }
}

/** True once the flukes have nearly reached their raised pose and slowed. */
function raisedTail(agent: WhaleAgent): boolean {
  const tip = agent.tail[2]!;
  return Math.abs(tip.rate) < 0.12;
}

/** Target bends for the current moment, before the springs. */
export function whaleBendTargets(agent: WhaleAgent): [number, number, number] {
  const [n0, n1, n2] = WHALE_NEUTRAL_BENDS;
  const swim = agent.strokeAmplitude;
  const stroke = (index: number, amplitude: number) =>
    swim * amplitude * Math.sin(agent.strokePhase - index * 0.75);
  // Up and down strokes of the flukes: small at the root, growing toward the
  // tip, each joint a little later than the one before.
  const base: [number, number, number] = [n0 + stroke(0, 0.05), n1 + stroke(1, 0.11), n2 + stroke(2, 0.2)];
  const lift = agent.slap.lift;
  const raised: [number, number, number] = [n0 + 0.1 * lift, n1 + 0.24 * lift, n2 + 0.2 * lift];
  const struck: [number, number, number] = [n0 - 0.02, n1 - 0.12 * agent.slap.force, n2 - 0.46 * agent.slap.force];
  switch (agent.phase) {
    case "prepare_tail_slap":
      return raised;
    case "tail_slap":
      if (agent.stage === "downstroke" || agent.stage === "follow") return struck;
      if (agent.stage === "relift") return raised.map((value, index) => value - 0.04 * index) as [number, number, number];
      return raised.map((value, index) => value + 0.03 * index) as [number, number, number];
    case "submerge":
      if (agent.flukeUp) {
        // Sounding: the peduncle arches and the flukes lift clear as the
        // head goes down, then slide under.
        const show = smoothstep(0.05, 0.3, agent.elapsed / agent.duration) * (1 - smoothstep(0.5, 0.82, agent.elapsed / agent.duration));
        return [n0 + 0.06 * show, n1 + 0.2 * show, n2 + 0.3 * show];
      }
      return base;
    default:
      return base;
  }
}

function bodyAngleTarget(agent: WhaleAgent): number {
  switch (agent.phase) {
    case "prepare_tail_slap":
    case "tail_slap":
      return agent.slap.bodyAngle + (agent.stage === "downstroke" ? -0.06 : 0);
    case "submerge": {
      const progress = agent.elapsed / agent.duration;
      const peak = agent.flukeUp ? 0.5 : 0.16;
      return peak * smoothstep(0, 0.3, progress) * (1 - smoothstep(0.6, 1, progress));
    }
    case "surface":
      // Rolling over at each breath: nose up as the head rises, down as it sinks.
      return agent.surfaceDepth < WHALE_SURFACE_BREATH_DEPTH + 0.1 ? -0.04 : 0.03;
    default:
      return 0;
  }
}

/** Spring frequencies of the tail joints; the flukes lag the body. */
const TAIL_FREQUENCY = [2.6, 2.1, 1.65] as const;
const TAIL_DAMPING = [0.9, 0.75, 0.58] as const;

function stepPose(agent: WhaleAgent, dt: number): void {
  const motion = agent.motion;
  const lobtailing = agent.phase === "prepare_tail_slap" || agent.phase === "tail_slap";
  // Fluke strokes: slow and deep at cruising speed, quieter when slowing.
  // A blue whale beats its flukes every four to eight seconds; harder when it
  // speeds up or climbs, barely at all while gliding down.
  const frequency = 0.12 + 0.065 * motion.speed;
  agent.strokePhase += Math.PI * 2 * frequency * dt;
  const effort = clamp(motion.verticalSpeed * 1.2, -0.3, 0.35);
  const targetAmplitude = lobtailing ? 0 : clamp(0.45 + motion.speed * 0.3 + effort, 0.3, 1.15);
  agent.strokeAmplitude += (targetAmplitude - agent.strokeAmplitude) * (1 - Math.exp(-0.8 * dt));

  const bodyTarget = bodyAngleTarget(agent);
  const bodyFrequency = 0.85;
  const bodyAcceleration =
    bodyFrequency * bodyFrequency * (bodyTarget - agent.bodyAngle) - 2 * 0.95 * bodyFrequency * agent.bodyAngleRate;
  agent.bodyAngleRate += bodyAcceleration * dt;
  agent.bodyAngle += agent.bodyAngleRate * dt;

  const targets = whaleBendTargets(agent);
  // The muscles drive a strike far harder than a lift.
  const power = agent.phase === "tail_slap" && (agent.stage === "downstroke" || agent.stage === "follow") ? 2.3 : 1;
  agent.tail.forEach((joint, index) => {
    const omega = TAIL_FREQUENCY[index]! * power;
    const zeta = TAIL_DAMPING[index]!;
    const acceleration = omega * omega * (targets[index]! - joint.angle) - 2 * zeta * omega * joint.rate;
    joint.rate += acceleration * dt;
    joint.angle += joint.rate * dt;
    const limit = WHALE_BEND_LIMITS[index]!;
    if (joint.angle > limit.max || joint.angle < limit.min) {
      joint.angle = clamp(joint.angle, limit.min, limit.max);
      joint.rate *= -0.2;
    }
  });
}

export function whalePose(agent: WhaleAgent): WhalePose {
  const lobtailing = agent.phase === "prepare_tail_slap" || agent.phase === "tail_slap";
  return {
    // Each stroke rocks the body a little: the head dips as the flukes rise.
    bodyAngle: agent.bodyAngle - agent.wavePitch + agent.strokeAmplitude * 0.01 * Math.sin(agent.strokePhase + 1.2),
    bends: [agent.tail[0]!.angle, agent.tail[1]!.angle, agent.tail[2]!.angle],
    secondaryWeight: lobtailing ? 0.55 : 0.32,
  };
}

/** Moves a hidden, distant whale ahead of the yacht. Never used while it can be seen. */
function relocateAhead(agent: WhaleAgent, vessel: VesselState, world: MarineWorld, random: RandomSource): void {
  const forwardX = Math.sin(vessel.heading);
  const forwardZ = Math.cos(vessel.heading);
  const side = random() < 0.5 ? -1 : 1;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const ahead = between(random, 90, 130);
    const lateral = side * between(random, 30, 60);
    const x = vessel.x + forwardX * ahead + forwardZ * lateral;
    const z = vessel.z + forwardZ * ahead - forwardX * lateral;
    if (world.seabedDepth(x, z) < 15) continue;
    agent.motion.x = x;
    agent.motion.z = z;
    agent.motion.y = -between(random, WHALE_DEEP_DEPTH.min, WHALE_DEEP_DEPTH.max);
    // Swim across the yacht's track, not straight at it.
    agent.motion.heading = Math.atan2(-forwardX, -forwardZ) + side * 0.9;
    agent.motion.yawRate = 0;
    agent.motion.pitch = 0;
    agent.motion.pitchRate = 0;
    agent.side = side;
    agent.relocated = true;
    return;
  }
}

/**
 * Forward kinematics of the tail for a pose, in the whale frame with the
 * model centre at the origin: returns the joint pivots, the fluke centre and
 * the fluke tip as (y, z) pairs, after the head-down body angle.
 */
export function whaleTailPoints(bodyAngle: number, bends: readonly number[]): {
  joints: { y: number; z: number }[];
  flukeCentre: { y: number; z: number };
  flukeTip: { y: number; z: number };
} {
  const rotate = (y: number, z: number) => ({
    y: y * Math.cos(bodyAngle) - z * Math.sin(bodyAngle),
    z: y * Math.sin(bodyAngle) + z * Math.cos(bodyAngle),
  });
  let pivot = rotate(WHALE_TAIL_ROOT.y, WHALE_TAIL_ROOT.z);
  const joints = [pivot];
  let cumulative = 0;
  let elevation = 0;
  WHALE_TAIL_SEGMENTS.forEach((segment, index) => {
    cumulative += bends[index] ?? 0;
    elevation = segment.restElevation + cumulative + bodyAngle;
    pivot = {
      y: pivot.y + segment.length * Math.sin(elevation),
      z: pivot.z - segment.length * Math.cos(elevation),
    };
    joints.push(pivot);
  });
  const last = joints[joints.length - 2]!;
  const point = (along: number, lift: number) => ({
    y: last.y + along * Math.sin(elevation) + lift * Math.cos(elevation),
    z: last.z - along * Math.cos(elevation) + lift * Math.sin(elevation),
  });
  return {
    joints,
    flukeCentre: point(WHALE_FLUKE_CENTRE.along, WHALE_FLUKE_CENTRE.lift),
    flukeTip: point(WHALE_FLUKE_TIP.along, WHALE_FLUKE_TIP.lift),
  };
}

/** Height of the dorsal ridge at body station z (whale frame, rest pose). */
export function whaleDorsalHeight(z: number): number {
  // Measured from the model: highest at the shoulders, tapering to the head and peduncle.
  const stations: [number, number][] = [
    [-6.8, 0.12],
    [-5.3, 0.83],
    [-3.8, 1.66],
    [-2.3, 1.82],
    [-0.8, 2.04],
    [0.7, 2.14],
    [2.2, 2.14],
    [3.7, 2.1],
    [5.2, 1.98],
    [6.7, 1.71],
    [8.2, 1.38],
    [9, 1],
  ];
  if (z <= stations[0]![0]) return stations[0]![1];
  for (let index = 1; index < stations.length; index += 1) {
    const [z1, y1] = stations[index]!;
    const [z0, y0] = stations[index - 1]!;
    if (z <= z1) return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
  }
  return stations[stations.length - 1]![1];
}
