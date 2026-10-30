import assert from "node:assert/strict";
import test from "node:test";
import { distanceFromWaterline, islandsInCell, isVolcanoCell, shoreClearance, VOLCANO_FOOT, VOLCANO_RIM, volcanoHeight } from "../../src/simulator/environment/IslandMath";
import {
  LOOT_RANGE,
  LOOT_SHORE_CLEARANCE,
  lootAround,
  lootContents,
  SAIL_COLOR_IDS,
  withinReach,
  type LootItem,
} from "../../src/simulator/effects/LootMath";
import { DISCOVERY_RANGE, nearestPoiClearance, POI_CLEARANCE, poiClearance, poisAround, type Poi } from "../../src/simulator/effects/PoiMath";
import {
  ashPuff,
  bombFlight,
  craterGlow,
  ERUPTION_COOLDOWN_MAX,
  ERUPTION_COOLDOWN_MIN,
  eruptionAt,
  eruptionStart,
  FIRST_ERUPTION_MAX,
  FIRST_ERUPTION_MIN,
  fountainActivity,
  plumePuff,
  PRECURSOR_SECONDS,
  precursorAt,
  volcanoTremor,
} from "../../src/simulator/effects/VolcanoMath";

/** Seconds of fountain counted per eruption by the sampling below (the fountain's audible life). */
const ERUPTION_LENGTH_SECONDS = 10;
import { findOpenWater, RESCUE_CLEARANCE } from "../../src/simulator/vessel/RescueMath";
import { composeJig, drunkenSailor } from "../../src/simulator/audio/MusicMath";
import { RADIO_STATIONS } from "../../src/simulator/audio/RadioSystem";

const open = (x: number, z: number): boolean => distanceFromWaterline(x, z) > LOOT_SHORE_CLEARANCE;

test("things afloat lie in open water, the same every visit, and stay gone once picked up", () => {
  const first = lootAround(0, -330, LOOT_RANGE, new Set(), open);
  const again = lootAround(0, -330, LOOT_RANGE, new Set(), open);
  assert.ok(first.length >= 3, `something to find near the start (${first.length})`);
  assert.deepEqual(first, again);
  for (const item of first) assert.ok(distanceFromWaterline(item.x, item.z) > LOOT_SHORE_CLEARANCE);
  const kinds = new Set(lootAround(0, 0, 2500, new Set(), open).map((item) => item.kind));
  assert.deepEqual([...kinds].sort(), ["bottle", "crate", "flamingo"]);
  const taken = new Set([first[0]!.key]);
  assert.ok(!lootAround(0, -330, LOOT_RANGE, taken, open).some((item) => item.key === first[0]!.key));
});

test("a thing is hauled aboard only alongside the hulls", () => {
  // Heading 0: bow toward +Z, the hulls about ±2 m across and ±5.4 m along.
  assert.ok(withinReach(0, 0, 0, 4.5, 0), "just off the side");
  assert.ok(withinReach(0, 0, 0, 0, 8), "just off the bow");
  assert.ok(!withinReach(0, 0, 0, 9, 0), "out of reach abeam");
  assert.ok(withinReach(0, 0, Math.PI / 2, 8, 0), "turned: now ahead");
});

test("bottles hold sail colours until all are found, then messages", () => {
  const bottle = (seed: number): LootItem => ({ key: `b${seed}`, kind: "bottle", x: 0, z: 0, seed });
  let colours = 0;
  for (let index = 0; index < 200; index += 1) {
    const contents = lootContents(bottle(index / 200), ["white"]);
    if (contents.kind === "bottle" && "sailColor" in contents) colours += 1;
  }
  assert.ok(colours > 30 && colours < 120, `about a third give a colour (${colours})`);
  const all = SAIL_COLOR_IDS;
  for (let index = 0; index < 50; index += 1) {
    const contents = lootContents(bottle(index / 50), all);
    assert.ok(contents.kind === "bottle" && "message" in contents, "nothing left to unlock: a message");
  }
  const crate = lootContents({ key: "c", kind: "crate", x: 0, z: 0, seed: 0.3 }, ["white"]);
  assert.ok(crate.kind === "crate" && crate.coins >= 5);
});

test("a volcano smokes east of the start; its cone rises to a crater", () => {
  assert.ok(isVolcanoCell(1, 0) && !isVolcanoCell(0, 0));
  // The only one in the sea.
  for (let column = -12; column <= 12; column += 1) {
    for (let row = -12; row <= 12; row += 1) assert.equal(isVolcanoCell(column, row), column === 1 && row === 0);
  }
  const volcano = islandsInCell(1, 0).find((island) => island.volcano);
  assert.ok(volcano, "the cell east of the start holds a volcano");
  assert.ok(volcano.height > 60 && volcano.beachRadius >= 150);
  const rim = volcanoHeight(VOLCANO_RIM, 0, volcano.height, volcano.seed);
  const crater = volcanoHeight(0, 0, volcano.height, volcano.seed);
  const flank = volcanoHeight((VOLCANO_RIM + VOLCANO_FOOT) / 2, 0, volcano.height, volcano.seed);
  assert.ok(rim > flank && flank > volcanoHeight(VOLCANO_FOOT, 0, volcano.height, volcano.seed));
  assert.ok(crater < rim - 5, "a crater, not a peak");
  // Rare: six to ten minutes apart, the first a few minutes in, each one warned of.
  const seed = volcano.seed;
  assert.ok(eruptionStart(0, seed) >= FIRST_ERUPTION_MIN && eruptionStart(0, seed) <= FIRST_ERUPTION_MAX);
  for (let index = 1; index < 30; index += 1) {
    const quiet = eruptionStart(index, seed) - eruptionStart(index - 1, seed);
    assert.ok(quiet >= ERUPTION_COOLDOWN_MIN && quiet <= ERUPTION_COOLDOWN_MAX, `quiet ${quiet.toFixed(0)} s`);
  }
  const state = { age: -1, strength: 0, slot: 0 };
  const start = eruptionStart(3, seed);
  assert.ok(precursorAt(start - PRECURSOR_SECONDS - 5, seed) === 0, "quiet before the warning");
  assert.ok(precursorAt(start - 10, seed) > 0.5, "smoke and rumble in the last half minute");
  eruptionAt(start - 1, seed, state);
  assert.ok(state.age < 0 || state.slot !== 3);
  eruptionAt(start + 2, seed, state);
  assert.equal(state.slot, 3);
  assert.ok(fountainActivity(state) > 0.3, "then it erupts");
  let erupting = 0;
  const span = 3600 * 3;
  for (let time = 0; time < span; time += 1) {
    eruptionAt(time, seed, state);
    if (fountainActivity(state) > 0.05) erupting += 1;
  }
  const perHour = (erupting / ERUPTION_LENGTH_SECONDS) / 3;
  assert.ok(perHour > 5 && perHour < 11, `six to ten an hour (${perHour.toFixed(1)})`);
  assert.ok(volcanoTremor(1, 0, -1, 200) > volcanoTremor(1, 0, -1, 1500) && volcanoTremor(1, 0, -1, 2500) === 0, "felt near, not far");
  assert.ok(craterGlow(10, { age: 2, strength: 1, slot: 0 }) > craterGlow(10, { age: -1, strength: 0, slot: 0 }) * 1.5);
  const point = { x: 0, y: 0, z: 0, radius: 0, opacity: 0 };
  plumePuff(60, 0.3, 5, 0, point);
  assert.ok(point.y > 150 && point.x > 150, "the plume rises and leans downwind");
  // The ash column climbs hundreds of metres, widening, and the wind takes its top.
  const ash = { x: 0, y: 0, z: 0, radius: 0, opacity: 0, fresh: 0 };
  ashPuff(30, 10, 3, 1, 6, 0, ash);
  assert.ok(ash.y > 350 && ash.radius > 50, `ash column (${ash.y.toFixed(0)} m, r ${ash.radius.toFixed(0)})`);
  // Each puff spreads its own way in the umbrella; the cloud as a whole goes downwind.
  let downwind = 0;
  for (let index = 0; index < 40; index += 1) downwind += ashPuff(30, index, 3, 1, 6, 0, ash).x / 40;
  assert.ok(downwind > 60, `the ash cloud drifts downwind (${downwind.toFixed(0)} m)`);
  const ember = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 };
  assert.ok(bombFlight(9, 3, 7, ember) && ember.t >= 0, "bombs fly up out of the crater");
  bombFlight(1e3, 3, 7, ember);
  assert.ok(ember.vy + 9.81 * ember.t > 30, "at tens of metres a second");
});

test("the barge, the wreck and the monolith lie in open water near the start and are obstacles", () => {
  const isOpen = (x: number, z: number): boolean => distanceFromWaterline(x, z) > POI_CLEARANCE;
  const places = poisAround(0, -330, 1500, isOpen);
  assert.deepEqual(places.map((poi) => poi.kind).sort(), ["barge", "monolith", "wreck"]);
  for (const poi of places) assert.ok(isOpen(poi.x, poi.z));
  const barge: Poi = { id: "b", kind: "barge", x: 0, z: 0, heading: 0 };
  const normal = { x: 0, z: 0 };
  assert.ok(Math.abs(poiClearance(barge, 10, 0, normal) - 4) < 1e-6 && normal.x > 0.99, "4 m off her side");
  assert.ok(poiClearance(barge, 0, 0, normal) < 0, "inside the footprint");
  assert.equal(nearestPoiClearance([barge], 900, 0, normal), 1e6);
  assert.ok(DISCOVERY_RANGE.volcano > DISCOVERY_RANGE.monolith);
});

test("a stuck yacht is towed to the nearest open water, pointing away from the obstacle", () => {
  // Hard against the first home island's beach.
  const island = islandsInCell(0, 0)[0]!;
  const x = island.centerX + island.beachRadius + 1;
  const z = island.centerZ;
  const spot = findOpenWater(x, z, shoreClearance);
  assert.ok(spot);
  const normal = { x: 0, z: 0 };
  assert.ok(shoreClearance(spot.x, spot.z, normal) >= RESCUE_CLEARANCE);
  assert.ok(Math.hypot(spot.x - x, spot.z - z) < 120, "nearby, not far away");
  assert.ok(Math.sin(spot.heading) * normal.x + Math.cos(spot.heading) * normal.z > 0.9, "bow toward open water");
});

test("the radio's music: a shanty and jigs that fit their bars, and four stations", () => {
  const sailor = drunkenSailor();
  assert.equal(sailor.length, 64, "sixteen bars of four");
  assert.equal(sailor.chords.length, 16);
  for (const seed of [1, 2, 3, 99]) {
    const jig = composeJig(seed);
    assert.equal(jig.length, 48);
    for (const note of jig.melody) assert.ok(note.beat >= 0 && note.beat < jig.length && note.midi > 40 && note.midi < 100);
  }
  assert.notDeepEqual(composeJig(1).melody, composeJig(2).melody);
  assert.deepEqual(RADIO_STATIONS.map((station) => station.id), ["lofi", "synthwave", "reggae", "shanty"]);
  for (const station of RADIO_STATIONS) {
    for (const url of station.streams) assert.ok(url.startsWith("https://"), "secure streams only");
  }
});
