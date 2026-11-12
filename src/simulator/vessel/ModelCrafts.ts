import * as THREE from "three";
import { drawnCraft, Kit, sportYacht as drawnSportYacht, type CraftModel } from "./CraftModels";

/**
 * The story's boats from their models (`/models/sport-yacht.glb`,
 * `/models/skiff-center-console.glb`), fitted to the craft frame of
 * `CraftModels` (bow +Z, up +Y, x to port, origin at the waterline
 * amidships):
 *
 * - **the sport yacht** of the prologue (and of the last chapter): an 11 m
 *   express cruiser, white (the model's red gelcoat whitened to the
 *   story's livery) with a black band, four outboards on
 *   her transom, a hardtop over the aft deck with a hatch and a ladder up.
 *   She is driven from the hardtop, where a flybridge helm (console, wheel,
 *   the display the network takes over, a bolster seat) is added;
 * - **the skiff** the skipper takes from Створ-9: a 6 m centre-console boat,
 *   the wheel behind a low windscreen, a leaning seat behind it, a padded
 *   seat in the bows and a bench aft, one outboard, turned with the helm.
 *
 * Until a model has come (`setCraftScenes`) the boat is drawn in code;
 * `Vessel` swaps it for the model when it arrives.
 */

export type CraftKind = "sport" | "skiff";
type SceneSource = (craft: CraftKind) => THREE.Group | null;

let source: SceneSource = () => null;

/** Where the boats' models come from (the asset manager's copies, null until loaded); null: drawn in code. */
export function setCraftScenes(next: SceneSource | null): void {
  source = next ?? (() => null);
}

/** The boat by id: from her model when it has loaded, else drawn in code. */
export function buildCraft(craft: CraftKind): CraftModel {
  const scene = source(craft);
  if (!scene) return drawnCraft(craft);
  return craft === "sport" ? modelSportYacht(scene) : modelSkiff(scene);
}

/** The sport yacht's wreck on the reef: her model blackened and broken, or the drawn one. */
export function wreckedSportYacht(): CraftModel {
  const scene = source("sport");
  return scene ? modelWreck(scene) : drawnSportYacht(true);
}

// --- Shared ------------------------------------------------------------------------------

/** Drops the model's stray line primitives, and lets every mesh cast and take shadows. */
function prepare(scene: THREE.Object3D): void {
  const lines: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Line).isLine || (object as THREE.Points).isPoints) lines.push(object);
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  for (const line of lines) line.removeFromParent();
}

function materialsOf(scene: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const found = new Set<THREE.MeshStandardMaterial>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material instanceof THREE.MeshStandardMaterial) found.add(material);
    }
  });
  return [...found];
}

/**
 * The helm's display: the chart and the speed, or the network's alert
 * blinking red over it. A small canvas, redrawn only when what it shows
 * changes (twice a second while the alert blinks).
 */
class HelmDisplay {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement | null;
  private alert: readonly string[] | null = null;
  private blink = 0;
  private lit = true;

  constructor() {
    this.canvas = typeof document === "undefined" ? null : document.createElement("canvas");
    if (this.canvas) {
      this.canvas.width = 256;
      this.canvas.height = 160;
    }
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.CanvasTexture(undefined as unknown as HTMLCanvasElement);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw();
  }

  setAlert(lines: readonly string[] | null): void {
    this.alert = lines;
    this.lit = true;
    this.blink = 0;
    this.draw();
  }

  update(delta: number): void {
    if (!this.alert) return;
    this.blink += delta;
    if (this.blink < 0.5) return;
    this.blink = 0;
    this.lit = !this.lit;
    this.draw();
  }

  private draw(): void {
    const context = this.canvas?.getContext("2d");
    if (!context) return;
    const { width, height } = context.canvas;
    if (this.alert) {
      context.fillStyle = this.lit ? "#7a0d0d" : "#2a0505";
      context.fillRect(0, 0, width, height);
      context.strokeStyle = "#ff5a4a";
      context.lineWidth = 4;
      context.strokeRect(6, 6, width - 12, height - 12);
      context.fillStyle = this.lit ? "#ffe4de" : "#ff7a6a";
      context.textAlign = "center";
      context.textBaseline = "middle";
      const lines = this.alert.length ? this.alert : ["!"];
      const size = lines.length > 2 ? 15 : 18;
      context.font = `700 ${size}px system-ui, sans-serif`;
      lines.forEach((line, index) => {
        const y = height / 2 + (index - (lines.length - 1) / 2) * (size + 10);
        wrapLine(context, line, width / 2, y, width - 28);
      });
    } else {
      // The chart: dark water, a coast, the track ahead, the speed.
      context.fillStyle = "#06182a";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#c8b88a";
      context.beginPath();
      context.moveTo(150, 0);
      context.bezierCurveTo(170, 40, 210, 50, 256, 46);
      context.lineTo(256, 0);
      context.closePath();
      context.fill();
      context.beginPath();
      context.ellipse(60, 40, 22, 12, 0.4, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#2c6a8f";
      context.lineWidth = 1;
      for (let index = 1; index < 5; index += 1) {
        context.beginPath();
        context.moveTo(0, index * 32);
        context.lineTo(width, index * 32 - 10);
        context.stroke();
      }
      context.strokeStyle = "#6fe0ff";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(128, 150);
      context.lineTo(128, 60);
      context.stroke();
      context.fillStyle = "#6fe0ff";
      context.beginPath();
      context.moveTo(128, 104);
      context.lineTo(120, 120);
      context.lineTo(136, 120);
      context.closePath();
      context.fill();
      context.fillStyle = "#e8f6ff";
      context.font = "700 22px system-ui, sans-serif";
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.fillText("31.4 kn", 12, 148);
    }
    this.texture.needsUpdate = true;
  }
}

function wrapLine(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number): void {
  if (context.measureText(text).width <= width) {
    context.fillText(text, x, y);
    return;
  }
  const scale = width / context.measureText(text).width;
  context.save();
  context.translate(x, y);
  context.scale(scale, 1);
  context.fillText(text, 0, 0);
  context.restore();
}

// --- The sport yacht ---------------------------------------------------------------------

/** The model's frame (metres, Y up, bow +Z): her length runs from z −0.71 to 10.65. */
const SPORT_MID_Z = 4.97;
/** Her waterline in the model (the keel at −0.43). */
const SPORT_WATERLINE = 0.02;
/** The hardtop's flat top, from just over the transom to where it falls to the windscreen. */
const SPORT_ROOF = 3.5 - SPORT_WATERLINE;

function tuneSportMaterials(scene: THREE.Object3D): void {
  const whitened = new Map<THREE.Texture, THREE.Texture>();
  for (const material of materialsOf(scene)) {
    if (material.userData.craftTuned) continue;
    material.userData.craftTuned = true;
    // Her livery as the story has her (the patrol reads it off her: "white hull,
    // black stripe on the stern"): the model's red gelcoat white, the black band kept.
    if (material.map) {
      let white = whitened.get(material.map);
      if (!white) {
        white = whitenRed(material.map);
        whitened.set(material.map, white);
      }
      material.map = white;
    } else if (isRed(material.color.r, material.color.g, material.color.b)) {
      material.color.setRGB(0.92, 0.92, 0.9);
    }
    // Exported dead matte: a gelcoat shines, the black band is near black glass.
    const dark = material.color.r + material.color.g + material.color.b < 0.2 && !material.map;
    material.roughness = dark ? 0.45 : 0.32;
    material.metalness = 0;
    material.envMapIntensity = 1.15;
    material.needsUpdate = true;
  }
}

function isRed(r: number, g: number, b: number): boolean {
  return r > 0.3 && r > g * 1.6 && r > b * 1.6;
}

/**
 * A copy of a texture with its reds turned to white gelcoat, the grain of
 * the paint kept as a faint grey; everything else as it was. The texture
 * itself if its picture cannot be read (no canvas: a test).
 */
function whitenRed(texture: THREE.Texture): THREE.Texture {
  const image = texture.image as CanvasImageSource & { width: number; height: number };
  if (typeof document === "undefined" || !image?.width) return texture;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return texture;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  let changed = 0;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]!;
    const g = data[index + 1]!;
    const b = data[index + 2]!;
    if (!isRed(r / 255, g / 255, b / 255)) continue;
    // The red's own light and dark (its grain) round a bright white.
    const shade = Math.max(206, Math.min(248, 232 + (r - 190) * 0.22));
    data[index] = shade;
    data[index + 1] = shade;
    data[index + 2] = shade - 3;
    changed += 1;
  }
  if (changed === 0) return texture;
  context.putImageData(pixels, 0, 0);
  const white = texture.clone();
  white.image = canvas;
  white.needsUpdate = true;
  return white;
}

function modelSportYacht(scene: THREE.Group): CraftModel {
  prepare(scene);
  tuneSportMaterials(scene);
  const kit = new Kit();
  const group = new THREE.Group();
  group.name = "SportYacht";
  scene.position.set(0, -SPORT_WATERLINE, -SPORT_MID_Z);
  group.add(scene);

  // The flybridge helm on the hardtop: a console with the wheel and the display, a bolster seat.
  const white = kit.material(new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.3, envMapIntensity: 1.1 }));
  const dark = kit.material(new THREE.MeshStandardMaterial({ color: 0x1d2125, roughness: 0.45, metalness: 0.35 }));
  const steel = kit.material(new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.16, metalness: 1, envMapIntensity: 1.3 }));
  const cushion = kit.material(new THREE.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.8 }));
  const display = new HelmDisplay();
  kit.textures.push(display.texture);
  const screen = kit.material(new THREE.MeshBasicMaterial({ map: display.texture, toneMapped: false }));
  const helmX = -0.42;
  const consoleZ = -1.62;
  const helm = new THREE.Group();
  helm.position.set(helmX, SPORT_ROOF, consoleZ);
  group.add(helm);
  // The console: a raked box, its face toward the seat.
  const body = kit.mesh(helm, new THREE.BoxGeometry(0.9, 0.82, 0.5), white, 0, 0.41, 0);
  body.rotation.x = 0.12;
  const face = kit.mesh(helm, new THREE.BoxGeometry(0.86, 0.06, 0.42), dark, 0, 0.84, -0.02);
  face.rotation.x = -0.55;
  // On the face, turned up and aft to the helmsman.
  const glass = kit.mesh(helm, new THREE.PlaneGeometry(0.42, 0.26), screen, -0.13, 0.87, -0.04, false);
  glass.rotation.set(-(Math.PI / 2 - 0.55), Math.PI, 0, "YXZ");
  const wheel = kit.mesh(helm, new THREE.TorusGeometry(0.19, 0.022, 8, 24), dark, 0.2, 0.86, -0.3);
  wheel.rotation.x = -0.75;
  kit.mesh(helm, new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), steel, 0.2, 0.82, -0.2).rotation.x = Math.PI / 2 - 0.75;
  const lever = kit.mesh(helm, new THREE.BoxGeometry(0.03, 0.18, 0.03), steel, -0.36, 0.95, -0.12);
  lever.rotation.x = 0.4;
  // A grab rail round the console.
  kit.tube(group, [
    new THREE.Vector3(helmX - 0.5, SPORT_ROOF, consoleZ + 0.2),
    new THREE.Vector3(helmX - 0.5, SPORT_ROOF + 0.95, consoleZ + 0.12),
    new THREE.Vector3(helmX + 0.5, SPORT_ROOF + 0.95, consoleZ + 0.12),
    new THREE.Vector3(helmX + 0.5, SPORT_ROOF, consoleZ + 0.2),
  ], 0.018, steel);
  // The bolster seat behind it.
  const seatZ = consoleZ - 0.82;
  kit.mesh(group, new THREE.CylinderGeometry(0.05, 0.08, 0.5, 10), steel, helmX, SPORT_ROOF + 0.25, seatZ);
  kit.mesh(group, new THREE.BoxGeometry(0.52, 0.12, 0.46), cushion, helmX, SPORT_ROOF + 0.56, seatZ);
  kit.mesh(group, new THREE.BoxGeometry(0.52, 0.42, 0.1), cushion, helmX, SPORT_ROOF + 0.8, seatZ - 0.24).rotation.x = -0.12;

  return {
    group,
    eye: new THREE.Vector3(helmX, SPORT_ROOF + 1.36, seatZ + 0.12),
    seats: [{ x: helmX, y: SPORT_ROOF, z: seatZ + 0.04, yaw: 0, sit: true, seat: 0.6 }],
    update: (delta) => display.update(delta),
    dispose: () => kit.dispose(),
    modelled: true,
    setAlert: (lines) => display.setAlert(lines),
  };
}

/** The wreck: her model blackened by fire, torn aft, her hardtop askew. */
function modelWreck(scene: THREE.Group): CraftModel {
  prepare(scene);
  tuneSportMaterials(scene);
  const kit = new Kit();
  const group = new THREE.Group();
  group.name = "SportYachtWreck";
  // Her own materials stay hers: the wreck's are copies, sooted.
  const sooted = new Map<THREE.Material, THREE.Material>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (material: THREE.Material) => {
      let copy = sooted.get(material);
      if (!copy) {
        const made = material.clone() as THREE.MeshStandardMaterial;
        if (made.color) made.color.multiplyScalar(0.5).lerp(new THREE.Color(0x2a2522), 0.35);
        made.roughness = 0.85;
        made.metalness = 0;
        copy = kit.material(made);
        sooted.set(material, copy);
      }
      return copy;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  scene.position.set(0, -SPORT_WATERLINE, -SPORT_MID_Z);
  group.add(scene);
  // The transom stove in, a black scorch over the quarter.
  const char = kit.material(new THREE.MeshStandardMaterial({ color: 0x181614, roughness: 0.95 }));
  kit.mesh(group, new THREE.BoxGeometry(3.0, 1.3, 1.8), char, 0, 0.9, -5.0);
  kit.mesh(group, new THREE.BoxGeometry(1.4, 0.9, 1.2), char, 0.9, 1.6, -3.8).rotation.set(0.2, 0.3, 0.15);
  return {
    group,
    eye: new THREE.Vector3(0, SPORT_ROOF + 1.3, -2),
    seats: [],
    update: () => undefined,
    dispose: () => kit.dispose(),
    modelled: true,
  };
}

// --- The skiff ---------------------------------------------------------------------------

/** The model's frame: bow +X, deck at y 0.74, the transom at x −2.51. */
const SKIFF_WATERLINE = 0.45;
const SKIFF_DECK = 0.74 - SKIFF_WATERLINE;

function tuneSkiffMaterials(scene: THREE.Object3D): void {
  for (const material of materialsOf(scene)) {
    if (material.userData.craftTuned) continue;
    material.userData.craftTuned = true;
    if (/glazing/iu.test(material.name)) {
      // Clear acrylic, exported as an opaque white sheet.
      material.color.set(0x7d929a);
      material.transparent = true;
      material.opacity = 0.32;
      material.depthWrite = false;
      material.roughness = 0.04;
      material.metalness = 0.1;
      material.side = THREE.DoubleSide;
      material.envMapIntensity = 1.6;
    } else {
      material.envMapIntensity = 1.1;
    }
    material.needsUpdate = true;
  }
}

function modelSkiff(scene: THREE.Group): CraftModel {
  prepare(scene);
  tuneSkiffMaterials(scene);
  const group = new THREE.Group();
  group.name = "Skiff";
  // Bow +X in the model: a quarter turn puts it on +Z (and her red lens to port).
  scene.rotation.y = -Math.PI / 2;
  scene.position.set(0, -SKIFF_WATERLINE, 0);
  group.add(scene);
  // The outboard (its leg and the clamp) on a pivot at the transom, to turn with the helm.
  const pivot = new THREE.Group();
  pivot.position.set(-2.55, 0.75, 0);
  scene.add(pivot);
  scene.updateMatrixWorld(true);
  const outboard: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && /outboard/iu.test(object.name)) outboard.push(object);
  });
  for (const part of outboard) pivot.attach(part);

  // A seat's height over the deck, from its top in the model.
  const sit = (top: number) => top - 0.74;
  return {
    group,
    eye: new THREE.Vector3(0, SKIFF_DECK + 0.42 + 0.8, -0.1),
    seats: [
      // The helmsman on the leaning seat behind the console.
      { x: 0, y: SKIFF_DECK, z: -0.2, yaw: 0, sit: true, seat: sit(1.16) },
      // Mark on the bench aft, turned to watch astern.
      { x: -0.36, y: SKIFF_DECK, z: -1.86, yaw: Math.PI * 0.92, sit: true, seat: sit(1.09) },
      // A third beside him, facing forward: out of the helmsman's view over the bow.
      { x: 0.38, y: SKIFF_DECK, z: -1.8, yaw: 0.15, sit: true, seat: sit(1.09) },
    ],
    update: (_delta, rudder) => {
      pivot.rotation.y = rudder * 0.5;
    },
    dispose: () => undefined,
    modelled: true,
  };
}
