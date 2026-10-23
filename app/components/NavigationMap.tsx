"use client";

import { useEffect, useMemo, useRef } from "react";
import type { MapState } from "@/src/simulator/Simulator";
import { islandPoint } from "@/src/simulator/world/IslandTerrain";
import type { Messages } from "./i18n";

type Props = {
  state: MapState | null;
  revision: number;
  /** Changes whenever the yacht moves; triggers a redraw. */
  tick: number;
  messages: Messages;
};

type View = { centerX: number; centerZ: number; metresPerPixel: number; width: number; height: number };

const OCEAN_TOP = "#0e4a63";
const OCEAN_BOTTOM = "#082f42";
const FOG = "rgba(8, 22, 31, 0.94)";

/** World → canvas. North (+Z) is up; east (-X in this right-handed frame) is right. */
function project(view: View, x: number, z: number): [number, number] {
  return [
    view.width / 2 - (x - view.centerX) / view.metresPerPixel,
    view.height / 2 - (z - view.centerZ) / view.metresPerPixel,
  ];
}

function islandColors(kind: string): [string, string] {
  switch (kind) {
    case "volcano":
      return ["#4a3f38", "#d8bf7c"];
    case "rocky":
      return ["#7c7a72", "#d8bf7c"];
    case "islet":
      return ["#5d5a54", "#cdb57a"];
    case "atoll":
      return ["#7fae5f", "#e2c987"];
    default:
      return ["#3f8f4d", "#d8bf7c"];
  }
}

function fogCanvas(state: MapState): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = state.gridSize;
  canvas.height = state.gridSize;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(state.gridSize, state.gridSize);
  for (let cellZ = 0; cellZ < state.gridSize; cellZ += 1) {
    for (let cellX = 0; cellX < state.gridSize; cellX += 1) {
      const explored = state.cells[cellZ * state.gridSize + cellX] === 1;
      // Canvas rows run north → south and columns east → west mirrored, so
      // flip both axes to match project().
      const pixelX = state.gridSize - 1 - cellX;
      const pixelY = state.gridSize - 1 - cellZ;
      const index = (pixelY * state.gridSize + pixelX) * 4;
      image.data[index] = 8;
      image.data[index + 1] = 22;
      image.data[index + 2] = 31;
      image.data[index + 3] = explored ? 0 : 240;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function drawPlaceIcon(context: CanvasRenderingContext2D, kind: string, x: number, y: number, size: number): void {
  context.save();
  context.translate(x, y);
  context.lineWidth = Math.max(1.2, size * 0.14);
  context.strokeStyle = "rgba(4, 18, 26, 0.9)";
  switch (kind) {
    case "volcano":
      context.fillStyle = "#ff6a2a";
      context.beginPath();
      context.moveTo(-size * 0.6, size * 0.45);
      context.lineTo(0, -size * 0.55);
      context.lineTo(size * 0.6, size * 0.45);
      context.closePath();
      context.fill();
      context.stroke();
      break;
    case "galleon":
      context.fillStyle = "#c79a5b";
      context.beginPath();
      context.arc(0, 0, size * 0.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.strokeStyle = "#2b1d10";
      context.beginPath();
      context.moveTo(0, -size * 0.32);
      context.lineTo(0, size * 0.3);
      context.moveTo(-size * 0.28, size * 0.12);
      context.quadraticCurveTo(0, size * 0.42, size * 0.28, size * 0.12);
      context.stroke();
      break;
    case "monolith":
      context.fillStyle = "#0b0b0d";
      context.strokeStyle = "#d6e6ea";
      context.fillRect(-size * 0.18, -size * 0.55, size * 0.36, size * 1.1);
      context.strokeRect(-size * 0.18, -size * 0.55, size * 0.36, size * 1.1);
      break;
    case "party":
      context.fillStyle = "#f15bb5";
      context.beginPath();
      context.arc(0, 0, size * 0.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#ffffff";
      context.font = `${Math.round(size * 0.8)}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("♪", 0, size * 0.04);
      break;
    case "lighthouse":
      context.fillStyle = "#f2efe8";
      context.beginPath();
      context.moveTo(-size * 0.25, size * 0.55);
      context.lineTo(-size * 0.14, -size * 0.45);
      context.lineTo(size * 0.14, -size * 0.45);
      context.lineTo(size * 0.25, size * 0.55);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = "#c23b2f";
      context.fillRect(-size * 0.2, -size * 0.05, size * 0.4, size * 0.18);
      context.fillStyle = "#ffd77a";
      context.beginPath();
      context.arc(0, -size * 0.55, size * 0.16, 0, Math.PI * 2);
      context.fill();
      break;
    default:
      break;
  }
  context.restore();
}

function drawChart(
  context: CanvasRenderingContext2D,
  state: MapState,
  view: View,
  fog: HTMLCanvasElement,
  messages: Messages,
  detailed: boolean,
): void {
  const { width, height } = view;
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, OCEAN_TOP);
  gradient.addColorStop(1, OCEAN_BOTTOM);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  // Faint latitude/longitude grid every 500 m.
  context.strokeStyle = "rgba(160, 225, 235, 0.08)";
  context.lineWidth = 1;
  const step = 500;
  for (let x = -state.extent; x <= state.extent; x += step) {
    const [px] = project(view, x, 0);
    context.beginPath();
    context.moveTo(px, 0);
    context.lineTo(px, height);
    context.stroke();
  }
  for (let z = -state.extent; z <= state.extent; z += step) {
    const [, py] = project(view, 0, z);
    context.beginPath();
    context.moveTo(0, py);
    context.lineTo(width, py);
    context.stroke();
  }

  for (const island of state.islands) {
    const [land, sand] = islandColors(island.kind);
    for (const [radial, color] of [[1.05, "rgba(110, 210, 220, 0.25)"], [1, sand], [0.86, land]] as const) {
      context.beginPath();
      for (let index = 0; index <= 72; index += 1) {
        const angle = (index / 72) * Math.PI * 2;
        const point = islandPoint(island, radial, angle);
        const [px, py] = project(view, point.x, point.z);
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.fillStyle = color;
      context.fill();
    }
    if (island.kind === "volcano") {
      const [px, py] = project(view, island.x, island.z);
      context.fillStyle = "#ff5a1f";
      context.beginPath();
      context.arc(px, py, Math.max(2, 9 / view.metresPerPixel), 0, Math.PI * 2);
      context.fill();
    }
  }

  // Fog of war over uncharted water, smoothed for soft coastlines.
  const [fogLeft, fogTop] = project(view, state.extent, state.extent);
  const fogSize = (state.extent * 2) / view.metresPerPixel;
  context.imageSmoothingEnabled = true;
  context.drawImage(fog, fogLeft, fogTop, fogSize, fogSize);
  // Everything beyond the charted area is uncharted too.
  context.fillStyle = FOG;
  context.fillRect(0, 0, width, Math.max(0, fogTop));
  context.fillRect(0, fogTop + fogSize, width, height);
  context.fillRect(0, 0, Math.max(0, fogLeft), height);
  context.fillRect(fogLeft + fogSize, 0, width, height);

  const iconSize = detailed ? 16 : 11;
  for (const item of state.collectibles) {
    if (!item.spotted || item.collected) continue;
    const [px, py] = project(view, item.x, item.z);
    context.fillStyle = item.kind === "bottle" ? "#5ee08a" : "#c08a4a";
    context.strokeStyle = "rgba(4, 18, 26, 0.9)";
    context.lineWidth = 1.5;
    if (item.kind === "bottle") {
      context.beginPath();
      context.arc(px, py, iconSize * 0.28, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else {
      context.fillRect(px - iconSize * 0.26, py - iconSize * 0.26, iconSize * 0.52, iconSize * 0.52);
      context.strokeRect(px - iconSize * 0.26, py - iconSize * 0.26, iconSize * 0.52, iconSize * 0.52);
    }
  }

  context.font = `600 ${detailed ? 13 : 10}px Inter, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const place of state.places) {
    if (!place.discovered) continue;
    const [px, py] = project(view, place.x, place.z);
    drawPlaceIcon(context, place.kind, px, py, iconSize);
    if (detailed) {
      const label = messages[place.kind as keyof Messages] ?? place.kind;
      context.lineWidth = 3;
      context.strokeStyle = "rgba(4, 18, 26, 0.85)";
      context.strokeText(label, px, py + iconSize * 0.7);
      context.fillStyle = "#effdff";
      context.fillText(label, px, py + iconSize * 0.7);
    }
  }

  // Ship contacts, AIS-style.
  for (const ship of state.ships) {
    const distance = Math.hypot(ship.x - state.yacht.x, ship.z - state.yacht.z);
    if (distance > 2600) continue;
    const [px, py] = project(view, ship.x, ship.z);
    const dx = -Math.sin(ship.heading);
    const dy = -Math.cos(ship.heading);
    const length = Math.max(7, ship.length / view.metresPerPixel);
    context.fillStyle = "#ffcf5a";
    context.strokeStyle = "rgba(4, 18, 26, 0.9)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(px + dx * length * 0.6, py + dy * length * 0.6);
    context.lineTo(px - dx * length * 0.5 - dy * length * 0.2, py - dy * length * 0.5 + dx * length * 0.2);
    context.lineTo(px - dx * length * 0.5 + dy * length * 0.2, py - dy * length * 0.5 - dx * length * 0.2);
    context.closePath();
    context.fill();
    context.stroke();
  }

  // The yacht.
  const [yx, yy] = project(view, state.yacht.x, state.yacht.z);
  const fx = -Math.sin(state.yacht.heading);
  const fy = -Math.cos(state.yacht.heading);
  const size = detailed ? 13 : 10;
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#065a6b";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(yx + fx * size, yy + fy * size);
  context.lineTo(yx - fx * size * 0.6 - fy * size * 0.55, yy - fy * size * 0.6 + fx * size * 0.55);
  context.lineTo(yx - fx * size * 0.25, yy - fy * size * 0.25);
  context.lineTo(yx - fx * size * 0.6 + fy * size * 0.55, yy - fy * size * 0.6 - fx * size * 0.55);
  context.closePath();
  context.fill();
  context.stroke();
}

function useFog(state: MapState | null, revision: number): HTMLCanvasElement | null {
  // Rebuilding the 60×60 fog image is cheap, so it simply follows the state.
  return useMemo(() => {
    void revision;
    if (!state || typeof document === "undefined") return null;
    return fogCanvas(state);
  }, [state, revision]);
}

function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return null;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext("2d");
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

/** Circular north-up minimap centred on the yacht. */
export function MiniMap({ state, revision, tick, messages }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fog = useFog(state, revision);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state || !fog) return;
    const context = prepareCanvas(canvas);
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const view: View = { centerX: state.yacht.x, centerZ: state.yacht.z, metresPerPixel: 1400 / width, width, height };
    context.save();
    context.beginPath();
    context.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
    context.clip();
    drawChart(context, state, view, fog, messages, false);
    context.restore();
    context.fillStyle = "#effdff";
    context.font = "700 10px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText("N", width / 2, 4);
  }, [state, fog, tick, messages]);
  return <canvas ref={canvasRef} className="minimap-canvas" aria-hidden="true" />;
}

/** Full chart of the archipelago with fog over uncharted waters. */
export function FullMap({ state, revision, tick, messages }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fog = useFog(state, revision);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state || !fog) return;
    const draw = () => {
      const context = prepareCanvas(canvas);
      if (!context) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const view: View = {
        centerX: 0,
        centerZ: 0,
        metresPerPixel: (state.extent * 2) / Math.min(width, height),
        width,
        height,
      };
      drawChart(context, state, view, fog, messages, true);
      // Scale bar.
      const barMetres = 500;
      const barPixels = barMetres / view.metresPerPixel;
      context.strokeStyle = "#effdff";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(16, height - 18);
      context.lineTo(16 + barPixels, height - 18);
      context.stroke();
      context.fillStyle = "#effdff";
      context.font = "600 11px Inter, system-ui, sans-serif";
      context.textAlign = "left";
      context.textBaseline = "bottom";
      context.fillText("500 m", 16, height - 22);
      context.textAlign = "right";
      context.textBaseline = "top";
      context.fillText("N ↑", width - 14, 12);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [state, fog, tick, messages]);
  return <canvas ref={canvasRef} className="fullmap-canvas" role="img" aria-label={`${messages.map}. ${messages.unexplored}`} />;
}
