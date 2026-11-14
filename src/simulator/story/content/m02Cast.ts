import type { ActorSpec } from "../../actors/ActorSystem";
import type { ActorLook } from "../../actors/ActorLooks";
import { SKIN, UNIFORM } from "../../actors/ActorLooks";
import { contractor } from "./looks";

/**
 * M02's people on their feet (docs/campaign/missions/m02.md): the five
 * fishermen of Тихий Лист and Nika; the fifteen mercenaries ashore (G01–G15:
 * eight at the market, four at the smokehouse, three who come to the back
 * jetty); and the people of the Free Bay. The captain is in his boat (her
 * party, `aboard:m02-captain`) and the twelve men of the six pursuing boats
 * are their crews (`BoatFigures`), not here.
 */

const t = (ru: string, en: string) => ({ ru, en });

// --- Looks (the costume notes of the scenario's §4.1) ----------------------------------

export const CAPTAIN_LOOK: ActorLook = { model: "man", skin: SKIN.olive, shirt: 0x6b7a4a, trousers: 0x5a5446, hair: 0x3a2e24, vest: null, head: "none", glasses: true, scale: 1.03 };
export const NIKA_LOOK: ActorLook = { model: "woman", skin: SKIN.light, shirt: 0x9cc3e0, trousers: 0x2a2e36, hair: 0x2a1f18, vest: null, head: "none", bag: true };
export const MATEO_LOOK: ActorLook = { model: "man", skin: SKIN.tan, shirt: 0x4a6ea8, trousers: 0xd8cfb8, hair: 0xd8d4cc, vest: null, head: "panama", headColor: 0xf2efe6, scale: 0.96 };
const ALIYA_LOOK: ActorLook = { model: "woman", skin: SKIN.olive, shirt: 0x3fb7b0, trousers: 0x2b2b2b, hair: 0x1e1612, vest: null, head: "none" };
const LUKA_LOOK: ActorLook = { model: "man", skin: SKIN.olive, shirt: 0x6f8a4a, trousers: 0x4a4f58, hair: 0x2a1e14, vest: null, head: "none", scale: 0.98 };
const JUAN_LOOK: ActorLook = { model: "man", skin: SKIN.brown, shirt: 0xe9e6dc, trousers: 0x7a5a3a, hair: 0x241a12, vest: null, head: "cap", headColor: 0x8a8070, scale: 1.02 };
const RAFA_LOOK: ActorLook = { model: "man", skin: SKIN.tan, shirt: 0xe8c33a, trousers: 0x23314f, hair: 0x1c140e, vest: null, head: "none", bag: true, scale: 0.94 };
const OSKAR_LOOK: ActorLook = { model: "man", skin: SKIN.light, shirt: 0xe2dccb, trousers: 0x4f4a42, hair: 0x3a2e22, vest: null, head: "cap", headColor: 0x3f5f7a };
const MILA_LOOK: ActorLook = { model: "woman", skin: SKIN.tan, shirt: 0xd8607a, trousers: 0xc9b98a, hair: 0x2a1c14, vest: null, head: "panama", headColor: 0xe2cf92 };

/** The fishermen's ids, in the order they sit along the Albatross's benches (after Nika). */
export const FIVE = ["m02-mateo", "m02-aliya", "m02-luka", "m02-juan", "m02-rafa"] as const;

const MERC_COMMON = {
  manDown: [t("Человек упал! Кто видел, откуда?", "Man down! Who saw where from?")],
  lost: [t("Здесь никого, дальше!", "Nobody here, move on!")],
  surrender: [t("Всё, всё! Не стреляй!", "All right, all right! Don't shoot!")],
  regroup: [t("Отступаем к дороге!", "Fall back to the road!")],
} as const;

const merc = (squad: string, spec: Omit<ActorSpec, "faction" | "squad">): ActorSpec => ({ faction: "hostile", squad, ...spec, barks: { ...MERC_COMMON, ...spec.barks } });

const civilian = (id: string, character: string, look: ActorLook, spawn: string, sit?: number): ActorSpec => ({
  id,
  character,
  look,
  gun: null,
  faction: "neutral",
  spawn,
  routine: sit === undefined ? { kind: "hold" } : { kind: "sit", seat: sit },
  immortal: true,
});

/** The people of the Free Bay going about their day (the scenario's 14–22 in sight at once). */
const BAY_LOOKS: readonly ActorLook[] = [
  { model: "man", skin: SKIN.brown, shirt: 0xd9a441, trousers: 0x3b4a5c, hair: 0x1a120c, vest: null, head: "none" },
  { model: "woman", skin: SKIN.olive, shirt: 0x5fa8c9, trousers: 0xe8dfc8, hair: 0x2a1a10, vest: null, head: "none" },
  { model: "man", skin: SKIN.tan, shirt: 0xc75b3a, trousers: 0xd2c6a6, hair: 0x2c2018, vest: null, head: "cap", headColor: 0xe8e2d0 },
  { model: "woman", skin: SKIN.brown, shirt: 0xf0d7a0, trousers: 0x6a3f5a, hair: 0x140e0a, vest: null, head: "none" },
  { model: "man", skin: SKIN.light, shirt: 0x7fb069, trousers: 0x5a4a3a, hair: 0x6a5a48, vest: null, head: "panama", headColor: 0xe9dfc5 },
  { model: "woman", skin: SKIN.fair, shirt: 0xf2f0ea, trousers: 0x2f6f8a, hair: 0x8a5a2a, vest: null, head: "none" },
  { model: "man", skin: SKIN.dark, shirt: 0x3a6fb0, trousers: 0xc8b890, hair: 0x0e0a08, vest: null, head: "none" },
  { model: "man", skin: SKIN.olive, shirt: 0xe7e2d6, trousers: 0x444a52, hair: 0x2a2018, vest: null, head: "cap", headColor: 0xb0412e },
  { model: "woman", skin: SKIN.tan, shirt: 0xb45a8a, trousers: 0xd8cfb0, hair: 0x2a1c12, vest: null, head: "none" },
  { model: "man", skin: SKIN.light, shirt: 0x9a8a6a, trousers: 0x2a2e36, hair: 0x4a3a2a, vest: null, head: "none", scale: 1.05 },
  { model: "woman", skin: SKIN.olive, shirt: 0x6ab0a0, trousers: 0x3a2a24, hair: 0x18100a, vest: null, head: "panama", headColor: 0xd8c08a },
  { model: "man", skin: SKIN.brown, shirt: 0xe2b04a, trousers: 0x6a5a46, hair: 0x14100c, vest: null, head: "none", scale: 0.95 },
];

/** Where each of the bay's people works: two or three spots of the bay's level, a while at each. */
const BAY_WORK: readonly (readonly string[])[] = [
  ["bay:pier-a", "bay:crates", "bay:pier-b"],
  ["bay:market-1", "bay:market-2", "bay:well"],
  ["bay:workshop-1", "bay:workshop-2"],
  ["bay:well", "bay:house-3", "bay:market-1"],
  ["bay:bar-1", "bay:bar-2", "bay:deck"],
  ["bay:med", "bay:house-1", "bay:well"],
  ["bay:pier-b", "bay:nets", "bay:crates"],
  ["bay:workshop-2", "bay:engine", "bay:workshop-1"],
  ["bay:market-2", "bay:house-2", "bay:market-3"],
  ["bay:deck", "bay:bar-2", "bay:beach"],
  ["bay:nets", "bay:beach", "bay:house-4"],
  ["bay:crates", "bay:pier-a", "bay:engine"],
];

export const M02_ACTORS: readonly ActorSpec[] = [
  // --- The five, and Nika ----------------------------------------------------------
  civilian("m02-mateo", "mateo", MATEO_LOOK, "tl:mateo"),
  civilian("m02-aliya", "aliya", ALIYA_LOOK, "tl:aliya", 0.42),
  civilian("m02-luka", "luka", LUKA_LOOK, "tl:luka", 0.42),
  civilian("m02-juan", "juan", JUAN_LOOK, "tl:juan"),
  civilian("m02-rafa", "rafa", RAFA_LOOK, "tl:rafa", 0.0),
  civilian("m02-nika", "nika", NIKA_LOOK, "tl:nika"),
  // In the Albatross: the captain at her wheel (seen only aboard).
  { id: "m02-captain", character: "captain", look: CAPTAIN_LOOK, gun: null, faction: "ally", spawn: "bay:captain", routine: { kind: "hold" }, immortal: true },

  // --- The market (G01–G08) --------------------------------------------------------------
  merc("market", {
    id: "g01",
    look: contractor("man", SKIN.tan, UNIFORM.olive, "cap", { glasses: true }),
    gun: "carbine",
    spawn: "tl:g01",
    routine: { kind: "stand" },
    barks: { noticed: [t("Слева движение!", "Movement, left!")], firstShot: [t("Есть контакт!", "Contact!")] },
  }),
  merc("market", {
    id: "g02",
    look: contractor("man", SKIN.light, UNIFORM.sand, "none", { hair: 0x6a4a2a }),
    gun: "carbine",
    spawn: "tl:g02",
    routine: { kind: "stand" },
    barks: { contact: [t("Вижу цель, за прилавком!", "Target seen, behind the stall!")] },
  }),
  merc("market", {
    id: "g03",
    look: contractor("man", SKIN.brown, UNIFORM.olive, "helmet", { headColor: 0x6a6a58 }),
    gun: "carbine",
    spawn: "tl:g03",
    routine: { kind: "stand" },
    skill: 1.05,
    barks: { noticed: [t("Стой! Ты кто такой?", "Stop! Who are you?")], firstShot: [t("Прикрывай вход!", "Cover the entrance!")] },
  }),
  merc("market", {
    id: "g04",
    look: contractor("man", SKIN.olive, UNIFORM.cargo, "panama", { headColor: 0xb8a57c }),
    gun: "carbine",
    spawn: "tl:g04",
    routine: { kind: "patrol", route: "tl:market-round", pause: 5 },
    barks: { noticed: [t("Кто у ворот?", "Who's at the gate?")], lost: [t("Вправо ушёл!", "He went right!")] },
  }),
  merc("market", {
    id: "g05",
    look: contractor("man", SKIN.light, UNIFORM.olive, "cap"),
    gun: "carbine",
    spawn: "tl:g05",
    routine: { kind: "stand" },
    barks: { contact: [t("Держи левый угол!", "Hold the left corner!")] },
  }),
  merc("market", {
    id: "g06",
    look: contractor("woman", SKIN.olive, UNIFORM.sand, "cap", { hair: 0x2a1a10 }),
    gun: "carbine",
    spawn: "tl:g06",
    routine: { kind: "stand" },
    barks: { firstShot: [t("Не высовывайся!", "Keep your head down!")] },
  }),
  merc("market", {
    id: "g07",
    look: contractor("man", SKIN.tan, UNIFORM.khaki, "helmet", { headColor: 0x7a7a64 }),
    gun: "carbine",
    spawn: "tl:g07",
    routine: { kind: "patrol", route: "tl:west-awnings", pause: 6 },
    barks: { noticed: [t("Контакт у западных навесов!", "Contact by the west awnings!")], firstShot: [t("Контакт у западных навесов!", "Contact by the west awnings!")] },
  }),
  merc("market", {
    id: "g08",
    look: contractor("man", SKIN.dark, UNIFORM.olive, "none"),
    gun: "carbine",
    spawn: "tl:g08",
    routine: { kind: "stand" },
    barks: { firstShot: [t("Держите двор! Не давайте выйти к воде!", "Hold the yard! Don't let them reach the water!")] },
  }),

  // --- The smokehouse (G09–G12) -----------------------------------------------------------
  merc("smoke", {
    id: "g09",
    look: contractor("man", SKIN.light, UNIFORM.olive, "cap", { glasses: true }),
    gun: "carbine",
    spawn: "tl:g09",
    routine: { kind: "stand" },
    barks: { noticed: [t("Стой, проверь лестницу!", "Hold on, check the stairs!")] },
  }),
  merc("smoke", {
    id: "g10",
    look: contractor("man", SKIN.tan, UNIFORM.sand, "panama", { headColor: 0xc8b48a }),
    gun: "carbine",
    spawn: "tl:g10",
    routine: { kind: "stand" },
    barks: { contact: [t("Уходим за склад!", "Behind the store!")] },
  }),
  merc("smoke", {
    id: "g11",
    look: contractor("man", SKIN.olive, UNIFORM.cargo, "helmet", { headColor: 0x5f6a5c }),
    gun: "carbine",
    spawn: "tl:g11",
    routine: { kind: "patrol", route: "tl:smoke-yard", pause: 5 },
    barks: { noticed: [t("Слышали? За дверью кто-то есть.", "Hear that? Someone's behind the door.")] },
  }),
  merc("smoke", {
    id: "g12",
    look: contractor("woman", SKIN.light, UNIFORM.olive, "none", { hair: 0x3a2a1c }),
    gun: "carbine",
    spawn: "tl:g12",
    routine: { kind: "stand" },
    barks: { noticed: [t("Тогда не лезь один. Подожди.", "Then don't go in alone. Wait.")] },
  }),

  // --- The back jetty's three (G13–G15), up from the big pier when the boats are seen ---
  merc("pier", {
    id: "g13",
    look: contractor("man", SKIN.brown, UNIFORM.khaki, "cap"),
    gun: "carbine",
    spawn: "tl:g13",
    routine: { kind: "stand" },
    barks: { noticed: [t("Они у запасного пирса!", "They're at the back pier!")], firstShot: [t("Они у запасного пирса!", "They're at the back pier!")] },
  }),
  merc("pier", {
    id: "g14",
    look: contractor("man", SKIN.light, UNIFORM.olive, "helmet", { headColor: 0x6f7550 }),
    gun: "carbine",
    spawn: "tl:g14",
    routine: { kind: "stand" },
    barks: { firstShot: [t("Перекрой им выход!", "Cut off their way out!")] },
  }),
  merc("pier", {
    id: "g15",
    look: contractor("man", SKIN.tan, UNIFORM.sand, "none"),
    gun: "carbine",
    spawn: "tl:g15",
    routine: { kind: "stand" },
    barks: { firstShot: [t("На причал бегом!", "To the pier, run!")] },
  }),

  // --- The Free Bay ---------------------------------------------------------------------
  civilian("m02-mateo-bay", "mateo", MATEO_LOOK, "bay:mateo"),
  civilian("m02-captain-bay", "captain", CAPTAIN_LOOK, "bay:captain"),
  civilian("m02-nika-bay", "nika", NIKA_LOOK, "bay:nika"),
  civilian("m02-oskar", "oskar", OSKAR_LOOK, "bay:oskar"),
  civilian("m02-mila", "mila", MILA_LOOK, "bay:mila"),
  ...BAY_LOOKS.map(
    (look, index): ActorSpec => ({
      id: `bay-${String(index + 1).padStart(2, "0")}`,
      look,
      gun: null,
      faction: "neutral",
      spawn: BAY_WORK[index]![0]!,
      routine: { kind: "work", spots: BAY_WORK[index]!, dwell: 6 + (index % 4) * 3 },
      immortal: true,
    }),
  ),
];

/** The bay's people (their ids), for presences. */
export const BAY_PEOPLE: readonly string[] = ["m02-mateo-bay", "m02-captain-bay", "m02-nika-bay", "m02-oskar", "m02-mila", ...BAY_LOOKS.map((_, index) => `bay-${String(index + 1).padStart(2, "0")}`)];
