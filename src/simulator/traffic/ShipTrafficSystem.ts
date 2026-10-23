import * as THREE from "three";
import type { InterestPoint } from "../camera/PhotoDirector";
import type { OceanSystem } from "../environment/OceanSystem";
import { clamp } from "../math";
import { createShip, type ShipKind, type ShipModel } from "./ShipModels";
import {
  chooseShipSpawn,
  closestApproach,
  HornScheduler,
  planarDistance,
  SHIP_MIN_SPACING,
  SHIP_RECYCLE_DISTANCE,
} from "./ShipTraffic";

const SHIP_KINDS: readonly ShipKind[] = ["lng", "container", "tanker", "cruise"];
const WAKE_SEGMENTS = 26;
const WAKE_LENGTH = 320;
/** Only ships this close get a dedicated, tightly fitted shadow map. */
const SHADOW_RANGE = 1400;
const HORN_APPROACH_DISTANCE = 1150;
const VISIBLE_DISTANCE = 1250;

type Ship = {
  model: ShipModel;
  position: THREE.Vector3;
  heading: number;
  speed: number;
  pitch: number;
  roll: number;
  approachHornDone: boolean;
  nextCasualHorn: number;
  lastDangerHorn: number;
  wake: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  wakePositions: Float32Array;
  glows: THREE.Sprite[];
  interest: InterestPoint;
  lastDistance: number;
};

export type ShipLighting = {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemisphere: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  nightFactor: number;
};

export type ShipTrafficEvents = {
  onHorn?: (position: THREE.Vector3, kind: ShipKind) => void;
};

function wakeTexture(): THREE.CanvasTexture {
  const width = 64;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, width, height);
    // Turbulent central wake plus two diverging Kelvin arms, foam streaks.
    for (let index = 0; index < 900; index += 1) {
      const v = Math.random();
      const centre = (Math.random() - 0.5) * (0.18 + v * 0.35);
      const arm = Math.random() < 0.45 ? (Math.random() < 0.5 ? -1 : 1) * (0.12 + v * 0.36) : centre;
      const x = (0.5 + arm) * width;
      const y = v * height;
      const alpha = (1 - v) * (0.18 + Math.random() * 0.4);
      context.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      context.fillRect(x, y, 1 + Math.random() * 2.5, 3 + Math.random() * 10);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.3, "rgba(255,255,255,.35)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Merchant traffic. Ships live in their own scene, rendered before the main
 * scene each frame (sharing the depth buffer), so the nearest ship can own a
 * dedicated sun light whose shadow camera is fitted to that hull alone. That
 * gives crisp self-shadowing on containers, tank domes and superstructure at
 * a fixed texel density, independent of the yacht's shadow frustum. A sky
 * environment map gives steel and clear-coated tanks realistic reflections.
 */
export class ShipTrafficSystem {
  readonly scene = new THREE.Scene();
  private readonly ships: Ship[] = [];
  private readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  private readonly hemisphere = new THREE.HemisphereLight(0xbfeaff, 0x275960, 1.2);
  private readonly ambient = new THREE.AmbientLight(0x9bc5da, 0.3);
  private readonly horns = new HornScheduler();
  private readonly wakeTexture = wakeTexture();
  private readonly glowTexture = glowTexture();
  private readonly wakeMaterial: THREE.MeshBasicMaterial;
  private readonly environment: THREE.WebGLRenderTarget | null;
  private readonly random = Math.random;
  private readonly scratch = new THREE.Vector3();
  private time = 0;

  constructor(
    private readonly mainScene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    private readonly ocean: OceanSystem,
    shadowMapSize: number,
    yacht: THREE.Vector3,
    private readonly events: ShipTrafficEvents = {},
  ) {
    this.scene.name = "ShipTrafficPass";
    this.scene.fog = mainScene.fog;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 900;
    this.scene.add(this.sun, this.sun.target, this.hemisphere, this.ambient);
    this.environment = this.createEnvironment(renderer);
    this.scene.environment = this.environment?.texture ?? null;
    this.wakeMaterial = new THREE.MeshBasicMaterial({
      map: this.wakeTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    SHIP_KINDS.forEach((kind, index) => {
      const model = createShip(kind, 101 + index * 17);
      const ship = this.createShip(model, index);
      this.ships.push(ship);
    });
    this.ships.forEach((ship) => this.respawn(ship, yacht));
  }

  /** Nearest ship within view, if any, for the HUD or photo mode. */
  collectInterest(points: InterestPoint[], yacht: THREE.Vector3): void {
    for (const ship of this.ships) {
      if (planarDistance(ship.position, yacht) < 950) points.push(ship.interest);
    }
  }

  get positions(): ReadonlyArray<{ x: number; z: number; heading: number; length: number }> {
    return this.ships.map((ship) => ({ x: ship.position.x, z: ship.position.z, heading: ship.heading, length: ship.model.length }));
  }

  setShadowMapSize(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  fixedUpdate(delta: number, yacht: THREE.Vector3): void {
    this.time += delta;
    for (const ship of this.ships) {
      ship.position.x += Math.sin(ship.heading) * ship.speed * delta;
      ship.position.z += Math.cos(ship.heading) * ship.speed * delta;
      const distance = planarDistance(ship.position, yacht);
      const receding = distance > ship.lastDistance;
      ship.lastDistance = distance;
      if (distance > SHIP_RECYCLE_DISTANCE || (receding && distance > SHIP_RECYCLE_DISTANCE * 0.8)) {
        this.respawn(ship, yacht);
        continue;
      }
      this.maybeSoundHorn(ship, yacht, distance, receding);
    }
    // Ships on crossing courses may drift together; quietly move a distant one.
    for (let a = 0; a < this.ships.length; a += 1) {
      for (let b = a + 1; b < this.ships.length; b += 1) {
        if (planarDistance(this.ships[a].position, this.ships[b].position) >= SHIP_MIN_SPACING) continue;
        const far = planarDistance(this.ships[a].position, yacht) > planarDistance(this.ships[b].position, yacht) ? this.ships[a] : this.ships[b];
        if (planarDistance(far.position, yacht) > VISIBLE_DISTANCE) this.respawn(far, yacht);
      }
    }
  }

  /** Push the yacht out of any hull it runs into. Returns true on contact. */
  constrainVessel(position: THREE.Vector3, velocity: THREE.Vector3): boolean {
    let collided = false;
    for (const ship of this.ships) {
      const dx = position.x - ship.position.x;
      const dz = position.z - ship.position.z;
      if (dx * dx + dz * dz > (ship.model.length * 0.6) ** 2) continue;
      const sin = Math.sin(ship.heading);
      const cos = Math.cos(ship.heading);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      const halfBeam = ship.model.beam / 2 + 4;
      const halfLength = ship.model.length / 2 + 4;
      if (Math.abs(localX) >= halfBeam || Math.abs(localZ) >= halfLength) continue;
      collided = true;
      // Exit through the nearest side, carrying the ship's own velocity.
      const pushX = halfBeam - Math.abs(localX);
      const pushZ = halfLength - Math.abs(localZ);
      let outX = localX;
      let outZ = localZ;
      if (pushX < pushZ) outX = Math.sign(localX || 1) * halfBeam;
      else outZ = Math.sign(localZ || 1) * halfLength;
      position.x = ship.position.x + outX * cos + outZ * sin;
      position.z = ship.position.z - outX * sin + outZ * cos;
      const normalX = pushX < pushZ ? Math.sign(localX || 1) * cos : Math.sign(localZ || 1) * sin;
      const normalZ = pushX < pushZ ? -Math.sign(localX || 1) * sin : Math.sign(localZ || 1) * cos;
      const inward = velocity.x * normalX + velocity.z * normalZ;
      if (inward < 0) {
        velocity.x -= normalX * inward * 1.4;
        velocity.z -= normalZ * inward * 1.4;
      }
      velocity.x = velocity.x * 0.6 + Math.sin(ship.heading) * ship.speed * 0.3;
      velocity.z = velocity.z * 0.6 + Math.cos(ship.heading) * ship.speed * 0.3;
    }
    return collided;
  }

  update(time: number, camera: THREE.Camera, lighting: ShipLighting): void {
    camera.getWorldPosition(this.scratch);
    let nearest: Ship | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const ship of this.ships) {
      this.updatePose(ship, time);
      const distance = planarDistance(ship.position, this.scratch);
      ship.model.group.visible = distance < 2500;
      ship.wake.visible = distance < 1600;
      if (ship.wake.visible) this.updateWake(ship);
      const night = lighting.nightFactor;
      ship.model.windowMaterial.emissiveIntensity = THREE.MathUtils.smoothstep(night, 0.15, 0.6) * 1.6;
      ship.glows.forEach((glow) => {
        (glow.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.smoothstep(night, 0.1, 0.5);
      });
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = ship;
      }
    }
    this.syncLighting(lighting, nearest && nearestDistance < SHADOW_RANGE ? nearest : undefined);
  }

  dispose(): void {
    this.ships.forEach((ship) => {
      this.scene.remove(ship.model.group);
      this.mainScene.remove(ship.wake);
      ship.model.dispose();
      ship.wake.geometry.dispose();
      ship.glows.forEach((glow) => (glow.material as THREE.SpriteMaterial).dispose());
    });
    this.wakeMaterial.dispose();
    this.wakeTexture.dispose();
    this.glowTexture.dispose();
    this.environment?.dispose();
    this.sun.shadow.map?.dispose();
  }

  private createShip(model: ShipModel, index: number): Ship {
    this.scene.add(model.group);
    const positions = new Float32Array((WAKE_SEGMENTS + 1) * 3 * 3);
    const uvs = new Float32Array((WAKE_SEGMENTS + 1) * 3 * 2);
    const colors = new Float32Array((WAKE_SEGMENTS + 1) * 3 * 3);
    const indices: number[] = [];
    for (let row = 0; row <= WAKE_SEGMENTS; row += 1) {
      const v = row / WAKE_SEGMENTS;
      for (let column = 0; column < 3; column += 1) {
        const vertex = row * 3 + column;
        uvs[vertex * 2] = column / 2;
        uvs[vertex * 2 + 1] = v;
        const fade = Math.pow(1 - v, 1.3) * (column === 1 ? 1 : 0.85);
        colors[vertex * 3] = fade;
        colors[vertex * 3 + 1] = fade;
        colors[vertex * 3 + 2] = fade;
        if (row < WAKE_SEGMENTS && column < 2) {
          const next = vertex + 3;
          indices.push(vertex, next, vertex + 1, vertex + 1, next, next + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    const wake = new THREE.Mesh(geometry, this.wakeMaterial);
    wake.frustumCulled = false;
    wake.renderOrder = 3;
    wake.name = `ShipWake_${model.kind}`;
    this.mainScene.add(wake);

    const glows: THREE.Sprite[] = [];
    const addGlow = (color: number, position: THREE.Vector3, size: number): void => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      sprite.position.copy(position);
      sprite.scale.set(size, size, 1);
      model.group.add(sprite);
      glows.push(sprite);
    };
    addGlow(0xfff4dc, model.masthead, 7);
    addGlow(0xfff4dc, new THREE.Vector3(0, model.freeboard + 14, model.length / 2 - 14), 6);
    // Port (+X) red and starboard (-X) green sidelights.
    addGlow(0xff3030, new THREE.Vector3(model.beam / 2 + 1, model.masthead.y - 12, model.masthead.z + 3), 5);
    addGlow(0x30ff8a, new THREE.Vector3(-model.beam / 2 - 1, model.masthead.y - 12, model.masthead.z + 3), 5);

    const position = model.group.position;
    return {
      model,
      position,
      heading: 0,
      speed: 7 + index * 0.9,
      pitch: 0,
      roll: 0,
      approachHornDone: false,
      nextCasualHorn: 40 + Math.random() * 40,
      lastDangerHorn: Number.NEGATIVE_INFINITY,
      wake,
      wakePositions: positions,
      glows,
      interest: { kind: "ship", position, radius: model.length * 0.55, priority: 3, lookHeight: 0.12 },
      lastDistance: Number.POSITIVE_INFINITY,
    };
  }

  private respawn(ship: Ship, yacht: THREE.Vector3): void {
    const others = this.ships.filter((other) => other !== ship && Number.isFinite(other.position.x) && other.lastDistance !== Number.POSITIVE_INFINITY);
    const spawn = chooseShipSpawn(yacht, others.map((other) => other.position), this.random);
    if (!spawn) {
      // Park it far away and try again next time it is recycled.
      ship.position.set(yacht.x + 9000, 0, yacht.z + 9000);
      ship.lastDistance = Number.POSITIVE_INFINITY;
      return;
    }
    ship.position.set(spawn.x, 0, spawn.z);
    ship.heading = spawn.heading;
    ship.approachHornDone = false;
    ship.lastDistance = planarDistance(ship.position, yacht);
  }

  private maybeSoundHorn(ship: Ship, yacht: THREE.Vector3, distance: number, receding: boolean): void {
    let wants = false;
    if (!ship.approachHornDone && !receding && distance < HORN_APPROACH_DISTANCE) {
      wants = true;
    } else if (distance < 600) {
      const approach = closestApproach(ship.position, ship.heading, yacht);
      // The yacht is standing into the ship's path: warning blast.
      if (approach.along > 0 && approach.along < 700 && approach.distance < 120 && this.time - ship.lastDangerHorn > 45) {
        wants = true;
        if (this.horns.canSound(this.time)) ship.lastDangerHorn = this.time;
      }
    }
    if (!wants && distance < 1700 && this.time >= ship.nextCasualHorn) wants = true;
    if (!wants) return;
    if (!this.horns.trySound(this.time)) return;
    ship.approachHornDone = true;
    ship.nextCasualHorn = this.time + 70 + Math.random() * 60;
    this.scratch.copy(ship.model.masthead).applyMatrix4(ship.model.group.matrixWorld);
    this.events.onHorn?.(this.scratch, ship.model.kind);
  }

  private updatePose(ship: Ship, time: number): void {
    const forwardX = Math.sin(ship.heading);
    const forwardZ = Math.cos(ship.heading);
    const half = ship.model.length * 0.4;
    const bow = this.ocean.sample(ship.position.x + forwardX * half, ship.position.z + forwardZ * half).height;
    const stern = this.ocean.sample(ship.position.x - forwardX * half, ship.position.z - forwardZ * half).height;
    const middle = this.ocean.sample(ship.position.x, ship.position.z).height;
    ship.position.y = (bow + stern + middle * 2) / 4 - 0.15;
    ship.pitch = -Math.atan2(bow - stern, half * 2) * 0.8;
    ship.roll = Math.sin(time * 0.31 + ship.model.length) * 0.006;
    ship.model.group.rotation.set(ship.pitch, ship.heading, ship.roll, "YXZ");
    ship.model.group.updateMatrixWorld(true);
  }

  private updateWake(ship: Ship): void {
    const sin = Math.sin(ship.heading);
    const cos = Math.cos(ship.heading);
    const sternZ = -ship.model.length / 2 + 4;
    for (let row = 0; row <= WAKE_SEGMENTS; row += 1) {
      const v = row / WAKE_SEGMENTS;
      const behind = sternZ - v * WAKE_LENGTH;
      // The wake fans out behind the stern (Kelvin arms spread ~19.5°).
      const halfWidth = ship.model.beam * 0.42 + v * WAKE_LENGTH * 0.33;
      for (let column = 0; column < 3; column += 1) {
        const lateral = (column - 1) * halfWidth;
        const x = ship.position.x + lateral * cos + behind * sin;
        const z = ship.position.z - lateral * sin + behind * cos;
        const vertex = (row * 3 + column) * 3;
        ship.wakePositions[vertex] = x;
        ship.wakePositions[vertex + 1] = this.ocean.sample(x, z).height + 0.08;
        ship.wakePositions[vertex + 2] = z;
      }
    }
    (ship.wake.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  private syncLighting(lighting: ShipLighting, focus: Ship | undefined): void {
    this.sun.color.copy(lighting.sunColor);
    this.sun.intensity = lighting.sunIntensity;
    this.hemisphere.color.copy(lighting.hemisphere.color);
    this.hemisphere.groundColor.copy(lighting.hemisphere.groundColor);
    this.hemisphere.intensity = lighting.hemisphere.intensity;
    this.ambient.color.copy(lighting.ambient.color);
    this.ambient.intensity = lighting.ambient.intensity;
    this.scene.environmentIntensity = clamp(1 - lighting.nightFactor * 0.88, 0.12, 1) * 0.55;
    this.sun.castShadow = Boolean(focus);
    if (!focus) return;
    // Fit an orthographic shadow camera tightly around this one hull.
    const radius = Math.hypot(focus.model.length / 2, focus.model.beam / 2) + 12;
    this.sun.target.position.copy(focus.position);
    this.sun.position.copy(focus.position).addScaledVector(lighting.sunDirection, 420);
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -radius;
    shadowCamera.right = radius;
    shadowCamera.top = radius;
    shadowCamera.bottom = -radius;
    shadowCamera.near = 420 - radius - 60;
    shadowCamera.far = 420 + radius + 60;
    shadowCamera.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
  }

  /** Small PMREM sky so steel and clear-coat reflect a tropical sky. */
  private createEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget | null {
    try {
      const skyScene = new THREE.Scene();
      const geometry = new THREE.SphereGeometry(10, 32, 16);
      const colors: number[] = [];
      const positions = geometry.getAttribute("position");
      const zenith = new THREE.Color(0x1d8fd6);
      const horizon = new THREE.Color(0xd8f1f7);
      const sea = new THREE.Color(0x0b4a63);
      const color = new THREE.Color();
      for (let index = 0; index < positions.count; index += 1) {
        const y = positions.getY(index) / 10;
        if (y >= 0) color.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
        else color.copy(horizon).lerp(sea, Math.min(1, -y * 4));
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
      skyScene.add(new THREE.Mesh(geometry, material));
      // A bright sun disc gives the clear-coat a crisp reflection highlight.
      const sun = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 8) }));
      sun.position.set(5.6, 6.3, -5);
      skyScene.add(sun);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const target = pmrem.fromScene(skyScene, 0.02);
      pmrem.dispose();
      geometry.dispose();
      material.dispose();
      sun.geometry.dispose();
      (sun.material as THREE.Material).dispose();
      return target;
    } catch (error) {
      console.warn("Ship environment map could not be generated.", error);
      return null;
    }
  }
}
