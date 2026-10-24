import * as THREE from "three";

/**
 * Billowing smoke, ash and steam as lit, camera-facing puffs.
 *
 * Each puff is an instanced quad shaded like a lumpy ball: a tileable noise
 * texture breaks its outline into cauliflower billows and bends its normal,
 * the sun lights the side facing it, the sky fills the rest, and a glow
 * colour (lava below, a flare inside) lights its underside. Puffs are sorted
 * back to front every frame, so a column of a few hundred overlapping puffs
 * reads as one body of smoke rather than a stack of discs. Quads, not points,
 * so a puff close to the camera is never clamped to the GPU's point size.
 * Fogged like the rest of the scene. One draw call per instance.
 */

const vertexShader = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aSize;
  attribute vec4 aAlbedo;
  attribute vec3 aGlow;
  attribute float aSeed;
  uniform vec3 uLightDirection;
  varying vec2 vUv;
  varying vec4 vAlbedo;
  varying vec3 vGlow;
  varying float vSeed;
  varying vec3 vLight;
  varying vec3 vDown;
  varying float vForward;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = viewMatrix * vec4(aCenter, 1.0);
    // Each puff turned its own way, so the noise never repeats in step.
    float angle = aSeed * 6.2831;
    mat2 turn = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    mvPosition.xy += turn * position.xy * aSize;
    gl_Position = projectionMatrix * mvPosition;
    vUv = position.xy + 0.5;
    vAlbedo = aAlbedo;
    vGlow = aGlow;
    vSeed = aSeed;
    // Light and "down" in the puff's own (rotated) quad frame.
    vec3 light = (viewMatrix * vec4(uLightDirection, 0.0)).xyz;
    vec3 down = (viewMatrix * vec4(0.0, -1.0, 0.0, 0.0)).xyz;
    mat2 back = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vLight = vec3(back * light.xy, light.z);
    vDown = vec3(back * down.xy, down.z);
    // How nearly the viewer looks toward the light through this puff.
    vForward = max(dot(normalize(mvPosition.xyz), normalize(light)), 0.0);
    #include <fog_vertex>
    #ifdef USE_FOG
      // Smoke is denser than the haze between: it keeps its shape farther off.
      vFogDepth *= 0.62;
    #endif
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tNoise;
  uniform vec3 uSun;
  uniform vec3 uAmbient;
  uniform float uSoftness;
  varying vec2 vUv;
  varying vec4 vAlbedo;
  varying vec3 vGlow;
  varying float vSeed;
  varying vec3 vLight;
  varying vec3 vDown;
  varying float vForward;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    vec2 offset = vec2(fract(vSeed * 7.31), fract(vSeed * 3.17));
    vec4 coarse = texture2D(tNoise, vUv * 0.55 + offset);
    vec4 fine = texture2D(tNoise, vUv * 1.1 + offset.yx);
    float r2 = dot(p, p);
    // Cauliflower outline: billows eat into the disc.
    float billow = coarse.r * 0.7 + fine.g * 0.3;
    float density = smoothstep(1.0, uSoftness, r2 + (billow - 0.5) * 0.9);
    if (density < 0.004) discard;
    // A ball's normal, bent by the billows.
    // Billows: the noise is read as a height field and its slope bends the normal.
    vec2 texel = vec2(1.0 / 128.0);
    float hx = texture2D(tNoise, vUv * 0.55 + offset + vec2(texel.x * 3.0, 0.0)).r - coarse.r;
    float hy = texture2D(tNoise, vUv * 0.55 + offset + vec2(0.0, texel.y * 3.0)).r - coarse.r;
    float fx = texture2D(tNoise, vUv * 1.1 + offset.yx + vec2(texel.x * 3.0, 0.0)).g - fine.g;
    float fy = texture2D(tNoise, vUv * 1.1 + offset.yx + vec2(0.0, texel.y * 3.0)).g - fine.g;
    vec2 bump = vec2(hx, hy) * 13.0 + vec2(fx, fy) * 2.5;
    vec3 normal = normalize(vec3(p * 1.1 - bump, sqrt(max(0.0, 1.0 - min(r2, 1.0))) * 0.8 + 0.2));
    float facing = dot(normal, normalize(vLight));
    // Sunlit tops bright, the shadowed side dark: smoke is optically thick.
    float sun = clamp(facing, 0.0, 1.0) * 0.85 + clamp(facing + 0.35, 0.0, 1.0) * 0.15;
    // Deep in a billow it is darker (light scattered away before it got there).
    float cavity = 0.45 + 0.55 * smoothstep(0.2, 0.8, billow);
    vec3 color = vAlbedo.rgb * (uAmbient * 0.55 + uSun * sun) * cavity;
    // Silver lining: thin edges glow when the sun is behind the smoke.
    float rim = pow(1.0 - clamp(normal.z, 0.0, 1.0), 2.0) * (1.0 - density * 0.6);
    color += uSun * vAlbedo.rgb * (0.12 + 0.88 * rim) * pow(vForward, 8.0) * 0.45;
    float underside = clamp(dot(normal, normalize(vDown)) * 0.5 + 0.5, 0.0, 1.0);
    color += vGlow * (0.3 + 0.7 * underside) * (0.6 + 0.4 * billow);
    gl_FragColor = vec4(color, vAlbedo.a * density);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A tileable fBm value-noise texture: three independent channels. */
function noiseTexture(size = 128): THREE.DataTexture {
  const lattice = (cells: number, channel: number) => {
    const values = new Float32Array(cells * cells);
    let state = 1234567 + channel * 7919 + cells * 31;
    for (let index = 0; index < values.length; index += 1) {
      state = (state * 1103515245 + 12345) >>> 0;
      values[index] = state / 4294967296;
    }
    return (x: number, y: number): number => {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (cx: number, cy: number) => values[((cy % cells) + cells) % cells * cells + (((cx % cells) + cells) % cells)]!;
      const a = at(ix, iy);
      const b = at(ix + 1, iy);
      const c = at(ix, iy + 1);
      const d = at(ix + 1, iy + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  };
  const data = new Uint8Array(size * size * 4);
  for (let channel = 0; channel < 3; channel += 1) {
    const octaves = [lattice(4, channel), lattice(8, channel), lattice(16, channel), lattice(32, channel)];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const value = octaves[0]!(x, y) * 0.5 + octaves[1]!(x, y) * 0.27 + octaves[2]!(x, y) * 0.15 + octaves[3]!(x, y) * 0.08;
        data[(y * size + x) * 4 + channel] = Math.round(Math.min(1, Math.max(0, value)) * 255);
      }
    }
  }
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

let sharedNoise: THREE.DataTexture | null = null;
let noiseUsers = 0;

type Entry = { x: number; y: number; z: number; size: number; r: number; g: number; b: number; a: number; gr: number; gg: number; gb: number; seed: number; depth: number };

export class LitPuffs {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly entries: Entry[];
  private readonly order: Entry[] = [];
  private count = 0;
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly size: THREE.InstancedBufferAttribute;
  private readonly albedo: THREE.InstancedBufferAttribute;
  private readonly glow: THREE.InstancedBufferAttribute;
  private readonly seed: THREE.InstancedBufferAttribute;

  constructor(readonly capacity: number, options: { name?: string; softness?: number; renderOrder?: number } = {}) {
    sharedNoise ??= noiseTexture();
    noiseUsers += 1;
    this.entries = Array.from({ length: capacity }, () => ({ x: 0, y: 0, z: 0, size: 0, r: 0, g: 0, b: 0, a: 0, gr: 0, gg: 0, gb: 0, seed: 0, depth: 0 }));
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const dynamic = <T extends THREE.InstancedBufferAttribute>(attribute: T): T => {
      attribute.setUsage(THREE.DynamicDrawUsage);
      return attribute;
    };
    this.center = dynamic(new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    this.size = dynamic(new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    this.albedo = dynamic(new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    this.glow = dynamic(new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    this.seed = dynamic(new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("aCenter", this.center);
    geometry.setAttribute("aSize", this.size);
    geometry.setAttribute("aAlbedo", this.albedo);
    geometry.setAttribute("aGlow", this.glow);
    geometry.setAttribute("aSeed", this.seed);
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      name: options.name ?? "LitPuffs",
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          tNoise: { value: null },
          uLightDirection: { value: new THREE.Vector3(0.3, 0.8, 0.5) },
          uSun: { value: new THREE.Color(1, 1, 1) },
          uAmbient: { value: new THREE.Color(0.4, 0.45, 0.5) },
          uSoftness: { value: options.softness ?? 0.2 },
        },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    material.uniforms.tNoise!.value = sharedNoise;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder ?? 5;
    this.mesh.visible = false;
    this.mesh.name = options.name ?? "LitPuffs";
  }

  /** The light the puffs are seen by (linear colours, direction toward the light). */
  setLight(direction: THREE.Vector3, sun: THREE.Color | readonly number[], ambient: readonly number[]): void {
    const uniforms = this.mesh.material.uniforms;
    (uniforms.uLightDirection!.value as THREE.Vector3).copy(direction);
    const sunColor = uniforms.uSun!.value as THREE.Color;
    if (sun instanceof THREE.Color) sunColor.copy(sun);
    else sunColor.setRGB(sun[0]!, sun[1]!, sun[2]!);
    (uniforms.uAmbient!.value as THREE.Color).setRGB(ambient[0]!, ambient[1]!, ambient[2]!);
  }

  begin(): void {
    this.count = 0;
  }

  /** One puff: centre, diameter (m), albedo and opacity, emitted glow, seed 0…1. */
  push(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number, gr = 0, gg = 0, gb = 0, seed = 0): void {
    if (this.count >= this.capacity || a <= 0.003 || size <= 0) return;
    const entry = this.entries[this.count]!;
    entry.x = x;
    entry.y = y;
    entry.z = z;
    entry.size = size;
    entry.r = r;
    entry.g = g;
    entry.b = b;
    entry.a = a;
    entry.gr = gr;
    entry.gg = gg;
    entry.gb = gb;
    entry.seed = seed;
    this.count += 1;
  }

  /** Sorts back to front from `eye` and uploads. */
  end(eye: THREE.Vector3): void {
    const order = this.order;
    order.length = 0;
    for (let index = 0; index < this.count; index += 1) {
      const entry = this.entries[index]!;
      entry.depth = (entry.x - eye.x) ** 2 + (entry.y - eye.y) ** 2 + (entry.z - eye.z) ** 2;
      order.push(entry);
    }
    order.sort((a, b) => b.depth - a.depth);
    for (let index = 0; index < order.length; index += 1) {
      const entry = order[index]!;
      this.center.setXYZ(index, entry.x, entry.y, entry.z);
      this.size.setX(index, entry.size);
      this.albedo.setXYZW(index, entry.r, entry.g, entry.b, entry.a);
      this.glow.setXYZ(index, entry.gr, entry.gg, entry.gb);
      this.seed.setX(index, entry.seed);
    }
    this.center.needsUpdate = true;
    this.size.needsUpdate = true;
    this.albedo.needsUpdate = true;
    this.glow.needsUpdate = true;
    this.seed.needsUpdate = true;
    this.mesh.geometry.instanceCount = order.length;
    this.mesh.visible = order.length > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
    noiseUsers -= 1;
    if (noiseUsers <= 0 && sharedNoise) {
      sharedNoise.dispose();
      sharedNoise = null;
    }
  }
}
