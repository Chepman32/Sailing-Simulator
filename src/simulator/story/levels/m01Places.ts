import * as THREE from "three";
import type { LevelDefinition } from "../../level/LevelSystem";
import type { LevelBuilder, LP } from "../../level/LevelBuilder";
import { chair, crate, desk, drum, fan, jerrycan, laundry, shelves, tent, waterTank } from "../../level/LevelProps";
import { skiff } from "../../vessel/CraftModels";
import { wreckedSportYacht } from "../../vessel/ModelCrafts";

/**
 * M01's other places (docs/campaign/missions/m01.md §2.2):
 *
 * - `kosaya`, the Slant Shoal on the outer island's south shore: the wreck's
 *   leavings on the sand (a piece of white hull with the black stripe, the
 *   container with its blinking beacon, a fuel can, wet straps, the freight
 *   tag, the knife and belt, a jellyfish at the water's edge); the wreck
 *   itself on the reef offshore, smoking a little; and the trail up through
 *   the heat past the pack on the snag, the empty café with its fan, the
 *   broken sign of the old customs and the rock to crouch at.
 * - `white-rocks`, the two white sea stacks of the pass (S08).
 * - `cove`, Mark's haven: a workshop under a tin roof, two outboards on
 *   stands, a hammock, fresh water, shirts drying, Maya's table, the small
 *   pier, Mark's map table.
 * - `kenji`, `sara`, `viktor`: the sets of the montage (S09), on islands
 *   near enough to be seen from the cove's sea.
 */

const ISLAND = { east: -7111.77, north: -5043.04 };

const ground = (b: LevelBuilder, r: number, f: number, up = 0): LP => [r, f, b.groundAt(r, f) + up];

/** A soft grey plume, drawn as a few drifting billboards (for the wreck: a thin smoke, not a column all day). */
function smoke(b: LevelBuilder, at: LP, height: number): void {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, "rgba(255,255,255,0.75)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = b.own(new THREE.CanvasTexture(canvas));
  const material = b.own(new THREE.SpriteMaterial({ map: texture, color: 0x4a4846, transparent: true, depthWrite: false, opacity: 0.5 }));
  const group = new THREE.Group();
  const puffs: { sprite: THREE.Sprite; phase: number }[] = [];
  const count = 22;
  for (let index = 0; index < count; index += 1) {
    const sprite = new THREE.Sprite(material.clone());
    sprite.material.rotation = index * 2.39;
    b.own(sprite.material);
    group.add(sprite);
    puffs.push({ sprite, phase: index / count });
  }
  b.object(group, at);
  b.animate((delta, elapsed) => {
    for (const puff of puffs) {
      const t = (puff.phase + elapsed * 0.04) % 1;
      // Dense and dark where it leaves the water, spreading and paling as it climbs.
      const size = 3 + t * 19;
      puff.sprite.scale.set(size, size, 1);
      // Leaning downwind as it rises.
      puff.sprite.position.set(t * t * 18, t * height, t * 6 + Math.sin(elapsed * 0.3 + puff.phase * 9) * 1.2);
      const material = puff.sprite.material as THREE.SpriteMaterial;
      material.opacity = 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.08)) * (1 - t * 0.45);
      material.color.setScalar(0.22 + t * 0.2);
    }
  });
}

/** A canvas texture with lines of text (a tag, a sign, a page). */
function textTexture(b: LevelBuilder, width: number, height: number, paint: (context: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d")!);
  const texture = b.own(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function plate(b: LevelBuilder, w: number, h: number, texture: THREE.Texture, at: LP, turn: number, tilt = 0, basic = false): THREE.Mesh {
  const material = basic ? new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }) : new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(b.own(new THREE.PlaneGeometry(w, h)), b.own(material));
  mesh.rotation.x = tilt;
  const holder = new THREE.Group();
  holder.add(mesh);
  b.object(holder, at, turn);
  return mesh;
}

/** A boat's model (a skiff hauled out, the wreck) set into a level, owned by it. */
function boatProp(b: LevelBuilder, model: { group: THREE.Group; dispose(): void }, at: LP, turn: number, roll = 0, pitch = 0): THREE.Group {
  b.own(model);
  model.group.rotation.set(pitch, 0, roll, "YXZ");
  const holder = new THREE.Group();
  holder.add(model.group);
  b.object(holder, at, turn);
  return model.group;
}

// --- The Slant Shoal and the trail ------------------------------------------------------

export const KOSAYA: LevelDefinition = {
  id: "kosaya",
  // On the south shore, looking out to sea (south-south-west): right is west-north-west.
  frame: { x: -(ISLAND.east - 8), z: ISLAND.north - 120, y: 0, bearing: 200 },
  range: 1300,
  build: (b) => buildKosaya(b),
};

function buildKosaya(b: LevelBuilder): void {
  // --- The wreck's leavings on the sand ------------------------------------------------
  // A piece of her white side, the black band along it.
  const shell = new THREE.CylinderGeometry(1.4, 1.4, 2.6, 14, 1, true, 0, Math.PI * 0.62);
  shell.rotateZ(Math.PI / 2);
  b.mesh(shell, "paint", ground(b, -12, 8, 0.25), 25, 0xf2f2ee);
  shell.dispose();
  const stripe = new THREE.CylinderGeometry(1.42, 1.42, 2.2, 14, 1, true, 0.15, 0.4);
  stripe.rotateZ(Math.PI / 2);
  b.mesh(stripe, "paint", ground(b, -12, 8, 0.25), 25, 0x15171a);
  stripe.dispose();
  b.interact("hull-piece", ground(b, -12, 8), 2.4);
  // Shards of it, and of the glass.
  for (let index = 0; index < 7; index += 1) {
    const r = -9 + index * 2.6 + Math.sin(index * 7) * 1.5;
    const f = 11 + Math.cos(index * 3) * 3;
    b.box({ at: ground(b, r, f, 0.02), size: [0.4 + (index % 3) * 0.3, 0.04, 0.25 + (index % 2) * 0.3], turn: index * 47, mat: "paint", color: index % 3 === 0 ? 0x1a1c1e : 0xeeeeea, solid: false });
  }
  // The container: a grey hard case, its lid thrown back, nothing in it but a board and a blue light.
  const caseAt = ground(b, 4, 12, 0.02);
  b.box({ at: caseAt, size: [0.86, 0.36, 0.58], turn: -18, mat: "paint", color: 0x8d969d });
  const container = new THREE.Group();
  const caseMaterial = b.own(new THREE.MeshStandardMaterial({ color: 0x8d969d, roughness: 0.55, metalness: 0.1 }));
  const latchMaterial = b.own(new THREE.MeshStandardMaterial({ color: 0xe0b232, roughness: 0.5 }));
  const foam = b.own(new THREE.MeshStandardMaterial({ color: 0x25282b, roughness: 0.95 }));
  // The lid, hinged at the back and thrown open past upright.
  const lid = new THREE.Mesh(b.own(new THREE.BoxGeometry(0.86, 0.07, 0.58)), caseMaterial);
  lid.geometry.translate(0, 0, -0.29);
  lid.position.set(0, 0.37, -0.29);
  lid.rotation.x = 1.95;
  lid.castShadow = true;
  const lining = new THREE.Mesh(b.own(new THREE.BoxGeometry(0.78, 0.02, 0.5)), foam);
  lining.geometry.translate(0, -0.053, -0.29);
  lid.add(lining);
  container.add(lid);
  for (const x of [-0.26, 0.26]) {
    const latch = new THREE.Mesh(b.own(new THREE.BoxGeometry(0.08, 0.1, 0.03)), latchMaterial);
    latch.position.set(x, 0.27, 0.3);
    container.add(latch);
  }
  b.object(container, caseAt, -18);
  b.box({ at: [caseAt[0], caseAt[1], caseAt[2]! + 0.365], size: [0.3, 0.025, 0.2], turn: -18, mat: "paint", color: 0x1d5a34, solid: false });
  const led = new THREE.Mesh(b.own(new THREE.SphereGeometry(0.03, 8, 6)), b.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.7, 3.2), toneMapped: false })));
  b.object(led, [caseAt[0] + 0.08, caseAt[1], caseAt[2]! + 0.4]);
  const glow = new THREE.Mesh(b.own(new THREE.SphereGeometry(0.11, 10, 8)), b.own(new THREE.MeshBasicMaterial({ color: 0x4c8cff, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })));
  b.object(glow, [caseAt[0] + 0.08, caseAt[1], caseAt[2]! + 0.4]);
  b.animate((_delta, elapsed) => {
    const on = elapsed % 1.6 < 0.18;
    led.visible = on;
    glow.visible = on;
  });
  b.interact("container", caseAt, 1.8);
  b.spot("container", caseAt, 0);
  // A fuel can, wet straps, the freight tag, the knife and belt, a purple jellyfish at the edge.
  jerrycan(b, ground(b, 9, 9), 70, 0xb02a20);
  for (let index = 0; index < 3; index += 1) b.box({ at: ground(b, -4 + index * 0.5, 10 + index * 0.4, 0.01), size: [0.05, 0.015, 2.2], turn: 60 + index * 25, mat: "fabric", color: 0x2c3b4a, solid: false });
  const tag = textTexture(b, 128, 64, (context) => {
    context.fillStyle = "#f1ead6";
    context.fillRect(0, 0, 128, 64);
    context.fillStyle = "#30302a";
    context.font = "bold 13px monospace";
    context.fillText("FREIGHT · 36-B", 8, 18);
    context.font = "10px monospace";
    context.fillText("CONSIGNEE: ON SITE", 8, 34);
    context.fillText("SEALED · DO NOT OPEN", 8, 48);
  });
  plate(b, 0.16, 0.08, tag, ground(b, 1.5, 6, 0.012), 30, -Math.PI / 2);
  b.interact("tag", ground(b, 1.5, 6), 1.4);
  b.box({ at: ground(b, -2, 3, 0.01), size: [0.05, 0.02, 1.1], turn: 40, mat: "fabric", color: 0x3a2a1a, solid: false });
  b.box({ at: ground(b, -1.9, 2.8, 0.03), size: [0.04, 0.03, 0.22], turn: 75, mat: "paint", color: 0x9ea4a8, solid: false });
  b.cylinder(ground(b, -2.25, 3.25, 0.03), 0.03, 0.16, "paint", 0x2a2a2a, { segments: 8, solid: false });
  b.interact("knife", ground(b, -2, 3), 1.4);
  const jelly = new THREE.Mesh(b.own(new THREE.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), b.own(new THREE.MeshStandardMaterial({ color: 0xb06ad8, roughness: 0.1, transparent: true, opacity: 0.55, emissive: 0x2a0d38 })));
  jelly.scale.y = 0.45;
  b.object(jelly, ground(b, 12, 15.5, -0.01));
  // Where he comes to, looking out at the smoke; where Mark waits, under the palms above him.
  // He comes to looking along the beach, the smoke off to one side: "where's the yacht?" turns him to it.
  b.spot("wake", ground(b, 0, 9), 34);
  b.spot("mark-hidden", ground(b, 34, -48), 200);
  b.spot("mark-beach", ground(b, 5, -5), 190);
  b.area("beach", [0, 6], 60, 26, { height: 6 });
  // The meeting: where they stand, and the camera's places for it.
  const head = (r: number, f: number, up: number): LP => ground(b, r, f, up);
  b.spot("meet-hero", ground(b, 3, 9), 157);
  b.spot("meet-mark", ground(b, 4.5, 5.5), -23);
  b.spot("meet-hero-head", head(3, 9, 1.62), 157);
  b.spot("meet-mark-head", head(4.5, 5.5, 1.62), -23);
  b.spot("meet-mid", head(3.75, 7.25, 1.3), 0);
  b.spot("cam-profile", head(8.6, 9.6, 1.45), 0);
  b.spot("cam-profile-near", head(7.2, 8.9, 1.5), 0);
  b.spot("cam-ots-mark", head(2.99, 10.41, 1.86), 0);
  b.spot("cam-ots-hero", head(5.52, 4.52, 1.86), 0);

  // --- The wreck on the reef offshore -----------------------------------------------------
  const wreck = wreckedSportYacht();
  boatProp(b, wreck, [-20, 125, -0.9], 140, 0.36, -0.12);
  smoke(b, [-21, 123, 1.5], 46);
  // Where he looks to find her: the foot of the smoke, a little above the water.
  b.spot("wreck-smoke", [-19, 124, 6], 0);

  // --- The trail -------------------------------------------------------------------------
  b.spot("mark-trail1", ground(b, 28, -20), 230);
  // The pack, caught on a snag of driftwood.
  b.cylinder(ground(b, 36, -25, 0.2), 0.18, 3.4, "wood", 0x8a7a64, { segments: 8, solid: false });
  b.box({ at: ground(b, 36.2, -24.2, 0.1), size: [0.42, 0.5, 0.26], turn: 20, mat: "fabric", color: 0x3f5c4a });
  b.interact("backpack", ground(b, 36, -24.4), 1.6);
  // The empty café by the old pier: tables, chairs, a fan still turning, towels on a line.
  const tables: [number, number][] = [
    [66, -31],
    [69, -37.5],
  ];
  for (const [r, f] of tables) {
    b.cylinder(ground(b, r, f), 0.05, 0.72, "paint", 0xe8e2d2, { segments: 8 });
    b.cylinder(ground(b, r, f, 0.72), 0.45, 0.04, "paint", 0xf0ebde, { segments: 16, solid: false });
    chair(b, ground(b, r + 0.7, f), 90);
    chair(b, ground(b, r - 0.7, f + 0.2), -90);
  }
  fan(b, ground(b, 66, -31, 0.76), false);
  b.cylinder(ground(b, 69, -37.4, 0.76), 0.04, 0.12, "glass", 0xffffff, { segments: 10, solid: false });
  laundry(b, [62, -43], [70, -45], b.groundAt(66, -44), [0xf2b23a, 0x3aa0c8, 0xf0ece0, 0xd6457a]);
  // A parasol over the first table, faded.
  const parasol = new THREE.ConeGeometry(1.6, 0.5, 10, 1, true);
  b.mesh(parasol, "fabric", ground(b, 66, -31, 2.4), 0, 0xd85a3a);
  parasol.dispose();
  b.cylinder(ground(b, 66, -31, 0.72), 0.025, 1.75, "paint", 0xdddddd, { segments: 6, solid: false });
  b.spot("cafe", ground(b, 67, -34), 0);
  b.spot("mark-cafe", ground(b, 61, -40), 120);
  // Two fishing boats drawn up on the sand, nobody near them.
  boatProp(b, skiff(), ground(b, 79, -22, 0.12), 95, 0.12);
  boatProp(b, skiff(), ground(b, 83, -29, 0.12), 110, -0.1);
  // The sign of the old customs, broken off its post.
  b.cylinder(ground(b, 50, -62), 0.06, 1.1, "wood", 0x7a6248, { segments: 6 });
  const sign = textTexture(b, 256, 64, (context) => {
    context.fillStyle = "#e9e1c8";
    context.fillRect(0, 0, 256, 64);
    context.fillStyle = "#24435a";
    context.font = "bold 30px sans-serif";
    context.fillText("ТАМОЖ", 12, 42);
    context.fillStyle = "rgba(0,0,0,0.18)";
    for (let index = 0; index < 60; index += 1) context.fillRect(Math.random() * 256, Math.random() * 64, 6, 2);
  });
  plate(b, 1.1, 0.28, sign, ground(b, 50.6, -61.4, 0.35), 200, -1.1);
  b.spot("mark-trail2", ground(b, 56, -90), 200);
  // The rock to crouch at, where the signals window could see them.
  b.box({ at: ground(b, 44.5, -137.5, -0.3), size: [1.8, 1.4, 1.2], turn: 25, mat: "rock", color: 0xd9d3c4, solid: { cover: true } });
  b.spot("mark-stone", ground(b, 43.5, -136), 200);
  b.cover(ground(b, 44, -136.4), 200);
}

// --- The two white rocks ----------------------------------------------------------------

export const WHITE_ROCKS: LevelDefinition = {
  id: "white-rocks",
  frame: { x: 6643, z: -4770, y: 0, bearing: 68.5 },
  range: 1600,
  build: (b) => {
    // Two pale limestone stacks either side of the pass, weed at their feet.
    for (const [side, height] of [
      [1, 9.5],
      [-1, 7.6],
    ] as const) {
      const r = side * 17;
      const stack = new THREE.IcosahedronGeometry(1, 1);
      const position = stack.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index);
        const y = position.getY(index);
        const z = position.getZ(index);
        const wobble = 1 + Math.sin(x * 5.1 + z * 3.3) * 0.12 + Math.cos(y * 4 + x) * 0.08;
        // Tall and a little overhanging at the top, worn in at the waterline.
        const waist = y < -0.3 && y > -0.75 ? 0.82 : 1;
        position.setXYZ(index, x * 5.4 * wobble * waist, y * (height + 10) * 0.5, z * 4.6 * wobble * waist);
      }
      stack.computeVertexNormals();
      b.mesh(stack, "rock", [r, 0, height - (height + 10) / 2], side * 30, 0xf1ede2);
      stack.dispose();
      const weed = new THREE.TorusGeometry(5.1, 0.35, 6, 18);
      weed.rotateX(Math.PI / 2);
      b.mesh(weed, "leaf", [r, 0, -0.15], 0, 0x3e5a2e);
      weed.dispose();
      b.obstacle([r, 0], 5.6);
    }
    b.spot("pass", [0, 0, 0], 0);
  },
};

// --- Mark's cove --------------------------------------------------------------------------

export const COVE: LevelDefinition = {
  id: "cove",
  // The west shore of the island across the lagoon, looking out west.
  frame: { x: 6251, z: -4616, y: 0, bearing: 270 },
  range: 2600,
  pads: [{ at: [0, -15], w: 24, d: 18, turn: 0, height: 1.55, blend: 4, clear: 2 }],
  build: (b) => buildCove(b),
};

function buildCove(b: LevelBuilder): void {
  const yard = 1.55;
  // The pier: planks on posts out over the water, the skiff's berth alongside.
  b.slab([0, 13], 2.2, 18, 1.0, { thick: 0.12, mat: "wood", color: 0x9a8262, surface: "wood" });
  for (let f = 5; f <= 22; f += 3) for (const r of [-1, 1]) b.cylinder([r, f, -2.2], 0.12, 3.2, "wood", 0x6e5a42, { segments: 8, solid: false });
  b.stairs([0, 4.2], [0, 1.2], 1.0, b.groundAt(0, 1.2), 1.6, { mat: "wood", color: 0x8d7556, rails: false });
  b.spot("berth", [2.6, 16.5, 0], 180);
  b.spot("pier-head", [0, 18, 1.0], 180);
  b.spot("hero", [0.6, 14.5, 1.0], 160);
  b.spot("maya-pier", [-0.4, 11.5, 1.0], 0);
  // The workshop under its tin roof: a bench, two outboards on stands, crates.
  for (const [r, f] of [
    [-9, -10],
    [-1, -10],
    [-9, -18],
    [-1, -18],
  ] as const) {
    b.cylinder([r, f, yard], 0.09, 3.0, "wood", 0x6e5a42, { segments: 8 });
  }
  const roof = new THREE.BoxGeometry(9.4, 0.05, 9.4);
  roof.rotateX(0.1);
  b.mesh(roof, "corrugated", [-5, -14, yard + 3.05], 0, 0x9aa79c);
  roof.dispose();
  desk(b, [-7.5, -17, yard], 0, 2.4);
  for (const [r, f] of [
    [-3.5, -16],
    [-6, -12.6],
  ] as const) {
    b.box({ at: [r, f, yard], size: [0.5, 0.9, 0.5], mat: "paint", color: 0x5a5e5c });
    b.box({ at: [r, f + 0.05, yard + 0.9], size: [0.36, 0.5, 0.5], mat: "paint", color: 0x2e3438, solid: false });
    b.box({ at: [r, f + 0.05, yard + 0.2], size: [0.1, 0.7, 0.16], mat: "paint", color: 0x2e3438, solid: false });
  }
  crate(b, [-8.6, -11, yard], 10, 0.9);
  drum(b, [-1.6, -11.2, yard], 0x2f5d8a);
  jerrycan(b, [-2.3, -17.6, yard], 0);
  // Mark's table: the map, the drive, the keys (placed by him in the scene).
  desk(b, [3, -9, yard], 90, 1.8);
  const chart = textTexture(b, 256, 160, (context) => {
    context.fillStyle = "#d8cfae";
    context.fillRect(0, 0, 256, 160);
    context.strokeStyle = "#7a9ab0";
    context.lineWidth = 1;
    for (let index = 0; index < 10; index += 1) {
      context.beginPath();
      context.arc(40 + index * 22, 80 + Math.sin(index) * 30, 14 + (index % 4) * 6, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = "#c0392b";
    for (const [x, y] of [[60, 52], [180, 40], [210, 120], [96, 120]]) {
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
    }
  });
  plate(b, 1.3, 0.8, chart, [3, -9, yard + 0.765], 90, -Math.PI / 2);
  b.box({ at: [2.7, -8.7, yard + 0.765], size: [0.07, 0.02, 0.12], mat: "paint", color: 0x222428, solid: false });
  b.spot("table", [3, -9, yard], 180);
  b.spot("mark", [3.2, -10.4, yard], 0);
  // Maya's table: ampoules and bottles of water, a medical bag.
  desk(b, [6.5, -5.5, yard], 0, 1.4);
  for (let index = 0; index < 8; index += 1) b.cylinder([6.0 + index * 0.13, -5.4, yard + 0.765], 0.035, 0.26, "glass", 0xdbe9f2, { segments: 8, solid: false });
  for (let index = 0; index < 6; index += 1) b.cylinder([6.2 + index * 0.06, -5.7, yard + 0.765], 0.008, 0.05, "glass", 0xffffff, { segments: 6, solid: false });
  b.spot("maya", [6.5, -6.4, yard], 0);
  b.spot("luis", [5.4, -4.4, yard], 200);
  // A hammock between two posts, fresh water, shirts drying, fish on ice.
  for (const r of [10, 14.5]) b.cylinder([r, -14, yard], 0.1, 1.9, "wood", 0x6e5a42, { segments: 8 });
  const hammock = new THREE.CylinderGeometry(0.55, 0.55, 4.2, 12, 1, true, Math.PI * 0.75, Math.PI * 0.5);
  hammock.rotateZ(Math.PI / 2);
  b.mesh(hammock, "fabric", [12.25, -14, yard + 1.6], 0, 0xc98a3a);
  hammock.dispose();
  waterTank(b, [-12, -6, yard]);
  laundry(b, [8, -20], [15, -21], yard, [0x2a6a9a, 0xe0d8c4, 0x9a3a3a, 0x6f7550, 0xf0c040]);
  b.box({ at: [-2, -6, yard], size: [0.9, 0.5, 0.6], mat: "paint", color: 0x3a86c4 });
  for (let index = 0; index < 4; index += 1) b.box({ at: [-2.2 + index * 0.13, -6, yard + 0.5], size: [0.08, 0.05, 0.42], turn: 5, mat: "paint", color: 0xb8c4c8, solid: false });
  tent(b, [10, -6, yard], 20, 3.4, 3.6, 0xd8c8a0);
}

// --- The montage's sets ---------------------------------------------------------------

export const KENJI: LevelDefinition = {
  id: "kenji",
  // The rocky islet's south shore: his field lab by a green, poisoned lagoon, old pipes beyond.
  frame: { x: 6493, z: -3985, y: 0, bearing: 180 },
  range: 3000,
  build: (b) => {
    tent(b, ground(b, -3, -8), 10, 3.2, 3, 0x9fb0a0);
    desk(b, ground(b, 1.5, -4.5), 0, 1.6);
    const top = b.groundAt(1.5, -4.5) + 0.765;
    for (let index = 0; index < 6; index += 1) b.cylinder([1.0 + index * 0.16, -4.4, top], 0.03, 0.15, "glass", index % 2 ? 0xbad9a0 : 0xd8eec8, { segments: 8, solid: false });
    b.box({ at: [2.0, -4.7, top], size: [0.32, 0.18, 0.24], mat: "paint", color: 0xe6e3da, solid: false });
    // The lagoon: a sickly green skin on the water, rusty pipes standing out of it.
    const film = new THREE.Mesh(b.own(new THREE.CircleGeometry(14, 32)), b.own(new THREE.MeshStandardMaterial({ color: 0x5f8f3a, roughness: 0.4, transparent: true, opacity: 0.55, depthWrite: false })));
    film.rotation.x = -Math.PI / 2;
    b.object(film, [0, 14, 0.04]);
    for (let index = 0; index < 4; index += 1) b.cylinder([-10 + index * 6, 26 + (index % 2) * 4, -1.5], 0.35, 3.4 + index * 0.4, "rust", 0xffffff, { segments: 10, solid: false });
    // He kneels at the water's edge with a sample; the camera low over the shallows, then behind him.
    b.spot("kenji", ground(b, 0.5, 0.2), 0);
    b.spot("cam-a", [4.5, 4.5, 0.9], 0);
    b.spot("look-a", ground(b, 0.5, 0.2, 0.7), 0);
    b.spot("cam-b", [-1.6, -3.4, b.groundAt(-1.6, -3.4) + 1.5], 0);
    b.spot("look-b", ground(b, 1.4, 4, 0.2), 0);
  },
};

export const SARA: LevelDefinition = {
  id: "sara",
  // A shore house on the rocky island to the north-east: its walls papered with documents.
  frame: { x: 5546, z: -3700, y: 0, bearing: 200 },
  range: 3000,
  // The ground a little under the floor, so the two never fight.
  pads: [{ at: [0, 0], w: 8, d: 7, height: 1.1, blend: 3, clear: 2 }],
  build: (b) => {
    const y = 1.2;
    b.slab([0, 0], 5, 4.4, y, { thick: 0.15, mat: "wood", color: 0x8a7556 });
    for (const [a, c, openings] of [
      [[-2.5, -2.2], [2.5, -2.2], []],
      [[-2.5, 2.2], [2.5, 2.2], [{ at: 3.2, width: 1.1, bottom: 0.9, top: 1.9 }]],
      [[-2.5, -2.2], [-2.5, 2.2], [{ at: 1.2, width: 0.9, bottom: 0, top: 2 }]],
      [[2.5, -2.2], [2.5, 2.2], []],
    ] as const) {
      b.wall(a, c, { y, height: 2.6, thick: 0.12, mat: "render", color: 0xe9e2d0, openings: openings.map((opening) => ({ ...opening })) });
    }
    b.slab([0, 0], 5.3, 4.7, y + 2.75, { thick: 0.12, mat: "corrugated", color: 0x8a9a92 });
    // Pages on the walls, a photo or two, string between them.
    const page = textTexture(b, 64, 84, (context) => {
      context.fillStyle = "#f3efe4";
      context.fillRect(0, 0, 64, 84);
      context.fillStyle = "#5a5a5a";
      for (let line = 0; line < 12; line += 1) context.fillRect(6, 8 + line * 6, 30 + Math.random() * 22, 2);
    });
    const material = b.own(new THREE.MeshStandardMaterial({ map: page, roughness: 0.9 }));
    const geometry = b.own(new THREE.PlaneGeometry(0.21, 0.28));
    for (let index = 0; index < 46; index += 1) {
      const wall = index % 3;
      const mesh = new THREE.Mesh(geometry, material);
      const u = Math.random();
      const v = 0.6 + Math.random() * 1.6;
      const holder = new THREE.Group();
      holder.add(mesh);
      if (wall === 0) b.object(holder, [-2.2 + u * 4.4, -2.13, y + v], 0);
      else if (wall === 1) b.object(holder, [2.43, -2 + u * 4, y + v], -90);
      else b.object(holder, [-2.43, -2 + u * 3, y + v], 90);
      mesh.rotation.z = (Math.random() - 0.5) * 0.2;
    }
    b.box({ at: [0.8, 1.2, y], size: [1.9, 0.18, 0.9], turn: 10, mat: "fabric", color: 0x6a7a8a, solid: false });
    const screen = textTexture(b, 128, 80, (context) => {
      context.fillStyle = "#0e2230";
      context.fillRect(0, 0, 128, 80);
      context.fillStyle = "#7fc0d8";
      for (let line = 0; line < 8; line += 1) context.fillRect(8, 8 + line * 8, 40 + Math.random() * 70, 3);
    });
    b.box({ at: [-0.6, 0.4, y], size: [0.34, 0.02, 0.24], mat: "paint", color: 0x222222, solid: false });
    plate(b, 0.32, 0.2, screen, [-0.6, 0.3, y + 0.14], 180, 0.3, true);
    b.spot("sara", [-0.4, 0.9, y], 200);
    b.spot("cam-a", [1.9, -1.6, y + 1.5], 0);
    b.spot("look-a", [-0.4, 0.9, y + 0.6], 0);
    b.spot("cam-b", [-1.6, -1.2, y + 1.2], 0);
    b.spot("look-b", [0.2, 2.1, y + 1.4], 0);
  },
};

export const VIKTOR: LevelDefinition = {
  id: "viktor",
  // Under the rock on the rocky island to the east: a narrow technical room, a vent shaft to the surf.
  frame: { x: 5841, z: -5620, y: 0, bearing: 90 },
  range: 3000,
  pads: [{ at: [0, 0], w: 9, d: 8, height: 0.9, blend: 3, clear: 2 }],
  build: (b) => {
    const y = 1.0;
    b.slab([0, 0], 6, 4, y, { thick: 0.2, mat: "concrete", color: 0x9a968c });
    for (const [a, c] of [
      [[-3, -2], [3, -2]],
      [[-3, 2], [3, 2]],
      [[-3, -2], [-3, 2]],
      [[3, -2], [3, 2]],
    ] as const) {
      b.wall(a, c, { y, height: 2.5, thick: 0.3, mat: "concrete", color: 0x8c887e });
    }
    b.slab([0, 0], 6.6, 4.6, y + 2.6, { thick: 0.5, mat: "rock", color: 0x8e8a80 });
    // The vent shaft, a slot of daylight.
    b.box({ at: [2.4, 1.6, y + 2.5], size: [0.6, 1.4, 0.6], mat: "rust", color: 0xffffff, solid: false });
    // Racks, a desk with monitors playing the test footage, a whiteboard with names.
    shelves(b, [-2.7, 0.5, y], 90, 2.4);
    desk(b, [0.5, 1.6, y], 0, 2.2);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 160;
    const context = canvas.getContext("2d")!;
    const footage = b.own(new THREE.CanvasTexture(canvas));
    footage.colorSpace = THREE.SRGBColorSpace;
    let frame = 0;
    const draw = (t: number) => {
      context.fillStyle = "#06121a";
      context.fillRect(0, 0, 256, 160);
      context.strokeStyle = "#3fb0d0";
      context.lineWidth = 2;
      context.beginPath();
      for (let x = 0; x < 256; x += 4) context.lineTo(x, 90 + Math.sin(x * 0.05 + t * 3) * 18 * Math.sin(t + x * 0.01));
      context.stroke();
      context.fillStyle = "#d8eef4";
      context.font = "12px monospace";
      context.fillText(`AQUILON · TEST 07 · 03:12:${String(Math.floor(t * 4) % 60).padStart(2, "0")}`, 8, 18);
      context.fillStyle = "rgba(255,255,255,0.05)";
      for (let line = 0; line < 160; line += 3) context.fillRect(0, line, 256, 1);
    };
    draw(0);
    plate(b, 0.7, 0.44, footage, [0.2, 1.75, y + 1.15], 180, 0, true);
    plate(b, 0.5, 0.32, footage, [1.1, 1.8, y + 1.05], 200, 0, true);
    b.animate((delta, elapsed) => {
      frame += delta;
      if (frame < 0.1) return;
      frame = 0;
      draw(elapsed);
      footage.needsUpdate = true;
    });
    const board = textTexture(b, 256, 128, (context) => {
      context.fillStyle = "#f2f2ee";
      context.fillRect(0, 0, 256, 128);
      context.fillStyle = "#24344a";
      context.font = "16px sans-serif";
      context.fillText("ПРОТОКОЛ 7 — ДОПУСК:", 10, 24);
      context.fillText("Седов ✓   Холт ✓", 10, 50);
      context.fillText("Ногата ✓  ", 10, 76);
      // One name wiped out: a grey smear.
      context.fillStyle = "rgba(120,130,140,0.45)";
      context.fillRect(100, 62, 110, 20);
    });
    plate(b, 1.4, 0.7, board, [-1.2, -1.82, y + 1.5], 0);
    b.spot("viktor", [0.4, 1.0, y], 0);
    b.spot("cam-a", [-1.8, -1.2, y + 1.55], 0);
    b.spot("look-a", [0.4, 1.4, y + 1.2], 0);
    b.spot("cam-b", [1.6, -0.6, y + 1.6], 0);
    b.spot("look-b", [-1.2, -1.8, y + 1.5], 0);
  },
};

export const M01_PLACES: readonly LevelDefinition[] = [KOSAYA, WHITE_ROCKS, COVE, KENJI, SARA, VIKTOR];
