import { clamp } from "../math";

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type NoiseColor = "brown" | "pink" | "white";

const MASTER_GAIN = 0.94;
const ENGINE_BUS_GAIN = 1.35;
const ENGINE_ENVIRONMENT_DUCK = 0.68;
const RESUME_RETRY_MS = 850;

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
  private engineNoiseGain?: GainNode;
  private waveGain?: GainNode;
  private windGain?: GainNode;
  private hullGain?: GainNode;
  private resumePromise?: Promise<boolean>;
  private ready = false;
  private enabled = true;
  private engineRunning = false;
  private engineMuted = false;
  private updateElapsed = 0;

  constructor(private readonly onReadyChange?: (ready: boolean) => void) {
    window.addEventListener("pointerdown", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("mousedown", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("touchstart", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("click", this.onUserGesture, { passive: true, capture: true });
    window.addEventListener("keydown", this.onUserGesture, { capture: true });
    window.addEventListener("pagehide", this.handlePageHide);
    window.addEventListener("pageshow", this.handlePageShow);
    window.addEventListener("focus", this.handlePageShow);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.setBusGain(this.master, enabled ? MASTER_GAIN : 0, 0.08);
  }

  isReady(): boolean {
    return this.ready && this.context?.state === "running";
  }

  async resumeFromGesture(): Promise<boolean> {
    if (!this.enabled || document.hidden) return false;
    if (!this.context || this.context.state === "closed") {
      try {
        this.createGraph();
        this.playUnlockImpulse();
      } catch (error) {
        console.warn("Audio output could not be initialized.", error);
        this.setReady(false);
        return false;
      }
    }
    const context = this.context;
    if (!context) return false;
    if (context.state === "running") {
      this.setReady(true);
      this.setBusGain(this.master, MASTER_GAIN, 0.035);
      return true;
    }
    if (this.resumePromise) return this.resumePromise;

    let timeoutId = 0;
    const resumeAttempt = context.resume().then(() => context.state === "running").catch(() => false);
    const retryTimeout = new Promise<boolean>((resolve) => {
      timeoutId = window.setTimeout(() => resolve(context.state === "running"), RESUME_RETRY_MS);
    });
    // WebKit can leave resume() pending while the page transitions out of an
    // interrupted state. The timeout releases the lock so the next trusted
    // gesture gets a fresh resume attempt instead of reusing a stuck promise.
    this.resumePromise = Promise.race([resumeAttempt, retryTimeout])
      .then((running) => {
        if (this.context !== context) return false;
        this.setReady(running);
        if (running) this.setBusGain(this.master, MASTER_GAIN, 0.035);
        return running;
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
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
    this.engineLow?.frequency.setTargetAtTime(88 + rpm * 112, now, 0.12);
    this.engineHigh?.frequency.setTargetAtTime(176 + rpm * 224, now, 0.1);
    this.engineLowGain?.gain.setTargetAtTime(Math.abs(throttle) < 0.02 ? 0.085 : 0.08 + rpm * 0.12, now, 0.15);
    this.engineHighGain?.gain.setTargetAtTime(Math.abs(throttle) < 0.02 ? 0.028 : 0.025 + rpm * 0.06, now, 0.12);
    this.engineNoiseGain?.gain.setTargetAtTime(Math.abs(throttle) < 0.02 ? 0.024 : 0.022 + rpm * 0.055, now, 0.14);
    this.waveGain?.gain.setTargetAtTime(0.24 + clamp(speed / 28, 0, 1) * 0.2, now, 0.3);
    this.windGain?.gain.setTargetAtTime(0.1 + clamp(apparentWind / 18, 0, 1) * 0.17, now, 0.35);
    this.hullGain?.gain.setTargetAtTime(clamp(speed / 18, 0, 1) * 0.18, now, 0.18);
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
    window.removeEventListener("mousedown", this.onUserGesture, true);
    window.removeEventListener("touchstart", this.onUserGesture, true);
    window.removeEventListener("click", this.onUserGesture, true);
    window.removeEventListener("keydown", this.onUserGesture, true);
    window.removeEventListener("pagehide", this.handlePageHide);
    window.removeEventListener("pageshow", this.handlePageShow);
    window.removeEventListener("focus", this.handlePageShow);
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
      void this.context.suspend().catch(() => undefined);
    } else {
      // Resuming from visibilitychange is not a trusted gesture on Safari.
      // Leave the graph pending; the next pointer, touch, or key event will
      // resume it through the capture listeners installed in the constructor.
      this.setReady(this.context.state === "running");
    }
  };

  private readonly handlePageHide = (): void => {
    if (!this.context || this.context.state === "closed") return;
    this.setReady(false);
    void this.context.suspend().catch(() => undefined);
  };

  private readonly handlePageShow = (): void => {
    this.setReady(this.context?.state === "running");
  };

  private readonly handleContextStateChange = (): void => {
    const running = this.context?.state === "running";
    this.setReady(running);
    if (running) this.setBusGain(this.master, this.enabled ? MASTER_GAIN : 0, 0.04);
  };

  private createGraph(): void {
    const AudioContextConstructor = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is unavailable in this browser.");
    try {
      this.context = new AudioContextConstructor({ latencyHint: "interactive" });
    } catch {
      // Older WebKit versions expose AudioContext but reject options.
      this.context = new AudioContextConstructor();
    }
    this.context.addEventListener("statechange", this.handleContextStateChange);
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 14;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.24;
    this.master.connect(compressor).connect(this.context.destination);
    this.engineBus = this.context.createGain();
    this.environmentBus = this.context.createGain();
    this.wildlifeBus = this.context.createGain();
    this.engineBus.connect(this.master);
    this.environmentBus.connect(this.master);
    this.wildlifeBus.connect(this.master);
    const engineAudible = this.engineRunning && !this.engineMuted;
    this.engineBus.gain.value = engineAudible ? ENGINE_BUS_GAIN : 0;
    this.environmentBus.gain.value = engineAudible ? ENGINE_ENVIRONMENT_DUCK : 1;
    this.wildlifeBus.gain.value = 1;

    this.engineLow = this.context.createOscillator();
    this.engineLow.type = "sawtooth";
    this.engineLowGain = this.context.createGain();
    this.engineLowGain.gain.value = 0.085;
    const engineLowPass = this.context.createBiquadFilter();
    engineLowPass.type = "lowpass";
    engineLowPass.frequency.value = 920;
    this.engineLow.connect(this.engineLowGain).connect(engineLowPass).connect(this.engineBus);
    this.engineLow.start();

    this.engineHigh = this.context.createOscillator();
    this.engineHigh.type = "triangle";
    this.engineHighGain = this.context.createGain();
    this.engineHighGain.gain.value = 0.028;
    this.engineHigh.connect(this.engineHighGain).connect(this.engineBus);
    this.engineHigh.start();

    const engineNoise = this.context.createBufferSource();
    engineNoise.buffer = this.createNoiseBuffer(4.1, "pink");
    engineNoise.loop = true;
    engineNoise.playbackRate.value = 0.83;
    const engineNoiseFilter = this.context.createBiquadFilter();
    engineNoiseFilter.type = "bandpass";
    engineNoiseFilter.frequency.value = 410;
    engineNoiseFilter.Q.value = 0.72;
    this.engineNoiseGain = this.context.createGain();
    this.engineNoiseGain.gain.value = 0.024;
    engineNoise.connect(engineNoiseFilter).connect(this.engineNoiseGain).connect(this.engineBus);
    engineNoise.start(0, 0.37);

    const waveNoise = this.createNoiseBuffer(5.3, "pink");
    const waves = this.context.createBufferSource();
    waves.buffer = waveNoise;
    waves.loop = true;
    const waveFilter = this.context.createBiquadFilter();
    waveFilter.type = "lowpass";
    waveFilter.frequency.value = 1100;
    waveFilter.Q.value = 0.45;
    this.waveGain = this.context.createGain();
    this.waveGain.gain.value = 0.24;
    waves.connect(waveFilter).connect(this.waveGain).connect(this.environmentBus);
    waves.start();

    const wind = this.context.createBufferSource();
    wind.buffer = this.createNoiseBuffer(4.7, "white");
    wind.loop = true;
    wind.playbackRate.value = 0.77;
    const windFilter = this.context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 1650;
    windFilter.Q.value = 0.46;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.1;
    wind.connect(windFilter).connect(this.windGain).connect(this.environmentBus);
    wind.start(0, 0.41);

    const hull = this.context.createBufferSource();
    hull.buffer = this.createNoiseBuffer(3.7, "pink");
    hull.loop = true;
    hull.playbackRate.value = 1.22;
    const hullFilter = this.context.createBiquadFilter();
    hullFilter.type = "bandpass";
    hullFilter.frequency.value = 620;
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
    oscillator.frequency.setValueAtTime(68, now);
    oscillator.frequency.exponentialRampToValueAtTime(158, now + 0.24);
    oscillator.frequency.exponentialRampToValueAtTime(104, now + 0.78);
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 680;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.82);
    oscillator.connect(filter).connect(gain).connect(this.engineBus);
    oscillator.start(now);
    oscillator.stop(now + 0.86);
  }

  private playUnlockImpulse(): void {
    if (!this.context) return;
    const source = this.context.createBufferSource();
    source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    source.buffer.getChannelData(0)[0] = 1;
    const almostSilent = this.context.createGain();
    almostSilent.gain.value = 0.0001;
    source.connect(almostSilent).connect(this.context.destination);
    source.start(this.context.currentTime);
  }

  private createNoiseBuffer(duration: number, color: NoiseColor = "brown"): AudioBuffer {
    if (!this.context) throw new Error("AudioContext is required before creating audio buffers.");
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let brown = 0;
    let pink0 = 0;
    let pink1 = 0;
    let pink2 = 0;
    let pink3 = 0;
    let pink4 = 0;
    let pink5 = 0;
    let pink6 = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      if (color === "white") {
        samples[index] = white * 0.36;
      } else if (color === "pink") {
        pink0 = 0.99886 * pink0 + white * 0.0555179;
        pink1 = 0.99332 * pink1 + white * 0.0750759;
        pink2 = 0.969 * pink2 + white * 0.153852;
        pink3 = 0.8665 * pink3 + white * 0.3104856;
        pink4 = 0.55 * pink4 + white * 0.5329522;
        pink5 = -0.7616 * pink5 - white * 0.016898;
        samples[index] = (pink0 + pink1 + pink2 + pink3 + pink4 + pink5 + pink6 + white * 0.5362) * 0.08;
        pink6 = white * 0.115926;
      } else {
        brown = (brown + 0.02 * white) / 1.02;
        samples[index] = brown * 3.2;
      }
    }
    return buffer;
  }

  private setBusGain(node: GainNode | undefined, value: number, timeConstant: number): void {
    if (!node || !this.context) return;
    node.gain.setTargetAtTime(value, this.context.currentTime, timeConstant);
  }

  private updateEngineBusGain(): void {
    const engineAudible = this.engineRunning && !this.engineMuted;
    this.setBusGain(this.engineBus, engineAudible ? ENGINE_BUS_GAIN : 0, 0.045);
    // Ambient audio remains present, but it ducks slightly while the engine is
    // running so its RPM layers are distinct on small mobile speakers.
    this.setBusGain(this.environmentBus, engineAudible ? ENGINE_ENVIRONMENT_DUCK : 1, 0.12);
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) return;
    this.ready = ready;
    this.onReadyChange?.(ready);
  }
}
