"use client";

import { useEffect, useRef, useState } from "react";
import { STICK_REACH, stickDeflection } from "./steering";
import type { SimulationSnapshot } from "@/src/simulator/types";
import type { DiverMessages } from "./diverMessages";
import { fill } from "./featureMessages";
import { findName, type ShopMessages } from "./shopMessages";

/** What the HUD asks of the simulator. */
export type DiverActions = {
  returnToHelm: () => void;
  interact: () => void;
  jump: () => void;
  toggleTorch: () => void;
  inventory: () => void;
  stick: (x: number, y: number) => void;
  hold: (up: boolean, down: boolean) => void;
  /** The pause menu (also Esc). */
  pause?: () => void;
};

type Props = {
  diver: SimulationSnapshot["diver"];
  messages: DiverMessages;
  shop: ShopMessages;
  /** Gold in the purse and finds in the bag. */
  wallet: { gold: number; bag: number };
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
export function DiverHud({ diver, messages, shop, wallet, touch, actions }: Props) {
  const [hint, setHint] = useState(true);
  const leaping = diver.mode === "leap";
  useEffect(() => {
    // The hint waits for the leap to end: it is about what he can do now.
    if (leaping) return;
    const timer = window.setTimeout(() => setHint(false), HINT_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [leaping]);
  // Going over the side: only his own eyes, nothing in the way.
  if (leaping) return null;
  const inWater = diver.mode === "swim";
  const ashore = diver.mode === "land";
  const diving = inWater && diver.depth > 0.6;
  const lowAir = diving && diver.air < 0.15;
  const status =
    diver.mode === "deck"
      ? messages.onDeck
      : ashore
        ? diver.wading > 0.15 ? messages.wading : messages.ashore
        : diving ? messages.diving : messages.swimming;
  const promptText =
    diver.prompt === "helm"
      ? messages.takeHelm
      : diver.prompt === "board"
        ? messages.board
        : diver.prompt === "trade"
          ? shop.talkTrader
          : diver.prompt === "pickup"
            ? diver.promptDetail === "chest"
              ? shop.openChest
              : fill(shop.pickUp, { name: findName(shop, diver.promptDetail ?? "") })
            : null;

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
        {(inWater || ashore) && (
          <span className="diver-wallet" aria-label={`${shop.gold}: ${wallet.gold}, ${shop.bag}: ${wallet.bag}`}>
            <span className="diver-wallet-coin" aria-hidden="true" />
            {wallet.gold.toLocaleString()}
            {wallet.bag > 0 && <span className="diver-wallet-bag"><span aria-hidden="true">🎒</span>{wallet.bag}</span>}
          </span>
        )}
      </div>

      <button type="button" className="diver-backpack" onClick={actions.inventory} title={`${shop.invTitle} (Tab)`} aria-label={shop.invTitle}>
        <span aria-hidden="true">🎒</span>
        {wallet.bag > 0 && <span className="diver-backpack-count">{wallet.bag}</span>}
      </button>

      {actions.pause && (
        <button type="button" className="diver-pause" onClick={actions.pause} title="Menu (Esc)" aria-label="Menu">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        </button>
      )}

      <button type="button" className="diver-helm" onClick={actions.returnToHelm} title={`${messages.backToHelm} (T)`}>
        <span aria-hidden="true" className="diver-helm-wheel" />
        <span>{messages.backToHelm}</span>
      </button>

      {!touch && diver.pointerLocked && <span className="diver-crosshair" aria-hidden="true" />}

      {lowAir && <p className="diver-warning" role="alert">{messages.lowAir}</p>}

      {promptText && (
        <button type="button" className={`diver-prompt${diver.prompt === "pickup" && diver.promptDetail === "chest" ? " is-treasure" : ""}`} onClick={actions.interact}>
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
                {!diving && (
                  <button type="button" className="diver-button" onClick={actions.jump} aria-label={messages.jump}>
                    <span aria-hidden="true">⤒</span>
                  </button>
                )}
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
/**
 * The walking stick of a touch screen. It floats: the whole lower-left
 * corner of the screen is its pad, and it appears under the thumb wherever
 * the thumb comes down (a fixed stick has to be found by feel, and a thumb
 * that lands a little off it does nothing). The knob follows the thumb to
 * the rim; pushed all the way it is a run. At rest the stick waits, faint,
 * in its corner, to show where the pad is.
 */
function Stick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const padRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  /** Where the thumb landed, in the pad's own pixels (null: at rest in the corner). */
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const pointer = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const update = (clientX: number, clientY: number) => {
    const next = stickDeflection(clientX - start.current.x, clientY - start.current.y);
    setKnob(next);
    onMove(next.x, -next.y);
  };
  const release = (pointerId: number) => {
    if (pointer.current !== pointerId) return;
    pointer.current = null;
    setOrigin(null);
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };
  return (
    <div
      ref={padRef}
      className={`diver-stick-pad${origin ? " is-held" : ""}`}
      aria-hidden="true"
      onPointerDown={(event) => {
        if (pointer.current !== null) return;
        const pad = padRef.current;
        if (!pad) return;
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = pad.getBoundingClientRect();
        // The stick is drawn whole: never closer to the pad's edge than its own radius.
        const half = 60;
        const x = Math.min(Math.max(event.clientX - rect.left, half), Math.max(half, rect.width - half));
        const y = Math.min(Math.max(event.clientY - rect.top, half), Math.max(half, rect.height - half));
        start.current = { x: rect.left + x, y: rect.top + y };
        setOrigin({ x, y });
        update(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (pointer.current === event.pointerId) update(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => release(event.pointerId)}
      onPointerCancel={(event) => release(event.pointerId)}
      onLostPointerCapture={(event) => release(event.pointerId)}
    >
      <div className="diver-stick" style={origin ? { left: origin.x, top: origin.y, bottom: "auto", transform: "translate(-50%, -50%)" } : undefined}>
        <span className="diver-stick-knob" style={{ transform: `translate(${knob.x * STICK_REACH}px, ${knob.y * STICK_REACH}px)` }} />
      </div>
    </div>
  );
}
