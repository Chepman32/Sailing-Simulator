export type CameraMode = "chase" | "helm" | "orbit" | "drone";
export type QualityPreset = "low" | "medium" | "high" | "ultra";
/** What the player picked. Only "auto" lets the simulator change the level by itself. */
export type QualityChoice = QualityPreset | "auto";
export type LightingMode = "day" | "night";
export type { WeatherKind, WeatherMode } from "./environment/WeatherMath";
import type { WeatherKind, WeatherMode } from "./environment/WeatherMath";

export type LoadingState = {
  loaded: number;
  total: number;
  label: string;
  ready: boolean;
};

export type SimulationSnapshot = {
  speedKnots: number;
  depthMeters: number;
  headingDegrees: number;
  heelDegrees: number;
  apparentWindKnots: number;
  apparentWindAngle: number;
  rudderDegrees: number;
  throttle: number;
  sailTrim: number;
  cameraMode: CameraMode;
  lightingMode: LightingMode;
  /** The time of day follows its own automatic cycle. */
  autoTime: boolean;
  /** Weather chosen by the planner (auto) or by the player (manual). */
  weatherMode: WeatherMode;
  /** The player's choice, used in manual mode. */
  weather: WeatherKind;
  /** The weather in force right now, whichever mode picked it. */
  weatherNow: WeatherKind;
  /** Significant wave height of the sea at present, metres. */
  waveHeight: number;
  /** True wind speed at present, knots. */
  trueWindKnots: number;
  /** The level in force now. */
  quality: QualityPreset;
  /** The player's choice; "auto" adapts the level to hold about 30 fps. */
  qualityChoice: QualityChoice;
  soundEnabled: boolean;
  audioReady: boolean;
  engineRunning: boolean;
  /** The helm is temporarily steering clear of an island. */
  shoreGuardActive: boolean;
  engineMuted: boolean;
  autoCenterHelm: boolean;
  steadyHelmView: boolean;
  sailColor: string;
  /** Sail colours found in bottles (white is always there). */
  unlockedSails: string[];
  /** Doubloons found in crates. */
  doubloons: number;
  /** Flamingos hauled aboard. */
  flamingos: number;
  /** Places discovered (see PoiKind). */
  discoveredPlaces: string[];
  /** The nearest thing afloat, if one is within sight: kind, metres, bearing off the bow (rad, + to starboard). */
  nearestLoot: { kind: "bottle" | "crate" | "flamingo"; distance: number; bearing: number } | null;
  /** A gust under way, 0…1. */
  gust: number;
  /** She has been held fast (aground, against a hull or a reef) for a while: offer a tow. */
  stuck: boolean;
  /** The radio station playing (or null). */
  radioStation: string | null;
  /** The radio is connecting or buffering. */
  radioBuffering: boolean;
  /** Position in the world, metres (for the map). */
  positionX: number;
  positionZ: number;
  /** Photo mode: the camera turns to events by itself. */
  photoAutoTarget: boolean;
  /** The skipper away from the helm: on deck, or swimming and diving. */
  diver: {
    mode: "helm" | "leap" | "deck" | "swim" | "land";
    /** Water round his legs ashore, m (0 on dry land). */
    wading: number;
    /** Eyes under the surface, m. */
    depth: number;
    /** Air left in the tank, 0…1. */
    air: number;
    /** What the interact key would do here. */
    prompt: "helm" | "board" | "pickup" | "trade" | null;
    /** What the prompt is about: the kind of find within reach (for "pickup"). */
    promptDetail: string | null;
    torch: boolean;
    /** The camera is under the water. */
    underwater: boolean;
    /** The mouse is captured for looking round. */
    pointerLocked: boolean;
  };
  /** Gold, the finds carried, the upgrades and the decor (see `EconomyMath`). */
  economy: {
    /** Finds in the bag: how many, what they fetch, and grouped by kind. */
    bagCount: number;
    bagValue: number;
    bag: { kind: string; count: number; total: number }[];
    upgrades: Record<string, number>;
    decor: string[];
    equipped: { flag: string | null; charm: string | null; bobble: string | null };
    /** Contacts the sonar has on the sea floor now. */
    sonarContacts: number;
  };
  fps: number;
  status: "loading" | "running" | "paused" | "error";
};

/** Something taken from the sea floor: what, its tier, and gold (paid at once for a chest). */
export type FindEvent = { kind: string; tier: 1 | 2 | 3; value: number; chest: boolean };

export type SimulatorOptions = {
  onSnapshot?: (snapshot: SimulationSnapshot) => void;
  onLoading?: (state: LoadingState) => void;
  onError?: (message: string) => void;
  /** Return true when the interface handles the gesture instead of recentering. */
  onSceneDoubleTap?: () => boolean;
  /** Something the keyboard did by itself that the interface should show (e.g. "engine-on"). */
  onKeyAction?: (action: string) => void;
  /** A radio station could not be reached. */
  onRadioFailed?: (station: string) => void;
  /** An event in the world worth telling the player (a message in a bottle, a new sail colour). */
  onDiscovery?: (discovery: Discovery) => void;
  /** A find taken from the sea floor. */
  onFind?: (find: FindEvent) => void;
  /** The skipper spoke to an island trader: open the shop. */
  onTrade?: () => void;
};

export type Discovery = {
  kind: "bottle" | "crate" | "flamingo" | "poi";
  /** Key of the message, cargo or place, for the interface's own text. */
  key: string;
  /** A sail colour unlocked by it, if any. */
  sailColor?: string;
  /** Doubloons found in a crate. */
  coins?: number;
  /** The first time this was found (a place, or a flamingo aboard). */
  first?: boolean;
};

export type SimulatorControls = {
  throttle: number;
  rudder: number;
  sailTrim: number;
};

export type Dispose = () => void;
