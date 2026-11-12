import * as THREE from "three";

/**
 * The materials the story's built places are made of, with procedural
 * textures drawn once on canvases and shared by every level: sun-bleached
 * concrete with rain stains, whitewashed render streaked with salt,
 * corrugated sheet (its ridges in a normal map, its paint worn), rust,
 * weathered planks, glass, canvas, rubber. Geometry carries vertex colours
 * (paint, tint) and UVs in metres; a texture's repeat sets its scale.
 */

export type LevelMaterialKey =
  | "concrete"
  | "render"
  | "corrugated"
  | "rust"
  | "wood"
  | "paint"
  | "glass"
  | "fabric"
  | "rubber"
  | "road"
  | "rock"
  | "leaf"
  | "sand";

type Kit = Record<LevelMaterialKey, THREE.Material>;

let kit: Kit | null = null;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  return { canvas: element, context: element.getContext("2d")! };
}

function texture(element: HTMLCanvasElement, repeat: number, color = true): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(element);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1 / repeat, 1 / repeat);
  map.anisotropy = 4;
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/** Soft blotches of a colour (stains, patches of paint, lichen). */
function blotches(context: CanvasRenderingContext2D, size: number, random: () => number, count: number, color: string, min: number, max: number, alpha: number): void {
  for (let index = 0; index < count; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = min + random() * (max - min);
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, color.replace("ALPHA", String(alpha * (0.4 + random() * 0.6))));
    gradient.addColorStop(1, color.replace("ALPHA", "0"));
    context.fillStyle = gradient;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      context.save();
      context.translate(ox, oy);
      context.fillRect(x - r, y - r, r * 2, r * 2);
      context.restore();
    }
  }
}

function grain(context: CanvasRenderingContext2D, size: number, random: () => number, amount: number): void {
  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const n = (random() - 0.5) * amount;
    data[index] = Math.max(0, Math.min(255, data[index]! + n));
    data[index + 1] = Math.max(0, Math.min(255, data[index + 1]! + n));
    data[index + 2] = Math.max(0, Math.min(255, data[index + 2]! + n));
  }
  context.putImageData(image, 0, 0);
}

function concreteTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas: element, context } = canvas(size);
  const random = rng(11);
  context.fillStyle = "#c9c6bd";
  context.fillRect(0, 0, size, size);
  blotches(context, size, random, 40, "rgba(120,114,100,ALPHA)", 20, 90, 0.18);
  blotches(context, size, random, 30, "rgba(235,232,222,ALPHA)", 30, 110, 0.22);
  blotches(context, size, random, 12, "rgba(95,92,70,ALPHA)", 8, 30, 0.2);
  // Form-work seams and the odd crack.
  context.strokeStyle = "rgba(90,86,78,0.28)";
  context.lineWidth = 1.2;
  for (let y = 0; y < size; y += 128) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(size, y + 0.5);
    context.stroke();
  }
  context.strokeStyle = "rgba(60,58,52,0.35)";
  for (let index = 0; index < 5; index += 1) {
    let x = random() * size;
    let y = random() * size;
    context.beginPath();
    context.moveTo(x, y);
    for (let step = 0; step < 12; step += 1) {
      x += (random() - 0.5) * 18;
      y += random() * 12;
      context.lineTo(x, y);
    }
    context.stroke();
  }
  grain(context, size, random, 26);
  return texture(element, 3);
}

function renderTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas: element, context } = canvas(size);
  const random = rng(23);
  context.fillStyle = "#f1eee6";
  context.fillRect(0, 0, size, size);
  blotches(context, size, random, 24, "rgba(205,198,182,ALPHA)", 30, 120, 0.25);
  // Salt and rain run down from every sill and ledge.
  for (let index = 0; index < 90; index += 1) {
    const x = random() * size;
    const y = random() * size * 0.6;
    const length = 40 + random() * 220;
    const gradient = context.createLinearGradient(x, y, x, y + length);
    const tone = random() < 0.6 ? "150,138,112" : "120,112,96";
    gradient.addColorStop(0, `rgba(${tone},${0.08 + random() * 0.14})`);
    gradient.addColorStop(1, `rgba(${tone},0)`);
    context.fillStyle = gradient;
    context.fillRect(x, y, 1.5 + random() * 4, length);
  }
  // Grime splashed up from the ground along the foot of the wall.
  const foot = context.createLinearGradient(0, size, 0, size * 0.78);
  foot.addColorStop(0, "rgba(120,104,80,0.35)");
  foot.addColorStop(1, "rgba(120,104,80,0)");
  context.fillStyle = foot;
  context.fillRect(0, size * 0.78, size, size * 0.22);
  grain(context, size, random, 14);
  return texture(element, 4);
}

function corrugatedTextures(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const size = 256;
  const ridges = 13;
  const { canvas: colourCanvas, context } = canvas(size);
  const random = rng(37);
  context.fillStyle = "#d8d8d2";
  context.fillRect(0, 0, size, size);
  // Paint worn off the crests, rust bleeding from the fixings.
  for (let index = 0; index < ridges; index += 1) {
    const x = ((index + 0.5) / ridges) * size;
    context.fillStyle = "rgba(255,255,250,0.18)";
    context.fillRect(x - 2, 0, 4, size);
  }
  blotches(context, size, random, 26, "rgba(150,90,50,ALPHA)", 4, 22, 0.35);
  for (let index = 0; index < 18; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const gradient = context.createLinearGradient(x, y, x, y + 70);
    gradient.addColorStop(0, "rgba(140,72,34,0.45)");
    gradient.addColorStop(1, "rgba(140,72,34,0)");
    context.fillStyle = gradient;
    context.fillRect(x - 1.5, y, 3, 70);
  }
  grain(context, size, random, 18);
  const { canvas: normalCanvas, context: normalContext } = canvas(size);
  const image = normalContext.createImageData(size, size);
  for (let x = 0; x < size; x += 1) {
    const slope = Math.cos(((x / size) * ridges) * Math.PI * 2) * 0.85;
    const nx = -slope;
    const nz = 1;
    const length = Math.hypot(nx, nz);
    const r = Math.round(((nx / length) * 0.5 + 0.5) * 255);
    const b = Math.round(((nz / length) * 0.5 + 0.5) * 255);
    for (let y = 0; y < size; y += 1) {
      const index = (y * size + x) * 4;
      image.data[index] = r;
      image.data[index + 1] = 128;
      image.data[index + 2] = b;
      image.data[index + 3] = 255;
    }
  }
  normalContext.putImageData(image, 0, 0);
  return { map: texture(colourCanvas, 1), normal: texture(normalCanvas, 1, false) };
}

function rustTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas: element, context } = canvas(size);
  const random = rng(41);
  context.fillStyle = "#8a5232";
  context.fillRect(0, 0, size, size);
  blotches(context, size, random, 40, "rgba(60,34,20,ALPHA)", 6, 40, 0.4);
  blotches(context, size, random, 30, "rgba(176,104,52,ALPHA)", 6, 30, 0.45);
  grain(context, size, random, 40);
  return texture(element, 1.5);
}

function woodTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas: element, context } = canvas(size);
  const random = rng(53);
  const planks = 4;
  for (let index = 0; index < planks; index += 1) {
    const tone = 150 + random() * 40;
    context.fillStyle = `rgb(${tone},${tone * 0.86},${tone * 0.7})`;
    context.fillRect(0, (index * size) / planks, size, size / planks);
    // The grain runs along the plank.
    for (let line = 0; line < 22; line += 1) {
      context.strokeStyle = `rgba(80,60,40,${0.06 + random() * 0.12})`;
      context.lineWidth = 0.6 + random();
      const y = (index * size) / planks + random() * (size / planks);
      context.beginPath();
      context.moveTo(0, y);
      for (let x = 0; x <= size; x += 32) context.lineTo(x, y + (random() - 0.5) * 3);
      context.stroke();
    }
    context.fillStyle = "rgba(40,30,20,0.55)";
    context.fillRect(0, ((index + 1) * size) / planks - 2, size, 2);
  }
  grain(context, size, random, 16);
  return texture(element, 1.2);
}

function fabricTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas: element, context } = canvas(size);
  const random = rng(61);
  context.fillStyle = "#e8e1cc";
  context.fillRect(0, 0, size, size);
  for (let index = 0; index < size; index += 2) {
    context.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.03})`;
    context.fillRect(index, 0, 1, size);
    context.fillRect(0, index, size, 1);
  }
  blotches(context, size, random, 8, "rgba(140,120,90,ALPHA)", 10, 40, 0.18);
  return texture(element, 1);
}

function roadTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas: element, context } = canvas(size);
  const random = rng(71);
  context.fillStyle = "#e9e1cc";
  context.fillRect(0, 0, size, size);
  blotches(context, size, random, 60, "rgba(190,176,146,ALPHA)", 10, 60, 0.35);
  // Two wheel ruts.
  for (const x of [size * 0.3, size * 0.7]) {
    const gradient = context.createLinearGradient(x - 40, 0, x + 40, 0);
    gradient.addColorStop(0, "rgba(170,154,122,0)");
    gradient.addColorStop(0.5, "rgba(170,154,122,0.45)");
    gradient.addColorStop(1, "rgba(170,154,122,0)");
    context.fillStyle = gradient;
    context.fillRect(x - 40, 0, 80, size);
  }
  for (let index = 0; index < 900; index += 1) {
    context.fillStyle = `rgba(${random() < 0.5 ? "120,110,90" : "250,248,240"},${0.2 + random() * 0.4})`;
    context.fillRect(random() * size, random() * size, 1 + random() * 2.5, 1 + random() * 2.5);
  }
  return texture(element, 6);
}

function rockTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas: element, context } = canvas(size);
  const random = rng(83);
  context.fillStyle = "#c8c3b6";
  context.fillRect(0, 0, size, size);
  blotches(context, size, random, 50, "rgba(120,116,104,ALPHA)", 6, 40, 0.4);
  blotches(context, size, random, 20, "rgba(110,120,80,ALPHA)", 8, 30, 0.25);
  grain(context, size, random, 36);
  return texture(element, 2.5);
}

function sandTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas: element, context } = canvas(size);
  const random = rng(97);
  context.fillStyle = "#e4d3a6";
  context.fillRect(0, 0, size, size);
  for (let index = 0; index < 2500; index += 1) {
    context.fillStyle = `rgba(${random() < 0.5 ? "170,150,110" : "255,250,235"},${0.25 + random() * 0.4})`;
    context.fillRect(random() * size, random() * size, 1, 1);
  }
  return texture(element, 2);
}

/** The shared kit (built at first use: canvases need a document). */
export function levelMaterials(): Kit {
  if (kit) return kit;
  const corrugated = corrugatedTextures();
  const standard = (parameters: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...parameters });
  kit = {
    concrete: standard({ map: concreteTexture(), roughness: 0.92 }),
    render: standard({ map: renderTexture(), roughness: 0.88 }),
    corrugated: standard({ map: corrugated.map, normalMap: corrugated.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }),
    rust: standard({ map: rustTexture(), roughness: 0.85, metalness: 0.4 }),
    wood: standard({ map: woodTexture(), roughness: 0.82 }),
    paint: standard({ roughness: 0.6, metalness: 0.15 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xa8cdd6, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }),
    fabric: standard({ map: fabricTexture(), roughness: 0.95, side: THREE.DoubleSide }),
    rubber: standard({ roughness: 0.85, metalness: 0.05 }),
    road: standard({ map: roadTexture(), roughness: 0.97, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    rock: standard({ map: rockTexture(), roughness: 0.93, flatShading: true }),
    leaf: standard({ roughness: 0.7, side: THREE.DoubleSide }),
    sand: standard({ map: sandTexture(), roughness: 0.97 }),
  };
  for (const [key, material] of Object.entries(kit)) material.name = `Level_${key}`;
  return kit;
}
