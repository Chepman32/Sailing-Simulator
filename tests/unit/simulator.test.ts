import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { deriveTimeOfDay } from "../../src/simulator/environment/EnvironmentMath";
import { sampleOcean } from "../../src/simulator/environment/OceanMath";
import { applyEnginePower, createSimulatorState } from "../../src/simulator/state";
import { VesselPhysics, type IslandPhysics, type OceanSampler } from "../../src/simulator/vessel/VesselPhysics";
import {
  canStartBreach,
  nextDolphinState,
  nextWhalePhase,
  type DolphinState,
  type WhalePhase,
} from "../../src/simulator/wildlife/WildlifeState";

test("GPU wave companion sampler stays finite over a wide world range", () => {
  for (let x = -1200; x <= 1200; x += 97) {
    for (let z = -1200; z <= 1200; z += 113) {
      const sample = sampleOcean(x, z, 123.45);
      assert.ok(Number.isFinite(sample.height));
      assert.ok(Number.isFinite(sample.normalX + sample.normalY + sample.normalZ));
      assert.ok(sample.normalY > 0.8 && sample.normalY <= 1);
    }
  }
});

test("day and night derive from one bounded environment state", () => {
  const day = deriveTimeOfDay(0);
  const night = deriveTimeOfDay(1);
  assert.equal(day.starVisibility, 0);
  assert.equal(night.starVisibility, 1);
  assert.ok(day.sunElevation > 0);
  assert.ok(night.sunElevation < 0);
  assert.ok(Math.abs(night.moonElevation - Math.PI / 6) < 1e-12);
  assert.ok(day.exposure > night.exposure);
});

test("engine starts stopped and stopping always returns the throttle to neutral", () => {
  const state = createSimulatorState();
  assert.equal(state.engineRunning, false);
  applyEnginePower(state, true);
  state.controls.throttle = 0.72;
  applyEnginePower(state, false);
  assert.equal(state.engineRunning, false);
  assert.equal(state.controls.throttle, 0);
});

test("dolphin breach state machine always returns to swim and is speed gated", () => {
  const visited: DolphinState[] = [];
  let state: DolphinState = "swim";
  for (let index = 0; index < 7; index += 1) {
    state = nextDolphinState(state);
    visited.push(state);
  }
  assert.deepEqual(visited, ["approach", "breach_ascent", "airborne", "reentry", "splash", "dive", "swim"]);
  assert.equal(canStartBreach(6.19, 0), false);
  assert.equal(canStartBreach(7.2, 0.01), false);
  assert.equal(canStartBreach(7.2, 0), true);
});

test("whale state machine always completes its surface and dive cycle", () => {
  const visited: WhalePhase[] = [];
  let phase: WhalePhase = "cruise";
  for (let index = 0; index < 3; index += 1) {
    phase = nextWhalePhase(phase);
    visited.push(phase);
  }
  assert.deepEqual(visited, ["surface", "dive", "cruise"]);
});

test("force-based vessel remains finite and is stable across integration rates", () => {
  const ocean: OceanSampler = { sample: () => ({ height: 0, normalX: 0, normalY: 1, normalZ: 0 }) };
  const islands: IslandPhysics = {
    depthAt: () => 18,
    avoidanceForce: (_position, _velocity, target) => target.set(0, 0, 0),
    constrainToWater: () => false,
    nearestShoreDirection: (_position, target) => target.set(0, 0, 1),
  };
  const run = (delta: number) => {
    const physics = new VesselPhysics(ocean, islands);
    const controls = { throttle: 0.74, rudder: 0.16, sailTrim: 0.72 };
    for (let elapsed = 0; elapsed < 12; elapsed += delta) physics.fixedUpdate(delta, controls);
    return physics;
  };
  const sixty = run(1 / 60);
  const oneTwenty = run(1 / 120);
  assert.ok(Number.isFinite(sixty.position.length() + sixty.heading + sixty.roll));
  assert.ok(sixty.position.distanceTo(oneTwenty.position) < 1.2);
  assert.ok(Math.abs(sixty.heading - oneTwenty.heading) < 0.12);
  assert.ok(sixty.telemetry.speedKnots > 1);
  assert.ok(sixty.position instanceof THREE.Vector3);
});

test("buoyancy settles on the waterline and follows the sampled surface plane", () => {
  const islands: IslandPhysics = {
    depthAt: () => 18,
    avoidanceForce: (_position, _velocity, target) => target.set(0, 0, 0),
    constrainToWater: () => false,
    nearestShoreDirection: (_position, target) => target.set(0, 0, 1),
  };
  const controls = { throttle: 0, rudder: 0, sailTrim: 0.2 };
  const run = (ocean: OceanSampler) => {
    const physics = new VesselPhysics(ocean, islands);
    for (let index = 0; index < 300; index += 1) physics.fixedUpdate(1 / 60, controls);
    return physics;
  };

  const flat = run({ sample: () => ({ height: 0, normalX: 0, normalY: 1, normalZ: 0 }) });
  const bowHigh = run({ sample: (_x, z) => ({ height: z * 0.035, normalX: 0, normalY: 1, normalZ: 0 }) });
  const portHigh = run({ sample: (x) => ({ height: x * -0.06, normalX: 0, normalY: 1, normalZ: 0 }) });

  assert.ok(Math.abs(flat.position.y - 0.46) < 0.04);
  assert.ok(bowHigh.pitch < -0.02, "a higher bow surface should rotate the +Z bow upward");
  assert.ok(portHigh.roll > 0.025, "a higher port surface should rotate the port hull upward");
});
