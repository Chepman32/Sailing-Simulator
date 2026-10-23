import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { HornKind } from "../audio/AudioMath";
import { seededRandom } from "../world/IslandTerrain";

/**
 * Procedural merchant ships. Each ship is built from a lofted steel hull with
 * waterline paint, merged superstructure blocks with a window texture (lit at
 * night), merged deck gear, and type-specific cargo: instanced containers,
 * clear-coated Moss LNG spheres, tanker pipework or stacked cruise decks.
 * Ships face +Z with the waterline at y = 0.
 */

export type ShipKind = HornKind;

export type ShipModel = {
  kind: ShipKind;
  group: THREE.Group;
  length: number;
  beam: number;
  /** Height of the main deck above the waterline. */
  freeboard: number;
  /** Local positions of navigation light glows. */
  masthead: THREE.Vector3;
  windowMaterial: THREE.MeshStandardMaterial;
  dispose: () => void;
};

type ShipSpec = {
  length: number;
  beam: number;
  freeboard: number;
  draft: number;
  hull: number;
  deck: number;
  boot: number;
};

const SPECS: Record<ShipKind, ShipSpec> = {
  container: { length: 196, beam: 30, freeboard: 7.5, draft: 10, hull: 0x1d4f7a, deck: 0x3c5a48, boot: 0x14181c },
  lng: { length: 210, beam: 34, freeboard: 9, draft: 10, hull: 0x23272e, deck: 0x4d5a52, boot: 0x14181c },
  tanker: { length: 184, beam: 32, freeboard: 5.5, draft: 11, hull: 0x161a1f, deck: 0x7a3a2c, boot: 0x0f1113 },
  cruise: { length: 224, beam: 30, freeboard: 11, draft: 8, hull: 0xf4f5f2, deck: 0x9a7f62, boot: 0x1b3c66 },
};

const ANTIFOULING = new THREE.Color(0x8c2b22);

function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute("uv");
  const value = new THREE.Color(color);
  const count = flat.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = value.r;
    colors[index * 3 + 1] = value.g;
    colors[index * 3 + 2] = value.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error("Ship geometry could not be merged.");
  merged.computeBoundingSphere();
  return merged;
}

/** Half-beam factor along the hull: transom stern, parallel midbody, fine bow. */
export function hullHalfBeamFactor(t: number): number {
  if (t < 0.12) return 0.8 + (t / 0.12) * 0.2;
  if (t <= 0.66) return 1;
  const bow = (t - 0.66) / 0.34;
  return Math.max(0.015, 1 - Math.pow(bow, 1.9));
}

function createHull(spec: ShipSpec): THREE.BufferGeometry {
  const stations = 44;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const hullColor = new THREE.Color(spec.hull);
  const bootColor = new THREE.Color(spec.boot);
  const deckColor = new THREE.Color(spec.deck);
  // Section profile (one side, deck edge → keel). Duplicated heights at the
  // paint lines give crisp boot-top and antifouling edges.
  const heights = [spec.freeboard, spec.freeboard * 0.5, 0.75, 0.7, -0.35, -0.4, -spec.draft * 0.6];
  const bilgeSteps = 4;
  const ringSize = (heights.length + bilgeSteps + 1) * 2;
  const color = new THREE.Color();
  const colorAt = (y: number): THREE.Color => {
    if (y > 0.72) return color.copy(hullColor);
    if (y > -0.37) return color.copy(bootColor);
    return color.copy(ANTIFOULING);
  };
  for (let station = 0; station <= stations; station += 1) {
    const t = station / stations;
    const z = (t - 0.5) * spec.length;
    const halfBeam = (spec.beam / 2) * hullHalfBeamFactor(t);
    // Forefoot and stern counter rise toward the ends.
    const keel = -spec.draft * (t > 0.9 ? 1 - (t - 0.9) / 0.1 * 0.55 : t < 0.05 ? 0.55 + t / 0.05 * 0.45 : 1);
    const sheer = t > 0.82 ? (t - 0.82) / 0.18 * 2.5 : 0;
    const bilge = Math.min(halfBeam * 0.9, spec.draft * 0.35);
    const ring: Array<[number, number]> = [];
    for (const height of heights) ring.push([halfBeam, Math.max(height + (height === spec.freeboard ? sheer : 0), keel + bilge)]);
    for (let step = 0; step <= bilgeSteps; step += 1) {
      const angle = (step / bilgeSteps) * (Math.PI / 2);
      ring.push([halfBeam - bilge + Math.cos(angle) * bilge, keel + bilge - Math.sin(angle) * bilge]);
    }
    // Port side is the mirror image, traversed keel → deck.
    const full = [...ring.map(([x, y]) => [-x, y] as [number, number]), ...ring.slice().reverse()];
    for (const [x, y] of full) {
      positions.push(x, y, z);
      colorAt(y);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let station = 0; station < stations; station += 1) {
    for (let index = 0; index < ringSize - 1; index += 1) {
      const a = station * ringSize + index;
      const b = a + ringSize;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  hull.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  hull.setIndex(indices);
  hull.computeVertexNormals();
  const hullFlat = hull.toNonIndexed();
  hull.dispose();

  // Deck plate between the two sheer lines, and a transom cap.
  const deckPositions: number[] = [];
  const deckColors: number[] = [];
  for (let station = 0; station < stations; station += 1) {
    const t0 = station / stations;
    const t1 = (station + 1) / stations;
    const z0 = (t0 - 0.5) * spec.length;
    const z1 = (t1 - 0.5) * spec.length;
    const w0 = (spec.beam / 2) * hullHalfBeamFactor(t0);
    const w1 = (spec.beam / 2) * hullHalfBeamFactor(t1);
    const y0 = spec.freeboard + (t0 > 0.82 ? (t0 - 0.82) / 0.18 * 2.5 : 0);
    const y1 = spec.freeboard + (t1 > 0.82 ? (t1 - 0.82) / 0.18 * 2.5 : 0);
    // Wound so the deck faces up (+Y).
    deckPositions.push(-w0, y0, z0, -w1, y1, z1, w0, y0, z0, w0, y0, z0, -w1, y1, z1, w1, y1, z1);
    for (let vertex = 0; vertex < 6; vertex += 1) deckColors.push(deckColor.r, deckColor.g, deckColor.b);
  }
  const transomHalf = (spec.beam / 2) * hullHalfBeamFactor(0);
  const zStern = -spec.length / 2;
  const transomBottom = -spec.draft * 0.55 + Math.min(transomHalf * 0.9, spec.draft * 0.35);
  // Transom faces aft (-Z).
  deckPositions.push(
    -transomHalf, spec.freeboard, zStern, transomHalf, spec.freeboard, zStern, transomHalf, transomBottom, zStern,
    -transomHalf, spec.freeboard, zStern, transomHalf, transomBottom, zStern, -transomHalf, transomBottom, zStern,
  );
  for (let vertex = 0; vertex < 6; vertex += 1) {
    deckColors.push(hullColor.r, hullColor.g, hullColor.b);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute("position", new THREE.Float32BufferAttribute(deckPositions, 3));
  deck.setAttribute("color", new THREE.Float32BufferAttribute(deckColors, 3));
  deck.computeVertexNormals();
  return merge([hullFlat, deck]);
}

function windowTexture(lit: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = lit ? "#000000" : "#f2f2ef";
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = lit ? "#ffd28a" : "#26323c";
    context.fillRect(10, 22, 44, 20);
    if (!lit) {
      context.fillStyle = "rgba(160, 200, 220, 0.35)";
      context.fillRect(10, 22, 44, 6);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A box whose UVs tile one window per `spacing` metres and per `floor` storey. */
function windowedBox(width: number, height: number, depth: number, spacing = 3.2, floor = 2.9): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z (four vertices each).
  const faces: Array<[number, number]> = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  faces.forEach(([u, v], face) => {
    const roof = face === 2 || face === 3;
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const index = face * 4 + vertex;
      // Roofs sample the solid wall colour (no windows).
      uv.setXY(index, roof ? 0.05 : uv.getX(index) * (u / spacing), roof ? 0.05 : uv.getY(index) * (v / floor));
    }
  });
  return geometry;
}

function containerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 128, 32);
    // Corrugation ribs and darker frame edges.
    for (let x = 0; x < 128; x += 4) {
      context.fillStyle = x % 8 === 0 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.12)";
      context.fillRect(x, 0, 2, 32);
    }
    context.fillStyle = "rgba(0,0,0,0.3)";
    context.fillRect(0, 0, 128, 2);
    context.fillRect(0, 30, 128, 2);
    context.fillRect(0, 0, 3, 32);
    context.fillRect(125, 0, 3, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createShip(kind: ShipKind, seed: number): ShipModel {
  const spec = SPECS[kind];
  const random = seededRandom(seed);
  const group = new THREE.Group();
  group.name = `Ship_${kind}`;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    geometries.push(geometry);
    group.add(mesh);
    return mesh;
  };

  const steel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  materials.push(steel);
  add(createHull(spec), steel, "Hull");

  const dayWindows = windowTexture(false);
  const nightWindows = windowTexture(true);
  textures.push(dayWindows, nightWindows);
  const windowMaterial = new THREE.MeshStandardMaterial({
    map: dayWindows,
    emissiveMap: nightWindows,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.42,
    metalness: 0.1,
  });
  materials.push(windowMaterial);

  const gear: THREE.BufferGeometry[] = [];
  const blocks: THREE.BufferGeometry[] = [];
  const F = spec.freeboard;
  const L = spec.length;
  const B = spec.beam;
  const funnelColor = kind === "cruise" ? 0x1f5fa8 : kind === "lng" ? 0xd9d6cf : kind === "tanker" ? 0x2a2a2a : 0xd9d6cf;
  const funnelBand = kind === "container" ? 0x2a9fd6 : kind === "lng" ? 0xc0392b : kind === "tanker" ? 0xe1b12c : 0xe74c3c;

  // Aft accommodation block (all but cruise ships).
  const accommodationZ = -L / 2 + (kind === "cruise" ? 0 : 20);
  if (kind !== "cruise") {
    const height = kind === "tanker" ? 24 : 21;
    const width = B * 0.86;
    blocks.push(windowedBox(width, height, 13).translate(0, F + height / 2, accommodationZ));
    // Bridge with wings.
    blocks.push(windowedBox(B + 2, 3.2, 6).translate(0, F + height + 1.6, accommodationZ + 3));
    gear.push(paint(new THREE.BoxGeometry(B * 0.6, 0.4, 7).translate(0, F + height + 3.4, accommodationZ + 3), 0xe8e8e2));
    // Radar mast and funnel behind the house.
    gear.push(paint(new THREE.CylinderGeometry(0.35, 0.45, 9, 8).translate(0, F + height + 7.5, accommodationZ + 1), 0xd8d8d0));
    gear.push(paint(new THREE.BoxGeometry(5, 0.3, 0.6).translate(0, F + height + 10, accommodationZ + 1), 0x333333));
    gear.push(paint(new THREE.BoxGeometry(8, 13, 7).translate(0, F + height - 1.5, accommodationZ - 9), funnelColor));
    gear.push(paint(new THREE.BoxGeometry(8.1, 2.2, 7.1).translate(0, F + height + 2.5, accommodationZ - 9), funnelBand));
    gear.push(paint(new THREE.BoxGeometry(8.2, 0.6, 7.2).translate(0, F + height + 5.3, accommodationZ - 9), 0x1a1a1a));
    // Lifeboats on davits.
    for (const side of [-1, 1]) {
      gear.push(paint(new THREE.CapsuleGeometry(1.4, 6, 4, 10).rotateX(Math.PI / 2).translate(side * (width / 2 + 1.6), F + 6, accommodationZ - 2), 0xf28c28));
    }
  }
  // Forecastle mast and windlass gear.
  gear.push(paint(new THREE.CylinderGeometry(0.3, 0.4, 12, 8).translate(0, F + 2.5 + 6, L / 2 - 14), 0xe0e0d8));
  gear.push(paint(new THREE.BoxGeometry(B * 0.5, 2.5, 7).translate(0, F + 2.5 + 1.25, L / 2 - 12), 0xd8d8d0));
  for (const side of [-1, 1]) gear.push(paint(new THREE.CylinderGeometry(1, 1, 1.4, 12).rotateZ(Math.PI / 2).translate(side * 3.5, F + 3.6, L / 2 - 18), 0x2c2f33));

  if (kind === "container") {
    const texture = containerTexture();
    textures.push(texture);
    const containerMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.25 });
    materials.push(containerMaterial);
    const palette = [0x2069b3, 0xb7322a, 0xe5e2da, 0x6d7378, 0x2f7d4a, 0xd97b29, 0x7a2f2f, 0x1c3d6e, 0xc9a227];
    const bayLength = 12.6;
    const firstBay = accommodationZ + 12;
    const lastBay = L / 2 - 26;
    const rows = Math.floor((B - 2) / 2.5);
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    for (let z = firstBay; z <= lastBay; z += bayLength + 0.5) {
      const bayTiers = 3 + Math.floor(random() * 4);
      for (let row = 0; row < rows; row += 1) {
        const tiers = Math.max(1, bayTiers - (random() < 0.25 ? 1 + Math.floor(random() * 2) : 0) - (row === 0 || row === rows - 1 ? 1 : 0));
        for (let tier = 0; tier < tiers; tier += 1) {
          matrices.push(
            new THREE.Matrix4().makeTranslation((row - (rows - 1) / 2) * 2.5, F + 1.35 + tier * 2.62, z + bayLength / 2),
          );
          colors.push(new THREE.Color(palette[Math.floor(random() * palette.length)]).multiplyScalar(0.85 + random() * 0.25));
        }
      }
      // Lashing bridge between bays.
      gear.push(paint(new THREE.BoxGeometry(B - 1, 3, 0.35).translate(0, F + 1.5, z - 0.3), 0x8a8f94));
    }
    const box = new THREE.BoxGeometry(2.44, 2.59, 12.2);
    const containers = new THREE.InstancedMesh(box, containerMaterial, matrices.length);
    matrices.forEach((matrix, index) => {
      containers.setMatrixAt(index, matrix);
      containers.setColorAt(index, colors[index]);
    });
    containers.castShadow = true;
    containers.receiveShadow = true;
    containers.name = "Containers";
    geometries.push(box);
    group.add(containers);
  }

  if (kind === "lng") {
    // Moss tanks: clear-coated spheres that throw small, intense highlights.
    const tankMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf1ede3,
      roughness: 0.34,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.045,
    });
    materials.push(tankMaterial);
    const tankRadius = 15.2;
    const tankCount = 4;
    const spacing = 37.5;
    const start = accommodationZ + 30;
    const tankParts: THREE.BufferGeometry[] = [];
    for (let index = 0; index < tankCount; index += 1) {
      const z = start + index * spacing;
      const sphere = new THREE.SphereGeometry(tankRadius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.62);
      sphere.translate(0, F + 7.5, z);
      tankParts.push(sphere);
      const skirt = new THREE.CylinderGeometry(tankRadius * 0.93, tankRadius * 0.98, 7.5, 48, 1, true);
      skirt.translate(0, F + 3.75, z);
      tankParts.push(skirt);
      // Dome valves on top of each tank.
      gear.push(paint(new THREE.CylinderGeometry(2.2, 2.4, 2.4, 16).translate(0, F + 7.5 + tankRadius + 0.6, z), 0x9aa3a8));
    }
    tankParts.forEach((part) => part.deleteAttribute("uv"));
    add(merge(tankParts), tankMaterial, "Moss_LNG_Tanks");
    // Pipe rack running fore and aft along the starboard side of the tanks.
    const rackLength = spacing * (tankCount - 1) + tankRadius * 2;
    const rackZ = start + (spacing * (tankCount - 1)) / 2;
    gear.push(paint(new THREE.BoxGeometry(2.6, 1.1, rackLength).translate(-B / 2 + 3, F + 5.5, rackZ), 0xb6b9b5));
    for (let z = rackZ - rackLength / 2; z <= rackZ + rackLength / 2; z += 9) {
      gear.push(paint(new THREE.BoxGeometry(0.5, 5, 0.5).translate(-B / 2 + 3, F + 2.5, z), 0x8d9290));
    }
  }

  if (kind === "tanker") {
    const deckStart = accommodationZ + 12;
    const deckEnd = L / 2 - 24;
    const length = deckEnd - deckStart;
    const centre = (deckStart + deckEnd) / 2;
    // Fore-and-aft pipelines, catwalk and the midship manifold crane.
    for (const x of [-4, -2.5, -1, 1, 2.5, 4]) {
      gear.push(paint(new THREE.CylinderGeometry(0.45, 0.45, length, 10).rotateX(Math.PI / 2).translate(x, F + 0.9, centre), 0x5e6a63));
    }
    gear.push(paint(new THREE.BoxGeometry(1.4, 0.2, length).translate(0, F + 3.2, centre), 0xc9c5b9));
    for (let z = deckStart; z <= deckEnd; z += 10) gear.push(paint(new THREE.BoxGeometry(0.3, 3, 0.3).translate(0, F + 1.6, z), 0x8d9290));
    gear.push(paint(new THREE.BoxGeometry(B * 0.7, 2.4, 3).translate(0, F + 1.2, centre), 0x6c7a72));
    gear.push(paint(new THREE.CylinderGeometry(0.5, 0.6, 12, 8).translate(B * 0.2, F + 6, centre - 4), 0xe0c040));
    gear.push(paint(new THREE.BoxGeometry(0.6, 0.6, 14).rotateX(-0.6).translate(B * 0.2, F + 13, centre + 1.5), 0xe0c040));
    // Hatches over the cargo tanks.
    for (let z = deckStart + 6; z < deckEnd; z += 16) {
      for (const x of [-9, 9]) gear.push(paint(new THREE.CylinderGeometry(0.9, 0.9, 0.7, 12).translate(x, F + 0.35, z), 0x8a5a44));
    }
  }

  if (kind === "cruise") {
    // Stacked, stepped decks of cabins with balconies, set back toward the bow.
    const levels = 9;
    for (let level = 0; level < levels; level += 1) {
      const length = L * (0.78 - level * 0.035);
      const width = B * (0.98 - level * 0.012);
      const z = -L * 0.06 + level * 1.4;
      blocks.push(windowedBox(width, 2.9, length, 2.6, 2.9).translate(0, F + 1.45 + level * 2.9, z));
    }
    const top = F + levels * 2.9;
    gear.push(paint(new THREE.BoxGeometry(B * 0.7, 1.2, L * 0.36).translate(0, top + 0.6, -L * 0.04), 0xf4f5f2));
    gear.push(paint(new THREE.BoxGeometry(12, 0.5, 8).translate(0, top + 1.45, L * 0.04), 0x3fb8e8));
    gear.push(paint(new THREE.CylinderGeometry(4.4, 5, 12, 20).scale(1, 1, 1.6).translate(0, top + 6, -L * 0.28), funnelColor));
    gear.push(paint(new THREE.CylinderGeometry(4.5, 4.5, 2, 20).scale(1, 1, 1.6).translate(0, top + 9, -L * 0.28), funnelBand));
    // Bridge front with wrap-around windows.
    blocks.push(windowedBox(B + 3, 3.4, 8, 2.2, 3.4).translate(0, top - 1.2, L * 0.33));
    for (const side of [-1, 1]) {
      for (let index = 0; index < 6; index += 1) {
        gear.push(paint(new THREE.CapsuleGeometry(1.6, 7, 4, 10).rotateX(Math.PI / 2).translate(side * (B / 2 + 0.6), F + 4.5, -L * 0.25 + index * 16), 0xf2a33a));
      }
    }
  }

  if (blocks.length > 0) {
    const merged = mergeGeometries(blocks, false);
    blocks.forEach((block) => block.dispose());
    if (merged) add(merged, windowMaterial, "Superstructure");
  }
  if (gear.length > 0) {
    const gearMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 });
    materials.push(gearMaterial);
    add(merge(gear), gearMaterial, "DeckGear");
  }

  const mastheadHeight = kind === "cruise" ? F + 9 * 2.9 + 10 : F + (kind === "tanker" ? 24 : 21) + 12;
  return {
    kind,
    group,
    length: L,
    beam: B,
    freeboard: F,
    masthead: new THREE.Vector3(0, mastheadHeight, accommodationZ + 1),
    windowMaterial,
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
    },
  };
}
