import assert from "node:assert/strict";
import test from "node:test";
import { distanceFromWaterline, islandEdgeNoise, islandsInCell, isVolcanoCell, lavaFlowPoint, LAVA_FLOWS, onLavaFlow, shoreClearance, VOLCANO_FOOT, VOLCANO_RIM, volcanoHeight } from "../../src/simulator/environment/IslandMath";
import { createUpgradeLevels, UPGRADES } from "../../src/simulator/economy/EconomyMath";
import {
  CRATE_GOLD,
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
});

test("a crate holds gold or an upgrade not yet at its top", () => {
  const crate = (seed: number): LootItem => ({ key: `c${seed}`, kind: "crate", x: 0, z: 0, seed });
  const levels = createUpgradeLevels();
  let gold = 0;
  let parts = 0;
  const kinds = new Set<string>();
  for (let index = 0; index < 400; index += 1) {
    const contents = lootContents(crate(index / 400), ["white"], levels);
    assert.equal(contents.kind, "crate");
    if (contents.kind !== "crate") continue;
    if (contents.reward === "gold") {
      gold += 1;
      assert.ok(contents.coins >= CRATE_GOLD.min && contents.coins <= CRATE_GOLD.max + 5 && contents.coins % 5 === 0, `round gold (${contents.coins})`);
    } else {
      parts += 1;
      kinds.add(contents.upgrade);
      assert.equal(contents.level, 1);
    }
  }
  assert.ok(parts > 100 && parts < 220, `about two in five hold an upgrade (${parts} of ${gold + parts})`);
  assert.ok(kinds.size >= 5, `many kinds of upgrade (${[...kinds].join(", ")})`);
  // Everything at its top: only gold.
  for (const upgrade of UPGRADES) levels[upgrade.id] = upgrade.max;
  for (let index = 0; index < 50; index += 1) {
    const contents = lootContents(crate(index / 50), ["white"], levels);
    assert.ok(contents.kind === "crate" && contents.reward === "gold");
  }
  // Without the levels (an old caller): gold.
  const plain = lootContents(crate(0.3), ["white"]);
  assert.ok(plain.kind === "crate" && plain.reward === "gold");
});

test("a volcano smokes east of the start; its cone rises to a crater", () => {
  assert.ok(isVolcanoCell(1, 0) && !isVolcanoCell(0, 0));
  // The only one anywhere near the start.
  for (let column = -5; column <= 8; column += 1) {
    for (let row = -6; row <= 7; row += 1) assert.equal(isVolcanoCell(column, row), column === 1 && row === 0);
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

test("the lava tongues down a volcano's flank are no path: the walker is kept off them", () => {
  const volcano = islandsInCell(1, 0).find((island) => island.volcano)!;
  for (let flow = 0; flow < LAVA_FLOWS; flow += 1) {
    for (const t of [0.05, 0.5, 0.95]) {
      const { angle, radial, half } = lavaFlowPoint(volcano, flow, t);
      const radius = volcano.beachRadius * radial * islandEdgeNoise(angle, volcano);
      const x = volcano.centerX + Math.cos(angle) * radius;
      const z = volcano.centerZ + Math.sin(angle) * radius * volcano.scaleZ;
      assert.ok(onLavaFlow(volcano, x, z), `flow ${flow} at ${t}`);
      // Two metres past its edge, across the slope, is bare rock again.
      const acrossX = -Math.sin(angle);
      const acrossZ = Math.cos(angle) * volcano.scaleZ;
      const length = Math.hypot(acrossX, acrossZ);
      const off = half + 2;
      const clear = [-1, 1].some((side) => !onLavaFlow(volcano, x + (acrossX / length) * off * side, z + (acrossZ / length) * off * side));
      assert.ok(clear, `beside flow ${flow} at ${t}`);
    }
  }
  // The beach is never lava, and an ordinary island has none.
  assert.equal(onLavaFlow(volcano, volcano.centerX + volcano.beachRadius * 0.98, volcano.centerZ), false);
  const plain = islandsInCell(0, 0).find((island) => !island.volcano)!;
  assert.equal(onLavaFlow(plain, plain.centerX, plain.centerZ), false);
});

test("volcanoes stand so far apart that two are never in sight at once", async () => {
  const { VOLCANO_DRAW_DISTANCE, VOLCANO_MIN_SPACING, VOLCANO_BLOCK, WORLD_CELL } = await import("../../src/simulator/environment/IslandMath");
  const volcanoes: { x: number; z: number }[] = [];
  const span = VOLCANO_BLOCK * 5;
  for (let column = -span; column <= span; column += 1) {
    for (let row = -span; row <= span; row += 1) {
      if (!isVolcanoCell(column, row)) continue;
      const found = islandsInCell(column, row).filter((island) => island.volcano);
      assert.equal(found.length, 1, `cell ${column}, ${row} holds one volcano`);
      volcanoes.push({ x: found[0]!.centerX, z: found[0]!.centerZ });
    }
  }
  // One to every block: the sea has them all over, a long sail apart.
  assert.ok(volcanoes.length >= 90 && volcanoes.length <= 125, `${volcanoes.length} volcanoes in ${2 * span + 1}² cells`);
  let nearest = Infinity;
  for (let a = 0; a < volcanoes.length; a += 1) {
    for (let b = a + 1; b < volcanoes.length; b += 1) nearest = Math.min(nearest, Math.hypot(volcanoes[a]!.x - volcanoes[b]!.x, volcanoes[a]!.z - volcanoes[b]!.z));
  }
  assert.ok(nearest >= VOLCANO_MIN_SPACING, `two volcanoes ${nearest.toFixed(0)} m apart`);
  // An eye that sees one (it and its plume are drawn to VOLCANO_DRAW_DISTANCE) cannot see another:
  // even standing between two, both would have to be within the drawing range.
  assert.ok(VOLCANO_MIN_SPACING > VOLCANO_DRAW_DISTANCE * 3);
  assert.ok(VOLCANO_MIN_SPACING > 6 * WORLD_CELL);
  // No other island of any cell is a volcano.
  for (let column = -20; column <= 20; column += 1) {
    for (let row = -20; row <= 20; row += 1) {
      if (!isVolcanoCell(column, row)) assert.ok(islandsInCell(column, row).every((island) => !island.volcano));
    }
  }
});
