"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { EMPTY_SNAPSHOT } from "@/src/simulator/state";
import type { Simulator as SimulatorInstance } from "@/src/simulator/Simulator";
import type { CameraMode, Discovery, LightingMode, LoadingState, QualityChoice } from "@/src/simulator/types";
import { WEATHER_KINDS, type WeatherKind, type WeatherMode } from "@/src/simulator/environment/WeatherMath";
import { SoundPrompt } from "./SoundPrompt";
import { usePwaInstall } from "./usePwaInstall";
import { gravityRollDegrees, requestTiltPermission, screenAngle, screenRollDegrees, STEERING_STORAGE_KEY, swipeToRudder, tiltToRudder, wheelToRudder } from "./steering";
import { featureText, getFeatureMessages } from "./featureMessages";
import { ChartView } from "./ChartView";
import {
  DiscoveryCard,
  LootChip,
  QuickStart,
  RadioPlayer,
  SignalButtons,
  StationBanner,
  stationInfo,
  StuckChip,
  VoyageIcon,
  type DiscoveryView,
} from "./VoyageUI";
import {
  getMessages,
  isLanguageCode,
  isRtlLanguage,
  LANGUAGE_OPTIONS,
  LANGUAGE_STORAGE_KEY,
  resolveLanguagePreference,
  type LanguageCode,
  type Messages,
} from "./i18n";

function photoFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `sailing-simulator-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`;
}

/** Save a photo: the share sheet on touch devices (Save to Photos), a download elsewhere. */
async function savePhoto(blob: Blob): Promise<void> {
  const name = photoFileName();
  const file = typeof File !== "undefined" ? new File([blob], name, { type: "image/jpeg" }) : null;
  if (window.matchMedia("(pointer: coarse)").matches && file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch {
      // Cancelled or blocked: fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const ASSET_LOAD_TOTAL = 6;
/** Set once the first-run guide has been finished or skipped. */
const GUIDE_STORAGE_KEY = "sailing-onboarding-done";
const SAIL_SWATCHES: { id: string; color: string }[] = [
  { id: "white", color: "#dcd8ca" },
  { id: "sunset", color: "#f06a3c" },
  { id: "lagoon", color: "#2bb7b3" },
  { id: "royal", color: "#4f46c8" },
  { id: "gold", color: "#e8b23c" },
  { id: "flamingo", color: "#f47fb8" },
  { id: "pirate", color: "#232328" },
];

function readGuideDone(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

/** Typing in a field (or a slider's own arrow keys) is not a command. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return (target as HTMLInputElement).type !== "range";
  return false;
}

type ControlIconName =
  | "sun"
  | "moon"
  | "power"
  | "sound-on"
  | "sound-off"
  | "engine-sound"
  | "engine-muted"
  | "chase"
  | "helm"
  | "orbit"
  | "drone"
  | "reset"
  | "photo"
  | "map"
  | "close"
  | "target"
  | "shutter"
  | "tilt"
  | "auto-time"
  | "clear"
  | "cloudy"
  | "overcast"
  | "rain"
  | "downpour"
  | "storm"
  | "hurricane";

function ControlIcon({ name }: { name: ControlIconName }) {
  return (
    <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "reset" && <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />}
      {name === "photo" && (
        <>
          <path d="M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
          <circle cx="12" cy="13" r="4" />
        </>
      )}
      {name === "map" && (
        <>
          <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z" />
          <path d="M9 4v13.5M15 6.5V20" />
        </>
      )}
      {name === "close" && <path d="M6 6l12 12M18 6 6 18" />}
      {name === "target" && (
        <>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2.3" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
        </>
      )}
      {name === "shutter" && (
        <>
          <path d="M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
          <circle cx="12" cy="13" r="4" />
          <circle cx="12" cy="13" r="1.4" />
        </>
      )}
      {name === "tilt" && (
        <>
          <rect x="7.5" y="3.5" width="9" height="17" rx="2" transform="rotate(-18 12 12)" />
          <path d="M3 9.5a9 9 0 0 1 2.4-4.2M21 14.5a9 9 0 0 1-2.4 4.2" />
        </>
      )}
      {name === "sun" && (
        <>
          <circle cx="12" cy="12" r="3.4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
        </>
      )}
      {name === "auto-time" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3.2 2" />
        </>
      )}
      {name === "clear" && (
        <>
          <circle cx="12" cy="12" r="3.4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
        </>
      )}
      {(name === "cloudy" || name === "overcast") && (
        <>
          <path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.2 4.4 4.4 0 0 0 7 18Z" />
          {name === "cloudy" && <path d="M4 5.5l1 1M8 3.5v1.4" />}
        </>
      )}
      {(name === "rain" || name === "downpour") && (
        <>
          <path d="M7 14h10a3.6 3.6 0 0 0 .5-7.15A5 5 0 0 0 7.2 6.2 3.9 3.9 0 0 0 7 14Z" />
          <path d={name === "rain" ? "M9 17l-1 2.5M13 17l-1 2.5M17 17l-1 2.5" : "M8 16.5l-1.4 4M12 16.5l-1.4 4M16 16.5l-1.4 4M10 18l-.8 2.5M14 18l-.8 2.5"} />
        </>
      )}
      {name === "storm" && (
        <>
          <path d="M7 13h10a3.6 3.6 0 0 0 .5-7.15A5 5 0 0 0 7.2 5.2 3.9 3.9 0 0 0 7 13Z" />
          <path d="m12.5 12-2.6 4.4h3L11.2 21" />
        </>
      )}
      {name === "hurricane" && (
        <>
          <path d="M4 8h11a3 3 0 1 0-3-3M3 12.5h16a3 3 0 1 1-3 3M6 17h7a2.5 2.5 0 1 1-2.5 2.5" />
        </>
      )}
      {name === "moon" && <path d="M20.2 15.1A8.2 8.2 0 0 1 8.9 3.8 8.3 8.3 0 1 0 20.2 15.1Z" />}
      {name === "power" && (
        <>
          <path d="M12 2.8v8.1" />
          <path d="M7.2 5.8a8 8 0 1 0 9.6 0" />
        </>
      )}
      {(name === "sound-on" || name === "sound-off") && (
        <>
          <path d="M4 10h3.1l4.2-3.6v11.2L7.1 14H4Z" />
          {name === "sound-on" ? (
            <path d="M15 9a4.4 4.4 0 0 1 0 6M17.8 6.5a7.8 7.8 0 0 1 0 11" />
          ) : (
            <path d="m15.3 10 4 4M19.3 10l-4 4" />
          )}
        </>
      )}
      {(name === "engine-sound" || name === "engine-muted") && (
        <>
          <path d="M3 10h2.2l1.7-2.4h6.9l1.7 2.4H18v7H6.2l-1.4-2H3Z" />
          <path d="M8.2 7.6V5.2h4.3M18 11.2h2M20 9.5v5" />
          {name === "engine-sound" ? <path d="M8.5 12.2h3.4M8.5 14.8h5.4" /> : <path d="M5 5l14 14" />}
        </>
      )}
      {name === "chase" && (
        <>
          <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
          <path d="m8 14 4-6 4 6-4 2Z" />
        </>
      )}
      {name === "helm" && (
        <>
          <circle cx="12" cy="12" r="7.5" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 4.5v5.5M12 14v5.5M4.5 12H10M14 12h5.5M6.7 6.7l3.9 3.9M13.4 13.4l3.9 3.9M17.3 6.7l-3.9 3.9M10.6 13.4l-3.9 3.9" />
        </>
      )}
      {name === "orbit" && (
        <>
          <circle cx="12" cy="12" r="2.4" />
          <path d="M4.3 10A8 8 0 0 1 18 6.5l1.5 1.2M19.7 14A8 8 0 0 1 6 17.5l-1.5-1.2" />
          <path d="m19.7 4.5-.2 3.2-3.2-.2M4.3 19.5l.2-3.2 3.2.2" />
        </>
      )}
      {name === "drone" && (
        <>
          <rect x="9" y="9" width="6" height="6" rx="1.5" />
          <path d="M9.4 9.4 6.5 6.5M14.6 9.4l2.9-2.9M9.4 14.6l-2.9 2.9M14.6 14.6l2.9 2.9" />
          <circle cx="5" cy="5" r="2" /><circle cx="19" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
        </>
      )}
    </svg>
  );
}

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function throttleLabel(value: number, messages: Messages): string {
  if (value > 0.84) return messages.fullAhead;
  if (value > 0.5) return messages.halfAhead;
  if (value > 0.08) return messages.slowAhead;
  if (value < -0.84) return messages.fullAstern;
  if (value < -0.5) return messages.halfAstern;
  if (value < -0.08) return messages.slowAstern;
  return messages.neutral;
}

export function SailingSimulator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const rudderRef = useRef<HTMLElement | null>(null);
  const simulatorRef = useRef<SimulatorInstance | null>(null);
  const photoButtonRef = useRef<HTMLButtonElement>(null);
  const photoModeRef = useRef(false);
  const [photoMode, setPhotoMode] = useState(false);
  const [tiltSteering, setTiltSteering] = useState(false);
  const [portraitPhone, setPortraitPhone] = useState(false);
  const [rotateHintDismissed, setRotateHintDismissed] = useState(true);
  const wheelSwipe = useRef<{ pointerId: number; startX: number; startRudder: number } | null>(null);
  const tiltNeutral = useRef<number | null>(null);
  const [photoFlash, setPhotoFlash] = useState(0);
  const [photoSaved, setPhotoSaved] = useState(false);
  const [photoHint, setPhotoHint] = useState(false);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState<LoadingState>({
    loaded: 0,
    total: ASSET_LOAD_TOTAL,
    label: "Preparing renderer",
    ready: false,
  });
  const [error, setError] = useState("");
  const [panelMinimized, setPanelMinimized] = useState(true);
  const [chartOpen, setChartOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  // Any press outside the open control panel closes it (the press still does
  // what it does: steer, look around, press another control).
  useEffect(() => {
    if (panelMinimized) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      setPanelMinimized(true);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [panelMinimized]);
  const [showHelp, setShowHelp] = useState(true);
  const [rudderInput, setRudderInput] = useState(0);
  const [throttleInput, setThrottleInput] = useState(0);
  const [engineInput, setEngineInput] = useState(false);
  const [engineNotice, setEngineNotice] = useState("");
  const [noticeKey, setNoticeKey] = useState(0);
  const [language, setLanguage] = useState<LanguageCode>("en");
  const rudderDragging = useRef(false);
  const swipeStart = useRef<{ x: number; value: number; width: number } | null>(null);
  const throttleDragging = useRef(false);
  const soundReadyAtPress = useRef(false);
  const soundDockRef = useRef<HTMLButtonElement>(null);
  const soundDockUnlocked = useRef(false);
  const [soundArrived, setSoundArrived] = useState(false);
  const soundArrivedTimer = useRef<number | undefined>(undefined);
  const onSoundPromptArrived = useCallback(() => {
    // The dust has settled into the corner button: let it glow for a moment.
    setSoundArrived(true);
    if (soundArrivedTimer.current !== undefined) window.clearTimeout(soundArrivedTimer.current);
    soundArrivedTimer.current = window.setTimeout(() => setSoundArrived(false), 900);
  }, []);
  useEffect(() => () => window.clearTimeout(soundArrivedTimer.current), []);
  const engineNoticeTimer = useRef<number | undefined>(undefined);
  // Finds and discoveries wait their turn for the card at the top.
  const [discoveries, setDiscoveries] = useState<DiscoveryView[]>([]);
  const discoveryId = useRef(0);
  const [stationBanner, setStationBanner] = useState<{ id: string; key: number } | null>(null);
  const [radioVolume, setRadioVolume] = useState(0.7);
  const [panelTab, setPanelTab] = useState<"scene" | "yacht">("scene");
  const [confirmRestart, setConfirmRestart] = useState(false);
  const { canInstall, install: installApp } = usePwaInstall();
  // First-run guide: 1–3 while it runs, 0 once done (decided after mount, from storage).
  const [guideStep, setGuideStep] = useState(0);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const finishGuide = useCallback(() => {
    setGuideStep(0);
    try {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, "1");
    } catch {
      // The guide simply shows again next time.
    }
  }, []);

  // Keep the phone awake while the yacht is on screen: a screen that dims in the middle of a passage is the
  // most common complaint of a handheld sim. The lock is released by the browser whenever the page is hidden,
  // so it is requested again each time the page becomes visible.
  useEffect(() => {
    type WakeLockHandle = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockHandle> } };
    if (!nav.wakeLock) return;
    let lock: WakeLockHandle | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible" || lock) return;
      try {
        const handle = await nav.wakeLock!.request("screen");
        if (disposed) {
          void handle.release().catch(() => undefined);
          return;
        }
        lock = handle;
        (handle as unknown as EventTarget).addEventListener?.("release", () => {
          if (lock === handle) lock = null;
        });
      } catch {
        // Denied (battery saver, permissions policy): the screen simply dims as usual.
      }
    };
    const onVisibility = () => void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    void acquire();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
      lock = null;
    };
  }, []);

  const exitPhotoMode = useCallback(() => {
    photoModeRef.current = false;
    setPhotoMode(false);
    simulatorRef.current?.setPhotoMode(false);
  }, []);

  useEffect(() => {
    if (!photoMode) return;
    const photoButton = photoButtonRef.current;
    canvasRef.current?.focus({ preventScroll: true });
    // The interface is hidden in photo mode, so say once how to get it back.
    setPhotoHint(true);
    const hintTimer = window.setTimeout(() => setPhotoHint(false), 3200);
    const onKeyDown = (event: KeyboardEvent) => {
      // Tab restores the interface as well, so keyboard users cannot end up
      // navigating invisible controls or trapped on the canvas.
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        exitPhotoMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    // One tap or click on the picture ends photo mode. A drag still frames
    // the shot (the camera gestures keep working), so only a short press that
    // barely moved counts as a tap.
    const canvas = canvasRef.current;
    let pressX = 0;
    let pressY = 0;
    let pressTime = 0;
    let pressId = -1;
    let pointers = 0;
    const onPointerDown = (event: PointerEvent) => {
      pointers += 1;
      if (pointers > 1) {
        pressId = -1;
        return;
      }
      pressId = event.pointerId;
      pressX = event.clientX;
      pressY = event.clientY;
      pressTime = event.timeStamp;
    };
    const onPointerUp = (event: PointerEvent) => {
      pointers = Math.max(0, pointers - 1);
      if (event.pointerId !== pressId) return;
      pressId = -1;
      const moved = Math.hypot(event.clientX - pressX, event.clientY - pressY);
      if (moved < 10 && event.timeStamp - pressTime < 450) exitPhotoMode();
    };
    const onPointerCancel = () => {
      pointers = Math.max(0, pointers - 1);
      pressId = -1;
    };
    canvas?.addEventListener("pointerdown", onPointerDown);
    canvas?.addEventListener("pointerup", onPointerUp);
    canvas?.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.clearTimeout(hintTimer);
      setPhotoHint(false);
      window.removeEventListener("keydown", onKeyDown);
      canvas?.removeEventListener("pointerdown", onPointerDown);
      canvas?.removeEventListener("pointerup", onPointerUp);
      canvas?.removeEventListener("pointercancel", onPointerCancel);
      photoButton?.focus({ preventScroll: true });
    };
  }, [photoMode, exitPhotoMode]);

  // Phone in portrait: offer the rotate hint. Also restore the saved steering mode.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 680px) and (orientation: portrait)");
    const update = () => setPortraitPhone(query.matches);
    const restore = () => {
      try {
        setRotateHintDismissed(window.sessionStorage.getItem("sailing-simulator-rotate-hint-dismissed") === "1");
        setTiltSteering(window.localStorage.getItem(STEERING_STORAGE_KEY) === "tilt" && window.matchMedia("(pointer: coarse)").matches);
      } catch {
        setRotateHintDismissed(false);
      }
    };
    update();
    restore();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Tilt steering: turn the phone like a steering wheel. The wheel angle is
  // read from gravity in the plane of the screen (devicemotion), which works
  // upright or tilted back, in portrait or landscape; its zero is the pose
  // the phone was in when tilt was switched on (or the rudder centred).
  // Devices that report only orientation fall back to its roll; a device
  // that reports neither (a laptop) turns tilt off again and says so.
  useEffect(() => {
    if (!tiltSteering) return;
    tiltNeutral.current = null;
    let lastSent = 0;
    let motionSeen = false;
    let anySeen = false;
    let smoothed: number | null = null;
    // Turning the phone between portrait and landscape rotates the screen's
    // axes by a quarter turn, and browsers report the new angle at slightly
    // different moments from the motion itself (iOS sometimes off by a half
    // turn in landscape). Rather than trust the angle, the wheel is re-zeroed
    // once the turn has settled: the pose the player holds the phone in after
    // turning it is straight ahead, the helm is held amidships meanwhile.
    let lastAngle = screenAngle();
    let settleUntil = 0;
    const resettle = () => {
      tiltNeutral.current = null;
      smoothed = null;
      settleUntil = performance.now() + 450;
      lastSent = 0;
      send(0, true);
    };
    const settling = () => {
      const angle = screenAngle();
      if (angle !== lastAngle) {
        lastAngle = angle;
        resettle();
      }
      return performance.now() < settleUntil;
    };
    const send = (rudder: number, force = false) => {
      const now = performance.now();
      if (!force && now - lastSent < 33) return;
      lastSent = now;
      simulatorRef.current?.setRudder(rudder);
      setRudderInput(Math.round(rudder * 100));
    };
    const onMotion = (event: DeviceMotionEvent) => {
      const gravity = event.accelerationIncludingGravity;
      motionSeen = true;
      anySeen = true;
      if (settling()) return;
      const roll = gravityRollDegrees(gravity?.x ?? null, gravity?.y ?? null, lastAngle);
      if (roll === null) return;
      // A little smoothing takes out the hand's jitter without lag you can feel.
      smoothed = smoothed === null ? roll : smoothed + (((roll - smoothed + 540) % 360) - 180) * 0.35;
      if (tiltNeutral.current === null) tiltNeutral.current = smoothed;
      send(wheelToRudder(smoothed, tiltNeutral.current));
    };
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null && event.gamma === null) return;
      anySeen = true;
      if (motionSeen || settling()) return;
      const roll = screenRollDegrees({ beta: event.beta, gamma: event.gamma }, lastAngle);
      if (tiltNeutral.current === null) tiltNeutral.current = roll;
      send(tiltToRudder(roll, tiltNeutral.current));
    };
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrientation);
    // Some browsers report the turn only through these events.
    const orientationQuery = window.matchMedia("(orientation: portrait)");
    orientationQuery.addEventListener("change", resettle);
    window.addEventListener("orientationchange", resettle);
    screen.orientation?.addEventListener?.("change", resettle);
    const check = window.setTimeout(() => {
      if (anySeen) return;
      setTiltSteering(false);
      setEngineNotice(getFeatureMessages(language).tiltUnavailable);
      setNoticeKey((key) => key + 1);
      window.clearTimeout(engineNoticeTimer.current);
      engineNoticeTimer.current = window.setTimeout(() => setEngineNotice(""), 2400);
      try {
        window.localStorage.setItem(STEERING_STORAGE_KEY, "slider");
      } catch {
        // Nothing to undo.
      }
    }, 1800);
    return () => {
      window.clearTimeout(check);
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onOrientation);
      orientationQuery.removeEventListener("change", resettle);
      window.removeEventListener("orientationchange", resettle);
      screen.orientation?.removeEventListener?.("change", resettle);
    };
  }, [tiltSteering, language]);

  const messages = useMemo(() => getMessages(language), [language]);
  const voyage = useMemo(() => getFeatureMessages(language), [language]);
  const closeChart = useCallback(() => setChartOpen(false), []);
  // Callbacks the simulator holds for its lifetime reach the current render through this.
  type LatestHandlers = { keyAction: (action: string) => void; discovery: (discovery: Discovery) => void; radioFailed: (station: string) => void };
  const latest = useRef<LatestHandlers>({ keyAction: () => {}, discovery: () => {}, radioFailed: () => {} });
  const cameraLabels = useMemo<Record<CameraMode, string>>(() => ({
    chase: messages.chase,
    helm: messages.helm,
    orbit: messages.orbit,
    drone: messages.drone,
  }), [messages]);
  const qualityLabels = useMemo<Record<QualityChoice, string>>(() => ({
    auto: messages.auto,
    low: messages.low,
    medium: messages.medium,
    high: messages.high,
  }), [messages]);

  useEffect(() => {
    const applyPreferredLanguage = () => {
      const stored = readStoredLanguage();
      const systemLanguages = [
        ...(navigator.languages ?? []),
        navigator.language,
        Intl.DateTimeFormat().resolvedOptions().locale,
      ].filter((candidate): candidate is string => Boolean(candidate));
      const nextLanguage = resolveLanguagePreference(stored, systemLanguages);
      setLanguage(nextLanguage);
      document.documentElement.lang = nextLanguage;
      document.documentElement.dir = isRtlLanguage(nextLanguage) ? "rtl" : "ltr";
    };
    applyPreferredLanguage();
    const followsSystemLanguage = !isLanguageCode(readStoredLanguage() ?? "");
    if (followsSystemLanguage) window.addEventListener("languagechange", applyPreferredLanguage);
    return () => window.removeEventListener("languagechange", applyPreferredLanguage);
  }, []);

  useEffect(() => {
    if (!rudderDragging.current && !wheelSwipe.current) setRudderInput(Math.round(snapshot.rudderDegrees / 35 * 100));
  }, [snapshot.rudderDegrees]);

  useEffect(() => {
    if (!throttleDragging.current) setThrottleInput(Math.round(snapshot.throttle * 100));
  }, [snapshot.throttle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let simulator: SimulatorInstance | undefined;

    void (async () => {
      try {
        // Three.js initializes a default LoadingManager at module evaluation
        // time. Import it only after the component mounts so the Cloudflare
        // server bundle never executes browser-only Three.js globals.
        const simulatorModule = await import("@/src/simulator/Simulator");
        if (disposed) return;
        // Client-only facts, read once the page is in the browser.
        setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
        if (!readGuideDone()) setGuideStep(1);
        simulator = new simulatorModule.Simulator(canvas, {
          onSnapshot: (nextSnapshot) => {
            setSnapshot(nextSnapshot);
            setEngineInput(nextSnapshot.engineRunning);
            // The first-run guide ticks itself off as the player does each thing.
            setGuideStep((step) => {
              if (step === 1 && (nextSnapshot.engineRunning || nextSnapshot.speedKnots > 1.2)) return 2;
              if (step === 2 && Math.abs(nextSnapshot.rudderDegrees) > 8) return 3;
              return step;
            });
          },
          onLoading: setLoading,
          onError: (message) => {
            exitPhotoMode();
            setError(message);
          },
          onSceneDoubleTap: () => {
            if (!photoModeRef.current) return false;
            exitPhotoMode();
            return true;
          },
          onKeyAction: (action) => latest.current.keyAction(action),
          onDiscovery: (discovery) => latest.current.discovery(discovery),
          onRadioFailed: (station) => latest.current.radioFailed(station),
        });
        simulatorRef.current = simulator;
        // Development builds only: lets visual checks drive the scene from a
        // headless browser (camera, engine) without clicking through the UI.
        if (process.env.NODE_ENV !== "production") (window as unknown as { __simulator?: SimulatorInstance }).__simulator = simulator;
        await simulator.init();
      } catch (reason: unknown) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : "The simulator could not start.");
        }
      }
    })();

    return () => {
      disposed = true;
      if (engineNoticeTimer.current !== undefined) window.clearTimeout(engineNoticeTimer.current);
      simulator?.dispose();
      if (simulatorRef.current === simulator) simulatorRef.current = null;
    };
  }, [exitPhotoMode]);

  const progress = loading.total > 0 ? Math.round((loading.loaded / loading.total) * 100) : 0;
  const compass = useMemo(() => `${snapshot.headingDegrees.toFixed(0).padStart(3, "0")}°`, [snapshot.headingDegrees]);
  const displayedRudderDegrees = rudderInput * 0.35;
  const displayedThrottle = throttleInput / 100;
  const wheelRotation = rudderInput * 2.7;

  const setLighting = (mode: LightingMode) => simulatorRef.current?.setLightingMode(mode);
  const weatherLabels: Record<WeatherKind, string> = {
    clear: messages.weatherClear,
    cloudy: messages.weatherCloudy,
    overcast: messages.weatherOvercast,
    rain: messages.weatherRain,
    downpour: messages.weatherDownpour,
    storm: messages.weatherStorm,
    hurricane: messages.weatherHurricane,
  };
  const setCamera = (mode: CameraMode) => simulatorRef.current?.setCameraMode(mode);
  const setQuality = (preset: QualityChoice) => {
    simulatorRef.current?.setQuality(preset);
    showNotice(`${messages.quality}: ${qualityLabels[preset]}`);
  };
  /** A plaque naming what a switch has just done, for a couple of seconds. */
  const showNotice = (text: string) => {
    setEngineNotice(text);
    setNoticeKey((key) => key + 1);
    if (engineNoticeTimer.current !== undefined) window.clearTimeout(engineNoticeTimer.current);
    engineNoticeTimer.current = window.setTimeout(() => setEngineNotice(""), 2400);
  };
  const resetScene = () => {
    if (!loading.ready || error) return;
    rudderDragging.current = false;
    throttleDragging.current = false;
    setRudderInput(0);
    setThrottleInput(0);
    setEngineNotice("");
    if (engineNoticeTimer.current !== undefined) window.clearTimeout(engineNoticeTimer.current);
    simulatorRef.current?.reset();
    showNotice(messages.reset);
  };
  const setEngineRunning = (running: boolean) => {
    const simulator = simulatorRef.current;
    if (!simulator || !loading.ready) return;
    simulator.resumeAudioFromGesture();
    // A short tick under the thumb confirms the switch on phones without sound; ignored where unsupported.
    try { navigator.vibrate?.(running ? 18 : 10); } catch { /* not available */ }
    setEngineInput(running);
    if (!running) {
      throttleDragging.current = false;
      setThrottleInput(0);
    }
    simulator.setEngineRunning(running);
    const activeThrottle = running && Math.abs(displayedThrottle) <= 0.08 ? 0.12 : displayedThrottle;
    showNotice(
      running
        ? `${messages.engine}: ${messages.on} · ${throttleLabel(activeThrottle, messages)}`
        : `${messages.engine}: ${messages.off} · ${messages.throttle}: ${messages.neutral}`,
    );
    navigator.vibrate?.(running ? 24 : 14);
  };

  const ready = loading.ready && !error;
  const toggleTilt = async () => {
    if (tiltSteering) {
      setTiltSteering(false);
      try {
        window.localStorage.setItem(STEERING_STORAGE_KEY, "slider");
      } catch {
        // The choice then lasts for this visit only.
      }
      return;
    }
    // The permission prompt must come straight from this tap on iOS.
    if (!(await requestTiltPermission())) {
      showNotice(voyage.tiltUnavailable);
      return;
    }
    setTiltSteering(true);
    showNotice(voyage.tiltOn);
    try {
      window.localStorage.setItem(STEERING_STORAGE_KEY, "tilt");
    } catch {
      // The choice then lasts for this visit only.
    }
  };
  const onWheelPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tiltSteering) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    wheelSwipe.current = { pointerId: event.pointerId, startX: event.clientX, startRudder: rudderInput / 100 };
  };
  const onWheelPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const swipe = wheelSwipe.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const rudder = swipeToRudder(swipe.startRudder, event.clientX - swipe.startX);
    setRudderInput(Math.round(rudder * 100));
    simulatorRef.current?.setRudder(rudder);
  };
  const endWheelSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (wheelSwipe.current?.pointerId === event.pointerId) wheelSwipe.current = null;
  };
  const dismissRotateHint = () => {
    setRotateHintDismissed(true);
    try {
      window.sessionStorage.setItem("sailing-simulator-rotate-hint-dismissed", "1");
    } catch {
      // Shown again next visit.
    }
  };
  const stations = stationInfo(voyage);

  const handlers: LatestHandlers = {
    keyAction: (action) => {
      if (action === "engine-on") showNotice(voyage.engineOnKey);
    },
    discovery: (discovery) => {
      discoveryId.current += 1;
      const view = { ...discovery, id: discoveryId.current };
      setDiscoveries((queue) => [...queue.slice(-3), view]);
      try { navigator.vibrate?.(discovery.kind === "poi" ? [20, 40, 20] : 16); } catch { /* not available */ }
    },
    radioFailed: () => showNotice(voyage.radioFailed),
  };
  useEffect(() => {
    latest.current = handlers;
  });

  const closeDiscovery = useCallback(() => setDiscoveries((queue) => queue.slice(1)), []);

  /** Horn or bell: they start the sound if needed, but never against the sound switch. */
  const playSignal = (signal: "horn" | "bell") => {
    const simulator = simulatorRef.current;
    if (!simulator || !ready) return;
    void simulator.playSignal(signal).then((result) => {
      if (result === "muted") showNotice(voyage.soundOffHint);
    });
  };
  const launchFlare = (color: "red" | "green") => {
    const simulator = simulatorRef.current;
    if (!simulator || !ready) return;
    const fired = simulator.launchFlare(color);
    showNotice(fired ? `${color === "red" ? voyage.flareRed : voyage.flareGreen} · ${voyage.flareFired}` : voyage.flareReloading);
    if (fired) {
      try { navigator.vibrate?.(22); } catch { /* not available */ }
    }
  };
  const tuneRadio = (station: string | null) => {
    const simulator = simulatorRef.current;
    if (!simulator || !ready) return;
    simulator.setRadio(station as Parameters<SimulatorInstance["setRadio"]>[0]);
    if (station) setStationBanner((banner) => ({ id: station, key: (banner?.key ?? 0) + 1 }));
    else showNotice(voyage.radioOff);
  };
  const stepRadio = (direction: 1 | -1) => {
    const simulator = simulatorRef.current;
    if (!simulator || !ready) return;
    const ids = stations.map((station) => station.id);
    const index = snapshot.radioStation ? ids.indexOf(snapshot.radioStation) : direction > 0 ? -1 : 0;
    const next = ids[(index + direction + ids.length) % ids.length]!;
    tuneRadio(next);
  };
  const rescueBoat = () => {
    const simulator = simulatorRef.current;
    if (!simulator || !ready) return;
    showNotice(simulator.rescueBoat() ? voyage.rescueDone : voyage.rescueClear);
  };
  const restartVoyage = () => {
    setConfirmRestart(false);
    setPanelMinimized(true);
    resetScene();
    showNotice(voyage.restarted);
  };
  const recenterCamera = () => {
    simulatorRef.current?.recenterCamera();
    showNotice(voyage.recenterCamera);
  };
  const hoistSail = (color: string) => {
    simulatorRef.current?.setSailColor(color);
    showNotice(`${voyage.sailColor}: ${featureText(voyage, `sail_${color}`)}`);
  };

  const enterPhotoMode = () => {
    photoModeRef.current = true;
    setPhotoMode(true);
    // The camera now turns by itself to whales, dolphins, sharks, eruptions and ships' horns.
    simulatorRef.current?.setPhotoMode(true);
    if (guideStep === 3) finishGuide();
  };

  const guideWasRunning = useRef(false);
  useEffect(() => {
    if (guideStep > 0) guideWasRunning.current = true;
  }, [guideStep]);
  useEffect(() => {
    // Back from the guide's photo mode: one word of encouragement.
    if (!photoMode && guideStep === 0 && guideWasRunning.current && readGuideDone()) {
      guideWasRunning.current = false;
      showNotice(voyage.guideDone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoMode, guideStep]);

  // The minimap sits in the bottom-left corner just above the rudder, whatever
  // height the rudder panel has at this size: its top edge is measured and
  // handed to the stylesheet as --minimap-bottom.
  useEffect(() => {
    const shell = shellRef.current;
    const rudder = rudderRef.current;
    if (!shell || !rudder) return;
    const place = () => {
      const shellBox = shell.getBoundingClientRect();
      const rudderBox = rudder.getBoundingClientRect();
      if (rudderBox.height <= 0) return;
      shell.style.setProperty("--minimap-bottom", `${Math.round(shellBox.bottom - rudderBox.top + 12)}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(rudder);
    observer.observe(shell);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [ready]);

  // Keyboard commands (the helm and the throttle are the simulator's own keys).
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const onKey = (event: KeyboardEvent) => {
    if (!ready || photoMode || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (isTypingTarget(event.target)) return;
    switch (event.code) {
      case "KeyP":
        setChartOpen(false);
        enterPhotoMode();
        break;
      case "KeyN":
        setChartOpen((value) => !value);
        break;
      case "KeyH":
        playSignal("horn");
        break;
      case "KeyB":
        playSignal("bell");
        break;
      case "KeyF":
        launchFlare("red");
        break;
      case "KeyG":
        launchFlare("green");
        break;
      case "KeyM":
        if (event.shiftKey) stepRadio(-1);
        else if (snapshot.radioStation && snapshot.radioStation === stations[stations.length - 1]!.id) tuneRadio(null);
        else stepRadio(1);
        break;
      case "KeyV": {
        const modes = Object.keys(cameraLabels) as CameraMode[];
        const next = modes[(modes.indexOf(snapshot.cameraMode) + 1) % modes.length]!;
        setCamera(next);
        showNotice(`${messages.camera}: ${cameraLabels[next]}`);
        break;
      }
      case "KeyR":
        recenterCamera();
        break;
      case "Escape":
        if (!panelMinimized) setPanelMinimized(true);
        else if (discoveries.length > 0) closeDiscovery();
        return;
      default:
        return;
    }
    event.preventDefault();
  };
  useEffect(() => {
    keyHandler.current = onKey;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const soundLocked = snapshot.soundEnabled && !snapshot.audioReady;
  const soundLabel = snapshot.soundEnabled
    ? snapshot.audioReady
      ? `${messages.sound}: ${messages.on}`
      : messages.tapSound
    : `${messages.sound}: ${messages.off}`;

  const toggleSound = () => {
    const simulator = simulatorRef.current;
    if (!simulator) return;
    if (snapshot.soundEnabled && !soundReadyAtPress.current) {
      simulator.startAudioFromUser();
      showNotice(`${messages.sound}: ${messages.on}`);
      return;
    }
    simulator.setSoundEnabled(!snapshot.soundEnabled);
    if (!snapshot.soundEnabled) simulator.startAudioFromUser();
    showNotice(`${messages.sound}: ${snapshot.soundEnabled ? messages.off : messages.on}`);
  };

  const unlockSound = () => {
    const simulator = simulatorRef.current;
    if (!simulator) return;
    // Run the complete unlock path during pointerdown. On iOS WebKit the
    // AudioContext state change can remove this button before a later click is
    // dispatched, so click alone is not a reliable first-gesture handler.
    simulator.setSoundEnabled(true);
    simulator.startAudioFromUser();
  };

  const changeLanguage = (nextLanguage: LanguageCode) => {
    setLanguage(nextLanguage);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // The active session still changes language when storage is blocked.
    }
    document.documentElement.lang = nextLanguage;
    document.documentElement.dir = isRtlLanguage(nextLanguage) ? "rtl" : "ltr";
  };

  return (
    <main
      ref={shellRef}
      className={`simulator-shell ${panelMinimized ? "" : "settings-open"}`}
      aria-label={`Sailing Simulator Pro · ${messages.sailingControls}`}
      dir={isRtlLanguage(language) ? "rtl" : "ltr"}
      onPointerDownCapture={() => simulatorRef.current?.resumeAudioFromGesture()}
    >
      <canvas
        ref={canvasRef}
        className="simulator-canvas"
        tabIndex={photoMode ? 0 : -1}
        aria-label={photoMode ? `${messages.photoMode}. ${messages.photoModeHint}` : messages.sailingControls}
      />

      {photoMode && (
        <div className="photo-toolbar" role="toolbar" aria-label={messages.photoMode}>
          <button
            type="button"
            className="photo-tool"
            aria-pressed={snapshot.photoAutoTarget}
            aria-label={messages.autoTarget}
            title={messages.autoTarget}
            onClick={() => simulatorRef.current?.setPhotoAutoTarget(!snapshot.photoAutoTarget)}
          >
            <ControlIcon name="target" />
          </button>
          <button
            type="button"
            className="photo-tool photo-shutter"
            aria-label={messages.takePhoto}
            title={messages.takePhoto}
            onClick={async () => {
              const simulator = simulatorRef.current;
              if (!simulator) return;
              setPhotoFlash((value) => value + 1);
              navigator.vibrate?.(12);
              const blob = await simulator.capturePhoto();
              if (!blob) return;
              await savePhoto(blob);
              setPhotoSaved(true);
              window.setTimeout(() => setPhotoSaved(false), 2200);
            }}
          >
            <ControlIcon name="shutter" />
          </button>
          <button
            type="button"
            className="photo-tool"
            aria-pressed={snapshot.soundEnabled && snapshot.audioReady}
            aria-label={soundLabel}
            title={soundLabel}
            onPointerDown={() => {
              if (!snapshot.soundEnabled || !snapshot.audioReady) unlockSound();
            }}
            onClick={() => {
              const simulator = simulatorRef.current;
              if (!simulator || !snapshot.soundEnabled || !snapshot.audioReady) return;
              simulator.setSoundEnabled(false);
            }}
          >
            <ControlIcon name={snapshot.soundEnabled && snapshot.audioReady ? "sound-on" : "sound-off"} />
          </button>
          {photoSaved && <span className="photo-saved" role="status">{messages.photoSaved}</span>}
        </div>
      )}
      {photoFlash > 0 && <div key={photoFlash} className="photo-flash" aria-hidden="true" />}

      {photoMode && photoHint && <p className="photo-toast" aria-hidden="true">{messages.photoModeHint}</p>}

      {/* Faded rather than removed, so leaving photo mode is a smooth return;
          inert keeps the hidden controls out of reach meanwhile. */}
      <div className={`simulator-interface ${photoMode ? "photo-hidden" : ""}`} inert={photoMode} aria-hidden={photoMode}>

        {!loading.ready && !error && (
          <section className="loading-screen" aria-live="polite">
            <div className="loading-mark" aria-hidden="true">◒</div>
            <p className="eyebrow">Sailing Simulator Pro</p>
            <h1>{messages.loadingTitle}</h1>
            <div className="loading-track"><span style={{ width: `${progress}%` }} /></div>
            <p>{messages.loading} · {progress}%</p>
          </section>
        )}

        {error && (
          <section className="error-card" role="alert">
            <p className="eyebrow">{messages.rendererNotice}</p>
            <h2>{messages.sceneInterrupted}</h2>
            <p>{error}</p>
            <button type="button" onClick={() => window.location.reload()}>{messages.reload}</button>
          </section>
        )}

        {/* Transient prompts share one centred column, so they never collide
            with each other or with the controls at any screen size. */}
        {/* What a control has just done: a short plaque a little below the
            centre of the screen, over everything, never in the way of a tap. */}
        {engineNotice && (
          <div className="action-toast" role="status" aria-live="polite" key={noticeKey}>
            {engineNotice}
          </div>
        )}

        <div className="notice-stack">
          <SoundPrompt
            active={loading.ready && snapshot.soundEnabled && !snapshot.audioReady && !error}
            targetRef={soundDockRef}
            label={messages.tapSound}
            onUnlock={unlockSound}
            onArrived={onSoundPromptArrived}
          />
          {ready && !discoveries.length && <QuickStart step={guideStep} touch={coarsePointer} messages={voyage} onSkip={finishGuide} />}
          {ready && (
            <DiscoveryCard key={discoveries[0]?.id ?? 0} discovery={discoveries[0] ?? null} messages={voyage} onClose={closeDiscovery} onHoist={(color) => {
              hoistSail(color);
              closeDiscovery();
            }} />
          )}
          {ready && snapshot.stuck && <StuckChip messages={voyage} onRescue={rescueBoat} />}
          {ready && !discoveries.length && guideStep === 0 && <LootChip loot={snapshot.nearestLoot} messages={voyage} />}
        </div>

        {ready && portraitPhone && !rotateHintDismissed && (
          <div className="rotate-hint" role="note">
            <span className="rotate-hint-icon" aria-hidden="true" />
            <p>{messages.rotateHint}</p>
            <button type="button" className="icon-button" aria-label={messages.dismiss} title={messages.dismiss} onClick={dismissRotateHint}>
              <ControlIcon name="close" />
            </button>
          </div>
        )}

        {stationBanner && (
          <StationBanner station={stations.find((station) => station.id === stationBanner.id) ?? null} keyId={stationBanner.key} />
        )}

        <div className="scene-actions">
          {/* Permanent mute/unmute. While the browser still holds sound back it
              pulses; one press both unlocks and plays. */}
          <button
            ref={soundDockRef}
            type="button"
            className={`scene-action sound-dock${soundLocked ? " is-locked" : ""}${soundArrived ? " is-arriving" : ""}`}
            disabled={!loading.ready || Boolean(error)}
            aria-label={soundLabel}
            title={soundLabel}
            aria-pressed={snapshot.soundEnabled && snapshot.audioReady}
            onPointerDown={() => {
              soundDockUnlocked.current = false;
              if (!snapshot.soundEnabled || !snapshot.audioReady) {
                // Unlock inside the trusted pointer gesture (iOS needs it here).
                soundDockUnlocked.current = true;
                unlockSound();
              }
            }}
            onClick={() => {
              if (soundDockUnlocked.current) {
                soundDockUnlocked.current = false;
                showNotice(`${messages.sound}: ${messages.on}`);
                return;
              }
              const simulator = simulatorRef.current;
              if (!simulator) return;
              if (!snapshot.soundEnabled || !snapshot.audioReady) unlockSound();
              else simulator.setSoundEnabled(false);
              showNotice(`${messages.sound}: ${!snapshot.soundEnabled || !snapshot.audioReady ? messages.on : messages.off}`);
            }}
          >
            <ControlIcon name={snapshot.soundEnabled && snapshot.audioReady ? "sound-on" : "sound-off"} />
          </button>
          <button
            type="button"
            className="scene-action"
            aria-label={`${messages.camera}: ${cameraLabels[snapshot.cameraMode]}`}
            title={`${messages.camera}: ${cameraLabels[snapshot.cameraMode]}`}
            onClick={() => {
              const modes = Object.keys(cameraLabels) as CameraMode[];
              const next = modes[(modes.indexOf(snapshot.cameraMode) + 1) % modes.length]!;
              setCamera(next);
              showNotice(`${messages.camera}: ${cameraLabels[next]}`);
            }}
          >
            <ControlIcon name={snapshot.cameraMode} />
            <span className="scene-action-label">{cameraLabels[snapshot.cameraMode]}</span>
          </button>
          <button
            ref={photoButtonRef}
            type="button"
            className={`scene-action${guideStep === 3 ? " guide-target" : ""}`}
            disabled={!loading.ready || Boolean(error)}
            title={`${messages.photoMode} (P). ${messages.photoModeHint}`}
            aria-describedby="photo-mode-hint"
            onClick={enterPhotoMode}
          >
            <ControlIcon name="photo" />
            <span className="scene-action-label">{messages.photoMode}</span>
          </button>
          <button
            type="button"
            className="scene-action"
            disabled={!ready}
            aria-expanded={chartOpen}
            title={`${messages.openMap} (N)`}
            onClick={() => {
              setPanelMinimized(true);
              setChartOpen(true);
            }}
          >
            <ControlIcon name="map" />
            <span className="scene-action-label">{messages.map}</span>
          </button>
          <p id="photo-mode-hint" className="photo-mode-hint">{messages.photoModeHint}</p>
          <RadioPlayer
            messages={voyage}
            snapshot={snapshot}
            disabled={!ready}
            volume={radioVolume}
            onStation={tuneRadio}
            onStep={stepRadio}
            onVolume={(volume) => {
              setRadioVolume(volume);
              simulatorRef.current?.setRadioVolume(volume);
            }}
          />
          <SignalButtons messages={voyage} disabled={!ready} onHorn={() => playSignal("horn")} onBell={() => playSignal("bell")} onFlare={launchFlare} />
        </div>

        <section className="instrument-cluster" aria-label={messages.sailingControls}>
          <div className="instrument"><span>{messages.speed}</span><strong>{snapshot.speedKnots.toFixed(1)}</strong><small>kn</small></div>
          <div className="instrument"><span>{messages.depth}</span><strong>{snapshot.depthMeters.toFixed(1)}</strong><small>m</small></div>
          <div className="instrument wind-instrument">
            <span><span className="wind-label-full">{messages.apparentWind}</span><span className="wind-label-short">{messages.wind}</span></span><strong>{snapshot.apparentWindKnots.toFixed(1)}</strong>
            <small>kn<span className="wind-angle"> · {Math.abs(snapshot.apparentWindAngle).toFixed(0)}°</span></small>
            {snapshot.gust > 0.15 && <em className="gust-flag" title={voyage.gust}>{voyage.gust}</em>}
          </div>
        </section>

        <section className="heading-card" aria-label={messages.heading}>
          <span className={`status-dot ${snapshot.status}`} />
          <strong>{compass}</strong><span>{messages.heading}</span>
        </section>

        <ChartView
          simulatorRef={simulatorRef}
          messages={voyage}
          open={chartOpen}
          onOpen={() => {
            setPanelMinimized(true);
            setChartOpen(true);
          }}
          onClose={closeChart}
          hideMini={!panelMinimized}
          ready={ready}
        />

        {!panelMinimized && (
          <button
            type="button"
            className="panel-scrim"
            aria-label={messages.minimize}
            onClick={() => setPanelMinimized(true)}
          />
        )}

        <section
          ref={panelRef}
          id="simulator-settings"
          className={`control-panel ${panelMinimized ? "is-minimized" : ""}`}
          aria-label={messages.controls}
        >
          <header>
            <div>
              <p className="eyebrow">
                <span className="full-control-title">{messages.worldControls}</span>
                <span className="mobile-control-title">{messages.controls}</span>
              </p>
              {/* On phones the heading card is hidden and this line carries the
                  heading. The sound prompt has its own button, and a live
                  region here would announce every degree of a turn. */}
              {panelMinimized && (
                <span className="panel-mini-status">
                  {compass}<span className="mini-status-word"> {messages.heading}</span>
                </span>
              )}
              {!panelMinimized && (
                <span>
                  {snapshot.fps.toFixed(0)} FPS · {snapshot.qualityChoice === "auto" ? `${qualityLabels.auto} · ${qualityLabels[snapshot.quality]}` : qualityLabels[snapshot.quality]} ·{" "}
                  <a className="model-credits" href="/models/README.md" target="_blank" rel="noreferrer">{messages.credits}</a>
                </span>
              )}
            </div>
            <button
              type="button"
              className="icon-button"
              aria-controls="simulator-settings"
              aria-expanded={!panelMinimized}
              aria-label={panelMinimized ? messages.expand : messages.minimize}
              onClick={() => {
                // The first-run tip waits inside the panel until it is dismissed.
                setPanelMinimized((value) => !value);
              }}
            >{panelMinimized ? "≡" : "×"}</button>
          </header>


          {!panelMinimized && (
            <div className={`panel-body${panelTab === "yacht" ? " is-yacht" : ""}`}>
              {/* The first-run tip lives in the control panel; what a switch has
                  just done is announced in the middle of the screen (see
                  .action-toast). The shore guard is announced on the rudder card. */}
              {showHelp && loading.ready && !error && (
                <div className="panel-status">
                  {showHelp && loading.ready && !error && (
                    <button type="button" className="help-toast" onClick={() => setShowHelp(false)}>
                      {messages.help}
                    </button>
                  )}
                </div>
              )}
              <div className="panel-tabs segmented" role="tablist" aria-label={messages.controls}>
                {(["scene", "yacht"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={panelTab === tab}
                    onClick={() => {
                      setPanelTab(tab);
                      setConfirmRestart(false);
                    }}
                  >{tab === "scene" ? voyage.tabScene : voyage.tabYacht}</button>
                ))}
              </div>
              {panelTab === "scene" && (<>
              <div className="compact-row">
                <div className="segmented time-group" role="group" aria-label={`${messages.day} / ${messages.night}`}>
                  {(["day", "night"] as LightingMode[]).map((mode) => (
                    <button
                      type="button"
                      className="icon-control"
                      key={mode}
                      aria-label={mode === "day" ? messages.day : messages.night}
                      title={mode === "day" ? messages.day : messages.night}
                      aria-pressed={snapshot.lightingMode === mode}
                      onClick={() => {
                        setLighting(mode);
                        showNotice(`${messages.timeOfDay}: ${mode === "day" ? messages.day : messages.night}`);
                      }}
                    >
                      <ControlIcon name={mode === "day" ? "sun" : "moon"} />
                    </button>
                  ))}
                  <button
                    type="button"
                    className="icon-control"
                    aria-label={`${messages.autoTime}: ${snapshot.autoTime ? messages.on : messages.off}`}
                    title={`${messages.autoTime}: ${snapshot.autoTime ? messages.on : messages.off}`}
                    aria-pressed={snapshot.autoTime}
                    onClick={() => {
                      simulatorRef.current?.setAutoTime(!snapshot.autoTime);
                      showNotice(`${messages.autoTime}: ${snapshot.autoTime ? messages.off : messages.on}`);
                    }}
                  ><ControlIcon name="auto-time" /></button>
                </div>
                <button
                  type="button"
                  className="quiet-button icon-control"
                  aria-label={snapshot.soundEnabled ? (snapshot.audioReady ? `${messages.sound}: ${messages.on}` : messages.tapSound) : `${messages.sound}: ${messages.off}`}
                  title={snapshot.soundEnabled ? (snapshot.audioReady ? `${messages.sound}: ${messages.on}` : messages.tapSound) : `${messages.sound}: ${messages.off}`}
                  aria-pressed={snapshot.soundEnabled && snapshot.audioReady}
                  onPointerDown={() => {
                    soundReadyAtPress.current = snapshot.audioReady;
                    // This is the sound button: the press itself may start sound (iOS needs the pointer gesture).
                    simulatorRef.current?.startAudioFromUser();
                  }}
                  onClick={toggleSound}
                ><ControlIcon name={snapshot.soundEnabled && snapshot.audioReady ? "sound-on" : "sound-off"} /></button>
                <button
                  type="button"
                  className="quiet-button icon-control"
                  aria-label={`${messages.engineSound}: ${snapshot.engineMuted ? messages.off : messages.on}`}
                  title={`${messages.engineSound}: ${snapshot.engineMuted ? messages.off : messages.on}`}
                  aria-pressed={!snapshot.engineMuted}
                  onClick={() => {
                    // Sound only: this never starts, stops or throttles the engine.
                    simulatorRef.current?.setEngineMuted(!snapshot.engineMuted);
                    showNotice(`${messages.engineSound}: ${snapshot.engineMuted ? messages.on : messages.off}`);
                  }}
                ><ControlIcon name={snapshot.engineMuted ? "engine-muted" : "engine-sound"} /></button>
              </div>

              <div className="panel-section panel-camera">
                <div className="section-label"><span>{messages.camera}</span><strong>{cameraLabels[snapshot.cameraMode]}</strong></div>
                <div className="camera-grid">
                  {(Object.keys(cameraLabels) as CameraMode[]).map((mode) => (
                    <button
                      type="button"
                      className="icon-control"
                      key={mode}
                      aria-label={`${messages.camera}: ${cameraLabels[mode]}`}
                      title={`${messages.camera}: ${cameraLabels[mode]}`}
                      aria-pressed={snapshot.cameraMode === mode}
                      onClick={() => {
                        setCamera(mode);
                        showNotice(`${messages.camera}: ${cameraLabels[mode]}`);
                      }}
                    >
                      <ControlIcon name={mode} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel-section panel-weather">
                <div className="section-label">
                  <span>{messages.weather}</span>
                  <strong>{weatherLabels[snapshot.weatherNow]}</strong>
                </div>
                <div className="weather-mode segmented" role="group" aria-label={messages.weather}>
                  {(["auto", "manual"] as WeatherMode[]).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      aria-pressed={snapshot.weatherMode === mode}
                      onClick={() => {
                        simulatorRef.current?.setWeatherMode(mode);
                        showNotice(`${messages.weather}: ${mode === "auto" ? messages.weatherAuto : messages.weatherManual}`);
                      }}
                    >{mode === "auto" ? messages.weatherAuto : messages.weatherManual}</button>
                  ))}
                </div>
                <div className="weather-grid">
                  {WEATHER_KINDS.map((kind) => (
                    <button
                      type="button"
                      className="icon-control"
                      key={kind}
                      aria-label={`${messages.weather}: ${weatherLabels[kind]}`}
                      title={weatherLabels[kind]}
                      aria-pressed={snapshot.weatherMode === "manual" ? snapshot.weather === kind : snapshot.weatherNow === kind}
                      data-auto={snapshot.weatherMode === "auto" ? "true" : undefined}
                      onClick={() => {
                        simulatorRef.current?.setWeather(kind);
                        showNotice(`${messages.weather}: ${weatherLabels[kind]}`);
                      }}
                    >
                      <ControlIcon name={kind} />
                    </button>
                  ))}
                </div>
                <div className="sea-readout">
                  <span>{messages.waves} <strong>{snapshot.waveHeight.toFixed(1)} m</strong></span>
                  <span>{messages.wind} <strong>{Math.round(snapshot.trueWindKnots)} kn</strong></span>
                </div>
              </div>

              </>)}
              {panelTab === "yacht" && (<>
              <div className="panel-section trim-row">
                <label htmlFor="sail-trim">{messages.sailTrim} <strong>{Math.round(snapshot.sailTrim * 100)}%</strong></label>
                <input
                  id="sail-trim"
                  type="range"
                  min="20"
                  max="100"
                  value={Math.round(snapshot.sailTrim * 100)}
                  onChange={(event) => simulatorRef.current?.setSailTrim(Number(event.target.value) / 100)}
                />
              </div>

              <div className="panel-section helm-options" role="group" aria-label={voyage.helmSection}>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={snapshot.autoCenterHelm}
                    onChange={(event) => {
                      simulatorRef.current?.setAutoCenterHelm(event.target.checked);
                      showNotice(`${voyage.autoCenter}: ${event.target.checked ? messages.on : messages.off}`);
                    }}
                  />
                  <span>{voyage.autoCenter}</span>
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={snapshot.steadyHelmView}
                    onChange={(event) => {
                      simulatorRef.current?.setSteadyHelmView(event.target.checked);
                      showNotice(`${voyage.steadyView}: ${event.target.checked ? messages.on : messages.off}`);
                    }}
                  />
                  <span>{voyage.steadyView}</span>
                </label>
              </div>

              <div className="panel-section sail-colours">
                <div className="section-label"><span>{voyage.sailColor}</span><strong>{featureText(voyage, `sail_${snapshot.sailColor}`)}</strong></div>
                <div className="swatch-row">
                  {SAIL_SWATCHES.map((swatch) => {
                    const unlocked = snapshot.unlockedSails.includes(swatch.id);
                    const name = featureText(voyage, `sail_${swatch.id}`);
                    return (
                      <button
                        key={swatch.id}
                        type="button"
                        className={`swatch${unlocked ? "" : " is-locked"}`}
                        aria-pressed={snapshot.sailColor === swatch.id}
                        aria-label={unlocked ? name : `${name}: ${voyage.sailLocked}`}
                        title={unlocked ? name : voyage.sailLocked}
                        disabled={!unlocked}
                        style={{ "--swatch": swatch.color } as CSSProperties}
                        onClick={() => hoistSail(swatch.id)}
                      >{unlocked ? null : "?"}</button>
                    );
                  })}
                </div>
                <div className="logbook" aria-label={voyage.logbook}>
                  <span title={voyage.doubloons}>🪙 {snapshot.doubloons}</span>
                  <span title={voyage.flamingos}>🦩 {snapshot.flamingos}</span>
                  <span title={voyage.placesFound}>🧭 {new Set(snapshot.discoveredPlaces.map((key) => key.split(":")[0])).size}/4</span>
                </div>
              </div>

              <div className="panel-section service-row" role="group" aria-label={voyage.service}>
                <div className="section-label"><span>{voyage.service}</span></div>
                {confirmRestart ? (
                  <div className="restart-confirm" role="alertdialog" aria-label={voyage.restart}>
                    <p>{voyage.restartConfirm}</p>
                    <div>
                      <button type="button" className="danger" onClick={restartVoyage}>{voyage.restartYes}</button>
                      <button type="button" onClick={() => setConfirmRestart(false)}>{voyage.cancel}</button>
                    </div>
                  </div>
                ) : (
                  <div className="service-grid">
                    <button type="button" onClick={recenterCamera}><VoyageIcon name="recenter" /><span>{voyage.recenterCamera}</span></button>
                    <button type="button" onClick={rescueBoat}><VoyageIcon name="rescue" /><span>{voyage.rescue}</span></button>
                    <button type="button" className="quiet-danger" onClick={() => setConfirmRestart(true)}><VoyageIcon name="restart" /><span>{voyage.restart}</span></button>
                    {canInstall && (
                      <button type="button" className="install-app" onClick={installApp}><VoyageIcon name="install" /><span>{messages.installApp}</span></button>
                    )}
                  </div>
                )}
              </div>

              {!coarsePointer && (
                <div className="panel-section key-help">
                  <div className="section-label"><span>{voyage.keys}</span></div>
                  <ul>
                    <li>{voyage.keyHelm}</li>
                    <li>{voyage.keyThrottle}</li>
                    <li>{voyage.keySheet}</li>
                    <li>{voyage.keyCenter}</li>
                    <li>{voyage.keySignals}</li>
                    <li>{voyage.keyMore}</li>
                  </ul>
                </div>
              )}
              </>)}

              {panelTab === "scene" && <footer className="panel-footer">
                <label>
                  <span>{messages.quality}</span>
                  <select value={snapshot.qualityChoice} onChange={(event) => setQuality(event.target.value as QualityChoice)}>
                    <option value="auto">{messages.auto}</option>
                    <option value="low">{messages.low}</option><option value="medium">{messages.medium}</option><option value="high">{messages.high}</option>
                  </select>
                </label>
                <label className="language-picker">
                  <span>{messages.language}</span>
                  <select
                    value={language}
                    aria-label={messages.language}
                    onChange={(event) => changeLanguage(event.target.value as LanguageCode)}
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>{option.name}</option>
                    ))}
                  </select>
                </label>
              </footer>}
            </div>
          )}
        </section>

        <div className="primary-controls">
          <section ref={rudderRef} className={`rudder-control${guideStep === 2 ? " guide-target" : ""}${tiltSteering ? " is-tilt" : ""}`} aria-label={messages.rudder}>
            <div
              className="helm-wheel"
              role="presentation"
              title={messages.swipeHint}
              onPointerDown={onWheelPointerDown}
              onPointerMove={onWheelPointerMove}
              onPointerUp={endWheelSwipe}
              onPointerCancel={endWheelSwipe}
            >
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <g transform={`rotate(${wheelRotation} 50 50)`}>
                  <circle className="helm-wheel-rim" cx="50" cy="50" r="35" />
                  <line x1="50" y1="5" x2="50" y2="95" />
                  <line x1="5" y1="50" x2="95" y2="50" />
                  <line x1="18" y1="18" x2="82" y2="82" />
                  <line x1="82" y1="18" x2="18" y2="82" />
                  <circle className="helm-wheel-hub" cx="50" cy="50" r="10" />
                </g>
              </svg>
            </div>
            <div className="control-heading">
              <span>{messages.rudder}</span>
              {/* While the shore guard holds the helm the rudder card says so:
                  it is why the wheel does not answer for a moment. */}
              {snapshot.shoreGuardActive && loading.ready ? (
                <strong className="rudder-guard" role="status">{messages.shoreGuard}</strong>
              ) : (
                <strong>{displayedRudderDegrees < -0.5 ? messages.port : displayedRudderDegrees > 0.5 ? messages.starboard : messages.center} {Math.abs(displayedRudderDegrees).toFixed(0)}°</strong>
              )}
            </div>
            <div className="rudder-track-wrap">
              <span>{messages.port}</span>
              <input
                aria-label={messages.rudder}
                aria-valuetext={`${displayedRudderDegrees < -0.5 ? messages.port : displayedRudderDegrees > 0.5 ? messages.starboard : messages.center} ${Math.abs(displayedRudderDegrees).toFixed(0)}°`}
                className="rudder-slider"
                type="range"
                disabled={tiltSteering}
                min="-100"
                max="100"
                value={rudderInput}
                style={{ "--rudder-progress": `${(rudderInput + 100) / 2}%` } as CSSProperties}
                onPointerDown={() => { rudderDragging.current = true; }}
                onPointerUp={() => {
                  rudderDragging.current = false;
                  // Let go of the wheel: it eases back amidships if the player wants that.
                  simulatorRef.current?.releaseRudder();
                }}
                onPointerCancel={() => {
                  rudderDragging.current = false;
                  simulatorRef.current?.releaseRudder();
                }}
                onBlur={() => { rudderDragging.current = false; }}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setRudderInput(value);
                  setShowHelp(false);
                  simulatorRef.current?.setRudder(value / 100);
                }}
              />
              <span>{messages.starboard}</span>
              {/* Touch: swipe anywhere along the strip; the helm moves by how far
                  the finger travels, not to where it lands. */}
              {coarsePointer && (
                <div
                  className="rudder-swipe"
                  aria-hidden="true"
                  onPointerDown={(event) => {
                    const strip = event.currentTarget;
                    strip.setPointerCapture(event.pointerId);
                    swipeStart.current = { x: event.clientX, value: rudderInput, width: strip.getBoundingClientRect().width };
                    rudderDragging.current = true;
                    setShowHelp(false);
                  }}
                  onPointerMove={(event) => {
                    const start = swipeStart.current;
                    if (!start) return;
                    const value = Math.round(Math.max(-100, Math.min(100, start.value + ((event.clientX - start.x) / Math.max(120, start.width)) * 230)));
                    setRudderInput(value);
                    simulatorRef.current?.setRudder(value / 100);
                  }}
                  onPointerUp={() => {
                    swipeStart.current = null;
                    rudderDragging.current = false;
                    simulatorRef.current?.releaseRudder();
                  }}
                  onPointerCancel={() => {
                    swipeStart.current = null;
                    rudderDragging.current = false;
                    simulatorRef.current?.releaseRudder();
                  }}
                />
              )}
            </div>
            <div className="rudder-buttons">
              <button
                type="button"
                className="tilt-button"
                aria-pressed={tiltSteering}
                aria-label={messages.tiltSteering}
                title={messages.tiltSteering}
                onClick={() => void toggleTilt()}
              >
                <ControlIcon name="tilt" />
              </button>
              <button
                type="button"
                className="center-button"
                onClick={() => {
                  setRudderInput(0);
                  tiltNeutral.current = null;
                  simulatorRef.current?.centerRudder();
                }}
              >
                <span className="full-center-label">{messages.centerRudder}</span>
                <span className="mobile-center-label">{messages.center}</span>
              </button>
            </div>
          </section>

          <section className={`throttle-control ${engineInput ? "" : "is-off"}`} aria-label={`${messages.engine} · ${messages.throttle}`}>
            <button
              type="button"
              className={`engine-toggle${guideStep === 1 ? " guide-target" : ""}`}
              role="switch"
              aria-checked={engineInput}
              aria-label={`${messages.engine}: ${engineInput ? messages.on : messages.off}`}
              disabled={!loading.ready}
              onPointerDown={() => simulatorRef.current?.resumeAudioFromGesture()}
              onClick={() => setEngineRunning(!engineInput)}
            >
              <span className="engine-toggle-copy">
                <small>{messages.engine}</small>
                <strong>{engineInput ? messages.on : messages.off}</strong>
              </span>
              <span className="engine-switch-track" aria-hidden="true"><span /></span>
            </button>
            {/* On phones the throttle springs out of the switch when the engine starts. */}
            <div className="throttle-reveal" aria-hidden={!engineInput || undefined}>
            <div className="throttle-reveal-inner">
            <div className="control-heading vertical-heading"><span>{messages.throttle}</span><strong>{engineInput ? throttleLabel(displayedThrottle, messages) : messages.off}</strong></div>
            <div className="throttle-layout">
              <span>{messages.forward}</span>
              <div className="throttle-slider-slot">
                <input
                  aria-label={messages.throttle}
                  aria-orientation="vertical"
                  aria-valuetext={engineInput ? throttleLabel(displayedThrottle, messages) : `${messages.engine}: ${messages.off}`}
                  className="throttle-slider"
                  type="range"
                  min="-100"
                  max="100"
                  disabled={!engineInput}
                  value={throttleInput}
                  style={{ "--throttle-progress": `${(throttleInput + 100) / 2}%` } as CSSProperties}
                  onPointerDown={() => { throttleDragging.current = true; }}
                  onPointerUp={() => { throttleDragging.current = false; }}
                  onPointerCancel={() => { throttleDragging.current = false; }}
                  onBlur={() => { throttleDragging.current = false; }}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setThrottleInput(value);
                    setShowHelp(false);
                    simulatorRef.current?.setThrottle(value / 100);
                  }}
                />
              </div>
              <span>{messages.reverse}</span>
            </div>
            </div>
            </div>
          </section>
        </div>

      </div>
    </main>
  );
}
