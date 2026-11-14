import type { AudioSystem } from "./AudioSystem";

/**
 * The sounds of the fight and of the story's radio, synthesised on the
 * main audio graph (`AudioSystem.mixer`): the skipper's rifle (a crack and
 * its slap-back off the water), a drone's bursts heard from where it is and
 * as late as sound takes to cross the gap, rounds striking her hull or
 * whipping past, a round ringing off armour or cracking a sensor dome, a
 * drone blowing up, the whine of their water-jets, the winch's ratchet,
 * and the squelch and two-tone chime of the radio.
 *
 * Nothing plays unless the player has turned sound on.
 */

type Point = { x: number; y: number; z: number };

const SPEED_OF_SOUND = 343;
const ENGINE_VOICES = 3;

type EngineVoice = { saw: OscillatorNode; sub: OscillatorNode; tone: BiquadFilterNode; gain: GainNode; panner: PannerNode; noise: AudioBufferSourceNode; wash: GainNode };

export class CombatAudio {
  private noise?: AudioBuffer;
  private context?: AudioContext;
  private voices: EngineVoice[] = [];
  private winchClock = 0;
  private echo?: { input: GainNode };

  constructor(private readonly audio: AudioSystem) {}

  private ready(): { context: AudioContext; master: AudioNode; music: AudioNode; reverb: AudioNode | null } | null {
    const mixer = this.audio.mixer;
    if (!mixer) return null;
    if (this.context !== mixer.context) {
      // A new context (sound turned on afresh): rebuild what lives in it.
      this.context = mixer.context;
      this.noise = undefined;
      this.voices = [];
      this.echo = undefined;
    }
    return mixer;
  }

  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const length = Math.floor(context.sampleRate * 1.5);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }

  /** A short slap-back off the water (a single tap with a soft repeat), shared by the rifle and the blasts. */
  private slapBack(context: AudioContext, master: AudioNode): GainNode {
    if (this.echo) return this.echo.input;
    const input = context.createGain();
    input.gain.value = 1;
    const delay = context.createDelay(1);
    delay.delayTime.value = 0.17;
    const feedback = context.createGain();
    feedback.gain.value = 0.22;
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 1800;
    const out = context.createGain();
    out.gain.value = 0.32;
    input.connect(delay).connect(tone).connect(feedback).connect(delay);
    tone.connect(out).connect(master);
    this.echo = { input };
    return input;
  }

  private panner(context: AudioContext, at: Point): PannerNode {
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = 12;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 4000;
    if (panner.positionX) {
      panner.positionX.value = at.x;
      panner.positionY.value = at.y;
      panner.positionZ.value = at.z;
    } else {
      panner.setPosition(at.x, at.y, at.z);
    }
    return panner;
  }

  private burstOfNoise(context: AudioContext, destination: AudioNode, start: number, length: number, level: number, type: BiquadFilterType, frequency: number, q = 0.8, rate = 1): void {
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context);
    source.playbackRate.value = rate;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(filter).connect(gain).connect(destination);
    source.start(start, Math.random() * 1.2);
    source.stop(start + length + 0.02);
  }

  private thump(context: AudioContext, destination: AudioNode, start: number, frequency: number, length: number, level: number): void {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency * 1.6, start);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.6, start + length);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(destination);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }

  /**
   * A shot from his own gun, built the way a game's weapon sound is layered
   * (every shot a little different in pitch and colour, so a string of them
   * never sounds like a loop):
   *
   * - the **crack**: a few milliseconds of full-band pressure, driven into a
   *   soft clipper so it hits like a real report on small speakers too;
   * - the **punch**: a low sine falling fast (the chest thump) under a short
   *   burst of low noise;
   * - the **blast**: the mid-band roar of the propellant, decaying in a tenth
   *   of a second (longer for the rifle);
   * - the **mechanism**: the slide or the bolt carrier slamming back and home,
   *   as small metallic transients with their own resonances;
   * - the **tail**: the report rolling away over the island (a long, dark
   *   decay), the slap-back off the nearest slope, and the reverb;
   * - the **case**: the spent brass ringing as it lands, half a second later.
   */
  gunshot(weapon: "pistol" | "rifle"): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const rifle = weapon === "rifle";
    const now = context.currentTime + 0.004;
    const pitch = 1 + (Math.random() * 2 - 1) * 0.045;
    // Everything goes through a soft clipper and a fast compressor: loud, dense, never harsh.
    const drive = context.createWaveShaper();
    drive.curve = this.clipCurve();
    drive.oversample = "2x";
    const glue = context.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 6;
    glue.ratio.value = 6;
    glue.attack.value = 0.001;
    glue.release.value = 0.12;
    const out = context.createGain();
    out.gain.value = rifle ? 0.95 : 0.8;
    drive.connect(glue).connect(out).connect(master);
    out.connect(this.slapBack(context, master));
    const dry = context.createGain();
    dry.gain.value = 1.6;
    dry.connect(drive);

    // Crack.
    this.burstOfNoise(context, dry, now, 0.006, 1.2, "highpass", 1800 * pitch, 0.5, 1.8);
    this.burstOfNoise(context, dry, now, rifle ? 0.03 : 0.022, 0.9, "highpass", 3200 * pitch, 0.7, 1.5);
    // Punch.
    this.thump(context, dry, now, (rifle ? 78 : 112) * pitch, rifle ? 0.2 : 0.13, rifle ? 1.1 : 0.85);
    this.burstOfNoise(context, dry, now, rifle ? 0.07 : 0.05, 0.75, "lowpass", (rifle ? 420 : 620) * pitch, 0.9, 0.7);
    // Blast.
    this.burstOfNoise(context, dry, now + 0.002, rifle ? 0.17 : 0.1, rifle ? 0.7 : 0.55, "bandpass", (rifle ? 950 : 1350) * pitch, 0.9);
    this.burstOfNoise(context, dry, now + 0.004, rifle ? 0.26 : 0.16, 0.28, "bandpass", (rifle ? 2400 : 2900) * pitch, 1.4);
    // Mechanism.
    const metal = (at: number, frequency: number, level: number, length = 0.025) =>
      this.burstOfNoise(context, out, now + at, length, level, "bandpass", frequency * pitch, 9);
    if (rifle) {
      metal(0.028, 2700, 0.16, 0.03);
      metal(0.034, 4300, 0.1);
      metal(0.062, 3100, 0.14, 0.035);
      metal(0.068, 1900, 0.1, 0.04);
    } else {
      metal(0.018, 3900, 0.14);
      metal(0.024, 6200, 0.08, 0.015);
      metal(0.046, 3300, 0.12, 0.03);
    }
    // Tail: the report rolling off over the land.
    const tail = context.createGain();
    tail.gain.value = 1;
    tail.connect(out);
    this.burstOfNoise(context, tail, now + 0.03, rifle ? 1.25 : 0.85, rifle ? 0.24 : 0.16, "lowpass", rifle ? 520 : 700, 0.7, 0.55);
    this.thump(context, tail, now + 0.06, rifle ? 52 : 64, rifle ? 0.6 : 0.4, rifle ? 0.22 : 0.14);
    // The case landing: two or three bright pings, then nothing.
    const land = now + (rifle ? 0.48 : 0.42) + Math.random() * 0.12;
    const ring = (at: number, frequency: number, level: number) =>
      this.burstOfNoise(context, out, land + at, 0.05, level, "bandpass", frequency, 28);
    ring(0, 5200 + Math.random() * 600, 0.05);
    ring(0.07 + Math.random() * 0.03, 6100 + Math.random() * 500, 0.03);
    if (Math.random() < 0.6) ring(0.15 + Math.random() * 0.05, 5600, 0.018);
    if (mixer.reverb) {
      const wet = context.createGain();
      wet.gain.value = rifle ? 0.42 : 0.3;
      out.connect(wet).connect(mixer.reverb);
    }
    window.setTimeout(() => {
      dry.disconnect();
      out.disconnect();
    }, 1900);
  }

  /** The rifle's shot (kept for callers that name it). */
  rifle(): void {
    this.gunshot("rifle");
  }

  private clipCurveCache: Float32Array<ArrayBuffer> | null = null;

  /** A soft clipper (tanh), shared. */
  private clipCurve(): Float32Array<ArrayBuffer> {
    if (this.clipCurveCache) return this.clipCurveCache;
    const curve = new Float32Array(1024);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = Math.tanh(x * 2.6) / Math.tanh(2.6);
    }
    this.clipCurveCache = curve;
    return curve;
  }

  /** One round of a drone's burst, from where it was fired. */
  droneShot(at: Point): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const listener = this.audio.listener;
    const distance = Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z);
    const start = context.currentTime + 0.01 + distance / SPEED_OF_SOUND;
    const panner = this.panner(context, at);
    const air = context.createBiquadFilter();
    air.type = "lowpass";
    air.frequency.value = 600 + 9000 * Math.exp(-distance / 300);
    panner.connect(air).connect(master);
    this.burstOfNoise(context, panner, start, 0.05, 1.1, "highpass", 900, 0.6, 1.2);
    this.thump(context, panner, start, 120, 0.12, 0.8);
    window.setTimeout(() => panner.disconnect(), (start - context.currentTime + 0.5) * 1000);
  }

  /** A round striking her: a hard knock and splinters, right where it hit. */
  hullHit(at: Point): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const now = context.currentTime + 0.005;
    const panner = this.panner(context, at);
    panner.refDistance = 4;
    panner.connect(master);
    this.burstOfNoise(context, panner, now, 0.05, 0.9, "bandpass", 1500, 1.6);
    this.thump(context, panner, now, 170, 0.09, 0.9);
    this.burstOfNoise(context, panner, now + 0.02, 0.12, 0.2, "highpass", 4000, 0.7, 1.6);
    window.setTimeout(() => panner.disconnect(), 600);
  }

  /** A round whipping past close by. */
  whiz(at: Point): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const now = context.currentTime + 0.005;
    const panner = this.panner(context, at);
    panner.refDistance = 3;
    panner.connect(master);
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context);
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 6;
    band.frequency.setValueAtTime(3400, now);
    band.frequency.exponentialRampToValueAtTime(800, now + 0.14);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    source.connect(band).connect(gain).connect(panner);
    source.start(now, Math.random());
    source.stop(now + 0.2);
    window.setTimeout(() => panner.disconnect(), 500);
  }

  /**
   * A gun fired by someone else (a guard's carbine, a pistol), placed where
   * it was fired: a sharp crack near, a flat thud with a long tail of echo
   * off the hills far off.
   */
  distantShot(kind: "carbine" | "pistol", at: Point): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const listener = this.audio.listener;
    const distance = Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z);
    const start = context.currentTime + 0.01 + distance / SPEED_OF_SOUND;
    const panner = this.panner(context, at);
    panner.refDistance = 12;
    panner.rolloffFactor = 0.8;
    panner.connect(master);
    const near = Math.max(0, 1 - distance / 120);
    const level = kind === "carbine" ? 1 : 0.7;
    // The crack (a high, short burst) fades with distance faster than the boom.
    this.burstOfNoise(context, panner, start, 0.02, 1.1 * level * near, "highpass", 2400, 0.7, 1.6);
    this.burstOfNoise(context, panner, start, 0.12, 0.8 * level, "lowpass", 900 + 1500 * near, 0.7, 0.9);
    this.thump(context, panner, start, kind === "carbine" ? 95 : 130, 0.14, 0.9 * level);
    if (mixer.reverb) {
      const wet = context.createGain();
      wet.gain.value = 0.35 + 0.4 * (1 - near);
      panner.connect(wet).connect(mixer.reverb);
    }
    window.setTimeout(() => panner.disconnect(), (start - context.currentTime + 1.5) * 1000);
  }

  /** A round striking something near the listener: a ricochet off steel, chips off stone. */
  ricochet(at: Point, material: string): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const listener = this.audio.listener;
    const distance = Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z);
    if (distance > 70) return;
    const start = context.currentTime + 0.01 + distance / SPEED_OF_SOUND;
    const panner = this.panner(context, at);
    panner.refDistance = 6;
    panner.connect(master);
    if (material === "metal") {
      const osc = context.createOscillator();
      osc.type = "triangle";
      const pitch = 1800 + Math.random() * 1600;
      osc.frequency.setValueAtTime(pitch, start);
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.5, start + 0.3);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain).connect(panner);
      osc.start(start);
      osc.stop(start + 0.34);
    }
    this.burstOfNoise(context, panner, start, 0.05, material === "glass" ? 0.9 : 0.5, material === "glass" ? "highpass" : "bandpass", material === "glass" ? 4000 : 1600, 1.2, 1.4);
    window.setTimeout(() => panner.disconnect(), (start - context.currentTime + 0.6) * 1000);
  }

  /** He is hit: a dull blow, his breath knocked out. */
  playerHit(): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const now = context.currentTime + 0.005;
    this.thump(context, master, now, 70, 0.22, 0.9);
    this.burstOfNoise(context, master, now, 0.18, 0.35, "lowpass", 600, 0.7, 0.8);
  }

  /** The skipper's round arriving at a drone: a ring off armour, a crack of glass, or a dull hit in the jets. */
  impact(at: Point, zone: "dome" | "jet" | "hull", armour: boolean): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const listener = this.audio.listener;
    const distance = Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z);
    const start = context.currentTime + 0.01 + distance / SPEED_OF_SOUND;
    const panner = this.panner(context, at);
    panner.refDistance = 25;
    panner.connect(master);
    if (zone === "dome" && !armour) {
      // Glass and electronics: a crack and a fizz.
      this.burstOfNoise(context, panner, start, 0.08, 0.9, "highpass", 3500, 0.7, 1.8);
      for (let index = 0; index < 4; index += 1) this.burstOfNoise(context, panner, start + 0.03 + index * 0.025 + Math.random() * 0.02, 0.015, 0.4, "bandpass", 5000 + Math.random() * 3000, 6);
    } else if (armour) {
      // A ping off steel, the ricochet singing away.
      const osc = context.createOscillator();
      osc.type = "triangle";
      const pitch = 2100 + Math.random() * 1400;
      osc.frequency.setValueAtTime(pitch, start);
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.55, start + 0.35);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
      osc.connect(gain).connect(panner);
      osc.start(start);
      osc.stop(start + 0.4);
      this.burstOfNoise(context, panner, start, 0.03, 0.6, "highpass", 2500, 0.7);
    } else {
      this.burstOfNoise(context, panner, start, 0.07, 0.7, "bandpass", 900, 1.2);
      this.thump(context, panner, start, 140, 0.1, 0.6);
    }
    window.setTimeout(() => panner.disconnect(), (start - context.currentTime + 0.8) * 1000);
  }

  /** A drone blowing up (or a big hit the story deals her). */
  explosion(at: Point, scale = 1): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const listener = this.audio.listener;
    const distance = Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z);
    const start = context.currentTime + 0.01 + distance / SPEED_OF_SOUND;
    const panner = this.panner(context, at);
    panner.refDistance = 40 * scale;
    const low = context.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.setValueAtTime(2400 * Math.exp(-distance / 900), start);
    low.frequency.exponentialRampToValueAtTime(140, start + 1.4);
    panner.connect(low).connect(master);
    if (mixer.reverb) {
      const wet = context.createGain();
      wet.gain.value = 0.6;
      low.connect(wet).connect(mixer.reverb);
    }
    low.connect(this.slapBack(context, master));
    this.burstOfNoise(context, panner, start, 2.4, 1.6 * scale, "lowpass", 1600, 0.5, 0.6);
    this.thump(context, panner, start, 55, 0.9, 1.2 * scale);
    this.burstOfNoise(context, panner, start, 0.08, 1.2 * scale, "highpass", 1000, 0.6);
    window.setTimeout(() => panner.disconnect(), (start - context.currentTime + 3) * 1000);
  }

  /** The water-jets of the nearest drones: a turbine whine over the roar of the jets, rising with speed. */
  updateEngines(engines: readonly { x: number; y: number; z: number; speed: number }[]): void {
    // No drones yet: nothing is built (free sailing never pays for these voices).
    if (this.voices.length === 0 && engines.length === 0) return;
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    if (this.voices.length === 0) {
      for (let index = 0; index < ENGINE_VOICES; index += 1) {
        const panner = this.panner(context, { x: 0, y: -100, z: 0 });
        panner.refDistance = 30;
        panner.rolloffFactor = 1.3;
        const gain = context.createGain();
        gain.gain.value = 0;
        const tone = context.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = 800;
        const saw = context.createOscillator();
        saw.type = "sawtooth";
        saw.frequency.value = 110;
        const sub = context.createOscillator();
        sub.type = "square";
        sub.frequency.value = 55;
        const subGain = context.createGain();
        subGain.gain.value = 0.35;
        const noise = context.createBufferSource();
        noise.buffer = this.noiseBuffer(context);
        noise.loop = true;
        const band = context.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 700;
        band.Q.value = 0.6;
        const wash = context.createGain();
        wash.gain.value = 0;
        saw.connect(tone);
        sub.connect(subGain).connect(tone);
        tone.connect(gain);
        noise.connect(band).connect(wash).connect(gain);
        gain.connect(panner).connect(master);
        saw.start();
        sub.start();
        noise.start(0, index * 0.3);
        this.voices.push({ saw, sub, tone, gain, panner, noise, wash });
      }
    }
    const listener = this.audio.listener;
    const now = context.currentTime;
    const nearest = [...engines].sort((a, b) => Math.hypot(a.x - listener.x, a.z - listener.z) - Math.hypot(b.x - listener.x, b.z - listener.z));
    this.voices.forEach((voice, index) => {
      const engine = nearest[index];
      if (!engine) {
        voice.gain.gain.setTargetAtTime(0, now, 0.4);
        return;
      }
      const distance = Math.hypot(engine.x - listener.x, engine.z - listener.z);
      if (voice.panner.positionX) {
        voice.panner.positionX.setTargetAtTime(engine.x, now, 0.1);
        voice.panner.positionY.setTargetAtTime(engine.y, now, 0.1);
        voice.panner.positionZ.setTargetAtTime(engine.z, now, 0.1);
      } else {
        voice.panner.setPosition(engine.x, engine.y, engine.z);
      }
      const run = Math.min(1, engine.speed / 17);
      voice.saw.frequency.setTargetAtTime(92 + run * 150, now, 0.3);
      voice.sub.frequency.setTargetAtTime(46 + run * 75, now, 0.3);
      voice.tone.frequency.setTargetAtTime(380 + run * 1600, now, 0.3);
      voice.wash.gain.setTargetAtTime(0.25 + run * 0.9, now, 0.3);
      const reach = Math.pow(Math.max(0, 1 - distance / 1300), 1.6);
      voice.gain.gain.setTargetAtTime(reach * (0.05 + run * 0.12), now, 0.3);
    });
  }

  /** The winch's ratchet while it hauls (`delta` seconds of hauling this frame). */
  winch(delta: number, at: Point): void {
    this.winchClock -= delta;
    if (this.winchClock > 0) return;
    this.winchClock = 0.085;
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const now = context.currentTime + 0.005;
    const panner = this.panner(context, at);
    panner.refDistance = 4;
    panner.connect(master);
    this.burstOfNoise(context, panner, now, 0.02, 0.35, "bandpass", 2400 + Math.random() * 600, 5);
    window.setTimeout(() => panner.disconnect(), 300);
  }

  /** The squelch of a radio call opening (`broadcast`: the network's two-tone chime instead). */
  radio(kind: "radio" | "broadcast"): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, music } = mixer;
    const now = context.currentTime + 0.01;
    if (kind === "broadcast") {
      for (const [index, pitch] of [880, 659.25, 880].entries()) {
        const osc = context.createOscillator();
        osc.type = "sine";
        osc.frequency.value = pitch;
        const gain = context.createGain();
        const at = now + index * 0.28;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
        osc.connect(gain).connect(music);
        osc.start(at);
        osc.stop(at + 0.3);
      }
      return;
    }
    this.audio.radioStatic();
  }

  /**
   * The story's sounds: the shortwave's hiss and flutter under a forecast, a
   * rifle bolt worked close behind him, the crash of a hull driven onto
   * rock, water flooding in, a breaker on the shoal, a mast cracking and
   * coming down.
   */
  story(sound: "radio-noise" | "click" | "crash" | "flooding" | "surf" | "mast" | "outboard" | "jeeps"): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master, music } = mixer;
    const now = context.currentTime + 0.01;
    const out = context.createGain();
    out.gain.value = 1;
    out.connect(sound === "radio-noise" ? music : master);
    const length = { "radio-noise": 9, click: 0.6, crash: 3.5, flooding: 6, surf: 4, mast: 3.2, outboard: 4.5, jeeps: 10 }[sound];
    if (sound === "radio-noise") {
      // Shortwave: a band of hiss, fluttering with the fading.
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer(context);
      source.loop = true;
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1800;
      band.Q.value = 0.7;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.4);
      const flutter = context.createOscillator();
      flutter.frequency.value = 5.5;
      const depth = context.createGain();
      depth.gain.value = 0.025;
      flutter.connect(depth).connect(gain.gain);
      gain.gain.setValueAtTime(0.05, now + length - 1.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
      source.connect(band).connect(gain).connect(out);
      source.start(now);
      source.stop(now + length);
      flutter.start(now);
      flutter.stop(now + length);
    } else if (sound === "click") {
      // A bolt: back, a beat, home.
      this.burstOfNoise(context, out, now, 0.03, 0.55, "bandpass", 2600, 3);
      this.thump(context, out, now, 420, 0.04, 0.25);
      this.burstOfNoise(context, out, now + 0.16, 0.035, 0.7, "bandpass", 3100, 3);
      this.thump(context, out, now + 0.16, 380, 0.05, 0.3);
    } else if (sound === "crash") {
      this.thump(context, out, now, 48, 1.1, 1.4);
      this.burstOfNoise(context, out, now, 1.6, 1.3, "lowpass", 900, 0.6, 0.7);
      for (let index = 0; index < 9; index += 1) {
        const at = now + 0.05 + Math.random() * 1.2;
        this.burstOfNoise(context, out, at, 0.08 + Math.random() * 0.1, 0.5 + Math.random() * 0.4, "bandpass", 500 + Math.random() * 1800, 2);
      }
    } else if (sound === "flooding") {
      // Rushing water, swelling, with gulps.
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer(context);
      source.loop = true;
      const low = context.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.setValueAtTime(400, now);
      low.frequency.linearRampToValueAtTime(1300, now + 2.5);
      low.frequency.linearRampToValueAtTime(250, now + length);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.7, now + 1.5);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
      source.connect(low).connect(gain).connect(out);
      source.start(now);
      source.stop(now + length);
      for (let index = 0; index < 10; index += 1) this.thump(context, out, now + 0.6 + index * 0.45 + Math.random() * 0.2, 90 + Math.random() * 60, 0.18, 0.35);
    } else if (sound === "outboard") {
      // A pull-start: the cord, a cough, a catch, the motor settling into a rattle.
      this.burstOfNoise(context, out, now, 0.35, 0.25, "bandpass", 900, 1.5);
      this.thump(context, out, now + 0.5, 70, 0.12, 0.5);
      this.thump(context, out, now + 0.72, 64, 0.1, 0.4);
      const motor = context.createOscillator();
      motor.type = "sawtooth";
      motor.frequency.setValueAtTime(28, now + 0.9);
      motor.frequency.linearRampToValueAtTime(64, now + 1.5);
      motor.frequency.linearRampToValueAtTime(46, now + length);
      const low = context.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 520;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 1.2);
      gain.gain.setValueAtTime(0.22, now + length - 1);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
      motor.connect(low).connect(gain).connect(out);
      motor.start(now + 0.9);
      motor.stop(now + length);
    } else if (sound === "jeeps") {
      // Two engines coming up the road and pulling in, gravel under the tyres.
      for (const [offset, pitch] of [
        [0, 38],
        [1.6, 44],
      ] as const) {
        const engine = context.createOscillator();
        engine.type = "sawtooth";
        engine.frequency.setValueAtTime(pitch, now + offset);
        engine.frequency.linearRampToValueAtTime(pitch * 1.5, now + offset + 4);
        engine.frequency.linearRampToValueAtTime(pitch * 0.8, now + offset + 8);
        const low = context.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.value = 380;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 3.5);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 8.4);
        engine.connect(low).connect(gain).connect(out);
        engine.start(now + offset);
        engine.stop(now + offset + 8.5);
      }
      this.burstOfNoise(context, out, now + 6.5, 1.8, 0.2, "bandpass", 1400, 0.7);
    } else if (sound === "surf") {
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer(context);
      source.loop = true;
      const low = context.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.setValueAtTime(2500, now);
      low.frequency.exponentialRampToValueAtTime(500, now + length);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.5, now + 0.35);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
      source.connect(low).connect(gain).connect(out);
      source.start(now);
      source.stop(now + length);
    } else {
      // The crack, the creak of it going, the fall onto the deck.
      this.burstOfNoise(context, out, now, 0.09, 1.2, "highpass", 1800, 0.7, 1.6);
      this.thump(context, out, now, 140, 0.15, 0.8);
      const creak = context.createOscillator();
      creak.type = "sawtooth";
      creak.frequency.setValueAtTime(240, now + 0.2);
      creak.frequency.exponentialRampToValueAtTime(70, now + 1.6);
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 600;
      band.Q.value = 4;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.7);
      creak.connect(band).connect(gain).connect(out);
      creak.start(now + 0.2);
      creak.stop(now + 1.8);
      this.thump(context, out, now + 1.75, 70, 0.6, 1.1);
      this.burstOfNoise(context, out, now + 1.75, 0.5, 0.6, "lowpass", 1200, 0.6);
    }
    window.setTimeout(() => out.disconnect(), (length + 0.5) * 1000);
  }

  private ambience: { gain: GainNode; birds: number; nodes: AudioScheduledSourceNode[] } | null = null;

  /**
   * The island's summer ashore (M01): cicadas in a dense shimmer and birds
   * now and then, falling silent for a few seconds after a gunshot. `level`
   * 0…1 (0: none, the sound faded out).
   */
  setAmbience(level: number, delta: number, hush: number): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    if (!this.ambience && level > 0.01) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(master);
      const nodes: AudioScheduledSourceNode[] = [];
      // Cicadas: a band of hiss around 5 kHz, pulsing fast and swelling slowly.
      for (const [frequency, rate] of [
        [4800, 38],
        [6300, 46],
      ] as const) {
        const source = context.createBufferSource();
        source.buffer = this.noiseBuffer(context);
        source.loop = true;
        const band = context.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = frequency;
        band.Q.value = 6;
        const pulse = context.createGain();
        pulse.gain.value = 0.02;
        const lfo = context.createOscillator();
        lfo.frequency.value = rate;
        const depth = context.createGain();
        depth.gain.value = 0.018;
        lfo.connect(depth).connect(pulse.gain);
        source.connect(band).connect(pulse).connect(gain);
        source.start();
        lfo.start();
        nodes.push(source, lfo);
      }
      this.ambience = { gain, birds: 2, nodes };
    }
    const ambience = this.ambience;
    if (!ambience) return;
    const target = level * (1 - hush);
    ambience.gain.gain.setTargetAtTime(target, context.currentTime, 0.8);
    // A bird now and then: a few quick falling whistles.
    ambience.birds -= delta;
    if (ambience.birds <= 0 && target > 0.05) {
      ambience.birds = 3 + Math.random() * 7;
      const start = context.currentTime + 0.02;
      const notes = 2 + Math.floor(Math.random() * 4);
      const base = 2200 + Math.random() * 1800;
      for (let index = 0; index < notes; index += 1) {
        const at = start + index * (0.09 + Math.random() * 0.05);
        const osc = context.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(base * (1.1 + Math.random() * 0.2), at);
        osc.frequency.exponentialRampToValueAtTime(base * 0.8, at + 0.07);
        const tone = context.createGain();
        tone.gain.setValueAtTime(0.0001, at);
        tone.gain.exponentialRampToValueAtTime(0.05 * target + 0.0002, at + 0.012);
        tone.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
        osc.connect(tone).connect(master);
        osc.start(at);
        osc.stop(at + 0.1);
      }
    }
    if (level <= 0.01 && ambience.gain.gain.value < 0.001) {
      for (const node of ambience.nodes) node.stop();
      ambience.gain.disconnect();
      this.ambience = null;
    }
  }

  /** A short warning cue the moment a drone has her (the interface's own sound, not a sound of the world). */
  spotted(): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, music } = mixer;
    const now = context.currentTime + 0.01;
    for (const [index, pitch] of [620, 930].entries()) {
      const osc = context.createOscillator();
      osc.type = "square";
      osc.frequency.value = pitch;
      const tone = context.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 2200;
      const gain = context.createGain();
      const at = now + index * 0.12;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.05, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
      osc.connect(tone).connect(gain).connect(music);
      osc.start(at);
      osc.stop(at + 0.12);
    }
  }

  dispose(): void {
    for (const voice of this.voices) {
      try {
        voice.saw.stop();
        voice.sub.stop();
        voice.noise.stop();
      } catch {
        // Already stopped with its context.
      }
      voice.panner.disconnect();
    }
    this.voices = [];
  }
}
