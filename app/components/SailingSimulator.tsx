"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { EMPTY_SNAPSHOT } from "@/src/simulator/state";
import type { Simulator as SimulatorInstance } from "@/src/simulator/Simulator";
import { prefetchStartModels } from "@/src/simulator/core/startAssets";
import type { CameraMode, Discovery, FindEvent, LightingMode, LoadingState, QualityChoice } from "@/src/simulator/types";
import { WEATHER_KINDS, type WeatherKind, type WeatherMode } from "@/src/simulator/environment/WeatherMath";
import { SoundPrompt } from "./SoundPrompt";
import { usePwaInstall } from "./usePwaInstall";
import { gravityRollDegrees, requestTiltPermission, screenAngle, screenRollDegrees, STEERING_STORAGE_KEY, swipeToRudder, tiltToRudder, wheelToRudder } from "./steering";
import { featureText, fill, getFeatureMessages } from "./featureMessages";
import { DiverHud } from "./DiverHud";
import { ControlsCard } from "./ControlsCard";
import { ShopModal } from "./ShopModal";
import { InventoryModal } from "./InventoryModal";
import { findName, getShopMessages, shopText } from "./shopMessages";
import { DustNotices, type NoticeItem } from "./DustNotice";
import { getDiverMessages } from "./diverMessages";
import { ChartView } from "./ChartView";
import { PauseMenu } from "./PauseMenu";
import { getPauseMessages } from "./pauseMessages";
import { StoryHud, storyPromptText } from "./story/StoryHud";
import { StoryOverlay } from "./story/StoryOverlay";
import { MainMenu } from "./story/MainMenu";
import { CinemaLayer } from "./story/CinemaLayer";
import { saveBlock } from "@/src/simulator/story/SaveGames";
import { JournalModal } from "./story/JournalModal";
import { storyMessages } from "./story/storyMessages";
import type { StoryOverlayFrame } from "@/src/simulator/types";
import { keyBindings, type BindingAction } from "@/src/simulator/input/KeyBindings";
import { setMenuSoundEnabled } from "./menuSound";
import {
  DiscoveryCard,
  LootChip,
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

/** Downloads plus scene steps (`LOAD_STEPS_TOTAL` in AssetManager), for the bar before the first report. */
const ASSET_LOAD_TOTAL = 16;
/** Set once the first-run controls card has been seen and closed. */
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
  | "walk"
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
          {/* A clapperboard: the cinematic mode. */}
          <path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
          <path d="M4 10 3.3 7a1 1 0 0 1 .75-1.2l13.6-3.1a1 1 0 0 1 1.2.75l.45 1.95Z" />
          <path d="M8.3 5.1l2.4 3.3M13.2 4l2.4 3.3M4 14h16" />
        </>
      )}
      {name === "walk" && (
        <>
          {/* A figure stepping off: away from the helm. */}
          <circle cx="13" cy="4.5" r="1.8" />
          <path d="M11.5 8.5 9 12.5l3 1.5-1 6M12 9l3 3 3 .5M12 14l3.5 2 1.5 4M9 12.5 6 13" />
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


/** The simulator's code (three.js and all), imported once. */
let simulatorImport: Promise<typeof import("@/src/simulator/Simulator")> | null = null;
function loadSimulatorModule(): Promise<typeof import("@/src/simulator/Simulator")> {
  simulatorImport ??= import("@/src/simulator/Simulator");
  return simulatorImport;
}

// In the browser, as soon as this script runs: the simulator's code and the
// models the first frame needs start downloading together, before React has
// even mounted the page (on the server, where three.js must not run, nothing).
if (typeof window !== "undefined") {
  prefetchStartModels();
  void loadSimulatorModule().catch(() => undefined);
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
  /** The pause menu (Esc on foot): the world holds still behind it. */
  const [pauseOpen, setPauseOpen] = useState(false);
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
  // What a control has just done: the newest pill, and older ones still crumbling to dust.
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const noticeId = useRef(0);
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
  // Finds and discoveries wait their turn for the card at the top.
  const [discoveries, setDiscoveries] = useState<DiscoveryView[]>([]);
  const discoveryId = useRef(0);
  const [stationBanner, setStationBanner] = useState<{ id: string; key: number } | null>(null);
  const [radioVolume, setRadioVolume] = useState(0.7);
  const [panelTab, setPanelTab] = useState<"scene" | "yacht">("scene");
  const [confirmRestart, setConfirmRestart] = useState(false);
  const { canInstall, install: installApp } = usePwaInstall(loading.ready);
  // The controls card: open by itself on the first visit, and on H or the "?" button.
  const [controlsOpen, setControlsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [controlsFirst, setControlsFirst] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);
  // The campaign: its journal, the choice of campaign or free sailing (from the menus), and the per-frame overlay.
  const [journalOpen, setJournalOpen] = useState(false);
  // The main menu (the game opens on it), its settings, and the controls card held back until a voyage starts.
  const [mainMenu, setMainMenu] = useState(true);
  const [menuSettings, setMenuSettings] = useState(false);
  const guidePending = useRef(false);
  const overlayListener = useRef<((frame: StoryOverlayFrame) => void) | null>(null);
  const closeControls = useCallback(() => {
    setControlsOpen(false);
    setControlsFirst(false);
    try {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, "1");
    } catch {
      // The card simply shows again next time.
    }
    // Back in the skipper's eyes: the click that closed the card captures the mouse again.
    simulatorRef.current?.setDiverFrozen(false);
    simulatorRef.current?.requestDiverPointer();
  }, []);
  const closeInventory = useCallback(() => {
    setInventoryOpen(false);
    simulatorRef.current?.setDiverFrozen(false);
    simulatorRef.current?.requestDiverPointer();
  }, []);
  const openInventory = () => {
    if (photoMode) exitPhotoMode();
    setChartOpen(false);
    setPanelMinimized(true);
    simulatorRef.current?.setDiverFrozen(true);
    setInventoryOpen(true);
  };
  const closeShop = useCallback(() => {
    setShopOpen(false);
    simulatorRef.current?.setDiverFrozen(false);
    simulatorRef.current?.requestDiverPointer();
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
    // The hint shown on the way in (`enterPhotoMode`) fades after a few seconds.
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
      noticeId.current += 1;
      const id = noticeId.current;
      setNotices((list) => [...list.slice(-3), { id, text: getFeatureMessages(language).tiltUnavailable }]);
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
  const diverWords = useMemo(() => getDiverMessages(language), [language]);
  const pauseWords = useMemo(() => getPauseMessages(language), [language]);
  const away = snapshot.diver.mode !== "helm";
  // The cinematic view is the yacht's: leaving the helm by any way (T, a
  // button, a leap) ends it, so it is never on for a walker or a swimmer.
  useEffect(() => {
    if (away && photoModeRef.current) exitPhotoMode();
  }, [away, exitPhotoMode]);
  /** Sound is playing at all; the engine is heard only then (its own toggle shows muted under a global mute). */
  const soundPlaying = snapshot.soundEnabled && snapshot.audioReady;
  // The menus' ticks and chimes are off with the game's sound.
  useEffect(() => {
    setMenuSoundEnabled(snapshot.soundEnabled);
  }, [snapshot.soundEnabled]);
  const engineHeard = soundPlaying && !snapshot.engineMuted;
  // On foot the chart is a card over his eyes: he stands still and lets the
  // mouse go while it is open (`chartFroze`), and walks on when it closes.
  const chartFroze = useRef(false);
  // Closing the chart gives him his eyes back in the same breath: inside the
  // click or the key that closed it, which is the gesture a browser wants
  // before it hands the mouse over (Safari accepts no later moment).
  const closeChart = useCallback(() => {
    setChartOpen(false);
    if (!chartFroze.current) return;
    chartFroze.current = false;
    const simulator = simulatorRef.current;
    simulator?.setDiverFrozen(false);
    simulator?.resumeDiverLook();
  }, []);
  // The pause menu holds the world still; it belongs to the skipper's own
  // eyes, so taking the helm (or the helm taking him) closes it.
  const pausedAfoot = pauseOpen && !mainMenu;
  useEffect(() => {
    simulatorRef.current?.setPaused(pausedAfoot);
  }, [pausedAfoot]);
  // The story's words drawn in the world (the alert on her screens) follow the language.
  useEffect(() => {
    simulatorRef.current?.setStoryLanguage(language === "ru" ? "ru" : "en");
  }, [language, loading.ready]);
  /** The first free voyage shows the controls card once. */
  const openGuideIfPending = () => {
    if (!guidePending.current) return;
    guidePending.current = false;
    setControlsOpen(true);
    setControlsFirst(true);
  };
  const leaveMainMenu = () => {
    setMainMenu(false);
    setMenuSettings(false);
    setJournalOpen(false);
    setChartOpen(false);
  };
  const toMainMenu = () => {
    setPauseOpen(false);
    setJournalOpen(false);
    setChartOpen(false);
    setShopOpen(false);
    setInventoryOpen(false);
    if (photoMode) exitPhotoMode();
    const simulator = simulatorRef.current;
    simulator?.setPaused(false);
    simulator?.enterMainMenu();
    setMainMenu(true);
  };
  const resumeFromPause = () => {
    setPauseOpen(false);
    const simulator = simulatorRef.current;
    if (!simulator) return;
    simulator.setPaused(false);
    // The press on "Resume" is a gesture: the mouse is his eyes again at once
    // (closed with Esc, at his next key or press).
    simulator.resumeDiverLook();
  };
  // The chart opening on foot freezes him; if it was closed by something
  // other than `closeChart` (another card taking its place), he is given
  // his eyes back only when no other card is over them.
  const cardOverView = shopOpen || inventoryOpen || controlsOpen || pausedAfoot;
  useEffect(() => {
    const simulator = simulatorRef.current;
    if (!simulator) return;
    if (chartOpen && snapshot.diver.mode !== "helm") {
      chartFroze.current = true;
      simulator.releaseDiverPointer();
      simulator.setDiverFrozen(true);
    } else if (!chartOpen && chartFroze.current) {
      chartFroze.current = false;
      if (cardOverView) return;
      simulator.setDiverFrozen(false);
      // Back to his own eyes without a click on the view first.
      simulator.resumeDiverLook();
    }
  }, [chartOpen, snapshot.diver.mode, cardOverView]);
  // Callbacks the simulator holds for its lifetime reach the current render through this.
  type LatestHandlers = {
    keyAction: (action: string) => void;
    discovery: (discovery: Discovery) => void;
    radioFailed: (station: string) => void;
    find: (find: FindEvent) => void;
    trade: () => void;
    pointerLost: () => void;
    autosave: () => void;
  };
  const latest = useRef<LatestHandlers>({ keyAction: () => {}, discovery: () => {}, radioFailed: () => {}, find: () => {}, trade: () => {}, pointerLost: () => {}, autosave: () => {} });
  const shopWords = useMemo(() => getShopMessages(language), [language]);
  const storyWords = useMemo(() => storyMessages(language), [language]);
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
    ultra: voyage.qualityUltra,
  }), [messages, voyage]);

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
        const simulatorModule = await loadSimulatorModule();
        if (disposed) return;
        // Client-only facts, read once the page is in the browser.
        setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
        if (!readGuideDone()) {
          // The controls card waits for the first free voyage (the main menu comes first).
          guidePending.current = true;
        }
        simulator = new simulatorModule.Simulator(canvas, {
          onSnapshot: (nextSnapshot) => {
            // A transition: React renders the interface in short slices and
            // yields to the next animation frame, so the HUD's refresh several
            // times a second never costs the scene a frame.
            startTransition(() => {
              setSnapshot(nextSnapshot);
              setEngineInput(nextSnapshot.engineRunning);
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
          onFind: (find) => latest.current.find(find),
          onTrade: () => latest.current.trade(),
          onPointerLost: () => latest.current.pointerLost(),
          onOverlay: (frame) => overlayListener.current?.(frame),
          onAutosave: () => latest.current.autosave(),
        });
        simulatorRef.current = simulator;
        // Development builds only: lets visual checks drive the scene from a
        // headless browser (camera, engine) without clicking through the UI.
        // Exposed for development, and in production with ?debug (profiling the real build).
        if (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("debug")) {
          (window as unknown as { __simulator?: SimulatorInstance }).__simulator = simulator;
        }
        await simulator.init();
      } catch (reason: unknown) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : "The simulator could not start.");
        }
      }
    })();

    return () => {
      disposed = true;
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
    noticeId.current += 1;
    const id = noticeId.current;
    // A few at most: the newest, and the ones before it still turning to dust.
    setNotices((list) => [...list.slice(-3), { id, text }]);
  };
  // Fast travel from the chart: the view fades to the night of the sea, the
  // yacht (or the skipper) is moved while it is dark, and the new place
  // fades in, so the streaming of a far-off world is never seen.
  const [travelVeil, setTravelVeil] = useState(false);
  const travelTimer = useRef(0);
  const travelTo = (key: string) => {
    const destination = simulatorRef.current?.travelDestinations().find((entry) => entry.key === key);
    closeChart();
    setTravelVeil(true);
    window.clearTimeout(travelTimer.current);
    travelTimer.current = window.setTimeout(() => {
      const simulator = simulatorRef.current;
      const went = simulator?.fastTravel(key) ?? false;
      if (went) simulator?.resumeDiverLook();
      const name = !destination ? "" : destination.kind === "trader" ? voyage.travelTrader : featureText(voyage, destination.kind);
      showNotice(went ? fill(voyage.travelArrived, { place: name }) : voyage.travelFailed);
      // Let the new place settle a moment before it fades in.
      travelTimer.current = window.setTimeout(() => setTravelVeil(false), 260);
    }, 380);
  };
  useEffect(() => () => window.clearTimeout(travelTimer.current), []);
  const dropNotice = useCallback((id: number) => setNotices((list) => list.filter((item) => item.id !== id)), []);
  const resetScene = () => {
    if (!loading.ready || error) return;
    rudderDragging.current = false;
    throttleDragging.current = false;
    setRudderInput(0);
    setThrottleInput(0);
    setNotices([]);
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
    simulator.setEngineRunning(running);
    const activeThrottle = running && Math.abs(displayedThrottle) <= 0.08 ? 0.12 : displayedThrottle;
    showNotice(running ? `${messages.engine}: ${messages.on} · ${throttleLabel(activeThrottle, messages)}` : `${messages.engine}: ${messages.off}`);
    navigator.vibrate?.(running ? 24 : 14);
  };

  const ready = loading.ready && !error;
  // The row of actions along the top must fit the screen whatever its width
  // and language (a tablet in landscape showed the labels and ran the row
  // off the right edge): measured with the labels, it drops them (icons,
  // names kept as tooltips and for screen readers) when they do not fit,
  // and wraps into a second row only if even the icons do not.
  const actionsRef = useRef<HTMLDivElement>(null);
  const [actionsFit, setActionsFit] = useState<"full" | "compact" | "wrap">("full");
  const actionsFitRef = useRef(actionsFit);
  useEffect(() => {
    actionsFitRef.current = actionsFit;
  }, [actionsFit]);
  useEffect(() => {
    const row = actionsRef.current;
    const shell = shellRef.current;
    if (!row || !shell) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // A column (the portrait phone layout) has its own rules.
      if (getComputedStyle(row).flexDirection === "column") {
        setActionsFit("full");
        return;
      }
      const rowBox = row.getBoundingClientRect();
      let room = shell.getBoundingClientRect().right - rowBox.left - 12;
      // Nor under a card standing on the right at the row's height (the throttle on a short screen).
      for (const card of shell.querySelectorAll<HTMLElement>(".throttle-control, .control-panel.is-minimized")) {
        const box = card.getBoundingClientRect();
        if (box.width > 0 && box.top < rowBox.top + 50 && box.bottom > rowBox.top && box.left > rowBox.left + 60) room = Math.min(room, box.left - rowBox.left - 10);
      }
      row.style.setProperty("--actions-room", `${Math.max(44, Math.floor(room))}px`);
      const natural = (fit: string) => {
        row.classList.remove("is-compact", "is-wrapped");
        if (fit !== "full") row.classList.add("is-compact");
        row.style.flexWrap = "nowrap";
        row.style.maxWidth = "none";
        const width = row.scrollWidth;
        row.style.flexWrap = "";
        row.style.maxWidth = "";
        return width;
      };
      const next = natural("full") <= room ? "full" : natural("compact") <= room ? "compact" : "wrap";
      // Back to what React rendered (the state update below sets the classes for good).
      row.classList.toggle("is-compact", actionsFitRef.current !== "full");
      row.classList.toggle("is-wrapped", actionsFitRef.current === "wrap");
      setActionsFit(next);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(shell);
    window.addEventListener("resize", schedule);
    // The labels' font may arrive after the first measure.
    void document.fonts?.ready.then(schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [language, ready, snapshot.radioStation]);
  // Steering by tilting the phone is steering by feel, with the yacht in view:
  // the camera goes behind her (chase) while tilt steers, and back to the view
  // the player had when tilt is switched off (unless he changed it meanwhile).
  const cameraModeRef = useRef(snapshot.cameraMode);
  useEffect(() => {
    cameraModeRef.current = snapshot.cameraMode;
  }, [snapshot.cameraMode]);
  useEffect(() => {
    const simulator = simulatorRef.current;
    if (!tiltSteering || !ready || !simulator) return;
    const before = cameraModeRef.current;
    if (before !== "chase") simulator.setCameraMode("chase");
    return () => {
      if (before !== "chase" && cameraModeRef.current === "chase") simulatorRef.current?.setCameraMode(before);
    };
  }, [tiltSteering, ready]);
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
      else if (action === "engine-on-space") showNotice(voyage.engineOnSpace);
      else if (action === "engine-off-space") showNotice(voyage.engineOffSpace);
      else if (action === "trader-charted") showNotice(voyage.traderCharted);
      else if (action === "bag-full") showNotice(shopWords.bagFull);
      else if (action === "engine-broken") showNotice(storyWords.engineBroken);
    },
    discovery: (discovery) => {
      discoveryId.current += 1;
      const view = { ...discovery, id: discoveryId.current };
      setDiscoveries((queue) => [...queue.slice(-3), view]);
      try { navigator.vibrate?.(discovery.kind === "poi" ? [20, 40, 20] : 16); } catch { /* not available */ }
    },
    radioFailed: () => showNotice(voyage.radioFailed),
    find: (find) => {
      showNotice(find.chest ? fill(shopWords.chestNotice, { gold: find.value }) : fill(shopWords.foundNotice, { name: findName(shopWords, find.kind), gold: find.value }));
      try { navigator.vibrate?.(find.chest ? [30, 50, 30, 50, 60] : 14); } catch { /* not available */ }
    },
    trade: () => {
      if (controlsOpen) return;
      setChartOpen(false);
      simulatorRef.current?.setDiverFrozen(true);
      setShopOpen(true);
    },
    autosave: () => showNotice(storyWords.autosaved),
    pointerLost: () => {
      // Esc with the mouse held: the browser takes the key and lets the
      // mouse go; that is the player asking for the menu.
      if (shopOpen || inventoryOpen || controlsOpen || chartOpen) return;
      setPauseOpen(true);
    },
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
    // Not on foot or in the water: the cinematic view is the yacht's.
    if (snapshot.diver.mode !== "helm") return;
    photoModeRef.current = true;
    setPhotoMode(true);
    // The interface is hidden in photo mode, so say once how to get it back.
    setPhotoHint(true);
    // The camera now turns by itself to whales, dolphins, sharks, eruptions and ships' horns.
    simulatorRef.current?.setPhotoMode(true);
  };



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

  const unlockSound = () => {
    const simulator = simulatorRef.current;
    if (!simulator) return;
    // Run the complete unlock path during pointerdown. On iOS WebKit the
    // AudioContext state change can remove this button before a later click is
    // dispatched, so click alone is not a reliable first-gesture handler.
    simulator.setSoundEnabled(true);
    simulator.startAudioFromUser();
  };

  /** M: sound on or off (the key is the player asking for it, so it may start the audio). */
  const toggleSoundKey = () => {
    const simulator = simulatorRef.current;
    if (!simulator) return;
    const playing = snapshot.soundEnabled && snapshot.audioReady;
    if (playing) simulator.setSoundEnabled(false);
    else unlockSound();
    showNotice(playing ? voyage.soundKeyOff : voyage.soundKeyOn);
  };

  // Keyboard commands (the helm and the throttle are the simulator's own keys).
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const onKey = (event: KeyboardEvent) => {
    if (!ready || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (isTypingTarget(event.target)) return;
    if (pausedAfoot) return;
    // On foot, Esc is the pause menu (with the mouse held, the browser keeps
    // the key and only lets the mouse go: that opens the menu too).
    if (away && event.code === "Escape" && !shopOpen && !inventoryOpen && !controlsOpen && !chartOpen && !photoMode) {
      setPauseOpen(true);
      event.preventDefault();
      return;
    }
    // On foot his own keys (as the player set them) are his, not the interface's.
    const afootAction = (action: BindingAction) => away && keyBindings.matches(action, event.code);
    if (away && !afootAction("chart") && !afootAction("backpack") && !afootAction("helm") && keyBindings.bound(event.code)) return;
    // The controls card: H opens and closes it, Esc closes it; it holds the keys while open.
    // The shop and the backpack hold the keys while open (they close themselves).
    if (shopOpen || inventoryOpen) return;
    // The backpack, on foot and at the helm.
    if (away ? afootAction("backpack") : event.code === "Tab") {
      if (!controlsOpen) openInventory();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyH") {
      if (controlsOpen) closeControls();
      else {
        if (photoMode) exitPhotoMode();
        setChartOpen(false);
        simulatorRef.current?.setDiverFrozen(true);
        setControlsOpen(true);
      }
      event.preventDefault();
      return;
    }
    if (controlsOpen) {
      if (event.code === "Escape") {
        closeControls();
        event.preventDefault();
      }
      return;
    }
    // The campaign's keys: the journal (L), the rifle (1), and at the helm the story's action (E).
    const campaign = snapshot.story?.mode === "campaign";
    if (campaign && event.code === "KeyL") {
      if (photoMode) exitPhotoMode();
      simulatorRef.current?.releaseDiverPointer();
      setJournalOpen((open) => !open);
      event.preventDefault();
      return;
    }
    if (campaign && (event.code === "Digit1" || event.code === "Numpad1") && !photoMode) {
      if (simulatorRef.current?.toggleRifle()) event.preventDefault();
      return;
    }
    if (campaign && !away && event.code === "KeyE" && !photoMode) {
      if (simulatorRef.current?.storyAct()) event.preventDefault();
      return;
    }
    // Sound on and off from anywhere, the skipper's own eyes and the cinematic view included.
    if (event.code === "KeyM") {
      toggleSoundKey();
      event.preventDefault();
      return;
    }
    if (away ? afootAction("helm") : event.code === "KeyT") {
      // From the cinematic view too: it closes, and he steps away.
      if (photoMode) exitPhotoMode();
      setChartOpen(false);
      // Away from the helm and back (on foot the walk keys are the diver's own).
      setPauseOpen(false);
      if (away) simulatorRef.current?.returnToHelm();
      else simulatorRef.current?.leaveHelm();
      event.preventDefault();
      return;
    }
    // The chart (Q or N), on foot too.
    if (away ? afootAction("chart") : event.code === "KeyQ" || event.code === "KeyN") {
      if (photoMode) exitPhotoMode();
      // Closed with its own key: the key press is the gesture that gives the mouse back.
      if (chartOpen) closeChart();
      else setChartOpen(true);
      event.preventDefault();
      return;
    }
    // V changes the view of the yacht (from the cinematic view too).
    if (event.code === "KeyV") {
      if (away) {
        showNotice(voyage.viewAtHelm);
      } else {
        if (photoMode) exitPhotoMode();
        const modes = Object.keys(cameraLabels) as CameraMode[];
        const next = modes[(modes.indexOf(snapshot.cameraMode) + 1) % modes.length]!;
        setCamera(next);
        showNotice(`${messages.camera}: ${cameraLabels[next]}`);
      }
      event.preventDefault();
      return;
    }
    if (photoMode) return;
    // On deck and in the water the signals, flares and camera keys are not his.
    // Nor is the cinematic view (P): it is a view of the yacht.
    // On foot in the campaign: R changes the magazine, B binds a wound.
    if (campaign && away && event.code === "KeyR") {
      simulatorRef.current?.reloadWeapon();
      event.preventDefault();
      return;
    }
    if (campaign && away && event.code === "KeyB") {
      simulatorRef.current?.applyBandage();
      event.preventDefault();
      return;
    }
    if (away && ["KeyF", "KeyG", "KeyJ", "KeyB", "KeyR", "KeyO", "KeyP"].includes(event.code)) return;
    switch (event.code) {
      case "KeyP":
        setChartOpen(false);
        enterPhotoMode();
        break;
      case "KeyJ":
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
      case "KeyO":
        if (event.shiftKey) stepRadio(-1);
        else if (snapshot.radioStation && snapshot.radioStation === stations[stations.length - 1]!.id) tuneRadio(null);
        else stepRadio(1);
        break;
      case "KeyR":
        recenterCamera();
        break;
      case "Escape":
        // The panel first, then a card, then the pause menu (at the wheel too).
        if (!panelMinimized) setPanelMinimized(true);
        else if (discoveries.length > 0) closeDiscovery();
        else if (!photoMode && !chartOpen) setPauseOpen(true);
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
      className={`simulator-shell ${panelMinimized ? "" : "settings-open"}${ready && mainMenu ? " is-main-menu" : ""}${!mainMenu && snapshot.story?.cinematic ? " is-cinematic" : ""}${!mainMenu && !away && snapshot.story?.alert ? " is-blackout" : ""}`}
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
      {/* Drawn straight to the screen (the low preset) the picture has no
          lens finish: the page lays its vignette over it, at no cost to the GPU. */}
      {ready && snapshot.quality === "low" && <div className="scene-vignette" aria-hidden="true" />}

      {/* Cinematic mode: black bars close in from above and below, as in a
          cinema; taps pass through them to the picture. */}
      <div className={`cinema-bars ${photoMode ? "is-on" : ""}`} aria-hidden="true">
        <div className="cinema-bar cinema-bar-top" />
        <div className="cinema-bar cinema-bar-bottom" />
      </div>

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

      {/* What a control has just done: over everything, the skipper's own
          view included (the cinematic view keeps its picture clean). */}
      {!photoMode && <DustNotices items={notices} onGone={dropNotice} />}

      {ready && controlsOpen && (
        <ControlsCard messages={voyage} touch={coarsePointer} firstVisit={controlsFirst} onClose={closeControls} />
      )}

      {ready && inventoryOpen && !controlsOpen && !shopOpen && (
        <InventoryModal
          economy={snapshot.economy}
          gold={snapshot.doubloons}
          messages={shopWords}
          onDiscard={(index) => simulatorRef.current?.discardStack(index)}
          onClose={closeInventory}
        />
      )}

      {ready && shopOpen && !controlsOpen && (
        <ShopModal
          economy={snapshot.economy}
          gold={snapshot.doubloons}
          messages={shopWords}
          onClose={closeShop}
          actions={{
            sell: (kind) => simulatorRef.current?.sellFinds(kind) ?? 0,
            buyUpgrade: (id) => simulatorRef.current?.buyUpgrade(id) ?? false,
            buyDecor: (id) => simulatorRef.current?.buyDecor(id) ?? false,
            equip: (slot, id) => simulatorRef.current?.equipDecor(slot, id),
          }}
        />
      )}

      {/* Faded rather than removed, so leaving photo mode is a smooth return;
          inert keeps the hidden controls out of reach meanwhile. */}
      {ready && away && !photoMode && (
        <DiverHud
          diver={snapshot.diver}
          storyPrompt={snapshot.diver.prompt === "story" ? storyPromptText(snapshot.diver.promptDetail, language) : null}
          helmLocked={snapshot.story?.boatLocked ?? false}
          messages={diverWords}
          shop={shopWords}
          wallet={{ gold: snapshot.doubloons, bag: snapshot.economy.bagCount }}
          touch={coarsePointer}
          actions={{
            returnToHelm: () => simulatorRef.current?.returnToHelm(),
            interact: () => simulatorRef.current?.diverInteract(),
            jump: () => simulatorRef.current?.diverJump(),
            toggleTorch: () => simulatorRef.current?.toggleTorch(),
            inventory: openInventory,
            stick: (x, y) => simulatorRef.current?.setDiverStick(x, y),
            hold: (up, down) => simulatorRef.current?.setDiverHold(up, down),
            pause: () => setPauseOpen(true),
          }}
        />
      )}

      {pausedAfoot && (
        <PauseMenu
          messages={pauseWords}
          labels={{
            language: messages.language,
            controls: messages.controls,
            quality: messages.quality,
            backToHelm: diverWords.backToHelm,
            sound: messages.sound,
            on: messages.on,
            off: messages.off,
          }}
          qualityLabels={qualityLabels}
          quality={snapshot.qualityChoice}
          ultra={!coarsePointer}
          language={language}
          soundOn={snapshot.soundEnabled && snapshot.audioReady}
          touch={coarsePointer}
          onResume={resumeFromPause}
          away={away}
          onSave={snapshot.story?.mode === "campaign" ? (slot) => simulatorRef.current?.saveGame(slot) ?? Promise.resolve("no-campaign" as const) : undefined}
          saveBlocked={
            snapshot.story
              ? saveBlock({
                  campaign: snapshot.story.mode === "campaign",
                  cinematic: snapshot.story.cinematic,
                  frozen: snapshot.story.frozen,
                  fade: snapshot.story.fade,
                  attacking: snapshot.combat.attacking,
                  anchored: snapshot.story.anchored,
                })
              : "no-campaign"
          }
          onLoad={(slot) => {
            setPauseOpen(false);
            setJournalOpen(false);
            setChartOpen(false);
            const simulator = simulatorRef.current;
            simulator?.setPaused(false);
            simulator?.loadGame(slot);
          }}
          onMainMenu={toMainMenu}
          onBackToHelm={() => {
            setPauseOpen(false);
            simulatorRef.current?.setPaused(false);
            simulatorRef.current?.returnToHelm();
          }}
          onQuality={setQuality}
          onLanguage={changeLanguage}
          onSound={toggleSoundKey}
          campaignLabel={snapshot.story?.mode === "campaign" ? storyWords.journal : undefined}
          onCampaign={
            snapshot.story?.mode === "campaign"
              ? () => {
                  setPauseOpen(false);
                  simulatorRef.current?.setPaused(false);
                  setJournalOpen(true);
                }
              : undefined
          }
        />
      )}
      {ready && mainMenu && menuSettings && (
        <PauseMenu
          settingsOnly
          messages={pauseWords}
          labels={{
            language: messages.language,
            controls: messages.controls,
            quality: messages.quality,
            backToHelm: diverWords.backToHelm,
            sound: messages.sound,
            on: messages.on,
            off: messages.off,
          }}
          qualityLabels={qualityLabels}
          quality={snapshot.qualityChoice}
          ultra={!coarsePointer}
          language={language}
          soundOn={snapshot.soundEnabled && snapshot.audioReady}
          touch={coarsePointer}
          away={false}
          onResume={() => setMenuSettings(false)}
          onBackToHelm={() => setMenuSettings(false)}
          onQuality={setQuality}
          onLanguage={changeLanguage}
          onSound={toggleSoundKey}
        />
      )}

      {/* The campaign: markers pinned to the scene, the story's screen, its menus. */}
      {ready && !photoMode && <StoryOverlay listenerRef={overlayListener} language={language} active={snapshot.story?.mode === "campaign" && !mainMenu && !snapshot.story.cinematic} />}
      {ready && !photoMode && !mainMenu && snapshot.story?.mode === "campaign" && (
        <CinemaLayer view={snapshot.story} language={language} touch={coarsePointer} atHelm={!away} onSkip={() => simulatorRef.current?.skipCutscene()} />
      )}
      {ready && !photoMode && !mainMenu && snapshot.story && (
        <StoryHud
          view={snapshot.story}
          combat={snapshot.combat}
          language={language}
          touch={coarsePointer}
          atHelm={!away}
          onAct={() => simulatorRef.current?.storyAct()}
          onSkip={() => simulatorRef.current?.skipStoryLine()}
          onToggleRifle={() => simulatorRef.current?.toggleRifle()}
          onCrouch={() => simulatorRef.current?.toggleCrouch()}
          onReload={() => simulatorRef.current?.reloadWeapon()}
          onBandage={() => simulatorRef.current?.applyBandage()}
          onJournal={() => {
            simulatorRef.current?.releaseDiverPointer();
            setJournalOpen(true);
          }}
        />
      )}
      {ready && mainMenu && !menuSettings && snapshot.story && (
        <MainMenu
          language={language}
          saved={snapshot.story.saved}
          onNew={() => {
            leaveMainMenu();
            simulatorRef.current?.startCampaign();
          }}
          onContinue={() => {
            leaveMainMenu();
            simulatorRef.current?.continueCampaign();
          }}
          onLoad={(slot) => {
            leaveMainMenu();
            simulatorRef.current?.loadGame(slot);
          }}
          onFree={() => {
            leaveMainMenu();
            simulatorRef.current?.chooseFreeSail();
            openGuideIfPending();
          }}
          onSettings={() => setMenuSettings(true)}
        />
      )}
      {journalOpen && snapshot.story && (
        <JournalModal
          view={snapshot.story}
          language={language}
          onClose={() => setJournalOpen(false)}
          onSwitch={toMainMenu}
        />
      )}

      {/* The chart and its minimap belong to the skipper as much as to the
          helm: they live outside the sailing interface, which is hidden
          while he is on foot or in the water. */}
      {!photoMode && (
        <ChartView
          simulatorRef={simulatorRef}
          messages={voyage}
          storyLanguage={language === "ru" ? "ru" : "en"}
          open={chartOpen}
          onOpen={() => {
            setPanelMinimized(true);
            simulatorRef.current?.releaseDiverPointer();
            setChartOpen(true);
          }}
          onClose={closeChart}
          onTravel={travelTo}
          hideMini={(!away && !panelMinimized) || pausedAfoot}
          afoot={away}
          ready={ready}
        />
      )}
      <div className={`travel-veil${travelVeil ? " is-on" : ""}`} aria-hidden="true" />

      <div
        className={`simulator-interface ${photoMode || away ? "photo-hidden" : ""} ${!loading.ready && !error ? "is-loading" : "is-ready"}`}
        inert={photoMode || away}
        aria-hidden={photoMode || away}
      >

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

        <div className="notice-stack">
          <SoundPrompt
            active={loading.ready && snapshot.soundEnabled && !snapshot.audioReady && !error}
            targetRef={soundDockRef}
            label={messages.tapSound}
            onUnlock={unlockSound}
            onArrived={onSoundPromptArrived}
          />
          {ready && (
            <DiscoveryCard key={discoveries[0]?.id ?? 0} discovery={discoveries[0] ?? null} messages={voyage} upgradeName={(id) => shopText(shopWords, `up_${id}`)} onClose={closeDiscovery} onHoist={(color) => {
              hoistSail(color);
              closeDiscovery();
            }} />
          )}
          {ready && snapshot.stuck && <StuckChip messages={voyage} onRescue={rescueBoat} />}
          {ready && !discoveries.length && !controlsOpen && <LootChip loot={snapshot.nearestLoot} messages={voyage} />}
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

        <div ref={actionsRef} className={`scene-actions${actionsFit === "compact" ? " is-compact" : actionsFit === "wrap" ? " is-compact is-wrapped" : ""}`}>
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
            className="scene-action"
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
            title={`${diverWords.leaveHelm} (T)`}
            onClick={() => simulatorRef.current?.leaveHelm()}
          >
            <ControlIcon name="walk" />
            <span className="scene-action-label">{diverWords.leaveHelm}</span>
          </button>
          <button
            type="button"
            className="scene-action"
            disabled={!ready}
            aria-expanded={chartOpen}
            title={`${messages.openMap} (Q)`}
            onClick={() => {
              setPanelMinimized(true);
              setChartOpen(true);
            }}
          >
            <ControlIcon name="map" />
            <span className="scene-action-label">{messages.map}</span>
          </button>
          <button
            type="button"
            className="scene-action"
            disabled={!ready}
            aria-haspopup="dialog"
            title={`${pauseWords.paused} (Esc)`}
            onClick={() => {
              setPanelMinimized(true);
              setChartOpen(false);
              setPauseOpen(true);
            }}
          >
            <span className="journal-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <span className="scene-action-label">{storyWords.menu}</span>
          </button>
          <button
            type="button"
            className="scene-action"
            disabled={!ready}
            aria-haspopup="dialog"
            aria-label={shopWords.invTitle}
            title={`${shopWords.invTitle} (Tab)`}
            onClick={openInventory}
          >
            <span className="backpack-glyph" aria-hidden="true">🎒</span>
            <span className="scene-action-label">{shopWords.invTitle}</span>
          </button>
          <button
            type="button"
            className="scene-action controls-action"
            disabled={!ready}
            aria-haspopup="dialog"
            aria-label={voyage.controlsButton}
            title={`${voyage.controlsButton} (H)`}
            onClick={() => setControlsOpen(true)}
          >
            <span className="controls-glyph" aria-hidden="true">?</span>
            <span className="scene-action-label">{voyage.controlsButton}</span>
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
          <div className="instrument" data-nosignal={storyWords.noSignal}><span>{messages.speed}</span><strong>{snapshot.speedKnots.toFixed(1)}</strong><small>kn</small></div>
          <div className="instrument" data-nosignal={storyWords.noSignal}><span>{messages.depth}</span><strong>{snapshot.depthMeters.toFixed(1)}</strong><small>m</small></div>
          <div className="instrument wind-instrument" data-nosignal={storyWords.noSignal}>
            <span><span className="wind-label-full">{messages.apparentWind}</span><span className="wind-label-short">{messages.wind}</span></span><strong>{snapshot.apparentWindKnots.toFixed(1)}</strong>
            <small>kn<span className="wind-angle"> · {Math.abs(snapshot.apparentWindAngle).toFixed(0)}°</span></small>
            {snapshot.gust > 0.15 && <em className="gust-flag" title={voyage.gust}>{voyage.gust}</em>}
          </div>
        </section>

        <section className="heading-card" aria-label={messages.heading}>
          <span className={`status-dot ${snapshot.status}`} />
          <strong>{compass}</strong><span>{messages.heading}</span>
        </section>

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
                  aria-label={`${messages.engineSound}: ${engineHeard ? messages.on : messages.off}`}
                  title={`${messages.engineSound}: ${engineHeard ? messages.on : messages.off}`}
                  aria-pressed={engineHeard}
                  onPointerDown={() => {
                    // With all sound off, asking for the engine asks for sound (iOS: inside the press).
                    if (!soundPlaying) unlockSound();
                  }}
                  onClick={() => {
                    // Sound only: this never starts, stops or throttles the engine.
                    const simulator = simulatorRef.current;
                    if (!simulator) return;
                    if (!soundPlaying) {
                      unlockSound();
                      simulator.setEngineMuted(false);
                      showNotice(`${messages.engineSound}: ${messages.on}`);
                      return;
                    }
                    simulator.setEngineMuted(!snapshot.engineMuted);
                    showNotice(`${messages.engineSound}: ${snapshot.engineMuted ? messages.on : messages.off}`);
                  }}
                ><ControlIcon name={engineHeard ? "engine-sound" : "engine-muted"} /></button>
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
                  {snapshot.economy.bagCount > 0 && <span title={shopWords.bag}>🎒 {snapshot.economy.bagCount}</span>}
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
                  <button type="button" className="key-help-open" onClick={() => setControlsOpen(true)}>{voyage.controlsButton} · H</button>
                </div>
              )}
              </>)}

              {panelTab === "scene" && <footer className="panel-footer">
                <label>
                  <span>{messages.quality}</span>
                  <select value={snapshot.qualityChoice} onChange={(event) => setQuality(event.target.value as QualityChoice)}>
                    <option value="auto">{messages.auto}</option>
                    <option value="low">{messages.low}</option><option value="medium">{messages.medium}</option><option value="high">{messages.high}</option>
                    {/* The full pipeline is for a desktop GPU: not offered on a phone or tablet. */}
                    {(!coarsePointer || snapshot.quality === "ultra") && <option value="ultra">{voyage.qualityUltra}</option>}
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
          <section ref={rudderRef} className={`rudder-control${tiltSteering ? " is-tilt" : ""}${coarsePointer ? "" : " no-slider"}`} aria-label={messages.rudder}>
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
            {/* The slider is for fingers: a phone or a tablet steers with it (or by
                swiping the wheel, or by tilt). At a desk the helm is the keyboard
                (and the wheel can still be dragged with the mouse), so a computer
                gets no slider: the card is just the wheel, the angle and "centre". */}
            {coarsePointer && (
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
            )}
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
              className="engine-toggle"
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
