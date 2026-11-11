import * as THREE from "three";
import { patchMaterialShader } from "../core/ShaderPatch";

/**
 * A procedurally modelled, articulated adult (1.78 m at scale 1), built as one
 * SkinnedMesh so the whole figure costs a single draw call and a single
 * shadow call.
 *
 * The body is sculpted, not assembled from primitives. Torso, limbs and
 * clothes are lofted through anatomical cross-sections that are themselves
 * interpolated (Catmull–Rom) into a dense, smooth surface: trapezius and
 * shoulder slope, chest and shoulder blades, waist, buttocks, deltoids,
 * biceps and triceps, the forearm's muscle belly tapering to a flat wrist,
 * quadriceps, kneecaps and calves. Skin weights blend across every joint.
 *
 * The head is sampled densely where the face is (more rows and columns at
 * the front than at the back) and shaped landmark by landmark: brow ridge,
 * eye sockets, the bridge, tip and wings of the nose, cheekbones, the lips
 * and the line between them, the chin, a jaw that narrows to it, the back of
 * the skull. Ears have a rim (helix), a bowl and a lobe; the hair has a
 * hairline and sideburns; the jaw carries a day's stubble.
 *
 * Hands have a palm, four fingers of three phalanges each and an opposed
 * thumb, curled into a loose grip. The polo shirt has a folded collar, a
 * button placket and sleeves that follow the slope of the shoulder; the
 * shorts have hems, pockets and a fly; the boat shoes laces and a stitched
 * sole; the cap six panels and a curved brim; the sunglasses two lenses in
 * a frame with a bridge and temples running back to the ears.
 *
 * Shading (`figureSurface`): ambient occlusion baked per vertex from the
 * body's own volumes, woven cotton with creases and seams, hair strands,
 * stubble, skin with colour variation and light through it at the
 * silhouette, glossy lenses; the shirt and shorts flutter in the wind.
 *
 * Bones start in a neutral standing pose with identity rotations, which keeps
 * procedural animation and IK straightforward.
 *
 * Axes: the figure faces +Z, +Y is up and its left side is +X (three.js is
 * right-handed, so an observer facing +Z has +X on their left).
 */

export type BoneName =
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "clavicleL"
  | "upperArmL"
  | "forearmL"
  | "handL"
  | "clavicleR"
  | "upperArmR"
  | "forearmR"
  | "handR"
  | "thighL"
  | "shinL"
  | "footL"
  | "thighR"
  | "shinR"
  | "footR";

type BoneDefinition = { name: BoneName; parent: BoneName | null; offset: [number, number, number] };

const BONES: readonly BoneDefinition[] = [
  { name: "hips", parent: null, offset: [0, 0.96, 0] },
  { name: "spine", parent: "hips", offset: [0, 0.1, 0] },
  { name: "chest", parent: "spine", offset: [0, 0.22, 0] },
  { name: "neck", parent: "chest", offset: [0, 0.21, -0.005] },
  { name: "head", parent: "neck", offset: [0, 0.09, 0.01] },
  { name: "clavicleL", parent: "chest", offset: [0.055, 0.155, -0.01] },
  { name: "upperArmL", parent: "clavicleL", offset: [0.135, 0, 0] },
  { name: "forearmL", parent: "upperArmL", offset: [0, -0.29, 0] },
  { name: "handL", parent: "forearmL", offset: [0, -0.255, 0] },
  { name: "clavicleR", parent: "chest", offset: [-0.055, 0.155, -0.01] },
  { name: "upperArmR", parent: "clavicleR", offset: [-0.135, 0, 0] },
  { name: "forearmR", parent: "upperArmR", offset: [0, -0.29, 0] },
  { name: "handR", parent: "forearmR", offset: [0, -0.255, 0] },
  { name: "thighL", parent: "hips", offset: [0.098, -0.055, 0] },
  { name: "shinL", parent: "thighL", offset: [0, -0.44, 0] },
  { name: "footL", parent: "shinL", offset: [0, -0.43, 0] },
  { name: "thighR", parent: "hips", offset: [-0.098, -0.055, 0] },
  { name: "shinR", parent: "thighR", offset: [0, -0.44, 0] },
  { name: "footR", parent: "shinR", offset: [0, -0.43, 0] },
];

export const UPPER_ARM_LENGTH = 0.29;
export const FOREARM_LENGTH = 0.255;
export const THIGH_LENGTH = 0.44;
export const SHIN_LENGTH = 0.43;

export type FigureOutfit = {
  skin: THREE.ColorRepresentation;
  shirt: THREE.ColorRepresentation;
  shorts: THREE.ColorRepresentation;
  shoes: THREE.ColorRepresentation;
  hair: THREE.ColorRepresentation;
  /** Cap colour; null for bare hair. */
  cap: THREE.ColorRepresentation | null;
  sunglasses: boolean;
  /** Fraction of the upper arm covered by the sleeve (0 = sleeveless). */
  sleeve: number;
};

export const SKIPPER_OUTFIT: FigureOutfit = {
  skin: 0xb98366,
  shirt: 0x24476f,
  shorts: 0xcdb98f,
  shoes: 0x6a4329,
  hair: 0x3a2a1c,
  cap: 0xf2f0ea,
  sunglasses: true,
  sleeve: 0.5,
};

/** Surface kinds, for the shader (`region` attribute). */
const REGION = { skin: 0, shirt: 1, shorts: 2, shoes: 3, hair: 4, cap: 5, glasses: 6, sole: 7, frame: 8, eye: 9, lace: 10 } as const;
type Region = (typeof REGION)[keyof typeof REGION];

type Influence = readonly [BoneName, number][];

/** One piece of the body under construction, in the figure's rest space. */
type Piece = {
  positions: number[];
  indices: number[];
  /** Per vertex: region, flutter weight, colour, and up to four bone influences. */
  regions: number[];
  flutter: number[];
  colors: number[];
  bones: [number, number, number, number][];
  weights: [number, number, number, number][];
  /** Occluder group: the bake does not let a piece darken itself. */
  group: string;
};

const BONE_INDEX = new Map<BoneName, number>(BONES.map((definition, index) => [definition.name, index]));

function smooth(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function gauss(dx: number, dy: number, sx: number, sy: number): number {
  return Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2));
}

/**
 * A cross-section of a loft: centre (ox, oz) at height y, half-width rx and
 * half-depth rz, with bulges toward the front (+Z) and back, a superellipse
 * exponent (2 is an ellipse, more is boxier) and a tilt (dy per metre of x:
 * a section that is not level, like the top of a sleeve following the
 * shoulder's slope).
 */
type Ring = { y: number; rx: number; rz: number; ox?: number; oz?: number; front?: number; back?: number; power?: number; tilt?: number };

type PieceStyle = {
  group: string;
  region: (x: number, y: number, z: number, angle: number) => Region;
  color: (region: Region, x: number, y: number, z: number) => THREE.Color;
  influence: (x: number, y: number, z: number) => Influence;
  flutter?: (x: number, y: number, z: number, angle: number) => number;
};

function newPiece(group: string): Piece {
  return { positions: [], indices: [], regions: [], flutter: [], colors: [], bones: [], weights: [], group };
}

function pushVertex(piece: Piece, style: PieceStyle, x: number, y: number, z: number, angle: number): number {
  const index = piece.positions.length / 3;
  piece.positions.push(x, y, z);
  const region = style.region(x, y, z, angle);
  piece.regions.push(region);
  piece.flutter.push(style.flutter?.(x, y, z, angle) ?? 0);
  const color = style.color(region, x, y, z);
  piece.colors.push(color.r, color.g, color.b);
  const influence = style.influence(x, y, z);
  const bones: [number, number, number, number] = [0, 0, 0, 0];
  const weights: [number, number, number, number] = [0, 0, 0, 0];
  let total = 0;
  influence.slice(0, 4).forEach(([bone, weight], slot) => {
    bones[slot] = BONE_INDEX.get(bone)!;
    weights[slot] = weight;
    total += weight;
  });
  for (let slot = 0; slot < 4; slot += 1) weights[slot] = total > 0 ? weights[slot]! / total : slot === 0 ? 1 : 0;
  piece.bones.push(bones);
  piece.weights.push(weights);
  return index;
}

const RING_FIELDS = ["y", "rx", "rz", "ox", "oz", "front", "back", "power", "tilt"] as const;
const RING_DEFAULTS: Record<(typeof RING_FIELDS)[number], number> = { y: 0, rx: 0, rz: 0, ox: 0, oz: 0, front: 0, back: 0, power: 2, tilt: 0 };

/**
 * Interpolates `steps` sections between each pair (Catmull–Rom through the
 * authored ones), so a handful of anatomical sections becomes a smooth,
 * dense surface without kinks between them.
 */
function refine(rings: readonly Ring[], steps: number): Ring[] {
  if (rings.length < 2 || steps <= 1) return [...rings];
  const value = (ring: Ring, field: (typeof RING_FIELDS)[number]) => ring[field] ?? RING_DEFAULTS[field];
  const out: Ring[] = [];
  for (let index = 0; index < rings.length - 1; index += 1) {
    const p0 = rings[Math.max(0, index - 1)]!;
    const p1 = rings[index]!;
    const p2 = rings[index + 1]!;
    const p3 = rings[Math.min(rings.length - 1, index + 2)]!;
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const ring: Ring = { y: 0, rx: 0, rz: 0 };
      for (const field of RING_FIELDS) {
        const a = value(p0, field);
        const b = value(p1, field);
        const c = value(p2, field);
        const d = value(p3, field);
        // Heights interpolate linearly so the rings never cross.
        const v = field === "y" ? b + (c - b) * t : 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        ring[field] = field === "rx" || field === "rz" ? Math.max(1e-4, v) : v;
      }
      out.push(ring);
    }
  }
  out.push(rings[rings.length - 1]!);
  return out;
}

/**
 * Lofts rings (ordered top to bottom or bottom to top) into a closed tube.
 * `segments` vertices per ring, angle 0 facing +Z and π/2 facing +X.
 */
function loft(piece: Piece, style: PieceStyle, rings: readonly Ring[], segments: number, closeStart = true, closeEnd = true): void {
  const base = piece.positions.length / 3;
  const firstIndex = piece.indices.length;
  for (const ring of rings) {
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      const s = Math.sin(angle);
      const c = Math.cos(angle);
      const power = ring.power ?? 2;
      const shape = (value: number) => Math.sign(value) * Math.pow(Math.abs(value), 2 / power);
      const bulge = 1 + (ring.front ?? 0) * Math.pow(Math.max(0, c), 2) + (ring.back ?? 0) * Math.pow(Math.max(0, -c), 2);
      const x = (ring.ox ?? 0) + ring.rx * shape(s) * bulge;
      const z = (ring.oz ?? 0) + ring.rz * shape(c) * bulge;
      const y = ring.y + (ring.tilt ?? 0) * (x - (ring.ox ?? 0));
      pushVertex(piece, style, x, y, z, angle);
    }
  }
  // Sides: rings run in the given order, so wind each quad by that direction.
  const descending = rings.length > 1 && rings[1]!.y < rings[0]!.y;
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let step = 0; step < segments; step += 1) {
      const a = base + ring * segments + step;
      const b = base + ring * segments + ((step + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      if (descending) piece.indices.push(a, b, c, b, d, c);
      else piece.indices.push(a, c, b, b, c, d);
    }
  }
  const cap = (ringIndex: number, outward: number) => {
    const ring = rings[ringIndex]!;
    const centre = pushVertex(piece, style, ring.ox ?? 0, ring.y + outward * 0.002, ring.oz ?? 0, 0);
    const first = base + ringIndex * segments;
    for (let step = 0; step < segments; step += 1) {
      const a = first + step;
      const b = first + ((step + 1) % segments);
      if ((outward > 0) !== descending) piece.indices.push(centre, b, a);
      else piece.indices.push(centre, a, b);
    }
  };
  if (closeStart) cap(0, descending ? 1 : -1);
  if (closeEnd) cap(rings.length - 1, descending ? -1 : 1);
  orientOutward(piece, firstIndex);
}

/** A deformed sphere: `radius(direction)` gives the surface distance from `centre`. */
function sculpt(
  piece: Piece,
  style: PieceStyle,
  centre: THREE.Vector3,
  radius: (direction: THREE.Vector3) => number,
  widthSegments: number,
  heightSegments: number,
): void {
  const base = piece.positions.length / 3;
  const firstIndex = piece.indices.length;
  const direction = new THREE.Vector3();
  for (let row = 0; row <= heightSegments; row += 1) {
    const polar = (row / heightSegments) * Math.PI;
    for (let column = 0; column < widthSegments; column += 1) {
      const azimuth = (column / widthSegments) * Math.PI * 2;
      direction.set(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
      const r = radius(direction);
      pushVertex(piece, style, centre.x + direction.x * r, centre.y + direction.y * r, centre.z + direction.z * r, azimuth);
    }
  }
  for (let row = 0; row < heightSegments; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const next = (column + 1) % widthSegments;
      const a = base + row * widthSegments + column;
      const b = base + row * widthSegments + next;
      const c = a + widthSegments;
      const d = b + widthSegments;
      if (row > 0) piece.indices.push(a, c, b);
      if (row < heightSegments - 1) piece.indices.push(b, c, d);
    }
  }
  orientOutward(piece, firstIndex);
}

/**
 * A tube along a path (parallel-transported frames): fingers, the rim of an
 * ear, the frame and temples of the sunglasses, a lace. `radius(t)` gives
 * the half-width (across `side`) and half-height (across `up`) at t ∈ [0, 1];
 * `up` is a hint for the frame's orientation.
 */
function tube(
  piece: Piece,
  style: PieceStyle,
  points: readonly THREE.Vector3[],
  radius: (t: number) => [number, number],
  segments: number,
  options: { closed?: boolean; caps?: boolean; up?: THREE.Vector3 } = {},
): void {
  const closed = options.closed ?? false;
  const count = points.length;
  const base = piece.positions.length / 3;
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const previousTangent = new THREE.Vector3();
  const hint = options.up ?? new THREE.Vector3(0, 0, 1);
  const tangentAt = (index: number, out: THREE.Vector3) => {
    const a = closed ? points[(index - 1 + count) % count]! : points[Math.max(0, index - 1)]!;
    const b = closed ? points[(index + 1) % count]! : points[Math.min(count - 1, index + 1)]!;
    return out.subVectors(b, a).normalize();
  };
  for (let index = 0; index < count; index += 1) {
    tangentAt(index, tangent);
    if (index === 0) {
      normal.copy(hint).addScaledVector(tangent, -hint.dot(tangent));
      if (normal.lengthSq() < 1e-8) normal.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
      normal.normalize();
    } else {
      // Parallel transport: turn the previous normal with the tangent.
      const axis = binormal.crossVectors(previousTangent, tangent);
      const sine = axis.length();
      if (sine > 1e-6) normal.applyAxisAngle(axis.normalize(), Math.asin(Math.min(1, sine)));
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    }
    previousTangent.copy(tangent);
    binormal.crossVectors(tangent, normal).normalize();
    const t = closed ? index / count : index / Math.max(1, count - 1);
    const [across, up] = radius(t);
    const point = points[index]!;
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      pushVertex(
        piece,
        style,
        point.x + normal.x * c * up + binormal.x * s * across,
        point.y + normal.y * c * up + binormal.y * s * across,
        point.z + normal.z * c * up + binormal.z * s * across,
        angle,
      );
    }
  }
  const spans = closed ? count : count - 1;
  const first = piece.indices.length;
  for (let ring = 0; ring < spans; ring += 1) {
    const next = (ring + 1) % count;
    for (let step = 0; step < segments; step += 1) {
      const a = base + ring * segments + step;
      const b = base + ring * segments + ((step + 1) % segments);
      const c = base + next * segments + step;
      const d = base + next * segments + ((step + 1) % segments);
      piece.indices.push(a, b, c, b, d, c);
    }
  }
  if (!closed && options.caps !== false) {
    for (const [ring, flip] of [[0, true], [count - 1, false]] as const) {
      const p = points[ring]!;
      tangentAt(ring, tangent);
      const [across] = radius(ring === 0 ? 0 : 1);
      const centre = pushVertex(piece, style, p.x + tangent.x * across * (flip ? -0.4 : 0.4), p.y + tangent.y * across * (flip ? -0.4 : 0.4), p.z + tangent.z * across * (flip ? -0.4 : 0.4), 0);
      for (let step = 0; step < segments; step += 1) {
        const a = base + ring * segments + step;
        const b = base + ring * segments + ((step + 1) % segments);
        if (flip) piece.indices.push(centre, a, b);
        else piece.indices.push(centre, b, a);
      }
    }
  }
  // Face away from the path: check the first quad against its ring's centre.
  const pa = new THREE.Vector3().fromArray(piece.positions, piece.indices[first]! * 3);
  const pb = new THREE.Vector3().fromArray(piece.positions, piece.indices[first + 1]! * 3);
  const pc = new THREE.Vector3().fromArray(piece.positions, piece.indices[first + 2]! * 3);
  const faceNormal = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa));
  if (faceNormal.dot(new THREE.Vector3().subVectors(pa, points[0]!)) < 0) flipFrom(piece, first);
}

function flipFrom(piece: Piece, firstIndex: number): void {
  const indices = piece.indices;
  for (let index = firstIndex; index < indices.length; index += 3) {
    const swap = indices[index + 1]!;
    indices[index + 1] = indices[index + 2]!;
    indices[index + 2] = swap;
  }
}

/** Copies the triangles (and their vertices) added since the marks, wound the other way: a sheet seen from both sides. */
function doubleSided(piece: Piece, firstVertex: number, firstIndex: number): void {
  const vertexCount = piece.positions.length / 3;
  const offset = vertexCount - firstVertex;
  for (let vertex = firstVertex; vertex < vertexCount; vertex += 1) {
    piece.positions.push(piece.positions[vertex * 3]!, piece.positions[vertex * 3 + 1]!, piece.positions[vertex * 3 + 2]!);
    piece.regions.push(piece.regions[vertex]!);
    piece.flutter.push(piece.flutter[vertex]!);
    piece.colors.push(piece.colors[vertex * 3]! * 0.82, piece.colors[vertex * 3 + 1]! * 0.82, piece.colors[vertex * 3 + 2]! * 0.82);
    piece.bones.push([...piece.bones[vertex]!]);
    piece.weights.push([...piece.weights[vertex]!]);
  }
  const end = piece.indices.length;
  for (let index = firstIndex; index < end; index += 3) {
    piece.indices.push(piece.indices[index]! + offset, piece.indices[index + 2]! + offset, piece.indices[index + 1]! + offset);
  }
}

/**
 * A curved sheet sampled over (u, v) ∈ [0, 1]², e.g. a lens or a cap's brim:
 * `point(u, v)` gives its surface. Wound to face `facing` (a direction).
 */
function sheet(piece: Piece, style: PieceStyle, columns: number, rows: number, point: (u: number, v: number) => THREE.Vector3, facing: THREE.Vector3): void {
  const base = piece.positions.length / 3;
  const first = piece.indices.length;
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const p = point(column / columns, row / rows);
      pushVertex(piece, style, p.x, p.y, p.z, column / columns);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = base + row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      piece.indices.push(a, c, b, b, c, d);
    }
  }
  const pa = new THREE.Vector3().fromArray(piece.positions, piece.indices[first]! * 3);
  const pb = new THREE.Vector3().fromArray(piece.positions, piece.indices[first + 1]! * 3);
  const pc = new THREE.Vector3().fromArray(piece.positions, piece.indices[first + 2]! * 3);
  if (new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa)).dot(facing) < 0) flipFrom(piece, first);
}

/**
 * Makes the triangles added since `firstIndex` face away from their own
 * centroid (every piece of the body is roughly convex), whatever order the
 * builder happened to wind them in.
 */
function orientOutward(piece: Piece, firstIndex: number): void {
  const p = piece.positions;
  const indices = piece.indices;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let count = 0;
  for (let index = firstIndex; index < indices.length; index += 1) {
    const vertex = indices[index]! * 3;
    cx += p[vertex]!;
    cy += p[vertex + 1]!;
    cz += p[vertex + 2]!;
    count += 1;
  }
  if (count === 0) return;
  cx /= count;
  cy /= count;
  cz /= count;
  let score = 0;
  for (let index = firstIndex; index < indices.length; index += 3) {
    const a = indices[index]! * 3;
    const b = indices[index + 1]! * 3;
    const c = indices[index + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    score += nx * (p[a]! - cx) + ny * (p[a + 1]! - cy) + nz * (p[a + 2]! - cz);
  }
  if (score < 0) flipFrom(piece, firstIndex);
}

function blend(a: BoneName, b: BoneName, t: number): Influence {
  return t <= 0 ? [[a, 1]] : t >= 1 ? [[b, 1]] : [[a, 1 - t], [b, t]];
}

/**
 * Ambient occlusion from the body's own volumes, baked into the vertex
 * colours: each vertex is darkened by the spheres (other body parts) its
 * normal faces, by their solid angle. Cheap, once, and enough for the
 * armpits, the crotch, the inside of the arms and the neck under the jaw.
 */
function bakeOcclusion(geometry: THREE.BufferGeometry, groups: string[], occluders: { centre: THREE.Vector3; radius: number; group: string }[]): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const color = geometry.getAttribute("color");
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    p.fromBufferAttribute(position, index);
    n.fromBufferAttribute(normal, index);
    let occlusion = 0;
    for (const occluder of occluders) {
      if (occluder.group === groups[index]) continue;
      d.subVectors(occluder.centre, p);
      const distance = Math.max(d.length(), occluder.radius * 1.05);
      const facing = n.dot(d) / distance;
      if (facing <= 0) continue;
      occlusion += facing * (occluder.radius * occluder.radius) / (distance * distance);
    }
    const ao = 1 - Math.min(0.55, occlusion * 0.85);
    color.setXYZ(index, color.getX(index) * ao, color.getY(index) * ao, color.getZ(index) * ao);
  }
  color.needsUpdate = true;
}

/** Shared uniforms of the figure's surface: time and how hard the wind tugs the clothes. */
type FigureUniforms = { uFigureTime: THREE.IUniform<number>; uFigureWind: THREE.IUniform<number> };

function figureSurface(material: THREE.MeshStandardMaterial, uniforms: FigureUniforms): void {
  patchMaterialShader(material, "human-figure-v3", (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float region;
         attribute float flutter;
         uniform float uFigureTime;
         uniform float uFigureWind;
         varying float vRegion;
         varying vec3 vRest;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vRegion = region;
         vRest = position;
         // Loose cotton rippling in the apparent wind: travelling waves along
         // the hems, stronger the farther the cloth hangs free.
         float ripple = sin(uFigureTime * 13.0 + position.y * 38.0 + position.x * 21.0) * 0.6
           + sin(uFigureTime * 21.0 - position.y * 57.0 + position.z * 30.0) * 0.4;
         transformed += normal * flutter * uFigureWind * ripple * 0.0055;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vRegion;
         varying vec3 vRest;
         float figureHash(vec3 p) {
           p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
           p *= 17.0;
           return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
         }
         float figureNoise(vec3 x) {
           vec3 i = floor(x);
           vec3 f = fract(x);
           f = f * f * (3.0 - 2.0 * f);
           return mix(
             mix(mix(figureHash(i), figureHash(i + vec3(1, 0, 0)), f.x), mix(figureHash(i + vec3(0, 1, 0)), figureHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(figureHash(i + vec3(0, 0, 1)), figureHash(i + vec3(1, 0, 1)), f.x), mix(figureHash(i + vec3(0, 1, 1)), figureHash(i + vec3(1, 1, 1)), f.x), f.y),
             f.z);
         }
         // A seam: a thin groove with a row of stitches beside it.
         float figureSeam(float distance, float along) {
           float groove = 1.0 - smoothstep(0.0, 0.0018, abs(distance));
           float stitch = (1.0 - smoothstep(0.0, 0.0006, abs(abs(distance) - 0.0032))) * (0.5 + 0.5 * step(0.4, fract(along * 260.0)));
           return groove * 0.55 + stitch * 0.25;
         }
         // Seams and stitching of the clothes, by surface kind (0 none … 1 a full groove).
         float figureSeams(vec3 p, float kind) {
           float seam = 0.0;
           if (kind > 0.5 && kind < 1.5) {
             // Polo placket down the chest, its two buttons, and the side seams.
             if (p.z > 0.0 && p.y > 1.31 && p.y < 1.47) seam = max(seam, figureSeam(abs(p.x) - 0.014, p.y));
             if (p.z > 0.0 && p.y > 1.305 && p.y < 1.316 && abs(p.x) < 0.014) seam = max(seam, 0.6);
             if (abs(p.x) > 0.13 && p.y < 1.33) seam = max(seam, figureSeam(p.z * (1.0 - 0.15 * (p.y - 1.0)), p.y) * 0.8);
             // The hem of the shirt's tail.
             seam = max(seam, figureSeam(p.y - 1.0, p.x + p.z) * 0.7);
           } else if (kind > 1.5 && kind < 2.5) {
             // Shorts: waistband, the fly, side pockets, back pockets, hems.
             seam = max(seam, figureSeam(p.y - 0.955, p.x + p.z) * 0.7);
             if (p.z > 0.0 && p.y > 0.8 && p.y < 0.955) seam = max(seam, figureSeam(p.x - 0.022 + (0.955 - p.y) * 0.12 * step(0.9, p.y), p.y) * 0.8);
             if (p.z > 0.02 && p.y > 0.78 && p.y < 0.95) seam = max(seam, figureSeam(abs(p.x) - 0.15 + (0.95 - p.y) * 0.45, p.y) * 0.8);
             if (p.z < -0.04 && p.y > 0.8 && p.y < 0.92 && abs(p.x) > 0.035 && abs(p.x) < 0.14) {
               float pocket = min(min(abs(p.y - 0.92), abs(p.y - 0.8)), min(abs(abs(p.x) - 0.035), abs(abs(p.x) - 0.14)));
               seam = max(seam, figureSeam(pocket, p.x + p.y) * 0.75);
             }
             seam = max(seam, figureSeam(abs(p.x) - 0.0, p.y) * step(p.y, 0.86) * step(0.0, -p.z) * 0.6);
           } else if (kind > 2.5 && kind < 3.5) {
             // Boat shoes: the moccasin stitch round the toe and the sole's welt.
             seam = max(seam, figureSeam(p.y - 0.022, p.z) * 0.8);
           } else if (kind > 4.5 && kind < 5.5) {
             // The cap's six panels.
             vec3 c = p - vec3(0.0, 1.7, 0.012);
             if (c.y > 0.004) {
               float a = atan(c.x, c.z) / 6.2831853 * 6.0;
               float edge = abs(fract(a) - 0.5) - 0.5;
               seam = max(seam, figureSeam(edge * length(c.xz) * 1.04, c.y) * 0.8);
             }
           }
           return seam;
         }
         // Relief of each surface, metres, in the figure's rest space.
         float figureRelief(vec3 p, float kind) {
           if (kind > 0.5 && kind < 2.5) {
             // Cotton: a fine weave and soft creases.
             float weave = (sin(p.x * 1400.0 + p.y * 900.0) * sin(p.y * 1400.0 - p.z * 900.0)) * 0.0001;
             float creases = (figureNoise(p * vec3(14.0, 34.0, 14.0)) - 0.5) * 0.0035;
             // The shirt bunches above its tail and at the elbows' fold.
             float bunch = kind < 1.5 ? (1.0 - smoothstep(0.98, 1.12, p.y)) * (figureNoise(p * vec3(9.0, 60.0, 9.0)) - 0.5) * 0.005 : 0.0;
             return weave + creases + bunch - figureSeams(p, kind) * 0.0012;
           }
           if (kind > 2.5 && kind < 3.5) return (figureNoise(p * 420.0) - 0.5) * 0.0003 - figureSeams(p, kind) * 0.001;
           if (kind > 3.5 && kind < 4.5) return (figureNoise(p * vec3(520.0, 70.0, 520.0)) - 0.5) * 0.0011;
           if (kind > 4.5 && kind < 5.5) return sin(p.x * 900.0 + p.z * 900.0) * 0.00006 - figureSeams(p, kind) * 0.0009;
           if (kind < 0.5) return (figureNoise(p * 300.0) - 0.5) * 0.00018 + (figureNoise(p * 1100.0) - 0.5) * 0.00005;
           return 0.0;
         }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         float kind = floor(vRegion + 0.5);
         roughnessFactor = kind < 0.5 ? 0.46 + figureNoise(vRest * 90.0) * 0.12 : kind < 2.5 ? 0.9 : kind < 3.5 ? 0.55 : kind < 4.5 ? 0.6 : kind < 5.5 ? 0.8 : kind < 6.5 ? 0.04 : kind < 7.5 ? 0.85 : kind < 8.5 ? 0.35 : kind < 9.5 ? 0.12 : 0.8;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           // Bump from the relief by its screen-space slope (Mikkelsen's surface
           // gradient with unnormalised derivatives: heights in metres).
           float h = figureRelief(vRest, kind);
           vec3 dPdx = dFdx(-vViewPosition);
           vec3 dPdy = dFdy(-vViewPosition);
           vec3 R1 = cross(dPdy, normal);
           vec3 R2 = cross(normal, dPdx);
           float fDet = dot(dPdx, R1);
           // Detail finer than a pixel fades out rather than shimmering.
           float resolved = 1.0 - smoothstep(0.004, 0.03, length(fwidth(vRest)));
           vec3 vGrad = sign(fDet) * (dFdx(h) * R1 + dFdy(h) * R2) * resolved * 1.6;
           normal = normalize(abs(fDet) * normal - vGrad);
         }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         {
           float kind = floor(vRegion + 0.5);
           // Cotton is never one flat colour: faint fading, wear, and seams a shade darker.
           if (kind > 0.5 && kind < 2.5) diffuseColor.rgb *= (0.93 + figureNoise(vRest * 18.0) * 0.12) * (1.0 - figureSeams(vRest, kind) * 0.28);
           if (kind > 2.5 && kind < 3.5) diffuseColor.rgb *= 1.0 - figureSeams(vRest, kind) * 0.3;
           if (kind > 4.5 && kind < 5.5) diffuseColor.rgb *= 1.0 - figureSeams(vRest, kind) * 0.18;
           // Hair: strands, darker toward the roots.
           if (kind > 3.5 && kind < 4.5) diffuseColor.rgb *= 0.72 + figureNoise(vRest * vec3(760.0, 90.0, 760.0)) * 0.55;
           // Skin: blotches of warmth, pores and a little sheen variation.
           if (kind < 0.5) {
             float blotch = figureNoise(vRest * 55.0);
             diffuseColor.rgb *= mix(vec3(0.96, 0.98, 1.0), vec3(1.04, 0.97, 0.94), blotch) * (0.96 + figureNoise(vRest * 420.0) * 0.06);
           }
           // Polo buttons: a small pale disc on the placket.
           if (kind > 0.5 && kind < 1.5 && vRest.z > 0.0 && abs(vRest.x) < 0.012) {
             float button = min(length(vec2(vRest.x, vRest.y - 1.35)), length(vec2(vRest.x, vRest.y - 1.405)));
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.84, 0.8), 1.0 - smoothstep(0.0045, 0.0055, button));
           }
         }`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
           float kind = floor(vRegion + 0.5);
           // Light through skin at the silhouette (ears, the edges of the arms)
           // and the soft sheen of cotton seen edge-on.
           float facing = abs(dot(normalize(vViewPosition), normal));
           float rim = pow(1.0 - facing, 3.0);
           if (kind < 0.5) outgoingLight += diffuseColor.rgb * vec3(1.0, 0.42, 0.28) * (rim * 0.26 + 0.035);
           if (kind > 0.5 && kind < 2.5) outgoingLight += diffuseColor.rgb * rim * 0.1;
           // Mirrored lenses: a gradient from the sky above to the sea below.
           if (kind > 5.5 && kind < 6.5) outgoingLight += mix(vec3(0.02, 0.03, 0.05), vec3(0.08, 0.16, 0.26), normal.y * 0.5 + 0.5) * (0.4 + 0.6 * rim);
         }
         #include <opaque_fragment>`,
      );
  });
}

export class HumanFigure {
  readonly mesh: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Drive these each frame: seconds, and 0…1 how hard the apparent wind tugs at the clothes. */
  readonly uniforms: FigureUniforms = { uFigureTime: { value: 0 }, uFigureWind: { value: 0.3 } };
  private readonly bones = new Map<BoneName, THREE.Bone>();
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly scratchD = new THREE.Vector3();
  private readonly scratchE = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly meshQuaternionInverse = new THREE.Quaternion();
  private static readonly DOWN = new THREE.Vector3(0, -1, 0);

  constructor(outfit: FigureOutfit = SKIPPER_OUTFIT) {
    const rest = new Map<BoneName, THREE.Vector3>();
    for (const definition of BONES) {
      const bone = new THREE.Bone();
      bone.name = `Figure_${definition.name}`;
      bone.position.fromArray(definition.offset);
      this.bones.set(definition.name, bone);
      const parentRest = definition.parent ? rest.get(definition.parent)! : new THREE.Vector3();
      rest.set(definition.name, parentRest.clone().add(bone.position));
      if (definition.parent) this.bones.get(definition.parent)!.add(bone);
    }

    const colors: Record<Region, THREE.Color> = {
      [REGION.skin]: new THREE.Color(outfit.skin),
      [REGION.shirt]: new THREE.Color(outfit.shirt),
      [REGION.shorts]: new THREE.Color(outfit.shorts),
      [REGION.shoes]: new THREE.Color(outfit.shoes),
      [REGION.hair]: new THREE.Color(outfit.hair),
      [REGION.cap]: new THREE.Color(outfit.cap ?? outfit.hair),
      [REGION.glasses]: new THREE.Color(0x07090c),
      [REGION.sole]: new THREE.Color(0xe9e4d8),
      [REGION.frame]: new THREE.Color(0x15171a),
      [REGION.eye]: new THREE.Color(0xe8e2da),
      [REGION.lace]: new THREE.Color(0x9a7a55),
    };
    const scratchColor = new THREE.Color();
    const paint = (region: Region) => scratchColor.copy(colors[region]);
    const pieces: Piece[] = [];
    const add = (group: string, build: (piece: Piece) => void) => {
      const piece = newPiece(group);
      build(piece);
      pieces.push(piece);
    };

    // --- Torso: pelvis in the shorts, waist, ribcage, chest, shoulders --------
    const HEM = 0.985;
    add("torso", (piece) => {
      const style: PieceStyle = {
        group: "torso",
        region: (_x, y) => (y >= HEM ? REGION.shirt : REGION.shorts),
        color: (region) => paint(region),
        influence: (x, y) => {
          const ax = Math.abs(x);
          const side: BoneName = x >= 0 ? "clavicleL" : "clavicleR";
          if (y < 0.97) return [["hips", 1]];
          if (y < 1.12) return blend("hips", "spine", smooth(0.98, 1.1, y));
          if (y < 1.26) return blend("spine", "chest", smooth(1.12, 1.24, y));
          const shoulder = smooth(0.12, 0.19, ax) * smooth(1.32, 1.43, y) * 0.5;
          // The shoulder's cap over the deltoid goes partly with the arm.
          const arm = smooth(0.17, 0.215, ax) * smooth(1.33, 1.4, y) * 0.45;
          const upper: BoneName = x >= 0 ? "upperArmL" : "upperArmR";
          const neck = smooth(1.45, 1.52, y);
          return [["chest", Math.max(0, 1 - shoulder - neck - arm)], [side, shoulder], [upper, arm], ["neck", neck]];
        },
        // The shirt's tail and back hang loose.
        flutter: (_x, y, z) => (y >= HEM ? (1 - smooth(0.99, 1.22, y)) * (0.6 + 0.4 * smooth(0, -0.1, z)) : 0),
      };
      loft(
        piece,
        style,
        refine(
          [
            { y: 0.83, rx: 0.06, rz: 0.05 },
            { y: 0.855, rx: 0.135, rz: 0.098, oz: -0.006, back: 0.1 },
            { y: 0.895, rx: 0.168, rz: 0.114, oz: -0.01, back: 0.2, power: 2.2 },
            { y: 0.94, rx: 0.174, rz: 0.115, oz: -0.01, back: 0.16, power: 2.2 },
            { y: 0.976, rx: 0.166, rz: 0.106, oz: -0.004, back: 0.05, power: 2.2 },
            // The shirt's tail stands proud of the shorts.
            { y: 0.98, rx: 0.178, rz: 0.12, oz: 0.002, power: 2.3 },
            { y: 1.0, rx: 0.175, rz: 0.117, oz: 0.004, power: 2.3 },
            { y: 1.06, rx: 0.163, rz: 0.108, oz: 0.008, front: 0.04, power: 2.3 },
            { y: 1.13, rx: 0.162, rz: 0.106, oz: 0.01, front: 0.05, power: 2.3 },
            { y: 1.2, rx: 0.172, rz: 0.112, oz: 0.012, front: 0.08, back: 0.05, power: 2.4 },
            // Chest and shoulder blades.
            { y: 1.28, rx: 0.184, rz: 0.118, oz: 0.012, front: 0.12, back: 0.08, power: 2.5 },
            // The shirt's shoulders cap the deltoids; the sleeves come out below them.
            { y: 1.34, rx: 0.2, rz: 0.11, oz: 0.006, front: 0.07, back: 0.1, power: 2.7 },
            { y: 1.39, rx: 0.216, rz: 0.097, oz: -0.002, back: 0.06, power: 3.0 },
            { y: 1.422, rx: 0.208, rz: 0.088, oz: -0.006, power: 2.9 },
            // Shoulders slope up to the neck (trapezius).
            { y: 1.45, rx: 0.17, rz: 0.082, oz: -0.009, power: 2.6 },
            { y: 1.474, rx: 0.13, rz: 0.077, oz: -0.012, power: 2.2 },
            { y: 1.492, rx: 0.093, rz: 0.071, oz: -0.012 },
            { y: 1.5, rx: 0.073, rz: 0.065, oz: -0.01 },
          ],
          3,
        ),
        40,
      );
    });

    // --- Neck, with the polo's folded collar ---------------------------------
    add("neck", (piece) => {
      const style: PieceStyle = {
        group: "neck",
        region: () => REGION.skin,
        color: (region) => paint(region),
        influence: (_x, y) => blend("neck", "head", smooth(1.56, 1.62, y)),
      };
      loft(
        piece,
        style,
        refine(
          [
            { y: 1.46, rx: 0.072, rz: 0.068, oz: -0.012 },
            // The Adam's apple, and the tendons to the jaw.
            { y: 1.52, rx: 0.065, rz: 0.063, oz: -0.006, front: 0.07 },
            { y: 1.565, rx: 0.065, rz: 0.063, oz: 0.002 },
            { y: 1.61, rx: 0.064, rz: 0.061, oz: 0.006 },
          ],
          3,
        ),
        24,
        false,
        false,
      );
    });
    add("collar", (piece) => {
      const style: PieceStyle = {
        group: "collar",
        region: () => REGION.shirt,
        color: (region) => paint(region),
        influence: (_x, y) => blend("chest", "neck", smooth(1.47, 1.53, y)),
      };
      // The stand round the neck, then the fold-down leaf, open at the front
      // where the placket starts: one sheet turned back on itself.
      const columns = 36;
      const gap = 0.32;
      const firstVertex = piece.positions.length / 3;
      const firstIndex = piece.indices.length;
      sheet(
        piece,
        style,
        columns,
        6,
        (u, v) => {
          const angle = gap + u * (Math.PI * 2 - 2 * gap);
          // v 0 → the stand's foot, 0.45 → the fold, 1 → the leaf's edge.
          const fold = smooth(0.35, 0.55, v);
          const radius = 0.074 + 0.004 * Math.cos(angle) + fold * 0.026 * smooth(0.45, 1.0, v) + (1 - fold) * 0.002;
          const front = Math.max(0, Math.cos(angle));
          const back = Math.max(0, -Math.cos(angle)) * 0.012;
          const y = (v < 0.45 ? 1.468 + v * 0.085 : 1.506 - (v - 0.45) * 0.08 - front * 0.012 * (v - 0.45)) + back;
          // The leaf's front corners point down toward the placket.
          const corner = Math.pow(front, 6) * smooth(0.6, 1.0, v) * 0.018;
          return new THREE.Vector3(Math.sin(angle) * (radius + corner * 0.4), y - corner, -0.012 + Math.cos(angle) * (radius * 0.94 + corner * 0.3));
        },
        new THREE.Vector3(0, 0, 1),
      );
      orientOutward(piece, firstIndex);
      doubleSided(piece, firstVertex, firstIndex);
    });

    // --- Head: skull, face, ears, hair, stubble ------------------------------
    const headCentre = new THREE.Vector3(0, 1.652, 0.016);
    const hasCap = outfit.cap !== null;
    const skin = new THREE.Color(outfit.skin);
    const lipColour = skin.clone().multiply(new THREE.Color(0.86, 0.6, 0.58));
    const flush = skin.clone().multiply(new THREE.Color(1.04, 0.84, 0.8));
    const stubble = skin.clone().multiply(new THREE.Color(0.78, 0.76, 0.74));
    const brows = new THREE.Color(outfit.hair);
    /** Head surface radius toward unit direction `d` (from `headCentre`). */
    const headRadius = (d: THREE.Vector3): number => {
      // Cranium: an ellipsoid, fuller at the back of the skull.
      let r = 1 / Math.sqrt((d.x / 0.077) ** 2 + (d.y / (d.y > 0 ? 0.114 : 0.107)) ** 2 + (d.z / 0.1) ** 2);
      r *= 1 + 0.05 * smooth(0.1, -0.7, d.z) * smooth(-0.5, 0.2, d.y);
      // Local landmark frame (metres from the head centre) on the bare ellipsoid.
      const x = d.x * r;
      const y = d.y * r;
      const z = d.z * r;
      const ax = Math.abs(x);
      // The face is flatter across than the skull, and the lower face
      // narrows to the chin: jaw angle, cheek, chin.
      const front = smooth(0.02, 0.07, z);
      r -= front * 1.0 * x * x;
      const lower = smooth(-0.025, -0.105, y);
      r -= lower * (0.004 + 0.008 * smooth(0.0, 0.07, z)) * smooth(0.025, 0.075, ax);
      // The jaw's angle below each ear stays wide.
      r += 0.009 * gauss(ax - 0.058, y + 0.064, 0.018, 0.018) * smooth(0.045, -0.015, z);
      // Under the chin the head meets the neck.
      r -= 0.012 * smooth(-0.07, -0.11, y) * smooth(0.03, -0.03, z);
      if (z > 0.02) {
        const f = front;
        // Brow ridge, eye sockets, cheekbones.
        r += 0.0045 * f * gauss(0, y - 0.03, 0.05, 0.009) * smooth(0.075, 0.03, ax);
        r -= 0.0055 * f * gauss(ax - 0.032, y - 0.011, 0.016, 0.012);
        r += 0.004 * f * gauss(ax - 0.05, y + 0.004, 0.016, 0.014);
        // Full cheeks either side of the mouth.
        r += 0.004 * f * gauss(ax - 0.044, y + 0.04, 0.016, 0.02);
        // Nose: a narrow bridge, the tip and the wings, then the septum back to the lip.
        const noseProfile = y > -0.03 ? 0.001 + 0.0155 * Math.pow(smooth(0.014, -0.028, y), 1.4) : 0.0165 * smooth(-0.04, -0.03, y);
        const noseWidth = 0.0055 + 0.0065 * smooth(0.0, -0.03, y);
        r += f * noseProfile * Math.exp(-((x / noseWidth) ** 2)) * smooth(0.024, 0.012, y);
        r += 0.006 * f * gauss(ax - 0.013, y + 0.034, 0.0065, 0.0055);
        // Lips: upper, the line between them, lower; the groove under the lip.
        const mouth = smooth(0.03, 0.018, ax);
        r += 0.003 * f * gauss(x, y + 0.051, 0.022, 0.0042) * mouth;
        r -= 0.0022 * f * gauss(x, y + 0.0575, 0.024, 0.0014) * mouth;
        r += 0.0034 * f * gauss(x, y + 0.064, 0.02, 0.0048) * mouth;
        r -= 0.003 * f * gauss(x, y + 0.077, 0.018, 0.005);
        // The philtrum, and the chin.
        r -= 0.0012 * f * gauss(ax - 0.004, y + 0.045, 0.003, 0.006);
        r += 0.006 * f * gauss(x, y + 0.093, 0.022, 0.012);
      }
      // Short hair stands a few millimetres off the scalp.
      const hair = smooth(0.0, 0.015, y + 0.03 - Math.max(0, z - 0.04) * 1.6) * smooth(0.07, 0.04, z + Math.max(0, -y) * 0.0);
      return r + hair * 0.0035;
    };
    const headStyle: PieceStyle = {
      group: "head",
      region: (px, py, pz) => {
        const x = px - headCentre.x;
        const y = py - headCentre.y;
        const z = pz - headCentre.z;
        const ax = Math.abs(x);
        // Hairline: across the forehead, down the temples to sideburns that
        // end level with the ear's middle, and round the back to the nape.
        const hairline = z > 0.045 ? y > 0.066 - (z - 0.045) * 0.3 : z > 0.0 ? y > 0.014 + Math.max(0, 0.068 - ax) * 0.9 : y > -0.058 + Math.max(0, z + 0.02) * 1.2;
        const sideburn = ax > 0.062 && z > -0.004 && z < 0.026 && y > -0.006;
        if (hairline || sideburn) return REGION.hair;
        return REGION.skin;
      },
      color: (region, px, py, pz) => {
        const c = paint(region);
        if (region !== REGION.skin) return c;
        const x = px - headCentre.x;
        const y = py - headCentre.y;
        const z = pz - headCentre.z;
        const ax = Math.abs(x);
        if (z > 0.02) {
          // Lips, the flush of the cheeks and nose, and the brows.
          const lips = gauss(x, y + 0.058, 0.021, 0.009) * smooth(0.03, 0.02, ax);
          c.lerp(lipColour, Math.min(1, lips * 1.3));
          c.lerp(flush, 0.35 * gauss(ax - 0.045, y + 0.02, 0.016, 0.016) + 0.3 * gauss(x, y + 0.025, 0.01, 0.014));
          c.lerp(brows, 0.8 * gauss(ax - 0.033, y - 0.03, 0.017, 0.0035) * smooth(0.0, 0.006, ax - 0.006));
        }
        // A day's stubble on the jaw, chin and upper lip (not on the lips).
        const beard = smooth(0.0, -0.03, y + Math.max(0, 0.03 - z) * 0.4) * smooth(-0.02, 0.01, z) * (1 - gauss(x, y + 0.058, 0.026, 0.011)) * smooth(0.085, 0.07, ax + Math.max(0, -y - 0.09));
        const moustache = gauss(x, y + 0.045, 0.024, 0.004) * smooth(0.04, 0.06, z);
        c.lerp(stubble, Math.min(0.8, beard * 0.75 + moustache * 0.6));
        return c;
      },
      influence: (_x, y) => blend("neck", "head", smooth(1.58, 1.62, y)),
    };
    add("head", (piece) => {
      // Sampled densely across the face, coarsely round the back of the skull.
      const columns = 72;
      const rows = 56;
      const base = piece.positions.length / 3;
      const firstIndex = piece.indices.length;
      const direction = new THREE.Vector3();
      // More rows between the brow and the chin: the polar angle is spread by
      // a density that peaks over the face.
      const samples = 400;
      const cumulative: number[] = [0];
      for (let index = 1; index <= samples; index += 1) {
        const p = (index - 0.5) / samples;
        cumulative.push(cumulative[index - 1]! + 1 + 1.7 * Math.exp(-(((p - 0.6) / 0.15) ** 2)));
      }
      const total = cumulative[samples]!;
      const polarAt = (v: number): number => {
        const goal = v * total;
        let index = 1;
        while (index < samples && cumulative[index]! < goal) index += 1;
        const before = cumulative[index - 1]!;
        const span = cumulative[index]! - before || 1;
        return Math.PI * ((index - 1 + (goal - before) / span) / samples);
      };
      for (let row = 0; row <= rows; row += 1) {
        const polar = polarAt(row / rows);
        for (let column = 0; column < columns; column += 1) {
          const t = column / columns * 2 - 1;
          // Denser toward azimuth 0 (the face).
          const azimuth = Math.PI * Math.sign(t) * Math.pow(Math.abs(t), 1.45);
          direction.set(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
          const r = headRadius(direction);
          pushVertex(piece, headStyle, headCentre.x + direction.x * r, headCentre.y + direction.y * r, headCentre.z + direction.z * r, azimuth);
        }
      }
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const next = (column + 1) % columns;
          const a = base + row * columns + column;
          const b = base + row * columns + next;
          const c = a + columns;
          const d = b + columns;
          if (row > 0) piece.indices.push(a, c, b);
          if (row < rows - 1) piece.indices.push(b, c, d);
        }
      }
      orientOutward(piece, firstIndex);
      if (!outfit.sunglasses) {
        // Eyes, set into their sockets.
        for (const sign of [1, -1]) {
          const eye = new THREE.Vector3(headCentre.x + sign * 0.032, headCentre.y + 0.011, headCentre.z + 0.066);
          sculpt(
            piece,
            {
              ...headStyle,
              region: () => REGION.eye,
              color: (_region, px, py, pz) => {
                const toward = new THREE.Vector3(px, py, pz).sub(eye).normalize();
                return paint(REGION.eye).lerp(new THREE.Color(0x3b2a1c), smooth(0.9, 0.93, toward.z)).lerp(new THREE.Color(0x050505), smooth(0.975, 0.985, toward.z));
              },
            },
            eye,
            () => 0.0118,
            14,
            10,
          );
        }
      }
    });
    add("ears", (piece) => {
      const style: PieceStyle = { ...headStyle, group: "ears", region: () => REGION.skin, color: () => paint(REGION.skin).lerp(flush, 0.3) };
      for (const sign of [1, -1]) {
        // The ear stands out from the head, flaring toward its back edge.
        const at = (y: number, z: number, out = 0) =>
          new THREE.Vector3(headCentre.x + sign * (0.0755 + out + Math.max(0, -z + 0.004) * 0.32), headCentre.y + y, headCentre.z + z);
        // The helix: from the front of the ear, over the top, down the back to the lobe.
        const helix: THREE.Vector3[] = [];
        for (let step = 0; step <= 18; step += 1) {
          const t = step / 18;
          const angle = Math.PI * (0.62 - 1.45 * t);
          helix.push(at(-0.008 + Math.sin(angle) * 0.027 * (t > 0.6 ? 1.08 : 1), -0.01 + Math.cos(angle) * 0.016 - 0.002, 0.002));
        }
        tube(piece, style, helix, (t) => [0.0042 - t * 0.0008, 0.0026], 8, { up: new THREE.Vector3(sign, 0, 0) });
        // The bowl of the ear, and the lobe.
        sculpt(piece, style, at(-0.008, -0.011, -0.002), (d) => 1 / Math.sqrt((d.x / 0.0075) ** 2 + (d.y / 0.024) ** 2 + (d.z / 0.0145) ** 2), 14, 10);
        sculpt(piece, style, at(-0.036, -0.004, 0.001), (d) => 1 / Math.sqrt((d.x / 0.0045) ** 2 + (d.y / 0.008) ** 2 + (d.z / 0.0075) ** 2), 10, 8);
      }
    });
    if (hasCap) {
      add("cap", (piece) => {
        const style: PieceStyle = { group: "cap", region: () => REGION.cap, color: (region) => paint(region), influence: () => [["head", 1]] };
        // Crown: six soft panels over the skull, its band at the brow, the
        // front panels a little taller.
        const crown = new THREE.Vector3(0, 1.7, 0.012);
        const firstVertex = piece.positions.length / 3;
        const rings: Ring[] = [];
        for (let step = 0; step <= 10; step += 1) {
          const t = step / 10;
          const angle = t * Math.PI * 0.5;
          rings.push({
            y: crown.y - 0.006 + Math.sin(angle) * 0.078,
            rx: 0.0835 * Math.pow(Math.cos(angle), 0.9) + 0.002,
            rz: 0.104 * Math.pow(Math.cos(angle), 0.9) + 0.002,
            oz: crown.z + 0.008 * t,
            front: 0.04 * (1 - t),
            power: 2.15,
          });
        }
        loft(piece, style, rings, 48, false, true);
        // The band's lower edge turns in (the cap has thickness).
        loft(piece, style, [
          { y: crown.y - 0.006, rx: 0.0855, rz: 0.106, oz: crown.z, front: 0.04, power: 2.15 },
          { y: crown.y - 0.008, rx: 0.08, rz: 0.1, oz: crown.z, front: 0.04, power: 2.15 },
        ], 48, false, false);
        // Brim: a curved peak, bent down at the sides, with a rolled edge.
        const brimPoint = (u: number, v: number, lift: number) => {
          const across = (u * 2 - 1) * 0.088;
          const reach = 0.03 + v * 0.064 * Math.sqrt(Math.max(0, 1 - (across / 0.092) ** 2));
          const y = crown.y - 0.004 - 0.014 * (across / 0.088) ** 2 - v * 0.014 + lift;
          return new THREE.Vector3(across, y, crown.z + 0.06 + reach);
        };
        sheet(piece, style, 24, 6, (u, v) => brimPoint(u, v, 0.0025), new THREE.Vector3(0, 1, 0));
        sheet(piece, { ...style, color: () => paint(REGION.cap).multiplyScalar(0.62) }, 24, 6, (u, v) => brimPoint(u, v, -0.0015), new THREE.Vector3(0, -1, 0));
        const edge: THREE.Vector3[] = [];
        for (let step = 0; step <= 24; step += 1) edge.push(brimPoint(step / 24, 1, 0.0005));
        tube(piece, style, edge, () => [0.0022, 0.0022], 6, { up: new THREE.Vector3(0, 1, 0) });
        // The button on top.
        sculpt(piece, style, new THREE.Vector3(0, crown.y + 0.073, crown.z + 0.008), (d) => (d.y > 0 ? 0.0075 : 0.0045), 10, 6);
        // Worn tipped back a little: the band rides over the ears' tops and
        // down toward the nape, the peak lifted clear of the brows.
        const pivot = new THREE.Vector3(0, crown.y, crown.z);
        const tip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.07);
        const point = new THREE.Vector3();
        for (let vertex = firstVertex; vertex < piece.positions.length / 3; vertex += 1) {
          point.fromArray(piece.positions, vertex * 3).sub(pivot).applyQuaternion(tip).add(pivot);
          piece.positions[vertex * 3] = point.x;
          piece.positions[vertex * 3 + 1] = point.y;
          piece.positions[vertex * 3 + 2] = point.z;
        }
      });
    }
    if (outfit.sunglasses) {
      add("glasses", (piece) => {
        const lensStyle: PieceStyle = { group: "glasses", region: () => REGION.glasses, color: (region) => paint(region), influence: () => [["head", 1]] };
        const frameStyle: PieceStyle = { ...lensStyle, region: () => REGION.frame };
        // Lenses follow a cylinder round the face, a couple of centimetres off it.
        const wrap = (x: number, y: number) => {
          const radius = 0.104;
          const angle = x / radius;
          return new THREE.Vector3(headCentre.x + Math.sin(angle) * radius, headCentre.y + y, headCentre.z + Math.cos(angle) * radius - 0.012 + 0.006 * (1 - Math.cos(angle * 1.4)));
        };
        const outline = (sign: number, t: number, inset = 0) => {
          // A rounded trapezoid: wider at the top, deeper toward the temple.
          const angle = t * Math.PI * 2;
          const c = Math.cos(angle);
          const s = Math.sin(angle);
          const halfWidth = 0.0245 - inset;
          const halfHeight = (0.0165 - inset) * (1 - 0.2 * Math.max(0, -s) * (sign * c < 0 ? 1 : 0.4));
          const x = sign * (0.0335 + Math.sign(c) * Math.pow(Math.abs(c), 0.6) * halfWidth);
          const y = 0.012 + Math.sign(s) * Math.pow(Math.abs(s), 0.75) * halfHeight - 0.004 * (1 - s) * 0.5;
          return wrap(x, y);
        };
        for (const sign of [1, -1]) {
          // The lens: rings from its centre out to the frame.
          const centre = wrap(sign * 0.034, 0.011);
          const columns = 28;
          const rings = 5;
          const base = piece.positions.length / 3;
          const first = piece.indices.length;
          pushVertex(piece, lensStyle, centre.x, centre.y, centre.z + 0.001, 0);
          for (let ring = 1; ring <= rings; ring += 1) {
            for (let column = 0; column < columns; column += 1) {
              const p = outline(sign, column / columns, 0.001).sub(centre).multiplyScalar(ring / rings).add(centre);
              p.z += 0.001 * (1 - (ring / rings) ** 2);
              pushVertex(piece, lensStyle, p.x, p.y, p.z, column / columns);
            }
          }
          for (let column = 0; column < columns; column += 1) piece.indices.push(base, base + 1 + column, base + 1 + ((column + 1) % columns));
          for (let ring = 1; ring < rings; ring += 1) {
            for (let column = 0; column < columns; column += 1) {
              const a = base + 1 + (ring - 1) * columns + column;
              const b = base + 1 + (ring - 1) * columns + ((column + 1) % columns);
              const c = a + columns;
              const d = b + columns;
              piece.indices.push(a, c, b, b, c, d);
            }
          }
          const pa = new THREE.Vector3().fromArray(piece.positions, piece.indices[first]! * 3);
          const pb = new THREE.Vector3().fromArray(piece.positions, piece.indices[first + 1]! * 3);
          const pc = new THREE.Vector3().fromArray(piece.positions, piece.indices[first + 2]! * 3);
          if (new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa)).z < 0) flipFrom(piece, first);
          // The frame round it.
          const rim: THREE.Vector3[] = [];
          for (let step = 0; step < 36; step += 1) rim.push(outline(sign, step / 36));
          tube(piece, frameStyle, rim, () => [0.0021, 0.0026], 6, { closed: true, up: new THREE.Vector3(0, 0, 1) });
          // The temple: from the frame's outer edge back along the head to the ear, then down behind it.
          const hinge = outline(sign, 0, 0);
          const temple: THREE.Vector3[] = [hinge];
          for (let step = 1; step <= 10; step += 1) {
            const t = step / 10;
            temple.push(
              new THREE.Vector3(
                headCentre.x + sign * (0.081 + 0.004 * Math.sin(t * Math.PI)),
                headCentre.y + 0.017 - t * 0.006,
                hinge.z - 0.012 - t * (hinge.z - headCentre.z + 0.004),
              ),
            );
          }
          temple.push(new THREE.Vector3(headCentre.x + sign * 0.079, headCentre.y + 0.004, headCentre.z - 0.03));
          temple.push(new THREE.Vector3(headCentre.x + sign * 0.077, headCentre.y - 0.012, headCentre.z - 0.034));
          tube(piece, frameStyle, temple, (t) => [0.0016, 0.0032 - t * 0.001], 6, { up: new THREE.Vector3(0, 1, 0) });
        }
        // The bridge over the nose.
        const bridge: THREE.Vector3[] = [];
        for (let step = 0; step <= 8; step += 1) {
          const t = step / 8;
          bridge.push(wrap((t * 2 - 1) * 0.012, 0.022 + 0.004 * Math.sin(t * Math.PI)).add(new THREE.Vector3(0, 0, 0.002)));
        }
        tube(piece, frameStyle, bridge, () => [0.0018, 0.0022], 6, { up: new THREE.Vector3(0, 0, 1) });
      });
    }

    // --- Arms: deltoid, biceps, elbow, forearm, wrist; sleeves; hands --------
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      const shoulder = rest.get(`upperArm${side}`)!;
      const x0 = shoulder.x;
      const y0 = shoulder.y;
      const z0 = shoulder.z;
      const elbow = y0 - UPPER_ARM_LENGTH;
      const wrist = elbow - FOREARM_LENGTH;
      const armInfluence = (_x: number, y: number): Influence => {
        if (y > y0 + 0.01) return blend(`clavicle${side}`, `upperArm${side}`, smooth(y0 + 0.05, y0 + 0.01, y));
        if (y > elbow + 0.045) return [[`upperArm${side}`, 1]];
        if (y > elbow - 0.045) return blend(`upperArm${side}`, `forearm${side}`, smooth(elbow + 0.045, elbow - 0.045, y));
        if (y > wrist + 0.025) return [[`forearm${side}`, 1]];
        return blend(`forearm${side}`, `hand${side}`, smooth(wrist + 0.025, wrist - 0.015, y));
      };
      add(`arm${side}`, (piece) => {
        const style: PieceStyle = { group: `arm${side}`, region: () => REGION.skin, color: (region) => paint(region), influence: armInfluence };
        const ring = (dy: number, rx: number, rz: number, oz = 0, front = 0, back = 0, ox = 0): Ring => ({ y: y0 + dy, rx, rz, ox: x0 + sign * ox, oz: z0 + oz, front, back });
        loft(
          piece,
          style,
          refine(
            [
              ring(-0.025, 0.026, 0.03, 0, 0, 0, -0.026),
              ring(-0.045, 0.042, 0.046, 0, 0.02, 0.02, -0.012),
              // Deltoid into biceps (front) and triceps (back).
              ring(-0.07, 0.051, 0.054, 0.002, 0.06, 0.05),
              ring(-0.15, 0.05, 0.052, 0.004, 0.1, 0.06),
              ring(-0.22, 0.045, 0.047, 0.002, 0.06, 0.04),
              ring(-UPPER_ARM_LENGTH + 0.01, 0.04, 0.043, -0.002, 0.02, 0.06),
              // Elbow, the forearm's muscle belly, then the flat wrist.
              ring(-0.33, 0.046, 0.048, 0.002, 0.08),
              ring(-0.38, 0.045, 0.044, 0.002, 0.04),
              ring(-0.44, 0.036, 0.032),
              ring(-0.5, 0.029, 0.021),
              ring(-(UPPER_ARM_LENGTH + FOREARM_LENGTH) - 0.005, 0.028, 0.02),
            ],
            3,
          ),
          24,
          false,
          false,
        );
      });
      if (outfit.sleeve > 0) {
        add(`sleeve${side}`, (piece) => {
          const style: PieceStyle = {
            group: `sleeve${side}`,
            region: () => REGION.shirt,
            color: (region) => paint(region),
            // The sleeve goes with the arm; only its top, tucked into the
            // shoulder, follows the collarbone, or it would shear when the
            // arm reaches forward to the wheel.
            influence: (_x, y) => blend(`clavicle${side}`, `upperArm${side}`, smooth(y0 + 0.06, y0 + 0.02, y)),
            flutter: (_x, y) => smooth(y0 - 0.04, y0 - UPPER_ARM_LENGTH * outfit.sleeve, y) * 0.8,
          };
          const end = -UPPER_ARM_LENGTH * outfit.sleeve;
          // The sleeve's head is a dome over the deltoid, set into the shirt's
          // shoulder (its inner half inside the torso), so the shoulder runs
          // into the sleeve without a step or an opening.
          loft(
            piece,
            style,
            refine(
              [
                { y: y0 - 0.012, rx: 0.036, rz: 0.044, ox: x0 - sign * 0.02, oz: z0 },
                { y: y0 - 0.04, rx: 0.055, rz: 0.059, ox: x0 - sign * 0.003, oz: z0 },
                { y: y0 - 0.065, rx: 0.057, rz: 0.06, ox: x0, oz: z0, front: 0.03 },
                { y: y0 + end * 0.7, rx: 0.055, rz: 0.058, ox: x0, oz: z0 + 0.003, front: 0.06 },
                { y: y0 + end, rx: 0.054, rz: 0.057, ox: x0, oz: z0 + 0.003, front: 0.07 },
              ],
              3,
            ),
            28,
            true,
            false,
          );
          // The hem turns in to the arm: the sleeve has thickness.
          loft(piece, style, [
            { y: y0 + end, rx: 0.054, rz: 0.057, ox: x0, oz: z0 + 0.003, front: 0.07 },
            { y: y0 + end + 0.004, rx: 0.045, rz: 0.048, ox: x0, oz: z0 + 0.003, front: 0.07 },
          ], 28, false, false);
        });
      }
      add(`hand${side}`, (piece) => {
        const handInfluence = (_x: number, y: number): Influence => blend(`forearm${side}`, `hand${side}`, smooth(wrist + 0.012, wrist - 0.02, y));
        const style: PieceStyle = {
          group: `hand${side}`,
          region: () => REGION.skin,
          color: (region, _x, y) => paint(region).lerp(flush, 0.18 * smooth(wrist - 0.1, wrist - 0.16, y)),
          influence: handInfluence,
        };
        // Palm: from the wrist to the knuckles, flat, its back toward the outside.
        const palmTop = wrist + 0.006;
        const knuckle = wrist - 0.092;
        loft(
          piece,
          style,
          refine(
            [
              { y: palmTop, rx: 0.028, rz: 0.019, ox: x0, oz: z0 },
              { y: wrist - 0.025, rx: 0.036, rz: 0.019, ox: x0, oz: z0 + 0.002, front: 0.12 },
              { y: wrist - 0.06, rx: 0.042, rz: 0.017, ox: x0 - sign * 0.002, oz: z0 + 0.004, front: 0.15 },
              { y: knuckle, rx: 0.043, rz: 0.014, ox: x0 - sign * 0.003, oz: z0 + 0.006, power: 2.4 },
            ],
            3,
          ),
          20,
          false,
          true,
        );
        // Four fingers, three phalanges each, curled into a loose grip
        // (toward +Z, the palm's side).
        const fingers = [
          { across: 0.028, length: 0.084, radius: 0.0088 },
          { across: 0.009, length: 0.092, radius: 0.0092 },
          { across: -0.01, length: 0.088, radius: 0.0088 },
          { across: -0.027, length: 0.07, radius: 0.0078 },
        ];
        for (const finger of fingers) {
          // `across` runs from the thumb's side (medial) to the little finger.
          const startX = x0 - sign * 0.003 - sign * finger.across * 0.95;
          const start = new THREE.Vector3(startX, knuckle + 0.004, z0 + 0.004);
          const points: THREE.Vector3[] = [start.clone()];
          const segments = [0.45, 0.31, 0.24].map((share) => share * finger.length);
          const bends = [0.55, 0.85, 0.6];
          let angle = 0.12;
          const p = start.clone();
          segments.forEach((segment, index) => {
            angle += bends[index]!;
            for (let step = 1; step <= 3; step += 1) {
              const a = angle - bends[index]! * (1 - step / 3);
              p.add(new THREE.Vector3(0, -Math.cos(a) * (segment / 3), Math.sin(a) * (segment / 3)));
              points.push(p.clone());
            }
          });
          const r = finger.radius;
          tube(piece, style, points, (t) => [r * (1 - 0.22 * t) * (1 + 0.08 * Math.sin(t * Math.PI * 3)), r * 0.86 * (1 - 0.25 * t)], 10, { up: new THREE.Vector3(0, 0, 1) });
          // The knuckle under the skin.
          sculpt(piece, style, start.clone().add(new THREE.Vector3(0, 0.002, -0.003)), () => r * 1.05, 8, 6);
        }
        // The thumb: from the base of the palm, opposed, along the front.
        const thumbBase = new THREE.Vector3(x0 - sign * 0.026, wrist - 0.024, z0 + 0.012);
        const thumb: THREE.Vector3[] = [];
        for (let step = 0; step <= 8; step += 1) {
          const t = step / 8;
          thumb.push(
            new THREE.Vector3(
              thumbBase.x - sign * (0.012 * Math.sin(t * 1.4)) + sign * 0.01 * t * t,
              thumbBase.y - 0.058 * t,
              thumbBase.z + 0.03 * Math.sin(t * 1.5) - 0.006 * t * t,
            ),
          );
        }
        tube(piece, style, thumb, (t) => [0.0125 * (1 - 0.32 * t), 0.0105 * (1 - 0.3 * t)], 10, { up: new THREE.Vector3(0, 0, 1) });
        // The ball of the thumb on the palm.
        sculpt(piece, style, new THREE.Vector3(x0 - sign * 0.017, wrist - 0.035, z0 + 0.012), (d) => 1 / Math.sqrt((d.x / 0.014) ** 2 + (d.y / 0.026) ** 2 + (d.z / 0.011) ** 2), 10, 8);
      });
    }

    // --- Legs: thigh, knee, calf, ankle; legs of the shorts; boat shoes -------
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      const hip = rest.get(`thigh${side}`)!;
      const x0 = hip.x;
      const y0 = hip.y;
      const knee = y0 - THIGH_LENGTH;
      const ankle = knee - SHIN_LENGTH;
      const SHORTS_END = -THIGH_LENGTH * 0.5;
      const legInfluence = (_x: number, y: number): Influence => {
        if (y > y0 - 0.06) return blend("hips", `thigh${side}`, smooth(y0 + 0.04, y0 - 0.06, y));
        if (y > knee + 0.05) return [[`thigh${side}`, 1]];
        if (y > knee - 0.05) return blend(`thigh${side}`, `shin${side}`, smooth(knee + 0.05, knee - 0.05, y));
        if (y > ankle + 0.03) return [[`shin${side}`, 1]];
        return blend(`shin${side}`, `foot${side}`, smooth(ankle + 0.03, ankle - 0.01, y));
      };
      add(`leg${side}`, (piece) => {
        const style: PieceStyle = {
          group: `leg${side}`,
          region: (_x, y) => (y > y0 + SHORTS_END + 0.02 ? REGION.shorts : REGION.skin),
          color: (region) => paint(region),
          influence: legInfluence,
        };
        const ring = (dy: number, rx: number, rz: number, oz = 0, front = 0, back = 0): Ring => ({ y: y0 + dy, rx, rz, ox: x0 - sign * 0.004 * Math.max(0, -dy), oz, front, back });
        loft(
          piece,
          style,
          refine(
            [
              ring(0.045, 0.08, 0.088),
              ring(-0.04, 0.086, 0.094, 0.004, 0.04),
              ring(-0.12, 0.081, 0.089, 0.008, 0.08),
              ring(-0.22, 0.073, 0.079, 0.008, 0.08),
              ring(-0.32, 0.063, 0.065, 0.004, 0.05),
              ring(-0.4, 0.054, 0.056, 0.004, 0.02),
              // Kneecap.
              ring(-THIGH_LENGTH, 0.05, 0.053, 0.01, 0.1),
              ring(-0.49, 0.048, 0.05, 0.004, 0.02),
              // Calf.
              ring(-0.56, 0.052, 0.058, -0.012, 0, 0.2),
              ring(-0.63, 0.049, 0.056, -0.013, 0, 0.18),
              ring(-0.71, 0.04, 0.044, -0.007, 0, 0.07),
              ring(-0.79, 0.031, 0.033),
              ring(-(THIGH_LENGTH + SHIN_LENGTH) + 0.02, 0.028, 0.03),
              ring(-(THIGH_LENGTH + SHIN_LENGTH) + 0.005, 0.031, 0.034),
            ],
            3,
          ),
          28,
        );
      });
      add(`shorts${side}`, (piece) => {
        const style: PieceStyle = {
          group: `shorts${side}`,
          region: () => REGION.shorts,
          color: (region) => paint(region),
          influence: legInfluence,
          flutter: (_x, y) => smooth(y0 - 0.06, y0 + SHORTS_END, y) * 0.55,
        };
        loft(
          piece,
          style,
          refine(
            [
              { y: y0 + 0.07, rx: 0.086, rz: 0.096, ox: x0 - sign * 0.004 },
              { y: y0 - 0.04, rx: 0.099, rz: 0.107, ox: x0, oz: 0.003 },
              { y: y0 - 0.13, rx: 0.096, rz: 0.103, ox: x0 + sign * 0.004, oz: 0.004 },
              { y: y0 + SHORTS_END, rx: 0.097, rz: 0.101, ox: x0 + sign * 0.006, oz: 0.002 },
            ],
            3,
          ),
          28,
          false,
          false,
        );
        // A turned-up hem: a slightly proud band, then the turn in to the leg.
        loft(piece, style, [
          { y: y0 + SHORTS_END + 0.03, rx: 0.098, rz: 0.102, ox: x0 + sign * 0.006, oz: 0.002 },
          { y: y0 + SHORTS_END + 0.026, rx: 0.1, rz: 0.104, ox: x0 + sign * 0.006, oz: 0.002 },
          { y: y0 + SHORTS_END + 0.001, rx: 0.1, rz: 0.104, ox: x0 + sign * 0.006, oz: 0.002 },
          { y: y0 + SHORTS_END - 0.002, rx: 0.097, rz: 0.101, ox: x0 + sign * 0.006, oz: 0.002 },
          { y: y0 + SHORTS_END + 0.004, rx: 0.08, rz: 0.084, ox: x0 + sign * 0.004 },
        ], 28, false, false);
      });
      add(`shoe${side}`, (piece) => {
        const foot = rest.get(`foot${side}`)!;
        const style: PieceStyle = {
          group: `shoe${side}`,
          region: (_x, y) => (y < 0.016 ? REGION.sole : REGION.shoes),
          color: (region) => paint(region),
          influence: (_x, y) => blend(`shin${side}`, `foot${side}`, smooth(foot.y + 0.07, foot.y + 0.03, y)),
        };
        // Lofted heel to toe along +Z (built along Y, then turned).
        const profile: [number, number, number, number][] = [
          // z, half-width, half-height, centre height
          [-0.07, 0.022, 0.026, 0.036],
          [-0.062, 0.036, 0.04, 0.045],
          [-0.04, 0.044, 0.048, 0.051],
          [-0.01, 0.047, 0.05, 0.053],
          [0.03, 0.047, 0.044, 0.048],
          [0.07, 0.05, 0.037, 0.04],
          [0.11, 0.05, 0.032, 0.034],
          [0.145, 0.046, 0.028, 0.029],
          [0.17, 0.038, 0.023, 0.025],
          [0.188, 0.026, 0.017, 0.021],
          [0.197, 0.012, 0.01, 0.018],
        ];
        const segments = 22;
        const base = piece.positions.length / 3;
        const firstIndex = piece.indices.length;
        for (const [z, halfWidth, halfHeight, centre] of profile) {
          for (let step = 0; step < segments; step += 1) {
            const angle = (step / segments) * Math.PI * 2;
            const s = Math.sin(angle);
            const c = Math.cos(angle);
            // Flat sole: the lower half is squared off.
            const yShape = c > 0 ? c : -Math.pow(-c, 0.4);
            const xShape = Math.sign(s) * Math.pow(Math.abs(s), 0.78);
            pushVertex(piece, style, x0 + sign * 0.006 + halfWidth * xShape, Math.max(0.002, centre + halfHeight * yShape), foot.z + 0.05 + z, angle);
          }
        }
        for (let ring = 0; ring < profile.length - 1; ring += 1) {
          for (let step = 0; step < segments; step += 1) {
            const a = base + ring * segments + step;
            const b = base + ring * segments + ((step + 1) % segments);
            const c = a + segments;
            const d = b + segments;
            piece.indices.push(a, b, c, b, d, c);
          }
        }
        for (const [ringIndex, flip] of [[0, true], [profile.length - 1, false]] as const) {
          const [z, , , centre] = profile[ringIndex]!;
          const middle = pushVertex(piece, style, x0 + sign * 0.006, centre, foot.z + 0.05 + z + (flip ? -0.004 : 0.004), 0);
          for (let step = 0; step < segments; step += 1) {
            const a = base + ringIndex * segments + step;
            const b = base + ringIndex * segments + ((step + 1) % segments);
            if (flip) piece.indices.push(middle, b, a);
            else piece.indices.push(middle, a, b);
          }
        }
        orientOutward(piece, firstIndex);
        // The leather lace threaded round the collar and tied over the instep.
        const laceStyle: PieceStyle = { ...style, region: () => REGION.lace, color: (region) => paint(region) };
        const collar: THREE.Vector3[] = [];
        for (let step = 0; step < 24; step += 1) {
          const angle = (step / 24) * Math.PI * 2;
          collar.push(new THREE.Vector3(x0 + sign * 0.006 + Math.sin(angle) * 0.046, 0.083 + 0.006 * Math.cos(angle), foot.z + 0.035 + Math.cos(angle) * 0.07 - 0.03));
        }
        tube(piece, laceStyle, collar, () => [0.0022, 0.0022], 5, { closed: true, up: new THREE.Vector3(0, 1, 0) });
        for (const turn of [-1, 1]) {
          const bow: THREE.Vector3[] = [];
          for (let step = 0; step <= 8; step += 1) {
            const t = step / 8;
            bow.push(new THREE.Vector3(x0 + sign * 0.006 + turn * (0.006 + 0.016 * Math.sin(t * Math.PI)), 0.09 + 0.006 * Math.sin(t * Math.PI), foot.z + 0.1 - 0.012 * t));
          }
          tube(piece, laceStyle, bow, () => [0.002, 0.002], 5, { up: new THREE.Vector3(0, 1, 0) });
        }
      });
    }

    // --- Assemble one indexed geometry -------------------------------------------
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const indices: number[] = [];
    const regionValues: number[] = [];
    const flutterValues: number[] = [];
    const colorValues: number[] = [];
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    const vertexGroups: string[] = [];
    const normals: number[] = [];
    for (const piece of pieces) {
      // Normals per piece, so a sleeve's normals never average with the arm's.
      const part = new THREE.BufferGeometry();
      part.setAttribute("position", new THREE.Float32BufferAttribute(piece.positions, 3));
      part.setIndex(piece.indices);
      part.computeVertexNormals();
      const offset = positions.length / 3;
      for (const value of piece.positions) positions.push(value);
      const normalArray = part.getAttribute("normal").array as Float32Array;
      for (let index = 0; index < normalArray.length; index += 1) normals.push(normalArray[index]!);
      part.dispose();
      for (const index of piece.indices) indices.push(index + offset);
      for (const value of piece.regions) regionValues.push(value);
      for (const value of piece.flutter) flutterValues.push(value);
      for (const value of piece.colors) colorValues.push(value);
      for (let vertex = 0; vertex < piece.bones.length; vertex += 1) {
        skinIndex.push(...piece.bones[vertex]!);
        skinWeight.push(...piece.weights[vertex]!);
        vertexGroups.push(piece.group);
      }
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colorValues, 3));
    geometry.setAttribute("region", new THREE.Float32BufferAttribute(regionValues, 1));
    geometry.setAttribute("flutter", new THREE.Float32BufferAttribute(flutterValues, 1));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
    geometry.setIndex(indices);

    // Occluders: the body's volumes as spheres, by piece group.
    const occluders: { centre: THREE.Vector3; radius: number; group: string }[] = [];
    const sphere = (x: number, y: number, z: number, radius: number, group: string) => occluders.push({ centre: new THREE.Vector3(x, y, z), radius, group });
    for (const y of [0.9, 1.0, 1.1, 1.2, 1.3, 1.38]) sphere(0, y, 0, 0.12, "torso");
    sphere(0, 1.652, 0.016, 0.095, "head");
    sphere(0, 1.55, -0.005, 0.05, "neck");
    if (hasCap) sphere(0, 1.69, 0.12, 0.045, "cap");
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      for (const dy of [0, -0.12, -0.24]) sphere(sign * 0.19, 1.435 + dy, 0, 0.05, `arm${side}`);
      for (const dy of [-0.34, -0.45]) sphere(sign * 0.19, 1.435 + dy, 0, 0.038, `arm${side}`);
      for (const dy of [-0.04, -0.16, -0.3]) sphere(sign * 0.098, 0.905 + dy, 0.005, 0.085, `leg${side}`);
      for (const dy of [-0.55, -0.68]) sphere(sign * 0.098, 0.905 + dy, -0.008, 0.048, `leg${side}`);
      sphere(sign * 0.19, 0.84, 0.0, 0.03, `hand${side}`);
    }
    bakeOcclusion(geometry, vertexGroups, occluders);
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0 });
    figureSurface(material, this.uniforms);
    this.mesh = new THREE.SkinnedMesh(geometry, material);
    this.mesh.name = "Procedural_Articulated_Human";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Bones animate procedurally; the rest-pose bounds would cull wrongly.
    this.mesh.frustumCulled = false;
    const root = this.bones.get("hips")!;
    this.mesh.add(root);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(BONES.map((definition) => this.bones.get(definition.name)!)));
  }

  bone(name: BoneName): THREE.Bone {
    return this.bones.get(name)!;
  }

  /** Reset every joint to the neutral standing pose (rotations, and the hips' position). */
  resetPose(): void {
    this.bones.forEach((bone) => bone.quaternion.identity());
    this.bones.get("hips")!.position.set(0, 0.96, 0);
  }

  /**
   * Analytic two-bone IK in the mesh's local space. Rotates `upper` and `lower`
   * so the end of `lower` reaches `targetWorld`, bending toward `poleWorld`.
   * Limbs hang along -Y in their rest pose. Unreachable targets straighten the
   * limb toward the target instead of stretching it.
   */
  solveTwoBone(
    upperName: BoneName,
    lowerName: BoneName,
    upperLength: number,
    lowerLength: number,
    targetWorld: THREE.Vector3,
    poleWorld: THREE.Vector3,
  ): void {
    const upper = this.bones.get(upperName)!;
    const lower = this.bones.get(lowerName)!;
    this.mesh.updateMatrixWorld(true);
    this.mesh.getWorldQuaternion(this.meshQuaternionInverse).invert();

    const start = this.mesh.worldToLocal(upper.getWorldPosition(this.scratchA));
    const target = this.mesh.worldToLocal(this.scratchB.copy(targetWorld));
    const pole = this.mesh.worldToLocal(this.scratchC.copy(poleWorld));
    const toTarget = target.sub(start);
    const distance = THREE.MathUtils.clamp(toTarget.length(), 0.02, upperLength + lowerLength - 0.002);
    const direction = toTarget.normalize();
    const cosine = THREE.MathUtils.clamp(
      (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * upperLength * distance),
      -1,
      1,
    );
    const sine = Math.sqrt(1 - cosine * cosine);
    const bend = pole.sub(start);
    bend.addScaledVector(direction, -bend.dot(direction));
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
    bend.normalize();
    // Elbow / knee position in mesh space.
    const joint = this.scratchD.copy(start).addScaledVector(direction, upperLength * cosine).addScaledVector(bend, upperLength * sine);
    const end = direction.multiplyScalar(distance).add(start);

    this.aimBone(upper, this.scratchE.copy(joint).sub(start));
    this.mesh.updateMatrixWorld(true);
    this.aimBone(lower, end.sub(joint));
  }

  /** Rotate a bone so its rest -Y axis points along `directionMesh` (mesh space). */
  private aimBone(bone: THREE.Bone, directionMesh: THREE.Vector3): void {
    const parent = bone.parent as THREE.Object3D;
    parent.getWorldQuaternion(this.scratchQuaternion);
    // Parent orientation relative to the mesh.
    this.scratchQuaternion.premultiply(this.meshQuaternionInverse);
    const local = directionMesh.normalize().applyQuaternion(this.scratchQuaternion.invert());
    bone.quaternion.setFromUnitVectors(HumanFigure.DOWN, local);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.skeleton.dispose();
  }
}
