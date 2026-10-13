import * as THREE from "three";
import type { Rgb } from "./EnvironmentPalette";

/**
 * Rain: a fixed pool of streaks in a box that follows the camera.
 *
 * Every drop is one instance of a unit quad; its position is a pure function
 * of its random seed, the clock and the camera, wrapped around the camera in
 * the vertex shader, so a frame costs one draw call and no CPU work beyond a
 * few uniforms. The intensity does not add or remove meshes: a drop is shown
 * when its own random threshold is below the rain, so a drizzle is a sparse
 * subset of a downpour. Streaks lean with the wind and are drawn as thin
 * camera-facing ribbons from the drop's head back along its path.
 *
 * Drops are hidden below the sea and fade out near it (the splashes are the
 * ocean shader's rain rings), and close to the lens.
 */

/** Size of the box around the camera, metres: width (x and z), height. */
const BOX_WIDTH = 64;
const BOX_HEIGHT = 36;
/** Metres per second a drop falls, in a drizzle and in a torrent. */
const FALL_SPEED = 9;
const FALL_SPEED_TORRENT = 13;
/** How much of the wind the falling drops take up. */
const WIND_DRAG = 0.55;
/** Seeds allocated; the quality preset chooses how many of them are drawn. */
const MAX_DROPS = 5600;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uRain;
  uniform float uShare;
  uniform vec3 uCamera;
  uniform vec3 uVelocity;
  uniform vec3 uBox;
  attribute vec4 aSeed;
  attribute vec2 aCorner;
  varying float vAlpha;
  varying float vEdge;

  void main() {
    // Seeds above the rain's intensity are not drawn at all.
    float shown = step(aSeed.w, uRain * uShare);
    vec3 position0 = aSeed.xyz * uBox + uVelocity * uTime;
    vec3 relative = mod(position0 - uCamera + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 head = uCamera + relative;
    float length0 = length(uVelocity);
    vec3 direction = uVelocity / max(length0, 1.0e-3);
    float streak = 0.06 * length0 * (0.7 + 0.6 * fract(aSeed.w * 91.7));
    vec3 tail = head - direction * streak;

    vec3 viewHead = (viewMatrix * vec4(head, 1.0)).xyz;
    vec3 viewTail = (viewMatrix * vec4(tail, 1.0)).xyz;
    vec3 axis = viewTail - viewHead;
    float distance0 = length(viewHead);
    vec3 side = normalize(cross(axis, viewHead) + vec3(1.0e-6));
    float width = max(0.006, distance0 * 0.0016) * (0.8 + 0.5 * fract(aSeed.w * 37.3));
    vec3 viewPosition = mix(viewHead, viewTail, aCorner.y) + side * aCorner.x * width;

    // Near the lens and at the edge of the box a drop fades out; below the
    // sea it is gone, and just above it fades before it would pierce the swell.
    float fade = smoothstep(1.2, 4.0, distance0) * (1.0 - smoothstep(0.3, 0.5, length(relative.xz) / uBox.x));
    fade *= smoothstep(0.2, 2.0, head.y);
    vAlpha = shown * fade * (0.55 + 0.45 * fract(aSeed.w * 53.1));
    vEdge = aCorner.x * 2.0;
    gl_Position = projectionMatrix * vec4(viewPosition, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vEdge;

  void main() {
    float soft = 1.0 - vEdge * vEdge;
    float alpha = vAlpha * soft * uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class RainSystem {
  readonly object: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly uniforms = {
    uTime: { value: 0 },
    uRain: { value: 0 },
    uShare: { value: 1 },
    uCamera: { value: new THREE.Vector3() },
    uVelocity: { value: new THREE.Vector3(0, -FALL_SPEED, 0) },
    uBox: { value: new THREE.Vector3(BOX_WIDTH, BOX_HEIGHT, BOX_WIDTH) },
    uColor: { value: new THREE.Color(0.5, 0.55, 0.62) },
    uOpacity: { value: 0.3 },
  };

  constructor(scene: THREE.Scene, count: number) {
    const geometry = new THREE.InstancedBufferGeometry();
    // One ribbon: x across (−0.5…0.5), y along (0 at the head, 1 at the tail).
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3),
    );
    geometry.setAttribute("aCorner", new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    // A fixed, well-spread seed set: deterministic, with no clumps.
    const seeds = new Float32Array(MAX_DROPS * 4);
    let state = 0x9e3779b9;
    const next = () => {
      state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x297a2d39) | 0;
      return ((state >>> 0) % 1000003) / 1000003;
    };
    for (let index = 0; index < MAX_DROPS; index += 1) {
      seeds[index * 4] = next();
      seeds[index * 4 + 1] = next();
      seeds[index * 4 + 2] = next();
      // The visibility threshold is stratified so any intensity shows an even share.
      seeds[index * 4 + 3] = (index + next()) / MAX_DROPS;
    }
    geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = Math.min(count, MAX_DROPS);
    this.uniforms.uShare.value = geometry.instanceCount / MAX_DROPS;

    const material = new THREE.ShaderMaterial({
      name: "RainStreaks",
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = "Rain";
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;
    this.object.visible = false;
    scene.add(this.object);
  }

  /** How many streaks the quality preset draws; takes effect at once. */
  setDrops(count: number): void {
    const geometry = this.object.geometry;
    geometry.instanceCount = Math.max(1, Math.min(count, MAX_DROPS));
    this.uniforms.uShare.value = geometry.instanceCount / MAX_DROPS;
  }

  /**
   * @param rain 0…1 intensity.
   * @param wind True wind (m/s) the drops lean with.
   * @param light Scene-linear colour of the light the drops catch.
   */
  update(time: number, camera: THREE.Camera, rain: number, wind: { x: number; z: number }, light: Rgb): void {
    const visible = rain > 0.015;
    this.object.visible = visible;
    if (!visible) return;
    const uniforms = this.uniforms;
    uniforms.uTime.value = time;
    uniforms.uRain.value = rain;
    camera.getWorldPosition(uniforms.uCamera.value);
    const fall = FALL_SPEED + (FALL_SPEED_TORRENT - FALL_SPEED) * rain;
    uniforms.uVelocity.value.set(wind.x * WIND_DRAG, -fall, wind.z * WIND_DRAG);
    uniforms.uColor.value.setRGB(light[0], light[1], light[2], THREE.LinearSRGBColorSpace);
    uniforms.uOpacity.value = 0.2 + 0.2 * rain;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.object);
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
