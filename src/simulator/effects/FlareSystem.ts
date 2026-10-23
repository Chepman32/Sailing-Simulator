import * as THREE from "three";
import type { SpatialHandle } from "../audio/AudioSystem";
import type { InterestPoint } from "../camera/PhotoDirector";
import {
  FLARE_ASCENT_SECONDS,
  FLARE_BURN_SECONDS,
  FLARE_RELOAD_SECONDS,
  flareAltitude,
  flareBrightness,
  flarePhase,
} from "./FlareMath";

const WIND_DRIFT = new THREE.Vector3(6.8, 0, 4.2).multiplyScalar(0.32);
const MAX_TRAIL = 220;
const FLARE_LIGHT_INTENSITY = 42000;

export type FlareAudio = {
  launch: (position: THREE.Vector3) => SpatialHandle | undefined;
  burst: (position: THREE.Vector3) => void;
  burn: (position: THREE.Vector3, duration: number) => SpatialHandle | undefined;
};

function softTexture(inner: string, outer: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(0.35, outer);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Red parachute signal flare fired by the skipper: a hissing rocket climb
 * with a smoke trail, an apogee burst, then a flickering magnesium star that
 * drifts down under its parachute, lighting the sea red, before burning out.
 * The point light always exists (at zero intensity when idle) so firing never
 * changes the light count and recompiles materials.
 */
export class FlareSystem {
  readonly position = new THREE.Vector3();
  private readonly group = new THREE.Group();
  private readonly star: THREE.Sprite;
  private readonly halo: THREE.Sprite;
  private readonly light = new THREE.PointLight(0xff3a24, 0, 0, 2);
  private readonly trail: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly trailPositions: Float32Array;
  private readonly trailAges: number[] = [];
  private readonly origin = new THREE.Vector3();
  private readonly glowTexture = softTexture("rgba(255,255,255,1)", "rgba(255,120,90,.55)");
  private readonly smokeTexture = softTexture("rgba(255,255,255,.55)", "rgba(255,255,255,.22)");
  private readonly interest: InterestPoint;
  private age = Number.POSITIVE_INFINITY;
  private sinceLaunch = Number.POSITIVE_INFINITY;
  private trailCursor = 0;
  private trailTimer = 0;
  private hiss?: SpatialHandle;
  private burn?: SpatialHandle;
  private burst = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly audio: FlareAudio,
  ) {
    this.group.name = "SignalFlare";
    scene.add(this.group);
    this.star = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xff6f5c,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xff3c14,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.star.renderOrder = 7;
    this.halo.renderOrder = 7;
    this.group.add(this.halo, this.star, this.light);

    this.trailPositions = new Float32Array(MAX_TRAIL * 3).fill(-9999);
    for (let index = 0; index < MAX_TRAIL; index += 1) this.trailAges.push(Number.POSITIVE_INFINITY);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.trail = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        map: this.smokeTexture,
        color: 0xd8c4c0,
        size: 4.5,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 6;
    this.group.add(this.trail);
    this.interest = { kind: "flare", position: this.position, radius: 28, priority: 4, lookHeight: 0 };
  }

  get ready(): boolean {
    return this.sinceLaunch >= FLARE_RELOAD_SECONDS;
  }

  get active(): boolean {
    return flarePhase(this.age) !== "spent";
  }

  collectInterest(points: InterestPoint[]): void {
    if (flarePhase(this.age) === "burning") points.push(this.interest);
  }

  launch(origin: THREE.Vector3): boolean {
    if (!this.ready) return false;
    this.stopSounds();
    this.origin.copy(origin);
    this.position.copy(origin);
    this.age = 0;
    this.sinceLaunch = 0;
    this.burst = false;
    this.hiss = this.audio.launch(origin);
    return true;
  }

  update(delta: number, nightFactor: number): void {
    this.sinceLaunch += delta;
    if (!Number.isFinite(this.age)) {
      this.updateTrail(delta, false);
      return;
    }
    this.age += delta;
    const phase = flarePhase(this.age);
    if (phase === "spent") {
      this.star.visible = false;
      this.halo.visible = false;
      this.light.intensity = 0;
      this.stopSounds();
      this.updateTrail(delta, false);
      if (this.trailAges.every((age) => age > 6)) this.age = Number.POSITIVE_INFINITY;
      return;
    }

    // Wind drift grows once the parachute opens.
    const drift = phase === "ascent" ? this.age * 0.25 : FLARE_ASCENT_SECONDS * 0.25 + (this.age - FLARE_ASCENT_SECONDS);
    this.position.set(
      this.origin.x + WIND_DRIFT.x * drift,
      this.origin.y + flareAltitude(this.age),
      this.origin.z + WIND_DRIFT.z * drift,
    );
    this.star.position.copy(this.position);
    this.halo.position.copy(this.position);
    this.light.position.copy(this.position);
    this.hiss?.setPosition(this.position);
    this.burn?.setPosition(this.position);

    if (phase === "ascent") {
      this.star.visible = true;
      this.halo.visible = false;
      (this.star.material as THREE.SpriteMaterial).opacity = 0.9;
      this.star.scale.setScalar(2.2);
      this.light.intensity = 0;
    } else {
      if (!this.burst) {
        this.burst = true;
        this.hiss?.stop(0.2);
        this.hiss = undefined;
        this.audio.burst(this.position);
        this.burn = this.audio.burn(this.position, FLARE_BURN_SECONDS);
      }
      const flicker = 0.82 + Math.sin(this.age * 31) * 0.08 + Math.sin(this.age * 53 + 1) * 0.07 + (Math.random() - 0.5) * 0.08;
      const brightness = flareBrightness(this.age) * flicker;
      this.star.visible = true;
      this.halo.visible = true;
      (this.star.material as THREE.SpriteMaterial).opacity = Math.min(1, brightness * 1.2);
      (this.halo.material as THREE.SpriteMaterial).opacity = brightness * (0.8 + nightFactor * 0.2);
      this.star.scale.setScalar(5 + brightness * 3);
      const haloSize = 26 + nightFactor * 40;
      this.halo.scale.set(haloSize * flicker, haloSize * flicker, 1);
      this.light.intensity = FLARE_LIGHT_INTENSITY * brightness * (0.35 + nightFactor * 0.65);
    }
    this.updateTrail(delta, true);
  }

  dispose(): void {
    this.stopSounds();
    this.scene.remove(this.group);
    (this.star.material as THREE.SpriteMaterial).dispose();
    (this.halo.material as THREE.SpriteMaterial).dispose();
    this.trail.geometry.dispose();
    this.trail.material.dispose();
    this.glowTexture.dispose();
    this.smokeTexture.dispose();
  }

  private stopSounds(): void {
    this.hiss?.stop(0.2);
    this.burn?.stop(0.6);
    this.hiss = undefined;
    this.burn = undefined;
  }

  private updateTrail(delta: number, emitting: boolean): void {
    this.trailTimer -= delta;
    if (emitting && this.trailTimer <= 0) {
      this.trailTimer = flarePhase(this.age) === "ascent" ? 0.025 : 0.12;
      const slot = this.trailCursor;
      this.trailCursor = (this.trailCursor + 1) % MAX_TRAIL;
      this.trailAges[slot] = 0;
      this.trailPositions[slot * 3] = this.position.x;
      this.trailPositions[slot * 3 + 1] = this.position.y;
      this.trailPositions[slot * 3 + 2] = this.position.z;
    }
    for (let index = 0; index < MAX_TRAIL; index += 1) {
      this.trailAges[index] += delta;
      if (this.trailAges[index] > 14) {
        this.trailPositions[index * 3 + 1] = -9999;
        continue;
      }
      // Smoke drifts downwind and spreads slowly.
      this.trailPositions[index * 3] += WIND_DRIFT.x * delta * 0.8;
      this.trailPositions[index * 3 + 1] += delta * 0.25;
      this.trailPositions[index * 3 + 2] += WIND_DRIFT.z * delta * 0.8;
    }
    (this.trail.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }
}
