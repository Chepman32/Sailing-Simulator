import * as THREE from "three";

/**
 * The wake as part of the water, not as decals lying on it.
 *
 * Every wake source (the two hull tracks, the diverging bow waves, the
 * propeller wash, splash foam, fin trails and ring waves) is drawn as a soft
 * stamp into a small top-down texture that follows the yacht. The ocean
 * shader samples that texture and turns it into water:
 *
 * - R: foam amount. The ocean breaks it into lace with its own noise, at
 *   pixel resolution, and lights it like the rest of the surface;
 * - G: aerated, smoothed water: lighter turquoise, wind ripples damped, the
 *   glassy band that lingers behind a boat;
 * - B − A: a small height field (metres) whose slope bends the water's normal:
 *   the transverse waves that follow the stern at the yacht's own speed and
 *   the diverging waves that open the Kelvin V. They catch the sun and the
 *   sky exactly like the swell does, because they are shaded by the same code.
 *
 * Heights are stored as two positive channels so plain additive blending sums
 * them correctly in any texture format. The field is redrawn from scratch at a
 * bounded rate, so it holds no history and cannot accumulate error.
 */

export const StampKind = {
  /** Turbulent stern track with the transverse waves that follow the yacht. */
  Track: 0,
  /** One crest of a diverging bow wave. */
  BowWave: 1,
  /** Propeller wash: churned, bubbly water. */
  PropWash: 2,
  /** A patch of foam (splash field, fin trail). */
  Foam: 3,
  /** A ring wave spreading from an impact. */
  Ring: 4,
} as const;
export type StampKind = (typeof StampKind)[keyof typeof StampKind];

const stampVertexShader = /* glsl */ `
  attribute vec4 stampA;
  attribute vec4 stampB;
  attribute vec4 stampC;
  uniform vec3 uArea;
  varying vec2 vLocal;
  varying vec4 vB;
  varying vec4 vC;
  varying float vKind;

  void main() {
    vLocal = position.xy;
    vB = stampB;
    vC = stampC;
    vKind = stampA.w;
    float s = sin(stampA.z);
    float c = cos(stampA.z);
    // Heading convention: forward (sin h, cos h), starboard (cos h, -sin h).
    vec2 world = stampA.xy
      + vec2(c, -s) * position.x * stampB.x
      + vec2(s, c) * position.y * stampB.y;
    vec2 clip = (world - uArea.xy) / (uArea.z * 0.5);
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`;

const stampFragmentShader = /* glsl */ `
  varying vec2 vLocal;
  varying vec4 vB;
  varying vec4 vC;
  varying float vKind;

  void main() {
    float r2 = dot(vLocal, vLocal);
    // Fade before the quad's own edge so no stamp ever shows a straight side.
    float edge = 1.0 - smoothstep(0.82, 1.0, max(abs(vLocal.x), abs(vLocal.y)));
    float foam = 0.0;
    float slick = 0.0;
    float height = 0.0;
    int kind = int(vKind + 0.5);
    if (kind == 0) {
      float core = exp(-r2 * 2.6);
      foam = vB.z * exp(-dot(vLocal * vec2(1.6, 1.0), vLocal * vec2(1.6, 1.0)) * 2.4);
      slick = vB.w * core;
      // Transverse crests lie across the track; the phase is the distance
      // behind the stern times the wavenumber of a wave as fast as the yacht.
      float phase = vC.z - vLocal.y * vC.y;
      height = vC.x * cos(phase) * exp(-vLocal.y * vLocal.y * 2.25) * exp(-vLocal.x * vLocal.x * 1.4);
    } else if (kind == 1) {
      float along = exp(-vLocal.y * vLocal.y * 2.0);
      float x = vLocal.x;
      float ridge = cos(x * 3.6) * exp(-x * x * 2.4);
      height = vC.x * ridge * along;
      foam = vB.z * pow(max(ridge, 0.0), 4.0) * along;
      slick = vB.w * exp(-r2 * 2.0);
    } else if (kind == 2) {
      foam = vB.z * exp(-r2 * 2.2);
      slick = vB.w * exp(-r2 * 1.5);
    } else if (kind == 3) {
      foam = vB.z * exp(-r2 * 2.6);
      slick = vB.w * exp(-r2 * 1.7);
    } else {
      float r = sqrt(r2);
      float band = (r - 0.78) / 0.16;
      height = vC.x * cos((r - 0.78) * vC.y) * exp(-band * band);
      foam = vB.z * exp(-band * band * 6.0);
      slick = vB.w * (1.0 - smoothstep(0.0, 0.8, r));
    }
    gl_FragColor = vec4(foam, slick, max(height, 0.0), max(-height, 0.0)) * edge;
  }
`;

export class WakeField {
  readonly target: THREE.WebGLRenderTarget;
  /** Centre x, centre z and side length of the field in metres. */
  readonly area = new THREE.Vector3(0, 0, 160);
  readonly resolution: number;
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly stampA: THREE.InstancedBufferAttribute;
  private readonly stampB: THREE.InstancedBufferAttribute;
  private readonly stampC: THREE.InstancedBufferAttribute;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clearColor = new THREE.Color();
  private count = 0;
  readonly capacity: number;

  constructor(renderer: THREE.WebGLRenderer, resolution: number, size: number, capacity: number) {
    this.resolution = resolution;
    this.capacity = capacity;
    this.area.z = size;
    const float = renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");
    this.target = new THREE.WebGLRenderTarget(resolution, resolution, {
      type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    this.target.texture.name = "WakeField";

    const quad = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    this.stampA = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.stampB = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.stampC = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    [this.stampA, this.stampB, this.stampC].forEach((attribute) => attribute.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("stampA", this.stampA);
    geometry.setAttribute("stampB", this.stampB);
    geometry.setAttribute("stampC", this.stampC);
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      name: "WakeFieldStamp",
      uniforms: { uArea: { value: this.area } },
      vertexShader: stampVertexShader,
      fragmentShader: stampFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** Metres per texel. */
  get texel(): number {
    return this.area.z / this.resolution;
  }

  /** Starts a new frame of stamps, centred (to the texel) on `x`, `z`. */
  begin(x: number, z: number): void {
    const texel = this.texel;
    this.area.x = Math.round(x / texel) * texel;
    this.area.y = Math.round(z / texel) * texel;
    this.count = 0;
  }

  push(
    x: number,
    z: number,
    heading: number,
    kind: StampKind,
    halfWidth: number,
    halfLength: number,
    foam: number,
    slick: number,
    amplitude = 0,
    wavenumber = 0,
    phase = 0,
  ): void {
    if (this.count >= this.capacity) return;
    const reach = this.area.z * 0.5 + Math.max(halfWidth, halfLength);
    if (Math.abs(x - this.area.x) > reach || Math.abs(z - this.area.y) > reach) return;
    const offset = this.count * 4;
    const a = this.stampA.array as Float32Array;
    const b = this.stampB.array as Float32Array;
    const c = this.stampC.array as Float32Array;
    a[offset] = x;
    a[offset + 1] = z;
    a[offset + 2] = heading;
    a[offset + 3] = kind;
    b[offset] = halfWidth;
    b[offset + 1] = halfLength;
    b[offset + 2] = foam;
    b[offset + 3] = slick;
    c[offset] = amplitude;
    c[offset + 1] = wavenumber;
    c[offset + 2] = phase;
    c[offset + 3] = 0;
    this.count += 1;
  }

  /** Draws this frame's stamps into the field. */
  render(renderer: THREE.WebGLRenderer): void {
    const geometry = this.mesh.geometry;
    geometry.instanceCount = this.count;
    for (const attribute of [this.stampA, this.stampB, this.stampC]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, Math.max(4, this.count * 4));
      attribute.needsUpdate = true;
    }
    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.clearColor);
    const previousAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    if (this.count > 0) {
      renderer.autoClear = false;
      renderer.render(this.scene, this.camera);
    }
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.clearColor, previousAlpha);
  }

  dispose(): void {
    this.target.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
