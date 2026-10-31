import * as THREE from "three";
import { SHIP_SHADOW_LAYER } from "./ShipShadows";
import { injectAfter, patchMaterialShader } from "../core/ShaderPatch";
import type { OceanSample } from "../environment/OceanMath";
import type { UnderwaterLight } from "../environment/UnderwaterLight";
import { buildShipGeometry } from "./ShipGeometry";
import { ShipModels } from "./ShipModels";
import {
  createShip,
  MAX_SHIPS,
  MOVING_SHIPS,
  planAnchorage,
  planLane,
  SHIP_KINDS,
  shipContact,
  nearestHullClearance,
  canSoundHorn,
  HORN_RETRY_SECONDS,
  shipHornSignal,
  shipOutOfRange,
  stepShip,
  writeShipUniforms,
  type HornSignal,
  type Ship,
  type ShipKind,
  type ShipWorld,
} from "./ShipMath";

/** Ships nearer than this answer the yacht's horn, metres. */
const HAIL_RANGE = 900;

export type ShipHornEvent = { position: THREE.Vector3; signal: Exclude<HornSignal, null>; length: number };

export type ShipSoundSource = {
  position: THREE.Vector3;
  speed: number;
  anchored: boolean;
  length: number;
};

type ShipVisual = {
  root: THREE.Group;
  hull: THREE.Mesh;
  /** The imported model drawn instead of the procedural hull, once loaded. */
  model: THREE.Group | null;
  modelKey: string;
  beacons: THREE.Points;
  material: THREE.MeshStandardMaterial;
  beaconMaterial: THREE.ShaderMaterial;
  anchored: { value: number };
  key: string;
  heave: number;
  pitch: number;
  roll: number;
};

type ContactBody = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
};

/** Points of the yacht's outline tested against a ship's side, metres (across, along). */
const YACHT_OUTLINE: readonly [number, number][] = [
  [0, 5.6],
  [-2.4, 3.2],
  [2.4, 3.2],
  [-2.6, -4.4],
  [2.6, -4.4],
  [0, -4.8],
];

/**
 * A ship is a landmark: the sea haze (tuned for the water and the islands)
 * would melt a vessel three kilometres off into the horizon, so it veils her
 * at a little over half strength: her silhouette stays readable, but a far
 * ship takes the air's colour like everything else instead of standing out
 * crisp and saturated as a toy would.
 */
function applyShipHaze(material: THREE.Material): void {
  patchMaterialShader(material, "ship-haze-v1", (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      `#ifdef USE_FOG
        float shipFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth * 0.4 );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, shipFog );
      #endif`,
    );
  });
}

/**
 * Lit windows on an imported model at night: a grid of panes over the walls
 * of her accommodation (every deck of a liner or a ferry, the block round a
 * cargo ship's bridge), some lit warm, a few cold, with a faint wash of deck
 * lighting over the superstructure. Far off, where the panes are smaller
 * than a pixel, the grid gives way to its average so it does not shimmer.
 * `windows` = (deck height, accommodation from z, to z, 1 for a passenger
 * ship); positions are the model's own (ship frame: bow +Z, waterline 0).
 */
function applyShipWindows(material: THREE.Material, night: { value: number }, windows: { value: THREE.Vector4 }): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  patchMaterialShader(material, "ship-windows-v1", (shader) => {
    shader.uniforms.uShipNight = night;
    shader.uniforms.uShipWindows = windows;
    shader.vertexShader = injectAfter(
      shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vShipObject;\nvarying vec3 vShipObjectNormal;"),
      "begin_vertex",
      "vShipObject = transformed;\nvShipObjectNormal = objectNormal;",
    );
    shader.fragmentShader = injectAfter(
      shader.fragmentShader.replace(
        "#include <common>",
        "#include <common>\nuniform float uShipNight;\nuniform vec4 uShipWindows;\nvarying vec3 vShipObject;\nvarying vec3 vShipObjectNormal;",
      ),
      "emissivemap_fragment",
      `if (uShipNight > 0.001) {
        vec3 shipP = vShipObject;
        vec3 shipN = normalize(vShipObjectNormal);
        float shipWall = 1.0 - smoothstep(0.25, 0.45, abs(shipN.y));
        float shipAbove = uShipWindows.w > 0.5
          ? step(uShipWindows.x * 0.55, shipP.y)
          : step(uShipWindows.x + 1.5, shipP.y) * step(uShipWindows.y, shipP.z) * step(shipP.z, uShipWindows.z);
        if (shipWall * shipAbove > 0.0) {
          float shipAlong = abs(shipN.x) > abs(shipN.z) ? shipP.z : shipP.x;
          vec2 shipCellCoord = vec2(shipAlong / 2.4, shipP.y / 2.9);
          vec2 shipCell = floor(shipCellCoord);
          vec2 shipF = fract(shipCellCoord);
          float shipSide = shipN.x + shipN.z * 3.0 > 0.0 ? 1.0 : 0.0;
          float shipHash = fract(sin(dot(shipCell + shipSide * 17.0, vec2(12.9898, 78.233))) * 43758.5453);
          float shipPane = step(0.18, shipF.x) * step(shipF.x, 0.82) * step(0.32, shipF.y) * step(shipF.y, 0.78) * step(0.42, shipHash);
          vec2 shipGrad = fwidth(shipCellCoord);
          float shipBlur = clamp(max(shipGrad.x, shipGrad.y) * 1.6 - 0.35, 0.0, 1.0);
          float shipWindow = mix(shipPane, 0.17, shipBlur);
          vec3 shipWarm = mix(vec3(1.0, 0.72, 0.42), vec3(0.78, 0.87, 1.0), step(0.92, shipHash));
          totalEmissiveRadiance += (shipWarm * shipWindow * 1.9 + vec3(0.06, 0.05, 0.035)) * shipWall * shipAbove * uShipNight;
        }
      }`,
    );
  });
}

/**
 * Owns the ships near the yacht: plans their passages, steps them, draws
 * them (one mesh per ship plus, at night, its points of light), feeds their
 * wakes to the ocean, keeps the yacht out of their hulls and reports their
 * sound signals. Ships far astern are replaced by new ones far ahead, out of
 * sight in the haze.
 */
export class ShipSystem {
  readonly ships: Ship[] = [];
  private readonly visuals: ShipVisual[] = [];
  private readonly geometries = new Map<string, { hull: THREE.BufferGeometry; beacons: THREE.BufferGeometry }>();
  readonly group = new THREE.Group();
  private readonly night = { value: 0 };
  private readonly pixelRatio = { value: 1 };
  private readonly normal = { x: 0, z: 0 };
  private readonly world: ShipWorld;
  private readonly horns: ShipHornEvent[] = [];
  /** When a horn last sounded (any ship): a global minimum gap keeps the sea from honking. */
  private lastHorn = -Infinity;
  /** A ship answering the yacht's horn: which, and in how many seconds. */
  private reply: { ship: Ship; delay: number } | null = null;
  private readonly sources: ShipSoundSource[] = [];
  private readonly random: () => number;
  private initialized = false;
  private time = 0;
  private yachtHeading = 0;
  private readonly retry: number[] = Array.from({ length: MAX_SHIPS }, () => 0);
  private readonly models: ShipModels;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly underwater: UnderwaterLight,
    shoreDistance: (x: number, z: number) => number,
    random: () => number = Math.random,
    /** Whether to fetch the imported ship models (about 20 MB; off on the low preset). */
    loadModels = true,
    /** Extra shading for every ship material (the ships' own shadows). */
    private readonly decorate: (material: THREE.Material) => void = () => undefined,
  ) {
    this.random = random;
    this.group.name = "DistantShips";
    scene.add(this.group);
    this.world = { shoreDistance, windFrom: 0, time: 0 };
    // Imported models load in the background; procedural ships stand in.
    this.models = new ShipModels((material, windows) => {
      // Painted steel, not plastic: no glossy sheen over a whole hull.
      if (material instanceof THREE.MeshStandardMaterial) {
        material.roughness = Math.max(material.roughness, 0.62);
        material.metalness = Math.min(material.metalness, 0.18);
      }
      applyShipWindows(material, this.night, windows);
      this.underwater.apply(material);
      applyShipHaze(material);
      this.decorate(material);
    });
    if (loadModels) void this.models.load();
    const kinds = [...SHIP_KINDS].sort(() => this.random() - 0.5);
    for (let slot = 0; slot < MAX_SHIPS; slot += 1) {
      const ship = createShip(kinds[slot % kinds.length]!, this.random);
      this.ships.push(ship);
      this.visuals.push(this.createVisual(ship, slot));
    }
    writeShipUniforms(this.ships);
  }

  /** Brightness of the ships' lights, 0 by day … 1 at night. */
  setNight(nightFactor: number): void {
    this.night.value = THREE.MathUtils.smoothstep(nightFactor, 0.25, 0.75);
  }

  setPixelRatio(ratio: number): void {
    this.pixelRatio.value = ratio;
  }

  /**
   * Moves every ship one fixed step. The first call places them: three
   * already under way within sight and one at anchor.
   */
  fixedUpdate(delta: number, time: number, yacht: THREE.Vector3, yachtHeading: number, wind: THREE.Vector3): void {
    this.time = time;
    this.yachtHeading = yachtHeading;
    this.world.time = time;
    this.world.windFrom = Math.atan2(-wind.x, -wind.z);
    if (!this.initialized) {
      this.initialized = true;
      this.ships.forEach((ship, slot) => this.place(ship, slot, yacht, true));
    }
    this.ships.forEach((ship, slot) => {
      this.retry[slot] = Math.max(0, this.retry[slot]! - delta);
      // A slot that found no clear passage tries again a few seconds later.
      if (this.retry[slot]! <= 0 && shipOutOfRange(ship, yacht.x, yacht.z)) this.place(ship, slot, yacht, false);
      stepShip(ship, this.ships, this.world, delta);
      const signal = shipHornSignal(ship, yacht.x, yacht.z, this.random);
      if (signal && !canSoundHorn(time, this.lastHorn)) {
        // Too soon after another blast: hold this one back and try again shortly.
        ship.hornCooldown = HORN_RETRY_SECONDS;
      } else if (signal) {
        this.lastHorn = time;
        this.horns.push({
          position: new THREE.Vector3(ship.x, 22, ship.z),
          signal,
          length: ship.halfLength * 2,
        });
      }
    });
    if (this.reply) {
      this.reply.delay -= delta;
      // The answer waits for the rule's gap like every other blast.
      if (this.reply.delay <= 0 && canSoundHorn(time, this.lastHorn)) {
        const ship = this.reply.ship;
        this.reply = null;
        if (ship.active) this.lastHorn = time;
        if (ship.active) this.horns.push({ position: new THREE.Vector3(ship.x, 22, ship.z), signal: "prolonged", length: ship.halfLength * 2 });
      }
    }
    writeShipUniforms(this.ships, yacht.x, yacht.z);
  }

  /**
   * Metres from the nearest ship's hull (large when none is near) and the
   * outward normal there: the helmsman's reflex treats a ship's side like a
   * shore (see `ShoreGuard`).
   */
  readonly hullClearance = (x: number, z: number, normal: { x: number; z: number }): number =>
    nearestHullClearance(this.ships, x, z, normal);

  /**
   * Keeps the yacht out of the ships' hulls: the outline point deepest inside
   * is pushed back out and the yacht's motion into the side is reversed with
   * a little restitution, relative to the ship's own motion. Returns the
   * impact speed (0 if there was no contact) and its place in `at`.
   */
  resolveContact(body: ContactBody, at: THREE.Vector3): number {
    let impact = 0;
    for (const ship of this.ships) {
      if (!ship.active) continue;
      const dx = body.position.x - ship.x;
      const dz = body.position.z - ship.z;
      if (dx * dx + dz * dz > (ship.halfLength + 20) ** 2) continue;
      let deepest = 0;
      let normalX = 0;
      let normalZ = 0;
      let pointX = 0;
      let pointZ = 0;
      for (const [across, along] of YACHT_OUTLINE) {
        const x = body.position.x + body.right.x * across + body.forward.x * along;
        const z = body.position.z + body.right.z * across + body.forward.z * along;
        const depth = shipContact(ship, x, z, 0.18, this.normal);
        if (depth > deepest) {
          deepest = depth;
          normalX = this.normal.x;
          normalZ = this.normal.z;
          pointX = x;
          pointZ = z;
        }
      }
      if (deepest <= 0) continue;
      body.position.x += normalX * deepest;
      body.position.z += normalZ * deepest;
      const shipVX = Math.sin(ship.heading) * ship.speed;
      const shipVZ = Math.cos(ship.heading) * ship.speed;
      const relative = (body.velocity.x - shipVX) * normalX + (body.velocity.z - shipVZ) * normalZ;
      if (relative < 0) {
        body.velocity.x -= normalX * relative * 1.35;
        body.velocity.z -= normalZ * relative * 1.35;
        if (-relative > impact) {
          impact = -relative;
          at.set(pointX, 0, pointZ);
        }
      }
    }
    return impact;
  }

  /**
   * Places the ships' meshes: each rides the swell (a ship of two hundred
   * metres barely moves, and slowly) and shows its lights at night.
   */
  update(delta: number, sample: (x: number, z: number) => OceanSample): void {
    this.ships.forEach((ship, slot) => {
      const visual = this.visuals[slot]!;
      visual.root.visible = ship.active;
      if (!ship.active) return;
      const key = this.geometryKey(ship);
      if (visual.key !== key) this.assignGeometry(visual, ship);
      this.assignModel(visual, ship);
      const forwardX = Math.sin(ship.heading);
      const forwardZ = Math.cos(ship.heading);
      const reach = ship.halfLength * 0.7;
      const beam = ship.halfBeam * 0.8;
      const bow = sample(ship.x + forwardX * reach, ship.z + forwardZ * reach).height;
      const stern = sample(ship.x - forwardX * reach, ship.z - forwardZ * reach).height;
      const starboard = sample(ship.x + forwardZ * beam, ship.z - forwardX * beam).height;
      const port = sample(ship.x - forwardZ * beam, ship.z + forwardX * beam).height;
      const ease = 1 - Math.exp(-delta * 0.6);
      visual.heave += ((bow + stern + port + starboard) * 0.25 * 0.6 - visual.heave) * ease;
      visual.pitch += (Math.atan2(stern - bow, reach * 2) * 0.5 - visual.pitch) * ease;
      visual.roll += (Math.atan2(port - starboard, beam * 2) * 0.4 - visual.roll) * ease;
      visual.root.position.set(ship.x, visual.heave + ship.ballast, ship.z);
      visual.root.rotation.set(visual.pitch, ship.heading, visual.roll, "YXZ");
      visual.anchored.value = ship.anchored ? 1 : 0;
      visual.beacons.visible = this.night.value > 0.01;
    });
  }

  /** The ships' scene objects, by ship index (for their shadows). */
  get roots(): readonly THREE.Object3D[] {
    return this.rootList;
  }

  private readonly rootList: THREE.Object3D[] = [];

  /** Sound signals given since the last call. */
  /**
   * The yacht sounded her horn at (x, z): the nearest ship within hail, if
   * any, answers with one long blast a moment later (a watchkeeper's
   * courtesy). Returns whether one will.
   */
  answerHorn(x: number, z: number): boolean {
    let nearest: Ship | null = null;
    let best = HAIL_RANGE;
    for (const ship of this.ships) {
      if (!ship.active) continue;
      const distance = Math.hypot(ship.x - x, ship.z - z) - ship.halfLength * 0.5;
      if (distance < best) {
        best = distance;
        nearest = ship;
      }
    }
    if (!nearest || this.reply) return false;
    this.reply = { ship: nearest, delay: 1.6 + best / 700 + this.random() * 0.8 };
    return true;
  }

  consumeHorns(): ShipHornEvent[] {
    const events = this.horns.splice(0);
    return events;
  }

  /** The ships as sound sources, for their engines and bow waves. */
  get soundSources(): readonly ShipSoundSource[] {
    this.sources.length = 0;
    this.ships.forEach((ship, slot) => {
      if (!ship.active) return;
      const visual = this.visuals[slot]!;
      this.sources.push({
        position: visual.root.position,
        speed: ship.speed,
        anchored: ship.anchored,
        length: ship.halfLength * 2,
      });
    });
    return this.sources;
  }

  dispose(): void {
    this.models.dispose();
    this.scene.remove(this.group);
    this.visuals.forEach((visual) => {
      visual.material.dispose();
      visual.beaconMaterial.dispose();
    });
    this.geometries.forEach(({ hull, beacons }) => {
      hull.dispose();
      beacons.dispose();
    });
    this.geometries.clear();
    this.ships.forEach((ship) => (ship.active = false));
    writeShipUniforms(this.ships);
  }

  /** Every ship type, built before the first frame so nothing is built while sailing. */
  prebuild(): void {
    for (const kind of SHIP_KINDS) for (let scheme = 0; scheme < 3; scheme += 1) this.geometry(kind, scheme);
  }

  private place(ship: Ship, slot: number, yacht: THREE.Vector3, initial: boolean): void {
    // A different type each time, so the horizon does not repeat itself.
    const others = new Set(this.ships.filter((other) => other !== ship && other.active).map((other) => other.kind));
    const choices = SHIP_KINDS.filter((kind) => !others.has(kind));
    const kind = choices[Math.floor(this.random() * choices.length)] ?? ship.kind;
    const fresh = createShip(kind, this.random);
    Object.assign(ship, fresh);
    let placed: boolean;
    if (slot >= MOVING_SHIPS) {
      // An anchorage anywhere in sight at the start; later, ahead of the yacht.
      const bearing = initial ? this.random() * Math.PI * 2 : this.yachtHeading + (this.random() - 0.5) * 1.6;
      placed = planAnchorage(ship, this.world, yacht.x, yacht.z, bearing, this.ships, this.random, initial ? 600 : 1000, initial ? 1700 : 1900);
    } else {
      // At the start the first ship crosses ahead, so one is in view at once.
      placed =
        (initial && slot === 0 && planLane(ship, this.world, yacht.x, yacht.z, this.ships, this.random, true, this.yachtHeading)) ||
        planLane(ship, this.world, yacht.x, yacht.z, this.ships, this.random, initial);
    }
    if (!placed) {
      ship.active = false;
      this.retry[slot] = 5;
    }
  }

  private geometryKey(ship: Ship): string {
    return `${ship.kind}:${ship.scheme}`;
  }

  private geometry(kind: ShipKind, scheme: number): { hull: THREE.BufferGeometry; beacons: THREE.BufferGeometry } {
    const key = `${kind}:${scheme}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = buildShipGeometry(kind, scheme);
      this.geometries.set(key, geometry);
    }
    return geometry;
  }

  /**
   * Puts the type's imported model on the ship once it has loaded (the
   * procedural hull hides; its points of light stay), or the procedural hull
   * back if the type has none.
   */
  private assignModel(visual: ShipVisual, ship: Ship): void {
    const variants = this.models.variants(ship.kind);
    const key = variants > 0 ? `${ship.kind}:${ship.scheme % variants}` : "";
    if (visual.modelKey === key && (visual.model !== null || key === "")) {
      if (visual.model && ship.hullProfile == null) ship.hullProfile = this.models.profile(ship.kind, ship.scheme % variants);
      return;
    }
    const model = key ? this.models.instance(ship.kind, ship.scheme % variants) : null;
    if (key && !model) {
      visual.hull.visible = true;
      return;
    }
    visual.model?.removeFromParent();
    visual.model = model;
    visual.modelKey = key;
    if (model) visual.root.add(model);
    visual.hull.visible = model === null;
    // Her sides are where the model's are: the yacht's fenders meet the hull she sees.
    ship.hullProfile = model ? this.models.profile(ship.kind, ship.scheme % variants) : null;
    // And her lights are on the model's own decks, not the procedural ship's.
    const lights = model ? this.models.lights(ship.kind, ship.scheme % variants) : null;
    visual.beacons.geometry = lights ?? this.geometry(ship.kind, ship.scheme).beacons;
  }

  private assignGeometry(visual: ShipVisual, ship: Ship): void {
    const geometry = this.geometry(ship.kind, ship.scheme);
    visual.hull.geometry = geometry.hull;
    visual.beacons.geometry = geometry.beacons;
    // A new kind or scheme: the model (and its lights) are chosen again.
    visual.modelKey = "";
    visual.model?.removeFromParent();
    visual.model = null;
    ship.hullProfile = null;
    visual.key = this.geometryKey(ship);
    visual.hull.name = `Ship_${ship.kind}`;
  }

  private createVisual(ship: Ship, slot: number): ShipVisual {
    const anchored = { value: 0 };
    const night = this.night;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.12 });
    material.name = `ShipPaint_${slot}`;
    // Windows, deck lights and the navigation (or anchor) lights glow at night.
    patchMaterialShader(material, "ship-lights-v1", (shader) => {
      shader.uniforms.uShipNight = night;
      shader.uniforms.uShipAnchored = anchored;
      shader.vertexShader = injectAfter(
        shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 shipLight;\nvarying vec4 vShipLight;"),
        "begin_vertex",
        "vShipLight = shipLight;",
      );
      shader.fragmentShader = injectAfter(
        shader.fragmentShader.replace(
          "#include <common>",
          "#include <common>\nuniform float uShipNight;\nuniform float uShipAnchored;\nvarying vec4 vShipLight;",
        ),
        "emissivemap_fragment",
        `float shipOn = vShipLight.w < 0.5 ? 1.0 : (vShipLight.w < 1.5 ? 1.0 - uShipAnchored : uShipAnchored);
        totalEmissiveRadiance += vShipLight.rgb * uShipNight * shipOn;`,
      );
    });
    // Below the waterline the hull is veiled by the sea like everything else.
    this.underwater.apply(material);
    applyShipHaze(material);
    this.decorate(material);
    const placeholder = new THREE.BufferGeometry();
    const hull = new THREE.Mesh(placeholder, material);
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.layers.enable(SHIP_SHADOW_LAYER);
    const beaconMaterial = new THREE.ShaderMaterial({
      name: `ShipBeacons_${slot}`,
      uniforms: { uShipNight: night, uShipAnchored: anchored, uPixelRatio: this.pixelRatio },
      vertexShader: /* glsl */ `
        attribute vec4 shipLight;
        uniform float uShipNight;
        uniform float uShipAnchored;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          float on = shipLight.w < 0.5 ? 1.0 : (shipLight.w < 1.5 ? 1.0 - uShipAnchored : uShipAnchored);
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          float distance = -view.z;
          // Points of light keep a few pixels at any range; the haze dims them.
          float haze = exp(-distance * 0.00055);
          vColor = shipLight.rgb * uShipNight * on * haze;
          float lamp = max(max(shipLight.r, shipLight.g), shipLight.b) > 2.0 ? 1.0 : 0.0;
          // A few pixels far off, larger as she comes near (a lit window is a metre across).
          gl_PointSize = (lamp > 0.5 ? 3.4 : 2.2) * uPixelRatio * on * clamp(260.0 / max(distance, 1.0), 1.0, 2.6);
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 offset = gl_PointCoord - 0.5;
          float falloff = exp(-dot(offset, offset) * 9.0);
          gl_FragColor = vec4(vColor * falloff, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beacons = new THREE.Points(new THREE.BufferGeometry(), beaconMaterial);
    beacons.visible = false;
    beacons.renderOrder = 3;
    const root = new THREE.Group();
    root.name = `Ship_${slot}`;
    root.add(hull, beacons);
    root.visible = false;
    this.group.add(root);
    this.rootList.push(root);
    const visual: ShipVisual = { root, hull, model: null, modelKey: "", beacons, material, beaconMaterial, anchored, key: "", heave: 0, pitch: 0, roll: 0 };
    this.assignGeometry(visual, ship);
    placeholder.dispose();
    return visual;
  }
}
