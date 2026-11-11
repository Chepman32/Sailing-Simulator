import assert from "node:assert/strict";
import test from "node:test";
import { createCampaign } from "../../src/simulator/story/CampaignMath";
import { CAMPAIGN } from "../../src/simulator/story/content";
import {
  decodeSave,
  deleteSave,
  describeSave,
  encodeSave,
  latestSave,
  listSaves,
  readSave,
  saveBlock,
  SAVE_SLOTS,
  SAVE_VERSION,
  writeSave,
  type KeyValueStore,
  type SaveGame,
} from "../../src/simulator/story/SaveGames";

/** A store like localStorage, with a size limit for the full-store case. */
function memoryStore(limit = Infinity): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      const size = [...map.entries()].filter(([entry]) => entry !== key).reduce((sum, [, entry]) => sum + entry.length, 0) + value.length;
      if (size > limit) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key) => void map.delete(key),
  };
}

function aSave(overrides: Partial<SaveGame> = {}): SaveGame {
  const campaign = createCampaign();
  campaign.missions.prologue = { step: "talk", done: true };
  campaign.missions.stranded = { step: "kit", done: false };
  campaign.gear = ["pistol", "knife", "map"];
  campaign.hull = 0.4;
  campaign.rig = false;
  return {
    version: SAVE_VERSION,
    slot: "slot-1",
    savedAt: 1_700_000_000_000,
    campaign,
    pose: { yacht: { x: 5650, z: -6010, heading: 1.2 }, skipper: { x: 5700, z: -5900, yaw: -0.4 } },
    world: { cycleTime: 12, weather: "overcast" },
    thumbnail: "data:image/jpeg;base64,AAAA",
    ...overrides,
  };
}

test("a save goes into its slot and comes back as it was", () => {
  const store = memoryStore();
  const game = aSave();
  assert.ok(writeSave(store, game));
  const back = readSave(store, "slot-1", CAMPAIGN)!;
  assert.deepEqual(back.campaign.missions, game.campaign.missions);
  assert.deepEqual(back.campaign.gear, ["pistol", "knife", "map"]);
  assert.equal(back.campaign.rig, false);
  assert.equal(back.campaign.hull, 0.4);
  assert.deepEqual(back.pose, game.pose);
  assert.deepEqual(back.world, game.world);
  assert.equal(back.thumbnail, game.thumbnail);
  // Each slot is its own.
  assert.equal(readSave(store, "slot-2", CAMPAIGN), null);
  const list = listSaves(store, CAMPAIGN);
  assert.equal(list.length, SAVE_SLOTS.length);
  assert.equal(list.filter(Boolean).length, 1);
  deleteSave(store, "slot-1");
  assert.equal(readSave(store, "slot-1", CAMPAIGN), null);
});

test("a damaged or foreign save is no save, and a doubtful field is dropped, not trusted", () => {
  assert.equal(decodeSave(null, CAMPAIGN), null);
  assert.equal(decodeSave("{nonsense", CAMPAIGN), null);
  assert.equal(decodeSave(JSON.stringify({ ...aSave(), version: 99 }), CAMPAIGN), null, "another version");
  assert.equal(decodeSave(JSON.stringify({ ...aSave(), slot: "slot-9" }), CAMPAIGN), null, "an unknown slot");
  assert.equal(decodeSave(JSON.stringify({ ...aSave(), pose: { yacht: { x: "a", z: 0, heading: 0 } } }), CAMPAIGN), null, "no yacht");
  assert.equal(decodeSave(JSON.stringify({ ...aSave(), campaign: createCampaign() }), CAMPAIGN), null, "nothing begun");
  const odd = decodeSave(
    JSON.stringify({ ...aSave(), thumbnail: "javascript:alert(1)", world: { cycleTime: "noon", weather: "fire" }, pose: { yacht: { x: 1, z: 2, heading: 3 }, skipper: { x: 1 } } }),
    CAMPAIGN,
  )!;
  assert.equal(odd.thumbnail, null);
  assert.deepEqual(odd.world, { cycleTime: 0, weather: null });
  assert.equal(odd.pose.skipper, null, "half a pose on foot is at the wheel");
  // The story rewritten under a save: the campaign is restored the way a live one is.
  const rewritten = decodeSave(JSON.stringify({ ...aSave(), campaign: { missions: { prologue: { step: "gone", done: true }, "cut-mission": { step: "x", done: false } } } }), CAMPAIGN)!;
  assert.deepEqual(Object.keys(rewritten.campaign.missions), ["prologue"]);
});

test("a full store keeps the save without its picture, and says so when even that will not fit", () => {
  const game = aSave({ thumbnail: `data:image/jpeg;base64,${"A".repeat(5000)}` });
  const bare = encodeSave({ ...game, thumbnail: null }).length;
  const tight = memoryStore(bare + 100);
  assert.ok(writeSave(tight, game));
  assert.equal(readSave(tight, "slot-1", CAMPAIGN)!.thumbnail, null);
  assert.equal(writeSave(memoryStore(50), game), false);
});

test("the load menu shows the newest save first and says where in the story each is", () => {
  const older = aSave({ slot: "slot-2", savedAt: 10 });
  const newer = aSave({ slot: "auto", savedAt: 20 });
  assert.equal(latestSave([null, older, newer, null])?.slot, "auto");
  assert.equal(latestSave([null, null]), null);
  const described = describeSave(aSave(), CAMPAIGN);
  const stranded = CAMPAIGN.missions.find((mission) => mission.id === "stranded")!;
  assert.deepEqual(described.mission, stranded.title);
  assert.ok(described.chapter, "the chapter");
  assert.deepEqual(described.goal, stranded.steps.find((step) => step.id === "kit")!.goal ?? null);
  assert.equal(described.done, 1);
  // Everything finished so far: the last mission done.
  const finished = aSave();
  finished.campaign.missions = { prologue: { step: "talk", done: true } };
  assert.deepEqual(describeSave(finished, CAMPAIGN).mission, CAMPAIGN.missions.find((mission) => mission.id === "prologue")!.title);
  assert.equal(describeSave(finished, CAMPAIGN).goal, null);
});

test("a game is saved only at a quiet moment of a campaign", () => {
  const calm = { campaign: true, cinematic: false, frozen: false, fade: 0, attacking: false };
  assert.equal(saveBlock(calm), null);
  assert.equal(saveBlock({ ...calm, campaign: false }), "no-campaign");
  assert.equal(saveBlock({ ...calm, cinematic: true }), "cutscene");
  assert.equal(saveBlock({ ...calm, frozen: true }), "cutscene");
  assert.equal(saveBlock({ ...calm, attacking: true }), "combat");
  assert.equal(saveBlock({ ...calm, fade: 0.8 }), "danger");
});
