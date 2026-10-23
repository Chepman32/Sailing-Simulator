/**
 * Offline synthesis of a water splash, rendered once into a sample buffer.
 *
 * What makes a splash read as water is not its low end but its bubbles:
 * every pocket of air the impact drags under rings briefly at its Minnaert
 * frequency (about 3.26 m·Hz divided by its radius) and rises in pitch as
 * it is squeezed, the "plink" of water. A real splash is
 *
 *   1. a sharp broadband smack as the body meets the surface,
 *   2. the hiss of the thrown sheet and spray,
 *   3. a shower of hundreds of bubble plinks and droplet ticks as the water
 *      that was thrown up falls back, spread over a second or more for a
 *      whale, and
 *   4. a short, modest body of low water noise (a boom on its own is what
 *      makes a synthetic splash sound muffled).
 *
 * The bubble model follows van den Doel, "Physically based models for
 * liquid sounds" (ACM TAP 2005). Pure: no Web Audio, so it is unit-tested.
 */

export type SplashRender = {
  readonly samples: Float32Array;
  readonly sampleRate: number;
};

/** Seconds of sound for a splash of `size` 0 (a fish) … 1 (a whale crashing down). */
export function splashDuration(size: number): number {
  return 0.7 + Math.max(0, Math.min(1, size)) * 2.6;
}

/** Small deterministic generator so every variant is reproducible. */
function generator(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minnaert resonance of an air bubble of `radius` metres, Hz. */
export function bubbleFrequency(radius: number): number {
  return 3.26 / radius;
}

/** Damping of a bubble's ring, 1/s (viscous, radiative and thermal losses). */
export function bubbleDamping(frequency: number): number {
  return 0.043 * frequency + 0.0014 * Math.pow(frequency, 1.5);
}

/**
 * Renders a splash.
 *
 * @param size 0 small … 1 a whale's body or fluke crashing down
 * @param seed picks one of many variants
 */
export function renderSplash(sampleRate: number, size: number, seed = 1): SplashRender {
  const s = Math.max(0, Math.min(1, size));
  const random = generator(seed);
  const duration = splashDuration(s);
  const length = Math.ceil(duration * sampleRate);
  const out = new Float32Array(length);
  const dt = 1 / sampleRate;

  // --- 1, 2, 4: the smack, the sheet hiss and a short low body -------------------
  // One-pole filters on white noise; coefficients from their cut-offs.
  const pole = (cutoff: number) => Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  const lowBody = pole(260 + 200 * (1 - s));
  const hissLow = pole(700);
  const hissHigh = pole(4800);
  const smackLow = pole(450);
  const smackHigh = pole(3800);
  // The gush of a falling mass of water: a broad 250 Hz … 1.4 kHz roar.
  const gushLow = pole(250);
  const gushHigh = pole(1400);
  const gushTau = 0.08 + 0.75 * s;
  const smackTau = 0.012 + 0.03 * s;
  const hissAttack = 0.012 + 0.03 * s;
  const hissTau = 0.18 + 0.55 * s;
  const bodyTau = 0.09 + 0.22 * s;
  let body = 0;
  let hissLowState = 0;
  let hissHighState = 0;
  let smackLowState = 0;
  let smackHighState = 0;
  let gushLowState = 0;
  let gushHighState = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index * dt;
    const white = random() * 2 - 1;
    // Smack: band-limited noise with a 1 ms attack.
    smackLowState = smackLow * smackLowState + (1 - smackLow) * white;
    smackHighState = smackHigh * smackHighState + (1 - smackHigh) * white;
    const smack = (smackHighState - smackLowState) * Math.min(1, time / 0.001) * Math.exp(-time / smackTau);
    gushLowState = gushLow * gushLowState + (1 - gushLow) * white;
    gushHighState = gushHigh * gushHighState + (1 - gushHigh) * white;
    const gushOnset = 0.02 + 0.12 * s;
    const gush = (gushHighState - gushLowState) * Math.min(1, time / gushOnset) * Math.exp(-Math.max(0, time - gushOnset) / gushTau);
    hissLowState = hissLow * hissLowState + (1 - hissLow) * white;
    hissHighState = hissHigh * hissHighState + (1 - hissHigh) * white;
    // Band 700 Hz … 4.8 kHz: the lowpassed-at-4.8k minus the lowpassed-at-700.
    const hiss = (hissHighState - hissLowState) * Math.min(1, time / hissAttack) * Math.exp(-time / hissTau);
    body = lowBody * body + (1 - lowBody) * white;
    const low = body * Math.min(1, time / 0.006) * Math.exp(-time / bodyTau);
    out[index] = smack * 2.6 + hiss * (1.1 + 0.6 * s) + gush * (0.6 + 2.4 * s) + low * (1.2 + 0.8 * s);
  }

  // --- 3: the fall-back shower of bubbles and droplet ticks ----------------------
  // Water thrown higher takes longer to come down: the shower peaks later and
  // lasts longer for a bigger splash.
  const showerPeak = 0.08 + 0.55 * s;
  const showerSpread = 0.12 + 0.75 * s;
  const bubbles = Math.round(70 + 620 * s);
  // Bigger splashes trap bigger bubbles too (lower, rounder "bloops").
  const minRadius = 0.0009;
  const maxRadius = 0.0035 + 0.0045 * s;
  for (let bubble = 0; bubble < bubbles; bubble += 1) {
    // Onset: a fraction right at the impact, the rest as a skewed shower.
    const early = random() < 0.18;
    const shape = random() + random() + random();
    const onset = early
      ? random() * 0.06
      : Math.max(0, showerPeak + (shape / 3 - 0.35) * showerSpread * 2.2 + random() * 0.04);
    if (onset >= duration - 0.02) continue;
    // Log-uniform radius: many small plinks, a few deep bloops.
    const radius = minRadius * Math.pow(maxRadius / minRadius, Math.pow(random(), 1.35));
    const frequency = bubbleFrequency(radius);
    if (frequency > sampleRate * 0.45) continue;
    const damping = bubbleDamping(frequency);
    // The pitch rises as the bubble is squeezed toward the surface.
    const rise = 0.1 * damping * (0.6 + random() * 0.8);
    // Bigger bubbles ring louder; the shower thins out toward its end.
    const fade = Math.exp(-Math.max(0, onset - showerPeak) / (showerSpread * 1.3));
    const amplitude = (0.05 + 0.1 * random()) * Math.pow(radius / 0.002, 0.7) * (early ? 1.2 : fade);
    const start = Math.floor(onset * sampleRate);
    const ring = Math.min(length - start, Math.ceil((5 / damping) * sampleRate));
    let phase = random() * 0.3;
    for (let step = 0; step < ring; step += 1) {
      const time = step * dt;
      phase += 2 * Math.PI * frequency * (1 + rise * time) * dt;
      // A 0.4 ms fade-in keeps the onset from clicking.
      out[start + step] += amplitude * Math.sin(phase) * Math.exp(-damping * time) * Math.min(1, time / 0.0004);
    }
    // A droplet tick on the surface goes with most falling-back bubbles.
    if (!early && random() < 0.6) {
      const tick = Math.min(length - start, Math.ceil(0.004 * sampleRate));
      const tickLevel = amplitude * 0.5;
      const tickPole = pole(3000);
      let tone = 0;
      for (let step = 0; step < tick; step += 1) {
        tone = tickPole * tone + (1 - tickPole) * (random() * 2 - 1);
        out[start + step] += tone * tickLevel * 3 * Math.exp(-(step * dt) / 0.0012);
      }
    }
  }

  // Air and the distance to the listener take the edge off the top: two
  // one-pole lowpasses at 5.5 kHz (12 dB/octave above it).
  const air = pole(5500);
  let first = 0;
  let second = 0;
  for (let index = 0; index < length; index += 1) {
    first = air * first + (1 - air) * out[index];
    second = air * second + (1 - air) * first;
    out[index] = second;
  }

  // Normalise, then a 30 ms fade-out so the buffer ends in silence.
  let peak = 0;
  for (let index = 0; index < length; index += 1) peak = Math.max(peak, Math.abs(out[index]));
  const gain = peak > 0 ? 0.9 / peak : 0;
  const fadeSamples = Math.floor(0.03 * sampleRate);
  for (let index = 0; index < length; index += 1) {
    const tail = Math.min(1, (length - 1 - index) / fadeSamples);
    out[index] *= gain * tail;
  }
  return { samples: out, sampleRate };
}
