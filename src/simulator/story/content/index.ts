import type { Campaign, Chapter, Mission, StoryItem, WorldRule } from "../StoryTypes";
import { CHARACTERS, FACTIONS } from "./cast";
import { BORDERS, LOCATIONS, QUARANTINE, SECTORS } from "./geography";
import { M01, M01_CUTSCENES } from "./m01";
import { M01_ACTORS } from "./m01Cast";
import { M02, M02_CUTSCENES } from "./m02";
import { BAY_PEOPLE, M02_ACTORS } from "./m02Cast";
import { M03, M03_CUTSCENES } from "./m03";
import { M03_ACTORS } from "./m03Cast";
import { PROLOGUE, PROLOGUE_CUTSCENES } from "./prologue";

const CHAPTERS: readonly Chapter[] = [
  { id: "prologue", title: { ru: "Пролог", en: "Prologue" }, subtitle: { ru: "Штиль перед обрывом", en: "The Calm Before the Drop" }, sector: "dead-tide" },
  { id: "chapter-1", title: { ru: "Глава 1", en: "Chapter 1" }, subtitle: { ru: "Мёртвый прилив", en: "Dead Tide" }, sector: "dead-tide" },
  { id: "arcs", title: { ru: "Сюжетные линии", en: "Story lines" }, subtitle: { ru: "В любом порядке", en: "In any order" }, sector: "dead-tide" },
  { id: "chapter-2", title: { ru: "Глава 2", en: "Chapter 2" }, subtitle: { ru: "Зелёный шквал", en: "Green Squall" }, sector: "green-squall" },
  { id: "chapter-3", title: { ru: "Глава 3", en: "Chapter 3" }, subtitle: { ru: "Песчаные зубья", en: "Sand Teeth" }, sector: "sand-teeth" },
  { id: "chapter-4", title: { ru: "Глава 4", en: "Chapter 4" }, subtitle: { ru: "Открытый клин", en: "The Open Wedge" }, sector: "open-wedge" },
  { id: "chapter-5", title: { ru: "Глава 5", en: "Chapter 5" }, subtitle: { ru: "Чёрная кальдера", en: "Black Caldera" }, sector: "black-caldera" },
];

/** Things the story hands over; `value` is what the black market pays for one (gold). */
const ITEMS: readonly StoryItem[] = [];

/** The four story lines M01 opens: in the journal, in any order, their first meetings still to be written. */
const arc = (id: string, giver: string, ru: string, en: string, briefRu: string, briefEn: string): Mission => ({
  id,
  chapter: "arcs",
  title: { ru, en },
  brief: { ru: briefRu, en: briefEn },
  giver,
  sector: "dead-tide",
  requires: ["m01"],
  status: "planned",
  steps: [],
});

const ARCS: readonly Mission[] = [
  arc("arc-mark", "holloway", "Продолжить у Марка", "Carry on with Mark", "Марк остаётся в бухте: его людям нужно снабжение. Следующая работа — только если сам придёшь.", "Mark stays at the cove: his people need supplies. The next job is his only if you come to him."),
  arc("arc-sara", "sara", "Познакомиться с Сарой Дженкинс", "Meet Sara Jenkins", "Бывший аналитик их разведки. Если кто и прочтёт код группы на приказе — она.", "A former analyst of their intelligence. If anyone can read the group code on the order, she can."),
  arc("arc-viktor", "sedov", "Познакомиться с Виктором Седовым", "Meet Viktor Sedov", "Один из создателей «Аквилона». Говорит, что хочет всё остановить.", "One of the men who built Aquilon. Says he wants to stop it."),
];

/** What the world holds from a point of the story on. */
const WORLD: readonly WorldRule[] = [
  // After M01: the outpost and the beach stay as they were left; Mark, Maya (and Luis, if he got out) at the cove.
  {
    id: "after-m01",
    after: "m01",
    presence: [
      { kind: "level", level: "kosaya" },
      { kind: "level", level: "stvor9" },
      { kind: "level", level: "white-rocks" },
      { kind: "level", level: "cove" },
      { kind: "actors", ids: ["mark-cove", "maya", "luis-cove"] },
    ],
  },
  // After M02: the Free Bay, open, its people about their day.
  {
    id: "after-m02",
    after: "m02",
    presence: [
      { kind: "level", level: "bay" },
      { kind: "actors", ids: BAY_PEOPLE },
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
  missions: [PROLOGUE, M01, M02, M03, ...ARCS],
  world: WORLD,
  cutscenes: [...PROLOGUE_CUTSCENES, ...M01_CUTSCENES, ...M02_CUTSCENES, ...M03_CUTSCENES],
  actors: [...M01_ACTORS, ...M02_ACTORS, ...M03_ACTORS],
  smallTalk: {
    holloway: [
      { ru: "Я остаюсь здесь. Остальным можешь заняться в любом порядке.", en: "I'm staying here. The rest you can take in any order." },
      { ru: "Мотор подлатать можно. Новую посудину купишь, когда заработаешь.", en: "The motor can be patched. You'll buy a new tub when you've earned it." },
    ],
    maya: [{ ru: "Воду бери с собой. И шляпу.", en: "Take water with you. And a hat." }],
    luis: [{ ru: "Как жене расскажу — не поверит. Спасибо тебе.", en: "When I tell my wife she won't believe it. Thank you." }],
  },
  // South-east of the outer island, just outside the zone, flat out for it.
  start: { yacht: [-5777, -6606], heading: 314 },
};
