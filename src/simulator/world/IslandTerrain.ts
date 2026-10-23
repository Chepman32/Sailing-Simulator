import { clamp, smoothstep } from "../math";
import type { IslandDefinition } from "./WorldLayout";

/**
 * Pure, deterministic island relief. The terrain mesh, palm and prop placement,
 * the photo director's line-of-sight checks and the map outline all sample
 * these functions, so what is drawn is what is tested.
 *
 * Terrain is described in polar form around the island centre: `radial` is the
 * distance normalised by the (edge-noised) beach radius, so 1 is the shoreline.
 */

export const MAX_VISIBLE_TERRAIN_RADIUS_SCALE = 1.06;

function hash(value: number): number {
  const s = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth 1D periodic noise over the angle, seeded per island. */
function angularNoise(angle: number, seed: number, octaves = 3): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 3;
  for (let octave = 0; octave < octaves; octave += 1) {
    const phase = hash(seed * 13 + octave * 7) * Math.PI * 2;
    total += Math.sin(angle * frequency + phase) * amplitude;
    amplitude *= 0.5;
    frequency = frequency * 2 + 1;
  }
  return total / 1.75;
}

/** 2D value noise in normalised island space for hills and outcrops. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const localX = x - cellX;
  const localY = y - cellY;
  const sx = localX * localX * (3 - 2 * localX);
  const sy = localY * localY * (3 - 2 * localY);
  const corner = (cx: number, cy: number): number => hash(cx * 57.3 + cy * 131.7 + seed * 19.1);
  const a = corner(cellX, cellY);
  const b = corner(cellX + 1, cellY);
  const c = corner(cellX, cellY + 1);
  const d = corner(cellX + 1, cellY + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2(x * frequency, y * frequency, seed + octave * 3.7) * amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return total;
}

/** Irregular shoreline: the beach radius multiplier at a given angle. */
export function shorelineScale(island: IslandDefinition, angle: number): number {
  const roughness = island.kind === "rocky" ? 0.075 : island.kind === "volcano" ? 0.06 : 0.045;
  return 1 + angularNoise(angle, island.seed) * roughness;
}

/** Shared beach-to-seabed profile used by every island kind. */
function shoreProfile(radial: number, inland: number): number {
  if (radial < 0.9) return inland;
  if (radial < 1) return inland + (-0.08 - inland) * smoothstep(0.9, 1, radial);
  return -0.08 + (-0.42 + 0.08) * smoothstep(1, MAX_VISIBLE_TERRAIN_RADIUS_SCALE, radial);
}

export function volcanoConeHeight(radial: number, peak: number): number {
  const rim = 0.075;
  const cone = (s: number): number => peak * Math.pow(Math.max(0, 1 - s / 0.95), 1.7);
  if (radial >= rim) return cone(radial);
  // Crater: a bowl sunk 12% of the peak below the rim.
  const t = radial / rim;
  return cone(rim) - peak * 0.12 * (1 - t * t);
}

/** Terrain height (metres above sea level) at a polar island coordinate. */
export function islandHeight(island: IslandDefinition, radial: number, angle: number): number {
  const nx = Math.cos(angle) * radial;
  const nz = Math.sin(angle) * radial;
  const inlandFade = 1 - smoothstep(0.62, 0.92, radial);
  const seed = island.seed;
  switch (island.kind) {
    case "hill": {
      // An off-centre forested hill with a ridge toward one side.
      const px = nx + 0.22;
      const pz = nz - 0.08;
      const hill = Math.exp(-(px * px + pz * pz) / (2 * 0.3 * 0.3));
      const ridge = Math.exp(-((nz + 0.25 * nx) ** 2) / 0.05) * smoothstep(0.75, 0.1, radial);
      const relief = island.peakHeight * (hill * 0.86 + ridge * 0.22) + (fbm(nx * 3, nz * 3, seed) - 0.5) * 2.2;
      return shoreProfile(radial, 1.25 + Math.max(0, relief) * inlandFade);
    }
    case "rocky": {
      // Ridged rock with a cliff face on the seaward side.
      const ridged = 1 - Math.abs(fbm(nx * 2.6, nz * 2.6, seed) * 2 - 1);
      const mass = island.peakHeight * (0.45 + ridged * 0.55) * (1 - smoothstep(0.1, 0.78, radial));
      const cliffSide = smoothstep(0.2, 0.9, Math.cos(angle + 0.5));
      const plateau = 2 + mass;
      const cliffDrop = cliffSide * smoothstep(0.72, 0.9, radial) * plateau * 0.9;
      return shoreProfile(radial, Math.max(0.6, plateau - cliffDrop));
    }
    case "atoll": {
      const dunes = (fbm(nx * 4, nz * 4, seed) - 0.5) * 0.9;
      return shoreProfile(radial, island.peakHeight * (1 - smoothstep(0.1, 0.9, radial) * 0.5) + dunes * inlandFade);
    }
    case "islet": {
      const rock = island.peakHeight * Math.pow(Math.max(0, 1 - radial / 0.9), 0.9) + (fbm(nx * 5, nz * 5, seed) - 0.5) * 1.2;
      return shoreProfile(radial, Math.max(0.4, rock));
    }
    case "volcano": {
      const cone = volcanoConeHeight(radial, island.peakHeight);
      // Radial erosion gullies, strongest on the mid slopes.
      const warp = fbm(nx * 2, nz * 2, seed) * 4;
      const gully = Math.pow(Math.abs(Math.sin(angle * 13 + warp)), 3) * 0.7 + Math.pow(Math.abs(Math.sin(angle * 31 + warp * 1.7)), 4) * 0.3;
      const erosion = 1 - gully * 0.13 * smoothstep(0.1, 0.4, radial) * (1 - smoothstep(0.72, 0.92, radial));
      const lumps = (fbm(nx * 6, nz * 6, seed + 9) - 0.5) * 4.5 * smoothstep(0.08, 0.3, radial);
      // Broad asymmetry, a parasitic cone on the flank and a notched crater rim
      // keep the silhouette from reading as a perfect geometric cone.
      const broad = (fbm(nx * 1.4 + 2, nz * 1.4, seed + 3) - 0.5) * 16 * smoothstep(0.05, 0.25, radial) * (1 - smoothstep(0.6, 0.9, radial));
      const px = nx - 0.36;
      const pz = nz + 0.22;
      const parasite = 17 * Math.exp(-(px * px + pz * pz) / (2 * 0.09 * 0.09));
      const notch = radial < 0.1 ? (1 - radial / 0.1) * Math.pow(Math.max(0, Math.cos(angle - 2.35)), 6) * -9 : 0;
      const inland = Math.max(1.1, cone * erosion + lumps + broad + parasite + notch);
      if (radial < 0.93) return inland;
      return shoreProfile(Math.max(0.9, radial), 1.1 + (inland - 1.1) * (1 - smoothstep(0.93, 0.97, radial)));
    }
  }
}

/** Angles (radians) of the volcano's three lava channels. */
export const LAVA_CHANNEL_ANGLES = [0.4, 2.35, 4.4] as const;

/** 0…1 mask of glowing lava for a volcano vertex: crater pool plus channels. */
export function lavaMask(island: IslandDefinition, radial: number, angle: number): number {
  if (island.kind !== "volcano") return 0;
  const crater = 1 - smoothstep(0.045, 0.07, radial);
  let channel = 0;
  for (const channelAngle of LAVA_CHANNEL_ANGLES) {
    const wander = Math.sin(radial * 14 + channelAngle * 3) * 0.06;
    const difference = Math.atan2(Math.sin(angle - channelAngle - wander), Math.cos(angle - channelAngle - wander));
    const lateralMetres = Math.abs(difference) * radial * island.beachRadius;
    const width = 3 + radial * 9;
    const along = smoothstep(0.06, 0.1, radial) * (1 - smoothstep(0.38, 0.62, radial));
    channel = Math.max(channel, Math.exp(-(lateralMetres * lateralMetres) / (width * width)) * along);
  }
  return clamp(Math.max(crater, channel), 0, 1);
}

/**
 * Terrain height at a world position, or -Infinity over open water. Used for
 * camera clearance and line-of-sight tests without touching the GPU mesh.
 */
export function terrainHeightAt(islands: readonly IslandDefinition[], x: number, z: number): number {
  let height = Number.NEGATIVE_INFINITY;
  for (const island of islands) {
    const dx = x - island.x;
    const dz = (z - island.z) / island.scaleZ;
    const angle = Math.atan2(dz, dx);
    const radial = Math.hypot(dx, dz) / (island.beachRadius * shorelineScale(island, angle));
    if (radial > MAX_VISIBLE_TERRAIN_RADIUS_SCALE) continue;
    height = Math.max(height, islandHeight(island, radial, angle));
  }
  return height;
}

/** World position of a polar island coordinate (shoreline-noise aware). */
export function islandPoint(island: IslandDefinition, radial: number, angle: number): { x: number; z: number; y: number } {
  const radius = island.beachRadius * shorelineScale(island, angle) * radial;
  return {
    x: island.x + Math.cos(angle) * radius,
    z: island.z + Math.sin(angle) * radius * island.scaleZ,
    y: islandHeight(island, radial, angle),
  };
}

/** Deterministic pseudo-random sequence for repeatable decoration layouts. */
export function seededRandom(seed: number): () => number {
  let state = Math.floor(seed * 9301 + 49297) % 233280;
  if (state <= 0) state += 233279;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}
