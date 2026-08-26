"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EMPTY_SNAPSHOT } from "@/src/simulator/state";
import type { Simulator as SimulatorInstance } from "@/src/simulator/Simulator";
import type { CameraMode, LightingMode, LoadingState, QualityPreset } from "@/src/simulator/types";
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

const ASSET_LOAD_TOTAL = 7;

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
  | "drone";

function ControlIcon({ name }: { name: ControlIconName }) {
  return (
    <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "sun" && (
        <>
          <circle cx="12" cy="12" r="3.4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
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
  const simulatorRef = useRef<SimulatorInstance | null>(null);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
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
  const rudderDragging = useRef(false);
  const throttleDragging = useRef(false);
  const soundReadyAtPress = useRef(false);
  const engineNoticeTimer = useRef<number | undefined>(undefined);

  const messages = useMemo(() => getMessages(language), [language]);
  const cameraLabels = useMemo<Record<CameraMode, string>>(() => ({
    chase: messages.chase,
    helm: messages.helm,
    orbit: messages.orbit,
    drone: messages.drone,
  }), [messages]);
  const qualityLabels = useMemo<Record<QualityPreset, string>>(() => ({
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
    if (!rudderDragging.current) setRudderInput(Math.round(snapshot.rudderDegrees / 35 * 100));
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
        simulator = new simulatorModule.Simulator(canvas, {
          onSnapshot: (nextSnapshot) => {
            setSnapshot(nextSnapshot);
            setEngineInput(nextSnapshot.engineRunning);
          },
          onLoading: setLoading,
          onError: setError,
        });
        simulatorRef.current = simulator;
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
  }, []);

  const progress = loading.total > 0 ? Math.round((loading.loaded / loading.total) * 100) : 0;
  const compass = useMemo(() => `${snapshot.headingDegrees.toFixed(0).padStart(3, "0")}°`, [snapshot.headingDegrees]);
  const displayedRudderDegrees = rudderInput * 0.35;
  const displayedThrottle = throttleInput / 100;
  const wheelRotation = rudderInput * 2.7;

  const setLighting = (mode: LightingMode) => simulatorRef.current?.setLightingMode(mode);
  const setCamera = (mode: CameraMode) => simulatorRef.current?.setCameraMode(mode);
  const setQuality = (preset: QualityPreset) => simulatorRef.current?.setQuality(preset);
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
      className={`simulator-shell ${panelMinimized ? "" : "settings-open"}`}
      aria-label={`Sailing Simulator Pro · ${messages.sailingControls}`}
      dir={isRtlLanguage(language) ? "rtl" : "ltr"}
      onPointerDownCapture={() => simulatorRef.current?.resumeAudioFromGesture()}
    >
      <canvas ref={canvasRef} className="simulator-canvas" aria-label={messages.sailingControls} />

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

      <section className="instrument-cluster" aria-label={messages.sailingControls}>
        <div className="instrument"><span>{messages.speed}</span><strong>{snapshot.speedKnots.toFixed(1)}</strong><small>kn</small></div>
        <div className="instrument"><span>{messages.depth}</span><strong>{snapshot.depthMeters.toFixed(1)}</strong><small>m</small></div>
        <div className="instrument wind-instrument">
          <span>{messages.apparentWind}</span><strong>{snapshot.apparentWindKnots.toFixed(1)}</strong>
          <small>kn · {Math.abs(snapshot.apparentWindAngle).toFixed(0)}°</small>
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
                {snapshot.fps.toFixed(0)} FPS · {qualityLabels[snapshot.quality]} ·{" "}
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
                aria-label={snapshot.soundEnabled ? (snapshot.audioReady ? `${messages.sound}: ${messages.on}` : messages.tapSound) : `${messages.sound}: ${messages.off}`}
                title={snapshot.soundEnabled ? (snapshot.audioReady ? `${messages.sound}: ${messages.on}` : messages.tapSound) : `${messages.sound}: ${messages.off}`}
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
              <button type="button" className="reset-button" onClick={() => simulatorRef.current?.reset()}>{messages.reset}</button>
            </footer>
          </div>
        )}
      </section>

      <div className="primary-controls">
        <section className="rudder-control" aria-label={messages.rudder}>
          <div className="helm-wheel" aria-hidden="true">
            <svg viewBox="0 0 100 100">
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
            <strong>{displayedRudderDegrees < -0.5 ? messages.port : displayedRudderDegrees > 0.5 ? messages.starboard : messages.center} {Math.abs(displayedRudderDegrees).toFixed(0)}°</strong>
          </div>
          <div className="rudder-track-wrap">
            <span>{messages.port}</span>
            <input
              aria-label={messages.rudder}
              aria-valuetext={`${displayedRudderDegrees < -0.5 ? messages.port : displayedRudderDegrees > 0.5 ? messages.starboard : messages.center} ${Math.abs(displayedRudderDegrees).toFixed(0)}°`}
              className="rudder-slider"
              type="range"
              min="-100"
              max="100"
              value={rudderInput}
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
          <button
            type="button"
            className="center-button"
            onClick={() => {
              setRudderInput(0);
              simulatorRef.current?.centerRudder();
            }}
          >
            <span className="full-center-label">{messages.centerRudder}</span>
            <span className="mobile-center-label">{messages.center}</span>
          </button>
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

      {showHelp && loading.ready && !error && (
        <button type="button" className="help-toast" onClick={() => setShowHelp(false)}>
          {messages.help}
        </button>
      )}
    </main>
  );
}
