import * as THREE from "three";
import { WideMonitor, type SonarBlip } from "./WideMonitor";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { islandEdgeNoise, islandsWithin, WATERLINE_RADIAL, type IslandDefinition } from "../environment/IslandMath";
import {
  chartProject,
  chartRange,
  compassCardAngle,
  engineRpm,
  formatBearing,
  leverAngle,
  windNeedleAngle,
} from "./HelmInstruments";

/**
 * The helm station: a pedestal on the starboard aft deck, as on a
 * performance catamaran, out of the boom's sweep. Leather-rimmed stainless
 * wheel, an instrument pod with a chart plotter, a speed/depth display and a
 * wind dial, a binnacle compass whose card stays on north, the engine lever,
 * a guard rail, the helm seat, and the sheet winch on the cabin side.
 *
 * The displays are one canvas atlas (`ATLAS_*`), redrawn a few times a second
 * and only while someone is close enough to read them. Everything static is
 * merged into one mesh per material (vertex colours carry the paint), so the
 * whole station is eight draw calls.
 *
 * Coordinates are in vessel space: +Z the bow, +X starboard, metres; the aft
 * deck of the starboard hull is at `DECK_Y`.
 */

const DECK_Y = 0.62;
export const HELM_X = 1.72;
/**
 * The whole station is moved this far forward (+Z) from where its parts are
 * laid out below. The starboard hull's transom is at z ≈ −4.0: laid out as
 * drawn, the helm seat (z −4.47) and the helmsman (z −4.16) stood beyond it,
 * over open water, which showed as soon as the helm camera looked down. With
 * the shift the seat's after edge is on the aft deck, inside the transom.
 */
export const HELM_STATION_SHIFT = 0.75;
/** Where the helmsman's eyes are, standing at the wheel (vessel space). */
export const HELM_EYE = new THREE.Vector3(HELM_X, DECK_Y + 1.6, -4.16 + HELM_STATION_SHIFT);
/** After edge of the starboard hull's aft deck (its transom), vessel space. */
export const HULL_TRANSOM_Z = -4.0;
/** After edge of the helm seat once the station is in place (vessel space). */
export const HELM_SEAT_AFT_Z = -4.47 - 0.17 + HELM_STATION_SHIFT;
const WHEEL_CENTRE = new THREE.Vector3(HELM_X, 1.42, -3.62);
const WHEEL_RADIUS = 0.36;
/** The wheel's top leans forward, like a pedestal wheel. */
const WHEEL_TILT = -0.24;
/** How far the wheel turns at full rudder, radians. */
const WHEEL_LOCK = Math.PI * 1.1;
const POD_CENTRE = new THREE.Vector3(HELM_X, 1.86, -3.4);
/** Pod face tilted back toward the helmsman's eyes. */
const POD_TILT = 0.5;

const ATLAS_WIDTH = 1024;
const ATLAS_HEIGHT = 672;
type Region = { x: number; y: number; w: number; h: number };
const MFD: Region = { x: 0, y: 0, w: 640, h: 400 };
const SPEED: Region = { x: 640, y: 0, w: 384, h: 192 };
const WIND: Region = { x: 640, y: 192, w: 384, h: 208 };
const CARD: Region = { x: 0, y: 400, w: 256, h: 256 };
/** Seconds between two redraws of the displays while they are read. */
const DISPLAY_INTERVAL = 0.18;

export type HelmTraffic = {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly active: boolean;
  readonly anchored: boolean;
  readonly halfLength: number;
};

export type HelmData = {
  x: number;
  z: number;
  heading: number;
  /** Speed over ground, m/s. */
  speed: number;
  depth: number;
  apparentWindSpeed: number;
  apparentWindAngle: number;
  shaft: number;
  engineRunning: boolean;
  throttle: number;
  rudder: number;
  night: number;
  /** Whether someone is close enough to read the displays (the helm camera, a close orbit). */
  readable: boolean;
};

/** A box with rounded edges (moulded fibreglass and cushions). */
function roundedBox(width: number, height: number, depth: number, segments: number, radius: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(width, height, depth, segments, radius) as unknown as THREE.BufferGeometry;
}

/** Paints a geometry one colour (linear RGB) through a colour attribute, for merging. */
function painted(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const base = geometry.index ? geometry.toNonIndexed() : geometry;
  if (base !== geometry) geometry.dispose();
  const linear = new THREE.Color(color);
  const count = base.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) colors.set([linear.r, linear.g, linear.b], index * 3);
  base.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  for (const name of Object.keys(base.attributes)) {
    if (!["position", "normal", "uv", "color"].includes(name)) base.deleteAttribute(name);
  }
  return base;
}

function placed(geometry: THREE.BufferGeometry, position: THREE.Vector3, rotation?: THREE.Euler): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4().compose(
    position,
    new THREE.Quaternion().setFromEuler(rotation ?? new THREE.Euler()),
    new THREE.Vector3(1, 1, 1),
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error("Helm station geometry could not be merged.");
  merged.computeBoundingSphere();
  return merged;
}

/** A plane whose UVs show one region of the display atlas. */
function screenPlane(width: number, height: number, region: Region): THREE.PlaneGeometry {
  const plane = new THREE.PlaneGeometry(width, height);
  const uv = plane.getAttribute("uv") as THREE.BufferAttribute;
  const u0 = region.x / ATLAS_WIDTH;
  const u1 = (region.x + region.w) / ATLAS_WIDTH;
  const vTop = 1 - region.y / ATLAS_HEIGHT;
  const vBottom = 1 - (region.y + region.h) / ATLAS_HEIGHT;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, u0 + uv.getX(index) * (u1 - u0), vBottom + uv.getY(index) * (vTop - vBottom));
  }
  return plane;
}

export class HelmStation {
  readonly group = new THREE.Group();
  private readonly wheel = new THREE.Group();
  private readonly wheelMount = new THREE.Group();
  private readonly lever = new THREE.Group();
  private readonly card: THREE.Mesh;
  private readonly screenMaterial: THREE.MeshStandardMaterial;
  private readonly canvas: HTMLCanvasElement | null;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture | null;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly coastlines = new Map<number, Float32Array>();
  private traffic: readonly HelmTraffic[] = [];
  private displayClock = DISPLAY_INTERVAL;
  private range: number = 600;
  private nightPainted = -1;
  private readonly point = { x: 0, y: 0 };
  /** The widescreen display that replaces the stock ones (the monitor upgrade). */
  private readonly wide: WideMonitor | null;
  private screens: THREE.Mesh | null = null;
  private sonarContacts: readonly SonarBlip[] = [];
  private sonarLevel = 0;
  private sonarReach = 0;

  constructor() {
    this.group.name = "HelmStation";
    this.group.position.z = HELM_STATION_SHIFT;
    this.canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    if (this.canvas) {
      this.canvas.width = ATLAS_WIDTH;
      this.canvas.height = ATLAS_HEIGHT;
    }
    this.context = this.canvas?.getContext("2d") ?? null;
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
    if (this.texture) {
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.anisotropy = 4;
    }
    const composite = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.05 });
    const stainless = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.16,
      metalness: 1,
      envMapIntensity: 1.25,
    });
    const leather = new THREE.MeshStandardMaterial({ color: 0x1d1714, roughness: 0.72, metalness: 0 });
    this.screenMaterial = new THREE.MeshStandardMaterial({
      color: 0x050607,
      roughness: 0.12,
      metalness: 0,
      emissive: 0xffffff,
      emissiveMap: this.texture,
      emissiveIntensity: 1,
    });
    const cardMaterial = new THREE.MeshStandardMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
      roughness: 0.6,
      emissive: 0xffd9a0,
      emissiveMap: this.texture,
      emissiveIntensity: 0,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.18,
      envMapIntensity: 1.6,
      depthWrite: false,
    });
    this.materials.push(composite, stainless, leather, this.screenMaterial, cardMaterial, glass);

    // --- Fibreglass, rubber and cushion: one mesh ------------------------------
    const podRotation = new THREE.Euler(POD_TILT, 0, 0);
    const pedestalHeight = WHEEL_CENTRE.y - DECK_Y;
    const parts: THREE.BufferGeometry[] = [
      // Pedestal column, its foot and the steering housing behind the wheel.
      placed(painted(new THREE.CylinderGeometry(0.075, 0.1, pedestalHeight, 20), 0xe9ecec), new THREE.Vector3(HELM_X, DECK_Y + pedestalHeight / 2, -3.45)),
      placed(painted(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 24), 0xd9dddd), new THREE.Vector3(HELM_X, DECK_Y + 0.02, -3.45)),
      placed(
        painted(roundedBox(0.2, 0.22, 0.2, 3, 0.05), 0xe4e7e7),
        new THREE.Vector3(HELM_X, WHEEL_CENTRE.y + 0.04, -3.47),
      ),
      // Instrument pod: a moulded shell with a dark bezel.
      placed(painted(roundedBox(0.6, 0.33, 0.13, 4, 0.045), 0xe6e9e9), POD_CENTRE.clone(), podRotation),
      placed(
        painted(roundedBox(0.56, 0.29, 0.02, 3, 0.012), 0x111416),
        POD_CENTRE.clone().add(new THREE.Vector3(0, Math.sin(POD_TILT) * 0.06, -Math.cos(POD_TILT) * 0.06)),
        podRotation,
      ),
      // Neck between housing and pod.
      placed(painted(new THREE.CylinderGeometry(0.05, 0.06, 0.24, 14), 0xe4e7e7), new THREE.Vector3(HELM_X, 1.66, -3.43)),
      // Engine control pod beside the pedestal.
      placed(painted(roundedBox(0.09, 0.15, 0.14, 2, 0.025), 0x1a1d20), new THREE.Vector3(HELM_X + 0.2, 1.3, -3.48)),
      // Helm seat: frame and cushion.
      placed(painted(roundedBox(0.72, 0.42, 0.34, 3, 0.04), 0xe8ebeb), new THREE.Vector3(HELM_X, DECK_Y + 0.21, -4.47)),
      placed(painted(roundedBox(0.7, 0.08, 0.33, 4, 0.035), 0x24333d), new THREE.Vector3(HELM_X, DECK_Y + 0.46, -4.47)),
      // Coiled sheet tail beside the winch.
      placed(painted(new THREE.TorusGeometry(0.085, 0.011, 6, 36), 0xd9d2c0), new THREE.Vector3(1.86, 1.205, -2.62), new THREE.Euler(Math.PI / 2, 0, 0)),
      placed(painted(new THREE.TorusGeometry(0.07, 0.011, 6, 32), 0xd2cab6), new THREE.Vector3(1.88, 1.225, -2.6), new THREE.Euler(Math.PI / 2, 0, 0.4)),
    ];
    const compositeGeometry = mergeAll(parts);
    const compositeMesh = new THREE.Mesh(compositeGeometry, composite);
    compositeMesh.name = "HelmComposite";
    compositeMesh.castShadow = true;
    compositeMesh.receiveShadow = true;

    // --- Stainless: guard rail, winch, compass ring --------------------------
    const railCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(HELM_X - 0.36, 0.98, -3.4),
      new THREE.Vector3(HELM_X - 0.38, 1.7, -3.36),
      new THREE.Vector3(HELM_X - 0.3, 2.06, -3.36),
      new THREE.Vector3(HELM_X, 2.1, -3.36),
      new THREE.Vector3(HELM_X + 0.3, 2.06, -3.36),
      new THREE.Vector3(HELM_X + 0.38, 1.7, -3.36),
      new THREE.Vector3(HELM_X + 0.36, 0.98, -3.4),
    ]);
    const winchProfile = [
      [0.0, 0],
      [0.1, 0],
      [0.1, 0.02],
      [0.072, 0.03],
      [0.066, 0.1],
      [0.078, 0.14],
      [0.085, 0.19],
      [0.06, 0.205],
      [0.045, 0.22],
      [0.0, 0.225],
    ].map(([radius, height]) => new THREE.Vector2(radius, height));
    const steel = [
      painted(new THREE.TubeGeometry(railCurve, 48, 0.0135, 8, false), 0xd8dde0),
      placed(painted(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8), 0xd8dde0), new THREE.Vector3(HELM_X, 1.36, -3.41), new THREE.Euler(0, 0, Math.PI / 2)),
      placed(painted(new THREE.LatheGeometry(winchProfile, 28), 0xcfd5d8), new THREE.Vector3(2.0, 1.15, -2.86)),
      placed(painted(new THREE.TorusGeometry(0.072, 0.008, 8, 32), 0xd8dde0), POD_CENTRE.clone().add(new THREE.Vector3(0, 0.17, 0.02)), new THREE.Euler(Math.PI / 2, 0, 0)),
      // Compass bowl under the glass.
      placed(painted(new THREE.CylinderGeometry(0.07, 0.06, 0.03, 24), 0x22282c), POD_CENTRE.clone().add(new THREE.Vector3(0, 0.16, 0.02))),
    ];
    const steelGeometry = mergeAll(steel);
    const steelMesh = new THREE.Mesh(steelGeometry, stainless);
    steelMesh.name = "HelmStainless";
    steelMesh.castShadow = true;
    steelMesh.receiveShadow = true;

    // --- Displays: one mesh, three screens of the atlas ---------------------------
    const faceOffset = new THREE.Vector3(0, Math.sin(POD_TILT) * 0.072, -Math.cos(POD_TILT) * 0.072);
    const screens = mergeAll([
      placed(screenPlane(0.31, 0.194, MFD), POD_CENTRE.clone().add(faceOffset).add(new THREE.Vector3(-0.1, 0, 0)), new THREE.Euler(POD_TILT, Math.PI, 0)),
      placed(
        screenPlane(0.15, 0.075, SPEED),
        POD_CENTRE.clone().add(faceOffset).add(new THREE.Vector3(0.17, Math.cos(POD_TILT) * 0.05, Math.sin(POD_TILT) * 0.05)),
        new THREE.Euler(POD_TILT, Math.PI, 0),
      ),
      placed(
        screenPlane(0.15, 0.081, WIND),
        POD_CENTRE.clone().add(faceOffset).add(new THREE.Vector3(0.17, -Math.cos(POD_TILT) * 0.046, -Math.sin(POD_TILT) * 0.046)),
        new THREE.Euler(POD_TILT, Math.PI, 0),
      ),
    ]);
    const screenMesh = new THREE.Mesh(screens, this.screenMaterial);
    screenMesh.name = "HelmDisplays";
    this.screens = screenMesh;

    // --- Compass: a card that keeps north, under a glass dome ---------------------
    const cardGeometry = new THREE.CircleGeometry(0.058, 40);
    const cardUv = cardGeometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let index = 0; index < cardUv.count; index += 1) {
      cardUv.setXY(
        index,
        (CARD.x + cardUv.getX(index) * CARD.w) / ATLAS_WIDTH,
        1 - (CARD.y + (1 - cardUv.getY(index)) * CARD.h) / ATLAS_HEIGHT,
      );
    }
    // Face up, texture top (N) along +Z and its right (E) along −X: seen from
    // above with north ahead, world −X is on the right, so east is where it
    // is on a real compass and the card is read from its front.
    cardGeometry.rotateX(-Math.PI / 2);
    cardGeometry.rotateY(Math.PI);
    this.card = new THREE.Mesh(cardGeometry, cardMaterial);
    this.card.name = "HelmCompassCard";
    this.card.position.copy(POD_CENTRE).add(new THREE.Vector3(0, 0.178, 0.02));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.068, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    dome.name = "HelmCompassGlass";
    dome.position.copy(POD_CENTRE).add(new THREE.Vector3(0, 0.172, 0.02));
    dome.renderOrder = 3;

    // --- Wheel: leather rim and five polished spokes -------------------------------
    const rim = new THREE.TorusGeometry(WHEEL_RADIUS, 0.022, 12, 64);
    const spokes: THREE.BufferGeometry[] = [];
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2;
      const spoke = new THREE.CylinderGeometry(0.008, 0.013, WHEEL_RADIUS - 0.04, 8);
      spoke.translate(0, (WHEEL_RADIUS - 0.04) / 2 + 0.04, 0);
      spoke.rotateZ(angle);
      spokes.push(painted(spoke, 0xdfe4e6));
    }
    spokes.push(painted(new THREE.CylinderGeometry(0.055, 0.06, 0.06, 24).rotateX(Math.PI / 2).translate(0, 0, 0.03), 0xd5dadd));
    spokes.push(painted(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24).rotateX(Math.PI / 2).translate(0, 0, 0.064), 0x1b1f22));
    // A turk's head knot on the top spoke marks the wheel amidships.
    spokes.push(painted(new THREE.TorusGeometry(WHEEL_RADIUS, 0.0245, 8, 6, 0.08).rotateZ(Math.PI / 2 - 0.04), 0xe9dcc0));
    const spokeGeometry = mergeAll(spokes);
    const rimMesh = new THREE.Mesh(rim, leather);
    const spokeMesh = new THREE.Mesh(spokeGeometry, stainless);
    rimMesh.castShadow = true;
    spokeMesh.castShadow = true;
    this.wheel.add(rimMesh, spokeMesh);
    const wheelMount = this.wheelMount;
    wheelMount.position.copy(WHEEL_CENTRE);
    wheelMount.rotation.order = "YXZ";
    wheelMount.rotation.set(WHEEL_TILT, Math.PI, 0);
    wheelMount.add(this.wheel);

    // --- Engine lever ------------------------------------------------------------------
    const leverParts = mergeAll([
      painted(new THREE.CylinderGeometry(0.009, 0.011, 0.16, 10).translate(0, 0.08, 0), 0xcfd5d8),
      painted(new THREE.SphereGeometry(0.026, 14, 10).translate(0, 0.165, 0), 0x111315),
    ]);
    const leverMesh = new THREE.Mesh(leverParts, stainless);
    this.lever.add(leverMesh);
    this.lever.position.set(HELM_X + 0.2, 1.38, -3.48);

    this.group.add(compositeMesh, steelMesh, screenMesh, this.card, dome, wheelMount, this.lever);
    this.wide = typeof document !== "undefined" ? new WideMonitor(POD_CENTRE.clone(), POD_TILT) : null;
    if (this.wide) this.group.add(this.wide.group);
    this.geometries.push(compositeGeometry, steelGeometry, screens, cardGeometry, dome.geometry, rim, spokeGeometry, leverParts);
    this.paintCard();
  }

  /** A point on the wheel's rim at `angle` in the mount's frame (not turning with the spokes), in the world. */
  rimPoint(angle: number, target: THREE.Vector3): THREE.Vector3 {
    this.group.updateWorldMatrix(true, true);
    target.set(Math.cos(angle) * WHEEL_RADIUS, Math.sin(angle) * WHEEL_RADIUS, 0);
    return this.wheelMount.localToWorld(target);
  }

  /** Current turn of the wheel, radians. */
  get wheelAngle(): number {
    return this.wheel.rotation.z;
  }

  /** Where the skipper's feet are: on the deck behind the wheel (vessel space). */
  static readonly STAND_FEET = new THREE.Vector3(HELM_X, DECK_Y, HELM_EYE.z);

  /** The monitor upgrade's level: from the first, one wide display in place of the stock three. */
  setMonitorLevel(level: number): void {
    if (!this.wide) return;
    this.wide.setLevel(level);
    if (this.screens) this.screens.visible = !this.wide.active;
    this.displayClock = DISPLAY_INTERVAL;
  }

  /** What the sonar sees (drawn on whichever display is fitted), its level and its reach, m. */
  setSonar(contacts: readonly SonarBlip[], level: number, reach: number): void {
    this.sonarContacts = contacts;
    this.sonarLevel = level;
    this.sonarReach = reach;
    this.wide?.setContacts(contacts);
  }

  /** Ships for the chart plotter's targets (shared by reference). */
  setTraffic(traffic: readonly HelmTraffic[]): void {
    this.traffic = traffic;
  }

  update(delta: number, data: HelmData): void {
    // Starboard helm turns the wheel clockwise as the helmsman sees it.
    this.wheel.rotation.z = THREE.MathUtils.damp(this.wheel.rotation.z, -data.rudder * WHEEL_LOCK, 14, delta);
    this.lever.rotation.x = THREE.MathUtils.damp(this.lever.rotation.x, leverAngle(data.engineRunning ? data.throttle : 0), 10, delta);
    // Compass cards are damped in their bowl and lag a quick turn a little.
    const card = compassCardAngle(data.heading);
    let difference = card - this.card.rotation.y;
    difference = Math.atan2(Math.sin(difference), Math.cos(difference));
    this.card.rotation.y += difference * (1 - Math.exp(-4 * delta));
    // Backlit at night, dimmed so they do not dazzle.
    const night = THREE.MathUtils.clamp(data.night, 0, 1);
    this.screenMaterial.emissiveIntensity = THREE.MathUtils.lerp(1.05, 0.42, night);
    (this.card.material as THREE.MeshStandardMaterial).emissiveIntensity = night * 0.35;

    if (this.wide?.active) {
      this.wide.update(delta, { x: data.x, z: data.z, heading: data.heading, speed: data.speed, depth: data.depth, night, sonarLevel: this.sonarLevel, sonarRange: this.sonarReach }, data.readable);
      return;
    }
    this.displayClock += delta;
    if (!data.readable || !this.context || !this.texture) return;
    if (this.displayClock < DISPLAY_INTERVAL) return;
    this.displayClock = 0;
    this.range = chartRange(data.speed, this.range);
    const nightPalette = night > 0.5 ? 1 : 0;
    if (nightPalette !== this.nightPainted) {
      this.nightPainted = nightPalette;
      this.paintCard();
    }
    this.drawChart(data, nightPalette === 1);
    this.drawSpeed(data, nightPalette === 1);
    this.drawWind(data, nightPalette === 1);
    this.texture.needsUpdate = true;
  }

  /** An island's coast outline in world metres (the chart rotates it each draw), made once. */
  private coastline(island: IslandDefinition): Float32Array {
    let points = this.coastlines.get(island.id);
    if (!points) {
      points = new Float32Array(56 * 2);
      for (let step = 0; step < 56; step += 1) {
        const angle = (step / 56) * Math.PI * 2;
        const radius = island.beachRadius * islandEdgeNoise(angle, island) * WATERLINE_RADIAL;
        points[step * 2] = island.centerX + Math.cos(angle) * radius;
        points[step * 2 + 1] = island.centerZ + Math.sin(angle) * radius * island.scaleZ;
      }
      // The world has no edge, so the outlines are kept only for the nearby islands.
      if (this.coastlines.size > 160) this.coastlines.clear();
      this.coastlines.set(island.id, points);
    }
    return points;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.texture?.dispose();
    this.wide?.dispose();
  }

  // --- Displays ---------------------------------------------------------------------

  private drawChart(data: HelmData, night: boolean): void {
    const context = this.context!;
    const { x: left, y: top, w: width, h: height } = MFD;
    context.save();
    context.beginPath();
    context.rect(left, top, width, height);
    context.clip();
    const deep = night ? "#071a26" : "#e9f3f8";
    const shelf = night ? "#0d2c3a" : "#b9def0";
    const land = night ? "#3a3220" : "#f1e1a4";
    const coast = night ? "#7b6a3e" : "#8f7c46";
    const ink = night ? "#9fb6c2" : "#24394a";
    context.fillStyle = deep;
    context.fillRect(left, top, width, height);

    const originX = left + width / 2;
    const originY = top + height * 0.7;
    const scale = (originY - top - 34) / this.range;
    const project = (worldX: number, worldZ: number) =>
      chartProject(worldX - data.x, worldZ - data.z, data.heading, this.range, originX, originY - 34, this.point);

    // Shelf first (a ring 60 m out), then the land on it.
    const visible = this.range * 2.2;
    for (const island of islandsWithin(data.x, data.z, visible)) {
      const outline = this.coastline(island);
      for (const [fill, grow] of [
        [shelf, 60],
        [land, 0],
      ] as const) {
        context.beginPath();
        for (let step = 0; step < outline.length / 2; step += 1) {
          const px = outline[step * 2]!;
          const pz = outline[step * 2 + 1]!;
          const dx = px - island.centerX;
          const dz = pz - island.centerZ;
          const length = Math.hypot(dx, dz / island.scaleZ) || 1;
          const factor = (length + grow) / length;
          const point = project(island.centerX + dx * factor, island.centerZ + dz * factor);
          if (step === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        context.closePath();
        context.fillStyle = fill;
        context.fill();
        if (grow === 0) {
          context.strokeStyle = coast;
          context.lineWidth = 2;
          context.stroke();
        }
      }
    }

    // Range rings.
    context.strokeStyle = night ? "rgba(140,180,200,0.35)" : "rgba(36,57,74,0.35)";
    context.lineWidth = 1.5;
    context.setLineDash([6, 6]);
    for (const ring of [0.5, 1]) {
      context.beginPath();
      context.arc(originX, originY - 34, this.range * ring * scale, 0, Math.PI * 2);
      context.stroke();
    }
    context.setLineDash([]);

    // Ships: AIS targets with a six-minute course vector.
    for (const ship of this.traffic) {
      if (!ship.active) continue;
      const point = project(ship.x, ship.z);
      if (point.x < left - 40 || point.x > left + width + 40 || point.y < top - 40 || point.y > top + height + 40) continue;
      context.save();
      context.translate(point.x, point.y);
      // Mirror of the view (see `chartProject`): turning toward +X turns left on screen.
      context.rotate(data.heading - ship.heading);
      const size = Math.max(9, ship.halfLength * 2 * scale);
      context.fillStyle = ship.anchored ? (night ? "#7d6b9e" : "#8a5cc0") : night ? "#3f9a6a" : "#139a4d";
      context.beginPath();
      context.moveTo(0, -size * 0.6);
      context.lineTo(size * 0.32, size * 0.45);
      context.lineTo(-size * 0.32, size * 0.45);
      context.closePath();
      context.fill();
      if (!ship.anchored && ship.speed > 0.5) {
        context.strokeStyle = context.fillStyle;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(0, -size * 0.6);
        context.lineTo(0, -size * 0.6 - ship.speed * 360 * scale);
        context.stroke();
      }
      context.restore();
    }

    // Sonar contacts, coloured by worth (chests ringed).
    for (const contact of this.sonarContacts) {
      const point = project(contact.x, contact.z);
      const size = contact.tier === 3 ? 8 : contact.tier === 2 ? 6 : 4;
      context.fillStyle = contact.tier === 3 ? "#e0a800" : contact.tier === 2 ? "#0f9e7e" : "#5d8fa3";
      context.beginPath();
      context.moveTo(point.x, point.y - size);
      context.lineTo(point.x + size, point.y);
      context.lineTo(point.x, point.y + size);
      context.lineTo(point.x - size, point.y);
      context.closePath();
      context.fill();
    }

    // Own ship, heading up, with her heading line.
    context.strokeStyle = ink;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(originX, originY - 34);
    context.lineTo(originX, top + 30);
    context.stroke();
    context.fillStyle = night ? "#e05050" : "#101820";
    context.beginPath();
    context.moveTo(originX, originY - 48);
    context.lineTo(originX + 9, originY - 22);
    context.lineTo(originX - 9, originY - 22);
    context.closePath();
    context.fill();

    // North arrow (the chart is head-up).
    context.save();
    context.translate(left + width - 34, top + 64);
    context.rotate(data.heading);
    context.fillStyle = night ? "#c05050" : "#c62828";
    context.beginPath();
    context.moveTo(0, -18);
    context.lineTo(8, 8);
    context.lineTo(0, 3);
    context.lineTo(-8, 8);
    context.closePath();
    context.fill();
    context.restore();

    // Data bars.
    context.fillStyle = night ? "rgba(2,8,12,0.88)" : "rgba(20,32,42,0.9)";
    context.fillRect(left, top, width, 40);
    context.fillRect(left, top + height - 34, width, 34);
    context.fillStyle = night ? "#d07070" : "#ffffff";
    context.font = "600 24px system-ui, -apple-system, Segoe UI, sans-serif";
    context.textBaseline = "middle";
    const knots = data.speed * 1.943844;
    context.fillText(`SOG ${knots.toFixed(1)} kn`, left + 14, top + 21);
    context.fillText(`HDG ${formatBearing(data.heading)}°`, left + 230, top + 21);
    context.fillText(`DPT ${data.depth.toFixed(1)} m`, left + 440, top + 21);
    context.font = "500 20px system-ui, -apple-system, Segoe UI, sans-serif";
    const rangeLabel = this.range >= 1000 ? `${(this.range / 1000).toFixed(1)} km` : `${this.range} m`;
    context.fillText(`HEAD UP   ${rangeLabel}`, left + 14, top + height - 17);
    const targets = this.traffic.filter((ship) => ship.active).length;
    context.fillText(`AIS ${targets}`, left + width - 92, top + height - 17);
    context.restore();
  }

  private drawSpeed(data: HelmData, night: boolean): void {
    const context = this.context!;
    const { x: left, y: top, w: width, h: height } = SPEED;
    context.fillStyle = night ? "#030405" : "#0c1115";
    context.fillRect(left, top, width, height);
    const digits = night ? "#ff6a5a" : "#f4f7f8";
    const label = night ? "#a04a40" : "#8fa3ae";
    context.textBaseline = "alphabetic";
    context.fillStyle = label;
    context.font = "600 22px system-ui, -apple-system, Segoe UI, sans-serif";
    context.fillText("SPEED", left + 18, top + 32);
    context.fillText("DEPTH", left + 228, top + 32);
    context.fillStyle = digits;
    context.font = "600 76px system-ui, -apple-system, Segoe UI, sans-serif";
    context.fillText((data.speed * 1.943844).toFixed(1), left + 14, top + 110);
    context.font = "600 52px system-ui, -apple-system, Segoe UI, sans-serif";
    context.fillText(data.depth > 99 ? "99+" : data.depth.toFixed(1), left + 226, top + 102);
    context.fillStyle = label;
    context.font = "600 20px system-ui, -apple-system, Segoe UI, sans-serif";
    context.fillText("KN", left + 18, top + 140);
    context.fillText("M", left + 228, top + 130);
    const rpm = engineRpm(data.shaft, data.engineRunning);
    context.fillText(data.engineRunning ? `ENGINE ${Math.round(rpm / 10) * 10} RPM` : "ENGINE OFF", left + 18, top + 176);
  }

  private drawWind(data: HelmData, night: boolean): void {
    const context = this.context!;
    const { x: left, y: top, w: width, h: height } = WIND;
    context.fillStyle = night ? "#030405" : "#0c1115";
    context.fillRect(left, top, width, height);
    const centreX = left + 110;
    const centreY = top + height / 2;
    const radius = 84;
    // Close-hauled sectors, coloured as the side lights look from the helm:
    // the red (−X, port) light shows on the right of the view, the green on the left.
    context.lineWidth = 10;
    context.strokeStyle = night ? "#1c5a32" : "#2e9e4f";
    context.beginPath();
    context.arc(centreX, centreY, radius - 6, -Math.PI / 2 - 1.05, -Math.PI / 2 - 0.35);
    context.stroke();
    context.strokeStyle = night ? "#6a1c1c" : "#c62828";
    context.beginPath();
    context.arc(centreX, centreY, radius - 6, -Math.PI / 2 + 0.35, -Math.PI / 2 + 1.05);
    context.stroke();
    context.strokeStyle = night ? "#5a3a36" : "#73858f";
    context.lineWidth = 2;
    for (let tick = 0; tick < 36; tick += 1) {
      const angle = (tick / 36) * Math.PI * 2;
      const inner = tick % 3 === 0 ? radius - 18 : radius - 10;
      context.beginPath();
      context.moveTo(centreX + Math.sin(angle) * inner, centreY - Math.cos(angle) * inner);
      context.lineTo(centreX + Math.sin(angle) * radius, centreY - Math.cos(angle) * radius);
      context.stroke();
    }
    // Boat outline in the middle, bow up.
    context.strokeStyle = night ? "#6b4a46" : "#9fb0b8";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(centreX, centreY - 30);
    context.quadraticCurveTo(centreX + 16, centreY, centreX + 10, centreY + 28);
    context.lineTo(centreX - 10, centreY + 28);
    context.quadraticCurveTo(centreX - 16, centreY, centreX, centreY - 30);
    context.stroke();
    // Needle: where the apparent wind comes from.
    const angle = windNeedleAngle(data.apparentWindAngle);
    context.strokeStyle = night ? "#ff7a5a" : "#ffb02e";
    context.lineWidth = 6;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(centreX + Math.sin(angle) * 18, centreY - Math.cos(angle) * 18);
    context.lineTo(centreX + Math.sin(angle) * (radius - 4), centreY - Math.cos(angle) * (radius - 4));
    context.stroke();
    context.lineCap = "butt";
    context.fillStyle = night ? "#a04a40" : "#8fa3ae";
    context.font = "600 22px system-ui, -apple-system, Segoe UI, sans-serif";
    context.textBaseline = "alphabetic";
    context.fillText("AWS", left + 230, top + 50);
    context.fillText("AWA", left + 230, top + 130);
    context.fillStyle = night ? "#ff6a5a" : "#f4f7f8";
    context.font = "600 46px system-ui, -apple-system, Segoe UI, sans-serif";
    context.fillText((data.apparentWindSpeed * 1.943844).toFixed(1), left + 226, top + 96);
    const degrees = Math.round((Math.abs(data.apparentWindAngle) * 180) / Math.PI);
    // Positive apparent wind angles come over the +X side, which is port.
    context.fillText(`${degrees}°${data.apparentWindAngle >= 0 ? "P" : "S"}`, left + 226, top + 176);
  }

  private paintCard(): void {
    const context = this.context;
    if (!context) return;
    const { x: left, y: top, w: size } = CARD;
    const night = this.nightPainted === 1;
    const centre = left + size / 2;
    const middle = top + size / 2;
    context.clearRect(left, top, size, size);
    context.fillStyle = night ? "#2a2418" : "#f4efe2";
    context.beginPath();
    context.arc(centre, middle, size / 2, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = night ? "#a08a5a" : "#1b1b1b";
    for (let degree = 0; degree < 360; degree += 5) {
      const angle = (degree * Math.PI) / 180;
      const long = degree % 30 === 0;
      context.lineWidth = long ? 3 : 1.5;
      const inner = size / 2 - (long ? 26 : 16);
      context.beginPath();
      context.moveTo(centre + Math.sin(angle) * inner, middle - Math.cos(angle) * inner);
      context.lineTo(centre + Math.sin(angle) * (size / 2 - 4), middle - Math.cos(angle) * (size / 2 - 4));
      context.stroke();
    }
    context.font = "700 34px Georgia, serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const letters: [string, number][] = [
      ["N", 0],
      ["E", 90],
      ["S", 180],
      ["W", 270],
    ];
    for (const [letter, degree] of letters) {
      const angle = (degree * Math.PI) / 180;
      context.fillStyle = letter === "N" ? "#c62828" : night ? "#c8b48a" : "#1b1b1b";
      context.fillText(letter, centre + Math.sin(angle) * (size / 2 - 52), middle - Math.cos(angle) * (size / 2 - 52));
    }
    context.textAlign = "start";
    if (this.texture) this.texture.needsUpdate = true;
  }
}
