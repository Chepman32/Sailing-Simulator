import { airAbsorptionCutoff, distanceGain, dopplerRatio } from "../aviation/AviationMath";
import type { AviationAudioState } from "../aviation/AviationSystem";
import { clamp } from "../math";

type NoiseFactory = (duration: number, color: "brown" | "pink" | "white") => AudioBuffer;

/**
 * Light aircraft: two-blade propeller passing frequency and engine firing
 * order at cruise RPM. Harmonics and an air-rush band keep it audible on phone
 * speakers that cannot reproduce the ~80 Hz fundamental.
 */
const PROP_BLADE_PASS_HZ = { seaplane: 79, banner: 88 } as const;
const PROP_FIRING_RATIO = 1.5;
const PROP_REFERENCE_DISTANCE = 42;
const PROP_MAX_GAIN = 0.62;
const JET_MAX_GAIN = 0.16;

/**
 * The aircraft's voices on their own bus:
 *
 * - the light aircraft's engine: a blade-pass harmonic series, the firing
 *   pulse and exhaust crackle gated at the firing rate, an air-rush band and
 *   the propeller's slow "wop"; Doppler-shifted, low-passed by air absorption
 *   with distance, panned, and summed with its own echo off the sea (the
 *   moving comb filter of a real low flyby);
 * - the distant roar of airliners high overhead.
 *
 * `AviationSystem.audioState` supplies listener-relative, sound-delayed
 * positions; this class only turns them into sound.
 */
export class AviationVoices {
  private readonly propFilter: BiquadFilterNode;
  private readonly propLevel: GainNode;
  private readonly propBlade: OscillatorNode;
  private readonly propFiring: OscillatorNode;
  private readonly propExhaustGate: OscillatorNode;
  private readonly propTremolo: OscillatorNode;
  private readonly propPanner?: StereoPannerNode;
  private readonly propReflection: DelayNode;
  private readonly jetGain: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(context: AudioContext, bus: AudioNode, noise: NoiseFactory) {
    this.propFilter = context.createBiquadFilter();
    this.propFilter.type = "lowpass";
    this.propFilter.frequency.value = 1800;
    this.propFilter.Q.value = 0.8;
    const tremoloNode = context.createGain();
    tremoloNode.gain.value = 0.78;
    this.propLevel = context.createGain();
    this.propLevel.gain.value = 0;

    // Blade-pass harmonic series of a two-blade propeller: strong low
    // harmonics rolling off slowly, which reads as a "buzz" rather than the
    // flat edge of a plain sawtooth.
    this.propBlade = context.createOscillator();
    const harmonics = [0, 1, 0.78, 0.62, 0.46, 0.36, 0.27, 0.2, 0.16, 0.12, 0.09, 0.07, 0.05];
    this.propBlade.setPeriodicWave(
      context.createPeriodicWave(new Float32Array(harmonics.length), new Float32Array(harmonics), { disableNormalization: false }),
    );
    this.propBlade.frequency.value = PROP_BLADE_PASS_HZ.seaplane;
    const bladeGain = context.createGain();
    bladeGain.gain.value = 0.5;
    this.propBlade.connect(bladeGain).connect(this.propFilter);

    this.propFiring = context.createOscillator();
    this.propFiring.type = "square";
    this.propFiring.frequency.value = PROP_BLADE_PASS_HZ.seaplane * PROP_FIRING_RATIO;
    const firingGain = context.createGain();
    firingGain.gain.value = 0.2;
    this.propFiring.connect(firingGain).connect(this.propFilter);

    // Exhaust crackle: band-limited noise gated at the cylinder firing rate.
    const crackle = context.createBufferSource();
    crackle.buffer = noise(2.9, "white");
    crackle.loop = true;
    const crackleFilter = context.createBiquadFilter();
    crackleFilter.type = "bandpass";
    crackleFilter.frequency.value = 420;
    crackleFilter.Q.value = 0.9;
    const crackleGate = context.createGain();
    crackleGate.gain.value = 0.5;
    this.propExhaustGate = context.createOscillator();
    this.propExhaustGate.type = "square";
    this.propExhaustGate.frequency.value = PROP_BLADE_PASS_HZ.seaplane * PROP_FIRING_RATIO;
    const gateDepth = context.createGain();
    gateDepth.gain.value = 0.5;
    this.propExhaustGate.connect(gateDepth).connect(crackleGate.gain);
    const crackleGain = context.createGain();
    crackleGain.gain.value = 0.42;
    crackle.connect(crackleFilter).connect(crackleGate).connect(crackleGain).connect(this.propFilter);

    const rush = context.createBufferSource();
    rush.buffer = noise(3.3, "pink");
    rush.loop = true;
    const rushFilter = context.createBiquadFilter();
    rushFilter.type = "bandpass";
    rushFilter.frequency.value = 1150;
    rushFilter.Q.value = 0.7;
    const rushGain = context.createGain();
    rushGain.gain.value = 0.55;
    rush.connect(rushFilter).connect(rushGain).connect(this.propFilter);

    this.propTremolo = context.createOscillator();
    this.propTremolo.type = "sine";
    this.propTremolo.frequency.value = 6.5;
    const tremoloDepth = context.createGain();
    tremoloDepth.gain.value = 0.2;
    this.propTremolo.connect(tremoloDepth).connect(tremoloNode.gain);

    this.propFilter.connect(tremoloNode);
    let output: AudioNode = tremoloNode;
    if (typeof context.createStereoPanner === "function") {
      // Older WebKit lacks StereoPannerNode; the aircraft then stays centred.
      this.propPanner = context.createStereoPanner();
      output = tremoloNode.connect(this.propPanner);
    }
    // Direct sound plus the copy reflected off the sea, slightly later and weaker.
    output.connect(this.propLevel);
    this.propReflection = context.createDelay(0.12);
    this.propReflection.delayTime.value = 0.01;
    const reflectionGain = context.createGain();
    reflectionGain.gain.value = 0.55;
    output.connect(this.propReflection).connect(reflectionGain).connect(this.propLevel);
    this.propLevel.connect(bus);

    // Distant airliner roar: a low brown-noise rumble with a mid band that
    // survives small speakers.
    this.jetGain = context.createGain();
    this.jetGain.gain.value = 0;
    const roar = context.createBufferSource();
    roar.buffer = noise(6.1, "brown");
    roar.loop = true;
    const roarFilter = context.createBiquadFilter();
    roarFilter.type = "lowpass";
    roarFilter.frequency.value = 340;
    roar.connect(roarFilter).connect(this.jetGain);
    const hiss = context.createBufferSource();
    hiss.buffer = noise(4.4, "pink");
    hiss.loop = true;
    hiss.playbackRate.value = 0.7;
    const hissFilter = context.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 560;
    hissFilter.Q.value = 0.55;
    const hissGain = context.createGain();
    hissGain.gain.value = 0.45;
    hiss.connect(hissFilter).connect(hissGain).connect(this.jetGain);
    this.jetGain.connect(bus);

    this.propBlade.start();
    this.propFiring.start();
    this.propExhaustGate.start();
    this.propTremolo.start();
    crackle.start(0, 0.3);
    rush.start(0, 0.6);
    roar.start(0, 2.2);
    hiss.start(0, 1.4);
    this.sources.push(this.propBlade, this.propFiring, this.propExhaustGate, this.propTremolo, crackle, rush, roar, hiss);
  }

  update(now: number, state: AviationAudioState): void {
    const presence = clamp(state.propPresence, 0, 1);
    if (presence > 0) {
      const doppler = dopplerRatio(state.propRadialSpeed);
      const base = PROP_BLADE_PASS_HZ[state.propKind];
      this.propBlade.frequency.setTargetAtTime(base * doppler, now, 0.08);
      this.propFiring.frequency.setTargetAtTime(base * PROP_FIRING_RATIO * doppler, now, 0.08);
      this.propExhaustGate.frequency.setTargetAtTime(base * PROP_FIRING_RATIO * doppler, now, 0.08);
      this.propReflection.delayTime.setTargetAtTime(clamp(state.propReflectionDelay, 0.0005, 0.11), now, 0.05);
      this.propTremolo.frequency.setTargetAtTime(6.5 * doppler, now, 0.2);
      this.propFilter.frequency.setTargetAtTime(airAbsorptionCutoff(state.propDistance), now, 0.12);
      this.propPanner?.pan.setTargetAtTime(state.propPan * 0.85, now, 0.1);
    }
    const loudness = distanceGain(state.propDistance, PROP_REFERENCE_DISTANCE) ** 1.1;
    this.propLevel.gain.setTargetAtTime(presence * loudness * PROP_MAX_GAIN, now, 0.15);
    this.jetGain.gain.setTargetAtTime(clamp(state.jetLevel, 0, 1) * JET_MAX_GAIN, now, 1.2);
  }

  dispose(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped with its context.
      }
    }
    this.propLevel.disconnect();
    this.jetGain.disconnect();
  }
}
