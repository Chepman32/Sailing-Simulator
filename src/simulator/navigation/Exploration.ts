/**
 * Fog of war for the chart. The sea has no edge, so what has been seen is
 * kept as a sparse set of square chunks, each a bitmap of `FOG_CELL` metre
 * cells. Sailing reveals a disc around the yacht; the chart shows only what
 * lies in revealed cells. The number of chunks is bounded (the oldest are
 * forgotten first), and the whole store round-trips through a compact string
 * for local storage under `EXPLORATION_STORAGE_KEY`.
 *
 * Pure: no DOM, no Three.js.
 */

export const EXPLORATION_STORAGE_KEY = "sailing-simulator-exploration-v1";
/** Side of one fog cell, metres. */
export const FOG_CELL = 40;
/** Cells along one side of a chunk (a chunk is 2.56 km square). */
export const FOG_CHUNK = 64;
/** How far the lookout sees for the chart, metres. */
export const REVEAL_RADIUS = 360;
/** Chunks kept at most (about 2,000 km² of sea, ≈ 160 kB stored). */
export const MAX_FOG_CHUNKS = 300;

const CHUNK_BYTES = (FOG_CHUNK * FOG_CHUNK) / 8;

function chunkKey(column: number, row: number): string {
  return `${column},${row}`;
}

export class ExplorationFog {
  /** Insertion order is age: a chunk touched again moves to the end. */
  private readonly chunks = new Map<string, Uint8Array>();

  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Whether the fog cell holding (x, z) has been seen. */
  isExplored(x: number, z: number): boolean {
    const cellX = Math.floor(x / FOG_CELL);
    const cellZ = Math.floor(z / FOG_CELL);
    const column = Math.floor(cellX / FOG_CHUNK);
    const row = Math.floor(cellZ / FOG_CHUNK);
    const bits = this.chunks.get(chunkKey(column, row));
    if (!bits) return false;
    const index = (cellZ - row * FOG_CHUNK) * FOG_CHUNK + (cellX - column * FOG_CHUNK);
    return (bits[index >> 3] & (1 << (index & 7))) !== 0;
  }

  /** Reveals every cell whose centre lies within `radius` of (x, z); returns how many were new. */
  reveal(x: number, z: number, radius: number): number {
    let revealed = 0;
    const minX = Math.floor((x - radius) / FOG_CELL);
    const maxX = Math.floor((x + radius) / FOG_CELL);
    const minZ = Math.floor((z - radius) / FOG_CELL);
    const maxZ = Math.floor((z + radius) / FOG_CELL);
    const radiusSquared = radius * radius;
    let bits: Uint8Array | undefined;
    let bitsKey = "";
    for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
      const dz = (cellZ + 0.5) * FOG_CELL - z;
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        const dx = (cellX + 0.5) * FOG_CELL - x;
        if (dx * dx + dz * dz > radiusSquared) continue;
        const column = Math.floor(cellX / FOG_CHUNK);
        const row = Math.floor(cellZ / FOG_CHUNK);
        const key = chunkKey(column, row);
        if (key !== bitsKey) {
          bitsKey = key;
          bits = this.touch(key);
        }
        const index = (cellZ - row * FOG_CHUNK) * FOG_CHUNK + (cellX - column * FOG_CHUNK);
        const mask = 1 << (index & 7);
        if ((bits![index >> 3] & mask) === 0) {
          bits![index >> 3] |= mask;
          revealed += 1;
        }
      }
    }
    return revealed;
  }

  /** Compact text form: `column,row:base64;…`, oldest first. */
  serialize(): string {
    const parts: string[] = [];
    for (const [key, bits] of this.chunks) parts.push(`${key}:${toBase64(bits)}`);
    return parts.join(";");
  }

  /** Restores a store written by `serialize`; malformed entries are skipped. */
  static parse(text: string | null | undefined): ExplorationFog {
    const fog = new ExplorationFog();
    if (!text) return fog;
    for (const part of text.split(";")) {
      const match = /^(-?\d+),(-?\d+):([A-Za-z0-9+/=]+)$/.exec(part);
      if (!match) continue;
      const bits = fromBase64(match[3]);
      if (!bits || bits.length !== CHUNK_BYTES) continue;
      fog.chunks.set(chunkKey(Number(match[1]), Number(match[2])), bits);
      if (fog.chunks.size > MAX_FOG_CHUNKS) fog.chunks.delete(fog.chunks.keys().next().value as string);
    }
    return fog;
  }

  private touch(key: string): Uint8Array {
    let bits = this.chunks.get(key);
    if (bits) {
      this.chunks.delete(key);
    } else {
      bits = new Uint8Array(CHUNK_BYTES);
      if (this.chunks.size >= MAX_FOG_CHUNKS) this.chunks.delete(this.chunks.keys().next().value as string);
    }
    this.chunks.set(key, bits);
    return bits;
  }
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    out += index + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : "=";
    out += index + 2 < bytes.length ? ALPHABET[triple & 63] : "=";
  }
  return out;
}

function fromBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let written = 0;
  for (let index = 0; index < text.length; index += 4) {
    let triple = 0;
    for (let offset = 0; offset < 4; offset += 1) {
      const character = text[index + offset];
      const value = character === "=" ? 0 : ALPHABET.indexOf(character);
      if (value < 0) return null;
      triple = (triple << 6) | value;
    }
    if (written < out.length) out[written++] = (triple >> 16) & 255;
    if (written < out.length) out[written++] = (triple >> 8) & 255;
    if (written < out.length) out[written++] = triple & 255;
  }
  return out;
}
