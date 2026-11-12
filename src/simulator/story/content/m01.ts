import type { Cutscene, DroneGroup, Effect, Line, Mission, Text } from "../StoryTypes";
import { stvor9Chart } from "../levels/stvor9";

/**
 * M01_MARK_01, «Ты должен был погибнуть» — "You Should Be Dead"
 * (docs/campaign/missions/m01.md, after the scenario of 11 November 2026).
 *
 * S01 the Slant Shoal: he comes to on the sand at 16:45, the wreck burning
 * on the reef; the container washed up at his feet holds nothing but a
 * tracking beacon. Mark. S02 the trail through the heat: a pistol, a dry
 * pack with a bandage, an empty café with its fan still turning. S03 the
 * ledge over Створ-9: three ways in. S04 the perimeter, quietly or not. S05
 * the archive: the log copied to Mark's drive; Luis in the container, if the
 * player wants him out. S06 the attachment, order AQ-L/1187 — liquidate, no
 * confirmation needed — dated 36 hours before he was hired; the commander
 * arrives in two jeeps. S07 the breakout to the jetty. S08 the skiff, the
 * crewed patrol boat, the pass between two white rocks. S09 Mark's cove,
 * Maya, and "we're not alone here": Kenji, Sara, Viktor. The skiff is his.
 *
 * Every enemy is a person; nobody is spawned anew; the commander lives.
 */

const t = (ru: string, en: string): Text => ({ ru, en });
const mark = (ru: string, en: string): Line => ({ who: "holloway", via: "voice", text: t(ru, en) });
const hero = (ru: string, en: string): Line => ({ who: "hero", via: "voice", text: t(ru, en) });
const think = (ru: string, en: string): Line => ({ who: "hero", via: "thought", text: t(ru, en) });
const say = (who: string, ru: string, en: string, via: Line["via"] = "voice"): Line => ({ who, via, text: t(ru, en) });
const lines = (...list: Line[]): Effect => ({ do: "say", lines: list });

/** The outpost's eleven, there from the start: nobody "appears out of the air". */
const POST = ["p01", "p02", "p03", "p04", "p05", "p06", "i07", "i08", "i09", "d10", "d11"] as const;
/** The commander and the five who come with him. */
const RELIEF = ["e12", "e13", "e14", "e15", "e16", "k17"] as const;

/** The patrol boat at the north tip's pier, crewed: W18 at the wheel, W19 aft. */
const CHASER: DroneGroup = { id: "chaser", at: "stvor9", count: 1, behaviour: "chase", spawn: stvor9Chart(-84.5, -1.2), heading: 45, speed: 13.5, crewed: true };

const S04 = ["infiltrate"];
const S05 = ["journal", "copy", "copying", "attachment"];
const OUTPOST = [...S04, ...S05, "order", "convoy", "deploy", "breakout", "castoff"];

// --- Cut scenes -------------------------------------------------------------------

/** Mark, coming down from the palms with his rifle: the two of them on the sand, the beacon between them. */
const MEET: Cutscene = {
  id: "m01-meet",
  hold: true,
  shots: [
    {
      // Through his eyes, up the beach at the man coming down out of the palms.
      seconds: 4,
      from: { eye: { anchor: "spot:kosaya:meet-hero-head" }, look: { anchor: "actor:mark", offset: [0, 1.5, 0] }, fov: 34 },
      to: { eye: { anchor: "spot:kosaya:meet-hero-head" }, look: { anchor: "actor:mark", offset: [0, 1.55, 0] }, fov: 28 },
      ease: "out",
    },
    {
      // The two of them in profile as Mark stops, the sea behind.
      seconds: 9,
      from: { eye: { anchor: "spot:kosaya:cam-profile" }, look: { anchor: "spot:kosaya:meet-mid" }, fov: 38 },
      to: { eye: { anchor: "spot:kosaya:cam-profile-near" }, look: { anchor: "spot:kosaya:meet-mid" }, fov: 36 },
      ease: "inOut",
    },
    {
      // Over the skipper's shoulder: Mark.
      seconds: 12,
      from: { eye: { anchor: "spot:kosaya:cam-ots-mark" }, look: { anchor: "spot:kosaya:meet-mark-head", offset: [0, -0.1, 0] }, fov: 30 },
      to: { eye: { anchor: "spot:kosaya:cam-ots-mark" }, look: { anchor: "spot:kosaya:meet-mark-head", offset: [0, -0.08, 0] }, fov: 27 },
      ease: "linear",
    },
    {
      // Over Mark's shoulder: the skipper, wet through, the case at his feet.
      seconds: 12,
      from: { eye: { anchor: "spot:kosaya:cam-ots-hero" }, look: { anchor: "spot:kosaya:meet-hero-head", offset: [0, -0.15, 0] }, fov: 30 },
      to: { eye: { anchor: "spot:kosaya:cam-ots-hero" }, look: { anchor: "spot:kosaya:meet-hero-head", offset: [0, -0.12, 0] }, fov: 27 },
      ease: "linear",
    },
    {
      // Back to the profile, slowly closer, as they decide.
      seconds: 60,
      from: { eye: { anchor: "spot:kosaya:cam-profile-near" }, look: { anchor: "spot:kosaya:meet-mid" }, fov: 34 },
      to: { eye: { anchor: "spot:kosaya:cam-profile-near", offset: [0, 0, 0] }, look: { anchor: "spot:kosaya:meet-mid" }, fov: 26 },
      ease: "inOut",
    },
  ],
};

/** Mark's binoculars on the outpost: the three ways in, the archive, the jetty and the skiff. */
const BINOCULARS: Cutscene = {
  id: "m01-binoculars",
  hold: true,
  shots: [
    {
      seconds: 5,
      from: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:route-a" }, fov: 9 },
      to: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:route-a", offset: [2, 0, 0] }, fov: 8 },
      ease: "linear",
    },
    {
      seconds: 5,
      from: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:route-b" }, fov: 9 },
      to: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:route-b", offset: [-2, 0, 0] }, fov: 8 },
      ease: "linear",
    },
    {
      seconds: 5,
      from: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:route-c" }, fov: 9 },
      to: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:route-c", offset: [1, 1, 0] }, fov: 8 },
      ease: "linear",
    },
    {
      // The white block — the archive's windows — then down to the jetty and the open skiff.
      seconds: 4.5,
      from: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:hq-door", offset: [0, 2, 0] }, fov: 10 },
      to: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:skiff" }, fov: 9 },
      ease: "inOut",
    },
    {
      seconds: 30,
      from: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:skiff" }, fov: 9 },
      to: { eye: { anchor: "spot:stvor9:overlook-view" }, look: { anchor: "spot:stvor9:skiff", offset: [0, 0.5, 0] }, fov: 8.5 },
      ease: "linear",
    },
  ],
};

/** The attachment: the screen, his face in its light, Mark comparing the date with the freight tag. */
const ORDER: Cutscene = {
  id: "m01-order",
  hold: true,
  shots: [
    {
      // Close on the screen: the photo, the outline of the yacht, the date.
      seconds: 9,
      from: { eye: { anchor: "spot:stvor9:terminal-eye", offset: [0.15, 0.05, -0.15] }, look: { anchor: "spot:stvor9:terminal-eye", offset: [0, -0.05, 1] }, fov: 34 },
      to: { eye: { anchor: "spot:stvor9:terminal-eye", offset: [0.05, 0, 0.12] }, look: { anchor: "spot:stvor9:terminal-eye", offset: [0, -0.05, 1] }, fov: 26 },
      ease: "linear",
    },
    {
      // Mark at his shoulder, the printout in both hands.
      seconds: 60,
      from: { eye: { anchor: "actor:mark", offset: [1.6, 1.55, 1.6] }, look: { anchor: "actor:mark", offset: [0, 1.45, 0] }, fov: 32 },
      to: { eye: { anchor: "actor:mark", offset: [1.3, 1.5, 1.35] }, look: { anchor: "actor:mark", offset: [0, 1.45, 0] }, fov: 30 },
      ease: "inOut",
    },
  ],
};

/** Out of the window: two jeeps raising dust on the white road; the commander gets out. */
const CONVOY: Cutscene = {
  id: "m01-convoy",
  hold: true,
  shots: [
    {
      seconds: 8,
      from: { eye: { anchor: "spot:stvor9:window" }, look: { anchor: "spot:stvor9:jeep-start1" }, fov: 30 },
      to: { eye: { anchor: "spot:stvor9:window" }, look: { anchor: "spot:stvor9:jeep-enter" }, fov: 26 },
      ease: "inOut",
    },
    {
      seconds: 40,
      from: { eye: { anchor: "spot:stvor9:window" }, look: { anchor: "spot:stvor9:jeep1", offset: [0, 1.6, 0] }, fov: 18 },
      to: { eye: { anchor: "spot:stvor9:window" }, look: { anchor: "actor:k17", offset: [0, 1.6, 0] }, fov: 12 },
      ease: "inOut",
    },
  ],
};

/** The mooring line let go, the starter, water: off. */
const CASTOFF: Cutscene = {
  id: "m01-castoff",
  shots: [
    {
      seconds: 2,
      from: { eye: { anchor: "spot:stvor9:mooring", offset: [0.6, 0.9, -1.4] }, look: { anchor: "spot:stvor9:mooring", offset: [0, 0.2, 0.6] }, fov: 44 },
      ease: "linear",
      cue: [{ do: "sound", sound: "outboard" }],
    },
    {
      seconds: 3,
      from: { eye: { anchor: "yacht", offset: [2.2, 0.7, -3.5] }, look: { anchor: "yacht", offset: [0, 0.6, 1] }, fov: 50 },
      to: { eye: { anchor: "yacht", offset: [2.6, 0.9, -5] }, look: { anchor: "yacht", offset: [0, 0.7, 2] }, fov: 52 },
      ease: "out",
    },
  ],
};

/** The cove: the skiff coming in, the engine dying, Maya with water; Mark's table. */
const HAVEN_ARRIVE: Cutscene = {
  id: "m01-haven",
  hold: true,
  shots: [
    {
      // Low along her side as she glides in.
      seconds: 7,
      from: { eye: { anchor: "spot:cove:berth", offset: [3.5, 0.6, -9] }, look: { anchor: "spot:cove:berth", offset: [0, 0.6, 0] }, fov: 40 },
      to: { eye: { anchor: "spot:cove:berth", offset: [2.6, 0.7, -4] }, look: { anchor: "spot:cove:pier-head", offset: [0, 1, 0] }, fov: 44 },
      ease: "out",
    },
    {
      seconds: 60,
      from: { eye: { anchor: "spot:cove:table", offset: [3.2, 1.6, 2.6] }, look: { anchor: "spot:cove:table", offset: [0, 1, 0] }, fov: 38 },
      to: { eye: { anchor: "spot:cove:table", offset: [2.6, 1.5, 2.2] }, look: { anchor: "spot:cove:table", offset: [0, 1.05, 0] }, fov: 34 },
      ease: "inOut",
    },
  ],
};

const vignette = (id: string, level: string): Cutscene => ({
  id,
  hold: true,
  shots: [
    {
      seconds: 9,
      from: { eye: { anchor: `spot:${level}:cam-a` }, look: { anchor: `spot:${level}:look-a` }, fov: 40 },
      to: { eye: { anchor: `spot:${level}:cam-a`, offset: [0.6, 0, 0.8] }, look: { anchor: `spot:${level}:look-a` }, fov: 36 },
      ease: "linear",
    },
    {
      seconds: 40,
      from: { eye: { anchor: `spot:${level}:cam-b` }, look: { anchor: `spot:${level}:look-b` }, fov: 34 },
      to: { eye: { anchor: `spot:${level}:cam-b`, offset: [0.3, 0, 0.5] }, look: { anchor: `spot:${level}:look-b` }, fov: 30 },
      ease: "linear",
    },
  ],
});

/** Back at the table: the map with three marks of their own, the keys, the lagoon and far off the smoke. */
const HAVEN_END: Cutscene = {
  id: "m01-haven-end",
  hold: true,
  shots: [
    {
      seconds: 8,
      from: { eye: { anchor: "spot:cove:table", offset: [0.2, 2.4, 0.4] }, look: { anchor: "spot:cove:table", offset: [0, 0.85, 0] }, fov: 34 },
      to: { eye: { anchor: "spot:cove:table", offset: [0.1, 2.2, 0.3] }, look: { anchor: "spot:cove:table", offset: [0, 0.85, 0] }, fov: 30 },
      ease: "linear",
    },
    {
      seconds: 60,
      from: { eye: { anchor: "spot:cove:table", offset: [-2.8, 1.65, -2.2] }, look: { anchor: "spot:cove:table", offset: [1.2, 1.3, 1.6] }, fov: 40 },
      to: { eye: { anchor: "spot:cove:table", offset: [-2.4, 1.6, -1.9] }, look: { anchor: "spot:cove:table", offset: [1.2, 1.3, 1.6] }, fov: 36 },
      ease: "inOut",
    },
  ],
};

export const M01_CUTSCENES: readonly Cutscene[] = [
  MEET,
  BINOCULARS,
  ORDER,
  CONVOY,
  CASTOFF,
  HAVEN_ARRIVE,
  vignette("m01-kenji", "kenji"),
  vignette("m01-sara", "sara"),
  vignette("m01-viktor", "viktor"),
  HAVEN_END,
];

// --- The mission ---------------------------------------------------------------------

export const M01: Mission = {
  id: "m01",
  chapter: "chapter-1",
  title: { ru: "Ты должен был погибнуть", en: "You Should Be Dead" },
  brief: {
    ru: "Яхта на рифе, груз — маяк слежения. Человек по имени Марк знает заставу за мысом, куда сходятся отчёты патрулей. Где-то там лежит бумага с твоим именем.",
    en: "The yacht on the reef, the cargo a tracking beacon. A man called Mark knows the outpost past the cape where the patrols' reports end up. Somewhere in it is a paper with your name on it.",
  },
  giver: "holloway",
  sector: "dead-tide",
  requires: ["prologue"],
  status: "playable",
  // The places, and the people who are there from the start (nobody "appears out of the air").
  presence: [
    { kind: "level", level: "kosaya" },
    { kind: "level", level: "stvor9" },
    { kind: "level", level: "white-rocks" },
    { kind: "actors", ids: ["mark", "luis", ...POST] },
  ],
  steps: [
    // --- S01 · The Slant Shoal ---------------------------------------------------------
    {
      id: "wake",
      objective: { kind: "wait", seconds: 3.2 },
      checkpoint: { yacht: "stvor9:skiff", skipper: "ashore", spot: "kosaya:wake" },
      onStart: [
        // The yacht is gone; the boat he will have is the skiff at the outpost's jetty.
        { do: "craft", craft: "skiff", at: "stvor9:skiff" },
        { do: "damage", engine: true },
        { do: "repair", hull: 1 },
        { do: "instruments", on: true },
        { do: "put", at: "kosaya:wake" },
        { do: "time", hour: 16.75, hold: true },
        { do: "weather", kind: "clear" },
        { do: "freeze", on: true },
        { do: "wake" },
        { do: "sound", sound: "surf" },
        { do: "title", style: "chapter", title: t("Ты должен был погибнуть", "You Should Be Dead"), subtitle: t("Мёртвый прилив · Косая отмель · 16:45", "Dead Tide · the Slant Shoal · 16:45") },
      ],
      onComplete: [{ do: "freeze", on: false }, lines(hero("Чёрт… Где яхта?", "Hell… Where's the yacht?"))],
    },
    {
      id: "shore",
      goal: t("Осмотрите место крушения", "Look over the wreck site"),
      hint: t("Что-то мигает синим у кромки воды", "Something's blinking blue at the water's edge"),
      objective: { kind: "when", when: { any: [{ flags: ["used:container"], quiet: true }, { stepTime: 70, quiet: true }] } },
      marker: "kosaya:container",
    },
    {
      id: "mark-in",
      objective: { kind: "listen" },
      onStart: [
        { do: "put", at: "kosaya:meet-hero" },
        { do: "actor", id: "mark", put: "kosaya:mark-beach" },
        { do: "actor", id: "mark", to: "kosaya:meet-mark", pace: "walk" },
        { do: "sound", sound: "click" },
        { do: "freeze", on: true },
        { do: "cutscene", scene: "m01-meet" },
      ],
    },
    {
      id: "meet",
      objective: { kind: "listen" },
      onStart: [
        lines(
          mark("Если собрался им звонить, я бы не советовал.", "If you're thinking of calling them, I wouldn't."),
          hero("Кто ты?", "Who are you?"),
          mark("Тот, кто видел, как тебя пытались утопить. Ты ещё почему-то жив.", "The one who watched them try to drown you. And for some reason you're still alive."),
          hero("Кому-то явно не понравился мой маршрут.", "Somebody didn't like my route."),
          mark("Маршрут? Они шли на тебя как по нитке. И огонь открыли до предупреждения.", "Route? They came at you like you were on a string. And opened fire before any warning."),
          hero("Я доставлял груз.", "I was delivering cargo."),
          mark("Ага. Груз, который следит за курьером. Тебя не ограбили, приятель. Тебя списали.", "Sure. Cargo that keeps an eye on the courier. You weren't robbed, pal. You were written off."),
          hero("Ты знаешь, кто они?", "You know who they are?"),
          mark("Люди «Вангард Навал». У них за мысом застава. Туда сходятся отчёты морских патрулей.", "Vanguard Naval. They've an outpost past the cape. That's where the sea patrols' reports end up."),
          hero("И ты предлагаешь туда пойти?", "And you're suggesting we go there?"),
          mark("Я предлагаю сперва убрать с тебя этот маячок. А потом — найти бумагу, на которой написано твоё имя.", "I'm suggesting we get that beacon off you first. Then find the paper with your name on it."),
          hero("С чего ты взял, что я пойду с тобой?", "What makes you think I'll come with you?"),
          mark("Потому что у тебя нет лодки. У меня есть кое-какой план. А ещё потому, что они пришлют людей проверить берег.", "Because you've no boat. I've got something like a plan. And because they'll send people to check the beach."),
          hero("Ладно. Веди.", "All right. Lead on."),
        ),
        { do: "flag", flag: "m01_beacon_seen" },
      ],
      onComplete: [{ do: "cut" }, { do: "freeze", on: false }],
    },

    // --- S02 · The trail -----------------------------------------------------------------
    {
      id: "follow",
      goal: t("Следуйте за Марком к наблюдательному выступу", "Follow Mark to the lookout ledge"),
      objective: { kind: "reach", at: "stvor9:overlook", by: "foot", radius: 7 },
      marker: "@actor:mark",
      checkpoint: { yacht: "stvor9:skiff", skipper: "ashore", spot: "kosaya:meet-hero" },
      onStart: [
        lines(
          mark("Держи. Не новый, зато стреляет прямо.", "Here. Not new, but it shoots straight."),
          hero("Ты каждому встречному раздаёшь оружие?", "You hand out guns to everybody you meet?"),
          mark("Только тем, кого уже пытались убить на моих глазах.", "Only to people somebody's already tried to kill in front of me."),
        ),
        { do: "give", what: "pistol" },
        { do: "give", what: "knife" },
        { do: "actor", id: "mark", to: "kosaya:mark-trail1", pace: "walk" },
      ],
    },

    // --- S03 · The ledge over Створ-9 -----------------------------------------------------
    {
      id: "overlook",
      objective: { kind: "listen" },
      checkpoint: { yacht: "stvor9:skiff", skipper: "ashore", spot: "stvor9:overlook" },
      onStart: [
        { do: "actor", id: "mark", to: "stvor9:mark-overlook", pace: "creep", pose: { crouch: 1 } },
        lines(
          mark("Вот «Створ-9». Когда-то тут проверяли рыбацкие лицензии. Теперь проверяют, кого можно утопить.", "That's Stvor-9. Used to check fishing licences. Now they check who can be drowned."),
          hero("Сколько людей?", "How many people?"),
          mark("С десяток на самой заставе. Плюс если поднимут тревогу — подъедут ещё. Не устраивай парад.", "A dozen or so on the post itself. If they sound the alarm, more drive over. Don't throw a parade."),
          hero("Где приказы?", "Where are the orders?"),
          mark("Внутри белого блока. Журнал смены, маршруты, решения об открытии огня. То, что нельзя объяснить «случайной ошибкой».", "In the white block. The watch log, the routes, the decisions to open fire. Things you can't call 'an honest mistake'."),
          hero("А лодка?", "And the boat?"),
          mark("На причале. Мотор дрянной, зато свой. Нам понадобится, чтобы отсюда выбраться.", "At the jetty. Lousy motor, but it's ours. We'll need it to get out of here."),
          hero("Ты сказал «нам»?", "You said 'we'?"),
          mark("Не привыкай. Мне нужны документы. Тебе — ответы.", "Don't get used to it. I need papers. You need answers."),
        ),
      ],
    },
    {
      id: "scout",
      goal: t("Осмотрите заставу в бинокль Марка", "Look the outpost over through Mark's binoculars"),
      objective: { kind: "use", id: "binoculars" },
      marker: "stvor9:binoculars",
    },
    {
      id: "choose",
      objective: { kind: "listen" },
      onStart: [
        lines(hero("Хорошо. Я выбираю путь. Ты идёшь за мной?", "Fine. I pick the way. You're coming behind me?"), mark("Я прикрою. Но стрелять вместо тебя весь день не собираюсь.", "I'll cover you. But I'm not doing your shooting for you all day.")),
        { do: "cut" },
        { do: "freeze", on: false },
        { do: "actor", id: "mark", follow: true },
      ],
    },

    // --- S04 · The perimeter -------------------------------------------------------------
    {
      id: "infiltrate",
      goal: t("Проникните на заставу «Створ-9»", "Get inside Stvor-9"),
      hint: t("Ворота, водосток или гребень. Пригнуться — C", "The gate, the drain or the ridge. Crouch — C"),
      objective: { kind: "when", when: { area: "stvor9:hq" } },
      marker: "stvor9:hq-door",
      checkpoint: { yacht: "stvor9:skiff", skipper: "ashore", spot: "stvor9:overlook" },
    },

    // --- S05 · The white block, the archive, Luis ------------------------------------------
    {
      id: "journal",
      goal: t("Найдите журнал морских операций", "Find the sea operations log"),
      hint: t("Архив — на первом этаже, терминал у дальней стены", "The archive is on the ground floor, the terminal by the far wall"),
      objective: { kind: "use", id: "terminal" },
      marker: "stvor9:terminal",
      checkpoint: { yacht: "stvor9:skiff", skipper: "ashore", spot: "stvor9:hq-in" },
    },
    {
      id: "copy",
      goal: t("Скопируйте данные об атаке на яхту", "Copy the record of the attack on the yacht"),
      objective: { kind: "use", id: "terminal-copy" },
      marker: "stvor9:terminal",
      onStart: [
        lines(
          hero("Смотри. Патруль у внешнего мыса, шестнадцать сорок. Моя яхта.", "Look. A patrol off the outer cape, sixteen forty. My yacht."),
          mark("Это уже полезно. Открой вложение. И не трогай печать выхода из системы.", "Now that's useful. Open the attachment. And don't touch the log-out stamp."),
        ),
      ],
    },
    {
      id: "copying",
      objective: { kind: "wait", seconds: 5.5 },
      onStart: [{ do: "switch", name: "stvor9:terminal", value: "copy:0.3" }, lines(hero("Здесь слишком много записей.", "There are too many entries here."), mark("Тащим всё. В убежище разберём.", "Take the lot. We'll sort it out at the haven."))],
      onComplete: [{ do: "switch", name: "stvor9:terminal", value: "copy:3" }, { do: "flag", flag: "m01_evidence_copied" }],
    },

    // --- S06 · The document that can't be explained ---------------------------------------
    {
      id: "attachment",
      goal: t("Откройте вложение к журналу", "Open the attachment to the log"),
      objective: { kind: "use", id: "terminal-order" },
      marker: "stvor9:terminal",
      checkpoint: { yacht: "stvor9:skiff", skipper: "ashore", spot: "stvor9:terminal-stand" },
    },
    {
      id: "order",
      objective: { kind: "listen" },
      onStart: [
        { do: "freeze", on: true },
        { do: "actor", id: "mark", follow: false, to: "stvor9:mark-terminal", pace: "walk" },
        { do: "switch", name: "stvor9:terminal", value: "doc" },
        { do: "cutscene", scene: "m01-order" },
        lines(
          hero("Это моя фотография.", "That's my photograph."),
          mark("И твой бортовой номер. Смотри на дату.", "And your hull number. Look at the date."),
          hero("Это невозможно. Мне предложили рейс только вчера.", "That's impossible. They only offered me the run yesterday."),
          mark("А тебя решили убить позавчера.", "And decided to kill you the day before."),
          hero("Тут написано «ликвидировать». Без проверки. Без предупреждения.", "It says 'liquidate'. No check. No warning."),
          mark("И без подписи человека, которого можно найти. Только код группы.", "And no signature of anybody you could find. Just a group code."),
          hero("Кто-то знал, что я соглашусь.", "Somebody knew I'd say yes."),
          mark("Или сделал так, чтобы ты не смог отказаться.", "Or made sure you couldn't say no."),
        ),
      ],
    },
    {
      id: "convoy",
      objective: { kind: "wait", seconds: 7.5 },
      onStart: [
        { do: "switch", name: "stvor9:jeeps", value: "arrive" },
        { do: "sound", sound: "jeeps" },
        { do: "cutscene", scene: "m01-convoy" },
        lines(mark("Чёрт. Сюда едет начальство. Копию забрал?", "Damn. The brass is coming. Got the copy?"), hero("Да.", "Yes.")),
      ],
    },
    {
      id: "deploy",
      objective: { kind: "listen" },
      presence: [{ kind: "actors", ids: RELIEF }],
      onStart: [
        { do: "actor", id: "k17", put: "stvor9:k17", face: "stvor9:hq-door" },
        { do: "actor", id: "e12", put: "stvor9:e12-arrive", face: "stvor9:k17" },
        { do: "actor", id: "e13", to: "stvor9:e13", pace: "run" },
        { do: "actor", id: "e14", to: "stvor9:e14", pace: "run" },
        { do: "actor", id: "e15", to: "stvor9:e15", pace: "run" },
        { do: "actor", id: "e16", to: "stvor9:e16", pace: "run" },
        { do: "flag", flag: "m01_commander_seen" },
        lines(say("commander", "Доложите обстановку.", "Report.")),
      ],
      onComplete: [
        lines(
          say("commander", "Раненых убрать с прохода. Остальных — по позициям.", "Get the wounded out of the way. Everyone else, to your positions."),
          say("e12", "Есть подозрение, что цель внутри здания.", "We suspect the target is inside the building."),
          say("commander", "Я понял. Гражданских не трогать. Цель мне нужна отдельно.", "Understood. Leave the civilians alone. The target, I want separately."),
          say("e13", "Живым?", "Alive?"),
          say("commander", "Приказ у вас на экране. Выполняйте.", "The order's on your screens. Carry it out."),
          mark("Тогда не будем ждать, пока нас представят.", "Then let's not wait to be introduced."),
        ),
      ],
    },

    // --- S07 · The breakout to the jetty -------------------------------------------------
    {
      id: "breakout",
      goal: t("Покиньте заставу через причал", "Get out of the outpost by the jetty"),
      hint: t("Боковая лестница, за контейнерами — к лодке. R — перезарядка, B — бинт", "The side stairs, behind the containers, to the boat. R reload, B bandage"),
      objective: { kind: "reach", at: "stvor9:mooring", by: "foot", radius: 3.2 },
      marker: "stvor9:mooring",
      presence: [{ kind: "actors", ids: RELIEF }],
      onStart: [
        { do: "cut" },
        { do: "freeze", on: false },
        { do: "actor", id: "mark", follow: true },
        { do: "switch", name: "stvor9:jeeps", value: "parked" },
        { do: "actor", id: "k17", to: "stvor9:k17-gallery", pace: "walk" },
        { do: "alarm", squad: "relief", at: "stvor9:hq-door", combat: true },
        { do: "alarm", squad: "post", at: "stvor9:hq-door", combat: true },
        lines(mark("Боковая лестница! К морю!", "The side stairs! To the sea!")),
      ],
    },
    {
      id: "castoff",
      goal: t("Отдайте швартов и садитесь за руль", "Cast off and take the tiller"),
      objective: { kind: "use", id: "mooring" },
      marker: "stvor9:mooring",
      checkpoint: { yacht: "stvor9:skiff", skipper: "ashore", spot: "stvor9:mooring" },
      presence: [{ kind: "actors", ids: RELIEF }],
      onStart: [
        { do: "actor", id: "mark", follow: false, to: "stvor9:mooring-mark", pace: "run" },
        lines(hero("Мотор исправен?", "Does the motor work?"), mark("Если заведётся — значит исправен. Отвязывай!", "If it starts, it works. Cast off!")),
      ],
    },

    // --- S08 · Away over the sunlit lagoon ------------------------------------------------
    {
      id: "escape",
      goal: t("Уходите к проходу между двумя белыми камнями", "Make for the pass between the two white rocks"),
      hint: t("Газ — W, руль — A / D. Узкий проход — ваше преимущество", "Throttle W, helm A / D. The narrow pass is your advantage"),
      objective: { kind: "reach", at: "m01-pass", by: "yacht", radius: 32 },
      marker: "m01-pass",
      presence: [{ kind: "drones", group: CHASER }, { kind: "actors", ids: RELIEF }],
      onStart: [
        { do: "switch", name: "stvor9:chase-boat", value: "gone" },
        lines(hero("Она вообще выйдет на глиссирование?", "Will she even get up on the plane?"), mark("Не жалуйся на подарок. Газу!", "Don't complain about a gift. Open her up!")),
      ],
    },
    {
      id: "lost",
      objective: { kind: "listen" },
      checkpoint: { yacht: "m01-pass", skipper: "helm" },
      presence: [{ kind: "drones", group: CHASER }],
      onStart: [
        { do: "withdraw", group: "chaser", to: "stvor9:chase-boat" },
        lines(
          say("w19", "Они уходят через узкий проход. Не успеваем развернуться.", "They're going through the narrows. We can't turn in time.", "radio"),
          say("w18", "Отмена сближения. Не угроблю экипаж ради чужой ошибки!", "Breaking off. I'm not wrecking my crew for somebody else's mistake!", "radio"),
          hero("Они нас упустили.", "They've lost us."),
          mark("Сегодня. Не делай из этого привычку.", "Today. Don't make a habit of it."),
        ),
      ],
    },
    {
      id: "cove",
      goal: t("Доберитесь до укрытой бухты", "Reach the sheltered cove"),
      objective: { kind: "reach", at: "mark-cove", by: "yacht", radius: 40 },
      marker: "mark-cove",
      presence: [{ kind: "level", level: "cove" }, { kind: "actors", ids: ["maya"] }],
    },

    // --- S09 · "We're not alone here" ------------------------------------------------------
    {
      id: "haven",
      objective: { kind: "listen" },
      presence: [
        { kind: "level", level: "cove" },
        { kind: "level", level: "kenji" },
        { kind: "level", level: "sara" },
        { kind: "level", level: "viktor" },
        { kind: "actors", ids: ["maya", "mark-cove", "luis-cove", "kenji", "sara", "viktor"] },
      ],
      onStart: [
        { do: "freeze", on: true },
        { do: "engine", running: false, throttle: 0 },
        { do: "craft", craft: "skiff", at: "cove:berth" },
        { do: "put", at: "cove:hero" },
        { do: "flag", flag: "aboard:mark", off: true },
        { do: "flag", flag: "aboard:luis", off: true },
        { do: "cutscene", scene: "m01-haven" },
        { do: "actor", id: "maya", to: "cove:maya-pier", pace: "walk" },
        lines(say("maya", "Ты привёл гостей?", "You've brought guests?"), mark("Одного — точно. Ещё одного, если удача сегодня не закончилась.", "One, for sure. Another, if today's luck hasn't run out.")),
      ],
    },
    {
      id: "haven-proof",
      objective: { kind: "listen" },
      onStart: [
        lines(
          mark("У нас есть доказательство, что его хотели убить заранее.", "We've got proof they meant to kill him before he ever set out."),
          hero("Доказательство есть. Имени заказчика нет.", "We have proof. We don't have the client's name."),
          mark("Зато есть люди, которые могут знать больше. Мы здесь не одни.", "But there are people who might know more. We're not alone here."),
        ),
      ],
    },
    {
      id: "haven-kenji",
      objective: { kind: "listen" },
      onStart: [
        { do: "cutscene", scene: "m01-kenji" },
        lines(
          mark("Кендзи Сато. Инженер. Когда понял, что здесь травят лагуны, полез с вопросами к неправильным людям.", "Kenji Sato. An engineer. When he worked out the lagoons here were being poisoned, he took his questions to the wrong people."),
          mark("Корпорация отняла у него работу, а потом попыталась заткнуть рот. Он ищет доказательства. И знает здешние воды лучше любого из их патрулей.", "The company took his job, then tried to shut him up. He's looking for proof. And he knows these waters better than any of their patrols."),
          say("kenji", "Опять. Даже после остановки станции.", "Again. Even after they shut the station down."),
        ),
      ],
    },
    {
      id: "haven-sara",
      objective: { kind: "listen" },
      onStart: [
        { do: "cutscene", scene: "m01-sara" },
        lines(
          mark("Сара Дженкинс. Аналитик их разведки. Ушла с ключами и файлами, за которые убивают.", "Sara Jenkins. One of their intelligence analysts. Walked out with keys and files people get killed for."),
          mark("Если кто и может разобрать код на этом приказе — она. Но Сара редко рассказывает всю историю с первого раза.", "If anybody can read the code on that order, she can. But Sara rarely tells the whole story the first time."),
          say("sara", "Тогда кто подписал вторую копию?", "Then who signed the second copy?"),
        ),
      ],
    },
    {
      id: "haven-viktor",
      objective: { kind: "listen" },
      onStart: [
        { do: "cutscene", scene: "m01-viktor" },
        lines(
          mark("Виктор Седов. Один из создателей «Аквилона». Уверяет, что хочет всё остановить.", "Viktor Sedov. One of the men who built Aquilon. Says he wants to stop it all."),
          mark("Он умеет вскрывать свою систему лучше кого-либо. Только не рассчитывай, что создатель кошмара будет честен о том, с чего всё началось.", "He can crack his own system better than anyone. Just don't count on the man who built the nightmare being honest about how it started."),
          say("sedov", "Нет… этого в окончательном протоколе не было.", "No… that wasn't in the final protocol."),
        ),
      ],
    },
    {
      id: "haven-end",
      objective: { kind: "listen" },
      onStart: [
        { do: "cutscene", scene: "m01-haven-end" },
        lines(
          hero("И ты им доверяешь?", "And you trust them?"),
          mark("Я доверяю тому, что они хотят выжить. С остальным разберёшься сам.", "I trust that they want to stay alive. The rest you'll work out yourself."),
          hero("А ты?", "And you?"),
          mark("Я остаюсь здесь. Мои люди без снабжения долго не протянут. Захочешь помочь — заходи.", "I'm staying here. My people won't last long without supplies. If you want to help, drop by."),
          mark("Лодка на причале. Не красавица, но довезёт. Отметил всех на карте.", "The boat's at the jetty. No beauty, but she'll get you there. I've marked them all on your chart."),
          hero("С чего начать?", "Where do I start?"),
          mark("С того, что для тебя важнее. Впервые за этот день выбор за тобой.", "With whatever matters most to you. For the first time today, it's your call."),
          say("maya", "Сначала выпей воды. Герои на такой жаре быстро падают в обморок.", "Drink some water first. Heroes faint fast in this heat."),
          hero("Спасибо.", "Thanks."),
        ),
        { do: "give", what: "map" },
        { do: "flag", flag: "m01_escape_boat_owned" },
      ],
    },
    {
      id: "free",
      objective: { kind: "listen" },
      onStart: [
        { do: "cut" },
        { do: "freeze", on: false },
        { do: "repair", engine: true },
        { do: "time", hour: 17.25 },
        { do: "flag", flag: "m01_completed" },
        { do: "flag", flag: "arc_mark_available" },
        { do: "flag", flag: "arc_kenji_available" },
        { do: "flag", flag: "arc_sarah_available" },
        { do: "flag", flag: "arc_viktor_available" },
      ],
    },
  ],
  onComplete: [
    { do: "title", style: "end", title: t("Миссия выполнена", "Mission complete"), subtitle: t("Ты должен был погибнуть", "You Should Be Dead") },
    { do: "title", style: "place", title: t("Открыты сюжетные линии", "Story lines open"), subtitle: t("Марк · Кендзи · Сара · Виктор", "Mark · Kenji · Sara · Viktor") },
  ],
  uses: [
    // S01: the wreck's leavings on the sand.
    {
      id: "container",
      label: t("Осмотреть контейнер", "Look in the container"),
      when: { steps: ["shore"] },
      do: [lines(hero("Пусто?.. Что я вообще вёз?", "Empty?.. What was I even carrying?"), hero("Передатчик. Серьёзно?", "A transmitter. Seriously?")), { do: "flag", flag: "m01_beacon_seen" }],
    },
    {
      id: "hull-piece",
      label: t("Осмотреть обломок борта", "Look at the piece of hull"),
      do: [lines(hero("Ещё утром я думал, что хуже сломанного двигателя ничего не бывает.", "This morning I thought nothing was worse than a broken engine."))],
    },
    {
      id: "tag",
      label: t("Поднять фрахтовый ярлык", "Pick up the freight tag"),
      do: [lines(think("Фрахтовый ярлык. «Груз 36-Б, получатель — по месту». Ни имени, ни адреса.", "A freight tag. 'Consignment 36-B, consignee on site'. No name, no address.")), { do: "flag", flag: "has-tag" }],
    },
    {
      id: "knife",
      label: t("Поднять нож и ремень с фонарём", "Pick up the knife and the belt with the torch"),
      do: [{ do: "give", what: "knife" }, lines(think("Мой нож. И ремень — фонарь даже работает.", "My knife. And the belt — the torch even works."))],
    },
    // S02: the pack on the snag.
    {
      id: "backpack",
      label: t("Обыскать рюкзак", "Search the pack"),
      do: [{ do: "give", what: "bandage" }, { do: "flag", flag: "has-bandage" }, lines(think("Сухой рюкзак. Бинт, почти новый. Пригодится.", "A dry pack. A bandage, nearly new. That'll come in handy."))],
    },
    // S03: Mark's binoculars.
    {
      id: "binoculars",
      label: t("Взять бинокль Марка", "Take Mark's binoculars"),
      when: { steps: ["scout"] },
      do: [
        { do: "freeze", on: true },
        { do: "cutscene", scene: "m01-binoculars" },
        lines(
          mark("Ворота — быстрее, но там пара любителей поговорить с незнакомцами.", "The gate's quicker, but there's a couple there who like a chat with strangers."),
          mark("Водосток выходит к генератору. Ботинки промочишь, зато меньше глаз.", "The drain comes out by the generator. Wet boots, but fewer eyes."),
          mark("По гребню можно зайти сверху. Осторожнее с крошкой под ногами.", "Along the ridge you come in from above. Mind the loose stuff underfoot."),
          think("Архив — в белом блоке. Лодка — у причала, открытая.", "The archive's in the white block. The boat's at the jetty, uncovered."),
        ),
      ],
    },
    // S05: the terminal, in three goes.
    { id: "terminal", label: t("Просмотреть журнал", "Look through the log"), when: { steps: ["journal"] } },
    { id: "terminal-copy", label: t("Подключить накопитель Марка", "Plug in Mark's drive"), when: { steps: ["copy"] } },
    { id: "terminal-order", label: t("Открыть вложение", "Open the attachment"), when: { steps: ["attachment"] } },
    {
      id: "hydro-doc",
      label: t("Открыть протокол на полке", "Open the protocol on the shelf"),
      when: { steps: S05 },
      do: [
        lines(
          think("«Подложка побережья, выпуск 04». Схема отметок дна… «Составлено по материалам военного гидрографического департамента».", "'Coastal substrate, issue 04'. A chart of bottom soundings… 'Compiled from the material of the military hydrographic department'."),
          hero("Я знаю эти условные знаки.", "I know these symbols."),
          mark("Что-то знакомое?", "Something familiar?"),
          hero("Работал с похожими схемами.", "I've worked with charts like these."),
        ),
        { do: "flag", flag: "m01_hydro_hint_seen" },
      ],
    },
    // Luis's cell.
    {
      id: "cell-door",
      label: t("Открыть дверь контейнера", "Open the container's door"),
      seconds: 1.2,
      when: { steps: [...S05, "order", "breakout", "castoff"], flags: ["luis-talked"] },
      do: [
        { do: "switch", name: "stvor9:cell-door", value: "open" },
        { do: "flag", flag: "m01_luis_rescued" },
        lines(
          hero("Ноги держат? Иди за нами, без геройства.", "Can you stand? Come with us, and no heroics."),
          say("luis", "Ты меня отсюда выводишь? Спасибо. Я знаю, где укрыться.", "You're getting me out of here? Thank you. I know where to hide."),
          mark("Прислушайся к нему. Из порта видно больше, чем из штабной башни.", "Listen to him. You see more from the harbour than from the HQ tower."),
        ),
        { do: "actor", id: "luis", release: true, pose: { sit: 0 } },
        { do: "actor", id: "luis", to: "stvor9:luis-out", pace: "walk" },
      ],
    },
    // The mooring line.
    {
      id: "mooring",
      label: t("Отдать швартов", "Let go the line"),
      seconds: 1.2,
      when: { steps: ["castoff"] },
      do: [
        lines(mark("Есть! За руль, капитан!", "Got it! Take the helm, skipper!")),
        { do: "actor", id: "mark", remove: true },
        { do: "flag", flag: "aboard:mark" },
        { do: "repair", engine: true },
        { do: "board" },
        { do: "engine", running: true, throttle: 0 },
        { do: "cutscene", scene: "m01-castoff" },
      ],
    },
  ],
  optionals: [
    { id: "container", goal: t("Осмотреть контейнер", "Look in the container"), show: { steps: ["shore"] }, done: { flags: ["used:container"] } },
    { id: "bandage", goal: t("Использовать бинт (B)", "Use the bandage (B)"), show: { flags: ["has-bandage"], health: 0.75 }, done: { flags: ["bandage-used"] } },
    { id: "luis", goal: t("Освободить Луиса", "Free Luis"), show: { flags: ["luis-talked"] }, done: { flags: ["m01_luis_rescued"] } },
    { id: "hydro", goal: t("Осмотреть гидрографическую схему", "Look at the hydrographic chart"), show: { steps: ["copy", "copying", "attachment"] }, done: { flags: ["m01_hydro_hint_seen"] } },
    { id: "luis-boat", goal: t("Помогите Луису добраться до лодки", "Get Luis to the boat"), show: { flags: ["m01_luis_rescued"], steps: ["breakout", "castoff"] }, done: { flags: ["aboard:luis"] } },
  ],
  triggers: [
    // --- S01 --------------------------------------------------------------------------
    { id: "smoke", when: { steps: ["shore"], stepTime: 2.5, quiet: true }, do: [lines(hero("Нет. Только не это.", "No. Not that."))] },
    {
      id: "beacon-a",
      when: { steps: ["mark-in"], not: ["used:container"] },
      do: [lines(mark("Красивый ящик. Пустой. Зато внутри маяк — чтобы не потерять тебя в море.", "Nice box. Empty. But there's a beacon in it — so they wouldn't lose you at sea.")), { do: "flag", flag: "m01_beacon_seen" }],
    },

    // --- S02: Mark leads, and waits for him ---------------------------------------------
    {
      id: "leg2",
      when: { steps: ["follow"], actorAt: { id: "mark", at: "kosaya:mark-trail1", radius: 2.5 }, nearActor: { id: "mark", radius: 12 } },
      do: [
        { do: "actor", id: "mark", to: "kosaya:mark-cafe", pace: "walk" },
        lines(
          mark("Впереди наблюдательный выступ. Оттуда увидишь заставу. Я работал на их связи; знаю, куда стекаются журналы.", "There's a lookout up ahead. You'll see the outpost from there. I did their signals; I know where the logs end up."),
          hero("Работал? А теперь?", "Did? And now?"),
          mark("А теперь иногда удаётся поспать ночью.", "Now I get to sleep at night, sometimes."),
          hero("Яхту потопили люди с эмблемой твоих старых друзей?", "The yacht was sunk by people wearing your old friends' badge?"),
          mark("Не путай эмблему и друзей. У меня тех и других больше нет.", "Don't mix up badges and friends. I've got neither any more."),
        ),
      ],
    },
    {
      id: "cafe",
      when: { steps: ["follow"], actorAt: { id: "mark", at: "kosaya:mark-cafe", radius: 2.5 }, nearActor: { id: "mark", radius: 12 }, quiet: true },
      do: [
        lines(
          hero("Здесь раньше жили люди.", "People used to live here."),
          mark("Живут. Кто-то скрывается в лесу. Кто-то служит тем, кто держит ворота. Не суди по форме с первого взгляда.", "They still do. Some are hiding in the woods. Some work for whoever holds the gate. Don't judge by the uniform at first sight."),
        ),
        { do: "actor", id: "mark", to: "kosaya:mark-trail2", pace: "walk" },
      ],
    },
    {
      id: "leg4",
      when: { steps: ["follow"], actorAt: { id: "mark", at: "kosaya:mark-trail2", radius: 2.5 }, nearActor: { id: "mark", radius: 12 } },
      do: [{ do: "actor", id: "mark", to: "kosaya:mark-stone", pace: "walk", pose: { crouch: 1 } }],
    },
    {
      id: "stone",
      when: { steps: ["follow"], actorAt: { id: "mark", at: "kosaya:mark-stone", radius: 2.5 }, nearActor: { id: "mark", radius: 10 } },
      do: [lines(mark("Присядь у камня. Дальше нас видно из окна связи.", "Get down by the rock. From here on they can see us from the signals window."))],
    },
    {
      id: "stone-crouched",
      when: { steps: ["follow"], flags: ["t:stone"], crouched: true, nearActor: { id: "mark", radius: 8 }, quiet: true },
      do: [
        lines(hero("А почему не обойти этот остров?", "Why not just go round this island?"), mark("Твой убийца найдёт тебя снова. Поищем сперва его подпись.", "Whoever wants you dead will find you again. Let's look for his signature first.")),
        { do: "actor", id: "mark", to: "stvor9:mark-overlook", pace: "creep", pose: { crouch: 1 } },
      ],
    },
    { id: "hurt", when: { steps: ["follow", "overlook", "scout", ...OUTPOST], health: 0.55, flags: ["has-bandage"], not: ["bandage-used"], quiet: true }, do: [lines(mark("У тебя кровь на рукаве. Бинт в сумке — используй, пока можешь держать руки ровно.", "There's blood on your sleeve. The bandage in the pack — use it while your hands are still steady."))] },
    { id: "ahead", when: { steps: ["follow"], farActor: { id: "mark", radius: 26 }, stepTime: 12, quiet: true }, do: [lines(mark("Тише, капитан. Тут ветер шуршит, но ботинки слышно.", "Easy, skipper. The wind rustles here, but boots carry."))] },
    { id: "waiting", when: { steps: ["follow"], still: 30, quiet: true }, do: [lines(mark("Передумал — скажи. Но море обратно яхту не отдаст.", "Changed your mind, say so. But the sea won't give the yacht back."))] },
    { id: "scratch", when: { steps: ["follow"], health: 0.95, quiet: true }, do: [lines(mark("Это царапина. Но морская вода добра не добавит.", "It's a scratch. But sea water won't do it any good."))] },
    { id: "far-wreck", when: { steps: ["follow", "overlook", "choose"], stepTime: 40, quiet: true, near: { at: "stvor9:overlook", radius: 14 } }, do: [lines(think("Сколько она стоила… и сколько стоил этот рейс.", "What she cost… and what this run cost."))] },

    // --- S04: what is heard at the posts, and Mark --------------------------------------
    { id: "route-gate", when: { steps: S04, area: "stvor9:gate" }, do: [{ do: "flag", flag: "m01_route_gate" }] },
    { id: "route-drain", when: { steps: S04, area: "stvor9:drain-in" }, do: [{ do: "flag", flag: "m01_route_drain" }] },
    { id: "route-ridge", when: { steps: S04, area: "stvor9:ridge-path" }, do: [{ do: "flag", flag: "m01_route_ridge" }] },
    {
      id: "checkpoint-talk",
      when: { steps: S04, near: { at: "stvor9:p01", radius: 24 }, not: ["down:p01", "down:p02", "alert:suspicious"], quiet: true },
      do: [
        lines(
          say("p02", "Ещё два часа до смены. Я здесь сварюсь.", "Two more hours till the change. I'll boil out here."),
          say("p01", "В конторе лёд закончился с утра. Нам сказали экономить генератор.", "The office ran out of ice this morning. They told us to go easy on the generator."),
          say("p02", "А этим в штабе, значит, можно сидеть под кондиционером?", "And the ones in HQ get to sit under the air conditioning?"),
          say("p01", "Им можно всё. Не стой на солнце, а то начальство опять решит, что мы отдыхаем.", "They get everything. Get out of the sun, or the brass will decide we're slacking again."),
        ),
      ],
    },
    {
      id: "challenge",
      when: { steps: S04, nearActor: { id: "p01", radius: 9 }, not: ["down:p01", "alert:combat"] },
      do: [
        lines(
          say("p01", "Стой. Не двигайся. Кто ты такой?", "Stop. Don't move. Who are you?"),
          hero("Я ищу береговую службу. На мою лодку напали.", "I'm looking for the coast service. My boat was attacked."),
          say("p01", "Положи руки так, чтобы я их видел. И без резких движений.", "Keep your hands where I can see them. And no sudden moves."),
        ),
      ],
    },
    {
      id: "challenge-again",
      when: { steps: S04, flags: ["t:challenge"], stepTime: 8, nearActor: { id: "p02", radius: 8 }, not: ["down:p02", "alert:combat"] },
      do: [lines(say("p02", "Вызываю старшего. У нас гражданский.", "Calling the sergeant. We've got a civilian.")), { do: "alarm", squad: "post", at: "stvor9:p01", combat: false }],
    },
    {
      id: "generator-talk",
      when: { steps: S04, near: { at: "stvor9:p03", radius: 16 }, not: ["down:p03", "down:p04", "alert:suspicious"], quiet: true },
      do: [
        lines(
          say("p03", "Если он заглохнет, мне снова вручную запускать эту рухлядь.", "If it stalls, I'll be hand-cranking this junk again."),
          say("p04", "Зато шум перекрывает всё остальное. Хоть пой целый день.", "At least the racket drowns out everything else. You could sing all day."),
          say("p03", "Ты сначала научись не разливать топливо.", "Learn not to spill the fuel first."),
        ),
      ],
    },
    {
      id: "ridge-talk",
      when: { steps: S04, area: "stvor9:ridge-path", not: ["down:p05", "down:p06", "alert:suspicious"], quiet: true },
      do: [lines(say("p05", "Внизу лодку опять не накрыли. Пластик на солнце растрескается.", "Nobody's covered the boat down there again. The plastic will crack in this sun."), say("p06", "Не твоя лодка. Пусть сами переживают.", "Not your boat. Let them worry."))],
    },
    { id: "radio", when: { steps: OUTPOST, alert: "combat", not: ["down:i07"] }, do: [lines(say("i07", "Посты, доклад. Кто открыл огонь?", "Posts, report. Who opened fire?", "radio"))] },
    { id: "loud", when: { steps: S04, alert: "combat" }, do: [lines(mark("План тихого входа отменяется. Двигайся к штабу, я перекрою им угол.", "So much for going in quiet. Make for HQ, I'll cover the corner."))] },
    { id: "first-shot", when: { steps: S04, event: "shot" }, do: [lines(hero("Вот тебе и доставка груза.", "So much for a delivery run."), mark("Ладно. Теперь аккуратнее: в блоке связи слышат каждый выстрел.", "Fine. Careful now: the signals block hears every shot."))] },
    { id: "spared", when: { steps: OUTPOST, flags: ["took-down"], quiet: true }, do: [lines(mark("Можешь не оставлять за собой трупы — оставляй. Нам здесь ещё жить.", "If you can leave them breathing, do. We've still got to live here."))] },
    { id: "cover", when: { steps: S04, crouched: true, alert: "suspicious", quiet: true }, do: [lines(mark("Не геройствуй на открытом месте. Камень крепче твоей рубашки.", "No heroics in the open. Stone's tougher than your shirt."))] },
    { id: "slow", when: { steps: S04, stepTime: 150, quiet: true }, do: [lines(mark("Дверь в штаб у них одна большая, а подходов три. Пользуйся.", "One big door into HQ, three ways to it. Use them."))] },
    { id: "quiet-in", when: { steps: ["journal"], not: ["alert:suspicious"], stepTime: 1, quiet: true }, do: [lines(mark("Вижу дверь. Сначала архив. Катер потом.", "There's the door. Archive first. The boat after."), mark("Хорошо. Чем меньше стрельбы, тем меньше людей сюда прибежит.", "Good. The less shooting, the fewer people come running."))] },
    { id: "surrendered", when: { steps: OUTPOST, event: "surrender" }, do: [lines(mark("Он без оружия. Идём дальше.", "He's unarmed. Keep moving."))] },
    { id: "ammo", when: { steps: OUTPOST, event: "pickup", quiet: true }, do: [lines(mark("Держи в голове, сколько патронов осталось. Здесь их никто бесплатно не раздаёт.", "Keep count of your rounds. Nobody hands them out free round here."))] },

    // --- S05: inside --------------------------------------------------------------------
    {
      id: "inside",
      when: { steps: ["journal"], area: "stvor9:archive" },
      do: [
        lines(
          mark("Здесь всё ещё пользуются моими маршрутными таблицами. Лентяи.", "They're still using my routing tables. Lazy."),
          hero("Ты их настраивал?", "You set them up?"),
          mark("Связь. Не приказы об убийстве. Разницу я тогда считал важной.", "The signals. Not the kill orders. Back then I thought the difference mattered."),
          hero("А теперь?", "And now?"),
          mark("Теперь не уверен, что её кто-то ещё видит.", "Now I'm not sure anybody else can see it."),
        ),
      ],
    },
    {
      id: "archive-talk",
      when: { steps: [...S04, "journal"], near: { at: "stvor9:i09", radius: 10 }, not: ["down:i08", "down:i09", "alert:suspicious"], quiet: true },
      do: [
        lines(
          say("i08", "Ещё одна папка с грифом. Здесь уже полки кончаются.", "Another classified folder. We're running out of shelves."),
          say("i09", "Приказ пришёл сверху — хранить бумажные копии. Значит, кто-то перестал доверять серверам.", "Orders from on high — keep paper copies. Means somebody's stopped trusting the servers."),
          say("i08", "Зря. Бумага хотя бы не зависнет в самый нужный момент.", "Shame. At least paper doesn't freeze when you need it."),
        ),
      ],
    },
    { id: "long-terminal", when: { steps: ["copy", "attachment"], stepTime: 45, quiet: true }, do: [lines(mark("Скопируй журнал. Разбирать будем там, где есть двери и замки.", "Copy the log. We'll read it where there are doors and locks."))] },
    { id: "fan", when: { steps: ["copy", "attachment"], stepTime: 20, quiet: true }, do: [lines(hero("Тут хоть на минуту бывает не жарко?", "Is it ever not hot here, even for a minute?"), mark("Ночью всего лишь мокро и душно.", "At night it's just wet and stuffy."))] },
    { id: "copy-mid", when: { steps: ["copying"], stepTime: 1.8 }, do: [{ do: "switch", name: "stvor9:terminal", value: "copy:1.4" }] },
    { id: "copy-late", when: { steps: ["copying"], stepTime: 3.6 }, do: [{ do: "switch", name: "stvor9:terminal", value: "copy:2.4" }] },

    // --- Luis ---------------------------------------------------------------------------
    {
      id: "luis-hello",
      when: { steps: [...S04, ...S05, "breakout", "castoff"], near: { at: "stvor9:cell-front", radius: 4.5 }, quiet: true },
      do: [
        lines(
          say("luis", "Эй… Вы не из смены? Есть вода?", "Hey… You're not from the shift? Got any water?"),
          hero("Почему тебя держат здесь?", "Why are they holding you here?"),
          say("luis", "Попросили переписать журнал судов. Чтобы будто никто не проходил через пролив в прошлый вторник.", "They wanted me to rewrite the vessel log. So it looks like nobody came through the strait last Tuesday."),
          hero("И ты отказался?", "And you said no?"),
          say("luis", "Моя жена умеет считать лодки. Я ей как-то должен смотреть в глаза.", "My wife can count boats. I've got to look her in the eye somehow."),
          mark("Дверь можно открыть, но у причала будет тесно. Решай.", "The door opens, but it'll be crowded at the jetty. Your call."),
        ),
        { do: "flag", flag: "luis-talked" },
      ],
    },
    {
      id: "luis-left",
      when: { steps: [...S05, "order", "breakout"], flags: ["luis-talked"], not: ["m01_luis_rescued"], far: { at: "stvor9:cell-front", radius: 22 } },
      do: [lines(say("luis", "Понимаю. Если доберёшься до людей, скажи, что я ещё здесь.", "I understand. If you get to people, tell them I'm still here."))],
    },
    { id: "luis-wait", when: { steps: [...S05, "breakout"], flags: ["luis-talked"], not: ["m01_luis_rescued"], near: { at: "stvor9:cell-front", radius: 3 }, still: 9, quiet: true }, do: [lines(say("luis", "Я никуда не убегу. Только реши, что со мной будет.", "I'm not going anywhere. Just decide what happens to me."))] },
    { id: "luis-follow", when: { flags: ["m01_luis_rescued"], actorAt: { id: "luis", at: "stvor9:luis-out", radius: 2 } }, do: [{ do: "actor", id: "luis", follow: true }] },
    { id: "luis-stumble", when: { steps: ["breakout", "castoff"], flags: ["m01_luis_rescued"], farActor: { id: "luis", radius: 14 }, quiet: true }, do: [lines(mark("Не спеши, старик. До лодки дойдём вместе.", "Easy, old man. We'll make the boat together."))] },
    {
      id: "luis-dock",
      when: { steps: ["breakout", "castoff"], flags: ["m01_luis_rescued"], area: "stvor9:dock" },
      do: [
        lines(say("luis", "Я могу идти. Просто покажите куда!", "I can walk. Just show me where!"), mark("К борту, Луис. Низко голову. Держись за леер.", "To the side, Luis. Head down. Hold on to the rail.")),
        { do: "actor", id: "luis", follow: false, to: "stvor9:mooring-luis", pace: "run" },
      ],
    },
    { id: "luis-aboard", when: { steps: ["escape", "lost"], flags: ["m01_luis_rescued"] }, do: [{ do: "actor", id: "luis", remove: true }, { do: "flag", flag: "aboard:luis" }] },
    { id: "luis-race", when: { steps: ["lost"], flags: ["aboard:luis"], stepTime: 9, quiet: true }, do: [lines(say("luis", "Я бы ещё раз согласился на тюрьму, только не на такие гонки.", "I'd take the cell again before another race like that."))] },

    // --- S06/S07: the reinforcements -----------------------------------------------------
    { id: "quiet-relief", when: { steps: ["deploy"], not: ["alert:combat"] }, do: [lines(say("e12", "Всё штатно, сэр. Документы принесли в ваш кабинет.", "All in order, sir. The papers are in your office."))] },
    { id: "loud-relief", when: { steps: ["deploy"], flags: ["alert:combat"] }, do: [lines(say("e12", "Незаконное проникновение. Несколько постов не отвечают.", "Intrusion. Several posts aren't answering."))] },
    { id: "breakout-yard", when: { steps: ["breakout"], area: "stvor9:yard", quiet: true }, do: [lines(hero("Они перекрывают причал!", "They're blocking the jetty!"), mark("Там контейнеры. Иди за ними — линия огня короткая!", "Containers there. Go behind them — short line of fire!"))] },
    { id: "known", when: { steps: ["breakout"], stepTime: 14, alert: "combat", quiet: true }, do: [lines(mark("Вот теперь они и меня узнали. Отлично.", "And now they've recognised me too. Great."))] },
    { id: "wounded", when: { steps: ["breakout", "castoff"], health: 0.45, quiet: true }, do: [lines(mark("Вниз! За стену! Сейчас прикрою.", "Get down! Behind the wall! I'll cover you."))] },
    { id: "last-stretch", when: { steps: ["breakout"], health: 0.3, stepTime: 30, quiet: true }, do: [lines(mark("Вставай. Ещё один поворот — и увидишь воду.", "Get up. One more turn and you'll see the water."))] },
    { id: "let-go", when: { steps: ["breakout", "castoff"], event: "surrender", quiet: true }, do: [lines(mark("Пусть идёт. Нам нужна лодка, не счёт на табло.", "Let him go. We need the boat, not a scoreboard."))] },
    { id: "k008", when: { steps: ["breakout"], stepTime: 16 }, do: [lines(say("commander", "Не стреляйте в сторону посёлка. Они идут к воде.", "Don't fire toward the village. They're heading for the water.", "radio"))] },
    { id: "k009", when: { steps: ["breakout", "castoff"], stepTime: 4, any: [{ area: "stvor9:yard" }, { area: "stvor9:dock" }], actorAt: { id: "k17", at: "stvor9:k17-gallery", radius: 3 }, quiet: true }, do: [lines(say("commander", "Значит, всё-таки выжил.", "So you did survive after all."))] },
    { id: "k010", when: { steps: ["castoff", "escape"], quiet: true }, do: [lines(say("commander", "Катер на воду. Я хочу знать, куда он пойдёт.", "Get the boat in the water. I want to know where he goes.", "radio"))] },

    // --- S08 ------------------------------------------------------------------------------
    { id: "chase", when: { steps: ["escape"], stepTime: 9, quiet: true }, do: [lines(mark("Сзади катер! Держи курс на два белых камня!", "Boat astern! Steer for the two white rocks!"), hero("Мы пройдём?", "Will we get through?"), mark("Эта посудина — да. За их мотор не ручаюсь.", "This tub will. Can't speak for their motor."))] },
    { id: "rock", when: { steps: ["escape", "lost", "cove"], event: "rock", quiet: true }, every: 20, do: [lines(mark("Это лодка, а не молоток, капитан!", "It's a boat, skipper, not a hammer!"))] },
    { id: "wide", when: { steps: ["escape"], stepTime: 50, quiet: true }, do: [lines(mark("Пусть чуть дольше. Главное — не дать им борт подставить.", "Longer's fine. Just don't give them our side."))] },

    // --- S09 ------------------------------------------------------------------------------
    { id: "luis-stays", when: { steps: ["cove", "haven"], not: ["m01_luis_rescued"] }, do: [{ do: "flag", flag: "gone:luis-cove" }] },
    { id: "f003", when: { steps: ["haven"], flags: ["m01_luis_rescued"], quiet: true, stepTime: 1 }, do: [lines(say("maya", "Луис? Господи… Садись. Дай посмотреть руки.", "Luis? Good Lord… Sit down. Let me see your hands."))] },
    { id: "f004", when: { steps: ["haven"], not: ["m01_luis_rescued"], quiet: true, stepTime: 1 }, do: [lines(say("maya", "Я слышала стрельбу с мыса. У вас всё хорошо?", "I heard shooting from the cape. Are you all right?"))] },
    { id: "loud-done", when: { steps: ["free"], flags: ["alert:combat"], stepTime: 0.05 }, do: [lines(mark("Ты вошёл шумнее, чем я рассчитывал. Но бумагу мы достали.", "You went in louder than I'd planned. But we got the paper."))] },
    { id: "quiet-done", when: { steps: ["free"], not: ["alert:combat"], stepTime: 0.05 }, do: [lines(mark("Вошли тихо. Теперь бы так же выйти.", "We got in quiet. Now to get out the same way."))] },
    { id: "hydro-after", when: { steps: ["escape"], flags: ["m01_hydro_hint_seen"], stepTime: 30, quiet: true }, do: [lines(mark("Ты ведь не просто плавал на своей яхте, верно?", "You didn't just sail around on that yacht of yours, did you?"), hero("Когда-то рисовал карты. Давно.", "I used to draw charts. A long time ago."), mark("Тогда знаешь, что линии на бумаге переживают людей.", "Then you know lines on paper outlive people."))] },
  ],
};
