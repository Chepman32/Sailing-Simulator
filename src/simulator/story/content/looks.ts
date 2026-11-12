import { SKIN, UNIFORM, type ActorLook } from "../../actors/ActorLooks";

/**
 * How the story's people look (docs/campaign/missions/m01.md §3): clothes
 * for the heat, faces and builds of every kind, nobody in winter kit.
 */

/** The skipper: a light linen shirt, sleeves rolled, navy shorts. */
export const HERO_LOOK: ActorLook = { model: "man", skin: SKIN.light, shirt: 0xe7dfcc, trousers: 0x1f2b46, hair: 0x3a2a1e, vest: null, head: "none" };

/** Mark Holloway: a faded olive shirt, a mended sand plate carrier, cargo trousers, a pale panama, his old platoon's band on the wrist. */
export const MARK_LOOK: ActorLook = {
  model: "man",
  skin: SKIN.olive,
  shirt: 0x6e7150,
  trousers: 0x6a6150,
  hair: 0x6b5a48,
  vest: 0xc2ad84,
  head: "panama",
  headColor: 0xe2d8bf,
  armband: true,
  scale: 1.03,
};

/** Luis Mendes: a faded coral tee of the old fishing co-op, blue shorts, a grey beard. */
export const LUIS_LOOK: ActorLook = { model: "man", skin: SKIN.tan, shirt: 0xe07c63, trousers: 0x2f5f8c, hair: 0xa8a6a0, vest: null, head: "none", scale: 0.97 };

/** Maya Rivera: a loose sea-green shirt, linen shorts, a medical bag across her. */
export const MAYA_LOOK: ActorLook = { model: "woman", skin: SKIN.brown, shirt: 0x3f9c95, trousers: 0xd8cbb0, hair: 0x241a14, vest: null, head: "none", bag: true };

/** The commander: a pale sand field shirt, a grey-green vest, short hair. */
export const COMMANDER_LOOK: ActorLook = { model: "man", skin: SKIN.light, shirt: 0xcbb88f, trousers: 0x8b7d5c, hair: 0x2c241e, vest: 0x5f6a5c, head: "none", scale: 1.06 };

/** A Vanguard contractor in the light uniform: shirt, trousers, vest, headgear varied. */
export function contractor(
  model: "man" | "woman",
  skin: number,
  shirt: number,
  head: ActorLook["head"],
  extra: Partial<ActorLook> = {},
): ActorLook {
  return { model, skin, shirt, trousers: extra.trousers ?? UNIFORM.khaki, hair: extra.hair ?? 0x2a2018, vest: extra.vest === undefined ? UNIFORM.greyGreen : extra.vest, head, ...extra };
}

/** The crews of the patrol boats. */
export const VANGUARD_CREW: readonly ActorLook[] = [
  contractor("man", SKIN.tan, UNIFORM.olive, "helmet", { headColor: 0x8d8a78 }),
  contractor("woman", SKIN.light, UNIFORM.sand, "cap", { glasses: true, goggles: false }),
  contractor("man", SKIN.brown, UNIFORM.olive, "cap", { glasses: true }),
];
