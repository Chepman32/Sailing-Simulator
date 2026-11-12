import * as THREE from "three";

/**
 * How the story's people are dressed. Everyone is one of the two rigged
 * base figures (a man, a woman: `public/models/trader-*.glb`), whose
 * texture is a patchwork of skin, a grey shirt, dark trousers and hair;
 * a look repaints those (`recolourFigure`: each texel sorted by its colour
 * into skin, shirt, trousers or hair and shifted to the look's colour, its
 * shading kept) and adds kit worn on the bones: a light plate carrier, a
 * helmet, a panama or a cap, glasses, a headset, a medical bag, a carbine
 * or a pistol in the hands.
 */

export type ActorModel = "man" | "woman";

export type Headgear = "none" | "helmet" | "panama" | "cap" | "headset";

export type ActorLook = {
  model: ActorModel;
  skin: number;
  shirt: number;
  trousers: number;
  hair: number;
  /** The plate carrier's colour, or null for none. */
  vest: number | null;
  head: Headgear;
  headColor?: number;
  glasses?: boolean;
  /** A medical bag on a strap (Maya), goggles round the neck (Kenji), an armband (Mark). */
  bag?: boolean;
  goggles?: boolean;
  armband?: boolean;
  /** Overall size (1 = the model's own, about 1.8 m). */
  scale?: number;
};

/** Skin tones from fair to dark (multiplied into the texture's skin, its shading kept). */
export const SKIN = { fair: 0xf2c9a8, light: 0xe2b08a, olive: 0xc99268, tan: 0xa8714c, brown: 0x7e5136, dark: 0x5a3824 } as const;

export const UNIFORM = {
  olive: 0x6f7550,
  sand: 0xb8a57c,
  khaki: 0x9a8a64,
  greyGreen: 0x5f6a5c,
  cargo: 0x5c5a48,
} as const;

// --- Texture recolouring ------------------------------------------------------

type Classified = { width: number; height: number; source: Uint8ClampedArray; kind: Uint8Array; shade: Float32Array };

const classifiedCache = new WeakMap<object, Classified>();
const textureCache = new Map<string, THREE.Texture>();

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/** 0 untouched, 1 skin, 2 shirt (grey), 3 trousers (dark), 4 hair (dark brown). */
function classify(r: number, g: number, b: number): number {
  const [h, s, v] = rgbToHsv(r / 255, g / 255, b / 255);
  if (s < 0.14 && v > 0.32) return 2;
  if (v < 0.42 && b >= r * 0.95 && s < 0.45) return 3;
  if (v < 0.5 && h >= 12 && h <= 45 && s > 0.3) return 4;
  if (h <= 40 && s >= 0.12 && s <= 0.62 && v > 0.45) return 1;
  return 0;
}

function classifyImage(image: CanvasImageSource & { width: number; height: number }): Classified | null {
  const cached = classifiedCache.get(image);
  if (cached) return cached;
  const size = Math.min(1024, image.width);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  const kind = new Uint8Array(size * size);
  const shade = new Float32Array(size * size);
  // The mean brightness of each class, so a texel's shading is kept relative to it.
  const sums = [0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0];
  for (let index = 0; index < size * size; index += 1) {
    const r = data[index * 4]!;
    const g = data[index * 4 + 1]!;
    const b = data[index * 4 + 2]!;
    const k = classify(r, g, b);
    kind[index] = k;
    const luma = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    shade[index] = luma;
    sums[k]! += luma;
    counts[k]! += 1;
  }
  for (let index = 0; index < size * size; index += 1) {
    const k = kind[index]!;
    if (k === 0) continue;
    shade[index] = shade[index]! / Math.max(0.05, sums[k]! / Math.max(1, counts[k]!));
  }
  const result = { width: size, height: size, source: data, kind, shade };
  classifiedCache.set(image, result);
  return result;
}

/**
 * The figure's base colour texture repainted for a look (cached by colours);
 * null if the image cannot be read (then the model keeps its own).
 */
export function recolourFigure(base: THREE.Texture, look: ActorLook): THREE.Texture | null {
  const key = `${base.uuid}:${look.skin}:${look.shirt}:${look.trousers}:${look.hair}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const image = base.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!image || !image.width || typeof document === "undefined") return null;
  const classified = classifyImage(image);
  if (!classified) return null;
  const { width, height, source, kind, shade } = classified;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const out = context.createImageData(width, height);
  const colours = [null, look.skin, look.shirt, look.trousers, look.hair].map((hex) => (hex === null ? null : new THREE.Color(hex)));
  for (let index = 0; index < width * height; index += 1) {
    const k = kind[index]!;
    const colour = colours[k];
    if (!colour) {
      out.data[index * 4] = source[index * 4]!;
      out.data[index * 4 + 1] = source[index * 4 + 1]!;
      out.data[index * 4 + 2] = source[index * 4 + 2]!;
    } else {
      // Folds and creases kept, a little contrast taken out (cloth in the sun).
      const s = 0.25 + 0.75 * shade[index]!;
      out.data[index * 4] = Math.min(255, colour.r * 255 * s);
      out.data[index * 4 + 1] = Math.min(255, colour.g * 255 * s);
      out.data[index * 4 + 2] = Math.min(255, colour.b * 255 * s);
    }
    out.data[index * 4 + 3] = 255;
  }
  context.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = base.flipY;
  texture.wrapS = base.wrapS;
  texture.wrapT = base.wrapT;
  texture.anisotropy = 4;
  textureCache.set(key, texture);
  return texture;
}

// --- Kit -----------------------------------------------------------------------

const kitMaterials = new Map<string, THREE.MeshStandardMaterial>();

export function kitMaterial(color: number, roughness = 0.85, metalness = 0.05): THREE.MeshStandardMaterial {
  const key = `${color}:${roughness}:${metalness}`;
  let material = kitMaterials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    kitMaterials.set(key, material);
  }
  return material;
}

const geometries = new Map<string, THREE.BufferGeometry>();

function shared(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = geometries.get(key);
  if (!geometry) geometries.set(key, (geometry = make()));
  return geometry;
}

function part(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

/**
 * A worn piece in the figure's own frame at rest (+x its left, +y up, +z
 * forward, metres from the soles of a 1.8 m figure), and the bone it rides on.
 */
export type WornPiece = { bone: "Spine02" | "Spine01" | "Head" | "Hips" | "LeftArm" | "neck"; object: THREE.Object3D };

/** A light plate carrier: a shell hugging the chest (front and back plates under cloth), shoulder straps, pouches, a radio. */
function vest(color: number): THREE.Group {
  const group = new THREE.Group();
  const cloth = kitMaterial(color, 0.92);
  const webbing = kitMaterial(new THREE.Color(color).multiplyScalar(0.78).getHex(), 0.95);
  // The carrier: an open sleeve round the torso, a little deeper in front where the plate is.
  const shell = shared("vest-shell", () => {
    const geometry = new THREE.CylinderGeometry(0.182, 0.17, 0.34, 18, 1, true);
    geometry.scale(1, 1, 0.84);
    geometry.translate(0, 0, 0.005);
    return geometry;
  });
  const sleeve = part(group, shell, cloth, 0, 1.27, 0);
  (sleeve.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const strap = shared("vest-strap", () => new THREE.BoxGeometry(0.055, 0.025, 0.27));
  for (const side of [-1, 1]) part(group, strap, webbing, side * 0.1, 1.45, 0);
  const pouch = shared("vest-pouch", () => new THREE.BoxGeometry(0.07, 0.11, 0.045));
  for (const x of [-0.085, 0, 0.085]) part(group, pouch, webbing, x, 1.19, 0.16);
  part(group, shared("vest-radio", () => new THREE.BoxGeometry(0.045, 0.1, 0.03)), kitMaterial(0x34372f, 0.7), 0.12, 1.33, 0.155);
  return group;
}

function headgear(kind: Headgear, color: number): THREE.Group | null {
  if (kind === "none") return null;
  const group = new THREE.Group();
  // The head's crown is some 1.72 m up, its centre about 1.62 m.
  if (kind === "helmet") {
    const shell = shared("helmet", () => new THREE.SphereGeometry(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52));
    part(group, shell, kitMaterial(color, 0.75), 0, 1.655, -0.005).scale.set(1, 0.95, 1.12);
    part(group, shared("helmet-rim", () => new THREE.TorusGeometry(0.133, 0.008, 6, 24)), kitMaterial(new THREE.Color(color).multiplyScalar(0.7).getHex(), 0.8), 0, 1.66, -0.005, Math.PI / 2).scale.set(1, 1.12, 1);
  } else if (kind === "panama") {
    part(group, shared("panama-crown", () => new THREE.CylinderGeometry(0.1, 0.112, 0.085, 20, 1, true)), kitMaterial(color, 0.95), 0, 1.73, 0);
    part(group, shared("panama-top", () => new THREE.CircleGeometry(0.1, 20)), kitMaterial(color, 0.95), 0, 1.772, 0, -Math.PI / 2);
    const brim = shared("panama-brim", () => {
      const geometry = new THREE.RingGeometry(0.105, 0.2, 24, 1);
      // A brim droops at its edge.
      const position = geometry.getAttribute("position");
      for (let index = 0; index < position.count; index += 1) {
        const r = Math.hypot(position.getX(index), position.getY(index));
        position.setZ(index, -(((r - 0.105) / 0.095) ** 2) * 0.03);
      }
      geometry.computeVertexNormals();
      return geometry;
    });
    const brimMesh = part(group, brim, kitMaterial(color, 0.95), 0, 1.69, 0, -Math.PI / 2);
    (brimMesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  } else if (kind === "cap") {
    part(group, shared("cap-crown", () => new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), kitMaterial(color, 0.9), 0, 1.69, -0.01).scale.set(1, 0.75, 1.1);
    part(group, shared("cap-peak", () => new THREE.BoxGeometry(0.17, 0.012, 0.09)), kitMaterial(color, 0.9), 0, 1.7, 0.12, 0.12);
  } else if (kind === "headset") {
    part(group, shared("headset-band", () => new THREE.TorusGeometry(0.105, 0.008, 6, 20, Math.PI)), kitMaterial(0x1d1f22, 0.5), 0, 1.66, 0, 0, Math.PI / 2);
    for (const side of [-1, 1]) part(group, shared("headset-cup", () => new THREE.CylinderGeometry(0.035, 0.035, 0.03, 14)), kitMaterial(0x1d1f22, 0.5), side * 0.1, 1.62, 0, 0, 0, Math.PI / 2);
    part(group, shared("headset-mic", () => new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6)), kitMaterial(0x1d1f22, 0.5), 0.085, 1.585, 0.06, Math.PI / 2.4, 0, 0.3);
  }
  return group;
}

function glasses(): THREE.Group {
  const group = new THREE.Group();
  const lens = shared("glasses-lens", () => new THREE.CircleGeometry(0.023, 14));
  const material = kitMaterial(0x101418, 0.08, 0.6);
  for (const side of [-1, 1]) {
    const mesh = part(group, lens, material, side * 0.033, 1.645, 0.118);
    mesh.scale.set(1.25, 1, 1);
  }
  part(group, shared("glasses-bridge", () => new THREE.BoxGeometry(0.11, 0.006, 0.006)), material, 0, 1.652, 0.118);
  return group;
}

/** The pieces a look wears (ridden on bones by `ActorBody`). */
export function wornPieces(look: ActorLook): WornPiece[] {
  const pieces: WornPiece[] = [];
  if (look.vest !== null) pieces.push({ bone: "Spine02", object: vest(look.vest) });
  const head = headgear(look.head, look.headColor ?? 0xd8cfb4);
  if (head) pieces.push({ bone: "Head", object: head });
  if (look.glasses) pieces.push({ bone: "Head", object: glasses() });
  if (look.bag) {
    const bag = new THREE.Group();
    part(bag, shared("bag", () => new THREE.BoxGeometry(0.09, 0.17, 0.24)), kitMaterial(0x2e5f6a, 0.9), 0.2, 0.98, 0.02);
    part(bag, shared("bag-cross", () => new THREE.BoxGeometry(0.012, 0.03, 0.03)), kitMaterial(0xd23a32, 0.6), 0.247, 1.0, 0.02);
    pieces.push({ bone: "Hips", object: bag });
    const strap = new THREE.Group();
    part(strap, shared("bag-strap", () => new THREE.BoxGeometry(0.035, 0.62, 0.012)), kitMaterial(0x24484f, 0.95), 0.02, 1.25, 0.12, 0, 0, -0.62);
    pieces.push({ bone: "Spine02", object: strap });
  }
  if (look.goggles) {
    const goggles = new THREE.Group();
    part(goggles, shared("goggles", () => new THREE.TorusGeometry(0.075, 0.012, 6, 18)), kitMaterial(0x30363a, 0.4, 0.3), 0, 1.47, 0.07, Math.PI / 2.3);
    pieces.push({ bone: "neck", object: goggles });
  }
  if (look.armband) {
    const band = new THREE.Group();
    part(band, shared("armband", () => new THREE.CylinderGeometry(0.052, 0.052, 0.05, 12, 1, true)), kitMaterial(0x7a2f2a, 0.9), 0.24, 1.33, -0.01, 0, 0, Math.PI / 2.6);
    pieces.push({ bone: "LeftArm", object: band });
  }
  return pieces;
}

// --- Guns ------------------------------------------------------------------------

export type GunKind = "carbine" | "pistol";

/**
 * A gun, modelled along +z (the muzzle forward), its grip at the origin; the
 * points the hands take (`grip`, `support`) and the `muzzle`, in its frame.
 */
export type GunModel = { object: THREE.Group; grip: THREE.Vector3; support: THREE.Vector3; muzzle: THREE.Vector3 };

export function gunModel(kind: GunKind): GunModel {
  const group = new THREE.Group();
  const metal = kitMaterial(0x1c1e21, 0.45, 0.7);
  const polymer = kitMaterial(0x2b2c2a, 0.7, 0.1);
  if (kind === "carbine") {
    part(group, shared("c-receiver", () => new THREE.BoxGeometry(0.05, 0.08, 0.34)), metal, 0, 0.03, 0.08);
    part(group, shared("c-guard", () => new THREE.BoxGeometry(0.052, 0.06, 0.24)), polymer, 0, 0.035, 0.36);
    part(group, shared("c-barrel", () => new THREE.CylinderGeometry(0.011, 0.012, 0.2, 8)), metal, 0, 0.04, 0.57, Math.PI / 2);
    part(group, shared("c-stock", () => new THREE.BoxGeometry(0.045, 0.1, 0.22)), polymer, 0, 0.0, -0.2);
    part(group, shared("c-mag", () => new THREE.BoxGeometry(0.035, 0.15, 0.065)), polymer, 0, -0.065, 0.13, 0.22);
    part(group, shared("c-grip", () => new THREE.BoxGeometry(0.035, 0.1, 0.045)), polymer, 0, -0.045, 0.0, -0.3);
    part(group, shared("c-sight", () => new THREE.BoxGeometry(0.035, 0.045, 0.08)), metal, 0, 0.095, 0.1);
    return { object: group, grip: new THREE.Vector3(0, -0.04, 0), support: new THREE.Vector3(0, 0.0, 0.36), muzzle: new THREE.Vector3(0, 0.04, 0.68) };
  }
  part(group, shared("p-slide", () => new THREE.BoxGeometry(0.03, 0.035, 0.18)), metal, 0, 0.05, 0.06);
  part(group, shared("p-grip", () => new THREE.BoxGeometry(0.028, 0.1, 0.045)), polymer, 0, -0.01, 0.0, -0.25);
  return { object: group, grip: new THREE.Vector3(0, 0, 0), support: new THREE.Vector3(0, -0.01, 0.015), muzzle: new THREE.Vector3(0, 0.05, 0.16) };
}

export function disposeLookCaches(): void {
  for (const texture of textureCache.values()) texture.dispose();
  textureCache.clear();
}
