import type { PointOfInterestKind } from "../types";

/**
 * Single source of truth for the archipelago. Rendering, collision,
 * bathymetry, ship routing, the map and discovery all read these definitions.
 * Coordinates are world metres; +Z is north and +X is west (three.js is
 * right-handed and the simulator's heading grows toward +X).
 */

export type IslandKind = "hill" | "rocky" | "atoll" | "volcano" | "islet";

export type IslandDefinition = {
  id: string;
  kind: IslandKind;
  x: number;
  z: number;
  beachRadius: number;
  /** Elliptical north–south scale of the shoreline. */
  scaleZ: number;
  /** Highest terrain point above sea level, metres. */
  peakHeight: number;
  seed: number;
  palms: number;
  rocks: number;
  pier?: { angle: number; length: number };
  hut?: { angle: number; radial: number };
  lighthouse?: { angle: number; radial: number };
};

export const ISLANDS: readonly IslandDefinition[] = [
  {
    id: "palm-cay",
    kind: "hill",
    x: -115,
    z: -65,
    beachRadius: 54,
    scaleZ: 0.72,
    peakHeight: 14,
    seed: 11,
    palms: 18,
    rocks: 12,
    pier: { angle: 0.35, length: 24 },
    hut: { angle: 0.62, radial: 0.66 },
  },
  {
    id: "lighthouse-rock",
    kind: "rocky",
    x: 138,
    z: -28,
    beachRadius: 46,
    scaleZ: 0.82,
    peakHeight: 10,
    seed: 23,
    palms: 7,
    rocks: 26,
    lighthouse: { angle: -0.5, radial: 0.42 },
  },
  {
    id: "sand-atoll",
    kind: "atoll",
    x: 25,
    z: 175,
    beachRadius: 36,
    scaleZ: 0.68,
    peakHeight: 1.7,
    seed: 37,
    palms: 15,
    rocks: 4,
  },
  {
    id: "fire-mountain",
    kind: "volcano",
    x: -520,
    z: 430,
    beachRadius: 135,
    scaleZ: 0.9,
    peakHeight: 118,
    seed: 53,
    palms: 22,
    rocks: 34,
  },
  {
    id: "monolith-islet",
    kind: "islet",
    x: 420,
    z: 330,
    beachRadius: 17,
    scaleZ: 0.9,
    peakHeight: 3.4,
    seed: 71,
    palms: 0,
    rocks: 10,
  },
];

export type ReefDefinition = { x: number; z: number; radius: number; topDepth: number };

/** Shallow sand-and-coral reef that holds the galleon wreck within view. */
export const GALLEON_REEF: ReefDefinition = { x: 300, z: -250, radius: 80, topDepth: 6.4 };

export type PointOfInterestDefinition = {
  id: string;
  kind: PointOfInterestKind;
  x: number;
  z: number;
  /** The place is marked on the map once the yacht comes this close. */
  discoverRadius: number;
};

export const POINTS_OF_INTEREST: readonly PointOfInterestDefinition[] = [
  { id: "volcano", kind: "volcano", x: -520, z: 430, discoverRadius: 720 },
  { id: "lighthouse", kind: "lighthouse", x: 155, z: -36, discoverRadius: 420 },
  { id: "galleon", kind: "galleon", x: GALLEON_REEF.x, z: GALLEON_REEF.z, discoverRadius: 110 },
  { id: "monolith", kind: "monolith", x: 420, z: 330, discoverRadius: 320 },
  { id: "party", kind: "party", x: -340, z: -320, discoverRadius: 320 },
];

export type CollectibleDefinition = { id: string; kind: "bottle" | "crate"; x: number; z: number };

/** Floating finds scattered around the archipelago, clear of every shoreline. */
export const COLLECTIBLES: readonly CollectibleDefinition[] = [
  { id: "bottle-1", kind: "bottle", x: 62, z: 48 },
  { id: "bottle-2", kind: "bottle", x: -210, z: 70 },
  { id: "bottle-3", kind: "bottle", x: 240, z: 120 },
  { id: "bottle-4", kind: "bottle", x: -60, z: -230 },
  { id: "bottle-5", kind: "bottle", x: 360, z: -90 },
  { id: "bottle-6", kind: "bottle", x: -390, z: 210 },
  { id: "bottle-7", kind: "bottle", x: 150, z: 420 },
  { id: "bottle-8", kind: "bottle", x: -560, z: -120 },
  { id: "crate-1", kind: "crate", x: 300, z: -205 },
  { id: "crate-2", kind: "crate", x: -300, z: -270 },
  { id: "crate-3", kind: "crate", x: 470, z: 260 },
  { id: "crate-4", kind: "crate", x: -60, z: 330 },
  { id: "crate-5", kind: "crate", x: 610, z: 40 },
  { id: "crate-6", kind: "crate", x: -420, z: 560 },
];

/** Half-size of the charted area shown on the full map, metres. */
export const WORLD_EXTENT = 1500;

/** Normalised elliptical distance from an island centre (1 = nominal beach). */
export function islandRadial(island: IslandDefinition, x: number, z: number): number {
  const dx = x - island.x;
  const dz = (z - island.z) / island.scaleZ;
  return Math.hypot(dx, dz) / island.beachRadius;
}

/** Shortest horizontal clearance from any island's beach, metres. */
export function landClearance(x: number, z: number): number {
  let clearance = Number.POSITIVE_INFINITY;
  for (const island of ISLANDS) {
    const dx = x - island.x;
    const dz = (z - island.z) / island.scaleZ;
    clearance = Math.min(clearance, Math.hypot(dx, dz) - island.beachRadius);
  }
  return clearance;
}

/** Does the straight segment come within `margin` metres of any shoreline? */
export function segmentNearLand(ax: number, az: number, bx: number, bz: number, margin: number): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 40));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (landClearance(ax + (bx - ax) * t, az + (bz - az) * t) < margin) return true;
  }
  return false;
}
