"use client";

import { useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import type { LanguageCode } from "../i18n";
import type { StoryOverlayFrame } from "@/src/simulator/types";
import { distanceText, storyMessages } from "./storyMessages";

/**
 * Things pinned to the scene, moved every frame straight in the DOM (no
 * React render per frame): the waypoint (a diamond over the place, or an
 * arrow at the screen's edge when it is off-screen or behind), brackets
 * round the drones in sight (amber unaware, red hunting, grey blinded with
 * the winch's progress), and the hit marker of the last rifle shot.
 */

type Props = {
  /** The simulator calls `current` every frame. */
  listenerRef: MutableRefObject<((frame: StoryOverlayFrame) => void) | null>;
  language: LanguageCode;
  active: boolean;
  /** The yard crane's controls held or let go (the pad's buttons, for touch and mouse). */
  crane?: (control: CraneControl, down: boolean) => void;
};

export type CraneControl = "travel+" | "travel-" | "cross+" | "cross-" | "up" | "down" | "grab";

const DRONE_SLOTS = 6;
const EDGE = 46;

/**
 * The part of the screen an edge arrow may sit in: clear of the throttle on
 * the right, the instruments and the scene actions above, the helm below.
 */
function arrowBounds(width: number, height: number): { left: number; right: number; top: number; bottom: number } {
  const narrow = width < 760 || height < 520;
  return {
    left: narrow ? 30 : 40,
    right: width - (narrow ? 120 : 190),
    top: narrow ? 120 : 170,
    bottom: height - (narrow ? 120 : 150),
  };
}

export function StoryOverlay({ listenerRef, language, active, crane }: Props) {
  const markerRef = useRef<HTMLDivElement>(null);
  const markerLabel = useRef<HTMLSpanElement>(null);
  const droneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const droneLabels = useRef<(HTMLSpanElement | null)[]>([]);
  const hitRef = useRef<HTMLDivElement>(null);
  const gunnerRef = useRef<HTMLDivElement | null>(null);
  const gunnerHeat = useRef<HTMLSpanElement | null>(null);
  const craneRef = useRef<HTMLDivElement | null>(null);
  const craneState = useRef<HTMLSpanElement | null>(null);
  const hitLabel = useRef<HTMLSpanElement>(null);
  const lastHit = useRef(0);
  const pointer = useRef({ x: -1, y: -1 });
  const messagesRef = useRef(storyMessages(language));
  const words = storyMessages(language);

  useEffect(() => {
    messagesRef.current = storyMessages(language);
  }, [language]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current.x = event.clientX;
      pointer.current.y = event.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
    };
  }, []);

  useEffect(() => {
    if (!active) {
      listenerRef.current = null;
      return;
    }
    listenerRef.current = (frame) => {
      const messages = messagesRef.current;
      // The waypoint.
      const marker = markerRef.current;
      if (marker) {
        const target = frame.marker;
        if (!target) {
          marker.style.display = "none";
        } else {
          marker.style.display = "";
          const cx = frame.width / 2;
          const cy = frame.height / 2;
          let x = target.x;
          let y = target.y;
          // Behind the camera the projection is mirrored.
          if (!target.front) {
            x = cx - (x - cx);
            y = cy - (y - cy);
          }
          const bounds = arrowBounds(frame.width, frame.height);
          const inside = target.front && x > EDGE && x < frame.width - EDGE && y > EDGE && y < frame.height - EDGE;
          if (!inside && !target.front) {
            // Behind him: low on the side to turn to, pointing back and out.
            const right = target.side >= 0;
            x = right ? bounds.right : bounds.left;
            y = bounds.bottom;
            marker.style.setProperty("--turn", `${right ? Math.PI / 4 : (3 * Math.PI) / 4}rad`);
          } else if (!inside) {
            // Pinned to the edge of the clear part of the screen, along the way to it.
            const midX = (bounds.left + bounds.right) / 2;
            const midY = (bounds.top + bounds.bottom) / 2;
            let dx = x - midX;
            let dy = y - midY;
            if (!target.front && Math.abs(dy) < 1) dy = 1;
            const length = Math.hypot(dx, dy) || 1;
            dx /= length;
            dy /= length;
            const reach = Math.min((bounds.right - midX) / Math.max(1e-3, Math.abs(dx)), (bounds.bottom - midY) / Math.max(1e-3, Math.abs(dy)));
            x = midX + dx * reach;
            y = midY + dy * reach;
            marker.style.setProperty("--turn", `${Math.atan2(dy, dx)}rad`);
          }
          marker.classList.toggle("is-edge", !inside);
          marker.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          if (markerLabel.current) markerLabel.current.textContent = distanceText(target.distance, messages);
        }
      }
      // The drones.
      for (let index = 0; index < DRONE_SLOTS; index += 1) {
        const element = droneRefs.current[index];
        if (!element) continue;
        const drone = frame.drones[index];
        if (!drone || !drone.front || drone.x < -40 || drone.x > frame.width + 40 || drone.y < -40 || drone.y > frame.height + 40) {
          element.style.display = "none";
          continue;
        }
        element.style.display = "";
        const state = drone.condition === "blind" ? "blind" : !drone.hostile ? "passing" : drone.aware ? "hunting" : "unaware";
        element.dataset.state = state;
        const size = Math.max(26, Math.min(90, 2600 / Math.max(30, drone.distance)));
        element.style.setProperty("--size", `${size.toFixed(0)}px`);
        element.style.setProperty("--salvage", drone.salvage.toFixed(3));
        element.style.transform = `translate3d(${drone.x.toFixed(1)}px, ${drone.y.toFixed(1)}px, 0)`;
        const label = droneLabels.current[index];
        if (label) label.textContent = distanceText(drone.distance, messages);
      }
      // The last shot's result, at the crosshair (or the click).
      const hit = hitRef.current;
      if (hit && frame.hit.id !== lastHit.current) {
        lastHit.current = frame.hit.id;
        const result = frame.hit;
        const atPointer = pointer.current.x >= 0 && !document.pointerLockElement;
        const x = atPointer ? pointer.current.x : frame.width / 2;
        const y = atPointer ? pointer.current.y : frame.height / 2;
        hit.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        const kind = result.zone === "miss" ? "miss" : result.condition === "wrecked" ? "kill" : result.armour ? "armour" : "hit";
        hit.dataset.kind = kind;
        if (hitLabel.current) {
          hitLabel.current.textContent =
            result.zone === "miss"
              ? ""
              : frame.gunner
                ? result.condition === "wrecked"
                  ? messages.hitBoatWrecked
                  : result.condition === "stopped" && result.zone === "jet"
                    ? messages.hitBoatStopped
                    : ""
              : result.condition === "wrecked"
                ? messages.hitWrecked
                : result.condition === "blind" && result.zone === "dome"
                  ? messages.hitBlind
                  : result.condition === "stopped" && result.zone === "jet"
                    ? messages.hitStopped
                    : result.armour
                      ? messages.hitArmour
                      : result.zone === "dome"
                        ? messages.hitDome
                        : messages.hitJet;
        }
        hit.classList.remove("is-live");
        // Restart the animation.
        void hit.offsetWidth;
        hit.classList.add("is-live");
      }
      document.documentElement.classList.toggle("rifle-drawn", frame.rifle);
      // At the mounted gun: its sight in the middle, the barrel's heat under it.
      const cranePad = craneRef.current;
      if (cranePad) {
        cranePad.style.display = frame.crane ? "" : "none";
        if (frame.crane) {
          cranePad.classList.toggle("is-holding", frame.crane.holding);
          const state = craneState.current;
          const label = frame.crane.holding ? messagesRef.current.craneHolding : messagesRef.current.craneFree;
          if (state && state.textContent !== label) state.textContent = label;
        }
      }
      const gunner = gunnerRef.current;
      if (gunner) {
        gunner.style.display = frame.gunner ? "" : "none";
        if (frame.gunner) {
          gunner.classList.toggle("is-hot", frame.gunner.hot);
          if (gunnerHeat.current) gunnerHeat.current.style.transform = `scaleX(${frame.gunner.heat.toFixed(3)})`;
        }
      }
    };
    return () => {
      listenerRef.current = null;
      document.documentElement.classList.remove("rifle-drawn");
    };
  }, [active, listenerRef]);

  if (!active) return null;
  return (
    <div className="story-overlay" aria-hidden="true">
      <div ref={markerRef} className="story-marker" style={{ display: "none" }}>
        <span className="story-marker-diamond" />
        <span className="story-marker-arrow" />
        <span ref={markerLabel} className="story-marker-distance" />
      </div>
      {Array.from({ length: DRONE_SLOTS }, (_, index) => (
        <div
          key={index}
          ref={(element) => {
            droneRefs.current[index] = element;
          }}
          className="story-drone"
          style={{ display: "none" }}
        >
          <span className="story-drone-bracket" />
          <span className="story-drone-winch" />
          <span
            ref={(element) => {
              droneLabels.current[index] = element;
            }}
            className="story-drone-distance"
          />
        </div>
      ))}
      <div ref={craneRef} className="story-crane" style={{ display: "none" }}>
        <div className="story-crane-head">
          <span className="story-crane-title">{words.craneTitle}</span>
          <span ref={craneState} className="story-crane-state" />
        </div>
        <div className="story-crane-rows">
          {(
            [
              [words.craneTravel, "travel-", "S", "travel+", "W"],
              [words.craneCross, "cross-", "A", "cross+", "D"],
              [words.craneHoist, "down", "F", "up", "R"],
            ] as const
          ).map(([label, less, lessKey, more, moreKey]) => (
            <div key={label} className="story-crane-row">
              <span className="story-crane-label">{label}</span>
              <CraneButton control={less} glyph={lessKey} press={crane} />
              <CraneButton control={more} glyph={moreKey} press={crane} />
            </div>
          ))}
          <CraneButton control="grab" glyph={`␣ ${words.craneGrab}`} press={crane} wide />
        </div>
      </div>
      <div ref={gunnerRef} className="story-gunner" style={{ display: "none" }}>
        <span className="story-gunner-sight" />
        <span className="story-gunner-heat">
          <span ref={gunnerHeat} className="story-gunner-heat-fill" />
        </span>
        <span className="story-gunner-label">{storyMessages(language).gunnerHeat}</span>
      </div>
      <div ref={hitRef} className="story-hit">
        <span className="story-hit-cross" />
        <span ref={hitLabel} className="story-hit-label" />
      </div>
    </div>
  );
}

/** One of the crane pad's buttons: held while pressed (the grab acts once), the key it stands for shown on it. */
function CraneButton({ control, glyph, press, wide = false }: { control: CraneControl; glyph: string; press?: (control: CraneControl, down: boolean) => void; wide?: boolean }) {
  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    press?.(control, false);
  };
  return (
    <button
      type="button"
      className={`story-crane-key${wide ? " is-wide" : ""}`}
      tabIndex={-1}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        press?.(control, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {glyph}
    </button>
  );
}
