import type { Mission } from "../StoryTypes";

/**
 * Prologue, "Quarantine" (docs/campaign/campaign.md). A routine charter run
 * into the islands, the network's broadcast, two interceptors, and a hit
 * the story will not let her escape.
 */
export const PROLOGUE: Mission = {
  id: "prologue",
  chapter: "prologue",
  title: { ru: "Карантин", en: "Quarantine" },
  brief: {
    ru: "Рейс с грузом на Северный рейд. Обычный рейс — до первого выхода в эфир «Аквилона».",
    en: "A cargo run to the North Roads. An ordinary run — until Aquilon comes on the air.",
  },
  sector: "open-wedge",
  requires: [],
  status: "playable",
  steps: [
    {
      id: "approach",
      goal: { ru: "Идите к Северному рейду", en: "Make for the North Roads" },
      objective: { kind: "wait", seconds: 22 },
      marker: "north-roads",
      onStart: [
        // An ordinary afternoon, under power, bound in.
        { do: "time", hour: 16.5 },
        { do: "weather", kind: "cloudy" },
        { do: "engine", running: true, throttle: 0.6 },
        { do: "title", style: "chapter", title: { ru: "Пролог", en: "Prologue" }, subtitle: { ru: "Карантин", en: "Quarantine" } },
        {
          do: "say",
          lines: [
            {
              who: "hero",
              via: "thought",
              text: {
                ru: "Рейс как рейс: двенадцать ящиков запчастей для чьей-то опреснительной станции и подпись в накладной. К закату — на Северном рейде.",
                en: "A run like any other: twelve crates of spares for somebody's desalination plant and a signature on the waybill. North Roads by sunset.",
              },
            },
            {
              who: "hero",
              via: "thought",
              text: {
                ru: "Странно только, что в эфире тишина. Обычно тут слова не вставишь.",
                en: "Odd, though: the radio's dead. Usually you can't get a word in round here.",
              },
            },
          ],
        },
      ],
    },
    {
      id: "broadcast",
      objective: { kind: "listen" },
      onStart: [
        {
          do: "say",
          lines: [
            {
              who: "aquilon",
              via: "broadcast",
              text: {
                ru: "Внимание. Действует режим карантина. Система «Аквилон» переведена в автономную оборону.",
                en: "Attention. Quarantine in effect. The Aquilon system is now in autonomous defence.",
              },
            },
            {
              who: "aquilon",
              via: "broadcast",
              text: {
                ru: "Любое движущееся судно в зоне является целью. Предупреждений не будет.",
                en: "Any vessel under way in the zone is a target. There will be no further warning.",
              },
            },
            {
              who: "unknown",
              via: "radio",
              text: {
                ru: "Мэйдэй, мэйдэй, мэйдэй! Рыбак «Каролина», по нам стреляют катера без людей, у нас раненые, мы…",
                en: "Mayday, mayday, mayday! Fishing boat Carolina, we're under fire from boats with nobody aboard, we've got wounded, we—",
              },
            },
            { who: "hero", via: "thought", text: { ru: "…Какой ещё карантин?", en: "…What quarantine?" } },
          ],
        },
      ],
    },
    {
      id: "intercept",
      goal: { ru: "Уходите к бурунам: на мелководье катерам не пройти", en: "Run for the breakers: their boats can't follow into the shallows" },
      hint: { ru: "Полный вперёд, руль на юг", en: "Full ahead, helm to the south" },
      objective: { kind: "hull", hull: 0.24, after: 80, at: "breakers" },
      marker: "breakers",
      presence: [{ kind: "drones", group: { id: "interceptors", at: "north-roads", count: 2, behaviour: "strike" } }],
      onStart: [
        {
          do: "say",
          lines: [
            { who: "hero", via: "voice", text: { ru: "Два катера. Без людей. Идут прямо на меня.", en: "Two boats. Nobody at the helm. Coming straight at me." } },
            {
              who: "hero",
              via: "voice",
              text: { ru: "Буруны на юге — там мель. Водомёты не пройдут.", en: "Breakers to the south — it's shoal water. Their jets won't follow." },
            },
          ],
        },
      ],
    },
    {
      id: "struck",
      objective: { kind: "wait", seconds: 3.2 },
      onStart: [
        { do: "blast", strength: 1 },
        { do: "damage", hull: 0.2, engine: true },
        { do: "fade", seconds: 3.2 },
      ],
    },
  ],
  onComplete: [
    { do: "place", yacht: "drowned-shoal", skipper: "ashore" },
    // Holed, but the tide set her on the shoal before she sank.
    { do: "repair", hull: 0.3 },
    { do: "time", hour: 6.4 },
    { do: "weather", kind: "overcast" },
    { do: "title", style: "chapter", title: { ru: "Глава 1", en: "Chapter 1" }, subtitle: { ru: "Мёртвый прилив", en: "Dead Tide" } },
  ],
};
