import { ISLANDS, LANDMARKS, islandWorldPoint } from "../environment/IslandShape";

/** The chart covers a square of this half-size (meters) around the origin. */
export const CHART_HALF_SIZE = 640;
export const FOG_RESOLUTION = 80;
/** Sea revealed around the yacht as it sails (meters). */
export const REVEAL_RADIUS = 115;
/** A landmark counts as discovered within this range of the yacht (meters). */
export const LANDMARK_DISCOVERY_RANGE = 60;
/** Islands are discovered on approaching their shore, measured from the beach. */
export const ISLAND_DISCOVERY_MARGIN = 45;
export const EXPLORATION_STORAGE_KEY = "sailing-simulator-exploration-v1";

const CELL_SIZE = (CHART_HALF_SIZE * 2) / FOG_RESOLUTION;

export type ChartLandmark = {
  id: string;
  kind: (typeof LANDMARKS)[number]["kind"];
  name: string;
  x: number;
  z: number;
  /** Distance from (x, z) within which the landmark is discovered. */
  discoveryRange: number;
};

/** World positions of every charted landmark; island entries use the island center. */
export const CHART_LANDMARKS: readonly ChartLandmark[] = LANDMARKS.map((landmark) => {
  const island = ISLANDS[landmark.island];
  const point =
    landmark.kind === "island" ? { x: island.centerX, z: island.centerZ } : islandWorldPoint(island, landmark.radial, landmark.angle);
  // The crater sits inland, so it is charted once the yacht reaches the shore below it.
  const discoveryRange =
    landmark.kind === "island"
      ? island.beachRadius + ISLAND_DISCOVERY_MARGIN
      : landmark.kind === "peak"
        ? island.beachRadius + 18
        : LANDMARK_DISCOVERY_RANGE;
  return { id: landmark.id, kind: landmark.kind, name: landmark.name, x: point.x, z: point.z, discoveryRange };
});

export function fogCellIndex(x: number, z: number): number {
  const column = Math.floor((x + CHART_HALF_SIZE) / CELL_SIZE);
  const row = Math.floor((z + CHART_HALF_SIZE) / CELL_SIZE);
  if (column < 0 || row < 0 || column >= FOG_RESOLUTION || row >= FOG_RESOLUTION) return -1;
  return row * FOG_RESOLUTION + column;
}

/** Marks every fog cell whose center lies within radius of (x, z); returns the count newly revealed. */
export function revealFog(fog: Uint8Array, x: number, z: number, radius: number): number {
  let revealed = 0;
  const minColumn = Math.max(0, Math.floor((x - radius + CHART_HALF_SIZE) / CELL_SIZE));
  const maxColumn = Math.min(FOG_RESOLUTION - 1, Math.floor((x + radius + CHART_HALF_SIZE) / CELL_SIZE));
  const minRow = Math.max(0, Math.floor((z - radius + CHART_HALF_SIZE) / CELL_SIZE));
  const maxRow = Math.min(FOG_RESOLUTION - 1, Math.floor((z + radius + CHART_HALF_SIZE) / CELL_SIZE));
  const radiusSquared = radius * radius;
  for (let row = minRow; row <= maxRow; row += 1) {
    const centerZ = -CHART_HALF_SIZE + (row + 0.5) * CELL_SIZE;
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const centerX = -CHART_HALF_SIZE + (column + 0.5) * CELL_SIZE;
      const dx = centerX - x;
      const dz = centerZ - z;
      const index = row * FOG_RESOLUTION + column;
      if (dx * dx + dz * dz <= radiusSquared && fog[index] === 0) {
        fog[index] = 1;
        revealed += 1;
      }
    }
  }
  return revealed;
}

export function encodeFog(fog: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < fog.length; index += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) if (fog[index + bit]) byte |= 1 << bit;
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeFog(encoded: string, target: Uint8Array): boolean {
  try {
    const binary = atob(encoded);
    if (binary.length * 8 < target.length) return false;
    for (let index = 0; index < target.length; index += 1) {
      target[index] = (binary.charCodeAt(index >> 3) >> (index & 7)) & 1;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Tracks which sea areas and landmarks the player has visited. The fog grid
 * and discovered landmark ids persist in localStorage so the chart survives a
 * reload; storage failures leave the session working without persistence.
 */
export class Exploration {
  readonly fog = new Uint8Array(FOG_RESOLUTION * FOG_RESOLUTION);
  private discovered: readonly string[] = [];
  private revisionValue = 0;
  private exploredCells = 0;
  private lastX = Number.POSITIVE_INFINITY;
  private lastZ = Number.POSITIVE_INFINITY;
  private dirty = false;
  private saveTimer = 0;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(EXPLORATION_STORAGE_KEY) ?? "{}") as {
        fog?: string;
        landmarks?: string[];
      };
      if (typeof saved.fog === "string") decodeFog(saved.fog, this.fog);
      this.exploredCells = this.fog.reduce((total, cell) => total + cell, 0);
      if (Array.isArray(saved.landmarks)) {
        const known = new Set(CHART_LANDMARKS.map((landmark) => landmark.id));
        this.discovered = saved.landmarks.filter((id) => typeof id === "string" && known.has(id));
      }
    } catch {
      // Blocked or corrupt storage: start with an uncharted sea.
    }
  }

  get revision(): number {
    return this.revisionValue;
  }

  get exploredFraction(): number {
    return this.exploredCells / this.fog.length;
  }

  get discoveredLandmarks(): readonly string[] {
    return this.discovered;
  }

  update(delta: number, x: number, z: number): void {
    this.saveTimer += delta;
    if (Math.hypot(x - this.lastX, z - this.lastZ) >= 6) {
      this.lastX = x;
      this.lastZ = z;
      const revealed = revealFog(this.fog, x, z, REVEAL_RADIUS);
      this.exploredCells += revealed;
      let changed = revealed > 0;
      const found = CHART_LANDMARKS.filter(
        (landmark) => !this.discovered.includes(landmark.id) && Math.hypot(landmark.x - x, landmark.z - z) <= landmark.discoveryRange,
      );
      if (found.length > 0) {
        // Replace the array so snapshot consumers can compare by identity.
        this.discovered = [...this.discovered, ...found.map((landmark) => landmark.id)];
        changed = true;
      }
      if (changed) {
        this.revisionValue += 1;
        this.dirty = true;
      }
    }
    if (this.dirty && this.saveTimer >= 4) this.save();
  }

  save(): void {
    this.saveTimer = 0;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      localStorage.setItem(
        EXPLORATION_STORAGE_KEY,
        JSON.stringify({ fog: encodeFog(this.fog), landmarks: this.discovered }),
      );
    } catch {
      // Persistence is optional.
    }
  }
}
