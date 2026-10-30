import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  bagByKind,
  bagValue,
  DECOR,
  engineBoost,
  FIND_CELL,
  FIND_TIER,
  findsInCell,
  flareBoost,
  gearBoost,
  monitorFeatures,
  restoreEconomy,
  sonarDepth,
  sonarRange,
  sonarRevealsTier,
  TIER_VALUE,
  totalUpgradeCost,
  UPGRADES,
  upgradePrice,
  type SeabedFind,
} from "../../src/simulator/economy/EconomyMath";
import { SeabedLoot, SONAR_LIMIT } from "../../src/simulator/economy/SeabedLoot";
import { UnderwaterLight } from "../../src/simulator/environment/UnderwaterLight";

test("upgrade prices grow by 1.65 a level", () => {
  assert.equal(upgradePrice(100, 0), 100);
  assert.equal(upgradePrice(100, 1), 165);
  assert.equal(upgradePrice(100, 2), 272);
  for (const upgrade of UPGRADES) {
    for (let level = 1; level < upgrade.max; level += 1) {
      const ratio = upgradePrice(upgrade.base, level) / upgradePrice(upgrade.base, level - 1);
      assert.ok(Math.abs(ratio - 1.65) < 0.02, `${upgrade.id} level ${level}: ×${ratio.toFixed(3)}`);
    }
  }
  assert.equal(totalUpgradeCost(100, 3), 100 + 165 + 272);
});

test("the first steps are a swim or two away, the top levels want expeditions", () => {
  // A shallow swim brings up a handful of tier-1 finds (10–40 gold each).
  const shallowDive = 8 * 25;
  for (const upgrade of UPGRADES) {
    assert.ok(upgradePrice(upgrade.base, 0) <= shallowDive, `${upgrade.id} level 1 costs ${upgradePrice(upgrade.base, 0)}`);
  }
  assert.ok(Math.min(...DECOR.map((item) => item.price)) <= shallowDive);
  assert.ok(DECOR.filter((item) => item.price <= 2 * shallowDive).length >= 6, "most decor within two dives");
  // The top of the engine and the sonar is worth several chests (500–1500 each).
  const engine = UPGRADES.find((upgrade) => upgrade.id === "engine")!;
  const sonar = UPGRADES.find((upgrade) => upgrade.id === "sonar")!;
  assert.ok(upgradePrice(engine.base, engine.max - 1) > 5 * 1500);
  assert.ok(upgradePrice(sonar.base, sonar.max - 1) > 3 * 1500);
});

test("what each level buys only ever improves", () => {
  for (let level = 1; level <= 10; level += 1) {
    assert.ok(engineBoost(level).thrust > engineBoost(level - 1).thrust);
    assert.ok(flareBoost(level).reach > flareBoost(level - 1).reach);
    assert.ok(sonarRange(level) > sonarRange(level - 1));
    assert.ok(sonarDepth(level) > sonarDepth(level - 1));
  }
  const gear = gearBoost(3, 3, 3);
  assert.ok(gear.air > 1 && gear.swim > 1 && gear.torch > 1);
  assert.deepEqual(engineBoost(0), { thrust: 1, fade: 1, response: 1 });
  // The sonar marks chests first, then artefacts, then everything.
  assert.equal(sonarRevealsTier(0, 3), false);
  assert.equal(sonarRevealsTier(1, 3), true);
  assert.equal(sonarRevealsTier(1, 2), false);
  assert.equal(sonarRevealsTier(3, 2), true);
  assert.equal(sonarRevealsTier(5, 1), false);
  assert.equal(sonarRevealsTier(6, 1), true);
  assert.equal(monitorFeatures(0).wide, false);
  assert.equal(monitorFeatures(1).wide, true);
  assert.equal(monitorFeatures(2).depthMap, true);
  assert.equal(monitorFeatures(4).relief, true);
});

/** Every find of the cells in a square of side `cells`, at a given depth and reef. */
function sample(depth: number, reef: number, cells = 30): SeabedFind[] {
  const out: SeabedFind[] = [];
  const scratch: SeabedFind[] = [];
  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) out.push(...findsInCell(column + 100, row - 40, () => depth, () => reef, scratch).map((find) => ({ ...find })));
  }
  return out;
}

test("the sea floor's finds: deterministic, inside their cells, worth their tier", () => {
  const first = sample(14, 0.4, 6);
  const again = sample(14, 0.4, 6);
  assert.deepEqual(first, again);
  assert.equal(new Set(first.map((find) => find.key)).size, first.length, "keys are unique");
  for (const find of first) {
    const [low, high] = TIER_VALUE[find.tier];
    assert.equal(FIND_TIER[find.kind], find.tier);
    assert.ok(find.value >= low && find.value <= high, `${find.kind} ${find.value}`);
    const column = Math.floor(find.x / FIND_CELL);
    const row = Math.floor(find.z / FIND_CELL);
    assert.ok(column >= 100 && column < 106 && row >= -40 && row < -34);
  }
});

test("chests lie deep or among the reefs, never in the shallows; junk is everywhere", () => {
  const shallow = sample(3, 0);
  const deep = sample(20, 0.2);
  assert.ok(shallow.length > 900 * 1.5, "a pocketful of junk on every patch of sand");
  assert.equal(shallow.filter((find) => find.tier === 3).length, 0);
  const chests = deep.filter((find) => find.tier === 3).length;
  assert.ok(chests > 4 && chests < 120, `${chests} chests in 900 deep cells`);
  const artefactsDeep = deep.filter((find) => find.tier === 2).length;
  const artefactsShallow = shallow.filter((find) => find.tier === 2).length;
  assert.ok(artefactsDeep > artefactsShallow, "artefacts are commoner in deep water");
  // Nothing on dry land.
  assert.equal(sample(-1, 0, 4).length, 0);
});

test("a saved economy is checked field by field", () => {
  const restored = restoreEconomy({
    upgrades: { engine: 3.7, sonar: 999, flare: -2, bogus: 4, monitor: "x" },
    bag: [{ kind: "shell", value: 21.6 }, { kind: "dragon", value: 4 }, null, { kind: "chest", value: Number.NaN }],
    decor: ["flag-jolly", "flag-jolly", "unknown", 7],
    equipped: { flag: "flag-jolly", charm: "charm-pearl", bobble: "flag-jolly" },
    taken: ["a", 3, "b"],
  });
  assert.equal(restored.upgrades.engine, 3);
  assert.equal(restored.upgrades.sonar, UPGRADES.find((upgrade) => upgrade.id === "sonar")!.max);
  assert.equal(restored.upgrades.flare, 0);
  assert.equal(restored.upgrades.monitor, 0);
  assert.deepEqual(restored.bag, [{ kind: "shell", value: 22 }]);
  assert.deepEqual(restored.decor, ["flag-jolly"]);
  // Only owned decor, in its own slot, can be up.
  assert.deepEqual(restored.equipped, { flag: "flag-jolly", charm: null, bobble: null });
  assert.deepEqual(restored.taken, ["a", "b"]);
  assert.deepEqual(restoreEconomy("garbage").bag, []);
  assert.equal(bagValue([{ kind: "shell", value: 10 }, { kind: "shell", value: 15 }, { kind: "amphora", value: 200 }]), 225);
  assert.deepEqual(bagByKind([{ kind: "shell", value: 10 }, { kind: "amphora", value: 200 }, { kind: "shell", value: 15 }]), [
    { kind: "shell", count: 2, total: 25 },
    { kind: "amphora", count: 1, total: 200 },
  ]);
});

test("the sonar shows a few dozen echoes, the most valuable and nearest first", () => {
  const scene = new THREE.Scene();
  const loot = new SeabedLoot(scene, new UnderwaterLight(), { depth: () => 20, reef: () => 0.7, ground: () => -20 }, new Set());
  const contacts = loot.scan(0, 0, sonarRange(6), sonarDepth(6), 6);
  assert.equal(contacts.length, SONAR_LIMIT);
  // Sorted by tier, then distance.
  for (let index = 1; index < contacts.length; index += 1) {
    const a = contacts[index - 1]!;
    const b = contacts[index]!;
    assert.ok(a.tier > b.tier || (a.tier === b.tier && Math.hypot(a.x, a.z) <= Math.hypot(b.x, b.z) + 1e-9));
  }
  // At the first level only chests, within its range and depth.
  const chests = loot.scan(0, 0, sonarRange(1), sonarDepth(1), 1);
  assert.ok(chests.every((contact) => contact.tier === 3 && Math.hypot(contact.x, contact.z) <= sonarRange(1)));
  // Too deep for a first-level sonar: nothing.
  const deepLoot = new SeabedLoot(scene, new UnderwaterLight(), { depth: () => 23.5, reef: () => 0.7, ground: () => -23.5 }, new Set());
  assert.equal(deepLoot.scan(0, 0, sonarRange(1), sonarDepth(1), 1).length, 0);
  loot.dispose();
  deepLoot.dispose();
});
