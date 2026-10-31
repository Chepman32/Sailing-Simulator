import { ACTIVE_MAX_FPS, FramePacer, UNFOCUSED_MAX_FPS } from "./FramePacer";

export type FrameCallbacks = {
  fixedUpdate: (fixedDelta: number) => void;
  /** `alpha`: how far the clock is from the last fixed step to the next, 0…1. */
  update: (delta: number, elapsed: number, alpha: number) => void;
  render: () => void;
  onFps?: (fps: number, frameCap: number) => void;
  onPauseChange?: (paused: boolean) => void;
};

export class RenderLoop {
  readonly fixedDelta = 1 / 60;
  private accumulator = 0;
  private elapsed = 0;
  private frame = 0;
  private running = false;
  private lastTime = 0;
  private fpsElapsed = 0;
  private fpsFrames = 0;
  private pausedByVisibility = document.hidden;
  private readonly pacer = new FramePacer();

  constructor(private readonly callbacks: FrameCallbacks) {
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  dispose(): void {
    this.stop();
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }

  /** Errors already reported (each once), so a fault repeated every frame does not flood the console. */
  private readonly reported = new Set<string>();

  private guard(stage: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      const message = `${stage}: ${error instanceof Error ? error.message : String(error)}`;
      if (this.reported.has(message)) return;
      this.reported.add(message);
      console.error(`Frame ${stage} failed; the loop carries on.`, error);
    }
  }

  private readonly handleVisibility = (): void => {
    this.pausedByVisibility = document.hidden;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.pacer.reset();
    this.callbacks.onPauseChange?.(this.pausedByVisibility);
  };

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);
    if (this.pausedByVisibility) return;
    // Render at most 60 times a second whatever the display's refresh rate, and
    // half as often while another window has the focus.
    if (!this.pacer.shouldRender(now, document.hasFocus() ? ACTIVE_MAX_FPS : UNFOCUSED_MAX_FPS)) return;

    const unclamped = (now - this.lastTime) / 1000;
    const delta = Math.min(0.05, Math.max(0, unclamped));
    this.lastTime = now;
    this.elapsed += delta;
    this.accumulator = Math.min(this.accumulator + delta, this.fixedDelta * 5);

    let steps = 0;
    while (this.accumulator >= this.fixedDelta && steps < 5) {
      this.guard("fixed update", () => this.callbacks.fixedUpdate(this.fixedDelta));
      this.accumulator -= this.fixedDelta;
      steps += 1;
    }

    // A failing system must not freeze the picture: each stage is guarded on
    // its own, so a fault in one (an update) still lets the frame be drawn.
    this.guard("update", () => this.callbacks.update(delta, this.elapsed, this.accumulator / this.fixedDelta));
    this.guard("render", () => this.callbacks.render());

    this.fpsElapsed += delta;
    this.fpsFrames += 1;
    if (this.fpsElapsed >= 0.75) {
      this.callbacks.onFps?.(this.fpsFrames / this.fpsElapsed, document.hasFocus() ? ACTIVE_MAX_FPS : UNFOCUSED_MAX_FPS);
      this.fpsElapsed = 0;
      this.fpsFrames = 0;
    }
  };
}
