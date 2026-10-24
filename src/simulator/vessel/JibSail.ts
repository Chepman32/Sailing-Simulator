import * as THREE from "three";
import { clamp, damp } from "../math";

/**
 * The jib: the headsail the aerodynamics already counts with the main (see
 * `SailAerodynamics`), now on the yacht. It sets on a forestay from the
 * mast to a short front beam between the bows; its sheet leads aft to the
 * cabin top on the leeward side. The cloth is a grid recomputed every frame
 * on the CPU (about four hundred vertices): its luff stays straight on the
 * stay, its belly deepens with the wind and the trim, the head twists open
 * and the leech shakes as the sail comes near luffing. Through a tack the
 * sail empties, flogs and crosses to the new side.
 */

const COLUMNS = 18;
const ROWS = 22;

export type JibRig = {
  /** Lower and upper ends of the forestay (vessel space). */
  stayFoot: THREE.Vector3;
  stayHead: THREE.Vector3;
  /** Where the bows are, for the beam the stay is set on (x of each, y, z). */
  bowX: number;
  beamY: number;
  beamZ: number;
};

/** Default rig for the catamaran (vessel space, metres). */
export const CATAMARAN_JIB_RIG: JibRig = {
  stayFoot: new THREE.Vector3(0, 0.8, 4.3),
  stayHead: new THREE.Vector3(0, 7.32, 1.73),
  bowX: 1.73,
  beamY: 0.58,
  beamZ: 4.3,
};

/** Sheeted angle of the jib off the centreline for the main's sheet angle (both radians). */
export function jibSheetAngle(mainSheetAngle: number): number {
  // Jib leads are fixed: it sheets a little closer than the main and cannot go far out.
  return clamp(mainSheetAngle * 0.82 + 0.05, 0.17, 0.85);
}

/** Panel seams, the UV strip along leech and foot, and the clew patch, painted once. */
function clothTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 256, 512);
  // u runs across (0 luff … 1 leech), v up (row 0 is the head at the top of the image).
  // Cross-cut panels: seams square to the leech, a little darker.
  context.strokeStyle = "rgba(120, 120, 120, 0.32)";
  context.lineWidth = 2;
  for (let index = 1; index < 11; index += 1) {
    const y = 512 - index * 44;
    context.beginPath();
    context.moveTo(0, y + 26);
    context.lineTo(256, y);
    context.stroke();
  }
  // Sun cover along the leech and foot (sewn on, the deep blue of most furling jibs).
  context.fillStyle = "#24384f";
  context.fillRect(222, 0, 34, 512);
  context.fillRect(0, 486, 256, 26);
  // Reinforcement patches at the clew and head.
  context.fillStyle = "rgba(170, 170, 170, 0.5)";
  context.beginPath();
  context.moveTo(256, 512);
  context.lineTo(176, 512);
  context.lineTo(256, 440);
  context.fill();
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(90, 0);
  context.lineTo(0, 70);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class JibSail {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly cloth: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly texture: THREE.CanvasTexture | null;
  private readonly fittings: THREE.Mesh[] = [];
  private readonly fittingGeometries: THREE.BufferGeometry[] = [];
  private readonly positions: Float32Array;
  /** Signed sheet angle (+ toward starboard, like the boom), eased. */
  private angle = 0.3;
  private draft = 0;
  private flog = 0;
  private readonly tack = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly clew = new THREE.Vector3();
  private readonly luffPoint = new THREE.Vector3();
  private readonly leechPoint = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly sheetLine: THREE.Line;
  private readonly sheetPositions: Float32Array;

  constructor(private readonly rig: JibRig = CATAMARAN_JIB_RIG) {
    this.group.name = "Jib";
    const count = (COLUMNS + 1) * (ROWS + 1);
    this.positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const indices: number[] = [];
    for (let row = 0; row <= ROWS; row += 1) {
      for (let column = 0; column <= COLUMNS; column += 1) {
        const index = row * (COLUMNS + 1) + column;
        uvs[index * 2] = column / COLUMNS;
        uvs[index * 2 + 1] = 1 - row / ROWS;
        if (row < ROWS && column < COLUMNS) {
          const a = index;
          const b = index + 1;
          const c = index + COLUMNS + 1;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    }
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);
    this.texture = clothTexture();
    this.material = new THREE.MeshStandardMaterial({
      name: "jib-cloth",
      color: 0xdcd8ca,
      map: this.texture,
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.cloth = new THREE.Mesh(this.geometry, this.material);
    this.cloth.castShadow = true;
    this.cloth.receiveShadow = true;
    this.cloth.frustumCulled = false;
    this.cloth.name = "JibCloth";
    this.group.add(this.cloth);
    this.buildFittings();
    this.sheetPositions = new Float32Array(6);
    const sheetGeometry = new THREE.BufferGeometry();
    sheetGeometry.setAttribute("position", new THREE.BufferAttribute(this.sheetPositions, 3));
    this.fittingGeometries.push(sheetGeometry);
    this.sheetLine = new THREE.Line(sheetGeometry, new THREE.LineBasicMaterial({ color: 0x2a2f35 }));
    this.sheetLine.frustumCulled = false;
    this.group.add(this.sheetLine);
    this.shape(0, 0.3, 0, 0, 0.6);
  }

  /** A front beam between the bows, the forestay and a furling drum. */
  private buildFittings(): void {
    const rig = this.rig;
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 1, roughness: 0.22 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272c, metalness: 0.3, roughness: 0.5 });
    const beam = new THREE.CylinderGeometry(0.065, 0.065, rig.bowX * 2, 14);
    beam.rotateZ(Math.PI / 2);
    const beamMesh = new THREE.Mesh(beam, metal);
    beamMesh.position.set(0, rig.beamY, rig.beamZ);
    const stayLength = rig.stayFoot.distanceTo(rig.stayHead);
    const stay = new THREE.CylinderGeometry(0.012, 0.012, stayLength, 6);
    const stayMesh = new THREE.Mesh(stay, metal);
    stayMesh.position.copy(rig.stayFoot).add(rig.stayHead).multiplyScalar(0.5);
    stayMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rig.stayHead.clone().sub(rig.stayFoot).normalize());
    // A short strut from the beam up to the drum.
    const strut = new THREE.CylinderGeometry(0.03, 0.04, rig.stayFoot.y - rig.beamY, 10);
    const strutMesh = new THREE.Mesh(strut, metal);
    strutMesh.position.set(0, (rig.stayFoot.y + rig.beamY) / 2, rig.stayFoot.z);
    const drum = new THREE.CylinderGeometry(0.09, 0.09, 0.12, 16);
    const drumMesh = new THREE.Mesh(drum, dark);
    drumMesh.position.copy(rig.stayFoot).add(new THREE.Vector3(0, 0.04, 0));
    for (const [mesh, geometry] of [
      [beamMesh, beam],
      [stayMesh, stay],
      [strutMesh, strut],
      [drumMesh, drum],
    ] as const) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.fittings.push(mesh);
      this.fittingGeometries.push(geometry);
    }
  }

  setColor(hex: number): void {
    this.material.color.setHex(hex);
  }

  /**
   * @param mainSheetAngle the main's sheet angle off the centreline (radians, unsigned).
   * @param leewardSide +1 when the sails fill toward starboard, −1 toward port.
   * @param luff 0 drawing … 1 flogging.
   * @param apparentWindSpeed m/s.
   * @param trim the helm's sail trim, 0.2…1.
   */
  update(time: number, delta: number, mainSheetAngle: number, leewardSide: number, luff: number, apparentWindSpeed: number, trim: number): void {
    const side = leewardSide >= 0 ? 1 : -1;
    const target = side * jibSheetAngle(mainSheetAngle);
    // Through a tack the clew crosses quickly but not instantly.
    this.angle = damp(this.angle, target, Math.sign(target) !== Math.sign(this.angle) ? 2.4 : 3.5, delta);
    const pressure = clamp(apparentWindSpeed / 10, 0, 1);
    const power = clamp((trim - 0.2) / 0.8, 0, 1);
    const drawing = 1 - clamp(luff, 0, 1);
    // Crossing over, the sail is empty whatever the wind.
    const crossing = clamp(1 - Math.abs(this.angle) / 0.16, 0, 1);
    const fill = drawing * (1 - crossing);
    this.draft = damp(this.draft, (0.06 + 0.11 * Math.min(1, 0.3 + pressure)) * (0.55 + 0.45 * power) * fill, 4, delta);
    this.flog = damp(this.flog, Math.max(luff, crossing) * Math.min(1, 0.25 + pressure), 6, delta);
    this.shape(time, this.angle, this.draft, this.flog, power, pressure);
  }

  private shape(time: number, angle: number, draft: number, flog: number, power: number, pressure = 0.6): void {
    const rig = this.rig;
    this.tack.copy(rig.stayFoot).add(this.point.set(0, 0.12, 0));
    this.head.copy(rig.stayFoot).lerp(rig.stayHead, 0.9);
    const foot = 2.95;
    // Sheeting: the clew swings out about the tack, to the side the boom swings to
    // (a positive boom angle shows on her +X side, see BoomDynamics and Vessel).
    const side = Math.sign(angle) || 1;
    this.clew.set(Math.sin(angle) * foot, 1.85 - this.tack.y, -Math.cos(angle) * foot).add(this.tack);
    // Toward leeward, square to the foot.
    const normalX = side * Math.cos(angle);
    const normalZ = side * Math.sin(angle);
    const positions = this.positions;
    for (let row = 0; row <= ROWS; row += 1) {
      // v: 0 at the foot, 1 at the head; rows run from the head down.
      const v = 1 - row / ROWS;
      this.luffPoint.copy(this.tack).lerp(this.head, v);
      this.leechPoint.copy(this.clew).lerp(this.head, v);
      const chord = this.luffPoint.distanceTo(this.leechPoint);
      for (let column = 0; column <= COLUMNS; column += 1) {
        const u = column / COLUMNS;
        this.point.copy(this.luffPoint).lerp(this.leechPoint, u);
        // Belly: deepest about 40 % aft of the luff, flatter at the foot and head.
        const belly = Math.sin(Math.PI * Math.pow(u, 0.72)) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, v * 1.15 + 0.05)));
        let offset = draft * chord * belly;
        // Twist: the upper leech falls off to leeward.
        offset += (0.05 + 0.08 * (1 - power)) * v * v * u * foot;
        // The leech and a luffing sail shake.
        const leech = Math.pow(u, 1.6);
        const wave = Math.sin(time * 11 + v * 13 - u * 7) * 0.65 + Math.sin(time * 17.3 + v * 23 + u * 3) * 0.35;
        offset += (flog * 0.16 + 0.012 * pressure) * chord * leech * wave * (0.4 + 0.6 * v) * Math.sin(Math.PI * Math.min(1, u * 1.05));
        // A flogging sail balloons back and forth as a whole.
        offset += flog * 0.09 * chord * Math.sin(time * 6.3 + v * 4) * Math.sin(Math.PI * u);
        const index = (row * (COLUMNS + 1) + column) * 3;
        positions[index] = this.point.x + normalX * offset;
        positions[index + 1] = this.point.y;
        positions[index + 2] = this.point.z + normalZ * offset;
      }
    }
    const attribute = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    attribute.needsUpdate = true;
    this.geometry.computeVertexNormals();
    // The sheet: clew to a block on the cabin top, abeam the mast on the leeward side.
    const clewIndex = (ROWS * (COLUMNS + 1) + COLUMNS) * 3;
    this.sheetPositions[0] = positions[clewIndex]!;
    this.sheetPositions[1] = positions[clewIndex + 1]!;
    this.sheetPositions[2] = positions[clewIndex + 2]!;
    this.sheetPositions[3] = side * 0.95;
    this.sheetPositions[4] = 1.56;
    this.sheetPositions[5] = 1.05;
    (this.sheetLine.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
    this.fittingGeometries.forEach((geometry) => geometry.dispose());
    this.fittings.forEach((mesh) => (mesh.material as THREE.Material).dispose());
    (this.sheetLine.material as THREE.Material).dispose();
  }
}
