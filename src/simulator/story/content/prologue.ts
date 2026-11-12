import type { Cutscene, DroneGroup, Effect, Line, Mission, Text } from "../StoryTypes";

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

const t = (ru: string, en: string): Text => ({ ru, en });
const hero = (ru: string, en: string): Line => ({ who: "hero", via: "voice", text: t(ru, en) });
const radio = (who: string, ru: string, en: string): Line => ({ who, via: "radio", text: t(ru, en) });
const lines = (...list: Line[]): Effect => ({ do: "say", lines: list });
/** A recorded effect of the prologue's scenes (`/audio/story/prologue/sfx/…`). */
const sfx = (clip: string, volume = 1): Effect => ({ do: "sfx", clip: `prologue/sfx/${clip}`, volume });

/**
 * The opening: the yacht flat out over the shallows' colours, the man at
 * her wheel pleased with her, the forecast on the civil channel.
 */
const OPENING: Cutscene = {
  id: "opening",
  shots: [
    {
      // High over her quarter, the sun high and to the side: settling down toward her as she runs.
      seconds: 8,
      from: { eye: { anchor: "yacht", offset: [-48, 26, -70] }, look: { anchor: "yacht", offset: [0, 1.5, 30] }, fov: 42 },
      to: { eye: { anchor: "yacht", offset: [-20, 7, -26] }, look: { anchor: "yacht", offset: [0, 2, 10] }, fov: 38 },
      ease: "inOut",
      cue: [{ do: "title", style: "chapter", title: { ru: "Пролог", en: "Prologue" }, subtitle: { ru: "Штиль перед обрывом", en: "The Calm Before the Drop" } }, sfx("EXFX0009_seabird_tern_pair", 0.7)],
    },
    {
      // Low along her side: the bow wave, the black band flicking past.
      seconds: 7,
      from: { eye: { anchor: "yacht", offset: [5.5, 0.6, 9] }, look: { anchor: "yacht", offset: [0, 0.9, -4] }, fov: 52 },
      to: { eye: { anchor: "yacht", offset: [4.6, 0.5, 1] }, look: { anchor: "yacht", offset: [0, 1.2, -6] }, fov: 48 },
      ease: "linear",
      shake: 0.3,
      cue: [
        sfx("EXFX0005_hand_on_helm_leather", 0.8),
        lines(hero("Ну что, красавица! В последний раз проверим, на что ты способна.", "Well then, beautiful! One last time — let's see what you can do.")),
      ],
    },
    {
      // Over his shoulder at the wheel: the forecast on the civil channel.
      seconds: 12,
      from: { eye: { anchor: "helm", offset: [0.5, 0.25, -0.9] }, look: { anchor: "helm", offset: [0, -0.15, 6] }, fov: 50 },
      to: { eye: { anchor: "helm", offset: [0.36, 0.15, -0.6] }, look: { anchor: "helm", offset: [0, -0.2, 6] }, fov: 44 },
      ease: "inOut",
      cue: [
        sfx("FX010_vessel_radio_static", 0.55),
        lines(
          radio("dispatch", "Внешняя гряда, погода без существенных изменений. Ветер юго-восточный, пять узлов, волна до полуметра.", "Outer Ridge, no significant change in the weather. Wind south-easterly, five knots, waves up to half a metre."),
          hero("Пять узлов… а я сегодня не под парусом.", "Five knots… and I'm not under sail today."),
        ),
      ],
    },
  ],
};

/** The network takes the channel: the dispatcher cut off mid-word, the screens dark, then red. */
const LOCKDOWN: Cutscene = {
  id: "lockdown",
  shots: [
    {
      // Over his shoulder: the dispatcher calling, and gone.
      seconds: 5.5,
      from: { eye: { anchor: "helm", offset: [0.45, 0.2, -0.8] }, look: { anchor: "helm", offset: [0, -0.25, 5] }, fov: 48 },
      to: { eye: { anchor: "helm", offset: [0.38, 0.14, -0.62] }, look: { anchor: "helm", offset: [0, -0.3, 5] }, fov: 44 },
      ease: "inOut",
      cue: [
        lines(
          radio("dispatch", "Внешняя гряда, слышите меня? Повторяю, внешн…", "Outer Ridge, do you read me? I repeat, Outer—"),
          hero("Алло, диспетч…", "Hello? Dispatch—"),
        ),
      ],
    },
    {
      // The screens go dark, then red; the network's voice.
      seconds: 8,
      from: { eye: { anchor: "helm", offset: [0.3, 0.05, -0.4] }, look: { anchor: "helm", offset: [0, -0.4, 1.2] }, fov: 40 },
      to: { eye: { anchor: "helm", offset: [0.2, -0.02, -0.2] }, look: { anchor: "helm", offset: [0, -0.45, 1.2] }, fov: 34 },
      ease: "out",
      cue: [
        {
          do: "instruments",
          on: false,
          alert: [t("ВНИМАНИЕ: СЕКТОР ЗАКРЫТ", "WARNING: SECTOR CLOSED"), t("ПРОТОКОЛ «АКВИЛОН»", "AQUILON PROTOCOL")],
        },
        sfx("FX012_radio_signal_cut", 0.8),
        sfx("EXFX0012_console_blackout_click"),
        sfx("EXFX0011_radar_alarm_triplet", 0.6),
        lines(
          { who: "aquilon", via: "broadcast", text: t("Внимание! Сектор закрыт. Протокол «Аквилон».", "Attention! Sector closed. Aquilon protocol.") },
          hero("Какой ещё протокол?", "What protocol?"),
        ),
      ],
    },
  ],
};

/** The patrol boats out from behind the cay; their channel; the gunner opening up without a word to him. */
const CONTACT: Cutscene = {
  id: "contact",
  shots: [
    {
      // From beside the cay: the first boat bursting out round it, people aboard.
      seconds: 9.5,
      from: { eye: { anchor: "drone:hunters", offset: [14, 3, 30] }, look: { anchor: "drone:hunters", offset: [0, 1.4, 0] }, fov: 40 },
      to: { eye: { anchor: "drone:hunters", offset: [9, 2.4, 13] }, look: { anchor: "drone:hunters", offset: [0, 1.6, 1] }, fov: 46 },
      ease: "linear",
      shake: 0.4,
      cue: [
        sfx("FX015_patrol_speedboat_approach", 0.9),
        lines(
          radio("vn-helm", "Цель визуально подтверждена. Белый корпус, чёрная полоса на корме.", "Target visually confirmed. White hull, black stripe on the stern."),
          radio("vn-lead", "Открываем огонь по приказу. Голосового контакта не требуется.", "Opening fire on orders. No voice contact required."),
        ),
      ],
    },
    {
      // Over the gunner's shoulder at her: he swings the gun round.
      seconds: 7,
      from: { eye: { anchor: "drone:hunters", offset: [0.7, 2.2, 1.4] }, look: { anchor: "yacht", offset: [0, 1.5, 0] }, fov: 11 },
      to: { eye: { anchor: "drone:hunters", offset: [0.6, 2.15, 1.8] }, look: { anchor: "yacht", offset: [0, 1.5, 0] }, fov: 7 },
      ease: "linear",
      shake: 0.5,
      cue: [
        lines(
          hero("Я гражданский, слышите?", "I'm a civilian, do you hear me?"),
          hero("Нет ответа. Они даже не собираются говорить.", "No answer. They're not even going to talk."),
        ),
      ],
    },
    {
      // On her: rounds splintering her side, glass going.
      seconds: 4,
      from: { eye: { anchor: "yacht", offset: [12, 3.5, 9] }, look: { anchor: "yacht", offset: [0, 1.5, 0] }, fov: 48 },
      to: { eye: { anchor: "yacht", offset: [9, 2.6, 6] }, look: { anchor: "yacht", offset: [0, 1.4, 0] }, fov: 54 },
      ease: "out",
      shake: 0.8,
      cue: [
        { do: "blast", strength: 0.4 },
        { do: "damage", hull: 0.12 },
        sfx("FX017_enemy_machinegun_short"),
        sfx("FX020_bullet_fiberglass_hits", 0.9),
        sfx("FX022_windscreen_chip", 0.8),
        lines(hero("Они стреляют!", "They're shooting!")),
      ],
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

export const PROLOGUE_CUTSCENES: readonly Cutscene[] = [OPENING, LOCKDOWN, CONTACT, CRASH];

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
      // The run: her speed, the cargo, the second bulletin about the western passage.
      id: "run",
      goal: t("Доставьте контейнер к внешнему острову", "Deliver the container to the outer island"),
      hint: t("Газ — W / S, руль — A / D или ← / → (на телефоне — рычаг и штурвал внизу)", "Throttle W / S, helm A / D or ← / → (on a phone, the lever and the wheel below)"),
      objective: { kind: "when", when: { flags: ["prologue_bulletin"], stepTime: 36, quiet: true } },
      marker: "delivery",
    },
    {
      id: "lockdown",
      objective: { kind: "watch" },
      onStart: [{ do: "cutscene", scene: "lockdown" }],
    },
    {
      // The instruments gone; something moving behind the cay.
      id: "blind",
      goal: t("Доставьте контейнер к внешнему острову", "Deliver the container to the outer island"),
      objective: { kind: "when", when: { stepTime: 4, quiet: true } },
      marker: "delivery",
      onStart: [
        sfx("FX013_nav_gps_fail", 0.7),
        lines(
          hero("Картплоттер потерял сигнал. Компас работает. Хорошо хоть двигатель не сдох.", "Chart plotter's lost the signal. Compass works. At least the engine hasn't died."),
          hero("Что за чёрт там, за мысом?", "What the hell is that behind the point?"),
        ),
      ],
    },
    {
      id: "contact",
      objective: { kind: "watch" },
      presence: [{ kind: "drones", group: HUNTERS }],
      onStart: [{ do: "cutscene", scene: "contact" }],
    },
    {
      id: "escape",
      goal: t("Уходите к острову, за риф: катерам там тесно", "Run for the island, inside the reef: it's tight for the patrol boats there"),
      hint: t("Газ до упора, петляйте — так в вас труднее попасть", "Full throttle, and weave — it makes you harder to hit"),
      objective: { kind: "hull", hull: 0.12, after: 60, at: "crash" },
      marker: "crash",
      presence: [{ kind: "drones", group: HUNTERS }],
      onStart: [
        { do: "engine", running: true, throttle: 1 },
        sfx("EXFX0017_yacht_engine_throttle_up_alt", 0.8),
        lines(hero("Давай, давай, давай!", "Come on, come on, come on!"), hero("Уйти к рифам… только бы успеть.", "Get to the reefs… if only I make it.")),
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
        sfx("EXFX0024_steering_wheel_hard_turn"),
        lines(hero("Нет!", "No!"), hero("Штурвал не слушается!", "The wheel's not answering!"), hero("Только не камни!", "Not the rocks!")),
      ],
      onComplete: [
        { do: "sound", sound: "crash" },
        sfx("FX028_boat_collides_side", 1.1),
        sfx("FX029_hull_reinforced_cracks"),
        sfx("FX030_propeller_strike_reef", 0.8),
        { do: "blast", strength: 1.4 },
        { do: "damage", hull: 0.3, engine: true },
        { do: "fade", seconds: 6 },
        { do: "sound", sound: "flooding" },
        sfx("FX033_water_entering_cabin", 0.9),
        sfx("EXFX0036_engine_water_choke", 0.8),
        lines(
          hero("Двигатель захлебнулся.", "The engine's flooded."),
          hero("Вода в салоне! Нужно наружу! Сейчас!", "Water in the cabin! Got to get out! Now!"),
          radio("vn-lead", "Цель потеряла ход. Наблюдаем до подтверждения.", "Target dead in the water. Observing until confirmed."),
          hero("Люк заело!", "The hatch is jammed!"),
          hero("Вот так… ещё раз!", "Like that… once more!"),
          radio("vn-helm", "Корпус разрушается. Подойти ближе не могу — мелко.", "Hull's breaking up. Can't get closer — too shallow."),
        ),
      ],
    },
    {
      // In the dark: under the water, the surface, the shore somewhere ahead.
      id: "dark",
      bed: "prologue/sfx/FX039_beach_surf_loop",
      objective: { kind: "when", when: { stepTime: 3, quiet: true } },
      onStart: [
        { do: "cut" },
        sfx("FX036_cabin_hatch_open", 0.8),
        sfx("FX037_submerged_bubbles", 0.9),
        lines(hero("Дыши. Только дыши.", "Breathe. Just breathe.")),
        sfx("FX038_water_surface_break", 0.8),
        lines(
          hero("Воздух!", "Air!"),
          hero("Берег… нужно добраться до берега.", "The shore… got to reach the shore."),
          hero("Только не отключайся.", "Don't black out."),
          hero("Не сейчас.", "Not now."),
        ),
        sfx("FX041_heartbeat_muffled", 0.7),
      ],
    },
  ],
  triggers: [
    // The run.
    { id: "pr-speed", when: { steps: ["run"], stepTime: 3, quiet: true }, do: [lines(hero("Вот это скорость!", "Now that's speed!"))] },
    {
      id: "pr-cargo",
      when: { steps: ["run"], stepTime: 8, quiet: true },
      do: [sfx("FX009_waterproof_case_latch", 0.7), lines(hero("Контейнер на месте, пломба цела. Осталось только доставить.", "Container's in place, seal intact. All that's left is to deliver it."), hero("Деньги хорошие, а вопросы — потом.", "Good money. Questions later."))],
    },
    {
      id: "pr-bulletin",
      when: { steps: ["run"], stepTime: 20, quiet: true },
      do: [
        sfx("EXFX0010_ship_vhf_single_squelch", 0.6),
        lines(
          radio("dispatch", "Внимание маломерным судам у западного прохода. Движение в районе исследовательского объекта временно ограничено.", "Attention small craft near the western passage. Traffic around the research facility is temporarily restricted."),
          hero("Этого у нас не было в маршруте.", "That wasn't on our route."),
          hero("Ладно, идём внешним проходом.", "Fine. We take the outer passage."),
        ),
        { do: "flag", flag: "prologue_bulletin" },
      ],
    },
    // The chase: what is said aboard, and what the patrol says on its channel.
    { id: "pr-hit", when: { steps: ["escape"], event: "struck" }, do: [sfx("FX021_bullet_metal_hits", 0.7), lines(hero("Чёрт! Попали в борт!", "Damn! They hit the side!"))] },
    {
      id: "pr-closing",
      when: { steps: ["escape"], stepTime: 6, quiet: true },
      do: [lines(radio("vn-lead", "Держать сближение, не давать выйти из сектора.", "Keep closing, don't let him leave the sector."), radio("vn-helm", "Вижу попадание по корме. Он всё ещё ускоряется.", "Hit on the stern. He's still accelerating."))],
    },
    { id: "pr-glass", when: { steps: ["escape"], stepTime: 13, event: "struck" }, do: [sfx("EXFX0025_stern_glass_shrapnel", 0.8), lines(hero("Пули прошили стекло!", "Rounds through the glass!"))] },
    {
      id: "pr-rocks",
      when: { steps: ["escape"], stepTime: 18, quiet: true },
      do: [lines(radio("vn-helm", "Он уходит к камням. Если пойдём напрямик — сорвём винт.", "He's heading for the rocks. Go straight in and we'll rip the prop off."), radio("vn-lead", "Обходи, выйди с востока.", "Go round, come out from the east."))],
    },
    { id: "pr-split", when: { steps: ["escape"], stepTime: 25, quiet: true }, do: [lines(hero("Они расходятся! Один идёт наперерез!", "They're splitting up! One's cutting me off!"))] },
    { id: "pr-holed", when: { steps: ["escape"], hull: 0.72, quiet: true }, do: [lines(hero("Ещё одно такое попадание — и мы пойдём ко дну.", "One more hit like that and we're going down."))] },
    {
      id: "pr-reefs",
      when: { steps: ["escape"], near: { at: "crash", radius: 560 }, quiet: true },
      do: [
        sfx("EXFX0026_rocky_channel_surf_close", 0.8),
        lines(
          radio("vn-helm", "Он между двумя рифами. Положение нестабильное.", "He's between two reefs. Position unstable."),
          radio("vn-helm", "Не могу стрелять, мешают скалы.", "Can't shoot, the rocks are in the way."),
          radio("vn-lead", "Не рискуй экипажем, обойди снаружи.", "Don't risk the crew, go round outside."),
        ),
      ],
    },
    { id: "pr-miss", when: { steps: ["escape"], near: { at: "crash", radius: 400 }, quiet: true }, do: [lines(hero("Эта штука сядет на камни, если я промахнусь.", "This thing will hit the rocks if I miss."))] },
    {
      id: "pr-gap",
      when: { steps: ["escape"], near: { at: "crash", radius: 290 }, quiet: true },
      do: [lines(hero("Ещё чуть-чуть.", "Just a little more."), radio("vn-helm", "Второй на позиции. Заходим ему в борт.", "Two in position. Coming in on his beam."), radio("vn-lead", "Подтверждаю. Сорвать управление.", "Confirmed. Take out his steering."))],
    },
  ],
};
