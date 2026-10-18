import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { subdivideSkinnedLoop } from "../../src/simulator/core/Subdivision";
import {
  distanceFromWaterline,
  islandEdgeNoise,
  islandsAround,
  islandsInCell,
  islandsWithin,
  type IslandDefinition,
  ISLAND_SLOTS,
  START_ISLANDS,
  WORLD_CELL,
  worldCell,
  selectIslandSlots,
  SHELF_WIDTH,
  WATERLINE_RADIAL,
} from "../../src/simulator/environment/IslandMath";
import { nearestShore } from "../../src/simulator/environment/SurfMath";
import {
  createShip,
  emptyWakeSample,
  hullHalfWidth,
  KELVIN_TANGENT,
  LANE_MAX_PASSING,
  LANE_MIN_PASSING,
  LANE_SHORE_CLEARANCE,
  MAX_SHIPS,
  MOVING_SHIPS,
  planAnchorage,
  planLane,
  sampleShipWake,
  SHIP_KINDS,
  SHIP_SPECS,
  SHIP_WAKE_UNIFORMS,
  shipContact,
  shipHornSignal,
  shipHullDistance,
  shipOutOfRange,
  stepShip,
  type Ship,
  type ShipWorld,
  WAKE_SLOTS,
  writeShipUniforms,
} from "../../src/simulator/ships/ShipMath";
import {
  createGullState,
  GULL_ALARM_DISTANCE,
  GULL_FLOAT_HEIGHT,
  GULL_MAX_BANK,
  placeGull,
  stepGull,
  type GullWorld,
} from "../../src/simulator/wildlife/GullBehavior";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Exact nearest-coast distance, island by island, for checking the indexed search. */
function bruteWaterline(x: number, z: number): number {
  let nearest = Infinity;
  for (const island of islandsAround(x, z)) {
    const dx = x - island.centerX;
    const dz = (z - island.centerZ) / island.scaleZ;
    const shore = island.beachRadius * islandEdgeNoise(Math.atan2(dz, dx), island) * WATERLINE_RADIAL;
    nearest = Math.min(nearest, Math.hypot(dx, dz) - shore);
  }
  return nearest;
}

test("the archipelago is many islands of every size, apart from each other and from the start", () => {
  assert.ok(START_ISLANDS.length >= 8, `only ${START_ISLANDS.length} islands`);
  const radii = START_ISLANDS.map((island) => island.beachRadius);
  assert.ok(Math.min(...radii) < 25 && Math.max(...radii) > 70, "cays and large islands alike");
  assert.ok(START_ISLANDS.some((island) => island.height > 5), "some islands are high");
  assert.ok(START_ISLANDS.filter((island) => Math.hypot(island.centerX, island.centerZ) < 1500).length >= 6, "several within sight of the start");
  for (let a = 0; a < START_ISLANDS.length; a += 1) {
    for (let b = a + 1; b < START_ISLANDS.length; b += 1) {
      const first = START_ISLANDS[a]!;
      const second = START_ISLANDS[b]!;
      const reach = first.beachRadius * Math.max(1, first.scaleZ) + second.beachRadius * Math.max(1, second.scaleZ);
      assert.ok(Math.hypot(first.centerX - second.centerX, first.centerZ - second.centerZ) > reach + 2 * SHELF_WIDTH, `islands ${a} and ${b} crowd each other`);
    }
  }
  assert.ok(distanceFromWaterline(0, 0) > 30, "the yacht starts in open water");
});

test("the indexed coast search is exact everywhere", () => {
  const random = seeded(7);
  for (let sample = 0; sample < 4000; sample += 1) {
    const x = (random() - 0.5) * 2000;
    const z = (random() - 0.5) * 2000;
    assert.ok(Math.abs(distanceFromWaterline(x, z) - bruteWaterline(x, z)) < 1e-9);
    const shore = nearestShore(x, z);
    assert.ok(Math.abs(shore.distance - bruteWaterline(x, z)) < 1e-9);
  }
});

test("the shader's island slots hold the nearest islands, nearest first", () => {
  const shape = new Float32Array(ISLAND_SLOTS * 4);
  const frame = new Float32Array(ISLAND_SLOTS * 4);
  for (const [x, z] of [[0, 0], [1500, -800], [-2000, 1600]] as const) {
    selectIslandSlots(x, z, shape, frame);
    const slotted = Array.from({ length: ISLAND_SLOTS }, (_, slot) => shape[slot * 4]!).filter((cx) => cx < 1e5);
    // The island whose coast is nearest is always in a slot.
    const nearest = nearestShore(x, z).island!;
    assert.ok(slotted.includes(Math.fround(nearest.centerX)), `island ${nearest.id} missing near (${x}, ${z})`);
    assert.ok(slotted.length >= 4, "enough neighbours fill the slots");
    assert.equal(new Set(slotted).size, slotted.length, "no island twice");
    const first = nearest;
    assert.equal(shape[0], Math.fround(first.centerX));
    assert.equal(shape[2], Math.fround(first.beachRadius));
  }
});

test("the world is endless: every cell holds an island and none crowd each other", () => {
  const seen = new Set<number>();
  const all: IslandDefinition[] = [];
  for (let col = -12; col <= 12; col += 1) {
    for (let row = -12; row <= 12; row += 1) {
      const cell = islandsInCell(col, row);
      assert.ok(cell.length >= 1, `cell ${col},${row} is empty`);
      for (const island of cell) {
        assert.ok(!seen.has(island.id), "ids are unique");
        seen.add(island.id);
        all.push(island);
      }
      assert.deepEqual(islandsInCell(col, row), cell, "generation is deterministic");
    }
  }
  const sample = all.filter((island) => Math.abs(island.centerX) < 3000 && Math.abs(island.centerZ) < 3000);
  for (let a = 0; a < sample.length; a += 1) {
    for (let b = a + 1; b < sample.length; b += 1) {
      const first = sample[a]!;
      const second = sample[b]!;
      const reach = first.beachRadius * Math.max(1, first.scaleZ) + second.beachRadius * Math.max(1, second.scaleZ);
      assert.ok(Math.hypot(first.centerX - second.centerX, first.centerZ - second.centerZ) > reach + 2 * SHELF_WIDTH);
    }
  }
  assert.equal(worldCell(0), 0);
  assert.ok(WORLD_CELL <= 2000);
});

test("land is always within a couple of kilometres, far from the start too", () => {
  const random = seeded(23);
  for (let sample = 0; sample < 400; sample += 1) {
    const x = (random() - 0.5) * 200000;
    const z = (random() - 0.5) * 200000;
    assert.ok(islandsWithin(x, z, 2000).length >= 1, `open ocean at (${x.toFixed(0)}, ${z.toFixed(0)})`);
  }
});

test("the ocean's wake slots hold the ships nearest the yacht", () => {
  const random = seeded(5);
  const ships = Array.from({ length: MAX_SHIPS }, (_, index) => {
    const ship = createShip(SHIP_KINDS[index % SHIP_KINDS.length]!, random);
    ship.x = index * 700;
    ship.z = 0;
    ship.active = true;
    return ship;
  });
  writeShipUniforms(ships, 3 * 700, 0);
  const pose = SHIP_WAKE_UNIFORMS.uShipPose.value;
  const slotted = Array.from({ length: WAKE_SLOTS }, (_, slot) => pose[slot * 4]!);
  assert.equal(slotted[0], 3 * 700, "the nearest ship comes first");
  assert.equal(new Set(slotted).size, WAKE_SLOTS, "no ship twice");
  assert.ok(slotted.every((x) => Math.abs(x - 3 * 700) <= 2 * 700), "only near ships are drawn");
  assert.ok(MAX_SHIPS > WAKE_SLOTS && MOVING_SHIPS < MAX_SHIPS);
});

const world = (time = 0): ShipWorld => ({ shoreDistance: distanceFromWaterline, windFrom: Math.atan2(-6.8, -4.2), time });

test("ships are planned on lanes clear of every island, passing within reach of the yacht", () => {
  const random = seeded(11);
  for (let trial = 0; trial < 30; trial += 1) {
    const kind = SHIP_KINDS[trial % SHIP_KINDS.length]!;
    const ship = createShip(kind, random);
    const yachtX = (random() - 0.5) * 2000;
    const yachtZ = (random() - 0.5) * 2000;
    if (!planLane(ship, world(), yachtX, yachtZ, [], random)) continue;
    // Closest approach of the lane to the yacht.
    const fx = Math.sin(ship.heading);
    const fz = Math.cos(ship.heading);
    const along = (yachtX - ship.x) * fx + (yachtZ - ship.z) * fz;
    const passing = Math.hypot(ship.x + fx * along - yachtX, ship.z + fz * along - yachtZ);
    assert.ok(passing >= LANE_MIN_PASSING - 1 && passing <= LANE_MAX_PASSING + 1, `passes at ${passing.toFixed(0)} m`);
    assert.ok(Math.hypot(ship.x - yachtX, ship.z - yachtZ) > 1400, "a new ship appears far up her lane");
    for (let travelled = 0; travelled < along + 1500; travelled += 50) {
      assert.ok(distanceFromWaterline(ship.x + fx * travelled, ship.z + fz * travelled) > LANE_SHORE_CLEARANCE);
    }
  }
});

test("ships steam on without touching land, keep apart, and slowly swing at anchor", () => {
  const random = seeded(3);
  const ships: Ship[] = SHIP_KINDS.slice(0, 4).map((kind) => createShip(kind, random));
  ships.slice(0, 3).forEach((ship) => assert.ok(planLane(ship, world(), 0, 0, ships, random, true)));
  assert.ok(planAnchorage(ships[3]!, world(), 0, 0, 1, ships, random));
  const anchorX = ships[3]!.x;
  let closest = Infinity;
  for (let step = 0; step < 60 * 400; step += 1) {
    const time = step / 60;
    for (const ship of ships) stepShip(ship, ships, world(time), 1 / 60);
    if (step % 30 !== 0) continue;
    for (const ship of ships) {
      assert.ok(Number.isFinite(ship.x + ship.z + ship.heading + ship.speed));
      assert.ok(distanceFromWaterline(ship.x, ship.z) > ship.halfBeam, `${ship.kind} ran onto an island`);
    }
    for (let a = 0; a < 3; a += 1) {
      for (let b = a + 1; b < 4; b += 1) closest = Math.min(closest, Math.hypot(ships[a]!.x - ships[b]!.x, ships[a]!.z - ships[b]!.z));
    }
  }
  assert.ok(closest > 150, `two ships came within ${closest.toFixed(0)} m`);
  assert.equal(ships[3]!.speed, 0);
  assert.equal(ships[3]!.x, anchorX, "an anchored ship stays put");
  ships.slice(0, 3).forEach((ship) => assert.ok(ship.speed > 4, "under way at service speed"));
});

test("a ship's hull keeps the yacht out, and the wake draws a Kelvin wedge", () => {
  const random = seeded(3);
  const ship = createShip("container", random);
  Object.assign(ship, { x: 0, z: 0, heading: 0, speed: SHIP_SPECS.container.cruiseSpeed, active: true });
  // Waterplane: full beam amidships, closed at the ends.
  assert.equal(hullHalfWidth(ship.halfLength, ship.halfBeam, 0), ship.halfBeam);
  assert.equal(hullHalfWidth(ship.halfLength, ship.halfBeam, ship.halfLength), 0);
  assert.ok(shipHullDistance(ship, 0, 0) < 0 && shipHullDistance(ship, ship.halfBeam + 5, 0) > 4);
  const normal = { x: 0, z: 0 };
  const depth = shipContact(ship, ship.halfBeam - 1, 10, 0.3, normal);
  assert.ok(depth > 1 && normal.x > 0.9, "pushed out through the starboard side");
  assert.equal(shipContact(ship, ship.halfBeam + 3, 0, 0.3, normal), 0);

  // Foam along the arms lies on the Kelvin angle behind the bow (measured
  // astern of the ship, clear of her side and of the turbulent centreline).
  const behind = 400;
  const bowZ = ship.halfLength;
  let best = { x: 0, foam: 0 };
  for (let x = 80; x < 260; x += 0.25) {
    const sample = sampleShipWake(ship, x, bowZ - behind, emptyWakeSample());
    if (sample.foam > best.foam) best = { x, foam: sample.foam };
  }
  const expected = KELVIN_TANGENT * behind + ship.halfBeam * 0.5;
  assert.ok(Math.abs(best.x - expected) < 4, `arm at ${best.x.toFixed(1)} m, expected ${expected.toFixed(1)} m`);
  // Bounded, finite waves everywhere; nothing ahead of the bow; calm when stopped.
  let maxHeight = 0;
  let maxSlope = 0;
  for (let x = -300; x <= 300; x += 7) {
    for (let z = -1500; z <= 300; z += 11) {
      const sample = sampleShipWake(ship, x, z, emptyWakeSample());
      assert.ok(Number.isFinite(sample.height + sample.slopeX + sample.slopeZ + sample.foam + sample.slick));
      maxHeight = Math.max(maxHeight, Math.abs(sample.height));
      maxSlope = Math.max(maxSlope, Math.hypot(sample.slopeX, sample.slopeZ));
    }
  }
  assert.ok(maxHeight > 0.15 && maxHeight < 0.8, `wake height ${maxHeight.toFixed(2)} m`);
  assert.ok(maxSlope < 0.2, `wake slope ${maxSlope.toFixed(3)}`);
  assert.equal(sampleShipWake(ship, 0, bowZ + 40, emptyWakeSample()).height, 0);
  ship.speed = 0;
  const still = sampleShipWake(ship, 30, -200, emptyWakeSample());
  assert.equal(still.height, 0);
  assert.equal(still.slick, 0);
});

test("ships sound the danger signal at a yacht in their path and are replaced once far astern", () => {
  const random = seeded(9);
  const ship = createShip("tanker", random);
  Object.assign(ship, { x: 0, z: 0, heading: 0, speed: 6, active: true, hornCooldown: 0 });
  assert.equal(shipHornSignal(ship, 0, ship.halfLength + 200, random), "danger");
  assert.equal(shipHornSignal(ship, 0, ship.halfLength + 200, random), null, "then waits before signalling again");
  assert.equal(shipOutOfRange(ship, 0, 2000), false, "approaching: kept");
  assert.equal(shipOutOfRange(ship, 0, -3000), true, "far astern and moving away: replaced");
});

const sea: GullWorld = { surfaceHeight: (x, z) => Math.sin(x * 0.2) * 0.4 + Math.cos(z * 0.15) * 0.3, windX: 0.85, windZ: 0.53 };

test("gulls fly forward on coordinated banks and never touch the water unless they mean to", () => {
  const random = seeded(21);
  const vessel = { x: 0, z: 0, heading: 0, speed: 0 };
  const birds = Array.from({ length: 6 }, (_, index) => {
    const state = createGullState(index, random);
    placeGull(state, vessel, index, 6);
    return state;
  });
  const modes = new Set<string>();
  let splashes = 0;
  let previousX = birds.map((bird) => bird.x);
  let previousZ = birds.map((bird) => bird.z);
  for (let step = 0; step < 60 * 600; step += 1) {
    // The yacht sails off after a while, so the birds also follow her.
    if (step > 60 * 300) {
      vessel.speed = 5;
      vessel.z += vessel.speed / 60;
    }
    birds.forEach((bird, index) => {
      const event = stepGull(bird, sea, vessel, birds.filter((other) => other !== bird), 1 / 60, random);
      if (event === "splash") splashes += 1;
      modes.add(bird.mode);
      assert.ok(Number.isFinite(bird.x + bird.y + bird.z + bird.heading + bird.bank + bird.pitch));
      assert.ok(Math.abs(bird.bank) <= GULL_MAX_BANK + 1e-6);
      const surface = sea.surfaceHeight(bird.x, bird.z);
      if (bird.mode !== "dive" && bird.mode !== "rest" && bird.mode !== "takeoff" && bird.mode !== "land") {
        assert.ok(bird.y >= surface + 0.79, `${bird.mode} gull at ${(bird.y - surface).toFixed(2)} m`);
        // Flying birds move along their heading, never backward.
        const moved = (bird.x - previousX[index]!) * Math.sin(bird.heading) + (bird.z - previousZ[index]!) * Math.cos(bird.heading);
        assert.ok(moved > -0.05, "a gull never flies backward");
      }
      if (bird.mode === "rest") assert.ok(Math.abs(bird.y - surface - GULL_FLOAT_HEIGHT) < 0.02, "afloat on the swell");
    });
    previousX = birds.map((bird) => bird.x);
    previousZ = birds.map((bird) => bird.z);
  }
  for (const mode of ["soar", "follow", "skim", "dive", "rest", "takeoff"]) assert.ok(modes.has(mode), `never saw ${mode}`);
  assert.ok(splashes > 0, "dives end in the water");
});

test("a gull on the water takes off, alarmed, when the yacht comes close", () => {
  const random = seeded(4);
  const bird = createGullState(0, random);
  Object.assign(bird, { mode: "rest", modeTime: 0, modeLength: 999, x: 0, z: 0, y: 0, speed: 0.3 });
  const vessel = { x: 0, z: -60, heading: 0, speed: 3 };
  let alarm = false;
  for (let step = 0; step < 60 * 30 && !alarm; step += 1) {
    vessel.z += vessel.speed / 60;
    alarm = stepGull(bird, sea, vessel, [], 1 / 60, random) === "alarm";
  }
  assert.ok(alarm);
  assert.ok(Math.hypot(vessel.x - bird.x, vessel.z - bird.z) <= GULL_ALARM_DISTANCE + vessel.speed * 2 + 0.5);
  for (let step = 0; step < 60 * 6; step += 1) stepGull(bird, sea, vessel, [], 1 / 60, random);
  assert.ok(bird.y > sea.surfaceHeight(bird.x, bird.z) + 2, "airborne after the take-off run");
  assert.ok(bird.flap > 0.3, "flapping hard to climb away");
});

test("loop subdivision rounds a skinned mesh, keeps its colours and normalised weights", () => {
  const source = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const count = source.getAttribute("position").count;
  const colours = new Float32Array(count * 3).map((_, index) => (Math.floor(index / 9) % 2 === 0 ? 1 : 0.2));
  source.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  source.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4).map((_, index) => (index % 4 < 2 ? index % 4 : 0)), 4));
  const weights = new Float32Array(count * 4);
  const position = source.getAttribute("position");
  for (let vertex = 0; vertex < count; vertex += 1) {
    const w = (position.getY(vertex) + 1) / 2;
    weights.set([w, 1 - w, 0, 0], vertex * 4);
  }
  source.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
  const result = subdivideSkinnedLoop(source, Math.PI);
  assert.equal(result.getAttribute("position").count, count * 4);
  const skin = result.getAttribute("skinWeight");
  for (let vertex = 0; vertex < skin.count; vertex += 1) {
    const sum = skin.getX(vertex) + skin.getY(vertex) + skin.getZ(vertex) + skin.getW(vertex);
    assert.ok(Math.abs(sum - 1) < 1e-5);
  }
  // Smoothing pulls the icosahedron's corners in toward a sphere.
  const resultPosition = result.getAttribute("position");
  let spread = 0;
  for (let vertex = 0; vertex < resultPosition.count; vertex += 1) {
    const radius = Math.hypot(resultPosition.getX(vertex), resultPosition.getY(vertex), resultPosition.getZ(vertex));
    assert.ok(radius <= 1 + 1e-6);
    spread = Math.max(spread, 1 - radius);
  }
  assert.ok(spread > 0.05 && spread < 0.4);
  const resultColour = result.getAttribute("color");
  const values = new Set<number>();
  for (let vertex = 0; vertex < resultColour.count; vertex += 1) values.add(Math.round(resultColour.getX(vertex) * 10));
  assert.deepEqual([...values].sort(), [10, 2], "every child triangle keeps its parent's flat colour");
});

test("imported ship models are turned bow to +Z, scaled to the type and floated at their draught, sea plane removed", async () => {
  const M = await import("../../src/simulator/ships/ShipModelMath");
  const { ShipModels } = await import("../../src/simulator/ships/ShipModels");
  // Bow axes map onto +Z under three.js's rotation about +Y.
  for (const bow of ["+x", "-x", "+z", "-z"] as const) {
    const axis = { "+x": new THREE.Vector3(1, 0, 0), "-x": new THREE.Vector3(-1, 0, 0), "+z": new THREE.Vector3(0, 0, 1), "-z": new THREE.Vector3(0, 0, -1) }[bow];
    axis.applyAxisAngle(new THREE.Vector3(0, 1, 0), M.bowYaw(bow));
    assert.ok(axis.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-9, bow);
  }
  // A 40-unit hull along +X, keel at y = 2, on a 200-unit sea plane.
  const scene = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(40, 6, 6), new THREE.MeshStandardMaterial());
  hull.position.set(5, 5, 0);
  hull.name = "Hull";
  const deck = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 5), new THREE.MeshStandardMaterial());
  deck.position.set(5, 8.5, 0);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial());
  sea.name = "Object_12";
  scene.add(hull, deck, sea);
  const models = new ShipModels(() => {});
  const sources = { container: [], tanker: [], cruise: [], bulk: [], carrier: [], lng: [], ferry: [], cargo: [{ url: "cargo.glb", bow: "+x" as const, credit: "test" }] };
  await models.load({ loadAsync: async () => ({ scene }) as never }, sources);
  assert.equal(models.variants("cargo"), 1);
  const ship = models.instance("cargo", 0)!;
  ship.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(ship);
  const spec = SHIP_SPECS.cargo;
  assert.ok(Math.abs(bounds.max.z - bounds.min.z - spec.length) < 1e-6, "as long as the type");
  assert.ok(Math.abs(bounds.min.y + spec.draft) < 1e-6, "keel at the draught");
  assert.ok(Math.abs(bounds.max.x - bounds.min.x - (6 * spec.length) / 40) < 1e-6, "the sea plane is gone");
  assert.ok(Math.abs(bounds.min.z + bounds.max.z) < 1e-6 && Math.abs(bounds.min.x + bounds.max.x) < 1e-6, "centred");
  assert.equal(models.instance("container", 0), null, "a type without a model keeps the procedural ship");
  models.dispose();
});

test("every listed ship model is shipped, credited and fits its type", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { SHIP_MODELS } = await import("../../src/simulator/ships/ShipModelMath");
  const credits = readFileSync(new URL("../../public/models/README.md", import.meta.url), "utf8");
  for (const kind of SHIP_KINDS) {
    for (const source of SHIP_MODELS[kind]) {
      const file = new URL(`../../public${source.url}`, import.meta.url);
      assert.ok(existsSync(file), `${source.url} is missing`);
      const name = source.url.split("/").pop()!;
      assert.ok(credits.includes(name), `${name} has no credit in public/models/README.md`);
      assert.match(source.credit, /CC BY 4\.0/u);
      // A ship model is a few megabytes at most: it loads in the background.
      assert.ok(readFileSync(file).byteLength < 8_000_000, `${name} is too heavy`);
    }
  }
});
