import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { clamp, smoothstep } from "../math";
import { buildCloudNoise, CLOUD_NOISE_SIZE, weatherThresholdFor, weatherThresholds } from "./CloudNoise";
import type { SkyUniforms } from "./SkyUniforms";
import { CLOUD_BASE, CLOUD_MAP_RIM, cloudMarchFragment, cloudMarchVertex } from "./shaders/cloudShader";

/**
 * The map of the sky's clouds.
 *
 * `shaders/cloudShader.ts` marches the cloud volume; this class owns the
 * map it is marched into and the pace of it. The map is drawn a tile a
 * frame (`cloudTilesFor`² tiles to a pass), each pass from one snapshot of the
 * light, the cover and the wind, so its tiles agree. Three targets go
 * round: the pass before last and the last one are on show, blended by how
 * far the pass in hand has come, so the sky moves smoothly however long a
 * pass takes; the third is the one being drawn.
 *
 * Every consumer of the sky reads the same two textures through the shared
 * sky uniforms: the dome, the ocean's mirror and the lighting capture can
 * not disagree about where a cloud is.
 */

/**
 * Tiles along a side of the map: a pass takes this many squared frames.
 * Chosen so that a frame marches a few tens of thousands of texels whatever
 * the map's size; a pass then lasts about half a second, which a cloud
 * drifting at ten metres a second does not show.
 */
export function cloudTilesFor(size: number): number {
  return size >= 1400 ? 6 : size >= 900 ? 5 : 6;
}
/** Clouds drift this fast in the trade wind (m/s per unit of cloud clock), toward +x and a little +z. */
export const CLOUD_DRIFT = { x: 9.5, z: 5.2 } as const;

/** The dome's detail noise is laid at the drift modulo this (m), so its coordinates stay small enough for 32-bit floats. */
const DRIFT_WRAP = 65536;

/** Where a direction of the sky (unit, y up) lies in the map, 0…1 each way. */
export function cloudMapUv(x: number, y: number, z: number): { u: number; v: number } {
  const scale = (0.5 * CLOUD_MAP_RIM) / (1 + y);
  return { u: 0.5 + x * scale, v: 0.5 + z * scale };
}

/** The direction of the sky a point of the map shows (the inverse of `cloudMapUv`). */
export function cloudMapDirection(u: number, v: number): { x: number; y: number; z: number } {
  const cx = ((u - 0.5) * 2) / CLOUD_MAP_RIM;
  const cz = ((v - 0.5) * 2) / CLOUD_MAP_RIM;
  const radius2 = cx * cx + cz * cz;
  return { x: (2 * cx) / (1 + radius2), y: (1 - radius2) / (1 + radius2), z: (2 * cz) / (1 + radius2) };
}

/** The part of the map (uv offset and size) the `index`-th tile of a pass covers. */
export function cloudTile(index: number, perSide: number): { x: number; y: number; size: number } {
  const wrapped = ((index % (perSide * perSide)) + perSide * perSide) % (perSide * perSide);
  return { x: (wrapped % perSide) / perSide, y: Math.floor(wrapped / perSide) / perSide, size: 1 / perSide };
}

/**
 * Height of the tallest cloud tops (m) for a cover: fair-weather cumulus
 * are a kilometre and a half deep, a closed storm sky towers.
 */
export function cloudTopFor(cover: number): number {
  return CLOUD_BASE + 1500 + 2300 * smoothstep(0.5, 0.95, clamp(cover, 0, 1));
}

/**
 * Distance (m) over which the air takes a cloud into the horizon's colour:
 * far in clean fair-weather air, near under a heavy, hazy sky.
 */
export function cloudAerialFor(cover: number, night: number): number {
  return (34000 - 16000 * smoothstep(0.45, 0.95, clamp(cover, 0, 1))) * (1 - 0.25 * clamp(night, 0, 1));
}

/** Ray-march steps for a map of this size: the finer map earns the finer march. */
export function cloudStepsFor(size: number): number {
  return size >= 1400 ? 64 : size >= 900 ? 52 : 40;
}

export class CloudMap {
  private readonly noise: THREE.Data3DTexture;
  private readonly thresholds: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly placeholder: THREE.DataTexture;
  private targets: THREE.WebGLRenderTarget[] = [];
  /** Indices into `targets`: the two on show and the one being drawn. */
  private previous = 0;
  private current = 0;
  private drawing = 1;
  private tile = 0;
  private passes = 0;
  private size = 0;
  private readonly viewport = new THREE.Vector4();
  private readonly drift = new THREE.Vector2();

  constructor(private readonly sky: SkyUniforms) {
    const data = buildCloudNoise(CLOUD_NOISE_SIZE);
    this.thresholds = weatherThresholds(data, CLOUD_NOISE_SIZE);
    this.noise = new THREE.Data3DTexture(data, CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE);
    this.noise.format = THREE.RGBAFormat;
    this.noise.type = THREE.UnsignedByteType;
    this.noise.minFilter = THREE.LinearFilter;
    this.noise.magFilter = THREE.LinearFilter;
    this.noise.wrapS = THREE.RepeatWrapping;
    this.noise.wrapT = THREE.RepeatWrapping;
    this.noise.wrapR = THREE.RepeatWrapping;
    this.noise.unpackAlignment = 1;
    this.noise.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      name: "CloudMarch",
      vertexShader: cloudMarchVertex,
      fragmentShader: cloudMarchFragment,
      uniforms: {
        uNoise: { value: this.noise },
        uTile: { value: new THREE.Vector4(0, 0, 1, 1) },
        uLight: { value: new THREE.Vector3(0, 1, 0) },
        uLit: { value: new THREE.Color() },
        uShade: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uDrift: { value: new THREE.Vector2() },
        uThreshold: { value: 1 },
        uCover: { value: 0 },
        uTop: { value: cloudTopFor(0) },
        uSteps: { value: 48 },
        uJitter: { value: 0 },
        uAerial: { value: 30000 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.placeholder.needsUpdate = true;
    this.show();
  }

  /** Whether the sky's clouds come from the map (false: the flat procedural ones). */
  get active(): boolean {
    return this.size > 0 && this.passes > 0;
  }

  /**
   * The map's side in texels (0 switches the volume off and frees it). A
   * new size starts from an empty map: the next `update` draws a whole pass
   * at once.
   */
  setSize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    for (const target of this.targets) target.dispose();
    this.targets = [];
    this.passes = 0;
    this.tile = 0;
    this.previous = 0;
    this.current = 0;
    this.drawing = 1;
    if (size > 0) {
      for (let index = 0; index < 3; index += 1) {
        const target = new THREE.WebGLRenderTarget(size, size, {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          depthBuffer: false,
          stencilBuffer: false,
          minFilter: THREE.LinearMipmapLinearFilter,
          magFilter: THREE.LinearFilter,
          generateMipmaps: true,
        });
        target.texture.name = `CloudMap${index}`;
        target.texture.wrapS = THREE.ClampToEdgeWrapping;
        target.texture.wrapT = THREE.ClampToEdgeWrapping;
        this.targets.push(target);
      }
      this.material.uniforms.uSteps!.value = cloudStepsFor(size);
    }
    this.show();
  }

  /** The GPU lost the maps: start over from an empty one. */
  invalidate(): void {
    this.passes = 0;
    this.tile = 0;
    this.show();
  }

  /**
   * Draws the next tile of the pass in hand (the whole first pass at once,
   * so the sky never opens empty).
   * @param eyeX, eyeZ where the viewer is over the sea (m): clouds are passed under way.
   */
  update(renderer: THREE.WebGLRenderer, eyeX: number, eyeZ: number): void {
    if (this.size <= 0) return;
    // The dome's fine detail rides with the clouds as they are now.
    this.sky.uCloudDrift.value.set(
      (eyeX + this.sky.uCloudTime.value * CLOUD_DRIFT.x) % DRIFT_WRAP,
      (eyeZ + this.sky.uCloudTime.value * CLOUD_DRIFT.z) % DRIFT_WRAP,
    );
    const perSide = cloudTilesFor(this.size);
    const count = perSide * perSide;
    const first = this.passes === 0;
    if (this.tile === 0) this.snapshot(eyeX, eyeZ);
    const target = this.targets[first ? this.current : this.drawing]!;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    const tiles = first ? count : 1;
    for (let step = 0; step < tiles; step += 1) {
      const tile = cloudTile(this.tile, perSide);
      (this.material.uniforms.uTile!.value as THREE.Vector4).set(tile.x, tile.y, tile.size, tile.size);
      const edge = Math.round(this.size * tile.size);
      this.viewport.set(Math.round(tile.x * this.size), Math.round(tile.y * this.size), edge, edge);
      target.viewport.copy(this.viewport);
      target.scissor.copy(this.viewport);
      target.scissorTest = true;
      this.tile += 1;
      // The mip chain (the sea's blurred mirror reads it) is rebuilt once, when the pass is whole.
      target.texture.generateMipmaps = this.tile >= count;
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
    }
    target.texture.generateMipmaps = true;
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    if (this.tile >= count) {
      this.tile = 0;
      this.passes += 1;
      if (first) {
        this.previous = this.current;
      } else {
        const spare = this.previous === this.current ? 3 - this.current - this.drawing : this.previous;
        this.previous = this.current;
        this.current = this.drawing;
        this.drawing = spare;
      }
    }
    this.show();
  }

  /** One pass is drawn from one moment's light, cover and wind. */
  private snapshot(eyeX: number, eyeZ: number): void {
    const uniforms = this.material.uniforms;
    const sky = this.sky;
    const cover = sky.uCloudCover.value;
    (uniforms.uLight!.value as THREE.Vector3).copy(sky.uLightDirection.value);
    // By night a cloud is a dark shape against the stars: its moonlit side stays under the sky's own brightness.
    (uniforms.uLit!.value as THREE.Color).copy(sky.uCloudLit.value).multiplyScalar(1 - 0.45 * sky.uNight.value);
    (uniforms.uShade!.value as THREE.Color).copy(sky.uCloudShade.value);
    (uniforms.uHaze!.value as THREE.Color).copy(sky.uHorizon.value).multiplyScalar(1.04);
    this.drift.set(eyeX + sky.uCloudTime.value * CLOUD_DRIFT.x, eyeZ + sky.uCloudTime.value * CLOUD_DRIFT.z);
    (uniforms.uDrift!.value as THREE.Vector2).copy(this.drift);
    uniforms.uThreshold!.value = weatherThresholdFor(this.thresholds, cover);
    uniforms.uCover!.value = cover;
    uniforms.uTop!.value = cloudTopFor(cover);
    uniforms.uAerial!.value = cloudAerialFor(cover, sky.uNight.value);
    // A different dither each pass: blended, two passes' grain averages out.
    uniforms.uJitter!.value = (this.passes * 0.618034) % 1;
  }

  /** Hands the maps on show, and their blend, to everything that draws the sky. */
  private show(): void {
    const sky = this.sky;
    if (!this.active) {
      sky.uCloudMap.value = this.placeholder;
      sky.uCloudMapPrev.value = this.placeholder;
      sky.uCloudMapBlend.value = 1;
      sky.uCloudVolume.value = 0;
      return;
    }
    sky.uCloudMap.value = this.targets[this.current]!.texture;
    sky.uCloudMapPrev.value = this.targets[this.previous]!.texture;
    const perSide = cloudTilesFor(this.size);
    sky.uCloudMapBlend.value = this.tile / (perSide * perSide);
    sky.uCloudVolume.value = 1;
  }

  dispose(): void {
    for (const target of this.targets) target.dispose();
    this.targets = [];
    this.size = 0;
    this.passes = 0;
    this.show();
    this.noise.dispose();
    this.material.dispose();
    this.quad.dispose();
    this.placeholder.dispose();
  }
}
