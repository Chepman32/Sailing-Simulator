import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { distanceFromWaterline, OPEN_WATER_DEPTH, SHELF_SLOPE, SHELF_WIDTH, SHORE_DEPTH } from "../environment/IslandMath";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import { patchMaterialShader } from "../core/ShaderPatch";
import { clamp, smoothstep } from "../math";

/**
 * What a diver sees down there, beyond what the sailing view already has
 * (the surface from below is the ocean's own underside, the fish and the
 * sharks are the wildlife's):
 *
 * - a detailed seabed round him: the depth the whole world agrees on
 *   (`waterDepthAt`), with dunes and ripples in the sand, rubble and
 *   patches of weed, blending at its edge into the distant flat bottom;
 * - a reef that grows out of it, decided cell by cell from the position so
 *   it never changes: boulders, brain and staghorn and table corals, sea
 *   fans and barrel sponges, sea grass swaying in the surge, urchins and
 *   starfish on the sand; dense on the island shelves, in scattered
 *   bommies over the open bottom;
 * - shafts of sunlight slanting down from the surface, drifting and
 *   flickering with the waves above;
 * - marine snow drifting in the water column, the scale of the water;
 * - the bubbles of his own breath, wobbling up and growing, and the plunge
 *   of his entry;
 * - a dive torch.
 *
 * Everything below the surface goes through `UnderwaterLight`, so the reef
 * loses its reds with depth and is crossed by caustics like the rest.
 */

/** Side of the detailed seabed, m, and the width of its fade into the distant bottom. */
const SEABED_SIZE = 150;
const SEABED_FADE = 26;
/** The patch follows the diver in steps of this (m), so the sand never swims. */
const SEABED_STEP = 4;
/** Cells the reef is decided in, m, and how far round the diver it is built. */
const REEF_CELL = 3;
const REEF_RADIUS = 62;
/** Most of each kind of prop. */
const PROP_CAPACITY = 1100;
const SHAFTS = 30;
const SNOW = 2600;
const SNOW_BOX = 26;
const BUBBLES = 360;

type PropKind =
  | "rock" | "brain" | "staghorn" | "table" | "fan" | "sponge" | "grass" | "urchin" | "star" | "softcoral"
  | "shell" | "pebbles" | "cucumber" | "dollar" | "rubble";
const PROP_KINDS: readonly PropKind[] = [
  "rock", "brain", "staghorn", "table", "fan", "sponge", "grass", "urchin", "star", "softcoral",
  "shell", "pebbles", "cucumber", "dollar", "rubble",
];
/** The small things strewn over the sand between the reefs. */
const LITTER_KINDS: readonly PropKind[] = ["shell", "pebbles", "cucumber", "dollar", "rubble", "grass"];

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul((y | 0) + salt * 0x9e3779b9, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, 7);
  const b = hash(ix + 1, iy, 7);
  const c = hash(ix, iy + 1, 7);
  const d = hash(ix + 1, iy + 1, 7);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Depth of water at (x, z) given the distance to the shore there: the same
 * expression as `waterDepthAt`, so the diver's bottom is the world's.
 */
export function depthForShore(x: number, z: number, shore: number): number {
  const open = OPEN_WATER_DEPTH + Math.sin(x * 0.006) * 1.7 + Math.cos(z * 0.005) * 1.2;
  const depth = shore < SHELF_WIDTH ? Math.min(open, SHORE_DEPTH + Math.max(0, shore) * SHELF_SLOPE) : open;
  return clamp(depth, 0.35, 24);
}

/** Sand dunes and hollows over the bottom, m (zero on the island shelves). */
export function seabedRelief(x: number, z: number, shore: number): number {
  const open = smoothstep(SHELF_WIDTH * 0.6, SHELF_WIDTH * 1.6, shore);
  const dunes = (valueNoise(x * 0.045, z * 0.045) - 0.5) * 1.6 + (valueNoise(x * 0.13 + 17, z * 0.13 - 4) - 0.5) * 0.5;
  // Hummocks and scours a stride or two across, all over the bottom.
  const hummocks = (valueNoise(x * 0.42 - 3.1, z * 0.42 + 8.3) - 0.5) * 0.22 + (valueNoise(x * 1.1 + 5.7, z * 1.1 - 2.2) - 0.5) * 0.06;
  return dunes * open + hummocks * smoothstep(0, 6, shore);
}

/** The detailed seabed's height at (x, z): the world's depth, with dunes. */
export function seabedHeight(x: number, z: number, shore = distanceFromWaterline(x, z)): number {
  return -depthForShore(x, z, shore) + seabedRelief(x, z, shore);
}

/** How much reef grows at (x, z), 0 bare sand … 1 a crowded reef. */
export function reefDensity(x: number, z: number, shore = distanceFromWaterline(x, z)): number {
  const shelf = 1 - smoothstep(SHELF_WIDTH * 0.5, SHELF_WIDTH * 2.4, shore);
  // Bommies: patches of coral over the open bottom.
  const patch = smoothstep(0.58, 0.82, valueNoise(x * 0.028 + 31, z * 0.028 - 9));
  const notOnBeach = smoothstep(1.2, 3.5, depthForShore(x, z, shore));
  return clamp(Math.max(shelf * 0.85, patch), 0, 1) * notOnBeach;
}

// --- Prop geometry -----------------------------------------------------------

function paintAll(geometry: THREE.BufferGeometry, color: (x: number, y: number, z: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    color(position.getX(index), position.getY(index), position.getZ(index), c);
    colors[index * 3] = c.r;
    colors[index * 3 + 1] = c.g;
    colors[index * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function noise3(x: number, y: number, z: number): number {
  return (valueNoise(x + z * 0.71, y - z * 0.37) + valueNoise(y * 1.3 - x * 0.2, z + 5.1)) * 0.5;
}

function rockGeometry(): THREE.BufferGeometry {
  // Welded, so the boulder is smooth rather than faceted.
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(1, 5).deleteAttribute("normal").deleteAttribute("uv"));
  const position = geometry.getAttribute("position");
  const v = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    v.fromBufferAttribute(position, index);
    const n = noise3(v.x * 1.6, v.y * 1.6, v.z * 1.6) * 0.5 + noise3(v.x * 4, v.y * 4, v.z * 4) * 0.18;
    v.multiplyScalar(0.72 + n);
    v.y = v.y > 0 ? v.y * 0.7 : v.y * 0.35;
    position.setXYZ(index, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return paintAll(geometry, (x, y, z, out) => {
    const n = noise3(x * 6, y * 6, z * 6);
    // Weathered stone, crusted with coralline algae and turf toward the top.
    out.setRGB(0.36 + n * 0.12, 0.33 + n * 0.1, 0.29 + n * 0.08);
    if (y > 0.25 && n > 0.45) out.lerp(new THREE.Color(0.55, 0.27, 0.32), 0.45);
    if (y > 0.4 && n < 0.35) out.lerp(new THREE.Color(0.2, 0.32, 0.12), 0.5);
  });
}

function brainGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 56, 32, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const position = geometry.getAttribute("position");
  const v = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    v.fromBufferAttribute(position, index);
    // The meandering grooves of a brain coral.
    const warp = noise3(v.x * 2.5, v.y * 2.5, v.z * 2.5) * 6;
    const groove = Math.abs(Math.sin((v.x + v.z * 0.6) * 14 + warp));
    const r = 1 - (1 - groove) * 0.045 + (noise3(v.x * 3, v.y * 3, v.z * 3) - 0.5) * 0.12;
    v.multiplyScalar(r);
    v.y = (v.y - 0.35) * 0.95;
    position.setXYZ(index, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return paintAll(geometry, (x, y, z, out) => {
    const warp = noise3(x * 2.5, (y / 0.95 + 0.35) * 2.5, z * 2.5) * 6;
    const groove = Math.abs(Math.sin((x + z * 0.6) * 14 + warp));
    out.setRGB(0.62, 0.55, 0.36).multiplyScalar(0.7 + groove * 0.35);
  });
}

function branch(parts: THREE.BufferGeometry[], from: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number, depth: number, seed: number): void {
  const geometry = new THREE.CylinderGeometry(radius * 0.72, radius, length, 7, 2);
  geometry.translate(0, length / 2, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  geometry.applyQuaternion(quaternion);
  geometry.translate(from.x, from.y, from.z);
  parts.push(geometry);
  const tip = from.clone().addScaledVector(direction.clone().normalize(), length);
  // Rounded growing tip.
  const cap = new THREE.SphereGeometry(radius * 0.74, 7, 5);
  cap.translate(tip.x, tip.y, tip.z);
  parts.push(cap);
  if (depth <= 0) return;
  const children = 2 + Math.floor(hash(seed, depth, 3) * 2);
  for (let index = 0; index < children; index += 1) {
    const spread = 0.45 + hash(seed, index, 5) * 0.4;
    const turn = hash(seed, index, 9) * Math.PI * 2;
    const next = direction.clone().normalize();
    const side = new THREE.Vector3(Math.cos(turn), 0, Math.sin(turn));
    next.addScaledVector(side, spread).normalize();
    next.y = Math.max(next.y, 0.25);
    branch(parts, tip, next, length * (0.7 + hash(seed, index, 11) * 0.2), radius * 0.72, depth - 1, seed * 7 + index + 1);
  }
}

function staghornGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let trunk = 0; trunk < 5; trunk += 1) {
    const angle = (trunk / 5) * Math.PI * 2 + hash(trunk, 1, 1);
    branch(parts, new THREE.Vector3(Math.cos(angle) * 0.1, 0, Math.sin(angle) * 0.1), new THREE.Vector3(Math.cos(angle) * 0.5, 1, Math.sin(angle) * 0.5), 0.32, 0.05, 3, trunk + 11);
  }
  const merged = mergeGeometries(parts.map((part) => part.toNonIndexed()), false)!;
  parts.forEach((part) => part.dispose());
  merged.computeVertexNormals();
  return paintAll(merged, (_x, y, _z, out) => {
    // Pale growing tips over a deeper base.
    out.setRGB(0.78, 0.5, 0.36).lerp(new THREE.Color(0.95, 0.85, 0.72), smoothstep(0.4, 1.3, y));
  });
}

function tableGeometry(): THREE.BufferGeometry {
  const plate = new THREE.CylinderGeometry(1, 0.85, 0.08, 40, 1);
  const position = plate.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const angle = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const wobble = 1 + (valueNoise(Math.cos(angle) * 3 + 5, Math.sin(angle) * 3) - 0.5) * 0.35;
    position.setXYZ(index, x * wobble, position.getY(index) + 0.55 - r * r * 0.05, z * wobble);
  }
  const stem = new THREE.CylinderGeometry(0.1, 0.18, 0.55, 8);
  stem.translate(0, 0.27, 0);
  const merged = mergeGeometries([plate.toNonIndexed(), stem.toNonIndexed()], false)!;
  plate.dispose();
  stem.dispose();
  merged.computeVertexNormals();
  return paintAll(merged, (x, y, z, out) => {
    const r = Math.hypot(x, z);
    out.setRGB(0.42, 0.55, 0.4).lerp(new THREE.Color(0.78, 0.8, 0.6), smoothstep(0.6, 1, r) * (y > 0.5 ? 1 : 0));
  });
}

function fanGeometry(): THREE.BufferGeometry {
  // A flat fan on a short stalk; its lattice is cut by the shader.
  const fan = new THREE.CircleGeometry(1, 40, 0, Math.PI);
  fan.translate(0, 0.08, 0);
  const position = fan.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    position.setZ(index, Math.sin(x * 2.2) * 0.06 + y * y * 0.05);
  }
  fan.computeVertexNormals();
  return paintAll(fan, (_x, y, _z, out) => out.setRGB(0.55, 0.18, 0.5).lerp(new THREE.Color(0.75, 0.35, 0.62), y));
}

function spongeGeometry(): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [];
  for (let step = 0; step <= 12; step += 1) {
    const t = step / 12;
    profile.push(new THREE.Vector2(0.45 + Math.sin(t * Math.PI * 0.8) * 0.35 + t * 0.15, t * 1.1));
  }
  // The inside of the barrel, back down.
  for (let step = 12; step >= 0; step -= 1) {
    const t = step / 12;
    profile.push(new THREE.Vector2(0.37 + Math.sin(t * Math.PI * 0.8) * 0.3 + t * 0.12, Math.max(0.15, t * 1.08)));
  }
  const geometry = new THREE.LatheGeometry(profile, 32);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const angle = Math.atan2(z, x);
    // Vertical ridges round the barrel.
    const ridge = 1 + Math.pow(Math.abs(Math.sin(angle * 8)), 3) * 0.06;
    position.setXYZ(index, x * ridge, position.getY(index), z * ridge);
  }
  geometry.computeVertexNormals();
  return paintAll(geometry, (x, y, z, out) => out.setRGB(0.5, 0.24, 0.17).multiplyScalar(0.75 + noise3(x * 8, y * 8, z * 8) * 0.4));
}

function grassGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let blade = 0; blade < 14; blade += 1) {
    const angle = hash(blade, 2, 1) * Math.PI * 2;
    const r = Math.sqrt(hash(blade, 3, 1)) * 0.28;
    const height = 0.35 + hash(blade, 4, 1) * 0.45;
    const geometry = new THREE.PlaneGeometry(0.03, height, 1, 5);
    geometry.translate(0, height / 2, 0);
    // A gentle lean, set by the blade.
    const position = geometry.getAttribute("position");
    const lean = (hash(blade, 5, 1) - 0.5) * 0.5;
    for (let index = 0; index < position.count; index += 1) {
      const y = position.getY(index);
      position.setZ(index, lean * y * y);
    }
    geometry.rotateY(hash(blade, 6, 1) * Math.PI);
    geometry.translate(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    parts.push(geometry);
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((part) => part.dispose());
  merged.computeVertexNormals();
  return paintAll(merged, (_x, y, _z, out) => out.setRGB(0.16, 0.32, 0.1).lerp(new THREE.Color(0.42, 0.55, 0.2), smoothstep(0, 0.7, y)));
}

function urchinGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.SphereGeometry(0.06, 10, 8)];
  const directions = new THREE.IcosahedronGeometry(1, 2).getAttribute("position");
  const seen = new Set<string>();
  const up = new THREE.Vector3(0, 1, 0);
  for (let index = 0; index < directions.count; index += 1) {
    const d = new THREE.Vector3().fromBufferAttribute(directions, index).normalize();
    const key = `${d.x.toFixed(2)},${d.y.toFixed(2)},${d.z.toFixed(2)}`;
    if (seen.has(key) || d.y < -0.3) continue;
    seen.add(key);
    const spine = new THREE.ConeGeometry(0.006, 0.2, 4);
    spine.translate(0, 0.1, 0);
    spine.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
    parts.push(spine);
  }
  const merged = mergeGeometries(parts.map((part) => part.toNonIndexed()), false)!;
  parts.forEach((part) => part.dispose());
  merged.computeVertexNormals();
  merged.translate(0, 0.04, 0);
  return paintAll(merged, (_x, _y, _z, out) => out.setRGB(0.06, 0.04, 0.08));
}

function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let step = 0; step <= 10; step += 1) {
    const angle = (step / 10) * Math.PI * 2 + Math.PI / 2;
    const r = step % 2 === 0 ? 0.16 : 0.055;
    if (step === 0) shape.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    else shape.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return paintAll(geometry, (x, _y, z, out) => out.setRGB(0.85, 0.36, 0.12).multiplyScalar(0.8 + noise3(x * 60, z * 60, 1) * 0.35));
}

function softCoralGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let finger = 0; finger < 18; finger += 1) {
    const angle = hash(finger, 1, 4) * Math.PI * 2;
    const r = Math.sqrt(hash(finger, 2, 4)) * 0.2;
    const height = 0.18 + hash(finger, 3, 4) * 0.28;
    const geometry = new THREE.CapsuleGeometry(0.035, height, 3, 7);
    geometry.translate(0, height / 2 + 0.03, 0);
    geometry.rotateZ((hash(finger, 4, 4) - 0.5) * 0.7);
    geometry.rotateX((hash(finger, 5, 4) - 0.5) * 0.7);
    geometry.translate(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    parts.push(geometry);
  }
  const merged = mergeGeometries(parts.map((part) => part.toNonIndexed()), false)!;
  parts.forEach((part) => part.dispose());
  merged.computeVertexNormals();
  return paintAll(merged, (_x, y, _z, out) => out.setRGB(0.62, 0.34, 0.55).lerp(new THREE.Color(0.85, 0.65, 0.78), smoothstep(0.1, 0.4, y)));
}

function shellGeometry(): THREE.BufferGeometry {
  // A cockle: a low dome with ribs running out from the hinge.
  const geometry = new THREE.SphereGeometry(0.06, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const angle = Math.atan2(z, x);
    const rib = 1 + Math.pow(Math.abs(Math.cos(angle * 9)), 4) * 0.07;
    // Squashed to a fan shape, the hinge at −Z.
    position.setXYZ(index, x * rib * (1 - z * 3), position.getY(index) * 0.42, z * rib * 0.85);
  }
  geometry.computeVertexNormals();
  return paintAll(geometry, (x, y, z, out) => {
    const band = 0.5 + 0.5 * Math.sin(Math.hypot(x, z) * 170);
    out.setRGB(0.93, 0.84, 0.74).lerp(new THREE.Color(0.8, 0.55, 0.45), band * 0.35 + (y < 0.004 ? 0.2 : 0));
  });
}

function pebblesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let stone = 0; stone < 7; stone += 1) {
    const r = 0.025 + hash(stone, 1, 21) * 0.05;
    const geometry = new THREE.IcosahedronGeometry(r, 1);
    geometry.scale(1 + hash(stone, 2, 21) * 0.5, 0.45 + hash(stone, 3, 21) * 0.25, 1);
    geometry.rotateY(hash(stone, 4, 21) * Math.PI);
    const angle = hash(stone, 5, 21) * Math.PI * 2;
    const spread = Math.sqrt(hash(stone, 6, 21)) * 0.22;
    geometry.translate(Math.cos(angle) * spread, r * 0.2, Math.sin(angle) * spread);
    const tone = 0.32 + hash(stone, 7, 21) * 0.35;
    const warm = hash(stone, 8, 21) * 0.08;
    paintAll(geometry, (_x, _y, _z, out) => out.setRGB(tone + warm, tone, tone - warm * 0.5));
    parts.push(geometry.toNonIndexed());
    geometry.dispose();
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((part) => part.dispose());
  merged.computeVertexNormals();
  return merged;
}

function cucumberGeometry(): THREE.BufferGeometry {
  // A sea cucumber lying on the sand: a soft, warty sausage, a little bent.
  const geometry = new THREE.CapsuleGeometry(0.045, 0.24, 6, 12);
  geometry.rotateZ(Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const wart = noise3(x * 60, y * 60, z * 60) * 0.012;
    const scale = 1 + wart / 0.045;
    position.setXYZ(index, x, y * scale * 0.8 + 0.035, z * scale + x * x * 1.2);
  }
  geometry.computeVertexNormals();
  return paintAll(geometry, (x, y, z, out) => {
    const spot = noise3(x * 70, y * 70, z * 70);
    out.setRGB(0.22, 0.15, 0.1).lerp(new THREE.Color(0.55, 0.42, 0.28), spot > 0.62 ? 0.7 : 0);
  });
}

function dollarGeometry(): THREE.BufferGeometry {
  // A sand dollar: a flat disc with its five-petal flower.
  const geometry = new THREE.CylinderGeometry(0.045, 0.048, 0.008, 28, 1);
  geometry.translate(0, 0.004, 0);
  return paintAll(geometry, (x, y, z, out) => {
    const angle = Math.atan2(z, x);
    const r = Math.hypot(x, z) / 0.045;
    const petal = Math.abs(Math.cos(angle * 2.5)) > 0.72 && r > 0.2 && r < 0.75 && y > 0.007;
    out.setRGB(0.86, 0.82, 0.72).multiplyScalar(petal ? 0.78 : 1);
  });
}

function rubbleGeometry(): THREE.BufferGeometry {
  // Broken coral: bleached branch pieces and a crumb or two.
  const parts: THREE.BufferGeometry[] = [];
  for (let piece = 0; piece < 6; piece += 1) {
    const length = 0.08 + hash(piece, 1, 33) * 0.16;
    const geometry = new THREE.CylinderGeometry(0.012, 0.018, length, 6, 1);
    geometry.rotateZ(Math.PI / 2 + (hash(piece, 2, 33) - 0.5) * 0.4);
    geometry.rotateY(hash(piece, 3, 33) * Math.PI);
    const angle = hash(piece, 4, 33) * Math.PI * 2;
    const spread = Math.sqrt(hash(piece, 5, 33)) * 0.28;
    geometry.translate(Math.cos(angle) * spread, 0.014, Math.sin(angle) * spread);
    parts.push(geometry.toNonIndexed());
    geometry.dispose();
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((part) => part.dispose());
  merged.computeVertexNormals();
  return paintAll(merged, (x, y, z, out) => out.setRGB(0.88, 0.85, 0.78).multiplyScalar(0.82 + noise3(x * 40, y * 40, z * 40) * 0.25));
}

const GEOMETRY_BUILDERS: Record<PropKind, () => THREE.BufferGeometry> = {
  rock: rockGeometry,
  brain: brainGeometry,
  staghorn: staghornGeometry,
  table: tableGeometry,
  fan: fanGeometry,
  sponge: spongeGeometry,
  grass: grassGeometry,
  urchin: urchinGeometry,
  star: starGeometry,
  softcoral: softCoralGeometry,
  shell: shellGeometry,
  pebbles: pebblesGeometry,
  cucumber: cucumberGeometry,
  dollar: dollarGeometry,
  rubble: rubbleGeometry,
};

/** Colours an instance of each kind may take (multiplied into its vertex colours). */
const PALETTES: Record<PropKind, readonly number[]> = {
  rock: [0xffffff, 0xe8e2d8, 0xd8d0c4],
  brain: [0xffffff, 0xc8d8a8, 0xe2b8d8, 0xd0c090],
  staghorn: [0xffffff, 0xf6c0a8, 0xe0e8a0, 0xd0a0e8, 0xa8d8f0],
  table: [0xffffff, 0xd8e8c0, 0xc0d8e0],
  fan: [0xffffff, 0xff9070, 0xe8d060, 0xc080ff],
  sponge: [0xffffff, 0xe0a070, 0xc080c0],
  grass: [0xffffff, 0xe0f0c0],
  urchin: [0xffffff],
  star: [0xffffff, 0xff7080, 0x70a0ff],
  softcoral: [0xffffff, 0xffc0a0, 0xa0d0ff, 0xffe0a0],
  shell: [0xffffff, 0xffe0d0, 0xf0d8b0, 0xe8c8d8],
  pebbles: [0xffffff, 0xe8e0d4, 0xd0d4d8],
  cucumber: [0xffffff, 0xc09080, 0x806050],
  dollar: [0xffffff, 0xf0e8d8],
  rubble: [0xffffff, 0xf4ece0, 0xe8e0e8],
};

type PropLayer = { kind: PropKind; mesh: THREE.InstancedMesh; count: number };

const scratchMatrix = new THREE.Matrix4();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const scratchColor = new THREE.Color();

// --- Shaders -------------------------------------------------------------------

const shaftVertex = /* glsl */ `
  attribute vec4 aShaft;
  attribute float aPhase;
  uniform vec3 uAxis;
  uniform float uTime;
  uniform float uSurface;
  varying vec2 vUv;
  varying float vFade;
  varying float vPhase;
  void main() {
    vec3 top = vec3(aShaft.x, uSurface, aShaft.y);
    vec3 axis = normalize(uAxis);
    vec3 toCamera = cameraPosition - top;
    vec3 across = normalize(cross(axis, toCamera));
    float drift = sin(uTime * 0.21 + aPhase * 6.3) * 0.8;
    vec3 point = top + across * (position.x * aShaft.z + drift) + axis * (-position.y * aShaft.w);
    vUv = vec2(position.x + 0.5, -position.y);
    vPhase = aPhase;
    // Shafts very near the eye are faded out, so the camera never sits inside a slab of light.
    float distance = length(cameraPosition - point);
    vFade = smoothstep(1.5, 6.0, distance) * exp(-distance * 0.028);
    gl_Position = projectionMatrix * viewMatrix * vec4(point, 1.0);
  }
`;

const shaftFragment = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vFade;
  varying float vPhase;
  void main() {
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    across = pow(across * across * (3.0 - 2.0 * across), 1.6);
    // Streaks within the shaft, flickering as the waves above focus and scatter it.
    float streaks = 0.78 + 0.22 * sin(vUv.x * 7.0 + vPhase * 9.0 + sin(uTime * 0.7 + vPhase * 4.0) * 2.0);
    float flicker = 0.7 + 0.3 * sin(uTime * (1.3 + vPhase) + vPhase * 11.0);
    float along = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.06, vUv.y);
    float light = across * streaks * flicker * along * vFade * uStrength;
    gl_FragColor = vec4(uColor * light, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const snowVertex = /* glsl */ `
  uniform vec3 uCentre;
  uniform float uTime;
  uniform float uSize;
  attribute float aSeed;
  varying float vFade;
  void main() {
    vec3 drift = vec3(sin(uTime * 0.11 + aSeed * 40.0) * 0.4, -uTime * 0.025 * (0.5 + aSeed), cos(uTime * 0.09 + aSeed * 30.0) * 0.4);
    vec3 p = mod(position + drift - uCentre + ${(SNOW_BOX / 2).toFixed(1)}, ${SNOW_BOX.toFixed(1)}) - ${(SNOW_BOX / 2).toFixed(1)} + uCentre;
    vec4 view = viewMatrix * vec4(p, 1.0);
    float distance = -view.z;
    vFade = smoothstep(0.2, 1.2, distance) * (1.0 - smoothstep(${(SNOW_BOX * 0.25).toFixed(1)}, ${(SNOW_BOX * 0.5).toFixed(1)}, distance));
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(uSize * (0.6 + aSeed) / max(distance, 0.1), 1.0, 6.0);
  }
`;

const snowFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float dot2 = 1.0 - smoothstep(0.15, 0.5, length(c));
    gl_FragColor = vec4(uColor * dot2 * vFade, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const bubbleVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const bubbleFragment = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uWater;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float facing = abs(dot(n, v));
    // A bubble is a mirror from inside the water: bright at its rim (total
    // reflection), clear in the middle, with the light above caught in it.
    float rim = pow(1.0 - facing, 2.2);
    float spot = pow(max(dot(reflect(-v, n), vec3(0.0, 1.0, 0.0)), 0.0), 24.0);
    vec3 color = uWater * 1.6 * rim + uLight * (rim * 0.35 + spot * 1.4);
    // Bubbles brushing past the mask fade out rather than fill the view.
    color *= smoothstep(0.25, 0.7, length(vView));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Bubble = { x: number; y: number; z: number; vx: number; vz: number; size: number; age: number; life: number; phase: number };

export class UnderwaterWorld {
  readonly group = new THREE.Group();
  private readonly seabed: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private seabedX = Number.NaN;
  private seabedZ = Number.NaN;
  private readonly props: PropLayer[] = [];
  private reefX = Number.NaN;
  private reefZ = Number.NaN;
  private readonly shafts: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly shaftData: Float32Array;
  private readonly shaftAttribute: THREE.InstancedBufferAttribute;
  private readonly snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly bubbles: THREE.InstancedMesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly bubbleList: Bubble[] = [];
  readonly torch: THREE.SpotLight;
  private readonly swayTime = { value: 0 };
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly underwater: UnderwaterLight,
    detail: number,
  ) {
    this.group.name = "Underwater_World";
    scene.add(this.group);

    // --- Seabed ------------------------------------------------------------
    const segments = Math.round(96 + 96 * clamp(detail, 0, 1));
    const geometry = new THREE.PlaneGeometry(SEABED_SIZE, SEABED_SIZE, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const seabedMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    this.sandSurface(seabedMaterial);
    underwater.apply(seabedMaterial);
    this.seabed = new THREE.Mesh(geometry, seabedMaterial);
    this.seabed.name = "DiveSeabed";
    this.seabed.frustumCulled = false;
    this.seabed.receiveShadow = false;
    this.group.add(this.seabed);

    // --- Reef props --------------------------------------------------------
    for (const kind of PROP_KINDS) {
      const geometry = GEOMETRY_BUILDERS[kind]();
      geometry.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: kind === "brain" || kind === "rock" || kind === "pebbles" || kind === "rubble" ? 0.9 : kind === "shell" ? 0.45 : 0.7,
        metalness: 0,
        side: kind === "fan" || kind === "grass" || kind === "sponge" ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (kind === "grass" || kind === "fan" || kind === "softcoral") this.sway(material, kind === "grass" ? 0.12 : kind === "fan" ? 0.05 : 0.04);
      if (kind === "fan") this.lattice(material);
      underwater.apply(material);
      const mesh = new THREE.InstancedMesh(geometry, material, PROP_CAPACITY);
      mesh.name = `Reef_${kind}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(mesh);
      this.props.push({ kind, mesh, count: 0 });
    }

    // --- Light shafts ------------------------------------------------------
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, -1, 0, -0.5, -1, 0], 3));
    quad.setIndex([0, 2, 1, 0, 3, 2]);
    this.shaftData = new Float32Array(SHAFTS * 4);
    this.shaftAttribute = new THREE.InstancedBufferAttribute(this.shaftData, 4).setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute("aShaft", this.shaftAttribute);
    const phases = new Float32Array(SHAFTS);
    for (let index = 0; index < SHAFTS; index += 1) phases[index] = hash(index, 77, 3);
    quad.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    quad.instanceCount = SHAFTS;
    this.shafts = new THREE.Mesh(
      quad,
      new THREE.ShaderMaterial({
        name: "LightShafts",
        vertexShader: shaftVertex,
        fragmentShader: shaftFragment,
        uniforms: {
          uAxis: { value: new THREE.Vector3(0, -1, 0) },
          uTime: { value: 0 },
          uSurface: { value: 0 },
          uStrength: { value: 0 },
          uColor: { value: new THREE.Color(0.5, 0.8, 0.85) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 6;
    this.shafts.name = "LightShafts";
    this.group.add(this.shafts);

    // --- Marine snow ---------------------------------------------------------
    const snowGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(SNOW * 3);
    const seeds = new Float32Array(SNOW);
    for (let index = 0; index < SNOW; index += 1) {
      positions[index * 3] = (hash(index, 1, 9) - 0.5) * SNOW_BOX;
      positions[index * 3 + 1] = (hash(index, 2, 9) - 0.5) * SNOW_BOX;
      positions[index * 3 + 2] = (hash(index, 3, 9) - 0.5) * SNOW_BOX;
      seeds[index] = hash(index, 4, 9);
    }
    snowGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    snowGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    this.snow = new THREE.Points(
      snowGeometry,
      new THREE.ShaderMaterial({
        name: "MarineSnow",
        vertexShader: snowVertex,
        fragmentShader: snowFragment,
        uniforms: { uCentre: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSize: { value: 3.5 }, uColor: { value: new THREE.Color(0.2, 0.3, 0.3) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 6;
    this.snow.name = "MarineSnow";
    this.group.add(this.snow);

    // --- Bubbles -------------------------------------------------------------
    this.bubbles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.ShaderMaterial({
        name: "Bubbles",
        vertexShader: bubbleVertex,
        fragmentShader: bubbleFragment,
        uniforms: { uLight: { value: new THREE.Color(1, 1, 1) }, uWater: { value: new THREE.Color(0.05, 0.2, 0.25) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      BUBBLES,
    );
    this.bubbles.count = 0;
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 7;
    this.bubbles.name = "Bubbles";
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.bubbles);

    // --- Dive torch: always in the scene (lights never come and go, see AGENTS) ---
    this.torch = new THREE.SpotLight(0xfff2dc, 0, 32, 0.42, 0.55, 1.4);
    this.torch.name = "DiveTorch";
    this.torch.castShadow = false;
    scene.add(this.torch);
    scene.add(this.torch.target);

    this.group.visible = false;
  }

  /** Sand: ripples, rubble and weed, as relief and colour in the shader. */
  private sandSurface(material: THREE.MeshStandardMaterial): void {
    patchMaterialShader(material, "dive-sand-v2", (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSandWorld;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvSandWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vSandWorld;
          float sandHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float sandNoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(sandHash(i), sandHash(i + vec2(1, 0)), f.x), mix(sandHash(i + vec2(0, 1)), sandHash(i + vec2(1, 1)), f.x), f.y);
          }
          // Wave ripples in the sand: long sinuous crests whose heading wanders
          // from patch to patch, sharp-crested and round-troughed like real
          // ones, with a finer set crossing them in the shallows.
          float sandRipples(vec2 p) {
            float heading = (sandNoise(p * 0.045 + 3.0) - 0.5) * 1.4;
            vec2 across = vec2(cos(0.6 + heading), sin(0.6 + heading));
            float warp = sandNoise(p * 0.35) * 3.0 + sandNoise(p * 1.1) * 0.6;
            float wave = 0.5 + 0.5 * sin(dot(p, across) * 5.8 + warp * 2.2);
            float crest = 1.0 - pow(1.0 - wave, 1.8);
            float fine = 0.5 + 0.5 * sin(dot(p, vec2(-across.y, across.x)) * 13.0 + sandNoise(p * 2.3) * 4.0);
            float fineAmount = sandNoise(p * 0.12 - 9.0);
            return crest * 2.0 - 1.0 + (fine - 0.5) * 0.2 * fineAmount;
          }
          // Sparse round things a few centimetres across on a cell grid:
          // returns the distance to the nearest one (cell units) and its seed.
          vec2 sandDots(vec2 p, float cell, float chance) {
            vec2 c = floor(p / cell);
            vec2 best = vec2(9.0, 0.0);
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 k = c + vec2(float(i), float(j));
              float h = sandHash(k * 1.37 + 0.5);
              if (h > chance) continue;
              vec2 centre = (k + vec2(sandHash(k + 7.1), sandHash(k - 3.3))) * cell;
              float d = length(p - centre) / cell;
              if (d < best.x) best = vec2(d, h / chance);
            }
            return best;
          }`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          {
            vec2 p = vSandWorld.xz;
            // Metres one pixel covers here: detail finer than that fades to
            // its average instead of shimmering into moiré rings.
            float footprint = length(fwidth(p));
            float fineDetail = 1.0 - smoothstep(0.012, 0.035, footprint);
            float rippleDetail = 1.0 - smoothstep(0.09, 0.3, footprint);
            float grain = mix(0.5, sandNoise(p * 40.0), fineDetail) * 0.5 + sandNoise(p * 9.0) * 0.5;
            float speckle = mix(0.5, sandHash(floor(p * 160.0)), fineDetail * 0.6);
            float ripple = sandRipples(p) * rippleDetail;
            // Coral sand: pale, with broad drifts of lighter and darker sand
            // and a faint pink of crushed shell here and there.
            float drift = sandNoise(p * 0.07 + 41.0);
            vec3 sand = mix(vec3(0.8, 0.74, 0.6), vec3(0.92, 0.87, 0.74), drift);
            sand = mix(sand, vec3(0.9, 0.78, 0.72), smoothstep(0.62, 0.85, sandNoise(p * 0.21 - 17.0)) * 0.35);
            sand *= 0.84 + grain * 0.2 + (speckle - 0.5) * 0.12;
            // The crests are scoured clean and bright; fine dark detritus
            // settles in the troughs.
            sand *= mix(0.9, 1.04, ripple * 0.5 + 0.5);
            // Rubble, dark grains and bits of shell.
            float rubble = smoothstep(0.62, 0.8, sandNoise(p * 0.6 + 13.0)) * smoothstep(0.45, 0.6, sandNoise(p * 5.0));
            sand = mix(sand, vec3(0.5, 0.46, 0.4) * (0.8 + grain * 0.4), rubble * 0.7);
            vec2 grit = sandDots(p, 0.07, 0.16);
            float dotDetail = 1.0 - smoothstep(0.02, 0.05, footprint);
            sand = mix(sand, vec3(0.3, 0.29, 0.27), (1.0 - smoothstep(0.12, 0.2, grit.x)) * 0.65 * dotDetail);
            vec2 shell = sandDots(p + 3.7, 0.11, 0.12);
            sand = mix(sand, mix(vec3(1.0, 0.95, 0.88), vec3(0.95, 0.72, 0.68), step(0.6, shell.y)), (1.0 - smoothstep(0.1, 0.17, shell.x)) * 0.8 * dotDetail);
            // Burrows: a small dark hole in a pale ring of thrown-up sand.
            vec2 burrow = sandDots(p - 11.0, 0.9, 0.06);
            float burrowDetail = 1.0 - smoothstep(0.06, 0.15, footprint);
            float ring = smoothstep(0.08, 0.06, abs(burrow.x - 0.1));
            sand = mix(sand, sand * 1.12, ring * 0.6 * burrowDetail);
            sand = mix(sand, vec3(0.12, 0.1, 0.08), smoothstep(0.045, 0.025, burrow.x) * burrowDetail);
            // Patches of turf and sea grass, thickest in the meadows.
            float meadow = smoothstep(0.5, 0.8, sandNoise(p * 0.05 - vec2(11.0, -23.0)));
            float weed = max(smoothstep(0.66, 0.84, sandNoise(p * 0.18 - 7.0)) * smoothstep(0.35, 0.65, sandNoise(p * 3.0 + 2.0)), meadow * smoothstep(0.3, 0.6, sandNoise(p * 1.7 + 4.0)));
            float blades = 1.0 + (0.5 * sandNoise(vec2(p.x * 22.0, p.y * 3.0) + sandNoise(p * 4.0) * 3.0) - 0.25) * fineDetail;
            sand = mix(sand, vec3(0.22, 0.32, 0.13) * blades * (0.8 + grain * 0.3), weed * 0.7);
            diffuseColor.rgb *= sand;
          }`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          {
            vec2 p = vSandWorld.xz;
            vec2 burrow = sandDots(p - 11.0, 0.9, 0.06);
            float mound = smoothstep(0.2, 0.08, burrow.x) * 0.012 - smoothstep(0.05, 0.02, burrow.x) * 0.02;
            float h = sandRipples(p) * 0.016 + sandNoise(p * 30.0) * 0.0025 + sandNoise(p * 7.0) * 0.004 + mound;
            float footprint = length(fwidth(p));
            vec3 dPdx = dFdx(-vViewPosition);
            vec3 dPdy = dFdy(-vViewPosition);
            vec3 R1 = cross(dPdy, normal);
            vec3 R2 = cross(normal, dPdx);
            float fDet = dot(dPdx, R1);
            vec3 grad = sign(fDet) * (dFdx(h) * R1 + dFdy(h) * R2);
            // Relief finer than a pixel is let go rather than shimmering.
            normal = normalize(abs(fDet) * normal - grad * 1.05 * (1.0 - smoothstep(0.03, 0.12, footprint)));
          }`,
        );
    });
  }

  /** Grass and fans lean and sway in the surge. */
  private sway(material: THREE.MeshStandardMaterial, amount: number): void {
    const time = this.swayTime;
    patchMaterialShader(material, `dive-sway-${amount}`, (shader) => {
      shader.uniforms.uSwayTime = time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uSwayTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          {
            #ifdef USE_INSTANCING
              vec2 root = instanceMatrix[3].xz;
            #else
              vec2 root = vec2(0.0);
            #endif
            float phase = dot(root, vec2(0.37, 0.23));
            float surge = sin(uSwayTime * 0.9 + phase) + sin(uSwayTime * 1.7 + phase * 1.3) * 0.35;
            float h = max(position.y, 0.0);
            transformed.x += surge * h * h * ${amount.toFixed(3)} * 4.0;
            transformed.z += cos(uSwayTime * 0.7 + phase) * h * h * ${amount.toFixed(3)} * 2.0;
          }`,
        );
    });
  }

  /** A sea fan's lattice: the solid fan is cut into a net of branching veins. */
  private lattice(material: THREE.MeshStandardMaterial): void {
    patchMaterialShader(material, "dive-fan-v1", (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vFan;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFan = position.xy;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vFan;")
        .replace(
          "#include <clipping_planes_fragment>",
          `#include <clipping_planes_fragment>
          {
            float r = length(vFan);
            float a = atan(vFan.x, vFan.y);
            float rays = abs(sin(a * 22.0 + sin(r * 9.0) * 0.6));
            float rings = abs(sin(r * 34.0 + a * 3.0));
            float vein = min(rays, rings);
            if (vein > 0.22 + (1.0 - r) * 0.12) discard;
          }`,
        );
    });
  }

  /** Plunge or breath: `count` bubbles of up to `size` m at `position`. */
  emitBubbles(position: THREE.Vector3, count: number, size: number, spread = 0.08): void {
    for (let index = 0; index < count; index += 1) {
      if (this.bubbleList.length >= BUBBLES) this.bubbleList.shift();
      const r = Math.random();
      this.bubbleList.push({
        x: position.x + (Math.random() - 0.5) * spread,
        y: position.y + (Math.random() - 0.5) * spread,
        z: position.z + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 0.25,
        vz: (Math.random() - 0.5) * 0.25,
        size: size * (0.15 + r * r * 0.85),
        age: -Math.random() * 0.25,
        life: 12,
        phase: Math.random() * 10,
      });
    }
  }

  /**
   * One frame. `centre` is the diver's eyes; `amount` how far under the
   * water the camera is (0 above … 1 under); `surface(x, z)` the water's
   * height; `sunDown` the direction sunlight travels once in the water.
   */
  update(
    delta: number,
    centre: THREE.Vector3,
    camera: THREE.Camera,
    active: boolean,
    amount: number,
    surface: (x: number, z: number) => number,
    sunDown: THREE.Vector3,
    daylight: number,
    light: THREE.Color,
    water: THREE.Color,
    torchOn: boolean,
  ): void {
    this.time += delta;
    this.swayTime.value = this.time;
    this.group.visible = active;
    if (!active) {
      this.torch.intensity = 0;
      this.bubbleList.length = 0;
      return;
    }
    this.placeSeabed(centre.x, centre.z);
    this.placeReef(centre.x, centre.z);

    // Shafts: a ring of them round the diver, renewed as he moves on.
    const shaftMaterial = this.shafts.material;
    const surfaceHere = surface(centre.x, centre.z);
    shaftMaterial.uniforms.uTime!.value = this.time;
    shaftMaterial.uniforms.uSurface!.value = surfaceHere - 0.15;
    (shaftMaterial.uniforms.uAxis!.value as THREE.Vector3).copy(sunDown);
    shaftMaterial.uniforms.uStrength!.value = amount * daylight * 0.14 * smoothstep(-2, 6, centre.y + 30);
    (shaftMaterial.uniforms.uColor!.value as THREE.Color).copy(light).multiply(water).multiplyScalar(14);
    for (let index = 0; index < SHAFTS; index += 1) {
      const o = index * 4;
      const dx = this.shaftData[o]! - centre.x;
      const dz = this.shaftData[o + 1]! - centre.z;
      if (this.shaftData[o + 3] === 0 || dx * dx + dz * dz > 38 * 38) {
        const angle = Math.random() * Math.PI * 2;
        const r = 4 + Math.sqrt(Math.random()) * 30;
        this.shaftData[o] = centre.x + Math.cos(angle) * r;
        this.shaftData[o + 1] = centre.z + Math.sin(angle) * r;
        this.shaftData[o + 2] = 1.2 + Math.random() * 3.4;
        this.shaftData[o + 3] = 14 + Math.random() * 22;
      }
    }
    this.shaftAttribute.needsUpdate = true;

    // Marine snow round the eyes, lit by the day (and the torch).
    const snowMaterial = this.snow.material;
    (snowMaterial.uniforms.uCentre!.value as THREE.Vector3).copy(centre);
    snowMaterial.uniforms.uTime!.value = this.time;
    (snowMaterial.uniforms.uColor!.value as THREE.Color).copy(water).multiplyScalar((0.9 + daylight * 2.2 + (torchOn ? 1.5 : 0)) * amount);

    // Bubbles: up, wobbling, growing as the pressure falls; burst at the top.
    const bubbleMaterial = this.bubbles.material;
    (bubbleMaterial.uniforms.uLight!.value as THREE.Color).copy(light).multiplyScalar(0.5 + daylight);
    (bubbleMaterial.uniforms.uWater!.value as THREE.Color).copy(water);
    let count = 0;
    for (let index = this.bubbleList.length - 1; index >= 0; index -= 1) {
      const bubble = this.bubbleList[index]!;
      bubble.age += delta;
      if (bubble.age < 0) continue;
      const rise = 0.25 + Math.sqrt(bubble.size) * 3.2;
      bubble.y += rise * delta;
      bubble.x += (bubble.vx + Math.sin(bubble.age * 9 + bubble.phase) * 0.12) * delta;
      bubble.z += (bubble.vz + Math.cos(bubble.age * 8 + bubble.phase) * 0.12) * delta;
      bubble.vx *= Math.exp(-delta * 1.5);
      bubble.vz *= Math.exp(-delta * 1.5);
      const top = surface(bubble.x, bubble.z);
      if (bubble.y > top - bubble.size || bubble.age > bubble.life) {
        this.bubbleList.splice(index, 1);
        continue;
      }
      const depth = top - bubble.y;
      const grown = bubble.size * Math.cbrt(1.5 / (1 + depth / 10));
      const wobble = 1 + Math.sin(bubble.age * 20 + bubble.phase) * 0.12;
      scratchPosition.set(bubble.x, bubble.y, bubble.z);
      scratchScale.set(grown * wobble, grown * (0.75 / wobble), grown * wobble);
      scratchMatrix.compose(scratchPosition, scratchQuaternion.identity(), scratchScale);
      this.bubbles.setMatrixAt(count, scratchMatrix);
      count += 1;
    }
    this.bubbles.count = count;
    this.bubbles.instanceMatrix.needsUpdate = true;

    // The torch: from the right shoulder, along the view.
    const forward = scratchPosition.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.torch.position.copy(camera.position).add(new THREE.Vector3(0.18, -0.15, 0).applyQuaternion(camera.quaternion));
    this.torch.target.position.copy(camera.position).addScaledVector(forward, 10);
    this.torch.target.updateMatrixWorld();
    this.torch.intensity += ((torchOn ? 55 : 0) - this.torch.intensity) * (1 - Math.exp(-delta * 12));
  }

  private placeSeabed(x: number, z: number): void {
    const sx = Math.round(x / SEABED_STEP) * SEABED_STEP;
    const sz = Math.round(z / SEABED_STEP) * SEABED_STEP;
    if (sx === this.seabedX && sz === this.seabedZ) return;
    this.seabedX = sx;
    this.seabedZ = sz;
    const geometry = this.seabed.geometry;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const half = SEABED_SIZE / 2;
    const columns = Math.round(Math.sqrt(position.count));
    // The distance to the shore is smooth: read it on a coarse grid and
    // interpolate (it is the costly part).
    const coarse = 4;
    const coarseColumns = Math.ceil((columns - 1) / coarse) + 1;
    const shoreGrid = new Float32Array(coarseColumns * coarseColumns);
    for (let row = 0; row < coarseColumns; row += 1) {
      for (let column = 0; column < coarseColumns; column += 1) {
        const lx = -half + (Math.min(columns - 1, column * coarse) / (columns - 1)) * SEABED_SIZE;
        const lz = -half + (Math.min(columns - 1, row * coarse) / (columns - 1)) * SEABED_SIZE;
        shoreGrid[row * coarseColumns + column] = distanceFromWaterline(sx + lx, sz + lz);
      }
    }
    for (let index = 0; index < position.count; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const localX = -half + (column / (columns - 1)) * SEABED_SIZE;
      const localZ = -half + (row / (columns - 1)) * SEABED_SIZE;
      const wx = sx + localX;
      const wz = sz + localZ;
      const gx = Math.min(coarseColumns - 1.001, column / coarse);
      const gz = Math.min(coarseColumns - 1.001, row / coarse);
      const ix = Math.floor(gx);
      const iz = Math.floor(gz);
      const fx = gx - ix;
      const fz = gz - iz;
      const s00 = shoreGrid[iz * coarseColumns + ix]!;
      const s10 = shoreGrid[iz * coarseColumns + ix + 1]!;
      const s01 = shoreGrid[(iz + 1) * coarseColumns + ix]!;
      const s11 = shoreGrid[(iz + 1) * coarseColumns + ix + 1]!;
      const shore = (s00 * (1 - fx) + s10 * fx) * (1 - fz) + (s01 * (1 - fx) + s11 * fx) * fz;
      // Toward the edge the detail settles onto the distant flat bottom.
      const edge = Math.max(Math.abs(localX), Math.abs(localZ));
      const blend = smoothstep(half - SEABED_FADE, half - 1, edge);
      // On the island shelves the island's own apron is the bottom: this lies
      // just under it, so the apron wins where both are.
      const under = 1 - smoothstep(SHELF_WIDTH * 0.6, SHELF_WIDTH * 1.1, shore);
      const height = seabedHeight(wx, wz, shore) - under * 0.3;
      position.setXYZ(index, localX, height * (1 - blend) + (-OPEN_WATER_DEPTH - 0.5) * blend, localZ);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    this.seabed.position.set(sx, 0, sz);
  }

  private placeReef(x: number, z: number): void {
    if (Math.hypot(x - this.reefX, z - this.reefZ) < REEF_CELL * 1.5) return;
    this.reefX = x;
    this.reefZ = z;
    for (const layer of this.props) layer.count = 0;
    const byKind = new Map(this.props.map((layer) => [layer.kind, layer]));
    const c0x = Math.floor((x - REEF_RADIUS) / REEF_CELL);
    const c1x = Math.floor((x + REEF_RADIUS) / REEF_CELL);
    const c0z = Math.floor((z - REEF_RADIUS) / REEF_CELL);
    const c1z = Math.floor((z + REEF_RADIUS) / REEF_CELL);
    for (let cz = c0z; cz <= c1z; cz += 1) {
      for (let cx = c0x; cx <= c1x; cx += 1) {
        const px = (cx + hash(cx, cz, 1)) * REEF_CELL;
        const pz = (cz + hash(cx, cz, 2)) * REEF_CELL;
        const dx = px - x;
        const dz = pz - z;
        if (dx * dx + dz * dz > REEF_RADIUS * REEF_RADIUS) continue;
        const shore = distanceFromWaterline(px, pz);
        const depth = depthForShore(px, pz, shore);
        if (depth < 1.1) continue;
        const reef = reefDensity(px, pz, shore);
        const roll = hash(cx, cz, 3);
        // Bare sand gets the odd urchin, star, grass tuft or rock.
        const chance = 0.1 + reef * 0.95;
        for (let item = 0; item < 3; item += 1) {
          const r = hash(cx * 3 + item, cz, 4);
          if (r > chance - item * 0.3) continue;
          const kind = this.pickKind(reef, depth, hash(cx, cz * 5 + item, 6), roll);
          const layer = byKind.get(kind)!;
          if (layer.count >= PROP_CAPACITY) continue;
          const ox = item === 0 ? px : px + (hash(cx, cz, 10 + item) - 0.5) * REEF_CELL * 0.9;
          const oz = item === 0 ? pz : pz + (hash(cx, cz, 20 + item) - 0.5) * REEF_CELL * 0.9;
          this.placeProp(layer, ox, oz, hash(cx * 7 + item, cz * 3, 30), reef, shore);
        }
        // Litter on the sand: shells, pebbles, a sea cucumber, broken coral
        // near the reefs; meadows of sea grass in patches. Only near the
        // diver, where something a hand across can be seen at all.
        if (dx * dx + dz * dz < 30 * 30) {
          const meadow = smoothstep(0.55, 0.75, valueNoise(px * 0.05 - 11, pz * 0.05 + 23)) * (1 - reef);
          for (let bit = 0; bit < 5; bit += 1) {
            const r = hash(cx * 11 + bit, cz * 13, 50);
            const grass = meadow > 0 && bit < 4 && r < meadow * 0.95;
            if (!grass && r > 0.42) continue;
            const pick = hash(cx * 17 + bit, cz * 19, 51);
            const kind: PropKind = grass
              ? "grass"
              : pick < 0.3 ? "shell" : pick < 0.55 ? "pebbles" : pick < 0.66 ? "cucumber" : pick < 0.76 ? "dollar" : reef > 0.15 ? "rubble" : "shell";
            const layer = byKind.get(kind)!;
            if (layer.count >= PROP_CAPACITY) continue;
            const ox = px + (hash(cx, cz * 3 + bit, 52) - 0.5) * REEF_CELL;
            const oz = pz + (hash(cx * 3 + bit, cz, 53) - 0.5) * REEF_CELL;
            this.placeProp(layer, ox, oz, hash(cx * 5 + bit, cz * 7, 54), reef, shore);
          }
        }
      }
    }
    for (const layer of this.props) {
      layer.mesh.count = layer.count;
      layer.mesh.instanceMatrix.needsUpdate = true;
      if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
    }
  }

  private pickKind(reef: number, depth: number, r: number, cell: number): PropKind {
    if (reef < 0.25) {
      if (r < 0.32) return "grass";
      if (r < 0.5) return "star";
      if (r < 0.66) return "urchin";
      if (r < 0.86) return "rock";
      return cell < 0.5 ? "brain" : "sponge";
    }
    // A reef: corals by depth (staghorn and tables like the light, fans and
    // sponges the deeper water).
    const deep = smoothstep(6, 16, depth);
    if (r < 0.16) return "rock";
    if (r < 0.3) return "brain";
    if (r < 0.46 - deep * 0.12) return "staghorn";
    if (r < 0.55 - deep * 0.08) return "table";
    if (r < 0.66) return "softcoral";
    if (r < 0.74 + deep * 0.06) return "fan";
    if (r < 0.84 + deep * 0.06) return "sponge";
    if (r < 0.9) return "urchin";
    return "grass";
  }

  private placeProp(layer: PropLayer, x: number, z: number, seed: number, reef: number, shore: number): void {
    const kind = layer.kind;
    const ground = seabedHeight(x, z, shore);
    const sizes: Record<PropKind, [number, number]> = {
      rock: [0.4, 1.6],
      brain: [0.35, 1.1],
      staghorn: [0.7, 1.5],
      table: [0.6, 1.5],
      fan: [0.4, 0.9],
      sponge: [0.5, 1.1],
      grass: [0.7, 1.3],
      urchin: [0.8, 1.3],
      star: [0.7, 1.2],
      softcoral: [0.8, 1.6],
      shell: [0.7, 1.5],
      pebbles: [0.8, 1.6],
      cucumber: [0.8, 1.4],
      dollar: [0.8, 1.3],
      rubble: [0.8, 1.6],
    };
    const [low, high] = sizes[kind];
    const size = (low + (high - low) * hash(Math.floor(seed * 1e6), 1, 40)) * (LITTER_KINDS.includes(kind) && kind !== "grass" ? 1 : 0.75 + reef * 0.4);
    const yaw = hash(Math.floor(seed * 1e6), 2, 40) * Math.PI * 2;
    const flat = kind === "shell" || kind === "dollar" || kind === "cucumber" || kind === "pebbles" || kind === "rubble";
    const tilt = kind === "fan" ? 0 : (hash(Math.floor(seed * 1e6), 3, 40) - 0.5) * (flat ? 0.1 : 0.25);
    scratchEuler.set(tilt, yaw, tilt * 0.6, "YXZ");
    scratchQuaternion.setFromEuler(scratchEuler);
    const squash = kind === "rock" ? 0.7 + hash(Math.floor(seed * 1e6), 4, 40) * 0.6 : 1;
    scratchScale.set(size, size * squash, size);
    scratchPosition.set(x, ground - (kind === "rock" ? size * 0.12 : kind === "star" || flat ? 0.005 : 0.05), z);
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
    layer.mesh.setMatrixAt(layer.count, scratchMatrix);
    const palette = PALETTES[kind];
    scratchColor.set(palette[Math.floor(hash(Math.floor(seed * 1e6), 5, 40) * palette.length) % palette.length]!);
    layer.mesh.setColorAt(layer.count, scratchColor);
    layer.count += 1;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.torch.removeFromParent();
    this.torch.target.removeFromParent();
    this.seabed.geometry.dispose();
    this.seabed.material.dispose();
    for (const layer of this.props) {
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
      layer.mesh.dispose();
    }
    this.shafts.geometry.dispose();
    this.shafts.material.dispose();
    this.snow.geometry.dispose();
    this.snow.material.dispose();
    this.bubbles.geometry.dispose();
    this.bubbles.material.dispose();
  }
}
