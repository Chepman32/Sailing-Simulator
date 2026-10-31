import { composeJig, drunkenSailor, HOUSE_BASS, HOUSE_CHORDS, HOUSE_TEMPO, midiToHz, type Tune } from "./MusicMath";

/**
 * Music synthesised in the browser, scheduled a little ahead of the audio
 * clock (never on the animation frame, so it does not stutter when the tab
 * is busy): the shanty band of the yacht radio — accordion, bass, stomps and
 * claps in a small wooden room — and the house groove of the party barge.
 */

const LOOKAHEAD = 0.25;
const TICK_MS = 60;

/** A short, warm room: decaying noise as an impulse response. */
export function createRoom(context: BaseAudioContext, seconds = 1.1, damping = 3.4): ConvolverNode {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let low = 0;
    for (let index = 0; index < length; index += 1) {
      const t = index / length;
      // Darker as it decays, as wood and air absorb the highs.
      low += (Math.random() * 2 - 1 - low) * (0.6 - t * 0.45);
      data[index] = low * Math.pow(1 - t, damping);
    }
  }
  const room = context.createConvolver();
  room.buffer = impulse;
  return room;
}

abstract class Sequenced {
  protected readonly output: GainNode;
  private timer = 0;
  protected nextTime = 0;
  protected step = 0;
  private running = false;

  constructor(protected readonly context: AudioContext, destination: AudioNode) {
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);
  }

  get playing(): boolean {
    return this.running;
  }

  start(level = 1): void {
    if (this.running) return;
    this.running = true;
    this.nextTime = this.context.currentTime + 0.08;
    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.setTargetAtTime(level, this.context.currentTime, 0.15);
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.clearInterval(this.timer);
    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.setTargetAtTime(0, this.context.currentTime, 0.12);
  }

  dispose(): void {
    this.stop();
    window.setTimeout(() => this.output.disconnect(), 600);
  }

  private schedule(): void {
    if (!this.running) return;
    // A suspended or stalled context: start again from now instead of
    // firing every missed note at once.
    if (this.nextTime < this.context.currentTime - 0.2) this.nextTime = this.context.currentTime + 0.05;
    while (this.nextTime < this.context.currentTime + LOOKAHEAD) {
      this.nextTime += this.play(this.nextTime);
    }
  }

  /** Plays what falls at `time`; returns the seconds until the next step. */
  protected abstract play(time: number): number;

  // --- Instruments -----------------------------------------------------------

  protected kick(time: number, level: number, low = 48, destination: AudioNode = this.output): void {
    const body = this.context.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(low * 2.6, time);
    body.frequency.exponentialRampToValueAtTime(low, time + 0.09);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
    body.connect(gain).connect(destination);
    body.start(time);
    body.stop(time + 0.35);
  }

  protected noiseHit(
    buffer: AudioBuffer,
    time: number,
    level: number,
    length: number,
    type: BiquadFilterType,
    frequency: number,
    q = 0.8,
    destination: AudioNode = this.output,
  ): void {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    source.connect(filter).connect(gain).connect(destination);
    source.start(time, Math.random() * 0.5);
    source.stop(time + length + 0.02);
  }

  protected tone(
    time: number,
    frequency: number,
    length: number,
    level: number,
    type: OscillatorType,
    destination: AudioNode,
    attack = 0.01,
    release = 0.08,
  ): void {
    const oscillator = this.context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + attack);
    gain.gain.setValueAtTime(level, time + Math.max(attack, length - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length + release);
    oscillator.connect(gain).connect(destination);
    oscillator.start(time);
    oscillator.stop(time + length + release + 0.02);
  }
}

function noiseBuffer(context: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * The shanty band: an accordion (two reeds a few cents apart and one an
 * octave down, through the bellows' tremolo and a reedy band), a plucked
 * bass on the downbeats, oom-pah chords, boots stomping on the deck and
 * hands clapping. "Drunken Sailor", then a new jig, then the shanty again.
 */
export class ShantyBand extends Sequenced {
  private readonly reeds: GainNode;
  private readonly room: ConvolverNode;
  private readonly noise: AudioBuffer;
  private tune: Tune = drunkenSailor();
  private tunes = 0;
  private melodyIndex = 0;
  /** Beat position within the tune, in eighth notes. */
  private eighth = 0;

  constructor(context: AudioContext, destination: AudioNode) {
    super(context, destination);
    this.noise = noiseBuffer(context, 1);
    this.room = createRoom(context, 1.2, 3);
    const wet = context.createGain();
    wet.gain.value = 0.28;
    this.room.connect(wet).connect(this.output);
    // Accordion voicing: reedy mid band, no fizz.
    const band = context.createBiquadFilter();
    band.type = "peaking";
    band.frequency.value = 1400;
    band.gain.value = 5;
    const soften = context.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 3600;
    this.reeds = context.createGain();
    this.reeds.gain.value = 1;
    // Bellows: a slow tremolo.
    const bellows = context.createOscillator();
    bellows.frequency.value = 5.2;
    const depth = context.createGain();
    depth.gain.value = 0.12;
    bellows.connect(depth).connect(this.reeds.gain);
    bellows.start();
    this.reeds.connect(band).connect(soften);
    soften.connect(this.output);
    soften.connect(this.room);
  }

  protected play(time: number): number {
    const tune = this.tune;
    const beat = this.eighth / 2;
    const beatSeconds = 60 / tune.tempo;
    const barBeats = tune.meter === 6 ? 3 : 4;
    const bar = Math.floor(beat / barBeats);
    const inBar = beat - bar * barBeats;
    const chord = tune.chords[bar % tune.chords.length]!;
    const third = chord.minor ? 3 : 4;

    // Melody notes starting on this eighth.
    while (this.melodyIndex < tune.melody.length && tune.melody[this.melodyIndex]!.beat < beat + 0.25) {
      const note = tune.melody[this.melodyIndex]!;
      this.accordion(time + (note.beat - beat) * beatSeconds, midiToHz(note.midi), note.length * beatSeconds * 0.92, 0.075);
      this.melodyIndex += 1;
    }

    if (tune.meter === 4) {
      if (inBar === 0 || inBar === 2) {
        this.tone(time, midiToHz(chord.root - 12 + (inBar === 2 ? 7 : 0)), beatSeconds * 0.8, 0.22, "triangle", this.output, 0.006, 0.12);
        this.kick(time, 0.5, 52);
        this.noiseHit(this.noise, time, 0.12, 0.12, "lowpass", 900);
      }
      if (inBar === 1 || inBar === 3) {
        this.chordStab(time, chord.root + 12, third, beatSeconds * 0.45);
        this.clap(time);
      }
    } else {
      // 6/8: boom on 1 and 4, chords on the off eighths.
      const eighthInBar = Math.round(inBar * 2);
      if (eighthInBar === 0 || eighthInBar === 3) {
        this.tone(time, midiToHz(chord.root - 12 + (eighthInBar === 3 ? 7 : 0)), beatSeconds * 0.9, 0.22, "triangle", this.output, 0.006, 0.12);
        this.kick(time, 0.45, 52);
      }
      if (eighthInBar === 2 || eighthInBar === 5) this.chordStab(time, chord.root + 12, third, beatSeconds * 0.35);
      if (eighthInBar === 3) this.clap(time);
    }

    this.eighth += 1;
    if (this.eighth / 2 >= tune.length) {
      // Next tune after a short breath.
      this.tunes += 1;
      this.tune = this.tunes % 2 === 0 ? drunkenSailor() : composeJig(this.tunes * 7919 + Math.floor(Math.random() * 1000));
      this.eighth = 0;
      this.melodyIndex = 0;
      return beatSeconds * 0.5 + 0.9;
    }
    return beatSeconds * 0.5;
  }

  private accordion(time: number, frequency: number, length: number, level: number): void {
    this.tone(time, frequency, length, level, "sawtooth", this.reeds, 0.025, 0.06);
    this.tone(time, frequency * 1.0035, length, level * 0.8, "sawtooth", this.reeds, 0.03, 0.06);
    this.tone(time, frequency * 0.5, length, level * 0.45, "square", this.reeds, 0.03, 0.06);
  }

  private chordStab(time: number, root: number, third: number, length: number): void {
    for (const interval of [0, third, 7]) this.accordion(time, midiToHz(root + interval - 12), length, 0.028);
  }

  private clap(time: number): void {
    // Several hands, not quite together.
    for (let hand = 0; hand < 3; hand += 1) {
      this.noiseHit(this.noise, time + hand * 0.007 + Math.random() * 0.004, 0.09, 0.09, "bandpass", 1300 + hand * 300, 1.1);
    }
  }
}

/**
 * The barge's house groove: four-on-the-floor kick, open hats, a rolling
 * bass and a filtered chord stab. The caller muffles it with distance.
 */
export class HouseGroove extends Sequenced {
  private readonly noise: AudioBuffer;
  private readonly pad: BiquadFilterNode;
  private sixteenth = 0;

  constructor(context: AudioContext, destination: AudioNode) {
    super(context, destination);
    this.noise = noiseBuffer(context, 1);
    this.pad = context.createBiquadFilter();
    this.pad.type = "lowpass";
    this.pad.frequency.value = 1800;
    this.pad.Q.value = 4;
    this.pad.connect(this.output);
    const sweep = context.createOscillator();
    sweep.frequency.value = 0.06;
    const depth = context.createGain();
    depth.gain.value = 900;
    sweep.connect(depth).connect(this.pad.frequency);
    sweep.start();
  }

  /** Bar position for the dance floor's lights, 0…4 beats. */
  get beatPhase(): number {
    const seconds = 60 / HOUSE_TEMPO;
    const sinceNext = this.nextTime - this.context.currentTime;
    return ((this.sixteenth / 4 - sinceNext / seconds) % 4 + 4) % 4;
  }

  protected play(time: number): number {
    const sixteenthSeconds = 60 / HOUSE_TEMPO / 4;
    const step = this.sixteenth % 16;
    const bar = Math.floor(this.sixteenth / 16) % 4;
    if (step % 4 === 0) this.kick(time, 0.9, 46);
    if (step % 4 === 2) this.noiseHit(this.noise, time, 0.09, 0.09, "highpass", 7000, 0.7);
    if (step % 4 === 0 && step > 0) this.noiseHit(this.noise, time, 0.03, 0.03, "highpass", 9000, 0.7);
    if (step === 4 || step === 12) this.noiseHit(this.noise, time, 0.16, 0.14, "bandpass", 1600, 0.9);
    if (step % 2 === 0) {
      const bass = HOUSE_BASS[bar]![step / 2]!;
      if (bass > 0) this.tone(time, midiToHz(bass), sixteenthSeconds * 1.6, 0.26, "sawtooth", this.output, 0.004, 0.05);
    }
    if (step === 3 || step === 10) {
      for (const note of HOUSE_CHORDS[bar]!) this.tone(time, midiToHz(note), sixteenthSeconds * 1.4, 0.035, "sawtooth", this.pad, 0.005, 0.12);
    }
    this.sixteenth += 1;
    return sixteenthSeconds;
  }
}
