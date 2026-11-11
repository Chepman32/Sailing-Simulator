import { restoreCampaign, stepOf, type CampaignState } from "./CampaignMath";
import type { Campaign, Text } from "./StoryTypes";
import { WEATHER_KINDS, type WeatherKind } from "../environment/WeatherMath";

/**
 * Saved games: an autosave the story writes as it moves on, and three slots
 * the player saves to from the pause menu. Each holds the campaign's state
 * (the same record the running campaign keeps, so a save survives the story
 * being rewritten under it exactly as the live one does), where the yacht
 * and the skipper were, the hour and the weather, and a small picture of
 * the moment for the load menu.
 *
 * Pure but for the store it is handed (localStorage in the game, a map in
 * the tests).
 */

export const SAVE_SLOTS = ["auto", "slot-1", "slot-2", "slot-3"] as const;
export type SaveSlotId = (typeof SAVE_SLOTS)[number];
/** The slots the player saves to by hand (the autosave is the story's). */
export const MANUAL_SLOTS: readonly SaveSlotId[] = ["slot-1", "slot-2", "slot-3"];
export const SAVE_VERSION = 1;
const KEY_PREFIX = "sailing-simulator-save-v1:";

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};


export type SavedPose = {
  /** World metres and radians, as the simulator keeps them. */
  yacht: { x: number; z: number; heading: number };
  /** On foot (null: at the wheel, or aboard). */
  skipper: { x: number; z: number; yaw: number } | null;
};

export type SaveGame = {
  version: number;
  slot: SaveSlotId;
  /** Milliseconds since the epoch. */
  savedAt: number;
  campaign: CampaignState;
  pose: SavedPose;
  /** The day cycle's clock and the sky. */
  world: { cycleTime: number; weather: WeatherKind | null };
  /** A JPEG data URL of the moment, or null. */
  thumbnail: string | null;
};

const keyOf = (slot: SaveSlotId) => KEY_PREFIX + slot;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A save read back, or null when it is missing, damaged, or not one of ours. */
export function decodeSave(raw: string | null, campaign: Campaign): SaveGame | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== SAVE_VERSION) return null;
  if (typeof record.slot !== "string" || !(SAVE_SLOTS as readonly string[]).includes(record.slot)) return null;
  if (!finite(record.savedAt)) return null;
  const pose = record.pose as Record<string, unknown> | undefined;
  const yacht = pose?.yacht as Record<string, unknown> | undefined;
  if (!yacht || !finite(yacht.x) || !finite(yacht.z) || !finite(yacht.heading)) return null;
  const skipper = pose?.skipper as Record<string, unknown> | null | undefined;
  const afoot = skipper && finite(skipper.x) && finite(skipper.z) && finite(skipper.yaw) ? { x: skipper.x, z: skipper.z, yaw: skipper.yaw } : null;
  const world = record.world as Record<string, unknown> | undefined;
  const weather = typeof world?.weather === "string" && (WEATHER_KINDS as readonly string[]).includes(world.weather) ? (world.weather as WeatherKind) : null;
  const state = restoreCampaign(record.campaign, campaign);
  // A save with nothing begun is no save.
  if (Object.keys(state.missions).length === 0) return null;
  return {
    version: SAVE_VERSION,
    slot: record.slot as SaveSlotId,
    savedAt: record.savedAt,
    campaign: state,
    pose: { yacht: { x: yacht.x, z: yacht.z, heading: yacht.heading }, skipper: afoot },
    world: { cycleTime: finite(world?.cycleTime) ? world.cycleTime : 0, weather },
    thumbnail: typeof record.thumbnail === "string" && record.thumbnail.startsWith("data:image/") ? record.thumbnail : null,
  };
}

export function encodeSave(game: SaveGame): string {
  return JSON.stringify(game);
}

export function readSave(store: KeyValueStore, slot: SaveSlotId, campaign: Campaign): SaveGame | null {
  try {
    return decodeSave(store.getItem(keyOf(slot)), campaign);
  } catch {
    return null;
  }
}

/** Every slot in order, null where there is nothing (or nothing readable). */
export function listSaves(store: KeyValueStore, campaign: Campaign): (SaveGame | null)[] {
  return SAVE_SLOTS.map((slot) => readSave(store, slot, campaign));
}

/**
 * Writes a save. A store that is full gets it without its picture; false
 * if even that does not fit (or the store is closed to us).
 */
export function writeSave(store: KeyValueStore, game: SaveGame): boolean {
  try {
    store.setItem(keyOf(game.slot), encodeSave(game));
    return true;
  } catch {
    if (!game.thumbnail) return false;
    try {
      store.setItem(keyOf(game.slot), encodeSave({ ...game, thumbnail: null }));
      return true;
    } catch {
      return false;
    }
  }
}

export function deleteSave(store: KeyValueStore, slot: SaveSlotId): void {
  try {
    store.removeItem(keyOf(slot));
  } catch {
    // Nothing to do.
  }
}

/** The newest of the saves given. */
export function latestSave(saves: readonly (SaveGame | null)[]): SaveGame | null {
  let best: SaveGame | null = null;
  for (const save of saves) if (save && (!best || save.savedAt > best.savedAt)) best = save;
  return best;
}

/** What the load menu says of a save: the chapter, the mission and what was to be done next. */
export function describeSave(game: SaveGame, campaign: Campaign): { chapter: Text | null; mission: Text | null; goal: Text | null; done: number } {
  const state = game.campaign;
  const entries = Object.entries(state.missions);
  const done = entries.filter(([, progress]) => progress.done).length;
  // The mission under way, else the last one finished (in story order).
  const order = campaign.missions.map((mission) => mission.id);
  const open = order.filter((id) => state.missions[id] && !state.missions[id]!.done);
  const finished = order.filter((id) => state.missions[id]?.done);
  const id = open[0] ?? finished[finished.length - 1] ?? null;
  const mission = id ? campaign.missions.find((entry) => entry.id === id) ?? null : null;
  if (!mission) return { chapter: null, mission: null, goal: null, done };
  const chapter = campaign.chapters.find((entry) => entry.id === mission.chapter);
  const step = state.missions[mission.id]!.done ? null : stepOf(campaign, state, mission.id);
  return { chapter: chapter?.title ?? null, mission: mission.title, goal: step?.goal ?? null, done };
}

/** Why the game cannot be saved just now (null: it can). */
export type SaveBlock = "no-campaign" | "cutscene" | "combat" | "danger";

export function saveBlock(facts: { campaign: boolean; cinematic: boolean; frozen: boolean; fade: number; attacking: boolean; anchored: boolean }): SaveBlock | null {
  if (!facts.campaign) return "no-campaign";
  // The prologue's opening run is one scene: a save in it would only start it over.
  if (!facts.anchored) return "danger";
  if (facts.cinematic || facts.frozen) return "cutscene";
  if (facts.attacking) return "combat";
  if (facts.fade > 0.05) return "danger";
  return null;
}
