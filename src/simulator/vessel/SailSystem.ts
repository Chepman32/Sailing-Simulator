import * as THREE from "three";
import { damp } from "../math";
import { computeSailState, type SailState } from "./SailAerodynamics";

const CHORD_SEGMENTS = 14;
const HEIGHT_SEGMENTS = 22;

/** Fallback rig dimensions (vessel space, metres) if the GLB nodes move. */
const DEFAULT_RIG = {
  mastZ: 1.745,
  mastTop: 8.2,
  gooseneck: new THREE.Vector3(0, 1.94, 1.7),
  boomLength: 5.9,
  boomRestAngle: 0.304,
  forestayBottom: new THREE.Vector3(0, 0.54, 4.36),
  forestayTop: new THREE.Vector3(0, 5.91, 1.79),
};

type SailShape = {
  tack: THREE.Vector3;
  head: THREE.Vector3;
  clew: THREE.Vector3;
  /** Extra outward curve of the leech, metres at mid-height. */
  roach: number;
  headWidth: number;
  /** Fraction of the camber retained at the foot. */
  footCamber: number;
};

/** Normalised chordwise belly profile with maximum draft at ~42% chord. */
export function sailCamberProfile(chord: number): number {
  const u = THREE.MathUtils.clamp(chord, 0, 1);
  return 5.1 * u * Math.pow(1 - u, 1.4);
}

function sailclothTexture(battens: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 256, 0);
    gradient.addColorStop(0, "#f4f1e6");
    gradient.addColorStop(1, "#ebe6d6");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 512);
    // Cross-cut panel seams run from luff to leech.
    context.strokeStyle = "rgba(150, 140, 118, 0.42)";
    context.lineWidth = 1.4;
    for (let index = 1; index < 11; index += 1) {
      const y = (index / 11) * 512;
      context.beginPath();
      context.moveTo(0, y + 6);
      context.lineTo(256, y - 6);
      context.stroke();
    }
    context.strokeStyle = "rgba(120, 112, 96, 0.5)";
    context.lineWidth = 5;
    for (let index = 1; index <= battens; index += 1) {
      const y = 512 - (index / (battens + 1)) * 512;
      context.beginPath();
      context.moveTo(256 * 0.42, y);
      context.lineTo(256, y);
      context.stroke();
    }
    // Reinforced corner patches at tack and clew.
    context.fillStyle = "rgba(205, 196, 172, 0.55)";
    context.beginPath();
    context.moveTo(0, 512);
    context.lineTo(46, 512);
    context.lineTo(0, 440);
    context.fill();
    context.beginPath();
    context.moveTo(256, 512);
    context.lineTo(206, 512);
    context.lineTo(256, 448);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

class ClothSail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly positions: Float32Array;
  private readonly luff = new THREE.Vector3();
  private readonly leech = new THREE.Vector3();
  private readonly chord = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly chordDirection = new THREE.Vector3();
  private readonly edgeA = new THREE.Vector3();
  private readonly edgeB = new THREE.Vector3();

  constructor(name: string, private readonly texture: THREE.Texture) {
    const columns = CHORD_SEGMENTS + 1;
    const rows = HEIGHT_SEGMENTS + 1;
    this.positions = new Float32Array(columns * rows * 3);
    const uvs = new Float32Array(columns * rows * 2);
    const indices: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        uvs[index * 2] = column / CHORD_SEGMENTS;
        uvs[index * 2 + 1] = row / HEIGHT_SEGMENTS;
        if (row < HEIGHT_SEGMENTS && column < CHORD_SEGMENTS) {
          const next = index + columns;
          indices.push(index, index + 1, next, index + 1, next + 1, next);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // The sail moves every frame; a static bounding sphere would cull it wrongly.
    this.mesh.frustumCulled = false;
  }

  /** Rebuild the cloth surface. `camber` and `twist` are signed toward leeward (+X). */
  shape(shape: SailShape, camber: number, twist: number, luffing: number, time: number, heightProfileStart: number): void {
    const { tack, head, clew } = shape;
    this.edgeA.subVectors(head, tack);
    this.edgeB.subVectors(clew, tack);
    this.normal.crossVectors(this.edgeA, this.edgeB).normalize();
    if (this.normal.x < 0) this.normal.negate();

    const columns = CHORD_SEGMENTS + 1;
    for (let row = 0; row <= HEIGHT_SEGMENTS; row += 1) {
      const v = row / HEIGHT_SEGMENTS;
      this.luff.lerpVectors(tack, head, v);
      this.leech.lerpVectors(clew, head, v);
      this.chordDirection.subVectors(this.leech, this.luff);
      const rawChord = this.chordDirection.length();
      if (rawChord > 1e-4) this.chordDirection.multiplyScalar(1 / rawChord);
      else this.chordDirection.subVectors(clew, tack).normalize();
      // Roach and a small headboard keep the main from becoming a flat triangle.
      this.leech.addScaledVector(this.chordDirection, shape.roach * Math.sin(Math.PI * v) + shape.headWidth * v * v);
      this.chord.subVectors(this.leech, this.luff);
      const chordLength = this.chord.length();
      // The upper leech opens to leeward (twist).
      this.leech.addScaledVector(this.normal, chordLength * Math.sin(twist * v));
      this.chord.subVectors(this.leech, this.luff);
      const heightProfile = shape.footCamber + (1 - shape.footCamber) * THREE.MathUtils.smoothstep(v, 0, heightProfileStart);

      for (let column = 0; column <= CHORD_SEGMENTS; column += 1) {
        const u = column / CHORD_SEGMENTS;
        this.point.copy(this.luff).addScaledVector(this.chord, u);
        let offset = camber * chordLength * sailCamberProfile(u) * heightProfile;
        // Flogging when luffing; otherwise only the leech trembles slightly.
        offset += luffing * chordLength * 0.06 * Math.sin(time * 13 + v * 7 - u * 9) * Math.sqrt(u);
        offset += chordLength * 0.004 * Math.sin(time * 9.5 + v * 14) * u * u * u;
        this.point.addScaledVector(this.normal, offset);
        const index = (row * columns + column) * 3;
        this.positions[index] = this.point.x;
        this.positions[index + 1] = this.point.y;
        this.positions[index + 2] = this.point.z;
      }
    }
    const attribute = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    attribute.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}

function findNode(model: THREE.Object3D, pattern: RegExp): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  model.traverse((object) => {
    if (!found && pattern.test(object.name)) found = object;
  });
  return found;
}

function boundsIn(root: THREE.Object3D, object: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.computeBoundingBox();
    const local = child.geometry.boundingBox?.clone();
    if (!local) return;
    local.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld));
    box.union(local);
  });
  return box;
}

/**
 * Procedural mainsail and staysail driven by SailAerodynamics. The detailed
 * GLB keeps its mast, boom, rigging and hull; its single flat mainsail mesh is
 * replaced by two dense cloth surfaces whose belly, twist and luffing follow
 * the same apparent wind and trim that the physics uses. The boom is re-pivoted
 * at the gooseneck so it swings with the main sheet.
 */
export class SailSystem {
  private readonly main: ClothSail;
  private readonly jib: ClothSail;
  private readonly boomPivot = new THREE.Group();
  private readonly rig = {
    mastZ: DEFAULT_RIG.mastZ,
    mastTop: DEFAULT_RIG.mastTop,
    gooseneck: DEFAULT_RIG.gooseneck.clone(),
    boomLength: DEFAULT_RIG.boomLength,
    boomRestAngle: DEFAULT_RIG.boomRestAngle,
    forestayBottom: DEFAULT_RIG.forestayBottom.clone(),
    forestayTop: DEFAULT_RIG.forestayTop.clone(),
  };
  private readonly mainShape: SailShape;
  private readonly jibShape: SailShape;
  private boomSigned = DEFAULT_RIG.boomRestAngle;
  private jibSigned = 0.3;
  private camberSigned = 0;
  private jibCamberSigned = 0;
  private twistSigned = 0;
  private luffing = 0;
  latest: SailState = computeSailState(1, 7, 0.68);

  constructor(model: THREE.Object3D, private readonly root: THREE.Object3D) {
    model.updateMatrixWorld(true);
    const hiddenSails: THREE.Mesh[] = [];
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material.name.toLowerCase().includes("cloth"))) hiddenSails.push(object);
    });
    hiddenSails.forEach((mesh) => {
      mesh.visible = false;
    });

    const mast = findNode(model, /^Cylinder\.?002_3$/);
    if (mast) {
      const box = boundsIn(root, mast);
      if (!box.isEmpty()) {
        this.rig.mastZ = (box.min.z + box.max.z) / 2;
        this.rig.mastTop = box.max.y;
      }
    }
    const forestay = findNode(model, /^Cylinder\.?006_8$/);
    if (forestay) {
      const box = boundsIn(root, forestay);
      if (!box.isEmpty()) {
        this.rig.forestayBottom.set(0, box.min.y, box.max.z);
        this.rig.forestayTop.set(0, box.max.y, box.min.z);
      }
    }
    const boom = findNode(model, /^Cylinder\.?004_5$/);
    if (boom) {
      const box = boundsIn(root, boom);
      if (!box.isEmpty()) {
        const aftX = Math.abs(box.max.x) > Math.abs(box.min.x) ? box.max.x : box.min.x;
        this.rig.gooseneck.set(0, (box.min.y + box.max.y) / 2, box.max.z);
        this.rig.boomLength = Math.hypot(aftX, box.max.z - box.min.z);
        this.rig.boomRestAngle = Math.atan2(aftX, box.max.z - box.min.z);
      }
      // Re-pivot the boom at the gooseneck while keeping its world transform.
      this.boomPivot.name = "BoomGooseneckPivot";
      this.boomPivot.position.copy(this.rig.gooseneck);
      root.add(this.boomPivot);
      this.boomPivot.updateMatrixWorld(true);
      this.boomPivot.attach(boom);
    }
    this.boomSigned = this.rig.boomRestAngle;

    this.mainShape = {
      tack: new THREE.Vector3(0, this.rig.gooseneck.y + 0.08, this.rig.mastZ - 0.08),
      head: new THREE.Vector3(0, this.rig.mastTop - 0.22, this.rig.mastZ - 0.08),
      clew: new THREE.Vector3(),
      roach: 0.42,
      headWidth: 0.22,
      footCamber: 0.42,
    };
    const stay = new THREE.Vector3().subVectors(this.rig.forestayTop, this.rig.forestayBottom);
    this.jibShape = {
      tack: this.rig.forestayBottom.clone().addScaledVector(stay, 0.03),
      head: this.rig.forestayBottom.clone().addScaledVector(stay, 0.95),
      clew: new THREE.Vector3(),
      roach: 0,
      headWidth: 0.04,
      footCamber: 0.55,
    };
    this.main = new ClothSail("Procedural_Mainsail", sailclothTexture(4));
    this.jib = new ClothSail("Procedural_Staysail_Jib", sailclothTexture(0));
    root.add(this.main.mesh, this.jib.mesh);
  }

  /** World-space bounds of both sails, used by the photo director to avoid occlusion. */
  get sailMeshes(): readonly THREE.Mesh[] {
    return [this.main.mesh, this.jib.mesh];
  }

  update(time: number, apparentWindAngle: number, apparentWindSpeed: number, trim: number, delta: number): void {
    const state = computeSailState(apparentWindAngle, apparentWindSpeed, trim);
    this.latest = state;
    // Signed angles pass smoothly through zero during a tack or gybe.
    this.boomSigned = damp(this.boomSigned, state.side * state.mainSheetAngle, 1.5, delta);
    this.jibSigned = damp(this.jibSigned, state.side * state.jibSheetAngle, 2.6, delta);
    this.camberSigned = damp(this.camberSigned, state.side * state.mainCamber, 2.2, delta);
    this.jibCamberSigned = damp(this.jibCamberSigned, state.side * state.jibCamber, 2.8, delta);
    this.twistSigned = damp(this.twistSigned, state.side * state.twist, 1.8, delta);
    this.luffing = damp(this.luffing, state.luffing, 3, delta);

    // Rotation about +Y moves the aft boom end toward -X, so negate the angle.
    this.boomPivot.rotation.y = -(this.boomSigned - this.rig.boomRestAngle);
    const boomReach = this.rig.boomLength - 0.12;
    this.mainShape.clew
      .set(Math.sin(this.boomSigned) * boomReach, 0.07, -Math.cos(this.boomSigned) * boomReach)
      .add(this.rig.gooseneck);

    const jibFoot = 3.05;
    const tack = this.jibShape.tack;
    const clewZ = tack.z - Math.cos(this.jibSigned) * jibFoot;
    // A high-cut clew keeps the jib foot clear of the coachroof.
    this.jibShape.clew.set(Math.sin(this.jibSigned) * jibFoot, Math.max(tack.y + 0.5, clewZ < 1.95 ? 1.74 : 1.2), clewZ);

    this.main.shape(this.mainShape, this.camberSigned, this.twistSigned, this.luffing, time, 0.32);
    this.jib.shape(this.jibShape, this.jibCamberSigned, this.twistSigned * 0.8, this.luffing, time + 0.37, 0.24);
  }

  dispose(): void {
    this.root.remove(this.main.mesh, this.jib.mesh);
    this.main.dispose();
    this.jib.dispose();
  }
}
