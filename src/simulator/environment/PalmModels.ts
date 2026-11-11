import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Procedural coconut palms, built to be looked at from a dinghy's length.
 *
 * A palm is three parts, each its own material so a whole grove merges into
 * three draw calls:
 *
 * - **trunk**: a slender, gently curving column that swells at its foot
 *   (the root bole) and narrows under the crown, wrapped in a bark texture
 *   of leaf-scar rings, fibres and lichen, with its normal map;
 * - **fronds**: a crown of pinnate leaves. Each frond is a ribbon along its
 *   rachis that rises, arches and droops under its own weight, folded into a
 *   shallow V; the leaflets are cut from an alpha texture (some missing, some
 *   torn, the old lower fronds yellowing), so the outline is a fringe of
 *   leaflets rather than a flat blade;
 * - **nuts**: a cluster of coconuts and the fibrous boot under the crown.
 *
 * Every variant comes at two levels of detail: near (smooth curves, many
 * fronds) and far (a third of the triangles), switched per grove by
 * distance. Units are metres; the palm stands at the origin, +Y up, about
 * ten metres tall before it is scaled.
 */

export type PalmPart = "trunk" | "fronds" | "nuts";

export type PalmVariant = {
  /** One geometry per part (vertex colours on the nuts only). */
  parts: Record<PalmPart, THREE.BufferGeometry>;
  height: number;
};

export type PalmTextures = {
  frond: THREE.DataTexture;
  bark: THREE.CanvasTexture;
  barkNormal: THREE.CanvasTexture;
};

const PALM_HEIGHT = 10;

/** A small deterministic generator (mulberry32). */
function random(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Textures ------------------------------------------------------------------

const FROND_WIDTH = 256;
const FROND_HEIGHT = 512;

/**
 * The leaflet sheet: u across the frond (0 left edge, 0.5 the rachis, 1 the
 * right edge), v from the tip (0) to the base (1). Leaflets leave the rachis angled
 * toward the tip, taper to a point and arch slightly; a few are missing or
 * torn short. RGB is the leaf colour; A the cut-out.
 *
 * Mipmaps are built here with their alpha rescaled so each level covers as
 * much as the full-size sheet at the cut-off: otherwise a distant frond's
 * averaged alpha falls under the threshold and the crown thins to nothing.
 */
export function createFrondTexture(): THREE.DataTexture {
  const rng = random(77);
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(FROND_WIDTH, FROND_HEIGHT) : Object.assign(document.createElement("canvas"), { width: FROND_WIDTH, height: FROND_HEIGHT });
  const g = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  g.clearRect(0, 0, FROND_WIDTH, FROND_HEIGHT);
  const centre = FROND_WIDTH / 2;
  const leaflets = 78;
  for (const side of [-1, 1]) {
    for (let index = 0; index < leaflets; index += 1) {
      const along = (index + 0.5 + (rng() - 0.5) * 0.4) / leaflets;
      if (along > 0.985) continue;
      // Missing leaflets: torn off by the wind.
      if (rng() < 0.05) continue;
      // Image y runs from the tip (top) to the base (bottom).
      const y0 = (1 - along) * FROND_HEIGHT;
      const torn = rng() < 0.08 ? 0.45 + rng() * 0.3 : 1;
      const reach = (centre - 3) * torn * (0.9 + rng() * 0.1);
      // Leaflets sweep toward the tip, more steeply near the base.
      const sweep = (0.36 + 0.22 * (1 - along)) * FROND_HEIGHT * 0.16;
      const width = 2.2 + 1.6 * Math.sin(Math.PI * Math.min(1, along * 1.1)) + rng() * 0.6;
      const hue = 84 + (rng() - 0.5) * 16;
      const light = 26 + rng() * 9 + along * 4;
      const saturation = 44 + rng() * 14;
      const tipX = centre + side * reach;
      const tipY = y0 - sweep;
      // Arching: the leaflet's midline bows away from the tip direction.
      const bowX = centre + side * reach * 0.55;
      const bowY = y0 - sweep * 0.25;
      const gradient = g.createLinearGradient(centre, y0, tipX, tipY);
      gradient.addColorStop(0, `hsl(${hue + 6}, ${saturation - 8}%, ${light + 8}%)`);
      gradient.addColorStop(0.55, `hsl(${hue}, ${saturation}%, ${light}%)`);
      // Some tips dry to straw.
      const dryTip = rng() < 0.18;
      gradient.addColorStop(1, dryTip ? `hsl(48, 45%, ${light + 14}%)` : `hsl(${hue - 4}, ${saturation}%, ${light - 3}%)`);
      g.fillStyle = gradient;
      g.beginPath();
      g.moveTo(centre, y0 - width * 0.6);
      g.quadraticCurveTo(bowX, bowY - width * 0.9, tipX, tipY);
      g.quadraticCurveTo(bowX, bowY + width * 0.9, centre, y0 + width * 0.6);
      g.closePath();
      g.fill();
      // Midrib: a fine lighter line.
      g.strokeStyle = `hsla(${hue + 10}, 40%, ${light + 18}%, 0.55)`;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(centre, y0);
      g.quadraticCurveTo(bowX, bowY, tipX, tipY);
      g.stroke();
    }
  }
  // The rachis: a stout yellow-green stem, thickest at the base.
  for (let y = 0; y < FROND_HEIGHT; y += 1) {
    const along = 1 - y / FROND_HEIGHT;
    const half = 1.2 + 3.4 * (1 - along);
    g.fillStyle = `hsl(${62 - along * 10}, 38%, ${48 - along * 10}%)`;
    g.fillRect(centre - half, y, half * 2, 1);
  }
  const base = g.getImageData(0, 0, FROND_WIDTH, FROND_HEIGHT).data;
  const texture = new THREE.DataTexture(new Uint8Array(base.buffer.slice(0)), FROND_WIDTH, FROND_HEIGHT, THREE.RGBAFormat);
  texture.mipmaps = coverageMipmaps(new Uint8Array(base.buffer.slice(0)), FROND_WIDTH, FROND_HEIGHT, 0.5);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Box-filtered mipmaps whose alpha is scaled per level so the share of
 * texels at or above `cutoff` matches the full-size level (alpha-tested
 * foliage keeps its density with distance). Colour is averaged weighted by
 * alpha, so cut-out texels never bleed dark fringes into the leaves.
 */
export function coverageMipmaps(data: Uint8Array, width: number, height: number, cutoff: number): THREE.DataTexture["mipmaps"] {
  const coverage = (pixels: Uint8Array, scale: number): number => {
    let covered = 0;
    for (let index = 3; index < pixels.length; index += 4) if ((pixels[index]! / 255) * scale >= cutoff) covered += 1;
    return covered / (pixels.length / 4);
  };
  const target = coverage(data, 1);
  const levels: { data: Uint8Array; width: number; height: number }[] = [{ data, width, height }];
  let source = data;
  let w = width;
  let h = height;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y += 1) {
      for (let x = 0; x < nw; x += 1) {
        let r = 0;
        let gr = 0;
        let b = 0;
        let a = 0;
        for (let dy = 0; dy < 2; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const sx = Math.min(w - 1, x * 2 + dx);
            const sy = Math.min(h - 1, y * 2 + dy);
            const i = (sy * w + sx) * 4;
            const alpha = source[i + 3]!;
            r += source[i]! * alpha;
            gr += source[i + 1]! * alpha;
            b += source[i + 2]! * alpha;
            a += alpha;
          }
        }
        const o = (y * nw + x) * 4;
        next[o] = a > 0 ? r / a : 0;
        next[o + 1] = a > 0 ? gr / a : 0;
        next[o + 2] = a > 0 ? b / a : 0;
        next[o + 3] = a / 4;
      }
    }
    // Find the alpha scale that restores the full-size coverage.
    let low = 1;
    let high = 8;
    for (let step = 0; step < 14; step += 1) {
      const mid = (low + high) / 2;
      if (coverage(next, mid) < target) low = mid;
      else high = mid;
    }
    const scaled = new Uint8Array(next);
    for (let index = 3; index < scaled.length; index += 4) scaled[index] = Math.min(255, Math.round(next[index]! * high));
    levels.push({ data: scaled, width: nw, height: nh });
    source = next;
    w = nw;
    h = nh;
  }
  return levels;
}

/** Bark: leaf-scar rings, vertical fibres, a grey weathering and lichen; with a matching normal map. */
export function createBarkTextures(): { bark: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const width = 256;
  const height = 512;
  const rng = random(31);
  const heightField = new Float32Array(width * height);
  const colour = new Float32Array(width * height * 3);
  const rings = 26;
  // Per-ring irregularity, wrapping round the trunk.
  const ringOffset = Array.from({ length: rings + 1 }, () => rng());
  for (let y = 0; y < height; y += 1) {
    const ringPos = (y / height) * rings;
    const ring = Math.floor(ringPos);
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const wobble = Math.sin(u * Math.PI * 2 * 3 + ringOffset[ring]! * 9) * 0.06 + Math.sin(u * Math.PI * 2 * 7 + ring) * 0.03;
      const f = ringPos - ring + wobble;
      const phase = ((f % 1) + 1) % 1;
      // Each ring: a smooth band that bulges, and a sharp scar groove at its top.
      const groove = Math.exp(-Math.pow((phase - 0.08) / 0.05, 2));
      const bulge = Math.sin(Math.PI * Math.min(1, phase / 0.9)) * 0.6;
      const fibre = Math.sin(u * 920 + Math.sin(y * 0.05) * 3) * 0.08 + (rng() - 0.5) * 0.12;
      const h = bulge - groove * 1.4 + fibre;
      heightField[y * width + x] = h;
      const weather = 0.5 + 0.5 * Math.sin(u * 13 + y * 0.011) * Math.sin(y * 0.023 + u * 5);
      // Weathered coconut bark is a light grey-brown, paler where the sun bleaches it.
      let r = 0.6 + 0.07 * weather + h * 0.05;
      let g = 0.55 + 0.06 * weather + h * 0.045;
      let b = 0.47 + 0.05 * weather + h * 0.04;
      // Grooves hold dark, damp fibre.
      r -= groove * 0.2;
      g -= groove * 0.19;
      b -= groove * 0.17;
      const i = (y * width + x) * 3;
      colour[i] = r;
      colour[i + 1] = g;
      colour[i + 2] = b;
    }
  }
  // Lichen: pale grey-green blotches.
  for (let spot = 0; spot < 70; spot += 1) {
    const cx = rng() * width;
    const cy = rng() * height;
    const radius = 3 + rng() * 9;
    for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
      for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
        const d = Math.hypot(x - cx, y - cy) / radius;
        if (d > 1 || y < 0 || y >= height) continue;
        const wx = ((x % width) + width) % width;
        const i = (y * width + wx) * 3;
        const t = (1 - d) * 0.5 * (0.6 + rng() * 0.4);
        colour[i] = colour[i]! * (1 - t) + 0.62 * t;
        colour[i + 1] = colour[i + 1]! * (1 - t) + 0.63 * t;
        colour[i + 2] = colour[i + 2]! * (1 - t) + 0.52 * t;
      }
    }
  }
  const make = (fill: (data: Uint8ClampedArray) => void): THREE.CanvasTexture => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d")!;
    const image = g.createImageData(width, height);
    fill(image.data);
    g.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  };
  const bark = make((data) => {
    for (let index = 0; index < width * height; index += 1) {
      data[index * 4] = Math.round(Math.min(1, Math.max(0, colour[index * 3]!)) * 255);
      data[index * 4 + 1] = Math.round(Math.min(1, Math.max(0, colour[index * 3 + 1]!)) * 255);
      data[index * 4 + 2] = Math.round(Math.min(1, Math.max(0, colour[index * 3 + 2]!)) * 255);
      data[index * 4 + 3] = 255;
    }
  });
  bark.colorSpace = THREE.SRGBColorSpace;
  const normal = make((data) => {
    const at = (x: number, y: number) => heightField[Math.min(height - 1, Math.max(0, y)) * width + (((x % width) + width) % width)]!;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * 1.6;
        const dy = (at(x, y + 1) - at(x, y - 1)) * 1.6;
        const length = Math.hypot(dx, dy, 1);
        const i = (y * width + x) * 4;
        data[i] = Math.round((-dx / length * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round((dy / length * 0.5 + 0.5) * 255);
        data[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
        data[i + 3] = 255;
      }
    }
  });
  return { bark, normal };
}

// --- Geometry ------------------------------------------------------------------

/** Trunk centreline at t (0 foot … 1 crown): a gentle upward curve, as a coconut palm grows toward the light. */
function trunkCentre(t: number, curve: number, height: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(curve * height * 0.11 * t * t * (1.2 - 0.2 * t), t * height, curve * height * 0.02 * Math.sin(t * Math.PI));
}

function trunkRadius(t: number, girth: number): number {
  // A root bole at the foot, a slender column, a slight narrowing under the crown.
  const bole = 0.16 * Math.exp(-t * 14);
  return girth * (0.2 + bole + 0.03 * Math.sin(t * 9.3) * (1 - t) - 0.05 * t);
}

function buildTrunk(height: number, curve: number, girth: number, sides: number, rings: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const centre = new THREE.Vector3();
  const next = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 1);
  // The bark tile holds 26 rings; a ring every twelve centimetres or so.
  const tileLength = 26 * 0.12;
  let travelled = 0;
  const previous = new THREE.Vector3();
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    trunkCentre(t, curve, height, centre);
    trunkCentre(Math.min(1, t + 0.01), curve, height, next);
    if (ring > 0) travelled += centre.distanceTo(previous);
    previous.copy(centre);
    tangent.copy(next).sub(centre);
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 1, 0);
    tangent.normalize();
    side.crossVectors(tangent, up).normalize();
    binormal.crossVectors(side, tangent).normalize();
    const radius = trunkRadius(t, girth);
    for (let s = 0; s <= sides; s += 1) {
      const a = (s / sides) * Math.PI * 2;
      positions.push(
        centre.x + (side.x * Math.cos(a) + binormal.x * Math.sin(a)) * radius,
        centre.y + (side.y * Math.cos(a) + binormal.y * Math.sin(a)) * radius,
        centre.z + (side.z * Math.cos(a) + binormal.z * Math.sin(a)) * radius,
      );
      uvs.push((s / sides) * 2, travelled / tileLength);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = ring * (sides + 1) + s;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type FrondSpec = {
  azimuth: number;
  /** Elevation of the rachis as it leaves the crown, radians (up +). */
  rise: number;
  /** How far it bends down by the tip, radians. */
  droop: number;
  length: number;
  /** Half-width of the leaflets at their longest, metres. */
  span: number;
  /** V-fold of the leaflets above the rachis plane, radians. */
  fold: number;
  /** 0 green … 1 old and yellowing (the lowest fronds). */
  age: number;
};

function buildFrond(origin: THREE.Vector3, spec: FrondSpec, segments: number, out: { positions: number[]; uvs: number[]; colors: number[]; indices: number[] }): void {
  const base = out.positions.length / 3;
  const point = origin.clone();
  const horizontal = new THREE.Vector3(Math.cos(spec.azimuth), 0, Math.sin(spec.azimuth));
  const side = new THREE.Vector3(-horizontal.z, 0, horizontal.x);
  const tangent = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const step = spec.length / segments;
  // Old fronds are yellower and paler.
  const tintR = 1 + spec.age * 0.35;
  const tintG = 1 + spec.age * 0.08;
  const tintB = 1 - spec.age * 0.35;
  for (let index = 0; index <= segments; index += 1) {
    const s = index / segments;
    const angle = spec.rise - spec.droop * Math.pow(s, 1.6);
    tangent.copy(horizontal).multiplyScalar(Math.cos(angle)).addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(angle)).normalize();
    // The frond's own "up", square to its tangent and its side.
    lift.crossVectors(side, tangent).normalize();
    if (lift.y < 0) lift.negate();
    if (index > 0) point.addScaledVector(tangent, step);
    // Leaflets are short at the base, longest a third of the way, shrinking to the tip.
    const width = spec.span * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + s * 0.95)), 0.75);
    // The V opens near the base and flattens, then droops, toward the tip.
    const fold = spec.fold * (1 - s * 0.8) - 0.25 * s * s;
    const cosF = Math.cos(fold);
    const sinF = Math.sin(fold);
    for (const [u, sign] of [[0, -1], [0.5, 0], [1, 1]] as const) {
      const w = sign === 0 ? 0 : width;
      out.positions.push(
        point.x + (side.x * sign * cosF + lift.x * sinF * Math.abs(sign)) * w,
        point.y + (side.y * sign * cosF + lift.y * sinF * Math.abs(sign)) * w - (sign === 0 ? 0 : 0.04 * s),
        point.z + (side.z * sign * cosF + lift.z * sinF * Math.abs(sign)) * w,
      );
      // The leaflet sheet is drawn tip at v = 0.
      out.uvs.push(u, 1 - s);
      out.colors.push(tintR, tintG, tintB);
    }
  }
  for (let index = 0; index < segments; index += 1) {
    const a = base + index * 3;
    const b = a + 3;
    out.indices.push(a, a + 1, b, b, a + 1, b + 1, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
}

function buildCrown(top: THREE.Vector3, rng: () => number, fronds: number, segments: number): THREE.BufferGeometry {
  const out = { positions: [] as number[], uvs: [] as number[], colors: [] as number[], indices: [] as number[] };
  const golden = 2.399963229728653;
  const start = rng() * Math.PI * 2;
  for (let index = 0; index < fronds; index += 1) {
    // Young fronds stand up in the middle; the older ones spread and hang.
    const order = index / Math.max(1, fronds - 1);
    const spec: FrondSpec = {
      azimuth: start + index * golden + (rng() - 0.5) * 0.3,
      rise: 1.05 - order * 1.15 + (rng() - 0.5) * 0.18,
      droop: 0.7 + order * 1.25 + rng() * 0.3,
      length: 3.6 + (1 - Math.abs(order - 0.45) * 1.2) * 1.4 + rng() * 0.5,
      span: 0.62 + rng() * 0.16,
      fold: 0.42 + rng() * 0.18,
      age: order > 0.82 ? 0.5 + rng() * 0.5 : rng() * 0.15,
    };
    buildFrond(top, spec, segments, out);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out.positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(out.uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(out.colors, 3));
  geometry.setIndex(out.indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildNuts(top: THREE.Vector3, rng: () => number, detail: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const green = new THREE.Color(0x5d6b25);
  const ripe = new THREE.Color(0x7a5528);
  const fibre = new THREE.Color(0x6a5638);
  // The boot: the old leaf bases wrapped round the top of the trunk.
  const boot = new THREE.CylinderGeometry(0.2, 0.26, 0.7, detail > 0.5 ? 12 : 6, 1, true);
  boot.translate(top.x, top.y - 0.3, top.z);
  parts.push(painted(boot, fibre, 0.12, rng));
  const count = 4 + Math.floor(rng() * 5);
  for (let index = 0; index < count; index += 1) {
    const a = (index / count) * Math.PI * 2 + rng() * 0.6;
    const nut = new THREE.SphereGeometry(0.13 + rng() * 0.03, detail > 0.5 ? 9 : 5, detail > 0.5 ? 7 : 4);
    nut.scale(1, 1.15, 1);
    nut.translate(top.x + Math.cos(a) * 0.24, top.y - 0.55 - rng() * 0.25, top.z + Math.sin(a) * 0.24);
    parts.push(painted(nut, rng() < 0.3 ? ripe : green, 0.15, rng));
  }
  const merged = mergeGeometries(parts.map((part) => part.index ? part.toNonIndexed() : part), false)!;
  parts.forEach((part) => part.dispose());
  merged.computeVertexNormals();
  return merged;
}

function painted(geometry: THREE.BufferGeometry, colour: THREE.Color, jitter: number, rng: () => number): THREE.BufferGeometry {
  geometry.deleteAttribute("uv");
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const v = 1 + (rng() - 0.5) * jitter;
    colors[index * 3] = colour.r * v;
    colors[index * 3 + 1] = colour.g * v;
    colors[index * 3 + 2] = colour.b * v;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * `count` palm variants, each at a near and a far level of detail. Variants
 * differ in curve, girth, crown size and frond arrangement.
 */
export function createPalmVariants(count = 6): { near: PalmVariant[]; far: PalmVariant[] } {
  const near: PalmVariant[] = [];
  const far: PalmVariant[] = [];
  for (let index = 0; index < count; index += 1) {
    const curve = 0.4 + (index % 3) * 0.45;
    const girth = 0.95 + (index % 2) * 0.15;
    const height = PALM_HEIGHT * (0.92 + (index % 4) * 0.05);
    const top = trunkCentre(1, curve, height, new THREE.Vector3());
    const fronds = 15 + (index % 3);
    for (const [list, detail] of [[near, 1], [far, 0.34]] as const) {
      const rng = random(1000 + index * 17);
      list.push({
        height,
        parts: {
          trunk: buildTrunk(height, curve, girth, detail > 0.5 ? 12 : 6, detail > 0.5 ? 26 : 7),
          fronds: buildCrown(top, rng, detail > 0.5 ? fronds : Math.round(fronds * 0.75), detail > 0.5 ? 9 : 4),
          nuts: buildNuts(top, rng, detail),
        },
      });
    }
  }
  return { near, far };
}
