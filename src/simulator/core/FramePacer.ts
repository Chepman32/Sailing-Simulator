/**
 * Caps the rendered frame rate without drifting.
 *
 * `requestAnimationFrame` follows the display: 120 Hz on a ProMotion MacBook,
 * 144 Hz on a gaming monitor. Rendering every callback would double the GPU
 * work (and the fan noise) for no visible gain, so the loop renders on a
 * fixed schedule of `1000 / maxFps` milliseconds and skips the callbacks in
 * between. The schedule advances by whole intervals, so a 144 Hz display
 * averages 60 fps instead of falling to 48, and it resynchronises after a stall
 * instead of firing a burst of catch-up frames.
 */

/** Frame rate while the page is visible and focused. */
export const ACTIVE_MAX_FPS = 60;
/** Frame rate while the page is visible but another window has the focus. */
export const UNFOCUSED_MAX_FPS = 30;
/** A callback this much before the scheduled time still renders (display jitter), ms. */
export const PACER_SLACK_MS = 2.5;

export class FramePacer {
  private next = 0;

  /** True when this animation-frame callback (at `now` ms) should render. */
  shouldRender(now: number, maxFps: number): boolean {
    const interval = 1000 / Math.max(1, maxFps);
    if (now < this.next - PACER_SLACK_MS) return false;
    // Stay on the schedule; after a stall, restart it from now.
    this.next = now - this.next > interval ? now + interval : this.next + interval;
    return true;
  }

  reset(): void {
    this.next = 0;
  }
}
