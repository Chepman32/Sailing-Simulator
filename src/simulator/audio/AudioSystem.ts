import { clamp } from "../math";
import { BoatVoices } from "./BoatVoices";
import { BELL_RING, ringBell } from "./BellSynth";
import { windSoundLevels, windWander } from "./WindSoundMath";
import { engineAirCutoff, engineDistanceGain, enginePan } from "./EngineSoundMath";
import { hornLength, openSeaImpulse, playHorn, type HornSpec } from "./HornSynth";
import { HouseGroove, ShantyBand } from "./MusicSynth";

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type NoiseColor = "brown" | "pink" | "white";

const MASTER_GAIN = 0.94;
/** The engine heard from the helm; it falls away with the camera's distance (see EngineSoundMath). */
const ENGINE_BUS_GAIN = 0.62;
const ENGINE_ENVIRONMENT_DUCK = 0.78;
/** Firing frequency of the four-cylinder diesel at idle and at full power, Hz. */
const ENGINE_IDLE_FIRING = 26;
const ENGINE_FULL_FIRING = 86;
/** Shortest and longest pause between two gull calls anywhere in the flock, seconds. */
const GULL_CALL_MIN_GAP = 2.6;
const GULL_CALL_MAX_GAP = 14;

/** What the weather asks of the soundscape. */
export type AudioWeather = {
  overcast: number;
  /** Rain intensity, 0…1. */
  rain: number;
  /** Sea state scale, 1 = the trade-wind sea. */
  waves: number;
  /** Wind of the weather relative to the trade wind (1 fair … 3.3 hurricane). */
  wind?: number;
  /** Storm intensity, 0…1. */
  storm?: number;
  /** True wind over the sea, m/s. */
  trueWind?: number;
};

/** What the sails and the wind are doing, for the yacht's own sounds. */
export type SailingSound = {
  /** 0 drawing … 1 flogging. */
  luff: number;
  /** Sheet trim rate, per second (+ in, − out). */
  trimRate: number;
  /** Gust event under way and approaching, 0…1. */
  gust: number;
  gustApproaching: number;
};

/** A ship as a sound source (see `ShipSystem.soundSources`). */
export type ShipSound = {
  position: { x: number; y: number; z: number };
  speed: number;
  anchored: boolean;
  length: number;
};

/** Speed of sound in air, m/s: a distant horn arrives seconds late. */
const SPEED_OF_SOUND = 343;
/** Ships voiced at once (the nearest ones). */
const SHIP_VOICES = 2;

type ShipVoice = {
  panner: PannerNode;
  air: BiquadFilterNode;
  rumble: GainNode;
  beat: GainNode;
  beatRate: OscillatorNode;
  wash: GainNode;
};

type Point3 = { x: number; y: number; z: number };

/**
 * A sound made on board (the bell, the yacht's horn), heard from where it is
 * on the yacht: level, air absorption, direction and the share of sea echo
 * follow the camera every frame while it rings, so the bell is loud and
 * beside you in the helm view, smaller and to one side from the chase
 * camera, faint and distant from far away.
 */
type OnboardEmitter = {
  point: Point3;
  /** Distance at which the sound is at full level, metres. */
  reference: number;
  gain: GainNode;
  air: BiquadFilterNode;
  panner: PannerNode;
  wet: GainNode;
  until: number;
};

/** Level of an on-board sound heard `distance` metres away (inverse distance, full within `reference`). */
export function onboardLevel(distance: number, reference: number): number {
  return Math.min(1.25, reference / Math.max(0.5, distance));
}

/** Share of a sound heard as sea echo rather than direct: more of it the farther away. */
export function onboardWet(distance: number): number {
  return 0.12 + 0.5 * (1 - Math.exp(-distance / 70));
}

export type ListenerPose = {
  position: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
};

/**
 * Harmonic spectrum of a diesel's firing pulses: strong low harmonics, a
 * slow roll-off, odd ones a little stronger. Enough energy between 150 Hz
 * and 1.5 kHz to be heard on a phone speaker without any fundamental there.
 */
function dieselSpectrum(): { real: Float32Array; imag: Float32Array } {
  const harmonics = 28;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n += 1) {
    const odd = n % 2 === 1 ? 1.15 : 0.85;
    imag[n] = (odd / Math.pow(n, 1.05)) * (0.6 + 0.4 * Math.cos(n * 0.9));
  }
  return { real, imag };
}
const RESUME_RETRY_MS = 850;
/** The barge's music is heard within this distance, metres. */
const PARTY_RANGE = 650;

/**
 * Loudness of a ship's horn heard `distance` metres away: a big ship's
 * whistle carries for kilometres, so it fades slowly (spherical spreading,
 * softened by the sea surface), louder than the yacht's own noises close by.
 */
export function shipHornLevel(distance: number): number {
  return 0.62 * (800 / (800 + Math.max(0, distance)));
}

export class AudioSystem {
  private context?: AudioContext;
  private master?: GainNode;
  private engineBus?: GainNode;
  /** The diver's ears: the water's low-pass, his own breath, the sea's hum. */
  private waterFilter?: BiquadFilterNode;
  private diverBus?: GainNode;
  private underwaterHum?: GainNode;
  private underwaterAmount = 0;
  /** After the engine bus: its level, air absorption and stereo position as heard from the camera. */
  private engineSpace?: GainNode;
  private engineAir?: BiquadFilterNode;
  private enginePanner?: StereoPannerNode;
  private engineSourceX = 0;
  private engineSourceY = 0.6;
  private engineSourceZ = 0;
  private listenerRightX = 1;
  private listenerRightZ = 0;
  /** Engine level heard at the camera, 0…1 (smoothed). */
  private engineHeard = 1;
  private environmentBus?: GainNode;
  private wildlifeBus?: GainNode;
  private engineFiring?: OscillatorNode;
  private engineCrank?: OscillatorNode;
  private engineTone?: BiquadFilterNode;
  private engineFiringGain?: GainNode;
  private engineCrankGain?: GainNode;
  private engineKnock?: OscillatorNode;
  private engineKnockDepth?: GainNode;
  private engineCombustionGain?: GainNode;
  private engineCombustionFilter?: BiquadFilterNode;
  private exhaustGain?: GainNode;
  private exhaustPulse?: OscillatorNode;
  private waveGain?: GainNode;
  private waveFilter?: BiquadFilterNode;
  private rainHissGain?: GainNode;
  private rainPatterGain?: GainNode;
  private thunderBuffer?: AudioBuffer;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;
  /** The storm's layers (see `WindSoundMath`). */
  private roarGain?: GainNode;
  private roarFilter?: BiquadFilterNode;
  private howlGain?: GainNode;
  private readonly howlBands: BiquadFilterNode[] = [];
  private shriekGain?: GainNode;
  private shriekBand?: BiquadFilterNode;
  private spindriftGain?: GainNode;
  private windClock = 0;
  private gullClock = 4 + Math.random() * 6;
  private engineLoad = 0;
  private boat?: BoatVoices;
  /** Music: the radio's shanty band, and the party barge's groove heard over the water. */
  private musicBus?: GainNode;
  private shanty?: ShantyBand;
  private shantyWanted = false;
  private party?: HouseGroove;
  private partyFilter?: BiquadFilterNode;
  private partyGain?: GainNode;
  private partyPanner?: PannerNode;
  private partyDistance = Infinity;
  private readonly partyPosition = { x: 0, y: 0, z: 0 };
  private readonly shipVoices: ShipVoice[] = [];
  private readonly bellPoint: Point3 = { x: 0, y: 2.3, z: 2 };
  private readonly hornPoint: Point3 = { x: 0, y: 5, z: 2 };
  private readonly onboardEmitters: OnboardEmitter[] = [];
  private seaReverb?: ConvolverNode;
  private clickBuffer?: AudioBuffer;
  private breathBuffer?: AudioBuffer;
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;
  private resumePromise?: Promise<boolean>;
  private ready = false;
  /**
   * Sound starts only when the player asks for it (the sound prompt or the
   * sound button). Until then clicks, keys and the engine switch leave the
   * audio graph alone; afterwards any gesture may resume a context the
   * browser suspended (a hidden tab, an iOS interruption).
   */
  private armed = false;
  private enabled = true;
  private muteTimer: number | undefined;
  private engineRunning = false;
  private engineMuted = false;
  private updateElapsed = 0;

  constructor(private readonly onReadyChange?: (ready: boolean) => void) {
    window.addEventListener("pointerdown", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("mousedown", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("touchstart", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("click", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("keydown", this.onUserGesture, { capture: true });
    window.addEventListener("pagehide", this.handlePageHide);
    window.addEventListener("pageshow", this.handlePageShow);
    window.addEventListener("focus", this.handlePageShow);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.syncShanty();
    this.setBusGain(this.master, enabled ? MASTER_GAIN : 0, 0.08);
    window.clearTimeout(this.muteTimer);
    if (!enabled) {
      // A muted graph still synthesises every voice; once the fade is done the
      // context is suspended, so muting also frees the audio thread. Turning
      // sound back on is a press, a trusted gesture that resumes it.
      this.muteTimer = window.setTimeout(() => {
        if (this.enabled || !this.context || this.context.state !== "running") return;
        this.setReady(false);
        void this.context.suspend().catch(() => undefined);
      }, 400);
    }
  }

  isReady(): boolean {
    return this.ready && this.context?.state === "running";
  }

  /** The player's own request for sound: arms the graph and starts it inside the gesture. */
  startFromUser(): Promise<boolean> {
    this.armed = true;
    return this.resumeFromGesture();
  }

  /** Whether the player has asked for sound in this page. */
  get isArmed(): boolean {
    return this.armed;
  }

  /**
   * Where the bell and the yacht's horn are now, in the world (the simulator
   * moves them with the yacht every frame).
   */
  setSignalPoints(bell: Point3, horn: Point3): void {
    this.bellPoint.x = bell.x;
    this.bellPoint.y = bell.y;
    this.bellPoint.z = bell.z;
    this.hornPoint.x = horn.x;
    this.hornPoint.y = horn.y;
    this.hornPoint.z = horn.z;
  }

  /** The yacht's horn: one long blast of a deep marine typhon, from the mast. */
  airHorn(): void {
    const context = this.context;
    if (!context || !this.isReady() || !this.enabled) return;
    const spec = this.yachtHornSpec();
    // A horn is loud: full level anywhere on board and from the chase camera, fading beyond.
    const input = this.onboardInput(this.hornPoint, 14, hornLength(spec) + 3.5);
    if (input) playHorn(context, input, context.currentTime + 0.02, spec);
  }

  /** The ship's bell, two strokes, from where it hangs on the mast. */
  bell(): void {
    const context = this.context;
    if (!context || !this.isReady() || !this.enabled) return;
    // Rung to be heard: from the chase camera as clearly as from the helm.
    const input = this.onboardInput(this.bellPoint, 12, BELL_RING + 3.5);
    this.clickBuffer ??= this.createNoiseBuffer(0.6, "white");
    if (input) ringBell(context, input, context.currentTime + 0.02, this.clickBuffer, 2, 0.46, 1.25);
  }

  /**
   * The yacht's horn: a pair of electric-air typhons a few cents apart
   * (they beat slowly), D3 — the deep "ship" voice of a COLREG 20 m+
   * signal, not a car's bright two-tone beep.
   */
  private yachtHornSpec(): HornSpec {
    this.breathBuffer ??= this.createNoiseBuffer(1.3, "white");
    return {
      voices: [
        { frequency: 146.8, weight: 1, detune: -4 },
        { frequency: 146.8, weight: 0.8, detune: 5 },
      ],
      blasts: [{ offset: 0, duration: 2.4 }],
      level: 0.46,
      formant: 560,
      attack: 0.38,
      release: 0.42,
      sag: 0.13,
      breath: this.breathBuffer,
    };
  }

  /**
   * A chain for a sound made on board at `point`: air absorption, distance
   * level, direction from the camera and a send to the sea echo, kept up to
   * date while it sounds (`updateOnboard`). Returns its input.
   */
  private onboardInput(point: Point3, reference: number, seconds: number): AudioNode | null {
    const context = this.context;
    if (!context || !this.environmentBus) return null;
    const air = context.createBiquadFilter();
    air.type = "lowpass";
    air.Q.value = 0.5;
    const gain = context.createGain();
    const panner = context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "linear";
    panner.rolloffFactor = 0;
    const wet = context.createGain();
    air.connect(gain).connect(panner).connect(this.environmentBus);
    gain.connect(wet);
    if (this.seaReverb) wet.connect(this.seaReverb);
    const emitter: OnboardEmitter = { point, reference, gain, air, panner, wet, until: context.currentTime + seconds };
    this.placeOnboard(emitter, true);
    this.onboardEmitters.push(emitter);
    return air;
  }

  private placeOnboard(emitter: OnboardEmitter, immediate: boolean): void {
    const context = this.context;
    if (!context) return;
    const { point } = emitter;
    const distance = Math.hypot(point.x - this.listenerX, point.y - this.listenerY, point.z - this.listenerZ);
    const level = onboardLevel(distance, emitter.reference);
    const cutoff = Math.max(1800, 18000 * Math.exp(-distance / 140));
    const wet = onboardWet(distance);
    const now = context.currentTime;
    const set = (param: AudioParam, value: number) => {
      if (immediate) param.setValueAtTime(value, now);
      else param.setTargetAtTime(value, now, 0.05);
    };
    set(emitter.gain.gain, level * (1 - wet * 0.5));
    set(emitter.air.frequency, cutoff);
    set(emitter.wet.gain, wet);
    const panner = emitter.panner;
    if (panner.positionX) {
      set(panner.positionX, point.x);
      set(panner.positionY, point.y);
      set(panner.positionZ, point.z);
    } else {
      panner.setPosition(point.x, point.y, point.z);
    }
  }

  /** Follows the camera with every on-board sound still ringing; lets finished ones go. */
  private updateOnboard(): void {
    const context = this.context;
    if (!context) return;
    for (let index = this.onboardEmitters.length - 1; index >= 0; index -= 1) {
      const emitter = this.onboardEmitters[index]!;
      if (context.currentTime > emitter.until) {
        emitter.panner.disconnect();
        emitter.wet.disconnect();
        this.onboardEmitters.splice(index, 1);
      } else {
        this.placeOnboard(emitter, false);
      }
    }
  }

  /** A flare leaving the launcher. */
  flareLaunch(): void {
    if (!this.enabled) return;
    if (this.isReady()) {
      this.boat?.flareLaunch();
      return;
    }
    // The first press may be the one that starts the sound: fire once it runs.
    if (this.armed) void this.resumeFromGesture().then((running) => running && this.boat?.flareLaunch());
  }

  /** The radio's band on board (the shanty station): plays while wanted and sound is on. */
  setShanty(playing: boolean): void {
    this.shantyWanted = playing;
    this.syncShanty();
  }

  /** Static between two stations. */
  radioStatic(): void {
    const context = this.context;
    if (!this.isReady() || !this.enabled || !context || !this.musicBus) return;
    const start = context.currentTime + 0.005;
    const source = context.createBufferSource();
    source.buffer = this.staticBuffer ??= this.createNoiseBuffer(1.2, "white");
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(900, start);
    band.frequency.exponentialRampToValueAtTime(3200, start + 0.18);
    band.frequency.exponentialRampToValueAtTime(1500, start + 0.34);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
    source.connect(band).connect(gain).connect(this.musicBus);
    source.start(start, Math.random() * 0.6);
    source.stop(start + 0.42);
  }

  /** Beat position of the barge's music (0…4), for its lights; NaN when it is not heard. */
  get partyBeat(): number {
    return this.party?.playing ? this.party.beatPhase : Number.NaN;
  }

  /**
   * The party barge `distance` metres away at `position`: its music carries
   * over the water, muffled far off (only the kick and the bass), opening up
   * and growing louder as the yacht comes closer.
   */
  setParty(distance: number, position: { x: number; y: number; z: number }): void {
    this.partyDistance = distance;
    this.partyPosition.x = position.x;
    this.partyPosition.y = position.y;
    this.partyPosition.z = position.z;
  }

  private staticBuffer?: AudioBuffer;
  private hum?: { gain: GainNode; panner: PannerNode; oscillators: OscillatorNode[] };
  private monolithDistance = Infinity;
  private readonly monolithPosition = { x: 0, y: 0, z: 0 };

  /** The monolith `distance` metres away: a low hum, felt more than heard, within a couple of hundred metres. */
  setMonolith(distance: number, position: { x: number; y: number; z: number }): void {
    this.monolithDistance = distance;
    this.monolithPosition.x = position.x;
    this.monolithPosition.y = position.y;
    this.monolithPosition.z = position.z;
  }

  private roarVoice?: { gain: GainNode; tone: BiquadFilterNode; panner: PannerNode };
  private roarLevel = 0;
  private roarDistance = Infinity;
  private readonly roarPosition = { x: 0, y: 0, z: 0 };

  /**
   * An erupting volcano `distance` metres away: a deep, ragged roar like a
   * jet engine heard through the ground, as long as the fountain plays
   * (`level` 0…1). Far off only the lowest part of it arrives.
   */
  setEruptionRoar(distance: number, level: number, position: { x: number; y: number; z: number }): void {
    this.roarDistance = distance;
    this.roarLevel = level;
    this.roarPosition.x = position.x;
    this.roarPosition.y = position.y;
    this.roarPosition.z = position.z;
  }

  private updateRoar(): void {
    const context = this.context;
    if (!context || !this.environmentBus) return;
    const audible = this.enabled && this.roarLevel > 0.01 && this.roarDistance < 4000;
    if (!audible && !this.roarVoice) return;
    if (!this.roarVoice) {
      const source = context.createBufferSource();
      source.buffer = this.createNoiseBuffer(6.3, "brown");
      source.loop = true;
      const tone = context.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 260;
      tone.Q.value = 0.7;
      const body = context.createBiquadFilter();
      body.type = "peaking";
      body.frequency.value = 70;
      body.gain.value = 9;
      // Ragged: the roar surges as the fountain pulses.
      const surge = context.createGain();
      surge.gain.value = 0.8;
      const lfo = context.createOscillator();
      lfo.frequency.value = 1.7;
      const depth = context.createGain();
      depth.gain.value = 0.35;
      lfo.connect(depth).connect(surge.gain);
      lfo.start();
      const gain = context.createGain();
      gain.gain.value = 0;
      const panner = context.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "linear";
      panner.rolloffFactor = 0;
      source.connect(body).connect(tone).connect(surge).connect(gain).connect(panner).connect(this.environmentBus);
      source.start();
      this.roarVoice = { gain, tone, panner };
    }
    const now = context.currentTime;
    const voice = this.roarVoice;
    const distance = Math.max(50, this.roarDistance);
    voice.gain.gain.setTargetAtTime(audible ? this.roarLevel * 0.9 * (600 / (600 + distance)) : 0, now, 0.5);
    voice.tone.frequency.setTargetAtTime(clamp(420 * Math.pow(400 / distance, 0.6), 110, 520), now, 0.8);
    if (voice.panner.positionX) {
      voice.panner.positionX.setTargetAtTime(this.roarPosition.x, now, 0.1);
      voice.panner.positionY.setTargetAtTime(this.roarPosition.y, now, 0.1);
      voice.panner.positionZ.setTargetAtTime(this.roarPosition.z, now, 0.1);
    }
  }

  private planeVoice?: {
    oscillators: OscillatorNode[];
    bases: number[];
    gain: GainNode;
    air: BiquadFilterNode;
    echo: DelayNode;
    panner: PannerNode;
    echoPanner: PannerNode;
  };
  private readonly planeHistory: { time: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }[] = [];
  private planeActive = false;
  private planeClock = 0;
  private jetVoice?: { gain: GainNode; tone: BiquadFilterNode; panner: PannerNode };
  private jetActive = false;
  private jetDistance = Infinity;
  private readonly jetPosition = { x: 0, y: 0, z: 0 };

  /**
   * The low floatplane: where it is now and how fast it moves. It is heard
   * where it was when the sound left it (distance / 343 m/s ago), with the
   * Doppler shift of that moment, the air's absorption of its highs, and the
   * sweeping comb of its echo off the sea.
   */
  setLowPlane(active: boolean, position: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }, delta: number): void {
    this.planeClock += delta;
    this.planeActive = active;
    if (!active) {
      this.planeHistory.length = 0;
      return;
    }
    this.planeHistory.push({ time: this.planeClock, x: position.x, y: position.y, z: position.z, vx: velocity.x, vy: velocity.y, vz: velocity.z });
    while (this.planeHistory.length > 2 && this.planeClock - this.planeHistory[0]!.time > 12) this.planeHistory.shift();
  }

  /** The nearest airliner, heard as a faint, low roar from where it was. */
  setAirliner(active: boolean, position: { x: number; y: number; z: number }, distance: number): void {
    this.jetActive = active;
    this.jetDistance = distance;
    this.jetPosition.x = position.x;
    this.jetPosition.y = position.y;
    this.jetPosition.z = position.z;
  }

  private updateAircraft(): void {
    const context = this.context;
    if (!context || !this.environmentBus) return;
    const now = context.currentTime;
    const place = (panner: PannerNode, x: number, y: number, z: number) => {
      if (panner.positionX) {
        panner.positionX.setTargetAtTime(x, now, 0.08);
        panner.positionY.setTargetAtTime(y, now, 0.08);
        panner.positionZ.setTargetAtTime(z, now, 0.08);
      } else {
        panner.setPosition(x, y, z);
      }
    };
    const makePanner = () => {
      const panner = context.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "linear";
      panner.rolloffFactor = 0;
      return panner;
    };

    // --- The floatplane -------------------------------------------------------
    if (this.planeActive && this.enabled && !this.planeVoice) {
      const gain = context.createGain();
      gain.gain.value = 0;
      const air = context.createBiquadFilter();
      air.type = "lowpass";
      air.Q.value = 0.6;
      const panner = makePanner();
      const echoPanner = makePanner();
      const echo = context.createDelay(0.5);
      const echoGain = context.createGain();
      echoGain.gain.value = 0.55;
      air.connect(gain);
      gain.connect(panner).connect(this.environmentBus);
      gain.connect(echo).connect(echoGain).connect(echoPanner).connect(this.environmentBus);
      // Propeller blade-pass tone and its harmonics, the engine's firing
      // pulses, and the broadband rush of air and exhaust.
      const bases = [80, 160, 240, 120, 360];
      const levels = [0.5, 0.32, 0.18, 0.28, 0.08];
      const types: OscillatorType[] = ["sawtooth", "sawtooth", "triangle", "square", "sawtooth"];
      const oscillators = bases.map((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = types[index]!;
        oscillator.frequency.value = frequency;
        const level = context.createGain();
        level.gain.value = levels[index]! * 0.12;
        oscillator.connect(level).connect(air);
        oscillator.start();
        return oscillator;
      });
      const rush = context.createBufferSource();
      rush.buffer = this.createNoiseBuffer(3.1, "pink");
      rush.loop = true;
      const rushBand = context.createBiquadFilter();
      rushBand.type = "bandpass";
      rushBand.frequency.value = 900;
      rushBand.Q.value = 0.5;
      const rushLevel = context.createGain();
      rushLevel.gain.value = 0.09;
      rush.connect(rushBand).connect(rushLevel).connect(air);
      rush.start();
      this.planeVoice = { oscillators: [...oscillators], bases, gain, air, echo, panner, echoPanner };
      // Keep the noise source with the oscillators so it stops with them.
      (this.planeVoice.oscillators as unknown as AudioScheduledSourceNode[]).push(rush);
    }
    const voice = this.planeVoice;
    if (voice) {
      const history = this.planeHistory;
      if (!this.planeActive || !this.enabled || history.length === 0) {
        voice.gain.gain.setTargetAtTime(0, now, 0.3);
        if (!this.planeActive && history.length === 0) {
          // Fully faded: free the voice.
          window.setTimeout(() => {
            if (this.planeVoice !== voice || this.planeActive) return;
            voice.oscillators.forEach((oscillator) => oscillator.stop());
            voice.gain.disconnect();
            this.planeVoice = undefined;
          }, 1500);
        }
        return;
      }
      // Where the sound we hear now left the plane.
      let sample = history[history.length - 1]!;
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const entry = history[index]!;
        const distance = Math.hypot(entry.x - this.listenerX, entry.y - this.listenerY, entry.z - this.listenerZ);
        sample = entry;
        if (this.planeClock - entry.time >= distance / SPEED_OF_SOUND) break;
      }
      const dx = this.listenerX - sample.x;
      const dy = this.listenerY - sample.y;
      const dz = this.listenerZ - sample.z;
      const distance = Math.max(1, Math.hypot(dx, dy, dz));
      const approach = (sample.vx * dx + sample.vy * dy + sample.vz * dz) / distance;
      const doppler = SPEED_OF_SOUND / Math.max(150, SPEED_OF_SOUND - approach);
      voice.oscillators.forEach((oscillator, index) => {
        if (index < voice.bases.length) oscillator.frequency.setTargetAtTime(voice.bases[index]! * doppler * (1 + 0.004 * Math.sin(now * 3.1 + index)), now, 0.12);
      });
      voice.gain.gain.setTargetAtTime(1.1 * (140 / (140 + distance)), now, 0.15);
      voice.air.frequency.setTargetAtTime(clamp(9000 * Math.pow(220 / (220 + distance), 0.85), 380, 9000), now, 0.2);
      // The echo off the sea arrives later by the difference of the two paths.
      const horizontal = Math.hypot(dx, dz);
      const reflected = Math.hypot(horizontal, sample.y + Math.max(0.5, this.listenerY));
      voice.echo.delayTime.setTargetAtTime(clamp((reflected - distance) / SPEED_OF_SOUND, 0, 0.45), now, 0.05);
      place(voice.panner, sample.x, sample.y, sample.z);
      place(voice.echoPanner, sample.x, -sample.y, sample.z);
    }

    // --- The airliner ---------------------------------------------------------
    const jetAudible = this.jetActive && this.enabled && this.jetDistance < 30000;
    if (jetAudible && !this.jetVoice) {
      const source = context.createBufferSource();
      source.buffer = this.createNoiseBuffer(7.7, "brown");
      source.loop = true;
      const tone = context.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 160;
      const gain = context.createGain();
      gain.gain.value = 0;
      const panner = makePanner();
      source.connect(tone).connect(gain).connect(panner).connect(this.environmentBus);
      source.start();
      this.jetVoice = { gain, tone, panner };
    }
    if (this.jetVoice) {
      const level = jetAudible ? 0.22 * clamp(11000 / this.jetDistance, 0, 1.4) ** 2 : 0;
      this.jetVoice.gain.gain.setTargetAtTime(level, now, 1.5);
      this.jetVoice.tone.frequency.setTargetAtTime(120 + 80 * clamp(11000 / this.jetDistance, 0, 1), now, 1.5);
      place(this.jetVoice.panner, this.jetPosition.x, this.jetPosition.y, this.jetPosition.z);
    }
  }

  private updateHum(): void {
    const context = this.context;
    if (!context || !this.musicBus) return;
    const level = this.enabled ? 0.11 * (1 - clamp((this.monolithDistance - 20) / 220, 0, 1)) : 0;
    if (level <= 0 && !this.hum) return;
    if (!this.hum) {
      const gain = context.createGain();
      gain.gain.value = 0;
      const panner = context.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "linear";
      panner.rolloffFactor = 0;
      gain.connect(panner).connect(this.musicBus);
      // Three tones a hair apart: a slow, shifting beat.
      const oscillators = [55, 82.6, 110.35].map((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = index === 1 ? "triangle" : "sine";
        oscillator.frequency.value = frequency;
        const partial = context.createGain();
        partial.gain.value = [1, 0.35, 0.5][index]!;
        oscillator.connect(partial).connect(gain);
        oscillator.start();
        return oscillator;
      });
      this.hum = { gain, panner, oscillators };
    }
    const now = context.currentTime;
    this.hum.gain.gain.setTargetAtTime(level, now, 0.6);
    const panner = this.hum.panner;
    if (panner.positionX) {
      panner.positionX.setTargetAtTime(this.monolithPosition.x, now, 0.1);
      panner.positionY.setTargetAtTime(this.monolithPosition.y, now, 0.1);
      panner.positionZ.setTargetAtTime(this.monolithPosition.z, now, 0.1);
    }
  }

  private syncShanty(): void {
    const context = this.context;
    if (!context || !this.musicBus) return;
    const play = this.shantyWanted && this.enabled && context.state === "running";
    if (play) {
      this.shanty ??= new ShantyBand(context, this.musicBus);
      this.shanty.start(0.9);
    } else {
      this.shanty?.stop();
    }
  }

  private updateParty(): void {
    const context = this.context;
    if (!context || !this.musicBus) return;
    const audible = this.partyDistance < PARTY_RANGE && this.enabled;
    if (!audible) {
      this.party?.stop();
      return;
    }
    if (!this.party) {
      this.partyGain = context.createGain();
      this.partyFilter = context.createBiquadFilter();
      this.partyFilter.type = "lowpass";
      this.partyFilter.Q.value = 0.9;
      this.partyPanner = context.createPanner();
      this.partyPanner.panningModel = "equalpower";
      this.partyPanner.distanceModel = "linear";
      this.partyPanner.rolloffFactor = 0;
      this.partyFilter.connect(this.partyGain).connect(this.partyPanner).connect(this.musicBus);
      this.party = new HouseGroove(context, this.partyFilter);
    }
    this.party.start(1);
    const now = context.currentTime;
    const distance = Math.max(4, this.partyDistance);
    // Far off only the low end carries; alongside, the whole mix.
    this.partyFilter!.frequency.setTargetAtTime(clamp(16000 * Math.pow(30 / distance, 1.35), 260, 16000), now, 0.4);
    this.partyGain!.gain.setTargetAtTime(0.7 * Math.min(1, 26 / distance) * (1 - clamp((distance - PARTY_RANGE * 0.7) / (PARTY_RANGE * 0.3), 0, 1)), now, 0.4);
    const panner = this.partyPanner!;
    if (panner.positionX) {
      panner.positionX.setTargetAtTime(this.partyPosition.x, now, 0.1);
      panner.positionY.setTargetAtTime(this.partyPosition.y, now, 0.1);
      panner.positionZ.setTargetAtTime(this.partyPosition.z, now, 0.1);
    } else {
      panner.setPosition(this.partyPosition.x, this.partyPosition.y, this.partyPosition.z);
    }
  }

  /** Something picked up from the water. */
  chime(): void {
    if (this.isReady() && this.enabled) this.boat?.chime();
  }

  async resumeFromGesture(): Promise<boolean> {
    if (!this.armed || !this.enabled || document.hidden) return false;
    if (!this.context || this.context.state === "closed") {
      try {
        this.createGraph();
        this.playUnlockImpulse();
      } catch (error) {
        console.warn("Audio output could not be initialized.", error);
        this.setReady(false);
        return false;
      }
    }
    const context = this.context;
    if (!context) return false;
    if (context.state === "running") {
      this.setReady(true);
      this.setBusGain(this.master, MASTER_GAIN, 0.035);
      return true;
    }
    if (this.resumePromise) {
      // Ask again inside this gesture. WebKit does not count a touch's
      // pointerdown as user activation, only the pointerup / touchend / click
      // that follow it: the resume asked for on pointerdown stays pending, and
      // returning that promise here let the click's own (allowed) attempt
      // never happen, so every first tap was lost and only the second worked.
      this.playUnlockImpulse();
      void context.resume().catch(() => undefined);
      return this.resumePromise;
    }

    let timeoutId = 0;
    const resumeAttempt = context.resume().then(() => context.state === "running").catch(() => false);
    const retryTimeout = new Promise<boolean>((resolve) => {
      timeoutId = window.setTimeout(() => resolve(context.state === "running"), RESUME_RETRY_MS);
    });
    // WebKit can leave resume() pending while the page transitions out of an
    // interrupted state. The timeout releases the lock so the next trusted
    // gesture gets a fresh resume attempt instead of reusing a stuck promise.
    this.resumePromise = Promise.race([resumeAttempt, retryTimeout])
      .then((running) => {
        if (this.context !== context) return false;
        this.setReady(running);
        if (running) this.setBusGain(this.master, MASTER_GAIN, 0.035);
        return running;
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        this.resumePromise = undefined;
      });
    return this.resumePromise;
  }

  setEngineMuted(muted: boolean): void {
    this.engineMuted = muted;
    this.updateEngineBusGain();
  }

  setEngineRunning(running: boolean): void {
    const starting = running && !this.engineRunning;
    const stopping = !running && this.engineRunning;
    this.engineRunning = running;
    this.updateEngineBusGain();
    if (starting) {
      void this.resumeFromGesture().then(() => this.playEngineStartCue());
    }
    if (stopping) this.playEngineStopCue();
  }

  /**
   * @param speed Hull speed through the water in m/s.
   * @param shaft Signed propeller shaft speed as a fraction of maximum.
   * @param apparentWind Apparent wind speed in m/s.
   */
  update(
    delta: number,
    speed: number,
    shaft: number,
    apparentWind: number,
    weather: AudioWeather = { overcast: 0, rain: 0, waves: 1 },
    sailing: SailingSound = { luff: 0, trimRate: 0, gust: 0, gustApproaching: 0 },
  ): void {
    if (!this.context || this.context.state !== "running") return;
    this.updateElapsed += delta;
    if (this.updateElapsed < 0.05) return;
    const step = this.updateElapsed;
    this.updateElapsed = 0;
    const now = this.context.currentTime;

    // --- Engine ---------------------------------------------------------------
    // Revs follow the shaft with the inertia of a flywheel; load (how hard the
    // propeller is pulling against the water) opens the tone up a little.
    const revs = this.engineRunning ? clamp(Math.abs(shaft), 0, 1) : 0;
    const load = this.engineRunning ? clamp(Math.abs(shaft) * 1.1 - speed / 9, 0, 1) : 0;
    this.engineLoad += (load - this.engineLoad) * (1 - Math.exp(-step * 2.5));
    const firing = ENGINE_IDLE_FIRING + (ENGINE_FULL_FIRING - ENGINE_IDLE_FIRING) * revs;
    this.engineFiring?.frequency.setTargetAtTime(firing, now, 0.45);
    this.engineCrank?.frequency.setTargetAtTime(firing / 2, now, 0.45);
    this.engineKnock?.frequency.setTargetAtTime(firing, now, 0.45);
    this.exhaustPulse?.frequency.setTargetAtTime(firing / 4, now, 0.45);
    // Muffled at idle, never a buzz: the tone opens only as power comes on.
    this.engineTone?.frequency.setTargetAtTime(260 + revs * 650 + this.engineLoad * 420, now, 0.4);
    this.engineCombustionFilter?.frequency.setTargetAtTime(firing * 6, now, 0.4);
    this.engineFiringGain?.gain.setTargetAtTime(0.065 + revs * 0.045 + this.engineLoad * 0.02, now, 0.35);
    this.engineCrankGain?.gain.setTargetAtTime(0.03 + revs * 0.02, now, 0.35);
    this.engineCombustionGain?.gain.setTargetAtTime(0.012 + this.engineLoad * 0.03, now, 0.35);
    this.exhaustGain?.gain.setTargetAtTime(0.05 + revs * 0.05, now, 0.4);
    this.updateEngineSpace(step, now);

    // --- Water and wind --------------------------------------------------------
    // A high sea roars: more water, and more of its low end.
    // A fair day's sea is barely heard: a faint wash, a little more under way.
    const heavySea = clamp((weather.waves - 1) / 3.5, 0, 1);
    this.waveGain?.gain.setTargetAtTime(0.035 + clamp(speed / 7, 0, 1) * 0.035 + Math.pow(heavySea, 0.8) * 0.5, now, 0.5);
    this.waveFilter?.frequency.setTargetAtTime(1100 + heavySea * 900, now, 0.8);
    // The wind: barely a breath on a fair day, a roaring, howling thing in a
    // storm (see WindSoundMath). Driven by the weather, not by the yacht's
    // own speed: twenty knots under power on a calm day is no gale.
    this.windClock += step;
    const windLevels = windSoundLevels({
      trueWind: weather.trueWind ?? apparentWind,
      apparentWind,
      storm: weather.storm ?? 0,
      windScale: weather.wind ?? 1,
      gust: sailing.gust,
      gustApproaching: sailing.gustApproaching,
      wander: windWander(this.windClock),
    });
    this.windGain?.gain.setTargetAtTime(windLevels.breeze, now, 0.9);
    this.windFilter?.frequency.setTargetAtTime(windLevels.breezeTone, now, 1.6);
    this.roarGain?.gain.setTargetAtTime(windLevels.roar, now, 0.6);
    this.roarFilter?.frequency.setTargetAtTime(windLevels.roarTone, now, 0.5);
    this.howlGain?.gain.setTargetAtTime(windLevels.howl, now, 0.5);
    this.howlBands.forEach((band, index) => band.frequency.setTargetAtTime(windLevels.howlPitch * (index === 0 ? 1 : 1.47), now, 0.7));
    this.shriekGain?.gain.setTargetAtTime(windLevels.shriek, now, 0.4);
    this.shriekBand?.frequency.setTargetAtTime(windLevels.shriekPitch, now, 0.6);
    this.spindriftGain?.gain.setTargetAtTime(windLevels.spindrift, now, 0.5);
    // Rain: a hiss on the sea and a patter on the deck.
    const rain = clamp(weather.rain, 0, 1);
    this.rainHissGain?.gain.setTargetAtTime(Math.pow(rain, 1.2) * 0.1, now, 0.9);
    this.rainPatterGain?.gain.setTargetAtTime(Math.pow(rain, 1.1) * 0.12, now, 0.9);
    this.syncShanty();
    this.updateParty();
    this.updateHum();
    this.updateRoar();
    this.updateAircraft();
    // The yacht's own layers: slap at rest, the bow wave's rush, spray at
    // speed, the rigging, the flogging sail, the winches (see BoatVoices).
    this.boat?.update(step, {
      knots: speed * 1.943844,
      waves: weather.waves,
      apparentWind: apparentWind * 1.943844,
      gust: sailing.gust,
      gustApproaching: sailing.gustApproaching,
      luff: sailing.luff,
      trimRate: sailing.trimRate,
      trueWind: (weather.trueWind ?? apparentWind) * 1.943844,
      motoring: revs,
    });
  }

  /**
   * Thunder from a strike `distance` metres away, arriving `delay` seconds
   * from now (sound crosses a kilometre in three seconds) from `pan` (−1
   * left … 1 right). Close by it is a tearing crack and a crash, then a roar;
   * kilometres off only the low rumble is left, longer and rolling, because
   * the air absorbs the high frequencies and the sound from different parts
   * of the channel arrives spread out in time.
   */
  /**
   * A firework shell bursting `distance` metres off at `position`, heard
   * `distance / 343` s later: a deep thud that carries over the water, a
   * sharp report when near, and for a crackle shell a spatter of pops after.
   */
  fireworkBoom(position: { x: number; y: number; z: number }, distance: number, crackle = false): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.environmentBus || !this.enabled) return;
    const start = context.currentTime + Math.max(0, distance) / 343;
    const far = clamp((distance - 200) / 2600, 0, 1);
    const level = 0.5 * (1 - far * 0.75);
    this.thunderBuffer ??= this.createNoiseBuffer(6.5, "brown");
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "linear";
    panner.rolloffFactor = 0;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
    panner.connect(this.environmentBus);
    const thud = context.createBufferSource();
    thud.buffer = this.thunderBuffer;
    thud.playbackRate.value = 1.1 + Math.random() * 0.3;
    const low = context.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.setValueAtTime(900 * (1 - far * 0.6), start);
    low.frequency.exponentialRampToValueAtTime(120, start + 1.2);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(level * 0.25, start + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.9 + far);
    thud.connect(low).connect(gain).connect(panner);
    thud.start(start, Math.random() * 3);
    thud.stop(start + 3);
    if (crackle) {
      for (let pop = 0; pop < 14; pop += 1) {
        const at = start + 0.25 + Math.random() * 1.1;
        const click = context.createBufferSource();
        click.buffer = this.thunderBuffer;
        click.playbackRate.value = 2.5 + Math.random();
        const band = context.createBiquadFilter();
        band.type = "highpass";
        band.frequency.value = 1400 - far * 800;
        const popGain = context.createGain();
        popGain.gain.setValueAtTime(0.0001, at);
        popGain.gain.exponentialRampToValueAtTime(level * 0.35 * (0.5 + Math.random() * 0.5), at + 0.004);
        popGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
        click.connect(band).connect(popGain).connect(panner);
        click.start(at, Math.random() * 5);
        click.stop(at + 0.1);
      }
    }
    window.setTimeout(() => panner.disconnect(), (start - context.currentTime + 3.5) * 1000);
  }

  thunder(distance: number, delay = 0, pan = 0): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.environmentBus) return;
    const far = clamp((distance - 400) / 11000, 0, 1);
    const start = context.currentTime + Math.max(0, delay);
    this.thunderBuffer ??= this.createNoiseBuffer(6.5, "brown");
    const output = context.createStereoPanner ? context.createStereoPanner() : null;
    if (output) output.pan.value = clamp(pan, -1, 1) * (0.35 + 0.45 * (1 - far));
    const destination: AudioNode = output ?? this.environmentBus;
    if (output) output.connect(this.environmentBus);

    // The rumble.
    const source = context.createBufferSource();
    source.buffer = this.thunderBuffer;
    source.playbackRate.value = 0.75 + Math.random() * 0.3 - far * 0.15;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(1700 * (1 - far * 0.72), start);
    filter.frequency.exponentialRampToValueAtTime(95 + 40 * (1 - far), start + 3.2 + far * 2.5);
    const gain = context.createGain();
    const peak = 0.9 * (1 - far * 0.6);
    const length = 4.5 + far * 3.5;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak * (far > 0.5 ? 0.6 : 1), start + 0.03 + far * 0.6);
    // The roll: the sound swells again as each part of the channel is heard.
    let time = 0.4 + far * 0.5;
    const rolls = 3 + Math.round(far * 3);
    for (let roll = 0; roll < rolls; roll += 1) {
      time += 0.3 + Math.random() * (0.6 + far * 0.6);
      const level = peak * (0.75 - (roll / rolls) * 0.45) * (0.6 + Math.random() * 0.4);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * 0.4), start + time);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), start + time + 0.22 + far * 0.3);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(filter).connect(gain).connect(destination);
    source.start(start, Math.random() * 0.4);
    source.stop(start + length + 0.1);

    // A close strike tears the air first: a sharp crack with real treble.
    if (distance < 2200) {
      const near = 1 - clamp((distance - 300) / 1900, 0, 1);
      const crack = context.createBufferSource();
      crack.buffer = this.thunderBuffer;
      crack.playbackRate.value = 1.6 + Math.random() * 0.4;
      const band = context.createBiquadFilter();
      band.type = "highpass";
      band.frequency.value = 900;
      const crackGain = context.createGain();
      crackGain.gain.setValueAtTime(0.0001, start);
      crackGain.gain.exponentialRampToValueAtTime(0.75 * near, start + 0.008);
      crackGain.gain.exponentialRampToValueAtTime(0.25 * near, start + 0.09);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5 + near * 0.4);
      crack.connect(band).connect(crackGain).connect(destination);
      crack.start(start, Math.random() * 2);
      crack.stop(start + 1);
    }
    if (output) {
      // Released when the rumble ends.
      source.onended = () => output.disconnect();
    }
  }

  /**
   * The camera is under the water by `amount` (0…1), `depth` metres down:
   * the world is dulled to a murmur and the sea's own hum rises.
   */
  setUnderwater(amount: number, depth: number, diving: boolean): void {
    this.underwaterAmount = amount;
    const context = this.context;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    const cutoff = 20000 * Math.pow(650 / 20000, amount);
    this.waterFilter?.frequency.setTargetAtTime(cutoff, now, 0.05);
    this.diverBus?.gain.setTargetAtTime(diving && this.enabled ? 1 : 0, now, 0.1);
    this.underwaterHum?.gain.setTargetAtTime(amount * (0.16 + Math.min(1, depth / 20) * 0.08), now, 0.2);
  }

  /** A breath in through the regulator: a hiss as the valve opens. */
  regulatorInhale(depth: number): void {
    const context = this.context;
    if (!context || !this.diverBus || context.state !== "running" || !this.enabled) return;
    const now = context.currentTime;
    const noise = context.createBufferSource();
    noise.buffer = this.createNoiseBuffer(1.4, "white");
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400 - Math.min(800, depth * 25);
    band.Q.value = 0.9;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.18);
    gain.gain.setValueAtTime(0.045, now + 0.9);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 1.25);
    noise.connect(band).connect(gain).connect(this.diverBus);
    noise.start(now);
    noise.stop(now + 1.35);
    noise.onended = () => gain.disconnect();
  }

  /** A breath out: a rush through the exhaust valve and a cascade of bubbles past the ears. */
  exhaleBubbles(depth: number): void {
    const context = this.context;
    if (!context || !this.diverBus || context.state !== "running" || !this.enabled) return;
    const now = context.currentTime;
    const rush = context.createBufferSource();
    rush.buffer = this.createNoiseBuffer(1.5, "pink");
    const low = context.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 900;
    const rushGain = context.createGain();
    rushGain.gain.setValueAtTime(0, now);
    rushGain.gain.linearRampToValueAtTime(0.09, now + 0.08);
    rushGain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
    rush.connect(low).connect(rushGain).connect(this.diverBus);
    rush.start(now);
    rush.stop(now + 1.45);
    rush.onended = () => rushGain.disconnect();
    // Bubbles: each a little sine whose pitch rises as it breaks free.
    const count = 14 + Math.floor(Math.random() * 8);
    for (let index = 0; index < count; index += 1) {
      const start = now + 0.05 + Math.random() * 1.1;
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      const base = 280 + Math.random() * 900 - Math.min(150, depth * 4);
      oscillator.frequency.setValueAtTime(base, start);
      oscillator.frequency.exponentialRampToValueAtTime(base * (1.6 + Math.random()), start + 0.05);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.018 + Math.random() * 0.02, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0003, start + 0.07);
      oscillator.connect(gain).connect(this.diverBus);
      oscillator.start(start);
      oscillator.stop(start + 0.08);
      oscillator.onended = () => gain.disconnect();
    }
  }

  /**
   * A find taken off the sea floor, heard through the water: a dull knock
   * of the thing against the hand, a ringing tone for a treasure, and for a
   * chest the lid's creak and the soft clink of the gold inside.
   */
  pickup(kind: "find" | "treasure" | "chest"): void {
    const context = this.context;
    const bus = this.diverBus;
    if (!context || !bus || context.state !== "running" || !this.enabled) return;
    const now = context.currentTime;
    const knock = context.createOscillator();
    knock.type = "sine";
    knock.frequency.setValueAtTime(kind === "chest" ? 120 : 210, now);
    knock.frequency.exponentialRampToValueAtTime(kind === "chest" ? 60 : 110, now + 0.18);
    const knockGain = context.createGain();
    knockGain.gain.setValueAtTime(0, now);
    knockGain.gain.linearRampToValueAtTime(kind === "chest" ? 0.22 : 0.14, now + 0.008);
    knockGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.3);
    knock.connect(knockGain).connect(bus);
    knock.start(now);
    knock.stop(now + 0.32);
    knock.onended = () => knockGain.disconnect();
    // Water bends every note down and blurs it.
    const muffle = context.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = 1800;
    muffle.connect(bus);
    const tones = kind === "find" ? [740] : kind === "treasure" ? [660, 990, 1320] : [520, 780, 1040, 1560];
    tones.forEach((frequency, index) => {
      const start = now + 0.06 + index * 0.075;
      const tone = context.createOscillator();
      tone.type = "triangle";
      tone.frequency.setValueAtTime(frequency, start);
      tone.frequency.linearRampToValueAtTime(frequency * 0.985, start + 0.6);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(kind === "find" ? 0.035 : 0.05, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0004, start + (kind === "find" ? 0.45 : 0.9));
      tone.connect(gain).connect(muffle);
      tone.start(start);
      tone.stop(start + 1);
      tone.onended = () => gain.disconnect();
    });
    if (kind === "chest") {
      // The lid: a slow, rasping creak.
      const creak = context.createOscillator();
      creak.type = "sawtooth";
      creak.frequency.setValueAtTime(70, now + 0.05);
      creak.frequency.linearRampToValueAtTime(140, now + 0.55);
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 600;
      band.Q.value = 4;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now + 0.05);
      gain.gain.linearRampToValueAtTime(0.05, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.6);
      creak.connect(band).connect(gain).connect(bus);
      creak.start(now + 0.05);
      creak.stop(now + 0.62);
      creak.onended = () => gain.disconnect();
      this.coinClinks(context, muffle, now + 0.45, 14, 0.03);
    }
    window.setTimeout(() => muffle.disconnect(), 2500);
  }

  /** Gold counted out on a trader's table (bigger sums ring longer). */
  coins(amount: number): void {
    const context = this.context;
    const bus = this.environmentBus;
    if (!context || !bus || context.state !== "running" || !this.enabled) return;
    const count = Math.round(6 + Math.min(18, Math.log2(1 + Math.max(0, amount) / 20) * 3));
    this.coinClinks(context, bus, context.currentTime + 0.02, count, 0.045);
  }

  /** A run of small metallic clinks: two inharmonic partials each, scattered in time. */
  private coinClinks(context: AudioContext, destination: AudioNode, start: number, count: number, level: number): void {
    let time = start;
    for (let index = 0; index < count; index += 1) {
      time += 0.025 + Math.random() * 0.07;
      const base = 2600 + Math.random() * 2200;
      for (const ratio of [1, 2.76]) {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = base * ratio;
        const gain = context.createGain();
        const peak = (level * (0.6 + Math.random() * 0.4)) / ratio;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(peak, time + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0002, time + 0.09 + Math.random() * 0.12);
        oscillator.connect(gain).connect(destination);
        oscillator.start(time);
        oscillator.stop(time + 0.25);
        oscillator.onended = () => gain.disconnect();
      }
    }
  }

  /** A footstep on deck (bare feet on teak and gelcoat). */
  footstep(running: boolean): void {
    const context = this.context;
    if (!context || !this.master || context.state !== "running" || !this.enabled) return;
    const now = context.currentTime;
    const thump = context.createBufferSource();
    thump.buffer = this.createNoiseBuffer(0.2, "brown");
    const low = context.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = running ? 420 : 300;
    const gain = context.createGain();
    gain.gain.setValueAtTime(running ? 0.16 : 0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    thump.connect(low).connect(gain).connect(this.master);
    thump.start(now, Math.random() * 0.05);
    thump.stop(now + 0.15);
    thump.onended = () => gain.disconnect();
  }

  /** Where the engine is (the yacht's engine room), for how it is heard from the camera. */
  setEngineSource(point: { x: number; y: number; z: number }): void {
    this.engineSourceX = point.x;
    this.engineSourceY = point.y;
    this.engineSourceZ = point.z;
  }

  /** Where the listener (the camera) is, for positional sounds. */
  setListener(pose: ListenerPose): void {
    this.listenerX = pose.position.x;
    this.listenerY = pose.position.y;
    this.listenerZ = pose.position.z;
    // Right = forward × up, kept horizontal for the engine's stereo position.
    this.listenerRightX = pose.forward.y * pose.up.z - pose.forward.z * pose.up.y;
    this.listenerRightZ = pose.forward.x * pose.up.y - pose.forward.y * pose.up.x;
    const context = this.context;
    if (!context || context.state !== "running") return;
    const listener = context.listener;
    const now = context.currentTime;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(pose.position.x, now, 0.03);
      listener.positionY.setTargetAtTime(pose.position.y, now, 0.03);
      listener.positionZ.setTargetAtTime(pose.position.z, now, 0.03);
      listener.forwardX.setTargetAtTime(pose.forward.x, now, 0.03);
      listener.forwardY.setTargetAtTime(pose.forward.y, now, 0.03);
      listener.forwardZ.setTargetAtTime(pose.forward.z, now, 0.03);
      listener.upX.setTargetAtTime(pose.up.x, now, 0.03);
      listener.upY.setTargetAtTime(pose.up.y, now, 0.03);
      listener.upZ.setTargetAtTime(pose.up.z, now, 0.03);
    } else {
      listener.setPosition(pose.position.x, pose.position.y, pose.position.z);
      listener.setOrientation(pose.forward.x, pose.forward.y, pose.forward.z, pose.up.x, pose.up.y, pose.up.z);
    }
    if (this.onboardEmitters.length > 0) this.updateOnboard();
  }

  /**
   * The nearest ships: the deep, slow beat of a large two-stroke diesel
   * carried kilometres over the water, losing its highs with distance, and
   * the rush of the bow wave when one passes close. A ship at anchor only
   * hums with her generators.
   */
  updateShips(ships: readonly ShipSound[]): void {
    const context = this.context;
    if (!context || context.state !== "running" || this.shipVoices.length === 0) return;
    const now = context.currentTime;
    const distanceTo = (ship: ShipSound): number =>
      Math.hypot(ship.position.x - this.listenerX, ship.position.y - this.listenerY, ship.position.z - this.listenerZ);
    const nearest = [...ships].sort((a, b) => distanceTo(a) - distanceTo(b));
    this.shipVoices.forEach((voice, index) => {
      const ship = nearest[index];
      if (!ship) {
        voice.rumble.gain.setTargetAtTime(0, now, 1.5);
        voice.beat.gain.setTargetAtTime(0, now, 1.5);
        voice.wash.gain.setTargetAtTime(0, now, 1.5);
        return;
      }
      const distance = distanceTo(ship);
      if (voice.panner.positionX) {
        voice.panner.positionX.setTargetAtTime(ship.position.x, now, 0.2);
        voice.panner.positionY.setTargetAtTime(ship.position.y, now, 0.2);
        voice.panner.positionZ.setTargetAtTime(ship.position.z, now, 0.2);
      } else {
        voice.panner.setPosition(ship.position.x, ship.position.y, ship.position.z);
      }
      const under = clamp(ship.speed / 7, 0, 1);
      const reach = Math.pow(clamp(1 - distance / 2600, 0, 1), 2.2);
      const size = clamp(ship.length / 220, 0.6, 1.3);
      voice.rumble.gain.setTargetAtTime(reach * (ship.anchored ? 0.05 : 0.12 + under * 0.1) * size, now, 1.2);
      voice.beat.gain.setTargetAtTime(reach * (ship.anchored ? 0 : 0.08 * under) * size, now, 1.2);
      // About 85 rpm on six cylinders: a beat of eight or nine a second.
      voice.beatRate.frequency.setTargetAtTime(ship.anchored ? 0 : 7 + under * 2, now, 2);
      voice.wash.gain.setTargetAtTime(Math.pow(clamp(1 - distance / 480, 0, 1), 2) * under * 0.2 * size, now, 0.8);
      // Air absorbs the highs: far off only the low throb is left.
      voice.air.frequency.setTargetAtTime(220 + 2400 * Math.exp(-distance / 420), now, 0.8);
    });
  }

  /**
   * A ship's whistle: one prolonged blast, or five short ones (the danger
   * signal) when the yacht stands into her path. Big ships sound low; the
   * sound arrives as late as it takes to cross the water.
   */
  shipHorn(position: { x: number; y: number; z: number }, signal: "danger" | "prolonged", length = 200): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.environmentBus || !this.enabled) return;
    const distance = Math.hypot(position.x - this.listenerX, position.y - this.listenerY, position.z - this.listenerZ);
    const level = shipHornLevel(distance);
    if (level < 0.02) return;
    const start = context.currentTime + distance / SPEED_OF_SOUND;
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "linear";
    panner.rolloffFactor = 0;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
    panner.connect(this.environmentBus);
    // The air takes the highs of a far whistle; the sea answers with more echo the farther it is.
    const air = context.createBiquadFilter();
    air.type = "lowpass";
    air.frequency.value = 450 + 3400 * Math.exp(-distance / 600);
    air.Q.value = 0.5;
    air.connect(panner);
    const wet = context.createGain();
    wet.gain.value = 0.25 + 0.55 * (1 - Math.exp(-distance / 900));
    air.connect(wet);
    if (this.seaReverb) wet.connect(this.seaReverb);
    // A ship's whistle is a stack of air horns tuned to a chord (a fundamental,
    // its fifth and its octave, one octave horn mistuned so the stack beats).
    // The larger the ship, the lower the chord and the lower the tube's resonance.
    const fundamental = clamp(92 - (length - 180) * 0.2, 55, 108);
    this.breathBuffer ??= this.createNoiseBuffer(1.3, "white");
    const spec: HornSpec = {
      voices: [
        { frequency: fundamental, weight: 1, detune: -3 },
        { frequency: fundamental * 1.498, weight: 0.8, detune: 2 },
        { frequency: fundamental * 2, weight: 0.5, detune: -1 },
        { frequency: fundamental * 2.003, weight: 0.32, detune: 4 },
      ],
      blasts: signal === "prolonged" ? [{ offset: 0, duration: 5.2 }] : [0, 1, 2, 3, 4].map((index) => ({ offset: index * 1.7, duration: 0.95 })),
      level: level * 0.62,
      formant: clamp(330 + fundamental * 1.4, 380, 520),
      attack: 0.55,
      release: 0.7,
      sag: 0.1,
      breath: this.breathBuffer,
    };
    const end = playHorn(context, air, start, spec);
    window.setTimeout(() => {
      panner.disconnect();
      wet.disconnect();
    }, (end - context.currentTime + 4) * 1000);
  }

  /**
   * Lets the flock call now and then: at irregular intervals one bird (the
   * caller chooses which, by position) gives one of several calls from where
   * it is flying.
   */
  updateGulls(delta: number, birds: readonly { x: number; y: number; z: number }[]): void {
    if (!this.context || this.context.state !== "running" || !this.enabled || birds.length === 0) return;
    this.gullClock -= delta;
    if (this.gullClock > 0) return;
    // Calls come in loose bursts: a reply often follows a call.
    this.gullClock = Math.random() < 0.3 ? GULL_CALL_MIN_GAP * (0.6 + Math.random() * 0.6) : GULL_CALL_MIN_GAP + Math.random() * (GULL_CALL_MAX_GAP - GULL_CALL_MIN_GAP);
    const bird = birds[Math.floor(Math.random() * birds.length)]!;
    this.gullCall(bird, Math.floor(Math.random() * 4));
  }

  /** One call from a particular gull (a bird disturbed on the water, or taking off). */
  gullCallAt(position: { x: number; y: number; z: number }, variant: number): void {
    if (!this.context || this.context.state !== "running" || !this.enabled) return;
    this.gullCall(position, variant);
  }

  /**
   * The storm's wind, silent until the weather calls for it: a deep roar,
   * the rigging's howl, a hurricane's shriek and the hiss of spindrift.
   */
  private createStormWind(context: AudioContext, bus: AudioNode): void {
    const roar = context.createBufferSource();
    roar.buffer = this.createNoiseBuffer(5.3, "brown");
    roar.loop = true;
    this.roarFilter = context.createBiquadFilter();
    this.roarFilter.type = "lowpass";
    this.roarFilter.frequency.value = 220;
    this.roarFilter.Q.value = 0.4;
    this.roarGain = context.createGain();
    this.roarGain.gain.value = 0;
    roar.connect(this.roarFilter).connect(this.roarGain).connect(bus);
    roar.start(0, 1.7);

    const howl = context.createBufferSource();
    howl.buffer = this.createNoiseBuffer(4.4, "pink");
    howl.loop = true;
    this.howlGain = context.createGain();
    this.howlGain.gain.value = 0;
    for (const [q, level] of [[9, 1], [12, 0.55]] as const) {
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 300;
      band.Q.value = q;
      const bandGain = context.createGain();
      bandGain.gain.value = level;
      howl.connect(band).connect(bandGain).connect(this.howlGain);
      this.howlBands.push(band);
    }
    this.howlGain.connect(bus);
    howl.start(0, 2.3);

    const shriek = context.createBufferSource();
    shriek.buffer = this.createNoiseBuffer(3.7, "white");
    shriek.loop = true;
    this.shriekBand = context.createBiquadFilter();
    this.shriekBand.type = "bandpass";
    this.shriekBand.frequency.value = 1600;
    this.shriekBand.Q.value = 18;
    this.shriekGain = context.createGain();
    this.shriekGain.gain.value = 0;
    shriek.connect(this.shriekBand).connect(this.shriekGain).connect(bus);
    shriek.start(0, 0.9);

    const spindrift = context.createBufferSource();
    spindrift.buffer = this.createNoiseBuffer(3.1, "white");
    spindrift.loop = true;
    const spindriftHigh = context.createBiquadFilter();
    spindriftHigh.type = "highpass";
    spindriftHigh.frequency.value = 3200;
    const spindriftSoft = context.createBiquadFilter();
    spindriftSoft.type = "lowpass";
    spindriftSoft.frequency.value = 9000;
    this.spindriftGain = context.createGain();
    this.spindriftGain.gain.value = 0;
    spindrift.connect(spindriftHigh).connect(spindriftSoft).connect(this.spindriftGain).connect(bus);
    spindrift.start(0, 1.4);
  }

  /**
   * The boom fetching up on its sheet after a gybe: a short, low thud with a
   * rattle of blocks on top.
   */
  boomSlam(intensity = 1): void {
    if (!this.context || !this.wildlifeBus || this.context.state !== "running" || !this.enabled) return;
    const now = this.context.currentTime;
    const strength = Math.min(1, Math.max(0.1, intensity));
    const thud = this.context.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(150, now);
    thud.frequency.exponentialRampToValueAtTime(70, now + 0.16);
    const thudGain = this.context.createGain();
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.exponentialRampToValueAtTime(0.32 * strength, now + 0.01);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    thud.connect(thudGain).connect(this.wildlifeBus);
    thud.start(now);
    thud.stop(now + 0.26);

    const rattle = this.context.createBufferSource();
    rattle.buffer = this.createNoiseBuffer(0.2);
    const rattleFilter = this.context.createBiquadFilter();
    rattleFilter.type = "bandpass";
    rattleFilter.frequency.value = 900;
    rattleFilter.Q.value = 0.8;
    const rattleGain = this.context.createGain();
    rattleGain.gain.setValueAtTime(0.0001, now);
    rattleGain.gain.exponentialRampToValueAtTime(0.035 * strength, now + 0.006);
    rattleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    rattle.connect(rattleFilter).connect(rattleGain).connect(this.wildlifeBus);
    rattle.start(now);
    rattle.stop(now + 0.2);
  }

  /**
   * One-shot water sound.
   *
   * @param intensity splash energy (dolphin re-entry ≈ 1, fluke slap ≈ 5)
   * @param kind how the body met the surface
   * @param distance metres from the listener; distant splashes are quieter
   */
  splash(
    intensity = 1,
    kind: "entry" | "exit" | "slap" | "breath" | "blow" = "entry",
    distance = 0,
    position?: { x: number; y: number; z: number },
  ): void {
    if (!this.context || !this.wildlifeBus || this.context.state !== "running" || !this.enabled) return;
    const attenuation = 1 / (1 + Math.max(0, distance) / 28);
    // Big impacts carry: a breaching whale is heard a long way off.
    const carry = 1 + Math.max(0, intensity - 3) * Math.min(1, distance / 60) * 0.6;
    const level = Math.min(2.4, Math.max(0.05, intensity)) * attenuation * carry;
    if (level < 0.015) return;
    const now = this.context.currentTime;
    // Positioned splashes are panned to where they happened; distance is
    // already in the level above, so the panner only places the sound.
    const output = position ? this.placedOutput(position) : this.wildlifeBus;
    // Far water sounds lose their highs.
    const far = clamp(distance / 160, 0, 1);
    const noise = (
      duration: number,
      type: BiquadFilterType,
      frequency: number,
      q: number,
      peak: number,
      attack: number,
      decay: number,
    ): void => {
      if (!this.context || !this.wildlifeBus) return;
      const source = this.context.createBufferSource();
      source.buffer = this.createNoiseBuffer(duration);
      const filter = this.context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
      if (far > 0.05) filter.frequency.value = frequency * (1 - far * 0.6);
      source.connect(filter).connect(gain).connect(output);
      source.start(now);
      source.stop(now + duration);
    };
    switch (kind) {
      case "blow":
        // A long, breathy exhalation rather than a splash.
        noise(1.8, "bandpass", 620, 0.45, 0.2 * level, 0.09, 1.5);
        noise(1.2, "highpass", 2400, 0.3, 0.05 * level, 0.05, 0.9);
        return;
      case "slap": {
        // A sharp crack over a heavy, low body of water.
        noise(0.4, "bandpass", 1500, 0.8, 0.22 * level, 0.004, 0.3);
        noise(1.6, "lowpass", 420, 0.7, 0.32 * level, 0.012, 1.3);
        const thump = this.context.createOscillator();
        thump.type = "sine";
        thump.frequency.setValueAtTime(140, now);
        thump.frequency.exponentialRampToValueAtTime(62, now + 0.35);
        const thumpGain = this.context.createGain();
        thumpGain.gain.setValueAtTime(0.0001, now);
        thumpGain.gain.exponentialRampToValueAtTime(0.28 * level, now + 0.01);
        thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
        thump.connect(thumpGain).connect(output);
        thump.start(now);
        thump.stop(now + 0.5);
        if (intensity >= 4.5) {
          // A body crashing down: a long, rolling roar of falling water.
          noise(3.4, "lowpass", 700, 0.6, 0.26 * level, 0.08, 3.1);
          noise(2.6, "bandpass", 1800, 0.5, 0.08 * level, 0.2, 2.2);
        }
        return;
      }
      case "exit":
        // Water pouring off a body.
        noise(0.9, "bandpass", 1250, 0.55, 0.1 * level, 0.03, 0.7);
        return;
      case "breath":
        noise(0.5, "bandpass", 1050, 0.6, 0.07 * level, 0.02, 0.35);
        return;
      case "entry":
        noise(0.7, "bandpass", 850, 0.62, 0.16 * level, 0.018, 0.56);
        return;
    }
  }

  dispose(): void {
    window.clearTimeout(this.muteTimer);
    window.removeEventListener("pointerdown", this.onUserGesture, true);
    window.removeEventListener("mousedown", this.onUserGesture, true);
    window.removeEventListener("touchstart", this.onUserGesture, true);
    window.removeEventListener("click", this.onUserGesture, true);
    window.removeEventListener("keydown", this.onUserGesture, true);
    window.removeEventListener("pagehide", this.handlePageHide);
    window.removeEventListener("pageshow", this.handlePageShow);
    window.removeEventListener("focus", this.handlePageShow);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.context?.removeEventListener("statechange", this.handleContextStateChange);
    this.engineFiring?.stop();
    this.engineCrank?.stop();
    this.engineKnock?.stop();
    this.exhaustPulse?.stop();
    this.shipVoices.forEach((voice) => voice.beatRate.stop());
    this.shanty?.dispose();
    this.party?.dispose();
    this.shipVoices.length = 0;
    if (this.context && this.context.state !== "closed") void this.context.close();
  }

  private readonly onUserGesture = (): void => {
    void this.resumeFromGesture();
  };

  private readonly handleVisibility = (): void => {
    if (!this.context) return;
    if (document.hidden) {
      this.setReady(false);
      void this.context.suspend().catch(() => undefined);
    } else {
      // Resuming from visibilitychange is not a trusted gesture on Safari.
      // Leave the graph pending; the next pointer, touch, or key event will
      // resume it through the capture listeners installed in the constructor.
      this.setReady(this.context.state === "running");
    }
  };

  private readonly handlePageHide = (): void => {
    if (!this.context || this.context.state === "closed") return;
    this.setReady(false);
    void this.context.suspend().catch(() => undefined);
  };

  private readonly handlePageShow = (): void => {
    this.setReady(this.context?.state === "running");
  };

  private readonly handleContextStateChange = (): void => {
    const running = this.context?.state === "running";
    this.setReady(running);
    if (running) this.setBusGain(this.master, this.enabled ? MASTER_GAIN : 0, 0.04);
  };

  private createGraph(): void {
    const AudioContextConstructor = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is unavailable in this browser.");
    // Music voices belong to the old graph, if there was one.
    this.shanty?.dispose();
    this.party?.dispose();
    this.shanty = undefined;
    this.party = undefined;
    this.hum?.oscillators.forEach((oscillator) => oscillator.stop());
    this.hum = undefined;
    this.roarVoice = undefined;
    this.planeVoice?.oscillators.forEach((oscillator) => oscillator.stop());
    this.planeVoice = undefined;
    this.jetVoice = undefined;
    try {
      this.context = new AudioContextConstructor({ latencyHint: "interactive" });
    } catch {
      // Older WebKit versions expose AudioContext but reject options.
      this.context = new AudioContextConstructor();
    }
    this.context.addEventListener("statechange", this.handleContextStateChange);
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 14;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.24;
    // Under the water everything from outside the mask is dulled: a low-pass
    // between the mix and the output, wide open in the air.
    this.waterFilter = this.context.createBiquadFilter();
    this.waterFilter.type = "lowpass";
    this.waterFilter.frequency.value = 20000;
    this.waterFilter.Q.value = 0.7;
    this.master.connect(this.waterFilter).connect(compressor).connect(this.context.destination);
    // What the diver hears inside his own mask (his breath, the regulator)
    // goes round the filter.
    this.diverBus = this.context.createGain();
    this.diverBus.gain.value = 0;
    this.diverBus.connect(compressor);
    // The hum of the sea itself, heard only under it.
    const hum = this.context.createBufferSource();
    hum.buffer = this.createNoiseBuffer(6.1, "brown");
    hum.loop = true;
    const humFilter = this.context.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 260;
    this.underwaterHum = this.context.createGain();
    this.underwaterHum.gain.value = 0;
    hum.connect(humFilter).connect(this.underwaterHum).connect(this.diverBus);
    hum.start(0, 0.9);
    this.engineBus = this.context.createGain();
    this.environmentBus = this.context.createGain();
    this.wildlifeBus = this.context.createGain();
    this.engineSpace = this.context.createGain();
    this.engineSpace.gain.value = this.engineHeard;
    this.engineAir = this.context.createBiquadFilter();
    this.engineAir.type = "lowpass";
    this.engineAir.frequency.value = 14000;
    this.engineAir.Q.value = 0.5;
    this.enginePanner = typeof this.context.createStereoPanner === "function" ? this.context.createStereoPanner() : undefined;
    const engineOut = this.engineBus.connect(this.engineSpace).connect(this.engineAir);
    if (this.enginePanner) engineOut.connect(this.enginePanner).connect(this.master);
    else engineOut.connect(this.master);
    this.environmentBus.connect(this.master);
    this.wildlifeBus.connect(this.master);
    const engineAudible = this.engineRunning && !this.engineMuted;
    this.engineBus.gain.value = engineAudible ? ENGINE_BUS_GAIN : 0;
    this.environmentBus.gain.value = engineAudible ? ENGINE_ENVIRONMENT_DUCK : 1;
    this.wildlifeBus.gain.value = 1;

    this.createEngine(this.context, this.engineBus);

    const waveNoise = this.createNoiseBuffer(5.3, "pink");
    const waves = this.context.createBufferSource();
    waves.buffer = waveNoise;
    waves.loop = true;
    this.waveFilter = this.context.createBiquadFilter();
    this.waveFilter.type = "lowpass";
    this.waveFilter.frequency.value = 1100;
    this.waveFilter.Q.value = 0.45;
    this.waveGain = this.context.createGain();
    this.waveGain.gain.value = 0.035;
    waves.connect(this.waveFilter).connect(this.waveGain).connect(this.environmentBus);
    waves.start();

    // Rain: broadband hiss of drops on the sea, and a lower patter on the deck
    // and the sails. Silent until it rains.
    const rainHiss = this.context.createBufferSource();
    rainHiss.buffer = this.createNoiseBuffer(4.1, "white");
    rainHiss.loop = true;
    const rainHissFilter = this.context.createBiquadFilter();
    rainHissFilter.type = "bandpass";
    rainHissFilter.frequency.value = 4800;
    rainHissFilter.Q.value = 0.35;
    this.rainHissGain = this.context.createGain();
    this.rainHissGain.gain.value = 0;
    rainHiss.connect(rainHissFilter).connect(this.rainHissGain).connect(this.environmentBus);
    rainHiss.start(0, 0.7);
    const rainPatter = this.context.createBufferSource();
    rainPatter.buffer = this.createNoiseBuffer(3.3, "pink");
    rainPatter.loop = true;
    rainPatter.playbackRate.value = 1.6;
    const rainPatterFilter = this.context.createBiquadFilter();
    rainPatterFilter.type = "bandpass";
    rainPatterFilter.frequency.value = 1500;
    rainPatterFilter.Q.value = 0.6;
    this.rainPatterGain = this.context.createGain();
    this.rainPatterGain.gain.value = 0;
    rainPatter.connect(rainPatterFilter).connect(this.rainPatterGain).connect(this.environmentBus);
    rainPatter.start(0, 1.3);

    // Wind: pink noise through a low band whose centre the breeze moves;
    // nothing hissy above a couple of kilohertz.
    const wind = this.context.createBufferSource();
    wind.buffer = this.createNoiseBuffer(6.1, "pink");
    wind.loop = true;
    wind.playbackRate.value = 0.71;
    this.windFilter = this.context.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.55;
    const windSoftener = this.context.createBiquadFilter();
    windSoftener.type = "lowpass";
    windSoftener.frequency.value = 1400;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.004;
    // Gusts are events (see WindMath.gustEvent): update() swells the wind.
    wind.connect(this.windFilter).connect(windSoftener).connect(this.windGain).connect(this.environmentBus);
    wind.start(0, 0.41);
    this.createStormWind(this.context, this.environmentBus);
    this.boat = new BoatVoices(this.context, this.environmentBus, (duration, color) => this.createNoiseBuffer(duration, color));
    // The open sea's echo for horns and the bell: early reflections off the
    // water and a distant shore, then a long, darkening tail.
    this.seaReverb = this.context.createConvolver();
    this.seaReverb.normalize = false;
    this.seaReverb.buffer = openSeaImpulse(this.context);
    const reverbReturn = this.context.createGain();
    reverbReturn.gain.value = 0.55;
    this.seaReverb.connect(reverbReturn).connect(this.environmentBus);
    this.musicBus = this.context.createGain();
    this.musicBus.gain.value = 0.8;
    this.musicBus.connect(this.master);
    this.createShipVoices(this.context, this.environmentBus);
    this.setReady(this.context.state === "running");
  }

  /** Continuous voices for the nearest ships, silent until `updateShips` gives them a ship. */
  private createShipVoices(context: AudioContext, bus: GainNode): void {
    const rumbleNoise = this.createNoiseBuffer(5.7, "brown");
    const washNoise = this.createNoiseBuffer(4.3, "pink");
    for (let index = 0; index < SHIP_VOICES; index += 1) {
      const panner = context.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "linear";
      panner.rolloffFactor = 0;
      panner.connect(bus);
      const air = context.createBiquadFilter();
      air.type = "lowpass";
      air.frequency.value = 600;
      air.Q.value = 0.4;
      air.connect(panner);
      // The throb: low noise with its energy just above 100 Hz, so a phone
      // speaker still carries it.
      const rumbleSource = context.createBufferSource();
      rumbleSource.buffer = rumbleNoise;
      rumbleSource.loop = true;
      rumbleSource.playbackRate.value = 0.9 + index * 0.13;
      const rumbleFilter = context.createBiquadFilter();
      rumbleFilter.type = "bandpass";
      rumbleFilter.frequency.value = 130;
      rumbleFilter.Q.value = 0.9;
      const rumble = context.createGain();
      rumble.gain.value = 0;
      rumbleSource.connect(rumbleFilter).connect(rumble).connect(air);
      rumbleSource.start(0, index * 1.7);
      // The beat of the cylinders: the same noise, pulsed.
      const beatSource = context.createBufferSource();
      beatSource.buffer = rumbleNoise;
      beatSource.loop = true;
      const beatFilter = context.createBiquadFilter();
      beatFilter.type = "bandpass";
      beatFilter.frequency.value = 180;
      beatFilter.Q.value = 1.6;
      const pulse = context.createGain();
      pulse.gain.value = 0.5;
      const beatRate = context.createOscillator();
      beatRate.frequency.value = 0;
      const beatDepth = context.createGain();
      beatDepth.gain.value = 0.5;
      beatRate.connect(beatDepth).connect(pulse.gain);
      beatRate.start();
      const beat = context.createGain();
      beat.gain.value = 0;
      beatSource.connect(beatFilter).connect(pulse).connect(beat).connect(air);
      beatSource.start(0, 2.3 + index);
      // The bow wave breaking along her side.
      const washSource = context.createBufferSource();
      washSource.buffer = washNoise;
      washSource.loop = true;
      const washFilter = context.createBiquadFilter();
      washFilter.type = "bandpass";
      washFilter.frequency.value = 650;
      washFilter.Q.value = 0.6;
      const wash = context.createGain();
      wash.gain.value = 0;
      washSource.connect(washFilter).connect(wash).connect(air);
      washSource.start(0, index * 0.9);
      this.shipVoices.push({ panner, air, rumble, beat, beatRate, wash });
    }
  }

  /**
   * A small marine diesel: firing pulses with a harmonic spectrum, a half-
   * speed crank component that gives the uneven "chug", combustion knock
   * (noise pulsed at the firing rate), and the gurgle of a wet exhaust.
   * Everything passes a low-pass that opens with revs, so it sounds calm and
   * muffled at idle and fuller, never shrill, under power.
   */
  private createEngine(context: AudioContext, bus: GainNode): void {
    const { real, imag } = dieselSpectrum();
    const wave = context.createPeriodicWave(real, imag, { disableNormalization: false });
    this.engineTone = context.createBiquadFilter();
    this.engineTone.type = "lowpass";
    this.engineTone.frequency.value = 260;
    this.engineTone.Q.value = 0.6;
    // Removes the sub-bass a phone cannot play and a laptop only rumbles with.
    const highPass = context.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 85;
    this.engineTone.connect(highPass).connect(bus);

    this.engineFiring = context.createOscillator();
    this.engineFiring.setPeriodicWave(wave);
    this.engineFiring.frequency.value = ENGINE_IDLE_FIRING;
    this.engineFiringGain = context.createGain();
    this.engineFiringGain.gain.value = 0.07;
    this.engineFiring.connect(this.engineFiringGain).connect(this.engineTone);
    this.engineFiring.start();

    this.engineCrank = context.createOscillator();
    this.engineCrank.setPeriodicWave(wave);
    this.engineCrank.frequency.value = ENGINE_IDLE_FIRING / 2;
    this.engineCrankGain = context.createGain();
    this.engineCrankGain.gain.value = 0.03;
    this.engineCrank.connect(this.engineCrankGain).connect(this.engineTone);
    this.engineCrank.start();

    // Knock: band-limited noise whose level pulses with each firing stroke.
    const knockNoise = context.createBufferSource();
    knockNoise.buffer = this.createNoiseBuffer(3.9, "pink");
    knockNoise.loop = true;
    this.engineCombustionFilter = context.createBiquadFilter();
    this.engineCombustionFilter.type = "bandpass";
    this.engineCombustionFilter.frequency.value = ENGINE_IDLE_FIRING * 6;
    this.engineCombustionFilter.Q.value = 1.1;
    this.engineCombustionGain = context.createGain();
    this.engineCombustionGain.gain.value = 0.012;
    this.engineKnock = context.createOscillator();
    this.engineKnock.type = "sine";
    this.engineKnock.frequency.value = ENGINE_IDLE_FIRING;
    this.engineKnockDepth = context.createGain();
    this.engineKnockDepth.gain.value = 0.01;
    this.engineKnock.connect(this.engineKnockDepth).connect(this.engineCombustionGain.gain);
    knockNoise.connect(this.engineCombustionFilter).connect(this.engineCombustionGain).connect(this.engineTone);
    this.engineKnock.start();
    knockNoise.start(0, 0.37);

    // Wet exhaust: low, burbling water at the transom.
    const exhaust = context.createBufferSource();
    exhaust.buffer = this.createNoiseBuffer(4.4, "brown");
    exhaust.loop = true;
    const exhaustFilter = context.createBiquadFilter();
    exhaustFilter.type = "bandpass";
    exhaustFilter.frequency.value = 240;
    exhaustFilter.Q.value = 0.8;
    this.exhaustGain = context.createGain();
    this.exhaustGain.gain.value = 0.05;
    this.exhaustPulse = context.createOscillator();
    this.exhaustPulse.type = "sine";
    this.exhaustPulse.frequency.value = ENGINE_IDLE_FIRING / 4;
    const exhaustDepth = context.createGain();
    exhaustDepth.gain.value = 0.03;
    this.exhaustPulse.connect(exhaustDepth).connect(this.exhaustGain.gain);
    exhaust.connect(exhaustFilter).connect(this.exhaustGain).connect(bus);
    this.exhaustPulse.start();
    exhaust.start(0, 1.7);
  }

  /** The starter turning the engine over, then the first firing strokes. */
  private playEngineStartCue(): void {
    if (!this.context || !this.engineBus || this.context.state !== "running" || !this.enabled || this.engineMuted) return;
    const now = this.context.currentTime;
    const starter = this.context.createOscillator();
    starter.type = "sawtooth";
    starter.frequency.setValueAtTime(9, now);
    starter.frequency.linearRampToValueAtTime(13, now + 0.55);
    const starterFilter = this.context.createBiquadFilter();
    starterFilter.type = "bandpass";
    starterFilter.frequency.value = 320;
    starterFilter.Q.value = 0.9;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.06);
    gain.gain.setValueAtTime(0.09, now + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    starter.connect(starterFilter).connect(gain).connect(this.engineBus);
    starter.start(now);
    starter.stop(now + 0.8);
  }

  /**
   * The engine switched off: the last few firings slow and die away, a
   * shudder through the hull and a puff from the exhaust. Played on the
   * environment bus, since the engine's own bus falls silent at once.
   */
  private playEngineStopCue(): void {
    const context = this.context;
    const bus = this.environmentBus;
    if (!context || !bus || context.state !== "running" || !this.enabled || this.engineMuted) return;
    const now = context.currentTime;
    const firing = context.createOscillator();
    firing.type = "sawtooth";
    firing.frequency.setValueAtTime(ENGINE_IDLE_FIRING, now);
    firing.frequency.exponentialRampToValueAtTime(ENGINE_IDLE_FIRING * 0.28, now + 0.95);
    const body = context.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.setValueAtTime(420, now);
    body.frequency.exponentialRampToValueAtTime(110, now + 0.95);
    body.Q.value = 1.4;
    const level = context.createGain();
    level.gain.setValueAtTime(0.0001, now);
    level.gain.exponentialRampToValueAtTime(0.12, now + 0.04);
    level.gain.exponentialRampToValueAtTime(0.05, now + 0.5);
    level.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);
    firing.connect(body).connect(level).connect(bus);
    firing.start(now);
    firing.stop(now + 1.1);
    // The exhaust's last breath: a short low puff of noise.
    const length = Math.floor(context.sampleRate * 0.35);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 2);
    const puff = context.createBufferSource();
    puff.buffer = buffer;
    const puffFilter = context.createBiquadFilter();
    puffFilter.type = "lowpass";
    puffFilter.frequency.value = 260;
    const puffLevel = context.createGain();
    puffLevel.gain.value = 0.07;
    puff.connect(puffFilter).connect(puffLevel).connect(bus);
    puff.start(now + 0.85);
    window.setTimeout(() => {
      firing.disconnect();
      body.disconnect();
      level.disconnect();
      puff.disconnect();
      puffFilter.disconnect();
      puffLevel.disconnect();
    }, 1800);
  }

  /** Output that places a one-shot sound at a world position. */
  private placedOutput(position: { x: number; y: number; z: number }): AudioNode {
    const context = this.context!;
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    // Level is set by the caller; the panner only gives the direction.
    panner.distanceModel = "linear";
    panner.rolloffFactor = 0;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
    panner.connect(this.wildlifeBus!);
    // Disconnect once every one-shot has finished.
    window.setTimeout(() => panner.disconnect(), 4500);
    return panner;
  }

  /**
   * One gull call from where the bird is flying. Variants: the long call
   * (a series of falling "kyow" notes), a single "kee-ow", short alarm "keks",
   * and a soft mew. Each note is a reedy tone through two vocal formants with
   * a little breath noise, pitch and timing varied every time.
   */
  private gullCall(position: { x: number; y: number; z: number }, variant: number): void {
    const context = this.context;
    if (!context || !this.wildlifeBus) return;
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = 10;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 400;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
    const level = context.createGain();
    level.gain.value = 0.8;
    level.connect(panner).connect(this.wildlifeBus);
    const formantA = context.createBiquadFilter();
    formantA.type = "bandpass";
    formantA.Q.value = 3.2;
    const formantB = context.createBiquadFilter();
    formantB.type = "bandpass";
    formantB.Q.value = 4.5;
    formantA.connect(level);
    formantB.connect(level);
    const pitch = 0.88 + Math.random() * 0.28;
    formantA.frequency.value = 1850 * pitch;
    formantB.frequency.value = 3300 * pitch;

    const now = context.currentTime + 0.02;
    const note = (start: number, length: number, from: number, peak: number, to: number, loudness: number): void => {
      const tone = context.createOscillator();
      tone.type = "sawtooth";
      const t0 = now + start;
      tone.frequency.setValueAtTime(from * pitch, t0);
      tone.frequency.exponentialRampToValueAtTime(peak * pitch, t0 + length * 0.25);
      tone.frequency.exponentialRampToValueAtTime(to * pitch, t0 + length);
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, t0);
      envelope.gain.exponentialRampToValueAtTime(0.16 * loudness, t0 + 0.02);
      envelope.gain.setValueAtTime(0.16 * loudness, t0 + length * 0.6);
      envelope.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      tone.connect(envelope);
      envelope.connect(formantA);
      envelope.connect(formantB);
      tone.start(t0);
      tone.stop(t0 + length + 0.02);
      // Breath: the rasp in a gull's voice.
      const breath = context.createBufferSource();
      breath.buffer = this.createNoiseBuffer(length + 0.05, "white");
      const breathGain = context.createGain();
      breathGain.gain.setValueAtTime(0.0001, t0);
      breathGain.gain.exponentialRampToValueAtTime(0.05 * loudness, t0 + 0.02);
      breathGain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      breath.connect(breathGain).connect(formantB);
      breath.start(t0);
      breath.stop(t0 + length + 0.05);
    };
    let end = 0;
    switch (variant) {
      case 0: {
        // Long call: a leading wail, then falling, quickening "kyow" notes.
        note(0, 0.42, 900, 1500, 1150, 0.9);
        const count = 3 + Math.floor(Math.random() * 4);
        let time = 0.55;
        for (let index = 0; index < count; index += 1) {
          const length = 0.2 - index * 0.012 + Math.random() * 0.03;
          note(time, length, 1250 - index * 30, 1650 - index * 40, 1050 - index * 25, 1 - index * 0.08);
          time += length + 0.07 + Math.random() * 0.05;
        }
        end = time;
        break;
      }
      case 1:
        note(0, 0.5, 1400, 1950, 820, 1);
        end = 0.5;
        break;
      case 2: {
        const count = 2 + Math.floor(Math.random() * 3);
        for (let index = 0; index < count; index += 1) note(index * 0.15, 0.09, 1700, 1900, 1500, 0.8);
        end = count * 0.15;
        break;
      }
      default:
        note(0, 0.6, 1100, 1350, 900, 0.55);
        end = 0.6;
        break;
    }
    window.setTimeout(() => panner.disconnect(), (end + 0.5) * 1000);
  }

  private playUnlockImpulse(): void {
    if (!this.context) return;
    const source = this.context.createBufferSource();
    source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    source.buffer.getChannelData(0)[0] = 1;
    const almostSilent = this.context.createGain();
    almostSilent.gain.value = 0.0001;
    source.connect(almostSilent).connect(this.context.destination);
    source.start(this.context.currentTime);
  }

  private createNoiseBuffer(duration: number, color: NoiseColor = "brown"): AudioBuffer {
    if (!this.context) throw new Error("AudioContext is required before creating audio buffers.");
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let brown = 0;
    let pink0 = 0;
    let pink1 = 0;
    let pink2 = 0;
    let pink3 = 0;
    let pink4 = 0;
    let pink5 = 0;
    let pink6 = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      if (color === "white") {
        samples[index] = white * 0.36;
      } else if (color === "pink") {
        pink0 = 0.99886 * pink0 + white * 0.0555179;
        pink1 = 0.99332 * pink1 + white * 0.0750759;
        pink2 = 0.969 * pink2 + white * 0.153852;
        pink3 = 0.8665 * pink3 + white * 0.3104856;
        pink4 = 0.55 * pink4 + white * 0.5329522;
        pink5 = -0.7616 * pink5 - white * 0.016898;
        samples[index] = (pink0 + pink1 + pink2 + pink3 + pink4 + pink5 + pink6 + white * 0.5362) * 0.08;
        pink6 = white * 0.115926;
      } else {
        brown = (brown + 0.02 * white) / 1.02;
        samples[index] = brown * 3.2;
      }
    }
    return buffer;
  }

  private setBusGain(node: GainNode | undefined, value: number, timeConstant: number): void {
    if (!node || !this.context) return;
    node.gain.setTargetAtTime(value, this.context.currentTime, timeConstant);
  }

  private updateEngineBusGain(): void {
    const engineAudible = this.engineRunning && !this.engineMuted;
    this.setBusGain(this.engineBus, engineAudible ? ENGINE_BUS_GAIN : 0, 0.045);
    // Ambient audio remains present, but it ducks slightly while the engine is
    // running so its RPM layers are distinct on small mobile speakers; less
    // so when the camera is far from the engine and hears little of it.
    this.setBusGain(this.environmentBus, engineAudible ? 1 - (1 - ENGINE_ENVIRONMENT_DUCK) * this.engineHeard : 1, 0.12);
  }

  /** The engine as heard from the camera: level, dulling by distance, and side. */
  private updateEngineSpace(step: number, now: number): void {
    const dx = this.engineSourceX - this.listenerX;
    const dy = this.engineSourceY - this.listenerY;
    const dz = this.engineSourceZ - this.listenerZ;
    const distance = Math.hypot(dx, dy, dz);
    const target = engineDistanceGain(distance);
    // A camera that jumps (a new mode) glides the level over a fraction of a second.
    const previous = this.engineHeard;
    this.engineHeard += (target - this.engineHeard) * (1 - Math.exp(-step * 6));
    this.engineSpace?.gain.setTargetAtTime(this.engineHeard, now, 0.08);
    this.engineAir?.frequency.setTargetAtTime(engineAirCutoff(distance), now, 0.12);
    this.enginePanner?.pan.setTargetAtTime(enginePan(this.listenerRightX, this.listenerRightZ, dx, dz), now, 0.1);
    if (Math.abs(this.engineHeard - previous) > 0.01) this.updateEngineBusGain();
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) return;
    this.ready = ready;
    this.onReadyChange?.(ready);
  }
}
