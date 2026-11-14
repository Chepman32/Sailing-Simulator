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
 * The people. Four speakers are not in this list and need no entry: `hero`
 * (the skipper himself), `aquilon` (the network's voice), `dispatch` (the
 * Outer Ridge's harbour dispatcher on the civil channel) and `unknown` (a
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
  // M02: the mercenaries at Тихий Лист and in the boats after the Albatross.
  ...["g01", "g02", "g03", "g04", "g05", "g06", "g07", "g08", "g09", "g10", "g11", "g12", "g13", "g14", "g15"].flatMap((id) => guard(id, { ru: "Наёмник", en: "Mercenary" })),
  ...guard("merc-gunner", { ru: "Стрелок катера", en: "Boat gunner" }),
  ...guard("merc-helm", { ru: "Рулевой катера", en: "Boat helmsman" }),
  ...guard("merc-lookout", { ru: "Дозорный", en: "Lookout" }),
  // M03: Лагуна-4's security.
  ...Array.from({ length: 24 }, (_, index) => `s${String(index + 1).padStart(2, "0")}`).flatMap((id) => guard(id, { ru: "Охранник станции", en: "Station guard" })),
  ...guard("security-lead", { ru: "Старший охраны", en: "Head of security" }),
  // The prologue's two patrol boats, heard on their own channel.
  ...guard("vn-helm", { ru: "Рулевой патрульного катера", en: "Patrol boat helmsman" }),
  ...guard("vn-lead", { ru: "Командир патруля", en: "Patrol leader" }),
  ...guard("w19", { ru: "Наблюдатель катера", en: "Patrol boat lookout" }),
  {
    id: "reese",
    name: { ru: "Харланд Риз", en: "Harland Reese" },
    callsign: { ru: "Пастух", en: "Shepherd" },
    role: { ru: "Командир «чистильщиков»", en: "Commander of the cleaners" },
    faction: "vanguard",
    monogram: "HR",
  },
  // M02: the captain and his people, the five of Тихий Лист, the Free Bay.
  {
    id: "captain",
    name: { ru: "Капитан", en: "The Captain" },
    role: { ru: "Хозяин «Альбатроса», старший Бухты свободных; когда-то служил с героем", en: "Master of the Albatross, the Free Bay's elder; once served with the skipper" },
    faction: "resistance",
    monogram: "КП",
  },
  { id: "nika", name: { ru: "Ника", en: "Nika" }, role: { ru: "Медик команды капитана", en: "The captain's medic" }, faction: "resistance", monogram: "НК" },
  { id: "mateo", name: { ru: "Матео Вега", en: "Mateo Vega" }, role: { ru: "Старый рыбак, сооснователь Бухты свободных", en: "An old fisherman, one of the Free Bay's founders" }, faction: "resistance", monogram: "МВ" },
  { id: "aliya", name: { ru: "Алия Вега", en: "Aliya Vega" }, role: { ru: "Рыбачка с Тихого Листа", en: "A fisherwoman of Тихий Лист" }, faction: "resistance", monogram: "АВ" },
  { id: "luka", name: { ru: "Лука Мора", en: "Luka Mora" }, role: { ru: "Молодой рыбак", en: "A young fisherman" }, faction: "resistance", monogram: "ЛМ" },
  { id: "juan", name: { ru: "Хуан Риос", en: "Juan Rios" }, role: { ru: "Механик рыболовного флота", en: "The fishing fleet's mechanic" }, faction: "resistance", monogram: "ХР" },
  { id: "rafa", name: { ru: "Рафа Ортис", en: "Rafa Ortiz" }, role: { ru: "Рыбак с сумкой инструментов", en: "A fisherman with his bag of tools" }, faction: "resistance", monogram: "РО" },
  { id: "oskar", name: { ru: "Оскар", en: "Oskar" }, role: { ru: "Механик Бухты свободных", en: "The Free Bay's mechanic" }, faction: "syndicate", monogram: "ОС" },
  { id: "mila", name: { ru: "Мила", en: "Mila" }, role: { ru: "Торговка Бухты свободных", en: "A trader of the Free Bay" }, faction: "syndicate", monogram: "МЛ" },
  { id: "bay", name: { ru: "Житель бухты", en: "Bay resident" }, role: { ru: "Житель Бухты свободных", en: "A Free Bay resident" }, faction: "syndicate", monogram: "БС" },
  // M03: Солнечный мыс and Лагуна-4.
  { id: "ines", name: { ru: "Инес", en: "Inés" }, role: { ru: "Жительница Солнечного мыса, раздаёт воду", en: "A Sunny Cape resident who hands out the water" }, faction: "resistance", monogram: "ИН" },
  { id: "tiago", name: { ru: "Тиаго", en: "Tiago" }, role: { ru: "Мальчишка с Солнечного мыса", en: "A boy from the Sunny Cape" }, faction: "resistance", monogram: "ТГ" },
  { id: "luis-w", name: { ru: "Луис", en: "Luis" }, role: { ru: "Начальник смены «Лагуны-4»", en: "Shift lead at Laguna-4" }, faction: "resistance", monogram: "ЛС" },
  { id: "daria", name: { ru: "Дарья", en: "Daria" }, role: { ru: "Водитель цистерны", en: "The tanker's driver" }, faction: "resistance", monogram: "ДР" },
  { id: "asha", name: { ru: "Аша", en: "Asha" }, role: { ru: "Рабочая станции", en: "A station worker" }, faction: "resistance", monogram: "АШ" },
];

/** One of Vanguard's people at Створ-9, named by his post (they speak, so they are cast). */
function guard(id: string, role: { ru: string; en: string }): Character[] {
  return [{ id, name: role, role, faction: "vanguard", monogram: id.toUpperCase().replace(/-/g, "").slice(0, 3) }];
}

/** Speakers that are not characters. */
export const OTHER_SPEAKERS = ["hero", "aquilon", "dispatch", "unknown"] as const;
