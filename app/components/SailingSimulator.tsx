"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_SNAPSHOT } from "@/src/simulator/state";
import type { Simulator as SimulatorInstance } from "@/src/simulator/Simulator";
import type { CameraMode, LightingMode, LoadingState, QualityPreset } from "@/src/simulator/types";

const ASSET_LOAD_TOTAL = 7;
const SMARTPHONE_VIEWPORT = "(max-width: 680px), (max-height: 560px) and (max-width: 960px)";

const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: "Chase",
  helm: "Helm",
  orbit: "Orbit",
  drone: "Drone",
};

function throttleLabel(value: number): string {
  if (value > 0.84) return "FULL AHEAD";
  if (value > 0.5) return "HALF AHEAD";
  if (value > 0.08) return "SLOW AHEAD";
  if (value < -0.84) return "FULL ASTERN";
  if (value < -0.5) return "HALF ASTERN";
  if (value < -0.08) return "SLOW ASTERN";
  return "NEUTRAL";
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
  const rudderDragging = useRef(false);
  const throttleDragging = useRef(false);
  const soundReadyAtPress = useRef(false);
  const engineNoticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPanelMinimized(window.matchMedia(SMARTPHONE_VIEWPORT).matches);
    });
    return () => window.cancelAnimationFrame(frame);
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
    setEngineNotice(
      running
        ? `Engine running · move throttle${snapshot.engineMuted ? " · sound muted" : ""}`
        : "Engine stopped · throttle neutral",
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

  return (
    <main
      className={`simulator-shell ${panelMinimized ? "" : "settings-open"}`}
      aria-label="Sailing Simulator Pro"
      onPointerDownCapture={() => simulatorRef.current?.resumeAudioFromGesture()}
    >
      <canvas ref={canvasRef} className="simulator-canvas" aria-label="Interactive tropical sailing scene" />

      {!loading.ready && !error && (
        <section className="loading-screen" aria-live="polite">
          <div className="loading-mark" aria-hidden="true">◒</div>
          <p className="eyebrow">Sailing Simulator Pro</p>
          <h1>Preparing the tropical sea</h1>
          <div className="loading-track"><span style={{ width: `${progress}%` }} /></div>
          <p>{loading.label} · {progress}%</p>
        </section>
      )}

      {error && (
        <section className="error-card" role="alert">
          <p className="eyebrow">Renderer notice</p>
          <h2>Scene interrupted</h2>
          <p>{error}</p>
          <button type="button" onClick={() => window.location.reload()}>Reload simulator</button>
        </section>
      )}

      <section className="instrument-cluster" aria-label="Navigation instruments">
        <div className="instrument"><span>Speed</span><strong>{snapshot.speedKnots.toFixed(1)}</strong><small>kn</small></div>
        <div className="instrument"><span>Depth</span><strong>{snapshot.depthMeters.toFixed(1)}</strong><small>m</small></div>
        <div className="instrument wind-instrument">
          <span>Apparent wind</span><strong>{snapshot.apparentWindKnots.toFixed(1)}</strong>
          <small>kn · {Math.abs(snapshot.apparentWindAngle).toFixed(0)}°</small>
        </div>
      </section>

      <section className="heading-card" aria-label="Current heading">
        <span className={`status-dot ${snapshot.status}`} />
        <strong>{compass}</strong><span>HDG</span>
      </section>

      {!panelMinimized && (
        <button
          type="button"
          className="panel-scrim"
          aria-label="Close simulator settings"
          onClick={() => setPanelMinimized(true)}
        />
      )}

      <section
        id="simulator-settings"
        className={`control-panel ${panelMinimized ? "is-minimized" : ""}`}
        aria-label="Simulator settings"
      >
        <header>
          <div>
            <p className="eyebrow">
              <span className="full-control-title">Sailing controls</span>
              <span className="mobile-control-title">Controls</span>
            </p>
            {panelMinimized && <span className="panel-mini-status">{compass} HDG</span>}
            {!panelMinimized && (
              <span>
                {snapshot.fps.toFixed(0)} FPS · {snapshot.quality.toUpperCase()} ·{" "}
                <a className="model-credits" href="/models/README.md" target="_blank" rel="noreferrer">3D credits</a>
              </span>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-controls="simulator-settings"
            aria-expanded={!panelMinimized}
            aria-label={panelMinimized ? "Expand control panel" : "Minimize control panel"}
            onClick={() => setPanelMinimized((value) => !value)}
          >{panelMinimized ? "≡" : "×"}</button>
        </header>

        {!panelMinimized && (
          <div className="panel-body">
            <div className="compact-row">
              <div className="segmented" aria-label="Lighting mode">
                {(["day", "night"] as LightingMode[]).map((mode) => (
                  <button type="button" key={mode} aria-pressed={snapshot.lightingMode === mode} onClick={() => setLighting(mode)}>
                    {mode === "day" ? "Day" : "Night"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="quiet-button"
                aria-pressed={engineInput}
                disabled={!loading.ready}
                onPointerDown={() => simulatorRef.current?.resumeAudioFromGesture()}
                onClick={() => setEngineRunning(!engineInput)}
              >{engineInput ? "Stop engine" : "Start engine"}</button>
              <button
                type="button"
                className="quiet-button"
                aria-pressed={snapshot.soundEnabled && snapshot.audioReady}
                onPointerDown={() => {
                  soundReadyAtPress.current = snapshot.audioReady;
                  simulatorRef.current?.resumeAudioFromGesture();
                }}
                onClick={toggleSound}
              >{snapshot.soundEnabled ? (snapshot.audioReady ? "Sound on" : "Tap for sound") : "Sound off"}</button>
              <button
                type="button"
                className="quiet-button"
                aria-pressed={snapshot.engineMuted}
                onClick={() => simulatorRef.current?.setEngineMuted(!snapshot.engineMuted)}
              >{snapshot.engineMuted ? "Engine sound off" : "Engine sound on"}</button>
            </div>

            <div className="panel-section">
              <div className="section-label"><span>Camera</span><strong>{CAMERA_LABELS[snapshot.cameraMode]}</strong></div>
              <div className="camera-grid">
                {(Object.keys(CAMERA_LABELS) as CameraMode[]).map((mode) => (
                  <button type="button" key={mode} aria-pressed={snapshot.cameraMode === mode} onClick={() => setCamera(mode)}>
                    {CAMERA_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>

            <div className="panel-section trim-row">
              <label htmlFor="sail-trim">Sail trim <strong>{Math.round(snapshot.sailTrim * 100)}%</strong></label>
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
                <span>Quality</span>
                <select value={snapshot.quality} onChange={(event) => setQuality(event.target.value as QualityPreset)}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </select>
              </label>
              <button type="button" className="reset-button" onClick={() => simulatorRef.current?.reset()}>Reset</button>
            </footer>
          </div>
        )}
      </section>

      <div className="primary-controls">
        <section className="rudder-control" aria-label="Rudder control">
          <div className="control-heading">
            <span>Rudder</span>
            <strong>{displayedRudderDegrees < -0.5 ? "PORT" : displayedRudderDegrees > 0.5 ? "STBD" : "CENTER"} {Math.abs(displayedRudderDegrees).toFixed(0)}°</strong>
          </div>
          <div className="rudder-track-wrap">
            <span>PORT</span>
            <input
              aria-label="Rudder angle"
              aria-valuetext={`${displayedRudderDegrees < -0.5 ? "Port" : displayedRudderDegrees > 0.5 ? "Starboard" : "Center"} ${Math.abs(displayedRudderDegrees).toFixed(0)} degrees`}
              type="range"
              min="-100"
              max="100"
              value={rudderInput}
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
            <span>STBD</span>
          </div>
          <button
            type="button"
            className="center-button"
            onClick={() => {
              setRudderInput(0);
              simulatorRef.current?.centerRudder();
            }}
          >
            <span className="full-center-label">Center rudder</span>
            <span className="mobile-center-label">Center</span>
          </button>
        </section>

        <section className={`throttle-control ${engineInput ? "" : "is-off"}`} aria-label="Engine and throttle controls">
          <button
            type="button"
            className="engine-power-button"
            aria-pressed={engineInput}
            aria-label={engineInput ? "Stop engine" : "Start engine"}
            disabled={!loading.ready}
            onPointerDown={() => simulatorRef.current?.resumeAudioFromGesture()}
            onClick={() => setEngineRunning(!engineInput)}
          >
            <span className="engine-power-dot" aria-hidden="true" />
            <span className="engine-power-copy">
              <small>{engineInput ? (snapshot.engineMuted ? "Running · muted" : "Running") : "Stopped"}</small>
              <strong>{engineInput ? "Stop" : "Start"}</strong>
            </span>
          </button>
          <div className="control-heading vertical-heading"><span>Throttle</span><strong>{engineInput ? throttleLabel(displayedThrottle) : "OFF"}</strong></div>
          <div className="throttle-layout">
            <span>FWD</span>
            <input
              aria-label="Throttle lever"
              aria-orientation="vertical"
              aria-valuetext={engineInput ? throttleLabel(displayedThrottle) : "Engine off"}
              className="throttle-slider"
              type="range"
              min="-100"
              max="100"
              disabled={!engineInput}
              value={throttleInput}
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
            <span>REV</span>
          </div>
        </section>
      </div>

      {engineNotice && <div className="engine-notice" role="status">{engineNotice}</div>}

      {showHelp && loading.ready && !error && (
        <button type="button" className="help-toast" onClick={() => setShowHelp(false)}>
          Swipe the sea to look · pinch to zoom · use the rudder and throttle independently
        </button>
      )}
    </main>
  );
}
