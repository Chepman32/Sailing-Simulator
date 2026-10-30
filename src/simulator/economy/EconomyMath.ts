/**
 * The voyage's economy, as plain numbers: what lies on the sea floor and
 * what it is worth, what the island traders sell and what each purchase
 * does, and the price curve that keeps the next step always a little out
 * of reach.
 *
 * Currency is gold (the doubloons the crates already held). Finds come in
 * three tiers: everyday wrack worth 10–40 (a shallow swim fills a pocket),
 * old things of value worth 100–350 (deeper water and reefs), and chests of
 * gold worth 500–1500 paid straight into the purse (rare, deep or tucked into
 * the reefs). Upgrades cost `base × 1.65^level`: the first levels and the
 * decor are a swim or two away, the top engine and sonar want long
 * expeditions after artefacts and chests.
 *
 * Everything here is pure and deterministic: the world's finds come from a
 * hash of their place, so they are the same on every visit.
 */

// --- Prices ---------------------------------------------------------------------

/** Growth of an upgrade's price from one level to the next. */
export const PRICE_GROWTH = 1.65;

/** Price of the next level when `level` levels are owned: `base × 1.65^level`, in whole gold. */
export function upgradePrice(base: number, level: number): number {
  return Math.round(base * Math.pow(PRICE_GROWTH, Math.max(0, level)));
}

/** Gold to buy every level of an upgrade from nothing. */
export function totalUpgradeCost(base: number, levels: number): number {
  let sum = 0;
  for (let level = 0; level < levels; level += 1) sum += upgradePrice(base, level);
  return sum;
}

// --- Upgrades ---------------------------------------------------------------------

export type UpgradeId = "engine" | "monitor" | "sonar" | "flare" | "tank" | "fins" | "torch";
export type UpgradeCategory = "yacht" | "gear";

export type UpgradeDefinition = {
  id: UpgradeId;
  category: UpgradeCategory;
  /** Price of the first level, gold. */
  base: number;
  /** Highest level (Tier MAX). */
  max: number;
};

export const UPGRADES: readonly UpgradeDefinition[] = [
  { id: "engine", category: "yacht", base: 140, max: 10 },
  { id: "monitor", category: "yacht", base: 190, max: 4 },
  { id: "sonar", category: "yacht", base: 160, max: 8 },
  { id: "flare", category: "yacht", base: 110, max: 6 },
  { id: "tank", category: "gear", base: 100, max: 6 },
  { id: "fins", category: "gear", base: 120, max: 6 },
  { id: "torch", category: "gear", base: 80, max: 5 },
];

export const UPGRADE_IDS = UPGRADES.map((upgrade) => upgrade.id);

export function upgradeDefinition(id: UpgradeId): UpgradeDefinition {
  return UPGRADES.find((upgrade) => upgrade.id === id)!;
}

export type UpgradeLevels = Record<UpgradeId, number>;

export function createUpgradeLevels(): UpgradeLevels {
  return { engine: 0, monitor: 0, sonar: 0, flare: 0, tank: 0, fins: 0, torch: 0 };
}

/** What the engine's level does to the propellers: more thrust, a higher top speed, a quicker answer. */
export type EngineBoost = {
  /** Multiplies the bollard thrust. */
  thrust: number;
  /** Multiplies the speed at which thrust fades (so the top speed rises with it). */
  fade: number;
  /** Multiplies how quickly the shaft spools up and down. */
  response: number;
};

export function engineBoost(level: number): EngineBoost {
  const l = Math.max(0, level);
  return { thrust: 1 + 0.11 * l, fade: 1 + 0.06 * l, response: 1 + 0.14 * l };
}

/** Tier of finds the sonar marks at a level: chests first, then artefacts, then everything. */
export function sonarRevealsTier(level: number, tier: FindTier): boolean {
  if (level <= 0) return false;
  if (tier === 3) return true;
  if (tier === 2) return level >= 3;
  return level >= 6;
}

/** How far round the yacht the sonar sweeps, m. */
export function sonarRange(level: number): number {
  return level <= 0 ? 0 : 50 + 35 * level;
}

/** How deep the sonar sees, m (a chest on the open-water floor is in reach from the first level). */
export function sonarDepth(level: number): number {
  return level <= 0 ? 0 : 18 + 2.5 * level;
}

/** What the helm monitor shows at a level (the sonar's contacts are shown on any of them). */
export type MonitorFeatures = {
  /** A wide display filling the instrument pod (the stock chart plotter otherwise). */
  wide: boolean;
  /** The chart shaded by depth (a bathymetric map). */
  depthMap: boolean;
  /** The depth map lit as relief, contour lines at every five metres. */
  relief: boolean;
  /** Range multiplier of the chart. */
  rangeScale: number;
};

export function monitorFeatures(level: number): MonitorFeatures {
  return {
    wide: level >= 1,
    depthMap: level >= 2,
    relief: level >= 4,
    rangeScale: level >= 4 ? 2.2 : level >= 3 ? 1.6 : 1,
  };
}

/** The flare gun's level: how high and far it climbs, how long and bright it burns, how far its light reaches. */
export type FlareBoost = { apex: number; burn: number; power: number; reach: number };

export function flareBoost(level: number): FlareBoost {
  const l = Math.max(0, level);
  return { apex: 1 + 0.15 * l, burn: 1 + 0.2 * l, power: 1 + 0.22 * l, reach: 1 + 0.25 * l };
}

/** Diving gear: the tank's capacity, the fins' speed, the torch's light. */
export type GearBoost = { air: number; swim: number; torch: number; torchRange: number };

export function gearBoost(tank: number, fins: number, torch: number): GearBoost {
  return {
    air: 1 + 0.45 * Math.max(0, tank),
    swim: 1 + 0.09 * Math.max(0, fins),
    torch: 1 + 0.4 * Math.max(0, torch),
    torchRange: 1 + 0.3 * Math.max(0, torch),
  };
}

// --- Decor ----------------------------------------------------------------------------

export type DecorSlot = "flag" | "charm" | "bobble";

export type DecorDefinition = {
  id: string;
  slot: DecorSlot;
  price: number;
};

export const DECOR: readonly DecorDefinition[] = [
  { id: "flag-jolly", slot: "flag", price: 140 },
  { id: "flag-tropic", slot: "flag", price: 160 },
  { id: "flag-signal", slot: "flag", price: 220 },
  { id: "flag-rainbow", slot: "flag", price: 260 },
  { id: "flag-dragon", slot: "flag", price: 480 },
  { id: "charm-shell", slot: "charm", price: 90 },
  { id: "charm-anchor", slot: "charm", price: 130 },
  { id: "charm-dreamcatcher", slot: "charm", price: 210 },
  { id: "charm-pearl", slot: "charm", price: 340 },
  { id: "bobble-hula", slot: "bobble", price: 180 },
  { id: "bobble-captain", slot: "bobble", price: 220 },
  { id: "bobble-parrot", slot: "bobble", price: 260 },
  { id: "bobble-shark", slot: "bobble", price: 420 },
];

export function decorDefinition(id: string): DecorDefinition | null {
  return DECOR.find((item) => item.id === id) ?? null;
}

// --- Finds on the sea floor --------------------------------------------------------

export type FindTier = 1 | 2 | 3;

export type FindKind =
  | "shell"
  | "fishbones"
  | "anchor"
  | "bottle"
  | "debris"
  | "can"
  | "amphora"
  | "compass"
  | "sextant"
  | "coral"
  | "statuette"
  | "chest";

export const FIND_KINDS: readonly FindKind[] = [
  "shell",
  "fishbones",
  "anchor",
  "bottle",
  "debris",
  "can",
  "amphora",
  "compass",
  "sextant",
  "coral",
  "statuette",
  "chest",
];

export const FIND_TIER: Record<FindKind, FindTier> = {
  shell: 1,
  fishbones: 1,
  anchor: 1,
  bottle: 1,
  debris: 1,
  can: 1,
  amphora: 2,
  compass: 2,
  sextant: 2,
  coral: 2,
  statuette: 2,
  chest: 3,
};

/** What each tier is worth, gold. */
export const TIER_VALUE: Record<FindTier, readonly [number, number]> = {
  1: [10, 40],
  2: [100, 350],
  3: [500, 1500],
};

/** Some kinds are worth more within their tier (a rusty anchor more than a can). */
const KIND_VALUE_BIAS: Record<FindKind, number> = {
  shell: 0.35,
  fishbones: 0.15,
  anchor: 0.7,
  bottle: 0.45,
  debris: 0.3,
  can: 0,
  amphora: 0.4,
  compass: 0.55,
  sextant: 0.75,
  coral: 0.6,
  statuette: 0.9,
  chest: 0.5,
};

/** Side of the cells the sea floor's finds are decided in, m. */
export const FIND_CELL = 40;

export type SeabedFind = {
  /** Stable identity (its cell and slot): picked-up finds stay gone. */
  key: string;
  kind: FindKind;
  tier: FindTier;
  /** Gold it fetches (tiers 1–2) or holds (a chest). */
  value: number;
  x: number;
  z: number;
  /** Turn about the vertical and a seed for its look. */
  yaw: number;
  seed: number;
};

function hash(a: number, b: number, salt: number): number {
  let h = Math.imul((a | 0) ^ 0x6d2b79f5, 0x85ebca6b) ^ Math.imul((b | 0) + salt * 0x9e3779b9, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Gold a find of `kind` with roll `r` (0…1) is worth: within its tier's range, weighted by kind. */
export function findValue(kind: FindKind, r: number): number {
  const [low, high] = TIER_VALUE[FIND_TIER[kind]];
  const bias = KIND_VALUE_BIAS[kind];
  // Mostly the low end of the range, now and then a good one.
  const t = Math.min(1, Math.max(0, bias * 0.45 + Math.pow(r, 1.7) * 0.55));
  return Math.round(low + (high - low) * t);
}

const TIER_ONE: readonly FindKind[] = ["shell", "shell", "fishbones", "bottle", "can", "debris", "anchor"];
const TIER_TWO: readonly FindKind[] = ["amphora", "amphora", "compass", "sextant", "coral", "statuette"];

/**
 * The finds lying in the cell (column, row) of `FIND_CELL` metres. `depth`
 * is the water depth at a point (m) and `reef` how much reef grows there
 * (0…1). Everyday wrack is everywhere the water is deep enough to swim;
 * artefacts are fewer, deeper and on the reefs; chests are rare, deep or
 * tucked into thick reef.
 */
export function findsInCell(
  column: number,
  row: number,
  depth: (x: number, z: number) => number,
  reef: (x: number, z: number) => number,
  out: SeabedFind[] = [],
): SeabedFind[] {
  out.length = 0;
  const x0 = column * FIND_CELL;
  const z0 = row * FIND_CELL;
  const place = (slot: number) => {
    const x = x0 + (0.08 + hash(column, row, 10 + slot * 3) * 0.84) * FIND_CELL;
    const z = z0 + (0.08 + hash(column, row, 11 + slot * 3) * 0.84) * FIND_CELL;
    return { x, z };
  };
  const add = (slot: number, kind: FindKind, x: number, z: number) => {
    out.push({
      key: `${column}:${row}:${slot}`,
      kind,
      tier: FIND_TIER[kind],
      value: findValue(kind, hash(column, row, 300 + slot)),
      x,
      z,
      yaw: hash(column, row, 400 + slot) * Math.PI * 2,
      seed: hash(column, row, 500 + slot),
    });
  };
  // Tier 1: two to five bits of wrack wherever a swimmer goes.
  const common = 2 + Math.floor(hash(column, row, 1) * 4);
  for (let slot = 0; slot < common; slot += 1) {
    const { x, z } = place(slot);
    const d = depth(x, z);
    if (d < 1.4 || d > 30) continue;
    add(slot, TIER_ONE[Math.floor(hash(column, row, 100 + slot) * TIER_ONE.length)]!, x, z);
  }
  // Tier 2: an artefact in about one cell in four, likelier deep and on reefs.
  {
    const slot = 20;
    const { x, z } = place(slot);
    const d = depth(x, z);
    const r = reef(x, z);
    const chance = 0.16 + 0.2 * Math.min(1, Math.max(0, (d - 5) / 10)) + 0.22 * r;
    if (d >= 3 && hash(column, row, 2) < chance) add(slot, TIER_TWO[Math.floor(hash(column, row, 120) * TIER_TWO.length)]!, x, z);
  }
  // Tier 3: a chest in about one cell in thirty, on the deep floor or in thick reef.
  {
    const slot = 30;
    const { x, z } = place(slot);
    const d = depth(x, z);
    const r = reef(x, z);
    const fit = d >= 12 || (r > 0.55 && d >= 6);
    if (fit && hash(column, row, 3) < 0.034 + 0.03 * r) add(slot, "chest", x, z);
  }
  return out;
}

// --- The bag of finds ------------------------------------------------------------------

export type CarriedFind = { kind: FindKind; value: number };

/** Gold the finds in the bag fetch from a trader. */
export function bagValue(bag: readonly CarriedFind[]): number {
  return bag.reduce((sum, item) => sum + item.value, 0);
}

/** The bag grouped by kind (for the trader's counter): count and total of each. */
export function bagByKind(bag: readonly CarriedFind[]): { kind: FindKind; count: number; total: number }[] {
  const groups = new Map<FindKind, { kind: FindKind; count: number; total: number }>();
  for (const item of bag) {
    const group = groups.get(item.kind) ?? { kind: item.kind, count: 0, total: 0 };
    group.count += 1;
    group.total += item.value;
    groups.set(item.kind, group);
  }
  return FIND_KINDS.filter((kind) => groups.has(kind)).map((kind) => groups.get(kind)!);
}

// --- Persistence -------------------------------------------------------------------------

/** The economy's saved state. */
export type EconomyState = {
  upgrades: UpgradeLevels;
  /** Finds carried, not yet sold. */
  bag: CarriedFind[];
  /** Decor bought, and what hangs where. */
  decor: string[];
  equipped: Record<DecorSlot, string | null>;
  /** Keys of the sea-floor finds already taken (most recent last). */
  taken: string[];
};

export const MAX_TAKEN_FINDS = 6000;

export function createEconomyState(): EconomyState {
  return { upgrades: createUpgradeLevels(), bag: [], decor: [], equipped: { flag: null, charm: null, bobble: null }, taken: [] };
}

/** A saved economy, checked field by field (anything malformed falls back to a fresh start). */
export function restoreEconomy(saved: unknown): EconomyState {
  const state = createEconomyState();
  if (!saved || typeof saved !== "object") return state;
  const source = saved as Partial<EconomyState>;
  if (source.upgrades && typeof source.upgrades === "object") {
    for (const upgrade of UPGRADES) {
      const value = (source.upgrades as Record<string, unknown>)[upgrade.id];
      if (typeof value === "number" && Number.isFinite(value)) state.upgrades[upgrade.id] = Math.max(0, Math.min(upgrade.max, Math.floor(value)));
    }
  }
  if (Array.isArray(source.bag)) {
    for (const item of source.bag.slice(-500)) {
      if (item && typeof item === "object" && FIND_KINDS.includes((item as CarriedFind).kind) && Number.isFinite((item as CarriedFind).value)) {
        state.bag.push({ kind: (item as CarriedFind).kind, value: Math.max(0, Math.round((item as CarriedFind).value)) });
      }
    }
  }
  if (Array.isArray(source.decor)) state.decor = Array.from(new Set(source.decor.filter((id): id is string => typeof id === "string" && decorDefinition(id) !== null)));
  if (source.equipped && typeof source.equipped === "object") {
    for (const slot of ["flag", "charm", "bobble"] as const) {
      const id = (source.equipped as Record<string, unknown>)[slot];
      if (typeof id === "string" && state.decor.includes(id) && decorDefinition(id)?.slot === slot) state.equipped[slot] = id;
    }
  }
  if (Array.isArray(source.taken)) state.taken = source.taken.filter((key): key is string => typeof key === "string").slice(-MAX_TAKEN_FINDS);
  return state;
}
