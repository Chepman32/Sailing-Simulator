"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
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
};

const DRONE_SLOTS = 6;
const EDGE = 46;

export function StoryOverlay({ listenerRef, language, active }: Props) {
  const markerRef = useRef<HTMLDivElement>(null);
  const markerLabel = useRef<HTMLSpanElement>(null);
  const droneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const droneLabels = useRef<(HTMLSpanElement | null)[]>([]);
  const hitRef = useRef<HTMLDivElement>(null);
  const hitLabel = useRef<HTMLSpanElement>(null);
  const lastHit = useRef(0);
  const pointer = useRef({ x: -1, y: -1 });
  const messagesRef = useRef(storyMessages(language));

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
          const inside = target.front && x > EDGE && x < frame.width - EDGE && y > EDGE && y < frame.height - EDGE;
          if (!inside) {
            // Pinned to the screen's edge along the way to it.
            let dx = x - cx;
            let dy = y - cy;
            if (!target.front && Math.abs(dy) < 1) dy = 1;
            const length = Math.hypot(dx, dy) || 1;
            dx /= length;
            dy /= length;
            const reach = Math.min((cx - EDGE) / Math.max(1e-3, Math.abs(dx)), (cy - EDGE) / Math.max(1e-3, Math.abs(dy)));
            x = cx + dx * reach;
            y = cy + dy * reach;
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
      <div ref={hitRef} className="story-hit">
        <span className="story-hit-cross" />
        <span ref={hitLabel} className="story-hit-label" />
      </div>
    </div>
  );
}
