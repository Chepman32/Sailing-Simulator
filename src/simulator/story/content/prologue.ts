import type { Cutscene, Mission } from "../StoryTypes";

/**
 * Mission 1 (the prologue), "Штиль перед обрывом" — "The Calm Before the
 * Drop" (docs/campaign/campaign.md). A sunset run before the trade wind
 * with fuel and fresh water for the far atolls; the radio dies, the
 * instruments die, a drone bursts from behind a cape and shoots the rig
 * away; a run for the reefs off the old light; a second drone rams her onto
 * the rocks. Dawn on the outer shoal: up the rock above the tide line, along
 * the path to the abandoned lighthouse, fresh cases in the dust — and a
 * rifle bolt behind him. Holloway.
 *
 * The opening is a cut scene; the route comes in from the south-east so the
 * trade wind (from about 120°) is fair for her all the way to the light.
 */

/** The opening: sunset, the run in, the radio's forecast, the screens going dark and then red. */
const OPENING: Cutscene = {
  id: "opening",
  shots: [
    {
      // High and wide over her quarter, the low sun behind: settling down toward her.
      seconds: 8,
      from: { eye: { anchor: "yacht", offset: [-52, 30, -72] }, look: { anchor: "yacht", offset: [0, 2, 26] }, fov: 40 },
      to: { eye: { anchor: "yacht", offset: [-24, 9, -30] }, look: { anchor: "yacht", offset: [0, 4, 8] }, fov: 36 },
      ease: "inOut",
      cue: [
        { do: "title", style: "chapter", title: { ru: "Пролог", en: "Prologue" }, subtitle: { ru: "Штиль перед обрывом", en: "The Calm Before the Drop" } },
        { do: "sound", sound: "radio-noise" },
      ],
    },
    {
      // Low along her lee hull: the bow wave, the cans lashed on deck.
      seconds: 7,
      from: { eye: { anchor: "yacht", offset: [6.5, 1.1, 11] }, look: { anchor: "yacht", offset: [0, 1.6, -3] }, fov: 50 },
      to: { eye: { anchor: "yacht", offset: [5.2, 0.9, 3] }, look: { anchor: "yacht", offset: [0, 2.4, -6] }, fov: 46 },
      ease: "linear",
      shake: 0.25,
      cue: [
        {
          do: "say",
          lines: [
            {
              who: "hero",
              via: "thought",
              text: {
                ru: "Сорок канистр солярки и сорок — пресной воды. Дальние атоллы ждут их неделю. Попутный ветер, мягкий закат, к полуночи буду на месте.",
                en: "Forty cans of diesel and forty of fresh water. The far atolls have waited a week for them. A fair wind, a soft sunset, there by midnight.",
              },
            },
          ],
        },
      ],
    },
    {
      // Over his shoulder at the wheel: the shortwave crackling a forecast.
      seconds: 8,
      from: { eye: { anchor: "helm", offset: [0.42, 0.12, -0.55] }, look: { anchor: "helm", offset: [-0.05, -0.32, 0.75] }, fov: 46 },
      to: { eye: { anchor: "helm", offset: [0.3, 0.05, -0.35] }, look: { anchor: "helm", offset: [-0.05, -0.36, 0.75] }, fov: 40 },
      ease: "inOut",
      cue: [
        {
          do: "say",
          lines: [
            {
              who: "unknown",
              via: "radio",
              text: {
                ru: "…ветер юго-восточный, четыре — пять метров в секунду… волнение два балла… к ночи без изменений… повторяем прогноз для района…",
                en: "…wind south-easterly, four to five metres a second… sea state two… no change by night… repeating the forecast for the area…",
              },
            },
          ],
        },
      ],
    },
    {
      // The radio cuts out; every screen goes dark, then red.
      seconds: 7,
      from: { eye: { anchor: "helm", offset: [0.25, 0.02, -0.3] }, look: { anchor: "helm", offset: [-0.05, -0.38, 0.75] }, fov: 38 },
      to: { eye: { anchor: "helm", offset: [0.18, -0.04, -0.12] }, look: { anchor: "helm", offset: [-0.05, -0.4, 0.75] }, fov: 34 },
      ease: "out",
      cue: [
        {
          do: "instruments",
          on: false,
          alert: [
            { ru: "ВНИМАНИЕ: СЕКТОР ЗАБЛОКИРОВАН", en: "WARNING: SECTOR LOCKED" },
            { ru: "АВТОНОМНЫЙ КАРАНТИН ПРОТОКОЛА «АКВИЛОН»", en: "AUTONOMOUS QUARANTINE · AQUILON PROTOCOL" },
          ],
        },
        { do: "sound", sound: "click" },
        {
          do: "say",
          lines: [
            {
              who: "aquilon",
              via: "broadcast",
              text: { ru: "Внимание: сектор заблокирован. Автономный карантин Протокола «Аквилон».", en: "Warning: sector locked. Autonomous quarantine, Aquilon Protocol." },
            },
          ],
        },
      ],
    },
  ],
};

/** The drone from behind the cape, its turret opening up, the rig shot away. */
const CONTACT: Cutscene = {
  id: "contact",
  shots: [
    {
      // From beside the cape: the drone bursts out round it at full speed.
      seconds: 5,
      from: { eye: { anchor: "drone:ambush", offset: [16, 3.5, 34] }, look: { anchor: "drone:ambush", offset: [0, 1.2, 0] }, fov: 40 },
      to: { eye: { anchor: "drone:ambush", offset: [11, 2.6, 15] }, look: { anchor: "drone:ambush", offset: [0, 1.4, 2] }, fov: 46 },
      ease: "linear",
      shake: 0.4,
      cue: [
        {
          do: "say",
          lines: [{ who: "hero", via: "thought", text: { ru: "Катер? Без огней, без людей…", en: "A launch? No lights, nobody aboard…" } }],
        },
      ],
    },
    {
      // Over its weapon station at her: the turret turns and opens up without a word.
      seconds: 4,
      from: { eye: { anchor: "drone:ambush", offset: [2.2, 2.6, -6] }, look: { anchor: "yacht", offset: [0, 5, 0] }, fov: 16 },
      to: { eye: { anchor: "drone:ambush", offset: [1.9, 2.4, -4.5] }, look: { anchor: "yacht", offset: [0, 5, 0] }, fov: 11 },
      ease: "linear",
      shake: 0.5,
    },
    {
      // On her: a heavy round splits the mast, the sail goes to rags.
      seconds: 4.5,
      from: { eye: { anchor: "yacht", offset: [14, 4, 10] }, look: { anchor: "yacht", offset: [0, 7, 0] }, fov: 46 },
      to: { eye: { anchor: "yacht", offset: [11, 3, 7] }, look: { anchor: "yacht", offset: [0, 4, 0] }, fov: 52 },
      ease: "out",
      shake: 0.8,
      cue: [
        { do: "rig", broken: true },
        { do: "sound", sound: "mast" },
        { do: "blast", strength: 0.55 },
        { do: "damage", hull: 0.12 },
      ],
    },
  ],
};

/** The second drone drives into her side. The last shot holds until it strikes. */
const RAM: Cutscene = {
  id: "ram",
  hold: true,
  shots: [
    {
      // Wide on her beam: something low and fast coming in out of the dusk.
      seconds: 3,
      from: { eye: { anchor: "yacht", offset: [-46, 7, 14] }, look: { anchor: "drone:rammer", offset: [0, 1, 0] }, fov: 44 },
      to: { eye: { anchor: "yacht", offset: [-36, 5, 8] }, look: { anchor: "drone:rammer", offset: [0, 1, 0] }, fov: 40 },
      ease: "linear",
      shake: 0.3,
    },
    {
      // Low on her quarter, the drone filling the frame as it strikes.
      seconds: 6,
      from: { eye: { anchor: "yacht", offset: [-11, 2.4, -9] }, look: { anchor: "yacht", offset: [-1, 1.2, 1] }, fov: 52 },
      to: { eye: { anchor: "yacht", offset: [-9, 2, -7] }, look: { anchor: "yacht", offset: [-1, 1.2, 1] }, fov: 56 },
      ease: "linear",
      shake: 0.6,
    },
  ],
};

/** The bolt behind him, and the man who worked it. */
const AMBUSH: Cutscene = {
  id: "ambush",
  hold: true,
  shots: [
    {
      // Over his own shoulder, looking at the cases in the dust; the click.
      seconds: 1.6,
      from: { eye: { anchor: "skipper", offset: [0.45, 1.75, -0.7] }, look: { anchor: "skipper", offset: [0, 0.3, 3] }, fov: 48 },
      ease: "linear",
    },
    {
      // Round to the man on the slope, the rifle on him.
      seconds: 9,
      from: { eye: { anchor: "npc:holloway", offset: [0.9, 1.7, 3.4] }, look: { anchor: "npc:holloway", offset: [0, 1.45, 0] }, fov: 34 },
      to: { eye: { anchor: "npc:holloway", offset: [0.7, 1.65, 2.6] }, look: { anchor: "npc:holloway", offset: [0, 1.5, 0] }, fov: 30 },
      ease: "inOut",
    },
  ],
};

export const PROLOGUE_CUTSCENES: readonly Cutscene[] = [OPENING, CONTACT, RAM, AMBUSH];

export const PROLOGUE: Mission = {
  id: "prologue",
  chapter: "prologue",
  title: { ru: "Штиль перед обрывом", en: "The Calm Before the Drop" },
  brief: {
    ru: "Закат на внешней границе архипелага. Груз — топливо и пресная вода для дальних атоллов. Обычный рейс — до первого выхода в эфир «Аквилона».",
    en: "Sunset on the outer edge of the archipelago. Fuel and fresh water for the far atolls. An ordinary run — until Aquilon comes on the air.",
  },
  sector: "dead-tide",
  requires: [],
  status: "playable",
  steps: [
    {
      id: "opening",
      objective: { kind: "watch" },
      onStart: [
        { do: "time", hour: 18.15 },
        { do: "weather", kind: "clear" },
        { do: "engine", running: false },
        { do: "steer", rudder: 0, throttle: 0 },
        { do: "cutscene", scene: "opening" },
      ],
    },
    {
      id: "contact",
      objective: { kind: "watch" },
      presence: [
        {
          kind: "drones",
          // Lying behind the cape, out round it at full speed the moment the screens die.
          group: { id: "ambush", at: "outer-cay", count: 1, behaviour: "strike", spawn: [-4850, -6272], heading: 191, speed: 19 },
        },
      ],
      onStart: [{ do: "cutscene", scene: "contact" }],
    },
    {
      id: "escape",
      goal: { ru: "Уходите на рифы у маяка: тяжёлый катер туда не сунется", en: "Run for the reefs off the light: the heavy launch won't follow in" },
      hint: {
        ru: "Мотор заведён, газ до упора. Рулите к отметке: A / D или ← / → (на телефоне — штурвал внизу)",
        en: "The engine's going, full ahead. Steer for the marker: A / D or ← / → (on a phone, the wheel below)",
      },
      objective: { kind: "hull", hull: 0.3, after: 45, at: "reef-refuge" },
      marker: "reef-refuge",
      presence: [{ kind: "drones", group: { id: "ambush", at: "outer-cay", count: 1, behaviour: "strike", spawn: [-4850, -6272], heading: 191, speed: 19 } }],
      onStart: [
        { do: "engine", running: true, throttle: 1 },
        {
          do: "say",
          lines: [
            { who: "hero", via: "voice", text: { ru: "Мачта — к чёрту. Мотор! Давай, родная…", en: "The mast's gone. Engine! Come on, old girl…" } },
            {
              who: "hero",
              via: "thought",
              text: { ru: "Рифы у маяка. Осадка у него глубже моей — на мелководье не полезет.", en: "The reefs off the light. He draws more than I do — he won't come into the shallows." },
            },
          ],
        },
      ],
    },
    {
      id: "rammed",
      objective: { kind: "event", event: "rammed:rammer", after: 12 },
      presence: [
        { kind: "drones", group: { id: "ambush", at: "outer-cay", count: 1, behaviour: "strike", spawn: [-4850, -6272], heading: 191, speed: 19 } },
        { kind: "drones", group: { id: "rammer", at: "reef-refuge", count: 1, behaviour: "ram", speed: 24 } },
      ],
      onStart: [
        { do: "freeze", on: true },
        { do: "cutscene", scene: "ram" },
        { do: "say", lines: [{ who: "hero", via: "voice", text: { ru: "Второй! С борта!..", en: "Another! On the beam!.." } }] },
      ],
      onComplete: [
        { do: "sound", sound: "crash" },
        { do: "blast", strength: 1.2 },
        { do: "damage", hull: 0.3, engine: true },
        { do: "fade", seconds: 5 },
        { do: "sound", sound: "flooding" },
      ],
    },
    {
      id: "sinking",
      objective: { kind: "wait", seconds: 4.5 },
      onStart: [{ do: "cut" }],
      onComplete: [
        // Holed and flooded, but the reef held her up: she lies off the shoal.
        { do: "place", yacht: "wash-up", skipper: "ashore" },
        { do: "repair", hull: 0.25 },
        // Her electronics drowned with her: the alert is gone with them.
        { do: "instruments", on: true },
        { do: "freeze", on: false },
        { do: "time", hour: 6.2 },
        { do: "weather", kind: "overcast" },
        { do: "wake" },
        { do: "sound", sound: "surf" },
      ],
    },
    {
      id: "ashore",
      goal: { ru: "Поднимитесь на скалу выше линии прилива", en: "Climb the rock above the tide line" },
      hint: { ru: "Волна вот-вот утащит остатки груза", en: "The surf is about to drag what's left of the cargo away" },
      objective: { kind: "reach", at: "tide-rock", by: "foot" },
      marker: "tide-rock",
      checkpoint: { yacht: "wash-up", skipper: "ashore" },
      presence: [{ kind: "props", set: "flotsam", at: "wash-up" }],
      onStart: [
        { do: "title", style: "place", title: { ru: "Мёртвый прилив", en: "Dead Tide" }, subtitle: { ru: "Внешняя отмель · рассвет", en: "The outer shoal · dawn" } },
        {
          do: "say",
          lines: [
            { who: "hero", via: "thought", text: { ru: "Живой… Песок во рту, в ушах звон.", en: "Alive… Sand in my mouth, a ringing in my ears." } },
            {
              who: "hero",
              via: "thought",
              text: {
                ru: "Нож, компас, ранец — всё, что было на ремне. Обломки мачты, канистры… Прилив поднимается. Наверх, пока волна не утащила остальное.",
                en: "Knife, compass, pack — whatever was on my belt. Bits of the mast, the cans… The tide's coming in. Up, before the surf takes the rest.",
              },
            },
          ],
        },
      ],
    },
    {
      id: "view",
      objective: { kind: "listen" },
      onStart: [
        {
          do: "say",
          lines: [
            {
              who: "hero",
              via: "thought",
              text: {
                ru: "Туман. Лабиринт чужих островов… А там, на горизонте, — дым. Горят буровые. Это не учения.",
                en: "Fog. A maze of strange islands… And out there, on the horizon — smoke. The rigs are burning. This is no exercise.",
              },
            },
            { who: "hero", via: "thought", text: { ru: "Маяк. Старый, но там может быть рация.", en: "A lighthouse. Old, but there might be a radio." } },
          ],
        },
      ],
    },
    {
      id: "path",
      goal: { ru: "Идите по тропе к старому маяку", en: "Follow the path to the old lighthouse" },
      objective: { kind: "reach", at: "light-tracks", by: "foot" },
      marker: "old-light",
      presence: [{ kind: "props", set: "tracks", at: "light-tracks" }],
    },
    {
      id: "tracks",
      objective: { kind: "wait", seconds: 3.6 },
      presence: [{ kind: "props", set: "tracks", at: "light-tracks" }],
      onStart: [
        {
          do: "say",
          lines: [{ who: "hero", via: "thought", text: { ru: "Следы сапог. Гильзы — свежие, ещё пахнут порохом.", en: "Boot prints. Spent cases — fresh, they still smell of powder." } }],
        },
      ],
    },
    {
      id: "ambush",
      objective: { kind: "listen" },
      presence: [
        { kind: "props", set: "tracks", at: "light-tracks" },
        { kind: "npc", character: "holloway", at: "light-ambush", face: "light-tracks", kit: "armed" },
      ],
      onStart: [
        { do: "freeze", on: true },
        { do: "sound", sound: "click" },
        { do: "cutscene", scene: "ambush" },
        {
          do: "say",
          lines: [
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Руки на затылок, турист. Если ты из корпоративных «чистильщиков», то у тебя отвратительно тихий мотор, но очень громкие шаги.",
                en: "Hands on your head, tourist. If you're one of the corporate cleaners, you've got a damn quiet engine and mighty loud feet.",
              },
            },
          ],
        },
      ],
      onComplete: [{ do: "cut" }, { do: "freeze", on: false }, { do: "look", at: "npc:holloway" }],
    },
    {
      id: "talk",
      goal: { ru: "Поговорите с Холлоуэем", en: "Talk to Holloway" },
      objective: { kind: "talk", character: "holloway" },
      marker: "light-ambush",
      presence: [
        { kind: "props", set: "tracks", at: "light-tracks" },
        { kind: "npc", character: "holloway", at: "light-ambush", face: "light-tracks", kit: "armed" },
      ],
      onComplete: [
        {
          do: "say",
          lines: [
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Ладно, забудь. Твою лодку только что пустили на дно «Аквилона». Здесь каждый выживает как может.",
                en: "All right, forget it. Aquilon just put your boat on the bottom. Out here everybody survives however they can.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Если хочешь не сдохнуть от пуль автоматонов или голода через три дня — топай за мной в схрон к старику Сато. Нам как раз нужны отчаянные головы, чтобы вернуть эту проклятую акваторию.",
                en: "If you don't want to die of automaton lead or hunger in three days, follow me to old Sato's hideout. We could use a few desperate heads to take these damned waters back.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: { ru: "Держи. Пистолет, пара магазинов, и карта секторов. Нож у тебя свой, вижу.", en: "Here. A pistol, a couple of magazines, and a chart of the sectors. You've your own knife, I see." },
            },
          ],
        },
        { do: "give", what: "pistol" },
        { do: "give", what: "knife" },
        { do: "give", what: "map" },
      ],
    },
  ],
  onComplete: [
    {
      do: "title",
      style: "end",
      title: { ru: "Пролог завершён", en: "Prologue complete" },
      subtitle: { ru: "Вы вступили в сопротивление", en: "You have joined the resistance" },
    },
  ],
};
