import * as THREE from "three";
import type { InterestPoint } from "../camera/PhotoDirector";
import { clamp } from "../math";
import { islandHeight, islandPoint, valueNoise2 } from "../world/IslandTerrain";
import type { IslandDefinition } from "../world/WorldLayout";
import {
  nextVolcanoPhase,
  VOLCANO_FIRST_QUIET_SECONDS,
  volcanoActivity,
  volcanoPhaseDuration,
  type VolcanoPhase,
} from "./VolcanoState";

/** Prevailing wind carries the plume; matches VesselPhysics' true wind. */
const WIND_DIRECTION = new THREE.Vector3(6.8, 0, 4.2).normalize();
const MAX_BOMBS = 160;

type Puff = {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  startSize: number;
  endSize: number;
  rotation: number;
  spin: number;
  shade: number;
  heat: number;
  peakOpacity: number;
};

type Bomb = {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  life: number;
};

const smokeVertexShader = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aSize;
  attribute float aRotation;
  attribute float aOpacity;
  attribute float aShade;
  attribute float aHeat;
  varying vec2 vUv;
  varying vec2 vCorner;
  varying float vOpacity;
  varying float vShade;
  varying float vHeat;
  varying float vFogDepth;
  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float c = cos(aRotation);
    float s = sin(aRotation);
    vec2 rotated = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
    vec3 world = aCenter + (right * rotated.x + up * rotated.y) * aSize;
    vec4 viewPosition = viewMatrix * vec4(world, 1.0);
    vUv = uv;
    vCorner = position.xy * 2.0;
    vOpacity = aOpacity;
    vShade = aShade;
    vHeat = aHeat;
    vFogDepth = -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const smokeFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunView;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying vec2 vCorner;
  varying float vOpacity;
  varying float vShade;
  varying float vHeat;
  varying float vFogDepth;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float density = tex.a * vOpacity;
    if (density < 0.004) discard;
    // Treat each puff as a soft sphere in view space: lit on the sun side,
    // self-shadowed on the far side, with texture detail breaking it up.
    float radius2 = clamp(dot(vCorner, vCorner), 0.0, 1.0);
    vec3 normal = normalize(vec3(vCorner, sqrt(1.0 - radius2) + 0.25));
    float lambert = max(dot(normal, normalize(uSunView)), 0.0);
    float light = 0.32 + lambert * 0.78 * (0.75 + tex.r * 0.5);
    vec3 albedo = mix(vec3(0.07, 0.065, 0.065), vec3(0.94, 0.94, 0.95), vShade);
    vec3 color = albedo * (uAmbient + uSunColor * light);
    // Incandescent underside of the ash column.
    color += vec3(1.0, 0.36, 0.08) * vHeat * (0.35 + (1.0 - vUv.y) * 0.9) * (0.6 + tex.r * 0.6);
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
    color = mix(color, uFogColor, fogFactor * 0.6);
    gl_FragColor = vec4(color, density);
  }
`;

function smokeTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size - 0.5;
      const v = y / size - 0.5;
      const radius = Math.hypot(u, v) * 2;
      let noise = 0;
      let amplitude = 0.5;
      let frequency = 4;
      for (let octave = 0; octave < 5; octave += 1) {
        noise += valueNoise2(u * frequency + 7, v * frequency + 3, octave * 5) * amplitude;
        amplitude *= 0.5;
        frequency *= 2.1;
      }
      // Cauliflower edge: the noise erodes the radial falloff.
      const density = clamp((1 - radius) * 1.6 + (noise - 0.5) * 1.1, 0, 1);
      const index = (y * size + x) * 4;
      data[index] = Math.round(noise * 255);
      data[index + 1] = Math.round(noise * 255);
      data[index + 2] = Math.round(noise * 255);
      data[index + 3] = Math.round(Math.pow(density, 1.4) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,250,220,1)");
    gradient.addColorStop(0.2, "rgba(255,190,90,.9)");
    gradient.addColorStop(0.5, "rgba(255,90,20,.3)");
    gradient.addColorStop(1, "rgba(255,60,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

export type VolcanoEvents = {
  onExplosion?: (position: THREE.Vector3, strength: number) => void;
};

/**
 * Eruption effects for the volcano island: a lit, wind-sheared steam and ash
 * plume (sorted instanced billboards), ballistic lava bombs, a pulsing crater
 * fountain glow and the lava emission that IslandSystem applies to the slopes.
 */
export class VolcanoSystem {
  readonly crater = new THREE.Vector3();
  private readonly group = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private readonly bombs: Bomb[] = [];
  private readonly smoke: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly smokeUniforms: Record<string, THREE.IUniform>;
  private readonly centers: Float32Array;
  private readonly sizes: Float32Array;
  private readonly rotations: Float32Array;
  private readonly opacities: Float32Array;
  private readonly shades: Float32Array;
  private readonly heats: Float32Array;
  private readonly order: number[] = [];
  private readonly bombPoints: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly bombPositions: Float32Array;
  private readonly fountain: THREE.Sprite;
  private readonly smokeTexture = smokeTexture();
  private readonly glow = glowTexture();
  private readonly interest: InterestPoint;
  private readonly interestCenter = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private phase: VolcanoPhase = "quiet";
  private phaseAge = 0;
  private phaseDuration = VOLCANO_FIRST_QUIET_SECONDS;
  private ashAccumulator = 0;
  private steamAccumulator = 0;
  private bombAccumulator = 0;
  private explosionTimer = 0;
  private lava = 0.12;
  private sortTimer = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly island: IslandDefinition,
    capacity: number,
    private readonly events: VolcanoEvents = {},
  ) {
    const top = islandPoint(island, 0, 0);
    this.crater.set(top.x, top.y + 1, top.z);
    this.group.name = "VolcanoEruptionEffects";
    scene.add(this.group);

    for (let index = 0; index < capacity; index += 1) {
      this.puffs.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: 0,
        life: 1,
        startSize: 1,
        endSize: 1,
        rotation: 0,
        spin: 0,
        shade: 1,
        heat: 0,
        peakOpacity: 0,
      });
      this.order.push(index);
    }
    this.centers = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.rotations = new Float32Array(capacity);
    this.opacities = new Float32Array(capacity);
    this.shades = new Float32Array(capacity);
    this.heats = new Float32Array(capacity);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("aCenter", new THREE.InstancedBufferAttribute(this.centers, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aRotation", new THREE.InstancedBufferAttribute(this.rotations, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(this.opacities, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aShade", new THREE.InstancedBufferAttribute(this.shades, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aHeat", new THREE.InstancedBufferAttribute(this.heats, 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeUniforms = {
      uMap: { value: this.smokeTexture },
      uSunView: { value: new THREE.Vector3(0.4, 0.6, 0.5) },
      uSunColor: { value: new THREE.Color(1, 0.96, 0.88) },
      uAmbient: { value: new THREE.Color(0.42, 0.48, 0.55) },
      uFogColor: { value: new THREE.Color(0xbdeaf5) },
      uFogDensity: { value: 0.00115 },
    };
    this.smoke = new THREE.InstancedMesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.smokeUniforms,
        vertexShader: smokeVertexShader,
        fragmentShader: smokeFragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
      capacity,
    );
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 5;
    this.smoke.name = "VolcanoPlume";
    this.group.add(this.smoke);

    this.bombPositions = new Float32Array(MAX_BOMBS * 3);
    for (let index = 0; index < MAX_BOMBS; index += 1) {
      this.bombs.push({ active: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 0, life: 1 });
    }
    const bombGeometry = new THREE.BufferGeometry();
    bombGeometry.setAttribute("position", new THREE.BufferAttribute(this.bombPositions, 3).setUsage(THREE.DynamicDrawUsage));
    bombGeometry.setDrawRange(0, 0);
    this.bombPoints = new THREE.Points(
      bombGeometry,
      new THREE.PointsMaterial({
        map: this.glow,
        color: 0xffb060,
        size: 7,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      }),
    );
    this.bombPoints.frustumCulled = false;
    this.bombPoints.renderOrder = 6;
    this.group.add(this.bombPoints);

    this.fountain = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glow,
        color: 0xff6a1e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      }),
    );
    this.fountain.position.copy(this.crater).y += 6;
    this.fountain.renderOrder = 6;
    this.group.add(this.fountain);

    this.interestCenter.set(island.x, 40, island.z);
    this.interest = { kind: "volcano", position: this.interestCenter, radius: 175, priority: 5, lookHeight: 0.55 };
  }

  get currentPhase(): VolcanoPhase {
    return this.phase;
  }

  /** 0…1 lava emission for the terrain material. */
  get lavaGlow(): number {
    return this.lava;
  }

  get erupting(): boolean {
    return this.phase === "eruption" || this.phase === "waning";
  }

  collectInterest(points: InterestPoint[]): void {
    if (this.phase === "eruption" || (this.phase === "waning" && this.phaseAge < 8)) points.push(this.interest);
  }

  update(
    delta: number,
    camera: THREE.Camera,
    lighting: { sunDirection: THREE.Vector3; sunColor: THREE.Color; sunIntensity: number; nightFactor: number; horizonColor: THREE.Color },
    fogDensity: number,
  ): void {
    this.phaseAge += delta;
    if (this.phaseAge >= this.phaseDuration) {
      this.phase = nextVolcanoPhase(this.phase);
      this.phaseAge = 0;
      this.phaseDuration = volcanoPhaseDuration(this.phase, Math.random());
      if (this.phase === "eruption") {
        this.events.onExplosion?.(this.crater, 1);
        this.explosionTimer = 3 + Math.random() * 3;
      }
    }
    const progress = this.phaseAge / this.phaseDuration;
    const activity = volcanoActivity(this.phase, progress);
    this.lava += (activity.lava - this.lava) * Math.min(1, delta * 0.8);

    if (this.phase === "eruption") {
      this.explosionTimer -= delta;
      if (this.explosionTimer <= 0) {
        this.explosionTimer = 3 + Math.random() * 4.5;
        this.events.onExplosion?.(this.crater, 0.45 + Math.random() * 0.45);
        this.bombAccumulator += 10;
      }
    }

    this.steamAccumulator += activity.steam * delta;
    this.ashAccumulator += activity.ash * delta;
    this.bombAccumulator += activity.bombs * delta;
    while (this.steamAccumulator >= 1) {
      this.steamAccumulator -= 1;
      this.emitPuff(false, activity.plumeSpeed);
    }
    while (this.ashAccumulator >= 1) {
      this.ashAccumulator -= 1;
      this.emitPuff(true, activity.plumeSpeed);
    }
    while (this.bombAccumulator >= 1) {
      this.bombAccumulator -= 1;
      this.emitBomb(activity.plumeSpeed);
    }

    this.updatePuffs(delta, camera, lighting, fogDensity);
    this.updateBombs(delta);
    const fountainMaterial = this.fountain.material as THREE.SpriteMaterial;
    const eruptive = this.phase === "eruption" ? 1 : this.phase === "waning" ? 1 - progress : 0;
    const flicker = 0.75 + Math.sin(this.phaseAge * 23) * 0.12 + Math.sin(this.phaseAge * 37) * 0.1;
    fountainMaterial.opacity = clamp(eruptive * flicker * 0.75 + this.lava * lighting.nightFactor * 0.35, 0, 1);
    const fountainSize = 18 + eruptive * 34 * flicker;
    this.fountain.scale.set(fountainSize, fountainSize * 1.3, 1);
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.smoke.geometry.dispose();
    this.smoke.material.dispose();
    this.bombPoints.geometry.dispose();
    this.bombPoints.material.dispose();
    (this.fountain.material as THREE.SpriteMaterial).dispose();
    this.smokeTexture.dispose();
    this.glow.dispose();
  }

  private emitPuff(ash: boolean, plumeSpeed: number): void {
    const puff = this.puffs.find((candidate) => !candidate.active) ?? this.oldestPuff();
    puff.active = true;
    puff.age = 0;
    puff.position.copy(this.crater);
    puff.position.x += (Math.random() - 0.5) * 8;
    puff.position.z += (Math.random() - 0.5) * 8;
    const speed = ash ? plumeSpeed * (0.75 + Math.random() * 0.5) : 3.5 + Math.random() * 2.5;
    puff.velocity.set((Math.random() - 0.5) * speed * 0.18, speed, (Math.random() - 0.5) * speed * 0.18);
    puff.life = ash ? 26 + Math.random() * 14 : 18 + Math.random() * 10;
    puff.startSize = ash ? 16 + Math.random() * 10 : 10 + Math.random() * 6;
    puff.endSize = ash ? 120 + Math.random() * 70 : 70 + Math.random() * 40;
    puff.rotation = Math.random() * Math.PI * 2;
    puff.spin = (Math.random() - 0.5) * 0.12;
    puff.shade = ash ? 0.08 + Math.random() * 0.18 : 0.78 + Math.random() * 0.18;
    puff.heat = ash ? 0.9 : 0.15;
    puff.peakOpacity = ash ? 0.95 : 0.42;
  }

  private oldestPuff(): Puff {
    return this.puffs.reduce((oldest, puff) => (puff.age / puff.life > oldest.age / oldest.life ? puff : oldest));
  }

  private emitBomb(plumeSpeed: number): void {
    const bomb = this.bombs.find((candidate) => !candidate.active);
    if (!bomb) return;
    bomb.active = true;
    bomb.age = 0;
    bomb.life = 9;
    bomb.position.copy(this.crater);
    const angle = Math.random() * Math.PI * 2;
    const spread = 6 + Math.random() * 16;
    bomb.velocity.set(Math.cos(angle) * spread, plumeSpeed * (0.9 + Math.random() * 0.9), Math.sin(angle) * spread);
  }

  private updatePuffs(
    delta: number,
    camera: THREE.Camera,
    lighting: { sunDirection: THREE.Vector3; sunColor: THREE.Color; sunIntensity: number; nightFactor: number; horizonColor: THREE.Color },
    fogDensity: number,
  ): void {
    let count = 0;
    for (const puff of this.puffs) {
      if (!puff.active) continue;
      puff.age += delta;
      if (puff.age >= puff.life) {
        puff.active = false;
        continue;
      }
      // Buoyant rise that decays; the wind shears the plume more with height.
      puff.velocity.y = Math.max(1.2, puff.velocity.y - puff.velocity.y * delta * 0.18);
      const height = puff.position.y - this.crater.y;
      const windSpeed = 2.5 + clamp(height / 120, 0, 1) * 6;
      puff.velocity.x += (WIND_DIRECTION.x * windSpeed - puff.velocity.x) * delta * 0.25;
      puff.velocity.z += (WIND_DIRECTION.z * windSpeed - puff.velocity.z) * delta * 0.25;
      puff.position.addScaledVector(puff.velocity, delta);
      puff.rotation += puff.spin * delta;
      count += 1;
    }

    // Back-to-front order for correct alpha blending (refreshed ~8 Hz).
    this.sortTimer -= delta;
    camera.getWorldPosition(this.scratch);
    if (this.sortTimer <= 0) {
      this.sortTimer = 0.12;
      const eye = this.scratch;
      this.order.sort((a, b) => {
        const puffA = this.puffs[a];
        const puffB = this.puffs[b];
        if (puffA.active !== puffB.active) return puffA.active ? -1 : 1;
        return puffB.position.distanceToSquared(eye) - puffA.position.distanceToSquared(eye);
      });
    }

    let slot = 0;
    for (const index of this.order) {
      const puff = this.puffs[index];
      if (!puff.active) continue;
      const t = puff.age / puff.life;
      const fadeIn = clamp(t / 0.08, 0, 1);
      const fadeOut = 1 - Math.pow(t, 1.6);
      this.centers[slot * 3] = puff.position.x;
      this.centers[slot * 3 + 1] = puff.position.y;
      this.centers[slot * 3 + 2] = puff.position.z;
      this.sizes[slot] = puff.startSize + (puff.endSize - puff.startSize) * Math.sqrt(t);
      this.rotations[slot] = puff.rotation;
      this.opacities[slot] = puff.peakOpacity * fadeIn * fadeOut;
      // Ash lightens as it disperses; heat fades quickly above the vent.
      this.shades[slot] = puff.shade + (0.55 - puff.shade) * t * 0.6;
      this.heats[slot] = puff.heat * Math.exp(-puff.age * 0.45) * (0.4 + this.lava * 0.6);
      slot += 1;
      if (slot >= count) break;
    }
    this.smoke.count = slot;
    const geometry = this.smoke.geometry;
    ["aCenter", "aSize", "aRotation", "aOpacity", "aShade", "aHeat"].forEach((name) => {
      (geometry.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
    });

    // Sun direction in view space for the per-puff sphere lighting.
    camera.matrixWorld.extractBasis(this.cameraRight, this.cameraUp, this.cameraForward);
    const sun = lighting.sunDirection;
    (this.smokeUniforms.uSunView.value as THREE.Vector3).set(
      sun.dot(this.cameraRight),
      sun.dot(this.cameraUp),
      sun.dot(this.cameraForward),
    );
    const daylight = 1 - lighting.nightFactor * 0.85;
    (this.smokeUniforms.uSunColor.value as THREE.Color).copy(lighting.sunColor).multiplyScalar(daylight * 0.95);
    (this.smokeUniforms.uAmbient.value as THREE.Color).setRGB(0.4, 0.46, 0.54).multiplyScalar(0.35 + daylight * 0.65);
    (this.smokeUniforms.uFogColor.value as THREE.Color).copy(lighting.horizonColor);
    this.smokeUniforms.uFogDensity.value = fogDensity;
  }

  private updateBombs(delta: number): void {
    let count = 0;
    for (const bomb of this.bombs) {
      if (!bomb.active) continue;
      bomb.age += delta;
      bomb.velocity.y -= 9.81 * delta;
      bomb.position.addScaledVector(bomb.velocity, delta);
      const radial = Math.hypot(bomb.position.x - this.island.x, (bomb.position.z - this.island.z) / this.island.scaleZ) / this.island.beachRadius;
      const angle = Math.atan2((bomb.position.z - this.island.z) / this.island.scaleZ, bomb.position.x - this.island.x);
      const ground = radial < 1 ? islandHeight(this.island, radial, angle) : -0.5;
      if (bomb.age >= bomb.life || (bomb.velocity.y < 0 && bomb.position.y <= ground + 0.5)) {
        bomb.active = false;
        continue;
      }
      this.bombPositions[count * 3] = bomb.position.x;
      this.bombPositions[count * 3 + 1] = bomb.position.y;
      this.bombPositions[count * 3 + 2] = bomb.position.z;
      count += 1;
    }
    this.bombPoints.geometry.setDrawRange(0, count);
    (this.bombPoints.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }
}
