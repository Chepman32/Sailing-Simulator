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

  /** The skipper's own rifle, right by his ear. */
  rifle(): void {
    const mixer = this.ready();
    if (!mixer) return;
    const { context, master } = mixer;
    const now = context.currentTime + 0.005;
    const out = context.createGain();
    out.gain.value = 0.9;
    out.connect(master);
    out.connect(this.slapBack(context, master));
    this.burstOfNoise(context, out, now, 0.035, 0.9, "highpass", 1400, 0.7, 1.4);
    this.burstOfNoise(context, out, now, 0.16, 0.6, "lowpass", 900, 0.7, 0.8);
    this.thump(context, out, now, 95, 0.18, 0.7);
    // The bolt cycling a beat later.
    this.burstOfNoise(context, out, now + 0.32, 0.03, 0.08, "bandpass", 3200, 4);
    this.burstOfNoise(context, out, now + 0.41, 0.025, 0.07, "bandpass", 2600, 4);
    if (mixer.reverb) {
      const wet = context.createGain();
      wet.gain.value = 0.35;
      out.connect(wet).connect(mixer.reverb);
    }
    window.setTimeout(() => out.disconnect(), 1500);
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
