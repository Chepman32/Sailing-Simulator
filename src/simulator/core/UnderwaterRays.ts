import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";

/**
 * Sunlight under the water as a volume (a screen-space pass): for every
 * pixel the view ray is marched through the water from the eye to whatever
 * it meets (the scene's depth) or as far as the water lets one see, and at
 * each step the light reaching that point is added, dimmed by the water on
 * its way down from the surface and on its way to the eye.
 *
 * How much light reaches a point is decided at the surface: following the
 * refracted sun back up from the point to where it entered the water, a
 * pattern of bright beams (the waves focusing the sunlight, drifting and
 * swaying with them) says whether that point lies in a beam. So the shafts
 * are true volumes: they converge toward the sun in perspective, are cut off
 * by the seabed, rocks and the hull, cross in front of each other, and look
 * right from any angle, looking up, along or down. Forward scattering (a
 * Henyey-Greenstein phase) makes them brightest looking toward the sun.
 *
 * Marched at half resolution with a jittered start (the noise averaged by
 * the upsampling blur), then added to the frame in linear HDR light before
 * bloom and the tone curve.
 */

const MarchShader = {
  uniforms: {
    tDepth: { value: null as THREE.Texture | null },
    uProjectionInverse: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
    uCamera: { value: new THREE.Vector3() },
    uSurface: { value: 0 },
    uSunDown: { value: new THREE.Vector3(0, -1, 0) },
    uTime: { value: 0 },
    uExtinction: { value: 0.05 },
    uReach: { value: 45 },
    uFrame: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDepth;
    uniform mat4 uProjectionInverse;
    uniform mat4 uCameraWorld;
    uniform vec3 uCamera;
    uniform float uSurface;
    uniform vec3 uSunDown;
    uniform float uTime;
    uniform float uExtinction;
    uniform float uReach;
    uniform float uFrame;
    varying vec2 vUv;

    float rayHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float rayNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(rayHash(i), rayHash(i + vec2(1.0, 0.0)), u.x), mix(rayHash(i + vec2(0.0, 1.0)), rayHash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    // Beams where the waves focus the light: the ridges of two drifting
    // noise layers, a few wide beams and more thin ones, slowly swaying.
    float beams(vec2 s) {
      vec2 sway = vec2(sin(uTime * 0.31 + s.y * 0.07), cos(uTime * 0.23 + s.x * 0.05)) * 0.6;
      float a = rayNoise(s * 0.32 + sway + vec2(uTime * 0.045, uTime * 0.03));
      float b = rayNoise(s * 0.71 - sway * 1.4 + vec2(-uTime * 0.06, uTime * 0.05) + 13.7);
      float wide = pow(max(0.0, 1.0 - abs(a * 2.0 - 1.0)), 7.0);
      float thin = pow(max(0.0, 1.0 - abs(b * 2.0 - 1.0)), 14.0);
      return wide + thin * 0.7;
    }

    const int STEPS = 40;

    void main() {
      float depth = texture2D(tDepth, vUv).x;
      // The ray through this pixel, and how far it goes before it meets something.
      vec4 near = uProjectionInverse * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
      vec4 hit = uProjectionInverse * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec3 viewHit = hit.xyz / hit.w;
      vec3 direction = normalize(mat3(uCameraWorld) * (near.xyz / near.w));
      float sceneDistance = depth >= 0.99999 ? 1.0e6 : length(viewHit);
      float reach = min(sceneDistance, uReach);
      // Up through the surface the water ends.
      if (direction.y > 1.0e-4) reach = min(reach, max(0.0, (uSurface - uCamera.y) / direction.y));
      if (reach <= 0.01) {
        gl_FragColor = vec4(0.0);
        return;
      }
      float sinUp = max(0.2, -uSunDown.y);
      float jitter = rayHash(gl_FragCoord.xy + uFrame * 7.13);
      float stepLength = reach / float(STEPS);
      float light = 0.0;
      for (int index = 0; index < STEPS; index++) {
        float t = (float(index) + jitter) * stepLength;
        vec3 p = uCamera + direction * t;
        float below = uSurface - p.y;
        if (below < 0.0) continue;
        // Where the light now at p entered the water.
        float path = below / sinUp;
        vec2 entry = p.xz - uSunDown.xz * path;
        // Beams blur out with depth (the focus spreads); light fades on its way down and out to the eye.
        // Only the beams (the focused excess over the even daylight, which the
        // water's own colour already carries); they blur out with depth.
        float focus = mix(max(0.0, beams(entry) - 0.06), 0.03, smoothstep(5.0, 28.0, below));
        light += focus * exp(-uExtinction * (path + t));
      }
      light *= stepLength;
      // Forward scattering: brightest looking toward the light.
      float g = 0.62;
      float cosine = dot(direction, -uSunDown);
      float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosine, 1.5) * 0.012;
      gl_FragColor = vec4(vec3(light * phase), 1.0);
    }
  `,
};

const CompositeShader = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null },
    tRays: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uTint: { value: new THREE.Color(0.4, 0.8, 0.9) },
    uStrength: { value: 0 },
  },
  vertexShader: MarchShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform sampler2D tRays;
    uniform vec2 uTexel;
    uniform vec3 uTint;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tColor, vUv);
      // A small tent blur over the half-resolution march smooths its jitter.
      float rays = texture2D(tRays, vUv).r * 0.4;
      rays += texture2D(tRays, vUv + vec2(uTexel.x, 0.0)).r * 0.15;
      rays += texture2D(tRays, vUv - vec2(uTexel.x, 0.0)).r * 0.15;
      rays += texture2D(tRays, vUv + vec2(0.0, uTexel.y)).r * 0.15;
      rays += texture2D(tRays, vUv - vec2(0.0, uTexel.y)).r * 0.15;
      gl_FragColor = vec4(color.rgb + rays * uTint * uStrength, color.a);
    }
  `,
};

export class UnderwaterRaysPass extends Pass {
  /** The scene's depth for this frame (set by the pipeline before each render). */
  depth: THREE.Texture | null = null;
  camera: THREE.Camera | null = null;
  /** 0 above the water … 1 under it. */
  amount = 0;
  /** The light entering the water (the sun's colour through the water), linear. */
  readonly tint = new THREE.Color(0.4, 0.8, 0.9);
  /** Height of the surface over the eye, the refracted sun's direction (down), the water's extinction (1/m). */
  surface = 0;
  readonly sunDown = new THREE.Vector3(0, -1, 0);
  extinction = 0.05;
  /** Overall strength (day, weather). */
  strength = 1;
  time = 0;
  private readonly raysTarget: THREE.WebGLRenderTarget;
  private readonly march = new THREE.ShaderMaterial({ ...MarchShader, uniforms: THREE.UniformsUtils.clone(MarchShader.uniforms), depthTest: false, depthWrite: false });
  private readonly composite = new THREE.ShaderMaterial({ ...CompositeShader, uniforms: THREE.UniformsUtils.clone(CompositeShader.uniforms), depthTest: false, depthWrite: false });
  private readonly quad = new FullScreenQuad();
  private frame = 0;

  constructor(width: number, height: number) {
    super();
    this.raysTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.raysTarget.texture.name = "UnderwaterRays";
    this.setSize(width, height);
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.raysTarget.setSize(w, h);
    (this.composite.uniforms.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const strength = this.strength * this.amount;
    const target = this.renderToScreen ? null : writeBuffer;
    const composite = this.composite.uniforms;
    composite.tColor!.value = readBuffer.texture;
    composite.tRays!.value = this.raysTarget.texture;
    if (strength > 0.001 && this.depth && this.camera) {
      this.frame = (this.frame + 1) % 64;
      const march = this.march.uniforms;
      march.tDepth!.value = this.depth;
      (march.uProjectionInverse!.value as THREE.Matrix4).copy((this.camera as THREE.PerspectiveCamera).projectionMatrixInverse);
      (march.uCameraWorld!.value as THREE.Matrix4).copy(this.camera.matrixWorld);
      (march.uCamera!.value as THREE.Vector3).setFromMatrixPosition(this.camera.matrixWorld);
      march.uSurface!.value = this.surface;
      (march.uSunDown!.value as THREE.Vector3).copy(this.sunDown);
      march.uTime!.value = this.time;
      march.uExtinction!.value = this.extinction;
      march.uFrame!.value = this.frame;
      this.quad.material = this.march;
      renderer.setRenderTarget(this.raysTarget);
      this.quad.render(renderer);
      (composite.uTint!.value as THREE.Color).copy(this.tint);
      composite.uStrength!.value = strength;
    } else {
      composite.uStrength!.value = 0;
    }
    this.quad.material = this.composite;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.raysTarget.dispose();
    this.march.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}
