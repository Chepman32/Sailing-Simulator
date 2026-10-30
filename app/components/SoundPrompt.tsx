"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { animateDust } from "./dustCanvas";

/**
 * The "tap for sound" prompt, and how it leaves.
 *
 * It appears in the middle of the screen when the scene is ready and sound is
 * on but the player has not started it yet. After a short while (or as soon
 * as sound starts or the player taps it) it dissolves into fine dust, the way
 * a deleted message does in a messenger: the pill is painted onto a canvas,
 * cut into grains a pixel or two across (`dustMath`), and a wave releases
 * them left to right; they lift, drift and stream into the sound button in
 * the corner, which then pulses. With reduced motion the pill simply fades.
 */

/** Seconds the prompt waits before dissolving into the corner button. */
export const SOUND_PROMPT_SECONDS = 2.6;

type Phase = "visible" | "snapping" | "gone";

type Props = {
  /** Whether the prompt should currently be offered at all. */
  active: boolean;
  /** The corner button the dust flies into. */
  targetRef: RefObject<HTMLElement | null>;
  label: string;
  onUnlock: () => void;
  /** Called when the last grain has arrived. */
  onArrived: () => void;
};

export type PillSnapshot = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The pill as pixels, at the device pixel ratio. */
  picture: HTMLCanvasElement;
  ratio: number;
};

type Snapshot = PillSnapshot;

/** Paints the pill as it looks on screen (see `.audio-unlock` in globals.css). */
export function paintPill(pill: HTMLElement): PillSnapshot | null {
  const rect = pill.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  const picture = document.createElement("canvas");
  picture.width = Math.ceil(rect.width * ratio);
  picture.height = Math.ceil(rect.height * ratio);
  const context = picture.getContext("2d");
  if (!context) return null;
  context.scale(ratio, ratio);
  const style = getComputedStyle(pill);
  const radius = Math.min(rect.height / 2, parseFloat(style.borderTopLeftRadius) || rect.height / 2);
  const gradient = context.createLinearGradient(0, 0, rect.width, rect.height);
  gradient.addColorStop(0, "#82fff0");
  gradient.addColorStop(1, "#57d7d0");
  context.beginPath();
  context.roundRect(0.5, 0.5, rect.width - 1, rect.height - 1, radius);
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = style.borderTopColor;
  context.lineWidth = 1;
  context.stroke();
  const icon = pill.querySelector("span");
  if (icon) {
    const box = icon.getBoundingClientRect();
    const iconStyle = getComputedStyle(icon);
    const cx = box.left - rect.left + box.width / 2;
    const cy = box.top - rect.top + box.height / 2;
    context.beginPath();
    context.arc(cx, cy, box.width / 2, 0, Math.PI * 2);
    context.fillStyle = iconStyle.backgroundColor;
    context.fill();
    context.font = `${iconStyle.fontWeight} ${iconStyle.fontSize} ${iconStyle.fontFamily}`;
    context.fillStyle = iconStyle.color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(icon.textContent ?? "", cx, cy + 1);
  }
  const text = pill.querySelector("strong");
  if (text) {
    const box = text.getBoundingClientRect();
    const textStyle = getComputedStyle(text);
    context.font = `${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`;
    context.fillStyle = textStyle.color;
    context.textAlign = "left";
    context.textBaseline = "middle";
    if ("letterSpacing" in context) (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = textStyle.letterSpacing;
    context.fillText(text.textContent ?? "", box.left - rect.left, box.top - rect.top + box.height / 2);
  }
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, picture, ratio };
}

export function SoundPrompt({ active, targetRef, label, onUnlock, onArrived }: Props) {
  const [ownPhase, setPhase] = useState<Phase>(active ? "visible" : "gone");
  // Sound started some other way: it leaves at once.
  const phase: Phase = !active && ownPhase === "visible" ? "snapping" : ownPhase;
  const pillRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const shown = useRef(false);

  // First offer: show, then dissolve after a moment whatever happens.
  useEffect(() => {
    if (!active || shown.current) return;
    shown.current = true;
    setPhase("visible");
    const timer = window.setTimeout(() => setPhase((current) => (current === "visible" ? "snapping" : current)), SOUND_PROMPT_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [active]);

  // Photograph the pill just before it is replaced by its dust.
  useLayoutEffect(() => {
    if (phase !== "snapping" || snapshot) return;
    const pill = pillRef.current;
    const picture = pill ? paintPill(pill) : null;
    if (!picture) {
      setPhase("gone");
      onArrived();
      return;
    }
    setSnapshot(picture);
  }, [phase, snapshot, onArrived]);

  // Release the dust and let it stream into the corner button.
  useEffect(() => {
    if (phase !== "snapping" || !snapshot) return;
    const canvas = canvasRef.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!canvas || reduced) {
      const timer = window.setTimeout(() => {
        setPhase("gone");
        onArrived();
      }, reduced ? 260 : 0);
      return () => window.clearTimeout(timer);
    }
    return animateDust(
      canvas,
      snapshot,
      () => {
        const target = targetRef.current?.getBoundingClientRect();
        return { x: target ? target.left + target.width / 2 : 24, y: target ? target.top + target.height / 2 : 24 };
      },
      () => {
        setPhase("gone");
        onArrived();
      },
    );
  }, [phase, snapshot, targetRef, onArrived]);

  if (phase === "gone") return null;

  if (phase === "snapping" && snapshot) {
    return (
      <>
        {/* Keeps the pill's place, so the prompts below do not jump up under the dust. */}
        <div aria-hidden="true" style={{ width: snapshot.width, height: snapshot.height, pointerEvents: "none" }} />
        <canvas ref={canvasRef} className="audio-unlock-dust" aria-hidden="true" />
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
