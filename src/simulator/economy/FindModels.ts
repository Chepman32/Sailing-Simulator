import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FindKind } from "./EconomyMath";

/**
 * The things lying on the sea floor, modelled in code (no download can fail):
 * each kind is one merged, vertex-coloured geometry drawn by an instanced
 * mesh. Sizes are real (a conch a hand long, an amphora half a metre, a
 * chest the size of a sea chest); `emissive` marks the parts that glow
 * (the living coral, the gold showing at a chest's lid).
 *
 * Origin at the point resting on the sand, +Y up.
 */

type Paint = (x: number, y: number, z: number, out: THREE.Color) => void;

const scratch = new THREE.Color();

function noise(x: number, y: number, z: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

/** Non-indexed copy with colour and glow attributes painted per vertex. */
function painted(geometry: THREE.BufferGeometry, paint: Paint, glow = 0): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  for (const name of Object.keys(flat.attributes)) if (name !== "position" && name !== "normal") flat.deleteAttribute(name);
  if (!flat.getAttribute("normal")) flat.computeVertexNormals();
  const position = flat.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const glows = new Float32Array(position.count).fill(glow);
  for (let index = 0; index < position.count; index += 1) {
    paint(position.getX(index), position.getY(index), position.getZ(index), scratch);
    colors[index * 3] = scratch.r;
    colors[index * 3 + 1] = scratch.g;
    colors[index * 3 + 2] = scratch.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  flat.setAttribute("glow", new THREE.BufferAttribute(glows, 1));
  return flat;
}

function solid(color: number, variation = 0.12): Paint {
  const base = new THREE.Color(color);
  return (x, y, z, out) => out.copy(base).multiplyScalar(1 - variation / 2 + noise(x * 9, y * 9, z * 9) * variation);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((part) => part.dispose());
  merged.computeBoundingSphere();
  return merged;
}

function placed(geometry: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  geometry.rotateX(rx);
  geometry.rotateY(ry);
  geometry.rotateZ(rz);
  geometry.translate(x, y, z);
  return geometry;
}

/** A spiral conch: a cone wound round itself with knobbed shoulders and a flared, pink lip. */
function conch(): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [];
  for (let step = 0; step <= 24; step += 1) {
    const t = step / 24;
    const radius = 0.012 + Math.sin(t * Math.PI * 0.92) * 0.055 * (1 - t * 0.35);
    profile.push(new THREE.Vector2(radius, t * 0.2));
  }
  const body = new THREE.LatheGeometry(profile, 28);
  const position = body.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const angle = Math.atan2(z, x);
    // Whorls: the radius swells along a helix, with knobs on the shoulder.
    const whorl = 1 + 0.18 * Math.sin(angle + y * 60) + 0.12 * Math.max(0, Math.sin(angle * 7)) * Math.sin((y / 0.2) * Math.PI);
    position.setXYZ(index, x * whorl, y, z * whorl);
  }
  body.computeVertexNormals();
  body.rotateZ(Math.PI / 2 - 0.15);
  body.translate(0.1, 0.05, 0);
  return painted(body, (x, y, z, out) => {
    const band = 0.5 + 0.5 * Math.sin(x * 120 + Math.atan2(z, y) * 3);
    out.setRGB(0.92, 0.82, 0.68).lerp(new THREE.Color(0.95, 0.55, 0.5), band * 0.3 + (y < 0.03 ? 0.35 : 0));
  });
}

/** A fish's skeleton: the spine, a fan of ribs, the skull and the tail. */
function fishBones(): THREE.BufferGeometry {
  const bone = new THREE.Color(0.88, 0.86, 0.78);
  const parts: THREE.BufferGeometry[] = [];
  const spine = new THREE.CylinderGeometry(0.006, 0.009, 0.42, 6);
  parts.push(placed(spine, 0, 0.02, 0, 0, 0, Math.PI / 2));
  for (let rib = 0; rib < 9; rib += 1) {
    const x = -0.12 + rib * 0.028;
    const length = 0.05 + Math.sin((rib / 8) * Math.PI) * 0.07;
    for (const side of [-1, 1]) {
      const geometry = new THREE.CylinderGeometry(0.0025, 0.004, length, 4);
      parts.push(placed(geometry, x, 0.02 + (length / 2) * 0.6, side * (length / 2) * 0.75, side * 0.9, 0, 0.25));
    }
  }
  const skull = new THREE.SphereGeometry(0.045, 10, 8);
  skull.scale(1.3, 0.75, 0.8);
  parts.push(placed(skull, 0.24, 0.03, 0));
  const tail = new THREE.ConeGeometry(0.05, 0.08, 4, 1, true);
  tail.scale(1, 1, 0.15);
  parts.push(placed(tail, -0.25, 0.025, 0, 0, 0, Math.PI / 2));
  return merge(parts.map((part) => painted(part, (x, y, z, out) => out.copy(bone).multiplyScalar(0.85 + noise(x * 40, y * 40, z * 40) * 0.2))));
}

/** A small rusted anchor lying on its side: shank, crown, two arms with flukes, the stock and the ring. */
function anchor(): THREE.BufferGeometry {
  const rust = solid(0x6b3d24, 0.35);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(placed(new THREE.CylinderGeometry(0.025, 0.03, 0.9, 8), 0, 0.04, 0, 0, 0, Math.PI / 2));
  const arms = new THREE.TorusGeometry(0.26, 0.025, 8, 24, Math.PI * 0.9);
  parts.push(placed(arms, -0.33, 0.04, 0, Math.PI / 2, 0, Math.PI * 0.55));
  for (const side of [-1, 1]) {
    const fluke = new THREE.ConeGeometry(0.06, 0.13, 4);
    fluke.scale(1, 1, 0.3);
    parts.push(placed(fluke, -0.48, 0.04, side * 0.23, Math.PI / 2, 0, side * 0.6));
  }
  parts.push(placed(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 8), 0.4, 0.06, 0, Math.PI / 2, 0, 0));
  parts.push(placed(new THREE.TorusGeometry(0.06, 0.012, 6, 16), 0.5, 0.03, 0, Math.PI / 2, 0, 0));
  return merge(parts.map((part) => painted(part, rust)));
}

/** An old green glass bottle, corked, half sunk in the sand. */
function bottle(): THREE.BufferGeometry {
  const profile = [
    [0, 0],
    [0.04, 0.0],
    [0.042, 0.01],
    [0.042, 0.16],
    [0.03, 0.2],
    [0.014, 0.23],
    [0.014, 0.29],
    [0.018, 0.3],
    [0, 0.3],
  ].map(([r, y]) => new THREE.Vector2(r!, y!));
  const glass = new THREE.LatheGeometry(profile, 18);
  glass.rotateZ(Math.PI / 2 - 0.1);
  glass.translate(0.15, 0.03, 0);
  const cork = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8);
  return merge([
    painted(glass, (x, y, z, out) => out.setRGB(0.12, 0.38, 0.2).multiplyScalar(0.8 + noise(x * 30, y * 30, z * 30) * 0.3)),
    painted(placed(cork, -0.16, 0.06, 0, 0, 0, Math.PI / 2), solid(0x8a6a44)),
  ]);
}

/** A torn piece of a shipping container: corrugated steel, bent, its paint flaking to rust. */
function debris(): THREE.BufferGeometry {
  const plate = new THREE.PlaneGeometry(0.9, 0.55, 36, 6);
  const position = plate.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const corrugation = Math.sign(Math.sin(x * 70)) * 0.012;
    const bend = (y + 0.275) * (y + 0.275) * 0.5;
    position.setXYZ(index, x, y, corrugation + bend);
  }
  plate.computeVertexNormals();
  plate.rotateX(-Math.PI / 2 + 0.25);
  plate.translate(0, 0.1, 0);
  const paint = new THREE.Color(0.62, 0.16, 0.12);
  const rust = new THREE.Color(0.42, 0.24, 0.13);
  return painted(plate, (x, y, z, out) => out.copy(paint).lerp(rust, noise(Math.floor(x * 14), Math.floor(z * 14), 1) > 0.55 ? 0.8 : 0.15));
}

/** An oil drum gone overboard from a ship: crushed a little, banded, half its paint gone. */
function drum(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.15, 0.15, 0.45, 20, 6);
  const position = body.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const dent = 1 - 0.18 * Math.max(0, Math.cos(Math.atan2(z, x) - 0.6)) * Math.exp(-y * y * 30);
    const rim = Math.abs(Math.abs(y) - 0.12) < 0.02 ? 1.04 : 1;
    position.setXYZ(index, x * dent * rim, y, z * dent * rim);
  }
  body.computeVertexNormals();
  body.rotateZ(Math.PI / 2);
  body.translate(0, 0.13, 0);
  const blue = new THREE.Color(0.1, 0.24, 0.5);
  const rust = new THREE.Color(0.38, 0.22, 0.12);
  return painted(body, (x, y, z, out) => out.copy(blue).lerp(rust, noise(Math.floor(x * 18), Math.floor(y * 18), Math.floor(z * 18)) > 0.5 ? 0.85 : 0.1));
}

/** A two-handled amphora, terracotta crusted with barnacles, lying on its side. */
function amphora(): THREE.BufferGeometry {
  const profile = [
    [0, 0],
    [0.02, 0.02],
    [0.06, 0.08],
    [0.13, 0.2],
    [0.15, 0.3],
    [0.14, 0.4],
    [0.09, 0.5],
    [0.05, 0.56],
    [0.045, 0.66],
    [0.06, 0.7],
    [0.0, 0.7],
  ].map(([r, y]) => new THREE.Vector2(r!, y!));
  const body = new THREE.LatheGeometry(profile, 22);
  const parts: THREE.BufferGeometry[] = [body];
  for (const side of [-1, 1]) {
    const handle = new THREE.TorusGeometry(0.055, 0.012, 6, 14, Math.PI);
    parts.push(placed(handle, side * 0.06, 0.6, 0, 0, side > 0 ? 0 : Math.PI, -Math.PI / 2));
  }
  const geometry = merge(parts.map((part) => painted(part, (x, y, z, out) => {
    out.setRGB(0.66, 0.36, 0.22).multiplyScalar(0.82 + noise(x * 20, y * 20, z * 20) * 0.25);
    // Barnacles and sea growth on the upper side.
    if (noise(Math.floor(x * 30), Math.floor(y * 30), Math.floor(z * 30)) > 0.82) out.setRGB(0.82, 0.8, 0.72);
  })));
  geometry.rotateZ(Math.PI / 2 - 0.12);
  geometry.translate(0.35, 0.14, 0);
  return geometry;
}

/** A brass pocket compass with its lid open, the glass catching the light. */
function compass(): THREE.BufferGeometry {
  const brass = solid(0xb08a3a, 0.2);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(painted(placed(new THREE.CylinderGeometry(0.06, 0.065, 0.025, 28), 0, 0.0125, 0), brass));
  parts.push(painted(placed(new THREE.CylinderGeometry(0.052, 0.052, 0.004, 28), 0, 0.026, 0), (x, _y, z, out) => {
    const angle = Math.atan2(z, x);
    out.setRGB(0.9, 0.88, 0.8);
    if (Math.abs(Math.sin(angle * 4)) < 0.12) out.setRGB(0.15, 0.12, 0.1);
  }));
  const needle = new THREE.ConeGeometry(0.008, 0.08, 4);
  parts.push(painted(placed(needle, 0, 0.03, 0, 0, 0, Math.PI / 2), solid(0xa02020, 0)));
  parts.push(painted(placed(new THREE.CylinderGeometry(0.06, 0.06, 0.006, 28), 0.0, 0.07, -0.06, -1.25, 0, 0), brass));
  return merge(parts);
}

/** A sextant: the brass arc, the index arm, the frame, two mirrors and the telescope. */
function sextant(): THREE.BufferGeometry {
  const brass = solid(0xa88434, 0.2);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(painted(placed(new THREE.TorusGeometry(0.2, 0.012, 6, 30, Math.PI / 3), 0, 0.02, 0, Math.PI / 2, 0, Math.PI / 3), brass));
  for (const angle of [Math.PI / 3, (2 * Math.PI) / 3]) {
    const bar = new THREE.BoxGeometry(0.2, 0.012, 0.012);
    bar.translate(0.1, 0, 0);
    parts.push(painted(placed(bar, 0, 0.02, 0, 0, -angle, 0), brass));
  }
  const arm = new THREE.BoxGeometry(0.21, 0.01, 0.018);
  arm.translate(0.105, 0, 0);
  parts.push(painted(placed(arm, 0, 0.032, 0, 0, -Math.PI / 2 - 0.15, 0), brass));
  parts.push(painted(placed(new THREE.BoxGeometry(0.03, 0.035, 0.004), 0.01, 0.04, 0.02), solid(0x9ab4c0, 0.1)));
  parts.push(painted(placed(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 10), 0.08, 0.04, 0.09, 0, 0, Math.PI / 2), solid(0x2a2620, 0.1)));
  const geometry = merge(parts);
  geometry.translate(0, 0, -0.1);
  return geometry;
}

/** A rare glowing coral: branches tipped with light, its own small lantern on the reef. */
function glowCoral(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const branch = (from: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number, depth: number, seed: number) => {
    const geometry = new THREE.CylinderGeometry(radius * 0.7, radius, length, 6);
    geometry.translate(0, length / 2, 0);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
    geometry.translate(from.x, from.y, from.z);
    const tip = from.clone().addScaledVector(direction.clone().normalize(), length);
    parts.push(painted(geometry, (_x, y, _z, out) => out.setRGB(0.25, 0.55, 0.62).lerp(new THREE.Color(0.55, 0.95, 0.95), Math.min(1, y / 0.35)), 0.25));
    const bulb = new THREE.SphereGeometry(radius * 1.25, 8, 6);
    bulb.translate(tip.x, tip.y, tip.z);
    parts.push(painted(bulb, (_x, _y, _z, out) => out.setRGB(0.6, 1, 0.95), 1));
    if (depth <= 0) return;
    for (let child = 0; child < 2; child += 1) {
      const turn = noise(seed, child, depth) * Math.PI * 2;
      const next = direction.clone().normalize().add(new THREE.Vector3(Math.cos(turn) * 0.7, 0.2, Math.sin(turn) * 0.7)).normalize();
      branch(tip, next, length * 0.75, radius * 0.75, depth - 1, seed * 3 + child + 1);
    }
  };
  for (let trunk = 0; trunk < 4; trunk += 1) {
    const angle = (trunk / 4) * Math.PI * 2 + 0.4;
    branch(new THREE.Vector3(Math.cos(angle) * 0.03, 0, Math.sin(angle) * 0.03), new THREE.Vector3(Math.cos(angle) * 0.4, 1, Math.sin(angle) * 0.4), 0.14, 0.018, 2, trunk + 1);
  }
  return merge(parts);
}

/** A small idol of gold and jade, worn by the sea, half buried. */
function statuette(): THREE.BufferGeometry {
  const gold = new THREE.Color(0.95, 0.72, 0.28);
  const jade = new THREE.Color(0.22, 0.6, 0.42);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(painted(placed(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 12), 0, 0.02, 0), (x, y, z, out) => out.copy(jade).multiplyScalar(0.85 + noise(x * 30, y * 30, z * 30) * 0.2)));
  const body = new THREE.LatheGeometry(
    [
      [0.0, 0.04],
      [0.05, 0.04],
      [0.055, 0.1],
      [0.04, 0.16],
      [0.035, 0.19],
      [0.0, 0.19],
    ].map(([r, y]) => new THREE.Vector2(r!, y!)),
    14,
  );
  parts.push(painted(body, (x, y, z, out) => out.copy(gold).multiplyScalar(0.8 + noise(x * 40, y * 40, z * 40) * 0.25), 0.08));
  const head = new THREE.SphereGeometry(0.045, 12, 10);
  head.scale(1, 1.15, 0.95);
  parts.push(painted(placed(head, 0, 0.235, 0), (x, y, z, out) => {
    out.copy(gold).multiplyScalar(0.85 + noise(x * 50, y * 50, z * 50) * 0.2);
    // Two jade eyes.
    if (z > 0.03 && Math.abs(Math.abs(x) - 0.017) < 0.008 && Math.abs(y - 0.245) < 0.008) out.copy(jade);
  }, 0.08));
  const geometry = merge(parts);
  geometry.rotateZ(0.25);
  return geometry;
}

/** A sea chest: planked wood, iron bands and corners, the lid ajar on a glimmer of gold. */
function chest(): THREE.BufferGeometry {
  const wood = new THREE.Color(0.36, 0.22, 0.12);
  const iron = new THREE.Color(0.2, 0.18, 0.17);
  const parts: THREE.BufferGeometry[] = [];
  const box = new THREE.BoxGeometry(0.7, 0.36, 0.45, 8, 4, 4);
  box.translate(0, 0.18, 0);
  parts.push(painted(box, (x, y, z, out) => {
    const plank = Math.floor((y + 0.02) / 0.09);
    out.copy(wood).multiplyScalar(0.8 + noise(plank, Math.floor(x * 6), 2) * 0.3);
    if (Math.abs(Math.abs(x) - 0.22) < 0.025 || y < 0.02 || Math.abs(y - 0.36) < 0.02) out.copy(iron);
  }));
  // The lid, a half barrel, propped open a crack.
  const lid = new THREE.CylinderGeometry(0.225, 0.225, 0.7, 16, 1, false, 0, Math.PI);
  lid.rotateZ(Math.PI / 2);
  lid.rotateX(-0.28);
  lid.translate(0, 0.37, -0.03);
  parts.push(painted(lid, (x, y, z, out) => {
    out.copy(wood).multiplyScalar(0.85 + noise(Math.floor(z * 10), Math.floor(x * 6), 3) * 0.25);
    if (Math.abs(Math.abs(x) - 0.22) < 0.025) out.copy(iron);
  }));
  // Gold showing in the gap.
  const coins = new THREE.BoxGeometry(0.62, 0.04, 0.38, 10, 1, 6);
  const coinPosition = coins.getAttribute("position");
  for (let index = 0; index < coinPosition.count; index += 1) {
    if (coinPosition.getY(index) > 0) coinPosition.setY(index, 0.02 + noise(coinPosition.getX(index) * 20, 0, coinPosition.getZ(index) * 20) * 0.04);
  }
  coins.computeVertexNormals();
  coins.translate(0, 0.35, 0);
  parts.push(painted(coins, (x, _y, z, out) => out.setRGB(1, 0.78, 0.3).multiplyScalar(0.85 + noise(x * 60, 1, z * 60) * 0.3), 0.55));
  // The lock plate.
  parts.push(painted(placed(new THREE.BoxGeometry(0.08, 0.1, 0.02), 0, 0.3, 0.235), solid(0xb08a3a, 0.1), 0.1));
  return merge(parts);
}

const BUILDERS: Record<FindKind, () => THREE.BufferGeometry> = {
  shell: conch,
  fishbones: fishBones,
  anchor,
  bottle,
  debris,
  can: drum,
  amphora,
  compass,
  sextant,
  coral: glowCoral,
  statuette,
  chest,
};

/** The geometry of one kind of find (merged, painted, `glow` per vertex). */
export function findGeometry(kind: FindKind): THREE.BufferGeometry {
  return BUILDERS[kind]();
}

/** How far above its resting point a find's top is, m (for reaching it and for its glint). */
export const FIND_HEIGHT: Record<FindKind, number> = {
  shell: 0.12,
  fishbones: 0.08,
  anchor: 0.12,
  bottle: 0.08,
  debris: 0.25,
  can: 0.3,
  amphora: 0.3,
  compass: 0.08,
  sextant: 0.08,
  coral: 0.4,
  statuette: 0.28,
  chest: 0.6,
};
