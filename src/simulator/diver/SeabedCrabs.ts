import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import { patchMaterialShader } from "../core/ShaderPatch";

/**
 * Crabs: on the seabed round a diver, and on the beaches round a walker.
 *
 * Each crab walks sideways in short bursts, stops, turns a little; one that
 * a diver's head comes close to rears up (claws raised) and hurries off. On
 * the beach they are skittish: a walker within a few metres sends every
 * crab near him dashing for the water, where it vanishes. They live in a
 * ring round the eyes: one left too far behind is put down again ahead.
 *
 * The crabs are the loaded crab models (`crab-red.glb`, `crab-blue.glb`),
 * each turned so its legs reach out along x and its front faces +z, merged
 * per material and drawn as instances. They have no skeleton: the legs
 * step in the vertex shader. A vertex well out to the side belongs to a
 * leg; where along the body it is picks the leg, and the legs step in two
 * alternating sets, so a hundred crabs are a few instanced draws. Should the
 * models be missing, a simple procedural crab stands in.
 */

export type CrabHabitat = "seabed" | "beach";

/** A crab model ready to instance: its parts (one per material), body half-width and length. */
export type CrabKit = { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]; halfWidth: number; length: number };

type Crab = {
  x: number;
  z: number;
  heading: number;
  /** Walking direction along its side: +1 or −1. */
  side: number;
  speed: number;
  timer: number;
  walking: boolean;
  /** Leg cycle phase, advanced with the distance walked. */
  gait: number;
  size: number;
  /** 0 calm … 1 reared up (someone close by). */
  alarm: number;
  /** Which model (0 or 1). */
  kind: number;
  /** A beach crab that has fled into the sea: hidden until it is put down again. */
  gone: boolean;
};

/** A deterministic generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turns a loaded crab model into instanceable parts: every mesh baked into
 * the model's frame, turned (`turn` radians about y) so the legs reach along
 * x and the front faces +z, set on y = 0, scaled to a body 1 m across, and
 * merged per material.
 */
export function crabKit(model: THREE.Object3D, turn: number): CrabKit | null {
  model.updateMatrixWorld(true);
  const rotate = new THREE.Matrix4().makeRotationY(turn);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld).applyMatrix4(rotate);
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") geometry.deleteAttribute(name);
    }
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    if (!geometry.getAttribute("uv")) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2));
    const list = groups.get(material) ?? [];
    list.push(geometry);
    groups.set(material, list);
  });
  if (groups.size === 0) return null;
  const merged = [...groups].map(([material, list]) => ({ material, geometry: mergeGeometries(list, false)! }));
  const box = new THREE.Box3();
  for (const part of merged) {
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox!);
  }
  const width = box.max.x - box.min.x;
  const scale = 1 / Math.max(width, 1e-3);
  const centre = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  for (const part of merged) {
    part.geometry.translate(-centre.x, -centre.y, -centre.z).scale(scale, scale, scale);
    part.geometry.computeBoundingSphere();
  }
  return { parts: merged.map((part) => ({ geometry: part.geometry, material: part.material.clone() })), halfWidth: 0.5, length: (box.max.z - box.min.z) * scale };
}

/** The stand-in when no crab model loaded: a wide body, eight legs, two claws, in one part. */
function proceduralKit(): CrabKit {
  const parts: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, color: THREE.Color) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.deleteAttribute("uv");
    const count = flat.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) colors.set([color.r, color.g, color.b], index * 3);
    flat.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    parts.push(flat);
  };
  const shell = new THREE.Color(0.62, 0.22, 0.12);
  const body = new THREE.SphereGeometry(0.2, 16, 8);
  body.scale(1.3, 0.42, 1).translate(0, 0.16, 0);
  add(body, shell);
  for (let pair = 0; pair < 4; pair += 1) {
    for (const side of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.012, 0.022, 0.26, 5);
      leg.rotateZ((side * Math.PI) / 2.4).translate(side * 0.34, 0.12, 0.1 - pair * 0.07);
      add(leg, shell);
    }
  }
  for (const side of [-1, 1]) {
    const claw = new THREE.SphereGeometry(0.06, 8, 6);
    claw.scale(0.8, 0.7, 1.4).translate(side * 0.15, 0.18, 0.33);
    add(claw, new THREE.Color(0.7, 0.3, 0.16));
  }
  const geometry = mergeGeometries(parts, false)!;
  geometry.computeVertexNormals();
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2));
  return { parts: [{ geometry, material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }) }], halfWidth: 0.5, length: 0.5 };
}

/** How many crabs, how far round the eyes they live, how near they let someone come. */
const SETTINGS: Record<CrabHabitat, { count: number; range: number; near: number; size: [number, number]; speed: [number, number]; shy: number }> = {
  // Seabed crabs are the big reef crabs (spider and king crabs a forearm to a
  // metre across), seen from metres away through the water.
  seabed: { count: 40, range: 24, near: 4, size: [0.45, 0.95], speed: [0.12, 0.26], shy: 2.2 },
  beach: { count: 34, range: 26, near: 5, size: [0.12, 0.2], speed: [0.25, 0.5], shy: 4.5 },
};

export type CrabWorld = {
  /** Height of the ground (sand or seabed) at (x, z). */
  ground: (x: number, z: number) => number;
  /** Where a crab of this habitat can stand (seabed: water a metre deep or more; beach: dry sand by the sea). */
  allowed: (x: number, z: number) => boolean;
  /** Seaward direction at (x, z) for a fleeing beach crab (unit x, z), or null. */
  seaward?: (x: number, z: number, out: { x: number; z: number }) => boolean;
};

export class SeabedCrabs {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[][] = [];
  private readonly kits: CrabKit[];
  private readonly crabs: Crab[] = [];
  private readonly gait: THREE.InstancedBufferAttribute[] = [];
  private readonly random: () => number;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly across = new THREE.Vector3(1, 0, 0);
  private readonly seaward = { x: 0, z: 0 };
  private readonly settings: (typeof SETTINGS)[CrabHabitat];
  private placed = false;

  constructor(
    scene: THREE.Scene,
    underwater: UnderwaterLight,
    readonly habitat: CrabHabitat = "seabed",
    kits: readonly (CrabKit | null)[] = [],
  ) {
    this.settings = SETTINGS[habitat];
    this.random = random(habitat === "seabed" ? 9137 : 5521);
    const usable = kits.filter((kit): kit is CrabKit => kit !== null);
    this.kits = usable.length > 0 ? usable : [proceduralKit()];
    const count = this.settings.count;
    this.kits.forEach((kit, kind) => {
      const gait = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
      gait.setUsage(THREE.DynamicDrawUsage);
      this.gait.push(gait);
      const list: THREE.InstancedMesh[] = [];
      for (const part of kit.parts) {
        const geometry = part.geometry.clone();
        geometry.setAttribute("crabState", gait);
        const material = part.material.clone();
        this.animate(material, kit.length);
        underwater.apply(material);
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = `Crabs_${habitat}_${kind}`;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        this.group.add(mesh);
        list.push(mesh);
      }
      this.meshes.push(list);
    });
    for (let index = 0; index < count; index += 1) {
      this.crabs.push({ x: 0, z: 0, heading: 0, side: 1, speed: 0.12, timer: 0, walking: false, gait: 0, size: 1, alarm: 0, kind: 0, gone: true });
    }
    this.group.name = `Crabs_${habitat}`;
    this.group.visible = false;
    scene.add(this.group);
  }

  /** The legs' step, in the vertex shader (the crab's frame: legs along x, front +z, 1 m across). */
  private animate(material: THREE.Material, length: number): void {
    patchMaterialShader(material, "crab-gait-v2", (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 crabState;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          {
            // Out at the side is leg; the body's middle third is not.
            float reach = abs(transformed.x);
            float leg = smoothstep(0.17, 0.32, reach);
            // Which pair along the body (front to back), alternating sides.
            float along = transformed.z / ${Math.max(0.2, length).toFixed(3)} + 0.5;
            float pair = floor(clamp(along, 0.0, 0.999) * 4.0);
            float set = mod(pair + step(0.0, transformed.x), 2.0);
            float phase = crabState.x * 6.2831 + set * 3.14159;
            // The tip lifts and swings; the further out, the more.
            float tip = smoothstep(0.2, 0.5, reach);
            transformed.y += max(0.0, sin(phase)) * 0.045 * leg * tip;
            transformed.z += cos(phase) * 0.03 * leg * tip;
            // Rearing up: the front lifted, the claws with it.
            transformed.y += crabState.y * max(0.0, transformed.z) * 0.35;
          }`,
        );
    });
  }

  /** Puts a crab down somewhere it may stand round (x, z), not too near; ahead of the eyes if `ahead` is given. */
  private place(crab: Crab, x: number, z: number, ahead: number | null, world: CrabWorld): void {
    const { range, near, size, speed } = this.settings;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const r = near + this.random() * (range - near);
      const a = ahead === null ? this.random() * Math.PI * 2 : ahead + (this.random() - 0.5) * 1.8;
      const cx = x + Math.cos(a) * r;
      const cz = z + Math.sin(a) * r;
      if (!world.allowed(cx, cz)) continue;
      crab.x = cx;
      crab.z = cz;
      crab.heading = this.random() * Math.PI * 2;
      crab.side = this.random() < 0.5 ? -1 : 1;
      crab.speed = speed[0] + this.random() * (speed[1] - speed[0]);
      crab.timer = this.random() * 3;
      crab.walking = this.random() < 0.5;
      crab.size = size[0] + this.random() * (size[1] - size[0]);
      crab.alarm = 0;
      crab.kind = Math.floor(this.random() * this.kits.length) % this.kits.length;
      crab.gone = false;
      return;
    }
    // Nowhere to stand round here (no beach in sight): try again in a while.
    crab.gone = true;
    crab.timer = 0.8 + this.random() * 0.8;
  }

  /**
   * One frame. `active` while someone is there to see them (a diver under
   * the water, a walker on a beach); `eye` the camera; `heading` where the
   * eyes look (crabs are put down ahead).
   */
  update(delta: number, active: boolean, eye: THREE.Vector3, heading: number, world: CrabWorld): void {
    this.group.visible = active;
    if (!active) {
      this.placed = false;
      return;
    }
    const dt = Math.min(0.05, Math.max(0, delta));
    const { range, shy } = this.settings;
    const beach = this.habitat === "beach";
    if (!this.placed) {
      this.placed = true;
      for (const crab of this.crabs) this.place(crab, eye.x, eye.z, null, world);
    }
    const ahead = Math.atan2(Math.cos(heading), Math.sin(heading));
    const counts = this.kits.map(() => 0);
    for (const crab of this.crabs) {
      const dx = crab.x - eye.x;
      const dz = crab.z - eye.z;
      const distance = Math.hypot(dx, dz);
      // Left behind, fled into the sea, or on ground it cannot stand on: put down again ahead.
      if (crab.gone || distance > range * 1.3 || !world.allowed(crab.x, crab.z)) {
        if (!crab.gone && beach && !world.allowed(crab.x, crab.z) && distance < range) {
          crab.gone = true;
          crab.timer = 3 + this.random() * 6;
        }
        if (crab.gone && crab.timer > 0 && distance < range * 1.3) {
          crab.timer -= dt;
          continue;
        }
        this.place(crab, eye.x, eye.z, ahead, world);
        if (crab.gone) continue;
      }
      const groundY = world.ground(crab.x, crab.z);
      // Someone close: rear up, then run (a beach crab for the sea).
      const near = Math.hypot(distance, (eye.y - groundY) * (beach ? 0.3 : 1));
      const threat = near < shy ? 1 : 0;
      crab.alarm += (threat - crab.alarm) * Math.min(1, dt * (beach ? 8 : 4));
      crab.timer -= dt;
      if (crab.timer <= 0) {
        crab.walking = !crab.walking || crab.alarm > 0.5;
        crab.timer = crab.walking ? 1.2 + this.random() * 2.5 : 0.8 + this.random() * 3;
        if (crab.walking && this.random() < 0.4) crab.side = -crab.side;
        crab.heading += (this.random() - 0.5) * 0.8;
      }
      let speed = crab.walking ? crab.speed : 0;
      if (crab.alarm > 0.5) {
        let awayX = dx / Math.max(distance, 1e-3);
        let awayZ = dz / Math.max(distance, 1e-3);
        if (beach && world.seaward?.(crab.x, crab.z, this.seaward)) {
          awayX = awayX * 0.4 + this.seaward.x;
          awayZ = awayZ * 0.4 + this.seaward.z;
        }
        // Turn side-on to the escape and scuttle that way.
        const sideways = Math.atan2(awayX, awayZ) - Math.PI / 2;
        const turn = Math.atan2(Math.sin(sideways - crab.heading), Math.cos(sideways - crab.heading));
        crab.heading += turn * Math.min(1, dt * 6);
        crab.side = 1;
        speed = crab.speed * (beach ? 4.2 : 2.6);
      }
      // Sideways is the body's x axis.
      crab.x += Math.cos(crab.heading) * crab.side * speed * dt;
      crab.z += -Math.sin(crab.heading) * crab.side * speed * dt;
      crab.gait += (speed * dt) / (0.12 * crab.size);
      const index = counts[crab.kind]!;
      counts[crab.kind] = index + 1;
      const gait = this.gait[crab.kind]!.array as Float32Array;
      gait[index * 2] = crab.gait % 1;
      gait[index * 2 + 1] = beach ? 0 : crab.alarm;
      this.quaternion.setFromAxisAngle(this.up, crab.heading);
      // A running crab leans into its stride; an alarmed one on the seabed rears.
      this.tilt.setFromAxisAngle(this.across, -(beach ? 0 : crab.alarm * 0.25));
      this.quaternion.multiply(this.tilt);
      this.position.set(crab.x, world.ground(crab.x, crab.z) - 0.004, crab.z);
      this.scale.setScalar(crab.size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      for (const mesh of this.meshes[crab.kind]!) mesh.setMatrixAt(index, this.matrix);
    }
    this.meshes.forEach((list, kind) => {
      for (const mesh of list) {
        mesh.count = counts[kind]!;
        mesh.instanceMatrix.needsUpdate = true;
      }
      this.gait[kind]!.needsUpdate = true;
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const list of this.meshes) {
      for (const mesh of list) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      }
    }
  }
}
