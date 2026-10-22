import * as THREE from "three";

// Small hand-built structures that give each island a recognizable landmark.
// They are assembled from a few shared materials and low-segment primitives,
// so the three islands together add only a few dozen draw calls.

export type PropMaterials = {
  white: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  thatch: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  lamp: THREE.MeshBasicMaterial;
  beam: THREE.MeshBasicMaterial;
};

export function createPropMaterials(): PropMaterials {
  return {
    white: new THREE.MeshStandardMaterial({ name: "Lighthouse_White", color: 0xf2efe6, roughness: 0.7 }),
    red: new THREE.MeshStandardMaterial({ name: "Lighthouse_Red", color: 0xc4322a, roughness: 0.6 }),
    wood: new THREE.MeshStandardMaterial({ name: "Weathered_Wood", color: 0xa07a55, roughness: 0.9 }),
    darkWood: new THREE.MeshStandardMaterial({ name: "Wet_Wood", color: 0x5a4330, roughness: 0.85 }),
    thatch: new THREE.MeshStandardMaterial({ name: "Palm_Thatch", color: 0xc9a764, roughness: 0.95, flatShading: true }),
    metal: new THREE.MeshStandardMaterial({ name: "Painted_Iron", color: 0x2d3338, roughness: 0.45, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ name: "Lantern_Glass", color: 0x223845, roughness: 0.08, metalness: 0.5 }),
    lamp: new THREE.MeshBasicMaterial({ name: "Lantern_Lamp", color: 0xfff1c2, toneMapped: false }),
    beam: new THREE.MeshBasicMaterial({
      name: "Lantern_Beam",
      color: 0xfff1c2,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  };
}

function place(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadows = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  parent.add(mesh);
  return mesh;
}

export type Lighthouse = {
  group: THREE.Group;
  beam: THREE.Group;
  lamp: THREE.Mesh;
};

/** A 15 m red-and-white lighthouse with a gallery, lantern and rotating beam. */
export function createLighthouse(materials: PropMaterials): Lighthouse {
  const group = new THREE.Group();
  group.name = "Lighthouse";
  const bands = 5;
  const towerHeight = 12;
  for (let band = 0; band < bands; band += 1) {
    const bottom = band / bands;
    const top = (band + 1) / bands;
    const geometry = new THREE.CylinderGeometry(
      THREE.MathUtils.lerp(1.7, 1.05, top),
      THREE.MathUtils.lerp(1.7, 1.05, bottom),
      towerHeight / bands,
      20,
    );
    place(group, geometry, band % 2 === 0 ? materials.white : materials.red, 0, (bottom + top) * 0.5 * towerHeight, 0);
  }
  place(group, new THREE.CylinderGeometry(2.3, 2.5, 0.8, 20), materials.white, 0, 0.1, 0);
  const door = place(group, new THREE.BoxGeometry(0.75, 1.5, 0.2), materials.darkWood, 0, 1.15, 1.62);
  door.rotation.x = -0.05;
  place(group, new THREE.CylinderGeometry(1.55, 1.55, 0.18, 20), materials.metal, 0, towerHeight + 0.09, 0);
  const rail = place(group, new THREE.TorusGeometry(1.5, 0.035, 6, 32), materials.metal, 0, towerHeight + 0.75, 0);
  rail.rotation.x = Math.PI / 2;
  place(group, new THREE.CylinderGeometry(0.85, 0.85, 1.35, 16, 1, true), materials.glass, 0, towerHeight + 0.85, 0);
  const lamp = place(group, new THREE.SphereGeometry(0.42, 16, 12), materials.lamp, 0, towerHeight + 0.85, 0, false);
  place(group, new THREE.ConeGeometry(1.05, 1.1, 16), materials.red, 0, towerHeight + 2.05, 0);
  place(group, new THREE.SphereGeometry(0.14, 8, 6), materials.metal, 0, towerHeight + 2.65, 0);

  // Two opposed light cones sweep the horizon; visible only at night.
  const beam = new THREE.Group();
  beam.name = "Lighthouse_Beam";
  beam.position.y = towerHeight + 0.85;
  [0, Math.PI].forEach((yaw) => {
    const geometry = new THREE.ConeGeometry(3.2, 46, 16, 8, true);
    // ConeGeometry points +Y; lay it along +Z with the apex at the lamp.
    geometry.translate(0, -23, 0);
    // Additive light fades to black (invisible) toward the far end, so the
    // beam dissolves into the night instead of ending in a hard rim.
    const position = geometry.getAttribute("position");
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      const fade = Math.pow(1 - Math.min(1, -position.getY(index) / 46), 1.6);
      colors.set([fade, fade, fade], index * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const cone = new THREE.Mesh(geometry, materials.beam);
    cone.rotation.set(-Math.PI / 2, 0, 0);
    const holder = new THREE.Group();
    holder.rotation.y = yaw;
    holder.add(cone);
    beam.add(holder);
  });
  group.add(beam);
  return { group, beam, lamp };
}

/** A plank pier on posts, built along local +Z from the beach out to sea. */
export function createPier(materials: PropMaterials, length: number, deckHeight: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "Wooden_Pier";
  const width = 2.4;
  const plankGeometry = new THREE.BoxGeometry(width, 0.12, 0.42);
  for (let z = 0; z < length; z += 0.5) {
    const plank = place(group, plankGeometry, materials.wood, 0, deckHeight, z + 0.25);
    plank.rotation.z = Math.sin(z * 3.7) * 0.012;
  }
  const postGeometry = new THREE.CylinderGeometry(0.13, 0.15, deckHeight + 3.2, 8);
  for (let z = 0.4; z <= length; z += 2.6) {
    [-1, 1].forEach((side) => place(group, postGeometry, materials.darkWood, side * (width / 2 - 0.05), deckHeight - (deckHeight + 3.2) / 2 + 0.6, z));
  }
  const railGeometry = new THREE.BoxGeometry(0.08, 0.08, length);
  [-1, 1].forEach((side) => place(group, railGeometry, materials.wood, side * (width / 2 - 0.05), deckHeight + 0.85, length / 2));
  // Mooring bollards at the seaward end.
  const bollard = new THREE.CylinderGeometry(0.16, 0.2, 0.45, 10);
  [-1, 1].forEach((side) => place(group, bollard, materials.metal, side * 0.8, deckHeight + 0.28, length - 0.5));
  return group;
}

/** A thatched beach hut on short stilts with a small porch. */
export function createHut(materials: PropMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = "Beach_Hut";
  const stilt = new THREE.CylinderGeometry(0.11, 0.13, 1.2, 8);
  [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4], [-1.4, 2.6], [1.4, 2.6]].forEach(([x, z]) => place(group, stilt, materials.darkWood, x, 0.6, z));
  place(group, new THREE.BoxGeometry(3.2, 0.18, 4.4), materials.wood, 0, 1.2, 0.6);
  place(group, new THREE.BoxGeometry(2.9, 2.0, 2.9), materials.wood, 0, 2.3, 0);
  place(group, new THREE.BoxGeometry(0.8, 1.45, 0.06), materials.darkWood, 0, 2.05, 1.47);
  [-1, 1].forEach((side) => place(group, new THREE.BoxGeometry(0.06, 0.6, 0.7), materials.darkWood, side * 1.46, 2.5, 0));
  const roof = place(group, new THREE.ConeGeometry(2.75, 2.1, 4, 1), materials.thatch, 0, 4.35, 0.2);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 1.25);
  return group;
}

/** Irregular boulder geometry shared by every rock instance. */
export function createRockGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    const jitter = 0.78 + 0.32 * (0.5 + 0.5 * Math.sin(vertex.x * 12.9 + vertex.y * 78.2 + vertex.z * 37.7));
    vertex.multiplyScalar(jitter);
    vertex.y *= 0.72;
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}
