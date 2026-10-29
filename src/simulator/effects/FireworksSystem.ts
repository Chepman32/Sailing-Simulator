import * as THREE from "three";
import {
  burst,
  burstLight,
  between,
  FINALE_LENGTH,
  launchRocket,
  nextCue,
  nextLaunchGap,
  nextShowGap,
  shedSparks,
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

/** Most stars and sparks in the air at once (one instanced draw). */
const CAPACITY = 9000;
/** Farther than this the liner's show is not fired (nobody would see it). */
const SHOW_RANGE = 3200;
/** Bursts remembered for the light they throw (the newest few dominate). */
const LIGHT_MEMORY = 6;

const vertexShader = /* glsl */ `
  attribute vec3 aHead;
  attribute vec3 aTail;
  attribute vec4 aColor;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vRound;
  #include <fog_pars_vertex>
  void main() {
    vec4 head = viewMatrix * vec4(aHead, 1.0);
    vec4 tail = viewMatrix * vec4(aTail, 1.0);
    vec3 along = head.xyz - tail.xyz;
    float length = length(along);
    // A spark barely moving (or the round flash of a burst) has no
    // direction of its own: it is drawn upright on the screen.
    vec3 axis = length > 1.0e-3 ? along / length : vec3(0.0, 1.0, 0.0);
    vec3 across = normalize(cross(axis, normalize(head.xyz + tail.xyz)));
    // Negative width: a round glow (the flash), not a streak.
    float roundGlow = aColor.w < 0.0 ? 1.0 : 0.0;
    // A spark keeps about two pixels at any range.
    float width = max(abs(aColor.w), -head.z * 0.0021);
    vec3 point;
    if (roundGlow > 0.5) {
      vec3 up = normalize(cross(across, normalize(head.xyz)));
      point = head.xyz + across * position.y * width + up * (position.x - 0.5) * width;
    } else {
      point = mix(tail.xyz, head.xyz, position.x) + across * position.y * width;
      point += axis * (position.x - 0.5) * width * 0.6;
    }
    vec4 mvPosition = vec4(point, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vUv = position.xy + vec2(0.0, 0.5);
    vColor = aColor.rgb;
    vRound = roundGlow;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vRound;
  #include <fog_pars_fragment>
  void main() {
    vec3 color;
    if (vRound > 0.5) {
      // The flash: a white-hot core in a soft halo.
      float r = length(vUv - 0.5) * 2.0;
      float halo = exp(-r * r * 5.0) * (1.0 - smoothstep(0.85, 1.0, r));
      color = vColor * (halo * 0.55 + pow(max(0.0, 1.0 - r * 2.2), 3.0) * 1.6);
    } else {
      float halfWidth = mix(0.2, 1.0, pow(vUv.x, 0.6));
      float across = 1.0 - smoothstep(0.0, halfWidth, abs(vUv.y * 2.0 - 1.0));
      float glow = pow(across, 1.4) * (0.15 + 0.85 * pow(vUv.x, 1.6));
      // A white-hot core in the brightest stars.
      color = vColor * glow + vec3(1.0) * pow(across, 6.0) * pow(vUv.x, 4.0) * max(max(vColor.r, vColor.g), vColor.b) * 0.3;
    }
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

type BurstGlow = { x: number; y: number; z: number; age: number; r: number; g: number; b: number; size: number };

/**
 * The cruise liner's fireworks: shows scheduled and choreographed by
 * `FireworksMath` (every minute or two after dark, now and then by day),
 * rockets, stars and their glitter stepped here and drawn as glowing
 * streaks, added to the scene's light. Each burst is handed to `onBurst`
 * (the boom, delayed by the distance), and the bursts' light is offered to
 * the scene (`light`), so the sea flickers in their colours.
 */
export class FireworksSystem {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly head: THREE.InstancedBufferAttribute;
  private readonly tail: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly rockets: Rocket[] = [];
  private readonly stars: Star[] = [];
  private readonly pending: Star[] = [];
  private readonly glows: BurstGlow[] = [];
  private untilShow: number;
  private showLeft = 0;
  private showLength = 1;
  private untilLaunch = 0;
  private clock = 0;
  /** The last burst, for the camera (photo mode) and tests. */
  readonly lastBurst = new THREE.Vector3();
  bursts = 0;
  /** The light the bursts throw right now (see `light`). */
  private readonly lightState = { position: new THREE.Vector3(), brightness: 0, rgb: [1, 1, 1] as [number, number, number] };

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

  /** Stars and sparks in the air (diagnostics, tests). */
  get starCount(): number {
    return this.stars.length;
  }

  /** Starts a show at once (tests, diagnostics). */
  startShow(): void {
    this.untilShow = 0;
  }

  /**
   * The light of the bursts in the air: where it comes from (weighted to the
   * brightest), how bright (0 for none, about 1 for a fresh shell's flash)
   * and its colour. Null when nothing is burning.
   */
  light(): { position: THREE.Vector3; brightness: number; rgb: readonly [number, number, number] } | null {
    return this.lightState.brightness > 0.01 ? this.lightState : null;
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
          this.showLength = this.showLeft;
          this.untilLaunch = 0;
        }
        this.untilShow = nextShowGap(random, night);
      }
    } else {
      this.showLeft -= dt;
      this.untilLaunch -= dt;
      while (inRange && source && this.showLeft > 0 && this.untilLaunch <= 0) {
        const cue = nextCue(random, this.showLeft, this.showLength);
        const finale = this.showLeft < FINALE_LENGTH;
        for (let index = 0; index < cue.count; index += 1) {
          // A volley is laid out symmetrically along the deck.
          const slot = cue.count > 1 ? index / (cue.count - 1) - 0.5 : between(random, -0.5, 0.5);
          const along = slot * 2 * cue.spread * source.halfLength + between(random, -0.04, 0.04) * source.halfLength;
          const x = source.x + Math.sin(source.heading) * along;
          const z = source.z + Math.cos(source.heading) * along;
          this.rockets.push(launchRocket(random, x, source.y, z, finale, cue));
        }
        this.untilLaunch += nextLaunchGap(random, this.showLeft) * (cue.count > 1 ? 1.6 : 1);
      }
    }

    const add = (star: Star) => {
      if (this.stars.length + this.pending.length < CAPACITY) this.pending.push(star);
    };
    // Glitter is the first thing to go when the sky is full.
    const addSpark = (star: Star) => {
      if (this.stars.length + this.pending.length < CAPACITY * 0.9) this.pending.push(star);
    };
    for (let index = this.rockets.length - 1; index >= 0; index -= 1) {
      const rocket = this.rockets[index]!;
      if (stepRocket(rocket, dt, random, addSpark)) {
        burst(rocket, random, add);
        this.lastBurst.set(rocket.x, rocket.y, rocket.z);
        this.bursts += 1;
        this.onBurst(this.lastBurst, rocket.shell === "crackle");
        this.remember(rocket);
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
        continue;
      }
      shedSparks(star, dt, random, addSpark);
    }
    for (const star of this.pending) this.stars.push(star);
    this.pending.length = 0;
    this.updateLight(dt);
    this.draw();
  }

  private remember(rocket: Rocket): void {
    const peak = Math.max(rocket.color[0], rocket.color[1], rocket.color[2]) || 1;
    // Most shells light the night in their colour; gold ones in gold.
    const gold = rocket.shell === "willow" || rocket.shell === "kamuro" || rocket.shell === "palm" || rocket.shell === "chrysanthemum";
    const crackle = rocket.shell === "crackle" || rocket.shell === "strobe";
    const glow: BurstGlow = {
      x: rocket.x,
      y: rocket.y,
      z: rocket.z,
      age: 0,
      r: gold ? 1 : crackle ? 1 : 0.35 + 0.65 * (rocket.color[0] / peak),
      g: gold ? 0.62 : crackle ? 0.97 : 0.35 + 0.65 * (rocket.color[1] / peak),
      b: gold ? 0.22 : crackle ? 0.92 : 0.35 + 0.65 * (rocket.color[2] / peak),
      size: rocket.size,
    };
    this.glows.push(glow);
    if (this.glows.length > LIGHT_MEMORY) this.glows.shift();
  }

  private updateLight(dt: number): void {
    const state = this.lightState;
    let total = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let index = this.glows.length - 1; index >= 0; index -= 1) {
      const glow = this.glows[index]!;
      glow.age += dt;
      const light = burstLight(glow.age) * glow.size;
      if (glow.age > 3) {
        this.glows.splice(index, 1);
        continue;
      }
      total += light;
      x += glow.x * light;
      y += glow.y * light;
      z += glow.z * light;
      r += glow.r * light;
      g += glow.g * light;
      b += glow.b * light;
    }
    state.brightness = Math.min(1.4, total);
    if (total > 1e-4) {
      state.position.set(x / total, y / total, z / total);
      const peak = Math.max(r, g, b) || 1;
      state.rgb[0] = r / peak;
      state.rgb[1] = g / peak;
      state.rgb[2] = b / peak;
    }
  }

  private draw(): void {
    let count = 0;
    // Rockets: a bright head on a short streak.
    for (const rocket of this.rockets) {
      if (count >= CAPACITY) break;
      this.head.setXYZ(count, rocket.x, rocket.y, rocket.z);
      this.tail.setXYZ(count, rocket.x - rocket.vx * 0.07, rocket.y - rocket.vy * 0.07, rocket.z - rocket.vz * 0.07);
      this.color.setXYZW(count, 7, 4.8, 2.2, 0.75);
      count += 1;
    }
    const clock = this.clock;
    for (const star of this.stars) {
      if (count >= CAPACITY) break;
      const flicker = Math.abs(Math.sin(star.phase * 12.9 + star.x * 3.1 + clock * 31));
      const brightness = starBrightness(star, flicker, clock);
      if (brightness < 0.01) continue;
      // The streak is the path of the last few hundredths of a second: long while fast.
      const trail = star.streak;
      this.head.setXYZ(count, star.x, star.y, star.z);
      this.tail.setXYZ(count, star.x - star.vx * trail, star.y - star.vy * trail, star.z - star.vz * trail);
      const t = star.age / star.life;
      const later = star.later;
      const mix = later ? Math.min(1, t * 2.2) : 0;
      const r = later ? star.color[0] + (later[0] - star.color[0]) * mix : star.color[0];
      const g = later ? star.color[1] + (later[1] - star.color[1]) * mix : star.color[1];
      const b = later ? star.color[2] + (later[2] - star.color[2]) * mix : star.color[2];
      // The flash swells as it fades; a star thins as it burns down.
      const size = star.twinkle === "flash" ? -star.size * (0.6 + 0.6 * t) : star.size * (1 - 0.35 * t);
      this.color.setXYZW(count, r * brightness, g * brightness, b * brightness, size);
      count += 1;
    }
    // Only the part in use goes to the GPU.
    for (const [attribute, size] of [
      [this.head, 3],
      [this.tail, 3],
      [this.color, 4],
    ] as const) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, Math.max(1, count) * size);
      attribute.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
  }

  clear(): void {
    this.rockets.length = 0;
    this.stars.length = 0;
    this.glows.length = 0;
    this.lightState.brightness = 0;
    this.showLeft = 0;
    this.draw();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
