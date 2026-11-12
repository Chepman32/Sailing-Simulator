import * as THREE from "three";
import type { LevelBuilder, LP } from "./LevelBuilder";
import type { Solid } from "./LevelCollision";

/**
 * Furniture and clutter for the story's levels, built from the builder's
 * primitives: crates, oil drums, sandbag walls, jerrycans, desks and
 * chairs, steel shelving, a fan that turns, a generator that shakes and
 * smokes, a container cell, floodlights, an antenna mast, a water tank,
 * fences (corrugated sheet, chain link with barbed wire), bollards, a
 * flowering bougainvillea, laundry on a line. Each is placed at a level
 * point (its foot) and turned (degrees clockwise from forward).
 */

const rotate = (b: LevelBuilder, at: LP, turn: number, right: number, forward: number, up = 0): LP => {
  const radians = (turn * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [at[0] + right * cos + forward * sin, at[1] - right * sin + forward * cos, (at[2] ?? 0) + up];
};

export function crate(b: LevelBuilder, at: LP, turn = 0, size = 1, tint = 0xb08a5a): void {
  b.box({ at, size: [1.1 * size, 0.85 * size, 0.9 * size], turn, mat: "wood", color: tint, solid: { cover: true }, floor: true });
  // Battens across the faces.
  b.box({ at: rotate(b, at, turn, 0, 0, 0.36 * size), size: [1.14 * size, 0.1 * size, 0.94 * size], turn, mat: "wood", color: 0x8a6a42, solid: false });
}

export function drum(b: LevelBuilder, at: LP, tint = 0x2f5d8a, lying = false): void {
  if (!lying) {
    b.cylinder(at, 0.29, 0.88, "paint", tint, { segments: 16, solid: { cover: true } });
    for (const h of [0.28, 0.6]) b.cylinder([at[0], at[1], (at[2] ?? 0) + h], 0.3, 0.035, "paint", new THREE.Color(tint).multiplyScalar(0.8).getHex(), { solid: false });
    return;
  }
  const geometry = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 16);
  geometry.rotateZ(Math.PI / 2);
  geometry.translate(0, 0.29, 0);
  b.mesh(geometry, "paint", at, 0, tint);
  geometry.dispose();
}

export function jerrycan(b: LevelBuilder, at: LP, turn = 0, tint = 0x9e2a22): void {
  b.box({ at, size: [0.17, 0.45, 0.35], turn, mat: "paint", color: tint, solid: false });
  b.box({ at: rotate(b, at, turn, 0, 0.1, 0.45), size: [0.05, 0.05, 0.12], turn, mat: "rubber", color: 0x222222, solid: false });
}

/** A wall of sandbags, `length` long, `courses` high (cover). */
export function sandbags(b: LevelBuilder, at: LP, length: number, turn = 0, courses = 4): void {
  const bag = new THREE.CapsuleGeometry(0.13, 0.42, 3, 8);
  bag.rotateZ(Math.PI / 2);
  bag.scale(1, 0.62, 1.15);
  const per = Math.max(1, Math.round(length / 0.62));
  for (let course = 0; course < courses; course += 1) {
    for (let index = 0; index < per; index += 1) {
      const offset = -length / 2 + (index + 0.5 + (course % 2) * 0.5) * (length / per);
      if (offset > length / 2) continue;
      b.mesh(bag, "fabric", rotate(b, at, turn, offset, (Math.random() - 0.5) * 0.04, 0.09 + course * 0.17), turn + (Math.random() - 0.5) * 6, 0xc4b48a);
    }
  }
  bag.dispose();
  b.box({ at, size: [length, courses * 0.17 + 0.05, 0.45], turn, mat: "fabric", solid: { cover: true, material: "fabric" }, skip: ["right", "left", "top", "bottom", "front", "back"] });
}

export function desk(b: LevelBuilder, at: LP, turn = 0, width = 1.6): void {
  b.box({ at: rotate(b, at, turn, 0, 0, 0.72), size: [width, 0.04, 0.75], turn, mat: "paint", color: 0xb9b2a2, solid: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box({ at: rotate(b, at, turn, sx * (width / 2 - 0.05), sz * 0.32), size: [0.04, 0.72, 0.04], turn, mat: "paint", color: 0x5a5d60, solid: false });
  b.box({ at, size: [width, 0.76, 0.75], turn, mat: "paint", solid: { cover: true }, skip: ["right", "left", "top", "bottom", "front", "back"] });
}

export function chair(b: LevelBuilder, at: LP, turn = 0): void {
  b.box({ at: rotate(b, at, turn, 0, 0, 0.44), size: [0.46, 0.05, 0.44], turn, mat: "rubber", color: 0x2d3032, solid: false });
  b.box({ at: rotate(b, at, turn, 0, -0.2, 0.47), size: [0.46, 0.5, 0.05], turn, mat: "rubber", color: 0x2d3032, solid: false });
  b.cylinder([...rotate(b, at, turn, 0, 0, 0)], 0.03, 0.44, "paint", 0x55595c, { solid: false });
}

/** Steel shelving with boxes and files, `width` wide (against a wall: its back toward −forward of its turn). */
export function shelves(b: LevelBuilder, at: LP, turn = 0, width = 2): void {
  for (const sx of [-1, 1]) b.box({ at: rotate(b, at, turn, sx * (width / 2 - 0.03), 0), size: [0.05, 2.1, 0.45], turn, mat: "paint", color: 0x6b7173, solid: false });
  for (const h of [0.15, 0.6, 1.05, 1.5, 1.95]) {
    b.box({ at: rotate(b, at, turn, 0, 0, h), size: [width, 0.03, 0.45], turn, mat: "paint", color: 0x6b7173, solid: false });
    if (h > 1.9) continue;
    // Files and boxes of every colour of cardboard and folder.
    let x = -width / 2 + 0.08;
    while (x < width / 2 - 0.15) {
      const w = 0.08 + Math.random() * 0.3;
      const tall = 0.24 + Math.random() * 0.12;
      const colour = [0x8a6d4a, 0xb59b6a, 0x3a5c7a, 0x8a2f2a, 0xd9cfb4, 0x4a6a4a][Math.floor(Math.random() * 6)]!;
      b.box({ at: rotate(b, at, turn, x + w / 2, 0.02, h + 0.03), size: [w - 0.01, tall, 0.34], turn, mat: "paint", color: colour, solid: false });
      x += w + 0.01 + (Math.random() < 0.2 ? 0.15 : 0);
    }
  }
  b.box({ at, size: [width, 2.1, 0.45], turn, mat: "paint", solid: { cover: true }, skip: ["right", "left", "top", "bottom", "front", "back"] });
}

/** A ceiling or desk fan that turns. */
export function fan(b: LevelBuilder, at: LP, ceiling: boolean): void {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.5 });
  b.own(material);
  b.own(dark);
  const hub = new THREE.Mesh(b.own(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12)), dark);
  const rotor = new THREE.Group();
  for (let index = 0; index < (ceiling ? 4 : 3); index += 1) {
    const blade = new THREE.Mesh(b.own(new THREE.BoxGeometry(ceiling ? 0.55 : 0.16, 0.01, ceiling ? 0.12 : 0.09)), material);
    blade.position.x = ceiling ? 0.32 : 0.1;
    const holder = new THREE.Group();
    holder.rotation.y = (index / (ceiling ? 4 : 3)) * Math.PI * 2;
    holder.add(blade);
    rotor.add(holder);
  }
  if (ceiling) {
    const rod = new THREE.Mesh(b.own(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6)), dark);
    rod.position.y = 0.25;
    group.add(rod, hub, rotor);
  } else {
    rotor.rotation.x = Math.PI / 2;
    rotor.position.y = 0.32;
    const stand = new THREE.Mesh(b.own(new THREE.CylinderGeometry(0.02, 0.07, 0.3, 8)), dark);
    stand.position.y = 0.15;
    hub.position.y = 0.32;
    hub.rotation.x = Math.PI / 2;
    group.add(stand, hub, rotor);
  }
  for (const child of group.children) child.castShadow = true;
  b.object(group, at);
  // A fan with a stutter in it, now and then.
  let speed = 9;
  b.animate((delta, elapsed) => {
    speed = 9 + Math.sin(elapsed * 0.7) * 1.5;
    if (ceiling) rotor.rotation.y += delta * speed;
    else rotor.rotation.z += delta * speed * 2;
  });
}

/** A diesel generator on skids, shaking, its exhaust stack and a fuel line. */
export function generator(b: LevelBuilder, at: LP, turn = 0): THREE.Object3D {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x5d7a5e, roughness: 0.6, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.5, metalness: 0.6 });
  b.own(body);
  b.own(metal);
  const housing = new THREE.Mesh(b.own(new THREE.BoxGeometry(1.4, 1.25, 2.3)), body);
  housing.position.y = 0.8;
  const skid = new THREE.Mesh(b.own(new THREE.BoxGeometry(1.5, 0.16, 2.5)), metal);
  skid.position.y = 0.08;
  const stack = new THREE.Mesh(b.own(new THREE.CylinderGeometry(0.06, 0.07, 1.1, 10)), metal);
  stack.position.set(0.35, 1.9, -0.6);
  const vents = new THREE.Mesh(b.own(new THREE.BoxGeometry(1.42, 0.5, 0.6)), metal);
  vents.position.set(0, 0.95, 0.95);
  for (const mesh of [housing, skid, stack, vents]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  b.object(group, at, turn);
  b.box({ at, size: [1.5, 1.45, 2.5], turn, mat: "paint", solid: { cover: true, material: "metal" }, skip: ["right", "left", "top", "bottom", "front", "back"] });
  b.animate((_delta, elapsed) => {
    housing.position.x = Math.sin(elapsed * 61) * 0.004;
    housing.position.y = 0.8 + Math.sin(elapsed * 47) * 0.003;
  });
  return stack;
}

/** A shipping container made a cell: doors at its `front` end replaced by bars, an awning over them. */
export function containerCell(b: LevelBuilder, at: LP, turn: number, colour = 0x9a4a32): { door: THREE.Object3D; bars: Solid | null } {
  const length = 6.06;
  const width = 2.44;
  const height = 2.59;
  // Three sides and the roof, corrugated; a floor of plywood.
  b.box({ at: rotate(b, at, turn, -width / 2 + 0.03, 0), size: [0.06, height, length], turn, mat: "corrugated", color: colour });
  b.box({ at: rotate(b, at, turn, width / 2 - 0.03, 0), size: [0.06, height, length], turn, mat: "corrugated", color: colour });
  b.box({ at: rotate(b, at, turn, 0, -length / 2 + 0.03), size: [width, height, 0.06], turn, mat: "corrugated", color: colour });
  b.box({ at: rotate(b, at, turn, 0, 0, height - 0.06), size: [width, 0.06, length], turn, mat: "corrugated", color: colour });
  b.slab(rotate(b, at, turn, 0, 0, 0), width - 0.1, length - 0.1, (at[2] ?? 0) + 0.12, { thick: 0.12, mat: "wood", turn });
  // The barred end: a frame and bars; the door is its own object, to swing open.
  const frameColour = 0x3f4446;
  b.box({ at: rotate(b, at, turn, 0, length / 2 - 0.05, height - 0.18), size: [width, 0.18, 0.1], turn, mat: "paint", color: frameColour });
  const door = new THREE.Group();
  const bar = b.own(new THREE.CylinderGeometry(0.016, 0.016, height - 0.25, 6));
  const metal = b.own(new THREE.MeshStandardMaterial({ color: 0x4a4f52, roughness: 0.5, metalness: 0.6 }));
  for (let index = 0; index < 11; index += 1) {
    const mesh = new THREE.Mesh(bar, metal);
    mesh.position.set(-(index + 0.5) * ((width - 0.1) / 11), (height - 0.25) / 2 + 0.05, 0);
    mesh.castShadow = true;
    door.add(mesh);
  }
  for (const y of [0.25, 1.2, 2.2]) {
    const rail = new THREE.Mesh(b.own(new THREE.BoxGeometry(width - 0.1, 0.05, 0.04)), metal);
    rail.position.set(-(width - 0.1) / 2, y, 0);
    door.add(rail);
  }
  // Hinged at its right edge (as seen from inside).
  b.object(door, rotate(b, at, turn, (width - 0.1) / 2, length / 2 - 0.05), turn);
  // An awning of tarp over the bars.
  const awning = new THREE.BoxGeometry(width + 0.6, 0.03, 1.4);
  awning.rotateX(0.18);
  b.mesh(awning, "fabric", rotate(b, at, turn, 0, length / 2 + 0.6, height - 0.1), turn, 0x5e7d8e);
  awning.dispose();
  // The cell's door as a solid (removed when it opens: the system keeps it closed by its own solid).
  const bars = b.box({ at: rotate(b, at, turn, 0, length / 2 - 0.05), size: [width, height, 0.12], turn, mat: "paint", solid: { opaque: false, stopsRounds: false }, skip: ["right", "left", "top", "bottom", "front", "back"] });
  return { door, bars };
}

export function floodlight(b: LevelBuilder, at: LP, turn = 0, height = 5): void {
  b.cylinder(at, 0.06, height, "paint", 0x80888a, { segments: 8 });
  b.box({ at: rotate(b, at, turn, 0, 0.15, height - 0.1), size: [0.5, 0.3, 0.18], turn, mat: "paint", color: 0x2c2f31, solid: false });
  b.box({ at: rotate(b, at, turn, 0, 0.25, height - 0.08), size: [0.44, 0.24, 0.02], turn, mat: "glass", solid: false });
}

export function antennaMast(b: LevelBuilder, at: LP, height = 9): void {
  b.cylinder(at, 0.05, height, "paint", 0xb9bec0, { segments: 6, solid: false });
  for (let index = 1; index < height / 1.2; index += 1) {
    b.box({ at: [at[0], at[1], (at[2] ?? 0) + index * 1.2], size: [0.6, 0.02, 0.02], mat: "paint", color: 0xb9bec0, solid: false });
  }
  // A dish and two whips.
  const dish = new THREE.SphereGeometry(0.4, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.35);
  dish.rotateX(-Math.PI / 2 + 0.3);
  b.mesh(dish, "paint", [at[0], at[1] + 0.2, (at[2] ?? 0) + height * 0.6], 0, 0xe8e8e2);
  dish.dispose();
  b.cylinder([at[0] + 0.3, at[1], (at[2] ?? 0) + height], 0.01, 2.4, "rubber", 0x222222, { segments: 4, solid: false });
}

export function waterTank(b: LevelBuilder, at: LP): void {
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.cylinder([at[0] + sx * 0.7, at[1] + sz * 0.7, at[2]], 0.06, 3, "rust", 0xffffff, { segments: 6 });
  b.cylinder([at[0], at[1], (at[2] ?? 0) + 3], 1.05, 1.7, "paint", 0x2a4a6a, { segments: 20, solid: false });
}

export function bollard(b: LevelBuilder, at: LP): void {
  b.cylinder(at, 0.16, 0.45, "paint", 0x2a2c2e, { segments: 12, top: 0.13 });
  b.cylinder([at[0], at[1], (at[2] ?? 0) + 0.45], 0.22, 0.06, "paint", 0x2a2c2e, { segments: 12, solid: false });
}

/** A corrugated sheet fence on posts from a to b, `height` tall, gaps where `openings` are. */
export function sheetFence(b: LevelBuilder, a: LP, c: LP, y: number, height: number, colour = 0x8fb5a0, openings: { at: number; width: number }[] = []): void {
  b.wall(a, c, { y, height, thick: 0.05, mat: "corrugated", color: colour, openings: openings.map((opening) => ({ ...opening, bottom: 0, top: height + 1 })), solid: { material: "metal" } });
  const dx = c[0] - a[0];
  const df = c[1] - a[1];
  const length = Math.hypot(dx, df);
  for (let s = 0; s <= length; s += 2.4) {
    if (openings.some((opening) => Math.abs(s - opening.at) < opening.width / 2)) continue;
    b.box({ at: [a[0] + (dx * s) / length, a[1] + (df * s) / length, y], size: [0.08, height + 0.1, 0.08], mat: "rust", solid: false });
  }
}

/** A chain-link fence with barbed wire along its top, open to the eye and to a round. */
export function chainFence(b: LevelBuilder, a: LP, c: LP, y: number, height: number, openings: { at: number; width: number }[] = []): void {
  const dx = c[0] - a[0];
  const df = c[1] - a[1];
  const length = Math.hypot(dx, df);
  const turn = (Math.atan2(dx, df) * 180) / Math.PI - 90;
  let last = 0;
  const pieces: [number, number][] = [];
  for (const opening of [...openings].sort((p, q) => p.at - q.at)) {
    pieces.push([last, opening.at - opening.width / 2]);
    last = opening.at + opening.width / 2;
  }
  pieces.push([last, length]);
  for (const [from, to] of pieces) {
    if (to - from < 0.1) continue;
    const mid = (from + to) / 2;
    const point: LP = [a[0] + (dx * mid) / length, a[1] + (df * mid) / length, y];
    b.box({ at: point, size: [to - from, height, 0.02], turn, mat: "glass", color: 0xffffff, solid: { opaque: false, stopsRounds: false, material: "metal" }, skip: ["top", "bottom", "right", "left"] });
    for (let s = from; s <= to + 0.01; s += 2.5) b.cylinder([a[0] + (dx * s) / length, a[1] + (df * s) / length, y], 0.035, height + 0.45, "paint", 0x7d8486, { segments: 6, solid: false });
    // The barbed wire: a coil along the top.
    const coil = new THREE.TorusGeometry(0.22, 0.008, 4, 10);
    for (let s = from; s < to; s += 0.35) b.mesh(coil, "paint", [a[0] + (dx * s) / length, a[1] + (df * s) / length, y + height + 0.25], turn + 90, 0x9aa0a2);
    coil.dispose();
  }
}

/** A bougainvillea: a heap of dark leaves dotted with magenta bracts (against a fence). */
export function bougainvillea(b: LevelBuilder, at: LP, size = 1.4): void {
  const leaves = new THREE.IcosahedronGeometry(size * 0.6, 1);
  const position = leaves.getAttribute("position");
  const colours: number[] = [];
  const colour = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const jitter = 0.75 + Math.random() * 0.5;
    position.setXYZ(index, position.getX(index) * jitter, position.getY(index) * jitter * 0.8, position.getZ(index) * jitter);
    colour.setHex(Math.random() < 0.42 ? 0xc0217a : Math.random() < 0.5 ? 0x2f6a2c : 0x3d7a34);
    colours.push(colour.r, colour.g, colour.b);
  }
  leaves.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  leaves.computeVertexNormals();
  const flat = leaves.toNonIndexed();
  flat.computeVertexNormals();
  b.mesh(flat, "leaf", [at[0], at[1], (at[2] ?? 0) + size * 0.45], Math.random() * 360);
  leaves.dispose();
  flat.dispose();
}

/** A line of washing between two posts: towels and shirts. */
export function laundry(b: LevelBuilder, a: LP, c: LP, y: number, colours: number[]): void {
  for (const point of [a, c]) b.cylinder([point[0], point[1], y], 0.04, 1.9, "wood", 0x9a7a52, { segments: 6, solid: false });
  const dx = c[0] - a[0];
  const df = c[1] - a[1];
  const length = Math.hypot(dx, df);
  const turn = (Math.atan2(dx, df) * 180) / Math.PI - 90;
  b.box({ at: [a[0] + dx / 2, a[1] + df / 2, y + 1.8], size: [length, 0.01, 0.01], turn, mat: "rubber", color: 0xdddddd, solid: false });
  colours.forEach((colour, index) => {
    const s = (index + 0.7) / (colours.length + 0.4);
    b.box({ at: [a[0] + dx * s, a[1] + df * s, y + 1.2], size: [0.5 + Math.random() * 0.3, 0.6, 0.01], turn: turn + (Math.random() - 0.5) * 8, mat: "fabric", color: colour, solid: false });
  });
}

/** A field tent: a ridge pole, a sloped canvas roof, open sides, a cook pot smoking under it. */
export function tent(b: LevelBuilder, at: LP, turn: number, w: number, d: number, colour = 0x6a7a52): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) b.cylinder(rotate(b, at, turn, (sx * w) / 2, (sz * d) / 2), 0.04, 2.0, "paint", 0x5a5e58, { segments: 6, solid: false });
  b.cylinder(rotate(b, at, turn, 0, -d / 2), 0.04, 2.6, "paint", 0x5a5e58, { segments: 6, solid: false });
  b.cylinder(rotate(b, at, turn, 0, d / 2), 0.04, 2.6, "paint", 0x5a5e58, { segments: 6, solid: false });
  for (const side of [-1, 1]) {
    const half = Math.hypot(w / 2, 0.6);
    const panel = new THREE.BoxGeometry(half, 0.02, d + 0.3);
    panel.rotateZ(side * Math.atan2(0.6, w / 2));
    b.mesh(panel, "fabric", rotate(b, at, turn, (side * w) / 4, 0, 2.3), turn, colour);
    panel.dispose();
  }
}
