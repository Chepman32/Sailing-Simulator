/**
 * The ship's bell: a small cast-bronze bell struck by its clapper.
 *
 * A bell is not a chime bar. Its sound is a set of inharmonic modes, the same
 * set that gives a church bell its voice, scaled up for a 20–25 cm bell:
 * the hum an octave below the prime, the prime, the minor-third tierce that
 * makes a bell sound like a bell, the quint, the nominal an octave above
 * the prime (the strike note the ear hears) and a thin top. Each mode is a
 * doublet: a cast bell is never perfectly round, so every mode splits into
 * two close frequencies that beat (the slow "wow" of a ringing bell). The low
 * modes ring for seconds, the high ones die in a fraction of one. The
 * clapper's strike is a short metallic click on top.
 */

/** Ratio to the prime, relative level, decay to −60 dB (s), doublet beat (Hz). */
const BELL_MODES: readonly (readonly [number, number, number, number])[] = [
  [0.5, 0.1, 5.6, 0.35], // hum
  [1, 0.2, 4.2, 0.8], // prime
  [1.188, 0.17, 3.4, 1.1], // tierce (minor third)
  [1.5, 0.06, 2.6, 1.4], // quint
  [2, 0.24, 3, 1.7], // nominal: the strike note
  [2.52, 0.07, 1.5, 2.3], // superquint
  [2.66, 0.08, 1.4, 2.9], // octave nominal
  [3.18, 0.05, 0.9, 3.5],
  [4.05, 0.035, 0.6, 4.6],
  [5.32, 0.025, 0.38, 6],
];

/** The prime of the yacht's bell, Hz (nominal, the heard pitch, an octave above). */
export const BELL_PRIME = 760;

/** How long one stroke rings, seconds. */
export const BELL_RING = 5.8;

/**
 * Strikes the bell `strokes` times (ship's time is rung in pairs), each
 * `gap` seconds apart, into `destination` from `start`. `click` is any white
 * noise buffer of at least 0.1 s. Returns when everything has stopped.
 */
export function ringBell(
  context: BaseAudioContext,
  destination: AudioNode,
  start: number,
  click: AudioBuffer,
  strokes = 2,
  gap = 0.46,
  level = 1,
): number {
  let end = start;
  for (let stroke = 0; stroke < strokes; stroke += 1) {
    const at = start + stroke * gap;
    // The second stroke of a pair is a touch softer, and each stroke excites
    // the modes a little differently (where the clapper lands).
    const force = level * (stroke % 2 === 0 ? 1 : 0.86);
    const output = context.createGain();
    output.gain.value = force;
    output.connect(destination);
    for (const [ratio, weight, decay, beat] of BELL_MODES) {
      const variation = 0.85 + Math.random() * 0.3;
      for (const [split, share] of [[-0.5, 0.58], [0.5, 0.42]] as const) {
        const partial = context.createOscillator();
        partial.type = "sine";
        partial.frequency.value = BELL_PRIME * ratio + split * beat;
        const gain = context.createGain();
        const peak = weight * share * variation;
        gain.gain.setValueAtTime(0.00001, at);
        gain.gain.linearRampToValueAtTime(peak, at + 0.0025);
        // −60 dB at `decay`: exponential ramps are exact and end on their own.
        gain.gain.exponentialRampToValueAtTime(peak * 0.001, at + decay);
        partial.connect(gain).connect(output);
        partial.start(at);
        partial.stop(at + decay + 0.02);
      }
      end = Math.max(end, at + decay);
    }
    // The clapper: a bright metallic tick and a dull knock.
    for (const [type, frequency, q, gainLevel, length] of [
      ["bandpass", 5200, 1.6, 0.22, 0.025],
      ["bandpass", 1900, 2.5, 0.12, 0.04],
    ] as const) {
      const source = context.createBufferSource();
      source.buffer = click;
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = context.createGain();
      gain.gain.setValueAtTime(gainLevel * force, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      source.connect(filter).connect(gain).connect(output);
      source.start(at, Math.random() * Math.max(0, click.duration - 0.1));
      source.stop(at + length + 0.01);
    }
  }
  return end;
}
