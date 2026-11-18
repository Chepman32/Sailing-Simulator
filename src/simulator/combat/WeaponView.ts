import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { patchMaterialShader, injectAfter } from "../core/ShaderPatch";
import type { WeaponId } from "./Firearms";

/**
 * The gun in the skipper's hands, as he sees it: the pistol and the
 * bolt-action rifle with both hands and forearms, drawn in front of the
 * first-person camera (on foot and at the helm).
 *
 * The models are built here (side profiles extruded with a bevel, lathed
 * barrels and scope, fingers as arcs wrapped round the grip), a few thousand
 * triangles each, merged by material: about ten draw calls for a gun and
 * both arms. Their depth is squeezed toward the near plane, so the gun is
 * never cut by a wall the skipper stands against, yet still hides itself
 * correctly. Nothing here casts a shadow or is mirrored in the sea.
 *
 * Motion is layered on a rest pose: raising and lowering, breathing, the
 * stride's bob, a lag behind a turning head, recoil on a damped spring, the
 * slide or the bolt, and the reload. `fire()` is the only event; everything
 * else follows from what `update` is told each frame.
 */

/** Depth squeeze: the gun's clip-space depth is mapped into the nearest part of the range. */
const DEPTH_SQUEEZE = 0.3;
const SHELLS = 8;
const RAISE_SECONDS = 0.28;
const FLASH_SECONDS = 0.05;
/** The rifle's bolt, worked after every shot (inside the gun's own interval). */
const BOLT_SECONDS = 0.4;

type V3 = readonly [number, number, number];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise, a few octaves, 0…1. */
function noiseField(size: number, octaves: number, base: number, seed: number): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const cells = base << octave;
    const lattice = new Float32Array(cells * cells);
    for (let index = 0; index < lattice.length; index += 1) lattice[index] = random();
    for (let y = 0; y < size; y += 1) {
      const v = (y / size) * cells;
      const y0 = Math.floor(v);
      const fy = v - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const y1 = (y0 + 1) % cells;
      for (let x = 0; x < size; x += 1) {
        const u = (x / size) * cells;
        const x0 = Math.floor(u);
        const fx = u - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const x1 = (x0 + 1) % cells;
        const a = lattice[y0 * cells + x0]!;
        const b = lattice[y0 * cells + x1]!;
        const c = lattice[y1 * cells + x0]!;
        const d = lattice[y1 * cells + x1]!;
        out[y * size + x]! += amplitude * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    total += amplitude;
    amplitude *= 0.5;
  }
  for (let index = 0; index < out.length; index += 1) out[index]! /= total;
  return out;
}

function dataTexture(data: Uint8Array, size: number, srgb: boolean, repeat: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function normalMap(height: Float32Array, size: number, strength: number, repeat: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const hx = height[y * size + ((x + 1) % size)]! - height[y * size + ((x + size - 1) % size)]!;
      const hy = height[((y + 1) % size) * size + x]! - height[((y + size - 1) % size) * size + x]!;
      const nx = -hx * strength;
      const ny = -hy * strength;
      const length = Math.hypot(nx, ny, 1);
      const at = (y * size + x) * 4;
      data[at] = Math.round(((nx / length) * 0.5 + 0.5) * 255);
      data[at + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255);
      data[at + 2] = Math.round((1 / length) * 0.5 * 255 + 127.5);
      data[at + 3] = 255;
    }
  }
  return dataTexture(data, size, false, repeat);
}

function greyTexture(field: Float32Array, size: number, low: number, high: number, repeat: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    const value = Math.round((low + (high - low) * field[index]!) * 255);
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  }
  return dataTexture(data, size, false, repeat);
}

/** A star of flame seen end-on and from the side, for the muzzle flash. */
function flashTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const random = seeded(77);
  const spikes = Array.from({ length: 9 }, (_, index) => ({ angle: (index / 9) * Math.PI * 2 + random() * 0.5, reach: 0.55 + random() * 0.45, width: 0.1 + random() * 0.12 }));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = (x / size) * 2 - 1;
      const py = (y / size) * 2 - 1;
      const radius = Math.hypot(px, py);
      const angle = Math.atan2(py, px);
      let value = Math.exp(-radius * radius * 9) * 1.4;
      for (const spike of spikes) {
        let off = Math.abs(angle - spike.angle);
        if (off > Math.PI) off = Math.PI * 2 - off;
        const across = Math.exp(-(off * off) / (spike.width * spike.width * (0.25 + radius)));
        value += across * Math.max(0, 1 - radius / spike.reach) * 0.9;
      }
      value = Math.min(1, value) * Math.max(0, 1 - radius * radius * radius);
      const at = (y * size + x) * 4;
      data[at] = 255;
      data[at + 1] = Math.round(255 * Math.min(1, 0.45 + value * 0.6));
      data[at + 2] = Math.round(255 * Math.min(1, 0.12 + value * value * 0.75));
      data[at + 3] = Math.round(255 * value);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Geometry gathered by material and merged into one mesh each. */
class Parts {
  private readonly lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  add(material: THREE.Material, geometry: THREE.BufferGeometry): this {
    const plain = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(plain.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") plain.deleteAttribute(name);
    let list = this.lists.get(material);
    if (!list) this.lists.set(material, (list = []));
    list.push(plain);
    return this;
  }

  place(geometry: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
    this.euler.set(rx, ry, rz, "YXZ");
    geometry.applyMatrix4(this.matrix.compose(this.position.set(x, y, z), this.quaternion.setFromEuler(this.euler), this.one));
    return geometry;
  }

  box(material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    return this.add(material, this.place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz));
  }

  /** A cylinder (or cone) along the view's depth: `front` radius at `zFront`, `back` radius at `zBack`. */
  tube(material: THREE.Material, front: number, back: number, zFront: number, zBack: number, x: number, y: number, segments = 20, open = false): this {
    const geometry = new THREE.CylinderGeometry(front, back, Math.abs(zBack - zFront), segments, 1, open);
    geometry.rotateX(-Math.PI / 2);
    return this.add(material, this.place(geometry, x, y, (zFront + zBack) / 2));
  }

  /** A rod with round ends between two points. */
  rod(material: THREE.Material, from: V3, to: V3, radius: number): this {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const length = a.distanceTo(b);
    const geometry = new THREE.CapsuleGeometry(radius, length, 4, 10);
    const direction = b.clone().sub(a).normalize();
    this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    geometry.applyMatrix4(this.matrix.compose(a.add(b).multiplyScalar(0.5), this.quaternion, this.one));
    return this.add(material, geometry);
  }

  /** A tapered limb between two points (no caps needed: its ends are hidden). */
  limb(material: THREE.Material, from: V3, to: V3, radiusFrom: number, radiusTo: number): this {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const geometry = new THREE.CylinderGeometry(radiusTo, radiusFrom, a.distanceTo(b), 18, 1, false);
    const direction = b.clone().sub(a).normalize();
    this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    geometry.applyMatrix4(this.matrix.compose(a.add(b).multiplyScalar(0.5), this.quaternion, this.one));
    return this.add(material, geometry);
  }

  /**
   * A finger wrapped round something: an arc of `arc` radians about `axis`
   * through `centre`, starting on the `start` side and bending forward first.
   */
  finger(material: THREE.Material, centre: V3, axis: V3, start: V3, radius: number, thickness: number, arc: number): this {
    const a = new THREE.Vector3(...axis).normalize();
    const s = new THREE.Vector3(...start);
    s.addScaledVector(a, -s.dot(a)).normalize();
    const t = new THREE.Vector3().crossVectors(a, s);
    if (t.z > 0) t.negate();
    const n = new THREE.Vector3().crossVectors(s, t);
    const geometry = new THREE.TorusGeometry(radius, thickness, 8, 14, arc);
    geometry.applyMatrix4(this.matrix.makeBasis(s, t, n).setPosition(centre[0], centre[1], centre[2]));
    // Round fingertips.
    const tip = new THREE.SphereGeometry(thickness, 10, 8);
    const end = new THREE.Vector3(...centre).addScaledVector(s, Math.cos(arc) * radius).addScaledVector(t, Math.sin(arc) * radius);
    tip.translate(end.x, end.y, end.z);
    return this.add(material, geometry).add(material, tip);
  }

  /** A side profile (`[forward, up]` pairs, metres) extruded across the gun's width with rounded edges. */
  profile(material: THREE.Material, outline: readonly (readonly [number, number])[], width: number, bevel: number, x = 0, hole?: readonly (readonly [number, number])[]): this {
    const shape = new THREE.Shape(outline.map(([f, u]) => new THREE.Vector2(f, u)));
    if (hole) shape.holes.push(new THREE.Path(hole.map(([f, u]) => new THREE.Vector2(f, u))));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.0005, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 3, curveSegments: 6 });
    geometry.translate(0, 0, -(width - bevel * 2) / 2);
    // Profile forward (+x) becomes the view's −z; its thickness lies across.
    geometry.rotateY(Math.PI / 2);
    geometry.translate(x, 0, 0);
    return this.add(material, geometry);
  }

  build(parent: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [material, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      for (const geometry of list) geometry.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.lists.clear();
    return meshes;
  }
}

type Materials = ReturnType<typeof createMaterials>;

function createMaterials() {
  const fine = noiseField(128, 4, 16, 11);
  const coarse = noiseField(128, 5, 4, 23);
  const scratch = new Float32Array(128 * 128);
  const random = seeded(5);
  for (let index = 0; index < scratch.length; index += 1) scratch[index] = 0.5 + (fine[index]! - 0.5) * 0.5;
  for (let line = 0; line < 90; line += 1) {
    const y = Math.floor(random() * 128);
    const x0 = Math.floor(random() * 128);
    const length = 8 + Math.floor(random() * 50);
    const depth = 0.25 + random() * 0.4;
    for (let step = 0; step < length; step += 1) scratch[y * 128 + ((x0 + step) % 128)] = depth;
  }
  const stipple = new Float32Array(128 * 128);
  for (let y = 0; y < 128; y += 1) for (let x = 0; x < 128; x += 1) stipple[y * 128 + x] = 0.5 + 0.5 * Math.sin(x * 0.785) * Math.sin(y * 0.785) * (0.7 + 0.3 * fine[y * 128 + x]!);
  const weave = new Float32Array(64 * 64);
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) weave[y * 64 + x] = 0.5 + 0.25 * Math.sin(x * 1.5708) + 0.25 * Math.sin(y * 1.5708 + (x % 8 < 4 ? 0 : 1.57));
  // Walnut: long streaks of grain with darker figure.
  const woodSize = 256;
  const grain = noiseField(woodSize, 5, 4, 41);
  const wood = new Uint8Array(woodSize * woodSize * 4);
  const woodHeight = new Float32Array(woodSize * woodSize);
  for (let y = 0; y < woodSize; y += 1) {
    for (let x = 0; x < woodSize; x += 1) {
      // Stretch the noise along the grain (x) by sampling it squeezed across.
      const warp = grain[((y * 6) % woodSize) * woodSize + ((x >> 2) % woodSize)]!;
      const rings = 0.5 + 0.5 * Math.sin((y / woodSize) * 60 + warp * 9);
      const tone = 0.35 + 0.4 * warp + 0.25 * rings;
      const at = (y * woodSize + x) * 4;
      wood[at] = Math.round(92 + tone * 76);
      wood[at + 1] = Math.round(48 + tone * 46);
      wood[at + 2] = Math.round(22 + tone * 24);
      wood[at + 3] = 255;
      woodHeight[y * woodSize + x] = rings * 0.6 + warp * 0.4;
    }
  }
  const steelRough = greyTexture(scratch, 128, 0.55, 1, 14);
  const steelNormal = normalMap(scratch, 128, 1.4, 14);
  const standard = (parameters: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(parameters);
  const basic = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
  return {
    steel: standard({ color: 0x23262a, metalness: 0.88, roughness: 0.5, roughnessMap: steelRough, normalMap: steelNormal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.1 }),
    bright: standard({ color: 0xa4a9ae, metalness: 1, roughness: 0.34, roughnessMap: steelRough, envMapIntensity: 1.2 }),
    polymer: standard({ color: 0x17191c, metalness: 0.05, roughness: 0.72, normalMap: normalMap(coarse, 128, 1.2, 10), normalScale: new THREE.Vector2(0.4, 0.4) }),
    grip: standard({ color: 0x121416, metalness: 0.02, roughness: 0.86, normalMap: normalMap(stipple, 128, 2.6, 22), normalScale: new THREE.Vector2(0.9, 0.9) }),
    dark: standard({ color: 0x040405, metalness: 0.3, roughness: 0.9 }),
    wood: standard({ map: dataTexture(wood, woodSize, true, 2.2), metalness: 0, roughness: 0.48, normalMap: normalMap(woodHeight, woodSize, 1.1, 2.2), normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.8 }),
    glove: standard({ color: 0x1b1d21, metalness: 0, roughness: 0.82, normalMap: normalMap(fine, 128, 2.2, 9), normalScale: new THREE.Vector2(0.7, 0.7) }),
    pad: standard({ color: 0x8b6b46, metalness: 0, roughness: 0.7, normalMap: normalMap(coarse, 128, 1.6, 6), normalScale: new THREE.Vector2(0.6, 0.6) }),
    sleeve: standard({ color: 0x3b4a40, metalness: 0, roughness: 0.94, normalMap: normalMap(weave, 64, 2.4, 26), normalScale: new THREE.Vector2(0.8, 0.8) }),
    brass: standard({ color: 0xd4a243, metalness: 1, roughness: 0.3 }),
    glass: standard({ color: 0x0a1830, metalness: 0.9, roughness: 0.05, envMapIntensity: 2.4 }),
    dot: basic(0.5, 2.4, 0.7),
    flash: new THREE.MeshBasicMaterial({ map: flashTexture(), color: new THREE.Color(6, 4.4, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false }),
  };
}

type Rest = { position: V3; rotation: V3 };

type Model = {
  group: THREE.Group;
  /** Where the round leaves, in the gun's frame. */
  muzzle: THREE.Object3D;
  /** Where the spent case leaves. */
  port: THREE.Object3D;
  /** The slide (pistol) or the bolt (rifle). */
  action: THREE.Group;
  magazine: THREE.Group | null;
  rightHand: THREE.Group;
  leftHand: THREE.Group;
  rest: Rest;
  /** The gun built here, hidden once an authored model takes its place. */
  builtGun: THREE.Object3D[];
  /** The authored model's clips, when it has taken the built gun's place. */
  mixer?: THREE.AnimationMixer;
  shoot?: THREE.AnimationAction;
  reload?: THREE.AnimationAction;
  authored?: boolean;
};

/** A hand's palm, back plate and wrist cuff (the fingers are added by the caller). */
function palm(parts: Parts, m: Materials, centre: V3, size: V3, tilt: V3, wrist: V3, elbow: V3): void {
  const geometry = new THREE.SphereGeometry(0.5, 16, 12);
  geometry.scale(size[0], size[1], size[2]);
  parts.add(m.glove, parts.place(geometry, centre[0], centre[1], centre[2], tilt[0], tilt[1], tilt[2]));
  // The forearm: a glove cuff, then the sleeve running out of the view.
  const cuff: V3 = [wrist[0] + (elbow[0] - wrist[0]) * 0.2, wrist[1] + (elbow[1] - wrist[1]) * 0.2, wrist[2] + (elbow[2] - wrist[2]) * 0.2];
  parts.limb(m.glove, centre, cuff, 0.031, 0.034);
  parts.limb(m.sleeve, cuff, elbow, 0.039, 0.05);
  parts.limb(m.sleeve, [cuff[0] + (wrist[0] - cuff[0]) * 0.12, cuff[1] + (wrist[1] - cuff[1]) * 0.12, cuff[2] + (wrist[2] - cuff[2]) * 0.12], cuff, 0.04, 0.041);
}

function buildPistol(m: Materials): Model {
  const group = new THREE.Group();
  group.name = "ViewPistol";
  const frame = new Parts();
  const BORE = 0.028;
  // Frame with the trigger guard cut through it, and the stippled grip over it.
  frame.profile(m.polymer, [[0.16, 0.01], [0.16, -0.006], [0.084, -0.008], [0.078, -0.014], [0.083, -0.04], [0.072, -0.05], [0.03, -0.05], [0.026, -0.044], [0.014, -0.108], [-0.04, -0.118], [-0.027, -0.03], [-0.037, -0.004], [-0.022, 0.01]], 0.0245, 0.003, 0,
    [[0.071, -0.018], [0.074, -0.037], [0.065, -0.043], [0.037, -0.043], [0.033, -0.018]]);
  frame.profile(m.grip, [[0.021, -0.022], [0.0105, -0.099], [-0.033, -0.107], [-0.0225, -0.03]], 0.0292, 0.0035);
  frame.box(m.steel, 0.005, 0.02, 0.007, 0, -0.028, -0.052, 0.35);
  // Barrel, bore and guide rod showing at the front.
  frame.tube(m.bright, 0.0064, 0.0064, -0.172, -0.14, 0, BORE, 16);
  frame.tube(m.dark, 0.0042, 0.0042, -0.1725, -0.17, 0, BORE, 12);
  frame.tube(m.steel, 0.0036, 0.0036, -0.167, -0.15, 0, 0.0165, 10);
  // Controls on the near (left) side: slide stop, take-down lever, magazine release; a rail under the dust cover.
  frame.box(m.steel, 0.003, 0.005, 0.03, -0.0128, 0.006, -0.03).box(m.steel, 0.003, 0.006, 0.012, -0.0128, 0.002, -0.075).tube(m.steel, 0.004, 0.004, -0.004, 0, 0, 0);
  frame.box(m.steel, 0.004, 0.007, 0.007, -0.0125, -0.02, -0.03);
  for (let slot = 0; slot < 3; slot += 1) frame.box(m.dark, 0.0252, 0.003, 0.004, 0, -0.0055, -0.1 - slot * 0.016);
  const builtGun: THREE.Object3D[] = frame.build(group);

  const action = new THREE.Group();
  const slide = new Parts();
  slide.profile(m.steel, [[-0.02, 0.0105], [0.165, 0.0105], [0.165, 0.031], [0.157, 0.0405], [-0.013, 0.0405], [-0.02, 0.034]], 0.026, 0.0028);
  // Ejection port, cocking serrations, sights with their dots.
  slide.box(m.dark, 0.0135, 0.008, 0.034, 0.0068, 0.0372, -0.088);
  for (let cut = 0; cut < 7; cut += 1) slide.box(m.dark, 0.0266, 0.021, 0.0016, 0, 0.0255, 0.014 - cut * 0.0046);
  slide.box(m.steel, 0.0032, 0.0055, 0.007, 0, 0.0428, -0.154);
  slide.box(m.steel, 0.006, 0.0055, 0.007, 0.0068, 0.0428, 0.01).box(m.steel, 0.006, 0.0055, 0.007, -0.0068, 0.0428, 0.01);
  slide.box(m.dot, 0.0016, 0.0016, 0.0005, 0, 0.0436, -0.1503).box(m.dot, 0.0016, 0.0016, 0.0005, 0.0068, 0.0436, 0.0137).box(m.dot, 0.0016, 0.0016, 0.0005, -0.0068, 0.0436, 0.0137);
  slide.box(m.dark, 0.012, 0.012, 0.002, 0, 0.026, 0.0195);
  slide.build(action);
  group.add(action);
  builtGun.push(action);

  const magazine = new THREE.Group();
  const mag = new Parts();
  mag.box(m.steel, 0.0205, 0.1, 0.03, 0, -0.065, 0.012, -0.2);
  mag.box(m.polymer, 0.026, 0.009, 0.05, 0, -0.1165, 0.014, -0.17);
  mag.build(magazine);
  group.add(magazine);
  builtGun.push(magazine);

  // Right hand: palm on the far side and the backstrap, three fingers round
  // the front, the index on the trigger, the thumb along the near side.
  const rightHand = new THREE.Group();
  const right = new Parts();
  const axis: V3 = [0, 0.98, -0.2];
  palm(right, m, [0.02, -0.058, 0.014], [0.034, 0.092, 0.07], [-0.2, 0, 0.1], [0.045, -0.12, 0.07], [0.2, -0.36, 0.42]);
  right.add(m.glove, right.place(new THREE.SphereGeometry(0.021, 14, 10), 0.004, -0.014, 0.043));
  for (let index = 0; index < 3; index += 1) {
    const down = -0.036 - index * 0.0215;
    right.finger(m.glove, [0, down, 0.004 - (down + 0.036) * 0.2], axis, [1, 0, 0], 0.0235 - index * 0.001, 0.0098 - index * 0.0007, 3.7);
  }
  right.rod(m.glove, [0.016, -0.016, 0.0], [0.011, -0.022, -0.04], 0.0088).rod(m.glove, [0.011, -0.022, -0.04], [0.001, -0.03, -0.056], 0.0082);
  right.rod(m.glove, [-0.004, -0.006, 0.04], [-0.0165, 0.0, 0.0], 0.0098).rod(m.glove, [-0.0165, 0.0, 0.0], [-0.017, 0.003, -0.036], 0.009);
  right.box(m.pad, 0.012, 0.05, 0.05, 0.036, -0.05, 0.02, -0.2, 0, 0.1);
  right.build(rightHand);
  group.add(rightHand);

  // Left hand: wrapped over the right's fingers from the near side, thumb forward under the slide.
  const leftHand = new THREE.Group();
  const left = new Parts();
  palm(left, m, [-0.03, -0.066, 0.006], [0.034, 0.09, 0.074], [-0.2, 0, -0.25], [-0.06, -0.125, 0.06], [-0.26, -0.36, 0.36]);
  for (let index = 0; index < 4; index += 1) {
    const down = -0.034 - index * 0.02;
    left.finger(m.glove, [0.002, down, 0.002 - (down + 0.034) * 0.2], axis, [-1, 0, 0], 0.0345 - index * 0.001, 0.0098 - index * 0.0006, 3.3);
  }
  left.rod(m.glove, [-0.03, -0.03, 0.02], [-0.024, -0.008, -0.03], 0.0102).rod(m.glove, [-0.024, -0.008, -0.03], [-0.019, -0.004, -0.07], 0.0092);
  left.box(m.pad, 0.012, 0.046, 0.05, -0.047, -0.062, 0.01, -0.2, 0, -0.25);
  // A watch on the wrist.
  left.add(m.steel, left.place(new THREE.CylinderGeometry(0.019, 0.019, 0.009, 20), -0.098, -0.142, 0.105, 0.5, 0, 1.0));
  left.add(m.glass, left.place(new THREE.CylinderGeometry(0.016, 0.016, 0.0095, 20), -0.0984, -0.1417, 0.105, 0.5, 0, 1.0));
  left.add(m.polymer, left.place(new THREE.TorusGeometry(0.036, 0.0075, 6, 22), -0.075, -0.153, 0.105, 0.72, 0.62, 0));
  left.build(leftHand);
  group.add(leftHand);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BORE, -0.176);
  const port = new THREE.Object3D();
  port.position.set(0.012, 0.04, -0.088);
  group.add(muzzle, port);
  return { group, muzzle, port, action, magazine, rightHand, leftHand, builtGun, rest: { position: [0.088, -0.118, -0.4], rotation: [0.01, 0.035, 0] } };
}

function buildRifle(m: Materials): Model {
  const group = new THREE.Group();
  group.name = "ViewRifle";
  const BORE = 0.045;
  const SCOPE = BORE + 0.044;
  const body = new Parts();
  // Walnut stock in one piece: butt, comb, wrist, grip, fore-end.
  body.profile(m.wood, [[-0.36, 0.036], [-0.366, -0.084], [-0.33, -0.09], [-0.105, -0.036], [-0.06, -0.078], [-0.022, -0.08], [-0.006, -0.032], [0.1, -0.024], [0.42, -0.005], [0.44, 0.011], [0.44, 0.029], [-0.06, 0.029], [-0.1, 0.022], [-0.2, 0.03], [-0.262, 0.046], [-0.34, 0.043]], 0.046, 0.011);
  body.box(m.polymer, 0.04, 0.118, 0.014, 0, -0.024, 0.37, 0.05);
  body.box(m.dark, 0.048, 0.006, 0.05, 0, -0.0765, 0.04, -0.02);
  // Barrel, receiver, floor plate, trigger and its guard.
  body.tube(m.steel, 0.0085, 0.0135, -0.7, -0.1, 0, BORE, 20).tube(m.dark, 0.0045, 0.0045, -0.7005, -0.69, 0, BORE, 12).tube(m.steel, 0.0095, 0.0095, -0.7, -0.692, 0, BORE, 20);
  body.tube(m.steel, 0.0168, 0.0168, -0.11, 0.09, 0, BORE, 24);
  body.box(m.dark, 0.016, 0.012, 0.07, 0.0085, BORE + 0.008, -0.025);
  body.box(m.steel, 0.026, 0.004, 0.09, 0, -0.0255, -0.055);
  body.profile(m.steel, [[-0.03, -0.028], [0.045, -0.028], [0.052, -0.036], [0.04, -0.062], [-0.004, -0.064], [-0.03, -0.046]], 0.013, 0.0015, 0, [[-0.022, -0.031], [0.04, -0.031], [0.044, -0.037], [0.035, -0.057], [-0.002, -0.059], [-0.022, -0.044]]);
  body.box(m.bright, 0.004, 0.022, 0.006, 0, -0.04, -0.008, 0.3);
  // The scope: tube, objective and ocular bells, turrets, rings, lenses.
  body.tube(m.steel, 0.0127, 0.0127, -0.2, 0.12, 0, SCOPE, 22).tube(m.steel, 0.0215, 0.0127, -0.24, -0.2, 0, SCOPE, 22).tube(m.steel, 0.0215, 0.0215, -0.3, -0.24, 0, SCOPE, 22);
  body.tube(m.steel, 0.0127, 0.0185, 0.12, 0.14, 0, SCOPE, 22).tube(m.steel, 0.0185, 0.0185, 0.14, 0.19, 0, SCOPE, 22).tube(m.polymer, 0.0198, 0.0198, 0.186, 0.2, 0, SCOPE, 22);
  body.tube(m.glass, 0.0188, 0.0188, -0.297, -0.294, 0, SCOPE, 22).tube(m.glass, 0.0165, 0.0165, 0.193, 0.196, 0, SCOPE, 22);
  body.box(m.steel, 0.03, 0.03, 0.032, 0, SCOPE, -0.04);
  body.add(m.steel, body.place(new THREE.CylinderGeometry(0.0105, 0.0105, 0.02, 18), 0, SCOPE + 0.024, -0.04));
  body.add(m.steel, body.place(new THREE.CylinderGeometry(0.0105, 0.0105, 0.02, 18), 0.024, SCOPE, -0.04, 0, 0, Math.PI / 2));
  for (const z of [0.03, -0.11]) {
    body.tube(m.polymer, 0.0162, 0.0162, z - 0.009, z + 0.009, 0, SCOPE, 20);
    body.box(m.polymer, 0.018, 0.024, 0.018, 0, SCOPE - 0.024, z);
  }
  const builtGun: THREE.Object3D[] = body.build(group);

  // The bolt: body, shroud, handle and knob, turning about the bore.
  const action = new THREE.Group();
  action.position.set(0, BORE, 0);
  const bolt = new Parts();
  bolt.tube(m.bright, 0.0092, 0.0092, -0.06, 0.1, 0, 0, 16);
  bolt.tube(m.steel, 0.0125, 0.0105, 0.09, 0.125, 0, 0, 18);
  bolt.rod(m.bright, [0.012, -0.002, 0.07], [0.05, -0.03, 0.074], 0.0052);
  bolt.add(m.bright, bolt.place(new THREE.SphereGeometry(0.0115, 14, 10), 0.056, -0.035, 0.075));
  bolt.build(action);
  group.add(action);
  builtGun.push(action);

  // Right hand round the wrist of the stock, index on the trigger, thumb over the top.
  const rightHand = new THREE.Group();
  const right = new Parts();
  const wristAxis: V3 = [0, 0.72, -0.69];
  palm(right, m, [0.028, -0.036, 0.062], [0.036, 0.09, 0.074], [-0.75, 0, 0.12], [0.06, -0.09, 0.13], [0.22, -0.32, 0.5]);
  for (let index = 0; index < 3; index += 1) {
    const along = index * 0.021;
    right.finger(m.glove, [0, -0.04 - along * 0.72, 0.03 + along * 0.69], wristAxis, [1, 0, 0], 0.03 - index * 0.001, 0.0098 - index * 0.0007, 3.5);
  }
  right.rod(m.glove, [0.024, -0.014, 0.05], [0.014, -0.03, 0.012], 0.0088).rod(m.glove, [0.014, -0.03, 0.012], [0.002, -0.042, -0.006], 0.0082);
  right.rod(m.glove, [0.016, 0.014, 0.085], [-0.012, 0.028, 0.068], 0.0098).rod(m.glove, [-0.012, 0.028, 0.068], [-0.024, 0.014, 0.05], 0.009);
  right.box(m.pad, 0.012, 0.05, 0.05, 0.046, -0.03, 0.066, -0.75, 0, 0.12);
  right.build(rightHand);
  group.add(rightHand);

  // Left hand under the fore-end: fingers up the far side, thumb along the near side.
  const leftHand = new THREE.Group();
  const left = new Parts();
  palm(left, m, [-0.006, -0.032, -0.25], [0.07, 0.036, 0.094], [0, 0, 0.1], [-0.05, -0.07, -0.19], [-0.3, -0.3, 0.2]);
  for (let index = 0; index < 4; index += 1) {
    left.finger(m.glove, [0, 0.008, -0.214 - index * 0.021], [0, 0, -1], [0, -1, 0], 0.031, 0.0098 - index * 0.0005, 2.5);
  }
  left.rod(m.glove, [-0.03, -0.02, -0.22], [-0.03, 0.012, -0.25], 0.0102).rod(m.glove, [-0.03, 0.012, -0.25], [-0.027, 0.02, -0.29], 0.0092);
  left.add(m.steel, left.place(new THREE.CylinderGeometry(0.019, 0.019, 0.009, 20), -0.106, -0.092, -0.1, 0.2, 0, 1.1));
  left.add(m.glass, left.place(new THREE.CylinderGeometry(0.016, 0.016, 0.0095, 20), -0.1064, -0.0917, -0.1, 0.2, 0, 1.1));
  left.build(leftHand);
  group.add(leftHand);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BORE, -0.705);
  const port = new THREE.Object3D();
  port.position.set(0.02, BORE + 0.012, -0.02);
  group.add(muzzle, port);
  return { group, muzzle, port, action, magazine: null, rightHand, leftHand, builtGun, rest: { position: [0.108, -0.158, -0.2], rotation: [0.0, 0.05, 0] } };
}

const ramp = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** An authored gun: its scene and clips (as the asset manager hands them out). */
export type ViewAsset = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };

/** How long the look over a gun just handed over lasts, s (`WeaponView.inspect`). */
export const INSPECT_SECONDS = 3.4;

/** How the authored pistol sits in the hand built here. */
const PISTOL_FIT = { scale: 0.058, x: 0, y: 0.008, z: -0.036 };
/** Where the authored rifle's muzzle and ejection port are, in the eye's frame, m. */
const RIFLE_FIT = { muzzle: [0.052, -0.052, -0.83] as V3, port: [0.105, -0.085, -0.3] as V3 };

/** What `WeaponView.update` is told each frame. */
export type WeaponViewInput = {
  /** The gun in his hands (null: holstered). */
  weapon: WeaponId | null;
  /** Whether the view is his own eyes (on foot, at the helm) and not a cut scene. */
  firstPerson: boolean;
  /** His speed over the ground, m/s. */
  speed: number;
  crouched: boolean;
  ammo: number;
  /** Reload progress 0…1 (1: not reloading). */
  reload: number;
  /** The ground (or deck) under him, for spent cases. */
  floor: number;
};

type Shell = { life: number; position: THREE.Vector3; velocity: THREE.Vector3; spin: THREE.Vector3; rotation: THREE.Euler; floor: number };

export class WeaponView {
  readonly root = new THREE.Group();
  private readonly rig = new THREE.Group();
  private readonly materials = createMaterials();
  private readonly models: Record<WeaponId, Model>;
  private readonly flash = new THREE.Group();
  private readonly shells: THREE.InstancedMesh;
  private readonly shellPool: Shell[] = Array.from({ length: SHELLS }, () => ({ life: 0, position: new THREE.Vector3(0, -500, 0), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), rotation: new THREE.Euler(), floor: 0 }));
  private shellNext = 0;
  private shown: WeaponId | null = null;
  private raise = 0;
  /** Seconds into a look over a gun just handed over (`inspect`); negative when not looking. */
  private inspectClock = -1;
  private flashClock = 0;
  private kick = 0;
  private kickSpeed = 0;
  private flip = 0;
  private flipSpeed = 0;
  private slide = 0;
  private bolt = 1;
  private boltEjected = true;
  private stride = 0;
  private breath = 0;
  private swayX = 0;
  private swayY = 0;
  private moving = 0;
  private floor = 0;
  private prewarm = false;
  /** Materials of adopted models (theirs to keep: the asset manager disposes them). */
  private readonly adopted: THREE.Material[] = [];
  private readonly lastQuaternion = new THREE.Quaternion();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchVector = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchEuler = new THREE.Euler();

  constructor(scene: THREE.Scene) {
    this.root.name = "WeaponView";
    this.root.matrixAutoUpdate = false;
    this.rig.rotation.order = "YXZ";
    this.root.add(this.rig);
    this.models = { pistol: buildPistol(this.materials), rifle: buildRifle(this.materials) };
    for (const model of Object.values(this.models)) {
      model.group.rotation.order = "YXZ";
      model.group.visible = false;
      this.rig.add(model.group);
    }
    // The flash: one star facing the eye, two along the barrel.
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), this.materials.flash);
    this.flash.add(face);
    for (const roll of [0.5, -0.65]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), this.materials.flash);
      side.rotation.y = Math.PI / 2;
      side.position.z = -0.1;
      const turn = new THREE.Group();
      turn.rotation.z = roll;
      turn.add(side);
      this.flash.add(turn);
    }
    this.flash.traverse((object) => {
      object.frustumCulled = false;
      if (object instanceof THREE.Mesh) object.renderOrder = 6;
    });
    this.flash.visible = false;
    this.rig.add(this.flash);
    // Everything drawn in his hands sits in the nearest slice of the depth range.
    for (const material of Object.values(this.materials)) this.squeeze(material);
    // Spent cases fall in the world, not in the hands.
    const shellGeometry = new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 8);
    this.shells = new THREE.InstancedMesh(shellGeometry, new THREE.MeshStandardMaterial({ color: 0xd4a243, metalness: 1, roughness: 0.3 }), SHELLS);
    this.shells.name = "SpentCases";
    this.shells.frustumCulled = false;
    this.shells.castShadow = false;
    this.shells.count = SHELLS;
    this.writeShells();
    scene.add(this.root, this.shells);
  }

  /**
   * Authored gun models in place of the ones built here (each optional; a
   * gun without one keeps its built model):
   * - `pistol`: a service pistol lying along −X (muzzle), 3.3 units long,
   *   with a `shoot` clip that works its slide and throws its case;
   * - `rifle`: a first-person rifle authored about its own camera bone at
   *   the origin (inches, +Z ahead), with a `Reload` clip.
   * The hands built here are moved to where each is held.
   */
  setModels(assets: { pistol?: ViewAsset | null; rifle?: ViewAsset | null }): void {
    const adopt = (model: Model, asset: ViewAsset, holder: THREE.Group) => {
      for (const part of model.builtGun) part.visible = false;
      holder.add(asset.scene);
      model.group.add(holder);
      model.authored = true;
      model.mixer = new THREE.AnimationMixer(asset.scene);
      asset.scene.traverse((object) => {
        object.frustumCulled = false;
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = false;
        object.receiveShadow = false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials as THREE.Material[]) {
          if (/arms|parallax/i.test(material.name)) object.visible = false;
          this.squeeze(material);
          this.adopted.push(material);
        }
      });
    };
    if (assets.pistol && !this.models.pistol.authored) {
      const model = this.models.pistol;
      const holder = new THREE.Group();
      holder.scale.setScalar(PISTOL_FIT.scale);
      holder.rotation.y = -Math.PI / 2;
      holder.position.set(PISTOL_FIT.x, PISTOL_FIT.y, PISTOL_FIT.z);
      adopt(model, assets.pistol, holder);
      const clip = assets.pistol.animations.find((candidate) => /shoot/i.test(candidate.name));
      if (clip && model.mixer) {
        model.shoot = model.mixer.clipAction(clip);
        model.shoot.setLoop(THREE.LoopOnce, 1);
        model.shoot.clampWhenFinished = true;
      }
      // Both hands on it, the left wrapped over the right's fingers.
      model.muzzle.position.set(0, 0.028, -0.136);
      model.port.position.set(0.012, 0.036, -0.03);
      model.rest = { position: [0.1, -0.112, -0.31], rotation: [0.02, 0.06, -0.04] };
    }
    if (assets.rifle && !this.models.rifle.authored) {
      const model = this.models.rifle;
      const holder = new THREE.Group();
      holder.scale.setScalar(0.0254);
      holder.rotation.y = Math.PI;
      adopt(model, assets.rifle, holder);
      const clip = assets.rifle.animations.find((candidate) => /reload/i.test(candidate.name));
      if (clip && model.mixer) {
        model.reload = model.mixer.clipAction(clip);
        model.reload.play();
        model.reload.paused = true;
        model.mixer.setTime(0);
      }
      model.rest = { position: [0, 0, 0], rotation: [0, 0, 0] };
      // The hands go where the rig holds her: grip and fore-end.
      for (const hand of [model.rightHand, model.leftHand]) {
        for (const child of [...hand.children]) {
          hand.remove(child);
          if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
        }
      }
      const m = this.materials;
      const right = new Parts();
      palm(right, m, [0.118, -0.156, -0.1], [0.05, 0.085, 0.075], [-0.3, 0.2, 0.1], [0.15, -0.21, -0.03], [0.34, -0.5, 0.3]);
      right.build(model.rightHand);
      const left = new Parts();
      palm(left, m, [0.058, -0.112, -0.43], [0.072, 0.04, 0.095], [0.1, 0.15, 0.2], [0.02, -0.15, -0.37], [-0.24, -0.46, -0.02]);
      for (let index = 0; index < 4; index += 1) left.finger(m.glove, [0.066 - index * 0.003, -0.085 + index * 0.002, -0.4 - index * 0.021], [-0.14, 0.15, -0.98], [0, -1, 0], 0.03, 0.0096, 2.4);
      left.build(model.leftHand);
      model.muzzle.position.set(RIFLE_FIT.muzzle[0], RIFLE_FIT.muzzle[1], RIFLE_FIT.muzzle[2]);
      model.port.position.set(RIFLE_FIT.port[0], RIFLE_FIT.port[1], RIFLE_FIT.port[2]);
    }
  }

  private squeeze(material: THREE.Material): void {
    patchMaterialShader(material, "weapon-view-depth", (shader) => {
      shader.vertexShader = injectAfter(shader.vertexShader, "project_vertex", `gl_Position.z = (-1.0 + (gl_Position.z / gl_Position.w + 1.0) * ${DEPTH_SQUEEZE.toFixed(2)}) * gl_Position.w;`);
    });
  }

  /** Whether a gun is on screen now. */
  get visible(): boolean {
    return this.shown !== null && this.raise > 0.02 && this.root.visible;
  }

  /** Triangles of one gun with both arms (for the budget test). */
  triangles(weapon: WeaponId): number {
    let count = 0;
    this.models[weapon].group.traverse((object) => {
      if (object instanceof THREE.Mesh) count += (object.geometry as THREE.BufferGeometry).getAttribute("position").count / 3;
    });
    return count;
  }

  /** Shows everything for the loading screen's shader compile, then hides it again. */
  setPrewarm(on: boolean): void {
    this.prewarm = on;
    for (const model of Object.values(this.models)) model.group.visible = on || model === (this.shown ? this.models[this.shown] : null);
    this.flash.visible = on;
    this.root.visible = on || this.raise > 0.02;
  }

  /** The muzzle in the world (valid after `attach`), into `out`. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const model = this.shown ? this.models[this.shown] : this.models.pistol;
    return model.muzzle.getWorldPosition(out);
  }

  /** A shot: recoil, the flash, the slide or the bolt, a spent case. */
  /**
   * A look over the gun just taken in hand: the arm goes out straight, the
   * gun is turned to show its right side, then its left, tipped up to see
   * along the slide, and brought back to the ready (`INSPECT_SECONDS`).
   * A shot, a reload or putting it away ends it.
   */
  inspect(): void {
    this.inspectClock = 0;
  }

  /** Whether the look over the gun is still going on. */
  get inspecting(): boolean {
    return this.inspectClock >= 0;
  }

  fire(): void {
    this.inspectClock = -1;
    const weapon = this.shown;
    if (!weapon) return;
    this.flashClock = FLASH_SECONDS;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar((weapon === "rifle" ? 1.5 : 1) * (0.8 + Math.random() * 0.45));
    const model = this.models[weapon];
    if (model.shoot) {
      // The authored clip works the slide and throws the case itself.
      model.shoot.stop();
      model.shoot.timeScale = 1.6;
      model.shoot.play();
    }
    if (weapon === "pistol") {
      this.kickSpeed += 1.5;
      this.flipSpeed += 3.4;
      this.slide = 1;
      if (!model.shoot) this.eject();
    } else if (model.authored) {
      this.kickSpeed += 1.9;
      this.flipSpeed += 1.7;
      this.eject();
    } else {
      this.kickSpeed += 2.1;
      this.flipSpeed += 2.2;
      this.bolt = 0;
      this.boltEjected = false;
    }
  }

  private eject(): void {
    const model = this.shown ? this.models[this.shown] : null;
    if (!model) return;
    const shell = this.shellPool[this.shellNext]!;
    this.shellNext = (this.shellNext + 1) % SHELLS;
    model.port.getWorldPosition(shell.position);
    // Out to the right and up, a little back, in the eye's frame.
    shell.velocity.set(1.6 + Math.random() * 1.2, 1.5 + Math.random() * 0.9, 0.3 + Math.random() * 0.6).transformDirection(this.root.matrix).multiplyScalar(1.5 + Math.random() * 0.6);
    shell.spin.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
    shell.life = 2.2;
    shell.floor = this.floor;
  }

  private writeShells(): void {
    for (let index = 0; index < SHELLS; index += 1) {
      const shell = this.shellPool[index]!;
      this.scratchMatrix.compose(shell.position, this.scratchQuaternion.setFromEuler(shell.rotation), this.scratchScale.set(1, 1, 1));
      this.shells.setMatrixAt(index, this.scratchMatrix);
    }
    this.shells.instanceMatrix.needsUpdate = true;
  }

  /** The gun's pose for this frame, from what he is doing. Call before `attach`. */
  update(delta: number, camera: THREE.Camera, input: WeaponViewInput): void {
    this.floor = input.floor;
    const wanted = input.firstPerson ? input.weapon : null;
    // Lower the gun in hand before another comes up.
    const lowering = this.shown !== wanted;
    this.raise = Math.min(1, Math.max(0, this.raise + (lowering ? -1 : 1) * (delta / RAISE_SECONDS)));
    if (lowering && this.raise <= 0) {
      if (this.shown && !this.prewarm) this.models[this.shown].group.visible = false;
      this.shown = wanted;
      if (this.shown) {
        this.models[this.shown].group.visible = true;
        this.kick = this.kickSpeed = this.flip = this.flipSpeed = 0;
        this.slide = 0;
        this.bolt = 1;
      }
    }
    // Spent cases fly on whether or not a gun is up.
    let flying = false;
    for (const shell of this.shellPool) {
      if (shell.life <= 0) continue;
      flying = true;
      shell.life -= delta;
      shell.velocity.y -= 9.8 * delta;
      shell.position.addScaledVector(shell.velocity, delta);
      shell.rotation.x += shell.spin.x * delta;
      shell.rotation.y += shell.spin.y * delta;
      shell.rotation.z += shell.spin.z * delta;
      if (shell.position.y < shell.floor + 0.006) {
        shell.position.y = shell.floor + 0.006;
        shell.velocity.y = Math.abs(shell.velocity.y) * 0.32;
        shell.velocity.x *= 0.55;
        shell.velocity.z *= 0.55;
        shell.spin.multiplyScalar(0.5);
      }
      if (shell.life <= 0) shell.position.set(0, -500, 0);
    }
    if (flying) this.writeShells();

    const weapon = this.shown;
    this.root.visible = this.prewarm || (weapon !== null && this.raise > 0.02);
    if (!weapon) return;
    const model = this.models[weapon];

    // Recoil: two damped springs, back along the bore and up about the wrist.
    const stiffness = weapon === "rifle" ? 210 : 300;
    const damping = weapon === "rifle" ? 21 : 24;
    const steps = Math.max(1, Math.ceil(delta / 0.008));
    const step = delta / steps;
    for (let index = 0; index < steps; index += 1) {
      this.kickSpeed += (-stiffness * this.kick - damping * this.kickSpeed) * step;
      this.kick += this.kickSpeed * step;
      this.flipSpeed += (-stiffness * this.flip - damping * this.flipSpeed) * step;
      this.flip += this.flipSpeed * step;
    }
    // His head turning: the gun lags a little behind it.
    this.scratchQuaternion.copy(this.lastQuaternion).invert().multiply(camera.quaternion);
    this.lastQuaternion.copy(camera.quaternion);
    const turnX = Math.max(-0.08, Math.min(0.08, this.scratchQuaternion.x * 2));
    const turnY = Math.max(-0.08, Math.min(0.08, this.scratchQuaternion.y * 2));
    const ease = Math.min(1, delta * 9);
    this.swayX += (-turnY * 0.5 - this.swayX) * ease;
    this.swayY += (turnX * 0.5 - this.swayY) * ease;
    // Stride and breath.
    this.moving += (Math.min(1, input.speed / 3.2) - this.moving) * Math.min(1, delta * 8);
    this.stride += delta * (4.6 + input.speed * 1.5) * (this.moving > 0.02 ? 1 : 0);
    this.breath += delta;
    const run = ramp(4.2, 5.6, input.speed);
    const bobX = Math.sin(this.stride) * 0.006 * this.moving;
    const bobY = Math.abs(Math.cos(this.stride)) * 0.007 * this.moving + Math.sin(this.breath * 1.3) * 0.0016;
    const down = 1 - ramp(0, 1, this.raise);

    // The reload: the gun canted and lowered while the hands work.
    const reloading = input.reload < 1;
    const u = input.reload;
    let cant = 0;
    let dip = 0;
    let pitch = 0;
    model.leftHand.position.set(0, 0, 0);
    model.rightHand.position.set(0, 0, 0);
    model.rightHand.rotation.set(0, 0, 0);
    if (weapon === "pistol") {
      const magazine = model.magazine!;
      if (reloading) {
        const tilt = ramp(0, 0.14, u) * (1 - ramp(0.8, 0.97, u));
        cant = 0.5 * tilt;
        pitch = 0.3 * tilt;
        dip = 0.03 * tilt;
        const drop = ramp(0.14, 0.3, u);
        const seat = ramp(0.52, 0.7, u);
        magazine.visible = u < 0.3 || u > 0.5;
        magazine.position.y = u < 0.45 ? -drop * 0.3 : -(1 - seat) * 0.2;
        const away = ramp(0.1, 0.24, u) * (1 - ramp(0.56, 0.72, u));
        model.leftHand.position.set(-0.04 * away, -0.2 * away, 0.12 * away);
        // The slide held open on the empty magazine, let go at the end.
        this.slide = Math.max(this.slide, 1 - ramp(0.84, 0.9, u));
      } else {
        magazine.visible = true;
        magazine.position.y = 0;
        this.slide = Math.max(0, this.slide - delta / 0.075);
      }
      model.action.position.z = this.slide * 0.034;
    } else {
      // The bolt: lifted, drawn back (the case goes), pushed home, turned down.
      let cycle = this.bolt;
      if (reloading) {
        const tilt = ramp(0, 0.16, u) * (1 - ramp(0.84, 0.98, u));
        cant = -0.38 * tilt;
        pitch = 0.26 * tilt;
        dip = 0.04 * tilt;
        // Open while the rounds go in, closed at the end.
        cycle = u < 0.5 ? ramp(0.1, 0.26, u) * 0.5 : 0.5 + ramp(0.8, 0.94, u) * 0.5;
        // The right hand feeding rounds into the open action.
        const feed = ramp(0.28, 0.4, u) * (1 - ramp(0.7, 0.8, u));
        const press = Math.sin(Math.max(0, u - 0.36) * 52) * 0.012 * feed;
        model.rightHand.position.set(-0.02 * feed, (0.105 + press) * feed, -0.04 * feed);
        model.rightHand.rotation.set(0.5 * feed, 0, 0.5 * feed);
      } else if (this.bolt < 1) {
        this.bolt = Math.min(1, this.bolt + delta / BOLT_SECONDS);
        cycle = this.bolt;
        if (!this.boltEjected && cycle > 0.42) {
          this.boltEjected = true;
          this.eject();
        }
      }
      const lift = ramp(0.08, 0.26, cycle) * (1 - ramp(0.8, 0.98, cycle));
      const draw = ramp(0.24, 0.46, cycle) * (1 - ramp(0.56, 0.8, cycle));
      model.action.rotation.z = lift * 1.05;
      model.action.position.z = draw * 0.085;
      if (!reloading && cycle < 1) {
        // The hand goes with the knob.
        const reach = ramp(0.02, 0.14, cycle) * (1 - ramp(0.88, 1, cycle));
        model.rightHand.position.set(0.03 * reach, (0.05 + lift * 0.04) * reach, (-0.012 + draw * 0.085) * reach);
        model.rightHand.rotation.set(0, 0, -0.35 * reach);
      }
    }

    if (model.authored) {
      // The authored model's own clips: the reload follows the gun's reload, the shot plays out.
      if (model.reload) {
        const clip = model.reload.getClip();
        model.reload.time = reloading ? Math.min(clip.duration - 0.01, u * clip.duration) : 0;
        // The hand built here is off the gun while the magazine is changed.
        if (weapon === "rifle") {
          const away = reloading ? ramp(0, 0.12, u) * (1 - ramp(0.86, 1, u)) : 0;
          model.leftHand.position.set(-0.1 * away, -0.3 * away, 0.2 * away);
          model.rightHand.position.set(0, 0, 0);
          model.rightHand.rotation.set(0, 0, 0);
          cant = 0;
          pitch = 0;
          dip = 0;
          model.action.rotation.z = 0;
        }
      }
      model.mixer?.update(delta);
    }
    // The look over a new gun (only once it is fully raised; a reload ends it).
    let lookX = 0;
    let lookY = 0;
    let lookZ = 0;
    let lookPitch = 0;
    let lookYaw = 0;
    let lookRoll = 0;
    if (this.inspectClock >= 0) {
      // Put away or reloading: over. Out of his own eyes (a cut): it waits.
      if (reloading || input.weapon === null) this.inspectClock = -1;
      else if (input.firstPerson && this.shown === input.weapon && this.raise >= 1) this.inspectClock += delta;
    }
    if (this.inspectClock >= 0) {
      const t = this.inspectClock / INSPECT_SECONDS;
      if (t >= 1) this.inspectClock = -1;
      else {
        const out = ramp(0, 0.14, t) * (1 - ramp(0.86, 1, t));
        // The arm straight out, the gun before the middle of the view and a little high.
        lookX = -0.075 * out;
        lookY = 0.035 * out;
        lookZ = -0.16 * out;
        // Right side (turned out, rolled), then the left, then tipped up along the slide.
        const right = ramp(0.1, 0.3, t) * (1 - ramp(0.4, 0.56, t));
        const left = ramp(0.42, 0.58, t) * (1 - ramp(0.68, 0.8, t));
        const top = ramp(0.7, 0.8, t) * (1 - ramp(0.86, 0.98, t));
        // Mostly the wrist's roll, a little of its turn: the forearm stays where it is.
        lookYaw = 0.4 * right - 0.36 * left;
        lookRoll = 0.62 * right - 0.66 * left;
        lookPitch = -0.1 * (right + left) + 0.38 * top;
        // One hand looks it over; the other drops out of the way.
        model.leftHand.position.set(-0.12 * out, -0.5 * out, 0.16 * out);
        // A small settle of the wrist between the turns.
        lookY += Math.sin(t * Math.PI * 6) * 0.004 * out;
      }
    }
    const rest = model.rest;
    const crouch = input.crouched ? 1 : 0;
    this.rig.position.set(
      rest.position[0] + bobX + this.swayX * 0.12 - run * 0.03 - cant * 0.03 + lookX,
      rest.position[1] - bobY - down * 0.3 - dip - run * 0.05 - crouch * 0.006 + lookY,
      rest.position[2] + this.kick + down * 0.05 + lookZ,
    );
    this.rig.rotation.set(
      rest.rotation[0] + this.flip + this.swayY - down * 0.95 + pitch - run * 0.3 + lookPitch,
      rest.rotation[1] + this.swayX + run * 0.55 + lookYaw,
      rest.rotation[2] + cant + bobX * 2 + run * 0.2 + lookRoll,
    );
    this.rig.scale.setScalar(1);

    // The flash at the muzzle, turned with the gun.
    this.flashClock -= delta;
    const lit = this.flashClock > 0;
    this.flash.visible = lit || this.prewarm;
    if (lit) {
      this.scratchEuler.copy(this.flash.rotation);
      this.flash.position.copy(model.muzzle.position).applyEuler(model.group.rotation).add(model.group.position);
      this.flash.position.z -= 0.03;
    }
  }

  /** Puts the gun before the camera as it will be drawn (after any shake is laid on). */
  attach(camera: THREE.Camera): void {
    if (!this.root.visible) return;
    this.root.matrix.copy(camera.matrixWorld);
    this.root.matrixWorldNeedsUpdate = true;
    this.root.updateMatrixWorld(true);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.shells.removeFromParent();
    this.shells.geometry.dispose();
    (this.shells.material as THREE.Material).dispose();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) (object.geometry as THREE.BufferGeometry).dispose();
    });
    for (const material of Object.values(this.materials)) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  }
}
