import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { QualitySettings } from "./QualityManager";

/**
 * HDR presentation pipeline.
 *
 * The scene is rendered into a multisampled half-float target in scene-linear
 * light, so the sun, its glitter on the water and the navigation lights keep
 * their true brightness. Bloom then spreads only what is genuinely brighter
 * than white, and one final pass applies the lens treatment, the renderer's
 * filmic tone curve and the display transfer.
 *
 * On the low preset the pipeline is bypassed and the scene renders directly;
 * every material tone-maps itself in that path, so both look consistent.
 */

/** Luminance above which a pixel is treated as a light source. */
export const BLOOM_THRESHOLD = 1.35;
const BLOOM_RADIUS = 0.62;
/**
 * Brightest value a pixel may carry into bloom and the finish. The half-float
 * target overflows to infinity above 65504, and one infinite or NaN pixel is
 * smeared by the blur over the whole frame: the screen blinks or goes black
 * until the next clean frame. Nothing real is brighter than this (the sun
 * disc is about 9, a lightning core a few tens).
 */
export const HDR_CEILING = 96;

/** GLSL: a colour made finite and non-negative (a NaN fails every comparison, so becomes 0). */
export const SANE_COLOR_GLSL = /* glsl */ `
  vec3 saneColor(vec3 c) {
    return vec3(
      c.r >= 0.0 ? min(c.r, ${HDR_CEILING.toFixed(1)}) : 0.0,
      c.g >= 0.0 ? min(c.g, ${HDR_CEILING.toFixed(1)}) : 0.0,
      c.b >= 0.0 ? min(c.b, ${HDR_CEILING.toFixed(1)}) : 0.0
    );
  }
`;

const FinishShader = {
  name: "LensFinish",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.012 },
    uAberration: { value: 0.0035 },
    uSaturation: { value: 1.07 },
    // The mood of the radio station (see RadioSystem): neutral by default.
    uGradeGain: { value: new THREE.Vector3(1, 1, 1) },
    uGradeShadows: { value: new THREE.Vector3(0, 0, 0) },
    uGradeSaturation: { value: 1 },
    uGradeVignette: { value: 0 },
    // A diver's view: the mask's edge, the water's wobble, 0 in air … 1 under.
    uUnderwater: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uSaturation;
    uniform vec3 uGradeGain;
    uniform vec3 uGradeShadows;
    uniform float uGradeSaturation;
    uniform float uGradeVignette;
    uniform float uUnderwater;
    varying vec2 vUv;

    ${SANE_COLOR_GLSL}

    float grainHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      // Under water the image swims a little (the water's own density
      // ripples), most toward the edges of the mask.
      if (uUnderwater > 0.0) {
        vec2 c = uv - 0.5;
        float edge = 0.35 + dot(c, c) * 2.6;
        uv += vec2(
          sin(uv.y * 23.0 + uTime * 1.6) + sin(uv.y * 41.0 - uTime * 2.3) * 0.5,
          cos(uv.x * 19.0 + uTime * 1.3) + cos(uv.x * 37.0 + uTime * 2.1) * 0.5
        ) * 0.0011 * edge * uUnderwater;
      }
      vec2 centred = uv - 0.5;
      float radius2 = dot(centred, centred);
      // A real lens focuses red and blue at slightly different magnifications
      // toward the corners; the centre of the frame stays untouched.
      vec2 fringe = centred * radius2 * (uAberration + uUnderwater * 0.012);
      vec3 color = vec3(
        texture2D(tDiffuse, uv - fringe).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv + fringe).b
      );
      color = saneColor(color);
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = max(mix(vec3(luminance), color, uSaturation * uGradeSaturation), 0.0);
      // Mood: a tint over the whole image and a lift of the shadows' colour.
      color = color * uGradeGain + uGradeShadows * (1.0 - smoothstep(0.0, 0.6, luminance));
      color *= 1.0 - smoothstep(0.1, 0.52, radius2) * (uVignette + uGradeVignette);
      // The dive mask: its rim darkens the corners of the view.
      color *= 1.0 - smoothstep(0.16, 0.42, radius2 * vec2(1.0, 1.0).x) * 0.55 * uUnderwater;
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      // Grain is added in display space, where it also hides 8-bit banding.
      float grain = grainHash(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5;
      gl_FragColor.rgb += grain * uGrain;
    }
  `,
};

/** The bloom bright-pass shader with its input made finite (see `HDR_CEILING`). */
export function hardenBrightPass(source: string): string {
  const read = "vec4 texel = texture2D( tDiffuse, vUv );";
  if (!source.includes(read)) return source;
  return `${SANE_COLOR_GLSL}\n${source.replace(read, "vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = saneColor(texel.rgb);")}`;
}

export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly finish: ShaderPass;
  /** False on the rare GPU that cannot render to a half-float target. */
  private readonly supported: boolean;
  private active: boolean;
  private samples: number;
  private width = 1;
  private height = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private camera: THREE.Camera,
    quality: QualitySettings,
  ) {
    this.supported =
      renderer.extensions.has("EXT_color_buffer_half_float") || renderer.extensions.has("EXT_color_buffer_float");
    this.active = quality.postProcessing && this.supported;
    this.samples = this.supportedSamples(quality.msaaSamples);
    const size = renderer.getSize(new THREE.Vector2());
    this.width = Math.max(1, size.x);
    this.height = Math.max(1, size.y);
    const pixelRatio = renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(this.width * pixelRatio, this.height * pixelRatio, {
      type: THREE.HalfFloatType,
      samples: this.samples,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.name = "HdrScene";
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.width, this.height);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(this.width * pixelRatio, this.height * pixelRatio),
      quality.bloomStrength,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    this.bloom.enabled = quality.bloomStrength > 0;
    // The bright-pass is where an overflowed pixel would enter the blur.
    this.bloom.materialHighPassFilter.fragmentShader = hardenBrightPass(this.bloom.materialHighPassFilter.fragmentShader);
    this.bloom.materialHighPassFilter.needsUpdate = true;
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.finish);
  }

  get enabled(): boolean {
    return this.active;
  }

  /**
   * The target the scene is drawn into. Shader programs differ between a
   * render target (linear, no tone mapping) and the screen, so prewarming
   * must compile against the same one.
   */
  get sceneTarget(): THREE.WebGLRenderTarget | null {
    return this.active ? this.composer.renderTarget1 : null;
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.renderPass.camera = camera;
  }

  setQuality(quality: QualitySettings): void {
    this.active = quality.postProcessing && this.supported;
    this.bloom.strength = quality.bloomStrength;
    this.bloom.enabled = quality.bloomStrength > 0;
    const samples = this.supportedSamples(quality.msaaSamples);
    if (samples !== this.samples) {
      this.samples = samples;
      this.composer.renderTarget1.samples = samples;
      this.composer.renderTarget2.samples = samples;
      // Changing the sample count requires new GPU storage.
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  /**
   * Frees every GPU target of the pipeline. three.js allocates them again on
   * the next frame, so a poisoned or forgotten buffer starts from nothing.
   */
  rebuild(): void {
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.bloom.dispose();
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);
  }

  /** The radio's mood grade (already eased by the caller). */
  setGrade(gain: readonly number[], shadows: readonly number[], saturation: number, vignette: number): void {
    const uniforms = this.finish.uniforms;
    (uniforms.uGradeGain!.value as THREE.Vector3).set(gain[0]!, gain[1]!, gain[2]!);
    (uniforms.uGradeShadows!.value as THREE.Vector3).set(shadows[0]!, shadows[1]!, shadows[2]!);
    uniforms.uGradeSaturation!.value = saturation;
    uniforms.uGradeVignette!.value = vignette;
  }

  /** A diver's view under the water (0 … 1). */
  setUnderwater(amount: number): void {
    this.finish.uniforms.uUnderwater!.value = amount;
  }

  render(delta: number, time: number): void {
    if (!this.active) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.finish.uniforms.uTime.value = time;
    this.composer.render(delta);
  }

  dispose(): void {
    this.bloom.dispose();
    this.finish.dispose();
    this.composer.dispose();
  }

  private supportedSamples(requested: number): number {
    return Math.max(0, Math.min(requested, this.renderer.capabilities.maxSamples));
  }
}
