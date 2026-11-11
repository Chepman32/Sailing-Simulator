"use client";

import type { LanguageCode } from "../i18n";
import type { SimulationSnapshot } from "@/src/simulator/types";
import type { StoryView } from "@/src/simulator/story/StorySystem";
import { CAMPAIGN } from "@/src/simulator/story/content";
import { MAGAZINE } from "@/src/simulator/combat/Rifle";
import { fill, storyLanguage, storyMessages, textIn, type StoryMessages } from "./storyMessages";

/**
 * The campaign on the screen: the objective, the voice on the radio, the
 * cards that open a chapter or name a sector, the black of a cut, the hull
 * and the drones' alarm, the rifle, and the story's action at the helm.
 */

type Props = {
  view: StoryView;
  combat: SimulationSnapshot["combat"];
  language: LanguageCode;
  touch: boolean;
  /** At the wheel (the action key there is the story's: the winch, the patch). */
  atHelm: boolean;
  onAct: () => void;
  onSkip: () => void;
  onToggleRifle: () => void;
  onJournal: () => void;
};

const FACTION_COLOR = new Map(CAMPAIGN.factions.map((faction) => [faction.id, faction.color]));

export function speakerOf(who: string, messages: StoryMessages, language: "ru" | "en"): { name: string; callsign: string | null; monogram: string; color: string } {
  const character = CAMPAIGN.characters.find((entry) => entry.id === who);
  if (character) {
    return {
      name: character.name[language],
      callsign: character.callsign?.[language] ?? null,
      monogram: character.monogram,
      color: FACTION_COLOR.get(character.faction) ?? "#8aa",
    };
  }
  if (who === "aquilon") return { name: messages.speakerAquilon, callsign: null, monogram: "AQ", color: FACTION_COLOR.get("aquilon") ?? "#e5484d" };
  if (who === "hero") return { name: messages.speakerHero, callsign: null, monogram: "SK", color: "#e9d8a6" };
  return { name: messages.speakerUnknown, callsign: null, monogram: "??", color: "#8a96a3" };
}

export function StoryHud({ view, combat, language, touch, atHelm, onAct, onSkip, onToggleRifle, onJournal }: Props) {
  if (view.mode !== "campaign") return null;
  const messages = storyMessages(language);
  const lang = storyLanguage(language);
  const line = view.line;
  const speaker = line ? speakerOf(line.who, messages, lang) : null;
  const title = view.title;
  const hullPercent = Math.round(view.hull * 100);
  const alarmLevel = combat.attacking ? "spotted" : combat.alarm > 0.08 ? "suspicious" : "hidden";
  const prompt = view.prompt;
  const helmPrompt = atHelm && prompt && prompt.kind !== "talk" ? prompt : null;
  const progress = helmPrompt ? helmPrompt.progress : 0;
  const busy = progress > 0.001;
  return (
    <>
      <div className="story-fade" style={{ opacity: view.fade }} aria-hidden="true" />

      {title && (
        <div key={title.id} className={`story-title is-${title.style}`} role="status" aria-live="polite">
          <span className="story-title-rule" aria-hidden="true" />
          <strong>{textIn(title.title, lang)}</strong>
          {title.subtitle && <span className="story-title-sub">{textIn(title.subtitle, lang)}</span>}
          <span className="story-title-rule" aria-hidden="true" />
        </div>
      )}

      <div className={`story-left${atHelm ? "" : " is-afoot"}`}>
      {(view.mission || view.complete) && view.fade < 0.6 && (
        <section className="story-tracker" aria-label={messages.objective}>
          {view.mission ? (
            <>
              <p className="story-tracker-chapter">
                {textIn(view.mission.chapter, lang)} · {textIn(view.mission.title, lang)}
              </p>
              {view.goal && <p className="story-tracker-goal">{textIn(view.goal, lang)}</p>}
              {view.hint && <p className="story-tracker-hint">{textIn(view.hint, lang)}</p>}
            </>
          ) : (
            <p className="story-tracker-hint">{messages.storyComplete}</p>
          )}
          <button type="button" className="story-journal-button" onClick={onJournal} title={messages.journalKey} aria-label={messages.journal}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z M6 18a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M10 8h5M10 11h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </section>
      )}

      <div className={`story-status${view.hull < 0.5 ? " is-damaged" : ""}`} aria-label={`${messages.hull} ${hullPercent}%`}>
        <span className="story-hull">
          <span className="story-status-label">{messages.hull}</span>
          <span className="story-hull-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, view.hull))})` }} />
          </span>
          <strong>{hullPercent}%</strong>
        </span>
        {!view.engine && <span className="story-engine-dead">{messages.engineDead}</span>}
        <span className={`story-alarm is-${alarmLevel}`} role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {alarmLevel === "hidden" ? (
              <path d="M3 12s3.5-6 9-6c2 0 3.7.8 5 1.8M21 12s-3.5 6-9 6c-2 0-3.7-.8-5-1.8M4 20 20 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            ) : (
              <>
                <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="12" cy="12" r="2.8" fill="currentColor" />
              </>
            )}
          </svg>
          <span>{alarmLevel === "spotted" ? messages.spotted : alarmLevel === "suspicious" ? messages.suspicious : messages.hidden}</span>
          {alarmLevel === "suspicious" && (
            <span className="story-alarm-meter" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.min(1, combat.alarm)})` }} />
            </span>
          )}
        </span>
      </div>
      </div>

      {line && speaker && (
        <button
          type="button"
          key={line.id}
          className={`story-line is-${line.via}`}
          onClick={onSkip}
          aria-live="polite"
          title={messages.skip}
          style={{ ["--speaker" as string]: speaker.color }}
        >
          {line.via !== "thought" && (
            <span className="story-line-badge" aria-hidden="true">
              {speaker.monogram}
            </span>
          )}
          <span className="story-line-body">
            <span className="story-line-who">
              {line.via === "thought" ? messages.viaThought : speaker.name}
              {speaker.callsign && line.via !== "thought" && <em> «{speaker.callsign}»</em>}
              {line.via === "radio" && <span className="story-line-via">{messages.viaRadio}</span>}
              {line.via === "broadcast" && <span className="story-line-via">{messages.viaBroadcast}</span>}
            </span>
            <span className="story-line-text">{textIn(line.text, lang)}</span>
            <span className="story-line-time" aria-hidden="true" style={{ animationDuration: `${line.duration}s` }} />
          </span>
        </button>
      )}

      {helmPrompt && (
        <button type="button" className={`story-prompt${busy ? " is-busy" : ""}`} onClick={onAct} disabled={busy}>
          {!touch && !busy && <kbd>E</kbd>}
          <span>
            {helmPrompt.kind === "repair" ? (busy ? messages.repairing : messages.repair) : busy ? messages.winching : messages.winch}
          </span>
          {busy && (
            <span className="story-prompt-progress" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.min(1, progress)})` }} />
            </span>
          )}
        </button>
      )}

      {combat.rifle && (
        <div className={`story-weapon${combat.drawn ? " is-drawn" : ""}${atHelm ? "" : " is-afoot"}`}>
          <button type="button" className="story-weapon-toggle" onClick={onToggleRifle} title={messages.rifleDraw} aria-pressed={combat.drawn}>
            <svg viewBox="0 0 32 16" aria-hidden="true">
              <path d="M1 9.5h17l2-2h6l5-1.5v3l-4 1.5H20l-3 3h-3l1-3H1z" fill="currentColor" />
              <path d="M9 6.5h6v2H9z" fill="currentColor" opacity="0.7" />
            </svg>
            <span>{combat.drawn ? messages.rifleAway : touch ? messages.rifleDrawTouch : messages.rifleDraw}</span>
          </button>
          {combat.drawn && (
            <span className="story-ammo" aria-label={`${combat.ammo}/${MAGAZINE}`}>
              {combat.reload < 1 ? (
                <span className="story-reload">
                  {messages.reloading}
                  <span className="story-reload-bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${combat.reload})` }} />
                  </span>
                </span>
              ) : (
                Array.from({ length: MAGAZINE }, (_, index) => <span key={index} className={`story-round${index < combat.ammo ? " is-loaded" : ""}`} aria-hidden="true" />)
              )}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** The talk prompt's words on foot (`detail` is "talk:<who>" or "repair:<progress>"). */
export function storyPromptText(detail: string | null, language: LanguageCode): string | null {
  if (!detail) return null;
  const messages = storyMessages(language);
  const lang = storyLanguage(language);
  if (detail.startsWith("talk:")) return fill(messages.talk, { name: speakerOf(detail.slice(5), messages, lang).name });
  if (detail.startsWith("repair:")) return Number(detail.slice(7)) > 0.001 ? messages.repairing : messages.repair;
  if (detail.startsWith("winch:")) return Number(detail.slice(6)) > 0.001 ? messages.winching : messages.winch;
  return null;
}
