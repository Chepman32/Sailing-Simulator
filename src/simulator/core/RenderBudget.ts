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
 *   scale is eased down while a frame costs more than `GPU_TARGET_MS`, and
 *   back up when there is room, so the GPU idles for most of each frame.
 *
 * Everything here is pure; `GpuTimer` supplies the measurements.
 */

/** GPU time a frame may take, ms: about 40 % of a 60 Hz frame. */
export const GPU_TARGET_MS = 6.5;
/** Lowest render scale the governor uses before handing over to the presets. */
export const MIN_RENDER_SCALE = 0.7;
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

  constructor(private readonly target = GPU_TARGET_MS) {}

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
