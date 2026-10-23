import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { seededRandom } from "./IslandTerrain";

/**
 * Man-made island props. Each prop is merged into one vertex-coloured geometry
 * so a pier, hut or lighthouse costs a single draw call.
 */

function colored(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, random?: () => number): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute("uv");
  const base = new THREE.Color(color);
  const tint = new THREE.Color();
  const count = flat.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const shade = jitter > 0 && random ? 1 + (random() - 0.5) * jitter : 1;
  tint.copy(base).multiplyScalar(shade);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = tint.r;
    colors[index * 3 + 1] = tint.g;
    colors[index * 3 + 2] = tint.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error("Island structure geometry could not be merged.");
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Timber jetty along local +Z from the beach (z = 0) to `length`, deck at
 * `deckHeight` above the water, posts reaching down to `seabedDepth`.
 */
export function createPierGeometry(length: number, deckHeight: number, seabedDepth: number): THREE.BufferGeometry {
  const random = seededRandom(length * 3.1);
  const parts: THREE.BufferGeometry[] = [];
  const width = 2.4;
  for (let z = 0; z < length; z += 0.34) {
    const board = new THREE.BoxGeometry(width + (random() - 0.5) * 0.08, 0.08, 0.3);
    board.translate((random() - 0.5) * 0.04, deckHeight, z);
    parts.push(colored(board, 0x9a7650, 0.22, random));
  }
  for (let z = 0; z <= length + 0.01; z += 2.8) {
    for (const x of [-width / 2 + 0.12, width / 2 - 0.12]) {
      const height = deckHeight + seabedDepth;
      const post = new THREE.CylinderGeometry(0.13, 0.15, height, 8);
      post.translate(x, deckHeight - height / 2 - 0.04, z);
      parts.push(colored(post, 0x5f4630, 0.15, random));
    }
    const beam = new THREE.BoxGeometry(width + 0.2, 0.16, 0.18);
    beam.translate(0, deckHeight - 0.13, z);
    parts.push(colored(beam, 0x6b5036));
  }
  // Rope rail posts on the last section and two bollards at the head.
  for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) {
    const bollard = new THREE.CylinderGeometry(0.12, 0.14, 0.45, 10);
    bollard.translate(x, deckHeight + 0.26, length - 0.5);
    parts.push(colored(bollard, 0x2e2a26));
  }
  return merge(parts);
}

/** Thatched stilt hut, 4 m square, origin at the ground under its centre. */
export function createHutGeometry(): THREE.BufferGeometry {
  const random = seededRandom(17);
  const parts: THREE.BufferGeometry[] = [];
  const floor = 0.9;
  for (const x of [-1.8, 1.8]) {
    for (const z of [-1.8, 1.8]) {
      const stilt = new THREE.CylinderGeometry(0.12, 0.14, floor + 0.6, 7);
      stilt.translate(x, (floor - 0.6) / 2, z);
      parts.push(colored(stilt, 0x5b412b, 0.2, random));
    }
  }
  const platform = new THREE.BoxGeometry(4.6, 0.16, 4.6);
  platform.translate(0, floor, 0);
  parts.push(colored(platform, 0x8a6a46));
  // Woven walls with a doorway on +Z.
  const wallColor = 0xc6a874;
  const wallHeight = 2.1;
  const back = new THREE.BoxGeometry(3.8, wallHeight, 0.12).translate(0, floor + wallHeight / 2, -1.85);
  const left = new THREE.BoxGeometry(0.12, wallHeight, 3.8).translate(1.85, floor + wallHeight / 2, 0);
  const right = new THREE.BoxGeometry(0.12, wallHeight, 3.8).translate(-1.85, floor + wallHeight / 2, 0);
  const frontLeft = new THREE.BoxGeometry(1.3, wallHeight, 0.12).translate(1.25, floor + wallHeight / 2, 1.85);
  const frontRight = new THREE.BoxGeometry(1.3, wallHeight, 0.12).translate(-1.25, floor + wallHeight / 2, 1.85);
  const lintel = new THREE.BoxGeometry(1.2, 0.5, 0.12).translate(0, floor + wallHeight - 0.25, 1.85);
  [back, left, right, frontLeft, frontRight, lintel].forEach((wall) => parts.push(colored(wall, wallColor, 0.12, random)));
  // Dark interior visible through the doorway.
  parts.push(colored(new THREE.BoxGeometry(1.2, wallHeight - 0.5, 0.05).translate(0, floor + (wallHeight - 0.5) / 2, 1.6), 0x1d1610));
  // Two-layer thatch: a steep inner cone and a ragged overhanging fringe.
  const roof = new THREE.ConeGeometry(3.6, 2.4, 4, 1, false, Math.PI / 4);
  roof.translate(0, floor + wallHeight + 1.15, 0);
  parts.push(colored(roof, 0xb8964f));
  const fringe = new THREE.ConeGeometry(3.9, 0.9, 4, 1, true, Math.PI / 4);
  fringe.translate(0, floor + wallHeight + 0.2, 0);
  parts.push(colored(fringe, 0x9c7c3e));
  // Ladder to the doorway.
  for (let step = 0; step < 4; step += 1) {
    parts.push(colored(new THREE.BoxGeometry(0.9, 0.06, 0.22).translate(0, 0.2 + step * 0.22, 2.6 - step * 0.18), 0x6b5036));
  }
  return merge(parts);
}

export const LIGHTHOUSE_HEIGHT = 17;

/** Red-and-white banded lighthouse, origin at its base. Lantern at the top. */
export function createLighthouseGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bands = 6;
  const towerHeight = LIGHTHOUSE_HEIGHT - 3;
  for (let band = 0; band < bands; band += 1) {
    const y0 = (band / bands) * towerHeight;
    const y1 = ((band + 1) / bands) * towerHeight;
    const r0 = THREE.MathUtils.lerp(2.3, 1.45, band / bands);
    const r1 = THREE.MathUtils.lerp(2.3, 1.45, (band + 1) / bands);
    const segment = new THREE.CylinderGeometry(r1, r0, y1 - y0, 24, 1, true);
    segment.translate(0, (y0 + y1) / 2, 0);
    parts.push(colored(segment, band % 2 === 0 ? 0xf2efe8 : 0xc23b2f));
  }
  parts.push(colored(new THREE.CylinderGeometry(2.6, 2.7, 0.6, 24).translate(0, 0.3, 0), 0x6c6862));
  // Gallery deck, railing posts and lantern room frame.
  parts.push(colored(new THREE.CylinderGeometry(2.05, 2.05, 0.22, 24).translate(0, towerHeight + 0.1, 0), 0x2f3236));
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    parts.push(colored(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 4).translate(Math.cos(angle) * 1.95, towerHeight + 0.6, Math.sin(angle) * 1.95), 0x2f3236));
  }
  parts.push(colored(new THREE.TorusGeometry(1.95, 0.04, 4, 24).rotateX(Math.PI / 2).translate(0, towerHeight + 1, 0), 0x2f3236));
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    parts.push(colored(new THREE.BoxGeometry(0.08, 1.7, 0.08).translate(Math.cos(angle) * 1.05, towerHeight + 1.05, Math.sin(angle) * 1.05), 0x2f3236));
  }
  parts.push(colored(new THREE.ConeGeometry(1.35, 1.1, 18).translate(0, towerHeight + 2.45, 0), 0xa8322a));
  parts.push(colored(new THREE.SphereGeometry(0.16, 8, 6).translate(0, towerHeight + 3.05, 0), 0x2f3236));
  return merge(parts);
}

/** Lantern-room glass; its emissive intensity follows the night factor. */
export function createLanternGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(1.0, 1.0, 1.6, 16, 1, true).translate(0, LIGHTHOUSE_HEIGHT - 3 + 1.05, 0);
}

/** Soft additive beam cone pointing along +X from the lantern. */
export function createBeamGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(7, 70, 20, 1, true);
  geometry.translate(0, -35, 0);
  geometry.rotateZ(Math.PI / 2);
  // Fade along the beam via vertex alpha in the colour channel.
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 1) {
    const fade = 1 - THREE.MathUtils.clamp(positions.getX(index) / 70, 0, 1);
    colors[index * 3] = fade;
    colors[index * 3 + 1] = fade * 0.93;
    colors[index * 3 + 2] = fade * 0.72;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}
