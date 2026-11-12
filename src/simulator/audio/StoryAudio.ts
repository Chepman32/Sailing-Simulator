import { assetUrl } from "../core/assetManifest";
import type { AudioSystem } from "./AudioSystem";

/**
 * The story's recorded sound (`/audio/story/…`): the voiced lines, the
 * scenes' sound effects and the beds of a place (the beach, the jungle,
 * the outpost's generator).
 *
 * - **voices**: one at a time, the line on screen. It follows the subtitle
 *   (`update`): a new line starts its clip, a line cut short (clicked away,
 *   dropped by a scene) stops it, and a pause stops it and picks it up again
 *   where the line stands. Radio lines already carry the set's crackle in
 *   their recording; a few sound through a radio band here;
 * - **effects**: one-shots, many at once;
 * - **beds**: one loop at a time, crossfaded into the next.
 *
 * Clips are fetched when first wanted (a line is fetched as soon as it is
 * queued, so it is in hand when its turn comes), decoded once and kept.
 */

const VOICE_GAIN = 1.05;
const EFFECT_GAIN = 0.75;
const BED_GAIN = 0.32;
/** Seconds one take of a bed fades into the next. */
const BED_OVERLAP = 2.5;
/** Kept decoded at most (least recently used go first). */
const CACHE_CLIPS = 48;

type Mixer = NonNullable<AudioSystem["mixer"]>;
type Playing = { source: AudioBufferSourceNode; gain: GainNode };

/** Where a clip's file is (its URL carries its content hash). */
export function clipUrl(clip: string): string {
  return assetUrl(`/audio/story/${clip}.mp3`);
}

export class StoryAudio {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private voice: { line: number; clip: string; playing: Playing | null } | null = null;
  /**
   * The bed: its takes laid end to end, each fading into the next over
   * `BED_OVERLAP` (the files are not cut to loop, and an MP3 never loops
   * without a gap); `nextAt` is when the next take starts, context time.
   */
  private bed: { clip: string; volume: number; takes: { playing: Playing; until: number }[]; nextAt: number; first: boolean } | null = null;
  private held = false;
  private disposed = false;

  constructor(private readonly audio: AudioSystem) {}

  private mixer(): Mixer | null {
    const mixer = this.audio.mixer;
    if (!mixer) return null;
    if (this.context !== mixer.context) {
      // Sound turned on afresh: what was decoded belonged to the old context.
      this.context = mixer.context;
      this.buffers.clear();
      this.loading.clear();
      if (this.voice) this.voice.playing = null;
      if (this.bed) {
        this.bed.takes = [];
        this.bed.nextAt = 0;
      }
    }
    return mixer;
  }

  /** Starts fetching clips that will be wanted soon (the lines just queued). */
  prefetch(clips: readonly string[]): void {
    for (const clip of clips) void this.fetchBytes(clip);
  }

  /**
   * The line on screen (null: none) and how far into it the subtitle is;
   * `running` false while the game is paused.
   */
  update(line: { id: number; voice?: string; elapsed: number } | null, running: boolean): void {
    if (this.disposed) return;
    const wanted = line?.voice ? line : null;
    const voice = this.voice;
    if (!wanted) {
      if (voice) this.stopVoice();
      this.held = !running;
      this.syncBed(running);
      return;
    }
    if (!voice || voice.line !== wanted.id) {
      this.stopVoice();
      this.voice = { line: wanted.id, clip: wanted.voice!, playing: null };
      if (running) this.startVoice(wanted.elapsed);
    } else if (!running && voice.playing) {
      this.stopPlaying(voice.playing, 0.05);
      voice.playing = null;
    } else if (running && !voice.playing && this.held) {
      // Back from the pause: on from where the line stands.
      this.startVoice(wanted.elapsed);
    }
    this.held = !running;
    this.syncBed(running);
  }

  /** A sound effect, once (`volume` 0…1.5 of the effects' level). */
  effect(clip: string, volume = 1): void {
    void this.buffer(clip).then((buffer) => {
      const mixer = this.mixer();
      if (!buffer || !mixer || this.disposed) return;
      this.play(mixer, buffer, EFFECT_GAIN * volume, false, 0, 0.005);
    });
  }

  /** The bed of the place: a loop (null: silence), crossfaded. */
  setBed(clip: string | null, volume = 1): void {
    if ((this.bed?.clip ?? null) === clip) return;
    for (const take of this.bed?.takes ?? []) this.stopPlaying(take.playing, 2.5);
    this.bed = clip ? { clip, volume, takes: [], nextAt: 0, first: true } : null;
    this.syncBed(!this.held);
  }

  stopAll(): void {
    this.stopVoice();
    this.setBed(null);
  }

  dispose(): void {
    this.disposed = true;
    this.stopAll();
    this.buffers.clear();
  }

  /** Keeps the bed going: the next take started as the last one begins to fade. */
  private syncBed(running: boolean): void {
    const bed = this.bed;
    if (!bed || !running) return;
    const buffer = this.buffers.get(bed.clip);
    if (!buffer) {
      void this.buffer(bed.clip);
      return;
    }
    const mixer = this.mixer();
    if (!mixer || mixer.context.currentTime < bed.nextAt) return;
    const now = mixer.context.currentTime;
    // The first take from anywhere in the file (a place is not entered at the start of its recording).
    const offset = bed.first ? Math.random() * Math.max(0, buffer.duration - BED_OVERLAP * 3) : 0;
    const length = buffer.duration - offset;
    const take = this.play(mixer, buffer, BED_GAIN * bed.volume, false, offset, bed.first ? 3 : BED_OVERLAP);
    const fadeAt = now + Math.max(0.5, length - BED_OVERLAP);
    take.gain.gain.setValueAtTime(BED_GAIN * bed.volume, fadeAt);
    take.gain.gain.linearRampToValueAtTime(0.0001, now + length - 0.05);
    bed.takes = [...bed.takes.filter((other) => now < other.until), { playing: take, until: now + length }];
    bed.nextAt = fadeAt;
    bed.first = false;
  }

  private startVoice(offset: number): void {
    const voice = this.voice;
    if (!voice) return;
    const started = performance.now();
    void this.buffer(voice.clip).then((buffer) => {
      const mixer = this.mixer();
      if (!buffer || !mixer || this.disposed || this.voice !== voice || voice.playing) return;
      // However long the fetch took, the line has moved on that much.
      const at = offset + (performance.now() - started) / 1000;
      if (at >= buffer.duration - 0.1) return;
      voice.playing = this.play(mixer, buffer, VOICE_GAIN, false, at < 0.25 ? 0 : at, at < 0.25 ? 0.005 : 0.06);
    });
  }

  private stopVoice(): void {
    if (this.voice?.playing) this.stopPlaying(this.voice.playing, 0.08);
    this.voice = null;
  }

  private play(mixer: Mixer, buffer: AudioBuffer, level: number, loop: boolean, offset: number, fadeIn: number): Playing {
    const { context, master } = mixer;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), now + Math.max(0.005, fadeIn));
    source.connect(gain).connect(master);
    source.start(now, Math.max(0, Math.min(offset, buffer.duration - 0.05)) % Math.max(0.05, buffer.duration));
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    return { source, gain };
  }

  private stopPlaying(playing: Playing, fade: number): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    try {
      playing.gain.gain.cancelScheduledValues(now);
      playing.gain.gain.setValueAtTime(Math.max(0.0001, playing.gain.gain.value), now);
      playing.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      playing.source.stop(now + fade + 0.02);
    } catch {
      // Already stopped.
    }
  }

  private fetchBytes(clip: string): Promise<ArrayBuffer | null> {
    let request = this.bytes.get(clip);
    if (!request) {
      request = fetch(clipUrl(clip))
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null);
      this.bytes.set(clip, request);
      // A failed fetch may be tried again later.
      void request.then((data) => {
        if (!data) this.bytes.delete(clip);
      });
    }
    return request;
  }

  private buffer(clip: string): Promise<AudioBuffer | null> {
    const ready = this.buffers.get(clip);
    if (ready) {
      // Most recently used last.
      this.buffers.delete(clip);
      this.buffers.set(clip, ready);
      return Promise.resolve(ready);
    }
    let decoding = this.loading.get(clip);
    if (!decoding) {
      decoding = this.fetchBytes(clip).then(async (data) => {
        const context = this.mixer()?.context;
        if (!data || !context) {
          this.loading.delete(clip);
          return null;
        }
        try {
          // Decoding detaches the bytes: decode a copy, keep the fetched ones for a new context.
          const buffer = await context.decodeAudioData(data.slice(0));
          this.buffers.set(clip, buffer);
          while (this.buffers.size > CACHE_CLIPS) this.buffers.delete(this.buffers.keys().next().value!);
          // The raw bytes are not needed once decoded.
          this.bytes.delete(clip);
          return buffer;
        } catch {
          return null;
        } finally {
          this.loading.delete(clip);
        }
      });
      this.loading.set(clip, decoding);
    }
    return decoding;
  }
}
