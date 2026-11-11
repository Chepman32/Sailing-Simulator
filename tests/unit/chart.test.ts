import assert from "node:assert/strict";
import test from "node:test";
import { ExploredSea, FOG_CELL, SIGHT_RANGE, Track, TRACK_STEP } from "../../src/simulator/map/ChartMath";
import { islandsInCell, START_ISLANDS } from "../../src/simulator/environment/IslandMath";
import { hillHeight, islandClearings, islandProfile, pierClearance } from "../../src/simulator/environment/IslandProps";
import { jibSheetAngle } from "../../src/simulator/vessel/JibSail";

test("chart: the fog lifts around the yacht, only once per cell, and survives a save", () => {
  const sea = new ExploredSea();
  assert.equal(sea.reveal(0, 0), true);
  const first = sea.cells.size;
  // About the disc of sight, in cells.
  const expected = (Math.PI * SIGHT_RANGE * SIGHT_RANGE) / (FOG_CELL * FOG_CELL);
  assert.ok(first > expected * 0.8 && first < expected * 1.6, `${first} cells for a disc of ~${expected.toFixed(0)}`);
  assert.equal(sea.reveal(10, 10), false, "same cell: nothing new");
  assert.ok(sea.seen(SIGHT_RANGE * 0.6, 0) && !sea.seen(SIGHT_RANGE * 2, 0));
  for (let x = 0; x < 6000; x += 40) sea.reveal(x, Math.sin(x / 900) * 700);
  const text = sea.serialize();
  const copy = new ExploredSea();
  copy.restore(text);
  assert.equal(copy.cells.size, sea.cells.size);
  for (const key of sea.cells) assert.ok(copy.cells.has(key));
  // Runs keep the saved form small: a few bytes a cell at most.
  assert.ok(text.length < sea.cells.size * 4, `${text.length} characters for ${sea.cells.size} cells`);
  copy.restore("garbage;;1,zz,;");
  assert.ok(copy.cells.size <= 2);
});

test("chart: the track takes a point every few tens of metres and breaks at a jump", () => {
  const track = new Track();
  for (let x = 0; x <= 300; x += 1) track.add(x, 0);
  const points = track.points.length / 2;
  assert.ok(points >= 300 / TRACK_STEP - 1 && points <= 300 / TRACK_STEP + 2);
  track.add(5000, 5000);
  assert.ok(track.points.some((value) => Number.isNaN(value)));
});

test("islands: each has a lasting character; the start shows a pier, a hut and a lighthouse", () => {
  const home = islandsInCell(0, 0).slice(0, 3);
  const profiles = home.map((island) => islandProfile(island));
  assert.notEqual(profiles[0]!.pierAngle, null, "the first home island has a pier");
  assert.notEqual(profiles[1]!.lighthouseAngle, null, "the second has a lighthouse");
  assert.deepEqual(islandProfile(home[0]!), profiles[0], "decided by the island alone");
  // Across the archipelago, more than one kind of island.
  const kinds = new Set(START_ISLANDS.map((island) => islandProfile(island).character));
  assert.ok(kinds.size >= 3, [...kinds].join(", "));
  // Hills rise inland and never reach the beach.
  const hilly = START_ISLANDS.map((island) => ({ island, profile: islandProfile(island) })).find(({ profile }) => profile.hills.length > 0)!;
  const hill = hilly.profile.hills[0]!;
  assert.ok(hillHeight(hilly.profile, hill.x, hill.z, 0.2) > 0.5);
  assert.equal(hillHeight(hilly.profile, hill.x, hill.z, 0.9), 0);
  // Nothing grows where the hut and the lighthouse stand.
  assert.ok(islandClearings(home[0]!, profiles[0]!).length >= 2);
  assert.equal(islandProfile({ ...home[0]!, volcano: true }).pierAngle, null, "no pier on a volcano");
});

test("islands: a pier's footprint keeps the yacht off it from every side", () => {
  const pier = { x: 0, z: 0, dirX: 1, dirZ: 0, length: 20, halfWidth: 2 };
  const normal = { x: 0, z: 0 };
  assert.ok(pierClearance(pier, 10, 0, normal) < 0, "inside");
  const side = pierClearance(pier, 10, 7, normal);
  assert.ok(Math.abs(side - 5) < 1e-9 && Math.abs(normal.z - 1) < 1e-9);
  const end = pierClearance(pier, 26, 0, normal);
  assert.ok(Math.abs(end - 6) < 1e-9 && Math.abs(normal.x - 1) < 1e-9);
  const corner = pierClearance(pier, 23, 6, normal);
  assert.ok(Math.abs(corner - 5) < 1e-9 && normal.x > 0 && normal.z > 0);
});

test("the jib sheets a little closer than the main and never beyond its leads", () => {
  assert.ok(jibSheetAngle(0.24) < 0.3);
  assert.ok(jibSheetAngle(1.5) <= 0.85);
  assert.ok(jibSheetAngle(0.8) < 0.8);
  assert.ok(jibSheetAngle(0) >= 0.17);
});
