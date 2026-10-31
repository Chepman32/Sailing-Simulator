/**
 * The fine dust a dismissed prompt dissolves into, as plain numbers.
 *
 * Modelled on the way a deleted message disintegrates in a messenger: the
 * picture is cut into grains a pixel or two across, a wave sweeps over it and
 * releases them column by column, and each grain lifts, drifts with a little
 * turbulence and fades as it shrinks. Here the drift also bends toward the
 * sound button the prompt belongs to, so the dust visibly settles there.
 * `SoundPrompt` paints the grains on a canvas; this module only moves them.
 */

export type RandomSource = () => number;

/** Edge of one grain, CSS pixels (a messenger's dust is about this fine). */
export const GRAIN_SIZE = 1.5;
/** Seconds the release wave takes to cross the prompt. */
export const SWEEP_SECONDS = 0.55;
/** Shortest and longest life of a grain after its release, seconds. */
export const GRAIN_LIFE_MIN = 0.55;
export const GRAIN_LIFE_MAX = 1.05;
/** Upper bound on the grains of one prompt, whatever its size. */
export const MAX_GRAINS = 9000;

export type Dust = {
  count: number;
  /** Position, CSS pixels, page coordinates. */
  x: Float32Array;
  y: Float32Array;
  /** Where the grain was in the picture. */
  originX: Float32Array;
  originY: Float32Array;
  /** Its own scatter away from that place (integrated `vx`, `vy`). */
  driftX: Float32Array;
  driftY: Float32Array;
  /** Share of the way to the button the grain covers before it fades, 0…1. */
  reach: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Seconds until the grain is released, then its age (negative before release). */
  age: Float32Array;
  life: Float32Array;
  /** Index into the colour table of the grain. */
  colour: Uint32Array;
  /** Phase of the grain's own wobble. */
  phase: Float32Array;
  /** Edge of a grain, CSS pixels. */
  size: number;
};

/**
 * Grains for every opaque cell of a picture `width × height` CSS pixels at
 * page position (left, top). `opaque(x, y)` returns the colour index of the
 * cell at that CSS position, or −1 where the picture is transparent.
 */
export function createDust(
  left: number,
  top: number,
  width: number,
  height: number,
  opaque: (x: number, y: number) => number,
  random: RandomSource = Math.random,
): Dust {
  // A coarser grain only for a prompt so large it would exceed the budget.
  const size = Math.max(GRAIN_SIZE, Math.sqrt((width * height) / MAX_GRAINS));
  const columns = Math.max(1, Math.floor(width / size));
  const rows = Math.max(1, Math.floor(height / size));
  const cells: number[] = [];
  const colours: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const colour = opaque((column + 0.5) * size, (row + 0.5) * size);
      if (colour < 0) continue;
      cells.push(row * columns + column);
      colours.push(colour);
    }
  }
  const count = Math.min(cells.length, MAX_GRAINS);
  const dust: Dust = {
    count,
    x: new Float32Array(count),
    y: new Float32Array(count),
    originX: new Float32Array(count),
    originY: new Float32Array(count),
    driftX: new Float32Array(count),
    driftY: new Float32Array(count),
    reach: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    age: new Float32Array(count),
    life: new Float32Array(count),
    colour: new Uint32Array(count),
    phase: new Float32Array(count),
    size,
  };
  for (let index = 0; index < count; index += 1) {
    const cell = cells[index]!;
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    const across = column / columns;
    dust.x[index] = dust.originX[index] = left + column * size;
    dust.y[index] = dust.originY[index] = top + row * size;
    dust.reach[index] = 0.7 + random() * 0.3;
    // The wave runs across from left to right, slightly ragged.
    dust.age[index] = -(across * SWEEP_SECONDS + random() * 0.12);
    dust.life[index] = GRAIN_LIFE_MIN + random() * (GRAIN_LIFE_MAX - GRAIN_LIFE_MIN);
    // Lift and scatter: mostly up and away, a few grains thrown wider.
    const spread = random() < 0.12 ? 2.2 : 1;
    dust.vx[index] = (random() - 0.35) * 46 * spread;
    dust.vy[index] = -(14 + random() * 42) * spread;
    dust.colour[index] = colours[index]!;
    dust.phase[index] = random() * Math.PI * 2;
  }
  return dust;
}

/**
 * Advances every grain by `dt` seconds. A released grain first lifts and
 * scatters on its own (its velocity slowed by the air), and is then carried
 * on a curving path toward (targetX, targetY), wobbling as it goes. Returns
 * how many grains are still visible (waiting or alive).
 */
export function stepDust(dust: Dust, dt: number, targetX: number, targetY: number, time: number): number {
  const step = Math.min(Math.max(dt, 0), 0.05);
  let visible = 0;
  const drag = Math.exp(-2.4 * step);
  for (let index = 0; index < dust.count; index += 1) {
    const age = dust.age[index]! + step;
    dust.age[index] = age;
    if (age < 0) {
      visible += 1;
      continue;
    }
    const life = dust.life[index]!;
    if (age >= life) continue;
    visible += 1;
    const vx = dust.vx[index]! * drag;
    const vy = dust.vy[index]! * drag;
    dust.vx[index] = vx;
    dust.vy[index] = vy;
    const driftX = dust.driftX[index]! + vx * step;
    const driftY = dust.driftY[index]! + vy * step;
    dust.driftX[index] = driftX;
    dust.driftY[index] = driftY;
    // Slow to leave, then quicker: the stream accelerates into the button.
    const progress = age / life;
    const carried = progress * progress * (3 - 2 * progress) * progress * dust.reach[index]!;
    const originX = dust.originX[index]!;
    const originY = dust.originY[index]!;
    const toX = targetX - originX;
    const toY = targetY - originY;
    const length = Math.hypot(toX, toY) || 1;
    // A sideways swirl that is widest halfway along.
    const swirl = Math.sin(time * 7 + dust.phase[index]!) * 14 * progress * (1 - progress) * 4;
    dust.x[index] = originX + driftX * (1 - carried) + toX * carried + (-toY / length) * swirl;
    dust.y[index] = originY + driftY * (1 - carried) + toY * carried + (toX / length) * swirl;
  }
  return visible;
}

/** Opacity and scale of a grain at its age: full until released, then fading as it shrinks. */
export function grainLook(age: number, life: number): { alpha: number; scale: number } {
  if (age < 0) return { alpha: 1, scale: 1 };
  const t = Math.min(1, age / Math.max(life, 1e-4));
  return { alpha: (1 - t) * (1 - t * 0.3), scale: 1 - t * 0.55 };
}
