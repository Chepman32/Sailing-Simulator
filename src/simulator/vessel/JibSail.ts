import * as THREE from "three";
import { damp } from "../math";
import type { SailShape } from "./SailMath";

const COLUMNS = 18;
const ROWS = 16;

/** Where the jib is set, in vessel space (+Z bow, +X starboard), from the mast's position and height. */
export type JibRig = {
  /** Tack: the forestay's foot on the bows' crossbeam. */
  tack: THREE.Vector3;
  /** Head: where the forestay meets the mast (a fractional rig). */
  head: THREE.Vector3;
  /** Foot length from the tack to the clew, metres. */
  foot: number;
  /** Clew height above the deck, metres. */
  clewHeight: number;
};

export function jibRig(mastX: number, mastZ: number, boomHeight: number, mastTop: number, bowZ: number): JibRig {
  const tack = new THREE.Vector3(mastX, boomHeight - 0.98, bowZ - 0.4);
  const head = new THREE.Vector3(mastX, boomHeight + (mastTop - boomHeight) * 0.74, mastZ + 0.14);
  return { tack, head, foot: Math.max(1, (tack.z - mastZ) * 0.86), clewHeight: tack.y + 0.3 };
}

/**
 * Where the jib's clew sits for a boom angle: the jib is sheeted a little
 * tighter than the main and always to the same (leeward) side. Signed like
 * every boom angle: positive toward starboard (+X).
 */
export function jibSheetAngle(boomAngle: number): number {
  const side = boomAngle >= 0 ? 1 : -1;
  return side * Math.min(1.0, Math.max(0.12, Math.abs(boomAngle) * 0.82 + 0.05));
}

/** Belly profile along the chord, 0 at luff and leech, 1 at its deepest (a third aft). */
export function jibCamber(u: number): number {
  const clamped = Math.min(1, Math.max(0, u));
  return (27 / 4) * clamped * (1 - clamped) * (1 - clamped);
}

/**
 * The jib (headsail): a cloth surface between the forestay and the clew,
 * rebuilt each frame from the same sail shape as the main (belly, luffing
 * flutter) and sheeted to the side the boom is on. The GLB has no jib, only
 * its forestay.
 */
export class JibSail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly positions: Float32Array;
  private readonly luff = new THREE.Vector3();
  private readonly leech = new THREE.Vector3();
  private readonly chord = new THREE.Vector3();
  private readonly belly = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly clew = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private angle = 0.3;

  constructor(private readonly rig: JibRig) {
    const count = (COLUMNS + 1) * (ROWS + 1);
    this.positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const indices: number[] = [];
    for (let row = 0; row <= ROWS; row += 1) {
      for (let column = 0; column <= COLUMNS; column += 1) {
        const vertex = row * (COLUMNS + 1) + column;
        uvs[vertex * 2] = column / COLUMNS;
        uvs[vertex * 2 + 1] = row / ROWS;
        if (row < ROWS && column < COLUMNS) {
          const next = vertex + COLUMNS + 1;
          indices.push(vertex, vertex + 1, next, vertex + 1, next + 1, next);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(this.positions, 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", position);
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({
      name: "Jib_Sailcloth",
      color: 0xf4f1e6,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "Procedural_Jib";
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // The vertices move every frame; stale bounds would cull the sail.
    this.mesh.frustumCulled = false;
  }

  update(time: number, delta: number, boomAngle: number, shape: SailShape): void {
    this.angle = damp(this.angle, jibSheetAngle(boomAngle), 3, delta);
    const rig = this.rig;
    const side = this.angle >= 0 ? 1 : -1;
    // The clew swings out to leeward about the tack.
    this.clew.set(
      rig.tack.x + Math.sin(this.angle) * rig.foot,
      rig.clewHeight,
      rig.tack.z - Math.cos(this.angle) * rig.foot,
    );
    this.axis.subVectors(rig.head, rig.tack).normalize();
    this.belly.subVectors(this.clew, rig.tack).cross(this.axis).normalize();
    if (this.belly.x * side < 0) this.belly.negate();
    const draft = Math.abs(shape.draft) * 1.1;
    const flutter = shape.flutter;
    let offset = 0;
    for (let row = 0; row <= ROWS; row += 1) {
      const v = row / ROWS;
      this.luff.lerpVectors(rig.tack, rig.head, v);
      this.leech.lerpVectors(this.clew, rig.head, v);
      this.chord.subVectors(this.leech, this.luff);
      const chordLength = this.chord.length();
      // Fuller low down, flatter toward the head.
      const depth = draft * chordLength * (1 - v * 0.3);
      for (let column = 0; column <= COLUMNS; column += 1) {
        const u = column / COLUMNS;
        // A luffing jib shakes most at its free edge, the leech.
        const shake = flutter * chordLength * Math.sin(time * 11 + v * 15 + u * 7) * u;
        this.point.copy(this.luff).addScaledVector(this.chord, u).addScaledVector(this.belly, depth * jibCamber(u) + shake);
        this.positions[offset] = this.point.x;
        this.positions[offset + 1] = this.point.y;
        this.positions[offset + 2] = this.point.z;
        offset += 3;
      }
    }
    this.mesh.geometry.getAttribute("position").needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
