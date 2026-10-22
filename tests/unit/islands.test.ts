import assert from "node:assert/strict";
import test from "node:test";
import {
  BEACH_START,
  ISLANDS,
  LANDMARKS,
  MAX_VISIBLE_TERRAIN_RADIUS_SCALE,
  islandHeight,
  isPlantable,
} from "../../src/simulator/environment/IslandShape";

function peak(index: number): number {
  let highest = Number.NEGATIVE_INFINITY;
  for (let radial = 0; radial < 1; radial += 0.02) {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.1) highest = Math.max(highest, islandHeight(ISLANDS[index], radial, angle));
  }
  return highest;
}

test("islands have distinct relief: volcanic peak, hills, and a low cay", () => {
  const [volcanic, hills, cay] = [peak(0), peak(1), peak(2)];
  assert.ok(volcanic > 15, `volcano too low: ${volcanic}`);
  assert.ok(hills > 6 && hills < volcanic, `hills out of range: ${hills}`);
  assert.ok(cay < 3.5, `cay should stay low: ${cay}`);
  assert.ok(islandHeight(ISLANDS[0], 0, 0) < peak(0) - 1.5, "the volcano has a summit crater");
});

test("every island meets the sea with a beach and a submerged apron", () => {
  ISLANDS.forEach((island) => {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
      const beach = islandHeight(island, BEACH_START + 0.05, angle);
      assert.ok(beach > -0.1 && beach < 0.5, `${island.name} beach height ${beach}`);
      assert.ok(islandHeight(island, 1.02, angle) < 0, "the waterline sits at the nominal beach radius");
      assert.ok(islandHeight(island, MAX_VISIBLE_TERRAIN_RADIUS_SCALE, angle) < -0.3);
    }
  });
});

test("landmarks stand on land, the pier reaches the water, palms avoid the beach and cliffs", () => {
  LANDMARKS.filter((landmark) => landmark.kind === "lighthouse" || landmark.kind === "hut").forEach((landmark) => {
    assert.ok(islandHeight(ISLANDS[landmark.island], landmark.radial, landmark.angle) > 0.8, landmark.id);
  });
  const pier = LANDMARKS.find((landmark) => landmark.kind === "pier");
  assert.ok(pier && islandHeight(ISLANDS[pier.island], pier.radial, pier.angle) < 0.2);
  assert.equal(isPlantable(ISLANDS[0], 0.98, 0), false, "no palms in the surf");
  assert.equal(isPlantable(ISLANDS[0], 0.02, 0), false, "no palms in the crater");
});
