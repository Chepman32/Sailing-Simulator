import assert from "node:assert/strict";
import test from "node:test";
import { QUALITY_SETTINGS } from "../../src/simulator/core/QualityManager";
import { OCEAN_WAVES } from "../../src/simulator/environment/OceanMath";
import {
  UNDERWATER_ABSORPTION,
  underwaterPathLength,
  underwaterTransmittance,
} from "../../src/simulator/environment/UnderwaterLight";
import { OCEAN_SURFACE_HEIGHT_GLSL } from "../../src/simulator/environment/shaders/oceanShader";
import { nacaHalfThickness } from "../../src/simulator/vessel/Appendages";
import {
  GYBE_ANGLE,
  MAX_BOOM_ANGLE,
  MIN_BOOM_ANGLE,
  boomPivotPose,
  boomTarget,
  createBoomState,
  stepBoom,
} from "../../src/simulator/vessel/BoomDynamics";
import { fishOwner } from "../../src/simulator/wildlife/ReefFishController";
import {
  FISH_MIN_WATER_DEPTH,
  MAX_FISH_PITCH,
  REEF_FISH_SPECIES,
  createFishAgent,
  stepSchool,
  tailAmplitude,
  tailBeatFrequency,
  type FishAgent,
  type FishThreat,
  type FishWorld,
} from "../../src/simulator/wildlife/ReefFishMath";

function settle(state: ReturnType<typeof createBoomState>, target: number, seconds: number): number {
  let strongestSlam = 0;
  for (let step = 0; step < seconds * 60; step += 1) {
    strongestSlam = Math.max(strongestSlam, stepBoom(state, target, 1 / 60));
  }
  return strongestSlam;
}

test("the boom settles where the sheet holds it, on the side the sail fills", () => {
  const boom = createBoomState(0.3);
  settle(boom, boomTarget(0.9, 1, 0, 0), 6);
  assert.ok(Math.abs(boom.angle - 0.9) < 0.01, "boom eased out to starboard");
  settle(boom, boomTarget(0.5, -1, 0, 0), 8);
  assert.ok(Math.abs(boom.angle + 0.5) < 0.01, "boom on the port side after the change of tack");
  assert.equal(boomTarget(5, 1, 0, 0), MAX_BOOM_ANGLE, "the shrouds stop the boom");
  assert.equal(boomTarget(0, -1, 0, 0), -MIN_BOOM_ANGLE);
  const flogging = [0, 0.1, 0.2, 0.3].map((time) => boomTarget(0.3, 1, 1, time));
  assert.ok(Math.max(...flogging) - Math.min(...flogging) > 0.02, "a luffing sail shakes the boom");
});

test("a gybe slams the boom across; a tack does not", () => {
  const gybe = createBoomState(1.2);
  const slam = settle(gybe, -1.2, 4);
  assert.ok(slam > 0.15, "the boom fetches up on the sheet after a gybe");
  assert.ok(Math.abs(gybe.angle + 1.2) < 0.05);

  const tack = createBoomState(MIN_BOOM_ANGLE + 0.1);
  assert.ok(Math.abs(tack.angle) < GYBE_ANGLE);
  assert.equal(settle(tack, -(MIN_BOOM_ANGLE + 0.1), 4), 0, "the boom crosses quietly when tacking");

  const bounded = createBoomState(0);
  for (let step = 0; step < 600; step += 1) {
    stepBoom(bounded, step % 120 < 60 ? 5 : -5, 1 / 60);
    assert.ok(Math.abs(bounded.angle) <= MAX_BOOM_ANGLE + 1e-9);
    assert.ok(Number.isFinite(bounded.rate));
  }
});

test("the rig pivot pose puts the authored boom at the requested angle on either side", () => {
  // Boom direction for a signed angle measured from aft toward starboard.
  const direction = (angle: number) => [Math.sin(angle), -Math.cos(angle)];
  for (const authored of [0.3, -0.3]) {
    for (const target of [1.1, 0.4, -0.4, -1.1]) {
      const pose = boomPivotPose(target, authored);
      // Mirror across the centreline, then rotate about +Y.
      const [x, z] = direction(authored);
      const mirroredX = x * pose.mirror;
      const rotatedX = mirroredX * Math.cos(pose.rotationY) + z * Math.sin(pose.rotationY);
      const rotatedZ = -mirroredX * Math.sin(pose.rotationY) + z * Math.cos(pose.rotationY);
      const [expectedX, expectedZ] = direction(target);
      assert.ok(Math.abs(rotatedX - expectedX) < 1e-9 && Math.abs(rotatedZ - expectedZ) < 1e-9);
      assert.equal(pose.mirror, Math.sign(target) * Math.sign(authored), "camber faces leeward");
    }
  }
});

test("sea water absorbs red first, blue last, and nothing above the surface", () => {
  assert.ok(UNDERWATER_ABSORPTION[0] > UNDERWATER_ABSORPTION[1] && UNDERWATER_ABSORPTION[1] > UNDERWATER_ABSORPTION[2]);
  assert.equal(underwaterPathLength(-0.5, 1, 10), 0);
  assert.equal(underwaterPathLength(0, 1, 10), 0);
  const shallow = underwaterPathLength(0.5, 1, 30);
  const deep = underwaterPathLength(3, 1, 30);
  const grazing = underwaterPathLength(3, 0.1, 30);
  assert.ok(deep > shallow && grazing > deep, "deeper and more oblique views pass through more water");
  assert.ok(underwaterPathLength(3, 0.05, 2) <= 2 + 3 * 0.6 + 1e-9, "the path cannot exceed the view distance");
  const transmittance = underwaterTransmittance(4);
  assert.ok(transmittance[0] < transmittance[1] && transmittance[1] < transmittance[2]);
  assert.ok(transmittance[2] > 0.75, "clear tropical water stays blue-transparent for metres");
  assert.ok(transmittance[0] < 0.25, "red is gone within a few metres");
  assert.deepEqual(underwaterTransmittance(0), [1, 1, 1]);
});

test("the hull wet band uses the same waves as the CPU sampler", () => {
  for (const wave of OCEAN_WAVES) {
    assert.ok(OCEAN_SURFACE_HEIGHT_GLSL.includes(wave.amplitude.toFixed(6)), `wave ${wave.wavelength} m is missing`);
  }
  assert.equal(OCEAN_SURFACE_HEIGHT_GLSL.match(/height \+=/gu)?.length, OCEAN_WAVES.length);
});

test("rudder and saildrive foils follow a symmetric NACA section", () => {
  assert.equal(nacaHalfThickness(0, 0.12), 0);
  assert.ok(Math.abs(nacaHalfThickness(1, 0.12)) < 0.002);
  let thickest = 0;
  let thickestAt = 0;
  for (let step = 0; step <= 100; step += 1) {
    const value = nacaHalfThickness(step / 100, 0.12);
    if (value > thickest) {
      thickest = value;
      thickestAt = step / 100;
    }
  }
  assert.ok(Math.abs(thickest - 0.06) < 0.002, "a 12% section is 12% thick");
  assert.ok(thickestAt > 0.25 && thickestAt < 0.35);
});

test("fish are identified from the loader's sanitised bone names", () => {
  assert.equal(fishOwner("Clown2Spine_039_13"), "Clown2");
  assert.equal(fishOwner("blue_tang1Tail59_63"), "blue_tang1");
  assert.equal(fishOwner("Yellow1R_Upper_fin131_135"), "Yellow1");
  assert.equal(fishOwner("GLTF_created_0_rootJoint"), "");
  assert.equal(fishOwner("root4_8"), "");
});

function reefWorld(threats: FishThreat[] = []): FishWorld {
  return {
    surfaceAt: () => 0,
    // A shelf that shoals toward +X, reaching dry land at x = 20.
    bottomAt: (x) => -Math.max(0.2, Math.min(6, (20 - x) * 0.4)),
    homeX: 0,
    homeY: -2,
    homeZ: 0,
    threats,
    time: 0,
  };
}

function school(count: number): FishAgent[] {
  const agents: FishAgent[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.4;
    agents.push(createFishAgent(Math.sin(angle) * 2, -2, Math.cos(angle) * 2, angle, (index * 0.618) % 1));
  }
  return agents;
}

test("reef fish swim forward with bounded turns and stay between reef and surface", () => {
  for (const species of REEF_FISH_SPECIES) {
    const agents = school(24);
    const world = reefWorld();
    const delta = 1 / 30;
    for (let step = 0; step < 900; step += 1) {
      world.time += delta;
      const before = agents.map((fish) => ({ heading: fish.heading, x: fish.x, z: fish.z }));
      stepSchool(agents, species, world, delta);
      agents.forEach((fish, index) => {
        assert.ok(fish.speed >= species.minSpeed - 1e-9 && fish.speed <= species.burstSpeed + 1e-9);
        const turned = Math.abs(Math.atan2(Math.sin(fish.heading - before[index].heading), Math.cos(fish.heading - before[index].heading)));
        assert.ok(turned <= species.maxTurnRate * 2.6 * delta + 1e-6, `${species.key} turned too fast`);
        const moved = (fish.x - before[index].x) * Math.sin(fish.heading) + (fish.z - before[index].z) * Math.cos(fish.heading);
        assert.ok(moved > 0, `${species.key} swam backward`);
        assert.ok(Math.abs(fish.pitch) <= MAX_FISH_PITCH + 1e-9);
        assert.ok(fish.y < world.surfaceAt(fish.x, fish.z) && fish.y > world.bottomAt(fish.x, fish.z));
        assert.ok(Number.isFinite(fish.x + fish.y + fish.z + fish.tailPhase));
      });
    }
    const centreX = agents.reduce((total, fish) => total + fish.x, 0) / agents.length;
    const centreZ = agents.reduce((total, fish) => total + fish.z, 0) / agents.length;
    assert.ok(Math.hypot(centreX, centreZ) < species.wanderRadius * 2, `${species.key} stayed on its reef`);
    const deepest = Math.min(...agents.map((fish) => -world.bottomAt(fish.x, fish.z)));
    assert.ok(deepest > FISH_MIN_WATER_DEPTH * 0.5, `${species.key} kept off the beach`);
  }
});

test("a school flees a predator together and calms down afterwards", () => {
  const species = REEF_FISH_SPECIES[0];
  const agents = school(30);
  const threat: FishThreat = { x: 0, y: -2, z: 0, radius: 9, strength: 1 };
  const world = reefWorld([threat]);
  const distance = () => agents.reduce((total, fish) => total + Math.hypot(fish.x, fish.z), 0) / agents.length;
  const before = distance();
  for (let step = 0; step < 45; step += 1) {
    world.time += 1 / 30;
    stepSchool(agents, species, world, 1 / 30);
  }
  assert.ok(distance() > before + 1, "the school scatters away from the predator");
  assert.ok(agents.every((fish) => fish.panic > 0.2), "the alarm spreads through the whole school");
  assert.ok(Math.max(...agents.map((fish) => fish.speed)) > species.cruiseSpeed * 2, "fish burst away");

  world.threats = [];
  for (let step = 0; step < 30 * 20; step += 1) {
    world.time += 1 / 30;
    stepSchool(agents, species, world, 1 / 30);
  }
  assert.ok(agents.every((fish) => fish.panic < 0.05), "panic decays once the threat is gone");
});

test("tail beat quickens with speed and with smaller bodies", () => {
  assert.ok(tailBeatFrequency(1, 0.2) > tailBeatFrequency(0.4, 0.2));
  assert.ok(tailBeatFrequency(0.5, 0.1) > tailBeatFrequency(0.5, 0.3));
  assert.ok(tailBeatFrequency(100, 0.1) <= 7);
  assert.ok(tailAmplitude(2, 0.2, 1) > tailAmplitude(0.3, 0.2, 0));
  assert.ok(tailAmplitude(50, 0.1, 1) <= 0.17);
});

test("reef fish numbers scale with the quality preset", () => {
  const { low, medium, high } = QUALITY_SETTINGS;
  assert.ok(low.fishDensity < medium.fishDensity && medium.fishDensity <= high.fishDensity);
  const fullSchool = REEF_FISH_SPECIES.reduce((total, species) => total + species.count, 0);
  assert.ok(fullSchool >= 100 && fullSchool <= 400, "enough fish to read as a reef, few enough to be cheap");
});
