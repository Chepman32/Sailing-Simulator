/**
 * Notes and patterns for the music made in the browser: the shanty station
 * of the yacht radio (a traditional tune and jigs written on the fly) and the
 * house beat coming from the party barge. Pure numbers; `MusicSynth` plays
 * them.
 */

/** Frequency of a MIDI note, Hz. */
export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export type Note = {
  /** Start, in beats from the top of the tune. */
  beat: number;
  /** Length in beats. */
  length: number;
  midi: number;
};

export type Tune = {
  name: string;
  /** Beats per minute. */
  tempo: number;
  /** Beats per bar (the accompaniment's pattern follows it). */
  meter: 4 | 6;
  /** Melody. */
  melody: Note[];
  /** One chord root (MIDI) per bar, and whether it is minor. */
  chords: { root: number; minor: boolean }[];
  /** Length in beats. */
  length: number;
};

const D4 = 62;

/**
 * "What Shall We Do with the Drunken Sailor" — a traditional capstan shanty
 * (public domain), in D dorian: verse and chorus. Written as [note, beats]
 * with 0 for a rest; one beat is a quarter note.
 */
const DRUNKEN_SAILOR: [number, number][] = [
  // What shall we do with a drun-ken sai-lor
  [69, 1], [69, 0.5], [69, 0.5], [69, 1], [69, 0.5], [69, 0.5], [69, 1], [62, 1], [65, 1], [69, 1],
  [67, 1], [67, 0.5], [67, 0.5], [67, 1], [67, 0.5], [67, 0.5], [67, 1], [60, 1], [64, 1], [67, 1],
  [69, 1], [69, 0.5], [69, 0.5], [69, 1], [69, 0.5], [69, 0.5], [69, 1], [71, 1], [72, 1], [74, 1],
  [72, 1], [69, 1], [67, 1], [64, 1], [62, 2], [62, 2],
  // Way hay and up she ri-ses
  [69, 2], [69, 2], [69, 1], [62, 1], [65, 1], [69, 1],
  [67, 2], [67, 2], [67, 1], [60, 1], [64, 1], [67, 1],
  [69, 2], [69, 2], [69, 1], [71, 1], [72, 1], [74, 1],
  [72, 1], [69, 1], [67, 1], [64, 1], [62, 2], [62, 2],
];
/** Dm, C, Dm, C–Dm per two bars of the tune (bars of four beats). */
const DRUNKEN_CHORDS = [
  { root: 50, minor: true }, { root: 50, minor: true }, { root: 48, minor: false }, { root: 48, minor: false },
  { root: 50, minor: true }, { root: 50, minor: true }, { root: 48, minor: false }, { root: 50, minor: true },
];

function sequence(notes: [number, number][]): { melody: Note[]; length: number } {
  const melody: Note[] = [];
  let beat = 0;
  for (const [midi, length] of notes) {
    if (midi > 0) melody.push({ beat, length, midi });
    beat += length;
  }
  return { melody, length: beat };
}

export function drunkenSailor(): Tune {
  const { melody, length } = sequence(DRUNKEN_SAILOR);
  // The tune is 16 bars long; the chord pattern repeats for the chorus.
  const chords = [...DRUNKEN_CHORDS, ...DRUNKEN_CHORDS].flatMap((chord) => [chord]);
  return { name: "Drunken Sailor", tempo: 118, meter: 4, melody, chords, length };
}

/** A small deterministic random stream. */
function stream(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

/**
 * A jig made up on the spot (6/8, two eight-bar strains), in a minor or
 * dorian key, over the old i – VII – i – v progression. Each seed gives a
 * different tune; each has a hook it comes back to, as real ones do.
 */
export function composeJig(seed: number): Tune {
  const random = stream(seed);
  const tonic = D4 + [0, -2, 2, -5, 5][Math.floor(random() * 5)]!;
  // Dorian: the major sixth gives the seafaring brightness.
  const scale = [0, 2, 3, 5, 7, 9, 10];
  const degreeToMidi = (degree: number): number => {
    const octave = Math.floor(degree / 7);
    return tonic + octave * 12 + scale[((degree % 7) + 7) % 7]!;
  };
  const progression = [0, -1, 0, 4, 0, -1, 3, 4]; // scale degrees of the chord roots, per bar
  const chords = progression.map((degree) => {
    const root = degreeToMidi(degree) - 12;
    const third = degreeToMidi(degree + 2) - 12 - root;
    return { root, minor: third === 3 };
  });
  // One bar = six eighth notes = three beats of quarter value (the tempo is per eighth / 2).
  const melody: Note[] = [];
  const hook: number[] = [];
  let degree = 4;
  const bars = 16;
  for (let bar = 0; bar < bars; bar += 1) {
    const chordDegree = progression[bar % 8]!;
    const usesHook = bar % 4 === 0 && hook.length > 0;
    const figure: number[] = [];
    for (let step = 0; step < 6; step += 1) {
      if (usesHook) {
        figure.push(hook[step]! + chordDegree);
        continue;
      }
      // Chord tones on the strong eighths, steps between.
      if (step === 0 || step === 3) {
        // The chord tone nearest the last note, in whichever octave.
        const target = chordDegree + [0, 2, 4][Math.floor(random() * 3)]!;
        degree = [target - 7, target, target + 7].reduce((best, option) => (Math.abs(option - degree) < Math.abs(best - degree) ? option : best));
      } else {
        degree += random() < 0.5 ? -1 : 1;
      }
      degree = Math.max(-2, Math.min(9, degree));
      figure.push(degree);
    }
    if (bar === 0) hook.push(...figure.map((value) => value - chordDegree));
    // The last bar of each strain lands on the tonic.
    if (bar % 8 === 7) {
      figure[3] = 0;
      figure[4] = 0;
      figure[5] = 0;
    }
    figure.forEach((value, step) => {
      const tied = bar % 8 === 7 && step > 3;
      if (tied) return;
      melody.push({
        beat: bar * 3 + step * 0.5,
        length: bar % 8 === 7 && step === 3 ? 1.5 : 0.5,
        midi: degreeToMidi(value) + 12,
      });
    });
  }
  return {
    name: "Jig",
    tempo: 128 + Math.floor(random() * 16),
    meter: 6,
    melody,
    chords: [...chords, ...chords],
    length: bars * 3,
  };
}

/** House groove of the party barge: 124 BPM, A minor, a four-chord loop. */
export const HOUSE_TEMPO = 124;
export const HOUSE_CHORDS: readonly number[][] = [
  [57, 60, 64, 67], // Am7
  [53, 57, 60, 64], // Fmaj7
  [55, 59, 62, 65], // G7
  [52, 55, 59, 62], // Em7
];
/** Bass line: one note per eighth (MIDI, 0 = rest) for one bar per chord. */
export const HOUSE_BASS: readonly number[][] = [
  [0, 45, 0, 45, 0, 45, 48, 45],
  [0, 41, 0, 41, 0, 41, 45, 41],
  [0, 43, 0, 43, 0, 43, 47, 43],
  [0, 40, 0, 40, 0, 40, 43, 40],
];
