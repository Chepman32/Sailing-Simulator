import { clamp, smoothstep } from "../math";
import type { MarineWorld, VesselState } from "./WaterContact";

/**
 * A rare, distant breach: a whale launches itself out of the sea and crashes
 * back in, well away from the yacht.
 *
 * It is a separate animal from the whale that surfaces and lobtails near the
 * yacht (`WhaleBehavior`), which never lifts its body out of the water. This
 * one is only ever seen far off, once in several minutes, and spends the rest
 * of its time deep and unseen.
 *
 *   waiting → run (accelerating up from depth) → air (ballistic) → splash → dive → waiting
 *
 * The run is a steepening climb from twelve metres down at swimming speed to
 * the exit speed the chosen arc needs; from the moment the body centre leaves
 * the water it flies a ballistic arc under gravity, its body axis turning
 * from the climb toward the fall more slowly than the path (rotational
 * inertia) while it rolls onto its side or back. Re-entry hands the momentum
 * to the water, which stops it within a body length.
 */

export type BreachPhase = "waiting" | "run" | "air" | "splash" | "dive";
export type BreachVariant = "full" | "side" | "partial";

export const BREACH_GRAVITY = 9.81;
/** Minimum and maximum seconds between two breaches. */
export const BREACH_MIN_INTERVAL = 150;
export const BREACH_MAX_INTERVAL = 360;
/** The breach happens this far from the yacht, metres. */
export const BREACH_MIN_DISTANCE = 75;
export const BREACH_MAX_DISTANCE = 150;
/** Water needed under the breach, metres. */
export const BREACH_MIN_WATER = 15;
const RUN_START_DEPTH = 12;
const RUN_DURATION = 3.6;
const DIVE_DURATION = 7;

export type BreachPlan = {
  variant: BreachVariant;
  /** Height the body centre rises above the surface, metres. */
  apex: number;
  /** Path angle at the surface, radians above horizontal. */
  exitAngle: number;
  /** Total roll through the flight, radians. */
  roll: number;
};

export type BreachState = {
  phase: BreachPhase;
  elapsed: number;
  /** Seconds until the next breach may start. */
  countdown: number;
  plan: BreachPlan;
  /** Body centre and velocity, world metres and m/s. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  /** Body pitch (positive nose up) and roll, radians. */
  pitch: number;
  roll: number;
  /** Fluke beat phase and strength 0–1. */
  strokePhase: number;
  stroke: number;
  /** Breaches so far, for statistics. */
  count: number;
  /** Exit point and run start, set when a breach is planned. */
  exitX: number;
  exitZ: number;
};

export type RandomSource = () => number;

function between(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random();
}

export function createBreachState(random: RandomSource): BreachState {
  return {
    phase: "waiting",
    elapsed: 0,
    // The first breach comes a few minutes into the session.
    countdown: between(random, 120, 240),
    plan: { variant: "full", apex: 5, exitAngle: 1.15, roll: 2.4 },
    x: 0,
    y: -40,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: 0,
    pitch: 0,
    roll: 0,
    strokePhase: random() * Math.PI * 2,
    stroke: 0,
    count: 0,
    exitX: 0,
    exitZ: 0,
  };
}

export function chooseBreachPlan(random: RandomSource): BreachPlan {
  const roll = random();
  if (roll < 0.45) {
    // Most of the body clears the water and it twists onto its back.
    return { variant: "full", apex: between(random, 5, 6.8), exitAngle: between(random, 1.1, 1.25), roll: between(random, 2.2, 3) };
  }
  if (roll < 0.8) {
    // Lower, flatter, and it crashes down on its flank.
    return { variant: "side", apex: between(random, 3.4, 4.6), exitAngle: between(random, 0.9, 1.05), roll: between(random, 1.3, 1.8) };
  }
  // Head and chest only, coming down on its chin.
  return { variant: "partial", apex: between(random, 1.6, 2.5), exitAngle: between(random, 0.75, 0.9), roll: between(random, 0.2, 0.6) };
}

/** Exit speed (m/s) and its components for a plan. */
export function exitVelocity(plan: BreachPlan): { speed: number; vertical: number; horizontal: number } {
  const vertical = Math.sqrt(2 * BREACH_GRAVITY * plan.apex);
  const speed = vertical / Math.sin(plan.exitAngle);
  return { speed, vertical, horizontal: speed * Math.cos(plan.exitAngle) };
}

/**
 * Where the next breach can happen: ahead of the yacht or off her bow, so it
 * is likely in view, at a distance, over deep water. Null if nowhere fits.
 */
function planSite(
  world: MarineWorld,
  vessel: VesselState,
  random: RandomSource,
): { x: number; z: number; heading: number } | null {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bearing = vessel.heading + between(random, -1.05, 1.05);
    const distance = between(random, BREACH_MIN_DISTANCE, BREACH_MAX_DISTANCE);
    const x = vessel.x + Math.sin(bearing) * distance;
    const z = vessel.z + Math.cos(bearing) * distance;
    // Broadside to the viewer looks best: the whale runs across the line of sight.
    const heading = bearing + (random() < 0.5 ? 1 : -1) * between(random, 1.1, 2);
    const runX = x - Math.sin(heading) * 30;
    const runZ = z - Math.cos(heading) * 30;
    if (world.seabedDepth(x, z) < BREACH_MIN_WATER || world.seabedDepth(runX, runZ) < BREACH_MIN_WATER) continue;
    return { x, z, heading };
  }
  return null;
}

/**
 * Advances the breach. Returns the phase it entered this step (for one-shot
 * effects), or null.
 */
export function stepBreach(
  state: BreachState,
  world: MarineWorld,
  vessel: VesselState,
  delta: number,
  random: RandomSource,
): BreachPhase | null {
  const dt = clamp(delta, 0, 0.05);
  if (dt <= 0) return null;
  state.elapsed += dt;
  const start = state.phase;

  switch (state.phase) {
    case "waiting": {
      state.countdown -= dt;
      if (state.countdown > 0) break;
      const site = planSite(world, vessel, random);
      if (!site) {
        state.countdown = between(random, 10, 20);
        break;
      }
      state.plan = chooseBreachPlan(random);
      state.exitX = site.x;
      state.exitZ = site.z;
      state.heading = site.heading;
      // Start where a steady climb over the run reaches the exit point.
      const exit = exitVelocity(state.plan);
      const runLength = (2.2 + exit.horizontal) * 0.5 * RUN_DURATION;
      state.x = site.x - Math.sin(site.heading) * runLength;
      state.z = site.z - Math.cos(site.heading) * runLength;
      state.y = -RUN_START_DEPTH;
      state.pitch = 0.15;
      state.roll = 0;
      state.phase = "run";
      state.elapsed = 0;
      break;
    }
    case "run": {
      // A powerful climb: speed builds, the path steepens toward the exit
      // angle, and the flukes beat hard.
      const exit = exitVelocity(state.plan);
      const progress = clamp(state.elapsed / RUN_DURATION, 0, 1);
      const speed = 2.2 + (exit.speed - 2.2) * smoothstep(0, 1, progress);
      const pitch = 0.15 + (state.plan.exitAngle - 0.15) * smoothstep(0.1, 0.9, progress);
      state.pitch = pitch;
      const horizontal = speed * Math.cos(pitch);
      state.vx = Math.sin(state.heading) * horizontal;
      state.vz = Math.cos(state.heading) * horizontal;
      state.vy = speed * Math.sin(pitch);
      // Depth follows the plan so the centre reaches the surface as the run ends.
      const targetY = -RUN_START_DEPTH * (1 - smoothstep(0, 1, progress));
      state.y += state.vy * dt;
      state.y += (targetY - state.y) * (1 - Math.exp(-3 * dt));
      state.x += state.vx * dt;
      state.z += state.vz * dt;
      state.stroke = 1;
      if (state.y >= world.surfaceHeight(state.x, state.z) - 0.05 || progress >= 1) {
        // Leave the water exactly on the planned arc.
        state.vy = exit.vertical;
        state.vx = Math.sin(state.heading) * exit.horizontal;
        state.vz = Math.cos(state.heading) * exit.horizontal;
        state.phase = "air";
        state.elapsed = 0;
        state.count += 1;
      }
      break;
    }
    case "air": {
      state.vy -= BREACH_GRAVITY * dt;
      state.x += state.vx * dt;
      state.y += state.vy * dt;
      state.z += state.vz * dt;
      // The body turns toward the path, but lags it: it hangs nose-high at the
      // top and falls back, rolling over as it goes.
      const flight = (2 * exitVelocity(state.plan).vertical) / BREACH_GRAVITY;
      const progress = clamp(state.elapsed / flight, 0, 1);
      const path = Math.atan2(state.vy, Math.hypot(state.vx, state.vz));
      const lagged = state.plan.exitAngle + (path - state.plan.exitAngle) * 0.55;
      state.pitch += (lagged - state.pitch) * (1 - Math.exp(-4 * dt));
      state.roll = state.plan.roll * smoothstep(0.05, 0.95, progress);
      state.stroke *= Math.exp(-3 * dt);
      if (state.vy < 0 && state.y <= world.surfaceHeight(state.x, state.z)) {
        state.phase = "splash";
        state.elapsed = 0;
      }
      break;
    }
    case "splash": {
      // The water stops eighty tonnes within a body length.
      const drag = Math.exp(-2.6 * dt);
      state.vx *= drag;
      state.vz *= drag;
      state.vy = state.vy * drag - 0.4 * dt;
      state.x += state.vx * dt;
      state.y += state.vy * dt;
      state.z += state.vz * dt;
      state.pitch += (-0.25 - state.pitch) * (1 - Math.exp(-1.5 * dt));
      if (state.elapsed > 1.6) {
        state.phase = "dive";
        state.elapsed = 0;
      }
      break;
    }
    case "dive": {
      // Righting itself and swimming down out of sight.
      state.roll *= Math.exp(-0.6 * dt);
      state.pitch += (-0.3 - state.pitch) * (1 - Math.exp(-1 * dt));
      const speed = 1.8;
      state.vx = Math.sin(state.heading) * speed * Math.cos(state.pitch);
      state.vz = Math.cos(state.heading) * speed * Math.cos(state.pitch);
      state.vy = speed * Math.sin(state.pitch);
      state.x += state.vx * dt;
      state.y += state.vy * dt;
      state.z += state.vz * dt;
      state.stroke += (0.6 - state.stroke) * (1 - Math.exp(-dt));
      if (state.elapsed > DIVE_DURATION) {
        state.phase = "waiting";
        state.elapsed = 0;
        state.y = -40;
        state.countdown = between(random, BREACH_MIN_INTERVAL, BREACH_MAX_INTERVAL);
      }
      break;
    }
  }
  const strokeFrequency = state.phase === "run" ? 0.55 : 0.22;
  state.strokePhase += Math.PI * 2 * strokeFrequency * dt;
  return state.phase !== start ? state.phase : null;
}

/** Whether the breaching whale is anywhere it could be seen. */
export function breachVisible(state: BreachState): boolean {
  return state.phase !== "waiting";
}
