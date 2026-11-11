import * as THREE from "three";
import type { DroneSystem } from "../combat/DroneSystem";
import type { Traders, TraderSpot } from "../economy/Traders";
import { buildAtlas, resolvePlace, sectorAt, seabedNear, toWorld, type Atlas, type Place } from "./AtlasMath";
import {
  advance,
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
} from "./CampaignMath";
import { CAMPAIGN } from "./content";
import { cameraFor, shotAt, type AnchorFrame, type CameraPose } from "./CutsceneMath";
import type { StoryProps } from "./StoryProps";
import type { Campaign, Cutscene, Effect, Line, Presence, Sector, StorySound, Text } from "./StoryTypes";

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
};

export type StoryLine = { id: number; who: string; via: Line["via"]; text: Text; duration: number; elapsed: number };
export type StoryTitle = { id: number; style: "chapter" | "place" | "end"; title: Text; subtitle?: Text };
export type StoryPrompt = { kind: "talk"; character: string } | { kind: "repair"; progress: number } | { kind: "winch"; progress: number };

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

  constructor(
    private readonly host: StoryHost,
    private readonly drones: DroneSystem,
    private readonly props: StoryProps,
    private readonly cast: Traders,
  ) {
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
    const start = toWorld(this.campaign.start.yacht);
    this.host.placeYacht(start.x, start.z, (-this.campaign.start.heading * Math.PI) / 180);
    this.host.conditionChanged();
    this.host.gearChanged();
    this.persist();
    this.reconcile(true);
    this.tick(0);
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
    this.restorePosition(!isDone(this.state, "prologue"));
    this.host.conditionChanged();
    this.host.gearChanged();
    this.persist();
    this.reconcile(true);
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
    this.host.placeYacht(yacht.x, yacht.z, yacht.heading);
    this.host.conditionChanged();
    this.host.gearChanged();
    this.persist();
    this.reconcile(true);
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
  }

  private clearWorld(): void {
    this.drones.clear();
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
    const place = step?.checkpoint ? this.place(step.checkpoint.yacht) : null;
    if (step?.checkpoint && place) {
      this.host.place(place, step.checkpoint.skipper);
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
      const near = this.speakerNear(skipper.x, skipper.z);
      if (near) return { kind: "talk", character: near };
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
    } else if (prompt.kind === "repair") {
      if (this.repairing < 0) this.repairing = 0;
    } else {
      this.winching = true;
    }
    return true;
  }

  /** The skipper on the porch of a story person, if one is in reach. */
  private speakerNear(x: number, z: number): string | null {
    for (const spot of this.castSpots) {
      if (Math.hypot(spot.x - x, spot.z - z) <= TALK_REACH) return this.castWho.get(spot.id) ?? null;
    }
    return null;
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
    if (character === "holloway") {
      const lines: Text[] = [
        { ru: "Патроны береги. Купол — три выстрела, не больше.", en: "Save your rounds. Three for the dome, no more." },
        { ru: "Под парусом, гидрограф. Мотор — чтобы удрать.", en: "Under sail, hydrographer. The engine's for running." },
        { ru: "Принесёшь целого дрона — заплачу как за двоих.", en: "Bring me one whole and I'll pay you for two." },
      ];
      this.say([{ who: "holloway", via: "voice", text: lines[Math.floor(Math.random() * lines.length)]! }]);
    }
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
      if (skipper.mode === "helm" && isDone(this.state, "prologue") && this.sinking < 0) {
        const yacht = this.host.yacht();
        this.state.position = { x: Math.round(yacht.x * 10) / 10, z: Math.round(yacht.z * 10) / 10, heading: Math.round(yacht.heading * 1000) / 1000 };
        this.dirty = true;
      }
      if (this.dirty) this.persist();
    }
  }

  private tick(delta: number): void {
    void delta;
    const yacht = this.host.yacht();
    const skipper = this.host.skipper();
    const facts: Facts = {
      events: this.events,
      dialogueIdle: !this.line && this.queue.length === 0 && this.lineGap <= 0,
      cutscene: this.scene !== null,
      stepTime: (mission) => this.stepClocks.get(mission) ?? 0,
      yacht: { x: yacht.x, z: yacht.z },
      skipper: { x: skipper.x, z: skipper.z },
      aboard: skipper.aboard,
      hull: this.state.hull,
      place: (id) => this.place(id),
    };
    const result = advance(this.campaign, this.state, facts);
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
      default:
        break;
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
      for (const effect of shot.cue ?? []) this.carryOut(effect);
    }
    if (at.index < 0 && this.scene === scene) this.scene = null;
  }

  /** The player asked to skip: every cue still to come happens now, and the scene ends (a held one too). */
  skipCutscene(): void {
    const scene = this.scene;
    if (!scene) return;
    while (scene.cued < scene.cutscene.shots.length) {
      const shot = scene.cutscene.shots[scene.cued]!;
      scene.cued += 1;
      for (const effect of shot.cue ?? []) this.carryOut(effect);
    }
    // What was being said goes too: it belonged to the scene.
    this.queue.length = 0;
    this.line = null;
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
      return { x: skipper.x, y: skipper.mode === "land" ? this.host.ground(skipper.x, skipper.z) : skipper.y, z: skipper.z, heading: skipper.yaw };
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
      if (presence.kind !== "npc") continue;
      const island = this.place(presence.at)?.island;
      if (island) out.add(island.id);
    }
    return out;
  }

  /** Where the waypoint points now, or null. */
  marker(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.active || this.sinking >= 0) return null;
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
    };
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
