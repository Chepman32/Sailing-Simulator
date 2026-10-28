import * as THREE from "three";
import { patchMaterialShader } from "../core/ShaderPatch";

/**
 * A procedurally modelled, articulated adult (1.78 m at scale 1), built as one
 * SkinnedMesh so the whole figure costs a single draw call and a single
 * shadow call.
 *
 * The body is sculpted rather than assembled from primitives: torso, limbs,
 * hands and shoes are lofted through anatomical cross-sections (chest and
 * shoulder blades, waist, buttocks, quadriceps, kneecaps, calves, biceps,
 * forearms), each one continuous surface whose skin weights blend across the
 * joints, so knees, elbows, hips and the neck bend smoothly instead of
 * showing seams. Clothes are shells with thickness and hems (sleeves, the
 * shirt's tail, the legs of the shorts) that stand off the body, and the
 * head is a sculpted skull with jaw, chin, nose, brow and ears under a cap,
 * with wraparound sunglasses.
 *
 * Shading (`figureSurface`): ambient occlusion baked per vertex from the
 * body's own volumes (under the arms, between the legs, under the chin and
 * the cap's brim), woven cotton and creases on the clothes, short hair
 * strands, skin with a soft sheen, glossy lenses; the shirt and shorts
 * flutter in the apparent wind.
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
  sleeve: 0.55,
};

/** Surface kinds, for the shader (`region` attribute). */
const REGION = { skin: 0, shirt: 1, shorts: 2, shoes: 3, hair: 4, cap: 5, glasses: 6, sole: 7 } as const;
type Region = (typeof REGION)[keyof typeof REGION];

type Influence = readonly [BoneName, number][];

/** One piece of the body under construction, in the figure's rest space. */
type Piece = {
  positions: number[];
  indices: number[];
  /** Per vertex: region, flutter weight, colour, and up to two bone influences. */
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

/**
 * A cross-section of a loft: centre (ox, oz) at height y, half-width rx and
 * half-depth rz, with bulges toward the front (+Z) and back, and a
 * superellipse exponent (2 is an ellipse, more is boxier).
 */
type Ring = { y: number; rx: number; rz: number; ox?: number; oz?: number; front?: number; back?: number; power?: number };

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
      pushVertex(piece, style, x, ring.y, z, angle);
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
    const centre = pushVertex(piece, style, ring.ox ?? 0, ring.y + outward * 0.004, ring.oz ?? 0, 0);
    const first = base + ringIndex * segments;
    for (let step = 0; step < segments; step += 1) {
      const a = first + step;
      const b = first + ((step + 1) % segments);
      // Outward normal along ±Y: counter-clockwise seen from that side.
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
    for (let column = 0; column <= widthSegments; column += 1) {
      const azimuth = (column / widthSegments) * Math.PI * 2;
      direction.set(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
      const r = radius(direction);
      pushVertex(piece, style, centre.x + direction.x * r, centre.y + direction.y * r, centre.z + direction.z * r, azimuth);
    }
  }
  for (let row = 0; row < heightSegments; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const a = base + row * (widthSegments + 1) + column;
      const b = a + 1;
      const c = a + widthSegments + 1;
      const d = c + 1;
      if (row > 0) piece.indices.push(a, c, b);
      if (row < heightSegments - 1) piece.indices.push(b, c, d);
    }
  }
  orientOutward(piece, firstIndex);
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
  if (score >= 0) return;
  for (let index = firstIndex; index < indices.length; index += 3) {
    const swap = indices[index + 1]!;
    indices[index + 1] = indices[index + 2]!;
    indices[index + 2] = swap;
  }
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
    const ao = 1 - Math.min(0.62, occlusion * 0.9);
    color.setXYZ(index, color.getX(index) * ao, color.getY(index) * ao, color.getZ(index) * ao);
  }
  color.needsUpdate = true;
}

/** Shared uniforms of the figure's surface: time and how hard the wind tugs the clothes. */
type FigureUniforms = { uFigureTime: THREE.IUniform<number>; uFigureWind: THREE.IUniform<number> };

function figureSurface(material: THREE.MeshStandardMaterial, uniforms: FigureUniforms): void {
  patchMaterialShader(material, "human-figure-v2", (shader) => {
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
         transformed += normal * flutter * uFigureWind * ripple * 0.0065;`,
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
         // Relief of each surface, metres, in the figure's rest space.
         float figureRelief(vec3 p, float kind) {
           if (kind > 0.5 && kind < 2.5) {
             // Cotton: a fine weave and soft creases.
             float weave = (sin(p.x * 1400.0 + p.y * 900.0) * sin(p.y * 1400.0 - p.z * 900.0)) * 0.00012;
             float creases = (figureNoise(p * vec3(14.0, 34.0, 14.0)) - 0.5) * 0.004;
             // The shirt bunches above its tail and at the elbows' fold.
             float bunch = kind < 1.5 ? (1.0 - smoothstep(0.98, 1.12, p.y)) * (figureNoise(p * vec3(9.0, 60.0, 9.0)) - 0.5) * 0.006 : 0.0;
             return weave + creases + bunch;
           }
           if (kind > 3.5 && kind < 4.5) return (figureNoise(p * vec3(500.0, 60.0, 500.0)) - 0.5) * 0.0012;
           if (kind > 4.5 && kind < 5.5) return sin(p.x * 900.0 + p.z * 900.0) * 0.00008;
           if (kind < 0.5) return (figureNoise(p * 260.0) - 0.5) * 0.00025;
           return 0.0;
         }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         float kind = floor(vRegion + 0.5);
         roughnessFactor = kind < 0.5 ? 0.5 : kind < 2.5 ? 0.88 : kind < 3.5 ? 0.62 : kind < 4.5 ? 0.66 : kind < 5.5 ? 0.78 : kind < 6.5 ? 0.06 : 0.9;`,
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
           // Cotton is never one flat colour: faint fading and wear.
           if (kind > 0.5 && kind < 2.5) diffuseColor.rgb *= 0.92 + figureNoise(vRest * 18.0) * 0.14;
           // Hair: strands, darker toward the roots.
           if (kind > 3.5 && kind < 4.5) diffuseColor.rgb *= 0.75 + figureNoise(vRest * vec3(700.0, 80.0, 700.0)) * 0.5;
           // Skin: a little colour variation and warmth.
           if (kind < 0.5) diffuseColor.rgb *= vec3(1.0, 0.97, 0.95) * (0.95 + figureNoise(vRest * 40.0) * 0.1);
         }`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
           float kind = floor(vRegion + 0.5);
           // Light through skin at the silhouette (ears, the edges of the arms)
           // and the soft sheen of cotton seen edge-on.
           float rim = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
           if (kind < 0.5) outgoingLight += diffuseColor.rgb * vec3(1.0, 0.45, 0.32) * rim * 0.22;
           if (kind > 0.5 && kind < 2.5) outgoingLight += diffuseColor.rgb * rim * 0.12;
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
      [REGION.glasses]: new THREE.Color(0x0b0d10),
      [REGION.sole]: new THREE.Color(0xe9e4d8),
    };
    const paint = (region: Region) => colors[region];
    const pieces: Piece[] = [];
    const add = (group: string, build: (piece: Piece) => void) => {
      const piece = newPiece(group);
      build(piece);
      pieces.push(piece);
    };

    // --- Torso: pelvis in the shorts, waist, ribcage, shoulders ----------------
    const HEM = 0.985;
    add("torso", (piece) => {
      const style: PieceStyle = {
        group: "torso",
        region: (_x, y) => (y >= HEM ? REGION.shirt : REGION.shorts),
        color: paint,
        influence: (x, y) => {
          const ax = Math.abs(x);
          const side: BoneName = x >= 0 ? "clavicleL" : "clavicleR";
          if (y < 0.97) return [["hips", 1]];
          if (y < 1.12) return blend("hips", "spine", smooth(0.98, 1.1, y));
          if (y < 1.26) return blend("spine", "chest", smooth(1.12, 1.24, y));
          const shoulder = smooth(0.13, 0.19, ax) * smooth(1.33, 1.43, y) * 0.55;
          const neck = smooth(1.44, 1.52, y);
          return [["chest", Math.max(0, 1 - shoulder - neck)], [side, shoulder], ["neck", neck]];
        },
        // The shirt's tail and back hang loose.
        flutter: (_x, y, z) => (y >= HEM ? (1 - smooth(0.99, 1.22, y)) * (0.6 + 0.4 * smooth(0, -0.1, z)) : 0),
      };
      loft(piece, style, [
        { y: 0.835, rx: 0.07, rz: 0.06 },
        { y: 0.86, rx: 0.135, rz: 0.098, oz: -0.004, back: 0.08 },
        { y: 0.9, rx: 0.168, rz: 0.112, oz: -0.008, back: 0.16, power: 2.2 },
        { y: 0.94, rx: 0.172, rz: 0.114, oz: -0.008, back: 0.14, power: 2.2 },
        { y: 0.975, rx: 0.164, rz: 0.106, oz: -0.002, back: 0.04, power: 2.2 },
        // The shirt's tail stands proud of the shorts.
        { y: 0.978, rx: 0.176, rz: 0.118, oz: 0.002, power: 2.3 },
        { y: 1.0, rx: 0.172, rz: 0.115, oz: 0.004, power: 2.3 },
        { y: 1.06, rx: 0.16, rz: 0.106, oz: 0.008, front: 0.04, power: 2.3 },
        { y: 1.13, rx: 0.158, rz: 0.104, oz: 0.01, front: 0.05, power: 2.3 },
        { y: 1.2, rx: 0.166, rz: 0.108, oz: 0.012, front: 0.08, back: 0.04, power: 2.4 },
        { y: 1.27, rx: 0.176, rz: 0.112, oz: 0.012, front: 0.1, back: 0.06, power: 2.5 },
        { y: 1.34, rx: 0.184, rz: 0.108, oz: 0.008, front: 0.06, back: 0.08, power: 2.6 },
        { y: 1.4, rx: 0.19, rz: 0.096, oz: -0.002, back: 0.04, power: 2.7 },
        { y: 1.445, rx: 0.16, rz: 0.082, oz: -0.008, power: 2.5 },
        { y: 1.48, rx: 0.1, rz: 0.068, oz: -0.01 },
        { y: 1.505, rx: 0.072, rz: 0.062, oz: -0.008 },
      ], 28);
    });

    // --- Neck --------------------------------------------------------------------
    add("neck", (piece) => {
      const style: PieceStyle = {
        group: "neck",
        region: () => REGION.skin,
        color: paint,
        influence: (_x, y) => blend("neck", "head", smooth(1.56, 1.62, y)),
      };
      loft(piece, style, [
        { y: 1.46, rx: 0.068, rz: 0.064, oz: -0.012 },
        { y: 1.51, rx: 0.062, rz: 0.06, oz: -0.008, front: 0.06 },
        { y: 1.56, rx: 0.058, rz: 0.057, oz: -0.002 },
        { y: 1.6, rx: 0.056, rz: 0.055, oz: 0.002 },
      ], 16, false, false);
      // The shirt's collar, standing round the base of the neck.
      loft(piece, { ...style, region: () => REGION.shirt, influence: (_x, y) => blend("chest", "neck", smooth(1.47, 1.53, y)) }, [
        { y: 1.465, rx: 0.084, rz: 0.08, oz: -0.012 },
        { y: 1.515, rx: 0.074, rz: 0.072, oz: -0.012, back: 0.06 },
        { y: 1.52, rx: 0.064, rz: 0.062, oz: -0.01 },
      ], 18, false, false);
    });

    // --- Head: skull, jaw, chin, nose, brow; hair under a cap ---------------------
    const headCentre = new THREE.Vector3(0, 1.652, 0.016);
    const hasCap = outfit.cap !== null;
    add("head", (piece) => {
      const style: PieceStyle = {
        group: "head",
        region: (x, y, z) => {
          const local = this.scratchA.set(x, y, z).sub(headCentre);
          const up = local.y;
          const front = local.z;
          // Short hair on the back and sides, above the ears and the nape.
          if (up > -0.035 && front < 0.045 + up * 0.4) return REGION.hair;
          return REGION.skin;
        },
        color: paint,
        influence: (_x, y) => blend("neck", "head", smooth(1.6, 1.64, y)),
      };
      sculpt(
        piece,
        style,
        headCentre,
        (d) => {
          // An ellipsoid skull, narrower toward the jaw, with a chin, cheeks,
          // a brow ridge, a nose and a flatter face.
          const base = 1 / Math.sqrt((d.x / 0.09) ** 2 + (d.y / 0.118) ** 2 + (d.z / 0.104) ** 2);
          const jaw = d.y < -0.15 ? 1 - 0.22 * smooth(-0.15, -0.85, d.y) * (1 - Math.max(0, d.z) * 0.35) : 1;
          const face = d.z > 0.5 ? 1 - 0.05 * smooth(0.5, 0.95, d.z) * (1 - Math.abs(d.y) * 1.5) : 1;
          const nose = 0.024 * Math.exp(-((d.x / 0.12) ** 2 + ((d.y + 0.08) / 0.16) ** 2)) * Math.max(0, d.z) ** 6;
          const brow = 0.008 * Math.exp(-(((d.y - 0.18) / 0.08) ** 2)) * Math.max(0, d.z) ** 3 * (1 - Math.abs(d.x) * 1.4);
          const chin = 0.012 * Math.exp(-((d.x / 0.22) ** 2 + ((d.y + 0.72) / 0.14) ** 2)) * Math.max(0, d.z);
          const cheek = 0.006 * Math.exp(-(((Math.abs(d.x) - 0.55) / 0.2) ** 2 + ((d.y + 0.15) / 0.2) ** 2)) * Math.max(0, d.z);
          return base * jaw * face + nose + brow + chin + cheek;
        },
        28,
        20,
      );
      // Ears.
      for (const sign of [1, -1]) {
        const ear = new THREE.Vector3(sign * 0.089, 1.652, 0);
        sculpt(piece, { ...style, region: () => REGION.skin }, ear, (d) => 1 / Math.sqrt((d.x / 0.012) ** 2 + (d.y / 0.03) ** 2 + (d.z / 0.02) ** 2), 8, 6);
      }
    });
    if (hasCap) {
      add("cap", (piece) => {
        const style: PieceStyle = { group: "cap", region: () => REGION.cap, color: paint, influence: () => [["head", 1]] };
        // Crown: a soft dome over the skull, its band at the brow.
        const crown = new THREE.Vector3(0, 1.683, 0.01);
        const rings: Ring[] = [];
        for (let step = 0; step <= 7; step += 1) {
          const t = step / 7;
          const angle = t * Math.PI * 0.5;
          rings.push({ y: crown.y + Math.sin(angle) * 0.09, rx: 0.102 * Math.cos(angle) + 0.002, rz: 0.112 * Math.cos(angle) + 0.002, oz: crown.z + 0.004 * t });
        }
        loft(piece, style, rings, 24, true, true);
        // Brim: a thin, gently domed peak over the eyes (its back half is inside the crown).
        sculpt(
          piece,
          style,
          new THREE.Vector3(0, 1.683, 0.118),
          (d) => 1 / Math.sqrt((d.x / 0.082) ** 2 + (d.y / 0.0055) ** 2 + (d.z / 0.07) ** 2),
          20,
          6,
        );
        // A button on top.
        sculpt(piece, style, new THREE.Vector3(0, crown.y + 0.091, crown.z + 0.004), () => 0.008, 6, 4);
      });
    }
    if (outfit.sunglasses) {
      add("glasses", (piece) => {
        const style: PieceStyle = { group: "glasses", region: () => REGION.glasses, color: paint, influence: () => [["head", 1]] };
        // A wraparound band across the eyes, standing just off the face.
        const columns = 14;
        const firstIndex = piece.indices.length;
        for (let row = 0; row < 2; row += 1) {
          for (let column = 0; column <= columns; column += 1) {
            const azimuth = -1.25 + (column / columns) * 2.5;
            const y = 1.67 - row * 0.034 + Math.cos(azimuth * 2) * 0.002;
            const r = 0.104 + Math.cos(azimuth) * 0.006;
            pushVertex(piece, style, headCentre.x + Math.sin(azimuth) * r * 0.93, y, headCentre.z + Math.cos(azimuth) * r, azimuth);
          }
        }
        for (let column = 0; column < columns; column += 1) {
          const a = column;
          const b = column + 1;
          const c = column + columns + 1;
          const d = c + 1;
          piece.indices.push(a, b, c, b, d, c);
        }
        // An open band: face it away from the head's centre.
        let score = 0;
        for (let index = firstIndex; index < piece.indices.length; index += 3) {
          const [a, b, c] = [piece.indices[index]!, piece.indices[index + 1]!, piece.indices[index + 2]!].map((vertex) => new THREE.Vector3().fromArray(piece.positions, vertex * 3));
          score += new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!)).dot(new THREE.Vector3().subVectors(a!, headCentre));
        }
        if (score < 0) {
          for (let index = firstIndex; index < piece.indices.length; index += 3) {
            const swap = piece.indices[index + 1]!;
            piece.indices[index + 1] = piece.indices[index + 2]!;
            piece.indices[index + 2] = swap;
          }
        }
      });
    }

    // --- Arms: deltoid, biceps, elbow, forearm, wrist; sleeves; hands ------------
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      const shoulder = rest.get(`upperArm${side}`)!;
      const x0 = shoulder.x;
      const y0 = shoulder.y;
      const elbow = y0 - UPPER_ARM_LENGTH;
      const wrist = elbow - FOREARM_LENGTH;
      const armInfluence = (_x: number, y: number): Influence => {
        if (y > y0 + 0.01) return blend(`clavicle${side}`, `upperArm${side}`, smooth(y0 + 0.045, y0 + 0.01, y));
        if (y > elbow + 0.04) return [[`upperArm${side}`, 1]];
        if (y > elbow - 0.04) return blend(`upperArm${side}`, `forearm${side}`, smooth(elbow + 0.04, elbow - 0.04, y));
        if (y > wrist + 0.02) return [[`forearm${side}`, 1]];
        return blend(`forearm${side}`, `hand${side}`, smooth(wrist + 0.02, wrist - 0.015, y));
      };
      add(`arm${side}`, (piece) => {
        const style: PieceStyle = { group: `arm${side}`, region: () => REGION.skin, color: paint, influence: armInfluence };
        const ring = (dy: number, rx: number, rz: number, oz = 0, front = 0, back = 0): Ring => ({ y: y0 + dy, rx, rz, ox: x0, oz, front, back });
        loft(piece, style, [
          ring(0.04, 0.046, 0.05),
          ring(-0.02, 0.052, 0.054),
          ring(-0.09, 0.048, 0.052, 0.002, 0.08, 0.02),
          ring(-0.17, 0.045, 0.049, 0.002, 0.07, 0.03),
          ring(-0.24, 0.041, 0.043),
          ring(-UPPER_ARM_LENGTH, 0.037, 0.039, -0.004),
          ring(-0.33, 0.044, 0.046, 0.002, 0.05),
          ring(-0.39, 0.04, 0.041),
          ring(-0.46, 0.032, 0.03),
          ring(-(UPPER_ARM_LENGTH + FOREARM_LENGTH), 0.027, 0.02),
          ring(-(UPPER_ARM_LENGTH + FOREARM_LENGTH) - 0.012, 0.026, 0.02),
        ], 16);
        // Deltoid: the shoulder's round cap, under the sleeve.
        sculpt(
          piece,
          { ...style, influence: () => [[`clavicle${side}`, 0.35], [`upperArm${side}`, 0.65]] },
          new THREE.Vector3(x0 + sign * 0.002, y0 - 0.016, -0.004),
          (d) => 1 / Math.sqrt((d.x / 0.05) ** 2 + (d.y / 0.064) ** 2 + (d.z / 0.054) ** 2),
          12,
          8,
        );
      });
      if (outfit.sleeve > 0) {
        add(`sleeve${side}`, (piece) => {
          const style: PieceStyle = {
            group: `sleeve${side}`,
            region: () => REGION.shirt,
            color: paint,
            // The sleeve goes with the arm; only its top, tucked into the
            // shoulder, follows the collarbone, or it would shear when the
            // arm reaches forward to the wheel.
            influence: (_x, y) => blend(`clavicle${side}`, `upperArm${side}`, smooth(y0 + 0.07, y0 + 0.035, y)),
            flutter: (_x, y) => smooth(y0 - 0.04, y0 - UPPER_ARM_LENGTH * outfit.sleeve, y) * 0.8,
          };
          const end = -UPPER_ARM_LENGTH * outfit.sleeve;
          loft(piece, style, [
            { y: y0 + 0.065, rx: 0.046, rz: 0.05, ox: x0 - sign * 0.008 },
            { y: y0 + 0.03, rx: 0.057, rz: 0.06, ox: x0 },
            { y: y0 - 0.04, rx: 0.06, rz: 0.062, ox: x0 },
            { y: y0 + end * 0.6, rx: 0.058, rz: 0.061, ox: x0 },
            { y: y0 + end, rx: 0.058, rz: 0.061, ox: x0 },
            // The hem turns in to the arm: the sleeve has thickness.
            { y: y0 + end + 0.004, rx: 0.047, rz: 0.05, ox: x0 },
          ], 16, false, false);
        });
      }
      add(`hand${side}`, (piece) => {
        const style: PieceStyle = {
          group: `hand${side}`,
          region: () => REGION.skin,
          color: paint,
          influence: (_x, y) => blend(`forearm${side}`, `hand${side}`, smooth(wrist + 0.01, wrist - 0.02, y)),
        };
        // Palm and fingers, curled a little as on a wheel's rim.
        loft(piece, style, [
          { y: wrist + 0.01, rx: 0.026, rz: 0.02, ox: x0 },
          { y: wrist - 0.03, rx: 0.036, rz: 0.021, ox: x0, oz: 0.002 },
          { y: wrist - 0.065, rx: 0.042, rz: 0.018, ox: x0 - sign * 0.002, oz: 0.004 },
          { y: wrist - 0.095, rx: 0.041, rz: 0.016, ox: x0 - sign * 0.003, oz: 0.008 },
          { y: wrist - 0.125, rx: 0.036, rz: 0.014, ox: x0 - sign * 0.004, oz: 0.016 },
          { y: wrist - 0.15, rx: 0.03, rz: 0.012, ox: x0 - sign * 0.005, oz: 0.026 },
          { y: wrist - 0.162, rx: 0.02, rz: 0.009, ox: x0 - sign * 0.005, oz: 0.032 },
        ], 12);
        // Thumb, along the front of the palm.
        sculpt(
          piece,
          style,
          new THREE.Vector3(x0 - sign * 0.012, wrist - 0.055, 0.026),
          (d) => 1 / Math.sqrt((d.x / 0.012) ** 2 + (d.y / 0.033) ** 2 + (d.z / 0.013) ** 2),
          8,
          6,
        );
      });
    }

    // --- Legs: thigh, knee, calf, ankle; legs of the shorts; boat shoes ----------
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
          color: paint,
          influence: legInfluence,
        };
        const ring = (dy: number, rx: number, rz: number, oz = 0, front = 0, back = 0): Ring => ({ y: y0 + dy, rx, rz, ox: x0 - sign * 0.004 * Math.max(0, -dy), oz, front, back });
        loft(piece, style, [
          ring(0.045, 0.08, 0.088),
          ring(-0.04, 0.086, 0.094, 0.004, 0.04),
          ring(-0.12, 0.08, 0.088, 0.008, 0.08),
          ring(-0.22, 0.072, 0.078, 0.008, 0.07),
          ring(-0.32, 0.062, 0.064, 0.004, 0.04),
          ring(-0.4, 0.053, 0.055, 0.004),
          ring(-THIGH_LENGTH, 0.049, 0.052, 0.009, 0.08),
          ring(-0.49, 0.048, 0.05, 0.003),
          ring(-0.56, 0.05, 0.056, -0.01, 0, 0.18),
          ring(-0.63, 0.047, 0.054, -0.011, 0, 0.16),
          ring(-0.71, 0.039, 0.043, -0.006, 0, 0.06),
          ring(-0.79, 0.031, 0.033),
          ring(-(THIGH_LENGTH + SHIN_LENGTH) + 0.02, 0.028, 0.03),
          ring(-(THIGH_LENGTH + SHIN_LENGTH) + 0.005, 0.03, 0.034),
        ], 18);
      });
      add(`shorts${side}`, (piece) => {
        const style: PieceStyle = {
          group: `shorts${side}`,
          region: () => REGION.shorts,
          color: paint,
          influence: legInfluence,
          flutter: (_x, y) => smooth(y0 - 0.06, y0 + SHORTS_END, y) * 0.55,
        };
        loft(piece, style, [
          { y: y0 + 0.07, rx: 0.084, rz: 0.094, ox: x0 - sign * 0.004 },
          { y: y0 - 0.04, rx: 0.098, rz: 0.106, ox: x0, oz: 0.003 },
          { y: y0 - 0.13, rx: 0.095, rz: 0.102, ox: x0 + sign * 0.004, oz: 0.004 },
          { y: y0 + SHORTS_END, rx: 0.096, rz: 0.1, ox: x0 + sign * 0.006, oz: 0.002 },
          { y: y0 + SHORTS_END + 0.004, rx: 0.078, rz: 0.083, ox: x0 + sign * 0.004 },
        ], 18, false, false);
      });
      add(`shoe${side}`, (piece) => {
        const foot = rest.get(`foot${side}`)!;
        const style: PieceStyle = {
          group: `shoe${side}`,
          region: (_x, y) => (y < 0.014 ? REGION.sole : REGION.shoes),
          color: paint,
          influence: (_x, y) => blend(`shin${side}`, `foot${side}`, smooth(foot.y + 0.07, foot.y + 0.03, y)),
        };
        // Lofted heel to toe along +Z (built along Y, then turned).
        const profile: [number, number, number, number][] = [
          // z, half-width, half-height, centre height
          [-0.07, 0.022, 0.026, 0.036],
          [-0.058, 0.04, 0.042, 0.047],
          [-0.02, 0.046, 0.05, 0.053],
          [0.03, 0.047, 0.044, 0.048],
          [0.08, 0.05, 0.036, 0.039],
          [0.13, 0.048, 0.03, 0.032],
          [0.165, 0.04, 0.024, 0.026],
          [0.188, 0.026, 0.017, 0.021],
          [0.196, 0.012, 0.01, 0.018],
        ];
        const segments = 16;
        const base = piece.positions.length / 3;
        const firstIndex = piece.indices.length;
        for (const [z, halfWidth, halfHeight, centre] of profile) {
          for (let step = 0; step < segments; step += 1) {
            const angle = (step / segments) * Math.PI * 2;
            const s = Math.sin(angle);
            const c = Math.cos(angle);
            // Flat sole: the lower half is squared off.
            const yShape = c > 0 ? c : -Math.pow(-c, 0.45);
            const xShape = Math.sign(s) * Math.pow(Math.abs(s), 0.8);
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
      positions.push(...piece.positions);
      normals.push(...(part.getAttribute("normal").array as Float32Array));
      part.dispose();
      for (const index of piece.indices) indices.push(index + offset);
      regionValues.push(...piece.regions);
      flutterValues.push(...piece.flutter);
      colorValues.push(...piece.colors);
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
    sphere(0, 1.652, 0.016, 0.1, "head");
    sphere(0, 1.55, -0.005, 0.05, "neck");
    if (hasCap) sphere(0, 1.685, 0.13, 0.05, "cap");
    for (const side of ["L", "R"] as const) {
      const sign = side === "L" ? 1 : -1;
      for (const dy of [0, -0.12, -0.24]) sphere(sign * 0.19, 1.435 + dy, 0, 0.05, `arm${side}`);
      for (const dy of [-0.34, -0.45]) sphere(sign * 0.19, 1.435 + dy, 0, 0.038, `arm${side}`);
      for (const dy of [-0.04, -0.16, -0.3]) sphere(sign * 0.098, 0.905 + dy, 0.005, 0.085, `leg${side}`);
      for (const dy of [-0.55, -0.68]) sphere(sign * 0.098, 0.905 + dy, -0.008, 0.048, `leg${side}`);
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
