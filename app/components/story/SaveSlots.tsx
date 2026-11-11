"use client";

import { useState } from "react";
import type { LanguageCode } from "../i18n";
import { CAMPAIGN } from "@/src/simulator/story/content";
import { describeSave, listSaves, MANUAL_SLOTS, SAVE_SLOTS, type SaveBlock, type SaveGame, type SaveSlotId } from "@/src/simulator/story/SaveGames";
import { fill, storyLanguage, storyMessages, textIn, type StoryMessages } from "./storyMessages";

/**
 * The save slots, to save to (the three of the player's own) or to load
 * from (those and the autosave): a picture of the moment, where in the
 * story it is, what was next, and when. Overwriting and loading over a game
 * under way ask first.
 */

type Props = {
  mode: "save" | "load";
  language: LanguageCode;
  /** Saving is impossible just now (shown instead of the slots' buttons). */
  blocked?: SaveBlock | null;
  /** Loading throws away a game under way: ask first. */
  confirmLoad?: boolean;
  onSave?: (slot: SaveSlotId) => Promise<"saved" | "full" | SaveBlock>;
  onLoad?: (slot: SaveSlotId) => void;
};

function readAll(): (SaveGame | null)[] {
  try {
    return listSaves(localStorage, CAMPAIGN);
  } catch {
    return SAVE_SLOTS.map(() => null);
  }
}

export function blockText(block: SaveBlock, messages: StoryMessages): string {
  return block === "cutscene" ? messages.saveBlockedCutscene : block === "combat" ? messages.saveBlockedCombat : block === "danger" ? messages.saveBlockedDanger : messages.saveBlockedFree;
}

function when(savedAt: number, language: LanguageCode, messages: StoryMessages): string {
  const age = Date.now() - savedAt;
  if (age >= 0 && age < 60_000) return messages.savedJustNow;
  try {
    return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(savedAt);
  } catch {
    return new Date(savedAt).toLocaleString();
  }
}

export function SaveSlots({ mode, language, blocked, confirmLoad, onSave, onLoad }: Props) {
  const messages = storyMessages(language);
  const lang = storyLanguage(language);
  // Shown only in the browser (after the game has loaded), so localStorage is there to read.
  const [saves, setSaves] = useState<(SaveGame | null)[]>(readAll);
  const [asking, setAsking] = useState<SaveSlotId | null>(null);
  const [busy, setBusy] = useState<SaveSlotId | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const slots = mode === "save" ? MANUAL_SLOTS : SAVE_SLOTS;
  const bySlot = new Map(SAVE_SLOTS.map((slot, index) => [slot, saves[index] ?? null]));
  const shown = mode === "load" ? slots.filter((slot) => bySlot.get(slot)) : slots;

  const save = async (slot: SaveSlotId) => {
    if (!onSave) return;
    setBusy(slot);
    setAsking(null);
    const result = await onSave(slot);
    setBusy(null);
    setSaves(readAll());
    setStatus(result === "saved" ? messages.saved : result === "full" ? messages.saveFull : blockText(result, messages));
  };

  const choose = (slot: SaveSlotId) => {
    const present = bySlot.get(slot);
    if (mode === "save") {
      if (blocked) return;
      if (present && asking !== slot) setAsking(slot);
      else void save(slot);
      return;
    }
    if (!present) return;
    if (confirmLoad && asking !== slot) setAsking(slot);
    else onLoad?.(slot);
  };

  return (
    <div className="save-slots">
      {mode === "save" && blocked && (
        <p className="save-note is-blocked" role="status">
          {blockText(blocked, messages)}
        </p>
      )}
      {mode === "load" && shown.length === 0 && <p className="save-note">{messages.noSaves}</p>}
      <ul className="save-list">
        {shown.map((slot) => {
          const game = bySlot.get(slot) ?? null;
          const about = game ? describeSave(game, CAMPAIGN) : null;
          const label = slot === "auto" ? messages.slotAuto : fill(messages.slotManual, { n: slot.slice(5) });
          const confirming = asking === slot;
          return (
            <li key={slot}>
              <button
                type="button"
                className={`save-slot${game ? "" : " is-empty"}${confirming ? " is-confirming" : ""}${slot === "auto" ? " is-auto" : ""}`}
                onClick={() => choose(slot)}
                disabled={(mode === "save" && !!blocked) || busy !== null}
                aria-label={`${label}: ${game ? textIn(about?.mission, lang) : messages.slotEmpty}`}
              >
                <span className="save-thumb" aria-hidden="true">
                  {game?.thumbnail ? <span className="save-thumb-image" style={{ backgroundImage: `url("${game.thumbnail}")` }} /> : <span className="save-thumb-empty" />}
                </span>
                <span className="save-body">
                  <span className="save-slot-name">
                    {label}
                    {game && <time>{when(game.savedAt, language, messages)}</time>}
                  </span>
                  {game && about ? (
                    <>
                      <strong>{textIn(about.mission, lang)}</strong>
                      <span className="save-chapter">{textIn(about.chapter, lang)}</span>
                      {about.goal && <span className="save-goal">{textIn(about.goal, lang)}</span>}
                    </>
                  ) : (
                    <strong className="save-empty">{messages.slotEmpty}</strong>
                  )}
                  {confirming && <span className="save-confirm">{mode === "save" ? messages.overwrite : messages.loadConfirm}</span>}
                </span>
                <span className="save-action">{busy === slot ? "…" : confirming ? (mode === "save" ? messages.overwriteYes : messages.loadThis) : mode === "save" ? messages.saveHere : messages.loadThis}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {status && (
        <p className="save-note is-done" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
