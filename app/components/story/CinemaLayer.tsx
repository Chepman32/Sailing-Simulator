"use client";

import { useEffect, useRef, useState } from "react";
import type { LanguageCode } from "../i18n";
import type { StoryView } from "@/src/simulator/story/StorySystem";
import { fill, storyLanguage, storyMessages, textIn } from "./storyMessages";

/**
 * The story's screen effects over the scene: the letterbox of a cut scene
 * with its hold-to-skip; the eyes opening when the skipper comes to; and,
 * while the yacht's electronics are dead, the red alert of the network.
 */

type Props = {
  view: StoryView;
  language: LanguageCode;
  touch: boolean;
  /** At the wheel: the alert on her screens is his to see. */
  atHelm: boolean;
  onSkip: () => void;
};

/** Seconds to hold for a skip (long enough not to happen by accident). */
const HOLD = 0.85;

export function CinemaLayer({ view, language, touch, atHelm, onSkip }: Props) {
  const lang = storyLanguage(language);
  const cinematic = view.cinematic;
  const alert = view.alert && view.alert.length > 0 ? view.alert : null;
  return (
    <>
      <div className={`cinema-bars${cinematic ? " is-on" : ""}`} aria-hidden="true">
        <span className="cinema-bar is-top" />
        <span className="cinema-bar is-bottom" />
      </div>

      {cinematic && <SkipControl language={language} touch={touch} onSkip={onSkip} />}

      {view.wake > 0 && (
        <div key={view.wake} className="cinema-wake" aria-hidden="true">
          <span className="cinema-lid is-top" />
          <span className="cinema-lid is-bottom" />
        </div>
      )}

      {alert && !cinematic && atHelm && (
        <div className="story-lockdown" role="alert">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 2 20h20L12 3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M12 10v4.5M12 17.2v.3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>
            {alert.map((line, index) => (
              <span key={index} className={index === 0 ? "story-lockdown-head" : "story-lockdown-sub"}>
                {textIn(line, lang)}
              </span>
            ))}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Hold Space (or Enter, or Esc), or press and hold the control, to skip the
 * scene. It shows itself after a moment, or at the first key. Mounted only
 * while a scene runs, so its state starts fresh with each.
 */
function SkipControl({ language, touch, onSkip }: { language: LanguageCode; touch: boolean; onSkip: () => void }) {
  const messages = storyMessages(language);
  const ringRef = useRef<HTMLSpanElement>(null);
  const holdStart = useRef<number | null>(null);
  const frame = useRef(0);
  const skipRef = useRef(onSkip);
  const [holding, setHolding] = useState(false);
  const [offered, setOffered] = useState(false);

  useEffect(() => {
    skipRef.current = onSkip;
  });

  // The hold, driven by its own clock.
  const controls = useRef({
    stop: () => {
      holdStart.current = null;
      cancelAnimationFrame(frame.current);
      setHolding(false);
      ringRef.current?.style.setProperty("--hold", "0");
    },
    start: () => {
      if (holdStart.current !== null) return;
      holdStart.current = performance.now();
      setHolding(true);
      setOffered(true);
      const step = (now: number) => {
        if (holdStart.current === null) return;
        const progress = Math.min(1, (now - holdStart.current) / 1000 / HOLD);
        ringRef.current?.style.setProperty("--hold", progress.toFixed(3));
        if (progress >= 1) {
          controls.current.stop();
          skipRef.current();
          return;
        }
        frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    },
  });

  useEffect(() => {
    const { start, stop } = controls.current;
    const timer = window.setTimeout(() => setOffered(true), 2200);
    const isSkipKey = (event: KeyboardEvent) => event.code === "Space" || event.code === "Enter" || event.code === "Escape";
    const onDown = (event: KeyboardEvent) => {
      if (!isSkipKey(event)) {
        setOffered(true);
        return;
      }
      // The scene holds these keys: nothing behind it (the pause menu included) hears them.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) start();
    };
    const onUp = (event: KeyboardEvent) => {
      if (isSkipKey(event)) stop();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", stop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", stop);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const { start, stop } = controls.current;
  return (
    <button
      type="button"
      className={`cinema-skip${offered ? " is-offered" : ""}${holding ? " is-holding" : ""}`}
      onPointerDown={(event) => {
        event.preventDefault();
        start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={messages.skipScene}
    >
      <span ref={ringRef} className="cinema-skip-ring" aria-hidden="true" />
      <span className="cinema-skip-label">{touch ? messages.skipHoldTouch : fill(messages.skipHold, { key: "␣" })}</span>
    </button>
  );
}
