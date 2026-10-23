"use client";

import { useEffect, useRef } from "react";
import { islandEdgeNoise, WATERLINE_RADIAL, type IslandDefinition } from "@/src/simulator/environment/IslandMath";
import type { MapState } from "@/src/simulator/Simulator";
import { CHART_CELL } from "@/src/simulator/world/ExploredChart";
import type { Messages } from "./i18n";
import type { FeatureMessages } from "./featureMessages";

type View = { centerX: number; centerZ: number; metresPerPixel: number; width: number; height: number };

/** Metres from the yacht to the edge of the minimap and of the full chart. */
export const MINIMAP_RADIUS = 650;
export const FULL_MAP_RADIUS = 1600;

const OCEAN_TOP = "#0e4a63";
const OCEAN_BOTTOM = "#082f42";
const FOG = [8, 22, 31];

/** North (+Z) is up; east is to the right, which is -X in the renderer's right-handed frame. */
function project(view: View, x: number, z: number): [number, number] {
  return [view.width / 2 - (x - view.centerX) / view.metresPerPixel, view.height / 2 - (z - view.centerZ) / view.metresPerPixel];
}

function islandColors(island: IslandDefinition): [string, string] {
  return island.volcano ? ["#4a3f38", "#cdb57a"] : ["#3f8f4d", "#d8bf7c"];
}

function drawIsland(context: CanvasRenderingContext2D, view: View, island: IslandDefinition): void {
  const [land, sand] = islandColors(island);
  for (const [scale, color] of [[1.06, "rgba(110, 210, 220, 0.25)"], [1, sand], [0.84, land]] as const) {
    context.beginPath();
    for (let index = 0; index <= 72; index += 1) {
      const angle = (index / 72) * Math.PI * 2;
      const radius = island.beachRadius * islandEdgeNoise(angle, island) * WATERLINE_RADIAL * scale;
      const [px, py] = project(view, island.centerX + Math.cos(angle) * radius, island.centerZ + Math.sin(angle) * radius * island.scaleZ);
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.fillStyle = color;
    context.fill();
  }
  if (island.volcano) {
    const [px, py] = project(view, island.centerX, island.centerZ);
    context.fillStyle = "#ff5a1f";
    context.beginPath();
    context.arc(px, py, Math.max(2, 14 / view.metresPerPixel), 0, Math.PI * 2);
    context.fill();
  }
}

function drawFog(context: CanvasRenderingContext2D, view: View, state: MapState): void {
  const left = view.centerX + (view.width / 2) * view.metresPerPixel;
  const right = view.centerX - (view.width / 2) * view.metresPerPixel;
  const bottom = view.centerZ - (view.height / 2) * view.metresPerPixel;
  const top = view.centerZ + (view.height / 2) * view.metresPerPixel;
  const minColumn = Math.floor(Math.min(left, right) / CHART_CELL) - 1;
  const maxColumn = Math.floor(Math.max(left, right) / CHART_CELL) + 1;
  const minRow = Math.floor(bottom / CHART_CELL) - 1;
  const maxRow = Math.floor(top / CHART_CELL) + 1;
  const columns = maxColumn - minColumn + 1;
  const rows = maxRow - minRow + 1;
  const offscreen = document.createElement("canvas");
  offscreen.width = columns;
  offscreen.height = rows;
  const small = offscreen.getContext("2d");
  if (!small) return;
  const image = small.createImageData(columns, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // Image x runs east (decreasing world X), image y runs south.
      const worldColumn = maxColumn - column;
      const worldRow = maxRow - row;
      const index = (row * columns + column) * 4;
      image.data[index] = FOG[0];
      image.data[index + 1] = FOG[1];
      image.data[index + 2] = FOG[2];
      image.data[index + 3] = state.chart.isExplored(worldColumn, worldRow) ? 0 : 238;
    }
  }
  small.putImageData(image, 0, 0);
  const [x0, y0] = project(view, (maxColumn + 1) * CHART_CELL, (maxRow + 1) * CHART_CELL);
  const [x1, y1] = project(view, minColumn * CHART_CELL, minRow * CHART_CELL);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(offscreen, x0, y0, x1 - x0, y1 - y0);
}

function drawPlaceIcon(context: CanvasRenderingContext2D, kind: string, x: number, y: number, size: number): void {
  context.save();
  context.translate(x, y);
  context.lineWidth = Math.max(1.2, size * 0.14);
  context.strokeStyle = "rgba(4, 18, 26, 0.9)";
  if (kind === "volcano") {
    context.fillStyle = "#ff6a2a";
    context.beginPath();
    context.moveTo(-size * 0.6, size * 0.45);
    context.lineTo(0, -size * 0.55);
    context.lineTo(size * 0.6, size * 0.45);
    context.closePath();
    context.fill();
    context.stroke();
  } else if (kind === "wreck") {
    context.fillStyle = "#c79a5b";
    context.beginPath();
    context.arc(0, 0, size * 0.5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(0, -size * 0.32);
    context.lineTo(0, size * 0.3);
    context.stroke();
  } else if (kind === "monolith") {
    context.fillStyle = "#0b0b0d";
    context.strokeStyle = "#d6e6ea";
    context.fillRect(-size * 0.18, -size * 0.55, size * 0.36, size * 1.1);
    context.strokeRect(-size * 0.18, -size * 0.55, size * 0.36, size * 1.1);
  } else {
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
  }
  context.restore();
}

function drawChart(context: CanvasRenderingContext2D, state: MapState, view: View, voyage: FeatureMessages, detailed: boolean): void {
  const { width, height } = view;
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, OCEAN_TOP);
  gradient.addColorStop(1, OCEAN_BOTTOM);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(160, 225, 235, 0.08)";
  context.lineWidth = 1;
  const grid = 500;
  const reach = (Math.max(width, height) / 2) * view.metresPerPixel;
  for (let x = Math.floor((view.centerX - reach) / grid) * grid; x <= view.centerX + reach; x += grid) {
    const [px] = project(view, x, 0);
    context.beginPath();
    context.moveTo(px, 0);
    context.lineTo(px, height);
    context.stroke();
  }
  for (let z = Math.floor((view.centerZ - reach) / grid) * grid; z <= view.centerZ + reach; z += grid) {
    const [, py] = project(view, 0, z);
    context.beginPath();
    context.moveTo(0, py);
    context.lineTo(width, py);
    context.stroke();
  }

  state.islands.forEach((island) => drawIsland(context, view, island));
  drawFog(context, view, state);

  const iconSize = detailed ? 16 : 11;
  for (const item of state.loot) {
    const [px, py] = project(view, item.x, item.z);
    context.fillStyle = item.kind === "bottle" ? "#5ee08a" : item.kind === "crate" ? "#c08a4a" : "#ff8fb1";
    context.strokeStyle = "rgba(4, 18, 26, 0.9)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(px, py, iconSize * 0.28, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  context.font = `600 ${detailed ? 13 : 10}px Inter, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const place of state.places) {
    if (!place.discovered) continue;
    const [px, py] = project(view, place.x, place.z);
    drawPlaceIcon(context, place.kind, px, py, iconSize);
    if (detailed) {
      const label = voyage[place.kind];
      context.lineWidth = 3;
      context.strokeStyle = "rgba(4, 18, 26, 0.85)";
      context.strokeText(label, px, py + iconSize * 0.7);
      context.fillStyle = "#effdff";
      context.fillText(label, px, py + iconSize * 0.7);
    }
  }

  for (const ship of state.ships) {
    if (!state.chart.isExploredAt(ship.x, ship.z)) continue;
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

type Props = {
  getMap: (radius: number) => MapState | null;
  /** Changes whenever the map should be redrawn (the yacht moved or the chart grew). */
  tick: number;
  messages: Messages;
  voyage: FeatureMessages;
};

/** Circular north-up minimap centred on the yacht. */
export function MiniMap({ getMap, tick, voyage }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const state = getMap(MINIMAP_RADIUS * 1.2);
    if (!canvas || !state) return;
    const context = prepareCanvas(canvas);
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const view: View = { centerX: state.yacht.x, centerZ: state.yacht.z, metresPerPixel: (MINIMAP_RADIUS * 2) / width, width, height };
    context.save();
    context.beginPath();
    context.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
    context.clip();
    drawChart(context, state, view, voyage, false);
    context.restore();
    context.fillStyle = "#effdff";
    context.font = "700 10px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText("N", width / 2, 4);
  }, [getMap, tick, voyage]);
  return <canvas ref={canvasRef} className="minimap-canvas" aria-hidden="true" />;
}

/** Full chart centred on the yacht, with fog over the sea she has not seen. */
export function FullMap({ getMap, tick, messages, voyage }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const state = getMap(FULL_MAP_RADIUS * 1.5);
      if (!state) return;
      const context = prepareCanvas(canvas);
      if (!context) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const view: View = {
        centerX: state.yacht.x,
        centerZ: state.yacht.z,
        metresPerPixel: (FULL_MAP_RADIUS * 2) / Math.min(width, height),
        width,
        height,
      };
      drawChart(context, state, view, voyage, true);
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
  }, [getMap, tick, voyage]);
  return <canvas ref={canvasRef} className="fullmap-canvas" role="img" aria-label={`${messages.map}. ${messages.unexplored}`} />;
}
