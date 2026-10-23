import assert from "node:assert/strict";
import test from "node:test";
import { ExplorationFog, FOG_CELL, FOG_CHUNK, MAX_FOG_CHUNKS } from "../../src/simulator/navigation/Exploration";

test("sailing reveals a disc of sea for the chart, across chunk borders and negative coordinates", () => {
  const fog = new ExplorationFog();
  assert.equal(fog.isExplored(0, 0), false);
  const revealed = fog.reveal(0, 0, 360);
  // About π·r² / cell² cells.
  assert.ok(Math.abs(revealed - (Math.PI * 360 * 360) / (FOG_CELL * FOG_CELL)) < 30, `${revealed}`);
  assert.equal(fog.reveal(0, 0, 360), 0, "seeing the same water again adds nothing");
  assert.ok(fog.isExplored(-300, 10) && fog.isExplored(200, -250));
  assert.ok(!fog.isExplored(500, 0) && !fog.isExplored(0, -420));
  assert.equal(fog.chunkCount, 4, "the disc at the origin spans four chunks");
});

test("the fog round-trips through storage and ignores damaged entries", () => {
  const fog = new ExplorationFog();
  fog.reveal(-5000, 7300, 300);
  fog.reveal(12000, -40, 300);
  const text = fog.serialize();
  const restored = ExplorationFog.parse(text);
  for (const [x, z] of [[-5000, 7300], [12000, -40], [-5250, 7300], [0, 0]]) {
    assert.equal(restored.isExplored(x, z), fog.isExplored(x, z), `${x}, ${z}`);
  }
  assert.equal(ExplorationFog.parse("garbage;1,2:@@@;3,4:AAAA").chunkCount, 0);
  assert.equal(ExplorationFog.parse(null).chunkCount, 0);
});

test("an endless voyage keeps the fog store bounded, forgetting the oldest water first", () => {
  const fog = new ExplorationFog();
  const span = FOG_CELL * FOG_CHUNK;
  for (let step = 0; step < MAX_FOG_CHUNKS + 40; step += 1) fog.reveal(step * span + span / 2, span / 2, 40);
  assert.equal(fog.chunkCount, MAX_FOG_CHUNKS);
  assert.ok(!fog.isExplored(span / 2, span / 2), "the first water seen was forgotten");
  assert.ok(fog.isExplored((MAX_FOG_CHUNKS + 39) * span + span / 2, span / 2));
  assert.ok(fog.serialize().length < 260_000, "fits comfortably in local storage");
});
