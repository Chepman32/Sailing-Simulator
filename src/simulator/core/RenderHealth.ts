/**
 * Decides whether the picture on the canvas is still alive.
 *
 * A frame can fail without any error being thrown: the GPU context is lost
 * and never comes back (a phone that swapped apps, a laptop that switched
 * graphics), or one render target is poisoned and the whole view turns into a
 * single flat colour while the HUD keeps running. These helpers are pure so
 * the policy can be tested; `Simulator` feeds them readings.
 */

/** A colour read back from the canvas, 0…255 per channel. */
export type PixelSample = readonly [number, number, number];

/** Largest per-channel spread between probes at which a frame counts as one flat colour. */
export const FLAT_TOLERANCE = 2;

/** Consecutive flat readings before the view is rebuilt (readings are about 1.5 s apart). */
export const FLAT_READINGS_TO_REBUILD = 3;

/** A lost context that has not come back after this long is asked to restore, seconds. */
export const RESTORE_AFTER = 1.5;

/** After this long without a restored context the page must be reloaded, seconds. */
export const RELOAD_AFTER = 8;

/** Whether every probe is the same colour: no real frame (sky above sea) looks like that. */
export function isFlatFrame(samples: readonly PixelSample[]): boolean {
  if (samples.length < 3) return false;
  for (let channel = 0; channel < 3; channel += 1) {
    let low = Infinity;
    let high = -Infinity;
    for (const sample of samples) {
      low = Math.min(low, sample[channel]!);
      high = Math.max(high, sample[channel]!);
    }
    if (high - low > FLAT_TOLERANCE) return false;
  }
  return true;
}

export type RecoveryStep = "none" | "restore" | "reload";

/** What to do about a context that has been lost for `lostFor` seconds. */
export function contextRecovery(lostFor: number, restoreRequested: boolean): RecoveryStep {
  if (lostFor >= RELOAD_AFTER) return "reload";
  if (lostFor >= RESTORE_AFTER && !restoreRequested) return "restore";
  return "none";
}

/** Counts flat readings in a row; `true` when it is time to rebuild the view. */
export class FlatFrameWatch {
  private streak = 0;

  observe(samples: readonly PixelSample[]): boolean {
    if (!isFlatFrame(samples)) {
      this.streak = 0;
      return false;
    }
    this.streak += 1;
    if (this.streak < FLAT_READINGS_TO_REBUILD) return false;
    this.streak = 0;
    return true;
  }

  reset(): void {
    this.streak = 0;
  }
}

/** A position, look-at point and field of view that a camera can safely use. */
export function isUsablePose(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value) && Math.abs(value) < 1e7);
}

/**
 * When the canvas may be resized.
 *
 * Giving a canvas a size (even the size it has) empties it. If that happens
 * after the frame's draw, the browser shows the emptied canvas: the page's
 * dark background with the interface over it, until the next frame is
 * drawn. That is one frame when all is well, but seconds when the next
 * frame has work to do first: a quality preset just changed (every shader
 * compiles again), the view was rebuilt, or the loop is being paced. And
 * resizes used to come exactly then, after the draw: the frame-rate
 * governor changing the resolution, the automatic quality changing the
 * preset, the watchdog rebuilding the view.
 *
 * So the canvas is only ever resized in the task that goes on to draw it:
 * a request made between the start of a frame and its draw is applied at
 * once; one made at any other time waits for the start of the next frame.
 * Before the first frame (loading, nothing on the canvas yet) every request
 * is applied at once.
 */
export class CanvasSizeGate {
  private live = false;
  private beforeDraw = false;
  private pending = false;

  /** The loop is about to start: from now on the canvas has a picture to keep. */
  goLive(): void {
    this.live = true;
  }

  /** A resize is wanted. True: apply it now. False: it is kept for the start of the next frame. */
  request(): boolean {
    if (!this.live || this.beforeDraw) return true;
    this.pending = true;
    return false;
  }

  /** A frame begins. True if a resize was kept for it (apply it now, before drawing). */
  beginFrame(): boolean {
    this.beforeDraw = true;
    const pending = this.pending;
    this.pending = false;
    return pending;
  }

  /** The frame's picture is on the canvas: no more resizing until the next frame. */
  drawn(): void {
    this.beforeDraw = false;
  }

  get waiting(): boolean {
    return this.pending;
  }
}

