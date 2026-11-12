import type { Cutscene, DroneGroup, Mission } from "../StoryTypes";

/**
 * The prologue, "Штиль перед обрывом" — "The Calm Before the Drop"
 * (docs/campaign/campaign.md). A hot afternoon run across turquoise water
 * at the wheel of a fast sport yacht that is not his: an unknown client
 * hired the hydrographer yesterday to deliver a sealed container to the
 * outer island of the Dead Tide, and paid too well. The radio dies, the
 * screens go red with Aquilon's pass regime; two Vanguard patrol boats,
 * crewed, burst from behind a cay and open fire without a word of warning.
 * A run for the island's reef; her helm shot through, she strikes it at
 * full speed. About 16:40. The prologue ends with the crash; M01 opens on
 * the beach five minutes later.
 *
 * Nothing in it is a robot or a drone: Aquilon is the network that watches
 * and lets pass; the boats that come for him have people in them.
 */

/** The two patrol boats, lying behind the low cay with their engines idling. */
const HUNTERS: DroneGroup = { id: "hunters", at: "ambush-cay", count: 2, behaviour: "strike", spawn: [-6232, -5712], heading: 220, speed: 21, crewed: true };

/** The opening: the yacht flat out over the shallows' colours, the man at her wheel, the radio, the screens going red. */
const OPENING: Cutscene = {
  id: "opening",
  shots: [
    {
      // High over her quarter, the sun high and to the side: settling down toward her as she runs.
      seconds: 8,
      from: { eye: { anchor: "yacht", offset: [-48, 26, -70] }, look: { anchor: "yacht", offset: [0, 1.5, 30] }, fov: 42 },
      to: { eye: { anchor: "yacht", offset: [-20, 7, -26] }, look: { anchor: "yacht", offset: [0, 2, 10] }, fov: 38 },
      ease: "inOut",
      cue: [{ do: "title", style: "chapter", title: { ru: "Пролог", en: "Prologue" }, subtitle: { ru: "Штиль перед обрывом", en: "The Calm Before the Drop" } }],
    },
    {
      // Low along her side: the bow wave, the black stripe flicking past.
      seconds: 7,
      from: { eye: { anchor: "yacht", offset: [5.5, 0.6, 9] }, look: { anchor: "yacht", offset: [0, 0.9, -4] }, fov: 52 },
      to: { eye: { anchor: "yacht", offset: [4.6, 0.5, 1] }, look: { anchor: "yacht", offset: [0, 1.2, -6] }, fov: 48 },
      ease: "linear",
      shake: 0.3,
      cue: [
        {
          do: "say",
          lines: [
            {
              who: "hero",
              via: "thought",
              text: {
                ru: "Вчера — звонок от заказчика, которого я в глаза не видел. Доставить герметичный контейнер на внешний остров «Мёртвого прилива». Яхта их, деньги вперёд.",
                en: "Yesterday a call from a client I've never laid eyes on. Deliver a sealed container to the outer island of the Dead Tide. Their yacht, money up front.",
              },
            },
            { who: "hero", via: "thought", text: { ru: "Слишком хорошие деньги за один рейс.", en: "Too much money for one run." } },
          ],
        },
      ],
    },
    {
      // Over his shoulder at the wheel: the radio murmuring the forecast.
      seconds: 7,
      from: { eye: { anchor: "helm", offset: [0.5, 0.25, -0.9] }, look: { anchor: "helm", offset: [0, -0.15, 6] }, fov: 50 },
      to: { eye: { anchor: "helm", offset: [0.36, 0.15, -0.6] }, look: { anchor: "helm", offset: [0, -0.2, 6] }, fov: 44 },
      ease: "inOut",
      cue: [
        { do: "sound", sound: "radio-noise" },
        {
          do: "say",
          lines: [
            {
              who: "unknown",
              via: "radio",
              text: {
                ru: "…ветер юго-восточный, слабый… видимость отличная… к вечеру до тридцати двух градусов… повторяем прогноз для района…",
                en: "…wind south-easterly, light… visibility excellent… up to thirty-two degrees by evening… repeating the forecast for the area…",
              },
            },
          ],
        },
      ],
    },
    {
      // The radio cuts out; the screens go dark, then red.
      seconds: 7,
      from: { eye: { anchor: "helm", offset: [0.3, 0.05, -0.4] }, look: { anchor: "helm", offset: [0, -0.4, 1.2] }, fov: 40 },
      to: { eye: { anchor: "helm", offset: [0.2, -0.02, -0.2] }, look: { anchor: "helm", offset: [0, -0.45, 1.2] }, fov: 34 },
      ease: "out",
      cue: [
        {
          do: "instruments",
          on: false,
          alert: [
            { ru: "ВНИМАНИЕ: СЕКТОР ЗАКРЫТ", en: "WARNING: SECTOR CLOSED" },
            { ru: "ЦИФРОВОЙ ПРОПУСКНОЙ РЕЖИМ «АКВИЛОН»", en: "AQUILON DIGITAL PASS REGIME" },
          ],
        },
        { do: "sound", sound: "click" },
        {
          do: "say",
          lines: [
            {
              who: "aquilon",
              via: "broadcast",
              text: {
                ru: "Внимание: сектор закрыт. Цифровой пропускной режим «Аквилон». Судам без допуска лечь в дрейф и ожидать досмотра.",
                en: "Warning: sector closed. Aquilon digital pass regime. Vessels without clearance, heave to and await inspection.",
              },
            },
            { who: "hero", via: "thought", text: { ru: "Досмотр? Мне сказали — коридор открыт.", en: "Inspection? They told me the corridor was open." } },
          ],
        },
      ],
    },
  ],
};

/** The patrol boats out from behind the cay, the gunner opening up without a word. */
const CONTACT: Cutscene = {
  id: "contact",
  shots: [
    {
      // From beside the cay: the first boat bursting out round it, people aboard.
      seconds: 4.5,
      from: { eye: { anchor: "drone:hunters", offset: [14, 3, 30] }, look: { anchor: "drone:hunters", offset: [0, 1.4, 0] }, fov: 40 },
      to: { eye: { anchor: "drone:hunters", offset: [9, 2.4, 13] }, look: { anchor: "drone:hunters", offset: [0, 1.6, 1] }, fov: 46 },
      ease: "linear",
      shake: 0.4,
      cue: [{ do: "say", lines: [{ who: "hero", via: "thought", text: { ru: "Катера. Вангард. Без огней, без вызова…", en: "Patrol boats. Vanguard. No lights, no hail…" } }] }],
    },
    {
      // Over the gunner's shoulder at her: he swings the gun round and fires.
      seconds: 4,
      from: { eye: { anchor: "drone:hunters", offset: [0.9, 2.5, 1.2] }, look: { anchor: "yacht", offset: [0, 2, 0] }, fov: 20 },
      to: { eye: { anchor: "drone:hunters", offset: [0.8, 2.45, 1.6] }, look: { anchor: "yacht", offset: [0, 2, 0] }, fov: 14 },
      ease: "linear",
      shake: 0.5,
      cue: [{ do: "say", lines: [{ who: "hero", via: "voice", text: { ru: "Эй! Я гражданский!..", en: "Hey! I'm a civilian!.." } }] }],
    },
    {
      // On her: rounds splintering her side, glass going.
      seconds: 4,
      from: { eye: { anchor: "yacht", offset: [12, 3.5, 9] }, look: { anchor: "yacht", offset: [0, 1.5, 0] }, fov: 48 },
      to: { eye: { anchor: "yacht", offset: [9, 2.6, 6] }, look: { anchor: "yacht", offset: [0, 1.4, 0] }, fov: 54 },
      ease: "out",
      shake: 0.8,
      cue: [{ do: "blast", strength: 0.4 }, { do: "damage", hull: 0.12 }],
    },
  ],
};

/** Her helm shot through: the wheel dead in his hands, the reef coming up white. The last shot holds until she strikes. */
const CRASH: Cutscene = {
  id: "crash",
  hold: true,
  shots: [
    {
      // Through his eyes over the bow: the reef's white water dead ahead.
      seconds: 2.5,
      from: { eye: { anchor: "helm", offset: [0, 0.05, 0] }, look: { anchor: "helm", offset: [0.2, -0.6, 12] }, fov: 58 },
      to: { eye: { anchor: "helm", offset: [0, 0.02, 0.2] }, look: { anchor: "helm", offset: [-0.4, -0.7, 12] }, fov: 62 },
      ease: "linear",
      shake: 0.7,
    },
    {
      // Low ahead of her, looking back as she comes on at the rocks.
      seconds: 6,
      from: { eye: { anchor: "yacht", offset: [-3, 0.8, 26] }, look: { anchor: "yacht", offset: [0, 1, 0] }, fov: 46 },
      to: { eye: { anchor: "yacht", offset: [-2.5, 0.7, 14] }, look: { anchor: "yacht", offset: [0, 1, 0] }, fov: 52 },
      ease: "linear",
      shake: 0.6,
    },
  ],
};

export const PROLOGUE_CUTSCENES: readonly Cutscene[] = [OPENING, CONTACT, CRASH];

export const PROLOGUE: Mission = {
  id: "prologue",
  chapter: "prologue",
  title: { ru: "Штиль перед обрывом", en: "The Calm Before the Drop" },
  brief: {
    ru: "Жаркий день на внешней кромке архипелага. Чужая спортивная яхта, герметичный контейнер для внешнего острова и слишком щедрый заказчик. Обычный рейс — до первого выхода в эфир «Аквилона».",
    en: "A hot day on the outer edge of the archipelago. Somebody else's sport yacht, a sealed container for the outer island and a too-generous client. An ordinary run — until Aquilon comes on the air.",
  },
  sector: "dead-tide",
  requires: [],
  status: "playable",
  steps: [
    {
      id: "opening",
      objective: { kind: "watch" },
      onStart: [
        { do: "craft", craft: "sport" },
        { do: "time", hour: 16.1, hold: true },
        { do: "weather", kind: "clear" },
        { do: "engine", running: true, throttle: 0.85 },
        { do: "steer", rudder: 0, throttle: 0.85 },
        { do: "cutscene", scene: "opening" },
      ],
    },
    {
      id: "run",
      goal: { ru: "Доставьте контейнер к внешнему острову", en: "Deliver the container to the outer island" },
      hint: {
        ru: "Газ — W / S, руль — A / D или ← / → (на телефоне — рычаг и штурвал внизу)",
        en: "Throttle W / S, helm A / D or ← / → (on a phone, the lever and the wheel below)",
      },
      objective: { kind: "wait", seconds: 24 },
      marker: "delivery",
    },
    {
      id: "contact",
      objective: { kind: "watch" },
      presence: [{ kind: "drones", group: HUNTERS }],
      onStart: [{ do: "cutscene", scene: "contact" }],
    },
    {
      id: "escape",
      goal: { ru: "Уходите к острову, за риф: катерам там тесно", en: "Run for the island, inside the reef: it's tight for the patrol boats there" },
      hint: { ru: "Газ до упора, петляйте — так в вас труднее попасть", en: "Full throttle, and weave — it makes you harder to hit" },
      objective: { kind: "hull", hull: 0.32, after: 55, at: "crash" },
      marker: "crash",
      presence: [{ kind: "drones", group: HUNTERS }],
      onStart: [
        { do: "engine", running: true, throttle: 1 },
        {
          do: "say",
          lines: [
            { who: "hero", via: "voice", text: { ru: "Ну же… Давай, давай!", en: "Come on… come on!" } },
            { who: "hero", via: "thought", text: { ru: "Внешний остров. За рифом им не развернуться.", en: "The outer island. Inside the reef they can't turn." } },
          ],
        },
      ],
    },
    {
      id: "crash",
      objective: { kind: "wait", seconds: 7 },
      presence: [{ kind: "drones", group: HUNTERS }],
      onStart: [
        { do: "freeze", on: true },
        { do: "steer", rudder: 0.55, throttle: 1 },
        { do: "cutscene", scene: "crash" },
        { do: "say", lines: [{ who: "hero", via: "voice", text: { ru: "Руль не слушается!..", en: "The helm's gone!.." } }] },
      ],
      onComplete: [
        { do: "sound", sound: "crash" },
        { do: "blast", strength: 1.4 },
        { do: "damage", hull: 0.3, engine: true },
        { do: "fade", seconds: 6 },
        { do: "sound", sound: "flooding" },
      ],
    },
    {
      id: "dark",
      objective: { kind: "wait", seconds: 4 },
      onStart: [{ do: "cut" }],
    },
  ],
};
