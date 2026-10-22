import * as THREE from "three";
import {
  CONTRAIL_FORMATION_TIME,
  CONTRAIL_INITIAL_WIDTH,
  CONTRAIL_SPREAD_RATE,
} from "./AviationMath";

// Instance layout (floats): p0.xyz, p1.xyz, t0.xyz, t1.xyz, birth0, birth1,
// distance0, distance1, lifetime, seed.
const STRIDE = 18;
const DEAD_BIRTH = -1e6;

const vertexShader = /* glsl */ `
  attribute vec2 corner;
  attribute vec3 p0;
  attribute vec3 p1;
  attribute vec3 t0;
  attribute vec3 t1;
  attribute vec2 birth;
  attribute vec2 trailDistance;
  attribute vec2 lifeSeed;
  uniform float uTime;
  uniform vec3 uWind;
  varying float vAcross;
  varying float vAlong;
  varying float vAge;
  varying float vOpacity;
  varying float vLife;
  varying float vSeed;

  // Mirrors contrailWidth() and contrailOpacity() in AviationMath.ts.
  float contrailWidth(float age) {
    return ${CONTRAIL_INITIAL_WIDTH.toFixed(4)} + ${CONTRAIL_SPREAD_RATE.toFixed(4)} * sqrt(max(age, 0.0));
  }

  float contrailOpacity(float age, float lifetime) {
    if (age < 0.0 || age >= lifetime) return 0.0;
    float formation = smoothstep(0.0, ${CONTRAIL_FORMATION_TIME.toFixed(4)}, age);
    float dissipation = 1.0 - smoothstep(lifetime * 0.3, lifetime, age);
    float thinning = pow(${(CONTRAIL_INITIAL_WIDTH * 2.4).toFixed(4)} / (contrailWidth(age) + ${(CONTRAIL_INITIAL_WIDTH * 1.4).toFixed(4)}), 0.32);
    return clamp(formation * dissipation * thinning, 0.0, 1.0);
  }

  void main() {
    float lifetime = lifeSeed.x;
    if (uTime - max(birth.x, birth.y) >= lifetime) {
      // Both ends expired (or the slot was never used): emit a clipped vertex.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float endpoint = corner.x;
    float age = uTime - mix(birth.x, birth.y, endpoint);
    // Older ice drifts downwind and sinks very slightly.
    vec3 local = mix(p0, p1, endpoint) + uWind * max(age, 0.0) + vec3(0.0, -0.012, 0.0) * max(age, 0.0);
    vec3 tangent = normalize(mix(t0, t1, endpoint) + vec3(0.0, 1e-4, 0.0));
    vec4 world = modelMatrix * vec4(local, 1.0);
    vec3 worldTangent = normalize(mat3(modelMatrix) * tangent);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec3 side = normalize(cross(worldTangent, toCamera) + vec3(1e-5));
    float width = contrailWidth(age);
    world.xyz += side * corner.y * width * 0.5;

    float horizon = smoothstep(0.015, 0.16, -toCamera.y);
    vOpacity = contrailOpacity(age, lifetime) * horizon;
    vAcross = corner.y;
    vAlong = mix(trailDistance.x, trailDistance.y, endpoint);
    vAge = max(age, 0.0);
    vLife = lifetime;
    vSeed = lifeSeed.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vAcross;
  varying float vAlong;
  varying float vAge;
  varying float vOpacity;
  varying float vLife;
  varying float vSeed;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    if (vOpacity <= 0.002) discard;
    float across = vAcross;
    // Soft Gaussian cross-section with a slightly denser core when young.
    float youth = 1.0 - smoothstep(0.0, 25.0, vAge);
    float profile = exp(-across * across * mix(2.6, 4.2, youth));
    vec2 coordinate = vec2(vAlong * 0.018 + vSeed * 17.0, across * 1.3 + vAge * 0.004);
    float billows = noise(coordinate * 1.7) * 0.6 + noise(coordinate * 4.3 + 3.1) * 0.4;
    // Ageing trails fragment into irregular patches before they disappear.
    float decay = smoothstep(0.15, 0.85, vAge / vLife);
    float breakup = smoothstep(decay * 0.75 - 0.05, decay * 0.75 + 0.22, billows);
    float alpha = vOpacity * profile * mix(1.0, breakup, decay) * (0.82 + billows * 0.18);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor * uIntensity * (0.94 + billows * 0.08), alpha);
  }
`;

type Trail = {
  head: number;
  lastPoint: THREE.Vector3;
  lastTangent: THREE.Vector3;
  lastBirth: number;
  lastDistance: number;
  lifetime: number;
  seed: number;
};

/**
 * A single bounded pool of camera-facing contrail segments. Every engine trail
 * appends segments into the shared ring and keeps one live head segment that
 * is stretched to the engine each frame, so a trail grows continuously rather
 * than in sample-sized steps. Width, opacity, drift and break-up are evaluated
 * on the GPU from the stored birth times; the CPU only writes touched slots.
 */
export class ContrailField {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly data: Float32Array;
  private readonly trails = new Map<number, Trail>();
  private readonly uniforms: {
    uTime: THREE.IUniform<number>;
    uWind: THREE.IUniform<THREE.Vector3>;
    uColor: THREE.IUniform<THREE.Color>;
    uIntensity: THREE.IUniform<number>;
  };
  private readonly scratchTangent = new THREE.Vector3();
  private nextSlot = 0;
  private nextTrailId = 1;
  private time = 0;

  constructor(parent: THREE.Object3D, private readonly capacity: number) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      "corner",
      new THREE.Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1], 2),
    );
    geometry.setIndex([0, 2, 1, 2, 3, 1]);
    this.data = new Float32Array(capacity * STRIDE);
    for (let slot = 0; slot < capacity; slot += 1) {
      this.data[slot * STRIDE + 12] = DEAD_BIRTH;
      this.data[slot * STRIDE + 13] = DEAD_BIRTH;
      this.data[slot * STRIDE + 16] = 1;
      this.data[slot * STRIDE + 9] = 1;
      this.data[slot * STRIDE + 6] = 1;
    }
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("p0", new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    geometry.setAttribute("p1", new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    geometry.setAttribute("t0", new THREE.InterleavedBufferAttribute(this.buffer, 3, 6));
    geometry.setAttribute("t1", new THREE.InterleavedBufferAttribute(this.buffer, 3, 9));
    geometry.setAttribute("birth", new THREE.InterleavedBufferAttribute(this.buffer, 2, 12));
    geometry.setAttribute("trailDistance", new THREE.InterleavedBufferAttribute(this.buffer, 2, 14));
    geometry.setAttribute("lifeSeed", new THREE.InterleavedBufferAttribute(this.buffer, 2, 16));
    geometry.instanceCount = capacity;

    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3(0.55, 0, 0.3) },
      uColor: { value: new THREE.Color(0xffffff) },
      uIntensity: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "Contrail_Field";
    this.mesh.frustumCulled = false;
    // After the sky dome (-100) and stars (-80), before ordinary scene content.
    this.mesh.renderOrder = -60;
    parent.add(this.mesh);
  }

  get clock(): number {
    return this.time;
  }

  advance(delta: number): void {
    this.time += delta;
    this.uniforms.uTime.value = this.time;
  }

  setAppearance(color: THREE.Color, intensity: number): void {
    this.uniforms.uColor.value.copy(color);
    this.uniforms.uIntensity.value = intensity;
  }

  startTrail(origin: THREE.Vector3, tangent: THREE.Vector3, lifetime: number): number {
    const id = this.nextTrailId;
    this.nextTrailId += 1;
    const trail: Trail = {
      head: -1,
      lastPoint: origin.clone(),
      lastTangent: tangent.clone().normalize(),
      lastBirth: this.time,
      lastDistance: 0,
      lifetime,
      seed: Math.random(),
    };
    trail.head = this.allocate();
    this.writeSegment(trail.head, trail, origin, trail.lastTangent);
    this.trails.set(id, trail);
    return id;
  }

  /** Stretches the live head to the engine and commits a sample every spacing meters. */
  extendTrail(id: number, position: THREE.Vector3, tangent: THREE.Vector3, spacing: number): void {
    const trail = this.trails.get(id);
    if (!trail) return;
    this.scratchTangent.copy(tangent).normalize();
    const travelled = position.distanceTo(trail.lastPoint);
    this.writeSegment(trail.head, trail, position, this.scratchTangent);
    if (travelled < spacing) return;
    trail.lastPoint.copy(position);
    trail.lastTangent.copy(this.scratchTangent);
    trail.lastBirth = this.time;
    trail.lastDistance += travelled;
    trail.head = this.allocate();
    this.writeSegment(trail.head, trail, position, this.scratchTangent);
  }

  /** Stops emitting; existing segments keep ageing on the GPU until they expire. */
  endTrail(id: number): void {
    this.trails.delete(id);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.trails.clear();
  }

  private allocate(): number {
    // The ring is sized so recycled slots belong to segments that have
    // already dissipated; at worst the very oldest tail is trimmed early.
    const slot = this.nextSlot;
    this.nextSlot = (this.nextSlot + 1) % this.capacity;
    const offset = slot * STRIDE;
    this.data[offset + 12] = DEAD_BIRTH;
    this.data[offset + 13] = DEAD_BIRTH;
    return slot;
  }

  private writeSegment(slot: number, trail: Trail, end: THREE.Vector3, endTangent: THREE.Vector3): void {
    const offset = slot * STRIDE;
    const data = this.data;
    data[offset] = trail.lastPoint.x;
    data[offset + 1] = trail.lastPoint.y;
    data[offset + 2] = trail.lastPoint.z;
    data[offset + 3] = end.x;
    data[offset + 4] = end.y;
    data[offset + 5] = end.z;
    data[offset + 6] = trail.lastTangent.x;
    data[offset + 7] = trail.lastTangent.y;
    data[offset + 8] = trail.lastTangent.z;
    data[offset + 9] = endTangent.x;
    data[offset + 10] = endTangent.y;
    data[offset + 11] = endTangent.z;
    data[offset + 12] = trail.lastBirth;
    data[offset + 13] = this.time;
    data[offset + 14] = trail.lastDistance;
    data[offset + 15] = trail.lastDistance + trail.lastPoint.distanceTo(end);
    data[offset + 16] = trail.lifetime;
    data[offset + 17] = trail.seed;
    this.buffer.addUpdateRange(offset, STRIDE);
    this.buffer.needsUpdate = true;
  }
}
