"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Simulator } from "@/src/simulator/Simulator";
import { FOG_CELL } from "@/src/simulator/map/ChartMath";
import { drawChart, scaleBar, type ChartCamera, type ChartLabels } from "./chartDraw";
import { fill, type FeatureMessages } from "./featureMessages";

/**
 * The chart: a round minimap in the corner (north up, the yacht in the
 * middle) and, from it or with the N key, a full-screen chart to pan and
 * zoom, with the places found, the yacht's track and fog over the sea not
 * yet seen.
 */

const MINI_RANGE = 1300;
const MIN_MPP = 0.9;
const MAX_MPP = 70;

type Props = {
  simulatorRef: RefObject<Simulator | null>;
  messages: FeatureMessages;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The minimap is not shown (photo mode, the settings open, the first-run guide). */
  hideMini: boolean;
  ready: boolean;
};

function useCanvasSize(canvas: RefObject<HTMLCanvasElement | null>, active: boolean): { width: number; height: number; dpr: number } {
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  useEffect(() => {
    const element = canvas.current;
    if (!element || !active) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height, dpr: Math.min(2, window.devicePixelRatio || 1) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvas, active]);
  return size;
}

export function ChartView({ simulatorRef, messages, open, onOpen, onClose, hideMini, ready }: Props) {
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const fullRef = useRef<HTMLCanvasElement | null>(null);
  const miniSize = useCanvasSize(miniRef, ready && !open && !hideMini);
  const fullSize = useCanvasSize(fullRef, ready && open);
  const view = useRef({ x: 0, z: 0, mpp: 7, follow: true });
  const [stats, setStats] = useState({ area: 0, found: 0 });
  const [scale, setScale] = useState(scaleBar(7));
  const labels = useMemo<ChartLabels>(
    () => ({
      volcano: messages.volcano,
      barge: messages.barge,
      wreck: messages.wreck,
      monolith: messages.monolith,
      unknown: messages.chartUnknown,
    }),
    [messages],
  );

  /** Gives the canvas its backing store at the device's pixel ratio. */
  const fit = (canvas: HTMLCanvasElement, size: { width: number; height: number; dpr: number }) => {
    const width = Math.max(1, Math.round(size.width * size.dpr));
    const height = Math.max(1, Math.round(size.height * size.dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  };

  // The minimap: a few frames a second is plenty for a yacht.
  useEffect(() => {
    if (!ready || open || hideMini || miniSize.width === 0) return;
    const canvas = miniRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    fit(canvas, miniSize);
    let frame = 0;
    let last = -1;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 160) return;
      last = now;
      const simulator = simulatorRef.current;
      const { width, height, dpr } = miniSize;
      const mpp = (MINI_RANGE * 2) / width;
      const position = simulator?.chartCentre();
      if (!simulator || !position) return;
      const camera: ChartCamera = { x: position.x, z: position.z, mpp, width, height, dpr };
      const data = simulator.chart(
        camera.x - (width / 2) * mpp,
        camera.z - (height / 2) * mpp,
        camera.x + (width / 2) * mpp,
        camera.z + (height / 2) * mpp,
      );
      if (data) drawChart(context, camera, data, { mini: true, time: now / 1000, labels });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [ready, open, hideMini, miniSize, simulatorRef, labels]);

  // The full chart.
  useEffect(() => {
    if (!ready || !open || fullSize.width === 0) return;
    const canvas = fullRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    fit(canvas, fullSize);
    let frame = 0;
    let last = -1;
    let lastStats = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 32) return;
      last = now;
      const simulator = simulatorRef.current;
      const position = simulator?.chartCentre();
      if (!simulator || !position) return;
      const state = view.current;
      if (state.follow) {
        state.x = position.x;
        state.z = position.z;
      }
      const { width, height, dpr } = fullSize;
      const camera: ChartCamera = { x: state.x, z: state.z, mpp: state.mpp, width, height, dpr };
      const data = simulator.chart(
        camera.x - (width / 2) * camera.mpp,
        camera.z - (height / 2) * camera.mpp,
        camera.x + (width / 2) * camera.mpp,
        camera.z + (height / 2) * camera.mpp,
      );
      if (!data) return;
      drawChart(context, camera, data, { mini: false, time: now / 1000, labels });
      if (now - lastStats > 500) {
        lastStats = now;
        setStats({
          area: (data.explored.cells.size * FOG_CELL * FOG_CELL) / 1e6,
          found: simulator.discoveredCount,
        });
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [ready, open, fullSize, simulatorRef, labels]);

  // Opening the chart centres it on the yacht.
  useEffect(() => {
    if (open) {
      view.current.follow = true;
      setScale(scaleBar(view.current.mpp));
    }
  }, [open]);

  // Pan, wheel and pinch on the full chart.
  useEffect(() => {
    const canvas = fullRef.current;
    if (!open || !canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const zoomAt = (factor: number, sx: number, sy: number) => {
      const state = view.current;
      const rect = canvas.getBoundingClientRect();
      const next = Math.min(MAX_MPP, Math.max(MIN_MPP, state.mpp * factor));
      // Keep the world point under the cursor where it is.
      const dx = sx - rect.left - rect.width / 2;
      const dy = sy - rect.top - rect.height / 2;
      state.x += -dx * state.mpp + dx * next;
      state.z += -dy * state.mpp + dy * next;
      state.mpp = next;
      setScale(scaleBar(next));
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      view.current.follow = false;
      zoomAt(Math.exp(event.deltaY * 0.0015), event.clientX, event.clientY);
    };
    const onDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
    };
    const onMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const state = view.current;
      if (pointers.size === 1) {
        const dx = event.clientX - previous.x;
        const dy = event.clientY - previous.y;
        if (Math.abs(dx) + Math.abs(dy) > 0) state.follow = false;
        // Screen x runs toward −X (east), screen y toward −Z (south).
        state.x += dx * state.mpp;
        state.z += dy * state.mpp;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch > 0 && distance > 0) {
          state.follow = false;
          zoomAt(pinch / distance, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
        }
        pinch = distance;
      }
    };
    const onUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = 0;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [open]);

  // Escape closes the chart (N is handled with the other keys).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const zoom = (factor: number) => {
    const state = view.current;
    state.mpp = Math.min(MAX_MPP, Math.max(MIN_MPP, state.mpp * factor));
    setScale(scaleBar(state.mpp));
  };

  if (!ready) return null;

  return (
    <>
      {!open && !hideMini && (
        <button type="button" className="minimap" onClick={onOpen} aria-label={messages.chartOpen} title={messages.chartOpen}>
          <canvas ref={miniRef} aria-hidden="true" />
          <span className="minimap-north" aria-hidden="true">
            N
          </span>
        </button>
      )}
      {open && (
        <div className="chart-overlay" role="dialog" aria-modal="true" aria-label={messages.chart}>
          <canvas ref={fullRef} className="chart-canvas" />
          <header className="chart-header">
            <div className="chart-title">
              <strong>{messages.chart}</strong>
              <span>
                {fill(messages.chartExplored, { area: stats.area < 10 ? stats.area.toFixed(1) : Math.round(stats.area) })}
                {" · "}
                {fill(messages.chartPlaces, { found: stats.found })}
              </span>
            </div>
            <button type="button" className="chart-close" onClick={onClose} aria-label={messages.chartClose}>
              ×
            </button>
          </header>
          <div className="chart-tools">
            <button type="button" onClick={() => zoom(1 / 1.6)} aria-label={messages.chartZoomIn}>
              +
            </button>
            <button type="button" onClick={() => zoom(1.6)} aria-label={messages.chartZoomOut}>
              −
            </button>
            <button
              type="button"
              className="chart-recenter"
              onClick={() => {
                view.current.follow = true;
              }}
              aria-label={messages.chartCenter}
              title={messages.chartCenter}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4" fill="currentColor" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </div>
          <div className="chart-compass" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="29" fill="rgba(6,26,38,0.72)" stroke="rgba(160,240,235,0.45)" />
              <path d="M32 7 L38 32 L32 29 L26 32 Z" fill="#ff6b5a" />
              <path d="M32 57 L26 32 L32 35 L38 32 Z" fill="#e8f4f6" />
              <path d="M7 32 L32 26 L29 32 L32 38 Z" fill="rgba(232,244,246,0.55)" />
              <path d="M57 32 L32 38 L35 32 L32 26 Z" fill="rgba(232,244,246,0.55)" />
              <text x="32" y="6" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" dy="3">
                N
              </text>
            </svg>
          </div>
          <footer className="chart-footer">
            <ul className="chart-legend">
              <li>
                <i className="legend-yacht" />
                {messages.chartYacht}
              </li>
              <li>
                <i className="legend-track" />
                {messages.chartTrack}
              </li>
              <li>
                <i className="legend-find" />
                {messages.chartFind}
              </li>
              <li>
                <i className="legend-fog" />
                {messages.chartFog}
              </li>
            </ul>
            <div className="chart-scale">
              <span style={{ width: `${Math.round(scale.pixels)}px` }} />
              {scale.label}
            </div>
          </footer>
          <p className="chart-hint">{messages.chartHint}</p>
        </div>
      )}
    </>
  );
}
