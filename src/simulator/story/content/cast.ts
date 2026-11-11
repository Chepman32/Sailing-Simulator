import type { Character, Faction } from "../StoryTypes";

/** The sides (docs/campaign/characters.md). */
export const FACTIONS: readonly Faction[] = [
  { id: "aquilon", name: { ru: "«Аквилон»", en: "Aquilon" }, color: "#e5484d", stance: "enemy" },
  { id: "vanguard", name: { ru: "«Вангард Навал»", en: "Vanguard Naval" }, color: "#8a99a8", stance: "enemy" },
  { id: "raiders", name: { ru: "Мародёры", en: "Raiders" }, color: "#c26a2e", stance: "enemy" },
  { id: "resistance", name: { ru: "Сопротивление", en: "The resistance" }, color: "#2bb3a3", stance: "ally" },
  { id: "syndicate", name: { ru: "Синдикат", en: "The Syndicate" }, color: "#c9a227", stance: "neutral" },
];

/**
 * The people. Three speakers are not in this list and need no entry: `hero`
 * (the skipper himself), `aquilon` (the network's voice) and `unknown` (a
 * voice on the radio nobody knows).
 */
export const CHARACTERS: readonly Character[] = [
  {
    id: "holloway",
    name: { ru: "Марк Холлоуэй", en: "Mark Holloway" },
    callsign: { ru: "Блэк", en: "Black" },
    role: { ru: "Бывший связист ЧВК «Эгида»", en: "Former Aegis PMC signals man" },
    faction: "resistance",
    monogram: "MH",
  },
  {
    id: "sara",
    name: { ru: "Сара Дженкинс", en: "Sara Jenkins" },
    callsign: { ru: "Вектор", en: "Vector" },
    role: { ru: "Бывший аналитик разведки «Вангард Навал»", en: "Former Vanguard Naval intelligence analyst" },
    faction: "resistance",
    monogram: "SJ",
  },
  {
    id: "kenji",
    name: { ru: "Кендзи Сато", en: "Kenji Sato" },
    callsign: { ru: "Рэйн", en: "Rain" },
    role: { ru: "Инженер-гидролог «Аквилона»", en: "Aquilon's hydrology engineer" },
    faction: "resistance",
    monogram: "KS",
  },
  {
    id: "sedov",
    name: { ru: "Виктор Седов", en: "Viktor Sedov" },
    role: { ru: "Бывший технический директор «Аквилона»", en: "Aquilon's former technical director" },
    faction: "syndicate",
    monogram: "VS",
  },
  {
    id: "reese",
    name: { ru: "Харланд Риз", en: "Harland Reese" },
    callsign: { ru: "Пастух", en: "Shepherd" },
    role: { ru: "Командир «чистильщиков»", en: "Commander of the cleaners" },
    faction: "vanguard",
    monogram: "HR",
  },
];

/** Speakers that are not characters. */
export const OTHER_SPEAKERS = ["hero", "aquilon", "unknown"] as const;
