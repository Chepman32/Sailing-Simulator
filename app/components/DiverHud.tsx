"use client";

import { useEffect, useRef, useState } from "react";
import type { SimulationSnapshot } from "@/src/simulator/types";
import type { DiverMessages } from "./diverMessages";

/** What the HUD asks of the simulator. */
export type DiverActions = {
  returnToHelm: () => void;
  interact: () => void;
  jump: () => void;
  toggleTorch: () => void;
  stick: (x: number, y: number) => void;
  hold: (up: boolean, down: boolean) => void;
};

type Props = {
  diver: SimulationSnapshot["diver"];
  messages: DiverMessages;
  touch: boolean;
  actions: DiverActions;
};

/** Seconds the controls hint stays up after leaving the helm. */
const HINT_SECONDS = 9;

/**
 * The skipper's own view: depth and air when in the water, what the
 * interact key would do here, the way back to the helm, and on a touch
 * screen a movement stick and buttons to rise, dive and use.
 */
export function DiverHud({ diver, messages, touch, actions }: Props) {
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setHint(false), HINT_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, []);
  const inWater = diver.mode === "swim";
  const diving = inWater && diver.depth > 0.6;
  const lowAir = diving && diver.air < 0.15;
  const status = diver.mode === "deck" ? messages.onDeck : diving ? messages.diving : messages.swimming;
  const promptText = diver.prompt === "helm" ? messages.takeHelm : diver.prompt === "board" ? messages.board : null;

  return (
    <div className={`diver-hud${diver.underwater ? " is-underwater" : ""}`}>
      <div className="diver-status" role="status" aria-live="polite">
        <span className="diver-mode">{status}</span>
        {inWater && (
          <>
            <span className="diver-gauge">
              <span className="diver-gauge-label">{messages.depth}</span>
              <span className="diver-gauge-value">{diver.depth.toFixed(1)} {messages.metres ?? "m"}</span>
            </span>
            <span className={`diver-gauge${lowAir ? " is-low" : ""}`}>
              <span className="diver-gauge-label">{messages.air}</span>
              <span className="diver-air" aria-hidden="true">
                <span className="diver-air-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, diver.air))})` }} />
              </span>
              <span className="diver-gauge-value">{Math.round(diver.air * 200)} {messages.bar ?? "bar"}</span>
            </span>
          </>
        )}
        {diver.torch && <span className="diver-torch-on" aria-label={messages.torch}>●</span>}
      </div>

      <button type="button" className="diver-helm" onClick={actions.returnToHelm} title={`${messages.backToHelm} (T)`}>
        <span aria-hidden="true" className="diver-helm-wheel" />
        <span>{messages.backToHelm}</span>
      </button>

      {!touch && diver.pointerLocked && <span className="diver-crosshair" aria-hidden="true" />}

      {lowAir && <p className="diver-warning" role="alert">{messages.lowAir}</p>}

      {promptText && (
        <button type="button" className="diver-prompt" onClick={actions.interact}>
          {!touch && <kbd>E</kbd>}
          <span>{promptText}</span>
        </button>
      )}

      {hint && (
        <p className="diver-hint" aria-hidden="true">
          {touch ? messages.hintTouch : diver.pointerLocked ? messages.hintKeys : `${messages.clickToLook} · ${messages.hintKeys}`}
        </p>
      )}

      {touch && (
        <>
          <Stick onMove={actions.stick} />
          <div className="diver-buttons">
            <button type="button" className="diver-button" onClick={actions.toggleTorch} aria-pressed={diver.torch} aria-label={messages.torch}>
              <span aria-hidden="true">✦</span>
            </button>
            {inWater ? (
              <>
                <HoldButton label={messages.up} glyph="▲" onHold={(on) => actions.hold(on, false)} />
                <HoldButton label={messages.down} glyph="▼" onHold={(on) => actions.hold(false, on)} />
              </>
            ) : (
              <button type="button" className="diver-button is-large" onClick={actions.jump} aria-label={messages.jump}>
                <span aria-hidden="true">⤒</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HoldButton({ label, glyph, onHold }: { label: string; glyph: string; onHold: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className="diver-button is-large"
      aria-label={label}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/** A virtual thumb-stick: drag from its centre; up is forward. */
function Stick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const pointer = useRef<number | null>(null);
  const update = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = (clientX - (rect.left + radius)) / radius;
    let dy = (clientY - (rect.top + radius)) / radius;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    setKnob({ x: dx, y: dy });
    onMove(dx, -dy);
  };
  const release = () => {
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };
  return (
    <div
      ref={baseRef}
      className="diver-stick"
      aria-hidden="true"
      onPointerDown={(event) => {
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (pointer.current === event.pointerId) update(event.clientX, event.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span className="diver-stick-knob" style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
    </div>
  );
}
