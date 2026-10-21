import * as THREE from "three";

/**
 * Shared materials and small procedural models for the things afloat: green
 * bottle glass with a lit scroll inside, a weathered plank crate, and the
 * glossy vinyl of an inflatable flamingo (also the one that rides on deck).
 */

export type LootMaterials = {
  glass: THREE.MeshStandardMaterial;
  scroll: THREE.MeshBasicMaterial;
  cork: THREE.MeshStandardMaterial;
  glow: THREE.SpriteMaterial;
  crate: THREE.MeshStandardMaterial;
  vinyl: THREE.MeshStandardMaterial;
  beak: THREE.MeshStandardMaterial;
  beakTip: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  /** Lit materials (to receive the underwater veil). */
  lit: THREE.Material[];
  all: THREE.Material[];
};

/** Weathered planks: four boards a side with dark seams, grain and battens. */
function plankTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const board = Math.floor(y / 32);
    const inBoard = (y % 32) / 32;
    for (let x = 0; x < size; x += 1) {
      const grain = Math.sin(x * 0.21 + Math.sin(y * 0.37 + board * 3.1) * 2.4 + board * 7.7) * 0.5 + 0.5;
      const fine = Math.sin(x * 1.37 + y * 0.11 + board) * 0.5 + 0.5;
      let shade = 0.78 + grain * 0.16 + fine * 0.05 + (board % 2) * 0.05;
      // Seams between boards.
      if (inBoard < 0.06 || inBoard > 0.96) shade *= 0.38;
      // Battens across the ends, nailed on.
      const batten = x < 12 || x > size - 13;
      if (batten) shade = 0.62 + grain * 0.1;
      if (batten && (y % 32 === 16) && (x === 6 || x === size - 7)) shade = 0.25;
      const index = (y * size + x) * 4;
      data[index] = Math.min(255, 168 * shade);
      data[index + 1] = Math.min(255, 128 * shade);
      data[index + 2] = Math.min(255, 84 * shade);
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function glowTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      const value = Math.max(0, Math.exp(-r * r * 6) - 0.0025);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(255 * value);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createLootMaterials(): LootMaterials {
  const glass = new THREE.MeshStandardMaterial({
    color: 0x3f8f5a,
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    envMapIntensity: 1.6,
    emissive: new THREE.Color(0x2a6b3a),
    emissiveIntensity: 0.35,
  });
  const scroll = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.4, 1.9, 1.05, THREE.LinearSRGBColorSpace) });
  const cork = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.9 });
  const glow = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: new THREE.Color().setRGB(2.2, 1.6, 0.7, THREE.LinearSRGBColorSpace),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const crate = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.86, metalness: 0 });
  const vinyl = new THREE.MeshStandardMaterial({ color: 0xff6fae, roughness: 0.28, metalness: 0, envMapIntensity: 1.3 });
  const beak = new THREE.MeshStandardMaterial({ color: 0xffe6dc, roughness: 0.35 });
  const beakTip = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.35 });
  const eye = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.2 });
  const lit = [glass, cork, crate, vinyl, beak, beakTip, eye];
  return { glass, scroll, cork, glow, crate, vinyl, beak, beakTip, eye, lit, all: [...lit, scroll, glow] };
}

/**
 * An inflatable flamingo ring: a fat pink torus to sit in, an S-shaped neck
 * rising from the front, a head with a pale beak tipped black, and a little
 * tail. About 1.8 m across, like the real ones.
 */
export function createFlamingo(materials: LootMaterials, geometries: THREE.BufferGeometry[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "Flamingo";
  const ring = new THREE.TorusGeometry(0.62, 0.3, 14, 28);
  ring.rotateX(Math.PI / 2);
  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.18, 0.62),
    new THREE.Vector3(0, 0.6, 0.78),
    new THREE.Vector3(0, 1.0, 0.62),
    new THREE.Vector3(0, 1.32, 0.78),
    new THREE.Vector3(0, 1.5, 0.98),
  ]);
  const neck = new THREE.TubeGeometry(neckCurve, 24, 0.12, 10, false);
  const head = new THREE.SphereGeometry(0.17, 14, 10);
  const beak = new THREE.ConeGeometry(0.075, 0.3, 10);
  beak.rotateX(Math.PI / 2 + 0.9);
  const beakTip = new THREE.ConeGeometry(0.045, 0.12, 8);
  beakTip.rotateX(Math.PI / 2 + 0.9);
  const eye = new THREE.SphereGeometry(0.028, 8, 6);
  const tail = new THREE.ConeGeometry(0.16, 0.36, 10);
  tail.rotateX(-Math.PI / 2 - 0.5);
  geometries.push(ring, neck, head, beak, beakTip, eye, tail);
  const ringMesh = new THREE.Mesh(ring, materials.vinyl);
  const neckMesh = new THREE.Mesh(neck, materials.vinyl);
  const headMesh = new THREE.Mesh(head, materials.vinyl);
  headMesh.position.set(0, 1.52, 1.0);
  const beakMesh = new THREE.Mesh(beak, materials.beak);
  beakMesh.position.set(0, 1.44, 1.2);
  const tipMesh = new THREE.Mesh(beakTip, materials.beakTip);
  tipMesh.position.set(0, 1.36, 1.3);
  const eyeLeft = new THREE.Mesh(eye, materials.eye);
  eyeLeft.position.set(0.13, 1.57, 1.06);
  const eyeRight = eyeLeft.clone();
  eyeRight.position.x = -0.13;
  const tailMesh = new THREE.Mesh(tail, materials.vinyl);
  tailMesh.position.set(0, 0.32, -0.78);
  group.add(ringMesh, neckMesh, headMesh, beakMesh, tipMesh, eyeLeft, eyeRight, tailMesh);
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  return group;
}
