import * as THREE from "three";
import {
  BOLT_MAX_SEGMENTS,
  buildBolt,
  createBoltShape,
  strikeLight,
  strikeProximity,
  strikesAround,
  type BoltShape,
  type Strike,
} from "./LightningMath";

/**
 * Lightning in the scene: the bolts themselves, and the numbers the sky, the
 * lights and the thunder need.
 *
 * A bolt is one mesh of camera-facing ribbons (one quad per channel segment)
 * with a bright core and a soft halo, additive and brighter than white so the
 * bloom pass turns it into light. The pool holds `MAX_BOLTS` meshes; each is
 * rebuilt in place when a new strike takes it. A strike farther away than
 * `BOLT_RENDER_DISTANCE` is drawn there at the same angular size (inside the
 * camera's far plane, behind the islands and ships on the horizon), dimmed by
 * the air and the rain between.
 */

const MAX_BOLTS = 3;
/** Strikes farther than this are drawn here, scaled to the same apparent size, m. */
export const BOLT_RENDER_DISTANCE = 1900;
/** Real width of the channel's core, m. */
const CHANNEL_WIDTH = 2.2;

const vertexShader = /* glsl */ `
  attribute vec4 aSegment;
  attribute vec4 aSegmentShape;
  attribute vec2 aCorner;
  uniform float uScale;
  uniform float uPixelAngle;
  uniform float uCoreWidth;
  varying float vAcross;
  varying float vBright;
  varying float vAlong;
  varying float vBranch;

  void main() {
    vec4 start = modelViewMatrix * vec4(aSegment.xy * uScale, 0.0, 1.0);
    vec4 end = modelViewMatrix * vec4(aSegment.zw * uScale, 0.0, 1.0);
    vec3 point = mix(start.xyz, end.xyz, aCorner.x);
    vec3 tangent = normalize(end.xyz - start.xyz + vec3(1.0e-5));
    vec3 across = normalize(cross(tangent, normalize(point)));
    float distance = length(point);
    // At least a few pixels wide however far away, so it never flickers out.
    float width = max(uCoreWidth * aSegmentShape.x, uPixelAngle * distance * (0.9 + 0.9 * aSegmentShape.x)) * 3.5;
    point += across * aCorner.y * width;
    vAcross = aCorner.y;
    vBright = aSegmentShape.y;
    vAlong = aSegmentShape.z;
    vBranch = aSegmentShape.w;
    gl_Position = projectionMatrix * vec4(point, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBrightness;
  uniform float uChannel;
  uniform float uReveal;
  uniform float uTransmission;
  varying float vAcross;
  varying float vBright;
  varying float vAlong;
  varying float vBranch;

  void main() {
    if (vAlong > uReveal) discard;
    // Branches flare with the first stroke; later strokes relight the main channel.
    float light = vBright * mix(uBrightness, uBrightness * 0.35 + uChannel * 0.1, vBranch) + uChannel * 0.06;
    float x2 = vAcross * vAcross;
    float core = exp(-x2 * 22.0);
    float halo = exp(-x2 * 3.2);
    vec3 color = uColor * light * uTransmission * (core * 14.0 + halo * 0.9);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Bolt = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  shape: BoltShape;
  strike: Strike | null;
};

export type StrikeEvent = {
  distance: number;
  /** World azimuth of the strike (heading convention: 0 = +Z, toward +X positive). */
  azimuth: number;
  kind: Strike["kind"];
};

export type LightningLight = {
  /** Light of the strikes on the scene around the yacht, 0…~1.6. */
  scene: number;
  /** Brightness of the sky flash, 0…~1.6. */
  sky: number;
  /** 0 the flash fills the sky … 1 only around `direction`. */
  focus: number;
  direction: THREE.Vector3;
};

export class LightningSystem {
  readonly group = new THREE.Group();
  private readonly bolts: Bolt[] = [];
  private readonly strikes: Strike[] = [];
  private readonly azimuths = new Map<number, number>();
  private readonly events: StrikeEvent[] = [];
  private lastStrikeId = -1;
  private readonly light: LightningLight = { scene: 0, sky: 0, focus: 0, direction: new THREE.Vector3(0, 0.2, 1) };
  private readonly forward = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.group.name = "Lightning";
    const index: number[] = [];
    for (let segment = 0; segment < BOLT_MAX_SEGMENTS; segment += 1) {
      const base = segment * 4;
      index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    const corners = new Float32Array(BOLT_MAX_SEGMENTS * 8);
    for (let segment = 0; segment < BOLT_MAX_SEGMENTS; segment += 1) {
      corners.set([0, -1, 0, 1, 1, -1, 1, 1], segment * 8);
    }
    for (let slot = 0; slot < MAX_BOLTS; slot += 1) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BOLT_MAX_SEGMENTS * 12), 3));
      geometry.setAttribute("aSegment", new THREE.BufferAttribute(new Float32Array(BOLT_MAX_SEGMENTS * 16), 4));
      geometry.setAttribute("aSegmentShape", new THREE.BufferAttribute(new Float32Array(BOLT_MAX_SEGMENTS * 16), 4));
      geometry.setAttribute("aCorner", new THREE.BufferAttribute(corners, 2));
      geometry.setIndex(index);
      geometry.setDrawRange(0, 0);
      const material = new THREE.ShaderMaterial({
        name: "LightningBolt",
        vertexShader,
        fragmentShader,
        uniforms: {
          uScale: { value: 1 },
          uPixelAngle: { value: 0.001 },
          uCoreWidth: { value: CHANNEL_WIDTH },
          uColor: { value: new THREE.Color(0.78, 0.84, 1.0) },
          uBrightness: { value: 0 },
          uChannel: { value: 0 },
          uReveal: { value: 0 },
          uTransmission: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `LightningBolt${slot}`;
      mesh.frustumCulled = false;
      mesh.visible = false;
      // After the sky and the sea, so both stay behind it.
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.bolts.push({ mesh, shape: createBoltShape(), strike: null });
    }
    scene.add(this.group);
  }

  /**
   * Advances the lightning to `time` for a storm level. Returns the light it
   * casts this frame; new strikes are queued for `consumeStrikes`.
   */
  update(time: number, storm: number, haze: number, camera: THREE.PerspectiveCamera, viewportHeight: number): LightningLight {
    strikesAround(time, storm, this.strikes);
    camera.getWorldDirection(this.forward);
    const cameraYaw = Math.atan2(this.forward.x, this.forward.z);
    const pixelAngle = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, viewportHeight);

    let best = 0;
    let scene = 0;
    for (const strike of this.strikes) {
      let azimuth = this.azimuths.get(strike.id);
      if (azimuth === undefined) {
        // Most strikes fall where the storm is, which is where one is looking
        // more often than not; the rest anywhere around.
        azimuth =
          strike.bearingSpread < 0.62 ? cameraYaw + (strike.bearingSeed - 0.5) * 2.5 : strike.bearingSeed * Math.PI * 2;
        this.azimuths.set(strike.id, azimuth);
        if (strike.id > this.lastStrikeId) {
          this.lastStrikeId = strike.id;
          this.events.push({ distance: strike.distance, azimuth, kind: strike.kind });
        }
        if (strike.kind === "ground") this.assignBolt(strike, azimuth, camera);
      }
      const light = strikeLight(strike, time - strike.start);
      const proximity = strikeProximity(strike.distance);
      scene = Math.max(scene, light.brightness * proximity);
      const sky = light.brightness * (0.3 + 0.7 * Math.sqrt(proximity));
      if (sky > best) {
        best = sky;
        const elevation = Math.atan2(strike.cloudBase, strike.distance) * (strike.kind === "cloud" ? 0.85 : 0.55);
        this.light.direction
          .set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation))
          .normalize();
        this.light.focus = 1 - proximity;
      }
    }
    this.light.scene = scene;
    this.light.sky = best;
    // Forget azimuths of strikes long gone.
    if (this.azimuths.size > 16) {
      for (const id of this.azimuths.keys()) if (!this.strikes.some((strike) => strike.id === id)) this.azimuths.delete(id);
    }

    for (const bolt of this.bolts) {
      const strike = bolt.strike;
      const material = bolt.mesh.material;
      if (!strike || time - strike.start > 1.2 || time < strike.start) {
        bolt.mesh.visible = false;
        bolt.strike = time < (strike?.start ?? 0) ? strike : null;
        continue;
      }
      const light = strikeLight(strike, time - strike.start);
      bolt.mesh.visible = light.reveal > 0 && (light.brightness > 0.004 || light.reveal < 1);
      material.uniforms.uBrightness.value = light.brightness;
      material.uniforms.uChannel.value = light.channel;
      material.uniforms.uReveal.value = light.reveal;
      material.uniforms.uPixelAngle.value = pixelAngle;
      // Air and rain between: far strikes through a downpour are dim and blue-grey.
      material.uniforms.uTransmission.value = Math.exp(-strike.distance * (0.00004 + haze * 0.00012));
    }
    return this.light;
  }

  /** Strikes that began since the last call (for the thunder). */
  consumeStrikes(): StrikeEvent[] {
    if (this.events.length === 0) return EMPTY;
    const events = this.events.splice(0, this.events.length);
    return events;
  }

  /** The bolts, to keep out of anything that should not see them (none at present). */
  get object(): THREE.Object3D {
    return this.group;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    for (const bolt of this.bolts) {
      bolt.mesh.geometry.dispose();
      bolt.mesh.material.dispose();
    }
  }

  private assignBolt(strike: Strike, azimuth: number, camera: THREE.Camera): void {
    // The free bolt, or the one whose strike is oldest.
    let bolt = this.bolts.find((candidate) => !candidate.strike);
    if (!bolt) bolt = this.bolts.reduce((oldest, candidate) => (candidate.strike!.start < oldest.strike!.start ? candidate : oldest));
    bolt.strike = strike;
    buildBolt(strike.seed, bolt.shape);
    const geometry = bolt.mesh.geometry;
    const segment = geometry.getAttribute("aSegment") as THREE.BufferAttribute;
    const shape = geometry.getAttribute("aSegmentShape") as THREE.BufferAttribute;
    const segments = bolt.shape.segments;
    const attributes = bolt.shape.attributes;
    const segmentArray = segment.array as Float32Array;
    const shapeArray = shape.array as Float32Array;
    for (let index = 0; index < bolt.shape.count; index += 1) {
      for (let corner = 0; corner < 4; corner += 1) {
        segmentArray.set(segments.subarray(index * 4, index * 4 + 4), (index * 4 + corner) * 4);
        shapeArray.set(attributes.subarray(index * 4, index * 4 + 4), (index * 4 + corner) * 4);
      }
    }
    segment.needsUpdate = true;
    shape.needsUpdate = true;
    geometry.setDrawRange(0, bolt.shape.count * 6);
    const distance = Math.min(strike.distance, BOLT_RENDER_DISTANCE);
    const scale = strike.cloudBase * (distance / strike.distance);
    bolt.mesh.material.uniforms.uScale.value = scale;
    bolt.mesh.material.uniforms.uCoreWidth.value = CHANNEL_WIDTH * (distance / strike.distance);
    bolt.mesh.position.set(
      camera.position.x + Math.sin(azimuth) * distance,
      0,
      camera.position.z + Math.cos(azimuth) * distance,
    );
    // The bolt's plane faces the observer.
    bolt.mesh.rotation.set(0, azimuth, 0);
    bolt.mesh.updateMatrixWorld();
  }
}

const EMPTY: StrikeEvent[] = [];
