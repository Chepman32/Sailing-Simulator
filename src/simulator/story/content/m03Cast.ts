import type { ActorSpec } from "../../actors/ActorSystem";
import type { ActorLook } from "../../actors/ActorLooks";
import { SKIN, UNIFORM } from "../../actors/ActorLooks";
import { contractor } from "./looks";

/**
 * M03's people (docs/campaign/missions/m03.md): Kenji, who goes with the
 * hero; Inés, Tiago and the cook in the village; at the station Luis the
 * shift lead, Daria with her tanker, Asha and three workers; and the
 * twenty-four of the company's security (E01–E18 at the station, E19–E24
 * the reserve that comes down the north road once the crane moves).
 */

const t = (ru: string, en: string) => ({ ru, en });

export const KENJI_LOOK: ActorLook = { model: "man", skin: SKIN.light, shirt: 0x3d4146, trousers: 0x55524a, hair: 0x9b9890, vest: 0xe4e0d6, head: "none", goggles: true, scale: 0.96 };
const INES_LOOK: ActorLook = { model: "woman", skin: SKIN.olive, shirt: 0xe0a24a, trousers: 0x3a4a5c, hair: 0x1e1410, vest: null, head: "none" };
const TIAGO_LOOK: ActorLook = { model: "man", skin: SKIN.brown, shirt: 0x5aa36a, trousers: 0xd2c6a6, hair: 0x140e0a, vest: null, head: "cap", headColor: 0xe8e2d0, scale: 0.92 };
const COOK_LOOK: ActorLook = { model: "woman", skin: SKIN.tan, shirt: 0xf2f0ea, trousers: 0x6a3f5a, hair: 0x2a1c12, vest: null, head: "none" };
const LUIS_W_LOOK: ActorLook = { model: "man", skin: SKIN.tan, shirt: 0xe86a2a, trousers: 0x3b4250, hair: 0x2a2018, vest: null, head: "cap", headColor: 0xf2c230 };
const DARIA_LOOK: ActorLook = { model: "woman", skin: SKIN.fair, shirt: 0x6a8aa8, trousers: 0x2a2e36, hair: 0x8a5a2a, vest: null, head: "cap", headColor: 0x2f6fb5 };
const ASHA_LOOK: ActorLook = { model: "woman", skin: SKIN.dark, shirt: 0xe86a2a, trousers: 0x3a3a3a, hair: 0x0e0a08, vest: null, head: "none" };
const WORKER_LOOKS: readonly ActorLook[] = [
  { model: "man", skin: SKIN.olive, shirt: 0xe86a2a, trousers: 0x2f3a48, hair: 0x2a1e14, vest: null, head: "cap", headColor: 0xf2c230 },
  { model: "man", skin: SKIN.brown, shirt: 0xe86a2a, trousers: 0x2f3a48, hair: 0x140e0a, vest: null, head: "none" },
  { model: "woman", skin: SKIN.light, shirt: 0xe86a2a, trousers: 0x2f3a48, hair: 0x3a2a1c, vest: null, head: "cap", headColor: 0xf2c230 },
];

const COMMON = {
  manDown: [t("Человек упал! Прикрой!", "Man down! Cover me!")],
  lost: [t("Потерял его. Держите проходы.", "Lost him. Hold the passages.")],
  surrender: [t("Всё! Не стреляй, ухожу!", "Enough! Don't shoot, I'm leaving!")],
  regroup: [t("Отходим! Через северную тропу!", "Fall back! By the north path!")],
} as const;

const guard = (squad: string, spec: Omit<ActorSpec, "faction" | "squad">): ActorSpec => ({ faction: "hostile", squad, ...spec, barks: { ...COMMON, ...spec.barks } });

const person = (id: string, character: string | undefined, look: ActorLook, spawn: string): ActorSpec => ({
  id,
  character,
  look,
  gun: null,
  faction: "neutral",
  spawn,
  routine: { kind: "hold" },
  immortal: true,
});

/** The security's looks by number (two authored soldiers and the stand-ins, varied). */
const looks: readonly ActorLook[] = [
  contractor("man", SKIN.tan, UNIFORM.olive, "cap", { glasses: true }),
  contractor("man", SKIN.light, UNIFORM.sand, "helmet", { headColor: 0x7a7a64 }),
  contractor("woman", SKIN.olive, UNIFORM.olive, "cap", { hair: 0x2a1a10 }),
  contractor("man", SKIN.brown, UNIFORM.cargo, "none"),
  contractor("man", SKIN.olive, UNIFORM.khaki, "panama", { headColor: 0xb8a57c }),
  contractor("man", SKIN.light, UNIFORM.olive, "helmet", { headColor: 0x5f6a5c }),
];

const BARKS: Record<string, ActorSpec["barks"]> = {
  s01: { noticed: [t("Эй. Стой у ворот.", "Hey. Stop at the gate.")], firstShot: [t("Контакт у КПП!", "Contact at the checkpoint!")] },
  s02: { firstShot: [t("Контакт у КПП!", "Contact at the checkpoint!")] },
  s04: { contact: [t("Обошёл со склада!", "He's come round by the store!")] },
  s09: { firstShot: [t("На галерее! Не пускайте к двери!", "On the gallery! Keep him off the door!")] },
  s12: { firstShot: [t("К лестнице пошёл!", "He's going for the stairs!")] },
  s14: { contact: [t("От контейнера! Назад!", "Away from the container! Back!")] },
  s16: { firstShot: [t("Через склад! Не стойте у ворот!", "Through the store! Don't stand at the gate!")] },
};

export const M03_ACTORS: readonly ActorSpec[] = [
  // Kenji goes with him from the square to the station.
  { id: "kenji-m03", character: "kenji", look: KENJI_LOOK, gun: null, faction: "ally", spawn: "sc:kenji", routine: { kind: "hold" }, immortal: true },
  person("ines", "ines", INES_LOOK, "sc:ines"),
  person("tiago", "tiago", TIAGO_LOOK, "sc:tiago"),
  person("cook", undefined, COOK_LOOK, "sc:cook"),
  person("luis-w", "luis-w", LUIS_W_LOOK, "lg4:luis"),
  person("daria", "daria", DARIA_LOOK, "lg4:daria"),
  person("asha", "asha", ASHA_LOOK, "lg4:asha"),
  ...WORKER_LOOKS.map((look, index) => person(`worker-${index + 1}`, undefined, look, `lg4:w${index + 1}`)),
  // The security: the checkpoint, the tech building, the gallery, the yard and the tower; then the reserve.
  ...Array.from({ length: 24 }, (_, index): ActorSpec => {
    const id = `s${String(index + 1).padStart(2, "0")}`;
    const squad = index < 4 ? "gate" : index < 10 ? "tech" : index < 18 ? "yard" : "reserve";
    return guard(squad, {
      id,
      character: id === "s13" ? "security-lead" : undefined,
      look: looks[index % looks.length]!,
      gun: "carbine",
      spawn: `lg4:${id}`,
      routine: { kind: "stand" },
      stubborn: id === "s13" ? false : undefined,
      skill: index >= 18 ? 1.05 : 0.95,
      barks: BARKS[id],
    });
  }),
];

/** The station's security by squad, for presences. */
export const LG4_GUARDS: readonly string[] = Array.from({ length: 24 }, (_, index) => `s${String(index + 1).padStart(2, "0")}`);
export const LG4_PEOPLE: readonly string[] = ["luis-w", "daria", "asha", "worker-1", "worker-2", "worker-3"];
export const SC_PEOPLE: readonly string[] = ["ines", "tiago", "cook"];
