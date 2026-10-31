import * as THREE from "three";
import { islandEdgeNoise, islandsWithin, waterDepthAt, WATERLINE_RADIAL } from "../environment/IslandMath";
import { monitorFeatures, type MonitorFeatures } from "../economy/EconomyMath";
import { chartProject, chartRange, formatBearing } from "./HelmInstruments";

/**
 * The widescreen helm display (the monitor upgrade): it replaces the stock
 * plotter and the two small instruments with one wide panel filling the
 * pod's face. On the left a head-up chart — shaded by depth from the second
 * level, lit as relief with contour lines at the fourth, its range growing
 * with each level — with the sonar's contacts on it; on the right the speed
 * in knots in large figures, heading, depth, the position in degrees and
 * minutes, and the sonar's list of what lies below, nearest first, coloured
 * by what it is worth.
 *
 * Coordinates are in the station's own frame (`HelmStation.group`).
 */

const WIDTH = 1024;
const HEIGHT = 530;
const CHART_W = 600;
/** Seconds between redraws while someone can read it. */
const INTERVAL = 0.25;
/** Where the archipelago lies on the globe: the position readout's origin (a Caribbean latitude). */
const ORIGIN_LAT = 12.42;
const ORIGIN_LON = -61.28;

export type SonarBlip = { x: number; z: number; tier: 1 | 2 | 3; depth: number };

export type MonitorData = {
  x: number;
  z: number;
  heading: number;
  speed: number;
  depth: number;
  night: number;
  sonarLevel: number;
  sonarRange: number;
};

const TIER_COLORS: Record<1 | 2 | 3, string> = { 1: "#9fd3e6", 2: "#5ff0c8", 3: "#ffcf4a" };

/** Degrees and decimal minutes, hemisphere letter last. */
export function formatPosition(x: number, z: number): { lat: string; lon: string } {
  const lat = ORIGIN_LAT + z / 111_320;
  // East is −X in this world (see the compass convention).
  const lon = ORIGIN_LON - x / (111_320 * Math.cos((ORIGIN_LAT * Math.PI) / 180));
  const format = (value: number, positive: string, negative: string, width: number) => {
    const sign = value >= 0 ? positive : negative;
    const absolute = Math.abs(value);
    const degrees = Math.floor(absolute);
    const minutes = (absolute - degrees) * 60;
    return `${String(degrees).padStart(width, "0")}°${minutes.toFixed(3).padStart(6, "0")}′${sign}`;
  };
  return { lat: format(lat, "N", "S", 2), lon: format(lon, "E", "W", 3) };
}

/** Colour of water `depth` metres deep on the bathymetric chart. */
function depthColor(depth: number, night: boolean): [number, number, number] {
  const t = Math.min(1, Math.max(0, depth / 22));
  const day: [number, number, number][] = [
    [186, 236, 238],
    [96, 196, 214],
    [34, 118, 176],
    [14, 52, 108],
  ];
  const stops = night ? day.map(([r, g, b]) => [r * 0.32, g * 0.36, b * 0.42] as [number, number, number]) : day;
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - index;
  const a = stops[index]!;
  const b = stops[index + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export class WideMonitor {
  readonly group = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly screen: THREE.MeshStandardMaterial;
  private readonly bezel: THREE.MeshStandardMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  /** The depth map, drawn on a small canvas and scaled up (it is smooth). */
  private readonly depthCanvas: HTMLCanvasElement;
  private readonly depthContext: CanvasRenderingContext2D;
  private readonly depthImage: ImageData;
  private clock = INTERVAL;
  private range = 600;
  private features: MonitorFeatures = monitorFeatures(1);
  private contacts: readonly SonarBlip[] = [];
  private readonly point = { x: 0, y: 0 };
  private sweep = 0;

  /** `centre` is the pod's centre and `tilt` the lean of its face (station frame). */
  constructor(centre: THREE.Vector3, tilt: number) {
    this.group.name = "HelmWideMonitor";
    this.canvas = document.createElement("canvas");
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.context = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.depthCanvas = document.createElement("canvas");
    this.depthCanvas.width = 72;
    this.depthCanvas.height = 48;
    this.depthContext = this.depthCanvas.getContext("2d")!;
    this.depthImage = this.depthContext.createImageData(72, 48);
    this.screen = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.1, emissive: 0xffffff, emissiveMap: this.texture, emissiveIntensity: 1 });
    this.bezel = new THREE.MeshStandardMaterial({ color: 0x0d0f11, roughness: 0.35, metalness: 0.2 });
    const face = new THREE.Vector3(0, Math.sin(tilt) * 0.078, -Math.cos(tilt) * 0.078);
    const frameGeometry = new THREE.BoxGeometry(0.585, 0.31, 0.012);
    const screenGeometry = new THREE.PlaneGeometry(0.56, 0.29);
    this.geometries.push(frameGeometry, screenGeometry);
    const frame = new THREE.Mesh(frameGeometry, this.bezel);
    frame.position.copy(centre).add(face);
    frame.rotation.set(tilt, Math.PI, 0);
    const screen = new THREE.Mesh(screenGeometry, this.screen);
    screen.position.copy(centre).add(face.clone().multiplyScalar(1.09));
    screen.rotation.set(tilt, Math.PI, 0);
    screen.name = "HelmWideScreen";
    this.group.add(frame, screen);
    this.group.visible = false;
  }

  setLevel(level: number): void {
    this.features = monitorFeatures(level);
    this.group.visible = this.features.wide;
    this.clock = INTERVAL;
  }

  get active(): boolean {
    return this.features.wide;
  }

  setContacts(contacts: readonly SonarBlip[]): void {
    this.contacts = contacts;
  }

  update(delta: number, data: MonitorData, readable: boolean): void {
    if (!this.features.wide) return;
    this.sweep += delta;
    this.screen.emissiveIntensity = THREE.MathUtils.lerp(1.05, 0.42, Math.min(1, Math.max(0, data.night)));
    this.clock += delta;
    if (!readable || this.clock < INTERVAL) return;
    this.clock = 0;
    this.range = Math.round(chartRange(data.speed, this.range / this.features.rangeScale) * this.features.rangeScale);
    this.draw(data);
    this.texture.needsUpdate = true;
  }

  private draw(data: MonitorData): void {
    const c = this.context;
    const night = data.night > 0.5;
    const ink = night ? "#c9d6dc" : "#0f2230";
    const panel = night ? "#05090c" : "#0b1620";
    c.save();
    c.fillStyle = panel;
    c.fillRect(0, 0, WIDTH, HEIGHT);

    // --- Chart ---------------------------------------------------------------
    c.save();
    c.beginPath();
    c.rect(0, 0, CHART_W, HEIGHT);
    c.clip();
    const originX = CHART_W / 2;
    const originY = HEIGHT * 0.72;
    const project = (worldX: number, worldZ: number) => chartProject(worldX - data.x, worldZ - data.z, data.heading, this.range, originX, originY, this.point);
    if (this.features.depthMap) {
      this.drawDepth(data, originX, originY, night);
    } else {
      c.fillStyle = night ? "#071a26" : "#e9f3f8";
      c.fillRect(0, 0, CHART_W, HEIGHT);
    }
    const land = night ? "#3a3220" : "#efdc9c";
    const coast = night ? "#7b6a3e" : "#8f7c46";
    for (const island of islandsWithin(data.x, data.z, this.range * 2)) {
      c.beginPath();
      for (let step = 0; step < 56; step += 1) {
        const angle = (step / 56) * Math.PI * 2;
        const radius = island.beachRadius * islandEdgeNoise(angle, island) * WATERLINE_RADIAL;
        const p = project(island.centerX + Math.cos(angle) * radius, island.centerZ + Math.sin(angle) * radius * island.scaleZ);
        if (step === 0) c.moveTo(p.x, p.y);
        else c.lineTo(p.x, p.y);
      }
      c.closePath();
      c.fillStyle = land;
      c.fill();
      c.strokeStyle = coast;
      c.lineWidth = 2;
      c.stroke();
    }
    // Range rings and the sonar's reach.
    const scale = originY / this.range;
    c.strokeStyle = night ? "rgba(160,200,215,0.35)" : "rgba(15,34,48,0.35)";
    c.lineWidth = 1.5;
    c.setLineDash([6, 6]);
    for (const ring of [0.5, 1]) {
      c.beginPath();
      c.arc(originX, originY, this.range * ring * scale, 0, Math.PI * 2);
      c.stroke();
    }
    c.setLineDash([]);
    if (data.sonarLevel > 0) {
      const radius = data.sonarRange * scale;
      c.strokeStyle = "rgba(95,240,200,0.55)";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(originX, originY, radius, 0, Math.PI * 2);
      c.stroke();
      // The sweep: a fading wedge turning round once every three seconds.
      const angle = (this.sweep / 3) * Math.PI * 2;
      const gradient = c.createRadialGradient(originX, originY, 0, originX, originY, radius);
      gradient.addColorStop(0, "rgba(95,240,200,0.0)");
      gradient.addColorStop(1, "rgba(95,240,200,0.22)");
      c.fillStyle = gradient;
      c.beginPath();
      c.moveTo(originX, originY);
      c.arc(originX, originY, radius, angle - 0.5, angle);
      c.closePath();
      c.fill();
    }
    // Contacts: coloured by worth, chests larger and ringed.
    for (const contact of this.contacts) {
      const p = project(contact.x, contact.z);
      const size = contact.tier === 3 ? 9 : contact.tier === 2 ? 6.5 : 4.5;
      c.fillStyle = TIER_COLORS[contact.tier];
      c.beginPath();
      c.moveTo(p.x, p.y - size);
      c.lineTo(p.x + size, p.y);
      c.lineTo(p.x, p.y + size);
      c.lineTo(p.x - size, p.y);
      c.closePath();
      c.fill();
      if (contact.tier === 3) {
        c.strokeStyle = TIER_COLORS[3];
        c.lineWidth = 2;
        c.beginPath();
        c.arc(p.x, p.y, size + 6 + Math.sin(this.sweep * 4) * 2, 0, Math.PI * 2);
        c.stroke();
      }
    }
    // Own ship, heading up.
    c.strokeStyle = night ? "#d07070" : "#0f2230";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(originX, originY);
    c.lineTo(originX, 10);
    c.stroke();
    c.fillStyle = night ? "#e05050" : "#101820";
    c.beginPath();
    c.moveTo(originX, originY - 15);
    c.lineTo(originX + 10, originY + 13);
    c.lineTo(originX - 10, originY + 13);
    c.closePath();
    c.fill();
    // North arrow.
    c.save();
    c.translate(CHART_W - 34, 40);
    c.rotate(data.heading);
    c.fillStyle = "#c62828";
    c.beginPath();
    c.moveTo(0, -18);
    c.lineTo(8, 8);
    c.lineTo(0, 3);
    c.lineTo(-8, 8);
    c.closePath();
    c.fill();
    c.restore();
    c.fillStyle = night ? "rgba(2,8,12,0.85)" : "rgba(11,22,32,0.82)";
    c.fillRect(0, HEIGHT - 36, CHART_W, 36);
    c.fillStyle = "#e8f4f8";
    c.font = "500 20px system-ui, -apple-system, Segoe UI, sans-serif";
    c.textBaseline = "middle";
    const rangeLabel = this.range >= 1000 ? `${(this.range / 1000).toFixed(1)} km` : `${this.range} m`;
    c.fillText(`HEAD UP  ${rangeLabel}${this.features.depthMap ? "  ·  DEPTH" : ""}`, 14, HEIGHT - 18);
    c.restore();

    // --- Side panel ----------------------------------------------------------------
    const left = CHART_W + 26;
    c.fillStyle = night ? "#0b1218" : "#102231";
    c.fillRect(CHART_W, 0, WIDTH - CHART_W, HEIGHT);
    c.fillStyle = night ? "#3a5560" : "#5f8ea0";
    c.fillRect(CHART_W, 0, 3, HEIGHT);
    c.textBaseline = "alphabetic";
    c.fillStyle = night ? "#86a0aa" : "#8fb9c8";
    c.font = "700 18px system-ui, -apple-system, Segoe UI, sans-serif";
    c.fillText("SOG  KN", left, 38);
    c.fillStyle = night ? "#e07a7a" : "#ffffff";
    c.font = "800 92px system-ui, -apple-system, Segoe UI, sans-serif";
    c.fillText((data.speed * 1.943844).toFixed(1), left - 4, 124);
    c.font = "600 26px system-ui, -apple-system, Segoe UI, sans-serif";
    c.fillStyle = night ? "#c9d6dc" : "#e8f4f8";
    c.fillText(`HDG ${formatBearing(data.heading)}°`, left, 168);
    c.fillText(`DPT ${data.depth.toFixed(1)} m`, left + 176, 168);
    const position = formatPosition(data.x, data.z);
    c.font = "600 24px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    c.fillStyle = night ? "#9fb6c2" : "#bfe3ef";
    c.fillText(position.lat, left, 212);
    c.fillText(position.lon, left, 244);
    c.fillStyle = night ? "#3a5560" : "#5f8ea0";
    c.fillRect(left, 262, WIDTH - left - 26, 2);
    c.font = "700 18px system-ui, -apple-system, Segoe UI, sans-serif";
    c.fillStyle = night ? "#86a0aa" : "#8fb9c8";
    if (data.sonarLevel <= 0) {
      c.fillText("SONAR  —  NOT FITTED", left, 292);
    } else {
      c.fillText(`SONAR  L${data.sonarLevel}  ·  ${Math.round(data.sonarRange)} m`, left, 292);
      const sorted = [...this.contacts]
        .map((contact) => ({ contact, distance: Math.hypot(contact.x - data.x, contact.z - data.z) }))
        .sort((a, b) => b.contact.tier - a.contact.tier || a.distance - b.distance)
        .slice(0, 6);
      c.font = "600 21px system-ui, -apple-system, Segoe UI, sans-serif";
      if (sorted.length === 0) {
        c.fillStyle = night ? "#6f8790" : "#7fa7b5";
        c.fillText("No contacts", left, 326);
      }
      sorted.forEach(({ contact, distance }, index) => {
        const y = 326 + index * 32;
        const dx = contact.x - data.x;
        const dz = contact.z - data.z;
        // Bearing relative to the bow, as the chart shows it (left negative).
        const across = dz * Math.sin(data.heading) - dx * Math.cos(data.heading);
        const along = dx * Math.sin(data.heading) + dz * Math.cos(data.heading);
        const relative = Math.round((Math.atan2(across, along) * 180) / Math.PI);
        c.fillStyle = TIER_COLORS[contact.tier];
        c.beginPath();
        c.arc(left + 8, y - 7, 7, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = night ? "#c9d6dc" : "#e8f4f8";
        const label = contact.tier === 3 ? "CHEST" : contact.tier === 2 ? "ARTEFACT" : "FIND";
        c.fillText(`${label}  ${Math.round(distance)} m  ${relative >= 0 ? "R" : "L"}${Math.abs(relative)}°  ${contact.depth.toFixed(0)} m`, left + 24, y);
      });
    }
    c.restore();
    void ink;
  }

  /** The bathymetric map round the yacht: depth in colour, lit as relief at the top level. */
  private drawDepth(data: MonitorData, originX: number, originY: number, night: boolean): void {
    const columns = this.depthImage.width;
    const rows = this.depthImage.height;
    const pixels = this.depthImage.data;
    const scale = originY / this.range;
    const cosine = Math.cos(data.heading);
    const sine = Math.sin(data.heading);
    const depths = new Float32Array(columns * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        // Screen pixel of this cell's centre, back to the world (inverse of `chartProject`).
        const sx = ((column + 0.5) / columns) * CHART_W;
        const sy = ((row + 0.5) / rows) * HEIGHT;
        const across = (sx - originX) / scale;
        const along = (originY - sy) / scale;
        const dx = along * sine - across * cosine;
        const dz = along * cosine + across * sine;
        depths[row * columns + column] = waterDepthAt(data.x + dx, data.z + dz);
      }
    }
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const depth = depths[row * columns + column]!;
        let [r, g, b] = depthColor(depth, night);
        if (this.features.relief) {
          // Lit from the upper left; a line at every five metres.
          const right = depths[row * columns + Math.min(columns - 1, column + 1)]!;
          const below = depths[Math.min(rows - 1, row + 1) * columns + column]!;
          const shade = 1 + Math.max(-0.35, Math.min(0.35, (right - depth + below - depth) * 0.08));
          r *= shade;
          g *= shade;
          b *= shade;
          const band = Math.floor(depth / 5);
          if (band !== Math.floor(right / 5) || band !== Math.floor(below / 5)) {
            r = r * 0.6 + 255 * 0.12;
            g = g * 0.6 + 255 * 0.14;
            b = b * 0.6 + 255 * 0.16;
          }
        }
        const offset = (row * columns + column) * 4;
        pixels[offset] = r;
        pixels[offset + 1] = g;
        pixels[offset + 2] = b;
        pixels[offset + 3] = 255;
      }
    }
    this.depthContext.putImageData(this.depthImage, 0, 0);
    this.context.imageSmoothingEnabled = true;
    this.context.drawImage(this.depthCanvas, 0, 0, CHART_W, HEIGHT);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.screen.dispose();
    this.bezel.dispose();
    this.texture.dispose();
  }
}
