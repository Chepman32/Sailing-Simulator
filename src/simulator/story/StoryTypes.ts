import type { ActorSpec } from "../actors/ActorSystem";
import type { BodyPose } from "../actors/ActorBody";

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
export type Line = {
  who: string;
  text: Text;
  via?: LineChannel;
  /**
   * The recording of it (`/audio/story/<voice>.mp3`); without one, the
   * recording whose words these are (`content/voices.ts`), if any.
   */
  voice?: string;
};

/** A group of boats in the world: Aquilon's uncrewed drones, or Vanguard's crewed patrol boats. */
export type DroneGroup = {
  id: string;
  /** Where they patrol from. */
  at: string;
  count: number;
  /**
   * - `patrol`: a real hostile on its beat round `at`: hears and sees the yacht, hunts her, fights;
   * - `pass`: crosses by on a line (a demonstration): never attacks;
   * - `strike`: the prologue's interceptors: they know where she is and close in shooting, and cannot be stopped;
   * - `ram`: comes in at full speed from her flank and drives into her side (`rammed:<group>` when it strikes).
   */
  behaviour: "patrol" | "pass" | "strike" | "ram" | "chase";
  /** Where it starts, exactly (a chart point; behind a cape, say), and its compass heading, degrees; else near `at` or, for a strike or a ram, off the yacht. */
  spawn?: ChartPoint;
  heading?: number;
  /** Top speed, m/s (a drone's own otherwise). */
  speed?: number;
  /** Patrol radius round `at`, m. */
  beat?: number;
  /** For `pass`: the line crossed, as two chart points. */
  line?: readonly [ChartPoint, ChartPoint];
  /** Seconds before a destroyed or salvaged drone of an ambient group comes back. */
  respawn?: number;
  /** Vanguard's crewed patrol boats, not Aquilon's drones (`chase`: one follows her from astern until called off). */
  crewed?: boolean;
};

/** Something put into the world while a step (or the world) calls for it; reconciled, so it survives a reload. */
export type Presence =
  | { kind: "drones"; group: DroneGroup }
  /** A story item to be picked up: on the sea floor near the place, or on its beach. */
  | { kind: "item"; item: string; at: string; where: "seabed" | "ashore" }
  /** A character standing at a place: on its porch, or (a place without one) on the spot, facing `face` if given. */
  | { kind: "npc"; character: string; at: string; face?: string; kit?: "armed" }
  /** Things lying about a place (a wreck's flotsam, footprints and spent cases), for the eye only. */
  | { kind: "props"; set: "flotsam" | "tracks"; at: string }
  /** A built place (`STORY_LEVELS`): standing while wanted and near. */
  | { kind: "level"; level: string }
  /** People of the campaign's roster (`Campaign.actors`), on their spots; one taken down stays down (flag `down:<id>`). */
  | { kind: "actors"; ids: readonly string[] };

/** The boat the skipper has: the catamaran of free sailing, the prologue's sport yacht, the skiff from Створ-9. */
export type CraftId = "catamaran" | "sport" | "skiff";

/**
 * A state of the world a trigger, an optional goal or a use waits for: every
 * field given must hold. Areas and spots are a built level's (`level:name`).
 */
export type Condition = {
  /** Flags set, and flags not set. */
  flags?: readonly string[];
  not?: readonly string[];
  /** The skipper on foot inside a level's area. */
  area?: string;
  /** The skipper (on foot or at the wheel) within `radius` of a level spot or a place. */
  near?: { at: string; radius: number };
  /** ...or beyond it. */
  far?: { at: string; radius: number };
  /** The skipper within `radius` of a person of the roster, or beyond it. */
  nearActor?: { id: string; radius: number };
  farActor?: { id: string; radius: number };
  /** A person of the roster within `radius` of a spot or a place (he has got there). */
  actorAt?: { id: string; at: string; radius: number };
  /** The guards at least this roused. */
  alert?: "suspicious" | "combat";
  /** The current step of the mission is one of these. */
  steps?: readonly string[];
  /** Seconds the step has been current, at least. */
  stepTime?: number;
  /** The skipper's health under this fraction. */
  health?: number;
  /** The boat's hull under this fraction. */
  hull?: number;
  /** He has stood still (on foot) this long, s. */
  still?: number;
  /** He is crouched. */
  crouched?: boolean;
  /** Nothing is being said. */
  quiet?: boolean;
  /** Something happened this frame (`down:p01`, `use:terminal`, `shot`, `bandage`, `takedown`, `pickup`). */
  event?: string;
  /** At least one of these holds (with everything else given). */
  any?: readonly Condition[];
};

/** Something the story does when a condition comes to hold (once, unless it repeats). */
export type Trigger = { id: string; when: Condition; do: readonly Effect[]; /** Fires again this many seconds after it last did, while it holds. */ every?: number };

/** A thing to work with the action key: a level's interactable, while `when` holds. */
export type Use = {
  /** The level interactable (`Level.interact`) it is worked at. */
  id: string;
  label: Text;
  when?: Condition;
  /** Seconds the key is held (0: a press). */
  seconds?: number;
  /** Worked once (flag `used:<id>`), then gone. */
  once?: boolean;
  do?: readonly Effect[];
};

/** A goal on the side: shown once its `show` holds, ticked off once its `done` does. */
export type Optional = { id: string; goal: Text; show: Condition; done: Condition };

/** A point a camera is set from or looks at: an anchor, and an offset in its frame (metres to its right, up, ahead). */
export type ShotPoint = { anchor: string; offset?: readonly [right: number, up: number, ahead: number] };

/**
 * One shot of a cut scene: the camera eases from `from` to `to` (or holds
 * `from`) over `seconds`. Anchors: `yacht` (her frame), `skipper`,
 * `drone:<group>` (its frame), `place:<location id>` (north-up). `cue` fires
 * when the shot starts.
 */
export type Shot = {
  seconds: number;
  from: { eye: ShotPoint; look: ShotPoint; fov?: number };
  to?: { eye: ShotPoint; look: ShotPoint; fov?: number };
  ease?: "linear" | "inOut" | "out" | "in";
  /** A little hand-held unsteadiness, 0…1. */
  shake?: number;
  cue?: readonly Effect[];
};

/** A cut scene: the player's camera and controls are taken while it runs; it can be skipped. */
export type Cutscene = {
  id: string;
  shots: readonly Shot[];
  /** The last shot is held until the story ends the scene (`{ do: "cut" }`) or another begins. */
  hold?: boolean;
};

/** A sound the story calls for. */
export type StorySound = "radio-noise" | "click" | "crash" | "flooding" | "surf" | "mast" | "outboard" | "jeeps";

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
  /**
   * The skipper takes a gun he has in hand (`inspect`: and looks it over,
   * turning it in a straight arm). Carried out when the line said just
   * before it in the same list has been spoken, so it follows the words.
   */
  | { do: "draw"; gun: "pistol" | "rifle"; inspect?: boolean }
  | { do: "pay"; coins: number }
  /** The engine's state at the helm (the prologue starts under way). */
  | { do: "engine"; running: boolean; throttle?: number }
  /** The time of day, hours (0…24); `hold`: the day runs at the pace of a real one from there (a mission's half hour of afternoon). */
  | { do: "time"; hour: number; hold?: boolean }
  | { do: "weather"; kind: "clear" | "cloudy" | "overcast" | "rain" | "storm" }
  | { do: "fade"; seconds: number }
  /** Shakes the camera and plays a blast near the yacht (a hit the story decides). */
  | { do: "blast"; strength: number }
  /** Sets a flag of the campaign (or clears it). */
  | { do: "flag"; flag: string; off?: boolean }
  /** Plays a cut scene (by id); `{ do: "cut" }` ends one that holds its last shot. */
  | { do: "cutscene"; scene: string }
  | { do: "cut" }
  /** The yacht's electronics: dark (`on: false`, the red alert on her screens) or back. */
  | { do: "instruments"; on: boolean; alert?: readonly Text[] }
  /** Her mast and sail: shot away (`broken: true`) or rigged again. */
  | { do: "rig"; broken: boolean }
  | { do: "sound"; sound: StorySound }
  /** A recorded sound effect, once (`/audio/story/<clip>.mp3`); `volume` of the effects' level (1). */
  | { do: "sfx"; clip: string; volume?: number }
  /** The recorded bed of the place, looped (null: none), crossfaded from the last. */
  | { do: "bed"; clip: string | null; volume?: number }
  /** Coming to: the eyes open slowly on the world. */
  | { do: "wake" }
  /** Turns the skipper on foot to look at a place or a person (`npc:<id>`). */
  | { do: "look"; at: string }
  /** Holds or frees the player's controls (a moment when he must not move). */
  | { do: "freeze"; on: boolean }
  /** The rudder and the throttle, set by the story (a scene sailing by itself). */
  | { do: "steer"; rudder?: number; throttle?: number; heading?: number }
  /**
   * A person of the roster: sent to a spot (`to`, at `pace`, then holding
   * `pose`), put there at once (`put`), set to follow the skipper or not,
   * given back to his own will (`release`), roused (`alarm`), turned to face
   * a spot or the skipper.
   */
  | {
      do: "actor";
      id: string;
      to?: string;
      put?: string;
      pace?: "walk" | "run" | "creep";
      pose?: Partial<BodyPose>;
      follow?: boolean;
      release?: boolean;
      alarm?: boolean;
      face?: string;
      /** Out of the world (gone in a car, off in a boat). */
      remove?: boolean;
    }
  /** Rouses a squad (to search, or to fight), toward a spot. */
  | { do: "alarm"; squad: string; at: string; combat?: boolean }
  /** Throws a built level's switch (`level:name`, a value its builder understands: a door open, a screen's page). */
  | { do: "switch"; name: string; value: string }
  /** The skipper's boat becomes this craft, lying at `at` (a level spot or a place); he stays where he is unless `board`. */
  | { do: "craft"; craft: CraftId; at?: string; board?: boolean }
  /** The skipper to the wheel of his boat where she lies. */
  | { do: "board" }
  /** The skipper on foot at a level spot (or a place's beach). */
  | { do: "put"; at: string }
  /** His wounds bound up: full health. */
  | { do: "heal" }
  /** Rounds for the pistol into his pockets. */
  | { do: "ammo"; rounds: number }
  /**
   * A crewed boat of a group gives up the chase: she turns away and runs
   * for home at `to` (a place or a spot), and is gone once out of sight.
   */
  | { do: "withdraw"; group: string; to: string };

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
  | { kind: "hull"; hull: number; after: number; at?: string }
  /** The cut scene started by this step has run (or been skipped). */
  | { kind: "watch" }
  /** Something happened in the world (`rammed:<group>`), or `after` seconds went by. */
  | { kind: "event"; event: string; after?: number }
  /** A flag is set (by a trigger, a use, a person taken down: `down:<id>`). */
  | { kind: "flag"; flag: string; after?: number }
  /** A use worked (flag `used:<id>`). */
  | { kind: "use"; id: string }
  /** A condition holds. */
  | { kind: "when"; when: Condition };

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
  /** The recorded bed of the place while this step is current (`/audio/story/<clip>.mp3`, looped); none: silence. */
  bed?: string;
  onStart?: readonly Effect[];
  onComplete?: readonly Effect[];
  /**
   * Reached, this step is where the game resumes (after a reload, a sinking,
   * a fall in a fight): the boat off `yacht` (a place, or a level spot she
   * lies at), the skipper at her wheel or ashore — at `spot` if given.
   */
  checkpoint?: { yacht: string; skipper: "helm" | "ashore"; spot?: string };
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
  /** What happens when the world comes to a state, whatever the step (lines, people moving, flags). */
  triggers?: readonly Trigger[];
  /** Things to work with the action key. */
  uses?: readonly Use[];
  /** Goals on the side. */
  optionals?: readonly Optional[];
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
  cutscenes: readonly Cutscene[];
  /** The people on their feet: guards, a companion, the people of a scene. */
  actors: readonly ActorSpec[];
  /** Words in passing from a person spoken to when no mission is under way. */
  smallTalk?: Readonly<Record<string, readonly Text[]>>;
  /** Where a new campaign begins; `heading` is a compass bearing, degrees. */
  start: { yacht: ChartPoint; heading: number };
};
