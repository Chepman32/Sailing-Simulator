"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * The "tap for sound" prompt, and how it leaves.
 *
 * It appears in the middle of the screen when the scene is ready and sound is
 * on but the browser has not let it play yet. After a short while (or as soon
 * as sound starts or the player taps it) it crumbles like dust: the pill is
 * cut into fragments that peel away from left to right, drift and swirl, and
 * stream into the sound button in the top-left corner, which then pulses.
 * The button stays as the permanent mute/unmute control.
 *
 * The effect is plain DOM: each fragment is a copy of the pill clipped to its
 * own cell, animated with the Web Animations API; nothing is rasterised and
 * nothing is left behind. With reduced motion the pill simply fades.
 */

/** Seconds the prompt waits before crumbling into the corner button. */
export const SOUND_PROMPT_SECONDS = 2.6;

const COLUMNS = 24;
const ROWS = 5;

type Phase = "visible" | "snapping" | "gone";

type Props = {
  /** Whether the prompt should currently be offered at all. */
  active: boolean;
  /** The corner button the dust flies into. */
  targetRef: RefObject<HTMLElement | null>;
  label: string;
  onUnlock: () => void;
  /** Called when the last fragment has arrived. */
  onArrived: () => void;
};

export function SoundPrompt({ active, targetRef, label, onUnlock, onArrived }: Props) {
  const [phase, setPhase] = useState<Phase>(active ? "visible" : "gone");
  const pillRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const shown = useRef(false);

  // First offer: show, then crumble after a moment whatever happens.
  useEffect(() => {
    if (!active || shown.current) return;
    shown.current = true;
    setPhase("visible");
    const timer = window.setTimeout(() => setPhase((current) => (current === "visible" ? "snapping" : current)), SOUND_PROMPT_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [active]);

  // Sound started some other way: leave at once.
  useEffect(() => {
    if (!active && phase === "visible") setPhase("snapping");
  }, [active, phase]);

  // Measure the pill just before it is replaced by its fragments.
  useLayoutEffect(() => {
    if (phase !== "snapping" || frame) return;
    const pill = pillRef.current;
    if (!pill) {
      setPhase("gone");
      return;
    }
    const rect = pill.getBoundingClientRect();
    setFrame({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }, [phase, frame]);

  // Animate the fragments into the corner button.
  useLayoutEffect(() => {
    if (phase !== "snapping" || !frame) return;
    const layer = layerRef.current;
    const target = targetRef.current?.getBoundingClientRect();
    if (!layer) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const targetX = target ? target.left + target.width / 2 : 24;
    const targetY = target ? target.top + target.height / 2 : 24;
    const fragments = Array.from(layer.children) as HTMLElement[];
    const animations: Animation[] = [];
    const cellWidth = frame.width / COLUMNS;
    const cellHeight = frame.height / ROWS;
    fragments.forEach((fragment, index) => {
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const centreX = frame.left + (column + 0.5) * cellWidth;
      const centreY = frame.top + (row + 0.5) * cellHeight;
      const toX = targetX - centreX;
      const toY = targetY - centreY;
      if (reduced) {
        animations.push(fragment.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: "forwards" }));
        return;
      }
      // Dust peels away from the right first, as the snap sweeps across,
      // lifts and scatters, then is drawn in a curve into the button.
      const sweep = (1 - column / COLUMNS) * 520 + Math.random() * 220 + row * 30;
      const scatterX = 18 + Math.random() * 46;
      const scatterY = -16 - Math.random() * 42 + (row - ROWS / 2) * 6;
      const spin = (Math.random() - 0.5) * 140;
      const swirlX = toX * 0.45 + (Math.random() - 0.5) * 60;
      const swirlY = toY * 0.35 - 30 - Math.random() * 40;
      animations.push(
        fragment.animate(
          [
            { transform: "translate(0px, 0px) rotate(0deg) scale(1)", opacity: 1, filter: "blur(0px)", offset: 0 },
            {
              transform: `translate(${scatterX}px, ${scatterY}px) rotate(${spin * 0.4}deg) scale(0.85)`,
              opacity: 0.9,
              filter: "blur(0.6px)",
              offset: 0.3,
            },
            {
              transform: `translate(${swirlX}px, ${swirlY}px) rotate(${spin}deg) scale(0.5)`,
              opacity: 0.75,
              filter: "blur(1.2px)",
              offset: 0.65,
            },
            { transform: `translate(${toX}px, ${toY}px) rotate(${spin * 1.4}deg) scale(0.12)`, opacity: 0, filter: "blur(2px)", offset: 1 },
          ],
          { duration: 1050 + Math.random() * 300, delay: sweep, easing: "cubic-bezier(0.45, 0.05, 0.35, 1)", fill: "forwards" },
        ),
      );
    });
    let cancelled = false;
    void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
      if (cancelled) return;
      setPhase("gone");
      onArrived();
    });
    return () => {
      cancelled = true;
      animations.forEach((animation) => animation.cancel());
    };
  }, [phase, frame, targetRef, onArrived]);

  if (phase === "gone") return null;

  if (phase === "snapping" && frame) {
    const cells = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const left = (column / COLUMNS) * 100;
        const right = 100 - ((column + 1) / COLUMNS) * 100;
        const top = (row / ROWS) * 100;
        const bottom = 100 - ((row + 1) / ROWS) * 100;
        cells.push(
          <div
            key={`${row}-${column}`}
            className="audio-unlock audio-unlock-fragment"
            aria-hidden="true"
            style={{
              left: frame.left,
              top: frame.top,
              width: frame.width,
              height: frame.height,
              // A hair of overlap so the cells read as one pill at the start.
              clipPath: `inset(${Math.max(0, top - 0.6)}% ${Math.max(0, right - 0.6)}% ${Math.max(0, bottom - 0.6)}% ${Math.max(0, left - 0.6)}%)`,
            }}
          >
            <span>♪</span>
            <strong>{label}</strong>
          </div>,
        );
      }
    }
    return (
      <>
        {/* Keeps the pill's place, so the prompts below do not jump up under the dust. */}
        <div aria-hidden="true" style={{ width: frame.width, height: frame.height, pointerEvents: "none" }} />
        <div ref={layerRef} className="audio-unlock-dust">{cells}</div>
      </>
    );
  }

  return (
    <button
      ref={pillRef}
      type="button"
      className="audio-unlock"
      onPointerDown={(event) => {
        event.preventDefault();
        onUnlock();
        setPhase("snapping");
      }}
      onClick={() => {
        onUnlock();
        setPhase("snapping");
      }}
    >
      <span aria-hidden="true">♪</span>
      <strong>{label}</strong>
    </button>
  );
}
