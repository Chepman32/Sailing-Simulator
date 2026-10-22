import * as THREE from "three";
import { damp } from "../math";
import {
  boomAngle,
  camberProfile,
  camberRatio,
  leechTwist,
  leewardSide,
  sailFill,
} from "./SailShape";

// Rig measurements in vessel-root space after Vessel normalizes the yacht GLB
// (9.4 m overall, bow toward +Z). They locate the mast, gooseneck and
// forestay of yacht-sailboat-pbr.glb; the boom itself is found by shape.
const GOOSENECK = new THREE.Vector3(0, 1.95, 1.72);
const MAIN_FOOT_HEIGHT = 0.12;
const MAIN_LUFF_LENGTH = 6.15;
const MAIN_HEAD_CHORD = 0.5;
const MAIN_ROACH = 0.42;
const JIB_TACK = new THREE.Vector3(0, 0.82, 4.3);
const JIB_HEAD = new THREE.Vector3(0, 5.84, 1.9);
const JIB_CLEW = new THREE.Vector3(0, 1.08, 2.08);
const SEGMENTS_CHORD = 18;
const SEGMENTS_HEIGHT = 16;
const SHAPE_INTERVAL = 1 / 30;

type ClothSail = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  positions: Float32Array;
};

function createCloth(name: string, material: THREE.MeshStandardMaterial): ClothSail {
  const columns = SEGMENTS_CHORD + 1;
  const rows = SEGMENTS_HEIGHT + 1;
  const positions = new Float32Array(columns * rows * 3);
  const uvs = new Float32Array(columns * rows * 2);
  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const vertex = row * columns + column;
      uvs[vertex * 2] = column / SEGMENTS_CHORD;
      uvs[vertex * 2 + 1] = row / SEGMENTS_HEIGHT;
      if (row < SEGMENTS_HEIGHT && column < SEGMENTS_CHORD) {
        const next = vertex + columns;
        indices.push(vertex, vertex + 1, next, vertex + 1, next + 1, next);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Vertices move every frame; bounds would go stale and cull the sail.
  mesh.frustumCulled = false;
  return { mesh, positions };
}

/**
 * Mainsail and jib as cloth surfaces whose belly, leech twist, sheeting
 * angle and luffing follow the apparent wind and trim. The GLB's single flat
 * sail mesh is hidden; its boom is re-parented to a gooseneck pivot so it
 * swings with the mainsail.
 */
export class SailSystem {
  private readonly material = new THREE.MeshStandardMaterial({
    name: "Dacron_Sailcloth",
    color: 0xf6f2e4,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  private readonly boomPivot = new THREE.Group();
  private readonly main: ClothSail;
  private readonly jib: ClothSail;
  private readonly baseBoomAngle: number;
  private readonly mainBoomLength: number;
  private readonly hiddenMeshes: THREE.Object3D[] = [];
  private readonly luff = new THREE.Vector3();
  private readonly leech = new THREE.Vector3();
  private readonly chord = new THREE.Vector3();
  private readonly belly = new THREE.Vector3();
  private readonly jibAxis = new THREE.Vector3();
  private readonly jibClew = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private side: 1 | -1 = 1;
  private angle = 0.3;
  private fill = 0;
  private camber = 0;
  private trim = 0.7;
  private shapeTimer = SHAPE_INTERVAL;

  constructor(root: THREE.Object3D, model: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const rootInverse = root.matrixWorld.clone().invert();
    let boom: THREE.Mesh | undefined;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const names = materials.map((material) => material.name.toLowerCase());
      if (object.name.toLowerCase().includes("sail") || names.some((name) => name.includes("cloth"))) {
        object.visible = false;
        this.hiddenMeshes.push(object);
        return;
      }
      // The boom is the long, thin, horizontal stainless spar at gooseneck height.
      if (!names.some((name) => name.includes("stainless"))) return;
      const bounds = new THREE.Box3().setFromObject(object).applyMatrix4(rootInverse);
      const size = bounds.getSize(new THREE.Vector3());
      if (size.y < 0.5 && Math.hypot(size.x, size.z) > 4 && Math.abs(bounds.min.y - GOOSENECK.y) < 0.4) boom = object;
    });

    this.boomPivot.name = "Boom_Gooseneck_Pivot";
    this.boomPivot.position.copy(GOOSENECK);
    root.add(this.boomPivot);
    let boomLength = 5.9;
    this.baseBoomAngle = 0.305;
    if (boom) {
      const bounds = new THREE.Box3().setFromObject(boom).applyMatrix4(rootInverse);
      const farX = Math.abs(bounds.max.x) > Math.abs(bounds.min.x) ? bounds.max.x : bounds.min.x;
      const aft = GOOSENECK.z - bounds.min.z;
      boomLength = Math.hypot(farX, aft);
      // Angle from dead aft toward +X (starboard) of the boom as modelled.
      this.baseBoomAngle = Math.atan2(farX, aft);
      this.boomPivot.updateMatrixWorld(true);
      this.boomPivot.attach(boom);
    }
    this.mainBoomLength = boomLength;

    this.main = createCloth("Procedural_Mainsail", this.material);
    this.jib = createCloth("Procedural_Jib", this.material);
    this.boomPivot.add(this.main.mesh);
    root.add(this.jib.mesh);
    this.reshape(0);
  }

  update(time: number, apparentWindAngle: number, apparentWindSpeed: number, trim: number, delta: number): void {
    const targetSide = leewardSide(apparentWindAngle);
    const targetAngle = boomAngle(apparentWindAngle, trim) * targetSide;
    // A gybe or tack swings the boom across smoothly rather than snapping.
    this.angle = damp(this.angle, targetAngle, 1.8, delta);
    this.side = this.angle >= 0 ? 1 : -1;
    this.fill = damp(this.fill, sailFill(apparentWindAngle, apparentWindSpeed, trim) * (Math.abs(this.angle) > 0.05 ? 1 : 0.2), 2.6, delta);
    this.trim = trim;
    this.camber = camberRatio(this.fill, trim);
    // Rotating about +Y by a positive angle swings an aft-pointing boom to
    // port, hence the negative sign to reach a starboard (positive) angle.
    this.boomPivot.rotation.y = -(this.angle - this.baseBoomAngle);
    this.shapeTimer += delta;
    if (this.shapeTimer >= SHAPE_INTERVAL) {
      this.shapeTimer = 0;
      this.reshape(time);
    }
  }

  dispose(): void {
    this.main.mesh.removeFromParent();
    this.jib.mesh.removeFromParent();
    this.main.mesh.geometry.dispose();
    this.jib.mesh.geometry.dispose();
    this.material.dispose();
    this.hiddenMeshes.forEach((mesh) => {
      mesh.visible = true;
    });
  }

  private reshape(time: number): void {
    this.shapeMain(time);
    this.shapeJib(time);
  }

  private shapeMain(time: number): void {
    // Pivot-local frame: the boom lies at baseBoomAngle from dead aft.
    const positions = this.main.positions;
    const luffing = 1 - this.fill;
    let offset = 0;
    for (let row = 0; row <= SEGMENTS_HEIGHT; row += 1) {
      const v = row / SEGMENTS_HEIGHT;
      const chordLength =
        THREE.MathUtils.lerp(this.mainBoomLength * 0.98, MAIN_HEAD_CHORD, v) + MAIN_ROACH * Math.sin(Math.PI * v) * (1 - v * 0.4);
      const sectionAngle = this.baseBoomAngle + this.side * leechTwist(v, this.trim);
      const directionX = Math.sin(sectionAngle);
      const directionZ = -Math.cos(sectionAngle);
      // Belly normal toward leeward, perpendicular to the section chord.
      const normalX = Math.cos(sectionAngle) * this.side;
      const normalZ = Math.sin(sectionAngle) * this.side;
      const depth = this.camber * chordLength * (0.8 + 0.3 * Math.sin(Math.PI * v));
      const y = MAIN_FOOT_HEIGHT + v * MAIN_LUFF_LENGTH;
      for (let column = 0; column <= SEGMENTS_CHORD; column += 1) {
        const u = column / SEGMENTS_CHORD;
        const ripple = luffing * 0.11 * Math.sin(time * 9.5 + v * 13 + u * 6) * u * (0.4 + v * 0.6);
        const out = depth * camberProfile(u) + ripple;
        positions[offset] = directionX * chordLength * u + normalX * out;
        positions[offset + 1] = y + (1 - v) * u * 0.05;
        positions[offset + 2] = -0.06 + directionZ * chordLength * u + normalZ * out;
        offset += 3;
      }
    }
    this.commit(this.main);
  }

  private shapeJib(time: number): void {
    // Vessel-root frame: the clew swings about the forestay toward leeward.
    const jibAngle = THREE.MathUtils.clamp(Math.abs(this.angle) * 0.8 + 0.06, 0.1, 1.05) * this.side;
    this.jibAxis.subVectors(JIB_HEAD, JIB_TACK).normalize();
    // The forestay axis leans aft, so a positive rotation about it carries the
    // clew to port; negate to send it to the leeward side.
    this.jibClew.subVectors(JIB_CLEW, JIB_TACK).applyAxisAngle(this.jibAxis, -jibAngle).add(JIB_TACK);
    this.belly.subVectors(this.jibClew, JIB_TACK).cross(this.jibAxis).normalize();
    if (this.belly.x * this.side < 0) this.belly.negate();
    const positions = this.jib.positions;
    const luffing = 1 - this.fill;
    let offset = 0;
    for (let row = 0; row <= SEGMENTS_HEIGHT; row += 1) {
      const v = row / SEGMENTS_HEIGHT;
      this.luff.lerpVectors(JIB_TACK, JIB_HEAD, v);
      this.leech.lerpVectors(this.jibClew, JIB_HEAD, v);
      this.chord.subVectors(this.leech, this.luff);
      const chordLength = this.chord.length();
      const depth = this.camber * 1.1 * chordLength * (1 - v * 0.25);
      for (let column = 0; column <= SEGMENTS_CHORD; column += 1) {
        const u = column / SEGMENTS_CHORD;
        const ripple = luffing * 0.07 * Math.sin(time * 11 + v * 15 + u * 7) * u;
        this.point.copy(this.luff).addScaledVector(this.chord, u).addScaledVector(this.belly, depth * camberProfile(u) + ripple);
        positions[offset] = this.point.x;
        positions[offset + 1] = this.point.y;
        positions[offset + 2] = this.point.z;
        offset += 3;
      }
    }
    this.commit(this.jib);
  }

  private commit(sail: ClothSail): void {
    sail.mesh.geometry.getAttribute("position").needsUpdate = true;
    sail.mesh.geometry.computeVertexNormals();
  }
}
