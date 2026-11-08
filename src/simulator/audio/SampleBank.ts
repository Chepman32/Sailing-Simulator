/**
 * Recorded sounds of the skipper's body (`public/audio/*.mp3`, CC0 and
 * CC BY, see `public/audio/README.md`): footsteps on each surface, the
 * slosh of wading, swimming strokes, plunges and bubbles. Small one-shots,
 * fetched once after the audio starts and decoded into buffers. Until a
 * group has arrived (or if it never does) `BodySounds` synthesises it.
 *
 * Every play is varied: a different take of the group, never the last one
 * twice in a row, a slightly different pitch and level.
 */

export type SampleGroup =
  | "sand"
  | "wet"
  | "grass"
  | "wood"
  | "plank"
  | "rock"
  | "deck"
  | "wade"
  | "stroke"
  | "plunge"
  | "bubble"
  | "bubblesRush";

/** Files of each group under `/audio/`. */
export const SAMPLE_FILES: Readonly<Record<SampleGroup, readonly string[]>> = {
  sand: ["foot-sand-1", "foot-sand-2", "foot-sand-3"],
  wet: ["foot-wet-1", "foot-wet-2", "foot-wet-3"],
  grass: ["foot-grass-1", "foot-grass-2", "foot-grass-3", "foot-grass-4", "foot-grass-5"],
  wood: ["foot-wood-1", "foot-wood-2", "foot-wood-3", "foot-wood-4", "foot-wood-5"],
  plank: ["foot-plank-1", "foot-plank-3", "foot-plank-4"],
  rock: ["foot-rock-1", "foot-rock-2", "foot-rock-3", "foot-rock-4", "foot-rock-5"],
  deck: ["foot-deck-1", "foot-deck-2", "foot-deck-3", "foot-deck-4", "foot-deck-5"],
  wade: ["wade-1", "wade-2", "wade-3"],
  stroke: ["stroke-1", "stroke-2", "stroke-3", "stroke-4", "stroke-5", "stroke-6", "stroke-7", "stroke-8"],
  plunge: ["plunge-1", "plunge-2", "plunge-3", "plunge-4"],
  bubble: ["bubble-1", "bubble-2", "bubble-3"],
  bubblesRush: ["bubbles-rush"],
};

export type PlayOptions = {
  /** Linear gain (1 = the file's own level, which is normalised to about −16 dBFS). */
  gain?: number;
  /** Playback rate (pitch and speed together); varied ±`spread` around it. */
  rate?: number;
  spread?: number;
  /** Seconds from now. */
  delay?: number;
  /** A low-pass on the take (Hz), e.g. a muffled sound through the water. */
  lowpass?: number;
  /** A high-pass on the take (Hz), e.g. to thin a heavy footfall. */
  highpass?: number;
  /** Plays only this long (s), fading out over the last tenth. */
  length?: number;
  output?: AudioNode;
};

export class SampleBank {
  private readonly buffers = new Map<SampleGroup, AudioBuffer[]>();
  private readonly last = new Map<SampleGroup, number>();
  private requested = false;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly output: AudioNode,
    private readonly base = "/audio/",
  ) {}

  /** Starts fetching every group (once). Failures leave that group to the synthesiser. */
  load(): void {
    if (this.requested || typeof fetch === "undefined") return;
    this.requested = true;
    for (const group of Object.keys(SAMPLE_FILES) as SampleGroup[]) {
      void Promise.all(
        SAMPLE_FILES[group].map(async (name) => {
          try {
            const response = await fetch(`${this.base}${name}.mp3`);
            if (!response.ok) return null;
            return await this.context.decodeAudioData(await response.arrayBuffer());
          } catch {
            return null;
          }
        }),
      ).then((decoded) => {
        const ready = decoded.filter((buffer): buffer is AudioBuffer => buffer !== null);
        if (ready.length > 0) this.buffers.set(group, ready);
      });
    }
  }

  has(group: SampleGroup): boolean {
    return (this.buffers.get(group)?.length ?? 0) > 0;
  }

  /** Plays a take of `group`; false if it is not loaded (the caller synthesises instead). */
  play(group: SampleGroup, options: PlayOptions = {}): boolean {
    const takes = this.buffers.get(group);
    if (!takes || takes.length === 0) return false;
    // A different take from the last one, whenever there is a choice.
    let index = Math.floor(Math.random() * takes.length);
    if (takes.length > 1 && index === this.last.get(group)) index = (index + 1 + Math.floor(Math.random() * (takes.length - 1))) % takes.length;
    this.last.set(group, index);
    const buffer = takes[index]!;
    const context = this.context;
    const start = context.currentTime + Math.max(0, options.delay ?? 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const spread = options.spread ?? 0.08;
    source.playbackRate.value = (options.rate ?? 1) * (1 - spread + Math.random() * spread * 2);
    let node: AudioNode = source;
    if (options.highpass) {
      const filter = context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = options.highpass;
      node = node.connect(filter);
    }
    if (options.lowpass) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      filter.Q.value = 0.6;
      node = node.connect(filter);
    }
    const gain = context.createGain();
    const level = Math.max(0, (options.gain ?? 1) * (0.86 + Math.random() * 0.28));
    gain.gain.setValueAtTime(level, start);
    const duration = buffer.duration / source.playbackRate.value;
    const length = Math.min(duration, options.length ?? duration);
    if (length < duration) {
      gain.gain.setValueAtTime(level, start + length * 0.9);
      gain.gain.linearRampToValueAtTime(0, start + length);
    }
    node.connect(gain).connect(options.output ?? this.output);
    source.start(start);
    source.stop(start + length + 0.02);
    source.onended = () => gain.disconnect();
    return true;
  }
}
