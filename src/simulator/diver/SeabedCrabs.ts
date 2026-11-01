import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import { patchMaterialShader } from "../core/ShaderPatch";

/**
 * Crabs scuttling over the sand round a diver: each walks sideways in short
 * bursts, stops, turns a little, raises its claws at a diver who comes too
 * close and hurries off. Their eight legs step in alternating sets in the
 * vertex shader (each leg vertex knows which leg it belongs to), so a
 * hundred of them are one instanced draw.
 *
 * They live in a ring round the diver: one that falls too far behind is
 * put down again ahead, somewhere he has not looked yet.
 */

const COUNT = 64;
const RANGE = 22;
const NEAR = 4;

type Crab = {
  x: number;
  z: number;
  /** Facing (the body's forward); it walks along its sideways axis. */
  heading: number;
  /** Walking direction along the side: +1 or −1. */
  side: number;
  speed: number;
  /** Seconds left of the current walk or rest. */
  timer: number;
  walking: boolean;
  /** Leg cycle phase, advanced with the distance walked. */
  gait: number;
  size: number;
  /** 0 calm … 1 claws up (a diver close by). */
  alarm: number;
};

/** One crab: a wide body, eight jointed legs (attribute `leg`: 1…8, 0 for the body) and two claws (9, 10). */
function crabGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tag = (geometry: THREE.BufferGeometry, leg: number, color: THREE.Color) => {
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("leg", new THREE.Float32BufferAttribute(new Float32Array(count).fill(leg), 1));
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) colors.set([color.r, color.g, color.b], index * 3);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    parts.push(geometry.index ? geometry.toNonIndexed() : geometry);
  };
  const shell = new THREE.Color(0.62, 0.22, 0.12);
  const leg = new THREE.Color(0.55, 0.25, 0.14);
  const claw = new THREE.Color(0.7, 0.3, 0.16);
  // The carapace: a flattened, slightly bumpy disc, wider than long (x is across).
  const body = new THREE.SphereGeometry(0.06, 14, 8);
  body.scale(1.35, 0.42, 1);
  body.translate(0, 0.045, 0);
  tag(body, 0, shell);
  // Eyes on stalks.
  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.008, 6, 4);
    eye.translate(side * 0.022, 0.075, 0.052);
    tag(eye, 0, new THREE.Color(0.05, 0.04, 0.04));
  }
  // Four legs a side, splayed out sideways and down to the sand.
  for (let pair = 0; pair < 4; pair += 1) {
    for (const side of [-1, 1]) {
      const z = 0.03 - pair * 0.022;
      const upper = new THREE.CylinderGeometry(0.006, 0.008, 0.07, 5);
      upper.rotateZ((side * Math.PI) / 2.6);
      upper.translate(side * 0.1, 0.06, z);
      const lower = new THREE.CylinderGeometry(0.003, 0.006, 0.07, 5);
      lower.rotateZ((-side * Math.PI) / 7);
      lower.translate(side * 0.142, 0.03, z);
      const index = 1 + pair * 2 + (side > 0 ? 1 : 0);
      tag(upper, index, leg);
      tag(lower, index, leg);
    }
  }
  // Two claws in front.
  for (const side of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.008, 0.009, 0.06, 5);
    arm.rotateX(Math.PI / 2.4);
    arm.translate(side * 0.045, 0.05, 0.08);
    const pincer = new THREE.SphereGeometry(0.018, 8, 6);
    pincer.scale(0.8, 0.7, 1.4);
    pincer.translate(side * 0.05, 0.055, 0.115);
    tag(arm, side < 0 ? 9 : 10, claw);
    tag(pincer, side < 0 ? 9 : 10, claw);
  }
  for (const part of parts) {
    part.deleteAttribute("uv");
  }
  const merged = mergeGeometries(parts, false)!;
  merged.computeVertexNormals();
  return merged;
}

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

export class SeabedCrabs {
  readonly mesh: THREE.InstancedMesh;
  private readonly crabs: Crab[] = [];
  private readonly gait: THREE.InstancedBufferAttribute;
  private readonly random = random(9137);
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private placed = false;

  constructor(scene: THREE.Scene, underwater: UnderwaterLight) {
    const geometry = crabGeometry();
    // Per crab: gait phase and alarm (claws up).
    this.gait = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 2), 2);
    this.gait.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("crabState", this.gait);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    patchMaterialShader(material, "seabed-crab-v1", (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float leg;\nattribute vec2 crabState;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          if (leg > 0.5 && leg < 8.5) {
            // Alternating sets: legs 1,4,5,8 step together, 2,3,6,7 together.
            float index = leg - 1.0;
            float pair = floor(index / 2.0);
            float set = mod(pair + mod(index, 2.0), 2.0);
            float phase = crabState.x * 6.2831 + set * 3.14159;
            float lift = max(0.0, sin(phase)) * 0.018;
            float swing = cos(phase) * 0.012;
            float outward = abs(transformed.x) - 0.05;
            transformed.y += lift * clamp(outward * 12.0, 0.0, 1.0);
            transformed.z += swing * clamp(outward * 12.0, 0.0, 1.0);
          } else if (leg > 8.5) {
            // Claws: raised and opened toward a diver who comes too close.
            float raise = crabState.y;
            float forward = max(0.0, transformed.z - 0.06);
            transformed.y += forward * raise * 1.3 + raise * 0.02;
            transformed.x *= 1.0 + raise * 0.25;
          }`,
        );
    });
    underwater.apply(material);
    this.mesh = new THREE.InstancedMesh(geometry, material, COUNT);
    this.mesh.name = "SeabedCrabs";
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.visible = false;
    for (let index = 0; index < COUNT; index += 1) {
      this.crabs.push({ x: 0, z: 0, heading: 0, side: 1, speed: 0.12, timer: 0, walking: false, gait: 0, size: 1, alarm: 0 });
    }
    scene.add(this.mesh);
  }

  /** Puts a crab down somewhere on the sand round (x, z), not too near. */
  private place(crab: Crab, x: number, z: number, ahead: number | null): void {
    const r = NEAR + this.random() * (RANGE - NEAR);
    const a = ahead === null ? this.random() * Math.PI * 2 : ahead + (this.random() - 0.5) * 1.6;
    crab.x = x + Math.cos(a) * r;
    crab.z = z + Math.sin(a) * r;
    crab.heading = this.random() * Math.PI * 2;
    crab.side = this.random() < 0.5 ? -1 : 1;
    crab.speed = 0.09 + this.random() * 0.12;
    crab.timer = this.random() * 3;
    crab.walking = this.random() < 0.5;
    crab.size = 0.7 + this.random() * 0.9;
    crab.alarm = 0;
  }

  /**
   * One frame. `active` while the diver is under the water; `eye` his eyes;
   * `ground(x, z)` the sand's height and `depth(x, z)` the water's (crabs
   * stay where there is a metre of water or more, off the reef tops).
   */
  update(delta: number, active: boolean, eye: THREE.Vector3, heading: number, ground: (x: number, z: number) => number, depth: (x: number, z: number) => number): void {
    this.mesh.visible = active;
    if (!active) {
      this.placed = false;
      return;
    }
    const dt = Math.min(0.05, Math.max(0, delta));
    if (!this.placed) {
      this.placed = true;
      for (const crab of this.crabs) this.place(crab, eye.x, eye.z, null);
    }
    const gait = this.gait.array as Float32Array;
    this.crabs.forEach((crab, index) => {
      const dx = crab.x - eye.x;
      const dz = crab.z - eye.z;
      const distance = Math.hypot(dx, dz);
      // Left behind: put down again ahead of the diver.
      if (distance > RANGE * 1.3 || depth(crab.x, crab.z) < 0.8) {
        this.place(crab, eye.x, eye.z, Math.atan2(Math.cos(heading), Math.sin(heading)));
        return;
      }
      const groundY = ground(crab.x, crab.z);
      // A diver's head close above: claws up, then a hurried retreat.
      const near = Math.hypot(distance, eye.y - groundY);
      const threat = near < 1.6 ? 1 : 0;
      crab.alarm += (threat - crab.alarm) * Math.min(1, dt * 4);
      crab.timer -= dt;
      if (crab.timer <= 0) {
        crab.walking = !crab.walking || crab.alarm > 0.5;
        crab.timer = crab.walking ? 1.2 + this.random() * 2.5 : 0.8 + this.random() * 3;
        if (crab.walking && this.random() < 0.4) crab.side = -crab.side;
        crab.heading += (this.random() - 0.5) * 0.8;
      }
      let speed = crab.walking ? crab.speed : 0;
      if (crab.alarm > 0.5) {
        // Away from the diver, sideways.
        const awaySide = Math.sign(-Math.sin(crab.heading) * dz + Math.cos(crab.heading) * dx) || 1;
        crab.side = awaySide;
        speed = crab.speed * 2.6;
      }
      // Sideways is the body's x axis.
      const sideX = Math.cos(crab.heading) * crab.side;
      const sideZ = -Math.sin(crab.heading) * crab.side;
      crab.x += sideX * speed * dt;
      crab.z += sideZ * speed * dt;
      crab.gait += (speed * dt) / (0.05 * crab.size);
      gait[index * 2] = crab.gait % 1;
      gait[index * 2 + 1] = crab.alarm;
      this.quaternion.setFromAxisAngle(this.up, crab.heading);
      this.position.set(crab.x, groundY - 0.005, crab.z);
      this.scale.setScalar(crab.size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(index, this.matrix);
    });
    this.mesh.count = COUNT;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.gait.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
