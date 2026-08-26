import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { deriveTimeOfDay } from "../../src/simulator/environment/EnvironmentMath";
import { sampleOcean } from "../../src/simulator/environment/OceanMath";
import {
  applyEnginePower,
  createSimulatorState,
  ENGINE_START_THROTTLE,
} from "../../src/simulator/state";
import { VesselPhysics, type IslandPhysics, type OceanSampler } from "../../src/simulator/vessel/VesselPhysics";
import { MAX_PROPELLER_RPM, propellerRpmForThrottle } from "../../src/simulator/vessel/Vessel";
import { calculateSplashProfile, calculateWakeEmission } from "../../src/simulator/vessel/WakeSystem";
import {
  forwardBiasedHeading,
  shortestAngleDifference,
  stepSwimmerKinematics,
  stepVerticalMotion,
  swimmerBank,
  swimmerPitch,
  type SwimmerKinematics,
  type SwimmerLimits,
} from "../../src/simulator/wildlife/SwimmerDynamics";
import {
  WHALE_MAX_BOAT_DISTANCE,
  WHALE_MIN_BOAT_DISTANCE,
  WHALE_SUBMERGED_FADE_START,
  WHALE_SURFACE_REVEAL_CLEARANCE,
  WHALE_TAIL_IMPACT_ARM_CLEARANCE,
  WHALE_TAIL_SPLASH_INTENSITY,
  canStartBreach,
  didWhaleFlukeStrike,
  isWhaleWithinBoatRange,
  nextDolphinState,
  nextWhalePhase,
  whaleOrbitHeading,
  whaleSpawnDistance,
  whaleSurfaceVisibility,
  whaleTailSlapPose,
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
  assert.ok(night.exposure >= 0.8, "night exposure should preserve readable moonlit detail");
});

test("engine start engages slow ahead and stopping returns the throttle to neutral", () => {
  const state = createSimulatorState();
  state.engineMuted = true;
  assert.equal(state.engineRunning, false);
  assert.equal(state.controls.throttle, 0);
  applyEnginePower(state, true);
  assert.equal(state.engineRunning, true);
  assert.equal(state.engineMuted, false, "an explicit engine start must clear a stale saved engine mute");
  assert.equal(state.controls.throttle, ENGINE_START_THROTTLE);
  state.controls.throttle = 0.72;
  applyEnginePower(state, true);
  assert.equal(state.controls.throttle, 0.72, "starting an already-running engine must preserve manual throttle");
  applyEnginePower(state, false);
  assert.equal(state.engineRunning, false);
  assert.equal(state.controls.throttle, 0);
});

test("propellers spin visibly at slow ahead and reach 600 RPM at full throttle", () => {
  assert.equal(propellerRpmForThrottle(0), 0);
  assert.ok(propellerRpmForThrottle(ENGINE_START_THROTTLE) >= 250);
  assert.equal(propellerRpmForThrottle(1), MAX_PROPELLER_RPM);
  assert.equal(propellerRpmForThrottle(-1), -MAX_PROPELLER_RPM);
  assert.ok(propellerRpmForThrottle(0.5) < MAX_PROPELLER_RPM);
});

test("wake remains visible at slow-ahead speeds and scales monotonically", () => {
  const stopped = calculateWakeEmission(0, 0, 0);
  const propAtRest = calculateWakeEmission(0, ENGINE_START_THROTTLE, 0);
  const slow = calculateWakeEmission(0.08, ENGINE_START_THROTTLE, 0);
  const cruise = calculateWakeEmission(4, 0.65, 0.2);
  const reverse = calculateWakeEmission(-0.08, -ENGINE_START_THROTTLE, 0);
  assert.deepEqual(stopped, { emitHull: false, emitProp: false, hullStrength: 0, propStrength: 0 });
  assert.equal(propAtRest.emitHull, false);
  assert.equal(propAtRest.emitProp, true, "a turning propeller must create immediate wash before the boat moves");
  assert.equal(slow.emitHull, true);
  assert.equal(slow.emitProp, true);
  assert.ok(slow.hullStrength >= 0.48 && slow.propStrength >= 0.52);
  assert.ok(cruise.hullStrength > slow.hullStrength);
  assert.ok(cruise.propStrength > slow.propStrength);
  assert.deepEqual(reverse, slow);
  assert.ok(cruise.hullStrength <= 1 && cruise.propStrength <= 1);
});

test("engaging the engine from neutral produces forward motion", () => {
  const ocean: OceanSampler = { sample: () => ({ height: 0, normalX: 0, normalY: 1, normalZ: 0 }) };
  const islands: IslandPhysics = {
    depthAt: () => 18,
    avoidanceForce: (_position, _velocity, target) => target.set(0, 0, 0),
    constrainToWater: () => false,
    nearestShoreDirection: (_position, target) => target.set(0, 0, 1),
  };
  const physics = new VesselPhysics(ocean, islands);
  physics.heading = Math.atan2(6.8, 4.2);
  const state = createSimulatorState();
  applyEnginePower(state, true);
  for (let index = 0; index < 60; index += 1) physics.fixedUpdate(1 / 60, state.controls);
  assert.ok(physics.telemetry.forwardSpeed > 1, "slow-ahead propeller thrust should move the vessel within one second");
  assert.ok(physics.telemetry.speedKnots > 1.9);
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

test("swimmer dynamics keep motion forward with bounded acceleration and turn inertia", () => {
  const limits: SwimmerLimits = {
    minSpeed: 1.8,
    maxSpeed: 3.6,
    acceleration: 0.42,
    deceleration: 0.58,
    maxTurnRate: 0.24,
    maxYawAcceleration: 0.16,
    turnResponse: 0.62,
  };
  const state: SwimmerKinematics = {
    heading: 0,
    yawRate: 0,
    speed: 2.4,
    velocityX: 0,
    velocityZ: 2.4,
    verticalSpeed: 0,
  };
  const delta = 1 / 60;
  let previousHeading = state.heading;
  let previousYawRate = state.yawRate;
  let previousSpeed = state.speed;
  for (let index = 0; index < 1200; index += 1) {
    stepSwimmerKinematics(state, Math.PI, 3.2, delta, limits);
    assert.ok(Math.abs(shortestAngleDifference(previousHeading, state.heading)) <= limits.maxTurnRate * delta + 1e-9);
    assert.ok(Math.abs(state.yawRate - previousYawRate) <= limits.maxYawAcceleration * delta + 1e-9);
    assert.ok(state.speed - previousSpeed <= limits.acceleration * delta + 1e-9);
    const forwardDot = Math.sin(state.heading) * state.velocityX + Math.cos(state.heading) * state.velocityZ;
    assert.ok(forwardDot > 0, "a swimmer must never translate tail-first");
    assert.ok(Math.abs(Math.hypot(state.velocityX, state.velocityZ) - state.speed) < 1e-9);
    previousHeading = state.heading;
    previousYawRate = state.yawRate;
    previousSpeed = state.speed;
  }
  assert.ok(Math.abs(shortestAngleDifference(state.heading, Math.PI)) < 0.03);
});

test("wildlife course, depth, pitch, and bank helpers reject abrupt or inverted motion", () => {
  assert.ok(Math.abs(forwardBiasedHeading(0, Math.PI, 0.35) - 0.35) < 1e-12);
  const state: SwimmerKinematics = {
    heading: 0,
    yawRate: 0,
    speed: 6.5,
    velocityX: 0,
    velocityZ: 6.5,
    verticalSpeed: 0,
  };
  let y = 0;
  y = stepVerticalMotion(y, state, -1.5, 1 / 60, 7.2, 5.1, 4.8);
  assert.ok(y < 0 && y > -0.01, "depth changes must start with acceleration rather than a teleport");
  for (let index = 0; index < 240; index += 1) {
    y = stepVerticalMotion(y, state, -1.5, 1 / 60, 7.2, 5.1, 4.8);
  }
  assert.ok(Math.abs(y + 1.5) < 0.03);
  assert.ok(Math.abs(swimmerPitch(20, 1, 0.18)) <= 0.18);
  assert.ok(Math.abs(swimmerBank(4, 8, 0.14)) <= 0.14);
});

test("whale state machine completes one submerged tail-slap cycle", () => {
  const visited: WhalePhase[] = [];
  let phase: WhalePhase = "cruise";
  for (let index = 0; index < 4; index += 1) {
    phase = nextWhalePhase(phase);
    visited.push(phase);
  }
  assert.deepEqual(visited, ["tail_rise", "tail_strike", "dive", "cruise"]);

  const raised = whaleTailSlapPose("tail_rise", 1);
  const impact = whaleTailSlapPose("tail_strike", 0.35);
  assert.ok(raised.bodyDepth <= -6, "the whale's body must remain deeply below the waterline");
  assert.ok(raised.tailFlex >= 0.75, "only the articulated tail should rise above the surface");
  assert.equal(impact.impact, true);
  assert.ok(Math.abs(impact.bodyPitch) < 0.1, "the full whale must never stand vertically");
});

test("the translucent ocean cannot reveal a submerged whale body", () => {
  assert.equal(whaleSurfaceVisibility(WHALE_SUBMERGED_FADE_START - 0.01), 0);
  assert.equal(whaleSurfaceVisibility(WHALE_SURFACE_REVEAL_CLEARANCE + 0.01), 1);
  const edgeVisibility = whaleSurfaceVisibility((WHALE_SUBMERGED_FADE_START + WHALE_SURFACE_REVEAL_CLEARANCE) / 2);
  assert.ok(edgeVisibility > 0 && edgeVisibility < 1, "the waterline transition must stay soft");
});

test("whale splash fires only when an armed fluke crosses down through the surface", () => {
  assert.ok(WHALE_TAIL_IMPACT_ARM_CLEARANCE >= 0.15);
  assert.equal(didWhaleFlukeStrike("tail_strike", true, 0.42, -0.03), true);
  assert.equal(didWhaleFlukeStrike("tail_rise", true, 0.42, -0.03), false);
  assert.equal(didWhaleFlukeStrike("tail_strike", false, 0.42, -0.03), false);
  assert.equal(didWhaleFlukeStrike("tail_strike", true, -0.02, -0.1), false);
});

test("the single whale remains in a 50–100 meter viewing band around the yacht", () => {
  assert.equal(isWhaleWithinBoatRange(WHALE_MIN_BOAT_DISTANCE), true);
  assert.equal(isWhaleWithinBoatRange(WHALE_MAX_BOAT_DISTANCE), true);
  assert.equal(isWhaleWithinBoatRange(WHALE_MIN_BOAT_DISTANCE - 0.01), false);
  assert.equal(isWhaleWithinBoatRange(WHALE_MAX_BOAT_DISTANCE + 0.01), false);
  assert.ok(isWhaleWithinBoatRange(whaleSpawnDistance(0)));
  assert.ok(isWhaleWithinBoatRange(whaleSpawnDistance(1)));

  const nearHeading = whaleOrbitHeading(0, 45, 1, 76);
  const farHeading = whaleOrbitHeading(0, 106, 1, 76);
  assert.ok(Math.cos(nearHeading) > 0, "a close whale must steer away from the yacht");
  assert.ok(Math.cos(farHeading) < 0, "a distant whale must steer back toward the yacht");
});

test("whale tail slap creates substantially more foam and particles than a dolphin splash", () => {
  const dolphin = calculateSplashProfile(0.8);
  const whale = calculateSplashProfile(WHALE_TAIL_SPLASH_INTENSITY);
  assert.ok(whale.dropletCount >= dolphin.dropletCount * 3.5);
  assert.ok(whale.ringCount >= 7);
  assert.ok(whale.foamPatchCount >= 9);
  assert.ok(whale.radius >= 14);
  assert.ok(whale.particleSize >= 0.65);
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
