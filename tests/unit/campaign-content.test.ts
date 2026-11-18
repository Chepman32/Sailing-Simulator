import assert from "node:assert/strict";
import test from "node:test";
import { distanceFromWaterline } from "../../src/simulator/environment/IslandMath";
import { buildAtlas, insideOutline, resolvePlace, ringPoints, sectorAt, toWorld } from "../../src/simulator/story/AtlasMath";
import {
  advance,
  applyToState,
  createCampaign,
  objectiveMet,
  openMissions,
  presenceNow,
  restoreCampaign,
  stepOf,
  storyComplete,
  type CampaignState,
  type Facts,
} from "../../src/simulator/story/CampaignMath";
import { OTHER_SPEAKERS } from "../../src/simulator/story/content/cast";
import { CAMPAIGN } from "../../src/simulator/story/content";
import { STORY_LEVELS } from "../../src/simulator/story/levels";
import type { Cutscene, Effect, Mission, Objective, Presence, Step, Text } from "../../src/simulator/story/StoryTypes";
import { cameraFor, ease, sceneLength, shotAt, type AnchorFrame } from "../../src/simulator/story/CutsceneMath";
import { cycleTimeForHour, dayCycleState, DAY_HOLD_SECONDS } from "../../src/simulator/environment/EnvironmentMath";

/**
 * The campaign's data checked as a whole. These are the tests that catch a
 * story edit gone wrong: a name misspelt, a place that moved out of its
 * sector, a mission nobody can reach, a step that can never be done.
 */

const GEAR = new Set(["rifle", "pistol", "knife", "map", "bandage"]);
const LEVELS = new Set(STORY_LEVELS.map((level) => level.id));
const ROSTER = new Set(CAMPAIGN.actors.map((actor) => actor.id));
/** A built level's named point (`level:name`), whose level exists. */
const levelPoint = (name: string) => name.includes(":") && LEVELS.has(name.split(":")[0]!);
const ids = <T extends { id: string }>(list: readonly T[]) => new Set(list.map((entry) => entry.id));
const unique = (label: string, list: readonly { id: string }[]) => assert.equal(ids(list).size, list.length, `${label}: ids are unique`);

function texts(value: unknown, path: string, out: { path: string; text: Text }[]): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.ru === "string" && typeof record.en === "string" && Object.keys(record).length === 2) {
    out.push({ path, text: record as Text });
    return;
  }
  for (const [key, child] of Object.entries(record)) texts(child, `${path}.${key}`, out);
}

function effectsOf(mission: Mission): Effect[] {
  const out: Effect[] = [...(mission.onComplete ?? []), ...(mission.triggers ?? []).flatMap((trigger) => trigger.do), ...(mission.uses ?? []).flatMap((use) => use.do ?? [])];
  for (const step of mission.steps) {
    out.push(...(step.onStart ?? []), ...(step.onComplete ?? []));
    if (step.objective.kind === "disable") out.push(...(step.objective.onLost ?? []));
  }
  return out;
}

function presencesOf(mission: Mission): Presence[] {
  return [...(mission.presence ?? []), ...mission.steps.flatMap((step) => step.presence ?? [])];
}

test("every id is unique and every reference names something that exists", () => {
  const campaign = CAMPAIGN;
  for (const [label, list] of [
    ["factions", campaign.factions],
    ["characters", campaign.characters],
    ["borders", campaign.borders],
    ["sectors", campaign.sectors],
    ["locations", campaign.locations],
    ["chapters", campaign.chapters],
    ["items", campaign.items],
    ["missions", campaign.missions],
    ["world", campaign.world],
  ] as const) {
    unique(label, list);
  }
  const factions = ids(campaign.factions);
  const characters = ids(campaign.characters);
  const speakers = new Set([...characters, ...OTHER_SPEAKERS]);
  const sectors = ids(campaign.sectors);
  const locations = ids(campaign.locations);
  const chapters = ids(campaign.chapters);
  const items = ids(campaign.items);
  const missions = ids(campaign.missions);
  for (const character of campaign.characters) assert.ok(factions.has(character.faction), `${character.id}: faction`);
  for (const sector of campaign.sectors) assert.ok(factions.has(sector.holder), `${sector.id}: holder`);
  for (const location of campaign.locations) assert.ok(sectors.has(location.sector), `${location.id}: sector`);
  for (const chapter of campaign.chapters) assert.ok(sectors.has(chapter.sector), `${chapter.id}: sector`);
  const groupsEverywhere = new Set<string>();
  for (const mission of campaign.missions) for (const presence of presencesOf(mission)) if (presence.kind === "drones") groupsEverywhere.add(presence.group.id);
  for (const rule of campaign.world) for (const presence of rule.presence) if (presence.kind === "drones") groupsEverywhere.add(presence.group.id);

  const checkPresence = (where: string, presence: Presence) => {
    if (presence.kind === "drones") {
      assert.ok(locations.has(presence.group.at), `${where}: drones at ${presence.group.at}`);
      assert.ok(presence.group.count >= 1);
      if (presence.group.behaviour === "pass") assert.ok(presence.group.line, `${where}: a passing drone needs its line`);
    } else if (presence.kind === "item") {
      assert.ok(items.has(presence.item), `${where}: item ${presence.item}`);
      assert.ok(locations.has(presence.at), `${where}: item at ${presence.at}`);
    } else if (presence.kind === "props") {
      assert.ok(locations.has(presence.at), `${where}: props at ${presence.at}`);
    } else if (presence.kind === "level") {
      assert.ok(LEVELS.has(presence.level), `${where}: level ${presence.level}`);
    } else if (presence.kind === "actors") {
      for (const id of presence.ids) assert.ok(ROSTER.has(id), `${where}: actor ${id}`);
    } else {
      assert.ok(characters.has(presence.character), `${where}: npc ${presence.character}`);
      assert.ok(locations.has(presence.at), `${where}: npc at ${presence.at}`);
      if (presence.face) assert.ok(locations.has(presence.face), `${where}: npc faces ${presence.face}`);
    }
  };
  // The cut scenes: unique, with shots, their anchors naming something real.
  unique("cutscenes", campaign.cutscenes);
  const scenes = ids(campaign.cutscenes);
  const anchorOk = (anchor: string) =>
    anchor === "yacht" ||
    anchor === "helm" ||
    anchor === "skipper" ||
    (anchor.startsWith("drone:") && groupsEverywhere.has(anchor.slice(6))) ||
    (anchor.startsWith("npc:") && characters.has(anchor.slice(4))) ||
    (anchor.startsWith("place:") && locations.has(anchor.slice(6))) ||
    (anchor.startsWith("actor:") && ROSTER.has(anchor.slice(6))) ||
    (anchor.startsWith("spot:") && levelPoint(anchor.slice(5)));
  for (const scene of campaign.cutscenes) {
    assert.ok(scene.shots.length > 0, `cutscene ${scene.id}: has shots`);
    for (const [index, shot] of scene.shots.entries()) {
      assert.ok(shot.seconds > 0, `cutscene ${scene.id}/${index}: a length`);
      for (const end of [shot.from, shot.to]) {
        if (!end) continue;
        assert.ok(anchorOk(end.eye.anchor), `cutscene ${scene.id}/${index}: eye on ${end.eye.anchor}`);
        assert.ok(anchorOk(end.look.anchor), `cutscene ${scene.id}/${index}: look at ${end.look.anchor}`);
      }
    }
  }
  for (const rule of campaign.world) {
    assert.ok(missions.has(rule.after), `world ${rule.id}: after ${rule.after}`);
    rule.presence.forEach((presence) => checkPresence(`world ${rule.id}`, presence));
  }

  for (const mission of campaign.missions) {
    const where = `mission ${mission.id}`;
    assert.ok(chapters.has(mission.chapter), `${where}: chapter`);
    assert.ok(sectors.has(mission.sector), `${where}: sector`);
    if (mission.giver) assert.ok(characters.has(mission.giver), `${where}: giver`);
    for (const id of mission.requires) assert.ok(missions.has(id), `${where}: requires ${id}`);
    if (mission.status === "playable") assert.ok(mission.steps.length > 0, `${where}: has steps`);
    const place = (id: string) => locations.has(id) || levelPoint(id);
    unique(`${where} steps`, mission.steps);
    presencesOf(mission).forEach((presence) => checkPresence(where, presence));
    const groups = new Set(presencesOf(mission).flatMap((presence) => (presence.kind === "drones" ? [presence.group.id] : [])));
    for (const step of mission.steps) {
      const at = `${where}/${step.id}`;
      const objective: Objective = step.objective;
      if (objective.kind === "reach") assert.ok(place(objective.at), `${at}: reach ${objective.at}`);
      if (objective.kind === "use") assert.ok((mission.uses ?? []).some((use) => use.id === objective.id), `${at}: use ${objective.id} is one of the mission's`);
      if (objective.kind === "hull" && objective.at) assert.ok(locations.has(objective.at), `${at}: hull at`);
      if (objective.kind === "talk") assert.ok(characters.has(objective.character), `${at}: talk`);
      if (objective.kind === "collect") {
        assert.ok(items.has(objective.item), `${at}: collect`);
        const placed = presencesOf(mission).some((presence) => presence.kind === "item" && presence.item === objective.item);
        assert.ok(placed, `${at}: the item to collect is put somewhere`);
      }
      if (objective.kind === "disable" || objective.kind === "salvage") assert.ok(groups.has(objective.group), `${at}: drones ${objective.group} are in the mission`);
      if (step.marker) {
        if (step.marker === "@yacht") continue;
        if (step.marker.startsWith("@drone:")) assert.ok(groupsEverywhere.has(step.marker.slice(7)), `${at}: marker drone group`);
        else if (step.marker.startsWith("@actor:")) assert.ok(ROSTER.has(step.marker.slice(7)), `${at}: marker actor`);
        else assert.ok(place(step.marker), `${at}: marker ${step.marker}`);
      }
      if (step.checkpoint) {
        assert.ok(place(step.checkpoint.yacht), `${at}: checkpoint`);
        if (step.checkpoint.spot) assert.ok(place(step.checkpoint.spot), `${at}: checkpoint spot`);
      }
      if (objective.kind === "event" && objective.event.startsWith("rammed:")) assert.ok(groups.has(objective.event.slice(7)), `${at}: the rammer is in the mission`);
      if (objective.kind === "event") assert.ok(objective.after !== undefined, `${at}: an event step has a way on if the event never comes`);
    }
    for (const effect of effectsOf(mission)) {
      if (effect.do === "say") for (const line of effect.lines) assert.ok(speakers.has(line.who), `${where}: speaker ${line.who}`);
      if (effect.do === "place") assert.ok(locations.has(effect.yacht), `${where}: place ${effect.yacht}`);
      if (effect.do === "give") assert.ok(items.has(effect.what) || GEAR.has(effect.what), `${where}: give ${effect.what}`);
      if (effect.do === "take") assert.ok(items.has(effect.item), `${where}: take ${effect.item}`);
      if (effect.do === "cutscene") assert.ok(scenes.has(effect.scene), `${where}: cutscene ${effect.scene}`);
      if (effect.do === "look") assert.ok(effect.at.startsWith("npc:") ? characters.has(effect.at.slice(4)) : locations.has(effect.at) || Boolean(levelPoint(effect.at)), `${where}: look at ${effect.at}`);
      if (effect.do === "draw") assert.ok(GEAR.has(effect.gun), `${where}: draw ${effect.gun}`);
      if (effect.do === "actor") {
        assert.ok(ROSTER.has(effect.id), `${where}: actor ${effect.id}`);
        for (const spot of [effect.to, effect.put]) if (spot) assert.ok(levelPoint(spot), `${where}: ${effect.id} to ${spot}`);
        if (effect.face && effect.face !== "skipper") assert.ok(levelPoint(effect.face), `${where}: ${effect.id} faces ${effect.face}`);
      }
      if (effect.do === "switch") assert.ok(levelPoint(effect.name), `${where}: switch ${effect.name}`);
      if (effect.do === "craft" && effect.at) assert.ok(place(effect.at), `${where}: craft at ${effect.at}`);
      if (effect.do === "put") assert.ok(place(effect.at), `${where}: put at ${effect.at}`);
      if (effect.do === "alarm") assert.ok(place(effect.at), `${where}: alarm at ${effect.at}`);
      if (effect.do === "withdraw") assert.ok(groups.has(effect.group) && place(effect.to), `${where}: withdraw ${effect.group}`);
    }
    for (const use of mission.uses ?? []) assert.ok(use.label.ru && use.label.en, `${where}: use ${use.id} labelled`);
  }
});

test("the roster's people stand on a level's spot, speak as someone cast, and the hostile ones number nineteen with the boat's crew", () => {
  const characters = new Set(CAMPAIGN.characters.map((character) => character.id));
  for (const actor of CAMPAIGN.actors) {
    assert.ok(levelPoint(actor.spawn), `${actor.id}: spawns at ${actor.spawn}`);
    if (actor.character) assert.ok(characters.has(actor.character), `${actor.id}: ${actor.character}`);
  }
  assert.equal(ROSTER.size, CAMPAIGN.actors.length, "unique ids");
  // M01: eleven at the post, five with the commander, the commander, and the two of the patrol boat (her crew).
  const hostile = CAMPAIGN.actors.filter((actor) => /^[pide]\d\d$/.test(actor.id)).length + 1 + 2;
  assert.equal(hostile, 19);
  assert.ok(CAMPAIGN.actors.find((actor) => actor.id === "k17")?.immortal, "the commander lives through M01");
});

test("every text is written in Russian and in English", () => {
  const found: { path: string; text: Text }[] = [];
  texts(CAMPAIGN, "campaign", found);
  assert.ok(found.length > 100, `${found.length} texts`);
  for (const { path, text } of found) {
    assert.ok(text.ru.trim().length > 0, `${path}: Russian`);
    assert.ok(text.en.trim().length > 0, `${path}: English`);
    assert.ok(/[а-яё]/i.test(text.ru), `${path}: the Russian is in Russian`);
  }
});

test("missions form a story without loops, and nothing playable waits on something planned", () => {
  const byId = new Map(CAMPAIGN.missions.map((mission) => [mission.id, mission]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    assert.ok(!visiting.has(id), `a loop through ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const need of byId.get(id)!.requires) visit(need);
    visiting.delete(id);
    visited.add(id);
  };
  for (const mission of CAMPAIGN.missions) visit(mission.id);
  for (const mission of CAMPAIGN.missions) {
    if (mission.status !== "playable") continue;
    for (const need of mission.requires) assert.equal(byId.get(need)!.status, "playable", `${mission.id} needs planned ${need}`);
  }
  assert.ok(CAMPAIGN.missions.some((mission) => mission.requires.length === 0 && mission.status === "playable"), "something to start with");
});

test("the sectors tile the quarantine zone like a map: no gaps, no overlaps, each place in its own sector", () => {
  const atlas = buildAtlas(CAMPAIGN);
  // Each ring of borders runs end to end.
  for (const sector of CAMPAIGN.sectors) {
    for (let index = 0; index < sector.ring.length; index += 1) {
      const take = (entry: { border: string; reverse?: boolean }) => {
        const points = CAMPAIGN.borders.find((border) => border.id === entry.border)!.points;
        return entry.reverse ? [...points].reverse() : [...points];
      };
      const here = take(sector.ring[index]!);
      const next = take(sector.ring[(index + 1) % sector.ring.length]!);
      assert.deepEqual(here[here.length - 1], next[0], `${sector.id}: ${sector.ring[index]!.border} joins the next border`);
    }
    assert.ok(ringPoints(CAMPAIGN, sector.ring).length >= 3);
  }
  // Every border is shared by exactly two sides (two sectors, or a sector and the zone's edge).
  for (const border of CAMPAIGN.borders) {
    const uses = CAMPAIGN.sectors.filter((sector) => sector.ring.some((entry) => entry.border === border.id)).length;
    const edge = CAMPAIGN.quarantine.some((entry) => entry.border === border.id) ? 1 : 0;
    assert.equal(uses + edge, 2, `${border.id} divides two sides`);
  }
  // A grid over the zone: every point inside lies in exactly one sector.
  let inside = 0;
  for (let x = atlas.zone.minX; x <= atlas.zone.maxX; x += 97) {
    for (let z = atlas.zone.minZ; z <= atlas.zone.maxZ; z += 97) {
      const holders = atlas.sectors.filter((entry) => insideOutline(entry.outline, x, z)).length;
      if (insideOutline(atlas.zone, x, z)) {
        inside += 1;
        assert.equal(holders, 1, `(${-x}, ${z}) is in ${holders} sectors`);
      } else {
        assert.equal(holders, 0, `(${-x}, ${z}) outside the zone is in a sector`);
      }
    }
  }
  assert.ok(inside > 15000, "a zone of some size");
  // No sector is a ring round another: each touches the zone's edge, but the caldera, which the Wedge leads into.
  for (const sector of CAMPAIGN.sectors) {
    const outer = sector.ring.some((entry) => CAMPAIGN.quarantine.some((edge) => edge.border === entry.border));
    assert.ok(outer || sector.id === "black-caldera", `${sector.id} reaches the open sea`);
  }
  // The places lie in their sectors.
  for (const location of CAMPAIGN.locations) {
    const point = toWorld(location.at);
    assert.equal(sectorAt(atlas, point.x, point.z)?.id, location.sector, `${location.id} is in ${location.sector}`);
  }
  // The start is outside the line.
  const start = toWorld(CAMPAIGN.start.yacht);
  assert.equal(sectorAt(atlas, start.x, start.z), null);
});

test("the story's places are found in the sea: beaches, a porch, open water, a dive within reach", () => {
  for (const location of CAMPAIGN.locations) {
    const place = resolvePlace(location);
    assert.ok(Number.isFinite(place.x) && Number.isFinite(place.z), location.id);
    if (location.snap === "island") {
      assert.ok(place.island, `${location.id}: an island`);
      assert.ok(place.landing, `${location.id}: a beach to land on`);
      assert.ok(distanceFromWaterline(place.landing!.x, place.landing!.z) < -3, `${location.id}: the landing is ashore`);
    }
    if (location.snap === "pier") assert.ok(place.porch && place.landing, `${location.id}: a porch`);
    if (location.snap === "water") assert.ok(distanceFromWaterline(place.x, place.z) > 40, `${location.id}: open water`);
  }
  const at = (id: string) => resolvePlace(CAMPAIGN.locations.find((entry) => entry.id === id)!);
  // The prologue's run: from the south-east, a mile and more to the outer island's reef.
  const start = toWorld(CAMPAIGN.start.yacht);
  const crash = at("crash");
  const run = Math.hypot(crash.x - start.x, crash.z - start.z);
  assert.ok(run > 1100 && run < 2200, `the run to the reef ${run.toFixed(0)} m`);
  assert.ok(distanceFromWaterline(crash.x, crash.z) > 20, "the wreck lies off the beach, in the water");
  // The pass lies between the outpost and the cove, in open water.
  const outpost = at("stvor9");
  const pass = at("m01-pass");
  const cove = at("mark-cove");
  const leg = Math.hypot(cove.x - outpost.x, cove.z - outpost.z);
  assert.ok(Math.hypot(pass.x - outpost.x, pass.z - outpost.z) < leg && Math.hypot(pass.x - cove.x, pass.z - cove.z) < leg, "the pass is on the way");
  assert.ok(distanceFromWaterline(pass.x, pass.z) > 60, "the pass is open water");
  assert.ok(leg > 600 && leg < 1400, `the outpost to the cove ${leg.toFixed(0)} m`);
});

/** Facts that do whatever the current step asks. */
function satisfying(state: CampaignState, mission: Mission, step: Step, time: number): Facts {
  const events = new Set<string>();
  const objective = step.objective;
  const placeOf = (id: string) => {
    // A level's spot: wherever the step wants him to be (the test has no built levels).
    if (id.includes(":")) return { x: 0, z: 0, radius: 5 };
    const location = CAMPAIGN.locations.find((entry) => entry.id === id)!;
    const place = resolvePlace(location);
    return { x: place.x, z: place.z, radius: place.radius };
  };
  let at = { x: 0, z: 0 };
  let aboard = true;
  if (objective.kind === "reach") {
    at = placeOf(objective.at);
    aboard = objective.by !== "foot";
  }
  // A condition about him on foot (in an area of a level) needs him ashore.
  if (objective.kind === "when") aboard = false;
  if (objective.kind === "talk") events.add(`talk:${objective.character}`);
  if (objective.kind === "collect") events.add(`collect:${objective.item}`);
  if (objective.kind === "repair") events.add("repaired");
  if (objective.kind === "disable") events.add(`disabled:${objective.group}`);
  if (objective.kind === "salvage") events.add(`salvaged:${objective.group}`);
  if (objective.kind === "event") events.add(objective.event);
  if (objective.kind === "flag" && !state.flags.includes(objective.flag)) state.flags.push(objective.flag);
  if (objective.kind === "use" && !state.flags.includes(`used:${objective.id}`)) state.flags.push(`used:${objective.id}`);
  return {
    events,
    dialogueIdle: true,
    stepTime: () => time,
    yacht: at,
    skipper: at,
    aboard,
    hull: objective.kind === "hull" ? 0.1 : state.hull,
    cutscene: false,
    place: (id) => placeOf(id),
    // Whatever a condition asks of the world, it is so: in the area, beside the person, at the spot.
    world: { inArea: () => true, actor: () => at, alert: "quiet", health: 1, still: 0, crouched: false },
  };
}

test("the whole story can be played through, and the engine hands out what the steps promise", () => {
  const state = createCampaign();
  const said = new Set<string>();
  const gave = new Set<string>();
  const crafts: string[] = [];
  for (let tick = 0; tick < 600 && !storyComplete(CAMPAIGN, state); tick += 1) {
    const open = openMissions(CAMPAIGN, state).find((mission) => state.missions[mission.id]) ?? openMissions(CAMPAIGN, state)[0]!;
    const step = stepOf(CAMPAIGN, state, open.id);
    const facts = step ? satisfying(state, open, step, 999) : satisfying(state, open, open.steps[0]!, 0);
    const result = advance(CAMPAIGN, state, facts);
    const effects = [...result.effects];
    // A use's effects come with the key press (the story system's), as the step asking for it is met.
    if (step?.objective.kind === "use") {
      const id = step.objective.id;
      for (const effect of open.uses?.find((use) => use.id === id)?.do ?? []) {
        applyToState(state, effect, CAMPAIGN);
        effects.push(effect);
      }
    }
    for (const effect of effects) {
      if (effect.do === "say") for (const line of effect.lines) said.add(line.who);
      if (effect.do === "give") gave.add(effect.what);
      if (effect.do === "craft") crafts.push(effect.craft);
      if (effect.do === "cutscene") {
        for (const shot of CAMPAIGN.cutscenes.find((scene) => scene.id === effect.scene)!.shots) {
          for (const cue of shot.cue ?? []) {
            if (cue.do === "say") for (const line of cue.lines) said.add(line.who);
            applyToState(state, cue, CAMPAIGN);
          }
        }
      }
    }
  }
  assert.ok(storyComplete(CAMPAIGN, state), `the story so far comes to its end (stuck at ${JSON.stringify(state.missions)})`);
  for (const mission of CAMPAIGN.missions) {
    if (mission.status === "playable") assert.ok(state.missions[mission.id]?.done, `${mission.id} done`);
    else assert.equal(state.missions[mission.id], undefined, `${mission.id} is not started`);
  }
  for (const what of ["pistol", "knife", "map"]) assert.ok(gave.has(what), `the ${what} is handed over`);
  assert.deepEqual(crafts.slice(0, 2), ["sport", "skiff"], "the sport yacht in the prologue, the skiff after it");
  assert.equal(state.craft, "skiff", "the skiff is his");
  for (const who of ["hero", "holloway", "maya", "kenji", "sara", "sedov", "commander", "aquilon"]) assert.ok(said.has(who), `${who} speaks`);
  assert.equal(state.engine, true, "the outboard runs");
  assert.equal(state.hull, 1);
  for (const flag of ["m01_beacon_seen", "m01_evidence_copied", "m01_commander_seen", "m01_escape_boat_owned", "arc_kenji_available", "arc_sarah_available", "arc_viktor_available", "arc_mark_available"]) {
    assert.ok(state.flags.includes(flag), flag);
  }
  assert.equal(state.clock, null, "the afternoon runs on its own again");
  // The haven stands afterwards, with Mark and Maya in it.
  assert.ok(presenceNow(CAMPAIGN, state).some((entry) => entry.kind === "actors" && entry.ids.includes("mark-cove")));
  assert.ok(state.checkpoint, "a checkpoint to resume from");
});

test("objectives wait for the world, and a beat waits for its own lines", () => {
  const state = createCampaign();
  const facts: Facts = {
    events: new Set(),
    dialogueIdle: true,
    stepTime: () => 0,
    yacht: { x: 0, z: 0 },
    skipper: { x: 0, z: 0 },
    aboard: false,
    hull: 1,
    cutscene: false,
    place: () => ({ x: 100, z: 0, radius: 20 }),
  };
  assert.equal(objectiveMet({ kind: "listen" }, state, facts, "m"), false, "not on the frame it starts");
  assert.equal(objectiveMet({ kind: "listen" }, state, { ...facts, stepTime: () => 1 }, "m"), true);
  assert.equal(objectiveMet({ kind: "reach", at: "x", by: "foot" }, state, facts, "m"), false);
  assert.equal(objectiveMet({ kind: "reach", at: "x", by: "foot" }, state, { ...facts, skipper: { x: 95, z: 0 } }, "m"), true);
  assert.equal(objectiveMet({ kind: "reach", at: "x", by: "yacht" }, state, { ...facts, yacht: { x: 95, z: 0 } }, "m"), false, "the yacht is there but he is not aboard");
  assert.equal(objectiveMet({ kind: "hull", hull: 0.3, after: 60 }, state, { ...facts, hull: 0.25 }, "m"), true);
  assert.equal(objectiveMet({ kind: "hull", hull: 0.3, after: 60 }, state, facts, "m"), false);
  // A scene is watched to its end (or skipped), never on the frame it starts.
  assert.equal(objectiveMet({ kind: "watch" }, state, { ...facts, stepTime: () => 5, cutscene: true }, "m"), false);
  assert.equal(objectiveMet({ kind: "watch" }, state, { ...facts, stepTime: () => 0.1 }, "m"), false);
  assert.equal(objectiveMet({ kind: "watch" }, state, { ...facts, stepTime: () => 5 }, "m"), true);
  // An event, or its time running out.
  assert.equal(objectiveMet({ kind: "event", event: "rammed:x", after: 12 }, state, { ...facts, stepTime: () => 3 }, "m"), false);
  assert.equal(objectiveMet({ kind: "event", event: "rammed:x", after: 12 }, state, { ...facts, stepTime: () => 3, events: new Set(["rammed:x"]) }, "m"), true);
  assert.equal(objectiveMet({ kind: "event", event: "rammed:x", after: 12 }, state, { ...facts, stepTime: () => 12.5 }, "m"), true);
});

test("a saved game survives the story being rewritten under it", () => {
  const state = restoreCampaign(
    {
      version: 1,
      missions: {
        prologue: { step: "dark", done: true },
        m01: { step: "a-step-that-was-cut", done: false },
        "a-mission-that-was-cut": { step: "x", done: false },
        "arc-kenji": { step: "x", done: false },
      },
      checkpoint: { mission: "m01", step: "no-longer-there" },
      gear: ["pistol", 7, "pistol"],
      items: ["a-thing-that-was-cut"],
      hull: 4,
      engine: false,
      sectors: ["dead-tide", "atlantis"],
      position: { x: 1, z: 2, heading: Number.NaN },
      flags: ["m01_beacon_seen", 3, "down:p01"],
      craft: "submarine",
      clock: 40.75,
    },
    CAMPAIGN,
  );
  assert.equal(state.missions.prologue?.done, true);
  assert.equal(state.missions.m01?.step, "wake", "an unknown step starts the mission over");
  assert.equal(state.missions["a-mission-that-was-cut"], undefined);
  assert.equal(state.missions["arc-kenji"], undefined, "a planned mission is not under way");
  assert.equal(state.checkpoint, null);
  assert.deepEqual(state.gear, ["pistol"]);
  assert.deepEqual(state.items, []);
  assert.equal(state.hull, 1);
  assert.equal(state.engine, false);
  assert.deepEqual(state.sectors, ["dead-tide"]);
  assert.equal(state.position, null);
  assert.deepEqual(state.flags, ["m01_beacon_seen", "down:p01"]);
  assert.equal(state.craft, "catamaran", "an unknown boat is the catamaran");
  assert.equal(state.clock, 16.75);
  // Rubbish is a new campaign.
  assert.deepEqual(restoreCampaign("nonsense", CAMPAIGN), createCampaign());
});

test("a cut scene's camera follows its anchors, eases between its ends, and holds when told", () => {
  const scene: Cutscene = {
    id: "t",
    shots: [
      { seconds: 2, from: { eye: { anchor: "yacht", offset: [0, 5, -10] }, look: { anchor: "yacht" } }, to: { eye: { anchor: "yacht", offset: [10, 5, 0] }, look: { anchor: "yacht" } }, ease: "inOut" },
      { seconds: 1, from: { eye: { anchor: "helm" }, look: { anchor: "yacht", offset: [0, 0, 20] }, fov: 30 } },
    ],
  };
  assert.equal(sceneLength(scene), 3);
  assert.deepEqual(shotAt(scene, 0.5), { index: 0, local: 0.5, progress: 0.25 });
  assert.equal(shotAt(scene, 2.5).index, 1);
  assert.equal(shotAt(scene, 3.5).index, -1, "a scene runs out");
  assert.equal(shotAt({ ...scene, hold: true }, 9).index, 1, "a held scene stays on its last shot");
  // Heading east (π/2): ahead is +x, right is −z.
  const frames = (anchor: string): AnchorFrame | null =>
    anchor === "yacht" ? { x: 100, y: 0, z: 50, heading: Math.PI / 2 } : anchor === "helm" ? { x: 98, y: 3, z: 50, heading: Math.PI / 2 } : null;
  const start = cameraFor(scene.shots[0]!, 0, 0, frames)!;
  assert.ok(Math.abs(start.eye.x - 90) < 1e-9 && Math.abs(start.eye.z - 50) < 1e-9 && start.eye.y === 5, "ten metres astern, five up");
  const end = cameraFor(scene.shots[0]!, 1, 0, frames)!;
  assert.ok(Math.abs(end.eye.x - 100) < 1e-9 && Math.abs(end.eye.z - 40) < 1e-9, "ten metres to starboard");
  const middle = cameraFor(scene.shots[0]!, 0.5, 0, frames)!;
  assert.ok(Math.abs(middle.eye.x - 95) < 1e-9, "half way at half time");
  assert.ok(ease("inOut", 0.25) < 0.25 && ease("out", 0.25) > 0.25 && ease("in", 1) === 1);
  const helm = cameraFor(scene.shots[1]!, 0, 0, frames)!;
  assert.equal(helm.fov, 30);
  assert.ok(Math.abs(helm.look.x - 120) < 1e-9);
  assert.equal(cameraFor({ seconds: 1, from: { eye: { anchor: "drone:x" }, look: { anchor: "yacht" } } }, 0, 0, frames), null, "no camera on what is not there");
});

test("a story's hour sets the day cycle's clock: a low sun at either end of the day, night between", () => {
  assert.equal(cycleTimeForHour(6), 0);
  assert.equal(cycleTimeForHour(12), DAY_HOLD_SECONDS / 2);
  const sunset = dayCycleState(cycleTimeForHour(17.7));
  assert.equal(sunset.progress, 0);
  assert.ok(sunset.sunArc > 0 && sunset.sunArc < 0.15, "a low evening sun");
  assert.ok(dayCycleState(cycleTimeForHour(18.75)).progress > 0.3, "dusk");
  assert.equal(dayCycleState(cycleTimeForHour(0)).progress, 1, "midnight");
  assert.equal(dayCycleState(cycleTimeForHour(3)).progress, 1);
  const dawn = dayCycleState(cycleTimeForHour(5.25)).progress;
  assert.ok(dawn > 0.3 && dawn < 0.7, "dawn");
  assert.ok(dayCycleState(cycleTimeForHour(6.2)).sunArc < 0.1, "first light on the shoal");
  for (let hour = 0; hour < 24; hour += 0.25) assert.ok(Number.isFinite(cycleTimeForHour(hour)));
});

test("every recording the story plays is there: the voices, the scenes' effects, the beds of places", async () => {
  const { existsSync } = await import("node:fs");
  const { VOICE_SECONDS, voiceFor, voiceKey } = await import("../../src/simulator/story/content/voices");
  const file = (clip: string) => `public/audio/story/${clip}.mp3`;
  const clips = new Set<string>(Object.keys(VOICE_SECONDS));
  const effects: Effect[] = [...CAMPAIGN.missions.flatMap(effectsOf), ...CAMPAIGN.cutscenes.flatMap((scene) => scene.shots.flatMap((shot) => shot.cue ?? []))];
  for (const effect of effects) {
    if (effect.do === "sfx") clips.add(effect.clip);
    if (effect.do === "bed" && effect.clip) clips.add(effect.clip);
  }
  for (const mission of CAMPAIGN.missions) for (const step of mission.steps) if (step.bed) clips.add(step.bed);
  for (const clip of clips) assert.ok(existsSync(file(clip)), `${clip} is recorded`);
  for (const [clip, seconds] of Object.entries(VOICE_SECONDS)) assert.ok(seconds > 0.3 && seconds < 15, `${clip}: ${seconds} s`);
  // The words are matched by their letters alone, and the prologue and M01 are spoken.
  assert.equal(voiceKey("Ну что, красавица!"), voiceKey("ну что — красавица"));
  assert.ok(voiceFor("Ну что, красавица! В последний раз проверим, на что ты способна."));
  const voiced = effects.flatMap((effect) => (effect.do === "say" ? effect.lines : [])).filter((line) => voiceFor(line.text.ru)).length;
  assert.ok(voiced > 120, `voiced lines: ${voiced}`);
});
