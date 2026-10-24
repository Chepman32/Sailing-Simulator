import * as THREE from "three";
import { injectAfter, patchMaterialShader } from "../core/ShaderPatch";
import type { EnvironmentPalette } from "../environment/EnvironmentPalette";
import { smoothstep } from "../math";
import {
  airlinerPosition,
  contrailShape,
  FIRST_LOW_PASS,
  LOW_PASS_GAP,
  lowPassActive,
  lowPassPose,
  planAirliner,
  planLowPass,
  seeded,
  WIND_ALOFT,
  type Airliner,
  type AircraftPose,
  type LowPass,
} from "./AircraftMath";
import { buildAirliner, buildFloatplane, LIVERIES, type FloatplaneParts, type Owned } from "./AircraftModels";

/**
 * Aircraft in the scene.
 *
 * A light floatplane comes by low every couple of minutes — sightseeing,
 * or towing a bright advertising banner that ripples on its tow line — and
 * airliners cross high above, drawing contrails that lengthen behind them,
 * spread, drift with the wind aloft and fade. The airliners and their
 * trails are ten kilometres up, far beyond the camera's far plane: their
 * vertices are pulled in along the line of sight to `SKY_RADIUS` in the
 * vertex shader, which keeps their direction and angular size exactly.
 */

const SKY_RADIUS = 3000;
/** Airliners kept in the sky (about). */
const AIRLINERS = 3;
/** Contrail points per engine, one every `TRAIL_STEP` s. */
const TRAIL_POINTS = 260;
const TRAIL_STEP = 1;
/** Half the spacing of the two engines' trails, m. */
const ENGINE_OFFSET = 6;

const BANNERS = [
  ["TIKI BAR", "HAPPY HOUR 17:00"],
  ["VOLCANO TOURS", "BOOK YOUR FLIGHT TODAY"],
  ["FRESH COCONUTS", "BEACH 3 · ALL DAY"],
  ["MARRY ME, LENA?", "♥ ♥ ♥"],
  ["SUNSET CRUISE", "CAPTAIN RAY · CHANNEL 16"],
] as const;

/** Pulls far vertices in to the sky sphere (view space), keeping direction and angular size. */
const SKY_PROJECT = /* glsl */ `
  {
    float skyDistance = length(mvPosition.xyz);
    if (skyDistance > ${SKY_RADIUS.toFixed(1)}) mvPosition.xyz *= ${SKY_RADIUS.toFixed(1)} / skyDistance;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const contrailVertex = /* glsl */ `
  attribute vec3 aOther;
  attribute vec4 aShape; // side, width, opacity, along
  uniform float uPixelAngle;
  varying float vAcross;
  varying float vOpacity;
  varying float vAlong;
  varying float vElevation;
  void main() {
    vec3 point = position;
    vec3 tangent = aOther - point;
    tangent = length(tangent) > 1.0e-3 ? normalize(tangent) : vec3(1.0, 0.0, 0.0);
    vec3 toCamera = normalize(cameraPosition - point);
    vec3 side = normalize(cross(tangent, toCamera));
    // Never thinner than a pixel and a half (a sub-pixel ribbon would
    // shimmer); widened, it is made fainter by as much.
    float distance = length(cameraPosition - point);
    float width = max(aShape.y, distance * uPixelAngle * 1.5);
    vec3 world = point + side * aShape.x * width * 0.5;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    ${SKY_PROJECT}
    vAcross = aShape.x;
    vOpacity = aShape.z * aShape.y / width;
    vAlong = aShape.w;
    vElevation = normalize(world - cameraPosition).y;
  }
`;

const contrailFragment = /* glsl */ `
  uniform vec3 uLit;
  uniform float uTime;
  varying float vAcross;
  varying float vOpacity;
  varying float vAlong;
  varying float vElevation;
  float trailHash(float n) { return fract(sin(n) * 43758.5453); }
  float trailNoise(float x) {
    float i = floor(x);
    float f = fract(x);
    return mix(trailHash(i), trailHash(i + 1.0), f * f * (3.0 - 2.0 * f));
  }
  void main() {
    float across = vAcross;
    // A soft-edged tube of ice crystals, lumpy along its length as it ages.
    float body = exp(-across * across * 2.6);
    float lumps = 0.72 + 0.28 * trailNoise(vAlong * 0.012 + across * 1.7) * trailNoise(vAlong * 0.031 - uTime * 0.02);
    // Low over the horizon the air between thickens: the trail fades into the haze.
    float horizon = smoothstep(0.03, 0.2, vElevation);
    float alpha = body * lumps * vOpacity * horizon;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(uLit, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Trail = { points: THREE.Vector3[]; born: number[]; count: number; next: number };

type AirlinerVisual = {
  plan: Airliner | null;
  group: THREE.Group;
  strobes: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[];
  trails: [Trail, Trail];
  lastEmit: number;
};

export type LowPlaneState = { active: boolean; position: THREE.Vector3; velocity: THREE.Vector3; kind: "banner" | "tour" };

export class AircraftSystem {
  readonly group = new THREE.Group();
  private readonly owned: Owned = { geometries: [], materials: [], textures: [] };
  private readonly planes: FloatplaneParts[] = [];
  private readonly banner: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly bannerTextures: THREE.CanvasTexture[] = [];
  private readonly rope: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly bannerTime = { value: 0 };
  private readonly airliners: AirlinerVisual[] = [];
  private readonly contrails: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly random: () => number;
  private pass: LowPass | null = null;
  private passStart = 0;
  private nextPass = FIRST_LOW_PASS;
  private passes = 0;
  private readonly pose: AircraftPose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, bank: 0, vx: 0, vy: 0, vz: 0 };
  private readonly towPose: AircraftPose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, bank: 0, vx: 0, vy: 0, vz: 0 };
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly scratch = new THREE.Vector3();
  private readonly towWorld = new THREE.Vector3();
  private readonly point = { x: 0, y: 0, z: 0 };
  private nextAirliner = 0;
  readonly lowPlane: LowPlaneState = { active: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), kind: "tour" };
  /** The nearest airliner, for its distant rumble. */
  readonly airlinerSound = { active: false, position: new THREE.Vector3(), distance: Infinity };

  constructor(scene: THREE.Scene, seed = Date.now()) {
    this.group.name = "Aircraft";
    this.random = seeded(seed);

    // Two floatplanes: a sightseeing one and a banner tug.
    for (const livery of [LIVERIES[0]!, LIVERIES[1]!]) {
      const plane = buildFloatplane(livery, this.owned);
      plane.group.visible = false;
      this.planes.push(plane);
      this.group.add(plane.group);
    }

    // The banner: a ripple travelling down the cloth, growing toward its tail.
    const bannerGeometry = new THREE.PlaneGeometry(24, 3.6, 48, 4);
    bannerGeometry.translate(-12, -1.8, 0);
    bannerGeometry.rotateY(-Math.PI / 2);
    this.owned.geometries.push(bannerGeometry);
    for (const [title, line] of BANNERS) this.bannerTextures.push(this.bannerTexture(title, line));
    this.owned.textures.push(...this.bannerTextures);
    const bannerMaterial = new THREE.MeshStandardMaterial({ map: this.bannerTextures[0]!, side: THREE.DoubleSide, roughness: 0.85 });
    patchMaterialShader(bannerMaterial, "banner-ripple", (shader) => {
      shader.uniforms.uBannerTime = this.bannerTime;
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uBannerTime;");
      shader.vertexShader = injectAfter(
        shader.vertexShader,
        "begin_vertex",
        `{
           float along = clamp(-transformed.z / 24.0, 0.0, 1.0);
           float wave = sin(along * 9.0 - uBannerTime * 7.0) + 0.4 * sin(along * 17.0 - uBannerTime * 11.0 + 1.3);
           transformed.x += wave * (0.08 + along * along * 0.9);
           transformed.y -= along * along * 0.5;
         }`,
      );
    });
    this.owned.materials.push(bannerMaterial);
    this.banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    this.banner.visible = false;
    this.banner.castShadow = true;
    this.group.add(this.banner);
    const ropeGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const ropeMaterial = new THREE.LineBasicMaterial({ color: 0x2b2b2b });
    this.owned.geometries.push(ropeGeometry);
    this.owned.materials.push(ropeMaterial);
    this.rope = new THREE.Line(ropeGeometry, ropeMaterial);
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    this.group.add(this.rope);

    // Airliners, pulled in to the sky sphere.
    for (let index = 0; index < AIRLINERS; index += 1) {
      const { group, strobes } = buildAirliner(this.owned);
      group.visible = false;
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.frustumCulled = false;
        const material = object.material as THREE.Material;
        (material as THREE.MeshStandardMaterial).fog = false;
        patchMaterialShader(material, "sky-project", (shader) => {
          shader.vertexShader = injectAfter(shader.vertexShader, "project_vertex", SKY_PROJECT);
        });
      });
      this.group.add(group);
      const trail = (): Trail => ({ points: Array.from({ length: TRAIL_POINTS }, () => new THREE.Vector3()), born: new Array<number>(TRAIL_POINTS).fill(0), count: 0, next: 0 });
      this.airliners.push({ plan: null, group, strobes, trails: [trail(), trail()], lastEmit: 0 });
    }

    // One ribbon mesh for every contrail.
    const vertices = AIRLINERS * 2 * TRAIL_POINTS * 2;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aOther", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aShape", new THREE.BufferAttribute(new Float32Array(vertices * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    for (let trail = 0; trail < AIRLINERS * 2; trail += 1) {
      for (let point = 0; point < TRAIL_POINTS - 1; point += 1) {
        const a = (trail * TRAIL_POINTS + point) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geometry.setIndex(indices);
    this.contrails = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        name: "Contrails",
        vertexShader: contrailVertex,
        fragmentShader: contrailFragment,
        uniforms: { uLit: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 }, uPixelAngle: { value: 0.002 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.contrails.frustumCulled = false;
    this.contrails.renderOrder = -50;
    this.owned.geometries.push(geometry);
    this.owned.materials.push(this.contrails.material);
    this.group.add(this.contrails);
    scene.add(this.group);
  }

  /** The low plane, for the photographer: where it is (null when none is passing). */
  get photoSubject(): THREE.Vector3 | null {
    return this.lowPlane.active ? this.lowPlane.position : null;
  }

  update(time: number, delta: number, yachtX: number, yachtZ: number, eye: THREE.Vector3, palette: EnvironmentPalette, night: number, pixelAngle = 0.002): void {
    this.bannerTime.value = time;
    this.contrails.material.uniforms.uPixelAngle!.value = pixelAngle;
    this.updateLowPass(time, delta, yachtX, yachtZ, night);
    this.updateAirliners(time, yachtX, yachtZ, eye, palette, night);
  }

  dispose(): void {
    this.owned.geometries.forEach((geometry) => geometry.dispose());
    this.owned.materials.forEach((material) => material.dispose());
    this.owned.textures.forEach((texture) => texture.dispose());
    this.group.removeFromParent();
  }

  private updateLowPass(time: number, delta: number, yachtX: number, yachtZ: number, night: number): void {
    if (!this.pass && time >= this.nextPass) {
      // Banners fly by day; at night only the sightseeing plane, lights on.
      const kind = night < 0.5 && this.passes % 2 === 0 ? "banner" : "tour";
      this.pass = planLowPass(yachtX, yachtZ, this.random, kind);
      this.passStart = time;
      this.passes += 1;
      if (kind === "banner") this.banner.material.map = this.bannerTextures[this.pass.seed % this.bannerTextures.length]!;
    }
    const pass = this.pass;
    const plane = this.planes[pass?.kind === "banner" ? 1 : 0]!;
    for (const other of this.planes) other.group.visible = false;
    this.banner.visible = false;
    this.rope.visible = false;
    this.lowPlane.active = false;
    if (!pass) return;
    const t = time - this.passStart;
    if (!lowPassActive(pass, t)) {
      this.pass = null;
      this.nextPass = time + LOW_PASS_GAP[0] + this.random() * (LOW_PASS_GAP[1] - LOW_PASS_GAP[0]);
      return;
    }
    const pose = lowPassPose(pass, t, this.pose);
    plane.group.visible = true;
    plane.group.position.set(pose.x, pose.y, pose.z);
    // Heading about Y, pitch about X (nose up), roll about Z (right wing down for +bank).
    this.euler.set(-pose.pitch, pose.heading, -pose.bank, "YXZ");
    plane.group.quaternion.setFromEuler(this.euler);
    plane.propeller.rotation.z += delta * 2400 / 60 * Math.PI * 2 * 0.37;
    // Navigation lights: steady, the beacon flashing.
    const beacon = Math.sin(time * Math.PI * 2 * 0.9) > 0.92 ? 1 : 0.05;
    plane.lights[3]!.material.color.setRGB(5 * beacon, 0.3 * beacon, 0.2 * beacon, THREE.LinearSRGBColorSpace);
    this.lowPlane.active = true;
    this.lowPlane.kind = pass.kind;
    this.lowPlane.position.set(pose.x, pose.y, pose.z);
    this.lowPlane.velocity.set(pose.vx, pose.vy, pose.vz);

    if (pass.kind === "banner") {
      // The banner follows the plane's track 45 m behind (where the plane was), hanging upright.
      const lag = 45 / pass.speed;
      const tow = lowPassPose(pass, t - lag, this.towPose);
      this.banner.visible = true;
      this.banner.position.set(tow.x, tow.y - 9, tow.z);
      this.euler.set(0, tow.heading, 0, "YXZ");
      this.banner.quaternion.setFromEuler(this.euler);
      this.towWorld.copy(plane.towPoint).applyQuaternion(plane.group.quaternion).add(plane.group.position);
      const positions = this.rope.geometry.getAttribute("position") as THREE.BufferAttribute;
      positions.setXYZ(0, this.towWorld.x, this.towWorld.y, this.towWorld.z);
      positions.setXYZ(1, tow.x, tow.y - 9, tow.z);
      positions.needsUpdate = true;
      this.rope.visible = true;
    }
  }

  private updateAirliners(time: number, yachtX: number, yachtZ: number, eye: THREE.Vector3, palette: EnvironmentPalette, night: number): void {
    // Keep a few airliners in the sky; the first ones are already on their way.
    if (time >= this.nextAirliner) {
      const free = this.airliners.find((visual) => !visual.plan);
      if (free) {
        const plan = planAirliner(yachtX, yachtZ, time, this.random);
        // At the start, put it part-way along so the sky is not empty for minutes.
        if (time < 5) plan.startTime -= plan.duration * (0.25 + this.random() * 0.4);
        free.plan = plan;
        free.trails.forEach((trail) => {
          trail.count = 0;
          trail.next = 0;
        });
        free.lastEmit = -Infinity;
      }
      this.nextAirliner = time + (time < 5 ? 0.5 : 40 + this.random() * 60);
    }

    // Contrails are lit by the sun (pink at sunset, faint grey under the moon).
    const sun = palette.lightColor;
    const ambient = palette.ambientColor;
    (this.contrails.material.uniforms.uLit!.value as THREE.Color).setRGB(
      sun[0] * 0.42 + ambient[0] * 1.15,
      sun[1] * 0.42 + ambient[1] * 1.15,
      sun[2] * 0.42 + ambient[2] * 1.15,
      THREE.LinearSRGBColorSpace,
    );
    this.contrails.material.uniforms.uTime!.value = time;

    const geometry = this.contrails.geometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const others = geometry.getAttribute("aOther") as THREE.BufferAttribute;
    const shapes = geometry.getAttribute("aShape") as THREE.BufferAttribute;
    let nearest = Infinity;
    this.airlinerSound.active = false;
    this.airliners.forEach((visual, planeIndex) => {
      const plan = visual.plan;
      if (plan && time - plan.startTime > plan.duration + plan.persistence) {
        visual.plan = null;
      }
      const flying = plan !== null && time - plan.startTime <= plan.duration;
      visual.group.visible = flying;
      if (plan && flying) {
        const at = airlinerPosition(plan, time, this.point);
        visual.group.position.set(at.x, at.y, at.z);
        visual.group.rotation.set(0, plan.heading, 0);
        // A long way off, a white speck with a glint; at night its strobes.
        const strobe = Math.sin(time * Math.PI * 2 * 0.8 + plan.seed) > 0.94 ? 1 : 0;
        const beacon = Math.sin(time * Math.PI * 2 * 0.55 + plan.seed * 0.3) > 0.9 ? 1 : 0.15;
        visual.strobes[0]!.visible = visual.strobes[1]!.visible = strobe > 0 && night > 0.2;
        visual.strobes[2]!.visible = beacon > 0.5 && night > 0.2;
        const distance = Math.hypot(at.x - yachtX, at.y, at.z - yachtZ);
        if (distance < nearest) {
          nearest = distance;
          this.airlinerSound.active = true;
          // Heard where it was when the sound left it: well behind the plane.
          const lag = distance / 343;
          this.airlinerSound.position.set(at.x - Math.sin(plan.heading) * plan.speed * lag, at.y, at.z - Math.cos(plan.heading) * plan.speed * lag);
          this.airlinerSound.distance = distance;
        }
        // Lay down a contrail point behind each engine.
        if (time - visual.lastEmit >= TRAIL_STEP) {
          visual.lastEmit = time;
          const rightX = Math.cos(plan.heading);
          const rightZ = -Math.sin(plan.heading);
          visual.trails.forEach((trail, engine) => {
            const side = engine === 0 ? -1 : 1;
            const slot = trail.next;
            trail.points[slot]!.set(at.x + rightX * side * ENGINE_OFFSET, at.y - 1, at.z + rightZ * side * ENGINE_OFFSET);
            trail.born[slot] = time;
            trail.next = (slot + 1) % TRAIL_POINTS;
            trail.count = Math.min(TRAIL_POINTS, trail.count + 1);
          });
        }
      }
      // Write both trails' ribbons (oldest first); the newest point is the plane itself.
      visual.trails.forEach((trail, engine) => {
        const base = (planeIndex * 2 + engine) * TRAIL_POINTS;
        // Unused points collapse onto the newest one (no stray triangles).
        let px = eye.x;
        let py = eye.y + 9000;
        let pz = eye.z;
        let along = 0;
        for (let k = 0; k < TRAIL_POINTS; k += 1) {
          const vertex = (base + k) * 2;
          let opacity = 0;
          let width = 0;
          if (plan && k < trail.count) {
            const slot = (trail.next - trail.count + k + TRAIL_POINTS) % TRAIL_POINTS;
            const point = trail.points[slot]!;
            const age = time - trail.born[slot]!;
            const shape = contrailShape(age, plan.persistence);
            // The two trails merge as they spread; the wind aloft carries them off.
            const merge = smoothstep(4, 30, age);
            const rightX = Math.cos(plan.heading) * (engine === 0 ? 1 : -1) * ENGINE_OFFSET * merge;
            const rightZ = -Math.sin(plan.heading) * (engine === 0 ? 1 : -1) * ENGINE_OFFSET * merge;
            px = point.x + WIND_ALOFT.x * age + rightX + Math.sin(age * 0.11 + k * 0.7) * age * 0.12;
            py = point.y - age * 0.4;
            pz = point.z + WIND_ALOFT.z * age + rightZ;
            width = shape.width;
            opacity = shape.opacity * (engine === 0 ? 1 : 0.92) * (night > 0.6 ? 0.35 : 1);
            along = (trail.born[slot]! - plan.startTime) * plan.speed;
          }
          positions.setXYZ(vertex, px, py, pz);
          positions.setXYZ(vertex + 1, px, py, pz);
          shapes.setXYZW(vertex, -1, width, opacity, along);
          shapes.setXYZW(vertex + 1, 1, width, opacity, along);
        }
        // Each point's neighbour toward the newer end (the newest looks back).
        for (let k = 0; k < TRAIL_POINTS; k += 1) {
          const vertex = (base + k) * 2;
          const neighbour = (base + Math.min(TRAIL_POINTS - 1, k + 1)) * 2;
          let ox = positions.getX(neighbour);
          let oy = positions.getY(neighbour);
          let oz = positions.getZ(neighbour);
          if (k + 1 >= trail.count) {
            const previous = (base + Math.max(0, k - 1)) * 2;
            ox = 2 * positions.getX(vertex) - positions.getX(previous);
            oy = 2 * positions.getY(vertex) - positions.getY(previous);
            oz = 2 * positions.getZ(vertex) - positions.getZ(previous);
          }
          others.setXYZ(vertex, ox, oy, oz);
          others.setXYZ(vertex + 1, ox, oy, oz);
        }
      });
    });
    positions.needsUpdate = true;
    others.needsUpdate = true;
    shapes.needsUpdate = true;
  }

  private bannerTexture(title: string, line: string): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 320;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#ffd43a";
    g.fillRect(0, 0, canvas.width, canvas.height);
    // Hemmed edges and a weathered red border.
    g.strokeStyle = "#c81e1e";
    g.lineWidth = 14;
    g.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    g.fillStyle = "#c81e1e";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "900 150px Arial Black, Arial, sans-serif";
    // Banners are read from the plane's left side, nose toward the start of the text.
    g.save();
    g.translate(canvas.width, 0);
    g.scale(-1, 1);
    g.fillText(title, canvas.width / 2, 120);
    g.font = "bold 82px Arial, sans-serif";
    g.fillStyle = "#1d1d1f";
    g.fillText(line, canvas.width / 2, 245);
    g.restore();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }
}
