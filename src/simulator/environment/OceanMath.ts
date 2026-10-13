export type OceanWave = {
  directionX: number;
  directionZ: number;
  amplitude: number;
  wavelength: number;
  speed: number;
  steepness: number;
};

export type OceanSample = {
  height: number;
  normalX: number;
  normalY: number;
  normalZ: number;
};

/**
 * Shared displacement spectrum. These six components are evaluated identically
 * by the GLSL vertex stage and by {@link sampleOcean}, so buoyancy, wake
 * decals, wildlife contact and the camera floor all describe the rendered
 * surface.
 *
 * The set approximates a moderate trade-wind sea (about 15 kn of breeze): a
 * long ground swell, two wind-sea components fanned around the true wind
 * direction (0.85, 0.53), and three shorter chop components. Every wavelength
 * stays above 5 m so the focused vertex grid can resolve it; anything shorter
 * lives in {@link OCEAN_DETAIL_WAVES} and is shaded per fragment only.
 *
 * Invariant: the summed slope `Σ amplitude · 2π / wavelength` stays near 0.33,
 * which keeps every sampled normal well above the tested 0.8 vertical limit.
 */
export const OCEAN_WAVES: readonly OceanWave[] = [
  { directionX: 0.94, directionZ: 0.34, amplitude: 0.36, wavelength: 44, speed: 1.0, steepness: 0.34 },
  { directionX: 0.8, directionZ: 0.6, amplitude: 0.24, wavelength: 27, speed: 1.03, steepness: 0.32 },
  { directionX: 0.99, directionZ: 0.1, amplitude: 0.15, wavelength: 17, speed: 0.97, steepness: 0.28 },
  { directionX: 0.55, directionZ: 0.83, amplitude: 0.1, wavelength: 11.5, speed: 1.05, steepness: 0.24 },
  { directionX: 0.97, directionZ: -0.24, amplitude: 0.062, wavelength: 7.6, speed: 0.96, steepness: 0.2 },
  { directionX: 0.3, directionZ: 0.95, amplitude: 0.04, wavelength: 5.1, speed: 1.07, steepness: 0.16 },
] as const;

/**
 * Sea state: how high the sea runs. Weather sets one number, the wave scale,
 * and every consumer (the vertex stage, the fragment stage, the height
 * sampler for the yacht, wake and wildlife) reads the same per-component
 * amplitude factors derived from it, so the water that is drawn is always the
 * water that is sampled.
 *
 * Wind builds the long components first and the short chop least, as a real
 * sea does: a gale piles up swell several metres high, while ripples stay
 * ripples. The factors therefore grow with wavelength, which also keeps the
 * summed slope in check at the top of the range.
 *
 * Scale 1 is the trade-wind sea described above; 0.35 is nearly glassy, 4.5 a
 * hurricane sea with crest-to-trough heights around eight metres.
 */
export const SEA_SCALE_MIN = 0.35;
export const SEA_SCALE_MAX = 4.5;
/** Share of the growth above scale 1 that each component takes, longest first. */
const SEA_GROWTH: readonly number[] = [1, 0.7, 0.35, 0.15, 0.05, 0];

/** Amplitude factor of every component for a wave scale. */
export function seaWaveFactors(scale: number, target: number[] = new Array<number>(OCEAN_WAVES.length)): number[] {
  const bounded = Math.min(SEA_SCALE_MAX, Math.max(SEA_SCALE_MIN, Number.isFinite(scale) ? scale : 1));
  for (let index = 0; index < OCEAN_WAVES.length; index += 1) {
    target[index] = bounded >= 1 ? 1 + (bounded - 1) * (SEA_GROWTH[index] ?? 0) : bounded;
  }
  return target;
}

/**
 * The factors in force right now. The array is shared by reference with the
 * GPU (`uSeaFactors`), so one in-place update reaches every shader.
 */
export const seaFactors: number[] = seaWaveFactors(1);
let currentSeaScale = 1;

export function setSeaScale(scale: number): void {
  currentSeaScale = Math.min(SEA_SCALE_MAX, Math.max(SEA_SCALE_MIN, Number.isFinite(scale) ? scale : 1));
  seaWaveFactors(currentSeaScale, seaFactors);
}

export function getSeaScale(): number {
  return currentSeaScale;
}

/** Largest crest fold (steepness × slope, summed) the sea state can show; the shader's crest scale. */
export function maximumOceanFold(factors: readonly number[] = seaFactors): number {
  let fold = 0;
  OCEAN_WAVES.forEach((wave, index) => {
    fold += wave.steepness * wave.amplitude * (factors[index] ?? 1) * ((Math.PI * 2) / wave.wavelength);
  });
  return fold;
}

/**
 * Significant wave height (the mean of the highest third of the waves) in
 * metres for a wave scale: four times the standard deviation of the surface.
 */
export function significantWaveHeight(scale: number = currentSeaScale): number {
  const factors = seaWaveFactors(scale);
  let variance = 0;
  OCEAN_WAVES.forEach((wave, index) => {
    const amplitude = wave.amplitude * (factors[index] ?? 1);
    variance += 0.5 * amplitude * amplitude;
  });
  return 4 * Math.sqrt(variance);
}

export type OceanDetailWave = {
  directionX: number;
  directionZ: number;
  /** Peak surface slope (amplitude × wave number); dimensionless. */
  slope: number;
  wavelength: number;
  speed: number;
};

/**
 * Short gravity waves that only perturb the shading normal. They are far too
 * small to move the yacht, so they deliberately have no CPU height companion.
 * The fragment stage fades each one out as it approaches the pixel footprint
 * and converts the lost energy into specular roughness; still finer capillary
 * ripples are added there as drifting noise.
 */
export const OCEAN_DETAIL_WAVES: readonly OceanDetailWave[] = [
  { directionX: 0.72, directionZ: 0.69, slope: 0.046, wavelength: 3.4, speed: 1.02 },
  { directionX: 0.98, directionZ: -0.18, slope: 0.044, wavelength: 2.3, speed: 0.95 },
  { directionX: 0.36, directionZ: 0.93, slope: 0.042, wavelength: 1.56, speed: 1.08 },
  { directionX: 0.9, directionZ: 0.44, slope: 0.041, wavelength: 1.07, speed: 0.98 },
  { directionX: 0.62, directionZ: -0.78, slope: 0.038, wavelength: 0.73, speed: 1.1 },
  { directionX: -0.2, directionZ: 0.98, slope: 0.036, wavelength: 0.5, speed: 0.93 },
] as const;

/** Largest slope the shared displacement spectrum can produce at any point. */
export function maximumOceanSlope(waves: readonly OceanWave[] = OCEAN_WAVES, factors: readonly number[] = []): number {
  let slope = 0;
  waves.forEach((wave, index) => {
    slope += wave.amplitude * (factors[index] ?? 1) * ((Math.PI * 2) / wave.wavelength);
  });
  return slope;
}

/** Precomputed per-wave constants; the spectrum is evaluated thousands of times a second. */
type WaveTerm = {
  directionX: number;
  directionZ: number;
  amplitude: number;
  waveNumber: number;
  angularSpeed: number;
  /** Horizontal Gerstner excursion, `steepness · amplitude`. */
  excursion: number;
  steepness: number;
};

const WAVE_TERMS: readonly WaveTerm[] = OCEAN_WAVES.map((wave) => {
  const directionLength = Math.hypot(wave.directionX, wave.directionZ) || 1;
  const waveNumber = (Math.PI * 2) / wave.wavelength;
  return {
    directionX: wave.directionX / directionLength,
    directionZ: wave.directionZ / directionLength,
    amplitude: wave.amplitude,
    waveNumber,
    angularSpeed: Math.sqrt(9.81 * waveNumber) * wave.speed,
    excursion: wave.steepness * wave.amplitude,
    steepness: wave.steepness,
  };
});

/**
 * Fixed-point steps used to find which undisplaced grid point the rendered
 * surface carries over a given world position. The horizontal Gerstner
 * excursion contracts by Σ steepness·k·A ≈ 0.08 per step, so two steps leave
 * an error of a few millimetres.
 */
export const SURFACE_INVERSION_ITERATIONS = 2;

/**
 * The GPU moves every surface vertex sideways as well as up (Gerstner
 * crests sharpen toward each other). The water standing over world point
 * (x, z) therefore belongs to a slightly different base point. This returns
 * that base point, so a sample describes the surface actually drawn there.
 */
export function surfaceBasePoint(x: number, z: number, time: number, target: { x: number; z: number }): void {
  let baseX = x;
  let baseZ = z;
  for (let iteration = 0; iteration < SURFACE_INVERSION_ITERATIONS; iteration += 1) {
    let offsetX = 0;
    let offsetZ = 0;
    for (let index = 0; index < WAVE_TERMS.length; index += 1) {
      const wave = WAVE_TERMS[index]!;
      const phase = wave.waveNumber * (wave.directionX * baseX + wave.directionZ * baseZ) - wave.angularSpeed * time;
      const cosine = Math.cos(phase);
      const excursion = wave.excursion * seaFactors[index]!;
      offsetX += wave.directionX * excursion * cosine;
      offsetZ += wave.directionZ * excursion * cosine;
    }
    baseX = x - offsetX;
    baseZ = z - offsetZ;
  }
  target.x = baseX;
  target.z = baseZ;
}

const scratchBase = { x: 0, z: 0 };

/**
 * Height and normal of the rendered sea surface above world point (x, z).
 *
 * `depth` (metres below the mean surface, default 0) returns instead the
 * vertical excursion of the water particle that sits at that depth: linear
 * wave theory attenuates each component by e^(−k·depth). A whale cruising
 * at eight metres is barely lifted by the swell; a dolphin at the surface
 * rides it fully.
 */
export function sampleOcean(x: number, z: number, time: number, depth = 0): OceanSample {
  surfaceBasePoint(x, z, time, scratchBase);
  const baseX = scratchBase.x;
  const baseZ = scratchBase.z;
  const submerged = Math.max(0, depth);
  let height = 0;
  let slopeX = 0;
  let slopeZ = 0;
  let compression = 0;

  for (let index = 0; index < WAVE_TERMS.length; index += 1) {
    const wave = WAVE_TERMS[index]!;
    const phase = wave.waveNumber * (wave.directionX * baseX + wave.directionZ * baseZ) - wave.angularSpeed * time;
    const sine = Math.sin(phase);
    const cosine = Math.cos(phase);
    const attenuation = submerged > 0 ? Math.exp(-wave.waveNumber * submerged) : 1;
    const amplitude = wave.amplitude * seaFactors[index]!;
    const peakSlope = amplitude * wave.waveNumber * attenuation;
    height += amplitude * attenuation * sine;
    slopeX += peakSlope * wave.directionX * cosine;
    slopeZ += peakSlope * wave.directionZ * cosine;
    compression += wave.steepness * peakSlope * sine;
  }

  // Gerstner surface normal: the crests are compressed horizontally, which
  // shortens the vertical component under them.
  const normalY = 1 - compression;
  const inverseLength = 1 / Math.hypot(slopeX, normalY, slopeZ);
  return {
    height,
    normalX: -slopeX * inverseLength,
    normalY: normalY * inverseLength,
    normalZ: -slopeZ * inverseLength,
  };
}

/** Dominant wavenumber of the swell, for quick attenuation estimates. */
export const SWELL_WAVENUMBER = (Math.PI * 2) / (OCEAN_WAVES[0]?.wavelength ?? 44);
