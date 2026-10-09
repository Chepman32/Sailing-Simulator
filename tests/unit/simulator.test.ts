import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { deriveTimeOfDay } from "../../src/simulator/environment/EnvironmentMath";
import { deriveEnvironmentPalette } from "../../src/simulator/environment/EnvironmentPalette";
import {
  ISLAND_DEFINITIONS,
  distanceFromBeach,
  distanceFromWaterline,
  shoreClearance,
  waterDepthAt,
} from "../../src/simulator/environment/IslandMath";
import { HULL_OUTLINE, SHORE_CUSHION } from "../../src/simulator/vessel/ShoreContact";
import { createOceanGrid } from "../../src/simulator/environment/OceanGrid";
import {
  OCEAN_DETAIL_WAVES,
  OCEAN_WAVES,
  maximumOceanSlope,
  sampleOcean,
} from "../../src/simulator/environment/OceanMath";
import {
  MAX_GUST_FACTOR,
  MAX_WIND_SHIFT,
  MEAN_WIND_HEADING,
  MEAN_WIND_SPEED,
  MIN_GUST_FACTOR,
  sampleWind,
} from "../../src/simulator/environment/WindMath";
import { QUALITY_SETTINGS } from "../../src/simulator/core/QualityManager";
import {
  MAX_SHEET_ANGLE,
  MIN_SHEET_ANGLE,
  createSailState,
  sailCoefficients,
  solveSail,
} from "../../src/simulator/vessel/SailAerodynamics";
import {
  applyEnginePower,
  createSimulatorState,
  ENGINE_START_THROTTLE,
} from "../../src/simulator/state";
import {
  VesselPhysics,
  propellerThrust,
  shaftTargetForThrottle,
  type IslandPhysics,
  type OceanSampler,
} from "../../src/simulator/vessel/VesselPhysics";
import { MAX_PROPELLER_RPM, propellerRpmForThrottle } from "../../src/simulator/vessel/Vessel";
import {
  BOW_SPRAY_MIN_SPEED,
  bowSprayRate,
  calculateWakeEmission,
} from "../../src/simulator/vessel/WakeSystem";
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
    shoreClearance: () => 1000,
  };
  const physics = new VesselPhysics(ocean, islands);
  physics.heading = Math.atan2(6.8, 4.2);
  const state = createSimulatorState();
  applyEnginePower(state, true);
  for (let index = 0; index < 60; index += 1) physics.fixedUpdate(1 / 60, state.controls);
  const afterOneSecond = physics.telemetry.forwardSpeed;
  assert.ok(afterOneSecond > 0.2, "slow ahead must gather visible way within one second");
  assert.ok(afterOneSecond < 1.6, "six tonnes of yacht cannot leap to cruising speed in one second");
  for (let index = 0; index < 180; index += 1) physics.fixedUpdate(1 / 60, state.controls);
  assert.ok(physics.telemetry.forwardSpeed > 1, "slow ahead should reach a metre per second within four seconds");
  assert.ok(physics.telemetry.speedKnots > 1.9);
  assert.ok(physics.telemetry.forwardSpeed > afterOneSecond);
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

test("force-based vessel remains finite and is stable across integration rates", () => {
  const ocean: OceanSampler = { sample: () => ({ height: 0, normalX: 0, normalY: 1, normalZ: 0 }) };
  const islands: IslandPhysics = {
    depthAt: () => 18,
    avoidanceForce: (_position, _velocity, target) => target.set(0, 0, 0),
    constrainToWater: () => false,
    nearestShoreDirection: (_position, target) => target.set(0, 0, 1),
    shoreClearance: () => 1000,
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
    shoreClearance: () => 1000,
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
  // Sail and windage load trim the yacht slightly even on calm water, so the
  // surface-following part is measured against that calm-water attitude.
  assert.ok(bowHigh.pitch - flat.pitch < -0.02, "a higher bow surface should rotate the +Z bow upward");
  assert.ok(portHigh.roll - flat.roll > 0.025, "a higher port surface should rotate the port hull upward");
});

const CALM: OceanSampler = { sample: () => ({ height: 0, normalX: 0, normalY: 1, normalZ: 0 }) };
const OPEN_WATER: IslandPhysics = {
  depthAt: () => 18,
  avoidanceForce: (_position, _velocity, target) => target.set(0, 0, 0),
  constrainToWater: () => false,
  nearestShoreDirection: (_position, target) => target.set(0, 0, 1),
  shoreClearance: () => 1000,
};

/** Heading that puts the mean true wind `degrees` off the starboard bow. */
function headingForTrueWindAngle(degrees: number): number {
  return MEAN_WIND_HEADING + Math.PI - THREE.MathUtils.degToRad(degrees);
}

/** Sail a held course for `seconds` with a simple proportional helm. */
function sailCourse(trueWindAngle: number, seconds: number, trim = 1): VesselPhysics {
  const physics = new VesselPhysics(CALM, OPEN_WATER);
  const course = headingForTrueWindAngle(trueWindAngle);
  physics.heading = course;
  const controls = { throttle: 0, rudder: 0, sailTrim: trim };
  for (let step = 0; step < seconds * 60; step += 1) {
    const error = Math.atan2(Math.sin(course - physics.heading), Math.cos(course - physics.heading));
    controls.rudder = THREE.MathUtils.clamp(error * 2.5 - physics.yawRate * 2.2, -1, 1);
    physics.fixedUpdate(1 / 60, controls);
  }
  return physics;
}

test("shared wave spectrum stays gentle enough for stable physics and a resolvable mesh", () => {
  assert.ok(maximumOceanSlope() < 0.5, "summed slope must keep sampled normals well above the 0.8 limit");
  for (const wave of OCEAN_WAVES) {
    assert.ok(wave.wavelength >= 5, "displacement waves must be long enough for the focused grid");
    assert.ok(wave.steepness > 0 && wave.steepness < 0.5);
  }
  const shortestDisplaced = Math.min(...OCEAN_WAVES.map((wave) => wave.wavelength));
  for (const wave of OCEAN_DETAIL_WAVES) {
    assert.ok(wave.wavelength < shortestDisplaced, "detail waves must be shorter than every displaced wave");
    assert.ok(wave.slope > 0 && wave.slope < 0.08);
  }
});

test("focused ocean grid has a uniform, world-locked centre and grows monotonically", () => {
  for (const preset of ["low", "medium", "high"] as const) {
    const grid = createOceanGrid(QUALITY_SETTINGS[preset].oceanSegments);
    const side = Math.round(Math.sqrt(grid.positions.length / 3));
    assert.equal(side * side * 3, grid.positions.length);
    assert.equal(grid.spacing.length, side * side);
    assert.equal(grid.indices.length, (side - 1) * (side - 1) * 6);
    let previous = Number.NEGATIVE_INFINITY;
    let finest = Number.POSITIVE_INFINITY;
    for (let column = 0; column < side; column += 1) {
      const x = grid.positions[column * 3];
      assert.ok(x > previous, "grid coordinates must increase monotonically");
      if (column > 0) finest = Math.min(finest, x - previous);
      if (Math.abs(x) < grid.innerRadius - 1e-3) {
        const centreRow = (side - 1) / 2;
        assert.ok(
          Math.abs(grid.spacing[centreRow * side + column] - grid.cellSize) < 1e-3,
          "the centre must be a uniform lattice",
        );
      }
      previous = x;
    }
    assert.ok(Math.abs(finest - grid.cellSize) < 1e-3);
    assert.ok(Math.abs(grid.positions[0] + 900) < 1e-2 && Math.abs(previous - 900) < 1e-2);
    assert.ok(grid.innerRadius >= 40, "the dense lattice must cover the yacht, its wake and nearby wildlife");
    assert.ok(grid.cellSize <= Math.max(...OCEAN_WAVES.map((wave) => wave.wavelength)) / 8);
    // The top face must be the front face: counter-clockwise seen from +Y.
    const [a, b, c] = [grid.indices[0], grid.indices[1], grid.indices[2]].map((vertex) => [
      grid.positions[vertex * 3],
      grid.positions[vertex * 3 + 2],
    ]);
    const normalY = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    assert.ok(normalY > 0, "ocean triangles must face upward");
  }
});

test("true wind gusts and shifts stay bounded and deterministic", () => {
  const sample = { x: 0, z: 0, speed: 0, gust: 1 };
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let time = 0; time < 1800; time += 0.5) {
    sampleWind(time, sample);
    assert.ok(sample.gust >= MIN_GUST_FACTOR && sample.gust <= MAX_GUST_FACTOR);
    assert.ok(Math.abs(Math.hypot(sample.x, sample.z) - sample.speed) < 1e-9);
    const shift = Math.atan2(sample.x, sample.z) - MEAN_WIND_HEADING;
    assert.ok(Math.abs(shift) <= MAX_WIND_SHIFT + 1e-9);
    minimum = Math.min(minimum, sample.speed);
    maximum = Math.max(maximum, sample.speed);
  }
  assert.ok(maximum - minimum > MEAN_WIND_SPEED * 0.2, "the breeze must audibly and visibly vary");
  const first = sampleWind(123.4, { x: 0, z: 0, speed: 0, gust: 1 });
  const second = sampleWind(123.4, { x: 0, z: 0, speed: 0, gust: 1 });
  assert.deepEqual(first, second);
});

test("sail polar luffs head to wind, lifts when reaching, and drags when running", () => {
  const coefficients = { lift: 0, drag: 0 };
  assert.equal(sailCoefficients(0, coefficients).lift, 0);
  const attached = { ...sailCoefficients(0.28, coefficients) };
  const stalled = { ...sailCoefficients(1.2, coefficients) };
  const square = { ...sailCoefficients(Math.PI / 2, coefficients) };
  assert.ok(attached.lift > 1.2 && attached.lift / attached.drag > 4, "an attached sail is an efficient wing");
  assert.ok(stalled.lift < attached.lift && stalled.drag > attached.drag);
  assert.ok(square.lift < 0.05 && square.drag > 1.1, "square to the wind a sail is a drag device");

  const sail = createSailState();
  solveSail(0, 10, 1, sail);
  assert.equal(sail.lift, 0);
  assert.equal(sail.luff, 1);
  assert.equal(sail.sheetAngle, MIN_SHEET_ANGLE);

  const reach = { ...solveSail(Math.PI / 2, 10, 1, sail) };
  assert.equal(reach.luff, 0);
  assert.ok(reach.lift > reach.drag * 3);
  assert.ok(reach.sheetAngle > MIN_SHEET_ANGLE && reach.sheetAngle < MAX_SHEET_ANGLE);

  const run = { ...solveSail(Math.PI, 10, 1, sail) };
  assert.equal(run.sheetAngle, MAX_SHEET_ANGLE);
  assert.ok(run.drag > run.lift * 3);

  const eased = { ...solveSail(Math.PI / 2, 10, 0.2, sail) };
  assert.ok(eased.lift < reach.lift * 0.5, "easing the sheets must depower the sail");
  const gust = { ...solveSail(Math.PI / 2, 20, 1, sail) };
  assert.ok(Math.abs(gust.lift / reach.lift - 4) < 1e-9, "sail force follows wind speed squared");
});

test("propellers spool with shaft speed squared and lose thrust as the hull catches up", () => {
  assert.equal(shaftTargetForThrottle(0), 0);
  assert.ok(shaftTargetForThrottle(ENGINE_START_THROTTLE) > 0.3);
  assert.equal(shaftTargetForThrottle(1), 1);
  assert.equal(shaftTargetForThrottle(-1), -1);
  assert.equal(propellerThrust(0, 3), 0);
  const bollard = propellerThrust(1, 0);
  assert.ok(bollard > 4000 && bollard < 12000, "twin auxiliaries produce kilonewtons, not tens of them");
  assert.ok(Math.abs(propellerThrust(0.5, 0) / bollard - 0.25) < 1e-9);
  assert.ok(propellerThrust(1, 4) < bollard);
  assert.ok(propellerThrust(-1, 0) < 0 && -propellerThrust(-1, 0) < bollard, "astern thrust is weaker than ahead");
});

test("the yacht cannot sail into the wind, reaches fastest, and heels to leeward", () => {
  const inIrons = sailCourse(0, 60);
  const closeHauled = sailCourse(50, 90);
  const beamReach = sailCourse(90, 90);
  const running = sailCourse(180, 90);
  assert.ok(inIrons.telemetry.speedKnots < 2, "head to wind the sails only flog");
  assert.ok(closeHauled.telemetry.speedKnots > 4, "fifty degrees off the wind is a workable close-hauled course");
  assert.ok(beamReach.telemetry.speedKnots > closeHauled.telemetry.speedKnots);
  assert.ok(beamReach.telemetry.speedKnots > running.telemetry.speedKnots, "reaching is faster than running");
  assert.ok(beamReach.telemetry.speedKnots > 6 && beamReach.telemetry.speedKnots < 12, "a believable cruising speed");
  assert.ok(running.telemetry.speedKnots > 3);
  // Wind over the starboard side pushes the rig to port: a negative roll.
  assert.equal(beamReach.telemetry.leewardSide, -1);
  assert.ok(beamReach.roll < -0.01 && beamReach.roll > -0.2, "a catamaran heels a few degrees to leeward");
  assert.ok(beamReach.telemetry.leeway < 0, "the yacht makes leeway away from the wind");
  assert.ok(Math.abs(beamReach.telemetry.leeway) < 0.5, "the keels must hold the yacht on her course");
  assert.ok(Math.abs(closeHauled.telemetry.apparentWindAngle) < Math.PI / 2, "apparent wind draws ahead upwind");

  const eased = sailCourse(90, 90, 0.2);
  assert.ok(eased.telemetry.speedKnots < beamReach.telemetry.speedKnots * 0.6, "easing sheets slows the yacht");
});

test("engines give a realistic top speed, steerage from prop wash, and correct helm sense", () => {
  const motor = new VesselPhysics(CALM, OPEN_WATER);
  motor.heading = MEAN_WIND_HEADING;
  const controls = { throttle: 1, rudder: 0, sailTrim: 0.2 };
  for (let step = 0; step < 40 * 60; step += 1) motor.fixedUpdate(1 / 60, controls);
  assert.ok(motor.engineShaft === 1);
  assert.ok(motor.telemetry.speedKnots > 6 && motor.telemetry.speedKnots < 14, "an auxiliary-powered cruising speed");

  const headingBefore = motor.heading;
  controls.rudder = 1;
  for (let step = 0; step < 5 * 60; step += 1) motor.fixedUpdate(1 / 60, controls);
  assert.ok(motor.heading > headingBefore + 0.3, "starboard helm turns the bow to starboard");
  assert.ok(motor.yawRate < 0.5, "a nine-metre catamaran does not spin on the spot");

  const stopped = new VesselPhysics(CALM, OPEN_WATER);
  stopped.heading = MEAN_WIND_HEADING;
  const kick = { throttle: 0.5, rudder: 1, sailTrim: 0.2 };
  for (let step = 0; step < 90; step += 1) stopped.fixedUpdate(1 / 60, kick);
  assert.ok(stopped.yawRate > 0.01, "prop wash over the rudders must turn a yacht that has barely gathered way");

  const coasting = new VesselPhysics(CALM, OPEN_WATER);
  coasting.heading = MEAN_WIND_HEADING;
  const ahead = { throttle: 1, rudder: 0, sailTrim: 0.2 };
  for (let step = 0; step < 120; step += 1) coasting.fixedUpdate(1 / 60, ahead);
  ahead.throttle = 0;
  coasting.fixedUpdate(1 / 60, ahead);
  assert.ok(coasting.engineShaft > 0.8, "the shafts must spool down, not stop instantly");
});

test("shoal water adds drag without stopping the yacht", () => {
  const shoal: IslandPhysics = { ...OPEN_WATER, depthAt: () => 1.2 };
  const run = (islands: IslandPhysics) => {
    const physics = new VesselPhysics(CALM, islands);
    physics.heading = MEAN_WIND_HEADING;
    const controls = { throttle: 1, rudder: 0, sailTrim: 0.2 };
    for (let step = 0; step < 20 * 60; step += 1) physics.fixedUpdate(1 / 60, controls);
    return physics;
  };
  const deep = run(OPEN_WATER);
  const shallow = run(shoal);
  assert.equal(deep.telemetry.grounding, 0);
  assert.equal(shallow.telemetry.grounding, 1);
  assert.ok(shallow.telemetry.speedKnots < deep.telemetry.speedKnots, "shallow water must cost speed");
  assert.ok(shallow.telemetry.speedKnots > deep.telemetry.speedKnots * 0.4, "but never pin her in place");
});

test("driven onto a beach the yacht rebounds and turns away instead of sticking", () => {
  const coast: IslandPhysics = {
    depthAt: waterDepthAt,
    avoidanceForce: (_position, _velocity, target) => target.set(0, 0, 0),
    constrainToWater: () => false,
    nearestShoreDirection: (_position, target) => target.set(0, 0, 1),
    shoreClearance,
  };
  const island = ISLAND_DEFINITIONS[0];
  const normal = { x: 0, z: 1 };
  for (const approach of [0, 25, 55]) {
    for (const bearing of [0, 1.3, 2.6, 4.2]) {
      const physics = new VesselPhysics(CALM, coast);
      // Start 30 m off the coast on this bearing, aimed at the island centre.
      let radius = island.beachRadius * 1.3;
      const x = (r: number) => island.centerX + Math.cos(bearing) * r;
      const z = (r: number) => island.centerZ + Math.sin(bearing) * r * island.scaleZ;
      while (shoreClearance(x(radius), z(radius), normal) > 30) radius -= 0.5;
      physics.position.set(x(radius), physics.position.y, z(radius));
      physics.heading = Math.atan2(island.centerX - x(radius), island.centerZ - z(radius)) + THREE.MathUtils.degToRad(approach);
      const controls = { throttle: 1, rudder: 0, sailTrim: 0.2 };
      let worst = Infinity;
      let impacts = 0;
      for (let step = 0; step < 40 * 60; step += 1) {
        physics.fixedUpdate(1 / 60, controls);
        if (physics.telemetry.shoreImpact > 0) impacts += 1;
        for (const [side, ahead] of HULL_OUTLINE) {
          const px = physics.position.x + physics.right.x * side + physics.forward.x * ahead;
          const pz = physics.position.z + physics.right.z * side + physics.forward.z * ahead;
          worst = Math.min(worst, shoreClearance(px, pz, normal));
        }
      }
      const label = `bearing ${bearing}, approach ${approach} deg`;
      assert.ok(impacts > 0 || worst < SHORE_CUSHION, `${label}: the yacht should reach the beach`);
      assert.ok(worst > 0.3, `${label}: a hull ran ${(-worst).toFixed(2)} m up the sand`);
      // Afterwards she sails clear: off the beach and not driving back into it.
      const clearance = shoreClearance(physics.position.x, physics.position.z, normal);
      const intoShore = -(physics.velocity.x * normal.x + physics.velocity.z * normal.z);
      assert.ok(clearance > 5, `${label}: still on the beach (${clearance.toFixed(1)} m)`);
      assert.ok(clearance > 25 || intoShore < 0.5, `${label}: still driving into the beach`);
      assert.ok(physics.telemetry.speedKnots > 1.5, `${label}: she must keep sailing, not sit on the beach (${physics.telemetry.speedKnots.toFixed(2)} kn)`);
      assert.ok(Number.isFinite(physics.position.length() + physics.heading));
    }
  }
});

test("the yacht stays finite and upright through a long passage in the shared seaway", () => {
  let time = 0;
  const physics = new VesselPhysics({ sample: (x, z) => sampleOcean(x, z, time) }, OPEN_WATER);
  const controls = { throttle: 0.8, rudder: 0, sailTrim: 1 };
  let maximumRoll = 0;
  let maximumPitch = 0;
  let maximumGap = 0;
  for (let step = 0; step < 240 * 60; step += 1) {
    time += 1 / 60;
    controls.rudder = Math.sin(time * 0.21) * 0.7;
    controls.throttle = Math.sin(time * 0.05) > 0 ? 0.8 : -0.4;
    physics.fixedUpdate(1 / 60, controls);
    maximumRoll = Math.max(maximumRoll, Math.abs(physics.roll));
    maximumPitch = Math.max(maximumPitch, Math.abs(physics.pitch));
    if (time > 10) {
      const water = sampleOcean(physics.position.x, physics.position.z, time).height;
      maximumGap = Math.max(maximumGap, Math.abs(physics.position.y - 0.46 - water));
    }
  }
  assert.ok(Number.isFinite(physics.position.length() + physics.heading));
  assert.ok(maximumRoll < 0.3, `roll stayed seamanlike (${maximumRoll})`);
  assert.ok(maximumPitch < 0.28, `pitch stayed seamanlike (${maximumPitch})`);
  assert.ok(maximumGap < 0.7, `the hulls must ride the rendered surface, not hang above it (${maximumGap})`);
});

test("island bathymetry shoals toward a coast the ocean shader can follow", () => {
  for (const island of ISLAND_DEFINITIONS) {
    const beachX = island.centerX + island.beachRadius;
    assert.ok(Math.abs(distanceFromBeach(island, beachX, island.centerZ)) < 1e-9);
    const atBeach = waterDepthAt(beachX, island.centerZ);
    const offshore = waterDepthAt(beachX + 12, island.centerZ);
    const openWater = waterDepthAt(beachX + 60, island.centerZ);
    assert.ok(atBeach < 0.5);
    assert.ok(offshore > atBeach + 3 && offshore < openWater);
    // The rendered, irregular waterline stays within a few metres of the
    // collision ellipse all the way round.
    for (let step = 0; step < 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      const x = island.centerX + Math.cos(angle) * island.beachRadius;
      const z = island.centerZ + Math.sin(angle) * island.beachRadius * island.scaleZ;
      assert.ok(Math.abs(distanceFromWaterline(x, z)) < island.beachRadius * 0.12);
    }
    assert.ok(distanceFromWaterline(island.centerX, island.centerZ) < 0, "the island centre is dry land");
  }
  assert.ok(distanceFromWaterline(0, 0) > 30, "the yacht starts in open water");
});

test("environment palette is finite, darker at night, and keeps the night readable", () => {
  const luminance = (color: readonly number[]) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  for (let step = 0; step <= 20; step += 1) {
    const palette = deriveEnvironmentPalette(deriveTimeOfDay(step / 20));
    for (const color of [
      palette.zenith,
      palette.horizon,
      palette.sunColor,
      palette.lightColor,
      palette.ambientColor,
      palette.cloudLit,
      palette.cloudShade,
    ]) {
      assert.ok(color.every((channel) => Number.isFinite(channel) && channel >= 0));
    }
    assert.ok(palette.cloudCover > 0.2 && palette.cloudCover < 0.7);
    assert.ok(palette.twilight >= 0 && palette.twilight <= 1);
    assert.ok(luminance(palette.cloudLit) > luminance(palette.cloudShade));
  }
  const day = deriveEnvironmentPalette(deriveTimeOfDay(0));
  const night = deriveEnvironmentPalette(deriveTimeOfDay(1));
  assert.equal(day.moonBlend, 0);
  assert.equal(night.moonBlend, 1);
  assert.ok(luminance(day.lightColor) > luminance(night.lightColor) * 4);
  assert.ok(luminance(night.lightColor) > 0.2, "moonlight must still model the yacht");
  assert.ok(luminance(night.horizon) > 0.04, "the night horizon must stay visible");
  assert.ok(luminance(day.horizon) > luminance(day.zenith), "the sky brightens toward the horizon");
  assert.ok(day.zenith[2] > day.zenith[0] * 4, "the day sky is blue");
  const dusk = deriveEnvironmentPalette(deriveTimeOfDay(0.61));
  assert.ok(dusk.twilight > 0.8 && dusk.horizon[0] > dusk.horizon[2], "the horizon warms as the sun sets");
});

test("quality presets scale cost monotonically and keep the low preset free of post-processing", () => {
  const { low, medium, high } = QUALITY_SETTINGS;
  assert.equal(low.postProcessing, false);
  assert.equal(low.msaaSamples, 0);
  assert.ok(medium.postProcessing && high.postProcessing);
  assert.ok(low.oceanDetail < medium.oceanDetail && medium.oceanDetail < high.oceanDetail);
  assert.ok(low.oceanSegments < medium.oceanSegments && medium.oceanSegments < high.oceanSegments);
  assert.ok(medium.bloomStrength <= high.bloomStrength && high.bloomStrength < 0.6);
  assert.ok(medium.msaaSamples <= high.msaaSamples);
});

test("bow spray starts at a realistic cruising speed and grows with speed and helm", () => {
  assert.equal(bowSprayRate(BOW_SPRAY_MIN_SPEED, 0), 0);
  assert.equal(bowSprayRate(1, 1), 0);
  const cruising = bowSprayRate(4, 0);
  assert.ok(cruising > 0);
  assert.ok(bowSprayRate(5, 0) > cruising);
  assert.ok(bowSprayRate(4, 1) > cruising);
  assert.equal(bowSprayRate(-4, 0), cruising);
});
