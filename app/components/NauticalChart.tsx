"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { islandEdgeNoise, WATERLINE_RADIAL } from "@/src/simulator/environment/IslandMath";
import { FOG_CELL } from "@/src/simulator/navigation/Exploration";
import type { ChartData, ChartMark, ChartMarkKind } from "@/src/simulator/types";
import type { FeatureMessages } from "./featureMessages";
import type { Messages } from "./i18n";

type ChartSource = {
  chartData: (radius: number) => ChartData;
  isExplored: (x: number, z: number) => boolean;
};

type NauticalChartProps = {
  source: () => ChartSource | null;
  messages: Messages;
  voyage: FeatureMessages;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

/** Minimap radius, metres. */
const MINIMAP_RADIUS = 700;
/** Zoom steps of the full chart (half the visible width), metres. */
const CHART_RADII = [900, 1600, 2800, 4500] as const;

const SEA_DEEP = "#0b3f59";
const SEA_SHALLOW = "rgba(120, 220, 230, 0.32)";
const SAND = "#d9c48f";
const ASH = "#5a4f4b";

/**
 * Screen position of a world point: north (+Z) up and east (−X: the
 * simulator's starboard-positive heading turns toward +X, which the compass
 * reads as west) to the right.
 */
function project(data: ChartData, scale: number, cx: number, cy: number, x: number, z: number): [number, number] {
  return [cx - (x - data.x) * scale, cy - (z - data.z) * scale];
}

const MARK_ORDER: ChartMarkKind[] = ["volcano", "barge", "wreck", "monolith", "bottle", "crate", "flamingo"];

function markLabel(kind: ChartMarkKind, voyage: FeatureMessages): string {
  return voyage[kind];
}

function drawMark(context: CanvasRenderingContext2D, mark: ChartMark, sx: number, sy: number, size: number): void {
  context.save();
  context.translate(sx, sy);
  context.lineJoin = "round";
  context.lineWidth = Math.max(1, size * 0.14);
  context.strokeStyle = "rgba(0, 0, 0, 0.55)";
  switch (mark.kind) {
    case "volcano":
      context.fillStyle = "#3d3532";
      context.beginPath();
      context.moveTo(-size, size * 0.7);
      context.lineTo(-size * 0.25, -size * 0.6);
      context.lineTo(size * 0.25, -size * 0.6);
      context.lineTo(size, size * 0.7);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = "#ff6a1f";
      context.beginPath();
      context.ellipse(0, -size * 0.6, size * 0.3, size * 0.14, 0, 0, Math.PI * 2);
      context.fill();
      break;
    case "wreck":
      context.fillStyle = "#8a5a32";
      context.beginPath();
      context.moveTo(-size, -size * 0.1);
      context.lineTo(size, -size * 0.1);
      context.lineTo(size * 0.6, size * 0.55);
      context.lineTo(-size * 0.6, size * 0.55);
      context.closePath();
      context.fill();
      context.stroke();
      context.strokeStyle = "#e9dcc0";
      context.beginPath();
      context.moveTo(0, -size * 0.1);
      context.lineTo(size * 0.15, -size);
      context.stroke();
      break;
    case "monolith":
      context.fillStyle = "#101114";
      context.fillRect(-size * 0.28, -size, size * 0.56, size * 1.8);
      context.strokeStyle = "#7af0ff";
      context.strokeRect(-size * 0.28, -size, size * 0.56, size * 1.8);
      break;
    case "barge":
      context.fillStyle = "#ff4fb8";
      context.beginPath();
      context.arc(0, 0, size * 0.75, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#fff";
      context.font = `700 ${Math.round(size * 1.2)}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("♪", 0, size * 0.05);
      break;
    case "bottle":
      context.fillStyle = "#5fd18a";
      context.beginPath();
      context.ellipse(0, 0, size * 0.28, size * 0.55, 0.6, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      break;
    case "crate":
      context.fillStyle = "#b07a3d";
      context.fillRect(-size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
      context.strokeRect(-size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
      break;
    case "flamingo":
      context.fillStyle = "#ff8fc0";
      context.beginPath();
      context.arc(0, 0, size * 0.45, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      break;
  }
  context.restore();
}

type DrawOptions = { radius: number; labels: boolean; voyage: FeatureMessages; scaleBar: boolean };

function drawChart(canvas: HTMLCanvasElement, chart: ChartSource, options: DrawOptions): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 4 || height < 4) return;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.min(width, height) / 2 / options.radius;
  const reach = Math.hypot(width, height) / 2 / scale;
  const data = chart.chartData(reach + 200);

  // Sea and a faint 500 m grid.
  context.fillStyle = SEA_DEEP;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(160, 225, 240, 0.08)";
  context.lineWidth = 1;
  const grid = options.radius > 2000 ? 1000 : 500;
  for (let gx = Math.floor((data.x - reach) / grid) * grid; gx <= data.x + reach; gx += grid) {
    const [sx] = project(data, scale, cx, cy, gx, data.z);
    context.beginPath();
    context.moveTo(sx, 0);
    context.lineTo(sx, height);
    context.stroke();
  }
  for (let gz = Math.floor((data.z - reach) / grid) * grid; gz <= data.z + reach; gz += grid) {
    const [, sy] = project(data, scale, cx, cy, data.x, gz);
    context.beginPath();
    context.moveTo(0, sy);
    context.lineTo(width, sy);
    context.stroke();
  }

  // Islands: a pale shallow halo, then the beach-coloured coast.
  for (const island of data.islands) {
    const path = new Path2D();
    for (let step = 0; step <= 56; step += 1) {
      const angle = (step / 56) * Math.PI * 2;
      const r = island.radius * islandEdgeNoise(angle, island) * WATERLINE_RADIAL;
      const [sx, sy] = project(data, scale, cx, cy, island.x + Math.cos(angle) * r, island.z + Math.sin(angle) * r * island.scaleZ);
      if (step === 0) path.moveTo(sx, sy);
      else path.lineTo(sx, sy);
    }
    path.closePath();
    context.strokeStyle = SEA_SHALLOW;
    context.lineWidth = Math.max(3, 40 * scale);
    context.stroke(path);
    context.fillStyle = island.volcano ? ASH : SAND;
    context.fill(path);
    context.strokeStyle = "rgba(60, 45, 20, 0.6)";
    context.lineWidth = 1;
    context.stroke(path);
    if (!island.volcano) {
      // A green interior: the palms and hills.
      context.save();
      context.clip(path);
      const [sx, sy] = project(data, scale, cx, cy, island.x, island.z);
      context.fillStyle = "rgba(70, 130, 70, 0.75)";
      context.beginPath();
      context.ellipse(sx, sy, island.radius * scale * 0.62, island.radius * island.scaleZ * scale * 0.62, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  // Fog over everything not yet seen, at the fog's own resolution, softened.
  const cellPixels = FOG_CELL * scale;
  const columns = Math.ceil(width / cellPixels) + 1;
  const rows = Math.ceil(height / cellPixels) + 1;
  if (columns * rows <= 90000) {
    const fog = document.createElement("canvas");
    fog.width = columns;
    fog.height = rows;
    const fogContext = fog.getContext("2d");
    if (fogContext) {
      const image = fogContext.createImageData(columns, rows);
      for (let row = 0; row < rows; row += 1) {
        const z = data.z - ((row + 0.5) * cellPixels - cy) / scale;
        for (let column = 0; column < columns; column += 1) {
          const x = data.x - ((column + 0.5) * cellPixels - cx) / scale;
          const offset = (row * columns + column) * 4;
          image.data[offset] = 9;
          image.data[offset + 1] = 22;
          image.data[offset + 2] = 31;
          image.data[offset + 3] = chart.isExplored(x, z) ? 0 : 250;
        }
      }
      fogContext.putImageData(image, 0, 0);
      context.imageSmoothingEnabled = true;
      context.drawImage(fog, 0, 0, columns * cellPixels, rows * cellPixels);
    }
  }

  // Places and finds (only those in explored water come from the simulator).
  const markSize = options.labels ? 9 : 6;
  context.font = "600 11px system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  const sorted = [...data.marks].sort((a, b) => MARK_ORDER.indexOf(a.kind) - MARK_ORDER.indexOf(b.kind));
  for (const mark of sorted) {
    const [sx, sy] = project(data, scale, cx, cy, mark.x, mark.z);
    if (sx < -20 || sy < -20 || sx > width + 20 || sy > height + 20) continue;
    const big = mark.kind === "volcano" || mark.kind === "barge" || mark.kind === "wreck" || mark.kind === "monolith";
    drawMark(context, mark, sx, sy, big ? markSize : markSize * 0.75);
    if (options.labels && big) {
      const label = markLabel(mark.kind, options.voyage);
      context.lineWidth = 3;
      context.strokeStyle = "rgba(4, 20, 28, 0.85)";
      context.strokeText(label, sx + markSize + 4, sy);
      context.fillStyle = mark.discovered ? "#fff6dc" : "rgba(255, 246, 220, 0.75)";
      context.fillText(label, sx + markSize + 4, sy);
    }
  }

  // The yacht: an arrow along her heading (heading 0 is north, positive turns west).
  context.save();
  context.translate(cx, cy);
  context.rotate(-data.heading);
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#0b3f59";
  context.lineWidth = 1.5;
  const yachtSize = options.labels ? 11 : 8;
  context.beginPath();
  context.moveTo(0, -yachtSize);
  context.lineTo(yachtSize * 0.62, yachtSize * 0.8);
  context.lineTo(0, yachtSize * 0.4);
  context.lineTo(-yachtSize * 0.62, yachtSize * 0.8);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();

  // North mark.
  context.fillStyle = "#fff6dc";
  context.font = `700 ${options.labels ? 13 : 10}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText("N", cx, options.labels ? 8 : 4);

  if (options.scaleBar) {
    const meters = options.radius >= 2800 ? 1000 : 500;
    const length = meters * scale;
    context.strokeStyle = "#fff6dc";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(14, height - 16);
    context.lineTo(14 + length, height - 16);
    context.moveTo(14, height - 21);
    context.lineTo(14, height - 11);
    context.moveTo(14 + length, height - 21);
    context.lineTo(14 + length, height - 11);
    context.stroke();
    context.textAlign = "left";
    context.textBaseline = "bottom";
    context.font = "600 11px system-ui, sans-serif";
    context.fillText(meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, 18 + length, height - 10);
  }
}

/**
 * The minimap (a round chart around the yacht) and, when opened by a tap on
 * it or the N key, the full chart. Both are drawn from the simulator's chart
 * data and fog of war a few times a second, never per frame.
 */
export function NauticalChart({ source, messages, voyage, open, onOpen, onClose }: NauticalChartProps) {
  const miniRef = useRef<HTMLCanvasElement>(null);
  const fullRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState(1);

  const redraw = useCallback(() => {
    const chart = source();
    if (!chart) return;
    if (miniRef.current) drawChart(miniRef.current, chart, { radius: MINIMAP_RADIUS, labels: false, voyage, scaleBar: false });
    if (open && fullRef.current) drawChart(fullRef.current, chart, { radius: CHART_RADII[zoom], labels: true, voyage, scaleBar: true });
  }, [source, open, zoom, voyage]);

  useEffect(() => {
    redraw();
    const timer = window.setInterval(redraw, open ? 700 : 1000);
    return () => window.clearInterval(timer);
  }, [redraw, open]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "+" || event.key === "=") {
        setZoom((value) => Math.max(0, value - 1));
      } else if (event.key === "-") {
        setZoom((value) => Math.min(CHART_RADII.length - 1, value + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  const legend: ChartMarkKind[] = ["volcano", "barge", "wreck", "monolith", "bottle", "crate", "flamingo"];
  return (
    <>
      <button type="button" className="minimap" aria-label={messages.openMap} title={`${messages.openMap} (N)`} onClick={onOpen}>
        <canvas ref={miniRef} aria-hidden="true" />
      </button>
      {open && (
        <div className="chart-overlay" role="dialog" aria-modal="true" aria-label={messages.map} onPointerDown={(event) => event.stopPropagation()}>
          <div className="chart-sheet">
            <header className="chart-header">
              <h2>{messages.map}</h2>
              <div className="chart-zoom">
                <button type="button" aria-label="+" title="+" disabled={zoom === 0} onClick={() => setZoom((value) => Math.max(0, value - 1))}>+</button>
                <button type="button" aria-label="−" title="−" disabled={zoom === CHART_RADII.length - 1} onClick={() => setZoom((value) => Math.min(CHART_RADII.length - 1, value + 1))}>−</button>
              </div>
              <button ref={closeRef} type="button" className="chart-close" aria-label={messages.closeMap} title={`${messages.closeMap} (Esc)`} onClick={onClose}>×</button>
            </header>
            <div className="chart-body">
              <canvas ref={fullRef} className="chart-canvas" aria-hidden="true" />
              <ul className="chart-legend">
                {legend.map((kind) => (
                  <li key={kind}>
                    <LegendIcon kind={kind} />
                    {markLabel(kind, voyage)}
                  </li>
                ))}
                <li><span className="legend-swatch legend-fog" aria-hidden="true" />{messages.uncharted}</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LegendIcon({ kind }: { kind: ChartMarkKind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = 40;
    canvas.height = 40;
    context.setTransform(2, 0, 0, 2, 0, 0);
    drawMark(context, { kind, x: 0, z: 0, discovered: true }, 10, 10, 7);
  }, [kind]);
  return <canvas ref={ref} className="legend-icon" aria-hidden="true" />;
}
