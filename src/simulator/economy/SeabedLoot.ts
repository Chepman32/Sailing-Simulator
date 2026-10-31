import * as THREE from "three";
import { patchMaterialShader } from "../core/ShaderPatch";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import {
  FIND_CELL,
  FIND_KINDS,
  findsInCell,
  sonarRevealsTier,
  type FindKind,
  type FindTier,
  type SeabedFind,
} from "./EconomyMath";
import { FIND_HEIGHT, findGeometry } from "./FindModels";

/**
 * The finds on the sea floor round a diver: everyday wrack, old things of
 * value and chests of gold (`EconomyMath.findsInCell`), each kind an
 * instanced mesh resting on the sand, with a slow glint over it so a
 * swimmer's eye is drawn to it through the blue. The world's finds are
 * decided by their place; the ones already taken stay gone.
 *
 * Also answers the yacht's sonar: what lies within its sweep, by tier.
 */

/** How far round the diver finds are laid out, m. */
const DRAW_RADIUS = 70;
/** Most of one kind drawn at once. */
const CAPACITY = 96;
/** Reach of a diver's hand from his eyes, m. */
export const PICKUP_REACH = 1.9;
/** The most marks the sonar shows at once. */
export const SONAR_LIMIT = 40;

export type SeabedWorld = {
  /** Water depth at (x, z), m (positive). */
  depth: (x: number, z: number) => number;
  /** How much reef grows there, 0…1. */
  reef: (x: number, z: number) => number;
  /** Height of the sand at (x, z), m. */
  ground: (x: number, z: number) => number;
};

export type SonarContact = { x: number; z: number; tier: FindTier; depth: number };

type Layer = { kind: FindKind; mesh: THREE.InstancedMesh; finds: SeabedFind[] };

const GLINT_COLORS: Record<FindTier, THREE.Color> = {
  1: new THREE.Color(0.75, 0.9, 1.0),
  2: new THREE.Color(0.75, 1.0, 0.95),
  3: new THREE.Color(1.0, 0.85, 0.4),
};

const glintVertex = /* glsl */ `
  attribute float aPhase;
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uTime;
  varying vec3 vColor;
  varying float vPulse;
  void main() {
    vec4 view = viewMatrix * modelMatrix * vec4(position, 1.0);
    float distance = -view.z;
    // A slow breath of light, now and then a flash: a glint, not a lamp.
    float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 1.7 + aPhase * 6.28), 6.0);
    vPulse = pulse * (1.0 - smoothstep(30.0, 60.0, distance)) * smoothstep(0.6, 2.0, distance);
    vColor = aColor;
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(aSize * 260.0 / max(distance, 0.5), 2.0, 48.0);
  }
`;

const glintFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vPulse;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    // A soft core and four faint rays.
    float core = exp(-r * r * 60.0);
    float rays = max(exp(-abs(c.x) * 60.0), exp(-abs(c.y) * 60.0)) * (1.0 - smoothstep(0.0, 0.5, r)) * 0.5;
    float light = (core + rays) * vPulse;
    if (light < 0.003) discard;
    gl_FragColor = vec4(vColor * light, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SeabedLoot {
  readonly group = new THREE.Group();
  private readonly layers: Layer[] = [];
  private readonly glints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly glintPositions: Float32Array;
  private readonly glintColors: Float32Array;
  private readonly glintPhases: Float32Array;
  private readonly glintSizes: Float32Array;
  private readonly glowTime = { value: 0 };
  private builtX = Number.NaN;
  private builtZ = Number.NaN;
  private takenVersion = -1;
  private readonly cellFinds: SeabedFind[] = [];
  /** Finds laid out round the diver now (with their resting height). */
  private readonly near: { find: SeabedFind; y: number }[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    scene: THREE.Scene,
    underwater: UnderwaterLight,
    private readonly world: SeabedWorld,
    /** Keys of the finds already taken. */
    private readonly taken: ReadonlySet<string>,
  ) {
    this.group.name = "Seabed_Finds";
    for (const kind of FIND_KINDS) {
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: kind === "compass" || kind === "sextant" || kind === "statuette" ? 0.35 : kind === "bottle" ? 0.15 : 0.8,
        metalness: kind === "compass" || kind === "sextant" || kind === "statuette" ? 0.75 : kind === "anchor" || kind === "can" ? 0.25 : 0,
      });
      this.glowing(material);
      underwater.apply(material);
      const mesh = new THREE.InstancedMesh(findGeometry(kind), material, CAPACITY);
      mesh.name = `Find_${kind}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.layers.push({ kind, mesh, finds: [] });
    }
    const total = CAPACITY * 4;
    this.glintPositions = new Float32Array(total * 3);
    this.glintColors = new Float32Array(total * 3);
    this.glintPhases = new Float32Array(total);
    this.glintSizes = new Float32Array(total);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.glintPositions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.glintColors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(this.glintPhases, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.glintSizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.glints = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        name: "FindGlints",
        vertexShader: glintVertex,
        fragmentShader: glintFragment,
        uniforms: { uTime: this.glowTime },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 7;
    this.group.add(this.glints);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** The parts painted to glow (living coral, gold) shine by themselves, breathing slowly. */
  private glowing(material: THREE.MeshStandardMaterial): void {
    const time = this.glowTime;
    patchMaterialShader(material, "find-glow-v1", (shader) => {
      shader.uniforms.uFindTime = time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vFindGlow;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFindGlow = glow;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uFindTime;\nvarying float vFindGlow;")
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * vFindGlow * (1.6 + 0.6 * sin(uFindTime * 1.3 + vFindGlow * 9.0));`,
        );
    });
  }

  /** Forget the layout (a find was taken, or the bag of taken keys was replaced): rebuilt next frame. */
  invalidate(): void {
    this.builtX = Number.NaN;
  }

  /**
   * One frame. `eye` is the diver's eyes; `active` whether he is under the
   * water (the finds are drawn only then).
   */
  update(delta: number, eye: THREE.Vector3, active: boolean, takenVersion: number): void {
    this.glowTime.value += delta;
    this.group.visible = active;
    if (!active) return;
    if (takenVersion !== this.takenVersion || !(Math.hypot(eye.x - this.builtX, eye.z - this.builtZ) < 6)) {
      this.takenVersion = takenVersion;
      this.layout(eye.x, eye.z);
    }
  }

  private layout(x: number, z: number): void {
    this.builtX = x;
    this.builtZ = z;
    this.near.length = 0;
    for (const layer of this.layers) layer.finds.length = 0;
    const byKind = new Map(this.layers.map((layer) => [layer.kind, layer]));
    const c0 = Math.floor((x - DRAW_RADIUS) / FIND_CELL);
    const c1 = Math.floor((x + DRAW_RADIUS) / FIND_CELL);
    const r0 = Math.floor((z - DRAW_RADIUS) / FIND_CELL);
    const r1 = Math.floor((z + DRAW_RADIUS) / FIND_CELL);
    let glints = 0;
    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) {
        for (const find of findsInCell(column, row, this.world.depth, this.world.reef, this.cellFinds)) {
          if (this.taken.has(find.key)) continue;
          if (Math.hypot(find.x - x, find.z - z) > DRAW_RADIUS) continue;
          const layer = byKind.get(find.kind)!;
          if (layer.finds.length >= CAPACITY) continue;
          const y = this.world.ground(find.x, find.z);
          // Settled into the sand, tilted to the lie of the bottom a little.
          this.quaternion.setFromAxisAngle(this.up, find.yaw);
          this.position.set(find.x, y - 0.02, find.z);
          this.scale.setScalar(0.9 + find.seed * 0.25);
          this.matrix.compose(this.position, this.quaternion, this.scale);
          layer.mesh.setMatrixAt(layer.finds.length, this.matrix);
          layer.finds.push({ ...find });
          this.near.push({ find: { ...find }, y });
          if (glints < this.glintPhases.length) {
            const color = GLINT_COLORS[find.tier];
            this.glintPositions.set([find.x, y + FIND_HEIGHT[find.kind] + 0.08, find.z], glints * 3);
            this.glintColors.set([color.r, color.g, color.b], glints * 3);
            this.glintPhases[glints] = find.seed;
            this.glintSizes[glints] = find.tier === 3 ? 0.55 : find.tier === 2 ? 0.38 : 0.22;
            glints += 1;
          }
        }
      }
    }
    for (const layer of this.layers) {
      layer.mesh.count = layer.finds.length;
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
    const geometry = this.glints.geometry;
    for (const name of ["position", "aColor", "aPhase", "aSize"]) (geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    geometry.setDrawRange(0, glints);
  }

  /** The find within reach of a diver's hand at `eye`, nearest first, or null. */
  reachable(eye: THREE.Vector3): SeabedFind | null {
    let best: SeabedFind | null = null;
    let bestDistance = PICKUP_REACH;
    for (const { find, y } of this.near) {
      if (this.taken.has(find.key)) continue;
      const top = y + FIND_HEIGHT[find.kind] * 0.5;
      const distance = Math.hypot(find.x - eye.x, top - eye.y, find.z - eye.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = find;
      }
    }
    return best;
  }

  /**
   * What the yacht's sonar sees from (x, z): finds within `range` metres,
   * in water no deeper than `maxDepth`, of the tiers its `level` marks.
   */
  scan(x: number, z: number, range: number, maxDepth: number, level: number, out: SonarContact[] = [], limit = SONAR_LIMIT): SonarContact[] {
    out.length = 0;
    if (range <= 0) return out;
    const c0 = Math.floor((x - range) / FIND_CELL);
    const c1 = Math.floor((x + range) / FIND_CELL);
    const r0 = Math.floor((z - range) / FIND_CELL);
    const r1 = Math.floor((z + range) / FIND_CELL);
    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) {
        // A cell entirely out of range is skipped before its finds are worked out.
        const nearX = Math.max(column * FIND_CELL, Math.min(x, (column + 1) * FIND_CELL));
        const nearZ = Math.max(row * FIND_CELL, Math.min(z, (row + 1) * FIND_CELL));
        if (Math.hypot(nearX - x, nearZ - z) > range) continue;
        for (const find of findsInCell(column, row, this.world.depth, this.world.reef, this.cellFinds)) {
          if (!sonarRevealsTier(level, find.tier) || this.taken.has(find.key)) continue;
          if (Math.hypot(find.x - x, find.z - z) > range) continue;
          const depth = this.world.depth(find.x, find.z);
          if (depth > maxDepth) continue;
          out.push({ x: find.x, z: find.z, tier: find.tier, depth });
        }
      }
    }
    // The echoes worth most first, the nearest first among equals: a screen
    // of a few dozen marks, not a snowstorm of tin cans.
    if (out.length > limit) {
      out.sort((a, b) => b.tier - a.tier || Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      out.length = limit;
    }
    return out;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const layer of this.layers) {
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
      layer.mesh.dispose();
    }
    this.glints.geometry.dispose();
    this.glints.material.dispose();
  }
}
