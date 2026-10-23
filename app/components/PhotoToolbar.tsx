"use client";

import { useEffect, useRef, useState } from "react";
import type { FeatureMessages } from "./featureMessages";

type PhotoToolbarProps = {
  messages: FeatureMessages;
  /** Localised "Sound: on" / "Sound: off" style label for the sound button. */
  soundLabel: string;
  soundOn: boolean;
  autoAim: boolean;
  touch: boolean;
  onAutoAim: (enabled: boolean) => void;
  /** Called inside the pointer gesture, so sound can be unlocked on iOS. */
  onSound: () => void;
  capture: () => Promise<Blob | null>;
};

/** File name for a photo taken now, e.g. `sailing-2026-10-23-14-05-09.jpg`. */
export function photoFileName(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `sailing-${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}.jpg`;
}

/**
 * Photo mode's own three buttons, top left and half transparent so they keep
 * out of the picture: auto-aim at events, take a photo (saved to the device),
 * and sound. They sit outside the hidden interface and the canvas, so a
 * press never ends photo mode or turns the camera.
 */
export function PhotoToolbar({ messages, soundLabel, soundOn, autoAim, touch, onAutoAim, onSound, capture }: PhotoToolbarProps) {
  const [toast, setToast] = useState("");
  const [flash, setFlash] = useState(0);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const say = (text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  const takePhoto = async () => {
    if (busy) return;
    setBusy(true);
    setFlash((value) => value + 1);
    try {
      const blob = await capture();
      if (!blob) throw new Error("no image");
      const name = photoFileName(new Date());
      const file = typeof File !== "undefined" ? new File([blob], name, { type: blob.type || "image/jpeg" }) : null;
      // On phones the share sheet is how a picture reaches the photo library.
      if (touch && file && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          say(messages.photoSaved);
          return;
        } catch (error) {
          // Dismissing the share sheet is not a failure; anything else falls back to a download.
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      say(messages.photoSaved);
    } catch {
      say(messages.photoFailed);
    } finally {
      setBusy(false);
    }
  };

  const aimLabel = autoAim ? messages.photoAutoAimOn : messages.photoAutoAimOff;
  return (
    <>
      <div className="photo-toolbar" role="toolbar" aria-label={messages.photoTools}>
        <button
          type="button"
          className={`photo-tool${autoAim ? " is-active" : ""}`}
          aria-pressed={autoAim}
          aria-label={messages.photoAutoAim}
          title={aimLabel}
          onClick={() => {
            onAutoAim(!autoAim);
            say(autoAim ? messages.photoAutoAimOff : messages.photoAutoAimOn);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="6.5" />
            <circle cx="12" cy="12" r="1.6" />
            <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
          </svg>
        </button>
        <button
          type="button"
          className="photo-tool photo-shutter"
          aria-label={messages.photoTake}
          title={messages.photoTake}
          disabled={busy}
          onClick={() => void takePhoto()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 7h3.5l1.8-2.6h5.4L16.5 7H20a1 1 0 0 1 1 1v10.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />
            <circle cx="12" cy="13" r="3.8" />
          </svg>
        </button>
        <button
          type="button"
          className={`photo-tool${soundOn ? " is-active" : ""}`}
          aria-pressed={soundOn}
          aria-label={soundLabel}
          title={soundLabel}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            onSound();
          }}
          onClick={(event) => {
            // Keyboard presses arrive as a click with no pointer before them.
            if (event.detail === 0) onSound();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
            {soundOn ? <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
          </svg>
        </button>
      </div>
      {flash > 0 && <div key={flash} className="photo-flash" aria-hidden="true" />}
      <p className="photo-toolbar-status" role="status" aria-live="polite">
        {toast}
      </p>
    </>
  );
}
