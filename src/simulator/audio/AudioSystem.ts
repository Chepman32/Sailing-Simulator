import { clamp } from "../math";
import {
  BELL_PARTIALS,
  BELL_STRIKE_HZ,
  HORN_PROFILES,
  airAbsorptionCutoff,
  type HornKind,
  type SpatialPoint,
} from "./AudioMath";

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type NoiseColor = "brown" | "pink" | "white";

const MASTER_GAIN = 0.94;
const ENGINE_BUS_GAIN = 1.35;
const ENGINE_ENVIRONMENT_DUCK = 0.68;
const RESUME_RETRY_MS = 850;
/** Wind was perceived as too loud; it now sits at half its former level. */
const WIND_LEVEL = 0.5;
const EFFECTS_BUS_GAIN = 1.1;

export type AmbientLoopKind = "party" | "volcano" | "monolith";

/** A moving positional source (e.g. a burning flare) that the caller updates. */
export type SpatialHandle = {
  setPosition: (position: SpatialPoint) => void;
  stop: (fadeSeconds?: number) => void;
};

type AmbientLoop = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode;
  level: number;
};

export class AudioSystem {
  private context?: AudioContext;
  private master?: GainNode;
  private engineBus?: GainNode;
  private environmentBus?: GainNode;
  private wildlifeBus?: GainNode;
  private effectsBus?: GainNode;
  private reverbSend?: GainNode;
  private noiseCache = new Map<string, AudioBuffer>();
  private readonly ambientLoops = new Map<AmbientLoopKind, AmbientLoop>();
  private readonly ambientTargets = new Map<AmbientLoopKind, { position: SpatialPoint; level: number }>();
  private readonly listenerPosition = { x: 0, y: 2, z: -10 };
  private readonly listenerForward = { x: 0, y: 0, z: 1 };
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
    this.windGain?.gain.setTargetAtTime((0.1 + clamp(apparentWind / 18, 0, 1) * 0.17) * WIND_LEVEL, now, 0.35);
    this.hullGain?.gain.setTargetAtTime(clamp(speed / 18, 0, 1) * 0.18, now, 0.18);
    this.applyListener(now);
    this.refreshAmbientLoops(now);
  }

  /** Camera pose; every positional sound is heard from here. */
  setListener(position: SpatialPoint, forward: SpatialPoint): void {
    this.listenerPosition.x = position.x;
    this.listenerPosition.y = position.y;
    this.listenerPosition.z = position.z;
    this.listenerForward.x = forward.x;
    this.listenerForward.y = forward.y;
    this.listenerForward.z = forward.z;
  }

  /**
   * Request a looping positional ambience. `level` 0 fades it out; the loop is
   * only created once it is near enough to matter.
   */
  setAmbient(kind: AmbientLoopKind, position: SpatialPoint, level: number): void {
    this.ambientTargets.set(kind, { position: { ...position }, level });
  }

  /** Two strikes of the ship's bell ("ding-ding"), heard from the camera. */
  playBell(position: SpatialPoint): void {
    const context = this.liveContext();
    if (!context || !this.effectsBus) return;
    const output = this.spatialOutput(position, { refDistance: 2.5, rolloff: 1.3, reverb: 0.22 });
    const now = context.currentTime + 0.01;
    [0, 0.38].forEach((offset, strike) => {
      const start = now + offset;
      const level = strike === 0 ? 1 : 0.86;
      for (const [ratio, gainLevel, decay] of BELL_PARTIALS) {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = BELL_STRIKE_HZ * ratio * (1 + (Math.random() - 0.5) * 0.002);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(gainLevel * level * 0.5, start + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
        oscillator.connect(gain).connect(output);
        oscillator.start(start);
        oscillator.stop(start + decay + 0.05);
      }
      // Metallic clapper transient.
      const click = context.createBufferSource();
      click.buffer = this.noise(0.05, "white");
      const highpass = context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 3200;
      const clickGain = context.createGain();
      clickGain.gain.setValueAtTime(0.5 * level, start);
      clickGain.gain.exponentialRampToValueAtTime(0.001, start + 0.035);
      click.connect(highpass).connect(clickGain).connect(output);
      click.start(start);
      click.stop(start + 0.06);
    });
  }

  /**
   * A prolonged ship's horn blast: detuned sawtooth harmonics with the slight
   * pitch rise of an air horn, a brassy formant, soft saturation and a long
   * sea-surface echo. Air absorption darkens it with distance.
   */
  playHorn(position: SpatialPoint, kind: HornKind): void {
    const context = this.liveContext();
    if (!context || !this.effectsBus) return;
    const profile = HORN_PROFILES[kind];
    const output = this.spatialOutput(position, { refDistance: 140, rolloff: 0.9, reverb: 0.55 });
    const now = context.currentTime + 0.02;
    const end = now + profile.duration;
    const voice = context.createGain();
    voice.gain.setValueAtTime(0.0001, now);
    voice.gain.exponentialRampToValueAtTime(0.5, now + 0.22);
    voice.gain.setValueAtTime(0.5, end - 0.05);
    voice.gain.exponentialRampToValueAtTime(0.0001, end + 0.55);
    const tremolo = context.createOscillator();
    tremolo.frequency.value = 5.3;
    const tremoloDepth = context.createGain();
    tremoloDepth.gain.value = 0.025;
    tremolo.connect(tremoloDepth).connect(voice.gain);
    tremolo.start(now);
    tremolo.stop(end + 0.6);

    const shaper = context.createWaveShaper();
    shaper.curve = softClipCurve(2.4);
    const body = context.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.value = 1900;
    body.Q.value = 0.4;
    const formant = context.createBiquadFilter();
    formant.type = "peaking";
    formant.frequency.value = 460;
    formant.Q.value = 1.1;
    formant.gain.value = 9 * profile.formant;
    const presence = context.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 1150;
    presence.Q.value = 1.4;
    presence.gain.value = 4;
    voice.connect(shaper).connect(body).connect(formant).connect(presence).connect(output);

    for (const tone of profile.tones) {
      for (const cents of [-6, 0, 5]) {
        const oscillator = context.createOscillator();
        oscillator.type = "sawtooth";
        const frequency = tone * Math.pow(2, cents / 1200);
        // Air horns start slightly flat and settle as the pressure builds.
        oscillator.frequency.setValueAtTime(frequency * 0.93, now);
        oscillator.frequency.exponentialRampToValueAtTime(frequency, now + 0.28);
        oscillator.frequency.setValueAtTime(frequency, end);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.97, end + 0.5);
        const gain = context.createGain();
        gain.gain.value = 0.16 / profile.tones.length;
        oscillator.connect(gain).connect(voice);
        oscillator.start(now);
        oscillator.stop(end + 0.6);
      }
    }
    // Breath noise of the diaphragm.
    const breath = context.createBufferSource();
    breath.buffer = this.noise(profile.duration + 0.6, "pink");
    const breathFilter = context.createBiquadFilter();
    breathFilter.type = "bandpass";
    breathFilter.frequency.value = 700;
    breathFilter.Q.value = 0.8;
    const breathGain = context.createGain();
    breathGain.gain.value = 0.05;
    breath.connect(breathFilter).connect(breathGain).connect(voice);
    breath.start(now);
    breath.stop(end + 0.6);
  }

  /**
   * Signal flare launch: a loud cartridge bang with a low thump, followed by
   * the rocket's rising hiss that travels with the returned handle.
   */
  playFlareLaunch(position: SpatialPoint): SpatialHandle | undefined {
    const context = this.liveContext();
    if (!context || !this.effectsBus) return undefined;
    const now = context.currentTime + 0.005;
    const bangOutput = this.spatialOutput(position, { refDistance: 4, rolloff: 1, reverb: 0.4 });
    const bang = context.createBufferSource();
    bang.buffer = this.noise(0.5, "white");
    const bangFilter = context.createBiquadFilter();
    bangFilter.type = "lowpass";
    bangFilter.frequency.setValueAtTime(5200, now);
    bangFilter.frequency.exponentialRampToValueAtTime(700, now + 0.3);
    const bangGain = context.createGain();
    bangGain.gain.setValueAtTime(0.0001, now);
    bangGain.gain.exponentialRampToValueAtTime(1.6, now + 0.003);
    bangGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    bang.connect(bangFilter).connect(bangGain).connect(bangOutput);
    bang.start(now);
    bang.stop(now + 0.5);
    const thump = context.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(150, now);
    thump.frequency.exponentialRampToValueAtTime(48, now + 0.22);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.exponentialRampToValueAtTime(1.1, now + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    thump.connect(thumpGain).connect(bangOutput);
    thump.start(now);
    thump.stop(now + 0.32);

    return this.movingNoise(position, {
      duration: 3.2,
      filterType: "bandpass",
      startFrequency: 1300,
      endFrequency: 3400,
      q: 0.9,
      level: 0.75,
      attack: 0.04,
      refDistance: 6,
      rolloff: 0.85,
    });
  }

  /** Crackling magnesium burn under the parachute; follows the flare. */
  startFlareBurn(position: SpatialPoint, duration: number): SpatialHandle | undefined {
    return this.movingNoise(position, {
      duration,
      filterType: "highpass",
      startFrequency: 1800,
      endFrequency: 1400,
      q: 0.5,
      level: 0.55,
      attack: 0.2,
      refDistance: 22,
      rolloff: 0.7,
      crackle: true,
    });
  }

  /** The star charge igniting at apogee. */
  playFlareBurst(position: SpatialPoint): void {
    const context = this.liveContext();
    if (!context) return;
    const output = this.spatialOutput(position, { refDistance: 30, rolloff: 0.8, reverb: 0.6 });
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noise(0.6, "pink");
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1.2, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    source.connect(gain).connect(output);
    source.start(now);
    source.stop(now + 0.6);
  }

  /** Volcanic explosion: a deep boom with a rolling tail. */
  playEruption(position: SpatialPoint, strength: number): void {
    const context = this.liveContext();
    if (!context) return;
    const output = this.spatialOutput(position, { refDistance: 260, rolloff: 0.75, reverb: 0.7 });
    const now = context.currentTime;
    const boom = context.createBufferSource();
    boom.buffer = this.noise(3.2, "brown");
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(140, now + 2.6);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1.8 * strength, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 3);
    boom.connect(filter).connect(gain).connect(output);
    boom.start(now);
    boom.stop(now + 3.2);
    const sub = context.createOscillator();
    sub.frequency.setValueAtTime(62, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + 1.4);
    const subGain = context.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.9 * strength, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    sub.connect(subGain).connect(output);
    sub.start(now);
    sub.stop(now + 1.7);
  }

  /** Short two-note chime when a bottle or crate is picked up. */
  playCollect(): void {
    const context = this.liveContext();
    if (!context || !this.effectsBus) return;
    const now = context.currentTime;
    [988, 1318].forEach((frequency, index) => {
      const start = now + index * 0.11;
      const oscillator = context.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      oscillator.connect(gain).connect(this.effectsBus!);
      oscillator.start(start);
      oscillator.stop(start + 0.55);
    });
  }

  splash(intensity = 1, position?: SpatialPoint): void {
    const context = this.liveContext();
    if (!context || !this.wildlifeBus) return;
    const output = position
      ? this.spatialOutput(position, { refDistance: 12, rolloff: 0.9, reverb: 0.15, bus: this.wildlifeBus })
      : this.wildlifeBus;
    const source = context.createBufferSource();
    source.buffer = this.noise(0.7, "brown");
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 850;
    filter.Q.value = 0.62;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16 * intensity * (position ? 2.4 : 1), now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
    source.connect(filter).connect(gain).connect(output);
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
    this.ambientLoops.forEach((loop) => loop.source.stop());
    this.ambientLoops.clear();
    this.noiseCache.clear();
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
    this.effectsBus = this.context.createGain();
    this.effectsBus.gain.value = EFFECTS_BUS_GAIN;
    this.engineBus.connect(this.master);
    this.environmentBus.connect(this.master);
    this.wildlifeBus.connect(this.master);
    this.effectsBus.connect(this.master);
    // A synthetic open-water reverb for distant horns, bells and explosions.
    const convolver = this.context.createConvolver();
    convolver.buffer = this.createImpulseResponse(2.6);
    this.reverbSend = this.context.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(convolver).connect(this.master);
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
    this.windGain.gain.value = 0.1 * WIND_LEVEL;
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

  private liveContext(): AudioContext | undefined {
    if (!this.context || this.context.state !== "running" || !this.enabled) return undefined;
    return this.context;
  }

  /** Cached noise buffers; one-shots reuse them instead of regenerating. */
  private noise(duration: number, color: NoiseColor): AudioBuffer {
    const key = `${color}:${Math.ceil(duration * 10)}`;
    let buffer = this.noiseCache.get(key);
    if (!buffer) {
      buffer = this.createNoiseBuffer(Math.ceil(duration * 10) / 10, color);
      this.noiseCache.set(key, buffer);
    }
    return buffer;
  }

  private createPanner(position: SpatialPoint, refDistance: number, rolloff: number): PannerNode {
    const context = this.context!;
    const panner = context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = refDistance;
    panner.rolloffFactor = rolloff;
    panner.maxDistance = 10000;
    setPannerPosition(panner, position, context.currentTime);
    return panner;
  }

  /**
   * Input node for a one-shot heard from the current camera position:
   * air-absorption filter → HRTF panner → bus, plus a reverb send.
   */
  private spatialOutput(
    position: SpatialPoint,
    options: { refDistance: number; rolloff: number; reverb: number; bus?: GainNode },
  ): AudioNode {
    const context = this.context!;
    const input = context.createGain();
    const absorption = context.createBiquadFilter();
    absorption.type = "lowpass";
    absorption.frequency.value = airAbsorptionCutoff(
      Math.hypot(position.x - this.listenerPosition.x, position.y - this.listenerPosition.y, position.z - this.listenerPosition.z),
    );
    const panner = this.createPanner(position, options.refDistance, options.rolloff);
    input.connect(absorption).connect(panner).connect(options.bus ?? this.effectsBus!);
    if (this.reverbSend && options.reverb > 0) {
      const send = context.createGain();
      send.gain.value = options.reverb;
      panner.connect(send).connect(this.reverbSend);
    }
    return input;
  }

  private movingNoise(
    position: SpatialPoint,
    options: {
      duration: number;
      filterType: BiquadFilterType;
      startFrequency: number;
      endFrequency: number;
      q: number;
      level: number;
      attack: number;
      refDistance: number;
      rolloff: number;
      crackle?: boolean;
    },
  ): SpatialHandle | undefined {
    const context = this.liveContext();
    if (!context || !this.effectsBus) return undefined;
    const now = context.currentTime;
    const end = now + options.duration;
    const source = context.createBufferSource();
    source.buffer = options.crackle ? this.crackleBuffer() : this.noise(Math.min(options.duration + 0.2, 6), "white");
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = options.filterType;
    filter.Q.value = options.q;
    filter.frequency.setValueAtTime(options.startFrequency, now);
    filter.frequency.exponentialRampToValueAtTime(options.endFrequency, end);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(options.level, now + options.attack);
    gain.gain.setValueAtTime(options.level, Math.max(now + options.attack, end - 0.6));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    const panner = this.createPanner(position, options.refDistance, options.rolloff);
    source.connect(filter).connect(gain).connect(panner).connect(this.effectsBus);
    if (this.reverbSend) {
      const send = context.createGain();
      send.gain.value = 0.25;
      panner.connect(send).connect(this.reverbSend);
    }
    source.start(now);
    source.stop(end + 0.05);
    let stopped = false;
    return {
      setPosition: (next) => {
        if (!stopped && this.context) setPannerPosition(panner, next, this.context.currentTime);
      },
      stop: (fadeSeconds = 0.3) => {
        if (stopped || !this.context) return;
        stopped = true;
        const time = this.context.currentTime;
        gain.gain.cancelScheduledValues(time);
        gain.gain.setTargetAtTime(0.0001, time, fadeSeconds / 3);
        source.stop(time + fadeSeconds + 0.05);
      },
    };
  }

  /** Sparse random crackles over a hiss bed, for burning pyrotechnics. */
  private crackleBuffer(): AudioBuffer {
    const key = "crackle";
    let buffer = this.noiseCache.get(key);
    if (buffer) return buffer;
    const context = this.context!;
    const length = Math.ceil(context.sampleRate * 2.4);
    buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let envelope = 0;
    for (let index = 0; index < length; index += 1) {
      if (Math.random() < 0.0009) envelope = 0.6 + Math.random() * 0.8;
      envelope *= 0.9965;
      data[index] = (Math.random() * 2 - 1) * (0.16 + envelope);
    }
    this.noiseCache.set(key, buffer);
    return buffer;
  }

  private createImpulseResponse(seconds: number): AudioBuffer {
    const context = this.context!;
    const length = Math.ceil(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const t = index / length;
        // Sparse early reflections from the water, then a smooth decay.
        const early = index < context.sampleRate * 0.12 && Math.random() < 0.004 ? 0.8 : 0;
        data[index] = ((Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) + early) * 0.5;
      }
    }
    return buffer;
  }

  private applyListener(now: number): void {
    const listener = this.context?.listener;
    if (!listener) return;
    const { x, y, z } = this.listenerPosition;
    const forward = this.listenerForward;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(x, now, 0.03);
      listener.positionY.setTargetAtTime(y, now, 0.03);
      listener.positionZ.setTargetAtTime(z, now, 0.03);
      listener.forwardX.setTargetAtTime(forward.x, now, 0.03);
      listener.forwardY.setTargetAtTime(forward.y, now, 0.03);
      listener.forwardZ.setTargetAtTime(forward.z, now, 0.03);
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else {
      // Older WebKit only exposes the deprecated setters.
      listener.setPosition(x, y, z);
      listener.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  private refreshAmbientLoops(now: number): void {
    const context = this.context;
    if (!context || !this.effectsBus) return;
    this.ambientTargets.forEach((target, kind) => {
      let loop = this.ambientLoops.get(kind);
      if (!loop && target.level > 0.001) {
        loop = this.createAmbientLoop(kind, target.position);
        this.ambientLoops.set(kind, loop);
      }
      if (!loop) return;
      setPannerPosition(loop.panner, target.position, now);
      loop.gain.gain.setTargetAtTime(target.level * loop.level, now, 0.6);
    });
  }

  private createAmbientLoop(kind: AmbientLoopKind, position: SpatialPoint): AmbientLoop {
    const context = this.context!;
    const source = context.createBufferSource();
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    let panner: PannerNode;
    let level: number;
    if (kind === "party") {
      source.buffer = renderPartyLoop(context.sampleRate, (length) => context.createBuffer(2, length, context.sampleRate));
      panner = this.createPanner(position, 14, 1.1);
      level = 0.9;
      source.connect(gain).connect(panner).connect(this.effectsBus!);
    } else if (kind === "volcano") {
      source.buffer = this.noise(5.6, "brown");
      const lowpass = context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 240;
      panner = this.createPanner(position, 220, 0.8);
      level = 1.4;
      source.connect(lowpass).connect(gain).connect(panner).connect(this.effectsBus!);
    } else {
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 4), context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        const t = index / context.sampleRate;
        // Integer cycles over the 4 s loop keep the drone seamless.
        data[index] =
          Math.sin(2 * Math.PI * 55 * t) * 0.32 +
          Math.sin(2 * Math.PI * 110.25 * t) * 0.18 +
          Math.sin(2 * Math.PI * 165 * t) * 0.08 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.25 * t));
      }
      source.buffer = buffer;
      panner = this.createPanner(position, 10, 1.4);
      level = 0.5;
      source.connect(gain).connect(panner).connect(this.effectsBus!);
    }
    source.start();
    return { source, gain, panner, level };
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

function setPannerPosition(panner: PannerNode, position: SpatialPoint, now: number): void {
  if (panner.positionX) {
    panner.positionX.setTargetAtTime(position.x, now, 0.02);
    panner.positionY.setTargetAtTime(position.y, now, 0.02);
    panner.positionZ.setTargetAtTime(position.z, now, 0.02);
  } else {
    panner.setPosition(position.x, position.y, position.z);
  }
}

function softClipCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

/**
 * Renders a seamless 4-bar, 118 BPM tropical house loop for the floating party:
 * four-on-the-floor kick, off-beat hats, a plucked bass line and soft chords.
 */
export function renderPartyLoop(sampleRate: number, allocate: (length: number) => AudioBuffer): AudioBuffer {
  const bpm = 118;
  const beat = 60 / bpm;
  const bars = 4;
  const length = Math.ceil(sampleRate * beat * 4 * bars);
  const buffer = allocate(length);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const add = (time: number, duration: number, pan: number, voice: (t: number) => number): void => {
    const start = Math.floor(time * sampleRate);
    const count = Math.floor(duration * sampleRate);
    for (let index = 0; index < count; index += 1) {
      const position = (start + index) % length;
      const value = voice(index / sampleRate);
      left[position] += value * (1 - Math.max(0, pan));
      right[position] += value * (1 + Math.min(0, pan));
    }
  };
  const chords = [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [261.63, 329.63, 392],
    [196, 246.94, 293.66],
  ];
  const bassRoots = [110, 87.31, 130.81, 98];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let step = 0; step < 4; step += 1) {
      const time = (bar * 4 + step) * beat;
      add(time, 0.3, 0, (t) => Math.sin(2 * Math.PI * (52 + 90 * Math.exp(-t * 28)) * t) * Math.exp(-t * 9) * 0.55);
      add(time + beat / 2, 0.06, 0.3, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 70) * 0.12);
      const root = bassRoots[bar];
      add(time + beat / 2, beat * 0.45, 0, (t) => {
        const phase = (root * t) % 1;
        return (phase * 2 - 1) * Math.exp(-t * 6) * 0.2;
      });
    }
    add(bar * 4 * beat + beat * 1.5, beat * 2.2, 0, (t) => {
      const envelope = Math.min(1, t * 20) * Math.exp(-t * 1.4);
      return chords[bar].reduce((sum, frequency, index) => sum + Math.sin(2 * Math.PI * frequency * t + index) * 0.05, 0) * envelope;
    });
  }
  return buffer;
}
