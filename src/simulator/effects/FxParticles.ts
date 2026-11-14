import * as THREE from "three";

/**
 * The fight's particle engine: every tracer, spark, flame, puff of smoke and
 * chip of debris in one instanced draw call.
 *
 * A particle is written once, when it is born (where, how fast, how long,
 * how it looks), and never touched again: the vertex shader works out where
 * it is from its age (drag, gravity, a bounce off a floor), so the CPU cost
 * of ten thousand particles is that of the handful born this frame. The
 * pool is a ring; nothing is allocated after construction.
 *
 * Three looks share the draw call:
 * - glow (`additive`): flashes, sparks, tracers. HDR, so they bloom;
 * - fire (`additive` + `textured`): cloud-shaped flame that cools from
 *   white-yellow through orange to dull red over its life;
 * - smoke (`textured`): cloud-shaped, lit by the sky, the sun and up to two
 *   fires (a blast, something burning), fogged like the scene.
 *
 * A particle with `stretch` is drawn as a ribbon from where it was a moment
 * ago to where it is (a tracer's streak, a spark's trail), built in view
 * space so it foreshortens correctly coming toward the eye.
 *
 * Output is premultiplied (`ONE, ONE_MINUS_SRC_ALPHA`): glow writes colour
 * with zero alpha, smoke colour × alpha with its alpha, so fire shows
 * through smoke drawn before it and is veiled by smoke drawn after.
 */

/** No floor under a particle: it never bounces. */
export const NO_FLOOR = -1e4;

const PUFF_SIZE = 128;

/** A tileable-enough cloud: `r` how lit a lump is, `a` its density. Built from numbers, so it also works without a DOM. */
function createPuffTexture(): THREE.DataTexture {
  const size = PUFF_SIZE;
  const data = new Uint8Array(size * size * 4);
  const density = new Float32Array(size * size);
  const shade = new Float32Array(size * size);
  let seed = 9173;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let blob = 0; blob < 52; blob += 1) {
    const angle = random() * Math.PI * 2;
    const reach = Math.sqrt(random()) * size * 0.25;
    const cx = size / 2 + Math.cos(angle) * reach;
    const cy = size / 2 + Math.sin(angle) * reach;
    const radius = size * (0.11 + random() * 0.14);
    const tone = 0.5 + random() * 0.5;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(size - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(size - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x - cx, y - cy) / radius;
        if (d >= 1) continue;
        const fall = (1 - d * d) * (1 - d * d) * 0.38;
        const index = y * size + x;
        // Lumps toward the top are the lit ones.
        const lit = tone * (0.72 + 0.28 * (y / size));
        const before = density[index]!;
        shade[index] = before < 1e-4 ? lit : shade[index]! * (1 - fall) + lit * fall;
        density[index] = 1 - (1 - before) * (1 - fall);
      }
    }
  }
  for (let index = 0; index < size * size; index += 1) {
    const value = Math.round(Math.min(1, shade[index]!) * 255);
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = Math.round(Math.min(1, density[index]!) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const vertexShader = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aVelocity;
  attribute vec4 aTiming;
  attribute vec4 aColor;
  attribute vec4 aMotion;
  attribute vec4 aLook;
  uniform float uTime;
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec4 vLook;
  varying float vAge;
  varying float vRibbon;
  varying float vNear;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    float age = uTime - aTiming.x;
    float t = age / aTiming.y;
    if (age < 0.0 || t >= 1.0) {
      gl_Position = vec4(0.0, 0.0, -9.0, 1.0);
      return;
    }
    // Drag slows it exponentially; gravity (or buoyancy) is added on top.
    float k = max(aMotion.y, 1e-3);
    float e = exp(-k * age);
    vec3 p = aStart + aVelocity * (1.0 - e) / k + vec3(0.0, -0.5 * aMotion.x * age * age, 0.0);
    vec3 v = aVelocity * e + vec3(0.0, -aMotion.x * age, 0.0);
    float floorY = aLook.w;
    if (floorY > -9000.0 && p.y < floorY) {
      p.y = floorY + abs(p.y - floorY) * 0.28;
      v.y = abs(v.y) * 0.3;
      v.xz *= 0.5;
    }
    float size = mix(aTiming.z, aTiming.w, 1.0 - (1.0 - t) * (1.0 - t));
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    vRibbon = 0.0;
    if (aMotion.z > 0.0) {
      vec3 viewVelocity = mat3(viewMatrix) * v;
      float speed = length(viewVelocity);
      // Never longer than the way it has come: a tracer does not reach back behind the muzzle.
      float span = min(speed * aMotion.z, speed * age) + size;
      vec3 along = viewVelocity / max(speed, 1e-4);
      vec3 point = mix(mvPosition.xyz - along * span, mvPosition.xyz, position.y + 0.5);
      vec3 side = normalize(cross(along, normalize(point)) + vec3(1e-5, 0.0, 0.0));
      mvPosition.xyz = point + side * position.x * size;
      vRibbon = 1.0;
    } else {
      float turn = aMotion.w * 6.2831 + age * (aMotion.w - 0.5) * 1.4;
      vec2 corner = position.xy * size;
      float c = cos(turn);
      float s = sin(turn);
      mvPosition.xy += vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
    }
    vUv = uv;
    vColor = aColor;
    vLook = aLook;
    vAge = t;
    vWorld = p;
    // A puff the eye is inside thins away instead of filling the view.
    vNear = smoothstep(0.06, 0.55 + size * 0.35 * aLook.y, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uPuff;
  uniform vec3 uAmbient;
  uniform vec3 uSun;
  uniform vec3 uLightA;
  uniform vec3 uLightAColor;
  uniform vec3 uLightB;
  uniform vec3 uLightBColor;
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec4 vLook;
  varying float vAge;
  varying float vRibbon;
  varying float vNear;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    vec2 centred = vUv - 0.5;
    float cover;
    float lump = 1.0;
    if (vLook.y > 0.5) {
      vec4 cloud = texture2D(uPuff, vUv);
      cover = cloud.a;
      lump = cloud.r;
    } else if (vRibbon > 0.5) {
      cover = (1.0 - smoothstep(0.04, 0.5, abs(centred.x))) * (1.0 - smoothstep(0.25, 0.5, abs(centred.y)));
    } else {
      cover = 1.0 - smoothstep(0.0, 0.5, length(centred));
      cover *= cover;
    }
    float fade = pow(max(1.0 - vAge, 0.0), vLook.z);
    float fogFactor = 0.0;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #endif
    vec3 color = vColor.rgb;
    if (vLook.x > 0.5) {
      if (vLook.y > 0.5) {
        // Flame: white-hot at birth, orange, then a dull red as it cools.
        color *= mix(vec3(1.7, 1.3, 0.85), vec3(1.0, 0.26, 0.04), smoothstep(0.0, 0.65, vAge));
        cover = cover * cover * 1.7;
      }
      float alpha = cover * vColor.a * fade * (1.0 - fogFactor) * vNear;
      gl_FragColor = vec4(color * alpha, 0.0);
    } else {
      fade *= smoothstep(0.0, 0.1, vAge);
      vec3 toA = uLightA - vWorld;
      vec3 toB = uLightB - vWorld;
      vec3 light = uAmbient + uSun * (0.25 + 0.75 * lump)
        + uLightAColor / (1.0 + dot(toA, toA) * 0.1)
        + uLightBColor / (1.0 + dot(toB, toB) * 0.22);
      color = color * light * (0.55 + 0.6 * lump);
      #ifdef USE_FOG
        color = mix(color, fogColor, fogFactor);
      #endif
      float alpha = clamp(cover * vColor.a * fade, 0.0, 1.0) * vNear;
      gl_FragColor = vec4(color * alpha, alpha);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** How a particle looks and moves; see `FxParticles.emit`. */
export type FxLook = {
  /** Glow (true) or lit smoke (false). */
  additive: boolean;
  /** Cloud-shaped rather than a soft dot or a ribbon. */
  textured: boolean;
  /** Downward acceleration, m/s² (negative: it rises). */
  gravity: number;
  /** Exponential drag, 1/s. */
  drag: number;
  /** Seconds of travel its ribbon spans (0: a camera-facing quad). */
  stretch: number;
  /** Exponent of the fade over its life (0: full brightness until it ends). */
  fade: number;
};

export class FxParticles {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly start: THREE.InstancedBufferAttribute;
  private readonly velocity: THREE.InstancedBufferAttribute;
  private readonly timing: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly motion: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly attributes: THREE.InstancedBufferAttribute[];
  private next = 0;
  private used = 0;
  private dirtyLow: number;
  private dirtyHigh = -1;
  private wrapped = false;
  private clock = 0;
  /** When the longest-lived particle now in the air ends. */
  private lastEnd = 0;

  constructor(readonly capacity: number, options: { name?: string; renderOrder?: number } = {}) {
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.setIndex(quad.getIndex());
    geometry.setAttribute("position", quad.getAttribute("position"));
    geometry.setAttribute("uv", quad.getAttribute("uv"));
    const attribute = (name: string, size: number) => {
      const value = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      value.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, value);
      return value;
    };
    this.start = attribute("aStart", 3);
    this.velocity = attribute("aVelocity", 3);
    this.timing = attribute("aTiming", 4);
    this.color = attribute("aColor", 4);
    this.motion = attribute("aMotion", 4);
    this.look = attribute("aLook", 4);
    this.attributes = [this.start, this.velocity, this.timing, this.color, this.motion, this.look];
    for (let index = 0; index < capacity; index += 1) {
      this.timing.array[index * 4] = -1e4;
      this.timing.array[index * 4 + 1] = 1;
    }
    geometry.instanceCount = 0;
    this.dirtyLow = capacity;
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uPuff: { value: null },
          uAmbient: { value: new THREE.Color(0.5, 0.52, 0.56) },
          uSun: { value: new THREE.Color(0.6, 0.58, 0.52) },
          uLightA: { value: new THREE.Vector3() },
          uLightAColor: { value: new THREE.Color(0, 0, 0) },
          uLightB: { value: new THREE.Vector3() },
          uLightBColor: { value: new THREE.Color(0, 0, 0) },
        },
      ]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    material.uniforms.uPuff!.value = createPuffTexture();
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = options.name ?? "FxParticles";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder ?? 3;
  }

  /** Particles now alive (an upper bound: the pool's high-water mark while anything is in the air). */
  get live(): number {
    return this.clock < this.lastEnd ? this.used : 0;
  }

  /**
   * One particle: born at (x, y, z) moving at (vx, vy, vz) m/s, alive for
   * `life` s, growing from `size0` to `size1` m, coloured (r, g, b) × `alpha`.
   * `floor`: a height it bounces off (`NO_FLOOR` for none).
   */
  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number,
    r: number, g: number, b: number, alpha: number,
    look: FxLook, floor = NO_FLOOR,
  ): void {
    const index = this.next;
    this.next += 1;
    if (this.next >= this.capacity) {
      this.next = 0;
      this.wrapped = true;
    }
    if (index < this.dirtyLow) this.dirtyLow = index;
    if (index > this.dirtyHigh) this.dirtyHigh = index;
    if (index + 1 > this.used) this.used = index + 1;
    let at = index * 3;
    let array = this.start.array;
    array[at] = x;
    array[at + 1] = y;
    array[at + 2] = z;
    array = this.velocity.array;
    array[at] = vx;
    array[at + 1] = vy;
    array[at + 2] = vz;
    at = index * 4;
    array = this.timing.array;
    array[at] = this.clock;
    array[at + 1] = life;
    array[at + 2] = size0;
    array[at + 3] = size1;
    array = this.color.array;
    array[at] = r;
    array[at + 1] = g;
    array[at + 2] = b;
    array[at + 3] = alpha;
    array = this.motion.array;
    array[at] = look.gravity;
    array[at + 1] = look.drag;
    array[at + 2] = look.stretch;
    array[at + 3] = Math.random();
    array = this.look.array;
    array[at] = look.additive ? 1 : 0;
    array[at + 1] = look.textured ? 1 : 0;
    array[at + 2] = look.fade;
    array[at + 3] = floor;
    if (this.clock + life > this.lastEnd) this.lastEnd = this.clock + life;
  }

  /** The sky's fill and the sun's light on smoke (scene-linear). */
  setLight(ambient: readonly [number, number, number], sun: readonly [number, number, number]): void {
    const uniforms = this.mesh.material.uniforms;
    (uniforms.uAmbient!.value as THREE.Color).setRGB(ambient[0], ambient[1], ambient[2]);
    (uniforms.uSun!.value as THREE.Color).setRGB(sun[0], sun[1], sun[2]);
  }

  /** A fire lighting the smoke round it (`slot` 0: a blast, wide; 1: something burning, close). */
  setFire(slot: 0 | 1, x: number, y: number, z: number, r: number, g: number, b: number): void {
    const uniforms = this.mesh.material.uniforms;
    (uniforms[slot === 0 ? "uLightA" : "uLightB"]!.value as THREE.Vector3).set(x, y, z);
    (uniforms[slot === 0 ? "uLightAColor" : "uLightBColor"]!.value as THREE.Color).setRGB(r, g, b);
  }

  /** Advances the clock and uploads the particles born since the last call. */
  update(delta: number): void {
    this.clock += delta;
    if (this.clock >= this.lastEnd && this.used > 0 && this.dirtyHigh < 0) {
      // Nothing in the air: start over, so the clock stays small (and exact
      // in 32-bit floats) however long the session, and an idle pool draws nothing.
      this.clock = 0;
      this.lastEnd = 0;
      this.next = 0;
      this.used = 0;
      this.wrapped = false;
    }
    this.mesh.material.uniforms.uTime!.value = this.clock;
    this.mesh.geometry.instanceCount = this.clock < this.lastEnd ? this.used : 0;
    if (this.dirtyHigh < 0) return;
    for (const attribute of this.attributes) {
      attribute.clearUpdateRanges();
      // A ring that came round uploads whole; otherwise only what was born.
      if (!this.wrapped) attribute.addUpdateRange(this.dirtyLow * attribute.itemSize, (this.dirtyHigh - this.dirtyLow + 1) * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    if (this.wrapped) this.used = this.capacity;
    this.dirtyLow = this.capacity;
    this.dirtyHigh = -1;
    this.wrapped = false;
  }

  /** Everything in the air gone at once (a new game, a restored checkpoint). */
  clear(): void {
    for (let index = 0; index < this.capacity; index += 1) this.timing.array[index * 4] = -1e4;
    this.timing.clearUpdateRanges();
    this.timing.needsUpdate = true;
    this.clock = 0;
    this.lastEnd = 0;
    this.next = 0;
    this.used = 0;
    this.dirtyLow = this.capacity;
    this.dirtyHigh = -1;
    this.wrapped = false;
    this.mesh.geometry.instanceCount = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material.uniforms.uPuff!.value as THREE.Texture).dispose();
    this.mesh.material.dispose();
  }
}
