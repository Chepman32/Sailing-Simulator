import * as THREE from "three";

/**
 * One step of Loop subdivision for a skinned, flat-coloured mesh.
 *
 * Imported low-poly animals are built from separate parts whose vertices are
 * split at every colour seam and hard edge. The surface is first welded by
 * position, so the parts subdivide as one body and stay joined; edges whose
 * faces meet at more than `creaseAngle` (a wing's trailing edge, the tip of
 * a beak) and the mesh's open borders are kept sharp with Loop's crease
 * rules, so the silhouette keeps its shape while the rest rounds out.
 *
 * Every new triangle keeps the colour of the triangle it came from, so the
 * plumage boundaries stay crisp. New vertices on an edge take the average of
 * the two ends' skin weights (the four largest, renormalised), which makes
 * the subdivided body deform exactly between its original vertices.
 */

type Corner = { position: number; source: number };

const key3 = (x: number, y: number, z: number, precision: number): string =>
  `${Math.round(x * precision)},${Math.round(y * precision)},${Math.round(z * precision)}`;

export function subdivideSkinnedLoop(geometry: THREE.BufferGeometry, creaseAngle = (55 * Math.PI) / 180): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  const color = geometry.getAttribute("color");
  const index = geometry.getIndex();
  const triangleCount = (index ? index.count : position.count) / 3;
  const corner = (triangle: number, k: number): number => (index ? index.getX(triangle * 3 + k) : triangle * 3 + k);

  // Weld vertices by position: one surface point per location.
  const precision = 1e5;
  const weldOf = new Int32Array(position.count);
  const weldKey = new Map<string, number>();
  const welded: number[] = [];
  const weldSource: number[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const key = key3(position.getX(vertex), position.getY(vertex), position.getZ(vertex), precision);
    let id = weldKey.get(key);
    if (id === undefined) {
      id = welded.length / 3;
      weldKey.set(key, id);
      welded.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      weldSource.push(vertex);
    }
    weldOf[vertex] = id;
  }
  const weldCount = welded.length / 3;

  // Triangles over welded ids, their face normals, and every edge's faces.
  const triangles: Corner[][] = [];
  const faceNormals: THREE.Vector3[] = [];
  const edges = new Map<string, { a: number; b: number; faces: number[]; opposite: number[] }>();
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const corners = [0, 1, 2].map((k) => {
      const source = corner(triangle, k);
      return { position: weldOf[source]!, source };
    });
    if (corners[0]!.position === corners[1]!.position || corners[1]!.position === corners[2]!.position || corners[0]!.position === corners[2]!.position) continue;
    const face = triangles.length;
    triangles.push(corners);
    va.fromArray(welded, corners[0]!.position * 3);
    vb.fromArray(welded, corners[1]!.position * 3);
    vc.fromArray(welded, corners[2]!.position * 3);
    faceNormals.push(new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize());
    for (let k = 0; k < 3; k += 1) {
      const a = corners[k]!.position;
      const b = corners[(k + 1) % 3]!.position;
      const c = corners[(k + 2) % 3]!.position;
      const key = edgeKey(a, b);
      let edge = edges.get(key);
      if (!edge) {
        edge = { a, b, faces: [], opposite: [] };
        edges.set(key, edge);
      }
      edge.faces.push(face);
      edge.opposite.push(c);
    }
  }

  const limit = Math.cos(creaseAngle);
  const sharp = (edge: { faces: number[] }): boolean =>
    edge.faces.length !== 2 || faceNormals[edge.faces[0]!]!.dot(faceNormals[edge.faces[1]!]!) < limit;

  // Neighbours of each welded vertex, and its sharp neighbours.
  const neighbours: Set<number>[] = Array.from({ length: weldCount }, () => new Set<number>());
  const sharpNeighbours: Set<number>[] = Array.from({ length: weldCount }, () => new Set<number>());
  edges.forEach((edge) => {
    neighbours[edge.a]!.add(edge.b);
    neighbours[edge.b]!.add(edge.a);
    if (sharp(edge)) {
      sharpNeighbours[edge.a]!.add(edge.b);
      sharpNeighbours[edge.b]!.add(edge.a);
    }
  });

  // Even (old) vertices.
  const even = new Float32Array(weldCount * 3);
  for (let vertex = 0; vertex < weldCount; vertex += 1) {
    const sharpCount = sharpNeighbours[vertex]!.size;
    const x = welded[vertex * 3]!;
    const y = welded[vertex * 3 + 1]!;
    const z = welded[vertex * 3 + 2]!;
    if (sharpCount > 2) {
      // A corner: stays where it is.
      even.set([x, y, z], vertex * 3);
    } else if (sharpCount === 2) {
      // On a crease: only the crease neighbours pull.
      let sx = 0;
      let sy = 0;
      let sz = 0;
      sharpNeighbours[vertex]!.forEach((other) => {
        sx += welded[other * 3]!;
        sy += welded[other * 3 + 1]!;
        sz += welded[other * 3 + 2]!;
      });
      even.set([x * 0.75 + sx * 0.125, y * 0.75 + sy * 0.125, z * 0.75 + sz * 0.125], vertex * 3);
    } else {
      const n = neighbours[vertex]!.size;
      if (n < 3) {
        even.set([x, y, z], vertex * 3);
        continue;
      }
      const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      let sx = 0;
      let sy = 0;
      let sz = 0;
      neighbours[vertex]!.forEach((other) => {
        sx += welded[other * 3]!;
        sy += welded[other * 3 + 1]!;
        sz += welded[other * 3 + 2]!;
      });
      even.set([x * (1 - n * beta) + sx * beta, y * (1 - n * beta) + sy * beta, z * (1 - n * beta) + sz * beta], vertex * 3);
    }
  }

  // Odd (edge) vertices.
  const odd = new Map<string, { position: THREE.Vector3; a: number; b: number }>();
  edges.forEach((edge, key) => {
    const a = edge.a;
    const b = edge.b;
    const point = new THREE.Vector3();
    if (sharp(edge)) {
      point.set(
        (welded[a * 3]! + welded[b * 3]!) / 2,
        (welded[a * 3 + 1]! + welded[b * 3 + 1]!) / 2,
        (welded[a * 3 + 2]! + welded[b * 3 + 2]!) / 2,
      );
    } else {
      const c = edge.opposite[0]!;
      const d = edge.opposite[1]!;
      for (let axis = 0; axis < 3; axis += 1) {
        point.setComponent(
          axis,
          0.375 * (welded[a * 3 + axis]! + welded[b * 3 + axis]!) + 0.125 * (welded[c * 3 + axis]! + welded[d * 3 + axis]!),
        );
      }
    }
    odd.set(key, { position: point, a, b });
  });

  // Skin weights of a welded vertex (taken from its first source vertex), and of a midpoint.
  const skinOf = (source: number): { index: number[]; weight: number[] } => ({
    index: [skinIndex.getX(source), skinIndex.getY(source), skinIndex.getZ(source), skinIndex.getW(source)],
    weight: [skinWeight.getX(source), skinWeight.getY(source), skinWeight.getZ(source), skinWeight.getW(source)],
  });
  const blendSkin = (first: number, second: number): { index: number[]; weight: number[] } => {
    const total = new Map<number, number>();
    for (const source of [first, second]) {
      const skin = skinOf(source);
      skin.index.forEach((bone, k) => total.set(bone, (total.get(bone) ?? 0) + skin.weight[k]! * 0.5));
    }
    const strongest = [...total.entries()].filter(([, weight]) => weight > 0).sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = strongest.reduce((acc, [, weight]) => acc + weight, 0) || 1;
    const index = [0, 0, 0, 0];
    const weight = [0, 0, 0, 0];
    strongest.forEach(([bone, value], k) => {
      index[k] = bone;
      weight[k] = value / sum;
    });
    return { index, weight };
  };

  const positions: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const colors: number[] = [];
  const pushVertex = (point: ArrayLike<number>, skin: { index: number[]; weight: number[] }, colour: number[]): void => {
    positions.push(point[0]!, point[1]!, point[2]!);
    skinIndices.push(...skin.index);
    skinWeights.push(...skin.weight);
    colors.push(...colour);
  };
  for (const corners of triangles) {
    const colour = color ? [color.getX(corners[0]!.source), color.getY(corners[0]!.source), color.getZ(corners[0]!.source)] : [1, 1, 1];
    const p = corners.map((c) => even.subarray(c.position * 3, c.position * 3 + 3));
    const s = corners.map((c) => skinOf(weldSource[c.position]!));
    const m = [0, 1, 2].map((k) => odd.get(edgeKey(corners[k]!.position, corners[(k + 1) % 3]!.position))!);
    const mp = m.map((edge) => [edge.position.x, edge.position.y, edge.position.z]);
    const ms = m.map((edge) => blendSkin(weldSource[edge.a]!, weldSource[edge.b]!));
    // Four triangles, same winding as the parent.
    const emit = (points: ArrayLike<number>[], skins: { index: number[]; weight: number[] }[]): void => {
      points.forEach((point, k) => pushVertex(point, skins[k]!, colour));
    };
    emit([p[0]!, mp[0]!, mp[2]!], [s[0]!, ms[0]!, ms[2]!]);
    emit([p[1]!, mp[1]!, mp[0]!], [s[1]!, ms[1]!, ms[0]!]);
    emit([p[2]!, mp[2]!, mp[1]!], [s[2]!, ms[2]!, ms[1]!]);
    emit([mp[0]!, mp[1]!, mp[2]!], [ms[0]!, ms[1]!, ms[2]!]);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  result.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  result.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}
