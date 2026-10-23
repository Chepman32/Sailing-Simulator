import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { screenRollDegrees, swipeToRudder, tiltToRudder, TILT_FULL_RUDDER_DEGREES } from "../../app/components/steering";
import { BELL_PARTIALS, HORN_PROFILES, airAbsorptionCutoff, inverseDistanceGain } from "../../src/simulator/audio/AudioMath";
import { isOccludedByYacht, planShotOffset, segmentIntersectsBox } from "../../src/simulator/camera/PhotoDirector";
import {
  createAutoQualityState,
  initialAutoLevel,
  stepAutoQuality,
  AUTO_QUALITY_TARGET_FPS,
} from "../../src/simulator/core/QualityManager";
import { FLARE_APOGEE, FLARE_ASCENT_SECONDS, FLARE_BURN_SECONDS, flareAltitude, flareBrightness, flarePhase } from "../../src/simulator/effects/FlareMath";
import { nextVolcanoPhase, volcanoActivity, type VolcanoPhase } from "../../src/simulator/environment/VolcanoState";
import { compassBearingDegrees } from "../../src/simulator/math";
import { createSimulatorState } from "../../src/simulator/state";
import {
  chooseShipSpawn,
  HORN_MIN_INTERVAL,
  HornScheduler,
  isValidShipSpacing,
  planarDistance,
  SHIP_LAND_CLEARANCE,
  SHIP_MAX_SPACING,
  SHIP_MIN_SPACING,
} from "../../src/simulator/traffic/ShipTraffic";
import { stepHelmsmanLean } from "../../src/simulator/vessel/Helmsman";
import { computeSailState, TOTAL_SAIL_AREA } from "../../src/simulator/vessel/SailAerodynamics";
import { sailCamberProfile } from "../../src/simulator/vessel/SailSystem";
import { VesselPhysics, type IslandPhysics, type OceanSampler } from "../../src/simulator/vessel/VesselPhysics";
import {
  nextSharkPhase,
  SHARK_FIN_EXPOSURE,
  sharkRootDepth,
  type SharkPhase,
} from "../../src/simulator/wildlife/WildlifeState";
import { decodeCells, DiscoveryState, encodeCells } from "../../src/simulator/world/Discovery";
import { islandHeight, lavaMask, terrainHeightAt } from "../../src/simulator/world/IslandTerrain";
import { COLLECTIBLES, ISLANDS, landClearance, POINTS_OF_INTEREST, segmentNearLand } from "../../src/simulator/world/WorldLayout";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const flatOcean: OceanSampler = { sample: () => ({ height: 0, normalX: 0, normalY: 1, normalZ: 0 }) };
const openWater: IslandPhysics = {
  depthAt: () => 18,
  avoidanceForce: (_position, _velocity, target) => target.set(0, 0, 0),
  constrainToWater: () => false,
  nearestShoreDirection: (_position, target) => target.set(0, 0, 1),
};

test("quality defaults to auto and only auto adapts, targeting 30 FPS", () => {
  assert.equal(createSimulatorState().quality, "auto");
  const state = createAutoQualityState();
  let level = stepAutoQuality("high", 45, state, false);
  // 45 FPS is comfortably above the 30 FPS target: never degrade.
  for (let window = 0; window < 50; window += 1) level = stepAutoQuality(level, 45, state, false);
  assert.equal(level, "high");
  // Sustained frames below ~30 FPS step down one level at a time.
  for (let window = 0; window < 3; window += 1) level = stepAutoQuality(level, AUTO_QUALITY_TARGET_FPS - 8, state, false);
  assert.equal(level, "medium");
  // A cooldown prevents bouncing straight back up.
  for (let window = 0; window < 30; window += 1) level = stepAutoQuality(level, 60, state, false);
  assert.equal(level, "medium");
});

test("auto quality never promotes a phone to high and starts phones low", () => {
  assert.equal(initialAutoLevel(true, true), "low");
  assert.equal(initialAutoLevel(false, false), "high");
  const state = createAutoQualityState();
  let level = stepAutoQuality("medium", 60, state, true);
  for (let window = 0; window < 400; window += 1) level = stepAutoQuality(level, 60, state, true);
  assert.equal(level, "medium");
});

test("ships spawn 1.5–3 km apart on routes clear of every island", () => {
  const random = seeded(42);
  const yacht = { x: 0, z: 0 };
  const ships: Array<{ x: number; z: number; heading: number }> = [];
  for (let index = 0; index < 4; index += 1) {
    const spawn = chooseShipSpawn(yacht, ships, random, 200);
    assert.ok(spawn, `ship ${index} could not be placed`);
    for (const other of ships) assert.ok(planarDistance(spawn, other) >= SHIP_MIN_SPACING);
    if (ships.length > 0) assert.ok(Math.min(...ships.map((other) => planarDistance(spawn, other))) <= SHIP_MAX_SPACING);
    const endX = spawn.x + Math.sin(spawn.heading) * 3000;
    const endZ = spawn.z + Math.cos(spawn.heading) * 3000;
    assert.equal(segmentNearLand(spawn.x, spawn.z, endX, endZ, SHIP_LAND_CLEARANCE), false);
    ships.push(spawn);
  }
  assert.equal(isValidShipSpacing({ x: 0, z: 0 }, [{ x: 1000, z: 0 }]), false);
  assert.equal(isValidShipSpacing({ x: 0, z: 0 }, [{ x: 4000, z: 0 }]), false);
  assert.equal(isValidShipSpacing({ x: 0, z: 0 }, [{ x: 2000, z: 0 }]), true);
});

test("ship horns are at least 30 seconds apart", () => {
  const horns = new HornScheduler();
  assert.equal(HORN_MIN_INTERVAL >= 30, true);
  assert.equal(horns.trySound(10), true);
  assert.equal(horns.trySound(25), false);
  assert.equal(horns.trySound(39.9), false);
  assert.equal(horns.trySound(40), true);
  for (const profile of Object.values(HORN_PROFILES)) {
    assert.ok(profile.duration >= 4 && profile.duration <= 6, "prolonged blast is 4–6 s");
    // Phone speakers need harmonics: fundamentals are low but present.
    assert.ok(profile.tones.every((tone) => tone >= 60 && tone <= 160));
  }
});

test("positional audio gets quieter and darker with camera distance", () => {
  // Bell heard from the helm (~4 m) vs. the chase camera (~17 m) vs. drone (~45 m).
  const helm = inverseDistanceGain(4, 2.5, 1.3);
  const chase = inverseDistanceGain(17, 2.5, 1.3);
  const drone = inverseDistanceGain(45, 2.5, 1.3);
  assert.ok(helm > chase && chase > drone);
  assert.ok(helm / drone > 5);
  assert.ok(airAbsorptionCutoff(1000) < airAbsorptionCutoff(50));
  assert.ok(BELL_PARTIALS.length >= 6);
});

test("tilt and swipe steering map to a bounded rudder", () => {
  assert.equal(screenRollDegrees({ beta: 10, gamma: 20 }, 0), 20);
  assert.equal(screenRollDegrees({ beta: 10, gamma: 20 }, 90), 10);
  assert.equal(screenRollDegrees({ beta: 10, gamma: 20 }, 270), -10);
  assert.equal(tiltToRudder(5, 4), 0, "dead zone around neutral");
  assert.equal(tiltToRudder(TILT_FULL_RUDDER_DEGREES + 10, 0), 1);
  assert.equal(tiltToRudder(-TILT_FULL_RUDDER_DEGREES - 10, 0), -1);
  assert.ok(tiltToRudder(12, 0) > 0 && tiltToRudder(12, 0) < 1);
  assert.equal(swipeToRudder(0.9, 500), 1);
  assert.ok(swipeToRudder(0, 55) > 0.4);
});

test("sharks periodically show only their dorsal fin above the surface", () => {
  let phase: SharkPhase = "patrol";
  const visited: SharkPhase[] = [];
  for (let step = 0; step < 4; step += 1) {
    visited.push(phase);
    phase = nextSharkPhase(phase);
  }
  assert.deepEqual(visited, ["patrol", "approach", "fin", "dive"]);
  assert.equal(phase, "patrol");
  const finTop = 0.9;
  // During the pass the fin tip clears the water by the configured amount…
  assert.ok(Math.abs(finTop - sharkRootDepth("fin", 0.5, finTop) - SHARK_FIN_EXPOSURE) < 1e-9);
  // …and the whole shark is submerged otherwise.
  assert.ok(finTop - sharkRootDepth("patrol", 0.5, finTop) < -0.5);
  assert.ok(finTop - sharkRootDepth("dive", 1, finTop) < -0.5);
  // The fin rises smoothly rather than popping up.
  assert.ok(sharkRootDepth("fin", 0.02, finTop) > sharkRootDepth("fin", 0.2, finTop));
});

test("the volcano cycles through a bounded eruption", () => {
  let phase: VolcanoPhase = "quiet";
  const order: VolcanoPhase[] = [];
  for (let step = 0; step < 4; step += 1) {
    order.push(phase);
    phase = nextVolcanoPhase(phase);
  }
  assert.deepEqual(order, ["quiet", "rumble", "eruption", "waning"]);
  const quiet = volcanoActivity("quiet", 0.5);
  const eruption = volcanoActivity("eruption", 0.1);
  assert.ok(eruption.ash > quiet.ash && eruption.bombs > quiet.bombs && eruption.lava > quiet.lava);
  for (const name of order) {
    for (const t of [0, 0.5, 1]) {
      const activity = volcanoActivity(name, t);
      assert.ok(activity.lava >= 0 && activity.lava <= 1);
      assert.ok(Number.isFinite(activity.ash + activity.bombs + activity.steam + activity.plumeSpeed));
    }
  }
});

test("a signal flare climbs, bursts, then drifts down while burning", () => {
  assert.equal(flarePhase(0.5), "ascent");
  assert.equal(flareBrightness(1), 0);
  assert.ok(Math.abs(flareAltitude(FLARE_ASCENT_SECONDS) - FLARE_APOGEE) < 1e-6);
  assert.ok(flareAltitude(1) < flareAltitude(2));
  assert.ok(flareAltitude(FLARE_ASCENT_SECONDS + 10) < FLARE_APOGEE);
  assert.ok(flareBrightness(FLARE_ASCENT_SECONDS + 5) > 0.9);
  assert.equal(flarePhase(FLARE_ASCENT_SECONDS + FLARE_BURN_SECONDS + 1), "spent");
});

test("photo auto-targeting never frames a subject through the sails", () => {
  const min = new THREE.Vector3(-1, -1, -1);
  const max = new THREE.Vector3(1, 1, 1);
  assert.equal(segmentIntersectsBox(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 0, 0), min, max), true);
  assert.equal(segmentIntersectsBox(new THREE.Vector3(-5, 3, 0), new THREE.Vector3(5, 3, 0), min, max), false);
  const yacht = { position: new THREE.Vector3(0, 0.4, 0), heading: 0.7 };
  const subject = { kind: "dolphin" as const, position: new THREE.Vector3(Math.sin(0.7) * 30, 0, Math.cos(0.7) * 30), radius: 3, priority: 6 };
  // A camera directly behind the yacht looking past it is blocked by the rig.
  const behind = new THREE.Vector3(-Math.sin(0.7) * 20, 3, -Math.cos(0.7) * 20);
  assert.equal(isOccludedByYacht(behind, subject.position, yacht), true);
  const plan = planShotOffset(subject, yacht, {
    waterHeightAt: () => 0,
    terrainHeightAt: () => Number.NEGATIVE_INFINITY,
    sunDirection: new THREE.Vector3(0.6, 0.7, -0.4).normalize(),
  }, null);
  const camera = subject.position.clone().add(plan.offset);
  assert.equal(plan.blocked, false);
  assert.equal(isOccludedByYacht(camera, subject.position, yacht), false);
});

test("discovery charts explored water, places and finds and survives a reload", () => {
  const discovery = new DiscoveryState();
  const volcano = POINTS_OF_INTEREST.find((place) => place.id === "volcano")!;
  const events = discovery.observe(volcano.x + 50, volcano.z);
  assert.ok(events.some((event) => event.type === "place" && event.id === "volcano"));
  assert.ok(discovery.exploredFraction() > 0);
  assert.ok(discovery.collect(COLLECTIBLES[0].id));
  assert.equal(discovery.collect(COLLECTIBLES[0].id), null, "a find is collected once");
  const restored = new DiscoveryState();
  restored.restore(discovery.serialize());
  assert.deepEqual([...restored.places], [...discovery.places]);
  assert.ok(restored.collected.has(COLLECTIBLES[0].id));
  assert.deepEqual(Array.from(restored.cells), Array.from(discovery.cells));
  const cells = new Uint8Array(37).map((_, index) => (index % 3 === 0 ? 1 : 0));
  const decoded = new Uint8Array(37);
  decodeCells(encodeCells(cells), decoded);
  assert.deepEqual(Array.from(decoded), Array.from(cells));
});

test("floating finds and places are on open water, clear of every island", () => {
  for (const item of COLLECTIBLES) assert.ok(landClearance(item.x, item.z) > 20, `${item.id} is too close to land`);
  for (const place of POINTS_OF_INTEREST) {
    if (["volcano", "lighthouse", "monolith"].includes(place.kind)) continue;
    assert.ok(landClearance(place.x, place.z) > 40, `${place.id} overlaps an island`);
  }
});

test("islands have distinct relief and the volcano has a glowing crater", () => {
  const peaks = ISLANDS.map((island) => {
    let peak = Number.NEGATIVE_INFINITY;
    for (let radial = 0; radial < 1; radial += 0.02) {
      for (let angle = 0; angle < Math.PI * 2; angle += 0.2) peak = Math.max(peak, islandHeight(island, radial, angle));
    }
    return { kind: island.kind, peak };
  });
  const volcano = peaks.find((entry) => entry.kind === "volcano")!;
  const atoll = peaks.find((entry) => entry.kind === "atoll")!;
  const hill = peaks.find((entry) => entry.kind === "hill")!;
  assert.ok(volcano.peak > 90, `volcano peak ${volcano.peak}`);
  assert.ok(hill.peak > 8 && atoll.peak < 4);
  const volcanoIsland = ISLANDS.find((island) => island.kind === "volcano")!;
  assert.equal(lavaMask(volcanoIsland, 0.01, 0), 1);
  assert.equal(lavaMask(ISLANDS[0], 0.01, 0), 0);
  assert.equal(terrainHeightAt(ISLANDS, 2000, 2000), Number.NEGATIVE_INFINITY);
  for (const island of ISLANDS) assert.ok(Number.isFinite(terrainHeightAt(ISLANDS, island.x, island.z)));
});

test("sail state keeps the combined force and fills the sails with wind", () => {
  const reach = computeSailState(1.2, 7, 0.7);
  const expected = 0.5 * 1.225 * TOTAL_SAIL_AREA * 49 * Math.sin(1.2) * 0.7 * 0.88;
  assert.ok(Math.abs(reach.force - expected) < 1e-6);
  assert.equal(reach.side, 1);
  assert.equal(computeSailState(-1.2, 7, 0.7).side, -1);
  assert.ok(computeSailState(1.2, 10, 0.7).mainCamber > computeSailState(1.2, 2, 0.7).mainCamber);
  // Head to wind (air from dead ahead) the sails luff and lose their belly.
  const headToWind = computeSailState(Math.PI - 0.1, 7, 0.7);
  assert.ok(headToWind.luffing > 0.9 && headToWind.mainCamber < reach.mainCamber);
  // Belly profile: zero at luff and leech, deepest around 40% chord.
  assert.equal(sailCamberProfile(0), 0);
  assert.equal(sailCamberProfile(1), 0);
  assert.ok(sailCamberProfile(0.42) > 0.98 && sailCamberProfile(0.42) <= 1.01);
});

test("starboard rudder turns the bow to starboard and the compass bearing rises", () => {
  const physics = new VesselPhysics(flatOcean, openWater);
  physics.velocity.set(0, 0, 4);
  for (let step = 0; step < 240; step += 1) physics.fixedUpdate(1 / 60, { throttle: 0.6, rudder: 1, sailTrim: 0.2 });
  // Starboard is -X in three.js' right-handed frame (bow +Z, up +Y).
  assert.ok(physics.heading < 0);
  assert.ok(physics.forward.x < 0);
  const bearing = compassBearingDegrees(physics.heading);
  assert.ok(bearing > 0 && bearing < 180, `bearing ${bearing}`);
});

test("the yacht heels to leeward under sail", () => {
  const physics = new VesselPhysics(flatOcean, openWater);
  for (let step = 0; step < 600; step += 1) physics.fixedUpdate(1 / 60, { throttle: 0, rudder: 0, sailTrim: 1 });
  // The true wind blows toward +X, so leeward is +X; positive roll lowers +X.
  assert.ok(physics.telemetry.apparentWindAngle > 0);
  assert.ok(physics.roll > 0.01, `roll ${physics.roll}`);
});

test("the skipper's balance spring stays bounded and settles", () => {
  const lean = { lean: 0, velocity: 0 };
  let peak = 0;
  for (let step = 0; step < 600; step += 1) {
    const value = stepHelmsmanLean(lean, 0.25, 0, 1 / 60);
    peak = Math.max(peak, Math.abs(value));
  }
  assert.ok(peak <= 0.5);
  assert.ok(Math.abs(lean.lean - 0.25 * 0.82) < 0.01);
});
