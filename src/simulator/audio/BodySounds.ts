/**
 * The sounds of the skipper's own body moving through the world, synthesised
 * from noise and a few oscillators (no samples to load):
 *
 * - **footsteps**, by what is underfoot: the soft crunch of dry sand (a
 *   granular hiss of grains over a dull thud, heel then toe), the dull, soft
 *   give of wet sand, the swish of grass, the hollow knock of pier planks (now and
 *   then a creak), the gritty click of volcanic rock, bare feet on the deck;
 * - **wading**: the slosh of a shin pushed through the water and the drops
 *   falling back;
 * - **swimming** at the surface: each arm entering the water (a bright plunge
 *   and the rising "bloop" of the bubbles it drags down), the pull (a low
 *   swoosh) and the drops falling from the recovering arm; sprinting, more
 *   vigorous, with the churn of the kick. Under the water, the muffled push
 *   of each fin kick;
 * - **leaves**: a walker pushing through a bush.
 *
 * Every sound is varied a little each time (pitch, level, timing), so a
 * walk never sounds like a loop.
 */

import { SampleBank, type SampleGroup } from "./SampleBank";

export type FootSurface = "sand" | "wetSand" | "grass" | "wood" | "rock" | "deck";

/** How loud a footstep is beside what it was recorded and synthesised at. */
const FOOT_LEVEL = 0.5;

/** The recorded footsteps of each surface (see `SampleBank`). */
const FOOT_SAMPLES: Record<FootSurface, SampleGroup> = {
  sand: "ground",
  wetSand: "ground",
  grass: "ground",
  wood: "woodStep",
  rock: "ground",
  deck: "woodStep",
};

type Envelope = { attack: number; decay: number; peak: number };

/** 0 a film of water at the edge … 1 knee-deep: how much of the full slosh a step in `depth` m of water has. */
export function wadeDepthMix(depth: number): number {
  const t = Math.min(1, Math.max(0, (depth - 0.06) / (0.45 - 0.06)));
  return t * t * (3 - 2 * t);
}

/**
 * How the recorded wading step is played at `deep` (0…1, `wadeDepthMix`):
 * its level, how much of its length, and the low-pass over it (null: none,
 * the recording as it is, from about knee-deep).
 */
export function wadeTone(deep: number): { gain: number; length: number; lowpass: number | null } {
  const d = Math.min(1, Math.max(0, deep));
  return {
    gain: 0.13 + 0.39 * d,
    length: 0.42 + 0.58 * d,
    lowpass: d > 0.92 ? null : 1300 + 5600 * d * d,
  };
}

export class BodySounds {
  private readonly white: AudioBuffer;
  private readonly brown: AudioBuffer;
  /** Sparse clicks: a grain hitting a grain (sand, gravel), at two densities. */
  private readonly grains: AudioBuffer;
  private readonly gravel: AudioBuffer;
  /** Fluttering leaf noise. */
  private readonly leaves: AudioBuffer;
  private lastFoot = 0;
  /** Recorded takes, preferred over the synthesis once loaded. */
  readonly samples: SampleBank;

  constructor(
    private readonly context: AudioContext,
    private readonly output: AudioNode,
    /** Heard inside the mask, past the water's muffling (his own plunge and bubbles). */
    private readonly inner: AudioNode = output,
  ) {
    this.samples = new SampleBank(context, output);
    this.samples.load();
    this.white = this.buffer(1.2, () => Math.random() * 2 - 1);
    let brown = 0;
    this.brown = this.buffer(1.2, () => {
      brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      return brown * 3.2;
    });
    this.grains = this.grainBuffer(0.5, 1400, 0.00035);
    this.gravel = this.grainBuffer(0.5, 520, 0.0009);
    let flutter = 0;
    let flutterTarget = 0;
    this.leaves = this.buffer(1.5, (index) => {
      // Leaves brushing: noise whose level jumps every few milliseconds.
      if (index % 90 === 0) flutterTarget = Math.random() < 0.35 ? Math.random() : Math.random() * 0.25;
      flutter += (flutterTarget - flutter) * 0.08;
      return (Math.random() * 2 - 1) * flutter;
    });
  }

  private buffer(seconds: number, sample: (index: number) => number): AudioBuffer {
    const length = Math.ceil(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = sample(index);
    return buffer;
  }

  /** Random clicks, `rate` a second, each a decaying impulse of `width` seconds. */
  private grainBuffer(seconds: number, rate: number, width: number): AudioBuffer {
    const rateSamples = this.context.sampleRate;
    const length = Math.ceil(rateSamples * seconds);
    const data = new Float32Array(length);
    const decay = Math.exp(-1 / Math.max(1, width * rateSamples));
    const count = Math.round(rate * seconds);
    for (let grain = 0; grain < count; grain += 1) {
      const start = Math.floor(Math.random() * length);
      let amplitude = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.75) ** 2;
      for (let index = start; index < length && Math.abs(amplitude) > 0.002; index += 1) {
        data[index] += amplitude * (Math.random() * 0.6 + 0.4);
        amplitude *= decay;
      }
    }
    const buffer = this.context.createBuffer(1, length, rateSamples);
    buffer.getChannelData(0).set(data);
    return buffer;
  }

  /** A burst of a buffer through a filter, shaped by an envelope, `delay` seconds from now. */
  private burst(
    source: AudioBuffer,
    filter: BiquadFilterType,
    frequency: number,
    q: number,
    envelope: Envelope,
    delay = 0,
    output: AudioNode = this.output,
    sweepTo?: number,
  ): void {
    const context = this.context;
    const now = context.currentTime + delay;
    const node = context.createBufferSource();
    node.buffer = source;
    node.playbackRate.value = 0.9 + Math.random() * 0.2;
    const shape = context.createBiquadFilter();
    shape.type = filter;
    shape.frequency.setValueAtTime(frequency, now);
    if (sweepTo !== undefined) shape.frequency.exponentialRampToValueAtTime(sweepTo, now + envelope.attack + envelope.decay);
    shape.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, envelope.peak), now + envelope.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + envelope.attack + envelope.decay);
    node.connect(shape).connect(gain).connect(output);
    const length = envelope.attack + envelope.decay + 0.02;
    node.start(now, Math.random() * Math.max(0, source.duration - length - 0.01));
    node.stop(now + length);
    node.onended = () => gain.disconnect();
  }

  /** A pitched blip: a sine from `from` to `to` Hz (a bubble's rising "bloop", a drop's "plink"). */
  private tone(from: number, to: number, peak: number, attack: number, decay: number, delay = 0, type: OscillatorType = "sine"): void {
    const context = this.context;
    const now = context.currentTime + delay;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + attack + decay);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    oscillator.connect(gain).connect(this.output);
    oscillator.start(now);
    oscillator.stop(now + attack + decay + 0.02);
    oscillator.onended = () => gain.disconnect();
  }

  /** A body thud: the weight landing (heel strike). */
  private thud(level: number, cutoff: number, delay = 0): void {
    this.burst(this.brown, "lowpass", cutoff, 0.7, { attack: 0.006, decay: 0.09 + Math.random() * 0.03, peak: level }, delay);
  }

  /** One footstep on `surface`; `running` steps are harder and quicker. */
  footstep(surface: FootSurface, running: boolean): void {
    const now = this.context.currentTime;
    // Two steps can never overlap into one (a landing right after a step).
    if (now - this.lastFoot < 0.06) return;
    this.lastFoot = now;
    // Footsteps sit well under the sea and the voices: heard, never in the way.
    const force = FOOT_LEVEL * (running ? 1.45 : 1) * (0.85 + Math.random() * 0.3);
    // Heel then the roll onto the toe, a few hundredths of a second apart.
    const roll = (running ? 0.045 : 0.075) * (0.85 + Math.random() * 0.3);
    if (this.recordedStep(surface, running, force, roll)) return;
    switch (surface) {
      case "sand": {
        this.thud(0.09 * force, 220);
        // Dry grains squeezed and scattered: a crunching hiss, heel and toe.
        this.burst(this.grains, "bandpass", 2600 + Math.random() * 900, 0.7, { attack: 0.012, decay: 0.12, peak: 0.16 * force });
        this.burst(this.grains, "bandpass", 3400 + Math.random() * 900, 0.8, { attack: 0.01, decay: 0.09, peak: 0.11 * force }, roll);
        this.burst(this.white, "highpass", 5000, 0.5, { attack: 0.01, decay: 0.07, peak: 0.012 * force }, roll * 0.5);
        break;
      }
      case "wetSand": {
        // Packed and wet: a dull footfall and the soft give of the sand (no
        // loose grains, no ringing drops: by the water nothing clicks).
        this.thud(0.12 * force, 240);
        this.squelch(force, roll);
        break;
      }
      case "grass": {
        this.thud(0.075 * force, 190);
        // Blades swished aside and pressed down: a soft, airy rustle with a little crackle.
        this.burst(this.leaves, "bandpass", 4200 + Math.random() * 1200, 0.6, { attack: 0.02, decay: 0.16, peak: 0.13 * force });
        this.burst(this.white, "highpass", 3000, 0.5, { attack: 0.015, decay: 0.1, peak: 0.02 * force }, roll * 0.6);
        this.burst(this.grains, "bandpass", 2200, 0.8, { attack: 0.01, decay: 0.05, peak: 0.03 * force }, roll);
        break;
      }
      case "wood": {
        // Planks over air: a hollow knock that rings a moment, and the click of the heel.
        this.tone(118 + Math.random() * 25, 82, 0.14 * force, 0.004, 0.14);
        this.burst(this.white, "bandpass", 230 + Math.random() * 60, 7, { attack: 0.003, decay: 0.2, peak: 0.25 * force });
        this.burst(this.white, "bandpass", 620 + Math.random() * 120, 5, { attack: 0.003, decay: 0.08, peak: 0.08 * force }, roll * 0.4);
        this.burst(this.white, "highpass", 2800, 0.7, { attack: 0.002, decay: 0.012, peak: 0.05 * force });
        this.tone(140, 100, 0.05 * force, 0.004, 0.09, roll);
        if (Math.random() < 0.18) {
          // A plank creaking under the weight.
          const context = this.context;
          const start = context.currentTime + roll;
          const saw = context.createOscillator();
          saw.type = "sawtooth";
          saw.frequency.setValueAtTime(170 + Math.random() * 60, start);
          saw.frequency.linearRampToValueAtTime(130 + Math.random() * 40, start + 0.28);
          const band = context.createBiquadFilter();
          band.type = "bandpass";
          band.frequency.value = 900 + Math.random() * 400;
          band.Q.value = 6;
          const gain = context.createGain();
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.018, start + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
          saw.connect(band).connect(gain).connect(this.output);
          saw.start(start);
          saw.stop(start + 0.32);
          saw.onended = () => gain.disconnect();
        }
        break;
      }
      case "rock": {
        // Volcanic cinder and stone: a hard click and loose grit scraping.
        this.thud(0.07 * force, 300);
        this.burst(this.white, "bandpass", 2400 + Math.random() * 800, 1.6, { attack: 0.002, decay: 0.03, peak: 0.07 * force });
        this.burst(this.gravel, "bandpass", 3600 + Math.random() * 1200, 0.7, { attack: 0.008, decay: 0.13, peak: 0.2 * force }, roll * 0.5);
        this.burst(this.gravel, "bandpass", 1800, 0.9, { attack: 0.006, decay: 0.08, peak: 0.08 * force }, roll);
        break;
      }
      case "deck": {
        // Bare feet on teak and gelcoat: a soft, padded slap.
        this.thud(0.1 * force, 340);
        this.burst(this.white, "bandpass", 1300, 0.9, { attack: 0.003, decay: 0.035, peak: 0.025 * force });
        break;
      }
    }
  }

  /**
   * A recorded footstep (when the takes have loaded), with a little of the
   * synthesis laid under it where a surface has more to it than one take:
   * loose grains on dry sand, the hollow ring and the creak of pier planks.
   */
  private recordedStep(surface: FootSurface, running: boolean, force: number, roll: number): boolean {
    const samples = this.samples;
    const group = FOOT_SAMPLES[surface];
    if (!samples.has(group)) return false;
    const rate = running ? 1.07 : 1;
    // The recording of the step itself, a little differently on each ground:
    // soft and dull in sand, brighter on rock, damped on grass.
    switch (surface) {
      case "sand":
        samples.play("ground", { gain: 0.5 * force, rate: rate * 0.94, lowpass: 5200 });
        samples.play("sand", { gain: 0.1 * force, rate, delay: roll * 0.3 });
        break;
      case "wetSand":
        // Packed wet sand by the water: the footfall itself, duller and a
        // little lower than on dry ground, and the soft give of the sand
        // under it. Nothing bright: a crisp, crackling layer here sounded
        // like a walk over ice or broken glass.
        samples.play("ground", { gain: 0.46 * force, rate: rate * 0.9, lowpass: 2300 });
        this.squelch(force, roll);
        break;
      case "grass":
        samples.play("ground", { gain: 0.42 * force, rate: rate * 1.02, lowpass: 4200 });
        this.burst(this.grains, "bandpass", 2600 + Math.random() * 900, 0.6, { attack: 0.02, decay: 0.12, peak: 0.03 * force }, roll * 0.5);
        break;
      case "rock":
        samples.play("ground", { gain: 0.5 * force, rate: rate * 1.08, highpass: 140 });
        break;
      case "wood":
        samples.play("woodStep", { gain: 0.55 * force, rate });
        if (Math.random() < 0.1) this.creak(roll);
        break;
      case "deck":
        samples.play("woodStep", { gain: 0.38 * force, rate: rate * 1.05, lowpass: 3000 });
        break;
    }
    return true;
  }

  /**
   * Wet sand giving under a foot: a short, soft, low press (water squeezed
   * out of the sand and drawn back as the toe lifts). All of it under about
   * 1 kHz, with slow edges, so it is felt more than heard.
   */
  private squelch(force: number, roll: number): void {
    this.burst(this.brown, "lowpass", 520 + Math.random() * 120, 0.8, { attack: 0.02, decay: 0.1, peak: 0.075 * force });
    this.burst(this.white, "bandpass", 760 + Math.random() * 140, 1.1, { attack: 0.022, decay: 0.09, peak: 0.016 * force }, roll, this.output, 420);
  }

  /** A plank creaking under the weight. */
  private creak(delay: number): void {
    const context = this.context;
    const start = context.currentTime + delay;
    const saw = context.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(170 + Math.random() * 60, start);
    saw.frequency.linearRampToValueAtTime(130 + Math.random() * 40, start + 0.28);
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900 + Math.random() * 400;
    band.Q.value = 6;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.014, start + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    saw.connect(band).connect(gain).connect(this.output);
    saw.start(start);
    saw.stop(start + 0.32);
    saw.onended = () => gain.disconnect();
  }

  /**
   * Going under: the rush of water closing over the head, the ears filling,
   * and a cloud of bubbles streaming up past the mask. `speed` m/s downward.
   */
  submerge(speed: number): void {
    const force = Math.min(1.4, 0.55 + speed * 0.35);
    if (!this.samples.play("plunge", { gain: 0.55 * force, rate: 0.82, lowpass: 1600, output: this.inner })) {
      this.burst(this.brown, "lowpass", 420, 0.8, { attack: 0.03, decay: 0.5, peak: 0.2 * force }, 0, this.inner);
    }
    this.samples.play("bubblesRush", { gain: 0.5 * force, rate: 1.05, lowpass: 3200, output: this.inner, length: 1.8 });
    for (let index = 0; index < 3; index += 1) {
      if (!this.samples.play("bubble", { gain: 0.32 * force, rate: 0.9 + index * 0.18, delay: 0.08 + index * 0.17 + Math.random() * 0.08, output: this.inner, lowpass: 2600 })) {
        const pitch = 300 + Math.random() * 500;
        this.tone(pitch, pitch * 1.7, 0.05 * force, 0.004, 0.08, 0.05 + index * 0.12);
      }
    }
    // The pressure in the ears: a deep, short swell.
    this.burst(this.brown, "lowpass", 140, 0.7, { attack: 0.08, decay: 0.6, peak: 0.12 * force }, 0.02, this.inner);
  }

  /** Breaking the surface: the water streaming off the head, drops falling round. */
  emerge(): void {
    if (!this.samples.play("stroke", { gain: 0.32, rate: 0.85, length: 0.6 })) {
      this.burst(this.white, "bandpass", 900, 0.8, { attack: 0.02, decay: 0.3, peak: 0.08 });
    }
    this.drops(7, 0.7, 0.018, 0.12);
  }

  /** His breath out under water, as bubbles past the ears (recorded takes; false if not loaded). */
  breathBubbles(depth: number): boolean {
    if (!this.samples.has("bubble")) return false;
    const deep = Math.min(1, depth / 20);
    this.samples.play("bubblesRush", { gain: 0.28, rate: 1.15 - deep * 0.15, lowpass: 3000 - deep * 900, output: this.inner, length: 1.2 });
    this.samples.play("bubble", { gain: 0.22, rate: 1.1, delay: 0.15, output: this.inner, lowpass: 2600 });
    this.samples.play("bubble", { gain: 0.18, rate: 1.35, delay: 0.5, output: this.inner, lowpass: 2600 });
    return true;
  }

  /** A walker pushing through a bush: leaves brushing his legs. `depth` 0…1 how far in. */
  rustle(depth: number, running: boolean): void {
    const level = (0.08 + depth * 0.12) * (running ? 1.4 : 1);
    this.burst(this.leaves, "bandpass", 3200 + Math.random() * 1500, 0.5, { attack: 0.04, decay: 0.35 + Math.random() * 0.15, peak: level });
    this.burst(this.leaves, "highpass", 6000, 0.4, { attack: 0.03, decay: 0.25, peak: level * 0.4 }, 0.05);
    // A twig snapping now and then.
    if (Math.random() < 0.15) this.burst(this.white, "bandpass", 2200, 3, { attack: 0.001, decay: 0.02, peak: 0.06 }, 0.1 + Math.random() * 0.15);
  }

  /** Drops falling back into the water round the listener. */
  private drops(count: number, spread: number, level: number, delay = 0): void {
    for (let drop = 0; drop < count; drop += 1) {
      const at = delay + Math.random() * spread;
      const pitch = 1400 + Math.random() * 2600;
      // A drop: a short tick and the tiny bubble it traps, ringing upward.
      this.burst(this.white, "bandpass", pitch * 1.6, 2, { attack: 0.001, decay: 0.008, peak: level * 0.4 }, at);
      this.tone(pitch, pitch * (1.25 + Math.random() * 0.3), level * (0.4 + Math.random() * 0.6), 0.002, 0.02 + Math.random() * 0.025, at);
    }
  }

  /**
   * A step in the water; `depth` of the water at the foot, m. From a film
   * of water over the sand at the water's edge (the footfall on wet sand
   * and a small, soft lap of water, no sparkle at all) through ankle-deep
   * to a shin pushed through knee-deep water (the full slosh and the drops
   * falling back). The brightness comes in with the depth: at the edge the
   * recording is heard through a low-pass, short and quiet, because a full,
   * crisp splash at every step there crackled like ice underfoot.
   */
  wade(depth: number, running: boolean): void {
    const deep = wadeDepthMix(depth);
    const force = (running ? 1.4 : 1) * (0.85 + Math.random() * 0.3);
    // The foot still lands on sand while the water is shallow.
    if (deep < 0.85) {
      if (!this.samples.play("ground", { gain: 0.38 * force * (1 - deep), rate: 0.9, lowpass: 2200 })) this.thud(0.1 * force * (1 - deep), 240);
      if (deep < 0.3) this.squelch(force * (1 - deep), 0.06);
    }
    const tone = wadeTone(deep);
    if (
      this.samples.play("waterStep", {
        gain: tone.gain * force,
        rate: (running ? 1.08 : 1) * (0.93 + 0.07 * deep),
        length: (running ? 0.8 : 1.2) * tone.length,
        lowpass: tone.lowpass ?? undefined,
      })
    ) {
      return;
    }
    // The slosh: water shoved aside and closing again behind the leg.
    const level = 0.35 + 0.65 * deep;
    this.burst(this.white, "bandpass", 620 + Math.random() * 260, 0.9, { attack: 0.04, decay: 0.24, peak: 0.1 * force * level }, 0, this.output, 400);
    this.burst(this.brown, "lowpass", 380, 0.8, { attack: 0.05, decay: 0.3, peak: 0.12 * force * level });
    if (deep > 0.35) {
      this.burst(this.white, "highpass", 3500, 0.5, { attack: 0.02, decay: 0.12, peak: 0.02 * force * deep }, 0.03);
      // Bubbles dragged under and the drops thrown up falling back.
      this.tone(500 + Math.random() * 300, 800 + Math.random() * 300, 0.03 * force * deep, 0.004, 0.06, 0.05);
      this.drops(Math.round((3 + force * 3) * deep), 0.35, 0.025 * force * deep, 0.12);
    }
  }

  /** One arm stroke of the crawl at the surface (sprinting: harder, with the churn of the kick). */
  stroke(sprint: boolean): void {
    const force = (sprint ? 1.5 : 1) * (0.85 + Math.random() * 0.3);
    if (this.samples.play("swimStroke", { gain: 0.6 * force, rate: sprint ? 1.08 : 1, length: sprint ? 0.85 : 1.05 })) return;
    if (this.samples.has("stroke")) {
      this.samples.play("stroke", { gain: 0.5 * force, rate: sprint ? 1.08 : 1 });
      this.samples.play("stroke", { gain: 0.22 * force, rate: 0.78, delay: 0.24 + Math.random() * 0.06, lowpass: 2400 });
      this.drops(sprint ? 6 : 3, 0.4, 0.014 * force, 0.36);
      return;
    }
    // The hand going in: a short, bright plunge.
    this.burst(this.white, "bandpass", 1600 + Math.random() * 600, 1.1, { attack: 0.004, decay: 0.07, peak: 0.12 * force });
    // Air dragged down with it: two or three bubbles ringing upward.
    const bubbles = sprint ? 4 : 2 + Math.round(Math.random());
    for (let bubble = 0; bubble < bubbles; bubble += 1) {
      const pitch = 380 + Math.random() * 700;
      this.tone(pitch, pitch * (1.3 + Math.random() * 0.4), 0.05 * force, 0.004, 0.05 + Math.random() * 0.05, 0.015 + bubble * 0.025 + Math.random() * 0.02);
    }
    // The pull: water pushed back along the body, a low swoosh.
    this.burst(this.white, "lowpass", 900, 0.6, { attack: 0.09, decay: 0.3, peak: 0.07 * force }, 0.06, this.output, 380);
    this.burst(this.brown, "lowpass", 300, 0.7, { attack: 0.08, decay: 0.28, peak: 0.08 * force }, 0.08);
    // The arm coming out and over: drops falling from it.
    this.drops(sprint ? 8 : 4, 0.4, 0.02 * force, 0.32);
    if (sprint) {
      // The kick churning the water behind.
      for (let kick = 0; kick < 3; kick += 1) {
        this.burst(this.white, "bandpass", 500 + Math.random() * 250, 0.8, { attack: 0.02, decay: 0.12, peak: 0.05 }, 0.05 + kick * 0.16);
      }
    }
  }

  /** A fin kick under the water: a muffled, heavy push and a swirl. */
  kick(sprint: boolean): void {
    const force = (sprint ? 1.5 : 1) * (0.85 + Math.random() * 0.3);
    // The water swirled by the blade, heard through the water.
    this.samples.play("stroke", { gain: 0.2 * force, rate: 0.62, lowpass: 650 });
    this.burst(this.brown, "lowpass", 180, 0.8, { attack: 0.06, decay: 0.32, peak: 0.16 * force });
    this.burst(this.white, "lowpass", 520, 0.7, { attack: 0.08, decay: 0.4, peak: 0.035 * force }, 0.04, this.output, 260);
  }
}
