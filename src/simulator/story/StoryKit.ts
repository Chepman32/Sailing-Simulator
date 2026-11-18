import * as THREE from "three";

/**
 * A story person's kit, worn over a trader model (`TraderSpot.kit`): for
 * Holloway an unbuttoned plate carrier — two front panels hanging apart,
 * the back panel, shoulder straps, magazine pouches — and a heavy assault
 * rifle slung across the body, muzzle down past his right thigh. In the figure's
 * own frame: +Z forward, +Y up, metres from the soles (a figure some
 * 1.8 m tall). Shared geometry and materials, built once.
 */

let parts: {
  panel: THREE.BoxGeometry;
  back: THREE.BoxGeometry;
  strap: THREE.BoxGeometry;
  pouch: THREE.BoxGeometry;
  receiver: THREE.BoxGeometry;
  barrel: THREE.CylinderGeometry;
  stock: THREE.BoxGeometry;
  magazine: THREE.BoxGeometry;
  rail: THREE.BoxGeometry;
  sight: THREE.BoxGeometry;
  sling: THREE.BoxGeometry;
  cloth: THREE.MeshStandardMaterial;
  webbing: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
} | null = null;

function shared() {
  parts ??= {
    panel: new THREE.BoxGeometry(0.17, 0.36, 0.045),
    back: new THREE.BoxGeometry(0.38, 0.4, 0.045),
    strap: new THREE.BoxGeometry(0.07, 0.03, 0.3),
    pouch: new THREE.BoxGeometry(0.07, 0.11, 0.05),
    receiver: new THREE.BoxGeometry(0.06, 0.09, 0.42),
    barrel: new THREE.CylinderGeometry(0.014, 0.016, 0.38, 8),
    stock: new THREE.BoxGeometry(0.05, 0.11, 0.24),
    magazine: new THREE.BoxGeometry(0.04, 0.17, 0.07),
    rail: new THREE.BoxGeometry(0.055, 0.06, 0.26),
    sight: new THREE.BoxGeometry(0.04, 0.05, 0.09),
    sling: new THREE.BoxGeometry(0.035, 0.62, 0.012),
    cloth: new THREE.MeshStandardMaterial({ color: 0x4b5138, roughness: 0.92 }),
    webbing: new THREE.MeshStandardMaterial({ color: 0x3a3f2c, roughness: 0.95 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.45, metalness: 0.7 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x2a2b2c, roughness: 0.7, metalness: 0.1 }),
  };
  return parts;
}

export function armedKit(): THREE.Group {
  const p = shared();
  const kit = new THREE.Group();
  kit.name = "StoryKit_armed";
  // The carrier, open at the front.
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(p.panel, p.cloth);
    panel.position.set(side * 0.11, 1.27, 0.125);
    panel.rotation.set(0.05, side * -0.22, 0);
    panel.castShadow = true;
    kit.add(panel);
    const strap = new THREE.Mesh(p.strap, p.webbing);
    strap.position.set(side * 0.12, 1.47, 0);
    kit.add(strap);
    for (const row of [0, 1]) {
      const pouch = new THREE.Mesh(p.pouch, p.webbing);
      pouch.position.set(side * (0.07 + row * 0.08), 1.16, 0.155);
      pouch.rotation.y = side * -0.22;
      kit.add(pouch);
    }
  }
  const back = new THREE.Mesh(p.back, p.cloth);
  back.position.set(0, 1.27, -0.13);
  back.castShadow = true;
  kit.add(back);
  // The rifle, slung across the body: butt up by the left shoulder, muzzle
  // down past the right thigh, lying against the carrier's front.
  const rifle = new THREE.Group();
  rifle.position.set(0.05, 1.2, 0.25);
  rifle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-0.45, -0.89, 0).normalize());
  // The magazine out from the chest, not into it.
  rifle.rotateZ(Math.PI / 2);
  const receiver = new THREE.Mesh(p.receiver, p.metal);
  const rail = new THREE.Mesh(p.rail, p.polymer);
  rail.position.set(0, 0.0, 0.32);
  const barrel = new THREE.Mesh(p.barrel, p.metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, 0.6);
  const stock = new THREE.Mesh(p.stock, p.polymer);
  stock.position.set(0, -0.02, -0.32);
  const magazine = new THREE.Mesh(p.magazine, p.polymer);
  magazine.position.set(0, -0.12, 0.08);
  magazine.rotation.x = 0.18;
  const sight = new THREE.Mesh(p.sight, p.metal);
  sight.position.set(0, 0.07, 0.02);
  for (const mesh of [receiver, rail, barrel, stock, magazine, sight]) {
    mesh.castShadow = true;
    rifle.add(mesh);
  }
  kit.add(rifle);
  // The sling, from the left shoulder across the chest to the right hip.
  const sling = new THREE.Mesh(p.sling, p.webbing);
  sling.position.set(0, 1.24, 0.185);
  sling.rotation.z = -Math.atan2(0.3, 0.48);
  kit.add(sling);
  return kit;
}
