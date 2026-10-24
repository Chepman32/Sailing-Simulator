import type { ChartFeatures, ChartIsland, ChartPlace } from "@/src/simulator/Simulator";
import { islandEdgeNoise, SHELF_WIDTH } from "@/src/simulator/environment/IslandMath";
import { FOG_CELL, SIGHT_RANGE, type ExploredSea } from "@/src/simulator/map/ChartMath";

/**
 * Drawing the chart: a modern nautical chart in the interface's colours.
 * The world's east (−X) is to the right and north (+Z) up, the way the
 * compass reads. Islands are drawn from the same coastline noise as the
 * terrain, with their shelf of shallow water, beach, greenery and contour
 * lines; volcanoes glow at the crater. Unexplored sea lies under a drifting
 * cloud of fog, its edge softened by drawing the explored cells as a tiny
 * image scaled up with smoothing.
 */

export type ChartCamera = {
  /** World point at the centre of the canvas. */
  x: number;
  z: number;
  /** Metres per CSS pixel. */
  mpp: number;
  /** Canvas size in CSS pixels, and the device pixel ratio. */
  width: number;
  height: number;
  dpr: number;
};

export type ChartLabels = Record<ChartPlace["kind"], string> & { unknown: string };

export type ChartStyle = {
  mini: boolean;
  /** Seconds, for the crater's glow and the fog's drift. */
  time: number;
  labels: ChartLabels;
};

const SEA_DEEP = "#0b344c";
const SEA_MID = "#0f4762";
const PLACE_COLORS: Record<ChartPlace["kind"], string> = {
  volcano: "#ff7a3d",
  barge: "#ff5fd2",
  wreck: "#62f2a0",
  monolith: "#b8a6ff",
};

// --- Shared textures ----------------------------------------------------------

let cloudTexture: HTMLCanvasElement | null = null;

/** A tileable 256² fBm cloud (value noise on wrapping lattices), white with varying alpha. */
function clouds(): HTMLCanvasElement {
  if (cloudTexture) return cloudTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  const field = new Float32Array(size * size);
  let seed = 1234567;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let amplitude = 1;
  let total = 0;
  for (const lattice of [4, 8, 16, 32, 64]) {
    const values = new Float32Array(lattice * lattice).map(() => random());
    const step = size / lattice;
    for (let y = 0; y < size; y += 1) {
      const gy = y / step;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x += 1) {
        const gx = x / step;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = values[(y0 % lattice) * lattice + (x0 % lattice)]!;
        const b = values[(y0 % lattice) * lattice + ((x0 + 1) % lattice)]!;
        const c = values[((y0 + 1) % lattice) * lattice + (x0 % lattice)]!;
        const d = values[((y0 + 1) % lattice) * lattice + ((x0 + 1) % lattice)]!;
        field[y * size + x]! += amplitude * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    total += amplitude;
    amplitude *= 0.55;
  }
  for (let index = 0; index < field.length; index += 1) {
    const v = field[index]! / total;
    image.data[index * 4] = 255;
    image.data[index * 4 + 1] = 255;
    image.data[index * 4 + 2] = 255;
    image.data[index * 4 + 3] = Math.round(Math.min(1, Math.max(0, (v - 0.25) * 1.6)) * 255);
  }
  context.putImageData(image, 0, 0);
  cloudTexture = canvas;
  return canvas;
}

let fogTexture: HTMLCanvasElement | null = null;

/** The fog itself: a slate-blue mist with brighter cloud tops (tileable). */
function fogFill(): HTMLCanvasElement {
  if (fogTexture) return fogTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgb(31, 52, 66)";
  context.fillRect(0, 0, size, size);
  context.globalAlpha = 0.34;
  context.fillStyle = "rgb(150, 178, 192)";
  // Offset copies of the cloud (wrapped, so the tile stays seamless) make the tops uneven.
  const cloud = clouds();
  const tiled = (ox: number, oy: number) => {
    for (const dx of [0, -size]) for (const dy of [0, -size]) context.drawImage(cloud, ox + dx, oy + dy);
  };
  tiled(0, 0);
  context.globalAlpha = 0.18;
  tiled(128, 64);
  tiled(64, 192);
  context.globalCompositeOperation = "source-atop";
  context.globalAlpha = 0.5;
  context.fillStyle = "rgb(120, 150, 168)";
  context.fillRect(0, 0, size, size);
  fogTexture = canvas;
  return canvas;
}

// --- The fog mask, cached per view --------------------------------------------

type FogMask = { canvas: HTMLCanvasElement; key: string; c1: number; r1: number; columns: number; rows: number };
const fogMasks = new WeakMap<CanvasRenderingContext2D, FogMask>();
const fogLayers = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
let cloudField: Float32Array | null = null;

/** The cloud texture's alpha as numbers 0…1, for shaping the fog's edge. */
function cloudValues(): Float32Array {
  if (cloudField) return cloudField;
  const data = clouds().getContext("2d")!.getImageData(0, 0, 256, 256).data;
  cloudField = new Float32Array(256 * 256);
  for (let index = 0; index < cloudField.length; index += 1) cloudField[index] = data[index * 4 + 3]! / 255;
  return cloudField;
}

/** Two passes of a running box blur along rows, then columns (about a Gaussian). */
function blur(values: Float32Array, width: number, height: number, radius: number): void {
  if (radius < 1) return;
  const line = new Float32Array(Math.max(width, height));
  const span = radius * 2 + 1;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += values[y * width + Math.min(width - 1, Math.max(0, k))]!;
      for (let x = 0; x < width; x += 1) {
        line[x] = sum / span;
        sum += values[y * width + Math.min(width - 1, x + radius + 1)]! - values[y * width + Math.max(0, x - radius)]!;
      }
      for (let x = 0; x < width; x += 1) values[y * width + x] = line[x]!;
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += values[Math.min(height - 1, Math.max(0, k)) * width + x]!;
      for (let y = 0; y < height; y += 1) {
        line[y] = sum / span;
        sum += values[Math.min(height - 1, y + radius + 1) * width + x]! - values[Math.max(0, y - radius) * width + x]!;
      }
      for (let y = 0; y < height; y += 1) values[y * width + x] = line[y]!;
    }
  }
}

/**
 * The fog's coverage over cells c0…c1 × r0…r1 as a small image, `sub`
 * pixels per cell: the explored cells blurred into round banks, their edge
 * frayed by the cloud texture (anchored to the world, so it holds still as
 * the chart pans).
 */
function fogMask(context: CanvasRenderingContext2D, explored: ExploredSea, c0: number, r0: number, c1: number, r1: number, sub: number): FogMask {
  const columns = c1 - c0 + 1;
  const rows = r1 - r0 + 1;
  const key = `${c0}:${r0}:${columns}:${rows}:${sub}:${explored.revision}`;
  let mask = fogMasks.get(context);
  if (mask && mask.key === key) return mask;
  const width = columns * sub;
  const height = rows * sub;
  const field = new Float32Array(width * height);
  for (let row = r0; row <= r1; row += 1) {
    // Image rows run north (high z) to south; image columns west (high x) to east.
    const y = (r1 - row) * sub;
    for (let column = c0; column <= c1; column += 1) {
      if (explored.has(column, row)) continue;
      const x = (c1 - column) * sub;
      for (let dy = 0; dy < sub; dy += 1) field.fill(1, (y + dy) * width + x, (y + dy) * width + x + sub);
    }
  }
  blur(field, width, height, Math.max(1, Math.round(sub * 0.75)));
  const cloud = cloudValues();
  const canvas = mask?.canvas ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const maskContext = canvas.getContext("2d")!;
  const image = maskContext.createImageData(width, height);
  // World metres per cloud texel: the fraying is a few tens of metres across.
  const texel = FOG_CELL / 3;
  for (let y = 0; y < height; y += 1) {
    const worldZ = (r1 + 1) * FOG_CELL - ((y + 0.5) / sub) * FOG_CELL;
    const ty = ((Math.floor(worldZ / texel) % 256) + 256) % 256;
    for (let x = 0; x < width; x += 1) {
      const worldX = (c1 + 1) * FOG_CELL - ((x + 0.5) / sub) * FOG_CELL;
      const tx = ((Math.floor(worldX / texel) % 256) + 256) % 256;
      const value = field[y * width + x]! + (cloud[ty * 256 + tx]! - 0.45) * 0.42;
      const t = Math.min(1, Math.max(0, (value - 0.32) / 0.4));
      image.data[(y * width + x) * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }
  maskContext.putImageData(image, 0, 0);
  mask = { canvas, key, c1, r1, columns, rows };
  fogMasks.set(context, mask);
  return mask;
}

// --- Geometry -----------------------------------------------------------------

function toScreen(camera: ChartCamera, x: number, z: number): [number, number] {
  return [camera.width / 2 - (x - camera.x) / camera.mpp, camera.height / 2 - (z - camera.z) / camera.mpp];
}

/** The island's outline grown by `extra` metres (or shrunk by `fraction` of its radius). */
function islandPath(camera: ChartCamera, island: ChartIsland, fraction: number, extra: number): Path2D {
  const [cx, cy] = toScreen(camera, island.x, island.z);
  const screenRadius = (island.radius * fraction + extra) / camera.mpp;
  const count = Math.round(Math.min(84, Math.max(14, screenRadius * 0.9)));
  const path = new Path2D();
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const radius = island.radius * islandEdgeNoise(angle, island) * fraction;
    const wx = Math.cos(angle) * (radius + extra);
    const wz = Math.sin(angle) * (radius * island.scaleZ + extra);
    const sx = cx - wx / camera.mpp;
    const sy = cy - wz / camera.mpp;
    if (index === 0) path.moveTo(sx, sy);
    else path.lineTo(sx, sy);
  }
  path.closePath();
  return path;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function drawIsland(context: CanvasRenderingContext2D, camera: ChartCamera, island: ChartIsland, style: ChartStyle): void {
  const [cx, cy] = toScreen(camera, island.x, island.z);
  const screenRadius = island.radius / camera.mpp;
  const reach = (island.radius * Math.max(1, island.scaleZ) * 1.15 + SHELF_WIDTH) / camera.mpp;
  if (cx + reach < 0 || cx - reach > camera.width || cy + reach < 0 || cy - reach > camera.height) return;
  // Shelf and reef: the shallows a skipper keeps off.
  context.fillStyle = "rgba(70, 190, 200, 0.28)";
  context.fill(islandPath(camera, island, 1, SHELF_WIDTH));
  context.fillStyle = "rgba(120, 225, 215, 0.42)";
  context.fill(islandPath(camera, island, 1, 11));
  const beach = islandPath(camera, island, 1, 0);
  context.fillStyle = island.volcano ? "#3b3532" : "#ead8a6";
  context.fill(beach);
  if (screenRadius < 1.6) return;
  const sand = island.volcano ? 0.9 : island.radius < 24 ? 0.55 : Math.max(0.6, 1 - 7 / island.radius);
  const land = islandPath(camera, island, sand, 0);
  const gradient = context.createRadialGradient(
    cx + screenRadius * 0.18,
    cy - screenRadius * 0.22,
    screenRadius * 0.05,
    cx,
    cy,
    screenRadius * sand * 1.05,
  );
  if (island.volcano) {
    gradient.addColorStop(0, "#7d6a5c");
    gradient.addColorStop(0.55, "#5a4a40");
    gradient.addColorStop(1, "#40362f");
  } else if (island.radius < 24) {
    gradient.addColorStop(0, "#8cc46a");
    gradient.addColorStop(1, "#5b9a4c");
  } else {
    gradient.addColorStop(0, island.height > 5 ? "#9bc77a" : "#7fbb62");
    gradient.addColorStop(0.6, "#5e9d4f");
    gradient.addColorStop(1, "#457f3e");
  }
  context.fillStyle = gradient;
  context.fill(land);
  // Contour lines on the higher islands (and many on a volcano).
  if (screenRadius > 7) {
    const levels = island.volcano ? 5 : island.height > 5 ? 3 : island.height > 2.4 ? 1 : 0;
    context.lineWidth = 0.8;
    context.strokeStyle = island.volcano ? "rgba(30, 20, 16, 0.38)" : "rgba(30, 64, 30, 0.32)";
    for (let level = 1; level <= levels; level += 1) {
      context.stroke(islandPath(camera, island, sand * (1 - level / (levels + 1.2)), 0));
    }
  }
  // Groves: dark green dots where the palms stand.
  if (!island.volcano && screenRadius > 9 && !style.mini) {
    context.fillStyle = "rgba(28, 72, 34, 0.55)";
    const trees = Math.min(40, Math.round(island.radius / 3));
    for (let index = 0; index < trees; index += 1) {
      const angle = hash(island.id * 0.37 + index) * Math.PI * 2;
      const radial = Math.sqrt(hash(island.id * 0.71 + index * 1.3)) * sand * 0.85;
      const wx = Math.cos(angle) * island.radius * radial;
      const wz = Math.sin(angle) * island.radius * radial * island.scaleZ;
      context.beginPath();
      context.arc(cx - wx / camera.mpp, cy - wz / camera.mpp, Math.max(0.8, 2.6 / camera.mpp), 0, Math.PI * 2);
      context.fill();
    }
  }
  if (island.volcano) {
    const crater = Math.max(2, (island.radius * 0.15) / camera.mpp);
    const pulse = 0.75 + 0.25 * Math.sin(style.time * 1.7 + island.seed);
    // Lava runs: a few glowing threads down the slope.
    context.lineCap = "round";
    for (let index = 0; index < 3; index += 1) {
      const angle = hash(island.id + index * 7.3) * Math.PI * 2;
      const length = island.radius * (0.45 + 0.35 * hash(island.id + index * 3.1));
      const bend = (hash(island.id + index * 1.7) - 0.5) * 0.5;
      context.strokeStyle = `rgba(255, 110, 40, ${0.55 * pulse})`;
      context.lineWidth = Math.max(1, 5 / camera.mpp);
      context.beginPath();
      context.moveTo(cx - (Math.cos(angle) * island.radius * 0.14) / camera.mpp, cy - (Math.sin(angle) * island.radius * 0.14) / camera.mpp);
      context.quadraticCurveTo(
        cx - (Math.cos(angle + bend) * length * 0.6) / camera.mpp,
        cy - (Math.sin(angle + bend) * length * 0.6) / camera.mpp,
        cx - (Math.cos(angle + bend * 0.4) * length) / camera.mpp,
        cy - (Math.sin(angle + bend * 0.4) * length) / camera.mpp,
      );
      context.stroke();
    }
    const glow = context.createRadialGradient(cx, cy, 0, cx, cy, crater * 2.6);
    glow.addColorStop(0, `rgba(255, 220, 140, ${0.95 * pulse})`);
    glow.addColorStop(0.35, `rgba(255, 110, 40, ${0.8 * pulse})`);
    glow.addColorStop(1, "rgba(255, 60, 20, 0)");
    context.fillStyle = "#1d1513";
    context.beginPath();
    context.arc(cx, cy, crater, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = glow;
    context.beginPath();
    context.arc(cx, cy, crater * 2.6, 0, Math.PI * 2);
    context.fill();
  }
  // A crisp coastline.
  context.lineWidth = 1;
  context.strokeStyle = island.volcano ? "rgba(10, 8, 8, 0.6)" : "rgba(120, 92, 48, 0.55)";
  context.stroke(beach);
}

function niceStep(metres: number): number {
  for (const step of [100, 250, 500, 1000, 2000, 5000, 10000, 20000]) if (step >= metres) return step;
  return 50000;
}

function drawGrid(context: CanvasRenderingContext2D, camera: ChartCamera): void {
  const step = niceStep(camera.mpp * 110);
  const left = camera.x + (camera.width / 2) * camera.mpp;
  const right = camera.x - (camera.width / 2) * camera.mpp;
  const top = camera.z + (camera.height / 2) * camera.mpp;
  const bottom = camera.z - (camera.height / 2) * camera.mpp;
  context.lineWidth = 1;
  context.strokeStyle = "rgba(170, 225, 240, 0.08)";
  context.beginPath();
  for (let x = Math.floor(right / step) * step; x <= left; x += step) {
    const [sx] = toScreen(camera, x, 0);
    context.moveTo(Math.round(sx) + 0.5, 0);
    context.lineTo(Math.round(sx) + 0.5, camera.height);
  }
  for (let z = Math.floor(bottom / step) * step; z <= top; z += step) {
    const [, sy] = toScreen(camera, 0, z);
    context.moveTo(0, Math.round(sy) + 0.5);
    context.lineTo(camera.width, Math.round(sy) + 0.5);
  }
  context.stroke();
}

function drawTrack(context: CanvasRenderingContext2D, camera: ChartCamera, points: readonly number[], mini: boolean): void {
  if (points.length < 4) return;
  context.save();
  context.lineWidth = mini ? 1.2 : 1.8;
  context.strokeStyle = "rgba(255, 255, 255, 0.6)";
  context.setLineDash(mini ? [2, 3] : [5, 6]);
  context.lineJoin = "round";
  context.beginPath();
  let drawing = false;
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index]!;
    const z = points[index + 1]!;
    if (Number.isNaN(x)) {
      drawing = false;
      continue;
    }
    const [sx, sy] = toScreen(camera, x, z);
    if (drawing) context.lineTo(sx, sy);
    else context.moveTo(sx, sy);
    drawing = true;
  }
  context.stroke();
  context.restore();
}

function drawFog(context: CanvasRenderingContext2D, camera: ChartCamera, explored: ExploredSea, time: number): void {
  const pad = 2;
  const halfWidth = (camera.width / 2) * camera.mpp;
  const halfHeight = (camera.height / 2) * camera.mpp;
  const c0 = Math.floor((camera.x - halfWidth) / FOG_CELL) - pad;
  const c1 = Math.floor((camera.x + halfWidth) / FOG_CELL) + pad;
  const r0 = Math.floor((camera.z - halfHeight) / FOG_CELL) - pad;
  const r1 = Math.floor((camera.z + halfHeight) / FOG_CELL) + pad;
  const cellPixels = FOG_CELL / camera.mpp;
  // Finer coverage when a cell is large on screen (cheap: few cells are in view then).
  const sub = Math.max(1, Math.min(6, Math.round(cellPixels / 10)));
  const mask = fogMask(context, explored, c0, r0, c1, r1, sub);
  const canvas = context.canvas;
  let layer = fogLayers.get(context);
  if (!layer) {
    layer = document.createElement("canvas");
    fogLayers.set(context, layer);
  }
  if (layer.width !== canvas.width || layer.height !== canvas.height) {
    layer.width = canvas.width;
    layer.height = canvas.height;
  }
  const fog = layer.getContext("2d")!;
  fog.setTransform(1, 0, 0, 1, 0, 0);
  fog.globalCompositeOperation = "source-over";
  fog.clearRect(0, 0, layer.width, layer.height);
  fog.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
  // Mask pixel (0, 0) is the cell (c1, r1). West is high x and shown on the
  // left, so the image's top-left corner is the world point ((c1+1)·cell, (r1+1)·cell).
  const [left, top] = toScreen(camera, (mask.c1 + 1) * FOG_CELL, (mask.r1 + 1) * FOG_CELL);
  // Scaled up with smoothing, the blurred grid becomes soft banks of fog.
  fog.imageSmoothingEnabled = true;
  fog.imageSmoothingQuality = "high";
  fog.drawImage(mask.canvas, left, top, mask.columns * cellPixels, mask.rows * cellPixels);
  // Fill the masked area with drifting cloud, anchored to the world so it pans with the chart.
  fog.globalCompositeOperation = "source-in";
  const pattern = fog.createPattern(fogFill(), "repeat");
  if (pattern) {
    const scale = Math.max(0.6, Math.min(3, 18 / camera.mpp)) * 0.5 + 0.6;
    const [ox, oy] = toScreen(camera, 0, 0);
    pattern.setTransform(new DOMMatrix().translate(ox + time * 2.2, oy + time * 0.8).scale(scale));
    fog.fillStyle = pattern;
  } else {
    fog.fillStyle = "rgb(36, 58, 72)";
  }
  fog.fillRect(0, 0, camera.width, camera.height);
  // A second, larger and turned layer of cloud breaks up the tile's repeat.
  const broad = fog.createPattern(fogFill(), "repeat");
  if (broad) {
    const scale = (Math.max(0.6, Math.min(3, 18 / camera.mpp)) * 0.5 + 0.6) * 2.7;
    const [ox, oy] = toScreen(camera, 0, 0);
    broad.setTransform(new DOMMatrix().translate(ox - time * 1.3, oy + time * 1.6).rotate(37).scale(scale));
    fog.globalCompositeOperation = "source-atop";
    fog.globalAlpha = 0.5;
    fog.fillStyle = broad;
    fog.fillRect(0, 0, camera.width, camera.height);
    fog.globalAlpha = 1;
  }
  fog.globalCompositeOperation = "source-over";
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(layer, 0, 0);
  context.restore();
}

type Box = [number, number, number, number];

function drawPlace(context: CanvasRenderingContext2D, camera: ChartCamera, place: ChartPlace, style: ChartStyle, boxes: Box[]): void {
  const [x, y] = toScreen(camera, place.x, place.z);
  const size = style.mini ? 6.5 : 11;
  if (x < -size * 4 || x > camera.width + size * 4 || y < -size * 2 || y > camera.height + size * 4) return;
  const color = PLACE_COLORS[place.kind];
  context.save();
  context.translate(x, y);
  if (!place.discovered) {
    // Seen from afar but not yet visited: a question mark.
    context.setLineDash([2.5, 2.5]);
    context.lineWidth = 1.3;
    context.strokeStyle = "rgba(255, 255, 255, 0.8)";
    context.fillStyle = "rgba(8, 28, 40, 0.65)";
    context.beginPath();
    context.arc(0, 0, size, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#ffffff";
    context.font = `700 ${Math.round(size * 1.2)}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("?", 0, size * 0.06);
    if (!style.mini) label(context, style.labels.unknown, x, y, size, "rgba(255, 255, 255, 0.75)", boxes);
    context.restore();
    return;
  }
  context.shadowColor = color;
  context.shadowBlur = style.mini ? 4 : 10;
  context.fillStyle = "rgba(8, 28, 40, 0.92)";
  context.beginPath();
  context.arc(0, 0, size, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = style.mini ? 1.2 : 1.8;
  context.strokeStyle = color;
  context.stroke();
  const s = size * 0.55;
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1.1, size * 0.13);
  context.lineCap = "round";
  context.lineJoin = "round";
  switch (place.kind) {
    case "volcano": {
      context.beginPath();
      context.moveTo(-s * 1.05, s * 0.75);
      context.lineTo(-s * 0.25, -s * 0.35);
      context.lineTo(s * 0.25, -s * 0.35);
      context.lineTo(s * 1.05, s * 0.75);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(0, -s * 0.5);
      context.quadraticCurveTo(-s * 0.4, -s * 0.9, s * 0.15, -s * 1.15);
      context.stroke();
      break;
    }
    case "barge": {
      // A quaver: the music on the water.
      context.beginPath();
      context.ellipse(-s * 0.3, s * 0.55, s * 0.38, s * 0.3, -0.4, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(s * 0.05, s * 0.5);
      context.lineTo(s * 0.05, -s * 0.95);
      context.quadraticCurveTo(s * 0.35, -s * 0.5, s * 0.75, -s * 0.35);
      context.stroke();
      break;
    }
    case "wreck": {
      // An anchor.
      context.beginPath();
      context.arc(0, -s * 0.72, s * 0.22, 0, Math.PI * 2);
      context.moveTo(0, -s * 0.5);
      context.lineTo(0, s * 0.85);
      context.moveTo(-s * 0.45, -s * 0.2);
      context.lineTo(s * 0.45, -s * 0.2);
      context.moveTo(-s * 0.8, s * 0.25);
      context.quadraticCurveTo(-s * 0.6, s * 0.9, 0, s * 0.85);
      context.quadraticCurveTo(s * 0.6, s * 0.9, s * 0.8, s * 0.25);
      context.stroke();
      break;
    }
    case "monolith": {
      context.fillRect(-s * 0.3, -s * 0.95, s * 0.6, s * 1.75);
      context.fillStyle = "rgba(8, 28, 40, 0.9)";
      context.fillRect(-s * 0.08, -s * 0.6, s * 0.16, s * 0.16);
      context.fillRect(-s * 0.08, -s * 0.15, s * 0.16, s * 0.16);
      break;
    }
  }
  if (!style.mini) label(context, style.labels[place.kind], x, y, size, "#ffffff", boxes);
  context.restore();
}

/** A name under a mark, unless it would overlap one already written. */
function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, boxes: Box[]): void {
  context.font = "600 12px system-ui, -apple-system, Segoe UI, sans-serif";
  const width = context.measureText(text).width + 6;
  const box: Box = [x - width / 2, y + size + 3, x + width / 2, y + size + 20];
  if (boxes.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) return;
  boxes.push(box);
  context.textAlign = "center";
  context.textBaseline = "top";
  context.lineWidth = 3.5;
  context.strokeStyle = "rgba(4, 20, 30, 0.85)";
  context.lineJoin = "round";
  context.setLineDash([]);
  context.strokeText(text, 0, size + 5);
  context.fillStyle = color;
  context.fillText(text, 0, size + 5);
}

function drawYacht(context: CanvasRenderingContext2D, camera: ChartCamera, data: ChartFeatures, style: ChartStyle): void {
  const [x, y] = toScreen(camera, data.yacht.x, data.yacht.z);
  // Heading 0 is north (up); the compass bearing grows clockwise as heading falls.
  const angle = -data.yacht.heading;
  if (!style.mini) {
    // The lookout's horizon: what is lifted out of the fog.
    context.save();
    context.setLineDash([3, 6]);
    context.lineWidth = 1;
    context.strokeStyle = "rgba(160, 240, 235, 0.35)";
    context.beginPath();
    context.arc(x, y, SIGHT_RANGE / camera.mpp, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  const size = style.mini ? 7 : 11;
  // Course line ahead.
  context.strokeStyle = "rgba(95, 240, 220, 0.75)";
  context.lineWidth = 1.4;
  context.setLineDash([3, 4]);
  context.beginPath();
  context.moveTo(0, -size * 1.2);
  context.lineTo(0, -size * (style.mini ? 3 : 5));
  context.stroke();
  context.setLineDash([]);
  context.shadowColor = "rgba(95, 240, 220, 0.9)";
  context.shadowBlur = style.mini ? 6 : 12;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(0, -size * 1.15);
  context.quadraticCurveTo(size * 0.62, -size * 0.2, size * 0.48, size * 0.85);
  context.lineTo(-size * 0.48, size * 0.85);
  context.quadraticCurveTo(-size * 0.62, -size * 0.2, 0, -size * 1.15);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "#14a99a";
  context.beginPath();
  context.arc(0, size * 0.05, size * 0.22, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawLoot(context: CanvasRenderingContext2D, camera: ChartCamera, data: ChartFeatures, style: ChartStyle): void {
  const twinkle = 0.7 + 0.3 * Math.sin(style.time * 4);
  for (const item of data.loot) {
    const [x, y] = toScreen(camera, item.x, item.z);
    if (x < -8 || x > camera.width + 8 || y < -8 || y > camera.height + 8) continue;
    const r = style.mini ? 2.2 : 3.4;
    const glow = context.createRadialGradient(x, y, 0, x, y, r * 3.2);
    glow.addColorStop(0, `rgba(255, 214, 102, ${0.85 * twinkle})`);
    glow.addColorStop(1, "rgba(255, 190, 60, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, r * 3.2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = item.kind === "flamingo" ? "#ff8fc0" : "#ffd666";
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }
}

/** Draws the whole chart into `context` (whose canvas is width·dpr × height·dpr). */
export function drawChart(context: CanvasRenderingContext2D, camera: ChartCamera, data: ChartFeatures, style: ChartStyle): void {
  context.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  // The sea: deep blue, a little lighter toward the middle, with a faint swell texture.
  const sea = context.createRadialGradient(
    camera.width / 2,
    camera.height / 2,
    0,
    camera.width / 2,
    camera.height / 2,
    Math.hypot(camera.width, camera.height) / 2,
  );
  sea.addColorStop(0, SEA_MID);
  sea.addColorStop(1, SEA_DEEP);
  context.fillStyle = sea;
  context.fillRect(0, 0, camera.width, camera.height);
  const swell = context.createPattern(clouds(), "repeat");
  if (swell) {
    const [ox, oy] = toScreen(camera, 0, 0);
    swell.setTransform(new DOMMatrix().translate(ox, oy).scale(Math.max(0.5, Math.min(4, 6 / camera.mpp))));
    context.globalAlpha = 0.05;
    context.fillStyle = swell;
    context.fillRect(0, 0, camera.width, camera.height);
    context.globalAlpha = 1;
  }
  if (!style.mini) drawGrid(context, camera);
  for (const island of data.islands) drawIsland(context, camera, island, style);
  drawTrack(context, camera, data.track.points, style.mini);
  drawLoot(context, camera, data, style);
  drawFog(context, camera, data.explored, style.time);
  // Found places first, so their names win over the question marks'.
  const boxes: Box[] = [];
  const shown = data.places.filter((place) => place.discovered || data.explored.seen(place.x, place.z));
  shown.sort((a, b) => Number(b.discovered) - Number(a.discovered));
  for (const place of shown) {
    const [x, y] = toScreen(camera, place.x, place.z);
    boxes.push([x - 12, y - 12, x + 12, y + 12]);
  }
  for (const place of shown) drawPlace(context, camera, place, style, boxes);
  drawYacht(context, camera, data, style);
}

/** A scale bar's length (CSS px) and label for the chart's current zoom. */
export function scaleBar(mpp: number): { pixels: number; label: string } {
  const metres = niceStep(mpp * 90);
  return { pixels: metres / mpp, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` };
}
