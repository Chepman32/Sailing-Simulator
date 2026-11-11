import type { LanguageCode } from "../i18n";
import type { StoryLanguage, Text } from "@/src/simulator/story/StoryTypes";

/**
 * The campaign's interface words (the story's own text lives with the
 * story, in `src/simulator/story/content`). Russian and English; every
 * other language reads the English.
 */

const EN = {
  campaign: "Campaign",
  campaignTag: "Aquilon",
  campaignLead: "A defence network gone rogue has closed the islands. Your sail is the one thing it can barely see.",
  continueCampaign: "Continue",
  newCampaign: "New campaign",
  newCampaignConfirm: "Start the campaign over? Progress is lost.",
  newCampaignYes: "Start over",
  freeSail: "Free sailing",
  freeSailLead: "The open sea as before: no story, no drones.",
  chooseTitle: "How will you sail?",
  campaignBadge: "Story",
  freeBadge: "Sandbox",
  journal: "Journal",
  journalChapters: "Chapters",
  journalCurrent: "Under way",
  journalDone: "Done",
  journalPlanned: "In development",
  journalItems: "Carried",
  journalSectors: "Sectors",
  journalEmpty: "Nothing yet.",
  objective: "Objective",
  distance: "{d}",
  metres: "{n} m",
  km: "{n} km",
  hull: "Hull",
  engine: "Engine",
  engineDead: "Engine out",
  engineBroken: "The engine is dead — sail on, or have it mended",
  hidden: "Unseen",
  suspicious: "Suspicion",
  spotted: "Spotted!",
  rifle: "Rifle",
  rifleDraw: "Rifle (1)",
  rifleDrawTouch: "Rifle",
  rifleAway: "Put away",
  reloading: "Reloading",
  hitDome: "Dome hit",
  hitBlind: "Blinded!",
  hitJet: "Jet hit",
  hitStopped: "Dead in the water",
  hitArmour: "Armour",
  hitWrecked: "Destroyed",
  talk: "Talk to {name}",
  repair: "Patch the hull",
  repairing: "Patching…",
  winch: "Winch it aboard",
  winching: "Winching…",
  skip: "Next",
  speakerHero: "Skipper",
  speakerAquilon: "Aquilon",
  speakerUnknown: "Unknown voice",
  viaRadio: "Radio",
  viaBroadcast: "All frequencies",
  viaThought: "Thinking",
  storyComplete: "The story so far is over. The reef belt is yours to hunt in until the next chapter.",
  sectorNeutral: "Neutral waters",
  chartSectors: "Sectors",
  chartQuarantine: "Quarantine line",
  close: "Close",
  journalKey: "Journal (L)",
};

export type StoryMessages = typeof EN;

const RU: StoryMessages = {
  campaign: "Кампания",
  campaignTag: "«Аквилон»",
  campaignLead: "Обезумевшая сеть береговой обороны закрыла архипелаг. Ваш парус — единственное, чего она почти не видит.",
  continueCampaign: "Продолжить",
  newCampaign: "Новая кампания",
  newCampaignConfirm: "Начать кампанию заново? Прогресс будет потерян.",
  newCampaignYes: "Начать заново",
  freeSail: "Свободное плавание",
  freeSailLead: "Открытое море, как раньше: без сюжета и дронов.",
  chooseTitle: "Как пойдёте?",
  campaignBadge: "Сюжет",
  freeBadge: "Песочница",
  journal: "Журнал",
  journalChapters: "Главы",
  journalCurrent: "Сейчас",
  journalDone: "Пройдено",
  journalPlanned: "В разработке",
  journalItems: "При себе",
  journalSectors: "Сектора",
  journalEmpty: "Пока ничего.",
  objective: "Задача",
  distance: "{d}",
  metres: "{n} м",
  km: "{n} км",
  hull: "Корпус",
  engine: "Двигатель",
  engineDead: "Мотор заглох",
  engineBroken: "Двигатель мёртв — идите под парусом или почините его",
  hidden: "Не замечены",
  suspicious: "Подозрение",
  spotted: "Обнаружены!",
  rifle: "Винтовка",
  rifleDraw: "Винтовка (1)",
  rifleDrawTouch: "Винтовка",
  rifleAway: "Убрать",
  reloading: "Перезарядка",
  hitDome: "Попадание в купол",
  hitBlind: "Ослеплён!",
  hitJet: "Попадание в сопло",
  hitStopped: "Обездвижен",
  hitArmour: "Броня",
  hitWrecked: "Уничтожен",
  talk: "Поговорить: {name}",
  repair: "Залатать пробоину",
  repairing: "Латаем…",
  winch: "Подтянуть лебёдкой",
  winching: "Тянем…",
  skip: "Дальше",
  speakerHero: "Шкипер",
  speakerAquilon: "«Аквилон»",
  speakerUnknown: "Неизвестный",
  viaRadio: "Радио",
  viaBroadcast: "Все частоты",
  viaThought: "Мысли",
  storyComplete: "Сюжет пока на этом всё. До следующей главы рифовый пояс — ваши охотничьи угодья.",
  sectorNeutral: "Нейтральные воды",
  chartSectors: "Сектора",
  chartQuarantine: "Линия карантина",
  close: "Закрыть",
  journalKey: "Журнал (L)",
};

export function storyMessages(language: LanguageCode): StoryMessages {
  return language === "ru" ? RU : EN;
}

export function storyLanguage(language: LanguageCode): StoryLanguage {
  return language === "ru" ? "ru" : "en";
}

export function textIn(text: Text | null | undefined, language: StoryLanguage): string {
  return text ? text[language] : "";
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** "420 m" / "1.6 km" in the reader's words. */
export function distanceText(metres: number, messages: StoryMessages): string {
  if (metres < 950) return fill(messages.metres, { n: Math.max(5, Math.round(metres / 5) * 5) });
  return fill(messages.km, { n: (metres / 1000).toFixed(1).replace(".", messages === RU ? "," : ".") });
}
