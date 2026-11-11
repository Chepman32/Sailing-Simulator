/**
 * The yacht's radio: three internet stations from SomaFM (listener-supported
 * free radio; each is credited in the player) and a shanty station played by
 * a band synthesised in the browser.
 *
 * A stream plays through an ordinary media element — no download, nothing
 * hidden — and tries the next server if one fails. The shanty band lives in
 * the sound graph (`AudioSystem.setShanty`). Each station also carries a
 * mood: a grade the image eases to while it plays.
 */

export type RadioStationId = "lofi" | "synthwave" | "reggae" | "shanty";

export type RadioGrade = {
  /** Multiplies the image (linear). */
  gain: readonly [number, number, number];
  /** Added to the shadows (linear). */
  shadows: readonly [number, number, number];
  saturation: number;
  vignette: number;
};

export type RadioStation = {
  id: RadioStationId;
  /** Stream addresses to try in turn (none: the band on board). */
  streams: readonly string[];
  /** The station's own page, for the credit. */
  homepage?: string;
  /** Name of the source station, for the credit. */
  source?: string;
  grade: RadioGrade;
};

const soma = (channel: string): string[] => [
  `https://ice2.somafm.com/${channel}-128-mp3`,
  `https://ice4.somafm.com/${channel}-128-mp3`,
  `https://ice1.somafm.com/${channel}-128-mp3`,
  `https://ice.somafm.com/${channel}`,
];

export const NEUTRAL_GRADE: RadioGrade = { gain: [1, 1, 1], shadows: [0, 0, 0], saturation: 1, vignette: 0 };

export const RADIO_STATIONS: readonly RadioStation[] = [
  {
    id: "lofi",
    streams: soma("groovesalad"),
    homepage: "https://somafm.com/groovesalad/",
    source: "SomaFM · Groove Salad",
    // Warm, soft, a little faded: a lazy afternoon.
    grade: { gain: [1.06, 1.01, 0.92], shadows: [0.012, 0.006, 0.0], saturation: 0.93, vignette: 0.05 },
  },
  {
    id: "synthwave",
    streams: soma("u80s"),
    homepage: "https://somafm.com/u80s/",
    source: "SomaFM · Underground 80s",
    // Neon: magenta highlights, violet shadows, punchy colour.
    grade: { gain: [1.08, 0.94, 1.08], shadows: [0.012, 0.0, 0.024], saturation: 1.16, vignette: 0.08 },
  },
  {
    id: "reggae",
    streams: soma("reggae"),
    homepage: "https://somafm.com/reggae/",
    source: "SomaFM · Heavyweight Reggae",
    // Golden sun and rich greens.
    grade: { gain: [1.07, 1.05, 0.9], shadows: [0.006, 0.008, 0.0], saturation: 1.12, vignette: 0.03 },
  },
  {
    id: "shanty",
    streams: [],
    // Old sea: cooler, a touch desaturated, a heavier vignette.
    grade: { gain: [0.95, 0.99, 1.04], shadows: [0.0, 0.004, 0.01], saturation: 0.84, vignette: 0.14 },
  },
];

export function radioStation(id: string | null): RadioStation | null {
  return RADIO_STATIONS.find((station) => station.id === id) ?? null;
}

export type RadioHooks = {
  /** Start or stop the band on board. */
  shanty: (playing: boolean) => void;
  /** A burst of static between stations. */
  tuning: () => void;
  /** The radio's state changed (playing, buffering, failed). */
  changed: () => void;
  /** A station could not be reached on any server. */
  failed: (station: RadioStationId) => void;
};

export class RadioSystem {
  private element: HTMLAudioElement | null = null;
  private current: RadioStation | null = null;
  private candidate = 0;
  private volume = 0.7;
  private muted = false;
  private hidden = false;
  private waiting = false;

  constructor(private readonly hooks: RadioHooks) {
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  get station(): RadioStationId | null {
    return this.current?.id ?? null;
  }

  get buffering(): boolean {
    return this.waiting;
  }

  get grade(): RadioGrade {
    return this.current?.grade ?? NEUTRAL_GRADE;
  }

  /** Tunes to a station (call inside a tap or key press: browsers allow sound only then). */
  play(id: RadioStationId): void {
    const station = radioStation(id);
    if (!station) return;
    if (this.current?.id === id) return;
    this.hooks.tuning();
    this.stopStream();
    this.current = station;
    if (station.streams.length === 0) {
      this.hooks.shanty(!this.muted);
      this.waiting = false;
    } else {
      this.hooks.shanty(false);
      this.candidate = 0;
      this.startStream();
    }
    this.hooks.changed();
  }

  /** The next or previous station, round the dial (from off: the first). */
  step(direction: 1 | -1): void {
    const index = this.current ? RADIO_STATIONS.indexOf(this.current) : direction > 0 ? -1 : 0;
    const next = RADIO_STATIONS[(index + direction + RADIO_STATIONS.length) % RADIO_STATIONS.length]!;
    this.play(next.id);
  }

  off(): void {
    if (!this.current) return;
    this.stopStream();
    this.hooks.shanty(false);
    this.current = null;
    this.waiting = false;
    this.hooks.changed();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.element) this.element.volume = this.volume;
  }

  get level(): number {
    return this.volume;
  }

  /** All sound off (the sound button): the radio falls silent with it. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.element) this.element.muted = muted;
    if (this.current && this.current.streams.length === 0) this.hooks.shanty(!muted);
  }

  dispose(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stopStream();
    this.hooks.shanty(false);
    this.current = null;
  }

  private startStream(): void {
    const station = this.current;
    if (!station) return;
    const url = station.streams[this.candidate];
    if (!url) {
      this.waiting = false;
      this.current = null;
      this.hooks.failed(station.id);
      this.hooks.changed();
      return;
    }
    const element = new Audio();
    element.preload = "none";
    element.volume = this.volume;
    element.muted = this.muted;
    element.addEventListener("playing", this.onPlaying);
    element.addEventListener("waiting", this.onWaiting);
    element.addEventListener("error", this.onError);
    element.addEventListener("stalled", this.onWaiting);
    element.src = url;
    this.element = element;
    this.waiting = true;
    if (!this.hidden) {
      element.play().catch((error: unknown) => {
        // NotAllowedError: no gesture; the next tap on the radio starts it.
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          this.waiting = false;
          this.hooks.changed();
          return;
        }
        if (this.element === element) this.tryNext();
      });
    }
  }

  private tryNext(): void {
    this.stopStream();
    this.candidate += 1;
    this.startStream();
    this.hooks.changed();
  }

  private stopStream(): void {
    const element = this.element;
    if (!element) return;
    element.removeEventListener("playing", this.onPlaying);
    element.removeEventListener("waiting", this.onWaiting);
    element.removeEventListener("error", this.onError);
    element.removeEventListener("stalled", this.onWaiting);
    element.pause();
    // Drop the connection, not just the sound.
    element.removeAttribute("src");
    element.load();
    this.element = null;
  }

  private readonly onPlaying = (): void => {
    this.waiting = false;
    this.hooks.changed();
  };

  private readonly onWaiting = (): void => {
    this.waiting = true;
    this.hooks.changed();
  };

  private readonly onError = (): void => {
    if (this.element) this.tryNext();
  };

  /** A hidden page pauses the radio with the rest of the sound; it comes back with the page. */
  private readonly onVisibility = (): void => {
    this.hidden = document.hidden;
    const element = this.element;
    if (!element) return;
    if (this.hidden) element.pause();
    else void element.play().catch(() => undefined);
  };
}
