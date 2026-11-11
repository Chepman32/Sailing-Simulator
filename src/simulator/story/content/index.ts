import type { Campaign, Chapter, StoryItem, WorldRule } from "../StoryTypes";
import { CHARACTERS, FACTIONS } from "./cast";
import { CHAPTER_1 } from "./chapter1";
import { BORDERS, LOCATIONS, QUARANTINE, SECTORS } from "./geography";
import { PROLOGUE, PROLOGUE_CUTSCENES } from "./prologue";

const CHAPTERS: readonly Chapter[] = [
  { id: "prologue", title: { ru: "Пролог", en: "Prologue" }, subtitle: { ru: "Штиль перед обрывом", en: "The Calm Before the Drop" }, sector: "dead-tide" },
  { id: "chapter-1", title: { ru: "Глава 1", en: "Chapter 1" }, subtitle: { ru: "Мёртвый прилив", en: "Dead Tide" }, sector: "dead-tide" },
  { id: "chapter-2", title: { ru: "Глава 2", en: "Chapter 2" }, subtitle: { ru: "Зелёный шквал", en: "Green Squall" }, sector: "green-squall" },
  { id: "chapter-3", title: { ru: "Глава 3", en: "Chapter 3" }, subtitle: { ru: "Песчаные зубья", en: "Sand Teeth" }, sector: "sand-teeth" },
  { id: "chapter-4", title: { ru: "Глава 4", en: "Chapter 4" }, subtitle: { ru: "Открытый клин", en: "The Open Wedge" }, sector: "open-wedge" },
  { id: "chapter-5", title: { ru: "Глава 5", en: "Chapter 5" }, subtitle: { ru: "Чёрная кальдера", en: "Black Caldera" }, sector: "black-caldera" },
];

/** Things the story hands over; `value` is what the black market pays for one (gold). */
const ITEMS: readonly StoryItem[] = [
  { id: "repair-kit", name: { ru: "Ремкомплект: пластыри и герметик", en: "Repair kit: patches and sealant" }, value: 0 },
  { id: "guidance-unit", name: { ru: "Блок наведения дрона", en: "Drone guidance unit" }, value: 0 },
  { id: "lis-battery", name: { ru: "Литий-серный аккумулятор", en: "Lithium-sulphur battery" }, value: 160 },
];

/** What the world holds from a point of the story on. */
const WORLD: readonly WorldRule[] = [
  // Holloway waits at Sato's hideout once he has gone ahead to it.
  { id: "holloway-at-hideout", after: "stranded", presence: [{ kind: "npc", character: "holloway", at: "sato-hideout", kit: "armed" }] },
  // Once she can fight back, the reef belt is patrolled: blind them and strip them for money.
  {
    id: "tide-patrols",
    after: "heart",
    presence: [
      { kind: "drones", group: { id: "tide-patrol-ridge", at: "broken-ridge", count: 1, behaviour: "patrol", beat: 450, respawn: 240 } },
      { kind: "drones", group: { id: "tide-patrol-banks", at: "pale-banks", count: 2, behaviour: "patrol", beat: 500, respawn: 300 } },
    ],
  },
];

/** The whole campaign: everything the engine reads (see StoryTypes). */
export const CAMPAIGN: Campaign = {
  factions: FACTIONS,
  characters: CHARACTERS,
  borders: BORDERS,
  quarantine: QUARANTINE,
  sectors: SECTORS,
  locations: LOCATIONS,
  chapters: CHAPTERS,
  items: ITEMS,
  missions: [PROLOGUE, ...CHAPTER_1],
  world: WORLD,
  cutscenes: PROLOGUE_CUTSCENES,
  // Outside the line to the south-east of the reef belt, running before the trade wind for the old light.
  start: { yacht: [-4850, -6900], heading: 318 },
};
