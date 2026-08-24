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

export const OCEAN_WAVES: readonly OceanWave[] = [
  { directionX: 0.94, directionZ: 0.34, amplitude: 0.34, wavelength: 26, speed: 0.94, steepness: 0.3 },
  { directionX: 0.28, directionZ: 0.96, amplitude: 0.18, wavelength: 15, speed: 1.14, steepness: 0.24 },
  { directionX: -0.72, directionZ: 0.69, amplitude: 0.065, wavelength: 8.4, speed: 1.36, steepness: 0.18 },
  { directionX: 0.63, directionZ: -0.78, amplitude: 0.022, wavelength: 4.6, speed: 1.65, steepness: 0.1 },
] as const;

export function sampleOcean(x: number, z: number, time: number): OceanSample {
  let height = 0;
  let slopeX = 0;
  let slopeZ = 0;

  for (const wave of OCEAN_WAVES) {
    const directionLength = Math.hypot(wave.directionX, wave.directionZ) || 1;
    const directionX = wave.directionX / directionLength;
    const directionZ = wave.directionZ / directionLength;
    const waveNumber = (Math.PI * 2) / wave.wavelength;
    const angularSpeed = Math.sqrt(9.81 * waveNumber) * wave.speed;
    const phase = waveNumber * (directionX * x + directionZ * z) - angularSpeed * time;
    const cosine = Math.cos(phase);
    height += wave.amplitude * Math.sin(phase);
    slopeX += wave.amplitude * waveNumber * directionX * cosine;
    slopeZ += wave.amplitude * waveNumber * directionZ * cosine;
  }

  const inverseLength = 1 / Math.hypot(slopeX, 1, slopeZ);
  return {
    height,
    normalX: -slopeX * inverseLength,
    normalY: inverseLength,
    normalZ: -slopeZ * inverseLength,
  };
}
