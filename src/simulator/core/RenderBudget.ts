/**
 * How many pixels to render, and how hard to let the GPU work.
 *
 * A frame that arrives on time can still keep the GPU busy for most of the
 * frame interval; a laptop then runs at 60 fps with its fans at full speed.
 * Two limits keep the work proportionate to what is seen:
 *
 * - a pixel budget per preset: the drawing buffer never holds more than that
 *   many pixels, whatever the window size and device pixel ratio (a Retina
 *   laptop at full screen would otherwise shade four to five million pixels,
 *   most of them invisible detail in noise-like water);
 * - a GPU-time governor: where the browser can time GPU work, the render
 *   scale is eased down while a frame costs more than its target, and back
 *   up when there is room, so the GPU idles for part of each frame;
 * - a frame-rate governor where it cannot (Safari on iPhone and iPad): the
 *   render scale follows the frame rate itself, and a step down that buys no
 *   frames (the CPU, not the GPU, holds the frame back) is undone.
 *
 * Everything here is pure; `GpuTimer` supplies the measurements.
 */

/** GPU time a frame may take, ms: about half of a 60 Hz frame. */
export const GPU_TARGET_MS = 8.5;
/**
 * GPU time the render scale is eased toward on every preset, ms: two thirds
 * of a 60 Hz frame, the rest left for the browser's compositing and spikes.
 * The game holds 60 fps first and resolution second.
 */
export const AUTO_GPU_TARGET_MS = 11;
/** Auto steps the level down when the frame rate stays below this, once the resolution cannot drop further. */
export const AUTO_SLOW_FPS = 50;
/** Lowest render scale the governors use before handing over to the presets. */
export const MIN_RENDER_SCALE = 0.55;
/** Shortest time between two resolution changes, s (targets are reallocated). */
export const SCALE_CHANGE_INTERVAL = 2.5;

/**
 * Device pixel ratio to render at: the device's own, limited by the preset's
 * ratio, by its pixel budget for this canvas size, and by the governor's scale.
 */
export function budgetPixelRatio(
  devicePixelRatio: number,
  maxDpr: number,
  pixelBudget: number,
  cssWidth: number,
  cssHeight: number,
  scale = 1,
): number {
  const device = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const area = Math.max(1, cssWidth) * Math.max(1, cssHeight);
  const budgetRatio = Math.sqrt(Math.max(1, pixelBudget) / area);
  const ratio = Math.min(device, maxDpr, budgetRatio) * Math.min(1, Math.max(MIN_RENDER_SCALE, scale));
  // Never below half a pixel per CSS pixel: past that the scene turns to mush.
  return Math.max(0.5, ratio);
}

export type GovernorVerdict = "steady" | "scaled" | "overloaded" | "idle";

/**
 * Eases the render scale toward the GPU-time target. `observe` takes the GPU
 * time of one frame and returns whether the scale changed this call, whether
 * the GPU is overloaded even at the lowest scale (step the preset down), or
 * idle at full scale with plenty of room (a higher preset may fit).
 */
export class GpuGovernor {
  scale = 1;
  /** Smoothed GPU time per frame, ms; NaN until measured. */
  smoothed = Number.NaN;
  private lastChange = -Infinity;
  private overloadTime = 0;
  private idleTime = 0;

  constructor(public target = GPU_TARGET_MS) {}

  observe(gpuMs: number, now: number, delta: number): GovernorVerdict {
    if (!Number.isFinite(gpuMs) || gpuMs < 0) return "steady";
    this.smoothed = Number.isNaN(this.smoothed) ? gpuMs : this.smoothed + (gpuMs - this.smoothed) * 0.08;
    const load = this.smoothed / this.target;
    const step = Math.max(0, Math.min(delta, 1));
    this.overloadTime = load > 1.25 && this.scale <= MIN_RENDER_SCALE + 1e-6 ? this.overloadTime + step : 0;
    this.idleTime = load < 0.5 && this.scale >= 1 ? this.idleTime + step : 0;
    if (this.overloadTime > 6) {
      this.overloadTime = 0;
      return "overloaded";
    }
    if (this.idleTime > 25) {
      this.idleTime = 0;
      return "idle";
    }
    if (now - this.lastChange < SCALE_CHANGE_INTERVAL) return "steady";
    // Shaded pixels go with the square of the scale.
    let next = this.scale;
    if (load > 1.12) next = Math.max(MIN_RENDER_SCALE, this.scale * Math.max(0.85, Math.sqrt(1 / load)));
    else if (load < 0.72) next = Math.min(1, this.scale * 1.06);
    if (Math.abs(next - this.scale) < 0.02 && !(next === 1 && this.scale < 1)) return "steady";
    this.scale = next;
    this.lastChange = now;
    return "scaled";
  }

  /** After a preset change the old measurements no longer apply. */
  reset(): void {
    this.scale = 1;
    this.smoothed = Number.NaN;
    this.lastChange = -Infinity;
    this.overloadTime = 0;
    this.idleTime = 0;
  }
}

/** Frame-rate windows (0.75 s each) ignored after start-up or a preset change, while shaders compile. */
export const FPS_WARMUP_WINDOWS = 6;

export type FpsReading = "slow" | "fast" | "neutral" | "ignored";

/**
 * Judges frame-rate windows for the preset fallback (where GPU time cannot be
 * measured). A window only counts when it says something about the GPU:
 * - not while the page is paced below 60 fps on purpose (another window has
 *   the focus, e.g. while the player takes a screenshot): 30 fps there is the
 *   pacer's choice, not a slow GPU;
 * - not in the first seconds after start-up or a preset change, when shader
 *   compilation and uploads stall frames that will never stall again.
 * Without these, a session dropped from high to low within three seconds of
 * the player switching to another app, and stayed there.
 */
export class FpsJudge {
  private warmup = FPS_WARMUP_WINDOWS;

  constructor(private readonly slowBelow: number, private readonly fastAbove = 58) {}

  reset(): void {
    this.warmup = FPS_WARMUP_WINDOWS;
  }

  observe(fps: number, frameCap: number): FpsReading {
    if (this.warmup > 0) {
      this.warmup -= 1;
      return "ignored";
    }
    if (!Number.isFinite(fps) || frameCap < 50) return "ignored";
    if (fps < this.slowBelow) return "slow";
    if (fps > this.fastAbove) return "fast";
    return "neutral";
  }
}

/** Steps of the frame-rate governor's scale (each change reallocates the render targets). */
const FRAME_SCALE_QUANTUM = 0.025;

function quantizeScale(scale: number): number {
  return Math.round(scale / FRAME_SCALE_QUANTUM) * FRAME_SCALE_QUANTUM;
}

/**
 * Holds 60 fps by the render scale alone, from frame-rate windows (about
 * 0.75 s each), for browsers that cannot time GPU work. Below about 54 fps
 * the scale steps down in proportion to the shortfall (pixels go with its
 * square); after a few seconds at a full frame rate it creeps back up, but
 * not to a scale that was too slow in the last 20 s. A step down that does
 * not raise the frame rate is undone and the scale is held there for 30 s:
 * the CPU is the limit, and a blurrier picture would gain nothing.
 * `atFloor` tells the presets that resolution has nothing more to give.
 */
export class FrameRateGovernor {
  scale = 1;
  private skip = 2;
  private fastSince = Number.NaN;
  private lastChange = -Infinity;
  private ceiling = 1;
  private ceilingUntil = -Infinity;
  private probe: { from: number; fps: number; at: number } | null = null;
  private floor = MIN_RENDER_SCALE;
  private floorUntil = -Infinity;

  /** Whether the scale is as low as it may go now (the frame rate is then the presets' business). */
  atFloorAt(now: number): boolean {
    return this.scale <= this.floorAt(now) + 1e-6;
  }

  /** The next windows say nothing about the GPU (a resize, a page coming back). */
  pause(windows = 2): void {
    this.skip = Math.max(this.skip, windows);
    this.fastSince = Number.NaN;
    this.probe = null;
  }

  reset(): void {
    this.scale = 1;
    this.skip = 2;
    this.fastSince = Number.NaN;
    this.lastChange = -Infinity;
    this.ceiling = 1;
    this.ceilingUntil = -Infinity;
    this.probe = null;
    this.floorUntil = -Infinity;
  }

  observe(fps: number, frameCap: number, now: number): "steady" | "scaled" {
    if (!Number.isFinite(fps) || fps <= 0 || frameCap < 50) return "steady";
    if (this.skip > 0) {
      this.skip -= 1;
      return "steady";
    }
    const slow = fps < frameCap * 0.9;
    const fast = fps >= frameCap * 0.96;
    // Did the last step down buy frames? If not, put the pixels back.
    if (this.probe && now - this.probe.at >= 1.4) {
      const probe = this.probe;
      this.probe = null;
      if (!fast && fps < probe.fps * 1.04) {
        this.scale = probe.from;
        this.floor = probe.from;
        this.floorUntil = now + 30;
        this.lastChange = now;
        this.skip = 1;
        return "scaled";
      }
    }
    if (slow) {
      this.fastSince = Number.NaN;
      const floor = this.floorAt(now);
      if (this.scale <= floor + 1e-6 || now - this.lastChange < 1.2) return "steady";
      const factor = Math.min(0.94, Math.max(0.75, Math.sqrt(fps / frameCap) * 0.97));
      const next = Math.max(floor, quantizeScale(this.scale * factor));
      if (next >= this.scale - 1e-6) return "steady";
      this.ceiling = this.scale;
      this.ceilingUntil = now + 20;
      this.probe = { from: this.scale, fps, at: now };
      this.scale = next;
      this.lastChange = now;
      this.skip = 1;
      return "scaled";
    }
    if (!fast) {
      this.fastSince = Number.NaN;
      return "steady";
    }
    if (Number.isNaN(this.fastSince)) this.fastSince = now;
    if (this.scale >= 1 || now - this.fastSince < 4 || now - this.lastChange < 3) return "steady";
    let next = Math.min(1, quantizeScale(this.scale * 1.08));
    if (now < this.ceilingUntil) next = Math.min(next, quantizeScale(this.ceiling - 0.05));
    if (next <= this.scale + 0.01) return "steady";
    this.scale = next;
    this.fastSince = Number.NaN;
    this.lastChange = now;
    this.skip = 1;
    return "scaled";
  }

  private floorAt(now: number): number {
    return now < this.floorUntil ? this.floor : MIN_RENDER_SCALE;
  }
}
