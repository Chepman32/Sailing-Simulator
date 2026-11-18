import * as THREE from "three";
import { drawnCraft, Kit, sportYacht as drawnSportYacht, type CraftModel } from "./CraftModels";

/**
 * The story's boats from their models (`/models/motoryacht-35.glb`,
 * `/models/skiff-center-console.glb`), fitted to the craft frame of
 * `CraftModels` (bow +Z, up +Y, x to port, origin at the waterline
 * amidships):
 *
 * - **the sport yacht** of the prologue: an open 11 m cruiser
 *   (`/models/motoryacht-35.glb`), her topsides whitened to the story's
 *   livery (the patrol reads "white hull, black stripe on the stern" off
 *   her), driven from the helm under her hardtop; the chart screen there is
 *   the display the network takes over, and her open cockpit is where the
 *   skipper runs about as she floods (`CraftModel.deck`);
 * - **the skiff** the skipper takes from Створ-9: a 6 m centre-console boat,
 *   the wheel behind a low windscreen, a leaning seat behind it, a padded
 *   seat in the bows and a bench aft, one outboard, turned with the helm.
 *
 * Until a model has come (`setCraftScenes`) the boat is drawn in code;
 * `Vessel` swaps it for the model when it arrives.
 */

export type CraftKind = "sport" | "skiff" | "albatross";
type SceneSource = (craft: CraftKind) => THREE.Group | null;

let source: SceneSource = () => null;

/** Where the boats' models come from (the asset manager's copies, null until loaded); null: drawn in code. */
export function setCraftScenes(next: SceneSource | null): void {
  source = next ?? (() => null);
}

/** The boat by id: from her model when it has loaded, else drawn in code. */
export function buildCraft(craft: CraftKind): CraftModel {
  // The Albatross is drawn in code only.
  const scene = craft === "albatross" ? null : source(craft);
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

/**
 * The model's frame (`/models/motoryacht-35.glb`): an open 35-foot
 * cruiser 4.75 units long, bow toward −Z, Y up. Scaled to her 11.4 m and
 * turned bow +Z.
 */
const SPORT_SCALE = 2.4;
const SPORT_MID_Z = -0.077;
/** Her waterline in the model (the boot top). */
const SPORT_WATERLINE = 0.32;
/** In the model: the cockpit's teak sole, the helm seat's top, the helm's centre line. */
const SPORT_SOLE = 0.51;
const SPORT_SEAT = 0.83;
const SPORT_HELM = { x: 0.27, z: 0.04 };
/** The model's point in the craft frame. */
const sportPoint = (x: number, y: number, z: number) =>
  new THREE.Vector3(-x * SPORT_SCALE, (y - SPORT_WATERLINE) * SPORT_SCALE, -(z - SPORT_MID_Z) * SPORT_SCALE);

function tuneSportMaterials(scene: THREE.Object3D): void {
  for (const material of materialsOf(scene)) {
    if (material.userData.craftTuned) continue;
    material.userData.craftTuned = true;
    const name = material.name;
    // Her livery as the story has her (the patrol reads it off her: "white hull,
    // black stripe on the stern"): the model's black topsides and hardtop white,
    // her black trim (the band aft) kept.
    if (name === "fiancate") material.color.setRGB(0.9, 0.91, 0.9);
    if (name === "fiancate" || name === "coperta1") {
      material.roughness = 0.28;
      material.envMapIntensity = 1.2;
    }
    if (material.transparent) {
      // The windscreen and the hatches: tinted glass, seen through.
      material.depthWrite = false;
      material.roughness = 0.05;
      material.opacity = Math.min(material.opacity, 0.45);
    }
    material.metalness = 0;
    material.needsUpdate = true;
  }
}

/** The model's own flag (an Italian ensign on her hardtop) and its staff: not hers here. */
function dropFlag(scene: THREE.Object3D): void {
  const flag: THREE.Object3D[] = [];
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material;
    if (/^(lambert4|lambert5|lambert6|phongE4)$/u.test(material.name)) flag.push(mesh);
  });
  for (const mesh of flag) mesh.removeFromParent();
}

/** The helm's chart screen in the model: the display the network takes over. */
function helmScreen(scene: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && (mesh.material as THREE.Material).name === "lambert1") found = mesh;
  });
  return found;
}

/** Puts the display on the model's screen: its own copy of the quad, its corners mapped flat to the picture. */
function fitDisplay(mesh: THREE.Mesh, material: THREE.Material, kit: Kit): void {
  const geometry = mesh.geometry.clone();
  kit.geometries.push(geometry);
  const position = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  // The screen lies across x (its width) and rises along z/y (its height): map those.
  const across = size.x >= size.z ? "x" : "z";
  const up = size.y >= Math.min(size.x, size.z) ? "y" : across === "x" ? "z" : "x";
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const u = (position.getComponent(index, across === "x" ? 0 : 2) - box.min[across]) / Math.max(1e-6, size[across]);
    const v = (position.getComponent(index, up === "y" ? 1 : up === "z" ? 2 : 0) - box.min[up]) / Math.max(1e-6, size[up]);
    uv[index * 2] = u;
    uv[index * 2 + 1] = up === "z" ? 1 - v : v;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  mesh.geometry = geometry;
  mesh.material = material;
}

function modelSportYacht(scene: THREE.Group): CraftModel {
  prepare(scene);
  dropFlag(scene);
  tuneSportMaterials(scene);
  const kit = new Kit();
  const group = new THREE.Group();
  group.name = "SportYacht";
  const hull = new THREE.Group();
  hull.add(scene);
  hull.scale.setScalar(SPORT_SCALE);
  hull.rotation.y = Math.PI;
  hull.position.set(0, -SPORT_WATERLINE * SPORT_SCALE, SPORT_MID_Z * SPORT_SCALE);
  group.add(hull);

  const display = new HelmDisplay();
  kit.textures.push(display.texture);
  const screen = helmScreen(scene);
  if (screen) fitDisplay(screen, kit.material(new THREE.MeshBasicMaterial({ map: display.texture, toneMapped: false })), kit);

  // At the helm under the hardtop, on the starboard side: the bolster seat behind the wheel and the screen.
  const seat = sportPoint(SPORT_HELM.x, SPORT_SOLE, SPORT_HELM.z);
  const seatHeight = (SPORT_SEAT - SPORT_SOLE) * SPORT_SCALE * 0.82;
  // The open cockpit aft of the helm: where he runs about when she strikes.
  const forward = sportPoint(0, SPORT_SOLE, 0.3);
  const aft = sportPoint(0, SPORT_SOLE, 1.55);
  return {
    group,
    eye: new THREE.Vector3(seat.x, seat.y + seatHeight + 0.82, seat.z + 0.16),
    seats: [{ x: seat.x, y: seat.y, z: seat.z, yaw: 0, sit: true, seat: seatHeight }],
    deck: { x: 0, y: seat.y, z: (forward.z + aft.z) / 2, halfX: 0.55, halfZ: Math.abs(forward.z - aft.z) / 2 },
    update: (delta) => display.update(delta),
    dispose: () => kit.dispose(),
    modelled: true,
    setAlert: (lines) => display.setAlert(lines),
  };
}

/** The wreck: her model blackened by fire, torn aft. */
function modelWreck(scene: THREE.Group): CraftModel {
  prepare(scene);
  dropFlag(scene);
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
  const hull = new THREE.Group();
  hull.add(scene);
  hull.scale.setScalar(SPORT_SCALE);
  hull.rotation.y = Math.PI;
  hull.position.set(0, -SPORT_WATERLINE * SPORT_SCALE, SPORT_MID_Z * SPORT_SCALE);
  group.add(hull);
  // The transom stove in, a black scorch over the quarter.
  const char = kit.material(new THREE.MeshStandardMaterial({ color: 0x181614, roughness: 0.95 }));
  kit.mesh(group, new THREE.BoxGeometry(3.0, 1.3, 1.8), char, 0, 0.9, -5.0);
  kit.mesh(group, new THREE.BoxGeometry(1.4, 0.9, 1.2), char, 0.9, 1.6, -3.8).rotation.set(0.2, 0.3, 0.15);
  return {
    group,
    eye: new THREE.Vector3(0, 2.2, -1),
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
