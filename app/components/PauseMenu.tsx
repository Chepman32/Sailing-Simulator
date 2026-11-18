"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { QualityChoice } from "@/src/simulator/types";
import {
  BINDING_ACTIONS,
  keyBindings,
  keyLabel,
  MOUSE_SENSITIVITY_MAX,
  MOUSE_SENSITIVITY_MIN,
  RESERVED_KEYS,
  type BindingAction,
} from "@/src/simulator/input/KeyBindings";
import { moveMenuFocus, useMenuNavigation } from "./menuNavigation";
import { menuBack } from "./menuSound";
import { LANGUAGE_OPTIONS, type LanguageCode } from "./i18n";
import type { PauseMessages } from "./pauseMessages";
import type { SaveBlock, SaveSlotId } from "@/src/simulator/story/SaveGames";
import { SaveSlots } from "./story/SaveSlots";
import { storyMessages } from "./story/storyMessages";

type Page = "main" | "graphics" | "keys" | "language" | "save" | "load" | "leave";

type Props = {
  messages: PauseMessages;
  /** Existing words: "Language", "Controls", "Quality", "Back to the helm", "Sound", on/off. */
  labels: { language: string; controls: string; quality: string; backToHelm: string; sound: string; on: string; off: string };
  qualityLabels: Record<QualityChoice, string>;
  quality: QualityChoice;
  /** Whether "ultra" is offered (not on phones). */
  ultra: boolean;
  language: LanguageCode;
  soundOn: boolean;
  touch: boolean;
  onResume: () => void;
  onBackToHelm: () => void;
  onQuality: (choice: QualityChoice) => void;
  onLanguage: (language: LanguageCode) => void;
  onSound: () => void;
  /** The campaign's journal (in a campaign). */
  campaignLabel?: string;
  onCampaign?: () => void;
  /** Not at the wheel: the way back to it is offered. */
  away?: boolean;
  /** Saving (in a campaign), and why it cannot be done just now. */
  onSave?: (slot: SaveSlotId) => Promise<"saved" | "full" | SaveBlock>;
  saveBlocked?: SaveBlock | null;
  onLoad?: (slot: SaveSlotId) => void;
  onMainMenu?: () => void;
  /** Opened from the main menu: the settings alone, with the way back. */
  settingsOnly?: boolean;
};

const QUALITY_ORDER: QualityChoice[] = ["auto", "low", "medium", "high", "ultra"];

/** The bindings, re-read whenever they change. */
function useBindings() {
  const keys = useSyncExternalStore(
    (listener) => keyBindings.subscribe(listener),
    () => keyBindings.keys,
    () => keyBindings.keys,
  );
  const look = useSyncExternalStore(
    (listener) => keyBindings.subscribe(listener),
    () => keyBindings.look,
    () => keyBindings.look,
  );
  return { keys, look };
}

/**
 * The pause menu, opened by Esc on foot (and in the water): the world
 * stands still behind it. Resume, graphics, key bindings and the mouse,
 * the language, sound, and the way back to the helm.
 */
export function PauseMenu({
  messages,
  labels,
  qualityLabels,
  quality,
  ultra,
  language,
  soundOn,
  touch,
  onResume,
  onBackToHelm,
  onQuality,
  onLanguage,
  onSound,
  campaignLabel,
  onCampaign,
  away = true,
  onSave,
  saveBlocked = null,
  onLoad,
  onMainMenu,
  settingsOnly = false,
}: Props) {
  const story = storyMessages(language);
  const [page, setPage] = useState<Page>("main");
  const [listening, setListening] = useState<BindingAction | null>(null);
  const { keys, look } = useBindings();
  const cardRef = useRef<HTMLElement>(null);
  // The Esc that opened the menu (when the browser passes it on after
  // letting the mouse go) must not close it again.
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = performance.now();
  }, []);

  // Focus the first control of each page (keyboard play without a mouse).
  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>("button, select, input")?.focus({ preventScroll: true });
  }, [page]);
  useMenuNavigation(cardRef, page);

  // Esc: stop listening for a key, or go back a page, or resume. Captured
  // before the game's own key handlers, which must not see it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (listening) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code !== "Escape" && !RESERVED_KEYS.has(event.code)) keyBindings.set(listening, event.code);
        setListening(null);
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (performance.now() - openedAt.current < 350) return;
        menuBack();
        if (page !== "main") setPage("main");
        else onResume();
        return;
      }
      // The arrows move through the menu; nothing behind it hears a key while it is open (Tab still moves focus).
      moveMenuFocus(cardRef.current, event);
      if (event.code !== "Tab") event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, page, onResume]);

  const title =
    page === "main"
      ? settingsOnly
        ? story.menuSettings
        : messages.paused
      : page === "graphics"
        ? messages.graphics
        : page === "keys"
          ? labels.controls
          : page === "save"
            ? story.saveTitle
            : page === "load"
              ? story.loadTitle
              : page === "leave"
                ? story.menuMain
                : labels.language;

  return (
    <div
      className="pause-backdrop"
      role="presentation"
      onClick={(event) => {
        // A press outside the menu resumes (and, being a gesture, gives the mouse back at once).
        if (event.target === event.currentTarget && !listening) onResume();
      }}
    >
      <section ref={cardRef} className="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <header className="pause-head">
          {page !== "main" && (
            <button type="button" className="pause-back" data-sound="back" onClick={() => setPage("main")} aria-label={messages.back}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
          <h2 id="pause-title">{title}</h2>
        </header>

        {page === "main" && (
          <nav className="pause-list">
            <button type="button" className="pause-item is-primary" onClick={onResume}>
              <span>{settingsOnly ? story.menuBack : messages.resume}</span>
              <kbd>Esc</kbd>
            </button>
            {!settingsOnly && onSave && (
              <button type="button" className="pause-item" onClick={() => setPage("save")}>
                <span>{story.save}</span>
                {saveBlocked && <small>{saveBlocked === "cutscene" ? story.saveBlockedCutscene : saveBlocked === "combat" ? story.saveBlockedCombat : saveBlocked === "danger" ? story.saveBlockedDanger : story.saveBlockedFree}</small>}
              </button>
            )}
            {!settingsOnly && onLoad && (
              <button type="button" className="pause-item" onClick={() => setPage("load")}>
                <span>{story.load}</span>
              </button>
            )}
            {!settingsOnly && onCampaign && campaignLabel && (
              <button type="button" className="pause-item" onClick={onCampaign}>
                <span>{campaignLabel}</span>
                <kbd>L</kbd>
              </button>
            )}
            <button type="button" className="pause-item" onClick={() => setPage("graphics")}>
              <span>{messages.graphics}</span>
              <small>{qualityLabels[quality]}</small>
            </button>
            {!touch && (
              <button type="button" className="pause-item" onClick={() => setPage("keys")}>
                <span>{labels.controls}</span>
                <small>{messages.keys}</small>
              </button>
            )}
            <button type="button" className="pause-item" onClick={() => setPage("language")}>
              <span>{labels.language}</span>
              <small>{LANGUAGE_OPTIONS.find((option) => option.code === language)?.name}</small>
            </button>
            <button type="button" className="pause-item" onClick={onSound} aria-pressed={soundOn}>
              <span>{labels.sound}</span>
              <small>{soundOn ? labels.on : labels.off}</small>
            </button>
            {!settingsOnly && away && (
              <button type="button" className="pause-item is-quiet" onClick={onBackToHelm}>
                <span>{labels.backToHelm}</span>
                <kbd>{keyLabel(keys.helm)}</kbd>
              </button>
            )}
            {!settingsOnly && onMainMenu && (
              <button type="button" className="pause-item is-quiet" onClick={() => setPage("leave")}>
                <span>{story.menuMain}</span>
              </button>
            )}
          </nav>
        )}

        {page === "save" && onSave && (
          <div className="pause-body">
            <SaveSlots mode="save" language={language} blocked={saveBlocked} onSave={onSave} />
          </div>
        )}

        {page === "load" && onLoad && (
          <div className="pause-body">
            <SaveSlots mode="load" language={language} confirmLoad onLoad={onLoad} />
          </div>
        )}

        {page === "leave" && onMainMenu && (
          <div className="pause-body">
            <p className="pause-note">{story.menuMainConfirm}</p>
            <nav className="pause-list">
              <button type="button" className="pause-item is-danger" onClick={onMainMenu}>
                <span>{story.menuMainYes}</span>
              </button>
              <button type="button" className="pause-item is-quiet" onClick={() => setPage("main")}>
                <span>{story.menuBack}</span>
              </button>
            </nav>
          </div>
        )}

        {page === "graphics" && (
          <div className="pause-body">
            <p className="pause-label">{labels.quality}</p>
            <div className="pause-choices" role="radiogroup" aria-label={labels.quality}>
              {QUALITY_ORDER.filter((choice) => choice !== "ultra" || ultra || quality === "ultra").map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={quality === choice}
                  className={`pause-choice${quality === choice ? " is-on" : ""}`}
                  onClick={() => onQuality(choice)}
                >
                  {qualityLabels[choice]}
                </button>
              ))}
            </div>
          </div>
        )}

        {page === "keys" && (
          <div className="pause-body">
            <div className="pause-keys" role="list">
              {BINDING_ACTIONS.map((action) => (
                <div key={action} className="pause-key-row" role="listitem">
                  <span>{messages.actions[action]}</span>
                  <button
                    type="button"
                    className={`pause-key${listening === action ? " is-listening" : ""}`}
                    onClick={() => setListening(listening === action ? null : action)}
                    aria-label={`${messages.actions[action]}: ${keyLabel(keys[action])}`}
                  >
                    {listening === action ? "…" : keyLabel(keys[action])}
                  </button>
                </div>
              ))}
            </div>
            {listening && <p className="pause-note" role="status">{messages.pressKey}</p>}
            <label className="pause-slider">
              <span>{messages.sensitivity}</span>
              <input
                type="range"
                min={MOUSE_SENSITIVITY_MIN}
                max={MOUSE_SENSITIVITY_MAX}
                step={0.05}
                value={look.sensitivity}
                onChange={(event) => keyBindings.setLook({ sensitivity: Number(event.target.value) })}
              />
              <output>{look.sensitivity.toFixed(2)}×</output>
            </label>
            <label className="pause-toggle">
              <input type="checkbox" checked={look.invertY} onChange={(event) => keyBindings.setLook({ invertY: event.target.checked })} />
              <span>{messages.invertY}</span>
            </label>
            <button type="button" className="pause-item is-quiet pause-reset" onClick={() => keyBindings.reset()}>
              <span>{messages.resetKeys}</span>
            </button>
          </div>
        )}

        {page === "language" && (
          <div className="pause-body">
            <div className="pause-languages" role="radiogroup" aria-label={labels.language}>
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  role="radio"
                  lang={option.code}
                  aria-checked={language === option.code}
                  className={`pause-choice${language === option.code ? " is-on" : ""}`}
                  onClick={() => onLanguage(option.code)}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
