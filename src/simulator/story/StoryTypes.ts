/**
 * The shapes the campaign is written in. Everything the story is made of —
 * the sectors, the people, the missions, what is said and what happens — is
 * plain data in `content/`, checked by `tests/unit/campaign-content.test.ts`;
 * the engine (`CampaignMath`, `StorySystem`) only interprets it. A change of
 * plot is a change of data; code changes only for a new kind of step or a
 * new kind of thing in the world.
 *
 * The design document these data follow is `docs/campaign/`.
 */

/** The campaign is written in Russian and English; other interface languages read the English. */
export type StoryLanguage = "ru" | "en";
export type Text = { ru: string; en: string };

/** A point on the chart, metres east and north of the world's origin (world x = −east, z = north). */
export type ChartPoint = readonly [east: number, north: number];

export type Faction = {
  id: string;
  name: Text;
  /** The faction's colour on the chart and in the interface. */
  color: string;
  stance: "enemy" | "ally" | "neutral";
};

export type Character = {
  id: string;
  name: Text;
  /** The name he is called by on the radio, if any ("Блэк"). */
  callsign?: Text;
  role: Text;
  faction: string;
  /** Two letters on his radio card. */
  monogram: string;
};

/**
 * A stretch of a sector's border, shared by the two sectors either side of
 * it (or by a sector and the quarantine line), so neighbours can never gap or
 * overlap: a sector is a ring of borders.
 */
export type Border = { id: string; points: readonly ChartPoint[] };

export type SectorAtmosphere = {
  /** Extra haze in the air, 0…1 (the fog of the reef belt). */
  haze?: number;
  /** The weather the planner leans toward here. */
  weather?: readonly ("clear" | "cloudy" | "overcast" | "rain" | "downpour" | "storm")[];
};

export type Sector = {
  id: string;
  name: Text;
  /** A line under the name on the title card ("Внешний рифовый пояс"). */
  subtitle: Text;
  color: string;
  /** Where its name is written on the chart. */
  label: ChartPoint;
  /** The ring of borders round it, in order; `reverse` walks a border backwards. */
  ring: readonly { border: string; reverse?: boolean }[];
  atmosphere?: SectorAtmosphere;
  /** Who holds it at the start of the campaign. */
  holder: string;
  /** Whether it has story content in the game yet. */
  status: "playable" | "planned";
};

/**
 * How a story place is fitted to the procedural world: its chart point is
 * an approximate spot, and the place itself is found there.
 * - `island`: the nearest island (a walker lands on its beach, the yacht anchors off it);
 * - `pier`: the nearest island with a pier and a porch (where a person stands);
 * - `water`: the nearest open water;
 * - `point`: exactly the point.
 */
export type LocationSnap = "island" | "pier" | "water" | "point";

export type Location = {
  id: string;
  name: Text;
  sector: string;
  at: ChartPoint;
  snap: LocationSnap;
  /** How near counts as "there", m. */
  radius: number;
  /** Shown on the chart before the story leads there (the default is hidden until a step points at it). */
  charted?: boolean;
};

export type LineChannel = "radio" | "voice" | "thought" | "broadcast";

/** One line of dialogue. `who` is a character id, `hero`, `aquilon` (the network's voice) or `unknown`. */
export type Line = { who: string; text: Text; via?: LineChannel };

/** A group of Aquilon drones in the world. */
export type DroneGroup = {
  id: string;
  /** Where they patrol from. */
  at: string;
  count: number;
  /**
   * - `patrol`: a real hostile on its beat round `at`: hears and sees the yacht, hunts her, fights;
   * - `pass`: crosses by on a line (a demonstration): never attacks;
   * - `strike`: the prologue's interceptors: they know where she is and close in shooting, and cannot be stopped.
   */
  behaviour: "patrol" | "pass" | "strike";
  /** Patrol radius round `at`, m. */
  beat?: number;
  /** For `pass`: the line crossed, as two chart points. */
  line?: readonly [ChartPoint, ChartPoint];
  /** Seconds before a destroyed or salvaged drone of an ambient group comes back. */
  respawn?: number;
};

/** Something put into the world while a step (or the world) calls for it; reconciled, so it survives a reload. */
export type Presence =
  | { kind: "drones"; group: DroneGroup }
  /** A story item to be picked up: on the sea floor near the place, or on its beach. */
  | { kind: "item"; item: string; at: string; where: "seabed" | "ashore" }
  /** A character standing at a place (on its porch). */
  | { kind: "npc"; character: string; at: string };

/** Something that happens once, when a step starts or ends. */
export type Effect =
  | { do: "say"; lines: readonly Line[] }
  | { do: "title"; style: "chapter" | "place" | "end"; title: Text; subtitle?: Text }
  /** Puts the yacht at a place (anchored off it, bow toward it) and the skipper at her helm or ashore there. */
  | { do: "place"; yacht: string; skipper: "helm" | "ashore" }
  | { do: "damage"; hull?: number; engine?: boolean }
  | { do: "repair"; hull?: number; engine?: boolean }
  /** Gear (`rifle`) or a story item into the skipper's keeping. */
  | { do: "give"; what: string }
  | { do: "take"; item: string }
  | { do: "pay"; coins: number }
  /** The engine's state at the helm (the prologue starts under way). */
  | { do: "engine"; running: boolean; throttle?: number }
  /** The time of day, hours (0…24). */
  | { do: "time"; hour: number }
  | { do: "weather"; kind: "clear" | "cloudy" | "overcast" | "rain" | "storm" }
  | { do: "fade"; seconds: number }
  /** Shakes the camera and plays a blast near the yacht (a hit the story decides). */
  | { do: "blast"; strength: number }
  | { do: "flag"; flag: string };

export type Objective =
  /** Everything queued to be said has been said. */
  | { kind: "listen" }
  | { kind: "wait"; seconds: number }
  /** Be at a place: aboard the yacht (`yacht`), on foot (`foot`) or either. */
  | { kind: "reach"; at: string; by: "yacht" | "foot" | "any"; radius?: number }
  /** Be aboard (at the helm or on deck). */
  | { kind: "aboard" }
  | { kind: "talk"; character: string }
  | { kind: "collect"; item: string }
  /** Hold the action key on deck for this long. */
  | { kind: "repair"; seconds: number }
  /** Blind (or stop) a drone of the group; `onLost` happens if one is blown up instead. */
  | { kind: "disable"; group: string; onLost?: readonly Effect[] }
  | { kind: "salvage"; group: string }
  /** The hull is under `hull`, or `after` seconds have gone (the prologue's escape that cannot succeed). */
  | { kind: "hull"; hull: number; after: number; at?: string };

export type Step = {
  id: string;
  /** The line in the objective tracker; a step without one is a beat (something said or shown). */
  goal?: Text;
  /** A hint under it. */
  hint?: Text;
  objective: Objective;
  /**
   * Where the waypoint points (defaults to the objective's own place): a
   * location id, `@yacht` (the yacht herself) or `@drone:<group>` (a drone of the group).
   */
  marker?: string;
  /** Things in the world while this step is current. */
  presence?: readonly Presence[];
  onStart?: readonly Effect[];
  onComplete?: readonly Effect[];
  /** Reached, this step is where the game resumes (after a reload or a sinking). */
  checkpoint?: { yacht: string; skipper: "helm" | "ashore" };
};

export type Mission = {
  id: string;
  chapter: string;
  title: Text;
  brief: Text;
  giver?: string;
  sector: string;
  /** Missions that must be done first. */
  requires: readonly string[];
  /** `planned`: in the journal, not yet playable. */
  status: "playable" | "planned";
  steps: readonly Step[];
  /** Things in the world for as long as the mission is under way. */
  presence?: readonly Presence[];
  onComplete?: readonly Effect[];
};

export type Chapter = { id: string; title: Text; subtitle: Text; sector: string };

export type StoryItem = { id: string; name: Text; /** What it is worth on the black market, doubloons (0 = not for sale). */ value: number };

/** Things that are in the world from some point of the story on (Holloway at his camp, the sector's patrols). */
export type WorldRule = { id: string; after: string; presence: readonly Presence[] };

export type Campaign = {
  factions: readonly Faction[];
  characters: readonly Character[];
  borders: readonly Border[];
  /** The quarantine line: the borders that run along it, in order round the zone. */
  quarantine: readonly { border: string; reverse?: boolean }[];
  sectors: readonly Sector[];
  locations: readonly Location[];
  chapters: readonly Chapter[];
  items: readonly StoryItem[];
  missions: readonly Mission[];
  world: readonly WorldRule[];
  /** Where a new campaign begins; `heading` is a compass bearing, degrees. */
  start: { yacht: ChartPoint; heading: number };
};
