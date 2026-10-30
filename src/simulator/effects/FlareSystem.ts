import * as THREE from "three";
import {
  FLARE_LIFE,
  FLARE_RELOAD,
  FLARE_RGB,
  FLARE_RISE,
  FLARE_SMOKE_LIFE,
  MAX_FLARES,
  flareBrightness,
  flareBurnEnd,
  FLARE_BURN_END,
  flarePosition,
  smokeOpacity,
  smokeRadius,
  type FlareColor,
  type FlareLaunch,
} from "./FlareMath";

/**
 * Signal flares in the scene: the burning star (a white-hot core in a halo
 * of its own colour, brighter than white so the bloom spreads it), and the
 * trail of smoke it leaves, lit from inside by the star while it burns.
 *
 * Up to `MAX_FLARES` fly at once; a new one takes the oldest slot. Nothing
 * is allocated per frame. The light they throw on the scene is not a light:
 * `brightest` hands it to the environment (see `EnvironmentSystem.setFlare`).
 */

/** Smoke puffs a flare leaves: densely while the motor burns, then sparsely. */
const PUFFS = 96;
const RISE_PUFF_INTERVAL = 0.045;
const BURN_PUFF_INTERVAL = 0.28;
/** Halo size of a burning star, m (it reads as a ball of light at 160 m). */
const HALO_SIZE = 46;
const CORE_SIZE = 7;

type Puff = { born: number; x: number; y: number; z: number };

type Flare = {
  launch: FlareLaunch;
  rgb: readonly [number, number, number];
  age: number;
  active: boolean;
  nextPuff: number;
  puffCount: number;
  puffs: Puff[];
  core: THREE.Sprite;
  halo: THREE.Sprite;
  smoke: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  position: THREE.Vector3;
  brightness: number;
};

const smokeVertex = /* glsl */ `
  attribute float aSize;
  attribute vec4 aShade;
  uniform float uScale;
  varying vec4 vShade;
  varying float vSeed;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(aSize * uScale / max(-view.z, 1.0), 1.0, 256.0);
    vShade = aShade;
    vSeed = fract(position.x * 0.137 + position.z * 0.071 + position.y * 0.019);
  }
`;

const smokeFragment = /* glsl */ `
  varying vec4 vShade;
  varying float vSeed;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    // A soft, lumpy puff rather than a disc.
    float angle = atan(p.y, p.x);
    float lumps = 0.82 + 0.18 * sin(angle * 3.0 + vSeed * 18.0) * sin(angle * 5.0 - vSeed * 7.0);
    float density = smoothstep(1.0, 0.15, r / lumps);
    gl_FragColor = vec4(vShade.rgb, vShade.a * density);
  }
`;

function radialTexture(size: number, falloff: (r: number) => number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const value = Math.round(255 * Math.max(0, Math.min(1, falloff(Math.hypot(dx, dy)))));
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = value;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class FlareSystem {
  readonly group = new THREE.Group();
  private readonly flares: Flare[] = [];
  private readonly coreTexture = radialTexture(64, (r) => Math.pow(Math.max(0, 1 - r), 2.2));
  private readonly haloTexture = radialTexture(64, (r) => Math.exp(-r * r * 5) * (1 - r * r * 0.2) - 0.01);
  private readonly scratch = { x: 0, y: 0, z: 0 };
  private readonly smokeTint = new THREE.Color();
  private reload = 0;
  private clock = 0;
  private seed = 1;

  constructor(scene: THREE.Scene) {
    this.group.name = "SignalFlares";
    for (let index = 0; index < MAX_FLARES; index += 1) this.flares.push(this.createFlare());
    scene.add(this.group);
  }

  /** Whether the gun is loaded (it takes a moment between shots). */
  get ready(): boolean {
    return this.reload <= 0;
  }

  /** The launch of the flare fired last, while it is still in the air. */
  get lastLaunch(): FlareLaunch | null {
    return this.last?.active ? this.last.launch : null;
  }

  private last: Flare | null = null;

  /** Fires a flare from (x, y, z), leaning downwind; false while reloading. */
  /** The flare gun's upgrade: climb, burn time, brightness (multipliers of the stock gun). */
  boost = { apex: 1, burn: 1, power: 1 };

  launch(color: FlareColor, x: number, y: number, z: number, windX: number, windZ: number): boolean {
    if (this.reload > 0) return false;
    this.reload = FLARE_RELOAD;
    // The oldest (or a free) slot.
    let slot = this.flares[0]!;
    for (const flare of this.flares) {
      if (!flare.active) {
        slot = flare;
        break;
      }
      if (flare.age > slot.age) slot = flare;
    }
    const wind = Math.hypot(windX, windZ);
    const launch = slot.launch;
    launch.x = x;
    launch.y = y;
    launch.z = z;
    launch.leanX = wind > 0.1 ? windX / wind : 0;
    launch.leanZ = wind > 0.1 ? windZ / wind : 0;
    launch.windX = windX;
    launch.windZ = windZ;
    this.seed = (this.seed * 16807) % 2147483647;
    launch.seed = (this.seed % 1000) / 100;
    launch.apex = this.boost.apex;
    launch.burn = this.boost.burn;
    launch.power = this.boost.power;
    slot.rgb = FLARE_RGB[color];
    slot.age = 0;
    slot.active = true;
    slot.nextPuff = 0;
    slot.puffCount = 0;
    slot.brightness = 0;
    this.last = slot;
    const [r, g, b] = slot.rgb;
    (slot.halo.material.color as THREE.Color).setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    return true;
  }

  /** Clears the sky (a restart). */
  clear(): void {
    for (const flare of this.flares) {
      flare.active = false;
      flare.core.visible = false;
      flare.halo.visible = false;
      flare.smoke.visible = false;
    }
  }

  /**
   * Moves the flares on. `ambient` is the sky's light (linear) the smoke is
   * seen by; `pixelScale` converts metres at 1 m into pixels.
   */
  update(delta: number, ambient: readonly [number, number, number], pixelScale: number): void {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    this.clock += dt;
    this.reload = Math.max(0, this.reload - dt);
    for (const flare of this.flares) {
      if (!flare.active) continue;
      flare.age += dt;
      const extraBurn = flareBurnEnd(flare.launch.burn) - FLARE_BURN_END;
      if (flare.age > FLARE_SMOKE_LIFE + extraBurn) {
        flare.active = false;
        flare.core.visible = false;
        flare.halo.visible = false;
        flare.smoke.visible = false;
        continue;
      }
      const position = flarePosition(flare.launch, flare.age, this.scratch);
      flare.position.set(position.x, position.y, position.z);
      flare.brightness = flareBrightness(flare.age, flare.launch.seed, flare.launch.burn) * (flare.launch.power ?? 1);

      // Smoke: puffs where the flare has been, drifting downwind.
      if (flare.age < FLARE_LIFE + extraBurn && flare.age >= flare.nextPuff && flare.puffCount < PUFFS) {
        const puff = flare.puffs[flare.puffCount]!;
        puff.born = flare.age;
        puff.x = position.x;
        puff.y = position.y;
        puff.z = position.z;
        flare.puffCount += 1;
        flare.nextPuff = flare.age + (flare.age < FLARE_RISE ? RISE_PUFF_INTERVAL : BURN_PUFF_INTERVAL);
      }
      this.drawStar(flare);
      this.drawSmoke(flare, ambient, pixelScale);
    }
  }

  /** The brightest flare burning, or null: what lights the scene. */
  brightest(): { position: THREE.Vector3; brightness: number; rgb: readonly [number, number, number] } | null {
    let best: Flare | null = null;
    for (const flare of this.flares) {
      if (flare.active && flare.brightness > 0 && (!best || flare.brightness > best.brightness)) best = flare;
    }
    return best ? { position: best.position, brightness: best.brightness, rgb: best.rgb } : null;
  }

  dispose(): void {
    for (const flare of this.flares) {
      flare.core.material.dispose();
      flare.halo.material.dispose();
      flare.smoke.geometry.dispose();
      flare.smoke.material.dispose();
    }
    this.coreTexture.dispose();
    this.haloTexture.dispose();
    this.group.removeFromParent();
  }

  private drawStar(flare: Flare): void {
    const burning = flare.brightness > 0.001;
    flare.core.visible = burning;
    flare.halo.visible = burning;
    if (!burning) return;
    const climbing = flare.age < FLARE_RISE;
    flare.core.position.copy(flare.position);
    flare.halo.position.copy(flare.position);
    // The motor is a small spark; the star a ball of light.
    const intensity = flare.brightness;
    const coreSize = climbing ? 2.2 : CORE_SIZE * (0.8 + 0.25 * intensity);
    flare.core.scale.setScalar(coreSize);
    const [r, g, b] = flare.rgb;
    // White-hot in the middle, tinted toward its colour.
    (flare.core.material.color as THREE.Color).setRGB(
      (6 + r * 22) * intensity,
      (6 + g * 22) * intensity,
      (6 + b * 22) * intensity,
      THREE.LinearSRGBColorSpace,
    );
    flare.halo.scale.setScalar(climbing ? 9 : HALO_SIZE * (0.75 + 0.35 * intensity));
    flare.halo.material.opacity = Math.min(1, intensity * (climbing ? 0.6 : 0.85));
    (flare.halo.material.color as THREE.Color).setRGB(r * 2.4, g * 2.4, b * 2.4, THREE.LinearSRGBColorSpace);
  }

  private drawSmoke(flare: Flare, ambient: readonly [number, number, number], pixelScale: number): void {
    const geometry = flare.smoke.geometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const sizes = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const shades = geometry.getAttribute("aShade") as THREE.BufferAttribute;
    const [r, g, b] = flare.rgb;
    // Grey smoke in the sky's light; a white smoke reads pale by day, dim at night.
    this.smokeTint.setRGB(0.2 + ambient[0] * 1.8, 0.2 + ambient[1] * 1.8, 0.22 + ambient[2] * 1.8);
    const skyLevel = Math.min(1, (ambient[0] + ambient[1] + ambient[2]) * 1.2);
    let visible = 0;
    for (let index = 0; index < flare.puffCount; index += 1) {
      const puff = flare.puffs[index]!;
      const age = flare.age - puff.born;
      const opacity = smokeOpacity(age);
      // The smoke drifts with the wind, rises a little as it cools, and the
      // turbulence frays it more the older it is.
      const swirl = Math.sqrt(age) * 1.3;
      const phase = index * 2.399 + flare.launch.seed;
      const x = puff.x + flare.launch.windX * age * 0.9 + Math.sin(phase + age * 0.37) * swirl;
      const y = puff.y + age * 0.35 + Math.sin(phase * 1.7 + age * 0.21) * swirl * 0.5;
      const z = puff.z + flare.launch.windZ * age * 0.9 + Math.cos(phase * 1.3 + age * 0.29) * swirl;
      positions.setXYZ(index, x, y, z);
      sizes.setX(index, smokeRadius(age) * 2);
      // Lit from inside by the star while it burns.
      const distance = Math.hypot(x - flare.position.x, y - flare.position.y, z - flare.position.z);
      const near = distance / 9;
      const glow = flare.brightness * 2.6 / (1 + near * near);
      const shade = this.smokeTint;
      shades.setXYZW(
        index,
        shade.r * (0.35 + 0.65 * skyLevel) + r * glow,
        shade.g * (0.35 + 0.65 * skyLevel) + g * glow,
        shade.b * (0.35 + 0.65 * skyLevel) + b * glow,
        opacity * (0.16 + 0.2 * skyLevel),
      );
      if (opacity > 0) visible = index + 1;
    }
    positions.needsUpdate = true;
    sizes.needsUpdate = true;
    shades.needsUpdate = true;
    geometry.setDrawRange(0, visible);
    flare.smoke.visible = visible > 0;
    flare.smoke.material.uniforms.uScale!.value = pixelScale;
  }

  private createFlare(): Flare {
    const additive = (texture: THREE.Texture): THREE.SpriteMaterial =>
      new THREE.SpriteMaterial({
        map: texture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      });
    const core = new THREE.Sprite(additive(this.coreTexture));
    const halo = new THREE.Sprite(additive(this.haloTexture));
    core.renderOrder = 7;
    halo.renderOrder = 6;
    core.frustumCulled = false;
    halo.frustumCulled = false;
    core.visible = false;
    halo.visible = false;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PUFFS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(PUFFS), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aShade", new THREE.BufferAttribute(new Float32Array(PUFFS * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const smoke = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        name: "FlareSmoke",
        vertexShader: smokeVertex,
        fragmentShader: smokeFragment,
        uniforms: { uScale: { value: 500 } },
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    smoke.frustumCulled = false;
    smoke.renderOrder = 5;
    smoke.visible = false;
    this.group.add(smoke, halo, core);
    return {
      launch: { x: 0, y: 0, z: 0, leanX: 0, leanZ: 0, windX: 0, windZ: 0, seed: 0 },
      rgb: FLARE_RGB.red,
      age: 0,
      active: false,
      nextPuff: 0,
      puffCount: 0,
      puffs: Array.from({ length: PUFFS }, () => ({ born: 0, x: 0, y: 0, z: 0 })),
      core,
      halo,
      smoke,
      position: new THREE.Vector3(),
      brightness: 0,
    };
  }
}
