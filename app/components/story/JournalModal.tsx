"use client";

import { useEffect } from "react";
import type { LanguageCode } from "../i18n";
import type { StoryView } from "@/src/simulator/story/StorySystem";
import { CAMPAIGN } from "@/src/simulator/story/content";
import { storyLanguage, storyMessages, textIn } from "./storyMessages";

/**
 * The skipper's journal: the chapters and their missions (done, under way
 * with the steps so far, or still in development), what he carries, and
 * the sectors he has sailed into.
 */

type Props = {
  view: StoryView;
  language: LanguageCode;
  onClose: () => void;
  /** To the main menu (a new game, a saved one, free sailing). */
  onSwitch: () => void;
};

export function JournalModal({ view, language, onClose, onSwitch }: Props) {
  const messages = storyMessages(language);
  const lang = storyLanguage(language);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape" || event.code === "KeyL") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const items = view.items.map((id) => CAMPAIGN.items.find((item) => item.id === id)).filter((item) => item !== undefined);
  return (
    <div className="journal-scrim" role="dialog" aria-modal="true" aria-labelledby="journal-title" onClick={onClose}>
      <section className="journal" onClick={(event) => event.stopPropagation()}>
        <header className="journal-header">
          <p className="journal-eyebrow">{messages.campaignTag}</p>
          <h2 id="journal-title">{messages.journal}</h2>
          <button type="button" className="icon-button journal-close" onClick={onClose} aria-label={messages.close} title={messages.close}>
            ×
          </button>
        </header>
        <div className="journal-body">
          <div className="journal-chapters">
            {CAMPAIGN.chapters.map((chapter) => {
              const missions = CAMPAIGN.missions.filter((mission) => mission.chapter === chapter.id);
              const planned = missions.length === 0;
              return (
                <section key={chapter.id} className={`journal-chapter${planned ? " is-planned" : ""}`}>
                  <h3>
                    {textIn(chapter.title, lang)} <span>· {textIn(chapter.subtitle, lang)}</span>
                  </h3>
                  {planned && <p className="journal-note">{messages.journalPlanned}</p>}
                  <ol>
                    {missions.map((mission) => {
                      const progress = view.progress[mission.id];
                      const status = mission.status === "planned" ? "planned" : progress?.done ? "done" : progress ? "current" : "locked";
                      if (status === "locked") return null;
                      const reached = progress ? mission.steps.findIndex((step) => step.id === progress.step) : -1;
                      return (
                        <li key={mission.id} className={`journal-mission is-${status}`}>
                          <div className="journal-mission-head">
                            <strong>{textIn(mission.title, lang)}</strong>
                            <span className="journal-tag">
                              {status === "done" ? messages.journalDone : status === "current" ? messages.journalCurrent : messages.journalPlanned}
                            </span>
                          </div>
                          {status !== "done" && <p>{textIn(mission.brief, lang)}</p>}
                          {status === "current" && (
                            <ul className="journal-steps">
                              {mission.steps
                                .filter((step, index) => step.goal && index <= reached)
                                .map((step) => (
                                  <li key={step.id} className={step.id === progress?.step ? "is-now" : "is-done"}>
                                    {textIn(step.goal, lang)}
                                  </li>
                                ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}
          </div>
          <aside className="journal-side">
            <h3>{messages.journalItems}</h3>
            {items.length === 0 && view.gear.length === 0 ? (
              <p className="journal-note">{messages.journalEmpty}</p>
            ) : (
              <ul className="journal-items">
                {view.gear.includes("rifle") && <li>{messages.rifle}</li>}
                {items.map((item) => (
                  <li key={item.id}>{textIn(item.name, lang)}</li>
                ))}
              </ul>
            )}
            <h3>{messages.journalSectors}</h3>
            <ul className="journal-sectors">
              {CAMPAIGN.sectors.map((sector) => (
                <li key={sector.id} style={{ ["--sector" as string]: sector.color }} className={view.sector?.id === sector.id ? "is-here" : ""}>
                  <span className="journal-sector-swatch" aria-hidden="true" />
                  <span>
                    <strong>{textIn(sector.name, lang)}</strong>
                    <small>
                      {textIn(sector.subtitle, lang)}
                      {sector.status === "planned" ? ` · ${messages.journalPlanned.toLowerCase()}` : ""}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="journal-switch" onClick={onSwitch}>
              {messages.menuMain}
            </button>
          </aside>
        </div>
      </section>
    </div>
  );
}
