/**
 * Marine horns: the yacht's typhon and the big ships' whistles.
 *
 * A car horn is two small electric diaphragms a major third apart around
 * 400–500 Hz, switched on and off at once: a bright, flat beep. A marine
 * horn is the opposite on every count, and those are the cues the ear uses:
 *
 * - **pitch**: a low fundamental (COLREG Annex III: 70–200 Hz for a large
 *   ship, 130–350 Hz for a vessel of 20–75 m), one tone or a wide chord;
 * - **the horn tube**: a long trumpet in front of the diaphragm. Below its
 *   flare cut-off it barely radiates, so the fundamental is weaker than the
 *   second to fifth harmonics; the tube's resonance lifts a broad band
 *   (the "formant", 350–650 Hz) and the flare rolls off the top;
 * - **onset**: compressed air takes a few tenths of a second to set the
 *   diaphragm going: a hiss of air, a sputter, the pitch rising into tune as
 *   the pressure builds, the level swelling;
 * - **sustain**: never quite steady: a slow waver of pitch and a small
 *   tremble of level as the diaphragm flutters; two horns on one ship beat
 *   slowly against each other;
 * - **release**: the pressure falls, the pitch sags and the note groans out;
 * - **space**: the open sea answers with a long, soft, darkening tail.
 */

/** One horn of a set (ships carry a stack tuned to a chord). */
export type HornVoice = {
  /** Fundamental, Hz. */
  frequency: number;
  /** Relative level. */
  weight: number;
  /** Mistuning, cents (twin horns a few cents apart beat slowly). */
  detune: number;
};

/** One blast: when it starts, relative to the call, and how long the valve stays open, seconds. */
export type HornBlast = { offset: number; duration: number };

export type HornSpec = {
  voices: readonly HornVoice[];
  blasts: readonly HornBlast[];
  /** Peak level at the output. */
  level: number;
  /** Centre of the horn tube's resonance, Hz. */
  formant: number;
  /** Seconds from the valve opening to full voice. */
  attack: number;
  /** Seconds for the note to die once the valve closes. */
  release: number;
  /** How far below pitch the note starts and ends (fraction, e.g. 0.12). */
  sag: number;
  /** Air noise for the valve's hiss (any white or pink noise of ≥ 0.5 s). */
  breath: AudioBuffer;
};

/**
 * Amplitude of harmonic `n` of a horn sounding `frequency`: a diaphragm's
 * pulse train (slowly falling harmonics), filtered by the tube (high-pass
 * below the flare cut-off, a resonance at the formant and a weaker one
 * above it, a roll-off at the top). Pure, for tests.
 */
export function hornHarmonic(n: number, frequency: number, formant: number): number {
  const partial = n * frequency;
  const source = 1 / Math.pow(n, 0.72);
  const cutoff = formant * 0.42;
  const ratio = (partial / cutoff) ** 2;
  const flare = ratio / (1 + ratio);
  const width = formant * 0.55;
  const resonance = 1 + 3.2 * Math.exp(-(((partial - formant) / width) ** 2)) + 1.1 * Math.exp(-(((partial - formant * 2.35) / (width * 1.4)) ** 2));
  const top = 1 / (1 + (partial / 4200) ** 3);
  return source * flare * resonance * top;
}

/** The periodic wave of one horn: harmonics up to ~7 kHz with fixed, scattered phases (no spiky waveform). */
export function hornWave(context: BaseAudioContext, frequency: number, formant: number): PeriodicWave {
  const harmonics = Math.max(4, Math.min(64, Math.floor(7000 / frequency)));
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n += 1) {
    const amplitude = hornHarmonic(n, frequency, formant);
    // Deterministic scattered phases: same timbre every call.
    const phase = (n * n * 2.399) % (Math.PI * 2);
    real[n] = amplitude * Math.sin(phase);
    imag[n] = amplitude * Math.cos(phase);
  }
  // Normalise to a unit peak here rather than trusting the implementation
  // (browsers normalise by default; some engines do not), so the level is
  // the same everywhere.
  let peak = 1e-6;
  for (let i = 0; i < 1024; i += 1) {
    const x = (i / 1024) * Math.PI * 2;
    let value = 0;
    for (let n = 1; n <= harmonics; n += 1) value += real[n]! * Math.cos(n * x) + imag[n]! * Math.sin(n * x);
    peak = Math.max(peak, Math.abs(value));
  }
  for (let n = 1; n <= harmonics; n += 1) {
    real[n] = real[n]! / peak;
    imag[n] = imag[n]! / peak;
  }
  return context.createPeriodicWave(real, imag, { disableNormalization: true });
}

/** Value after `elapsed` seconds of an exponential approach from `from` to `to` with time constant `tau`. */
export function approachValue(from: number, to: number, elapsed: number, tau: number): number {
  return to + (from - to) * Math.exp(-Math.max(0, elapsed) / Math.max(1e-4, tau));
}

/**
 * Schedules an exponential approach from `from` to `to` over
 * [`at`, `at + duration`] as a value curve: the shape of `setTargetAtTime`,
 * but bounded and explicit, so later events never interact with an open
 * target (some engines mis-evaluate long targets). Returns the value
 * reached at the end.
 */
function approach(param: AudioParam, from: number, to: number, at: number, duration: number, tau: number): number {
  // Half a millisecond of clearance at each end: a value curve may not share
  // its interval with any other event, including one at its very edge.
  if (duration < 0.004) {
    param.setValueAtTime(from, at + 0.0005);
    return from;
  }
  const count = Math.max(8, Math.min(256, Math.ceil(duration * 90)));
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i += 1) curve[i] = approachValue(from, to, (i / (count - 1)) * duration, tau);
  param.setValueCurveAtTime(curve, at + 0.0005, duration - 0.001);
  return curve[count - 1]!;
}

/** When the call is over (last valve closed plus the release), relative to its start, seconds. */
export function hornLength(spec: Pick<HornSpec, "blasts" | "release">): number {
  let end = 0;
  for (const blast of spec.blasts) end = Math.max(end, blast.offset + blast.duration);
  return end + spec.release * 3;
}

/**
 * Sounds `spec` into `destination` from `start` (context time). Returns the
 * context time at which everything has stopped. Every node is created for
 * this call and stops by itself; nothing needs disposing.
 */
export function playHorn(context: BaseAudioContext, destination: AudioNode, start: number, spec: HornSpec): number {
  const end = start + hornLength(spec);
  const output = context.createGain();
  output.gain.value = 1;
  output.connect(destination);

  // The tube's resonance once more as a gentle filter, so the breath and the
  // sputter share the horn's colour.
  const body = context.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = spec.formant;
  body.Q.value = 0.9;
  body.gain.value = 4;
  const top = context.createBiquadFilter();
  top.type = "lowpass";
  top.frequency.value = 5200;
  top.Q.value = 0.4;
  body.connect(top).connect(output);

  // Level envelope shared by every horn of the set.
  const envelope = context.createGain();
  envelope.gain.value = 0;
  // Diaphragm flutter: a small, fast tremble of the level (±3.5 %), on its
  // own stage so the envelope's automation stays plain.
  const tremble = context.createGain();
  tremble.gain.value = 1;
  envelope.connect(tremble).connect(body);
  const flutter = context.createOscillator();
  flutter.type = "triangle";
  flutter.frequency.value = 13.7;
  const flutterDepth = context.createGain();
  flutterDepth.gain.value = 0.035;
  flutter.connect(flutterDepth).connect(tremble.gain);

  const level = spec.level;
  const blasts = [...spec.blasts].sort((a, b) => a.offset - b.offset);
  // Each blast may only shape its parameters until the next one begins.
  const windowEnd = (index: number) => (index + 1 < blasts.length ? start + blasts[index + 1]!.offset - 0.002 : end);
  let carried = 0;
  blasts.forEach((blast, index) => {
    const t0 = start + blast.offset;
    const t1 = t0 + blast.duration;
    const attack = Math.min(spec.attack, blast.duration * 0.6);
    // The diaphragm catches: a quick, weak sputter, then the swell to full voice.
    envelope.gain.setValueAtTime(carried, t0);
    envelope.gain.linearRampToValueAtTime(level * 0.22, t0 + 0.035);
    envelope.gain.linearRampToValueAtTime(level * 0.12, t0 + 0.08);
    approach(envelope.gain, level * 0.12, level, t0 + 0.08, t1 - t0 - 0.08, attack * 0.38);
    // Valve closes: the note dies with the pressure.
    carried = approach(envelope.gain, approachValue(level * 0.12, level, t1 - t0 - 0.08, attack * 0.38), 0, t1, windowEnd(index) - t1, spec.release * 0.42);
  });

  // Slow waver of pitch common to the set (pressure), in cents.
  const waver = context.createOscillator();
  waver.frequency.value = 0.43;
  const waverDepth = context.createGain();
  waverDepth.gain.value = 5;
  waver.connect(waverDepth);
  const vibrato = context.createOscillator();
  vibrato.frequency.value = 5.3;
  const vibratoDepth = context.createGain();
  vibratoDepth.gain.value = 2.2;
  vibrato.connect(vibratoDepth);

  const oscillators: OscillatorNode[] = [flutter, waver, vibrato];
  const weightSum = spec.voices.reduce((sum, voice) => sum + voice.weight, 0) || 1;
  for (const voice of spec.voices) {
    const tone = context.createOscillator();
    tone.setPeriodicWave(hornWave(context, voice.frequency, spec.formant));
    tone.detune.value = voice.detune;
    waverDepth.connect(tone.detune);
    vibratoDepth.connect(tone.detune);
    const gain = context.createGain();
    gain.gain.value = voice.weight / weightSum;
    tone.connect(gain).connect(envelope);
    blasts.forEach((blast, index) => {
      const t0 = start + blast.offset;
      const t1 = t0 + blast.duration;
      const low = voice.frequency * (1 - spec.sag);
      // Pitch rises into tune as the pressure builds, and sags as it falls.
      tone.frequency.setValueAtTime(low, t0);
      approach(tone.frequency, low, voice.frequency, t0, t1 - t0, spec.attack * 0.32);
      const held = approachValue(low, voice.frequency, t1 - t0, spec.attack * 0.32);
      approach(tone.frequency, held, voice.frequency * (1 - spec.sag * 0.8), t1, windowEnd(index) - t1, spec.release * 0.55);
    });
    oscillators.push(tone);
  }

  // Compressed air: a hiss as the valve opens, a softer one under the note, a puff as it shuts.
  const hiss = context.createBiquadFilter();
  hiss.type = "bandpass";
  hiss.frequency.value = Math.min(3200, spec.formant * 2.6);
  hiss.Q.value = 0.8;
  const hissGain = context.createGain();
  hissGain.gain.value = 0;
  hiss.connect(hissGain).connect(output);
  for (const blast of blasts) {
    const t0 = start + blast.offset;
    const t1 = t0 + blast.duration;
    hissGain.gain.setValueAtTime(0, t0);
    hissGain.gain.linearRampToValueAtTime(level * 0.2, t0 + 0.025);
    approach(hissGain.gain, level * 0.2, level * 0.035, t0 + 0.025, t1 - t0 - 0.025, 0.12);
    // The puff as the valve shuts, then silence.
    hissGain.gain.linearRampToValueAtTime(level * 0.09, t1 + 0.03);
    hissGain.gain.linearRampToValueAtTime(0, t1 + 0.3);
    const air = context.createBufferSource();
    air.buffer = spec.breath;
    air.loop = true;
    air.connect(hiss);
    air.start(t0, Math.random() * Math.max(0, spec.breath.duration - 0.1));
    air.stop(t1 + 0.6);
  }

  for (const oscillator of oscillators) {
    oscillator.start(start);
    oscillator.stop(end + 0.05);
  }
  return end;
}

/**
 * Impulse response of open water: no walls, only the sea surface, a distant
 * shore and the haze. A few early reflections, then a long, sparse,
 * darkening tail. Built once per context.
 */
export function openSeaImpulse(context: BaseAudioContext, seconds = 3.2): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.floor(seconds * rate);
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let seed = 0x9e3779b9 ^ (channel * 0x85ebca6b);
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) / 4294967296) * 2 - 1;
    };
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / rate;
      // Sparse at first (single echoes), denser later; highs die faster.
      const density = Math.min(1, 0.04 + t * 0.9);
      const sample = Math.abs(random()) < density ? random() : 0;
      const darkening = Math.min(0.985, 0.55 + t * 0.32);
      low = low * darkening + sample * (1 - darkening);
      const swell = Math.min(1, t / 0.12);
      data[i] = low * swell * Math.exp(-t * 1.9) * 2.4;
    }
    // Early reflections: the water under the horn and a far shore.
    // Unit energy: the response neither boosts nor cuts the level on its
    // own (use with `normalize = false`); the reflections are then set
    // against the normalised tail.
    let energy = 1e-12;
    for (let i = 0; i < length; i += 1) energy += data[i]! * data[i]!;
    const scale = 0.8 / Math.sqrt(energy);
    for (let i = 0; i < length; i += 1) data[i] = data[i]! * scale;
    for (const [time, gain] of [[0.012 + channel * 0.003, 0.45], [0.41 + channel * 0.02, 0.22], [0.93 - channel * 0.03, 0.11]] as const) {
      const index = Math.floor(time * rate);
      if (index < length) data[index] = data[index]! + gain;
    }
  }
  return buffer;
}
