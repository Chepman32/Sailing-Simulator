import type { ActorSpec } from "../../actors/ActorSystem";
import { SKIN, UNIFORM } from "../../actors/ActorLooks";
import { COMMANDER_LOOK, HERO_LOOK, LUIS_LOOK, MARK_LOOK, MAYA_LOOK, contractor } from "./looks";

/**
 * M01's people on their feet (docs/campaign/missions/m01.md §3.7): Mark,
 * Luis, Maya, and exactly the nineteen hostile people the document counts —
 * eleven at Створ-9, five who come with the commander, the commander
 * himself, and the two in the patrol boat (who are her crew, in
 * `BoatFigures`, not here). Nobody is spawned anew once taken down.
 */

const t = (ru: string, en: string) => ({ ru, en });

/** What any of the outpost's people may shout (each line said once). */
const COMMON = {
  manDown: [t("Всем проверить позиции! У нас человек на земле!", "Everybody check your positions! We've got a man down!")],
  lost: [t("Я его потерял. Не высовывайтесь в одиночку.", "I've lost him. Nobody sticks their head out alone.")],
  surrender: [t("Всё! Оружие бросаю. Только не стреляй!", "That's it! I'm dropping it. Just don't shoot!")],
} as const;

const post = (spec: Omit<ActorSpec, "faction" | "squad">): ActorSpec => ({ faction: "hostile", squad: "post", ...spec, barks: { ...COMMON, ...spec.barks } });
const relief = (spec: Omit<ActorSpec, "faction" | "squad">): ActorSpec => ({ faction: "hostile", squad: "relief", ...spec, barks: { ...COMMON, ...spec.barks } });

export const M01_ACTORS: readonly ActorSpec[] = [
  // --- Mark, and the people of the story -----------------------------------------
  { id: "mark", character: "holloway", look: MARK_LOOK, gun: "carbine", faction: "ally", spawn: "kosaya:mark-hidden", routine: { kind: "hold" }, immortal: true, skill: 1.1 },
  { id: "luis", character: "luis", look: LUIS_LOOK, gun: null, faction: "neutral", spawn: "stvor9:luis", routine: { kind: "sit", seat: 0.16 }, immortal: true },
  { id: "mark-cove", character: "holloway", look: MARK_LOOK, gun: null, faction: "ally", spawn: "cove:mark", routine: { kind: "hold" }, immortal: true },
  { id: "luis-cove", character: "luis", look: LUIS_LOOK, gun: null, faction: "neutral", spawn: "cove:luis", routine: { kind: "sit", seat: 0.45 }, immortal: true },
  { id: "maya", character: "maya", look: MAYA_LOOK, gun: null, faction: "ally", spawn: "cove:maya", routine: { kind: "hold" }, immortal: true },
  // The three people of the montage, where the story will find them.
  {
    id: "kenji",
    character: "kenji",
    look: { model: "man", skin: SKIN.light, shirt: 0x3d4146, trousers: 0x55524a, hair: 0x9b9890, vest: 0xe4e0d6, head: "none", goggles: true, scale: 0.96 },
    gun: null,
    faction: "neutral",
    spawn: "kenji:kenji",
    routine: { kind: "hold" },
    immortal: true,
  },
  {
    id: "sara",
    character: "sara",
    look: { model: "woman", skin: SKIN.fair, shirt: 0x5d6f86, trousers: 0x3b4250, hair: 0x6a4a2e, vest: null, head: "none" },
    gun: null,
    faction: "neutral",
    spawn: "sara:sara",
    routine: { kind: "sit", seat: 0.05 },
    immortal: true,
  },
  {
    id: "viktor",
    character: "sedov",
    look: { model: "man", skin: SKIN.light, shirt: 0xd9d2c2, trousers: 0x4a4a46, hair: 0xb8b5ae, vest: null, head: "none", scale: 1.02 },
    gun: null,
    faction: "neutral",
    spawn: "viktor:viktor",
    routine: { kind: "hold" },
    immortal: true,
  },

  // --- Створ-9: the eleven of the outpost ----------------------------------------
  post({
    id: "p01",
    look: contractor("man", SKIN.tan, UNIFORM.olive, "panama", { glasses: true, headColor: 0xb8a57c }),
    gun: "carbine",
    spawn: "stvor9:p01",
    routine: { kind: "stand" },
    barks: { firstShot: [t("Стрельба! Всем в укрытие!", "Shots fired! Everybody into cover!")] },
  }),
  post({
    id: "p02",
    look: contractor("woman", SKIN.light, UNIFORM.sand, "none", { vest: 0x7a7f6a, hair: 0x3b2a1e }),
    gun: "carbine",
    spawn: "stvor9:p02",
    routine: { kind: "stand" },
    barks: { manDown: [t("У нас раненый! Нужна помощь!", "We've got wounded! Need help here!")] },
  }),
  post({
    id: "p03",
    look: contractor("man", SKIN.olive, UNIFORM.olive, "none", { vest: null, hair: 0x8a8680, trousers: UNIFORM.cargo, scale: 1.04 }),
    gun: "pistol",
    spawn: "stvor9:p03",
    routine: { kind: "work", spots: ["stvor9:p03", "stvor9:p03-water"], dwell: 28 },
    barks: { firstShot: [t("Стрельба! Всем в укрытие!", "Shots fired! Everybody into cover!")] },
  }),
  post({
    id: "p04",
    look: contractor("man", SKIN.brown, UNIFORM.sand, "cap", { glasses: true, trousers: UNIFORM.sand, scale: 0.97 }),
    gun: "carbine",
    spawn: "stvor9:p04",
    routine: { kind: "patrol", route: "stvor9:p04", pause: 4 },
    barks: { regroup: [t("Не бегите в одиночку, держитесь вместе!", "Don't run off alone, stick together!")] },
  }),
  post({
    id: "p05",
    look: contractor("woman", SKIN.tan, UNIFORM.olive, "panama", { headColor: 0x9a8a64 }),
    gun: "carbine",
    spawn: "stvor9:p05",
    routine: { kind: "patrol", route: "stvor9:p05", pause: 6 },
    barks: { noticed: [t("Слышали? Со стороны склона.", "Hear that? From the slope.")] },
  }),
  post({
    id: "p06",
    look: contractor("man", SKIN.light, 0x2b2d2a, "none", { hair: 0x1e1a16 }),
    gun: "carbine",
    spawn: "stvor9:p06",
    routine: { kind: "work", spots: ["stvor9:p06", "stvor9:p06-post"], dwell: 40 },
    barks: { contact: [t("Контакт у забора! Проверяю.", "Contact at the fence! Checking it.")] },
  }),
  post({
    id: "i07",
    look: contractor("man", SKIN.olive, UNIFORM.khaki, "headset", { vest: null }),
    gun: "pistol",
    spawn: "stvor9:i07",
    routine: { kind: "sit", seat: 0.48 },
  }),
  post({
    id: "i08",
    look: contractor("woman", SKIN.brown, UNIFORM.sand, "none", { vest: null, hair: 0x15100c }),
    gun: "carbine",
    spawn: "stvor9:i08",
    routine: { kind: "work", spots: ["stvor9:i08", "stvor9:i08-terminal"], dwell: 14 },
  }),
  post({
    id: "i09",
    look: contractor("man", SKIN.tan, UNIFORM.olive, "none", { hair: 0x1a1512, vest: null, scale: 1.05 }),
    gun: "carbine",
    spawn: "stvor9:i09",
    routine: { kind: "sit", seat: 0.48 },
  }),
  post({
    id: "d10",
    look: contractor("man", SKIN.dark, UNIFORM.sand, "cap", { headColor: 0xf2f0ea, vest: null }),
    gun: "pistol",
    spawn: "stvor9:d10",
    routine: { kind: "stand" },
  }),
  post({
    id: "d11",
    look: contractor("man", SKIN.light, UNIFORM.khaki, "none", { vest: UNIFORM.olive, hair: 0x6a4a2a }),
    gun: "carbine",
    spawn: "stvor9:d11",
    routine: { kind: "stand" },
  }),

  // --- The five who come with the commander, and the commander --------------------
  relief({
    id: "e12",
    look: contractor("man", SKIN.olive, UNIFORM.olive, "helmet", { headColor: 0x8d8a78 }),
    gun: "carbine",
    spawn: "stvor9:jeep1",
    routine: { kind: "hold" },
    barks: { regroup: [t("Не стреляйте по нашим! Держите интервалы!", "Watch your fire! Keep your spacing!")] },
  }),
  relief({
    id: "e13",
    look: contractor("woman", SKIN.tan, UNIFORM.sand, "panama", { headColor: 0xc8b48a }),
    gun: "carbine",
    spawn: "stvor9:jeep1",
    routine: { kind: "hold" },
    barks: { contact: [t("Контакт на втором этаже! Он уходит к служебному выходу!", "Contact, second floor! He's heading for the service exit!")] },
  }),
  relief({
    id: "e14",
    look: contractor("man", SKIN.light, UNIFORM.khaki, "helmet", { headColor: 0xd8d2c0 }),
    gun: "carbine",
    spawn: "stvor9:jeep2",
    routine: { kind: "hold" },
    barks: { firstShot: [t("Держите лестницу! Не давать ему пройти!", "Hold the stairs! Don't let him through!")] },
  }),
  relief({
    id: "e15",
    look: contractor("man", SKIN.brown, UNIFORM.olive, "cap", { glasses: true }),
    gun: "carbine",
    spawn: "stvor9:jeep2",
    routine: { kind: "hold" },
    barks: { noticed: [t("Вижу двоих! Один в старом жилете!", "I see two! One in an old vest!")] },
  }),
  relief({
    id: "e16",
    look: contractor("woman", SKIN.olive, UNIFORM.khaki, "none", { hair: 0x2a1d14 }),
    gun: "carbine",
    spawn: "stvor9:jeep2",
    routine: { kind: "hold" },
    barks: { manDown: [t("У нас раненый! Нужен медик!", "Man down! We need a medic!")] },
  }),
  { id: "k17", character: "commander", look: COMMANDER_LOOK, gun: "pistol", faction: "neutral", squad: "command", spawn: "stvor9:jeep1", routine: { kind: "hold" }, immortal: true, stubborn: true },
];

/** The skipper as the story's figure (in a scene on foot, in a boat). */
export const HERO_FIGURE = HERO_LOOK;
