import { clamp } from "../math";
import { shortestAngleDifference } from "./SwimmerDynamics";

/**
 * Reef fish as a boids school with the same forward-only, bounded-turn rules
 * the larger animals obey.
 *
 * Each fish blends separation, alignment and cohesion with its neighbours, a
 * pull toward its school's patch of reef, a slow individual wander, a depth
 * band between the reef and the surface, and flight from threats. Steering
 * produces a desired heading, pitch and speed; the fish then turns at a
 * bounded rate and never swims backward, so panic produces a sudden flash
 * of the whole school rather than teleporting individuals.
 *
 * Pure and allocation-free: the controller owns the arrays, rendering and
 * world queries.
 */

export type FishAgent = {
  x: number;
  y: number;
  z: number;
  /** Yaw: 0 points along +Z, increasing toward +X. */
  heading: number;
  /** Positive raises the nose. */
  pitch: number;
  /** Through-water speed in m/s; always positive. */
  speed: number;
  yawRate: number;
  bank: number;
  /** Phase of the swimming body wave in radians. */
  tailPhase: number;
  /** 0 calm … 1 fleeing; decays over a few seconds. */
  panic: number;
  /** Individual offset for the wander noise. */
  seed: number;
};

export type FishSpecies = {
  key: string;
  /** Body length in metres. */
  length: number;
  /** School size on the high preset. */
  count: number;
  cruiseSpeed: number;
  burstSpeed: number;
  minSpeed: number;
  /** rad/s while calm; panicking fish turn faster. */
  maxTurnRate: number;
  separationRadius: number;
  neighbourRadius: number;
  alignment: number;
  cohesion: number;
  /** Metres seaward of the waterline that the school patrols. */
  shoreDistance: number;
  wanderRadius: number;
  /** Stays at least this far below the surface. */
  minDepth: number;
  /** Stays at least this far above the bottom. */
  bottomClearance: number;
  /** Keeps within this height of the bottom; 0 means anywhere in the column. */
  maxHeightAboveBottom: number;
};

export type FishThreat = {
  x: number;
  y: number;
  z: number;
  /** Distance at which fish start to flee. */
  radius: number;
  /** 0–1 how alarming the threat is. */
  strength: number;
};

export type FishWorld = {
  /** Water surface height at a point. */
  surfaceAt: (x: number, z: number) => number;
  /** Seabed height (negative) at a point. */
  bottomAt: (x: number, z: number) => number;
  homeX: number;
  homeY: number;
  homeZ: number;
  threats: readonly FishThreat[];
  time: number;
};

/** Shallowest water a reef fish will swim into, in metres. */
export const FISH_MIN_WATER_DEPTH = 0.9;
export const MAX_FISH_PITCH = 0.55;
const PANIC_TURN_MULTIPLIER = 2.6;
const PANIC_DECAY = 0.45;

export const REEF_FISH_SPECIES: readonly FishSpecies[] = [
  {
    key: "blue_tang",
    length: 0.28,
    count: 64,
    cruiseSpeed: 0.55,
    burstSpeed: 2.8,
    minSpeed: 0.18,
    maxTurnRate: 1.6,
    separationRadius: 0.42,
    neighbourRadius: 2.2,
    alignment: 0.85,
    cohesion: 0.55,
    shoreDistance: 9,
    wanderRadius: 7,
    minDepth: 0.7,
    bottomClearance: 0.5,
    maxHeightAboveBottom: 0,
  },
  {
    key: "Yellow",
    length: 0.2,
    count: 52,
    cruiseSpeed: 0.45,
    burstSpeed: 2.4,
    minSpeed: 0.15,
    maxTurnRate: 1.9,
    separationRadius: 0.32,
    neighbourRadius: 1.8,
    alignment: 0.75,
    cohesion: 0.6,
    shoreDistance: 6,
    wanderRadius: 5,
    minDepth: 0.6,
    bottomClearance: 0.35,
    maxHeightAboveBottom: 2.2,
  },
  {
    key: "moorish",
    length: 0.22,
    count: 14,
    cruiseSpeed: 0.35,
    burstSpeed: 2,
    minSpeed: 0.12,
    maxTurnRate: 1.5,
    separationRadius: 0.6,
    neighbourRadius: 1.6,
    alignment: 0.4,
    cohesion: 0.35,
    shoreDistance: 5,
    wanderRadius: 4,
    minDepth: 0.6,
    bottomClearance: 0.4,
    maxHeightAboveBottom: 1.6,
  },
  {
    key: "Clown",
    length: 0.11,
    count: 12,
    cruiseSpeed: 0.22,
    burstSpeed: 1.4,
    minSpeed: 0.08,
    maxTurnRate: 2.2,
    separationRadius: 0.3,
    neighbourRadius: 0.9,
    alignment: 0.15,
    cohesion: 0.5,
    shoreDistance: 3.5,
    wanderRadius: 1.6,
    minDepth: 0.5,
    bottomClearance: 0.15,
    maxHeightAboveBottom: 0.7,
  },
] as const;

export function createFishAgent(x: number, y: number, z: number, heading: number, seed: number): FishAgent {
  return { x, y, z, heading, pitch: 0, speed: 0.3, yawRate: 0, bank: 0, tailPhase: seed * 6.283, panic: 0, seed };
}

/** Tail beats per second: small fish beat faster, and every fish beats faster to go faster. */
export function tailBeatFrequency(speed: number, length: number): number {
  return clamp(0.9 + (0.65 * Math.max(0, speed)) / Math.max(length, 0.05), 0.9, 7);
}

/** Lateral tail excursion as a fraction of body length. */
export function tailAmplitude(speed: number, length: number, panic: number): number {
  return clamp(0.07 + (0.02 * speed) / Math.max(length, 0.05) + panic * 0.05, 0.07, 0.17);
}

/**
 * Advances one school by `delta` seconds.
 * @param agents The school, updated in place.
 */
export function stepSchool(
  agents: FishAgent[],
  species: FishSpecies,
  world: FishWorld,
  delta: number,
): void {
  const dt = clamp(delta, 0, 0.05);
  if (dt <= 0) return;
  const separation2 = species.separationRadius * species.separationRadius;
  const neighbour2 = species.neighbourRadius * species.neighbourRadius;

  for (let index = 0; index < agents.length; index += 1) {
    const fish = agents[index];
    let separateX = 0;
    let separateY = 0;
    let separateZ = 0;
    let alignX = 0;
    let alignZ = 0;
    let centreX = 0;
    let centreY = 0;
    let centreZ = 0;
    let neighbours = 0;
    let neighbourPanic = 0;

    for (let other = 0; other < agents.length; other += 1) {
      if (other === index) continue;
      const mate = agents[other];
      const dx = fish.x - mate.x;
      const dy = fish.y - mate.y;
      const dz = fish.z - mate.z;
      const distance2 = dx * dx + dy * dy + dz * dz;
      if (distance2 > neighbour2) continue;
      neighbours += 1;
      alignX += Math.sin(mate.heading);
      alignZ += Math.cos(mate.heading);
      centreX += mate.x;
      centreY += mate.y;
      centreZ += mate.z;
      neighbourPanic = Math.max(neighbourPanic, mate.panic);
      if (distance2 < separation2 && distance2 > 1e-8) {
        const push = (separation2 - distance2) / (separation2 * Math.sqrt(distance2));
        separateX += dx * push;
        separateY += dy * push;
        separateZ += dz * push;
      }
    }

    let steerX = separateX * 1.6;
    let steerY = separateY * 1.2;
    let steerZ = separateZ * 1.6;
    if (neighbours > 0) {
      const inverse = 1 / neighbours;
      steerX += alignX * inverse * species.alignment + (centreX * inverse - fish.x) * species.cohesion;
      steerY += (centreY * inverse - fish.y) * species.cohesion * 0.6;
      steerZ += alignZ * inverse * species.alignment + (centreZ * inverse - fish.z) * species.cohesion;
    }

    // Patrol the school's patch of reef with a slow individual wander.
    const wanderAngle = world.time * 0.11 + fish.seed * 6.283;
    const targetX = world.homeX + Math.sin(wanderAngle) * species.wanderRadius * (0.5 + fish.seed * 0.5);
    const targetZ = world.homeZ + Math.cos(wanderAngle * 0.8) * species.wanderRadius * (0.5 + fish.seed * 0.5);
    const homeX = targetX - fish.x;
    const homeZ = targetZ - fish.z;
    const homeDistance = Math.hypot(homeX, homeZ) || 1;
    const homePull = 0.25 + clamp((homeDistance - species.wanderRadius) / species.wanderRadius, 0, 3) * 0.6;
    steerX += (homeX / homeDistance) * homePull;
    steerZ += (homeZ / homeDistance) * homePull;

    // Threats: flee, and pass the alarm through the school.
    let panic = fish.panic * Math.exp(-PANIC_DECAY * dt);
    for (const threat of world.threats) {
      const dx = fish.x - threat.x;
      const dy = fish.y - threat.y;
      const dz = fish.z - threat.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance >= threat.radius || distance < 1e-6) continue;
      const fear = (1 - distance / threat.radius) * threat.strength;
      panic = Math.max(panic, fear);
      const flee = (fear * 6) / distance;
      steerX += dx * flee;
      steerY += dy * flee * 0.3;
      steerZ += dz * flee;
    }
    panic = Math.max(panic, neighbourPanic * 0.82);
    fish.panic = clamp(panic, 0, 1);

    // Depth band between the reef and the surface.
    const surface = world.surfaceAt(fish.x, fish.z);
    const bottom = world.bottomAt(fish.x, fish.z);
    const ceiling = surface - species.minDepth;
    const floor = bottom + species.bottomClearance;
    const roof =
      species.maxHeightAboveBottom > 0 ? Math.min(ceiling, bottom + species.maxHeightAboveBottom) : ceiling;
    if (fish.y > roof) steerY -= (fish.y - roof) * 2.2;
    if (fish.y < floor) steerY += (floor - fish.y) * 2.6;
    // Too shallow to swim: turn back toward the reef edge.
    if (surface - bottom < FISH_MIN_WATER_DEPTH + species.bottomClearance) {
      steerX += homeX / homeDistance * 2;
      steerZ += homeZ / homeDistance * 2;
    }

    const horizontal = Math.hypot(steerX, steerZ);
    const desiredHeading = horizontal > 1e-5 ? Math.atan2(steerX, steerZ) : fish.heading;
    const desiredPitch = clamp(Math.atan2(steerY, Math.max(horizontal, 0.4)), -MAX_FISH_PITCH, MAX_FISH_PITCH);
    const turnLimit = species.maxTurnRate * (1 + fish.panic * (PANIC_TURN_MULTIPLIER - 1));
    const targetYawRate = clamp(shortestAngleDifference(fish.heading, desiredHeading) * 3, -turnLimit, turnLimit);
    fish.yawRate += clamp(targetYawRate - fish.yawRate, -turnLimit * 6 * dt, turnLimit * 6 * dt);
    fish.heading = Math.atan2(Math.sin(fish.heading + fish.yawRate * dt), Math.cos(fish.heading + fish.yawRate * dt));
    fish.pitch += clamp(desiredPitch - fish.pitch, -1.5 * dt, 1.5 * dt);

    const desiredSpeed =
      species.cruiseSpeed * (0.75 + 0.5 * fish.seed) + (species.burstSpeed - species.cruiseSpeed) * fish.panic;
    const acceleration = fish.panic > 0.2 ? 6 : 0.8;
    fish.speed = clamp(
      fish.speed + clamp(desiredSpeed - fish.speed, -acceleration * dt, acceleration * dt),
      species.minSpeed,
      species.burstSpeed,
    );
    fish.bank = clamp(-fish.yawRate * fish.speed * 0.35, -0.5, 0.5);

    const horizontalSpeed = Math.cos(fish.pitch) * fish.speed;
    fish.x += Math.sin(fish.heading) * horizontalSpeed * dt;
    fish.z += Math.cos(fish.heading) * horizontalSpeed * dt;
    fish.y = clamp(fish.y + Math.sin(fish.pitch) * fish.speed * dt, bottom + 0.05, surface - 0.2);
    fish.tailPhase += tailBeatFrequency(fish.speed, species.length) * Math.PI * 2 * dt;
    if (fish.tailPhase > 1000) fish.tailPhase -= Math.PI * 2 * 150;
  }
}
