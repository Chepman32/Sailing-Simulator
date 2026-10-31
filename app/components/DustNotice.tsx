"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animateDust } from "./dustCanvas";
import { paintPill, type PillSnapshot } from "./SoundPrompt";

/**
 * What a control has just done ("Sound: on", "Camera: drone", "Flare
 * away!"): a bright pill like the first "tap for sound" prompt, a little below
 * the middle of the screen, that after a couple of seconds crumbles into fine
 * dust blown up and away — the same disintegration as the sound prompt, with
 * no button to settle into. A newer notice sends the one before it to dust at
 * once. Shown everywhere, the skipper's first-person view included.
 */

/** Seconds a notice stays whole before it crumbles. */
export const NOTICE_SECONDS = 2.2;

export type NoticeItem = { id: number; text: string };

type Phase = "visible" | "snapping" | "gone";

function DustNotice({ text, dismissed, onGone }: { text: string; dismissed: boolean; onGone: () => void }) {
  const [ownPhase, setPhase] = useState<Phase>("visible");
  // A newer notice sends this one to dust at once.
  const phase: Phase = dismissed && ownPhase === "visible" ? "snapping" : ownPhase;
  const pillRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<PillSnapshot | null>(null);
  const goneRef = useRef(onGone);
  useLayoutEffect(() => {
    goneRef.current = onGone;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setPhase((current) => (current === "visible" ? "snapping" : current)), NOTICE_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, []);

  // Photograph the pill just before it turns to dust.
  useLayoutEffect(() => {
    if (phase !== "snapping" || snapshot) return;
    const picture = pillRef.current ? paintPill(pillRef.current) : null;
    if (!picture) {
      setPhase("gone");
      goneRef.current();
      return;
    }
    setSnapshot(picture);
  }, [phase, snapshot]);

  useEffect(() => {
    if (phase !== "snapping" || !snapshot) return;
    const canvas = canvasRef.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const finish = () => {
      setPhase("gone");
      goneRef.current();
    };
    if (!canvas || reduced) {
      const timer = window.setTimeout(finish, reduced ? 200 : 0);
      return () => window.clearTimeout(timer);
    }
    // Blown up and off to the side, like ash on a breath of wind.
    const goal = { x: snapshot.left + snapshot.width + 150, y: snapshot.top - 170 };
    return animateDust(canvas, snapshot, () => goal, finish);
  }, [phase, snapshot]);

  if (phase === "gone") return null;
  if (phase === "snapping" && snapshot) return <canvas ref={canvasRef} className="audio-unlock-dust" aria-hidden="true" />;
  return (
    <div ref={pillRef} className="audio-unlock dust-notice" role="status" aria-live="polite">
      <span aria-hidden="true">✓</span>
      <strong>{text}</strong>
    </div>
  );
}

/** The current notice and any older ones still crumbling. */
export function DustNotices({ items, onGone }: { items: readonly NoticeItem[]; onGone: (id: number) => void }) {
  const newest = items[items.length - 1]?.id;
  return (
    <>
      {items.map((item) => (
        <DustNotice key={item.id} text={item.text} dismissed={item.id !== newest} onGone={() => onGone(item.id)} />
      ))}
    </>
  );
}
