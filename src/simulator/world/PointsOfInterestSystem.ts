import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { InterestPoint } from "../camera/PhotoDirector";
import type { OceanSystem } from "../environment/OceanSystem";
import { clamp } from "../math";
import { HumanFigure, type FigureOutfit } from "../vessel/HumanFigure";
import { COLLECT_RADIUS, type DiscoveryState } from "./Discovery";
import { islandHeight, seededRandom } from "./IslandTerrain";
import { COLLECTIBLES, GALLEON_REEF, ISLANDS, POINTS_OF_INTEREST, type CollectibleDefinition } from "./WorldLayout";

/** Paint a geometry with one vertex colour, dropping uvs so parts can merge. */
function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, shade = 1): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute("uv");
  const value = new THREE.Color(color).multiplyScalar(shade);
  const count = flat.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = value.r;
    colors[index * 3 + 1] = value.g;
    colors[index * 3 + 2] = value.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error("Point-of-interest geometry could not be merged.");
  merged.computeBoundingSphere();
  return merged;
}

/** Lofted wooden hull: a rounded U-section, full amidships, fine at the bow. */
function loftedHull(length: number, beam: number, depth: number, stations = 22, sides = 14): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const plank = new THREE.Color(0x4a3524);
  const plankDark = new THREE.Color(0x2f2217);
  const algae = new THREE.Color(0x3f5a3a);
  const color = new THREE.Color();
  for (let station = 0; station <= stations; station += 1) {
    const t = station / stations;
    const z = (t - 0.5) * length;
    // Fine bow (+Z), broad transom stern (-Z).
    const bow = Math.max(0, (t - 0.55) / 0.45);
    const halfBeam = (beam / 2) * Math.sqrt(Math.max(0.02, 1 - Math.pow(bow, 1.6))) * (t < 0.08 ? 0.8 + t * 2.5 : 1);
    const sheer = depth + Math.pow(Math.abs(t - 0.45) * 2, 2) * 1.1;
    for (let side = 0; side <= sides; side += 1) {
      const s = side / sides;
      const angle = Math.PI * s;
      const x = -Math.cos(angle) * halfBeam;
      const y = sheer - Math.sin(angle) * (depth + 0.4) * (1 - bow * 0.3);
      positions.push(x, y, z);
      const band = Math.floor((y + depth) * 3.2) % 2 === 0;
      color.copy(band ? plank : plankDark).lerp(algae, clamp(0.6 - y / depth, 0, 0.7));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let station = 0; station < stations; station += 1) {
    for (let side = 0; side < sides; side += 1) {
      const a = station * (sides + 1) + side;
      const b = a + sides + 1;
      // Break a few planks out of the starboard side to show the wreck's ribs.
      if (side === 3 && station > 6 && station < 12) continue;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  return flat;
}

function createGalleonGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [loftedHull(28, 7.4, 4.2)];
  parts[0].computeVertexNormals();
  // Sterncastle and forecastle.
  parts.push(paint(new THREE.BoxGeometry(6.6, 3.2, 6).translate(0, 5.2, -11), 0x43301f));
  parts.push(paint(new THREE.BoxGeometry(5.6, 1.6, 4.2).translate(0, 4.6, 10.2), 0x3d2c1d));
  // Gun-deck planking.
  parts.push(paint(new THREE.BoxGeometry(6.2, 0.2, 20).translate(0, 3.9, 0), 0x5a4330));
  // Broken masts: two stubs and a fallen mainmast resting on the reef.
  parts.push(paint(new THREE.CylinderGeometry(0.32, 0.4, 6.5, 10).translate(0, 7, 2.5), 0x3a2a1c));
  parts.push(paint(new THREE.CylinderGeometry(0.26, 0.32, 3.2, 10).translate(0, 5.4, 9), 0x3a2a1c));
  parts.push(paint(new THREE.CylinderGeometry(0.3, 0.38, 19, 10).rotateZ(1.32).rotateY(0.5).translate(9, 1.4, -2), 0x34261a));
  parts.push(paint(new THREE.BoxGeometry(0.25, 0.25, 7).rotateY(1.2).translate(10.5, 0.9, 3), 0x34261a));
  // Bowsprit and stern lanterns.
  parts.push(paint(new THREE.CylinderGeometry(0.18, 0.26, 7, 8).rotateX(-1.2).translate(0, 5.2, 15.5), 0x3a2a1c));
  // Scattered cannons.
  const random = seededRandom(91);
  for (let index = 0; index < 5; index += 1) {
    const cannon = new THREE.CylinderGeometry(0.2, 0.3, 2.2, 10).rotateZ(Math.PI / 2).rotateY(random() * Math.PI);
    cannon.translate(-6 + random() * 18, 0.25, -10 + random() * 22);
    parts.push(paint(cannon, 0x252a2c));
  }
  // Treasure chest with a half-open lid.
  parts.push(paint(new THREE.BoxGeometry(1.4, 0.8, 0.9).translate(-6, 0.3, 4), 0x5c3b1d));
  parts.push(paint(new THREE.BoxGeometry(1.4, 0.12, 0.9).rotateX(-0.9).translate(-6, 1, 3.65), 0x5c3b1d));
  return mergeParts(parts.map((part) => (part.getAttribute("color") ? part : paint(part, 0x4a3524))));
}

function createBottleGeometry(): THREE.BufferGeometry {
  const body = new THREE.LatheGeometry(
    [[0.0001, -0.16], [0.07, -0.16], [0.075, 0.06], [0.03, 0.14], [0.026, 0.22], [0.0001, 0.22]].map(([x, y]) => new THREE.Vector2(x, y)),
    12,
  );
  body.rotateZ(Math.PI / 2);
  return body;
}

const OUTFITS: FigureOutfit[] = [
  { skin: 0x8d5a3b, shirt: 0xf26b5b, shorts: 0x2d4b7a, shoes: 0xf2e2c8, hair: 0x1d1510, cap: null, sunglasses: true, sleeve: 0 },
  { skin: 0xe0b089, shirt: 0x37c2b5, shorts: 0xf3efe2, shoes: 0x7a4b2a, hair: 0xc89b55, cap: null, sunglasses: false, sleeve: 0.35 },
  { skin: 0xc68b62, shirt: 0xffd166, shorts: 0x3a3a3a, shoes: 0x2b2b2b, hair: 0x2a1c12, cap: 0xd94f70, sunglasses: true, sleeve: 0.4 },
  { skin: 0x6b4430, shirt: 0xffffff, shorts: 0xb2463c, shoes: 0xeeeeee, hair: 0x120d0a, cap: null, sunglasses: false, sleeve: 0 },
];

type Floater = {
  definition: CollectibleDefinition;
  mesh: THREE.Mesh;
  phase: number;
};

const PARTY_BPM = 118;

/**
 * Discoverable places that are not islands: the sunken galleon on its reef,
 * the black monolith, a floating beach party with dancers and music, and the
 * bottles and crates drifting in between.
 */
export class PointsOfInterestSystem {
  readonly partyCenter = new THREE.Vector3();
  readonly monolithCenter = new THREE.Vector3();
  private readonly group = new THREE.Group();
  private readonly party = new THREE.Group();
  private readonly dancers: HumanFigure[] = [];
  private readonly floaters: Floater[] = [];
  private readonly lights: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly lightColors: THREE.Color[] = [];
  private readonly lightColor = new THREE.Color();
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly interestParty: InterestPoint;
  private readonly interestMonolith: InterestPoint;
  private readonly quaternion = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly normal = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ocean: OceanSystem,
    private readonly discovery: DiscoveryState,
  ) {
    this.group.name = "PointsOfInterest";
    scene.add(this.group);
    this.createGalleon();
    this.createMonolith();
    this.lights = this.createParty();
    this.createCollectibles();
    this.interestParty = { kind: "party", position: this.partyCenter, radius: 9, priority: 1.5, lookHeight: 0.2 };
    this.interestMonolith = { kind: "monolith", position: this.monolithCenter, radius: 9, priority: 1.4, lookHeight: 0.6 };
  }

  collectInterest(points: InterestPoint[], yacht: THREE.Vector3): void {
    if (yacht.distanceTo(this.partyCenter) < 260) points.push(this.interestParty);
    if (yacht.distanceTo(this.monolithCenter) < 260) points.push(this.interestMonolith);
  }

  /** Bob, dance and collect. Returns ids of bottles/crates picked up this frame. */
  update(time: number, delta: number, yacht: THREE.Vector3, nightFactor: number): string[] {
    const picked: string[] = [];
    // Floating party platform follows the swell.
    const sample = this.ocean.sample(this.partyCenter.x, this.partyCenter.z);
    this.party.position.y = sample.height + 0.12;
    this.normal.set(sample.normalX, sample.normalY, sample.normalZ);
    this.quaternion.setFromUnitVectors(this.up, this.normal);
    this.party.quaternion.slerp(this.quaternion, Math.min(1, delta * 2.5));

    const near = yacht.distanceTo(this.partyCenter) < 420;
    this.party.visible = yacht.distanceTo(this.partyCenter) < 1300;
    if (near) {
      const beat = (time * PARTY_BPM) / 60;
      this.dancers.forEach((dancer, index) => this.dance(dancer, beat + index * 0.37, index));
      const glow = 0.55 + nightFactor * 0.9;
      for (let index = 0; index < this.lightColors.length; index += 1) {
        const pulse = 0.65 + 0.35 * Math.sin(beat * Math.PI + index * 0.9);
        this.lightColor.copy(this.lightColors[index]).multiplyScalar(glow * pulse);
        this.lights.setColorAt(index, this.lightColor);
      }
      if (this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true;
    }

    for (const floater of this.floaters) {
      if (!floater.mesh.visible) continue;
      const { x, z } = floater.definition;
      const water = this.ocean.sample(x, z);
      floater.mesh.position.y = water.height + (floater.definition.kind === "crate" ? 0.12 : 0.02);
      floater.mesh.rotation.x = Math.sin(time * 0.9 + floater.phase) * 0.18 + water.normalZ * 0.6;
      floater.mesh.rotation.z = Math.cos(time * 0.7 + floater.phase) * 0.18 - water.normalX * 0.6;
      floater.mesh.rotation.y += delta * 0.12;
      if (Math.hypot(yacht.x - x, yacht.z - z) < COLLECT_RADIUS) {
        floater.mesh.visible = false;
        picked.push(floater.definition.id);
      }
    }
    return picked;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.dancers.forEach((dancer) => dancer.dispose());
    this.lights.geometry.dispose();
    this.lights.material.dispose();
    this.ownedGeometries.forEach((geometry) => geometry.dispose());
    this.ownedMaterials.forEach((material) => material.dispose());
  }

  private own<T extends THREE.Material>(material: T): T {
    this.ownedMaterials.push(material);
    return material;
  }

  private ownGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.ownedGeometries.push(geometry);
    return geometry;
  }

  private createGalleon(): void {
    const material = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }));
    const galleon = new THREE.Mesh(this.ownGeometry(createGalleonGeometry()), material);
    // Settled on the reef: listing to port, bow buried in the sand.
    galleon.position.set(GALLEON_REEF.x + 4, -GALLEON_REEF.topDepth - 2.2, GALLEON_REEF.z - 3);
    galleon.rotation.set(-0.08, 0.6, 0.32);
    galleon.name = "Sunken_Galleon";
    this.group.add(galleon);
  }

  private createMonolith(): void {
    const definition = POINTS_OF_INTEREST.find((place) => place.id === "monolith");
    const islet = ISLANDS.find((island) => island.id === "monolith-islet");
    if (!definition || !islet) return;
    const ground = islandHeight(islet, 0, 0);
    // The classic 1 : 4 : 9 proportions.
    const geometry = this.ownGeometry(new THREE.BoxGeometry(1.25, 11.25, 5));
    const monolith = new THREE.Mesh(
      geometry,
      this.own(new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.14, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 })),
    );
    monolith.position.set(islet.x, ground + 11.25 / 2 - 0.3, islet.z);
    monolith.rotation.y = 0.45;
    monolith.castShadow = true;
    monolith.name = "Black_Monolith";
    this.group.add(monolith);
    this.monolithCenter.set(islet.x, ground, islet.z);
  }

  private createParty(): THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
    const definition = POINTS_OF_INTEREST.find((place) => place.id === "party");
    this.partyCenter.set(definition?.x ?? -340, 0, definition?.z ?? -320);
    this.party.position.copy(this.partyCenter);
    this.party.name = "Floating_Beach_Party";
    this.group.add(this.party);

    const deckMaterial = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }));
    const parts: THREE.BufferGeometry[] = [];
    parts.push(paint(new THREE.CylinderGeometry(7.2, 7.2, 0.5, 40).translate(0, -0.05, 0), 0x2f3b45));
    parts.push(paint(new THREE.CylinderGeometry(6.9, 6.9, 0.14, 40).translate(0, 0.27, 0), 0xb38a5d));
    for (let index = 0; index < 20; index += 1) {
      const angle = (index / 20) * Math.PI * 2;
      if (index === 5) continue; // Boarding gap.
      parts.push(paint(new THREE.CylinderGeometry(0.05, 0.05, 1, 6).translate(Math.cos(angle) * 6.7, 0.84, Math.sin(angle) * 6.7), 0xdedede));
    }
    parts.push(paint(new THREE.TorusGeometry(6.7, 0.05, 6, 48).rotateX(Math.PI / 2).translate(0, 1.32, 0), 0xdedede));
    // DJ booth with speakers, a bar and two parasols.
    parts.push(paint(new THREE.BoxGeometry(2.4, 1.1, 0.9).translate(0, 0.9, -4.6), 0x1e1e24));
    parts.push(paint(new THREE.BoxGeometry(0.8, 1.6, 0.7).translate(-1.9, 1.15, -4.7), 0x111114));
    parts.push(paint(new THREE.BoxGeometry(0.8, 1.6, 0.7).translate(1.9, 1.15, -4.7), 0x111114));
    parts.push(paint(new THREE.BoxGeometry(3, 1.1, 0.8).translate(3.6, 0.9, 2.8).rotateY(0.4), 0xd9c39a));
    for (const [x, z, color] of [[-4, 2.5, 0xff6f61], [2.6, -1.4, 0x3cc6c0]] as const) {
      parts.push(paint(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6).translate(x, 1.7, z), 0xeeeeee));
      parts.push(paint(new THREE.ConeGeometry(1.9, 0.7, 12, 1, true).translate(x, 3.1, z), color));
    }
    // String-light poles.
    const poles: Array<[number, number]> = [];
    for (let index = 0; index < 4; index += 1) {
      const angle = index * (Math.PI / 2) + Math.PI / 4;
      poles.push([Math.cos(angle) * 6.3, Math.sin(angle) * 6.3]);
      parts.push(paint(new THREE.CylinderGeometry(0.06, 0.07, 3.6, 6).translate(Math.cos(angle) * 6.3, 2.1, Math.sin(angle) * 6.3), 0x6a5a48));
    }
    const deck = new THREE.Mesh(this.ownGeometry(mergeParts(parts)), deckMaterial);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.party.add(deck);

    // Inflatable flamingo drifting alongside.
    const flamingoMaterial = this.own(new THREE.MeshStandardMaterial({ color: 0xff8fb1, roughness: 0.35 }));
    const ring = new THREE.Mesh(this.ownGeometry(new THREE.TorusGeometry(0.8, 0.32, 10, 24).rotateX(Math.PI / 2)), flamingoMaterial);
    ring.position.set(8.6, 0.05, 1.5);
    const neck = new THREE.Mesh(this.ownGeometry(new THREE.TorusGeometry(0.6, 0.13, 8, 16, Math.PI * 1.2).rotateY(Math.PI / 2)), flamingoMaterial);
    neck.position.set(8.6, 0.6, 0.8);
    this.party.add(ring, neck);

    // Catenary string lights between the poles.
    const bulbs: THREE.Vector3[] = [];
    for (let index = 0; index < poles.length; index += 1) {
      const [ax, az] = poles[index];
      const [bx, bz] = poles[(index + 1) % poles.length];
      for (let step = 0; step < 9; step += 1) {
        const t = (step + 0.5) / 9;
        bulbs.push(new THREE.Vector3(ax + (bx - ax) * t, 3.8 - Math.sin(t * Math.PI) * 0.9, az + (bz - az) * t));
      }
    }
    const palette = [0xff4d6d, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf15bb5];
    const lights = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.11, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      bulbs.length,
    );
    bulbs.forEach((bulb, index) => {
      lights.setMatrixAt(index, new THREE.Matrix4().makeTranslation(bulb.x, bulb.y, bulb.z));
      const color = new THREE.Color(palette[index % palette.length]);
      this.lightColors.push(color);
      lights.setColorAt(index, color);
    });
    lights.name = "Party_String_Lights";
    this.party.add(lights);

    OUTFITS.forEach((outfit, index) => {
      const dancer = new HumanFigure(outfit);
      const angle = index * 1.55 + 0.4;
      dancer.mesh.position.set(Math.cos(angle) * 2.3, 0.34, Math.sin(angle) * 2.3 - 0.6);
      dancer.mesh.rotation.y = Math.atan2(-dancer.mesh.position.x, -4.6 - dancer.mesh.position.z);
      dancer.mesh.scale.setScalar(0.97 + index * 0.02);
      this.party.add(dancer.mesh);
      this.dancers.push(dancer);
    });
    return lights;
  }

  private dance(dancer: HumanFigure, beat: number, style: number): void {
    dancer.resetPose();
    const pulse = Math.abs(Math.sin(beat * Math.PI));
    const sway = Math.sin(beat * Math.PI * 0.5);
    dancer.bone("hips").position.y = 0.96 - pulse * 0.06;
    dancer.bone("hips").rotation.set(0, sway * 0.25, sway * 0.08);
    dancer.bone("spine").rotation.set(0.05 + pulse * 0.06, -sway * 0.15, -sway * 0.06);
    dancer.bone("head").rotation.set(-pulse * 0.18, sway * 0.2, 0);
    const raise = style % 2 === 0 ? 2.6 + Math.sin(beat * Math.PI) * 0.25 : 0.9 + pulse * 0.6;
    dancer.bone("upperArmL").rotation.set(style === 3 ? -pulse * 0.8 : 0, 0, raise);
    dancer.bone("upperArmR").rotation.set(style === 3 ? -pulse * 0.8 : 0, 0, -raise + sway * 0.3);
    dancer.bone("forearmL").rotation.set(-0.4 - pulse * 0.5, 0, 0);
    dancer.bone("forearmR").rotation.set(-0.4 - (1 - pulse) * 0.5, 0, 0);
    // Bent knees on the downbeat, feet stay roughly under the hips.
    dancer.bone("thighL").rotation.set(-pulse * 0.32, 0, 0.04);
    dancer.bone("thighR").rotation.set(-pulse * 0.32, 0, -0.04);
    dancer.bone("shinL").rotation.set(pulse * 0.6, 0, 0);
    dancer.bone("shinR").rotation.set(pulse * 0.6, 0, 0);
    dancer.bone("footL").rotation.set(-pulse * 0.28, 0, 0);
    dancer.bone("footR").rotation.set(-pulse * 0.28, 0, 0);
  }

  private createCollectibles(): void {
    const glass = this.own(new THREE.MeshPhysicalMaterial({ color: 0x2f8a52, roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.85, clearcoat: 1 }));
    const cork = this.own(new THREE.MeshStandardMaterial({ color: 0x9b7448, roughness: 0.9 }));
    const crateMaterial = this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    const bottleGeometry = this.ownGeometry(createBottleGeometry());
    const corkGeometry = this.ownGeometry(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 8).rotateZ(Math.PI / 2).translate(-0.24, 0, 0));
    const random = seededRandom(5);
    const crateParts: THREE.BufferGeometry[] = [paint(new THREE.BoxGeometry(0.9, 0.62, 0.62), 0x8b6a43)];
    for (const offset of [-0.32, 0, 0.32]) {
      crateParts.push(paint(new THREE.BoxGeometry(0.06, 0.64, 0.64).translate(offset, 0, 0), 0x6a4f31, 0.9 + random() * 0.2));
    }
    const crateGeometry = this.ownGeometry(mergeParts(crateParts));
    COLLECTIBLES.forEach((definition, index) => {
      let mesh: THREE.Mesh;
      if (definition.kind === "bottle") {
        mesh = new THREE.Mesh(bottleGeometry, glass);
        mesh.add(new THREE.Mesh(corkGeometry, cork));
        mesh.scale.setScalar(2.2);
      } else {
        mesh = new THREE.Mesh(crateGeometry, crateMaterial);
        mesh.scale.setScalar(1.4);
      }
      mesh.position.set(definition.x, 0, definition.z);
      mesh.castShadow = true;
      mesh.name = `Collectible_${definition.id}`;
      mesh.visible = !this.discovery.collected.has(definition.id);
      this.group.add(mesh);
      this.floaters.push({ definition, mesh, phase: index * 1.7 });
    });
  }
}
