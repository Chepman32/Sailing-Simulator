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
    id: "commander",
    name: { ru: "Командир", en: "The Commander" },
    role: { ru: "Командир сил ЧВК в секторе (имя не установлено)", en: "Commander of the PMC's force in the sector (name unknown)" },
    faction: "vanguard",
    monogram: "KM",
  },
  {
    id: "luis",
    name: { ru: "Луис Мендес", en: "Luis Mendes" },
    role: { ru: "Портовый диспетчер", en: "Harbour dispatcher" },
    faction: "resistance",
    monogram: "LM",
  },
  {
    id: "maya",
    name: { ru: "Майя Ривера", en: "Maya Rivera" },
    role: { ru: "Медик и завхоз убежища", en: "The haven's medic and quartermaster" },
    faction: "resistance",
    monogram: "MR",
  },
  ...guard("p01", { ru: "Часовой у КПП", en: "Checkpoint sentry" }),
  ...guard("p02", { ru: "Часовая у КПП", en: "Checkpoint sentry" }),
  ...guard("p03", { ru: "Механик у генератора", en: "Generator mechanic" }),
  ...guard("p04", { ru: "Охранник у генератора", en: "Generator guard" }),
  ...guard("p05", { ru: "Патрульная, северный обход", en: "North round patrol" }),
  ...guard("p06", { ru: "Патрульный, северный обход", en: "North round patrol" }),
  ...guard("i07", { ru: "Связист", en: "Signaller" }),
  ...guard("i08", { ru: "Архивариус", en: "Archive clerk" }),
  ...guard("i09", { ru: "Сержант в архиве", en: "Archive sergeant" }),
  ...guard("d10", { ru: "Охранник причала", en: "Dock guard" }),
  ...guard("d11", { ru: "Охранник причала", en: "Dock guard" }),
  ...guard("e12", { ru: "Командир отделения", en: "Squad leader" }),
  ...guard("e13", { ru: "Боец подкрепления", en: "Reinforcement" }),
  ...guard("e14", { ru: "Боец подкрепления", en: "Reinforcement" }),
  ...guard("e15", { ru: "Боец подкрепления", en: "Reinforcement" }),
  ...guard("e16", { ru: "Боец подкрепления", en: "Reinforcement" }),
  ...guard("w18", { ru: "Рулевой катера", en: "Patrol boat helmsman" }),
  ...guard("w19", { ru: "Наблюдатель катера", en: "Patrol boat lookout" }),
  {
    id: "reese",
    name: { ru: "Харланд Риз", en: "Harland Reese" },
    callsign: { ru: "Пастух", en: "Shepherd" },
    role: { ru: "Командир «чистильщиков»", en: "Commander of the cleaners" },
    faction: "vanguard",
    monogram: "HR",
  },
];

/** One of Vanguard's people at Створ-9, named by his post (they speak, so they are cast). */
function guard(id: string, role: { ru: string; en: string }): Character[] {
  return [{ id, name: role, role, faction: "vanguard", monogram: id.toUpperCase().slice(0, 3) }];
}

/** Speakers that are not characters. */
export const OTHER_SPEAKERS = ["hero", "aquilon", "unknown"] as const;
