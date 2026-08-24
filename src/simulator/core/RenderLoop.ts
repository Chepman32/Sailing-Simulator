export type FrameCallbacks = {
  fixedUpdate: (fixedDelta: number) => void;
  update: (delta: number, elapsed: number) => void;
  render: () => void;
  onFps?: (fps: number) => void;
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

  private readonly handleVisibility = (): void => {
    this.pausedByVisibility = document.hidden;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.callbacks.onPauseChange?.(this.pausedByVisibility);
  };

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);
    if (this.pausedByVisibility) return;

    const unclamped = (now - this.lastTime) / 1000;
    const delta = Math.min(0.05, Math.max(0, unclamped));
    this.lastTime = now;
    this.elapsed += delta;
    this.accumulator = Math.min(this.accumulator + delta, this.fixedDelta * 5);

    let steps = 0;
    while (this.accumulator >= this.fixedDelta && steps < 5) {
      this.callbacks.fixedUpdate(this.fixedDelta);
      this.accumulator -= this.fixedDelta;
      steps += 1;
    }

    this.callbacks.update(delta, this.elapsed);
    this.callbacks.render();

    this.fpsElapsed += delta;
    this.fpsFrames += 1;
    if (this.fpsElapsed >= 0.75) {
      this.callbacks.onFps?.(this.fpsFrames / this.fpsElapsed);
      this.fpsElapsed = 0;
      this.fpsFrames = 0;
    }
  };
}
