import { clamp } from "../math";
import { boatSoundLevels, sailFillCrack, type BoatSoundState } from "./BoatSoundMath";

type NoiseFactory = (duration: number, color: "brown" | "pink" | "white") => AudioBuffer;

/** The shrouds' whistle sits well under the water (about −8 dB from the original mix). */
export const RIGGING_LEVEL = 0.4;

/**
 * The yacht's own voices, layered (levels from `boatSoundLevels`):
 *
 * - **slap**: irregular slaps and gurgles of water against the hulls, the
 *   sound of a boat at rest; each slap is a short, low burst at a random
 *   moment;
 * - **rush**: the bow wave, a continuous broadband rush whose top end opens
 *   with speed;
 * - **spray**: above 6–8 knots, hissing bursts as the bows throw water;
 * - **rigging**: the shrouds humming and whistling in a breeze;
 * - **flog**: the sail cracking and rattling while it luffs, and one loud
 *   crack when it fills on the new tack;
 * - **winch**: the ratchet clicking while the sheet comes in, and the soft
 *   zip of an eased sheet;
 * - the yacht's air horn and the ship's bell, on request.
 */
export class BoatVoices {
  private readonly slapBuffer: AudioBuffer;
  private readonly sprayBuffer: AudioBuffer;
  private readonly rushGain: GainNode;
  private readonly rushTone: BiquadFilterNode;
  private readonly riggingGain: GainNode;
  private readonly riggingBands: BiquadFilterNode[] = [];
  private readonly flogGain: GainNode;
  private readonly flogRate: OscillatorNode;
  private readonly slipGain: GainNode;
  private slapClock = 0.3;
  private sprayClock = 0.5;
  private clickClock = 0;
  private peakLuff = 0;
  private peakLuffAge = 0;
  private crackCooldown = 0;
  private lastLevels = boatSoundLevels({ knots: 0, waves: 1, apparentWind: 8, gust: 0, gustApproaching: 0, luff: 0, trimRate: 0 });

  constructor(
    private readonly context: AudioContext,
    private readonly bus: AudioNode,
    noise: NoiseFactory,
  ) {
    this.slapBuffer = noise(2.3, "brown");
    this.sprayBuffer = noise(2.1, "white");

    // The bow wave: pink noise, high-passed so it never booms, low-passed by speed.
    const rush = context.createBufferSource();
    rush.buffer = noise(4.7, "pink");
    rush.loop = true;
    const rushHigh = context.createBiquadFilter();
    rushHigh.type = "highpass";
    rushHigh.frequency.value = 260;
    this.rushTone = context.createBiquadFilter();
    this.rushTone.type = "lowpass";
    this.rushTone.frequency.value = 900;
    this.rushTone.Q.value = 0.5;
    this.rushGain = context.createGain();
    this.rushGain.gain.value = 0;
    rush.connect(rushHigh).connect(this.rushTone).connect(this.rushGain).connect(bus);
    rush.start(0, 0.6);

    // The rigging: narrow resonances of the shrouds, slowly wavering.
    const air = context.createBufferSource();
    air.buffer = noise(3.1, "white");
    air.loop = true;
    this.riggingGain = context.createGain();
    this.riggingGain.gain.value = 0;
    for (const [ratio, level] of [[1, 1], [1.51, 0.6], [2.03, 0.35]] as const) {
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 600 * ratio;
      band.Q.value = 26;
      const bandGain = context.createGain();
      bandGain.gain.value = level;
      air.connect(band).connect(bandGain).connect(this.riggingGain);
      this.riggingBands.push(band);
    }
    this.riggingGain.connect(bus);
    air.start(0, 0.2);

    // The sail flogging: canvas noise chopped by a fast, uneven flap.
    const canvas = context.createBufferSource();
    canvas.buffer = noise(2.7, "pink");
    canvas.loop = true;
    const canvasBand = context.createBiquadFilter();
    canvasBand.type = "bandpass";
    canvasBand.frequency.value = 520;
    canvasBand.Q.value = 0.7;
    const chopper = context.createGain();
    chopper.gain.value = 0.5;
    this.flogRate = context.createOscillator();
    this.flogRate.type = "square";
    this.flogRate.frequency.value = 5;
    const flogDepth = context.createGain();
    flogDepth.gain.value = 0.5;
    this.flogRate.connect(flogDepth).connect(chopper.gain);
    this.flogRate.start();
    this.flogGain = context.createGain();
    this.flogGain.gain.value = 0;
    canvas.connect(canvasBand).connect(chopper).connect(this.flogGain).connect(bus);
    canvas.start(0, 1.1);

    // An eased sheet zipping round the winch drum.
    const slip = context.createBufferSource();
    slip.buffer = noise(1.9, "white");
    slip.loop = true;
    const slipBand = context.createBiquadFilter();
    slipBand.type = "bandpass";
    slipBand.frequency.value = 2400;
    slipBand.Q.value = 1.4;
    this.slipGain = context.createGain();
    this.slipGain.gain.value = 0;
    slip.connect(slipBand).connect(this.slipGain).connect(bus);
    slip.start(0, 0.4);
  }

  update(step: number, state: BoatSoundState): void {
    const context = this.context;
    const now = context.currentTime;
    const levels = boatSoundLevels(state);
    this.lastLevels = levels;
    this.rushGain.gain.setTargetAtTime(levels.rush * 0.34, now, 0.35);
    this.rushTone.frequency.setTargetAtTime(levels.rushTone, now, 0.5);
    this.riggingGain.gain.setTargetAtTime(levels.rigging * 0.05 * RIGGING_LEVEL, now, 0.8);
    this.riggingBands.forEach((band, index) =>
      band.frequency.setTargetAtTime(levels.riggingPitch * [1, 1.51, 2.03][index]!, now, 1.2),
    );
    this.flogGain.gain.setTargetAtTime(levels.flog * 0.2, now, 0.08);
    this.flogRate.frequency.setTargetAtTime(levels.flogRate * (0.85 + Math.random() * 0.3), now, 0.1);
    this.slipGain.gain.setTargetAtTime(levels.sheetSlip * 0.05, now, 0.06);

    // Slaps at random moments, more of them in a lop.
    this.slapClock -= step;
    while (this.slapClock <= 0) {
      this.slap(levels.slap * (0.5 + Math.random() * 0.6), now + Math.random() * 0.05);
      this.slapClock += (0.35 + Math.random() * 1.3) / Math.max(0.3, levels.slapRate);
    }
    // Spray bursts as she meets the waves at speed.
    if (levels.spray > 0.01) {
      this.sprayClock -= step;
      while (this.sprayClock <= 0) {
        this.spray(levels.spray * (0.6 + Math.random() * 0.5), now + Math.random() * 0.05);
        this.sprayClock += (0.25 + Math.random() * 0.9) / Math.max(0.3, levels.sprayRate);
      }
    }
    // Winch ratchet while trimming in.
    if (levels.winchClicks > 0) {
      this.clickClock -= step;
      while (this.clickClock <= 0) {
        this.click(now + Math.random() * 0.01);
        this.clickClock += 1 / levels.winchClicks;
      }
    } else {
      this.clickClock = 0;
    }
    // The sail cracks full on the new tack.
    this.peakLuffAge += step;
    if (state.luff > this.peakLuff || this.peakLuffAge > 2.5) {
      this.peakLuff = state.luff;
      this.peakLuffAge = 0;
    }
    this.crackCooldown = Math.max(0, this.crackCooldown - step);
    const crack = sailFillCrack(this.peakLuff, state.luff, state.apparentWind);
    if (crack > 0 && this.crackCooldown <= 0) {
      this.sailCrack(crack, now);
      this.crackCooldown = 3;
      this.peakLuff = 0;
    }
  }

  /** Current levels (for diagnostics and tests in the browser). */
  get levels(): Readonly<ReturnType<typeof boatSoundLevels>> {
    return this.lastLevels;
  }

  /** The yacht's air horn: a short two-tone blast. */
  airHorn(): void {
    const context = this.context;
    const start = context.currentTime + 0.01;
    const length = 1.25;
    const output = context.createGain();
    output.gain.setValueAtTime(0.0001, start);
    output.gain.exponentialRampToValueAtTime(0.32, start + 0.04);
    output.gain.setValueAtTime(0.32, start + length - 0.12);
    output.gain.exponentialRampToValueAtTime(0.0001, start + length);
    const tone = context.createBiquadFilter();
    tone.type = "bandpass";
    tone.frequency.value = 900;
    tone.Q.value = 0.7;
    const body = context.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.value = 3200;
    tone.connect(body).connect(output).connect(this.bus);
    for (const frequency of [415, 523]) {
      const reed = context.createOscillator();
      reed.type = "sawtooth";
      reed.frequency.setValueAtTime(frequency * 0.97, start);
      reed.frequency.exponentialRampToValueAtTime(frequency, start + 0.08);
      const level = context.createGain();
      level.gain.value = 0.5;
      reed.connect(level).connect(tone);
      reed.start(start);
      reed.stop(start + length + 0.05);
    }
  }

  /** The ship's bell: two strokes, a bronze tone with its inharmonic partials. */
  bell(): void {
    const context = this.context;
    const base = 740;
    for (const offset of [0, 0.42]) {
      const start = context.currentTime + 0.01 + offset;
      const output = context.createGain();
      output.gain.value = 1;
      output.connect(this.bus);
      for (const [ratio, level, decay] of [[1, 0.26, 3.4], [2.76, 0.12, 1.9], [5.4, 0.06, 0.9], [8.93, 0.03, 0.45], [0.5, 0.05, 4.2]] as const) {
        const partial = context.createOscillator();
        partial.type = "sine";
        partial.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.002);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(level, start + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
        partial.connect(gain).connect(output);
        partial.start(start);
        partial.stop(start + decay + 0.05);
      }
      // The clapper's strike.
      this.burst(this.sprayBuffer, start, 0.03, 0.05, "bandpass", 3200, 2);
    }
  }

  /** A flare leaving its launcher: a pop and a rising hiss. */
  flareLaunch(): void {
    const start = this.context.currentTime + 0.01;
    this.burst(this.slapBuffer, start, 0.12, 0.35, "lowpass", 900, 0.7);
    this.burst(this.sprayBuffer, start + 0.02, 1.4, 0.07, "bandpass", 2600, 1.2, 4200);
    // High overhead, the star ejecting: a small, distant crack.
    this.burst(this.slapBuffer, start + 2.3, 0.18, 0.09, "bandpass", 1500, 0.9);
  }

  /** A pick-up from the water: a bright little chime. */
  chime(): void {
    const context = this.context;
    const start = context.currentTime + 0.01;
    [880, 1318.5, 1760].forEach((frequency, index) => {
      const tone = context.createOscillator();
      tone.type = "triangle";
      tone.frequency.value = frequency;
      const gain = context.createGain();
      const at = start + index * 0.07;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
      tone.connect(gain).connect(this.bus);
      tone.start(at);
      tone.stop(at + 0.65);
    });
  }

  private slap(level: number, at: number): void {
    if (level < 0.01) return;
    // A low, hollow knock and the water's gurgle after it.
    this.burst(this.slapBuffer, at, 0.09 + Math.random() * 0.12, 0.42 * level, "bandpass", 260 + Math.random() * 220, 1.6);
    this.burst(this.slapBuffer, at + 0.03, 0.25 + Math.random() * 0.2, 0.12 * level, "bandpass", 700 + Math.random() * 500, 2.4);
  }

  private spray(level: number, at: number): void {
    this.burst(this.sprayBuffer, at, 0.35 + Math.random() * 0.45, 0.16 * level, "bandpass", 3000 + Math.random() * 2500, 0.7);
    this.burst(this.slapBuffer, at, 0.22, 0.2 * level, "lowpass", 600, 0.7);
  }

  private click(at: number): void {
    // The pawl dropping onto the ratchet: a tiny metallic tick.
    this.burst(this.sprayBuffer, at, 0.018, 0.09, "bandpass", 4200 + Math.random() * 600, 7);
    this.burst(this.slapBuffer, at, 0.03, 0.05, "bandpass", 1300, 4);
  }

  private sailCrack(strength: number, at: number): void {
    this.burst(this.slapBuffer, at, 0.18, 0.55 * strength, "lowpass", 260, 0.8);
    this.burst(this.sprayBuffer, at, 0.08, 0.2 * strength, "bandpass", 1400, 0.9);
  }

  private burst(
    buffer: AudioBuffer,
    at: number,
    length: number,
    level: number,
    type: BiquadFilterType,
    frequency: number,
    q: number,
    sweepTo?: number,
  ): void {
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, clamp(level, 0, 2)), at + Math.min(0.012, length * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain).connect(this.bus);
    source.start(at, Math.random() * Math.max(0, buffer.duration - length - 0.05));
    source.stop(at + length + 0.05);
  }
}
