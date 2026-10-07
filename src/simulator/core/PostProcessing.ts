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

const FinishShader = {
  name: "LensFinish",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.012 },
    uAberration: { value: 0.0035 },
    uSaturation: { value: 1.07 },
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
    varying vec2 vUv;

    float grainHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 centred = vUv - 0.5;
      float radius2 = dot(centred, centred);
      // A real lens focuses red and blue at slightly different magnifications
      // toward the corners; the centre of the frame stays untouched.
      vec2 fringe = centred * radius2 * uAberration;
      vec3 color = vec3(
        texture2D(tDiffuse, vUv - fringe).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv + fringe).b
      );
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = max(mix(vec3(luminance), color, uSaturation), 0.0);
      color *= 1.0 - smoothstep(0.1, 0.52, radius2) * uVignette;
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      // Grain is added in display space, where it also hides 8-bit banding.
      float grain = grainHash(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5;
      gl_FragColor.rgb += grain * uGrain;
    }
  `,
};

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
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.finish);
  }

  get enabled(): boolean {
    return this.active;
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

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(this.width, this.height);
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
