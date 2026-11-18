import type { Cutscene, DroneGroup, Effect, Line, Mission, Presence, Text } from "../StoryTypes";
import { CHASE_ROUTE } from "../levels/m02Places";
import { BAY_PEOPLE, FIVE } from "./m02Cast";

/**
 * M02 «Люди, которых мы спасли» (the scenario of 13 Nov 2026, see
 * docs/campaign/missions/m02.md): an SOS from a fishing village held by
 * mercenaries; ashore, the hero finds old Mateo and the four hidden behind
 * the fish shop and walks them to the back jetty; the captain's Albatross
 * takes them off, the hero on her stern gun through five waves of pursuers
 * in the mangroves; out of the fight the captain turns out to be his old
 * comrade; the Free Bay opens.
 *
 * The scenario's lines are used as written (its ids M02_Dxxx); the archive
 * branches of S12/S13 wait for the mission that finds the recording, the
 * no-archive first meeting (version B) is played.
 */

const t = (ru: string, en: string): Text => ({ ru, en });
const say = (who: string, ru: string, en: string, via: Line["via"] = "voice"): Line => ({ who, via, text: t(ru, en) });
const hero = (ru: string, en: string): Line => say("hero", ru, en);
const radio = (who: string, ru: string, en: string): Line => say(who, ru, en, "radio");
const lines = (...list: Line[]): Effect => ({ do: "say", lines: list });
const flag = (name: string, off = false): Effect => ({ do: "flag", flag: name, off });

/** The village and the channel stand from the first step to the last wave. */
const VILLAGE: readonly Presence[] = [
  { kind: "level", level: "tl" },
  { kind: "level", level: "gs" },
];
const ASHORE: readonly Presence[] = [
  ...VILLAGE,
  { kind: "actors", ids: ["g01", "g02", "g03", "g04", "g05", "g06", "g07", "g08", "g09", "g10", "g11", "g12", "g13", "g14", "g15", ...FIVE] },
];

/** The pursuers, wave by wave: one boat each, two in the fourth (P04A and P04B), all of them crewed, all of them can be stopped. */
const pursuer = (id: string, speed: number): DroneGroup => ({ id, at: "tikhiy-list", count: 1, behaviour: "chase", crewed: true, vulnerable: true, speed });
const P01 = pursuer("p01", 17);
const P02 = pursuer("p02", 17.5);
const P03 = pursuer("p03", 18);
const P04A = pursuer("p04a", 17.5);
const P04B = pursuer("p04b", 18);
const P05 = pursuer("p05", 18.5);

/** A wave's boat put out of the fight (her engine stopped, or sunk): a flag, and the line for it. */
const out = (group: string, said: Line | null): { id: string; when: { any: { event: string }[] }; do: Effect[] } => ({
  id: `${group}-out`,
  when: { any: [{ event: `destroyed:${group}` }, { event: `stopped:${group}` }] },
  do: [flag(`m02_${group}_out`), ...(said ? [lines(said)] : [])],
});

// --- Scenes ---------------------------------------------------------------------------------

/** S02: Mateo under his awning, watching the boats; the hero comes up to him. */
const MATEO: Cutscene = {
  id: "m02-mateo",
  shots: [
    {
      seconds: 6,
      from: { eye: { anchor: "spot:tl:cam-mateo" }, look: { anchor: "actor:m02-mateo", offset: [0, 1.4, 0] }, fov: 40 },
      to: { eye: { anchor: "spot:tl:cam-mateo", offset: [0.6, -0.2, 0.8] }, look: { anchor: "actor:m02-mateo", offset: [0, 1.45, 0] }, fov: 34 },
      ease: "inOut",
    },
  ],
};

/** S04/S05: the latch lifted, the five in the half-light of the shelter. */
const SHELTER: Cutscene = {
  id: "m02-shelter",
  shots: [
    {
      seconds: 7,
      from: { eye: { anchor: "spot:tl:cam-shelter" }, look: { anchor: "spot:tl:cam-shelter-look" }, fov: 52 },
      to: { eye: { anchor: "spot:tl:cam-shelter", offset: [0.5, -0.1, 0.9] }, look: { anchor: "spot:tl:cam-shelter-look" }, fov: 46 },
      ease: "inOut",
    },
  ],
};

/** S06: the Albatross comes in to the jetty; the five go aboard one by one, the hero to the stern gun. */
const BOARD: Cutscene = {
  id: "m02-board",
  shots: [
    {
      seconds: 6,
      from: { eye: { anchor: "spot:tl:cam-jetty" }, look: { anchor: "spot:tl:cam-jetty-look" }, fov: 44 },
      to: { eye: { anchor: "spot:tl:cam-jetty", offset: [1.5, -0.4, 2] }, look: { anchor: "spot:tl:cam-jetty-look" }, fov: 40 },
      ease: "inOut",
    },
    {
      // Aboard: over the gun's shield, astern, the jetty falling away.
      seconds: 5,
      from: { eye: { anchor: "yacht", offset: [-1.6, 2.6, -7] }, look: { anchor: "yacht", offset: [0, 1.4, 1] }, fov: 50 },
      to: { eye: { anchor: "yacht", offset: [-1.2, 2.3, -6] }, look: { anchor: "yacht", offset: [0, 1.4, 0] }, fov: 46 },
      ease: "out",
    },
  ],
};

/** S12: out of the fight; the captain comes out of the wheelhouse to count people, and looks at the gunner twice. */
const OLD_TIMES: Cutscene = {
  id: "m02-old-times",
  hold: true,
  shots: [
    {
      // The empty belt tray, the gun's cooling jacket.
      seconds: 5,
      from: { eye: { anchor: "yacht", offset: [0.9, 2.2, -2.6] }, look: { anchor: "yacht", offset: [0, 1.6, -4.2] }, fov: 38 },
      to: { eye: { anchor: "yacht", offset: [0.7, 2.1, -2.9] }, look: { anchor: "yacht", offset: [0, 1.55, -4.2] }, fov: 34 },
      ease: "inOut",
    },
    {
      // The two of them in one frame, the people on the benches between.
      seconds: 9,
      from: { eye: { anchor: "yacht", offset: [-2.6, 2.6, -6.8] }, look: { anchor: "yacht", offset: [0, 1.5, 0.5] }, fov: 46 },
      to: { eye: { anchor: "yacht", offset: [-2.3, 2.4, -6.2] }, look: { anchor: "yacht", offset: [0, 1.5, 0.5] }, fov: 42 },
      ease: "inOut",
    },
    {
      // Recognition: on the captain's face.
      seconds: 30,
      from: { eye: { anchor: "yacht", offset: [-0.4, 2.3, -0.6] }, look: { anchor: "yacht", offset: [-0.5, 1.75, 1.9] }, fov: 32 },
      to: { eye: { anchor: "yacht", offset: [-0.3, 2.25, -0.2] }, look: { anchor: "yacht", offset: [-0.5, 1.75, 1.9] }, fov: 30 },
      ease: "linear",
    },
  ],
};

/** S13: the Free Bay from the pier head: coloured houses, people, smoke from the bar's grill. */
const BAY: Cutscene = {
  id: "m02-bay",
  shots: [
    {
      seconds: 7,
      from: { eye: { anchor: "spot:bay:cam-arrive" }, look: { anchor: "spot:bay:cam-arrive-look" }, fov: 50 },
      to: { eye: { anchor: "spot:bay:cam-arrive", offset: [0.8, -0.6, 1.5] }, look: { anchor: "spot:bay:cam-arrive-look" }, fov: 46 },
      ease: "inOut",
      cue: [{ do: "title", style: "place", title: t("Бухта свободных", "The Free Bay"), subtitle: t("Перекрёсток архипелага", "The archipelago's crossroads") }],
    },
    {
      seconds: 6,
      from: { eye: { anchor: "spot:bay:cam-square" }, look: { anchor: "spot:bay:cam-square-look" }, fov: 52 },
      to: { eye: { anchor: "spot:bay:cam-square", offset: [-1, -0.5, 1] }, look: { anchor: "spot:bay:cam-square-look" }, fov: 48 },
      ease: "inOut",
    },
  ],
};

export const M02_CUTSCENES: readonly Cutscene[] = [MATEO, SHELTER, BOARD, OLD_TIMES, BAY];

// --- The mission -----------------------------------------------------------------------------

const VILLAGE_BED = "m01/sfx/FX045_beach_summer_day_loop";
const BAY_BED = "m01/sfx/EXFX0048_tropical_beach_breeze";

export const M02: Mission = {
  id: "m02",
  chapter: "chapter-1",
  title: t("Люди, которых мы спасли", "The People We Saved"),
  brief: t(
    "Сигнал SOS с рыбацкого посёлка Тихий Лист: пятеро гражданских на берегу, у пирса вооружённые люди. Вывести их к катеру, который за ними возвращается.",
    "An SOS from the fishing village of Тихий Лист: five civilians on the shore, armed men at the pier. Get them to the boat that is coming back for them.",
  ),
  giver: "captain",
  sector: "dead-tide",
  requires: ["m01"],
  status: "playable",
  presence: VILLAGE,
  steps: [
    {
      // A while after M01, wherever he is: the radio wakes.
      id: "signal",
      objective: { kind: "when", when: { stepTime: 20, quiet: true } },
    },
    {
      // S01: the SOS.
      id: "sos",
      goal: t("Проверьте сигнал с рыбацкого посёлка Тихий Лист", "Check the signal from the fishing village of Тихий Лист"),
      hint: t("Подойдите к старой каменной лестнице на западном берегу и причальте", "Come in to the old stone steps on the west shore and make fast"),
      objective: { kind: "reach", at: "tl:berth", by: "yacht", radius: 40 },
      marker: "tl:berth",
      onStart: [
        { do: "sound", sound: "radio-noise" },
        lines(
          radio("unknown", "Любой, кто нас слышит… у посёлка Тихий Лист люди на берегу. Нам нужна лодка.", "Anyone who hears us… there are people on the shore at Тихий Лист. We need a boat."),
          hero("Приём. Сколько вас осталось?", "Receiving. How many of you are left?"),
          radio("unknown", "Пятеро. Остальных вывезли. У пирса вооружённые люди.", "Five. The rest were taken off. Armed men at the pier."),
          hero("Понял. Я рядом.", "Understood. I'm close."),
        ),
      ],
    },
    {
      // S02: ashore, to the awning by the south shore.
      id: "ashore",
      goal: t("Найдите Матео Вегу у навеса над южным берегом", "Find Mateo Vega under the awning above the south shore"),
      hint: t("Пригнитесь (C), держитесь в тени навесов: у рынка наёмники", "Crouch (C) and keep to the awnings' shade: there are mercenaries at the market"),
      objective: { kind: "when", when: { nearActor: { id: "m02-mateo", radius: 3.5 } } },
      marker: "tl:mateo",
      presence: ASHORE,
      bed: VILLAGE_BED,
      checkpoint: { yacht: "tl:berth", skipper: "ashore", spot: "tl:landing" },
      onStart: [
        { do: "time", hour: 16.3, hold: true },
        { do: "weather", kind: "clear" },
        lines(hero("У навеса. Кого искать?", "At the awnings. Who am I looking for?"), radio("nika", "Матео Вегу. Старик в синей рубашке. Он с остальными.", "Mateo Vega. An old man in a blue shirt. He's with the others.")),
      ],
    },
    {
      id: "mateo",
      objective: { kind: "listen" },
      presence: ASHORE,
      bed: VILLAGE_BED,
      onStart: [
        { do: "actor", id: "m02-mateo", face: "tl:mateo-hero" },
        { do: "cutscene", scene: "m02-mateo" },
        lines(
          say("mateo", "Не стой посреди прохода. Они отсюда рынок простреливают.", "Don't stand in the open. They can cover the whole market from here."),
          hero("Я за вами. Где остальные?", "I've come for you. Where are the others?"),
          say("mateo", "За цехом. Четверо. Я отсюда за катерами смотрю.", "Behind the fish shop. Four of them. I watch the boats from here."),
          hero("Большой причал уже не взять.", "The big pier's out of the question."),
          say("mateo", "С другой стороны есть доски. Там раньше сети разгружали.", "There are planks on the other side. We used to land the nets there."),
          radio("captain", "К запасному причалу подойду. Только покажите, когда вода чистая.", "I'll come in to the back jetty. Just tell me when the water's clear."),
          say("mateo", "Опять вернулся… Узнаю этого упрямца.", "Back again… I'd know that stubborn mule anywhere."),
          hero("Вы знакомы?", "You know him?"),
          say("mateo", "Ещё как. Половину нашей бухты вместе на сваях подняли. Потом расскажу.", "I'll say. We put half our bay up on stilts together. I'll tell you later."),
          radio("nika", "Не затягивайте. С той стороны уже слышны моторы.", "Don't drag it out. We can hear engines on the other side already."),
        ),
      ],
      onComplete: [{ do: "cut" }, { do: "actor", id: "m02-mateo", to: "tl:shelter-mateo", pace: "creep" }, flag("m02_mateo_met")],
    },
    {
      // S03: through the market (or round it) to the fish shop.
      id: "market",
      goal: t("Пройдите к рыбному цеху, не привлекая лишних врагов", "Get to the fish shop without drawing more of them"),
      hint: t("Три пути: рынок, переулок под холмом или двор за оградой", "Three ways: the market, the lane under the hill, or the yard behind the fence"),
      objective: { kind: "when", when: { area: "tl:fishshop" } },
      marker: "tl:shop-safe",
      presence: ASHORE,
      bed: VILLAGE_BED,
      checkpoint: { yacht: "tl:berth", skipper: "ashore", spot: "tl:mateo-hero" },
      onComplete: [lines(radio("nika", "Мы рядом. Осталось вывести людей к воде.", "We're close. All that's left is getting the people to the water."))],
    },
    {
      // S04: the shelter behind the shop, its door latched from inside.
      id: "smokehouse",
      goal: t("Откройте путь к укрытию рыбаков за цехом", "Open the way to the fishermen's shelter behind the shop"),
      objective: { kind: "use", id: "tl-shelter-door" },
      marker: "tl:door-out",
      presence: ASHORE,
      bed: VILLAGE_BED,
      checkpoint: { yacht: "tl:berth", skipper: "ashore", spot: "tl:shop-safe" },
    },
    {
      // S05: five under the lean-to; the route confirmed on the radio.
      id: "five",
      goal: t("Подтвердите маршрут по рации капитана", "Confirm the way out on the captain's radio"),
      objective: { kind: "use", id: "tl-radio" },
      marker: "tl:shelter",
      presence: ASHORE,
      bed: VILLAGE_BED,
      checkpoint: { yacht: "tl:berth", skipper: "ashore", spot: "tl:door-out" },
      onStart: [
        { do: "switch", name: "tl:shelter-door", value: "open" },
        { do: "actor", id: "m02-mateo", put: "tl:shelter-mateo" },
        { do: "cutscene", scene: "m02-shelter" },
        lines(
          say("aliya", "Вы точно пришли за нами?", "You've really come for us?"),
          hero("Да. Катер подойдёт с другой стороны. Собирайтесь.", "Yes. The boat will come in on the other side. Get ready."),
          say("luka", "А где их большой патруль?", "And where's their big patrol?"),
          hero("Ещё здесь. Потому и идём быстро.", "Still here. That's why we're moving fast."),
          say("juan", "Я двигатель у резервного причала подготовил. Его они не нашли.", "I got the engine at the back jetty ready. They never found it."),
          say("rafa", "Можно забрать инструменты? Здесь всё моё.", "Can I take my tools? Everything here is mine."),
          say("aliya", "Рафа, лодка не резиновая.", "Rafa, the boat isn't made of rubber."),
          say("rafa", "Знаю. Сумку одну.", "I know. One bag."),
          say("mateo", "Стойте. Я за журналом.", "Hold on. I'm getting the logbook."),
          say("aliya", "Матео, журнал можно потом.", "Mateo, the logbook can wait."),
          say("mateo", "Там записи по всем причалам. Кто ещё помнит, что где было?", "It has every pier in it. Who else remembers what was where?"),
          hero("Возьмите один лист. Остальное потом.", "Take one page. The rest later."),
          say("mateo", "Ладно… один.", "All right… one."),
        ),
      ],
      onComplete: [{ do: "cut" }],
    },
    {
      // S06: out to the back jetty, the five behind him; the three from the big pier come too late.
      id: "jetty",
      goal: t("Выведите пятерых к запасному причалу", "Get the five to the back jetty"),
      hint: t("Люди идут за вами; при стрельбе они пригибаются у стен", "They follow you; under fire they keep low by the walls"),
      objective: { kind: "when", when: { area: "tl:jetty" } },
      marker: "tl:jetty",
      presence: ASHORE,
      bed: VILLAGE_BED,
      checkpoint: { yacht: "tl:berth", skipper: "ashore", spot: "tl:door-out" },
      onStart: [
        ...FIVE.map((id): Effect => ({ do: "actor", id, follow: true })),
        lines(radio("nika", "Причал свободен. Давайте людей по одному, без толкотни.", "The jetty's clear. Bring them one at a time, no crowding."), say("mateo", "Я последний.", "I'll go last."), hero("Не сейчас. Проходите.", "Not now. Go on."), say("mateo", "Не спорю. Почти.", "I'm not arguing. Almost.")),
        { do: "actor", id: "g13", to: "tl:g13-cover", pace: "run" },
        { do: "actor", id: "g14", to: "tl:g14-cover", pace: "run" },
        { do: "actor", id: "g15", to: "tl:g15-cover", pace: "run" },
      ],
    },
    {
      // The Albatross alongside; aboard.
      id: "board",
      objective: { kind: "watch" },
      presence: VILLAGE,
      bed: VILLAGE_BED,
      onStart: [
        { do: "craft", craft: "albatross", at: "tl:jetty-berth" },
        { do: "cutscene", scene: "m02-board" },
        ...["m02-nika", ...FIVE].map((id): Effect => ({ do: "actor", id, remove: true })),
        ...["m02-nika", ...FIVE, "m02-captain"].map((id) => flag(`aboard:${id}`)),
        { do: "board" },
        lines(
          say("nika", "Матео, руку давай. Вот так.", "Mateo, give me your hand. That's it."),
          say("rafa", "Сумка у меня. Никому не мешаю.", "I've got the bag. I'm not in anyone's way."),
          say("aliya", "Лука, не оглядывайся. Иди.", "Luka, don't look back. Go."),
          say("luka", "Я иду.", "I'm going."),
          say("captain", "Стрелок! На корму, к установке!", "Gunner! Aft, to the gun!"),
          hero("Садись за руль, я прикрою!", "Get on the wheel, I'll cover us!"),
          say("captain", "Уже сижу! Держись!", "Already there! Hold on!"),
          say("nika", "Пятеро на борту! Я с ними!", "Five aboard! I'm with them!"),
          say("captain", "Отходим!", "Casting off!"),
        ),
      ],
      onComplete: [{ do: "cut" }, flag("gunner"), flag("m02_civilians_aboard")],
    },
    // --- The chase: the captain steers, the hero on the stern gun ---------------------------
    {
      id: "wave1",
      goal: t("Отбейте первый катер", "Beat off the first boat"),
      hint: t("Мышь — наводка, левая кнопка — огонь; следите за нагревом ствола", "Mouse to aim, left button to fire; mind the barrel's heat"),
      objective: { kind: "when", when: { any: [{ flags: ["m02_p01_out"] }, { stepTime: 75 }] } },
      presence: [...VILLAGE, { kind: "drones", group: P01 }],
      onStart: [
        { do: "freeze", on: true },
        { do: "pilot", route: CHASE_ROUTE, speed: 0.92 },
        lines(say("captain", "Сзади один! Видишь?", "One astern! See him?"), hero("Вижу.", "I see him."), say("nika", "Всем пригнуться! Голову ниже!", "Everybody down! Heads lower!")),
      ],
      onComplete: [{ do: "withdraw", group: "p01", to: "tikhiy-list" }, lines(say("captain", "Не расслабляйся. На повороте ещё будут.", "Don't relax. There'll be more at the bend."))],
    },
    {
      id: "wave2",
      goal: t("Держите огонь по второму катеру — впереди низкий мост", "Keep firing on the second boat — a low bridge ahead"),
      objective: { kind: "when", when: { any: [{ flags: ["m02_p02_out"] }, { stepTime: 70 }] } },
      presence: [...VILLAGE, { kind: "drones", group: P02 }],
      onComplete: [{ do: "withdraw", group: "p02", to: "tikhiy-list" }, lines(say("nika", "Все целы. Идём дальше.", "Everyone's fine. Moving on."))],
    },
    {
      id: "wave3",
      goal: t("Не дайте третьему подойти к корме", "Don't let the third boat close on the stern"),
      objective: { kind: "when", when: { any: [{ flags: ["m02_p03_out"] }, { stepTime: 70 }] } },
      presence: [...VILLAGE, { kind: "drones", group: P03 }],
      onStart: [lines(say("captain", "Узко будет. Руки не отпускай!", "It's going to be tight. Don't let go!"), hero("Я уже понял, как ты водишь.", "I've worked out how you drive."), say("captain", "Сейчас станет ещё понятнее.", "It's about to get even clearer."))],
      onComplete: [{ do: "withdraw", group: "p03", to: "tikhiy-list" }, lines(say("mateo", "Такую дорогу я не выбирал.", "This isn't the road I'd have picked."), say("nika", "Зато она нас вывела.", "But it got us out."))],
    },
    {
      id: "wave4",
      goal: t("Отразите атаку двух катеров", "Beat off the two boats together"),
      objective: { kind: "when", when: { any: [{ flags: ["m02_p04a_out", "m02_p04b_out"] }, { stepTime: 85 }] } },
      presence: [...VILLAGE, { kind: "drones", group: P04A }, { kind: "drones", group: P04B }],
      onStart: [lines(say("nika", "Два угла! Они нас поджимают!", "Both quarters! They're squeezing us!"), say("captain", "Не суетись. Я выведу на прямую.", "Easy. I'll get us onto the straight."))],
      onComplete: [
        { do: "withdraw", group: "p04a", to: "tikhiy-list" },
        { do: "withdraw", group: "p04b", to: "tikhiy-list" },
        lines(say("captain", "Хорошо. Ещё один рывок.", "Good. One more push.")),
      ],
    },
    {
      id: "wave5",
      goal: t("Остановите последнего и уходите в лагуну", "Stop the last one and get into the lagoon"),
      objective: { kind: "reach", at: "free-bay", by: "yacht", radius: 260 },
      presence: [...VILLAGE, { kind: "drones", group: P05 }],
      onStart: [lines(say("captain", "Последний. За мысом отстанет.", "The last one. He'll drop off past the point."), hero("Дай мне секунду!", "Give me a second!"))],
      onComplete: [
        { do: "withdraw", group: "p05", to: "tikhiy-list" },
        lines(
          say("nika", "У нас никто не ранен. Давай домой.", "Nobody's hurt. Take us home."),
          say("mateo", "Я уже думал, что эту воду не увижу.", "I thought I'd never see this water again."),
          say("aliya", "Ты её каждый день видишь, Матео.", "You see it every day, Mateo."),
          say("mateo", "А сегодня особенно хорошо.", "Today it looks especially good."),
          hero("Всё. Чисто.", "That's it. Clear."),
          say("captain", "Хорошо отработал. Сейчас причалим.", "Good work. We'll be alongside in a minute."),
        ),
      ],
    },
    {
      // S12: «как в старые времена».
      id: "old-times",
      objective: { kind: "when", when: { stepTime: 4, quiet: true } },
      presence: [{ kind: "level", level: "bay" }],
      bed: BAY_BED,
      onStart: [
        flag("gunner", true),
        { do: "switch", name: "bay:albatross", value: "away" },
        { do: "pilot", route: ["bay:albatross-berth"], speed: 0.35 },
        { do: "cutscene", scene: "m02-old-times" },
        lines(
          say("nika", "Пятеро. Проверила дважды.", "Five. I checked twice."),
          say("captain", "Отлично. Вода у всех есть?", "Good. Has everyone got water?"),
          say("nika", "Есть. А этот стрелок тебе весь короб сжёг.", "They have. And this gunner burned through your whole box."),
          say("captain", "Ты мне всю ленту извёл.", "You've used up my whole belt."),
          hero("А ты лодку чуть не перевернул.", "And you nearly rolled the boat."),
          say("captain", "Погоди…", "Wait…"),
          hero("Ну?", "Well?"),
          say("captain", "Блядь… Это ты?", "Fuck… Is that you?"),
          hero("Привет.", "Hi."),
          say("captain", "Да охренеть.", "Well, I'll be damned."),
          hero("Ты всегда так встречаешь гостей?", "Is that how you always greet guests?"),
          say("captain", "Гостей — лучше.", "Guests get better."),
          say("captain", "Серьёзно… я рад, что ты жив.", "Seriously… I'm glad you're alive."),
          hero("Я тоже.", "So am I."),
          say("captain", "Подойди. Ты целый?", "Come here. Are you in one piece?"),
          hero("Более-менее.", "More or less."),
          say("captain", "Слушай. Я знаю, что пропал. Я…", "Listen. I know I disappeared. I…"),
          hero("Потом. Сначала людей довези.", "Later. Get the people home first."),
          say("captain", "Да. Верно.", "Yes. Right."),
          say("mateo", "Вы знакомы, что ли?", "You two know each other?"),
          say("captain", "Очень давно.", "For a very long time."),
        ),
      ],
      onComplete: [{ do: "cut" }, flag("captain_met"), flag("m02_captain_recognised")],
    },
    {
      // S13: the Free Bay.
      id: "bay",
      goal: t("Поговорите с капитаном на причале", "Talk to the captain on the pier"),
      objective: { kind: "use", id: "bay-captain" },
      marker: "bay:captain",
      presence: [{ kind: "level", level: "bay" }, { kind: "actors", ids: BAY_PEOPLE }],
      bed: BAY_BED,
      checkpoint: { yacht: "bay:skiff-berth", skipper: "ashore", spot: "bay:hero" },
      onStart: [
        { do: "pilot", route: null },
        { do: "freeze", on: false },
        ...["m02-nika", ...FIVE, "m02-captain"].map((id) => flag(`aboard:${id}`, true)),
        { do: "craft", craft: "skiff", at: "bay:skiff-berth" },
        { do: "switch", name: "bay:albatross", value: "home" },
        { do: "put", at: "bay:hero" },
        { do: "repair", hull: 1 },
        { do: "cutscene", scene: "m02-bay" },
        lines(
          say("mateo", "Вот теперь дома.", "Now we're home."),
          say("aliya", "Да. Дома.", "Yes. Home."),
          say("nika", "В медпункт пройдите. Просто осмотр, минут пять.", "Go to the clinic. Just a check-up, five minutes."),
          say("rafa", "Мне инструменты куда?", "Where do my tools go?"),
          say("mateo", "Своими ногами до мастерской донесёшь.", "On your own two feet, to the workshop."),
          say("rafa", "Так я и думал.", "That's what I thought."),
          say("oskar", "Матео! Живой, старый разбойник?", "Mateo! Still alive, you old bandit?"),
          say("mateo", "А ты всё так же моторы мучаешь?", "And you're still torturing engines?"),
          say("oskar", "Один уже завёлся. Ты слышишь?", "One of them's running already. Hear it?"),
          say("mila", "Кому воды? Сначала пить, потом рассказывать.", "Who wants water? Drink first, talk later."),
        ),
      ],
      onComplete: [{ do: "cut" }],
    },
  ],
  triggers: [
    // S01: Nika on the radio as he nears the village.
    {
      id: "sos-nika",
      when: { steps: ["sos"], near: { at: "tikhiy-list", radius: 650 }, quiet: true },
      do: [
        lines(
          radio("nika", "Кто идёт к берегу, не подходите к большому причалу. Там стоят наёмники.", "Whoever's coming in, keep off the big pier. There are mercenaries on it."),
          hero("Вижу старую тропу. Подойду с запада.", "I see the old path. I'll come in from the west."),
          radio("nika", "Хорошо. Под навесом пятеро наших. Скажи им: пришёл за людьми, не за грузом.", "Good. Five of ours under the awning. Tell them you've come for people, not cargo."),
          hero("Принял.", "Copy."),
        ),
      ],
    },
    {
      id: "sos-watch",
      when: { steps: ["sos"], near: { at: "tikhiy-list", radius: 420 }, quiet: true },
      do: [lines(radio("merc-lookout", "Северный причал перекрыть. Ни одной лодки не выпускать.", "Close off the north pier. Not one boat gets out."), hero("Значит, торопиться всё-таки придётся.", "So I'll have to hurry after all."))],
    },
    // S03: what the market's people say among themselves, heard from cover.
    {
      id: "mk-report",
      when: { steps: ["ashore", "market"], near: { at: "tl:g01", radius: 16 }, not: ["alert:suspicious", "alert:combat"], quiet: true },
      do: [lines(say("g01", "Я этот рынок ещё месяц назад в торговом отчёте видел. Полный народа был.", "I saw this market in a trade report a month ago. It was full of people."), say("g02", "А теперь два ящика воды на четверых. Отличная работа.", "And now it's two crates of water for four of us. Great job."))],
    },
    {
      id: "mk-ice",
      when: { steps: ["market"], near: { at: "tl:g05", radius: 12 }, crouched: true, not: ["alert:suspicious", "alert:combat"], quiet: true },
      do: [
        lines(
          say("g05", "Не трогай лёд. Его уже утром отключили.", "Leave the ice. They cut it off this morning."),
          say("g06", "Тогда чего здесь вообще торчим?", "Then why are we even standing here?"),
          say("g05", "Потому что приказ. Ты сегодня с утра невнимательный.", "Because those are the orders. You're not paying attention today."),
        ),
      ],
    },
    { id: "mk-way", when: { steps: ["market"], stepTime: 10, quiet: true }, do: [lines(hero("Тут проход есть. За рынком.", "There's a way through. Behind the market."))] },
    {
      id: "mk-lost",
      when: { steps: ["market"], stepTime: 45, not: ["alert:combat"], quiet: true },
      do: [lines(radio("nika", "Ты у рынка? Там за стойкой слева дверь в цех.", "Are you at the market? Behind the counter on the left there's a door into the shop."), hero("Вижу. Двигаюсь дальше.", "I see it. Moving on."))],
    },
    { id: "mk-many", when: { steps: ["market", "smokehouse"], alert: "combat", stepTime: 25, quiet: true }, do: [lines(hero("Чёрт, их больше, чем я думал.", "Damn, there are more of them than I thought."))] },
    // S04: the smokehouse's two on watch, and the voices behind the latched door.
    {
      id: "sm-watch",
      when: { steps: ["smokehouse"], near: { at: "tl:g10", radius: 16 }, not: ["alert:suspicious", "alert:combat"], quiet: true },
      do: [lines(say("g09", "Поднимись на лестницу, посмотри к воде.", "Get up the stairs, look toward the water."), say("g10", "Солнце в глаза. Отсюда ничего не видно.", "Sun's in my eyes. Can't see a thing from here."))],
    },
    {
      id: "sm-voices",
      when: { steps: ["smokehouse"], near: { at: "tl:door-out", radius: 7 }, quiet: true },
      do: [lines(say("aliya", "Мне кажется, кто-то в цехе.", "I think someone's in the shop."), say("luka", "Это они?", "Is it them?"), radio("mateo", "Это наш. Дайте ему открыть.", "He's one of ours. Let him open it."))],
    },
    // S06: under fire on the way to the jetty.
    { id: "jt-fire", when: { steps: ["jetty"], alert: "combat", quiet: true }, do: [lines(hero("На мостик! Быстрее!", "Onto the planks! Quick!"))] },
    // The chase's voices.
    out("p01", hero("Первый отстал.", "The first one's dropped back.")),
    out("p02", hero("Есть! Он отстал.", "Got him! He's dropped back.")),
    out("p03", hero("Есть! Оторвались.", "Got him! We've lost him.")),
    out("p04a", hero("Катер остановился.", "That boat's stopped.")),
    out("p04b", hero("Второй тоже.", "The second one too.")),
    out("p05", hero("Он отстал!", "He's dropped back!")),
    { id: "w1-close", when: { steps: ["wave1"], stepTime: 12, quiet: true }, do: [lines(say("merc-gunner", "Держите их на линии!", "Keep them on the line!"), say("captain", "Сейчас вправо. Держись за станок!", "Going right. Hold onto the mount!"))] },
    { id: "w1-roll", when: { steps: ["wave1"], stepTime: 26, quiet: true }, do: [lines(hero("Да не крути ты так резко!", "Don't throw her around like that!"), say("captain", "А ты хочешь, чтоб нас догнали?", "You want them to catch us?"))] },
    { id: "w1-shallow", when: { steps: ["wave1"], stepTime: 40, quiet: true }, do: [lines(say("merc-helm", "Не могу ближе, мелко!", "Can't get closer, it's shallow!"), say("nika", "Я людей держу. Делайте своё.", "I've got the people. You do your part."))] },
    {
      id: "w2-bridge",
      when: { steps: ["wave2"], near: { at: "gs:bridge", radius: 260 }, quiet: true },
      do: [lines(say("captain", "Мост впереди! Присядь!", "Bridge ahead! Get down!"), hero("Где?", "Where?"), say("captain", "Да прямо у тебя над головой будет!", "Right over your head in a second!"), say("nika", "Голову вниз! Все!", "Heads down! Everyone!"))],
    },
    { id: "w2-creak", when: { steps: ["wave2"], near: { at: "gs:bridge", radius: 60 }, quiet: true }, do: [lines(say("mateo", "Знаю эту переправу. Она ещё при мне скрипела.", "I know this crossing. It creaked back in my day."), say("luka", "Сейчас не время!", "Not now!"))] },
    { id: "w2-left", when: { steps: ["wave2"], stepTime: 30, quiet: true }, do: [lines(say("merc-gunner", "Вперёд, мост уже прошли!", "Go, we're past the bridge!"), hero("Слева ещё один!", "Another one on the left!"), say("captain", "Вижу. Я отвожу нас от берега.", "I see him. I'm taking us off the shore."))] },
    { id: "w3-rafa", when: { steps: ["wave3"], stepTime: 16, quiet: true }, do: [lines(say("nika", "Рафа, голову ниже. Да, прямо сейчас.", "Rafa, head down. Yes, right now."), say("rafa", "Я просто хотел посмотреть.", "I just wanted to look."))] },
    { id: "w3-close", when: { steps: ["wave3"], stepTime: 30, quiet: true }, do: [lines(say("merc-gunner", "Прижми их! Догоняем!", "Press them! We're catching up!"), say("merc-helm", "Держу!", "Holding!"), hero("Слишком близко!", "Too close!"), say("captain", "Тогда стреляй, не на меня смотри!", "Then shoot, don't look at me!"))] },
    { id: "w4-right", when: { steps: ["wave4"], stepTime: 18, quiet: true }, do: [lines(say("merc-gunner", "Правее держи, он уходит!", "Keep right, he's getting away!"), say("merc-helm", "Правее не могу, там берег!", "Can't go right, there's the shore!"))] },
    { id: "w4-kidding", when: { steps: ["wave4"], stepTime: 34, quiet: true }, do: [lines(hero("Да вы издеваетесь…", "You've got to be kidding…"), say("captain", "На корме всё ещё твоя работа!", "The stern's still your job!"))] },
    { id: "w4-water", when: { steps: ["wave4"], stepTime: 52, quiet: true }, do: [lines(say("nika", "Алия, вода есть? Дай Матео.", "Aliya, got water? Give some to Mateo."), say("aliya", "Есть. Держи, Матео.", "Here. Take it, Mateo."), say("mateo", "Я живой, Ника. Можно без церемоний.", "I'm alive, Nika. No need to fuss."))] },
    { id: "w5-lose", when: { steps: ["wave5"], stepTime: 14, quiet: true }, do: [lines(say("merc-gunner", "Не теряй их!", "Don't lose them!"), say("merc-helm", "Он стреляет по нам, вижу!", "He's shooting at us, I can see it!"))] },
    // S13: the bay's people as he passes.
    {
      id: "bay-mila",
      when: { steps: ["bay"], nearActor: { id: "m02-mila", radius: 4 }, quiet: true },
      do: [lines(say("mila", "Ты рыбаков привёл? Спасибо. Поешь хоть сначала.", "You brought the fishermen? Thank you. At least eat something first."), hero("Потом. Но спасибо.", "Later. But thanks."))],
    },
    {
      id: "bay-mateo",
      when: { steps: ["bay"], nearActor: { id: "m02-mateo-bay", radius: 4 }, quiet: true },
      do: [lines(say("mateo", "Завтра у меня сети чинить. Заходи, если будет время.", "Tomorrow I'm mending nets. Come by if you have time."), hero("Если свободен буду — зайду.", "If I'm free, I'll come."))],
    },
    { id: "bay-nika", when: { steps: ["bay"], nearActor: { id: "m02-nika-bay", radius: 4 }, quiet: true }, do: [lines(say("nika", "Так. Все пятеро на месте, без серьёзных ран.", "Right. All five accounted for, nothing serious."))] },
  ],
  uses: [
    { id: "tl-rifle", label: t("Взять винтовку и два магазина", "Take the rifle and two magazines"), when: { steps: ["market", "smokehouse"] }, once: true, do: [{ do: "give", what: "rifle" }, lines(hero("Обычная винтовка. Пригодится.", "An ordinary rifle. It'll come in handy."))] },
    {
      id: "tl-shelter-door",
      label: t("Постучать и назваться", "Knock and say who you are"),
      when: { steps: ["smokehouse"] },
      do: [
        lines(
          hero("Я от тех, кто на катере. Откройте.", "I'm with the people on the boat. Open up."),
          say("aliya", "Назови имя старика.", "Tell me the old man's name."),
          hero("Матео. Синяя рубашка, старая сеть. Довольно?", "Mateo. Blue shirt, old net. Good enough?"),
          say("aliya", "Довольно.", "Good enough."),
          radio("nika", "Противники отошли от причала. У вас окно, минуты две.", "They've pulled back from the jetty. You've got a window, two minutes."),
        ),
      ],
    },
    {
      id: "tl-radio",
      label: t("Связаться с катером", "Call the boat"),
      when: { steps: ["five"] },
      do: [
        { do: "sound", sound: "radio-noise" },
        lines(
          radio("nika", "Я вас вижу. Капитан уже разворачивается к причалу.", "I can see you. The captain's already turning for the jetty."),
          hero("Пятеро. Все на ногах. Выходим.", "Five. All on their feet. Coming out."),
          say("mateo", "Он за нами вернулся?", "He came back for us?"),
          radio("nika", "Да. И я бы с ним сейчас не спорила.", "Yes. And I wouldn't argue with him right now."),
          say("mateo", "Вот же упрямый чёрт.", "That stubborn devil."),
        ),
      ],
    },
    {
      id: "bay-captain",
      label: t("Поговорить с капитаном", "Talk to the captain"),
      when: { steps: ["bay"] },
      do: [
        lines(
          say("captain", "Здесь можно заправиться, купить детали. Торговцы свои.", "You can refuel here, buy parts. The traders are our own."),
          hero("А лодки продают?", "Do they sell boats?"),
          say("captain", "Оскар покажет. Скажешь, что от меня. Он всё равно цену не сбросит.", "Oskar will show you. Say I sent you. He won't drop the price anyway."),
          hero("Здесь людно.", "Busy here."),
          say("captain", "Люди идут, когда знают, что их не прогонят.", "People come when they know they won't be driven off."),
          say("captain", "Ты мог бы остаться на ночь. Есть свободная комната.", "You could stay the night. There's a spare room."),
          hero("Посмотрим.", "We'll see."),
          say("captain", "Спасибо за помощь. Дальше сам выбирай, куда идти.", "Thanks for the help. Where you go next is up to you."),
          hero("Это я умею.", "That I can do."),
        ),
      ],
    },
  ],
  onComplete: [
    // The afternoon runs on by itself again.
    { do: "time", hour: 17.2 },
    flag("m02_completed"),
    flag("bay_discovered"),
    { do: "title", style: "end", title: t("Миссия выполнена", "Mission complete"), subtitle: t("Люди, которых мы спасли", "The People We Saved") },
  ],
};
