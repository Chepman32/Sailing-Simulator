import { COLLECTIBLES, POINTS_OF_INTEREST, WORLD_EXTENT } from "./WorldLayout";

/** Fog-of-war cell size in metres. */
export const DISCOVERY_CELL_SIZE = 50;
export const DISCOVERY_GRID_SIZE = Math.ceil((WORLD_EXTENT * 2) / DISCOVERY_CELL_SIZE);
/** The crew can see this far for charting coastlines. */
export const DISCOVERY_REVEAL_RADIUS = 230;
/** Floating finds are spotted (and marked) from this distance. */
export const COLLECTIBLE_SPOT_RADIUS = 150;
/** Sailing this close to a bottle or crate picks it up. */
export const COLLECT_RADIUS = 7;
export const DISCOVERY_STORAGE_KEY = "sailing-simulator-discovery-v1";

export type DiscoveryEvent =
  | { type: "place"; id: string }
  | { type: "collect"; id: string };

type StoredDiscovery = { cells?: string; places?: string[]; spotted?: string[]; collected?: string[] };

/**
 * What the skipper has charted: explored map cells, discovered places,
 * spotted and collected floating finds. Pure and serialisable.
 */
export class DiscoveryState {
  readonly cells = new Uint8Array(DISCOVERY_GRID_SIZE * DISCOVERY_GRID_SIZE);
  readonly places = new Set<string>();
  readonly spotted = new Set<string>();
  readonly collected = new Set<string>();
  revision = 0;
  private lastCellX = Number.NaN;
  private lastCellZ = Number.NaN;

  /** Reveal around the yacht; returns newly discovered places and pickups. */
  observe(x: number, z: number): DiscoveryEvent[] {
    const events: DiscoveryEvent[] = [];
    const cellX = Math.floor((x + WORLD_EXTENT) / DISCOVERY_CELL_SIZE);
    const cellZ = Math.floor((z + WORLD_EXTENT) / DISCOVERY_CELL_SIZE);
    if (cellX !== this.lastCellX || cellZ !== this.lastCellZ) {
      this.lastCellX = cellX;
      this.lastCellZ = cellZ;
      if (this.revealCells(x, z, DISCOVERY_REVEAL_RADIUS)) this.revision += 1;
    }
    for (const place of POINTS_OF_INTEREST) {
      if (this.places.has(place.id)) continue;
      if (Math.hypot(place.x - x, place.z - z) <= place.discoverRadius) {
        this.places.add(place.id);
        this.revision += 1;
        events.push({ type: "place", id: place.id });
      }
    }
    for (const item of COLLECTIBLES) {
      if (this.collected.has(item.id)) continue;
      const distance = Math.hypot(item.x - x, item.z - z);
      if (!this.spotted.has(item.id) && distance <= COLLECTIBLE_SPOT_RADIUS) {
        this.spotted.add(item.id);
        this.revision += 1;
      }
    }
    return events;
  }

  /** Record a pickup reported by the floating object itself. */
  collect(id: string): DiscoveryEvent | null {
    if (this.collected.has(id)) return null;
    this.collected.add(id);
    this.spotted.add(id);
    this.revision += 1;
    return { type: "collect", id };
  }

  isExplored(cellX: number, cellZ: number): boolean {
    if (cellX < 0 || cellZ < 0 || cellX >= DISCOVERY_GRID_SIZE || cellZ >= DISCOVERY_GRID_SIZE) return false;
    return this.cells[cellZ * DISCOVERY_GRID_SIZE + cellX] === 1;
  }

  exploredFraction(): number {
    let explored = 0;
    for (const cell of this.cells) explored += cell;
    return explored / this.cells.length;
  }

  serialize(): string {
    const stored: StoredDiscovery = {
      cells: encodeCells(this.cells),
      places: [...this.places],
      spotted: [...this.spotted],
      collected: [...this.collected],
    };
    return JSON.stringify(stored);
  }

  restore(serialized: string | null): void {
    if (!serialized) return;
    try {
      const stored = JSON.parse(serialized) as StoredDiscovery;
      if (typeof stored.cells === "string") decodeCells(stored.cells, this.cells);
      const validPlaces = new Set(POINTS_OF_INTEREST.map((place) => place.id));
      const validItems = new Set(COLLECTIBLES.map((item) => item.id));
      stored.places?.forEach((id) => validPlaces.has(id) && this.places.add(id));
      stored.spotted?.forEach((id) => validItems.has(id) && this.spotted.add(id));
      stored.collected?.forEach((id) => validItems.has(id) && this.collected.add(id));
      this.revision += 1;
    } catch {
      // A corrupt save simply starts a fresh chart.
    }
  }

  private revealCells(x: number, z: number, radius: number): boolean {
    let changed = false;
    const minX = Math.max(0, Math.floor((x - radius + WORLD_EXTENT) / DISCOVERY_CELL_SIZE));
    const maxX = Math.min(DISCOVERY_GRID_SIZE - 1, Math.floor((x + radius + WORLD_EXTENT) / DISCOVERY_CELL_SIZE));
    const minZ = Math.max(0, Math.floor((z - radius + WORLD_EXTENT) / DISCOVERY_CELL_SIZE));
    const maxZ = Math.min(DISCOVERY_GRID_SIZE - 1, Math.floor((z + radius + WORLD_EXTENT) / DISCOVERY_CELL_SIZE));
    for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        const centerX = (cellX + 0.5) * DISCOVERY_CELL_SIZE - WORLD_EXTENT;
        const centerZ = (cellZ + 0.5) * DISCOVERY_CELL_SIZE - WORLD_EXTENT;
        if (Math.hypot(centerX - x, centerZ - z) > radius) continue;
        const index = cellZ * DISCOVERY_GRID_SIZE + cellX;
        if (this.cells[index] === 0) {
          this.cells[index] = 1;
          changed = true;
        }
      }
    }
    return changed;
  }
}

/** Bit-pack the explored grid into base64 for compact local storage. */
export function encodeCells(cells: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(cells.length / 8));
  cells.forEach((cell, index) => {
    if (cell) bytes[index >> 3] |= 1 << (index & 7);
  });
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function decodeCells(encoded: string, target: Uint8Array): void {
  const binary = atob(encoded);
  for (let index = 0; index < target.length; index += 1) {
    const byte = binary.charCodeAt(index >> 3) || 0;
    target[index] = (byte >> (index & 7)) & 1;
  }
}
