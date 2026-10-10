/**
 * Camera-focused ocean grid.
 *
 * The centre of the grid is a uniform lattice fine enough to carry every wave
 * in the shared displacement spectrum. Outside it the cells grow smoothly to
 * the horizon. Because the mesh is re-centred in whole inner cells, the dense
 * lattice never slides over the waves it is sampling.
 *
 * Each vertex records the size of its largest neighbouring cell. The vertex
 * shader uses that to stop displacing a wave once the local cells can no
 * longer resolve it, which removes far-field geometric aliasing; the fragment
 * stage keeps shading those waves analytically.
 */

export const OCEAN_SIZE = 1800;
const INNER_FRACTION = 0.6;

export type OceanGrid = {
  positions: Float32Array;
  spacing: Float32Array;
  indices: Uint32Array;
  /** Edge length of one cell in the uniform centre, in metres. */
  cellSize: number;
  /** Half extent of the uniform centre, in metres. */
  innerRadius: number;
};

export function oceanCellSize(segments: number): number {
  return Math.min(2, Math.max(1.1, 2.04 - 0.0035 * segments));
}

export function createOceanGrid(segments: number): OceanGrid {
  const count = Math.max(8, Math.round(segments / 2) * 2);
  const half = count / 2;
  const halfExtent = OCEAN_SIZE / 2;
  const cellSize = oceanCellSize(count);
  const innerCells = Math.round(half * INNER_FRACTION);
  const innerRadius = innerCells * cellSize;
  const outerCells = half - innerCells;
  const linearGrowth = cellSize * outerCells;
  const cubicGrowth = halfExtent - innerRadius - linearGrowth;

  const coordinate = (index: number): number => {
    const offset = index - half;
    const magnitude = Math.abs(offset);
    if (magnitude <= innerCells) return offset * cellSize;
    const t = (magnitude - innerCells) / outerCells;
    return Math.sign(offset) * (innerRadius + linearGrowth * t + cubicGrowth * t * t * t);
  };

  const axis = new Float32Array(count + 1);
  const axisSpacing = new Float32Array(count + 1);
  for (let index = 0; index <= count; index += 1) axis[index] = coordinate(index);
  for (let index = 0; index <= count; index += 1) {
    const before = index > 0 ? axis[index] - axis[index - 1] : 0;
    const after = index < count ? axis[index + 1] - axis[index] : 0;
    axisSpacing[index] = Math.max(before, after);
  }

  const side = count + 1;
  const positions = new Float32Array(side * side * 3);
  const spacing = new Float32Array(side * side);
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const vertex = row * side + column;
      positions[vertex * 3] = axis[column];
      positions[vertex * 3 + 1] = 0;
      positions[vertex * 3 + 2] = axis[row];
      spacing[vertex] = Math.max(axisSpacing[column], axisSpacing[row]);
    }
  }

  const indices = new Uint32Array(count * count * 6);
  let cursor = 0;
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const a = row * side + column;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      // Counter-clockwise seen from above (+Y), so the top face is the front.
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  return { positions, spacing, indices, cellSize, innerRadius };
}
