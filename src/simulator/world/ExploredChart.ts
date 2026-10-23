/**
 * The fog of war of the chart: which squares of the endless sea the yacht has
 * seen. Pure and serialisable. A square is revealed when the yacht passes
 * within `CHART_REVEAL_RADIUS` of its centre; unrevealed water stays under
 * fog on the map.
 */

/** Side of one chart square, metres. */
export const CHART_CELL = 150;
/** The crew charts everything within this reach of the yacht, metres. */
export const CHART_REVEAL_RADIUS = 280;
/** Squares remembered between visits (the oldest are forgotten first). */
export const CHART_MAX_CELLS = 6000;

export function chartCellKey(column: number, row: number): string {
  return `${column},${row}`;
}

export class ExploredChart {
  private readonly cells = new Set<string>();
  /** Bumped whenever a square is added; the interface redraws on change. */
  revision = 0;
  private lastColumn = Number.NaN;
  private lastRow = Number.NaN;

  constructor(saved: readonly string[] = []) {
    for (const key of saved) if (/^-?\d+,-?\d+$/.test(key)) this.cells.add(key);
    this.trim();
  }

  get size(): number {
    return this.cells.size;
  }

  isExplored(column: number, row: number): boolean {
    return this.cells.has(chartCellKey(column, row));
  }

  isExploredAt(x: number, z: number): boolean {
    return this.isExplored(Math.floor(x / CHART_CELL), Math.floor(z / CHART_CELL));
  }

  /** Reveal the squares around (x, z). Returns true if any square was new. */
  observe(x: number, z: number): boolean {
    const column = Math.floor(x / CHART_CELL);
    const row = Math.floor(z / CHART_CELL);
    if (column === this.lastColumn && row === this.lastRow) return false;
    this.lastColumn = column;
    this.lastRow = row;
    const span = Math.ceil(CHART_REVEAL_RADIUS / CHART_CELL) + 1;
    let added = false;
    for (let dRow = -span; dRow <= span; dRow += 1) {
      for (let dColumn = -span; dColumn <= span; dColumn += 1) {
        const cellColumn = column + dColumn;
        const cellRow = row + dRow;
        const centreX = (cellColumn + 0.5) * CHART_CELL;
        const centreZ = (cellRow + 0.5) * CHART_CELL;
        if (Math.hypot(centreX - x, centreZ - z) > CHART_REVEAL_RADIUS) continue;
        const key = chartCellKey(cellColumn, cellRow);
        if (this.cells.has(key)) continue;
        this.cells.add(key);
        added = true;
      }
    }
    if (added) {
      this.revision += 1;
      this.trim();
    }
    return added;
  }

  serialize(): string[] {
    return [...this.cells];
  }

  private trim(): void {
    // Sets iterate in insertion order, so the oldest squares go first.
    while (this.cells.size > CHART_MAX_CELLS) {
      const oldest = this.cells.values().next().value;
      if (oldest === undefined) break;
      this.cells.delete(oldest);
    }
  }
}
