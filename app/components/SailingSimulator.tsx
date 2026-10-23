"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { EMPTY_SNAPSHOT } from "@/src/simulator/state";
import type { MapState, Simulator as SimulatorInstance } from "@/src/simulator/Simulator";
import type { CameraMode, LightingMode, LoadingState, PointOfInterestKind, QualityPreset } from "@/src/simulator/types";
import { ControlIcon } from "./ControlIcon";
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
import { FullMap, MiniMap } from "./NavigationMap";
import {
  requestTiltPermission,
  screenRollDegrees,
  STEERING_STORAGE_KEY,
  swipeToRudder,
  tiltToRudder,
} from "./steering";

const ASSET_LOAD_TOTAL = 7;
const ROTATE_HINT_KEY = "sailing-simulator-rotate-hint-dismissed";

function readStorage(storage: "local" | "session", key: string): string | null {
  try {
    return (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: "local" | "session", key: string, value: string): void {
  try {
    (storage === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    // The current session keeps working when storage is blocked.
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

function placeLabel(kind: PointOfInterestKind, messages: Messages): string {
  return messages[kind];
}

function photoFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `sailing-simulator-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`;
}

/** Save a photo: the share sheet on touch devices (Save to Photos), a download elsewhere. */
async function savePhoto(blob: Blob): Promise<void> {
  const name = photoFileName();
  const file = typeof File !== "undefined" ? new File([blob], name, { type: "image/jpeg" }) : null;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (coarse && file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch {
      // Cancelled or blocked: fall back to a download link.
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

export function SailingSimulator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulatorRef = useRef<SimulatorInstance | null>(null);
  const photoButtonRef = useRef<HTMLButtonElement>(null);
  const photoToolbarRef = useRef<HTMLDivElement>(null);
  const mapButtonRef = useRef<HTMLButtonElement>(null);
  const photoModeRef = useRef(false);
  const [photoMode, setPhotoMode] = useState(false);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [mapState, setMapState] = useState<MapState | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [loading, setLoading] = useState<LoadingState>({
    loaded: 0,
    total: ASSET_LOAD_TOTAL,
    label: "Preparing renderer",
    ready: false,
  });
  const [error, setError] = useState("");
  const [panelMinimized, setPanelMinimized] = useState(true);
  const [showHelp, setShowHelp] = useState(true);
  const [rudderInput, setRudderInput] = useState(0);
  const [throttleInput, setThrottleInput] = useState(0);
  const [engineInput, setEngineInput] = useState(false);
  const [engineNotice, setEngineNotice] = useState("");
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [toast, setToast] = useState<{ text: string; serial: number } | null>(null);
  const [photoNotice, setPhotoNotice] = useState(false);
  const [photoFlash, setPhotoFlash] = useState(0);
  const [tiltSteering, setTiltSteering] = useState(false);
  const [portraitPhone, setPortraitPhone] = useState(false);
  const [rotateHintDismissed, setRotateHintDismissed] = useState(true);
  const rudderDragging = useRef(false);
  const throttleDragging = useRef(false);
  const wheelSwipe = useRef<{ pointerId: number; startX: number; startRudder: number } | null>(null);
  const tiltNeutral = useRef<number | null>(null);
  const soundReadyAtPress = useRef(false);
  const engineNoticeTimer = useRef<number | undefined>(undefined);
  const lastDiscoverySerial = useRef(0);

  const exitPhotoMode = useCallback(() => {
    photoModeRef.current = false;
    setPhotoMode(false);
    simulatorRef.current?.setPhotoMode(false);
  }, []);

  const enterPhotoMode = () => {
    photoModeRef.current = true;
    setPhotoMode(true);
    setMapOpen(false);
    simulatorRef.current?.setPhotoMode(true);
  };

  useEffect(() => {
    if (!photoMode) return;
    const photoButton = photoButtonRef.current;
    photoToolbarRef.current?.querySelector("button")?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitPhotoMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      photoButton?.focus({ preventScroll: true });
    };
  }, [photoMode, exitPhotoMode]);

  const messages = useMemo(() => getMessages(language), [language]);
  const cameraLabels = useMemo<Record<CameraMode, string>>(() => ({
    chase: messages.chase,
    helm: messages.helm,
    orbit: messages.orbit,
    drone: messages.drone,
  }), [messages]);
  const qualityLabels = useMemo<Record<QualityPreset, string>>(() => ({
    auto: messages.auto,
    low: messages.low,
    medium: messages.medium,
    high: messages.high,
  }), [messages]);

  useEffect(() => {
    const applyPreferredLanguage = () => {
      const stored = readStorage("local", LANGUAGE_STORAGE_KEY);
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
    const followsSystemLanguage = !isLanguageCode(readStorage("local", LANGUAGE_STORAGE_KEY) ?? "");
    if (followsSystemLanguage) window.addEventListener("languagechange", applyPreferredLanguage);
    return () => window.removeEventListener("languagechange", applyPreferredLanguage);
  }, []);

  // Phone-in-portrait detection for the rotate hint; restore steering mode.
  useEffect(() => {
    const query = window.matchMedia("(max-width: 680px) and (orientation: portrait)");
    const update = () => setPortraitPhone(query.matches);
    // Browser-only preferences are read after hydration to match the server render.
    const restorePreferences = () => {
      setRotateHintDismissed(readStorage("session", ROTATE_HINT_KEY) === "1");
      setTiltSteering(readStorage("local", STEERING_STORAGE_KEY) === "tilt" && window.matchMedia("(pointer: coarse)").matches);
    };
    update();
    restorePreferences();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!rudderDragging.current && !wheelSwipe.current) setRudderInput(Math.round(snapshot.rudderDegrees / 35 * 100));
  }, [snapshot.rudderDegrees]);

  useEffect(() => {
    if (!throttleDragging.current) setThrottleInput(Math.round(snapshot.throttle * 100));
  }, [snapshot.throttle]);

  // Discovery and pickup toasts.
  useEffect(() => {
    const discovery = snapshot.lastDiscovery;
    if (!discovery || discovery.serial === lastDiscoverySerial.current) return;
    lastDiscoverySerial.current = discovery.serial;
    const collectible = discovery.kind === "bottle" || discovery.kind === "crate";
    const text = collectible
      ? `${messages.found}: ${placeLabel(discovery.kind, messages)} · ${snapshot.collected}/${snapshot.collectibleTotal}`
      : `${messages.discovered}: ${placeLabel(discovery.kind, messages)}`;
    setToast({ text, serial: discovery.serial });
    const timer = window.setTimeout(() => setToast((current) => (current?.serial === discovery.serial ? null : current)), 3800);
    return () => window.clearTimeout(timer);
  }, [snapshot.lastDiscovery, snapshot.collected, snapshot.collectibleTotal, messages]);

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
        simulator = new simulatorModule.Simulator(canvas, {
          onSnapshot: (nextSnapshot) => {
            setSnapshot(nextSnapshot);
            setEngineInput(nextSnapshot.engineRunning);
            if (nextSnapshot.status !== "loading" && simulator) setMapState(simulator.getMapState());
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
        });
        simulatorRef.current = simulator;
        if (process.env.NODE_ENV !== "production") (window as unknown as { __sailingSimulator?: unknown }).__sailingSimulator = simulator;
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

  // Keyboard shortcuts: M map, B bell, F flare.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
      if (photoModeRef.current || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === "KeyM") setMapOpen((open) => !open);
      if (event.code === "KeyB") simulatorRef.current?.ringBell();
      if (event.code === "KeyF") simulatorRef.current?.fireFlare();
      if (event.code === "Escape") setMapOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!mapOpen) return;
    const mapButton = mapButtonRef.current;
    return () => mapButton?.focus({ preventScroll: true });
  }, [mapOpen]);

  // Tilt steering: device roll relative to the pose captured when enabled.
  useEffect(() => {
    if (!tiltSteering) return;
    tiltNeutral.current = null;
    let lastSent = 0;
    const onOrientation = (event: DeviceOrientationEvent) => {
      const angle = screen.orientation?.angle ?? 0;
      const roll = screenRollDegrees({ beta: event.beta, gamma: event.gamma }, angle);
      if (tiltNeutral.current === null) tiltNeutral.current = roll;
      const rudder = tiltToRudder(roll, tiltNeutral.current);
      const now = performance.now();
      if (now - lastSent < 40) return;
      lastSent = now;
      simulatorRef.current?.setRudder(rudder);
      setRudderInput(Math.round(rudder * 100));
    };
    window.addEventListener("deviceorientation", onOrientation);
    return () => window.removeEventListener("deviceorientation", onOrientation);
  }, [tiltSteering]);

  const progress = loading.total > 0 ? Math.round((loading.loaded / loading.total) * 100) : 0;
  const compass = useMemo(() => `${snapshot.headingDegrees.toFixed(0).padStart(3, "0")}°`, [snapshot.headingDegrees]);
  const displayedRudderDegrees = rudderInput * 0.35;
  const displayedThrottle = throttleInput / 100;
  const wheelRotation = rudderInput * 2.7;
  const ready = loading.ready && !error;
  const qualityStatus = snapshot.quality === "auto" ? `${messages.auto} · ${qualityLabels[snapshot.qualityLevel]}` : qualityLabels[snapshot.quality];
  const rudderText = `${displayedRudderDegrees < -0.5 ? messages.port : displayedRudderDegrees > 0.5 ? messages.starboard : messages.center} ${Math.abs(displayedRudderDegrees).toFixed(0)}°`;

  const setLighting = (mode: LightingMode) => simulatorRef.current?.setLightingMode(mode);
  const setCamera = (mode: CameraMode) => simulatorRef.current?.setCameraMode(mode);
  const setQuality = (preset: QualityPreset) => simulatorRef.current?.setQuality(preset);
  const resetScene = () => {
    if (!ready) return;
    rudderDragging.current = false;
    throttleDragging.current = false;
    setRudderInput(0);
    setThrottleInput(0);
    setEngineNotice("");
    if (engineNoticeTimer.current !== undefined) window.clearTimeout(engineNoticeTimer.current);
    simulatorRef.current?.reset();
  };
  const setEngineRunning = (running: boolean) => {
    const simulator = simulatorRef.current;
    if (!simulator || !loading.ready) return;
    simulator.resumeAudioFromGesture();
    setEngineInput(running);
    if (!running) {
      throttleDragging.current = false;
      setThrottleInput(0);
    }
    simulator.setEngineRunning(running);
    const activeThrottle = running && Math.abs(displayedThrottle) <= 0.08 ? 0.12 : displayedThrottle;
    setEngineNotice(
      running
        ? `${messages.engine}: ${messages.on} · ${throttleLabel(activeThrottle, messages)} · ${messages.engineSound}: ${messages.on}`
        : `${messages.engine}: ${messages.off} · ${messages.throttle}: ${messages.neutral}`,
    );
    if (engineNoticeTimer.current !== undefined) window.clearTimeout(engineNoticeTimer.current);
    engineNoticeTimer.current = window.setTimeout(() => setEngineNotice(""), 2600);
    navigator.vibrate?.(running ? 24 : 14);
  };

  const toggleSound = () => {
    const simulator = simulatorRef.current;
    if (!simulator) return;
    if (snapshot.soundEnabled && !soundReadyAtPress.current) {
      simulator.resumeAudioFromGesture();
      return;
    }
    simulator.setSoundEnabled(!snapshot.soundEnabled);
  };

  const unlockSound = () => {
    const simulator = simulatorRef.current;
    if (!simulator) return;
    // Run the complete unlock path during pointerdown. On iOS WebKit the
    // AudioContext state change can remove this button before a later click is
    // dispatched, so click alone is not a reliable first-gesture handler.
    simulator.setSoundEnabled(true);
    simulator.resumeAudioFromGesture();
  };

  const ringBell = () => {
    simulatorRef.current?.resumeAudioFromGesture();
    simulatorRef.current?.ringBell();
  };

  const fireFlare = () => {
    simulatorRef.current?.resumeAudioFromGesture();
    simulatorRef.current?.fireFlare();
  };

  const takePhoto = async () => {
    const simulator = simulatorRef.current;
    if (!simulator) return;
    setPhotoFlash((value) => value + 1);
    navigator.vibrate?.(12);
    const blob = await simulator.capturePhoto();
    if (!blob) return;
    await savePhoto(blob);
    setPhotoNotice(true);
    window.setTimeout(() => setPhotoNotice(false), 2200);
  };

  const toggleTilt = async () => {
    if (tiltSteering) {
      setTiltSteering(false);
      writeStorage("local", STEERING_STORAGE_KEY, "slider");
      return;
    }
    // The permission prompt must come straight from this tap on iOS.
    if (!(await requestTiltPermission())) return;
    setTiltSteering(true);
    writeStorage("local", STEERING_STORAGE_KEY, "tilt");
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
    setShowHelp(false);
    simulatorRef.current?.setRudder(rudder);
  };
  const endWheelSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (wheelSwipe.current?.pointerId === event.pointerId) wheelSwipe.current = null;
  };

  const changeLanguage = (nextLanguage: LanguageCode) => {
    setLanguage(nextLanguage);
    writeStorage("local", LANGUAGE_STORAGE_KEY, nextLanguage);
    document.documentElement.lang = nextLanguage;
    document.documentElement.dir = isRtlLanguage(nextLanguage) ? "rtl" : "ltr";
  };

  const dismissRotateHint = () => {
    setRotateHintDismissed(true);
    writeStorage("session", ROTATE_HINT_KEY, "1");
  };

  const soundLabel = snapshot.soundEnabled ? (snapshot.audioReady ? `${messages.sound}: ${messages.on}` : messages.tapSound) : `${messages.sound}: ${messages.off}`;
  const mapTick = Math.round(snapshot.positionX * 2) * 7919 + Math.round(snapshot.positionZ * 2) + Math.round(snapshot.headingDegrees);

  return (
    <main
      className={`simulator-shell ${panelMinimized ? "" : "settings-open"} ${engineInput ? "engine-on" : "engine-off"}`}
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
        <div ref={photoToolbarRef} className="photo-toolbar" role="toolbar" aria-label={`${messages.photoMode}. ${messages.photoModeHint}`}>
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
            onClick={() => void takePhoto()}
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
              soundReadyAtPress.current = snapshot.audioReady;
              simulatorRef.current?.resumeAudioFromGesture();
            }}
            onClick={toggleSound}
          >
            <ControlIcon name={snapshot.soundEnabled && snapshot.audioReady ? "sound-on" : "sound-off"} />
          </button>
          {photoNotice && <span className="photo-saved" role="status">{messages.photoSaved}</span>}
        </div>
      )}
      {photoFlash > 0 && <div key={photoFlash} className="photo-flash" aria-hidden="true" />}

      <div className="simulator-interface" hidden={photoMode}>

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

        {loading.ready && snapshot.soundEnabled && !snapshot.audioReady && !error && (
          <button
            type="button"
            className="audio-unlock"
            onPointerDown={(event) => {
              event.preventDefault();
              unlockSound();
            }}
            onClick={unlockSound}
          >
            <span aria-hidden="true">♪</span>
            <strong>{messages.tapSound}</strong>
          </button>
        )}

        <div className="scene-actions">
          <button type="button" className="scene-action" disabled={!ready} onClick={resetScene} aria-label={messages.reset} title={messages.reset}>
            <ControlIcon name="reset" />
            <span>{messages.reset}</span>
          </button>
          <button
            ref={photoButtonRef}
            type="button"
            className="scene-action"
            disabled={!ready}
            title={`${messages.photoMode}. ${messages.photoModeHint}`}
            aria-label={messages.photoMode}
            aria-describedby="photo-mode-hint"
            onClick={enterPhotoMode}
          >
            <ControlIcon name="photo" />
            <span>{messages.photoMode}</span>
          </button>
          <button
            ref={mapButtonRef}
            type="button"
            className="scene-action"
            disabled={!ready}
            aria-label={messages.openMap}
            aria-expanded={mapOpen}
            aria-controls="navigation-map"
            title={`${messages.openMap} (M)`}
            onClick={() => setMapOpen(true)}
          >
            <ControlIcon name="map" />
            <span>{messages.map}</span>
          </button>
          <button type="button" className="scene-action" disabled={!ready} onClick={ringBell} aria-label={messages.bell} title={`${messages.bell} (B)`}>
            <ControlIcon name="bell" />
            <span>{messages.bell}</span>
          </button>
          <button
            type="button"
            className="scene-action flare-action"
            disabled={!ready || !snapshot.flareReady}
            onClick={fireFlare}
            aria-label={snapshot.flareReady ? messages.flare : messages.flareReloading}
            title={`${snapshot.flareReady ? messages.flare : messages.flareReloading} (F)`}
          >
            <ControlIcon name="flare" />
            <span>{snapshot.flareReady ? messages.flare : messages.flareReloading}</span>
          </button>
          <p id="photo-mode-hint" className="photo-mode-hint">{messages.photoModeHint}</p>
        </div>

        <section className="instrument-cluster" aria-label={messages.sailingControls}>
          <div className="instrument"><span>{messages.speed}</span><strong>{snapshot.speedKnots.toFixed(1)}</strong><small>kn</small></div>
          <div className="instrument"><span>{messages.depth}</span><strong>{snapshot.depthMeters.toFixed(1)}</strong><small>m</small></div>
          <div className="instrument wind-instrument">
            <span>{messages.apparentWind}</span><strong>{snapshot.apparentWindKnots.toFixed(1)}</strong>
            <small>kn<span className="wind-angle"> · {Math.abs(snapshot.apparentWindAngle).toFixed(0)}°</span></small>
          </div>
        </section>

        <section className="heading-card" aria-label={messages.heading}>
          <span className={`status-dot ${snapshot.status}`} />
          <strong>{compass}</strong><span>{messages.heading}</span>
        </section>

        {ready && (
          <button
            type="button"
            className="minimap"
            aria-label={`${messages.openMap} · ${messages.places} ${snapshot.discovered}/${snapshot.discoverableTotal}`}
            title={`${messages.openMap} (M)`}
            onClick={() => setMapOpen(true)}
          >
            <MiniMap state={mapState} revision={snapshot.mapRevision} tick={mapTick} messages={messages} />
            <span className="minimap-heading" aria-hidden="true">{compass}</span>
          </button>
        )}

        {mapOpen && (
          <section id="navigation-map" className="map-overlay" role="dialog" aria-modal="true" aria-label={messages.map}>
            <div className="map-card">
              <header>
                <div>
                  <p className="eyebrow">{messages.map}</p>
                  <span>
                    {messages.places} {snapshot.discovered}/{snapshot.discoverableTotal} · {messages.finds} {snapshot.collected}/{snapshot.collectibleTotal}
                  </span>
                </div>
                <button type="button" className="icon-button" aria-label={messages.closeMap} title={messages.closeMap} onClick={() => setMapOpen(false)} autoFocus>
                  <ControlIcon name="close" />
                </button>
              </header>
              <FullMap state={mapState} revision={snapshot.mapRevision} tick={mapTick} messages={messages} />
              <ul className="map-legend">
                <li><span className="legend-swatch legend-you" />{messages.you}</li>
                <li><span className="legend-swatch legend-ship" />{messages.ship}</li>
                <li><span className="legend-swatch legend-bottle" />{messages.bottle}</li>
                <li><span className="legend-swatch legend-crate" />{messages.crate}</li>
                <li><span className="legend-swatch legend-fog" />{messages.unexplored}</li>
              </ul>
            </div>
          </section>
        )}

        {!panelMinimized && (
          <button
            type="button"
            className="panel-scrim"
            aria-label={messages.minimize}
            onClick={() => setPanelMinimized(true)}
          />
        )}

        <section
          id="simulator-settings"
          className={`control-panel ${panelMinimized ? "is-minimized" : ""}`}
          aria-label={messages.controls}
        >
          <header>
            <div>
              <p className="eyebrow">
                <span className="full-control-title">{messages.sailingControls}</span>
                <span className="mobile-control-title">{messages.controls}</span>
              </p>
              {panelMinimized && (
                <span className="panel-mini-status" aria-live="polite">
                  {snapshot.soundEnabled && !snapshot.audioReady ? messages.tapSound : `${compass} ${messages.heading}`}
                </span>
              )}
              {!panelMinimized && (
                <span>
                  {snapshot.fps.toFixed(0)} FPS · {qualityStatus} ·{" "}
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
              onClick={() => setPanelMinimized((value) => !value)}
            >{panelMinimized ? "≡" : "×"}</button>
          </header>

          {!panelMinimized && (
            <div className="panel-body">
              <div className="compact-row">
                <div className="segmented" aria-label={`${messages.day} / ${messages.night}`}>
                  {(["day", "night"] as LightingMode[]).map((mode) => (
                    <button
                      type="button"
                      className="icon-control"
                      key={mode}
                      aria-label={mode === "day" ? messages.day : messages.night}
                      title={mode === "day" ? messages.day : messages.night}
                      aria-pressed={snapshot.lightingMode === mode}
                      onClick={() => setLighting(mode)}
                    >
                      <ControlIcon name={mode === "day" ? "sun" : "moon"} />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="quiet-button icon-control"
                  aria-label={`${messages.engine}: ${engineInput ? messages.stop : messages.start}`}
                  title={`${messages.engine}: ${engineInput ? messages.stop : messages.start}`}
                  aria-pressed={engineInput}
                  disabled={!loading.ready}
                  onPointerDown={() => simulatorRef.current?.resumeAudioFromGesture()}
                  onClick={() => setEngineRunning(!engineInput)}
                ><ControlIcon name="power" /></button>
                <button
                  type="button"
                  className="quiet-button icon-control"
                  aria-label={soundLabel}
                  title={soundLabel}
                  aria-pressed={snapshot.soundEnabled && snapshot.audioReady}
                  onPointerDown={() => {
                    soundReadyAtPress.current = snapshot.audioReady;
                    simulatorRef.current?.resumeAudioFromGesture();
                  }}
                  onClick={toggleSound}
                ><ControlIcon name={snapshot.soundEnabled && snapshot.audioReady ? "sound-on" : "sound-off"} /></button>
                <button
                  type="button"
                  className="quiet-button icon-control"
                  aria-label={`${messages.engineSound}: ${snapshot.engineMuted ? messages.off : messages.on}`}
                  title={`${messages.engineSound}: ${snapshot.engineMuted ? messages.off : messages.on}`}
                  aria-pressed={!snapshot.engineMuted}
                  onClick={() => simulatorRef.current?.setEngineMuted(!snapshot.engineMuted)}
                ><ControlIcon name={snapshot.engineMuted ? "engine-muted" : "engine-sound"} /></button>
              </div>

              <div className="panel-section">
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
                      onClick={() => setCamera(mode)}
                    >
                      <ControlIcon name={mode} />
                    </button>
                  ))}
                </div>
              </div>

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

              <footer className="panel-footer">
                <label>
                  <span>{messages.quality}</span>
                  <select value={snapshot.quality} onChange={(event) => setQuality(event.target.value as QualityPreset)}>
                    <option value="auto">{snapshot.quality === "auto" ? qualityStatus : messages.auto}</option>
                    <option value="low">{messages.low}</option>
                    <option value="medium">{messages.medium}</option>
                    <option value="high">{messages.high}</option>
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
              </footer>
            </div>
          )}
        </section>

        <div className="primary-controls">
          <section className={`rudder-control ${tiltSteering ? "is-tilt" : ""}`} aria-label={messages.rudder}>
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
              <strong>{rudderText}</strong>
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
            <div className="rudder-track-wrap">
              <span>{messages.port}</span>
              <input
                aria-label={messages.rudder}
                aria-valuetext={rudderText}
                className="rudder-slider"
                type="range"
                min="-100"
                max="100"
                value={rudderInput}
                disabled={tiltSteering}
                style={{ "--rudder-progress": `${(rudderInput + 100) / 2}%` } as CSSProperties}
                onPointerDown={() => { rudderDragging.current = true; }}
                onPointerUp={() => { rudderDragging.current = false; }}
                onPointerCancel={() => { rudderDragging.current = false; }}
                onBlur={() => { rudderDragging.current = false; }}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setRudderInput(value);
                  setShowHelp(false);
                  simulatorRef.current?.setRudder(value / 100);
                }}
              />
              <span>{messages.starboard}</span>
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
          </section>
        </div>

        {engineNotice && <div className="engine-notice" role="status">{engineNotice}</div>}
        {toast && <div className="discovery-toast" role="status">{toast.text}</div>}

        {ready && portraitPhone && !rotateHintDismissed && (
          <div className="rotate-hint" role="note">
            <span className="rotate-hint-icon" aria-hidden="true" />
            <p>{messages.rotateHint}</p>
            <button type="button" className="icon-button" aria-label={messages.dismiss} title={messages.dismiss} onClick={dismissRotateHint}>
              <ControlIcon name="close" />
            </button>
          </div>
        )}

        {showHelp && ready && (
          <button type="button" className="help-toast" onClick={() => setShowHelp(false)}>
            {messages.help}
          </button>
        )}
      </div>
    </main>
  );
}
