/**
 * The chart: what the skipper has seen of the sea. The world is endless, so
 * the explored sea is kept as a sparse set of square cells of
 * {@link FOG_CELL} metres; every cell within {@link SIGHT_RANGE} of the yacht
 * (a lookout's horizon for islands and wrecks, a little short of the real
 * one) is lifted out of the fog. The set is saved as a compact string so a
 * long voyage still costs only a few kilobytes of storage. Pure; the chart
 * view draws it, the simulator feeds it the yacht's position.
 */

/** Side of one fog cell, metres. */
export const FOG_CELL = 160;
/** Radius around the yacht lifted out of the fog, metres. */
export const SIGHT_RANGE = 720;
/** Most cells remembered (about 77 km² of sea); the oldest go first beyond it. */
export const MAX_EXPLORED = 24000;
/** Yacht track: a point every this many metres, and how many are kept. */
export const TRACK_STEP = 30;
export const TRACK_POINTS = 600;

export function fogCell(v: number): number {
  return Math.floor(v / FOG_CELL);
}

export function cellKey(column: number, row: number): number {
  // Columns and rows within ±2^20 cells (±167 000 km) pack into one safe integer.
  return (column + 1048576) * 2097152 + (row + 1048576);
}

export function cellOf(key: number): [number, number] {
  const row = (key % 2097152) - 1048576;
  const column = Math.floor(key / 2097152) - 1048576;
  return [column, row];
}

export class ExploredSea {
  /** Keys in insertion order (a Set keeps it), so the oldest can be dropped. */
  readonly cells = new Set<number>();
  /** Bumped whenever a cell is added: views redraw their fog when it changes. */
  revision = 0;
  private lastColumn = Number.NaN;
  private lastRow = Number.NaN;

  /** Lifts the fog around (x, z). Returns true when anything new was revealed. */
  reveal(x: number, z: number, range = SIGHT_RANGE): boolean {
    const column = fogCell(x);
    const row = fogCell(z);
    // The disc only changes when the yacht enters another cell.
    if (column === this.lastColumn && row === this.lastRow) return false;
    this.lastColumn = column;
    this.lastRow = row;
    const reach = Math.ceil(range / FOG_CELL);
    let added = false;
    for (let dz = -reach; dz <= reach; dz += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        // Nearest point of the cell to the yacht's cell centre.
        const gx = Math.max(0, Math.abs(dx) - 0.5) * FOG_CELL;
        const gz = Math.max(0, Math.abs(dz) - 0.5) * FOG_CELL;
        if (gx * gx + gz * gz > range * range) continue;
        const key = cellKey(column + dx, row + dz);
        if (this.cells.has(key)) continue;
        this.cells.add(key);
        added = true;
      }
    }
    if (added) {
      this.revision += 1;
      if (this.cells.size > MAX_EXPLORED) {
        let drop = this.cells.size - MAX_EXPLORED;
        for (const key of this.cells) {
          this.cells.delete(key);
          if (--drop <= 0) break;
        }
      }
    }
    return added;
  }

  /** Marks the cell holding (x, z) as seen. */
  markPoint(x: number, z: number): void {
    const key = cellKey(fogCell(x), fogCell(z));
    if (this.cells.has(key) || this.cells.size >= MAX_EXPLORED) return;
    this.cells.add(key);
    this.revision += 1;
  }

  has(column: number, row: number): boolean {
    return this.cells.has(cellKey(column, row));
  }

  /** Has the point (x, z) been seen? */
  seen(x: number, z: number): boolean {
    return this.has(fogCell(x), fogCell(z));
  }

  /** Forgets the last cell, so the next `reveal` runs in full (after a teleport). */
  invalidate(): void {
    this.lastColumn = Number.NaN;
    this.lastRow = Number.NaN;
  }

  /**
   * Compact form: runs of cells along a row, "column,row,length;" in base 36.
   * A voyage reveals bands of whole rows, so runs shrink it several times.
   */
  serialize(): string {
    const rows = new Map<number, number[]>();
    for (const key of this.cells) {
      const [column, row] = cellOf(key);
      let list = rows.get(row);
      if (!list) rows.set(row, (list = []));
      list.push(column);
    }
    const parts: string[] = [];
    for (const [row, columns] of rows) {
      columns.sort((a, b) => a - b);
      let start = columns[0]!;
      let length = 1;
      for (let index = 1; index <= columns.length; index += 1) {
        const column = columns[index];
        if (column === start + length) {
          length += 1;
          continue;
        }
        parts.push(`${start.toString(36)},${row.toString(36)}${length > 1 ? `,${length.toString(36)}` : ""}`);
        if (column !== undefined) {
          start = column;
          length = 1;
        }
      }
    }
    return parts.join(";");
  }

  restore(text: unknown): void {
    this.cells.clear();
    this.invalidate();
    if (typeof text !== "string" || text.length === 0) return;
    for (const part of text.split(";")) {
      const [a, b, c] = part.split(",");
      const column = parseInt(a ?? "", 36);
      const row = parseInt(b ?? "", 36);
      const length = c === undefined ? 1 : parseInt(c, 36);
      if (!Number.isFinite(column) || !Number.isFinite(row) || !Number.isFinite(length)) continue;
      if (Math.abs(column) > 1048000 || Math.abs(row) > 1048000) continue;
      for (let index = 0; index < Math.min(length, 4096); index += 1) {
        this.cells.add(cellKey(column + index, row));
        if (this.cells.size >= MAX_EXPLORED) break;
      }
      if (this.cells.size >= MAX_EXPLORED) break;
    }
    this.revision += 1;
  }
}

/** The yacht's wake on the chart: a point every {@link TRACK_STEP} metres. */
export class Track {
  readonly points: number[] = [];

  add(x: number, z: number): boolean {
    const length = this.points.length;
    if (length >= 2) {
      const dx = x - this.points[length - 2]!;
      const dz = z - this.points[length - 1]!;
      if (dx * dx + dz * dz < TRACK_STEP * TRACK_STEP) return false;
      // A jump (a tow, a restart) breaks the line.
      if (dx * dx + dz * dz > 400 * 400) this.points.push(Number.NaN, Number.NaN);
    }
    this.points.push(x, z);
    if (this.points.length > TRACK_POINTS * 2) this.points.splice(0, this.points.length - TRACK_POINTS * 2);
    return true;
  }
}
