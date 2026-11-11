import * as THREE from "three";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import { patchMaterialShader } from "../core/ShaderPatch";
import { clamp } from "../math";

/**
 * Fish that keep a diver company in open water, where the reef fish (which
 * live on the island shelves) are not: schools of silvery jacks that wheel
 * round him, glinting as they turn, and little blue-and-yellow fish that
 * hang over the coral heads.
 *
 * Boids (separation, alignment, cohesion) with a home that drifts with the
 * diver, a depth band, the sand and the surface as walls, and the diver
 * himself as something to keep a respectful distance from. Each fish is an
 * instance of a lofted body whose tail beats in the vertex shader.
 */

type Species = {
  name: string;
  length: number;
  count: number;
  speed: number;
  /** Colours: back, flank, belly, and a stripe. */
  back: number;
  flank: number;
  belly: number;
  stripe: number;
  /** How close they come to the diver, m. */
  shy: number;
  /** Depth band over the bottom (m above the sand). */
  above: [number, number];
  /** How far round the diver the school ranges, m. */
  range: number;
};

const SPECIES: readonly Species[] = [
  { name: "jack", length: 0.42, count: 34, speed: 1.4, back: 0x42607a, flank: 0xc7d2da, belly: 0xf0f2f2, stripe: 0xe8c040, shy: 2.6, above: [2, 9], range: 16 },
  { name: "chromis", length: 0.11, count: 46, speed: 0.6, back: 0x2a6fd0, flank: 0x3d8ee8, belly: 0xa8d8f8, stripe: 0xffd84a, shy: 1.2, above: [0.5, 2.5], range: 9 },
  { name: "fusilier", length: 0.24, count: 40, speed: 1.1, back: 0x3a78c8, flank: 0x9cc8ec, belly: 0xf4e8d8, stripe: 0xf0c830, shy: 2.0, above: [3, 10], range: 20 },
];

type Fish = { x: number; y: number; z: number; vx: number; vy: number; vz: number; phase: number; wiggle: number };

type School = { species: Species; fish: Fish[]; mesh: THREE.InstancedMesh; homeX: number; homeY: number; homeZ: number; wanderPhase: number };

/** A fish body along +Z, unit length, its tail at z = −0.5 (vertex attribute `along` 0 at the tail … 1 at the nose). */
function fishGeometry(): THREE.BufferGeometry {
  const rings = 14;
  const segments = 12;
  const positions: number[] = [];
  const along: number[] = [];
  const indices: number[] = [];
  const profile = (t: number) => {
    // Width and height of the body at t (0 tail … 1 nose).
    const body = Math.sin(Math.PI * Math.pow(t, 0.75)) ;
    return { w: 0.075 * body + 0.006, h: 0.13 * body + 0.012 };
  };
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const { w, h } = profile(t);
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      positions.push(Math.sin(angle) * w, Math.cos(angle) * h, t - 0.5);
      along.push(t);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let step = 0; step < segments; step += 1) {
      const a = ring * segments + step;
      const b = ring * segments + ((step + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      indices.push(a, b, c, b, d, c);
    }
  }
  // The forked tail: two triangles fanning out behind.
  const base = positions.length / 3;
  positions.push(0, 0, -0.5, 0, 0.13, -0.66, 0, 0.02, -0.58, 0, -0.13, -0.66, 0, -0.02, -0.58);
  along.push(0, -0.1, -0.06, -0.1, -0.06);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 1, base, base + 3, base + 4, base, base + 4, base + 3);
  // Dorsal fin.
  const fin = positions.length / 3;
  positions.push(0, 0.12, 0.12, 0, 0.2, -0.02, 0, 0.11, -0.18);
  along.push(0.62, 0.48, 0.32);
  indices.push(fin, fin + 1, fin + 2, fin, fin + 2, fin + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const position = new THREE.Vector3();
const forward = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class DiveFish {
  readonly group = new THREE.Group();
  private readonly schools: School[] = [];
  private readonly time = { value: 0 };
  private placed = false;

  constructor(scene: THREE.Scene, underwater: UnderwaterLight) {
    this.group.name = "Dive_Fish";
    scene.add(this.group);
    const geometry = fishGeometry();
    SPECIES.forEach((species, index) => {
      const material = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.35, side: THREE.DoubleSide });
      this.fishSurface(material, species, index);
      underwater.apply(material);
      const mesh = new THREE.InstancedMesh(geometry, material, species.count);
      mesh.name = `DiveFish_${species.name}`;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      const fish: Fish[] = [];
      for (let n = 0; n < species.count; n += 1) fish.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, phase: Math.random() * 10, wiggle: 0 });
      this.schools.push({ species, fish, mesh, homeX: 0, homeY: 0, homeZ: 0, wanderPhase: Math.random() * 100 });
    });
    this.group.visible = false;
  }

  /** Countershading, stripe, scales' glint; the tail beat. */
  private fishSurface(material: THREE.MeshStandardMaterial, species: Species, index: number): void {
    const time = this.time;
    const back = new THREE.Color(species.back);
    const flank = new THREE.Color(species.flank);
    const belly = new THREE.Color(species.belly);
    const stripe = new THREE.Color(species.stripe);
    patchMaterialShader(material, `dive-fish-${index}`, (shader) => {
      shader.uniforms.uFishTime = time;
      shader.uniforms.uBack = { value: back };
      shader.uniforms.uFlank = { value: flank };
      shader.uniforms.uBelly = { value: belly };
      shader.uniforms.uStripe = { value: stripe };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute float along;
          uniform float uFishTime;
          varying vec3 vFish;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vFish = position;
          {
            #ifdef USE_INSTANCING
              float seed = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
            #else
              float seed = 0.0;
            #endif
            // A travelling wave down the body, growing toward the tail.
            float amplitude = pow(1.0 - clamp(along, -0.2, 1.0), 2.0) * 0.12;
            transformed.x += sin(uFishTime * ${(9 + index * 3).toFixed(1)} + seed - along * 5.0) * amplitude;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform vec3 uBack;
          uniform vec3 uFlank;
          uniform vec3 uBelly;
          uniform vec3 uStripe;
          varying vec3 vFish;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          {
            float up = vFish.y / 0.14;
            vec3 c = mix(uBelly, uFlank, smoothstep(-0.7, 0.0, up));
            c = mix(c, uBack, smoothstep(0.2, 0.75, up));
            // A stripe along the flank (and the yellow tail of a fusilier).
            c = mix(c, uStripe, (1.0 - smoothstep(0.03, 0.09, abs(up - 0.18))) * 0.8);
            c = mix(c, uStripe, smoothstep(-0.48, -0.58, vFish.z) * ${index === 2 ? "0.9" : "0.0"});
            // The eye.
            float eye = length(vec2(vFish.z - 0.38, vFish.y - 0.02));
            c = mix(c, vec3(0.02), 1.0 - smoothstep(0.012, 0.018, eye));
            diffuseColor.rgb = c;
          }`,
        );
    });
  }

  /**
   * One frame. `diver` is the diver's eyes; `ground(x, z)` the sand's height;
   * `surface(x, z)` the water's. `presence` 1 … 0: below 1 the schools
   * leave (a storm), heading off into the murk, and at 0 they are gone.
   */
  update(
    delta: number,
    active: boolean,
    diver: THREE.Vector3,
    ground: (x: number, z: number) => number,
    surface: (x: number, z: number) => number,
    presence = 1,
  ): void {
    active = active && presence > 0;
    this.group.visible = active;
    if (!active) {
      this.placed = false;
      return;
    }
    const dt = clamp(delta, 0, 0.05);
    this.time.value += dt;
    for (const school of this.schools) {
      const species = school.species;
      // The school's home wanders round the diver.
      school.wanderPhase += dt * 0.05;
      const angle = school.wanderPhase * 2 + species.length * 40;
      // Leaving: the home slides away from the diver, far into the murk.
      const away = species.range * 0.6 + (1 - presence) * 80;
      const homeX = diver.x + Math.cos(angle) * away;
      const homeZ = diver.z + Math.sin(angle * 1.3) * away;
      const sand = ground(homeX, homeZ);
      const top = surface(homeX, homeZ) - 1.2;
      const homeY = clamp(sand + (species.above[0] + species.above[1]) * 0.5, sand + species.above[0], top);
      if (!this.placed || (presence >= 1 && Math.hypot(school.homeX - diver.x, school.homeZ - diver.z) > species.range * 3)) {
        // (Re)start out of sight: round the home, swimming the same way.
        for (const fish of school.fish) {
          fish.x = homeX + (Math.random() - 0.5) * 4;
          fish.y = homeY + (Math.random() - 0.5) * 2;
          fish.z = homeZ + (Math.random() - 0.5) * 4;
          fish.vx = Math.cos(angle) * species.speed;
          fish.vy = 0;
          fish.vz = Math.sin(angle) * species.speed;
        }
      }
      school.homeX = homeX;
      school.homeY = homeY;
      school.homeZ = homeZ;
      this.steer(school, dt, diver, ground, surface, 1 + (1 - presence) * 1.6);
    }
    this.placed = true;
  }

  private steer(
    school: School,
    dt: number,
    diver: THREE.Vector3,
    ground: (x: number, z: number) => number,
    surface: (x: number, z: number) => number,
    hurry: number,
  ): void {
    const species = school.species;
    const fish = school.fish;
    const length = species.length;
    // School centre and heading.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const f of fish) {
      cx += f.x;
      cy += f.y;
      cz += f.z;
      ax += f.vx;
      ay += f.vy;
      az += f.vz;
    }
    const n = fish.length;
    cx /= n;
    cy /= n;
    cz /= n;
    ax /= n;
    ay /= n;
    az /= n;
    const spacing = length * 2.2;
    for (let index = 0; index < n; index += 1) {
      const f = fish[index]!;
      let fx = 0;
      let fy = 0;
      let fz = 0;
      // Separation from the nearest few (a stride through the school keeps it cheap).
      for (let k = 1; k <= 6; k += 1) {
        const other = fish[(index + k * 7) % n]!;
        const dx = f.x - other.x;
        const dy = f.y - other.y;
        const dz = f.z - other.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < spacing * spacing && d2 > 1e-6) {
          const push = (spacing * spacing - d2) / (spacing * spacing);
          fx += dx * push * 6;
          fy += dy * push * 6;
          fz += dz * push * 6;
        }
      }
      // Cohesion and alignment.
      fx += (cx - f.x) * 0.35 + (ax - f.vx) * 0.6;
      fy += (cy - f.y) * 0.35 + (ay - f.vy) * 0.6;
      fz += (cz - f.z) * 0.35 + (az - f.vz) * 0.6;
      // Home.
      fx += (school.homeX - f.x) * 0.06 * hurry;
      fy += (school.homeY - f.y) * 0.12;
      fz += (school.homeZ - f.z) * 0.06 * hurry;
      // Keep clear of the diver: a bubble they will not enter.
      const dx = f.x - diver.x;
      const dy = f.y - diver.y;
      const dz = f.z - diver.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < species.shy * 2 && d > 1e-3) {
        const flee = (species.shy * 2 - d) / species.shy;
        fx += (dx / d) * flee * 5;
        fy += (dy / d) * flee * 3;
        fz += (dz / d) * flee * 5;
      }
      // The sand and the surface.
      const sand = ground(f.x, f.z);
      if (f.y < sand + species.above[0]) fy += (sand + species.above[0] - f.y) * 3;
      const top = surface(f.x, f.z) - 0.8;
      if (f.y > top) fy -= (f.y - top) * 4;
      f.vx += fx * dt;
      f.vy += fy * dt;
      f.vz += fz * dt;
      // Cruise speed, a little faster when fleeing.
      const speed = Math.hypot(f.vx, f.vy, f.vz);
      const want = species.speed * (d < species.shy * 1.5 ? 1.8 : 1) * hurry;
      const k = speed > 1e-4 ? clamp(speed + (want - speed) * dt * 2, want * 0.4, want * 2.2) / speed : 1;
      f.vx *= k;
      f.vy *= k * 0.7;
      f.vz *= k;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      // Pose: nose along the velocity, the body level-ish.
      forward.set(f.vx, f.vy * 0.6, f.vz).normalize();
      quaternion.setFromUnitVectors(Z, forward);
      scale.setScalar(length * (0.85 + ((index * 37) % 10) * 0.03));
      position.set(f.x, f.y, f.z);
      matrix.compose(position, quaternion, scale);
      school.mesh.setMatrixAt(index, matrix);
    }
    school.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const school of this.schools) {
      (school.mesh.material as THREE.Material).dispose();
      school.mesh.dispose();
    }
    this.schools[0]?.mesh.geometry.dispose();
  }
}
