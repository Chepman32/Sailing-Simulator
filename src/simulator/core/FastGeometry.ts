import * as THREE from "three";

/**
 * Copies of `sources[i]` placed by `matrices[i]`, merged into one geometry:
 * what cloning each source, `applyMatrix4` and `mergeGeometries` give (the
 * same vertices, normals and index, value for value), without the
 * intermediate copies. An island's grove is a few hundred palms in six
 * geometries, and islands are built while the yacht sails.
 *
 * The sources must be plain geometries alike: the same attributes with the
 * same item sizes, all in non-interleaved arrays (position, normal and
 * tangent in `Float32Array`s), all indexed or none, without morph targets.
 * Null when they are not (the caller merges the slow way), or when there is
 * nothing to merge.
 */
export function mergeTransformed(sources: readonly THREE.BufferGeometry[], matrices: readonly THREE.Matrix4[]): THREE.BufferGeometry | null {
  if (sources.length === 0 || sources.length !== matrices.length) return null;
  const first = sources[0]!;
  const names = Object.keys(first.attributes);
  if (!names.includes("position")) return null;
  const indexed = first.index !== null;
  let vertices = 0;
  let indices = 0;
  for (const source of sources) {
    if ((source.index !== null) !== indexed || Object.keys(source.morphAttributes).length > 0) return null;
    if (Object.keys(source.attributes).length !== names.length) return null;
    for (const name of names) {
      const attribute = source.attributes[name];
      const reference = first.attributes[name]!;
      if (!(attribute instanceof THREE.BufferAttribute) || !(reference instanceof THREE.BufferAttribute)) return null;
      if (attribute.itemSize !== reference.itemSize || attribute.normalized !== reference.normalized) return null;
      if (attribute.array.constructor !== reference.array.constructor) return null;
      if ((name === "position" || name === "normal" || name === "tangent") && !(attribute.array instanceof Float32Array)) return null;
    }
    vertices += source.attributes.position!.count;
    indices += indexed ? source.index!.count : 0;
  }

  const geometry = new THREE.BufferGeometry();
  const normalMatrix = new THREE.Matrix3();
  for (const name of names) {
    const reference = first.attributes[name] as THREE.BufferAttribute;
    const itemSize = reference.itemSize;
    const ArrayType = reference.array.constructor as new (length: number) => THREE.TypedArray;
    const out = new ArrayType(vertices * itemSize);
    let offset = 0;
    sources.forEach((source, piece) => {
      const attribute = source.attributes[name] as THREE.BufferAttribute;
      const from = attribute.array;
      const count = attribute.count;
      const base = offset * itemSize;
      const e = matrices[piece]!.elements;
      if (name === "position") {
        for (let index = 0; index < count; index += 1) {
          const i = index * itemSize;
          const x = from[i]!;
          const y = from[i + 1]!;
          const z = from[i + 2]!;
          // As Vector3.applyMatrix4, perspective divide included.
          const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
          out[base + i] = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w;
          out[base + i + 1] = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w;
          out[base + i + 2] = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w;
          for (let component = 3; component < itemSize; component += 1) out[base + i + component] = from[i + component]!;
        }
      } else if (name === "normal" || name === "tangent") {
        // Normals by the normal matrix, tangents as directions (their w kept); both renormalised.
        const m = name === "normal" ? normalMatrix.getNormalMatrix(matrices[piece]!).elements : null;
        for (let index = 0; index < count; index += 1) {
          const i = index * itemSize;
          const x = from[i]!;
          const y = from[i + 1]!;
          const z = from[i + 2]!;
          const nx = m ? m[0]! * x + m[3]! * y + m[6]! * z : e[0]! * x + e[4]! * y + e[8]! * z;
          const ny = m ? m[1]! * x + m[4]! * y + m[7]! * z : e[1]! * x + e[5]! * y + e[9]! * z;
          const nz = m ? m[2]! * x + m[5]! * y + m[8]! * z : e[2]! * x + e[6]! * y + e[10]! * z;
          const scale = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
          out[base + i] = nx * scale;
          out[base + i + 1] = ny * scale;
          out[base + i + 2] = nz * scale;
          for (let component = 3; component < itemSize; component += 1) out[base + i + component] = from[i + component]!;
        }
      } else {
        out.set(from, base);
      }
      offset += count;
    });
    geometry.setAttribute(name, new THREE.BufferAttribute(out, itemSize, reference.normalized));
  }

  if (indexed) {
    // What `setIndex` makes of a plain array: 16 bits unless an index reaches 65535.
    const index = vertices - 1 >= 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    let cursor = 0;
    let base = 0;
    for (const source of sources) {
      const own = source.index!;
      for (let position = 0; position < own.count; position += 1) index[cursor++] = own.getX(position) + base;
      base += source.attributes.position!.count;
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }
  return geometry;
}

/** A plain (not interleaved) 3-component `Float32Array` attribute, or null. */
function plainFloat3(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): Float32Array | null {
  if (!(attribute instanceof THREE.BufferAttribute) || attribute.itemSize !== 3 || attribute.normalized) return null;
  return attribute.array instanceof Float32Array ? attribute.array : null;
}

/**
 * `geometry.computeBoundingSphere()`: the same sphere (the box's centre, the
 * farthest vertex), read straight from the array instead of a call per
 * vertex. Geometries it does not cover (morph targets, interleaved or
 * quantised positions) go to three.js.
 */
export function computeBoundingSphereFast(geometry: THREE.BufferGeometry): void {
  const array = plainFloat3(geometry.attributes.position);
  if (!array || geometry.morphAttributes.position) {
    geometry.computeBoundingSphere();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < array.length; i += 3) {
    const x = array[i]!;
    const y = array[i + 1]!;
    const z = array[i + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const empty = maxX < minX || maxY < minY || maxZ < minZ;
  const cx = empty ? 0 : (minX + maxX) * 0.5;
  const cy = empty ? 0 : (minY + maxY) * 0.5;
  const cz = empty ? 0 : (minZ + maxZ) * 0.5;
  let maxRadiusSq = 0;
  for (let i = 0; i < array.length; i += 3) {
    const dx = cx - array[i]!;
    const dy = cy - array[i + 1]!;
    const dz = cz - array[i + 2]!;
    maxRadiusSq = Math.max(maxRadiusSq, dx * dx + dy * dy + dz * dz);
  }
  const sphere = geometry.boundingSphere ?? new THREE.Sphere();
  sphere.center.set(cx, cy, cz);
  sphere.radius = Math.sqrt(maxRadiusSq);
  geometry.boundingSphere = sphere;
}

/**
 * `geometry.computeVertexNormals()`: the same normals, value for value (area
 * weighted over the faces round a vertex, accumulated in the attribute's own
 * precision, then normalised), without the calls per vertex. Geometries it
 * does not cover go to three.js.
 */
export function computeVertexNormalsFast(geometry: THREE.BufferGeometry): void {
  const positions = plainFloat3(geometry.attributes.position);
  const index = geometry.index;
  if (!positions || (index && !(index instanceof THREE.BufferAttribute))) {
    geometry.computeVertexNormals();
    return;
  }
  const count = positions.length / 3;
  let normal = geometry.attributes.normal;
  let normals = plainFloat3(normal);
  if (!normal || !normals || normals.length !== positions.length) {
    if (normal) {
      // An attribute this does not write (another layout): leave it to three.js.
      geometry.computeVertexNormals();
      return;
    }
    normals = new Float32Array(count * 3);
    normal = new THREE.BufferAttribute(normals, 3);
    geometry.setAttribute("normal", normal);
  } else {
    normals.fill(0);
  }
  const p = positions;
  const n = normals;
  if (index) {
    const indices = index.array;
    for (let i = 0; i + 2 < index.count; i += 3) {
      const a = indices[i]! * 3;
      const b = indices[i + 1]! * 3;
      const c = indices[i + 2]! * 3;
      const cbx = p[c]! - p[b]!;
      const cby = p[c + 1]! - p[b + 1]!;
      const cbz = p[c + 2]! - p[b + 2]!;
      const abx = p[a]! - p[b]!;
      const aby = p[a + 1]! - p[b + 1]!;
      const abz = p[a + 2]! - p[b + 2]!;
      const x = cby * abz - cbz * aby;
      const y = cbz * abx - cbx * abz;
      const z = cbx * aby - cby * abx;
      // Read all three before writing any, as three.js does (a face may repeat a vertex).
      const ax = n[a]! + x;
      const ay = n[a + 1]! + y;
      const az = n[a + 2]! + z;
      const bx = n[b]! + x;
      const by = n[b + 1]! + y;
      const bz = n[b + 2]! + z;
      const cx = n[c]! + x;
      const cy = n[c + 1]! + y;
      const cz = n[c + 2]! + z;
      n[a] = ax;
      n[a + 1] = ay;
      n[a + 2] = az;
      n[b] = bx;
      n[b + 1] = by;
      n[b + 2] = bz;
      n[c] = cx;
      n[c + 1] = cy;
      n[c + 2] = cz;
    }
  } else {
    for (let a = 0; a + 8 < p.length; a += 9) {
      const b = a + 3;
      const c = a + 6;
      const cbx = p[c]! - p[b]!;
      const cby = p[c + 1]! - p[b + 1]!;
      const cbz = p[c + 2]! - p[b + 2]!;
      const abx = p[a]! - p[b]!;
      const aby = p[a + 1]! - p[b + 1]!;
      const abz = p[a + 2]! - p[b + 2]!;
      const x = cby * abz - cbz * aby;
      const y = cbz * abx - cbx * abz;
      const z = cbx * aby - cby * abx;
      for (const v of [a, b, c]) {
        n[v] = x;
        n[v + 1] = y;
        n[v + 2] = z;
      }
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i]!;
    const y = n[i + 1]!;
    const z = n[i + 2]!;
    const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    n[i] = x * scale;
    n[i + 1] = y * scale;
    n[i + 2] = z * scale;
  }
  normal.needsUpdate = true;
}
