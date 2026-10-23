/**
 * Things floating on the sea, in numbers: where they drift, what is inside
 * and when the yacht is close enough to pick one up.
 *
 * The sea is cut into `LOOT_CELL` squares. Each square has, by a hash of its
 * coordinates, at most one thing afloat in it: a glowing bottle with a
 * message, a wooden crate, or an inflatable pink flamingo. The same sea
 * always holds the same things, so nothing has to be stored except what has
 * been picked up. Pure; `LootSystem` draws and floats them.
 */

export type LootKind = "bottle" | "crate" | "flamingo";

export type LootItem = {
  /** Stable key of the cell it floats in. */
  key: string;
  kind: LootKind;
  x: number;
  z: number;
  /** 0…1, for its spin, bobbing phase and contents. */
  seed: number;
};

/** Side of one loot square, metres: at 6 knots one is crossed in a minute and a half. */
export const LOOT_CELL = 260;
/** Chance a square has something afloat in it. */
export const LOOT_CHANCE = 0.5;
/** Things farther than this are not floated or drawn, metres. */
export const LOOT_RANGE = 700;
/** Open water an item needs around it (clear of beaches and surf), metres. */
export const LOOT_SHORE_CLEARANCE = 30;
/** Margin around the hulls inside which a thing is hauled aboard, metres. */
export const PICKUP_MARGIN = 3.2;
/** Half the yacht's beam and length at the waterline, metres. */
const HALF_BEAM = 2.1;
const HALF_LENGTH = 5.4;

/** The sail colours a bottle may hold (white is the yacht's own). */
export const SAIL_COLORS = {
  white: 0xdcd8ca,
  sunset: 0xf06a3c,
  lagoon: 0x2bb7b3,
  royal: 0x4f46c8,
  gold: 0xe8b23c,
  flamingo: 0xf47fb8,
  pirate: 0x232328,
} as const;

export type SailColor = keyof typeof SAIL_COLORS;
export const SAIL_COLOR_IDS = Object.keys(SAIL_COLORS) as SailColor[];

export function isSailColor(value: unknown): value is SailColor {
  return typeof value === "string" && value in SAIL_COLORS;
}

/** Messages a bottle can hold; the interface has the words for each. */
export const BOTTLE_MESSAGES = [
  "joke-anchor",
  "joke-pirate-alphabet",
  "joke-ocean-wave",
  "joke-sailor-cards",
  "joke-fish-piano",
  "riddle-teeth",
  "riddle-shadow",
  "riddle-hole",
  "riddle-towel",
  "egg-time-traveller",
  "egg-cat-captain",
  "egg-coordinates",
  "egg-developer",
] as const;
export type BottleMessage = (typeof BOTTLE_MESSAGES)[number];

/** What crates carry. */
export const CRATE_CARGO = ["coconuts", "spices", "ducks", "chart", "doubloons", "lanterns"] as const;
export type CrateCargo = (typeof CRATE_CARGO)[number];

export type LootContents =
  | { kind: "bottle"; sailColor: SailColor }
  | { kind: "bottle"; message: BottleMessage }
  | { kind: "crate"; cargo: CrateCargo; coins: number }
  | { kind: "flamingo" };

function hash(column: number, row: number, salt: number): number {
  let h = Math.imul((column | 0) ^ 0x1b873593, 0xcc9e2d51) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul((h ^ (h >>> 13)) + Math.imul(row | 0, 0x27d4eb2d), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export function lootCellKey(column: number, row: number): string {
  return `${column}:${row}`;
}

/** The item floating in square (column, row), or null. `isOpen` vets the water. */
export function lootInCell(column: number, row: number, isOpen: (x: number, z: number) => boolean): LootItem | null {
  if (hash(column, row, 11) >= LOOT_CHANCE) return null;
  // The start square stays empty: the first find should be a little way off.
  if (column === 0 && row === -1) return null;
  const roll = hash(column, row, 23);
  const kind: LootKind = roll < 0.46 ? "bottle" : roll < 0.75 ? "crate" : "flamingo";
  const x = (column + 0.1 + hash(column, row, 37) * 0.8) * LOOT_CELL;
  const z = (row + 0.1 + hash(column, row, 41) * 0.8) * LOOT_CELL;
  if (!isOpen(x, z)) return null;
  return { key: lootCellKey(column, row), kind, x, z, seed: hash(column, row, 53) };
}

/**
 * Everything afloat within `radius` of (x, z) that has not been picked up,
 * nearest first.
 */
export function lootAround(
  x: number,
  z: number,
  radius: number,
  collected: ReadonlySet<string>,
  isOpen: (x: number, z: number) => boolean,
): LootItem[] {
  const found: { item: LootItem; distance: number }[] = [];
  const first = Math.floor((x - radius) / LOOT_CELL);
  const last = Math.floor((x + radius) / LOOT_CELL);
  const top = Math.floor((z - radius) / LOOT_CELL);
  const bottom = Math.floor((z + radius) / LOOT_CELL);
  for (let row = top; row <= bottom; row += 1) {
    for (let column = first; column <= last; column += 1) {
      if (collected.has(lootCellKey(column, row))) continue;
      const item = lootInCell(column, row, isOpen);
      if (!item) continue;
      const distance = Math.hypot(item.x - x, item.z - z);
      if (distance <= radius) found.push({ item, distance });
    }
  }
  found.sort((a, b) => a.distance - b.distance);
  return found.map((entry) => entry.item);
}

/**
 * Whether a thing at (itemX, itemZ) is alongside the yacht at (x, z) heading
 * `heading`: within `PICKUP_MARGIN` of her hulls, where a crewman with a
 * boathook can reach it.
 */
export function withinReach(x: number, z: number, heading: number, itemX: number, itemZ: number): boolean {
  const dx = itemX - x;
  const dz = itemZ - z;
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const along = dx * forwardX + dz * forwardZ;
  const across = dx * forwardZ - dz * forwardX;
  const outsideAlong = Math.max(0, Math.abs(along) - HALF_LENGTH);
  const outsideAcross = Math.max(0, Math.abs(across) - HALF_BEAM);
  return Math.hypot(outsideAlong, outsideAcross) <= PICKUP_MARGIN;
}

/**
 * What is inside. A bottle holds a new sail colour (while any is still to
 * be found, about a third of the time) or a message; a crate some cargo and
 * a few doubloons; a flamingo is a flamingo.
 */
export function lootContents(item: LootItem, unlocked: readonly SailColor[]): LootContents {
  const pick = <T>(list: readonly T[], value: number): T => list[Math.min(list.length - 1, Math.floor(value * list.length))]!;
  const roll = (item.seed * 9301 + 0.49297) % 1;
  if (item.kind === "bottle") {
    const locked = SAIL_COLOR_IDS.filter((color) => color !== "white" && !unlocked.includes(color));
    if (locked.length > 0 && roll < 0.36) return { kind: "bottle", sailColor: pick(locked, (roll / 0.36 + item.seed) % 1) };
    return { kind: "bottle", message: pick(BOTTLE_MESSAGES, item.seed) };
  }
  if (item.kind === "crate") return { kind: "crate", cargo: pick(CRATE_CARGO, item.seed), coins: 5 + Math.floor(roll * 36) };
  return { kind: "flamingo" };
}
