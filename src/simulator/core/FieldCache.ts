/**
 * A fixed scalar field of the world (the depth the animals see, how far the
 * sea's waves are calmed by a beach…) read from a lazily filled grid and
 * interpolated between its corners.
 *
 * These fields depend only on where a point is, never on time, but each
 * reading walks the nearby islands and their noisy coastlines; the animals'
 * shore avoidance and every wave sample near land asked for them hundreds of
 * times a frame (a third of a frame's simulation beside an island). Here each
 * grid corner is worked out once and kept: a reading is four lookups. The
 * grid is fine against the scale the fields change over (a cell of a metre
 * or two for fields that change over tens), and bilinear interpolation keeps
 * the result continuous, so nothing steering by it can feel the cells.
 *
 * Memory is bounded: past `limit` corners the cache simply starts over (a
 * voyage leaves the old waters behind).
 */
export type Field = (x: number, z: number) => number;

/** Integer grid coordinates packed into one exact double (within ±2^24 cells). */
const OFFSET = 2 ** 24;
const SPAN = 2 ** 25;

export function cachedField(field: Field, cell: number, limit = 250_000): Field {
  const corners = new Map<number, number>();
  const corner = (i: number, j: number): number => {
    const key = (i + OFFSET) * SPAN + (j + OFFSET);
    let value = corners.get(key);
    if (value === undefined) {
      if (corners.size >= limit) corners.clear();
      value = field(i * cell, j * cell);
      corners.set(key, value);
    }
    return value;
  };
  const inverse = 1 / cell;
  return (x: number, z: number): number => {
    const fx = x * inverse;
    const fz = z * inverse;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = corner(i, j);
    const b = corner(i + 1, j);
    const c = corner(i, j + 1);
    const d = corner(i + 1, j + 1);
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}
