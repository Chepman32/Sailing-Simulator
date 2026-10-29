import * as THREE from "three";
import {
  burst,
  between,
  launchRocket,
  nextLaunchGap,
  nextShowGap,
  SHOW_LENGTH,
  splitStar,
  starBrightness,
  stepRocket,
  stepStar,
  type Rocket,
  type Star,
} from "./FireworksMath";

/** Where the show is fired from: the liner's top deck. */
export type FireworksSource = { x: number; y: number; z: number; heading: number; halfLength: number };

/** Most stars and trail sparks in the air at once (one instanced draw). */
const CAPACITY = 2600;
/** Farther than this the liner's show is not fired (nobody would see it). */
const SHOW_RANGE = 3200;

const vertexShader = /* glsl */ `
  attribute vec3 aHead;
  attribute vec3 aTail;
  attribute vec4 aColor;
  varying vec2 vUv;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    vec4 head = viewMatrix * vec4(aHead, 1.0);
    vec4 tail = viewMatrix * vec4(aTail, 1.0);
    vec3 along = head.xyz - tail.xyz;
    float length = max(length(along), 1.0e-3);
    vec3 axis = along / length;
    vec3 across = normalize(cross(axis, normalize(head.xyz + tail.xyz)));
    // A spark keeps about a pixel and a half at any range.
    float width = max(aColor.w, -head.z * 0.0016);
    vec3 point = mix(tail.xyz, head.xyz, position.x) + across * position.y * width;
    point += axis * (position.x - 0.5) * width * 0.6;
    vec4 mvPosition = vec4(point, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vUv = position.xy + vec2(0.0, 0.5);
    vColor = aColor.rgb;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  #include <fog_pars_fragment>
  void main() {
    float halfWidth = mix(0.2, 1.0, pow(vUv.x, 0.6));
    float across = 1.0 - smoothstep(0.0, halfWidth, abs(vUv.y * 2.0 - 1.0));
    float glow = pow(across, 1.4) * (0.2 + 0.8 * pow(vUv.x, 1.8));
    // A white-hot core in the brightest stars.
    vec3 color = vColor * glow + vec3(1.0) * pow(across, 6.0) * pow(vUv.x, 4.0) * max(max(vColor.r, vColor.g), vColor.b) * 0.25;
    gl_FragColor = vec4(color, 1.0);
    #ifdef USE_FOG
      // Light from the sky is veiled far less than a lit surface.
      #ifdef FOG_EXP2
        float fireFog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth * 0.25);
      #else
        float fireFog = smoothstep(fogNear, fogFar, vFogDepth) * 0.5;
      #endif
      gl_FragColor.rgb *= 1.0 - fireFog;
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The cruise liner's fireworks: shows scheduled by `FireworksMath` (every
 * minute or two after dark, now and then by day), rockets and stars stepped
 * here and drawn as glowing streaks, added to the scene's light. Each burst
 * is handed to `onBurst` (the boom, delayed by the distance).
 */
export class FireworksSystem {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly head: THREE.InstancedBufferAttribute;
  private readonly tail: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly rockets: Rocket[] = [];
  private readonly stars: Star[] = [];
  private readonly pending: Star[] = [];
  private untilShow: number;
  private showLeft = 0;
  private untilLaunch = 0;
  private clock = 0;
  /** The last burst, for the camera (photo mode) and tests. */
  readonly lastBurst = new THREE.Vector3();
  bursts = 0;

  constructor(
    scene: THREE.Scene,
    private readonly onBurst: (position: THREE.Vector3, crackle: boolean) => void = () => undefined,
    private readonly random: () => number = Math.random,
  ) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.head = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tail = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aHead", this.head);
    geometry.setAttribute("aTail", this.tail);
    geometry.setAttribute("aColor", this.color);
    geometry.instanceCount = 0;
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        name: "Fireworks",
        vertexShader,
        fragmentShader,
        uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    // Visible (with nothing to draw) until the first update, so the loading
    // screen compiles its shader instead of the first show.
    this.mesh.visible = true;
    this.mesh.name = "Fireworks";
    scene.add(this.mesh);
    // The first show comes soon after dark (or a little while into a day).
    this.untilShow = between(random, 20, 45);
  }

  /** Whether a show is on (rockets or stars in the air). */
  get active(): boolean {
    return this.showLeft > 0 || this.rockets.length > 0 || this.stars.length > 0;
  }

  /** Starts a show at once (tests, diagnostics). */
  startShow(): void {
    this.untilShow = 0;
  }

  /**
   * @param night 0 day … 1 night (shows come more often after dark).
   * @param source The liner, or null when none is near.
   * @param viewer Where the camera is (a far show is not fired).
   */
  update(delta: number, night: number, source: FireworksSource | null, viewer: THREE.Vector3): void {
    const dt = Math.min(0.1, Math.max(0, delta));
    this.clock += dt;
    const random = this.random;
    const inRange = source !== null && Math.hypot(source.x - viewer.x, source.z - viewer.z) < SHOW_RANGE;
    if (this.showLeft <= 0) {
      this.untilShow -= dt;
      if (this.untilShow <= 0) {
        if (inRange) {
          this.showLeft = between(random, SHOW_LENGTH.min, SHOW_LENGTH.max);
          this.untilLaunch = 0;
        }
        this.untilShow = nextShowGap(random, night);
      }
    } else {
      this.showLeft -= dt;
      this.untilLaunch -= dt;
      while (inRange && source && this.showLeft > 0 && this.untilLaunch <= 0) {
        const along = between(random, -0.35, 0.35) * source.halfLength;
        const x = source.x + Math.sin(source.heading) * along;
        const z = source.z + Math.cos(source.heading) * along;
        this.rockets.push(launchRocket(random, x, source.y, z, this.showLeft < 5));
        this.untilLaunch += nextLaunchGap(random, this.showLeft);
      }
    }

    const add = (star: Star) => {
      if (this.stars.length + this.pending.length < CAPACITY) this.pending.push(star);
    };
    for (let index = this.rockets.length - 1; index >= 0; index -= 1) {
      const rocket = this.rockets[index]!;
      if (stepRocket(rocket, dt, random, add)) {
        burst(rocket, random, add);
        this.lastBurst.set(rocket.x, rocket.y, rocket.z);
        this.bursts += 1;
        this.onBurst(this.lastBurst, rocket.shell === "crackle");
        this.rockets.splice(index, 1);
      }
    }
    for (let index = this.stars.length - 1; index >= 0; index -= 1) {
      const star = this.stars[index]!;
      const alive = stepStar(star, dt);
      if (star.split > 0 && star.age >= star.split) {
        star.split = -1;
        splitStar(star, random, add);
        this.stars[index] = this.stars[this.stars.length - 1]!;
        this.stars.pop();
        continue;
      }
      if (!alive) {
        this.stars[index] = this.stars[this.stars.length - 1]!;
        this.stars.pop();
      }
    }
    for (const star of this.pending) this.stars.push(star);
    this.pending.length = 0;
    this.draw();
  }

  private draw(): void {
    let count = 0;
    // Rockets: a bright head on a short streak.
    for (const rocket of this.rockets) {
      if (count >= CAPACITY) break;
      this.head.setXYZ(count, rocket.x, rocket.y, rocket.z);
      this.tail.setXYZ(count, rocket.x - rocket.vx * 0.06, rocket.y - rocket.vy * 0.06, rocket.z - rocket.vz * 0.06);
      this.color.setXYZW(count, 6, 4.2, 2, 0.6);
      count += 1;
    }
    for (const star of this.stars) {
      if (count >= CAPACITY) break;
      const flicker = Math.abs(Math.sin(star.x * 12.9 + star.z * 7.3 + this.clock * 31));
      const brightness = starBrightness(star, flicker);
      if (brightness < 0.01) continue;
      // The streak is the path of the last few hundredths of a second: long while fast.
      const trail = 0.07;
      this.head.setXYZ(count, star.x, star.y, star.z);
      this.tail.setXYZ(count, star.x - star.vx * trail, star.y - star.vy * trail, star.z - star.vz * trail);
      const t = star.age / star.life;
      const later = star.later;
      const mix = later ? Math.min(1, t * 2.2) : 0;
      const r = later ? star.color[0] + (later[0] - star.color[0]) * mix : star.color[0];
      const g = later ? star.color[1] + (later[1] - star.color[1]) * mix : star.color[1];
      const b = later ? star.color[2] + (later[2] - star.color[2]) * mix : star.color[2];
      this.color.setXYZW(count, r * brightness, g * brightness, b * brightness, star.size);
      count += 1;
    }
    this.head.needsUpdate = true;
    this.tail.needsUpdate = true;
    this.color.needsUpdate = true;
    this.mesh.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
  }

  clear(): void {
    this.rockets.length = 0;
    this.stars.length = 0;
    this.showLeft = 0;
    this.draw();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
