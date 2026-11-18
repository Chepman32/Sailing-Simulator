import type { Cutscene, Effect, Line, Mission, Presence, Text } from "../StoryTypes";
import { LG4_GUARDS, LG4_PEOPLE, SC_PEOPLE } from "./m03Cast";

/**
 * M03 «Мёртвая вода» (the production kit of 14 Nov 2026, see
 * docs/campaign/missions/m03.md): Kenji's line. The street tap of the
 * Sunny Cape is dry, its water unsafe; the water station Лагуна-4 at the
 * island's south end is being stripped by the company's security. With
 * Kenji the hero gets in (by the gate or the service path), finds Luis's
 * shift, gives Kenji his minute at the control room to stop the
 * discharge, climbs to the yard crane and with it blocks the exit with an
 * empty container and brings the two platforms back to the hangar; then
 * clears the yard, and the clean reserve goes to the village in Daria's
 * tanker.
 *
 * Lines as the kit writes them (ids M03_Sxx_nnn); its conditional
 * variants are played where the game knows the condition.
 */

const t = (ru: string, en: string): Text => ({ ru, en });
const say = (who: string, ru: string, en: string, via: Line["via"] = "voice"): Line => ({ who, via, text: t(ru, en) });
const hero = (ru: string, en: string): Line => say("hero", ru, en);
const kenji = (ru: string, en: string): Line => say("kenji", ru, en);
const lines = (...list: Line[]): Effect => ({ do: "say", lines: list });
const flag = (name: string, off = false): Effect => ({ do: "flag", flag: name, off });

const ISLAND: readonly Presence[] = [
  { kind: "level", level: "sc" },
  { kind: "level", level: "lg4" },
];
const PEOPLE: readonly Presence[] = [...ISLAND, { kind: "actors", ids: ["kenji-m03", ...SC_PEOPLE, ...LG4_PEOPLE, ...LG4_GUARDS] }];

const BED = "m01/sfx/FX064_overlook_seabreeze";
const YARD_BED = "m01/sfx/FX068_outpost_day_loop";

// --- Scenes ----------------------------------------------------------------------------------

const TAP: Cutscene = {
  id: "m03-tap",
  shots: [
    {
      seconds: 7,
      from: { eye: { anchor: "spot:sc:cam-square" }, look: { anchor: "spot:sc:cam-square-look" }, fov: 46 },
      to: { eye: { anchor: "spot:sc:cam-square", offset: [0.6, -0.4, 1.2] }, look: { anchor: "spot:sc:cam-square-look" }, fov: 40 },
      ease: "inOut",
      cue: [{ do: "title", style: "chapter", title: t("Мёртвая вода", "Dead Water"), subtitle: t("Солнечный мыс · полдень", "The Sunny Cape · noon") }],
    },
  ],
};

const OVERLOOK: Cutscene = {
  id: "m03-overlook",
  shots: [
    {
      seconds: 9,
      from: { eye: { anchor: "spot:lg4:cam-overlook" }, look: { anchor: "spot:lg4:cam-overlook-look" }, fov: 38 },
      to: { eye: { anchor: "spot:lg4:cam-overlook", offset: [0.5, 0.2, 1] }, look: { anchor: "spot:lg4:cam-overlook-look" }, fov: 30 },
      ease: "inOut",
    },
  ],
};

const TECH: Cutscene = {
  id: "m03-tech",
  shots: [
    {
      seconds: 8,
      from: { eye: { anchor: "spot:lg4:cam-tech" }, look: { anchor: "spot:lg4:cam-tech-look" }, fov: 48 },
      to: { eye: { anchor: "spot:lg4:cam-tech", offset: [0.4, -0.1, 0.8] }, look: { anchor: "spot:lg4:cam-tech-look" }, fov: 42 },
      ease: "inOut",
    },
  ],
};

const RESERVE: Cutscene = {
  id: "m03-reserve",
  shots: [
    {
      seconds: 9,
      from: { eye: { anchor: "spot:lg4:cam-reserve" }, look: { anchor: "spot:lg4:cam-reserve-look" }, fov: 46 },
      to: { eye: { anchor: "spot:lg4:cam-reserve", offset: [0.8, -0.2, 1.0] }, look: { anchor: "spot:lg4:cam-reserve-look" }, fov: 40 },
      ease: "inOut",
    },
  ],
};

const HOME: Cutscene = {
  id: "m03-home",
  shots: [
    {
      seconds: 8,
      from: { eye: { anchor: "spot:sc:cam-square" }, look: { anchor: "spot:sc:tanker-stop" }, fov: 46 },
      to: { eye: { anchor: "spot:sc:cam-square", offset: [-0.6, -0.3, 1] }, look: { anchor: "spot:sc:cam-square-look" }, fov: 42 },
      ease: "inOut",
    },
  ],
};

export const M03_CUTSCENES: readonly Cutscene[] = [TAP, OVERLOOK, TECH, RESERVE, HOME];

// --- The mission --------------------------------------------------------------------------------

export const M03: Mission = {
  id: "m03",
  chapter: "arcs",
  title: t("Мёртвая вода", "Dead Water"),
  brief: t(
    "На Солнечном мысе пересох уличный кран, а старую подачу пить нельзя. Кендзи Сато ищет, кто сходит с ним на водную станцию «Лагуна-4», которую разбирает охрана.",
    "The street tap on the Sunny Cape has run dry, and the old supply is not safe to drink. Kenji Sato is looking for someone to go with him to the Laguna-4 water station, which the security is stripping.",
  ),
  giver: "kenji",
  sector: "dead-tide",
  requires: ["m01"],
  status: "playable",
  presence: ISLAND,
  steps: [
    {
      // Wherever he is: the cape is on his chart (Mark's coordinates).
      id: "cape",
      goal: t("Солнечный мыс: Кендзи нужна помощь", "The Sunny Cape: Kenji needs help"),
      hint: t("Причальте у пирса на северном берегу", "Come alongside the pier on the north shore"),
      objective: { kind: "reach", at: "sunny-cape", by: "any", radius: 60 },
      marker: "sunny-cape",
    },
    {
      // S01: the dry tap.
      id: "tap",
      goal: t("Поговорите с Кендзи у сухого крана", "Talk to Kenji at the dry tap"),
      objective: { kind: "use", id: "sc-kenji" },
      marker: "sc:kenji",
      presence: PEOPLE,
      bed: BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "sc:pier" },
      onStart: [{ do: "time", hour: 12.2, hold: true }, { do: "weather", kind: "clear" }, { do: "cutscene", scene: "m03-tap" }],
      onComplete: [flag("met_kenji"), flag("m03_accepted")],
    },
    {
      // S02: up the slope to the overlook, Kenji behind.
      id: "path",
      goal: t("Найдите путь на станцию «Лагуна-4»", "Find a way into the Laguna-4 station"),
      hint: t("Дорога на юг; с площадки на склоне видно весь двор", "The road south; from the ledge on the slope you can see the whole yard"),
      objective: { kind: "when", when: { area: "lg4:overlook" } },
      marker: "lg4:overlook",
      presence: PEOPLE,
      bed: BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "sc:hero" },
      onStart: [{ do: "actor", id: "kenji-m03", follow: true }],
    },
    {
      id: "overlook",
      objective: { kind: "listen" },
      presence: PEOPLE,
      bed: BED,
      onStart: [
        { do: "freeze", on: true },
        { do: "cutscene", scene: "m03-overlook" },
        lines(
          hero("Похоже, они сами всё останавливают.", "Looks like they're shutting it all down themselves."),
          kenji("Нет. Они вывозят исправное.", "No. They're taking away what still works."),
          hero("Вон тот блок?", "That unit there?"),
          kenji("Насосный модуль. А под навесом — управление. Без них здесь останется пустая коробка.", "The pump module. And under the awning, the controls. Without them this is an empty box."),
          hero("Значит, не дадим уехать.", "Then we don't let them leave."),
          kenji("Нужно вернуть оба. Резерв отдельно, за техкорпусом.", "We need both back. The reserve is separate, behind the tech building."),
          hero("Кран рабочий?", "Does the crane work?"),
          kenji("Рабочий. И быстрее, чем выглядит.", "It works. And faster than it looks."),
          hero("До него ещё дойти надо.", "We still have to get to it."),
          kenji("Через КПП короче. Сервисная тропа спокойнее.", "The checkpoint's shorter. The service path's quieter."),
          hero("Где рабочие?", "Where are the workers?"),
          kenji("В синем ангаре. Не стреляй по жилетам.", "In the blue hangar. Don't shoot at the vests."),
          say("security-lead", "Первую платформу к выезду. Вторую — следом.", "First platform to the exit. The second after it.", "radio"),
          say("luis-w", "У меня ещё люди на площадке.", "I've still got people on the pad.", "radio"),
          say("security-lead", "Уведи их. Погрузка идёт.", "Get them off. We're loading.", "radio"),
          kenji("Пойдём. Пока не закрыли сервисную дверь.", "Let's go. Before they shut the service door."),
        ),
      ],
      onComplete: [{ do: "cut" }, { do: "freeze", on: false }],
    },
    {
      // S03: the gate or the service path, to the tech building.
      id: "entry",
      goal: t("Доберитесь до техкорпуса", "Get to the tech building"),
      hint: t("КПП — короче и шумнее; сервисная калитка в стене западнее — тише", "The checkpoint is shorter and louder; the service gate in the wall to the west is quieter"),
      objective: { kind: "when", when: { area: "lg4:tech" } },
      marker: "lg4:hero-tech",
      presence: PEOPLE,
      bed: BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "lg4:overlook" },
    },
    {
      // S04: Luis's shift in the tech building.
      id: "tech",
      objective: { kind: "listen" },
      presence: PEOPLE,
      bed: YARD_BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "lg4:hero-tech" },
      onStart: [
        { do: "actor", id: "kenji-m03", follow: false },
        { do: "actor", id: "kenji-m03", to: "lg4:kenji-tech", pace: "walk" },
        { do: "cutscene", scene: "m03-tech" },
        lines(
          say("luis-w", "Сато? Думал, ты уже уехал.", "Sato? I thought you'd left."),
          kenji("Думал. Что с резервом?", "I thought so too. What about the reserve?"),
          say("luis-w", "Отдельный контур. Не открывали. Проверка — вчера.", "Separate circuit. Nobody's opened it. Tested yesterday."),
          hero("То есть воду можно забрать?", "So the water can be taken?"),
          kenji("Этот запас — да. Подачу из ручья пока не трогаем.", "That supply, yes. We leave the stream intake alone for now."),
          say("daria", "Цистерна чистая, промыта. Только выезд теперь под охраной.", "The tanker's clean, flushed out. Only the way out's guarded now."),
          hero("Разберёмся. Модуль уже закрепили на машине?", "We'll deal with it. Is the module fixed on the truck already?"),
          say("luis-w", "Подцепили. Стяжки ещё не ставили, погрузку торопят.", "Hooked on. No straps yet, they're rushing the loading."),
          kenji("Хорошо. Сможем вернуть к ангару.", "Good. We can bring it back to the hangar."),
          hero("Сможем — это кто?", "We — meaning who?"),
          kenji("Ты наверху. Я с площадки помогу.", "You up top. I'll help from the ground."),
          hero("Раньше надо было сказать.", "You could have said so earlier."),
          kenji("Раньше я не знал, что они вообще его снимут.", "Earlier I didn't know they'd take it off at all."),
          say("asha", "Рабочих уведу через южную дверь.", "I'll take the workers out through the south door."),
          kenji("Спасибо. Во двор потом не выходите.", "Thanks. Don't come out into the yard afterwards."),
          say("luis-w", "Приказ демонтажа возьми. Пусть потом не рассказывают, что всё само пропало.", "Take the dismantling order. So nobody says later it all just disappeared."),
        ),
      ],
      onComplete: [
        { do: "cut" },
        flag("clean_reserve_confirmed"),
        flag("evidence_local_spill"),
        { do: "actor", id: "asha", to: "lg4:workers", pace: "walk" },
        { do: "actor", id: "worker-1", to: "lg4:w1", pace: "walk" },
        { do: "actor", id: "worker-2", to: "lg4:w2", pace: "walk" },
        { do: "actor", id: "worker-3", to: "lg4:w3", pace: "walk" },
      ],
    },
    {
      // S05: up the stairs to the control room; Kenji works there while the hero keeps the gallery.
      id: "gallery",
      goal: t("Освободите Кендзи путь к пульту за синей дверью", "Clear Kenji's way to the console behind the blue door"),
      hint: t("Лестница внутри техкорпуса; охрана держит галерею снаружи", "The stairs inside the tech building; the guards hold the gallery outside"),
      objective: { kind: "when", when: { area: "lg4:control" } },
      marker: "lg4:console",
      presence: PEOPLE,
      bed: YARD_BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "lg4:hero-tech" },
      onStart: [lines(kenji("Мне к закрытому пульту. За синей дверью.", "I need the locked console. Behind the blue door."), hero("Снизу пройти можно?", "Can we get there from below?"), kenji("Да. Там выход у лестницы.", "Yes. There's a way out by the stairs."))],
      onComplete: [lines(hero("Вход свободен. Работай.", "The way's clear. Do your job."), kenji("Вижу. Я быстро.", "I see. I'll be quick."))],
    },
    {
      id: "discharge",
      objective: { kind: "when", when: { stepTime: 7, quiet: true } },
      presence: PEOPLE,
      bed: YARD_BED,
      onStart: [{ do: "actor", id: "kenji-m03", to: "lg4:console", pace: "run" }, { do: "sfx", clip: "m01/sfx/FX089_keyboard_typing", volume: 0.8 }],
      onComplete: [
        flag("discharge_stopped"),
        lines(
          say("asha", "Южный проход чистый. Все ушли.", "The south passage is clear. Everyone's out.", "radio"),
          kenji("Понял. Держитесь в ангаре.", "Understood. Stay in the hangar."),
          hero("Тише стало.", "It's gone quieter."),
          kenji("Сброс остановлен.", "The discharge is stopped."),
          hero("Вода теперь нормальная?", "Is the water all right now?"),
          kenji("Нет. Старую подачу оставим закрытой. Сегодня берём только резерв.", "No. We leave the old supply shut. Today we take only the reserve."),
          hero("Хорошо. Где вход наверх?", "All right. Where's the way up?"),
          kenji("Через двор и лестницу справа.", "Across the yard and up the stairs on the right."),
          say("security-lead", "Хватит возиться. Выводите платформы.", "Stop fooling around. Get the platforms out.", "radio"),
          hero("Поторопимся.", "We'd better hurry."),
        ),
      ],
    },
    {
      // S06: across the yard to the stair tower and up to the cab.
      id: "tower",
      goal: t("Поднимитесь в кабину крана", "Climb to the crane's cab"),
      hint: t("Лестничная башня у восточного края двора", "The stair tower at the yard's east edge"),
      objective: { kind: "use", id: "lg4-cab" },
      marker: "lg4:cab",
      presence: PEOPLE,
      bed: YARD_BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "lg4:gallery" },
      onStart: [
        { do: "actor", id: "kenji-m03", to: "lg4:kenji-hangar", pace: "run" },
        lines(hero("Кран здоровенный.", "That's one big crane."), kenji("Три движения. Вдоль рельсов, поперёк и вверх-вниз. Остальное не трогай.", "Three movements. Along the rails, across, and up and down. Don't touch anything else."), hero("Очень успокоил.", "Very reassuring."), kenji("Разберёшься. Я снизу вижу весь двор.", "You'll manage. I can see the whole yard from down here.")),
      ],
      onComplete: [
        lines(
          say("luis-w", "У нас все шесть. Во дворе рабочих нет.", "We've got all six. No workers left in the yard.", "radio"),
          kenji("Принял. Управление у тебя.", "Copy. The controls are yours."),
          hero("С чего начинаем?", "Where do we start?"),
          kenji("Пустой синий контейнер. Поставь поперёк выезда.", "The empty blue container. Put it across the exit."),
          hero("А эти?", "And those?"),
          kenji("Две белые платформы — к ангару. Жёлтые крепления уже готовы.", "The two white platforms, to the hangar. The yellow lifting points are ready."),
          hero("Полный подъём нужен?", "Do I need to lift all the way?"),
          kenji("Нет. Подними над препятствием и веди сразу.", "No. Lift it over whatever's in the way and take it straight there."),
          hero("Понял. Поехали.", "Got it. Here we go."),
        ),
        flag("workers_safe"),
      ],
    },
    {
      // S07: the crane.
      id: "crane",
      goal: t("Перекройте выезд синим контейнером и верните обе платформы на жёлтую площадку у ангара", "Block the exit with the blue container and bring both platforms back to the yellow pad by the hangar"),
      hint: t(
        "W/S — вдоль рельсов, A/D — поперёк, R/F — крюк вверх/вниз, Пробел — взять/отпустить груз",
        "W/S along the rails, A/D across, R/F hook up/down, Space to take or let go of a load",
      ),
      objective: { kind: "flag", flag: "m03_crane_done" },
      presence: PEOPLE,
      bed: YARD_BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "lg4:cab" },
      onStart: [{ do: "freeze", on: true }, flag("crane")],
      onComplete: [
        flag("crane", true),
        { do: "freeze", on: false },
        { do: "put", at: "lg4:tower-foot" },
        lines(kenji("Обе на месте. Хватит, спускайся.", "Both in place. That's enough, come down.")),
      ],
    },
    {
      // S08: down among his own handiwork; the yard cleared, the side exit opened.
      id: "yard",
      goal: t("Откройте боковой выезд для цистерны", "Open the side exit for the tanker"),
      hint: t("Ворота у лестничной башни; охране не обязательно погибать — отступившие уходят", "The gate by the stair tower; the guards needn't all die — those who fall back leave"),
      objective: { kind: "use", id: "lg4-side-gate" },
      marker: "lg4:side-gate",
      presence: PEOPLE,
      bed: YARD_BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "lg4:tower-foot" },
      onStart: [
        lines(hero("Снизу это выглядит хуже.", "It looks worse from down here."), kenji("Зато выезд теперь точно закрыт.", "But the exit's shut for good now."), kenji("Боковые ворота у лестницы. Нам туда цистерну провести.", "The side gate by the stairs. That's where we take the tanker."), hero("Да, вижу.", "Yes, I see it.")),
        { do: "alarm", squad: "yard", at: "lg4:side-gate", combat: true },
      ],
      onComplete: [
        flag("yard_secured"),
        flag("side_exit_open"),
        lines(
          say("security-lead", "Отходим! Через северную тропу!", "Fall back! By the north path!"),
          hero("Пусть уходят.", "Let them go."),
          kenji("Дарья, готовь машину.", "Daria, get the truck ready."),
          say("daria", "Двигатель уже работает.", "The engine's running already.", "radio"),
          hero("У вас тут все готовы раньше меня.", "Everyone here's ready before me."),
          kenji("Они эту станцию знают лучше нас.", "They know this station better than we do."),
          say("asha", "В проходе чисто. Можно идти.", "The passage is clear. We can go.", "radio"),
          hero("Дальше что?", "What now?"),
          kenji("Вода. Ради неё всё и было.", "The water. That's what it was all for."),
        ),
        ...LG4_GUARDS.map((id): Effect => ({ do: "actor", id, remove: true })),
      ],
    },
    {
      // S09: the clean reserve.
      id: "reserve",
      goal: t("Помогите подключить рукав цистерны к резерву", "Help connect the tanker's hose to the reserve"),
      objective: { kind: "use", id: "lg4-hose" },
      marker: "lg4:reserve",
      presence: [...ISLAND, { kind: "actors", ids: ["kenji-m03", ...SC_PEOPLE, ...LG4_PEOPLE] }],
      bed: YARD_BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "lg4:tower-foot" },
      onStart: [
        { do: "actor", id: "kenji-m03", put: "lg4:kenji-reserve" },
        { do: "actor", id: "daria", put: "lg4:daria-reserve" },
        { do: "actor", id: "luis-w", put: "lg4:luis-reserve" },
        { do: "actor", id: "asha", put: "lg4:asha-reserve" },
      ],
    },
    {
      id: "filling",
      objective: { kind: "listen" },
      presence: [...ISLAND, { kind: "actors", ids: ["kenji-m03", ...SC_PEOPLE, ...LG4_PEOPLE] }],
      bed: YARD_BED,
      onStart: [
        { do: "cutscene", scene: "m03-reserve" },
        lines(
          say("daria", "Рукав готов. Уходим через южные ворота.", "The hose is ready. We go out by the south gate."),
          kenji("Резерв в порядке. Можно выдавать.", "The reserve's fine. We can hand it out."),
          hero("Деревне надолго хватит?", "Will it last the village long?"),
          kenji("На первое время. Дальше наладим доставку, пока источник не проверят снова.", "For now. Then we'll set up deliveries until the source is tested again."),
          hero("То есть краном я проблему с водой не решил?", "So I didn't solve the water problem with the crane?"),
          kenji("Вывоз решил. Это уже немало.", "You solved them taking it away. That's no small thing."),
          say("luis-w", "Модули поставим обратно. С людьми только надо договориться.", "We'll put the modules back. We just need to sort it out with the people."),
          kenji("Я останусь помогать. Сегодня хотя бы запустим подготовку.", "I'll stay and help. Today at least we'll get started."),
          say("luis-w", "Ты сначала в деревню съезди. Они тебя ждут.", "Go to the village first. They're waiting for you."),
          hero("Поедем. Скажешь им сам.", "Let's go. You tell them yourself."),
          say("daria", "Садитесь. Тут недалеко.", "Get in. It's not far."),
          hero("В этот раз за рулём не я.", "This time I'm not the one driving."),
        ),
      ],
      onComplete: [{ do: "cut" }, flag("clean_water_released"), flag("modules_saved"), { do: "fade", seconds: 2.5 }],
    },
    {
      // S10: the village gets its water.
      id: "home",
      objective: { kind: "listen" },
      presence: [...ISLAND, { kind: "actors", ids: ["kenji-m03", ...SC_PEOPLE, "daria"] }],
      bed: BED,
      checkpoint: { yacht: "sc:berth", skipper: "ashore", spot: "sc:hero" },
      onStart: [
        { do: "wake" },
        { do: "put", at: "sc:arrive" },
        { do: "actor", id: "kenji-m03", put: "sc:kenji" },
        { do: "actor", id: "daria", put: "sc:tanker-stop" },
        { do: "cutscene", scene: "m03-home" },
        lines(
          say("ines", "Вернулись. Воду привезли?", "You're back. Did you bring the water?"),
          say("daria", "Привезли. Поставьте пустые сюда, по одной.", "We did. Put the empty ones here, one at a time."),
          say("tiago", "К старому крану можно?", "Can we use the old tap?"),
          kenji("Пока нет. Только отсюда. Я потом скажу, когда можно будет.", "Not yet. Only from here. I'll tell you when it's all right."),
          say("ines", "Поняла. Людям объясню.", "Understood. I'll explain to people."),
          hero("На станции охраны больше нет. По крайней мере сейчас.", "There's no more security at the station. For now, at least."),
          kenji("Рабочие вернут оборудование. С подачей разберёмся, но не за вечер.", "The workers will put the equipment back. We'll sort out the supply, but not in one evening."),
          say("ines", "Не за вечер — ладно. Лишь бы теперь кто-нибудь действительно занимался.", "Not in one evening, fine. As long as somebody really sees to it now."),
          kenji("Буду заниматься.", "I'll see to it."),
          say("ines", "Тогда поешьте сначала.", "Then eat something first."),
          hero("Это я поддерживаю.", "I'm all for that."),
          kenji("Спасибо. Один я бы туда сегодня не попал.", "Thank you. I wouldn't have got in there today on my own."),
          hero("А я бы не понял, что там оставлять целым.", "And I wouldn't have known what to leave in one piece."),
          kenji("Ну, не всё получилось.", "Well, not everything worked out."),
          hero("Нужное осталось. Ты проверял.", "What mattered is still there. You checked."),
          kenji("Проверял. Лодку потом пригони — посмотрю, что с ней можно сделать.", "I did. Bring your boat round later, I'll see what can be done with it."),
        ),
      ],
      onComplete: [{ do: "cut" }],
    },
  ],
  triggers: [
    // S01: Inés at the tap as he comes up.
    {
      id: "tap-ines",
      when: { steps: ["tap"], near: { at: "sc:kenji", radius: 9 }, quiet: true },
      do: [lines(say("ines", "Нет, из этого не наливай. Кендзи перекрыл.", "No, don't fill up from that. Kenji shut it off."), hero("Из-за станции?", "Because of the station?"), kenji("Пока точно знаю одно: эту воду пить нельзя.", "For now I know one thing for sure: that water isn't fit to drink."), say("ines", "Чистая ещё есть. На сегодня.", "There's still clean water. For today."))],
    },
    // S03: the gate or the service path.
    {
      id: "gate-talk",
      when: { steps: ["entry"], near: { at: "lg4:gate", radius: 9 }, not: ["alert:combat"], quiet: true },
      do: [
        lines(
          say("s01", "Эй. Стой у ворот.", "Hey. Stop at the gate."),
          hero("Нам к начальнику смены.", "We need the shift lead."),
          say("s01", "Здесь выгрузка закончена. Назад.", "Unloading's finished here. Back off."),
          kenji("Он меня знает. Позови Луиса.", "He knows me. Call Luis."),
          say("s01", "Я сказал — назад!", "I said back off!"),
        ),
        flag("entry_front"),
      ],
    },
    {
      id: "service-talk",
      when: { steps: ["entry"], near: { at: "lg4:service", radius: 8 }, not: ["alert:combat"], quiet: true },
      do: [lines(kenji("Справа дверь. Уведу их взгляд — пройди вдоль стены.", "There's a door on the right. I'll draw their eyes — go along the wall."), hero("Вижу. Не выходи пока.", "I see it. Don't come out yet.")), flag("entry_service")],
    },
    { id: "entry-fight", when: { steps: ["entry"], alert: "combat", quiet: true }, do: [lines(kenji("Я за стеной. Иди, прикроюсь здесь.", "I'm behind the wall. Go, I'll take cover here."))] },
    { id: "gallery-fight", when: { steps: ["gallery"], alert: "combat", stepTime: 3, quiet: true }, do: [lines(hero("Не лезь на дорожку. Сверху смотрят.", "Stay off the walkway. They're watching from above."))] },
    // S06: the stair tower under fire.
    { id: "tower-fire", when: { steps: ["tower"], alert: "combat", quiet: true }, do: [lines(hero("С площадки меня держат!", "They've got me pinned from the platform!"), kenji("Нижний пролёт закрыт металлом. Через него!", "The lower flight's plated with steel. Go up through it!"))] },
    // S07: the crane's moments.
    { id: "cr-first", when: { steps: ["crane"], event: "crane:first-motion" }, do: [lines(hero("О, вот теперь чувствуется.", "Oh, now you can feel it."))] },
    { id: "cr-hint", when: { steps: ["crane"], stepTime: 40, not: ["exit_blocked"], quiet: true }, do: [lines(kenji("Не отпускай ход. Подъём работает вместе с ним.", "Don't let go of the travel. The hoist works at the same time."))] },
    { id: "cr-take", when: { steps: ["crane"], event: "crane:taken:c1" }, do: [lines(say("security-lead", "Отвести машину! Он нам выезд закроет!", "Move the truck! He's going to block our exit!"))] },
    { id: "cr-exit", when: { steps: ["crane"], event: "crane:c1:exit" }, do: [flag("exit_blocked"), lines(hero("Поздно.", "Too late."), kenji("Хорошо. Теперь белую платформу.", "Good. Now the white platform."))] },
    { id: "cr-exit2", when: { steps: ["crane"], event: "crane:c2:exit" }, do: [flag("exit_blocked"), lines(hero("Поздно.", "Too late."))] },
    { id: "cr-heavy", when: { steps: ["crane"], event: "crane:taken:p1" }, do: [lines(hero("Блядь, как её повело!", "Fuck, look how it swings!"), kenji("Сбавь. Она тяжёлая, не остановится сразу.", "Slow down. It's heavy, it won't stop at once."))] },
    { id: "cr-p1", when: { steps: ["crane"], event: "crane:p1:hangar" }, do: [flag("p1_safe"), lines(hero("Первую вернул.", "Got the first one back."), kenji("Вижу. Вторая под навесом, справа.", "I see. The second's under the awning, on the right."))] },
    { id: "cr-done", when: { steps: ["crane"], flags: ["exit_blocked", "p1_safe", "p2_safe"] }, do: [flag("m03_crane_done")] },
    { id: "cr-p2", when: { steps: ["crane"], event: "crane:p2:hangar" }, do: [flag("p2_safe"), lines(hero("Эту тоже.", "That one too."))] },
    {
      id: "cr-reserve",
      when: { steps: ["crane"], stepTime: 75 },
      do: [
        lines(say("luis-w", "С северных ворот ещё машина!", "Another truck at the north gate!", "radio"), kenji("Закрой им обзор. Пустой контейнер у тебя рядом.", "Block their view. You've got an empty container right there.")),
        ...["s19", "s20", "s21", "s22", "s23", "s24"].map((id): Effect => ({ do: "actor", id, to: `lg4:${id}-yard`, pace: "run" })),
      ],
    },
    // S08: the last of the fight.
    { id: "yard-two", when: { steps: ["yard"], stepTime: 12, alert: "combat", quiet: true }, do: [lines(hero("Справа ещё двое. В ангар не выходите.", "Two more on the right. Don't come out of the hangar."), say("luis-w", "Сидим. Дверь держим.", "We're staying put. Holding the door.", "radio"))] },
    // S09: the sign.
    { id: "sign", when: { steps: ["filling"], stepTime: 40, quiet: true }, do: [lines(say("asha", "А это куда?", "And where does this go?"), kenji("Пока в ящик. Не выбрасывай.", "In a crate for now. Don't throw it away."), hero("Думаешь, пригодится?", "You think it'll come in handy?"), kenji("Думаю, документы лучше не терять.", "I think documents are better not lost."))] },
  ],
  uses: [
    {
      id: "sc-kenji",
      label: t("Поговорить с Кендзи", "Talk to Kenji"),
      when: { steps: ["tap"] },
      do: [
        lines(
          kenji("Кендзи Сато. Марк дал тебе координаты?", "Kenji Sato. Did Mark give you the coordinates?"),
          hero("Да. Сказал, ты умеешь чинить то, что другие уже списали.", "Yes. Said you can fix what others have written off."),
          kenji("Сначала посмотрим, что там осталось.", "First let's see what's left out there."),
          hero("Ты уже ходил на станцию?", "Have you been to the station already?"),
          kenji("Ходил. С охраной разговор не получился.", "I have. The talk with security didn't go well."),
          hero("А сейчас получится?", "And will it now?"),
          kenji("Сейчас я возьму тебя.", "Now I'm taking you."),
          say("ines", "Только не разнесите её. Нам оттуда ещё воду брать.", "Just don't wreck it. We still need water from there."),
          kenji("Именно поэтому и идём.", "That's exactly why we're going."),
          hero("Что нужно сделать?", "What needs doing?"),
          kenji("Остановить сброс. И открыть чистый резерв, если они его не трогали.", "Stop the discharge. And open the clean reserve, if they haven't touched it."),
        ),
      ],
    },
    { id: "sc-tap", label: t("Осмотреть кран", "Look at the tap"), when: { steps: ["tap", "path"] }, once: true, do: [{ do: "sfx", clip: "m01/sfx/FX095_metal_holding_cell", volume: 0.4 }, lines(hero("Сухо. И табличка: «Не пить».", "Dry. And a sign: 'Do not drink'."))] },
    { id: "lg4-service-gate", label: t("Открыть сервисную калитку", "Open the service gate"), when: { steps: ["entry"] }, once: true, do: [{ do: "switch", name: "lg4:service-gate", value: "open" }, lines(kenji("Калитку открыл. Слева от тебя.", "The gate's open. On your left."), hero("Есть. Перебегай.", "Right. Run across."))] },
    { id: "lg4-order", label: t("Взять приказ демонтажа", "Take the dismantling order"), when: { steps: ["tech", "gallery", "discharge"] }, once: true, do: [{ do: "sfx", clip: "m01/sfx/FX093_document_folder_open", volume: 0.8 }, flag("m03_order_taken"), lines(hero("«Демонтаж и вывоз оборудования. Подача — без изменений до окончания работ». Хорошо.", "'Dismantle and remove the equipment. Supply unchanged until the work is complete.' Nice."))] },
    { id: "lg4-cab", label: t("Сесть за управление краном", "Take the crane's controls"), when: { steps: ["tower"] } },
    { id: "lg4-side-gate", label: t("Открыть боковой выезд", "Open the side exit"), when: { steps: ["yard"] }, seconds: 1.5 },
    { id: "lg4-hose", label: t("Помочь подключить рукав", "Help connect the hose"), when: { steps: ["reserve"] }, seconds: 2 },
  ],
  onComplete: [
    { do: "time", hour: 13.4 },
    flag("m03_completed"),
    flag("kenji_arc_available"),
    { do: "pay", coins: 650 },
    { do: "title", style: "end", title: t("Миссия выполнена", "Mission complete"), subtitle: t("Мёртвая вода", "Dead Water") },
  ],
};
