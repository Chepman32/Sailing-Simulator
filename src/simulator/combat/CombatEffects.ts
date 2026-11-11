import * as THREE from "three";

/**
 * What a fight looks like in the air: tracer streaks, muzzle flashes,
 * sparks off armour, fire and the smoke of a holed hull or a burning drone.
 * Three draw calls for all of it (glow, smoke, tracers), every particle from
 * a fixed pool; nothing is allocated per frame.
 */

const GLOW_POOL = 360;
const SMOKE_POOL = 420;
const TRACER_POOL = 64;

const glowVertex = /* glsl */ `
  attribute float aSize;
  attribute vec4 aShade;
  uniform float uScale;
  varying vec4 vShade;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(aSize * uScale / max(-view.z, 0.5), 1.0, 320.0);
    vShade = aShade;
  }
`;

const glowFragment = /* glsl */ `
  varying vec4 vShade;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    float core = exp(-r * 5.0);
    gl_FragColor = vec4(vShade.rgb * (0.6 + core * 1.8), vShade.a * core);
  }
`;

const smokeVertex = /* glsl */ `
  attribute float aSize;
  attribute vec4 aShade;
  uniform float uScale;
  varying vec4 vShade;
  varying float vSeed;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(aSize * uScale / max(-view.z, 1.0), 1.0, 300.0);
    vShade = aShade;
    vSeed = fract(position.x * 0.137 + position.z * 0.071);
  }
`;

const smokeFragment = /* glsl */ `
  varying vec4 vShade;
  varying float vSeed;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    float angle = atan(p.y, p.x);
    float lumps = 0.8 + 0.2 * sin(angle * 3.0 + vSeed * 18.0) * sin(angle * 5.0 - vSeed * 7.0);
    float density = smoothstep(1.0, 0.1, r / lumps);
    gl_FragColor = vec4(vShade.rgb, vShade.a * density);
  }
`;

type Particle = {
  life: number;
  max: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  a: number;
  drag: number;
  gravity: number;
};

type Tracer = { life: number; max: number; fromX: number; fromY: number; fromZ: number; toX: number; toY: number; toZ: number; length: number; r: number; g: number; b: number };

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, () => ({ life: 0, max: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, grow: 0, r: 1, g: 1, b: 1, a: 0, drag: 0, gravity: 0 }));
}

function pointCloud(count: number, vertex: string, fragment: string, blending: THREE.Blending): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("aShade", new THREE.BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

export class CombatEffects {
  readonly group = new THREE.Group();
  private readonly glow = makeParticles(GLOW_POOL);
  private readonly smoke = makeParticles(SMOKE_POOL);
  private readonly tracers: Tracer[] = Array.from({ length: TRACER_POOL }, () => ({
    life: 0, max: 0, fromX: 0, fromY: 0, fromZ: 0, toX: 0, toY: 0, toZ: 0, length: 0, r: 1, g: 1, b: 1,
  }));
  private readonly glowPoints = pointCloud(GLOW_POOL, glowVertex, glowFragment, THREE.AdditiveBlending);
  private readonly smokePoints = pointCloud(SMOKE_POOL, smokeVertex, smokeFragment, THREE.NormalBlending);
  private readonly tracerLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private glowNext = 0;
  private smokeNext = 0;
  private tracerNext = 0;
  /** Light the smoke takes from the sky (dark at night). */
  private readonly ambient = new THREE.Color(0.7, 0.72, 0.75);

  constructor(scene: THREE.Scene) {
    this.group.name = "CombatEffects";
    const tracerGeometry = new THREE.BufferGeometry();
    tracerGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRACER_POOL * 6), 3).setUsage(THREE.DynamicDrawUsage));
    tracerGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRACER_POOL * 6), 3).setUsage(THREE.DynamicDrawUsage));
    tracerGeometry.setDrawRange(0, 0);
    this.tracerLines = new THREE.LineSegments(
      tracerGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.tracerLines.frustumCulled = false;
    // Smoke under the glow, so fire shows through it.
    this.smokePoints.renderOrder = 2;
    this.glowPoints.renderOrder = 3;
    this.tracerLines.renderOrder = 4;
    this.group.add(this.smokePoints, this.glowPoints, this.tracerLines);
    scene.add(this.group);
  }

  /** Pixels a 1 m particle covers at 1 m (from the camera's projection). */
  setPixelScale(scale: number): void {
    this.glowPoints.material.uniforms.uScale!.value = scale;
    this.smokePoints.material.uniforms.uScale!.value = scale;
  }

  setAmbient(color: readonly [number, number, number]): void {
    this.ambient.setRGB(color[0], color[1], color[2]);
  }

  private spawnGlow(): Particle {
    const particle = this.glow[this.glowNext]!;
    this.glowNext = (this.glowNext + 1) % GLOW_POOL;
    return particle;
  }

  private spawnSmoke(): Particle {
    const particle = this.smoke[this.smokeNext]!;
    this.smokeNext = (this.smokeNext + 1) % SMOKE_POOL;
    return particle;
  }

  /** A round's streak from muzzle to where it strikes (`warm`: a drone's red-orange tracer; else the rifle's pale one). */
  tracer(from: THREE.Vector3, to: THREE.Vector3, warm: boolean): void {
    const tracer = this.tracers[this.tracerNext]!;
    this.tracerNext = (this.tracerNext + 1) % TRACER_POOL;
    tracer.fromX = from.x;
    tracer.fromY = from.y;
    tracer.fromZ = from.z;
    tracer.toX = to.x;
    tracer.toY = to.y;
    tracer.toZ = to.z;
    const distance = from.distanceTo(to);
    // About 800 m/s: the streak crosses the gap in a fraction of a second.
    tracer.max = Math.max(0.05, distance / 800);
    tracer.life = 0;
    tracer.length = Math.min(9, distance * 0.35);
    if (warm) {
      tracer.r = 2.4;
      tracer.g = 0.75;
      tracer.b = 0.25;
    } else {
      tracer.r = 1.6;
      tracer.g = 1.45;
      tracer.b = 1.1;
    }
  }

  /** A muzzle flash. */
  flash(at: THREE.Vector3, size = 0.9): void {
    const particle = this.spawnGlow();
    Object.assign(particle, { life: 0, max: 0.06, x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, size, grow: 0, r: 1, g: 0.72, b: 0.35, a: 1, drag: 0, gravity: 0 });
  }

  /** Sparks off steel: `count` short-lived embers flung out round `at`. */
  sparks(at: THREE.Vector3, count = 10, heat = 1): void {
    for (let index = 0; index < count; index += 1) {
      const particle = this.spawnGlow();
      const speed = 3 + Math.random() * 7;
      const angle = Math.random() * Math.PI * 2;
      const lift = Math.random() * 0.9 + 0.1;
      Object.assign(particle, {
        life: 0,
        max: 0.25 + Math.random() * 0.45,
        x: at.x,
        y: at.y,
        z: at.z,
        vx: Math.cos(angle) * speed * (1 - lift * 0.5),
        vy: lift * speed,
        vz: Math.sin(angle) * speed * (1 - lift * 0.5),
        size: 0.09 + Math.random() * 0.08,
        grow: -0.1,
        r: 1,
        g: 0.62 + Math.random() * 0.25,
        b: 0.25,
        a: heat,
        drag: 1.2,
        gravity: 9.8,
      });
    }
  }

  /** Splinters and a puff where a round goes into the yacht. */
  splinters(at: THREE.Vector3): void {
    this.sparks(at, 5, 0.7);
    this.puff(at, 0.55, 0.9, 0.45, 0.42, 0.38);
  }

  /** One puff of smoke (`shade` grey 0…1 of the ambient light). */
  puff(at: THREE.Vector3, size: number, life: number, r = 0.25, g = 0.25, b = 0.26, rise = 1.2, opacity = 0.55): void {
    const particle = this.spawnSmoke();
    Object.assign(particle, {
      life: 0,
      max: life,
      x: at.x + (Math.random() - 0.5) * size * 0.3,
      y: at.y,
      z: at.z + (Math.random() - 0.5) * size * 0.3,
      vx: (Math.random() - 0.5) * 0.5,
      vy: rise * (0.7 + Math.random() * 0.6),
      vz: (Math.random() - 0.5) * 0.5,
      size,
      grow: size * 1.6,
      r,
      g,
      b,
      a: opacity,
      drag: 0.4,
      gravity: 0,
    });
  }

  /** Smoke from something burning: dark puffs drifting downwind (`windX`, `windZ` in m/s). */
  smokeFrom(at: THREE.Vector3, strength: number, windX: number, windZ: number): void {
    const particle = this.spawnSmoke();
    const dark = 0.12 + Math.random() * 0.1;
    Object.assign(particle, {
      life: 0,
      max: 4 + strength * 3 + Math.random() * 2,
      x: at.x + (Math.random() - 0.5) * 0.4,
      y: at.y,
      z: at.z + (Math.random() - 0.5) * 0.4,
      vx: windX * 0.35 + (Math.random() - 0.5) * 0.4,
      vy: 1.6 + strength * 1.8,
      vz: windZ * 0.35 + (Math.random() - 0.5) * 0.4,
      size: 0.9 + strength * 0.8,
      grow: 1.4 + strength * 1.6,
      r: dark,
      g: dark,
      b: dark * 1.05,
      a: 0.5 + strength * 0.25,
      drag: 0.25,
      gravity: 0,
    });
  }

  /** Licks of flame at `at`. */
  fire(at: THREE.Vector3, strength: number): void {
    const particle = this.spawnGlow();
    Object.assign(particle, {
      life: 0,
      max: 0.35 + Math.random() * 0.35,
      x: at.x + (Math.random() - 0.5) * 0.6,
      y: at.y,
      z: at.z + (Math.random() - 0.5) * 0.6,
      vx: (Math.random() - 0.5) * 0.6,
      vy: 1.5 + Math.random() * 1.5,
      vz: (Math.random() - 0.5) * 0.6,
      size: 0.5 + strength * 0.7,
      grow: -0.6,
      r: 1,
      g: 0.45 + Math.random() * 0.2,
      b: 0.12,
      a: 0.9,
      drag: 0.6,
      gravity: -1,
    });
  }

  /** A blast: a fireball, a burst of sparks, a column of smoke. */
  explosion(at: THREE.Vector3, scale = 1): void {
    for (let index = 0; index < 18; index += 1) {
      const particle = this.spawnGlow();
      const angle = Math.random() * Math.PI * 2;
      const out = (2 + Math.random() * 5) * scale;
      Object.assign(particle, {
        life: 0,
        max: 0.5 + Math.random() * 0.6,
        x: at.x,
        y: at.y + 0.5,
        z: at.z,
        vx: Math.cos(angle) * out,
        vy: (2 + Math.random() * 6) * scale,
        vz: Math.sin(angle) * out,
        size: (1.6 + Math.random() * 2.2) * scale,
        grow: 2 * scale,
        r: 1,
        g: 0.5 + Math.random() * 0.3,
        b: 0.15,
        a: 1,
        drag: 2.2,
        gravity: -0.5,
      });
    }
    this.sparks(at, 40, 1);
    for (let index = 0; index < 22; index += 1) {
      this.puff(
        at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3 * scale, Math.random() * 2 * scale, (Math.random() - 0.5) * 3 * scale)),
        (2 + Math.random() * 2) * scale,
        5 + Math.random() * 4,
        0.14,
        0.13,
        0.13,
        2.5 * scale,
        0.75,
      );
    }
  }

  update(delta: number): void {
    // Glow: flashes, sparks, fire.
    {
      const positions = this.glowPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
      const sizes = this.glowPoints.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const shades = this.glowPoints.geometry.getAttribute("aShade") as THREE.BufferAttribute;
      let count = 0;
      for (const particle of this.glow) {
        if (particle.life >= particle.max) continue;
        particle.life += delta;
        if (particle.life >= particle.max) continue;
        const damp = Math.exp(-particle.drag * delta);
        particle.vx *= damp;
        particle.vy = particle.vy * damp - particle.gravity * delta;
        particle.vz *= damp;
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.z += particle.vz * delta;
        particle.size = Math.max(0.01, particle.size + particle.grow * delta);
        const fade = 1 - particle.life / particle.max;
        positions.setXYZ(count, particle.x, particle.y, particle.z);
        sizes.setX(count, particle.size);
        shades.setXYZW(count, particle.r, particle.g, particle.b, particle.a * fade);
        count += 1;
      }
      positions.needsUpdate = true;
      sizes.needsUpdate = true;
      shades.needsUpdate = true;
      this.glowPoints.geometry.setDrawRange(0, count);
    }
    // Smoke, lit by the sky.
    {
      const positions = this.smokePoints.geometry.getAttribute("position") as THREE.BufferAttribute;
      const sizes = this.smokePoints.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const shades = this.smokePoints.geometry.getAttribute("aShade") as THREE.BufferAttribute;
      let count = 0;
      const light = this.ambient;
      for (const particle of this.smoke) {
        if (particle.life >= particle.max) continue;
        particle.life += delta;
        if (particle.life >= particle.max) continue;
        const damp = Math.exp(-particle.drag * delta);
        particle.vx *= damp;
        particle.vy *= damp;
        particle.vz *= damp;
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.z += particle.vz * delta;
        particle.size += particle.grow * delta * (1 - particle.life / particle.max);
        const t = particle.life / particle.max;
        const fade = Math.min(1, t * 8) * (1 - t) * (1 - t);
        positions.setXYZ(count, particle.x, particle.y, particle.z);
        sizes.setX(count, particle.size);
        shades.setXYZW(count, particle.r * light.r * 1.6, particle.g * light.g * 1.6, particle.b * light.b * 1.6, particle.a * fade);
        count += 1;
      }
      positions.needsUpdate = true;
      sizes.needsUpdate = true;
      shades.needsUpdate = true;
      this.smokePoints.geometry.setDrawRange(0, count);
    }
    // Tracers: a bright head running from the muzzle to the strike.
    {
      const positions = this.tracerLines.geometry.getAttribute("position") as THREE.BufferAttribute;
      const colors = this.tracerLines.geometry.getAttribute("color") as THREE.BufferAttribute;
      let count = 0;
      for (const tracer of this.tracers) {
        if (tracer.life >= tracer.max) continue;
        tracer.life += delta;
        if (tracer.life >= tracer.max) continue;
        const span = Math.hypot(tracer.toX - tracer.fromX, tracer.toY - tracer.fromY, tracer.toZ - tracer.fromZ) || 1;
        const head = Math.min(1, tracer.life / tracer.max);
        const tail = Math.max(0, head - tracer.length / span);
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        positions.setXYZ(count * 2, lerp(tracer.fromX, tracer.toX, tail), lerp(tracer.fromY, tracer.toY, tail), lerp(tracer.fromZ, tracer.toZ, tail));
        positions.setXYZ(count * 2 + 1, lerp(tracer.fromX, tracer.toX, head), lerp(tracer.fromY, tracer.toY, head), lerp(tracer.fromZ, tracer.toZ, head));
        colors.setXYZ(count * 2, tracer.r * 0.15, tracer.g * 0.15, tracer.b * 0.15);
        colors.setXYZ(count * 2 + 1, tracer.r, tracer.g, tracer.b);
        count += 1;
      }
      positions.needsUpdate = true;
      colors.needsUpdate = true;
      this.tracerLines.geometry.setDrawRange(0, count * 2);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.glowPoints.geometry.dispose();
    this.glowPoints.material.dispose();
    this.smokePoints.geometry.dispose();
    this.smokePoints.material.dispose();
    this.tracerLines.geometry.dispose();
    this.tracerLines.material.dispose();
  }
}
