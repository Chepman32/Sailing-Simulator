import type { Mission } from "../StoryTypes";

/**
 * Chapter 1, "Dead Tide" (docs/campaign/campaign.md): stranded on the
 * reef belt, the first ally, the first drone blinded and taken apart, the
 * engine brought back to life. "The Rusty Spire" is planned.
 */

const STRANDED: Mission = {
  id: "stranded",
  chapter: "chapter-1",
  title: { ru: "На мели", en: "Aground" },
  brief: {
    ru: "Яхта сидит на Отмели Утопленника с пробоиной ниже ватерлинии. Сначала — снова держаться на воде.",
    en: "The yacht sits on Drowned Man's Shoal, holed below the waterline. First, stay afloat.",
  },
  sector: "dead-tide",
  requires: ["prologue"],
  status: "playable",
  steps: [
    {
      id: "wake",
      goal: { ru: "Доберитесь до яхты", en: "Get back to the yacht" },
      hint: { ru: "Вброд или вплавь, затем «Подняться на борт»", en: "Wade or swim out, then climb aboard" },
      objective: { kind: "aboard" },
      marker: "@yacht",
      checkpoint: { yacht: "drowned-shoal", skipper: "ashore" },
      onStart: [
        {
          do: "say",
          lines: [
            { who: "hero", via: "thought", text: { ru: "Жив. В голове звон, во рту соль.", en: "Alive. Ears ringing, mouth full of salt." } },
            {
              who: "hero",
              via: "thought",
              text: { ru: "Яхта… вон она. Сидит на мели, но на плаву.", en: "The yacht… there she is. Hard on the shoal, but afloat." },
            },
          ],
        },
      ],
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
                ru: "Пробоина ниже ватерлинии. Двигатель мёртв: блок управления выгорел подчистую.",
                en: "Holed below the waterline. Engine's dead: the control unit's burnt clean out.",
              },
            },
            {
              who: "holloway",
              via: "radio",
              text: {
                ru: "…ем, кто на яхте у Отмели Утопленника. Живой? Отзовись.",
                en: "…anyone on that yacht at Drowned Man's Shoal. You alive? Talk to me.",
              },
            },
            { who: "hero", via: "radio", text: { ru: "Живой. Кто это?", en: "Alive. Who's this?" } },
            {
              who: "holloway",
              via: "radio",
              text: { ru: "Тот, кто видел, как тебя разделали. Зови меня Блэк.", en: "Someone who watched them carve you up. Call me Black." },
            },
            {
              who: "holloway",
              via: "radio",
              text: {
                ru: "Слушай внимательно. Эти твари слышат дизель за милю и чуют выхлоп. Мотор — только когда без него никак.",
                en: "Listen up. Those things hear a diesel a mile off and smell the exhaust. Engine only when you've no other choice.",
              },
            },
            {
              who: "holloway",
              via: "radio",
              text: {
                ru: "А парус они почти не видят. Их учили на винтах. Парусник для них — плавник.",
                en: "A sail, though, they barely see. They were trained on propellers. A sailboat's driftwood to them.",
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
                ru: "Залатаешь пробоину — уже человек. Вчера мародёры утопили «Зодиак» в кабельтове к востоку от тебя. Ремкомплект у них был, я видел.",
                en: "Patch that hole and you're in business. Raiders sank a Zodiac a cable east of you yesterday. They had a repair kit aboard — I saw it.",
              },
            },
            { who: "holloway", via: "radio", text: { ru: "Там неглубоко. Метров десять.", en: "It's shallow there. Ten metres, give or take." } },
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
  ],
  onComplete: [
    {
      do: "say",
      lines: [
        {
          who: "holloway",
          via: "radio",
          text: {
            ru: "Слышу, не тонешь. Теперь ко мне: лагерь на пирсе, остров к северо-востоку от тебя. Под парусом.",
            en: "Sounds like you're not sinking. Now come to me: camp on the pier, the island north-east of you. Under sail.",
          },
        },
      ],
    },
  ],
};

const BLACK: Mission = {
  id: "black",
  chapter: "chapter-1",
  title: { ru: "Блэк", en: "Black" },
  brief: {
    ru: "Голос по радио знает, как устроены дроны. Его лагерь — на пирсе к северо-востоку.",
    en: "The voice on the radio knows how the drones work. His camp is on a pier to the north-east.",
  },
  giver: "holloway",
  sector: "dead-tide",
  requires: ["stranded"],
  status: "playable",
  steps: [
    {
      id: "sail",
      goal: { ru: "Под парусом идите к лагерю Блэка", en: "Sail to Black's camp" },
      hint: { ru: "Двигатель не работает: ловите ветер парусом", en: "The engine is dead: let the sail find the wind" },
      objective: { kind: "reach", at: "black-camp", by: "yacht" },
      checkpoint: { yacht: "drowned-shoal", skipper: "helm" },
      presence: [
        {
          kind: "drones",
          group: { id: "demo-patrol", at: "broken-ridge", count: 1, behaviour: "pass", line: [[-8000, -1500], [-9300, -2800]] },
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
      goal: { ru: "Сойдите на берег у лагеря", en: "Go ashore at the camp" },
      hint: { ru: "Отойдите от штурвала и прыгайте за борт", en: "Leave the helm and go over the side" },
      objective: { kind: "reach", at: "black-camp", by: "foot", radius: 40 },
      checkpoint: { yacht: "black-camp", skipper: "helm" },
    },
    {
      id: "talk",
      goal: { ru: "Поговорите с Холлоуэем", en: "Talk to Holloway" },
      objective: { kind: "talk", character: "holloway" },
      marker: "black-camp",
      onComplete: [
        {
          do: "say",
          lines: [
            {
              who: "holloway",
              via: "voice",
              text: { ru: "Гидрограф. Живой, мокрый и злой — люблю это сочетание.", en: "Hydrographer. Alive, wet and angry — my favourite combination." },
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
            { who: "hero", via: "voice", text: { ru: "А ты откуда всё это знаешь?", en: "And how would you know all that?" } },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Служил у них связистом. Пока мне не приказали открыть огонь по рыбацкой шхуне.",
                en: "I was their signals man. Till they ordered me to open fire on a fishing schooner.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Ладно, к делу. Дизель твой я подниму, но нужен блок наведения от дрона: там та же начинка, что в твоём сгоревшем блоке.",
                en: "Right, business. I can raise your diesel, but I need a guidance unit off a drone: same guts as your burnt control box.",
              },
            },
            {
              who: "holloway",
              via: "voice",
              text: {
                ru: "Держи винтовку. Купол на макушке у дрона — его глаза. Три пули в купол, и он слепой котёнок. По корпусу не трать: броня.",
                en: "Take this rifle. That dome on top is its eyes. Three rounds in the dome and it's a blind kitten. Don't waste lead on the hull: it's armoured.",
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
      checkpoint: { yacht: "black-camp", skipper: "helm" },
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
      goal: { ru: "Вернитесь в лагерь Блэка", en: "Return to Black's camp" },
      objective: { kind: "reach", at: "black-camp", by: "foot", radius: 40 },
      checkpoint: { yacht: "black-camp", skipper: "helm" },
    },
    {
      id: "deliver",
      goal: { ru: "Отдайте Блэку блок наведения", en: "Give Black the guidance unit" },
      objective: { kind: "talk", character: "holloway" },
      marker: "black-camp",
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
                ru: "…судно у лагеря Холлоуэя, говорит Вектор. Не отвечайте. Просто слушайте.",
                en: "…vessel at Holloway's camp, this is Vector. Don't answer. Just listen.",
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

export const CHAPTER_1: readonly Mission[] = [STRANDED, BLACK, EYES, HEART, RUSTY_SPIRE];
