import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";

/**
 * Crepuscular rays (sun shafts) as a screen-space pass, after GPU Gems 3,
 * ch. 13: the open sky round the sun is taken as the light (pixels whose
 * depth is the far plane, weighted by their brightness and by how close
 * they are to the sun's disc), then smeared along lines toward the sun with
 * a decaying weight. Masts, sails, rigging, palm crowns and cloud edges cut
 * dark gaps into that smear: the shafts stream past them.
 *
 * Both steps run at half resolution (the rays are soft by nature); the
 * result is added to the scene in linear HDR light, before bloom and the
 * tone curve, tinted by the sun's own colour.
 */

const MaskShader = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uThreshold: { value: 0.9 },
    uProjectionInverse: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform vec2 uSun;
    uniform float uAspect;
    uniform float uThreshold;
    uniform mat4 uProjectionInverse;
    uniform mat4 uCameraWorld;
    varying vec2 vUv;
    void main() {
      float depth = texture2D(tDepth, vUv).x;
      // Only the open sky shines: nothing nearer than the far plane, and
      // above the horizon (the sea writes no depth, and its glitter is not sky).
      vec4 view = uProjectionInverse * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 direction = mat3(uCameraWorld) * (view.xyz / view.w);
      float sky = step(0.99995, depth) * smoothstep(-0.004, 0.012, normalize(direction).y);
      vec3 color = min(texture2D(tColor, vUv).rgb, vec3(24.0));
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec2 toSun = (vUv - uSun) * vec2(uAspect, 1.0);
      // The disc and its aureole: a tight core and a broad glow round it.
      float near = exp(-dot(toSun, toSun) * 26.0) + exp(-dot(toSun, toSun) * 220.0) * 2.0;
      float light = max(0.0, luminance - uThreshold) * near * sky;
      gl_FragColor = vec4(vec3(min(light, 8.0)), 1.0);
    }
  `,
};

const SAMPLES = 56;

const BlurShader = {
  uniforms: {
    tMask: { value: null as THREE.Texture | null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uDensity: { value: 0.92 },
    uDecay: { value: 0.965 },
    uJitter: { value: 0 },
  },
  vertexShader: MaskShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tMask;
    uniform vec2 uSun;
    uniform float uDensity;
    uniform float uDecay;
    uniform float uJitter;
    varying vec2 vUv;
    float shaftHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec2 step = (vUv - uSun) * uDensity / float(${SAMPLES});
      // A per-pixel offset along the ray (changing each frame) trades the
      // banding of a fixed sample count for a fine grain the eye ignores.
      vec2 uv = vUv - step * shaftHash(gl_FragCoord.xy + uJitter);
      float weight = 1.0;
      vec3 sum = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < ${SAMPLES}; i++) {
        sum += texture2D(tMask, uv).rgb * weight;
        total += weight;
        weight *= uDecay;
        uv -= step;
      }
      gl_FragColor = vec4(sum / max(total, 1.0) * 3.2, 1.0);
    }
  `,
};

const CompositeShader = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null },
    tRays: { value: null as THREE.Texture | null },
    uTint: { value: new THREE.Color(1, 0.9, 0.75) },
    uStrength: { value: 0 },
  },
  vertexShader: MaskShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform sampler2D tRays;
    uniform vec3 uTint;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec3 color = texture2D(tColor, vUv).rgb;
      vec3 rays = texture2D(tRays, vUv).rgb;
      gl_FragColor = vec4(color + rays * uTint * uStrength, 1.0);
    }
  `,
};

export class SunShaftsPass extends Pass {
  /** The scene's depth for this frame (set by the pipeline before each render). */
  depth: THREE.Texture | null = null;
  /** Sun position on screen (0…1 uv) and how much of it shines (0 hidden … 1). */
  readonly sun = new THREE.Vector2(0.5, 0.5);
  visibility = 0;
  readonly tint = new THREE.Color(1, 0.9, 0.75);
  strength = 0.42;
  private readonly maskTarget: THREE.WebGLRenderTarget;
  private readonly raysTarget: THREE.WebGLRenderTarget;
  private readonly maskMaterial = new THREE.ShaderMaterial({ ...MaskShader, uniforms: THREE.UniformsUtils.clone(MaskShader.uniforms), depthTest: false, depthWrite: false });
  private readonly blurMaterial = new THREE.ShaderMaterial({ ...BlurShader, uniforms: THREE.UniformsUtils.clone(BlurShader.uniforms), depthTest: false, depthWrite: false });
  private readonly compositeMaterial = new THREE.ShaderMaterial({
    ...CompositeShader,
    uniforms: THREE.UniformsUtils.clone(CompositeShader.uniforms),
    depthTest: false,
    depthWrite: false,
  });
  private readonly quad = new FullScreenQuad();
  private frame = 0;
  private aspect = 1;
  /** The camera the frame was drawn with (for the horizon test). */
  camera: THREE.Camera | null = null;

  constructor(width: number, height: number) {
    super();
    const options = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter } as const;
    this.maskTarget = new THREE.WebGLRenderTarget(1, 1, options);
    this.raysTarget = new THREE.WebGLRenderTarget(1, 1, options);
    this.maskTarget.texture.name = "SunShaftMask";
    this.raysTarget.texture.name = "SunShafts";
    this.setSize(width, height);
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.maskTarget.setSize(w, h);
    this.raysTarget.setSize(w, h);
    this.aspect = width / Math.max(1, height);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const strength = this.strength * this.visibility;
    const target = this.renderToScreen ? null : writeBuffer;
    if (strength <= 0.001 || !this.depth) {
      // Nothing to add: the frame is passed on as it is.
      this.compositeMaterial.uniforms.tColor!.value = readBuffer.texture;
      this.compositeMaterial.uniforms.tRays!.value = this.raysTarget.texture;
      this.compositeMaterial.uniforms.uStrength!.value = 0;
      this.quad.material = this.compositeMaterial;
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
      return;
    }
    this.frame = (this.frame + 1) % 64;
    const mask = this.maskMaterial.uniforms;
    mask.tColor!.value = readBuffer.texture;
    mask.tDepth!.value = this.depth;
    (mask.uSun!.value as THREE.Vector2).copy(this.sun);
    mask.uAspect!.value = this.aspect;
    if (this.camera) {
      (mask.uProjectionInverse!.value as THREE.Matrix4).copy((this.camera as THREE.PerspectiveCamera).projectionMatrixInverse);
      (mask.uCameraWorld!.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    }
    this.quad.material = this.maskMaterial;
    renderer.setRenderTarget(this.maskTarget);
    this.quad.render(renderer);

    const blur = this.blurMaterial.uniforms;
    blur.tMask!.value = this.maskTarget.texture;
    (blur.uSun!.value as THREE.Vector2).copy(this.sun);
    blur.uJitter!.value = this.frame * 17.0;
    this.quad.material = this.blurMaterial;
    renderer.setRenderTarget(this.raysTarget);
    this.quad.render(renderer);

    const composite = this.compositeMaterial.uniforms;
    composite.tColor!.value = readBuffer.texture;
    composite.tRays!.value = this.raysTarget.texture;
    (composite.uTint!.value as THREE.Color).copy(this.tint);
    composite.uStrength!.value = strength;
    this.quad.material = this.compositeMaterial;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.maskTarget.dispose();
    this.raysTarget.dispose();
    this.maskMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quad.dispose();
  }
}
