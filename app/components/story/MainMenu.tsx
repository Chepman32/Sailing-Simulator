"use client";

import { useEffect, useRef, useState } from "react";
import type { LanguageCode } from "../i18n";
import type { SaveSlotId } from "@/src/simulator/story/SaveGames";
import { SaveSlots } from "./SaveSlots";
import { storyMessages } from "./storyMessages";

/**
 * The main menu, over the yacht drifting in the evening light: a new game
 * (the prologue), continue (the campaign where it was left), load (a saved
 * game), free sailing, and the settings.
 */

type Props = {
  language: LanguageCode;
  /** A campaign is under way to continue. */
  saved: boolean;
  onNew: () => void;
  onContinue: () => void;
  onLoad: (slot: SaveSlotId) => void;
  onFree: () => void;
  onSettings: () => void;
};

type Page = "main" | "load" | "confirm-new";

export function MainMenu({ language, saved, onNew, onContinue, onLoad, onFree, onSettings }: Props) {
  const messages = storyMessages(language);
  const [page, setPage] = useState<Page>("main");
  const listRef = useRef<HTMLElement>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [page]);

  // Esc goes back a page; nothing behind the menu hears a key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape" && page !== "main") {
        event.preventDefault();
        setPage("main");
      }
      if (event.code !== "Tab" && !event.code.startsWith("Arrow") && event.code !== "Enter" && event.code !== "Space") event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [page]);

  return (
    <div className="main-menu" role="dialog" aria-modal="true" aria-labelledby="main-menu-title">
      <div className="main-menu-shade" aria-hidden="true" />
      <section ref={listRef} className={`main-menu-card is-${page}`}>
        <header className="main-menu-head">
          <p className="main-menu-eyebrow">{messages.menuSubtitle}</p>
          <h1 id="main-menu-title">{messages.menuTitle}</h1>
          <span className="main-menu-rule" aria-hidden="true" />
        </header>

        {page === "main" && (
          <nav className="main-menu-list">
            {saved && (
              <button type="button" className="main-menu-item is-primary" onClick={onContinue}>
                <span>{messages.menuContinue}</span>
              </button>
            )}
            <button type="button" className={`main-menu-item${saved ? "" : " is-primary"}`} onClick={() => (saved ? setPage("confirm-new") : onNew())}>
              <span>{messages.menuNew}</span>
              <small>{messages.menuNewLead}</small>
            </button>
            <button type="button" className="main-menu-item" onClick={() => setPage("load")}>
              <span>{messages.menuLoad}</span>
            </button>
            <button type="button" className="main-menu-item" onClick={onFree}>
              <span>{messages.menuFree}</span>
              <small>{messages.menuFreeLead}</small>
            </button>
            <button type="button" className="main-menu-item is-quiet" onClick={onSettings}>
              <span>{messages.menuSettings}</span>
            </button>
          </nav>
        )}

        {page === "confirm-new" && (
          <div className="main-menu-confirm" role="alertdialog" aria-describedby="main-menu-confirm-text">
            <p id="main-menu-confirm-text">{messages.menuNewConfirm}</p>
            <div className="main-menu-list">
              <button type="button" className="main-menu-item is-danger" onClick={onNew}>
                <span>{messages.menuNewYes}</span>
              </button>
              <button type="button" className="main-menu-item is-quiet" onClick={() => setPage("main")}>
                <span>{messages.menuBack}</span>
              </button>
            </div>
          </div>
        )}

        {page === "load" && (
          <div className="main-menu-load">
            <h2>{messages.loadTitle}</h2>
            <SaveSlots mode="load" language={language} onLoad={onLoad} />
            <button type="button" className="main-menu-item is-quiet" onClick={() => setPage("main")}>
              <span>{messages.menuBack}</span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
