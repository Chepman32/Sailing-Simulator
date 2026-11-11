import type { Campaign, Effect, Mission, Objective, Presence, Step } from "./StoryTypes";

/**
 * The campaign's progress and the rules that move it on. Pure: the runtime
 * (`StorySystem`) gathers what happened in the world into `Facts`, calls
 * `advance`, and carries out the effects it returns.
 *
 * Progress is kept by id (mission and step), never by position in a list,
 * so the story can be rewritten under a saved game: an unknown mission is
 * forgotten, an unknown step starts its mission over, a removed checkpoint
 * falls back to the start (see `restoreCampaign`).
 */

export const CAMPAIGN_VERSION = 1;

export type MissionProgress = { step: string; done: boolean };

export type CampaignState = {
  version: number;
  /** Missions under way or done (a mission not in here has not started). */
  missions: Record<string, MissionProgress>;
  /** The step the game resumes from (after a reload or a sinking). */
  checkpoint: { mission: string; step: string } | null;
  /** Gear the skipper has been given (`rifle`). */
  gear: string[];
  /** Story items he holds now, and every one he has ever picked up (so a taken item is not put back). */
  items: string[];
  collected: string[];
  /** The yacht's hull, 0…1, whether her engine can run, and whether she has her mast and sail. */
  hull: number;
  engine: boolean;
  rig: boolean;
  /** Sectors entered at least once (their title card has been shown). */
  sectors: string[];
  /** Where she was last at the helm in open play (null after the story moved her). */
  position: { x: number; z: number; heading: number } | null;
};

export function createCampaign(): CampaignState {
  return {
    version: CAMPAIGN_VERSION,
    missions: {},
    checkpoint: null,
    gear: [],
    items: [],
    collected: [],
    hull: 1,
    engine: true,
    rig: true,
    sectors: [],
    position: null,
  };
}

const strings = (value: unknown, limit = 64): string[] =>
  Array.isArray(value) ? Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string"))).slice(0, limit) : [];

/** A saved campaign read back against the story as it is now; anything it no longer names is dropped. */
export function restoreCampaign(raw: unknown, campaign: Campaign): CampaignState {
  const state = createCampaign();
  if (!raw || typeof raw !== "object") return state;
  const saved = raw as Partial<Record<keyof CampaignState, unknown>>;
  if (saved.missions && typeof saved.missions === "object") {
    for (const [id, value] of Object.entries(saved.missions as Record<string, unknown>)) {
      const mission = campaign.missions.find((entry) => entry.id === id);
      if (!mission || mission.status !== "playable" || !value || typeof value !== "object") continue;
      const progress = value as Partial<MissionProgress>;
      const done = progress.done === true;
      const step = mission.steps.find((entry) => entry.id === progress.step) ?? mission.steps[0];
      if (!step) continue;
      state.missions[id] = { step: step.id, done };
    }
  }
  const checkpoint = saved.checkpoint as { mission?: unknown; step?: unknown } | null | undefined;
  if (checkpoint && typeof checkpoint === "object") {
    const mission = campaign.missions.find((entry) => entry.id === checkpoint.mission);
    const step = mission?.steps.find((entry) => entry.id === checkpoint.step);
    if (mission && step?.checkpoint && state.missions[mission.id]) state.checkpoint = { mission: mission.id, step: step.id };
  }
  state.gear = strings(saved.gear);
  const items = new Set(campaign.items.map((item) => item.id));
  state.items = strings(saved.items).filter((item) => items.has(item));
  state.collected = strings(saved.collected).filter((item) => items.has(item));
  if (typeof saved.hull === "number" && Number.isFinite(saved.hull)) state.hull = Math.min(1, Math.max(0.05, saved.hull));
  if (typeof saved.engine === "boolean") state.engine = saved.engine;
  if (typeof saved.rig === "boolean") state.rig = saved.rig;
  const sectors = new Set(campaign.sectors.map((sector) => sector.id));
  state.sectors = strings(saved.sectors).filter((sector) => sectors.has(sector));
  const position = saved.position as { x?: unknown; z?: unknown; heading?: unknown } | null | undefined;
  if (position && [position.x, position.z, position.heading].every((value) => typeof value === "number" && Number.isFinite(value))) {
    state.position = { x: position.x as number, z: position.z as number, heading: position.heading as number };
  }
  return state;
}

export function missionById(campaign: Campaign, id: string): Mission | null {
  return campaign.missions.find((mission) => mission.id === id) ?? null;
}

export function stepOf(campaign: Campaign, state: CampaignState, missionId: string): Step | null {
  const progress = state.missions[missionId];
  if (!progress || progress.done) return null;
  return missionById(campaign, missionId)?.steps.find((step) => step.id === progress.step) ?? null;
}

export function isDone(state: CampaignState, missionId: string): boolean {
  return state.missions[missionId]?.done === true;
}

/** Missions that can be played now: playable, everything they need done, not done themselves. */
export function openMissions(campaign: Campaign, state: CampaignState): Mission[] {
  return campaign.missions.filter((mission) => mission.status === "playable" && !isDone(state, mission.id) && mission.requires.every((id) => isDone(state, id)));
}

/** The mission the interface follows: the first one open (the story is linear for now). */
export function trackedMission(campaign: Campaign, state: CampaignState): Mission | null {
  return openMissions(campaign, state).find((mission) => state.missions[mission.id]) ?? null;
}

/** Every mission is done and nothing more is open: the story so far is over. */
export function storyComplete(campaign: Campaign, state: CampaignState): boolean {
  return openMissions(campaign, state).length === 0 && campaign.missions.some((mission) => isDone(state, mission.id));
}

/** What the world needs to hold at this point of the story. */
export function presenceNow(campaign: Campaign, state: CampaignState): Presence[] {
  const out: Presence[] = [];
  for (const rule of campaign.world) if (isDone(state, rule.after)) out.push(...rule.presence);
  for (const mission of openMissions(campaign, state)) {
    if (!state.missions[mission.id]) continue;
    out.push(...(mission.presence ?? []));
    out.push(...(stepOf(campaign, state, mission.id)?.presence ?? []));
  }
  // An item already picked up stays picked up.
  return out.filter((entry) => entry.kind !== "item" || !state.collected.includes(entry.item));
}

/** A key naming one thing in the world, for reconciling what is there with what should be. */
export function presenceKey(presence: Presence): string {
  if (presence.kind === "drones") return `drones:${presence.group.id}`;
  if (presence.kind === "item") return `item:${presence.item}`;
  if (presence.kind === "props") return `props:${presence.set}:${presence.at}`;
  return `npc:${presence.character}`;
}

/** What the world says this frame, gathered by the runtime. */
export type Facts = {
  /** What happened since the last call: `talk:<who>`, `collect:<item>`, `repaired`, `disabled:<group>`, `destroyed:<group>`, `salvaged:<group>`. */
  events: ReadonlySet<string>;
  /** Nothing is waiting to be said. */
  dialogueIdle: boolean;
  /** A cut scene is running. */
  cutscene: boolean;
  /** Seconds the mission's current step has been current. */
  stepTime: (mission: string) => number;
  yacht: { x: number; z: number };
  skipper: { x: number; z: number };
  /** The skipper is aboard (at the helm or on deck). */
  aboard: boolean;
  hull: number;
  /** Where a story place is (see AtlasMath.resolvePlace). */
  place: (id: string) => { x: number; z: number; radius: number } | null;
};

function near(point: { x: number; z: number }, place: { x: number; z: number; radius: number } | null, radius?: number): boolean {
  return place !== null && Math.hypot(point.x - place.x, point.z - place.z) <= (radius ?? place.radius);
}

export function objectiveMet(objective: Objective, state: CampaignState, facts: Facts, mission: string): boolean {
  const time = facts.stepTime(mission);
  switch (objective.kind) {
    case "listen":
      // A beat lasts at least long enough for what it says to be queued.
      return facts.dialogueIdle && time > 0.4;
    case "wait":
      return time >= objective.seconds;
    case "reach": {
      const place = facts.place(objective.at);
      if (objective.by === "yacht") return facts.aboard && near(facts.yacht, place, objective.radius);
      if (objective.by === "foot") return !facts.aboard && near(facts.skipper, place, objective.radius);
      return near(facts.aboard ? facts.yacht : facts.skipper, place, objective.radius);
    }
    case "aboard":
      return facts.aboard;
    case "talk":
      return facts.events.has(`talk:${objective.character}`);
    case "collect":
      return facts.events.has(`collect:${objective.item}`) || state.items.includes(objective.item);
    case "repair":
      return facts.events.has("repaired");
    case "disable":
      return facts.events.has(`disabled:${objective.group}`);
    case "salvage":
      return facts.events.has(`salvaged:${objective.group}`);
    case "hull":
      return facts.hull < objective.hull || time >= objective.after || (objective.at !== undefined && near(facts.yacht, facts.place(objective.at)));
    case "watch":
      return !facts.cutscene && time > 0.4;
    case "event":
      return facts.events.has(objective.event) || (objective.after !== undefined && time >= objective.after);
  }
}

/** Changes to the campaign's own state an effect makes (the runtime does the rest: the yacht, the world, the screen). */
export function applyToState(state: CampaignState, effect: Effect, campaign: Campaign): void {
  switch (effect.do) {
    case "give":
      if (campaign.items.some((item) => item.id === effect.what)) {
        if (!state.items.includes(effect.what)) state.items.push(effect.what);
        if (!state.collected.includes(effect.what)) state.collected.push(effect.what);
      } else if (!state.gear.includes(effect.what)) {
        state.gear.push(effect.what);
      }
      break;
    case "take":
      state.items = state.items.filter((item) => item !== effect.item);
      break;
    case "damage":
      if (effect.hull !== undefined) state.hull = Math.max(0, state.hull - effect.hull);
      if (effect.engine) state.engine = false;
      break;
    case "repair":
      if (effect.hull !== undefined) state.hull = Math.max(state.hull, Math.min(1, effect.hull));
      if (effect.engine) state.engine = true;
      break;
    case "rig":
      state.rig = !effect.broken;
      break;
    case "place":
      state.position = null;
      break;
    default:
      break;
  }
}

export type Advance = {
  /** Effects to carry out, in order. */
  effects: Effect[];
  /** Missions whose step changed (their step clocks restart). */
  moved: string[];
};

/**
 * Moves the story on by what the world says: starts the missions that have
 * opened, completes the steps whose objectives are met (one step per mission
 * per call, so a step's own lines are queued before the next can be judged),
 * and returns what is to happen.
 */
export function advance(campaign: Campaign, state: CampaignState, facts: Facts): Advance {
  const effects: Effect[] = [];
  const moved: string[] = [];
  const enter = (mission: Mission, step: Step) => {
    state.missions[mission.id] = { step: step.id, done: false };
    if (step.checkpoint) state.checkpoint = { mission: mission.id, step: step.id };
    effects.push(...(step.onStart ?? []));
    moved.push(mission.id);
  };
  for (const mission of openMissions(campaign, state)) {
    const progress = state.missions[mission.id];
    if (!progress) {
      // A new mission waits for the last one's words to be heard out (and its scene to end).
      if (!facts.dialogueIdle || facts.cutscene) continue;
      const first = mission.steps[0];
      if (first) enter(mission, first);
      continue;
    }
    const index = mission.steps.findIndex((step) => step.id === progress.step);
    const step = mission.steps[index];
    if (!step) continue;
    if (step.objective.kind === "disable" && facts.events.has(`destroyed:${step.objective.group}`)) effects.push(...(step.objective.onLost ?? []));
    // A blinded drone blown up before it was hauled in: back to blinding one.
    if (step.objective.kind === "salvage" && facts.events.has(`destroyed:${step.objective.group}`)) {
      const previous = mission.steps[index - 1];
      if (previous && previous.objective.kind === "disable" && previous.objective.group === step.objective.group) {
        state.missions[mission.id] = { step: previous.id, done: false };
        effects.push(...(previous.objective.onLost ?? []));
        moved.push(mission.id);
        continue;
      }
    }
    if (!objectiveMet(step.objective, state, facts, mission.id)) continue;
    effects.push(...(step.onComplete ?? []));
    const next = mission.steps[index + 1];
    if (next) {
      enter(mission, next);
    } else {
      state.missions[mission.id] = { step: step.id, done: true };
      effects.push(...(mission.onComplete ?? []));
      moved.push(mission.id);
    }
  }
  for (const effect of effects) applyToState(state, effect, campaign);
  return { effects, moved };
}
