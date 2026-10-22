"use client";

import { useEffect, useRef } from "react";
import { BEACH_START, ISLANDS, islandLocalPoint } from "@/src/simulator/environment/IslandShape";
import {
  CHART_HALF_SIZE,
  CHART_LANDMARKS,
  FOG_RESOLUTION,
  type ChartLandmark,
} from "@/src/simulator/navigation/Exploration";
import type { Messages } from "./i18n";
import { LANDMARKS } from "@/src/simulator/environment/IslandShape";

const CHART_ISLAND_INDEX = new Map(LANDMARKS.map((landmark) => [landmark.id, landmark.island]));

type ChartView = {
  centerX: number;
  centerZ: number;
  /** World meters per CSS pixel. */
  scale: number;
};

type ChartProps = {
  /** Reads the live fog grid; called only while drawing, never during render. */
  getFog: () => Uint8Array | undefined;
  positionX: number;
  positionZ: number;
  headingDegrees: number;
  discovered: readonly string[];
  revision: number;
  messages: Messages;
};

const FOG_ALPHA = 0.93;
/** Meters shown across the shorter side of the full chart. */
const CHART_VIEW_SPAN = 760;
const FOG_COLOR = `rgba(9, 28, 39, ${FOG_ALPHA})`;

export function landmarkLabel(landmark: ChartLandmark, messages: Messages): string {
  switch (landmark.kind) {
    case "lighthouse":
      return messages.lighthouse;
    case "pier":
      return messages.pier;
    case "hut":
      return messages.beachHut;
    case "peak":
      return messages.crater;
    default:
      return landmark.name;
  }
}

function fogImage(fog: Uint8Array | undefined, cache: { canvas?: HTMLCanvasElement }): HTMLCanvasElement {
  const canvas = cache.canvas ?? document.createElement("canvas");
  cache.canvas = canvas;
  canvas.width = FOG_RESOLUTION;
  canvas.height = FOG_RESOLUTION;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(FOG_RESOLUTION, FOG_RESOLUTION);
  const explored = (row: number, column: number) => {
    if (row < 0 || column < 0 || row >= FOG_RESOLUTION || column >= FOG_RESOLUTION) return 0;
    return fog?.[row * FOG_RESOLUTION + column] === 1 ? 1 : 0;
  };
  for (let row = 0; row < FOG_RESOLUTION; row += 1) {
    for (let column = 0; column < FOG_RESOLUTION; column += 1) {
      // A 3x3 average feathers the reveal edge before the image is scaled up.
      let open = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) open += explored(row + dy, column + dx);
      const clear = explored(row, column) ? Math.max(0.55, open / 9) : open / 18;
      // Fog rows grow with +Z (north); image rows grow downward (south).
      const pixel = ((FOG_RESOLUTION - 1 - row) * FOG_RESOLUTION + column) * 4;
      image.data[pixel] = 9;
      image.data[pixel + 1] = 28;
      image.data[pixel + 2] = 39;
      image.data[pixel + 3] = Math.round(FOG_ALPHA * 255 * (1 - clear));
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function drawChart(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: ChartView,
  props: ChartProps,
  fogCanvas: HTMLCanvasElement,
  compact: boolean,
): void {
  // North (+Z) is up and east (+X) is right, matching the compass heading.
  const toScreenX = (x: number) => width / 2 + (x - view.centerX) / view.scale;
  const toScreenY = (z: number) => height / 2 - (z - view.centerZ) / view.scale;

  const sea = context.createLinearGradient(0, 0, 0, height);
  sea.addColorStop(0, "#1f8fae");
  sea.addColorStop(1, "#167895");
  context.fillStyle = sea;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(220, 250, 255, 0.12)";
  context.lineWidth = 1;
  const gridStep = compact ? 100 : 200;
  const firstX = Math.floor((view.centerX - (width / 2) * view.scale) / gridStep) * gridStep;
  const firstZ = Math.floor((view.centerZ - (height / 2) * view.scale) / gridStep) * gridStep;
  for (let x = firstX; toScreenX(x) <= width; x += gridStep) {
    context.beginPath();
    context.moveTo(toScreenX(x), 0);
    context.lineTo(toScreenX(x), height);
    context.stroke();
  }
  for (let z = firstZ; toScreenY(z) >= 0; z += gridStep) {
    context.beginPath();
    context.moveTo(0, toScreenY(z));
    context.lineTo(width, toScreenY(z));
    context.stroke();
  }

  ISLANDS.forEach((island) => {
    const ring = (radial: number) => {
      context.beginPath();
      for (let step = 0; step <= 48; step += 1) {
        const angle = (step / 48) * Math.PI * 2;
        const point = islandLocalPoint(island, radial, angle);
        const x = toScreenX(island.centerX + point.x);
        const y = toScreenY(island.centerZ + point.z);
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
    };
    context.fillStyle = "rgba(120, 220, 210, 0.35)";
    ring(1.18);
    context.fill();
    context.fillStyle = "#e3c785";
    ring(1);
    context.fill();
    context.fillStyle = island.style === "cay" ? "#7cc06a" : "#4f9a58";
    ring(BEACH_START - 0.06);
    context.fill();
    if (island.style === "volcanic") {
      context.fillStyle = "#6d5a4b";
      ring(0.32);
      context.fill();
      context.fillStyle = "#3d322b";
      ring(0.07);
      context.fill();
    }
  });

  // Fog of war: everything outside the chart square is uncharted, and inside
  // it the fog texture is smoothed so revealed areas get soft edges.
  const left = Math.round(toScreenX(-CHART_HALF_SIZE));
  const right = Math.round(toScreenX(CHART_HALF_SIZE));
  const top = Math.round(toScreenY(CHART_HALF_SIZE));
  const bottom = Math.round(toScreenY(-CHART_HALF_SIZE));
  context.fillStyle = FOG_COLOR;
  context.beginPath();
  context.rect(0, 0, width, height);
  context.rect(left, top, right - left, bottom - top);
  context.fill("evenodd");
  context.imageSmoothingEnabled = true;
  context.drawImage(fogCanvas, left, top, right - left, bottom - top);

  const discovered = new Set(props.discovered);
  context.textAlign = "center";
  context.textBaseline = "middle";
  CHART_LANDMARKS.forEach((landmark) => {
    if (!discovered.has(landmark.id)) {
      // Uncharted islands show as a question mark so the player knows where to sail.
      if (landmark.kind !== "island") return;
      context.font = `800 ${compact ? 12 : 18}px Inter, system-ui, sans-serif`;
      context.fillStyle = "rgba(170, 225, 235, 0.75)";
      context.fillText("?", toScreenX(landmark.x), toScreenY(landmark.z));
      return;
    }
    const x = toScreenX(landmark.x);
    const y = toScreenY(landmark.z);
    if (x < -40 || y < -40 || x > width + 40 || y > height + 40) return;
    if (landmark.kind === "island") {
      if (compact) return;
      // Island names sit above the island so landmark labels stay readable.
      const island = ISLANDS[CHART_ISLAND_INDEX.get(landmark.id) ?? 0];
      const nameY = y - (island.beachRadius * island.scaleZ) / view.scale - 12;
      context.font = "700 13px Inter, system-ui, sans-serif";
      context.lineWidth = 3;
      context.strokeStyle = "rgba(5, 30, 40, 0.8)";
      context.strokeText(landmark.name, x, nameY);
      context.fillStyle = "#fffbe8";
      context.fillText(landmark.name, x, nameY);
      return;
    }
    const size = compact ? 4 : 6;
    context.lineWidth = 2;
    context.strokeStyle = "#0b2633";
    if (landmark.kind === "lighthouse") {
      context.fillStyle = "#ffffff";
      context.fillRect(x - size * 0.45, y - size, size * 0.9, size * 2);
      context.fillStyle = "#d33a2f";
      context.fillRect(x - size * 0.45, y - size * 0.25, size * 0.9, size * 0.5);
      context.strokeRect(x - size * 0.45, y - size, size * 0.9, size * 2);
    } else if (landmark.kind === "peak") {
      context.fillStyle = "#c2552d";
      context.beginPath();
      context.moveTo(x, y - size);
      context.lineTo(x + size, y + size * 0.8);
      context.lineTo(x - size, y + size * 0.8);
      context.closePath();
      context.fill();
      context.stroke();
    } else {
      context.fillStyle = landmark.kind === "pier" ? "#a0784f" : "#f1cf6b";
      context.beginPath();
      context.arc(x, y, size * 0.8, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    if (!compact) {
      context.font = "600 11px Inter, system-ui, sans-serif";
      context.lineWidth = 3;
      context.strokeStyle = "rgba(5, 30, 40, 0.8)";
      const label = landmarkLabel(landmark, props.messages);
      // Pier labels sit to the right and crater labels above so neighbours on
      // the same island do not collide with the hut or island name.
      const labelX = landmark.kind === "pier" ? x + size + 4 : x;
      const labelY = landmark.kind === "pier" ? y : landmark.kind === "peak" ? y - size - 9 : y + size + 10;
      context.textAlign = landmark.kind === "pier" ? "left" : "center";
      context.strokeText(label, labelX, labelY);
      context.fillStyle = "#e9fbff";
      context.fillText(label, labelX, labelY);
      context.textAlign = "center";
    }
  });

  // Yacht arrow; heading 0 points north and increases clockwise.
  const heading = (props.headingDegrees * Math.PI) / 180;
  const yachtX = Math.min(width - 8, Math.max(8, toScreenX(props.positionX)));
  const yachtY = Math.min(height - 8, Math.max(8, toScreenY(props.positionZ)));
  context.save();
  context.translate(yachtX, yachtY);
  context.rotate(heading);
  const arrow = compact ? 7 : 9;
  context.fillStyle = "#ff6a3d";
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, -arrow);
  context.lineTo(arrow * 0.62, arrow * 0.8);
  context.lineTo(0, arrow * 0.4);
  context.lineTo(-arrow * 0.62, arrow * 0.8);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();

  context.font = "800 11px Inter, system-ui, sans-serif";
  context.fillStyle = "#e9fbff";
  context.fillText("N", width / 2, compact ? 9 : 14);
}

function useChartCanvas(props: ChartProps, view: (width: number, height: number) => ChartView, compact: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fogCache = useRef<{ canvas?: HTMLCanvasElement; revision?: number }>({});
  const { positionX, positionZ, headingDegrees, discovered, revision, getFog, messages } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    if (!fogCache.current.canvas || fogCache.current.revision !== revision) {
      fogImage(getFog(), fogCache.current);
      fogCache.current.revision = revision;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawChart(
      context,
      width,
      height,
      view(width, height),
      { positionX, positionZ, headingDegrees, discovered, revision, getFog, messages },
      fogCache.current.canvas!,
      compact,
    );
  });

  return canvasRef;
}

export function MiniMap(props: ChartProps & { onOpen: () => void }) {
  const canvasRef = useChartCanvas(
    props,
    () => ({ centerX: props.positionX, centerZ: props.positionZ, scale: 4.6 }),
    true,
  );
  return (
    <button
      type="button"
      className="minimap"
      aria-label={props.messages.openMap}
      title={`${props.messages.openMap} (M)`}
      onClick={props.onOpen}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </button>
  );
}

export function ChartDialog(props: ChartProps & { exploredFraction: number; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useChartCanvas(
    props,
    (width, height) => ({
      // Frame the island group; the rest of the charted square stays reachable
      // at the edges and the yacht arrow is clamped inside the view.
      centerX: 15,
      centerZ: 50,
      scale: CHART_VIEW_SPAN / Math.max(1, Math.min(width, height)),
    }),
    false,
  );
  const discovered = new Set(props.discovered);
  const exploredPercent = Math.round(props.exploredFraction * 100);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="chart-dialog" role="dialog" aria-modal="true" aria-label={props.messages.map}>
      <header>
        <div>
          <p className="eyebrow">{props.messages.map}</p>
          <strong>
            {props.messages.explored} {exploredPercent}% · {props.discovered.length}/{CHART_LANDMARKS.length}
          </strong>
        </div>
        <button ref={closeRef} type="button" className="icon-button" aria-label={props.messages.closeMap} title={`${props.messages.closeMap} (Esc / M)`} onClick={props.onClose}>
          ×
        </button>
      </header>
      <div className="chart-body">
        <canvas ref={canvasRef} className="chart-canvas" role="img" aria-label={props.messages.map} />
        <ul className="chart-legend">
          {CHART_LANDMARKS.map((landmark) => (
            <li key={landmark.id} className={discovered.has(landmark.id) ? "is-found" : ""}>
              <span aria-hidden="true" className={`legend-icon legend-${landmark.kind}`} />
              {discovered.has(landmark.id) ? landmarkLabel(landmark, props.messages) : props.messages.uncharted}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
