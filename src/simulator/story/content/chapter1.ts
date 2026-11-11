import type { Mission } from "../StoryTypes";

/**
 * Chapter 1, "Dead Tide" (docs/campaign/campaign.md): the yacht raised off
 * the reef by the old light, the run to Sato's hideout, the first drone
 * blinded and taken apart, the engine brought back to life. "The Rusty
 * Spire" is planned.
 */

const STRANDED: Mission = {
  id: "stranded",
  chapter: "chapter-1",
  title: { ru: "На мели", en: "Aground" },
  brief: {
    ru: "Яхта не на дне, а на рифе у маяка: пробоина, мачта сломана, мотор мёртв. Поднять её — и до схрона Сато можно дойти по воде.",
    en: "The yacht is not on the bottom but on the reef by the light: holed, dismasted, the engine dead. Raise her, and Sato's hideout is a sail away.",
  },
  giver: "holloway",
  sector: "dead-tide",
  requires: ["prologue"],
  status: "playable",
  steps: [
    {
      id: "look",
      objective: { kind: "listen" },
      presence: [{ kind: "npc", character: "holloway", at: "light-ambush", face: "wash-up", kit: "armed" }],
      onStart: [
        {
          do: "say",
          lines: [
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Стой. Глянь-ка с обрыва… Я соврал: твоя посудина не на дне. Сидит на рифе, вода по пояс, но корпус цел.",
                en: "Hold on. Look down there… I lied: your tub's not on the bottom. She's sitting on the reef, waist-deep in water, but the hull's in one piece.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Залатаешь — дойдём до Сато по воде, а не вплавь. Я вперёд, на своём «Зодиаке». Буду на связи.",
                en: "Patch her up and we go to Sato's by water, not swimming. I'll go ahead in my Zodiac. I'll be on the radio.",
              },
            },
          ],
        },
      ],
    },
    {
      id: "wade",
      goal: { ru: "Доберитесь до яхты", en: "Get out to the yacht" },
      hint: { ru: "Вброд или вплавь, затем «Подняться на борт»", en: "Wade or swim out, then climb aboard" },
      objective: { kind: "aboard" },
      marker: "@yacht",
      checkpoint: { yacht: "wash-up", skipper: "ashore" },
    },
    {
      id: "inspect",
      objective: { kind: "listen" },
      onStart: [
        {
          do: "say",
          lines: [
            {
              who: "hero",
              via: "voice",
              text: {
                ru: "Пробоина в корме. Мачта переломлена, от паруса — лохмотья. Двигатель мёртв: блок управления выгорел подчистую.",
                en: "Holed in the stern. The mast's snapped, the sail's in rags. The engine's dead: the control unit's burnt clean out.",
              },
            },
            {
              who: "holloway",
              via: "radio",
              text: {
                ru: "Турист, слышишь? Запомни сразу: эти твари слышат дизель за милю и чуют выхлоп. А парус почти не видят — их учили на винтах.",
                en: "Tourist, you hear me? Learn this now: those things hear a diesel a mile off and smell the exhaust. A sail they barely see — they were trained on propellers.",
              },
            },
          ],
        },
      ],
    },
    {
      id: "kit",
      goal: { ru: "Достаньте ремкомплект с затонувшего «Зодиака»", en: "Recover the repair kit from the sunken Zodiac" },
      hint: { ru: "Прыгайте за борт и ныряйте у отметки", en: "Go over the side and dive at the marker" },
      objective: { kind: "collect", item: "repair-kit" },
      marker: "sunken-zodiac",
      presence: [{ kind: "item", item: "repair-kit", at: "sunken-zodiac", where: "seabed" }],
      onStart: [
        {
          do: "say",
          lines: [
            {
              who: "holloway",
              via: "radio",
              text: {
                ru: "Мародёры вчера утопили «Зодиак» в кабельтове к востоку от маяка. Ремкомплект у них был, я видел. Там неглубоко, метров восемь.",
                en: "Raiders sank a Zodiac a cable east of the light yesterday. They had a repair kit, I saw it. It's shallow there, eight metres or so.",
              },
            },
          ],
        },
      ],
    },
    {
      id: "patch",
      goal: { ru: "Залатайте пробоину", en: "Patch the hull" },
      hint: { ru: "На борту нажмите E (или кнопку «Залатать пробоину»)", en: "Aboard, press E (or the patch button)" },
      objective: { kind: "repair", seconds: 4 },
      marker: "@yacht",
      onComplete: [
        { do: "take", item: "repair-kit" },
        { do: "repair", hull: 0.7 },
        { do: "say", lines: [{ who: "hero", via: "thought", text: { ru: "Держит. Не сухо, но держит.", en: "Holding. Not dry, but holding." } }] },
      ],
    },
    {
      id: "jury-rig",
      goal: { ru: "Поставьте аварийную мачту из обломков", en: "Jury-rig a mast from the wreckage" },
      hint: { ru: "На борту нажмите E: обломок мачты и запасной стаксель", en: "Aboard, press E: the stump of the mast and the spare jib" },
      objective: { kind: "repair", seconds: 6 },
      marker: "@yacht",
      onComplete: [
        { do: "rig", broken: false },
        {
          do: "say",
          lines: [
            {
              who: "hero",
              via: "thought",
              text: { ru: "Не мачта — палка с тряпкой. Но ветер она поймает.", en: "Not a mast — a stick with a rag on it. But it'll catch the wind." },
            },
          ],
        },
      ],
    },
  ],
  onComplete: [
    {
      do: "say",
      lines: [
        {
          who: "holloway",
          via: "radio",
          text: {
            ru: "Слышу, не тонешь. Схрон — на пирсе, на северо-запад от маяка. Иди под парусом, турист, мотор всё равно мёртв.",
            en: "Sounds like you're not sinking. The hideout's on a pier, north-west of the light. Come under sail, tourist — the engine's dead anyway.",
          },
        },
      ],
    },
  ],
};

const HIDEOUT: Mission = {
  id: "black",
  chapter: "chapter-1",
  title: { ru: "Схрон Сато", en: "Sato's Hideout" },
  brief: {
    ru: "Холлоуэй ждёт в схроне старика Сато, на пирсе к северо-западу. Дойти туда под парусом.",
    en: "Holloway waits at old Sato's hideout, on a pier to the north-west. Get there under sail.",
  },
  giver: "holloway",
  sector: "dead-tide",
  requires: ["stranded"],
  status: "playable",
  steps: [
    {
      id: "sail",
      goal: { ru: "Под парусом идите к схрону Сато", en: "Sail to Sato's hideout" },
      hint: { ru: "Двигатель не работает: ловите ветер парусом", en: "The engine is dead: let the sail find the wind" },
      objective: { kind: "reach", at: "sato-hideout", by: "yacht" },
      checkpoint: { yacht: "wash-up", skipper: "helm" },
      presence: [
        {
          kind: "drones",
          group: { id: "demo-patrol", at: "pale-banks", count: 1, behaviour: "pass", line: [[-5000, -4700], [-6600, -3300]] },
        },
      ],
      onStart: [
        {
          do: "say",
          lines: [
            {
              who: "holloway",
              via: "radio",
              text: { ru: "Видишь катер на горизонте? Их патруль. Не дёргайся.", en: "See that boat on the horizon? Their patrol. Easy now." },
            },
            {
              who: "holloway",
              via: "radio",
              text: { ru: "Идёшь под парусом — для него ты кусок плавника.", en: "Under sail you're a lump of driftwood to it." },
            },
          ],
        },
      ],
    },
    {
      id: "ashore",
      goal: { ru: "Сойдите на берег у схрона", en: "Go ashore at the hideout" },
      hint: { ru: "Отойдите от штурвала и прыгайте за борт", en: "Leave the helm and go over the side" },
      objective: { kind: "reach", at: "sato-hideout", by: "foot", radius: 40 },
      checkpoint: { yacht: "sato-hideout", skipper: "helm" },
    },
    {
      id: "talk",
      goal: { ru: "Поговорите с Холлоуэем", en: "Talk to Holloway" },
      objective: { kind: "talk", character: "holloway" },
      marker: "sato-hideout",
      onComplete: [
        {
          do: "say",
          lines: [
            {
              who: "holloway",
              via: "voice",
              text: { ru: "Доплыл, турист. Живой, мокрый и злой — люблю это сочетание.", en: "Made it, tourist. Alive, wet and angry — my favourite combination." },
            },
            { who: "hero", via: "voice", text: { ru: "Что здесь творится, Блэк?", en: "What's going on here, Black?" } },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "«Вангард Навал» купил эти острова под полигон. Их игрушка — «Аквилон»: катера, торпеды, турели, и всё думает одной головой.",
                en: "Vanguard Naval bought these islands for a proving ground. Their toy's called Aquilon: boats, torpedoes, turrets, all thinking with one head.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Вчера кто-то свернул этой голове шею. Теперь она стреляет во всё, что движется, а корпорация шлёт чистильщиков — прибрать свидетелей. То есть нас.",
                en: "Yesterday somebody wrung that head's neck. Now it shoots anything that moves, and the corporation's sending cleaners to tidy up the witnesses. That's us.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Сато колдует над своими кабелями, ему не до гостей. Дело к тебе: дизель твой я подниму, но нужен блок наведения от дрона — там та же начинка, что в твоём сгоревшем блоке.",
                en: "Sato's busy with his cables, no time for guests. Business: I can raise your diesel, but I need a guidance unit off a drone — same guts as your burnt control box.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Пистолетом дрон не ослепишь. Держи винтовку. Купол на макушке — его глаза: три пули в купол, и он слепой котёнок. По корпусу не трать — броня.",
                en: "You won't blind a drone with a pistol. Take this rifle. That dome on top is its eyes: three rounds in the dome and it's a blind kitten. Don't waste lead on the hull — it's armoured.",
              },
            },
          ],
        },
        { do: "give", what: "rifle" },
      ],
    },
  ],
  onComplete: [
    {
      do: "say",
      lines: [
        {
          who: "holloway",
          via: "voice",
          text: {
            ru: "Патруль ходит у Сломанной гряды, к востоку отсюда. Принеси мне его целым.",
            en: "There's a patrol working Broken Ridge, east of here. Bring it back in one piece.",
          },
        },
      ],
    },
  ],
};

const EYES: Mission = {
  id: "eyes",
  chapter: "chapter-1",
  title: { ru: "Глаза «Аквилона»", en: "Aquilon's Eyes" },
  brief: {
    ru: "Холлоуэю нужен блок наведения. Его носит патрульный дрон у Сломанной гряды — нужно ослепить дрон и разобрать.",
    en: "Holloway needs a guidance unit. A patrol drone at Broken Ridge carries one — blind it and take it apart.",
  },
  giver: "holloway",
  sector: "dead-tide",
  requires: ["black"],
  status: "playable",
  presence: [{ kind: "drones", group: { id: "ridge-patrol", at: "broken-ridge", count: 1, behaviour: "patrol", beat: 300 } }],
  steps: [
    {
      id: "find",
      goal: { ru: "Найдите патрульный дрон у Сломанной гряды", en: "Find the patrol drone at Broken Ridge" },
      hint: { ru: "Под парусом вы заметите его раньше, чем он вас", en: "Under sail you'll see it before it sees you" },
      objective: { kind: "reach", at: "broken-ridge", by: "any" },
      checkpoint: { yacht: "sato-hideout", skipper: "helm" },
    },
    {
      id: "blind",
      goal: { ru: "Ослепите дрон: стреляйте в купол сенсора", en: "Blind the drone: shoot its sensor dome" },
      hint: { ru: "1 — винтовка, щелчок или касание по цели — выстрел. Корпус бронирован", en: "1 draws the rifle; click or tap the target to fire. The hull is armoured" },
      objective: {
        kind: "disable",
        group: "ridge-patrol",
        onLost: [
          {
            do: "say",
            lines: [
              {
                who: "holloway",
                via: "radio",
                text: {
                  ru: "Ты его в решето? Мне нужна начинка, а не металлолом! Ладно, там ещё один крутится. Целься в купол.",
                  en: "You shot it to scrap? I need the guts, not a colander! Fine, there's another one about. Aim for the dome.",
                },
              },
            ],
          },
        ],
      },
      marker: "@drone:ridge-patrol",
    },
    {
      id: "salvage",
      goal: { ru: "Подтяните дрон лебёдкой", en: "Winch the drone alongside" },
      hint: { ru: "Подойдите вплотную и нажмите E (или кнопку «Подтянуть лебёдкой»)", en: "Come alongside and press E (or the winch button)" },
      objective: { kind: "salvage", group: "ridge-patrol" },
      marker: "@drone:ridge-patrol",
      onComplete: [
        { do: "give", what: "guidance-unit" },
        { do: "give", what: "lis-battery" },
      ],
    },
  ],
  onComplete: [
    {
      do: "say",
      lines: [
        {
          who: "holloway",
          via: "radio",
          text: { ru: "Слышу, ты его разобрал. Ювелирно. Возвращайся.", en: "Heard you took it apart. Neat work. Come on back." },
        },
      ],
    },
  ],
};

const HEART: Mission = {
  id: "heart",
  chapter: "chapter-1",
  title: { ru: "Новое сердце", en: "A New Heart" },
  brief: {
    ru: "Отвезти Холлоуэю блок наведения, чтобы двигатель снова заработал.",
    en: "Bring Holloway the guidance unit so the engine can run again.",
  },
  giver: "holloway",
  sector: "dead-tide",
  requires: ["eyes"],
  status: "playable",
  steps: [
    {
      id: "return",
      goal: { ru: "Вернитесь в схрон Сато", en: "Return to Sato's hideout" },
      objective: { kind: "reach", at: "sato-hideout", by: "foot", radius: 40 },
      checkpoint: { yacht: "sato-hideout", skipper: "helm" },
    },
    {
      id: "deliver",
      goal: { ru: "Отдайте Блэку блок наведения", en: "Give Black the guidance unit" },
      objective: { kind: "talk", character: "holloway" },
      marker: "sato-hideout",
      onComplete: [
        { do: "take", item: "guidance-unit" },
        {
          do: "say",
          lines: [
            {
              who: "holloway",
              via: "voice",
              text: { ru: "Вот это я понимаю — целёхонький. Дай мне двадцать минут.", en: "Now that's what I call intact. Give me twenty minutes." },
            },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Готово. Дизель снова дышит, пробоину я заварил как следует. Но заведёшь мотор — тебя услышит каждый дрон в секторе.",
                en: "Done. Your diesel's breathing again, and I welded that hole properly. But fire it up and every drone in the sector hears you.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: { ru: "Мотор — чтобы удрать. Парус — чтобы охотиться.", en: "Engine's for running. Sail's for hunting." },
            },
          ],
        },
        { do: "repair", hull: 1, engine: true },
      ],
    },
    {
      id: "vector",
      objective: { kind: "listen" },
      onStart: [
        {
          do: "say",
          lines: [
            {
              who: "sara",
              via: "radio",
              text: {
                ru: "…судно у схрона Сато, говорит Вектор. Не отвечайте. Просто слушайте.",
                en: "…vessel at Sato's hideout, this is Vector. Don't answer. Just listen.",
              },
            },
            {
              who: "sara",
              via: "radio",
              text: {
                ru: "Вы ослепили их дрон и разобрали его. «Аквилон» это заметил. Заметила и я.",
                en: "You blinded one of their drones and took it apart. Aquilon noticed. So did I.",
              },
            },
            {
              who: "sara",
              via: "radio",
              text: {
                ru: "Чистильщики высаживаются завтра. Хотите дожить до послезавтра — нам нужно поговорить. Не на этой частоте.",
                en: "The cleaners land tomorrow. If you want to see the day after, we need to talk. Not on this frequency.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: { ru: "Вектор… Значит, Дженкинс жива. Это меняет дело.", en: "Vector… So Jenkins is alive. That changes things." },
            },
          ],
        },
      ],
    },
  ],
  onComplete: [
    {
      do: "title",
      style: "end",
      title: { ru: "Конец главы 1", en: "End of Chapter 1" },
      subtitle: { ru: "Продолжение следует: «Ржавый шпиль»", en: "To be continued: The Rusty Spire" },
    },
  ],
};

const RUSTY_SPIRE: Mission = {
  id: "rusty-spire",
  chapter: "chapter-1",
  title: { ru: "Ржавый шпиль", en: "The Rusty Spire" },
  brief: {
    ru: "Мародёры Скрапа засели на полузатопленной буровой «Аванпост-12». Подняться по техническим лестницам, перехватить лебёдочный кран и повернуть турели сектора против их хозяев.",
    en: "Scrap's raiders hold the half-sunk rig of Outpost 12. Climb the service ladders, take the winch crane, and turn the sector's turrets on their masters.",
  },
  giver: "holloway",
  sector: "dead-tide",
  requires: ["heart"],
  status: "planned",
  steps: [
    {
      id: "spire",
      goal: { ru: "Возьмите «Ржавый шпиль»", en: "Take the Rusty Spire" },
      objective: { kind: "reach", at: "rusty-spire", by: "any" },
    },
  ],
};

export const CHAPTER_1: readonly Mission[] = [STRANDED, HIDEOUT, EYES, HEART, RUSTY_SPIRE];
