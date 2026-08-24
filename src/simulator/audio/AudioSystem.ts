import { clamp } from "../math";

export class AudioSystem {
  private context?: AudioContext;
  private master?: GainNode;
  private engineBus?: GainNode;
  private environmentBus?: GainNode;
  private wildlifeBus?: GainNode;
  private engineLow?: OscillatorNode;
  private engineHigh?: OscillatorNode;
  private engineLowGain?: GainNode;
  private engineHighGain?: GainNode;
  private waveGain?: GainNode;
  private windGain?: GainNode;
  private hullGain?: GainNode;
  private resumePromise?: Promise<void>;
  private ready = false;
  private enabled = true;
  private engineRunning = false;
  private engineMuted = false;
  private updateElapsed = 0;

  constructor(private readonly onReadyChange?: (ready: boolean) => void) {
    window.addEventListener("pointerdown", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("touchend", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("keydown", this.onUserGesture, { capture: true });
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.setBusGain(this.master, enabled ? 0.86 : 0, 0.08);
  }

  isReady(): boolean {
    return this.ready && this.context?.state === "running";
  }

  async resumeFromGesture(): Promise<void> {
    if (!this.enabled || document.hidden) return;
    if (!this.context || this.context.state === "closed") this.createGraph();
    const context = this.context;
    if (!context) return;
    if (context.state === "running") {
      this.setReady(true);
      this.setBusGain(this.master, 0.86, 0.035);
      return;
    }
    if (this.resumePromise) return this.resumePromise;

    this.resumePromise = context
      .resume()
      .then(() => {
        if (this.context !== context) return;
        const running = context.state === "running";
        this.setReady(running);
        if (running) this.setBusGain(this.master, 0.86, 0.035);
      })
      .catch(() => {
        this.setReady(false);
      })
      .finally(() => {
        this.resumePromise = undefined;
      });
    return this.resumePromise;
  }

  setEngineMuted(muted: boolean): void {
    this.engineMuted = muted;
    this.updateEngineBusGain();
  }

  setEngineRunning(running: boolean): void {
    const starting = running && !this.engineRunning;
    this.engineRunning = running;
    this.updateEngineBusGain();
    if (starting) {
      void this.resumeFromGesture().then(() => this.playEngineStartCue());
    }
  }

  update(delta: number, speed: number, throttle: number, apparentWind: number): void {
    if (!this.context || this.context.state !== "running") return;
    this.updateElapsed += delta;
    if (this.updateElapsed < 0.05) return;
    this.updateElapsed = 0;
    const now = this.context.currentTime;
    const rpm = this.engineRunning ? clamp(Math.abs(throttle) * 0.78 + speed / 44, 0, 1.25) : 0;
    this.engineLow?.frequency.setTargetAtTime(42 + rpm * 68, now, 0.12);
    this.engineHigh?.frequency.setTargetAtTime(84 + rpm * 138, now, 0.1);
    this.engineLowGain?.gain.setTargetAtTime(Math.abs(throttle) < 0.02 ? 0.034 : 0.025 + rpm * 0.055, now, 0.15);
    this.engineHighGain?.gain.setTargetAtTime(Math.abs(throttle) < 0.02 ? 0.01 : 0.008 + rpm * 0.024, now, 0.12);
    this.waveGain?.gain.setTargetAtTime(0.13 + clamp(speed / 28, 0, 1) * 0.16, now, 0.3);
    this.windGain?.gain.setTargetAtTime(0.045 + clamp(apparentWind / 18, 0, 1) * 0.13, now, 0.35);
    this.hullGain?.gain.setTargetAtTime(clamp(speed / 24, 0, 1) * 0.12, now, 0.18);
  }

  splash(intensity = 1): void {
    if (!this.context || !this.wildlifeBus || this.context.state !== "running" || !this.enabled) return;
    const source = this.context.createBufferSource();
    source.buffer = this.createNoiseBuffer(0.7);
    const filter = this.context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 850;
    filter.Q.value = 0.62;
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16 * intensity, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
    source.connect(filter).connect(gain).connect(this.wildlifeBus);
    source.start(now);
    source.stop(now + 0.65);
  }

  dispose(): void {
    window.removeEventListener("pointerdown", this.onUserGesture, true);
    window.removeEventListener("touchend", this.onUserGesture, true);
    window.removeEventListener("keydown", this.onUserGesture, true);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.context?.removeEventListener("statechange", this.handleContextStateChange);
    this.engineLow?.stop();
    this.engineHigh?.stop();
    if (this.context && this.context.state !== "closed") void this.context.close();
  }

  private readonly onUserGesture = (): void => {
    void this.resumeFromGesture();
  };

  private readonly handleVisibility = (): void => {
    if (!this.context) return;
    if (document.hidden) {
      this.setReady(false);
      void this.context.suspend();
    } else if (this.enabled) {
      void this.resumeFromGesture();
    }
  };

  private readonly handleContextStateChange = (): void => {
    const running = this.context?.state === "running";
    this.setReady(running);
    if (running) this.setBusGain(this.master, this.enabled ? 0.86 : 0, 0.04);
  };

  private createGraph(): void {
    this.context = new AudioContext({ latencyHint: "interactive" });
    this.context.addEventListener("statechange", this.handleContextStateChange);
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);
    this.engineBus = this.context.createGain();
    this.environmentBus = this.context.createGain();
    this.wildlifeBus = this.context.createGain();
    this.engineBus.connect(this.master);
    this.environmentBus.connect(this.master);
    this.wildlifeBus.connect(this.master);
    this.engineBus.gain.value = this.engineMuted || !this.engineRunning ? 0 : 1;
    this.environmentBus.gain.value = 1;
    this.wildlifeBus.gain.value = 1;

    this.engineLow = this.context.createOscillator();
    this.engineLow.type = "sawtooth";
    this.engineLowGain = this.context.createGain();
    this.engineLowGain.gain.value = 0.01;
    const engineLowPass = this.context.createBiquadFilter();
    engineLowPass.type = "lowpass";
    engineLowPass.frequency.value = 390;
    this.engineLow.connect(this.engineLowGain).connect(engineLowPass).connect(this.engineBus);
    this.engineLow.start();

    this.engineHigh = this.context.createOscillator();
    this.engineHigh.type = "triangle";
    this.engineHighGain = this.context.createGain();
    this.engineHighGain.gain.value = 0.003;
    this.engineHigh.connect(this.engineHighGain).connect(this.engineBus);
    this.engineHigh.start();

    const noiseBuffer = this.createNoiseBuffer(2);
    const waves = this.context.createBufferSource();
    waves.buffer = noiseBuffer;
    waves.loop = true;
    const waveFilter = this.context.createBiquadFilter();
    waveFilter.type = "lowpass";
    waveFilter.frequency.value = 720;
    waveFilter.Q.value = 0.45;
    this.waveGain = this.context.createGain();
    this.waveGain.gain.value = 0.12;
    waves.connect(waveFilter).connect(this.waveGain).connect(this.environmentBus);
    waves.start();

    const wind = this.context.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    wind.playbackRate.value = 0.77;
    const windFilter = this.context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 1450;
    windFilter.Q.value = 0.38;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(windFilter).connect(this.windGain).connect(this.environmentBus);
    wind.start(0, 0.41);

    const hull = this.context.createBufferSource();
    hull.buffer = noiseBuffer;
    hull.loop = true;
    hull.playbackRate.value = 1.22;
    const hullFilter = this.context.createBiquadFilter();
    hullFilter.type = "bandpass";
    hullFilter.frequency.value = 510;
    hullFilter.Q.value = 0.9;
    this.hullGain = this.context.createGain();
    this.hullGain.gain.value = 0;
    hull.connect(hullFilter).connect(this.hullGain).connect(this.environmentBus);
    hull.start(0, 1.13);
    this.setReady(this.context.state === "running");
  }

  private playEngineStartCue(): void {
    if (!this.context || !this.engineBus || this.context.state !== "running" || !this.enabled || this.engineMuted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(34, now);
    oscillator.frequency.exponentialRampToValueAtTime(82, now + 0.24);
    oscillator.frequency.exponentialRampToValueAtTime(54, now + 0.78);
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 360;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.095, now + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.82);
    oscillator.connect(filter).connect(gain).connect(this.engineBus);
    oscillator.start(now);
    oscillator.stop(now + 0.86);
  }

  private createNoiseBuffer(duration: number): AudioBuffer {
    if (!this.context) throw new Error("AudioContext is required before creating audio buffers.");
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      samples[index] = brown * 3.2;
    }
    return buffer;
  }

  private setBusGain(node: GainNode | undefined, value: number, timeConstant: number): void {
    if (!node || !this.context) return;
    node.gain.setTargetAtTime(value, this.context.currentTime, timeConstant);
  }

  private updateEngineBusGain(): void {
    this.setBusGain(this.engineBus, this.engineMuted || !this.engineRunning ? 0 : 1, 0.06);
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) return;
    this.ready = ready;
    this.onReadyChange?.(ready);
  }
}
