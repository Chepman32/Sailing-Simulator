/**
 * The noise the cloud volume is carved from, as plain numbers.
 *
 * One small tileable 3D texture holds everything the ray march reads
 * (`shaders/cloudShader.ts`):
 *
 * - R: Perlin–Worley, the billowing body of a cumulus (smooth gradient noise
 *   swollen by cell noise, after Schneider's "Real-time volumetric
 *   cloudscapes of Horizon Zero Dawn");
 * - G: three octaves of cell noise, which erode the body's edge into
 *   cauliflower heads and wisps;
 * - B: low gradient noise, read on a horizontal plane at a very large scale
 *   as the weather: where clouds stand and where the sky is clear;
 * - A: one octave of low cell noise (the big billows alone).
 *
 * Every channel tiles in all three directions, so the texture repeats
 * without a seam. Nothing here touches the renderer; `tests/unit/clouds.test.ts`
 * checks the tiling, the range and the weather's quantiles.
 */

export const CLOUD_NOISE_SIZE = 64;
/** Scales and offsets of the two weather layers (shared by the shader and the CPU sampler). */
export const WEATHER_LAYERS = [
  { scale: 46000, offsetX: 0, offsetZ: 0, level: 0.37, weight: 0.62 },
  { scale: 17000, offsetX: 0.31, offsetZ: 0.57, level: 0.71, weight: 0.38 },
] as const;

function hashInt(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

const GRADIENTS = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
] as const;

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** Gradient (Perlin) noise that repeats every `period` cells, about −1…1. */
function gradientNoise(x: number, y: number, z: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
  let total = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const dx = corner & 1;
    const dy = (corner >> 1) & 1;
    const dz = (corner >> 2) & 1;
    const gradient = GRADIENTS[hashInt(wrap(xi + dx, period), wrap(yi + dy, period), wrap(zi + dz, period), seed) % 12]!;
    const dot = gradient[0] * (xf - dx) + gradient[1] * (yf - dy) + gradient[2] * (zf - dz);
    total += dot * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return total;
}

/** Feature points of a cell-noise lattice of `frequency` cells a side (one point per cell). */
function featurePoints(frequency: number, seed: number): Float32Array {
  const points = new Float32Array(frequency * frequency * frequency * 3);
  let index = 0;
  for (let z = 0; z < frequency; z += 1) {
    for (let y = 0; y < frequency; y += 1) {
      for (let x = 0; x < frequency; x += 1) {
        points[index++] = hashInt(x, y, z, seed) / 4294967296;
        points[index++] = hashInt(x, y, z, seed + 17) / 4294967296;
        points[index++] = hashInt(x, y, z, seed + 31) / 4294967296;
      }
    }
  }
  return points;
}

/** Cell (Worley) noise, inverted: 1 at a feature point, 0 a cell away from every point. Tiles every `frequency` cells. */
function cellNoise(x: number, y: number, z: number, frequency: number, points: Float32Array): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let nearest = 4;
  for (let dz = -1; dz <= 1; dz += 1) {
    const cz = wrap(zi + dz, frequency);
    for (let dy = -1; dy <= 1; dy += 1) {
      const cy = wrap(yi + dy, frequency);
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = wrap(xi + dx, frequency);
        const at = ((cz * frequency + cy) * frequency + cx) * 3;
        const px = xi + dx + points[at]! - x;
        const py = yi + dy + points[at + 1]! - y;
        const pz = zi + dz + points[at + 2]! - z;
        const distance = px * px + py * py + pz * pz;
        if (distance < nearest) nearest = distance;
      }
    }
  }
  return 1 - Math.min(1, Math.sqrt(nearest));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

let cached: { size: number; data: Uint8Array } | null = null;

/**
 * The cloud noise as RGBA bytes, `size`³ texels, x fastest. Built once and
 * kept: about a third of a second of arithmetic at 64³.
 */
export function buildCloudNoise(size = CLOUD_NOISE_SIZE): Uint8Array {
  if (cached && cached.size === size) return cached.data;
  const data = new Uint8Array(size * size * size * 4);
  const low = [4, 8, 16].map((frequency, octave) => ({ frequency, points: featurePoints(frequency, 101 + octave) }));
  const fine = [6, 12, 24].map((frequency, octave) => ({ frequency, points: featurePoints(frequency, 211 + octave) }));
  let index = 0;
  for (let k = 0; k < size; k += 1) {
    const w = (k + 0.5) / size;
    for (let j = 0; j < size; j += 1) {
      const v = (j + 0.5) / size;
      for (let i = 0; i < size; i += 1) {
        const u = (i + 0.5) / size;
        // Smooth body: three octaves of gradient noise.
        const perlin =
          gradientNoise(u * 4, v * 4, w * 4, 4, 7) +
          gradientNoise(u * 8, v * 8, w * 8, 8, 8) * 0.5 +
          gradientNoise(u * 16, v * 16, w * 16, 16, 9) * 0.25;
        const body = clamp01(0.5 + perlin * 0.58);
        const billow =
          cellNoise(u * 4, v * 4, w * 4, 4, low[0]!.points) * 0.625 +
          cellNoise(u * 8, v * 8, w * 8, 8, low[1]!.points) * 0.25 +
          cellNoise(u * 16, v * 16, w * 16, 16, low[2]!.points) * 0.125;
        // Perlin–Worley: the smooth body pushed out where the cells swell.
        const perlinWorley = clamp01((body - (billow - 1)) / (2 - billow));
        const erosion =
          cellNoise(u * 6, v * 6, w * 6, 6, fine[0]!.points) * 0.625 +
          cellNoise(u * 12, v * 12, w * 12, 12, fine[1]!.points) * 0.25 +
          cellNoise(u * 24, v * 24, w * 24, 24, fine[2]!.points) * 0.125;
        const weather =
          gradientNoise(u * 2, v * 2, w * 2, 2, 41) +
          gradientNoise(u * 4, v * 4, w * 4, 4, 42) * 0.5 +
          gradientNoise(u * 8, v * 8, w * 8, 8, 43) * 0.25;
        data[index++] = Math.round(perlinWorley * 255);
        data[index++] = Math.round(clamp01(erosion) * 255);
        data[index++] = Math.round(clamp01(0.5 + weather * 0.62) * 255);
        data[index++] = Math.round(clamp01(cellNoise(u * 4, v * 4, w * 4, 4, low[0]!.points)) * 255);
      }
    }
  }
  cached = { size, data };
  return data;
}

/** One channel of the noise at a point of the unit cube, trilinear and repeating: what the GPU's sampler returns. */
export function sampleCloudNoise(data: Uint8Array, size: number, u: number, v: number, w: number, channel: number): number {
  const x = u * size - 0.5;
  const y = v * size - 0.5;
  const z = w * size - 0.5;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  let total = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const dx = corner & 1;
    const dy = (corner >> 1) & 1;
    const dz = (corner >> 2) & 1;
    const at = ((wrap(zi + dz, size) * size + wrap(yi + dy, size)) * size + wrap(xi + dx, size)) * 4 + channel;
    total += (data[at]! / 255) * (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
  }
  return total;
}

/** The weather over a point of the sea (m): 0…1, clouds stand where it is high. The shader's `cloudWeather`. */
export function cloudWeatherAt(data: Uint8Array, size: number, x: number, z: number): number {
  let total = 0;
  for (const layer of WEATHER_LAYERS) {
    total += sampleCloudNoise(data, size, x / layer.scale + layer.offsetX, layer.level, z / layer.scale + layer.offsetZ, 2) * layer.weight;
  }
  return total;
}

/** Steps of the cover in the threshold table (0, 1/32 … 1). */
export const WEATHER_QUANTILES = 33;

/**
 * For each cover fraction (0…1 in `WEATHER_QUANTILES` steps), the weather
 * value that just that fraction of the sea lies above: the threshold that
 * makes "cover 0.19" mean clouds over 19 % of the sky, whatever the noise's
 * own distribution.
 */
export function weatherThresholds(data: Uint8Array, size = CLOUD_NOISE_SIZE): Float32Array {
  const samples: number[] = [];
  const span = WEATHER_LAYERS[0].scale * 3;
  const count = 96;
  for (let j = 0; j < count; j += 1) {
    for (let i = 0; i < count; i += 1) {
      samples.push(cloudWeatherAt(data, size, ((i + 0.37) / count) * span, ((j + 0.61) / count) * span));
    }
  }
  samples.sort((a, b) => a - b);
  const thresholds = new Float32Array(WEATHER_QUANTILES);
  for (let step = 0; step < WEATHER_QUANTILES; step += 1) {
    const cover = step / (WEATHER_QUANTILES - 1);
    const at = Math.min(samples.length - 1, Math.max(0, Math.round((1 - cover) * (samples.length - 1))));
    thresholds[step] = samples[at]!;
  }
  // No cover at all: above every sample; full cover: below every one.
  thresholds[0] = samples[samples.length - 1]! + 0.02;
  thresholds[WEATHER_QUANTILES - 1] = samples[0]! - 0.02;
  return thresholds;
}

/** The weather threshold for a cover fraction, interpolated in the table. */
export function weatherThresholdFor(thresholds: Float32Array, cover: number): number {
  const at = clamp01(cover) * (thresholds.length - 1);
  const lower = Math.floor(at);
  const upper = Math.min(thresholds.length - 1, lower + 1);
  return thresholds[lower]! + (thresholds[upper]! - thresholds[lower]!) * (at - lower);
}
