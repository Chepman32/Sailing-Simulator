import * as THREE from "three";
import type { DroneSystem } from "../combat/DroneSystem";
import type { ActorEvent, ActorSystem } from "../actors/ActorSystem";
import type { LevelSystem } from "../level/LevelSystem";
import type { Traders, TraderSpot } from "../economy/Traders";
import { buildAtlas, resolvePlace, sectorAt, seabedNear, toWorld, type Atlas, type Place } from "./AtlasMath";
import {
  advance,
  applyToState,
  conditionHolds,
  createCampaign,
  isDone,
  missionById,
  openMissions,
  presenceKey,
  presenceNow,
  restoreCampaign,
  stepOf,
  trackedMission,
  type CampaignState,
  type Facts,
  type WorldFacts,
} from "./CampaignMath";
import { CAMPAIGN } from "./content";
import { cameraFor, shotAt, type AnchorFrame, type CameraPose } from "./CutsceneMath";
import type { StoryProps } from "./StoryProps";
import type { Campaign, CraftId, Cutscene, Effect, Line, Mission, Presence, Sector, StorySound, Text, Use } from "./StoryTypes";

/**
 * The campaign at run time: it keeps the progress, gathers what happens in
 * the world into facts for `CampaignMath.advance`, carries out the effects
 * (through the `StoryHost`, which is the simulator), keeps the world holding
 * what the story needs (drones, the kit on the sea floor, Holloway on his
 * porch), plays the dialogue line by line, shows the title cards, notices
 * the sectors entered, and resumes from the checkpoint.
 *
 * In free sailing it does nothing at all.
 */

export type StoryMode = "campaign" | "free";

const CAMPAIGN_KEY = "sailing-campaign-v1";
const MODE_KEY = "sailing-mode";

/** Reading pace for the subtitles: seconds a line stays up. */
export function lineDuration(text: string): number {
  return Math.min(9.5, Math.max(2.6, 1 + text.length / 16));
}

/** A walker or swimmer this near a story item picks it up, m. */
const PICKUP_REACH = 2.4;
/** A person on a porch is spoken to from this near, m. */
const TALK_REACH = 3.4;
/** Seconds a group the story needs may be missing before it is put back. */
const RESPAWN_MISSING = 20;

export type SkipperPose = { x: number; y: number; z: number; yaw: number; aboard: boolean; mode: "helm" | "leap" | "deck" | "swim" | "land" };

/** What the story asks of the simulator. */
export type StoryHost = {
  yacht(): { x: number; y: number; z: number; heading: number; speed: number };
  skipper(): SkipperPose;
  /** Puts the yacht off a place (bow toward it) and the skipper at her helm or ashore there. */
  place(place: Place, skipper: "helm" | "ashore"): void;
  /** Puts the yacht at (x, z) with the skipper at the helm. */
  placeYacht(x: number, z: number, heading: number): void;
  setEngine(running: boolean, throttle?: number): void;
  setHour(hour: number): void;
  setWeather(kind: "clear" | "cloudy" | "overcast" | "rain" | "storm"): void;
  blast(strength: number): void;
  pay(coins: number): void;
  /** The hull or the engine changed: the yacht's handling and looks follow. */
  conditionChanged(): void;
  gearChanged(): void;
  ground(x: number, z: number): number;
  seabed(x: number, z: number): number;
  radio(kind: "radio" | "broadcast"): void;
  /** The world frame of the yacht's helm (the skipper's eyes at the wheel), for a cut scene's camera. */
  helm(): AnchorFrame;
  /** The yacht's displays dark with the alert on them, or back to normal. */
  instruments(on: boolean, alert: readonly Text[] | null): void;
  /** Her mast and sail shot away, or rigged again. */
  rig(broken: boolean): void;
  sound(sound: StorySound): void;
  /** Turns the skipper on foot toward (x, z). */
  look(x: number, z: number): void;
  /** Holds the player's controls (a scene, a moment of danger) or frees them. */
  freeze(on: boolean): void;
  /** Sets the rudder and the throttle. */
  steer(rudder?: number, throttle?: number): void;
  /** The skipper's boat becomes this craft (her model, her handling). */
  craft(craft: CraftId): void;
  /** Moves the boat to (x, z) without the skipper (he stays where he is ashore). */
  moveBoat(x: number, z: number, heading: number): void;
  /** Sets the skipper down on foot at (x, y, z), facing `yaw`. */
  putAshore(x: number, y: number, z: number, yaw: number): void;
  /** Full health; rounds for the pistol. */
  heal(): void;
  ammo(rounds: number): void;
  /** The skipper's own state for the story's conditions. */
  body(): { health: number; still: number; crouched: boolean };
  /** Holds the day at a real day's pace from `hour` (null: lets it run on its own); the hour it is held at now. */
  holdClock(hour: number | null): void;
  clockHour(): number | null;
};

export type StoryLine = { id: number; who: string; via: Line["via"]; text: Text; duration: number; elapsed: number };
export type StoryTitle = { id: number; style: "chapter" | "place" | "end"; title: Text; subtitle?: Text };
export type StoryPrompt =
  | { kind: "talk"; character: string }
  | { kind: "repair"; progress: number }
  | { kind: "winch"; progress: number }
  /** A thing to work (a terminal, a cell door, a mooring line), and how far it has been worked. */
  | { kind: "use"; id: string; label: Text; progress: number }
  /** A guard within reach from behind, unaware: to be put down quietly. */
  | { kind: "takedown"; id: string };

/** A side goal as the interface lists it. */
export type StoryOptional = { id: string; goal: Text; done: boolean };

/** What the interface shows of the story (refreshed with the HUD). */
export type StoryView = {
  mode: StoryMode | null;
  /** A campaign is under way (there is progress to continue). */
  saved: boolean;
  mission: { id: string; title: Text; chapter: Text } | null;
  goal: Text | null;
  hint: Text | null;
  line: StoryLine | null;
  title: StoryTitle | null;
  sector: Sector | null;
  /** Black over the screen, 0…1. */
  fade: number;
  hull: number;
  engine: boolean;
  gear: string[];
  items: string[];
  prompt: StoryPrompt | null;
  /** Missions done and the one under way, for the journal. */
  progress: Record<string, { step: string; done: boolean }>;
  /** Everything the story so far has to offer is done. */
  complete: boolean;
  /** A cut scene is on (the interface steps aside but for the subtitles, the letterbox and the skip). */
  cinematic: boolean;
  /** Grows each time the skipper comes to (the interface's eyes-opening effect). */
  wake: number;
  /** The yacht's electronics are dead, with this alert on her screens (null: they work). */
  alert: readonly Text[] | null;
  /** She has her mast and sail. */
  rig: boolean;
  /** The skipper is held where he is (nothing to steer or walk). */
  frozen: boolean;
  /** A save now would resume here (past the prologue's opening run, or at a checkpoint). */
  anchored: boolean;
  /** The mission's side goals shown so far. */
  optionals: StoryOptional[];
};

export class StorySystem {
  readonly campaign: Campaign = CAMPAIGN;
  readonly atlas: Atlas = buildAtlas(CAMPAIGN);
  state: CampaignState;
  mode: StoryMode | null;
  private readonly places = new Map<string, Place>();
  private readonly stepClocks = new Map<string, number>();
  private readonly events = new Set<string>();
  private readonly queue: StoryLine[] = [];
  private line: StoryLine | null = null;
  private lineGap = 0;
  private readonly titles: StoryTitle[] = [];
  private title: { card: StoryTitle; elapsed: number } | null = null;
  private serial = 0;
  private sector: Sector | null = null;
  private sectorClock = 0;
  private fadeLevel = 0;
  private fadeHold = 0;
  private fadeTarget = 0;
  private readonly present = new Set<string>();
  private readonly missingSince = new Map<string, number>();
  private time = 0;
  private repairing = -1;
  private winching = false;
  private sinking = -1;
  private saveClock = 0;
  private dirty = false;
  private readonly castSpots: TraderSpot[] = [];
  private readonly castWho = new Map<number, string>();
  private readonly scratch = new THREE.Vector3();
  /** The cut scene running: which, how far in, and how many of its shots have fired their cues. */
  private scene: { cutscene: Cutscene; time: number; cued: number } | null = null;
  private wakeSerial = 0;
  private alert: readonly Text[] | null = null;
  private frozen = false;
  /** The campaign as it was when the last checkpoint was reached: what a fall in a fight goes back to. */
  private checkpointState: CampaignState | null = null;
  /** Seconds since the skipper fell (−1: on his feet). */
  private downed = -1;
  /** A use being worked (held), and how long it has been. */
  private using: { use: Use; time: number } | null = null;
  /** When repeating triggers last fired (story clock). */
  private readonly fired = new Map<string, number>();
  /** How roused the guards are. */
  private guards: "quiet" | "suspicious" | "combat" = "quiet";
  /** The build count of each level the switches were last put back on. */
  private readonly switched = new Map<string, number>();
  private readonly roster = new Map<string, import("../actors/ActorSystem").ActorSpec>();

  constructor(
    private readonly host: StoryHost,
    private readonly drones: DroneSystem,
    private readonly props: StoryProps,
    private readonly cast: Traders,
    private readonly actors: ActorSystem,
    private readonly levels: LevelSystem,
  ) {
    for (const spec of this.campaign.actors) this.roster.set(spec.id, spec);
    this.mode = StorySystem.readMode();
    this.state = StorySystem.readCampaign();
  }

  static readMode(): StoryMode | null {
    try {
      const value = localStorage.getItem(MODE_KEY);
      return value === "campaign" || value === "free" ? value : null;
    } catch {
      return null;
    }
  }

  static readCampaign(): CampaignState {
    try {
      return restoreCampaign(JSON.parse(localStorage.getItem(CAMPAIGN_KEY) ?? "null"), CAMPAIGN);
    } catch {
      return createCampaign();
    }
  }

  get active(): boolean {
    return this.mode === "campaign";
  }

  /** There is a campaign to continue. */
  get saved(): boolean {
    return Object.keys(this.state.missions).length > 0;
  }

  private persist(): void {
    try {
      localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(this.state));
      if (this.mode) localStorage.setItem(MODE_KEY, this.mode);
    } catch {
      // Storage blocked: the campaign still runs for this visit.
    }
    this.dirty = false;
  }

  place(id: string): Place | null {
    let place = this.places.get(id);
    if (!place) {
      const location = this.campaign.locations.find((entry) => entry.id === id);
      if (!location) return null;
      place = resolvePlace(location);
      this.places.set(id, place);
    }
    return place;
  }

  /**
   * Where a name the story uses is: a built level's spot (`level:spot`, while
   * the level stands), else a place.
   */
  point(id: string): { x: number; y: number | null; z: number; radius: number; yaw: number | null } | null {
    if (id.includes(":")) {
      const spot = this.levels.spot(id);
      return spot ? { x: spot.x, y: spot.y, z: spot.z, radius: 3, yaw: spot.yaw } : null;
    }
    const place = this.place(id);
    return place ? { x: place.x, y: null, z: place.z, radius: place.radius, yaw: null } : null;
  }

  // --- Starting, resuming, leaving ----------------------------------------------

  /** The main menu: no story running (what was under way stays saved, to continue). */
  enterMenu(): void {
    if (this.active) this.persist();
    this.mode = null;
    this.resetRun();
  }

  /** Free sailing: no story, no drones. */
  chooseFree(): void {
    this.mode = "free";
    this.clearWorld();
    this.persist();
  }

  /** A new campaign from the prologue. */
  startNew(): void {
    this.mode = "campaign";
    this.state = createCampaign();
    this.resetRun();
    this.host.craft(this.state.craft);
    const start = toWorld(this.campaign.start.yacht);
    this.host.placeYacht(start.x, start.z, (-this.campaign.start.heading * Math.PI) / 180);
    this.host.conditionChanged();
    this.host.gearChanged();
    this.host.heal();
    this.persist();
    this.reconcile(true);
    this.tick(0);
    this.checkpointState = structuredClone(this.state);
  }

  /** Back into the campaign where it was left. */
  resume(): void {
    this.mode = "campaign";
    this.resetRun();
    // A prologue left before the wreck starts over: up to there it is one scene.
    if (!isDone(this.state, "prologue") && !this.state.checkpoint) {
      this.startNew();
      return;
    }
    this.host.craft(this.state.craft);
    this.host.holdClock(this.state.clock);
    this.reconcile(true);
    this.restorePosition(!isDone(this.state, "prologue"));
    this.host.conditionChanged();
    this.host.gearChanged();
    this.host.heal();
    this.persist();
    this.reconcile(true);
    this.checkpointState = structuredClone(this.state);
    this.tick(0);
  }

  /**
   * A saved game: its campaign, and the yacht where she lay (the caller sets
   * the skipper down ashore after, if that is where he was). A save from
   * before the wreck starts the prologue over; false then.
   */
  load(state: CampaignState, yacht: { x: number; z: number; heading: number }): boolean {
    this.mode = "campaign";
    this.state = state;
    this.resetRun();
    if (!isDone(this.state, "prologue") && !this.state.checkpoint) {
      this.startNew();
      return false;
    }
    this.host.craft(this.state.craft);
    this.host.holdClock(this.state.clock);
    this.host.placeYacht(yacht.x, yacht.z, yacht.heading);
    this.host.conditionChanged();
    this.host.gearChanged();
    this.host.heal();
    this.persist();
    this.reconcile(true);
    this.checkpointState = structuredClone(this.state);
    return true;
  }

  /** Grows each time the story moves on a step (the autosave's cue). */
  progressSerial = 0;

  private resetRun(): void {
    this.clearWorld();
    this.queue.length = 0;
    this.line = null;
    this.titles.length = 0;
    this.title = null;
    this.stepClocks.clear();
    this.events.clear();
    this.sector = null;
    this.fadeLevel = 0;
    this.fadeTarget = 0;
    this.repairing = -1;
    this.winching = false;
    this.sinking = -1;
    this.scene = null;
    if (this.alert) this.host.instruments(true, null);
    this.alert = null;
    if (this.frozen) this.host.freeze(false);
    this.frozen = false;
    this.downed = -1;
    this.using = null;
    this.fired.clear();
    this.guards = "quiet";
  }

  private clearWorld(): void {
    this.drones.clear();
    this.actors.clear();
    this.levels.want([]);
    this.switched.clear();
    for (const key of this.props.keys()) this.props.remove(key);
    this.present.clear();
    this.missingSince.clear();
    this.castSpots.length = 0;
    this.castWho.clear();
  }

  /** Where the game picks up: where she was last sailed, else the checkpoint. */
  private restorePosition(fromCheckpoint: boolean): void {
    const position = this.state.position;
    if (position && !fromCheckpoint) {
      this.host.placeYacht(position.x, position.z, position.heading);
      return;
    }
    const checkpoint = this.state.checkpoint;
    const step = checkpoint ? missionById(this.campaign, checkpoint.mission)?.steps.find((entry) => entry.id === checkpoint.step) : null;
    const cp = step?.checkpoint;
    // A boat lying at a built level's spot (the skiff at the jetty), the skipper at her wheel or on his spot.
    if (cp && cp.yacht.includes(":")) {
      const boat = this.point(cp.yacht);
      if (boat) {
        if (cp.skipper === "helm") this.host.placeYacht(boat.x, boat.z, boat.yaw ?? 0);
        else this.host.moveBoat(boat.x, boat.z, boat.yaw ?? 0);
      }
      const spot = cp.spot ? this.point(cp.spot) : null;
      if (cp.skipper === "ashore" && spot) this.host.putAshore(spot.x, spot.y ?? this.host.ground(spot.x, spot.z), spot.z, spot.yaw ?? 0);
      if (boat) return;
    }
    const place = cp ? this.place(cp.yacht) : null;
    if (cp && place) {
      this.host.place(place, cp.skipper);
      const spot = cp.spot ? this.point(cp.spot) : null;
      if (cp.skipper === "ashore" && spot) this.host.putAshore(spot.x, spot.y ?? this.host.ground(spot.x, spot.z), spot.z, spot.yaw ?? 0);
      return;
    }
    const start = toWorld(this.campaign.start.yacht);
    this.host.placeYacht(start.x, start.z, (-this.campaign.start.heading * Math.PI) / 180);
  }

  // --- What the player does --------------------------------------------------------

  /** A story item picked up, someone spoken to: told by the simulator. */
  notify(event: string): void {
    this.events.add(event);
  }

  /** What the action key would do for the story here, if anything. */
  prompt(): StoryPrompt | null {
    if (!this.active || this.sinking >= 0) return null;
    const skipper = this.host.skipper();
    if (skipper.mode === "land") {
      if (this.downed >= 0) return null;
      const near = this.speakerNear(skipper.x, skipper.z);
      if (near) return { kind: "talk", character: near };
      if (this.using) return { kind: "use", id: this.using.use.id, label: this.using.use.label, progress: Math.min(1, this.using.time / Math.max(0.01, this.using.use.seconds ?? 0)) };
      const use = this.useNear(skipper.x, skipper.y, skipper.z);
      if (use) return { kind: "use", id: use.id, label: use.label, progress: 0 };
      const quiet = this.actors.takedownTarget(skipper.x, skipper.z);
      if (quiet) return { kind: "takedown", id: quiet };
      return null;
    }
    if (!skipper.aboard) return null;
    if (this.repairing >= 0) return { kind: "repair", progress: this.repairing / this.repairSeconds() };
    if (this.repairSeconds() > 0) return { kind: "repair", progress: 0 };
    const yacht = this.host.yacht();
    const hauled = this.drones.salvageable(yacht.x, yacht.z);
    if (hauled >= 0) return { kind: "winch", progress: hauled };
    return null;
  }

  /** The action key, pressed. */
  act(): boolean {
    const prompt = this.prompt();
    if (!prompt) return false;
    if (prompt.kind === "talk") {
      this.events.add(`talk:${prompt.character}`);
      // Spoken to with nothing to say: a word in passing.
      if (!this.wantsTalk(prompt.character)) this.small(prompt.character);
    } else if (prompt.kind === "use") {
      const use = this.useNear(this.host.skipper().x, this.host.skipper().y, this.host.skipper().z);
      if (use && !this.using) {
        if ((use.seconds ?? 0) > 0) this.using = { use, time: 0 };
        else this.worked(use);
      }
    } else if (prompt.kind === "takedown") {
      this.actors.takedown(prompt.id);
      this.events.add("takedown");
    } else if (prompt.kind === "repair") {
      if (this.repairing < 0) this.repairing = 0;
    } else {
      this.winching = true;
    }
    return true;
  }

  /** The skipper on the porch of a story person, or beside a friendly one on his feet, if one is in reach and has a word for him. */
  private speakerNear(x: number, z: number): string | null {
    for (const spot of this.castSpots) {
      if (Math.hypot(spot.x - x, spot.z - z) <= TALK_REACH) return this.castWho.get(spot.id) ?? null;
    }
    for (const id of this.actors.ids()) {
      const spec = this.roster.get(id);
      if (!spec?.character || spec.faction === "hostile" || this.actors.status(id) !== "active") continue;
      if (!this.wantsTalk(spec.character) && !this.smallTalk(spec.character)) continue;
      const at = this.actors.where(id);
      if (at && Math.hypot(at.x - x, at.z - z) <= TALK_REACH) return spec.character;
    }
    return null;
  }

  /** The use the skipper stands at, if one is open to him now. */
  private useNear(x: number, y: number, z: number): Use | null {
    for (const mission of openMissions(this.campaign, this.state)) {
      const progress = this.state.missions[mission.id];
      if (!progress) continue;
      for (const use of mission.uses ?? []) {
        if (use.once !== false && this.state.flags.includes(`used:${use.id}`)) continue;
        const at = this.levels.interactable(use.id);
        if (!at || Math.hypot(at.x - x, at.z - z) > at.radius || Math.abs(at.y - y) > 2.2) continue;
        if (use.when && !conditionHolds(use.when, this.state, this.facts(), mission.id, progress.step)) continue;
        return use;
      }
    }
    return null;
  }

  /** A use worked: its flag, its event, what it does. */
  private worked(use: Use): void {
    this.using = null;
    const flag = `used:${use.id}`;
    if (!this.state.flags.includes(flag)) this.state.flags.push(flag);
    this.events.add(`use:${use.id}`);
    this.dirty = true;
    for (const effect of use.do ?? []) this.cue(effect);
  }

  /** What the people of the story did (the simulator passes on each `ActorEvent`). */
  actorEvent(event: ActorEvent): void {
    if (!this.active) return;
    const flag = (name: string) => {
      if (!this.state.flags.includes(name)) this.state.flags.push(name);
      this.dirty = true;
    };
    switch (event.kind) {
      case "down":
        flag(`down:${event.id}`);
        if (event.lethal) flag(`killed:${event.id}`);
        this.events.add(`down:${event.id}`);
        this.events.add("down");
        if (event.by === "takedown") flag("took-down");
        break;
      case "surrender":
        flag(`surr:${event.id}`);
        this.events.add(`surrender:${event.id}`);
        this.events.add("surrender");
        break;
      case "alert":
        this.guards = event.level;
        if (event.level !== "quiet") flag(`alert:${event.level}`);
        if (event.level === "combat") flag("alert:suspicious");
        this.events.add(`alert:${event.level}`);
        break;
      case "bark":
        // A guard's shout never talks over the story: said only into a quiet moment.
        if (!this.line && this.queue.length === 0) this.say([{ who: event.character, via: "voice", text: event.text }]);
        break;
      case "shotAt":
        this.events.add("shotAt");
        break;
      case "playerHit":
        this.events.add("hit");
        break;
    }
  }

  /** The skipper fell in a fight: black, then back to the last checkpoint as it was. */
  playerDown(): void {
    if (!this.active || this.downed >= 0) return;
    this.downed = 0;
    this.fadeTarget = 1;
    this.fadeHold = 2;
  }

  /** Whether the story is taking the skipper back after a fall. */
  get recovering(): boolean {
    return this.downed >= 0;
  }

  private afterDown(): void {
    this.downed = -1;
    this.fadeTarget = 0;
    if (this.checkpointState) this.state = structuredClone(this.checkpointState);
    this.queue.length = 0;
    this.line = null;
    this.scene = null;
    this.using = null;
    this.stepClocks.clear();
    this.events.clear();
    this.fired.clear();
    this.guards = "quiet";
    if (this.frozen) this.host.freeze(false);
    this.frozen = false;
    this.actors.clear();
    this.drones.clear();
    this.present.clear();
    this.switched.clear();
    this.host.craft(this.state.craft);
    this.reconcile(true);
    this.restorePosition(true);
    this.host.heal();
    this.host.conditionChanged();
    this.host.gearChanged();
    this.reconcile(true);
    this.persist();
  }

  /** Whether some open step waits for a word with this person. */
  private wantsTalk(character: string): boolean {
    return openMissions(this.campaign, this.state).some((mission) => {
      const step = stepOf(this.campaign, this.state, mission.id);
      return step?.objective.kind === "talk" && step.objective.character === character;
    });
  }

  private small(character: string): void {
    if (this.line || this.queue.length > 0) return;
    const lines = this.smallTalk(character);
    if (lines) {
      this.say([{ who: character, via: "voice", text: lines[Math.floor(Math.random() * lines.length)]! }]);
      return;
    }
    if (character === "holloway-old") {
      const lines: Text[] = [
        { ru: "Патроны береги. Купол — три выстрела, не больше.", en: "Save your rounds. Three for the dome, no more." },
        { ru: "Под парусом, гидрограф. Мотор — чтобы удрать.", en: "Under sail, hydrographer. The engine's for running." },
        { ru: "Принесёшь целого дрона — заплачу как за двоих.", en: "Bring me one whole and I'll pay you for two." },
      ];
      this.say([{ who: "holloway", via: "voice", text: lines[Math.floor(Math.random() * lines.length)]! }]);
    }
  }

  /** A person's words in passing, when no mission is under way. */
  private smallTalk(character: string): readonly Text[] | null {
    if (trackedMission(this.campaign, this.state)) return null;
    return this.campaign.smallTalk?.[character] ?? null;
  }

  private repairSeconds(): number {
    for (const mission of openMissions(this.campaign, this.state)) {
      const step = stepOf(this.campaign, this.state, mission.id);
      if (step?.objective.kind === "repair") return step.objective.seconds;
    }
    return 0;
  }

  /** A round struck her: the hull gives a little; a hit from astern may stop the engine. */
  damage(hull: number, engine: boolean): void {
    if (!this.active || this.sinking >= 0) return;
    this.state.hull = Math.max(0, this.state.hull - hull);
    if (engine && this.state.engine) {
      this.state.engine = false;
      this.host.setEngine(false);
    }
    this.dirty = true;
    this.host.conditionChanged();
    // Holed through: she goes down, and the game picks up at the checkpoint.
    if (this.state.hull <= 0 && isDone(this.state, "prologue")) {
      this.sinking = 0;
      this.fadeTarget = 1;
      this.say([{ who: "hero", via: "thought", text: { ru: "Вода в кокпите… Она уходит!", en: "Water in the cockpit… she's going down!" } }]);
    }
  }

  /** The player asked to hear the next line now. */
  skipLine(): void {
    if (this.line) this.line.elapsed = this.line.duration;
  }

  // --- Each frame ------------------------------------------------------------------

  update(delta: number): void {
    if (!this.active) return;
    this.time += delta;
    for (const [mission, clock] of this.stepClocks) this.stepClocks.set(mission, clock + delta);
    this.updateScene(delta);
    this.updateFade(delta);
    this.updateLines(delta);
    this.updateTitle(delta);
    this.updateActions(delta);
    this.updateSector(delta);
    this.updatePresence(delta);
    this.tick(delta);
    // Remember where she is in open play, every few seconds.
    this.saveClock -= delta;
    const skipper = this.host.skipper();
    if (this.saveClock <= 0) {
      this.saveClock = 4;
      const hour = this.host.clockHour();
      if (hour !== null && this.state.clock !== null && Math.abs(hour - this.state.clock) > 0.01) {
        this.state.clock = Math.round(hour * 1000) / 1000;
        this.dirty = true;
      }
      if (skipper.mode === "helm" && isDone(this.state, "prologue") && this.sinking < 0 && this.downed < 0) {
        const yacht = this.host.yacht();
        this.state.position = { x: Math.round(yacht.x * 10) / 10, z: Math.round(yacht.z * 10) / 10, heading: Math.round(yacht.heading * 1000) / 1000 };
        this.dirty = true;
      }
      if (this.dirty) this.persist();
    }
  }

  /** What the world says now, for `advance` and for conditions. */
  private facts(): Facts {
    const yacht = this.host.yacht();
    const skipper = this.host.skipper();
    const body = this.host.body();
    const world: WorldFacts = {
      inArea: (name) => skipper.mode === "land" && this.levels.inArea(name, skipper.x, skipper.y + 0.5, skipper.z),
      actor: (id) => {
        const at = this.actors.where(id);
        return at && this.actors.status(id) !== null ? { x: at.x, z: at.z } : null;
      },
      alert: this.guards,
      health: body.health,
      still: body.still,
      crouched: body.crouched,
    };
    return {
      events: this.events,
      dialogueIdle: !this.line && this.queue.length === 0 && this.lineGap <= 0,
      cutscene: this.scene !== null,
      stepTime: (mission) => this.stepClocks.get(mission) ?? 0,
      yacht: { x: yacht.x, z: yacht.z },
      skipper: { x: skipper.x, z: skipper.z },
      aboard: skipper.aboard,
      hull: this.state.hull,
      place: (id) => this.point(id),
      now: this.time,
      fired: this.fired,
      world,
    };
  }

  private tick(delta: number): void {
    void delta;
    if (this.downed >= 0) {
      this.events.clear();
      return;
    }
    const checkpoint = this.state.checkpoint;
    const facts = this.facts();
    const result = advance(this.campaign, this.state, facts);
    this.updateOptionals(facts);
    this.events.clear();
    for (const mission of result.moved) this.stepClocks.set(mission, 0);
    if (result.moved.length > 0) {
      this.progressSerial += 1;
      this.repairing = -1;
      this.dirty = true;
      this.reconcile(true);
      this.persist();
    }
    for (const effect of result.effects) this.carryOut(effect);
    // A new checkpoint: what a fall goes back to, as the step begins (its own effects done).
    if (this.state.checkpoint !== checkpoint && this.state.checkpoint) this.checkpointState = structuredClone(this.state);
    if (result.effects.length > 0) this.dirty = true;
  }

  /** Side goals: shown (flag `opt:<id>`) once their condition holds, done (`optdone:<id>`) once theirs does. */
  private updateOptionals(facts: Facts): void {
    for (const mission of openMissions(this.campaign, this.state)) {
      const progress = this.state.missions[mission.id];
      if (!progress) continue;
      for (const optional of mission.optionals ?? []) {
        const shown = `opt:${optional.id}`;
        const done = `optdone:${optional.id}`;
        if (this.state.flags.includes(done)) continue;
        if (!this.state.flags.includes(shown)) {
          if (!conditionHolds(optional.show, this.state, facts, mission.id, progress.step)) continue;
          this.state.flags.push(shown);
          this.dirty = true;
        }
        if (conditionHolds(optional.done, this.state, facts, mission.id, progress.step)) {
          this.state.flags.push(done);
          this.dirty = true;
        }
      }
    }
  }

  private optionalsView(mission: Mission | null): StoryOptional[] {
    if (!mission) return [];
    const out: StoryOptional[] = [];
    for (const optional of mission.optionals ?? []) {
      if (!this.state.flags.includes(`opt:${optional.id}`)) continue;
      out.push({ id: optional.id, goal: optional.goal, done: this.state.flags.includes(`optdone:${optional.id}`) });
    }
    return out;
  }

  private carryOut(effect: Effect): void {
    switch (effect.do) {
      case "say":
        this.say(effect.lines);
        break;
      case "title":
        this.titles.push({ id: (this.serial += 1), style: effect.style, title: effect.title, subtitle: effect.subtitle });
        break;
      case "place": {
        const place = this.place(effect.yacht);
        if (place) this.host.place(place, effect.skipper);
        break;
      }
      case "damage":
        if (effect.engine) this.host.setEngine(false);
        this.host.conditionChanged();
        break;
      case "repair":
        this.host.conditionChanged();
        break;
      case "give":
        this.host.gearChanged();
        break;
      case "pay":
        this.host.pay(effect.coins);
        break;
      case "engine":
        this.host.setEngine(effect.running, effect.throttle);
        break;
      case "time":
        this.host.setHour(effect.hour);
        this.host.holdClock(effect.hold ? effect.hour : null);
        break;
      case "weather":
        this.host.setWeather(effect.kind);
        break;
      case "fade":
        this.fadeLevel = 0;
        this.fadeTarget = 1;
        this.fadeHold = effect.seconds;
        break;
      case "blast":
        this.host.blast(effect.strength);
        break;
      case "cutscene": {
        const cutscene = this.campaign.cutscenes.find((entry) => entry.id === effect.scene);
        if (cutscene) this.scene = { cutscene, time: 0, cued: 0 };
        break;
      }
      case "cut":
        this.scene = null;
        break;
      case "instruments":
        this.alert = effect.on ? null : (effect.alert ?? []);
        this.host.instruments(effect.on, this.alert);
        break;
      case "rig":
        this.host.rig(effect.broken);
        this.host.conditionChanged();
        break;
      case "sound":
        this.host.sound(effect.sound);
        break;
      case "wake":
        this.wakeSerial += 1;
        break;
      case "look": {
        const at = this.anchorFrame(effect.at.startsWith("npc:") ? effect.at : `place:${effect.at}`);
        if (at) this.host.look(at.x, at.z);
        break;
      }
      case "freeze":
        this.frozen = effect.on;
        this.host.freeze(effect.on);
        break;
      case "steer":
        this.host.steer(effect.rudder, effect.throttle);
        break;
      case "actor":
        this.direct(effect);
        break;
      case "alarm": {
        const at = this.point(effect.at);
        if (at) this.actors.alarmSquad(effect.squad, { x: at.x, z: at.z }, effect.combat ?? false);
        break;
      }
      case "switch":
        this.levels.signal(effect.name, effect.value);
        break;
      case "craft": {
        this.host.craft(effect.craft);
        const at = effect.at ? this.point(effect.at) : null;
        if (at && effect.board) this.host.placeYacht(at.x, at.z, at.yaw ?? 0);
        else if (at) this.host.moveBoat(at.x, at.z, at.yaw ?? 0);
        else if (effect.board) this.host.placeYacht(this.host.yacht().x, this.host.yacht().z, this.host.yacht().heading);
        this.host.conditionChanged();
        break;
      }
      case "board": {
        const yacht = this.host.yacht();
        this.host.placeYacht(yacht.x, yacht.z, yacht.heading);
        break;
      }
      case "put": {
        const at = this.point(effect.at);
        if (at) this.host.putAshore(at.x, at.y ?? this.host.ground(at.x, at.z), at.z, at.yaw ?? this.host.skipper().yaw);
        break;
      }
      case "heal":
        this.host.heal();
        break;
      case "ammo":
        this.host.ammo(effect.rounds);
        break;
      case "withdraw": {
        const to = this.point(effect.to);
        if (to) this.drones.withdraw(effect.group, to.x, to.z);
        break;
      }
      default:
        break;
    }
  }

  /** The story's hand on a person of the roster. */
  private direct(effect: Extract<Effect, { do: "actor" }>): void {
    const id = effect.id;
    if (effect.remove) {
      const gone = `gone:${id}`;
      if (!this.state.flags.includes(gone)) this.state.flags.push(gone);
      this.actors.remove(id);
      return;
    }
    if (!this.actors.has(id)) return;
    if (effect.release) this.actors.release(id);
    if (effect.follow !== undefined) this.actors.setFollow(id, effect.follow);
    if (effect.put) {
      const at = this.levels.spot(effect.put);
      if (at) this.actors.place(id, at);
    }
    if (effect.to) {
      const at = this.levels.spot(effect.to);
      if (at) this.actors.order(id, at, effect.pace ?? "walk", effect.pose);
    } else if (effect.pose) {
      this.actors.pose(id, effect.pose);
    }
    if (effect.face) {
      const where = this.actors.where(id);
      const toward = effect.face === "skipper" ? this.host.skipper() : this.levels.spot(effect.face);
      if (where && toward) this.actors.pose(id, {});
      if (where && toward) this.actors.face(id, Math.atan2(toward.x - where.x, toward.z - where.z));
    }
    if (effect.alarm) {
      const where = this.actors.where(id);
      const spec = this.roster.get(id);
      if (where && spec?.squad) this.actors.alarmSquad(spec.squad, { x: where.x, z: where.z }, true);
    }
  }

  // --- Cut scenes ------------------------------------------------------------------

  /** Moves the scene on, firing each shot's cues as it begins; ends it when it has run (unless it holds). */
  private updateScene(delta: number): void {
    const scene = this.scene;
    if (!scene) return;
    scene.time += delta;
    const at = shotAt(scene.cutscene, scene.time);
    const reached = at.index < 0 ? scene.cutscene.shots.length : at.index + 1;
    while (scene.cued < reached) {
      const shot = scene.cutscene.shots[scene.cued]!;
      scene.cued += 1;
      for (const effect of shot.cue ?? []) this.cue(effect);
    }
    if (at.index < 0 && this.scene === scene) this.scene = null;
  }

  /** A shot's cue: what it changes in the campaign (the rig, the hull, the gear), then in the world. */
  private cue(effect: Effect): void {
    applyToState(this.state, effect, this.campaign);
    this.dirty = true;
    this.carryOut(effect);
  }

  /** The player asked to skip: every cue still to come happens now, and the scene ends (a held one too). */
  skipCutscene(): void {
    const scene = this.scene;
    if (!scene) return;
    while (scene.cued < scene.cutscene.shots.length) {
      const shot = scene.cutscene.shots[scene.cued]!;
      scene.cued += 1;
      for (const effect of shot.cue ?? []) this.cue(effect);
    }
    // What was being said and shown goes too: it belonged to the scene.
    this.queue.length = 0;
    this.line = null;
    this.titles.length = 0;
    this.title = null;
    this.scene = null;
  }

  get cinematic(): boolean {
    return this.active && this.scene !== null;
  }

  /** The camera of the scene running, or null (no scene, or its anchor is not in the world yet). */
  sceneCamera(): CameraPose | null {
    const scene = this.scene;
    if (!scene || !this.active) return null;
    const at = shotAt(scene.cutscene, scene.time);
    const shot = scene.cutscene.shots[at.index];
    if (!shot) return null;
    return cameraFor(shot, Math.min(1, at.progress), this.time, (anchor) => this.anchorFrame(anchor));
  }

  /** Where a scene's anchor is: the yacht, her helm, the skipper, a drone, a person, a place. */
  private anchorFrame(anchor: string): AnchorFrame | null {
    if (anchor === "yacht") {
      const yacht = this.host.yacht();
      return { x: yacht.x, y: yacht.y, z: yacht.z, heading: yacht.heading };
    }
    if (anchor === "helm") return this.host.helm();
    if (anchor === "skipper") {
      const skipper = this.host.skipper();
      return { x: skipper.x, y: skipper.y, z: skipper.z, heading: skipper.yaw };
    }
    if (anchor.startsWith("drone:")) {
      const drone = this.drones.find(anchor.slice(6));
      return drone ? { x: drone.x, y: drone.y - 2, z: drone.z, heading: drone.heading } : null;
    }
    if (anchor.startsWith("npc:")) {
      const who = anchor.slice(4);
      for (const spot of this.castSpots) {
        if (this.castWho.get(spot.id) === who) return { x: spot.x, y: this.host.ground(spot.x, spot.z), z: spot.z, heading: spot.facing };
      }
      return null;
    }
    if (anchor.startsWith("actor:")) {
      const where = this.actors.where(anchor.slice(6));
      return where ? { x: where.x, y: where.y, z: where.z, heading: where.yaw } : null;
    }
    if (anchor.startsWith("spot:")) {
      const spot = this.levels.spot(anchor.slice(5));
      return spot ? { x: spot.x, y: spot.y, z: spot.z, heading: spot.yaw } : null;
    }
    if (anchor.startsWith("place:")) {
      const place = this.place(anchor.slice(6));
      return place ? { x: place.x, y: place.island ? this.host.ground(place.x, place.z) : 0, z: place.z, heading: 0 } : null;
    }
    return null;
  }

  private say(lines: readonly Line[]): void {
    for (const line of lines) {
      const text = line.text.ru.length > line.text.en.length ? line.text.ru : line.text.en;
      this.queue.push({ id: (this.serial += 1), who: line.who, via: line.via ?? "radio", text: line.text, duration: lineDuration(text), elapsed: 0 });
    }
  }

  private updateLines(delta: number): void {
    if (this.line) {
      this.line.elapsed += delta;
      if (this.line.elapsed >= this.line.duration) {
        this.line = null;
        this.lineGap = 0.35;
      }
      return;
    }
    if (this.lineGap > 0) {
      this.lineGap -= delta;
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    this.line = next;
    // A radio call opens with the squelch; the network's broadcast with its chime.
    const previous = this.lastVia;
    if (next.via === "broadcast" && previous !== "broadcast") this.host.radio("broadcast");
    else if (next.via === "radio" && (previous !== "radio" || this.lastWho !== next.who)) this.host.radio("radio");
    this.lastVia = next.via;
    this.lastWho = next.who;
  }

  private lastVia: Line["via"] | null = null;
  private lastWho = "";

  private updateTitle(delta: number): void {
    if (this.title) {
      this.title.elapsed += delta;
      const hold = this.title.card.style === "place" ? 4.2 : this.title.card.style === "end" ? 8 : 5.5;
      if (this.title.elapsed > hold) this.title = null;
      return;
    }
    // A card waits for the screen to clear of black.
    if (this.fadeLevel > 0.2 && this.fadeTarget > 0) return;
    const next = this.titles.shift();
    if (next) this.title = { card: next, elapsed: 0 };
  }

  private updateFade(delta: number): void {
    if (this.fadeTarget > 0) {
      this.fadeLevel = Math.min(1, this.fadeLevel + delta / 0.6);
      if (this.fadeLevel >= 1) {
        this.fadeHold -= delta;
        if (this.sinking >= 0) {
          this.sinking += delta;
          if (this.sinking > 1.6) this.afterSinking();
        } else if (this.downed >= 0) {
          this.downed += delta;
          if (this.downed > 1.2) this.afterDown();
        } else if (this.fadeHold <= 0) {
          this.fadeTarget = 0;
        }
      }
    } else {
      this.fadeLevel = Math.max(0, this.fadeLevel - delta / 1.4);
    }
  }

  private afterSinking(): void {
    this.sinking = -1;
    this.fadeTarget = 0;
    this.state.hull = Math.max(this.state.hull, 0.4);
    this.state.position = null;
    this.drones.clear();
    this.present.clear();
    this.restorePosition(true);
    this.host.conditionChanged();
    this.reconcile(true);
    this.persist();
    this.titles.push({ id: (this.serial += 1), style: "place", title: { ru: "Снова на плаву", en: "Afloat again" }, subtitle: { ru: "Корпус залатан наспех", en: "The hull patched in a hurry" } });
  }

  private updateActions(delta: number): void {
    const skipper = this.host.skipper();
    // A use held: worked once its time is up, given up if he walks away from it.
    if (this.using) {
      const at = this.levels.interactable(this.using.use.id);
      if (skipper.mode !== "land" || !at || Math.hypot(at.x - skipper.x, at.z - skipper.z) > at.radius + 0.6) this.using = null;
      else {
        this.using.time += delta;
        if (this.using.time >= (this.using.use.seconds ?? 0)) this.worked(this.using.use);
      }
    }
    if (this.repairing >= 0) {
      if (!skipper.aboard) this.repairing = -1;
      else {
        this.repairing += delta;
        if (this.repairing >= this.repairSeconds()) {
          this.repairing = -1;
          this.events.add("repaired");
        }
      }
    }
    if (this.winching) {
      const yacht = this.host.yacht();
      if (!skipper.aboard || !this.drones.winch(yacht.x, yacht.z, delta)) this.winching = false;
    }
    // Story items: picked up by reaching them.
    for (const key of this.props.keys()) {
      const at = this.props.position(key);
      if (!at) continue;
      const near = skipper.mode === "swim" || skipper.mode === "land" ? Math.hypot(at.x - skipper.x, at.y - skipper.y, at.z - skipper.z) : Infinity;
      if (near > PICKUP_REACH) continue;
      const item = key.slice(5);
      this.props.remove(key);
      this.present.delete(key);
      if (!this.state.collected.includes(item)) this.state.collected.push(item);
      if (!this.state.items.includes(item)) this.state.items.push(item);
      this.events.add(`collect:${item}`);
      this.dirty = true;
    }
    // What the drones did.
    for (const event of this.drones.consumeEvents()) {
      if (event.type === "rammed") this.events.add(`rammed:${event.group}`);
      if (event.type === "disabled") this.events.add(`disabled:${event.group}`);
      if (event.type === "destroyed") this.events.add(`destroyed:${event.group}`);
      if (event.type === "salvaged") {
        this.events.add(`salvaged:${event.group}`);
        this.host.pay(event.value);
        this.winching = false;
      }
      if (event.type === "scrap") this.host.pay(event.value);
    }
  }

  private updateSector(delta: number): void {
    this.sectorClock -= delta;
    if (this.sectorClock > 0) return;
    this.sectorClock = 0.5;
    const skipper = this.host.skipper();
    const where = skipper.aboard ? this.host.yacht() : skipper;
    const sector = sectorAt(this.atlas, where.x, where.z);
    if (sector?.id === this.sector?.id) return;
    const first = this.sector === null && this.time < 1;
    this.sector = sector;
    if (!sector || first) return;
    if (!this.state.sectors.includes(sector.id)) {
      this.state.sectors.push(sector.id);
      this.dirty = true;
    }
    this.titles.push({ id: (this.serial += 1), style: "place", title: sector.name, subtitle: sector.subtitle });
  }

  /** The sector the yacht (or the skipper ashore) is in now. */
  get currentSector(): Sector | null {
    return this.sector;
  }

  // --- The world holding what the story needs ---------------------------------------

  private presenceClock = 0;

  private updatePresence(delta: number): void {
    this.presenceClock -= delta;
    if (this.presenceClock > 0) return;
    this.presenceClock = 1;
    this.reconcile(false);
  }

  /** Puts in what the story now needs and takes out what it no longer does. */
  private reconcile(now: boolean): void {
    const wanted = presenceNow(this.campaign, this.state);
    // The built places first: the people stand on them.
    const levels = wanted.filter((entry): entry is Extract<Presence, { kind: "level" }> => entry.kind === "level").map((entry) => entry.level);
    this.levels.want(levels);
    if (now) for (const level of levels) this.levels.ensure(level);
    // Their switches as the story left them (a door opened, a screen's page), once each time one is built.
    for (const level of levels) {
      const serial = this.levels.buildSerial(level);
      if (serial === 0 || this.switched.get(level) === serial) continue;
      this.switched.set(level, serial);
      for (const flag of this.state.flags) {
        if (!flag.startsWith(`sw:${level}:`)) continue;
        const [name, value] = flag.slice(3).split("=");
        if (name && value !== undefined) this.levels.signal(name, value);
      }
    }
    // The people: on their spots once their level stands; not back once down or gone.
    const people = new Set<string>();
    for (const entry of wanted) if (entry.kind === "actors") for (const id of entry.ids) people.add(id);
    for (const id of this.actors.ids()) if (!people.has(id)) this.actors.remove(id);
    for (const id of people) {
      if (this.actors.has(id)) continue;
      if (this.state.flags.includes(`down:${id}`) || this.state.flags.includes(`gone:${id}`) || this.state.flags.includes(`surr:${id}`)) continue;
      const spec = this.roster.get(id);
      if (!spec) continue;
      const spot = this.levels.spot(spec.spawn);
      if (spot) this.actors.spawn(spec, spot);
    }
    const keys = new Set(wanted.map(presenceKey));
    // Out with what is no longer wanted.
    for (const key of [...this.present]) {
      if (keys.has(key)) continue;
      this.present.delete(key);
      if (key.startsWith("drones:")) this.drones.remove(key.slice(7));
      if (key.startsWith("item:") || key.startsWith("props:")) this.props.remove(key);
    }
    this.castSpots.length = 0;
    this.castWho.clear();
    for (const presence of wanted) {
      const key = presenceKey(presence);
      if (presence.kind === "npc") {
        // One of each person: a later presence (the step's) wins over the world's.
        const place = this.place(presence.at);
        for (const [id, who] of this.castWho) {
          if (who !== presence.character) continue;
          this.castWho.delete(id);
          const index = this.castSpots.findIndex((spot) => spot.id === id);
          if (index >= 0) this.castSpots.splice(index, 1);
        }
        // A new id wherever he stands, so a person who moves is built afresh there
        // (a multiple of three: the first trader model, a man).
        let hash = 0;
        for (const char of `${presence.character}@${presence.at}`) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
        const id = 3000 + hash * 3;
        if (place?.porch) {
          this.castSpots.push({ id, x: place.porch.x, z: place.porch.z, facing: place.porch.facing, kit: presence.kit });
          this.castWho.set(id, presence.character);
        } else if (place) {
          // On the spot, facing what he watches.
          const toward = presence.face ? this.place(presence.face) : null;
          const facing = toward ? Math.atan2(toward.x - place.x, toward.z - place.z) : 0;
          this.castSpots.push({ id, x: place.x, z: place.z, facing, kit: presence.kit });
          this.castWho.set(id, presence.character);
        }
        this.present.add(key);
        continue;
      }
      if (presence.kind === "props") {
        if (!this.props.has(key)) {
          const place = this.place(presence.at);
          if (place) {
            const spot = presence.set === "flotsam" ? (place.landing ?? place) : place;
            this.props.placeSet(key, presence.set, spot.x, spot.z, (x, z) => this.host.ground(x, z));
          }
        }
        this.present.add(key);
        continue;
      }
      if (presence.kind === "item") {
        if (!this.props.has(key)) this.putItem(presence);
        this.present.add(key);
        continue;
      }
      if (presence.kind === "level" || presence.kind === "actors") {
        this.present.add(key);
        continue;
      }
      // Drones: put on the water when first wanted; a group that went missing comes back after a while.
      const there = this.drones.has(presence.group.id);
      if (there) {
        this.missingSince.delete(key);
        this.present.add(key);
        continue;
      }
      const fresh = !this.present.has(key);
      const since = this.missingSince.get(key) ?? this.time;
      this.missingSince.set(key, since);
      if (fresh || now || this.time - since > RESPAWN_MISSING) {
        this.spawnDrones(presence);
        this.missingSince.delete(key);
      }
      this.present.add(key);
    }
  }

  private putItem(presence: Extract<Presence, { kind: "item" }>): void {
    const place = this.place(presence.at);
    if (!place) return;
    const key = presenceKey(presence);
    if (presence.where === "seabed") {
      const bed = seabedNear(place.x, place.z);
      this.props.place(key, bed.x, this.host.seabed(bed.x, bed.z), bed.z, true);
    } else {
      const spot = place.landing ?? place;
      this.props.place(key, spot.x, this.host.ground(spot.x, spot.z), spot.z, false);
    }
  }

  private spawnDrones(presence: Extract<Presence, { kind: "drones" }>): void {
    const group = presence.group;
    const place = this.place(group.at);
    if (!place) return;
    const yacht = this.host.yacht();
    const line = group.line ? ([toWorld(group.line[0]), toWorld(group.line[1])] as const) : undefined;
    const start = group.spawn ? toWorld(group.spawn) : undefined;
    this.drones.spawn(
      {
        group: group.id,
        behaviour: group.behaviour,
        count: group.count,
        centre: { x: place.x, z: place.z },
        beat: group.beat ?? 300,
        line,
        respawn: group.respawn,
        start: start ? { x: start.x, z: start.z, heading: (-(group.heading ?? 0) * Math.PI) / 180 } : undefined,
        speed: group.speed,
        crewed: group.crewed,
      },
      yacht,
    );
  }

  /** Story people on their porches (Holloway), for the figures and the talk prompt. */
  updateCast(delta: number, ground: (x: number, z: number) => number, visitor: THREE.Vector3 | null, eye: THREE.Vector3): void {
    this.cast.update(delta, this.active ? this.castSpots : [], ground, visitor, eye);
  }

  /** Islands whose own trader gives way to a story person standing there. */
  castIslands(): Set<number> {
    const out = new Set<number>();
    if (!this.active) return out;
    for (const presence of presenceNow(this.campaign, this.state)) {
      // A built place on an island (the beach and the café of M01) empties its trader's porch too.
      const at = presence.kind === "npc" ? presence.at : presence.kind === "level" ? presence.level : null;
      if (!at) continue;
      const island = this.place(at)?.island;
      if (island) out.add(island.id);
    }
    return out;
  }

  /** Where the waypoint points now, or null. */
  marker(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.active || this.sinking >= 0 || this.downed >= 0) return null;
    const mission = trackedMission(this.campaign, this.state);
    if (!mission) return null;
    const step = stepOf(this.campaign, this.state, mission.id);
    if (!step || !step.goal) return null;
    const objective = step.objective;
    const target = step.marker ?? (objective.kind === "reach" ? objective.at : objective.kind === "hull" ? objective.at : undefined);
    if (!target) return null;
    if (target === "@yacht") {
      const skipper = this.host.skipper();
      if (skipper.aboard) return null;
      const yacht = this.host.yacht();
      return out.set(yacht.x, yacht.y + 3, yacht.z);
    }
    if (target.startsWith("@drone:")) {
      const drone = this.drones.find(target.slice(7));
      return drone ? out.set(drone.x, drone.y + 1.5, drone.z) : null;
    }
    if (target.startsWith("@actor:")) {
      const where = this.actors.where(target.slice(7));
      return where ? out.set(where.x, where.y + 2.3, where.z) : null;
    }
    if (target.includes(":")) {
      const spot = this.levels.interactable(target.slice(target.indexOf(":") + 1)) ?? this.levels.spot(target);
      return spot ? out.set(spot.x, spot.y + 1.2, spot.z) : null;
    }
    // A sunken thing: the waypoint stands over it.
    if (objective.kind === "collect") {
      const key = `item:${objective.item}`;
      const at = this.props.position(key);
      if (at) return out.copy(at).setY(Math.max(at.y + 1, 0.6));
    }
    const place = this.place(target);
    if (!place) return null;
    const skipper = this.host.skipper();
    // On foot, a porch or a beach; afloat, the place itself.
    const spot = !skipper.aboard && (place.porch ?? place.landing) ? (place.porch ?? place.landing)! : place;
    return out.set(spot.x, (place.island ? this.host.ground(spot.x, spot.z) : 0) + 2.5, spot.z);
  }

  view(): StoryView {
    const mission = this.active ? trackedMission(this.campaign, this.state) : null;
    const step = mission ? stepOf(this.campaign, this.state, mission.id) : null;
    const chapter = mission ? this.campaign.chapters.find((entry) => entry.id === mission.chapter) : null;
    return {
      mode: this.mode,
      saved: this.saved,
      mission: mission && chapter ? { id: mission.id, title: mission.title, chapter: chapter.title } : null,
      goal: step?.goal ?? null,
      hint: step?.hint ?? null,
      line: this.line ? { ...this.line } : null,
      title: this.title?.card ?? null,
      sector: this.sector,
      fade: this.fadeLevel,
      hull: this.state.hull,
      engine: this.state.engine,
      gear: [...this.state.gear],
      items: [...this.state.items],
      prompt: this.prompt(),
      progress: { ...this.state.missions },
      complete: this.active && openMissions(this.campaign, this.state).length === 0,
      cinematic: this.cinematic,
      wake: this.wakeSerial,
      alert: this.active ? this.alert : null,
      rig: this.state.rig,
      frozen: this.active && this.frozen,
      anchored: isDone(this.state, "prologue") || this.state.checkpoint !== null,
      optionals: this.optionalsView(mission),
    };
  }

  /** Who rides in the skipper's boat with him (flags `aboard:<id>`), as the roster dresses them. */
  party(): { id: string; look: import("../actors/ActorLooks").ActorLook }[] {
    const out: { id: string; look: import("../actors/ActorLooks").ActorLook }[] = [];
    for (const flag of this.state.flags) {
      if (!flag.startsWith("aboard:")) continue;
      const spec = this.roster.get(flag.slice(7));
      if (spec) out.push({ id: spec.id, look: spec.look });
    }
    return out;
  }

  /** Bandages in his pack: the one from the backpack on the trail, until it is used. */
  bandages(): number {
    if (!this.active) return 0;
    return this.state.gear.includes("bandage") && !this.state.flags.includes("bandage-used") ? 1 : 0;
  }

  bandageUsed(): void {
    if (!this.state.flags.includes("bandage-used")) this.state.flags.push("bandage-used");
    this.events.add("bandage");
    this.dirty = true;
  }

  /** The skipper has this gear. */
  has(gear: string): boolean {
    return this.active && this.state.gear.includes(gear);
  }

  /** The engine may run (free sailing: always). */
  get engineWorks(): boolean {
    return !this.active || this.state.engine;
  }

  get hull(): number {
    return this.active ? this.state.hull : 1;
  }

  dispose(): void {
    if (this.dirty) this.persist();
    this.clearWorld();
    void this.scratch;
  }
}
