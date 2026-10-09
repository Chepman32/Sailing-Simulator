import { clamp } from "../math";

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type NoiseColor = "brown" | "pink" | "white";

const MASTER_GAIN = 0.94;
const ENGINE_BUS_GAIN = 0.95;
const ENGINE_ENVIRONMENT_DUCK = 0.78;
/** Firing frequency of the four-cylinder diesel at idle and at full power, Hz. */
const ENGINE_IDLE_FIRING = 26;
const ENGINE_FULL_FIRING = 86;
/** Shortest and longest pause between two gull calls anywhere in the flock, seconds. */
const GULL_CALL_MIN_GAP = 2.6;
const GULL_CALL_MAX_GAP = 14;

export type ListenerPose = {
  position: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
};

/**
 * Harmonic spectrum of a diesel's firing pulses: strong low harmonics, a
 * slow roll-off, odd ones a little stronger. Enough energy between 150 Hz
 * and 1.5 kHz to be heard on a phone speaker without any fundamental there.
 */
function dieselSpectrum(): { real: Float32Array; imag: Float32Array } {
  const harmonics = 28;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n += 1) {
    const odd = n % 2 === 1 ? 1.15 : 0.85;
    imag[n] = (odd / Math.pow(n, 1.05)) * (0.6 + 0.4 * Math.cos(n * 0.9));
  }
  return { real, imag };
}
const RESUME_RETRY_MS = 850;

export class AudioSystem {
  private context?: AudioContext;
  private master?: GainNode;
  private engineBus?: GainNode;
  private environmentBus?: GainNode;
  private wildlifeBus?: GainNode;
  private engineFiring?: OscillatorNode;
  private engineCrank?: OscillatorNode;
  private engineTone?: BiquadFilterNode;
  private engineFiringGain?: GainNode;
  private engineCrankGain?: GainNode;
  private engineKnock?: OscillatorNode;
  private engineKnockDepth?: GainNode;
  private engineCombustionGain?: GainNode;
  private engineCombustionFilter?: BiquadFilterNode;
  private exhaustGain?: GainNode;
  private exhaustPulse?: OscillatorNode;
  private waveGain?: GainNode;
  private windGain?: GainNode;
  private windFilter?: BiquadFilterNode;
  private rigGain?: GainNode;
  private gullClock = 4 + Math.random() * 6;
  private engineLoad = 0;
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

  /**
   * @param speed Hull speed through the water in m/s.
   * @param shaft Signed propeller shaft speed as a fraction of maximum.
   * @param apparentWind Apparent wind speed in m/s.
   */
  update(delta: number, speed: number, shaft: number, apparentWind: number, overcast = 0): void {
    if (!this.context || this.context.state !== "running") return;
    this.updateElapsed += delta;
    if (this.updateElapsed < 0.05) return;
    const step = this.updateElapsed;
    this.updateElapsed = 0;
    const now = this.context.currentTime;

    // --- Engine ---------------------------------------------------------------
    // Revs follow the shaft with the inertia of a flywheel; load (how hard the
    // propeller is pulling against the water) opens the tone up a little.
    const revs = this.engineRunning ? clamp(Math.abs(shaft), 0, 1) : 0;
    const load = this.engineRunning ? clamp(Math.abs(shaft) * 1.1 - speed / 9, 0, 1) : 0;
    this.engineLoad += (load - this.engineLoad) * (1 - Math.exp(-step * 2.5));
    const firing = ENGINE_IDLE_FIRING + (ENGINE_FULL_FIRING - ENGINE_IDLE_FIRING) * revs;
    this.engineFiring?.frequency.setTargetAtTime(firing, now, 0.45);
    this.engineCrank?.frequency.setTargetAtTime(firing / 2, now, 0.45);
    this.engineKnock?.frequency.setTargetAtTime(firing, now, 0.45);
    this.exhaustPulse?.frequency.setTargetAtTime(firing / 4, now, 0.45);
    // Muffled at idle, never a buzz: the tone opens only as power comes on.
    this.engineTone?.frequency.setTargetAtTime(260 + revs * 650 + this.engineLoad * 420, now, 0.4);
    this.engineCombustionFilter?.frequency.setTargetAtTime(firing * 6, now, 0.4);
    this.engineFiringGain?.gain.setTargetAtTime(0.065 + revs * 0.045 + this.engineLoad * 0.02, now, 0.35);
    this.engineCrankGain?.gain.setTargetAtTime(0.03 + revs * 0.02, now, 0.35);
    this.engineCombustionGain?.gain.setTargetAtTime(0.012 + this.engineLoad * 0.03, now, 0.35);
    this.exhaustGain?.gain.setTargetAtTime(0.05 + revs * 0.05, now, 0.4);

    // --- Water and wind --------------------------------------------------------
    this.waveGain?.gain.setTargetAtTime(0.24 + clamp(speed / 7, 0, 1) * 0.18, now, 0.5);
    // A soft, low rush that swells slowly with the breeze and the weather;
    // the rigging only sings when it really blows.
    const breeze = clamp((apparentWind - 2) / 14, 0, 1);
    this.windGain?.gain.setTargetAtTime(0.018 + breeze * 0.045 + overcast * 0.02, now, 1.4);
    this.windFilter?.frequency.setTargetAtTime(380 + breeze * 420 + overcast * 120, now, 1.6);
    this.rigGain?.gain.setTargetAtTime(Math.max(0, breeze - 0.7) * 0.012, now, 2);
    this.hullGain?.gain.setTargetAtTime(clamp(speed / 6, 0, 1) * 0.16, now, 0.25);
  }

  /** Where the listener (the camera) is, for positional sounds. */
  setListener(pose: ListenerPose): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const listener = context.listener;
    const now = context.currentTime;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(pose.position.x, now, 0.03);
      listener.positionY.setTargetAtTime(pose.position.y, now, 0.03);
      listener.positionZ.setTargetAtTime(pose.position.z, now, 0.03);
      listener.forwardX.setTargetAtTime(pose.forward.x, now, 0.03);
      listener.forwardY.setTargetAtTime(pose.forward.y, now, 0.03);
      listener.forwardZ.setTargetAtTime(pose.forward.z, now, 0.03);
      listener.upX.setTargetAtTime(pose.up.x, now, 0.03);
      listener.upY.setTargetAtTime(pose.up.y, now, 0.03);
      listener.upZ.setTargetAtTime(pose.up.z, now, 0.03);
    } else {
      listener.setPosition(pose.position.x, pose.position.y, pose.position.z);
      listener.setOrientation(pose.forward.x, pose.forward.y, pose.forward.z, pose.up.x, pose.up.y, pose.up.z);
    }
  }

  /**
   * Lets the flock call now and then: at irregular intervals one bird (the
   * caller chooses which, by position) gives one of several calls from where
   * it is flying.
   */
  updateGulls(delta: number, birds: readonly { x: number; y: number; z: number }[]): void {
    if (!this.context || this.context.state !== "running" || !this.enabled || birds.length === 0) return;
    this.gullClock -= delta;
    if (this.gullClock > 0) return;
    // Calls come in loose bursts: a reply often follows a call.
    this.gullClock = Math.random() < 0.3 ? GULL_CALL_MIN_GAP * (0.6 + Math.random() * 0.6) : GULL_CALL_MIN_GAP + Math.random() * (GULL_CALL_MAX_GAP - GULL_CALL_MIN_GAP);
    const bird = birds[Math.floor(Math.random() * birds.length)]!;
    this.gullCall(bird, Math.floor(Math.random() * 4));
  }

  /**
   * The boom fetching up on its sheet after a gybe: a short, low thud with a
   * rattle of blocks on top.
   */
  boomSlam(intensity = 1): void {
    if (!this.context || !this.wildlifeBus || this.context.state !== "running" || !this.enabled) return;
    const now = this.context.currentTime;
    const strength = Math.min(1, Math.max(0.1, intensity));
    const thud = this.context.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(150, now);
    thud.frequency.exponentialRampToValueAtTime(70, now + 0.16);
    const thudGain = this.context.createGain();
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.exponentialRampToValueAtTime(0.32 * strength, now + 0.01);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    thud.connect(thudGain).connect(this.wildlifeBus);
    thud.start(now);
    thud.stop(now + 0.26);

    const rattle = this.context.createBufferSource();
    rattle.buffer = this.createNoiseBuffer(0.2);
    const rattleFilter = this.context.createBiquadFilter();
    rattleFilter.type = "bandpass";
    rattleFilter.frequency.value = 2200;
    rattleFilter.Q.value = 1.4;
    const rattleGain = this.context.createGain();
    rattleGain.gain.setValueAtTime(0.0001, now);
    rattleGain.gain.exponentialRampToValueAtTime(0.09 * strength, now + 0.006);
    rattleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    rattle.connect(rattleFilter).connect(rattleGain).connect(this.wildlifeBus);
    rattle.start(now);
    rattle.stop(now + 0.2);
  }

  /**
   * One-shot water sound.
   *
   * @param intensity splash energy (dolphin re-entry ≈ 1, fluke slap ≈ 5)
   * @param kind how the body met the surface
   * @param distance metres from the listener; distant splashes are quieter
   */
  splash(
    intensity = 1,
    kind: "entry" | "exit" | "slap" | "breath" | "blow" = "entry",
    distance = 0,
    position?: { x: number; y: number; z: number },
  ): void {
    if (!this.context || !this.wildlifeBus || this.context.state !== "running" || !this.enabled) return;
    const attenuation = 1 / (1 + Math.max(0, distance) / 28);
    // Big impacts carry: a breaching whale is heard a long way off.
    const carry = 1 + Math.max(0, intensity - 3) * Math.min(1, distance / 60) * 0.6;
    const level = Math.min(2.4, Math.max(0.05, intensity)) * attenuation * carry;
    if (level < 0.015) return;
    const now = this.context.currentTime;
    // Positioned splashes are panned to where they happened; distance is
    // already in the level above, so the panner only places the sound.
    const output = position ? this.placedOutput(position) : this.wildlifeBus;
    // Far water sounds lose their highs.
    const far = clamp(distance / 160, 0, 1);
    const noise = (
      duration: number,
      type: BiquadFilterType,
      frequency: number,
      q: number,
      peak: number,
      attack: number,
      decay: number,
    ): void => {
      if (!this.context || !this.wildlifeBus) return;
      const source = this.context.createBufferSource();
      source.buffer = this.createNoiseBuffer(duration);
      const filter = this.context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
      if (far > 0.05) filter.frequency.value = frequency * (1 - far * 0.6);
      source.connect(filter).connect(gain).connect(output);
      source.start(now);
      source.stop(now + duration);
    };
    switch (kind) {
      case "blow":
        // A long, breathy exhalation rather than a splash.
        noise(1.8, "bandpass", 620, 0.45, 0.2 * level, 0.09, 1.5);
        noise(1.2, "highpass", 2400, 0.3, 0.05 * level, 0.05, 0.9);
        return;
      case "slap": {
        // A sharp crack over a heavy, low body of water.
        noise(0.4, "bandpass", 1500, 0.8, 0.22 * level, 0.004, 0.3);
        noise(1.6, "lowpass", 420, 0.7, 0.32 * level, 0.012, 1.3);
        const thump = this.context.createOscillator();
        thump.type = "sine";
        thump.frequency.setValueAtTime(140, now);
        thump.frequency.exponentialRampToValueAtTime(62, now + 0.35);
        const thumpGain = this.context.createGain();
        thumpGain.gain.setValueAtTime(0.0001, now);
        thumpGain.gain.exponentialRampToValueAtTime(0.28 * level, now + 0.01);
        thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
        thump.connect(thumpGain).connect(output);
        thump.start(now);
        thump.stop(now + 0.5);
        if (intensity >= 4.5) {
          // A body crashing down: a long, rolling roar of falling water.
          noise(3.4, "lowpass", 700, 0.6, 0.26 * level, 0.08, 3.1);
          noise(2.6, "bandpass", 1800, 0.5, 0.08 * level, 0.2, 2.2);
        }
        return;
      }
      case "exit":
        // Water pouring off a body.
        noise(0.9, "bandpass", 1250, 0.55, 0.1 * level, 0.03, 0.7);
        return;
      case "breath":
        noise(0.5, "bandpass", 1050, 0.6, 0.07 * level, 0.02, 0.35);
        return;
      case "entry":
        noise(0.7, "bandpass", 850, 0.62, 0.16 * level, 0.018, 0.56);
        return;
    }
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
    this.engineFiring?.stop();
    this.engineCrank?.stop();
    this.engineKnock?.stop();
    this.exhaustPulse?.stop();
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

    this.createEngine(this.context, this.engineBus);

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

    // Wind: pink noise through a low band whose centre the breeze moves;
    // nothing hissy above a couple of kilohertz.
    const wind = this.context.createBufferSource();
    wind.buffer = this.createNoiseBuffer(6.1, "pink");
    wind.loop = true;
    wind.playbackRate.value = 0.71;
    this.windFilter = this.context.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.55;
    const windSoftener = this.context.createBiquadFilter();
    windSoftener.type = "lowpass";
    windSoftener.frequency.value = 1400;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.02;
    // Slow gusts swell and ease the wind over several seconds.
    const gust = this.context.createOscillator();
    gust.frequency.value = 0.07;
    const gustDepth = this.context.createGain();
    gustDepth.gain.value = 0.008;
    gust.connect(gustDepth).connect(this.windGain.gain);
    gust.start();
    wind.connect(this.windFilter).connect(windSoftener).connect(this.windGain).connect(this.environmentBus);
    wind.start(0, 0.41);
    // A faint whistle in the rigging, only in strong wind.
    const rig = this.context.createBufferSource();
    rig.buffer = this.createNoiseBuffer(3.3, "white");
    rig.loop = true;
    const rigFilter = this.context.createBiquadFilter();
    rigFilter.type = "bandpass";
    rigFilter.frequency.value = 980;
    rigFilter.Q.value = 9;
    this.rigGain = this.context.createGain();
    this.rigGain.gain.value = 0;
    rig.connect(rigFilter).connect(this.rigGain).connect(this.environmentBus);
    rig.start(0, 0.9);

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

  /**
   * A small marine diesel: firing pulses with a harmonic spectrum, a half-
   * speed crank component that gives the uneven "chug", combustion knock
   * (noise pulsed at the firing rate), and the gurgle of a wet exhaust.
   * Everything passes a low-pass that opens with revs, so it sounds calm and
   * muffled at idle and fuller, never shrill, under power.
   */
  private createEngine(context: AudioContext, bus: GainNode): void {
    const { real, imag } = dieselSpectrum();
    const wave = context.createPeriodicWave(real, imag, { disableNormalization: false });
    this.engineTone = context.createBiquadFilter();
    this.engineTone.type = "lowpass";
    this.engineTone.frequency.value = 260;
    this.engineTone.Q.value = 0.6;
    // Removes the sub-bass a phone cannot play and a laptop only rumbles with.
    const highPass = context.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 85;
    this.engineTone.connect(highPass).connect(bus);

    this.engineFiring = context.createOscillator();
    this.engineFiring.setPeriodicWave(wave);
    this.engineFiring.frequency.value = ENGINE_IDLE_FIRING;
    this.engineFiringGain = context.createGain();
    this.engineFiringGain.gain.value = 0.07;
    this.engineFiring.connect(this.engineFiringGain).connect(this.engineTone);
    this.engineFiring.start();

    this.engineCrank = context.createOscillator();
    this.engineCrank.setPeriodicWave(wave);
    this.engineCrank.frequency.value = ENGINE_IDLE_FIRING / 2;
    this.engineCrankGain = context.createGain();
    this.engineCrankGain.gain.value = 0.03;
    this.engineCrank.connect(this.engineCrankGain).connect(this.engineTone);
    this.engineCrank.start();

    // Knock: band-limited noise whose level pulses with each firing stroke.
    const knockNoise = context.createBufferSource();
    knockNoise.buffer = this.createNoiseBuffer(3.9, "pink");
    knockNoise.loop = true;
    this.engineCombustionFilter = context.createBiquadFilter();
    this.engineCombustionFilter.type = "bandpass";
    this.engineCombustionFilter.frequency.value = ENGINE_IDLE_FIRING * 6;
    this.engineCombustionFilter.Q.value = 1.1;
    this.engineCombustionGain = context.createGain();
    this.engineCombustionGain.gain.value = 0.012;
    this.engineKnock = context.createOscillator();
    this.engineKnock.type = "sine";
    this.engineKnock.frequency.value = ENGINE_IDLE_FIRING;
    this.engineKnockDepth = context.createGain();
    this.engineKnockDepth.gain.value = 0.01;
    this.engineKnock.connect(this.engineKnockDepth).connect(this.engineCombustionGain.gain);
    knockNoise.connect(this.engineCombustionFilter).connect(this.engineCombustionGain).connect(this.engineTone);
    this.engineKnock.start();
    knockNoise.start(0, 0.37);

    // Wet exhaust: low, burbling water at the transom.
    const exhaust = context.createBufferSource();
    exhaust.buffer = this.createNoiseBuffer(4.4, "brown");
    exhaust.loop = true;
    const exhaustFilter = context.createBiquadFilter();
    exhaustFilter.type = "bandpass";
    exhaustFilter.frequency.value = 240;
    exhaustFilter.Q.value = 0.8;
    this.exhaustGain = context.createGain();
    this.exhaustGain.gain.value = 0.05;
    this.exhaustPulse = context.createOscillator();
    this.exhaustPulse.type = "sine";
    this.exhaustPulse.frequency.value = ENGINE_IDLE_FIRING / 4;
    const exhaustDepth = context.createGain();
    exhaustDepth.gain.value = 0.03;
    this.exhaustPulse.connect(exhaustDepth).connect(this.exhaustGain.gain);
    exhaust.connect(exhaustFilter).connect(this.exhaustGain).connect(bus);
    this.exhaustPulse.start();
    exhaust.start(0, 1.7);
  }

  /** The starter turning the engine over, then the first firing strokes. */
  private playEngineStartCue(): void {
    if (!this.context || !this.engineBus || this.context.state !== "running" || !this.enabled || this.engineMuted) return;
    const now = this.context.currentTime;
    const starter = this.context.createOscillator();
    starter.type = "sawtooth";
    starter.frequency.setValueAtTime(9, now);
    starter.frequency.linearRampToValueAtTime(13, now + 0.55);
    const starterFilter = this.context.createBiquadFilter();
    starterFilter.type = "bandpass";
    starterFilter.frequency.value = 320;
    starterFilter.Q.value = 0.9;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.06);
    gain.gain.setValueAtTime(0.09, now + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    starter.connect(starterFilter).connect(gain).connect(this.engineBus);
    starter.start(now);
    starter.stop(now + 0.8);
  }

  /** Output that places a one-shot sound at a world position. */
  private placedOutput(position: { x: number; y: number; z: number }): AudioNode {
    const context = this.context!;
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    // Level is set by the caller; the panner only gives the direction.
    panner.distanceModel = "linear";
    panner.rolloffFactor = 0;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
    panner.connect(this.wildlifeBus!);
    // Disconnect once every one-shot has finished.
    window.setTimeout(() => panner.disconnect(), 4500);
    return panner;
  }

  /**
   * One gull call from where the bird is flying. Variants: the long call
   * (a series of falling "kyow" notes), a single "kee-ow", short alarm "keks",
   * and a soft mew. Each note is a reedy tone through two vocal formants with
   * a little breath noise, pitch and timing varied every time.
   */
  private gullCall(position: { x: number; y: number; z: number }, variant: number): void {
    const context = this.context;
    if (!context || !this.wildlifeBus) return;
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = 10;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 400;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
    const level = context.createGain();
    level.gain.value = 0.8;
    level.connect(panner).connect(this.wildlifeBus);
    const formantA = context.createBiquadFilter();
    formantA.type = "bandpass";
    formantA.Q.value = 3.2;
    const formantB = context.createBiquadFilter();
    formantB.type = "bandpass";
    formantB.Q.value = 4.5;
    formantA.connect(level);
    formantB.connect(level);
    const pitch = 0.88 + Math.random() * 0.28;
    formantA.frequency.value = 1850 * pitch;
    formantB.frequency.value = 3300 * pitch;

    const now = context.currentTime + 0.02;
    const note = (start: number, length: number, from: number, peak: number, to: number, loudness: number): void => {
      const tone = context.createOscillator();
      tone.type = "sawtooth";
      const t0 = now + start;
      tone.frequency.setValueAtTime(from * pitch, t0);
      tone.frequency.exponentialRampToValueAtTime(peak * pitch, t0 + length * 0.25);
      tone.frequency.exponentialRampToValueAtTime(to * pitch, t0 + length);
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, t0);
      envelope.gain.exponentialRampToValueAtTime(0.16 * loudness, t0 + 0.02);
      envelope.gain.setValueAtTime(0.16 * loudness, t0 + length * 0.6);
      envelope.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      tone.connect(envelope);
      envelope.connect(formantA);
      envelope.connect(formantB);
      tone.start(t0);
      tone.stop(t0 + length + 0.02);
      // Breath: the rasp in a gull's voice.
      const breath = context.createBufferSource();
      breath.buffer = this.createNoiseBuffer(length + 0.05, "white");
      const breathGain = context.createGain();
      breathGain.gain.setValueAtTime(0.0001, t0);
      breathGain.gain.exponentialRampToValueAtTime(0.05 * loudness, t0 + 0.02);
      breathGain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      breath.connect(breathGain).connect(formantB);
      breath.start(t0);
      breath.stop(t0 + length + 0.05);
    };
    let end = 0;
    switch (variant) {
      case 0: {
        // Long call: a leading wail, then falling, quickening "kyow" notes.
        note(0, 0.42, 900, 1500, 1150, 0.9);
        const count = 3 + Math.floor(Math.random() * 4);
        let time = 0.55;
        for (let index = 0; index < count; index += 1) {
          const length = 0.2 - index * 0.012 + Math.random() * 0.03;
          note(time, length, 1250 - index * 30, 1650 - index * 40, 1050 - index * 25, 1 - index * 0.08);
          time += length + 0.07 + Math.random() * 0.05;
        }
        end = time;
        break;
      }
      case 1:
        note(0, 0.5, 1400, 1950, 820, 1);
        end = 0.5;
        break;
      case 2: {
        const count = 2 + Math.floor(Math.random() * 3);
        for (let index = 0; index < count; index += 1) note(index * 0.15, 0.09, 1700, 1900, 1500, 0.8);
        end = count * 0.15;
        break;
      }
      default:
        note(0, 0.6, 1100, 1350, 900, 0.55);
        end = 0.6;
        break;
    }
    window.setTimeout(() => panner.disconnect(), (end + 0.5) * 1000);
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
