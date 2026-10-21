import * as THREE from "three";

/**
 * Procedural models of the strange places: the party barge, the stranded
 * pirate galleon on its reef, and the monolith. Each builder returns a group
 * in the place's own frame (bow toward +Z, the waterline at y = 0) plus the
 * parts that the system animates.
 */

export type BargeParts = {
  group: THREE.Group;
  /** Coloured haze over the floor, pulsing with the beat. */
  haze: THREE.Sprite;
  dancers: THREE.Object3D[];
  floor: THREE.ShaderMaterial;
  bulbs: THREE.InstancedMesh;
  ball: THREE.Mesh;
  lasers: THREE.Group;
  laserMaterial: THREE.ShaderMaterial;
  bulbCount: number;
};

export type WreckParts = {
  group: THREE.Group;
  lantern: THREE.Sprite;
  sails: THREE.Mesh[];
  flag: THREE.Mesh;
};

export type MonolithParts = {
  group: THREE.Group;
  runes: THREE.MeshStandardMaterial;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
};

/** Everything a builder allocated, for disposal. */
export type Owned = { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] };

function dataTexture(size: number, paint: (x: number, y: number) => [number, number, number, number], srgb = true): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const index = (y * size + x) * 4;
      data[index] = Math.max(0, Math.min(255, r));
      data[index + 1] = Math.max(0, Math.min(255, g));
      data[index + 2] = Math.max(0, Math.min(255, b));
      data[index + 3] = Math.max(0, Math.min(255, a));
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function noise2(x: number, y: number, seed = 0): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = noise2(ix, iy, seed);
  const b = noise2(ix + 1, iy, seed);
  const c = noise2(ix, iy + 1, seed);
  const d = noise2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function standard(owned: Owned, parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(parameters);
  owned.materials.push(material);
  return material;
}

function mesh(owned: Owned, geometry: THREE.BufferGeometry, material: THREE.Material, shadows = true): THREE.Mesh {
  owned.geometries.push(geometry);
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = shadows;
  result.receiveShadow = shadows;
  return result;
}

// --- The party barge --------------------------------------------------------

const floorVertex = /* glsl */ `
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const floorFragment = /* glsl */ `
  uniform float uBeat;
  uniform float uLevel;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  vec3 hue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }
  void main() {
    vec2 grid = vUv * vec2(6.0, 8.0);
    vec2 cell = floor(grid);
    vec2 inCell = fract(grid);
    float seam = step(0.06, inCell.x) * step(inCell.x, 0.94) * step(0.06, inCell.y) * step(inCell.y, 0.94);
    float beat = floor(uBeat);
    float pick = fract(sin(dot(cell + beat * vec2(3.1, 1.7), vec2(12.9898, 78.233))) * 43758.5453);
    // Each beat lights a new pattern, fading through the beat.
    float on = step(0.45, pick) * (1.0 - fract(uBeat) * 0.75);
    vec3 color = hue(fract(pick * 3.7 + beat * 0.13)) * on * 2.6 * uLevel;
    color += vec3(0.02, 0.02, 0.03);
    gl_FragColor = vec4(color * seam + vec3(0.01) * (1.0 - seam), 1.0);
    #include <fog_fragment>
  }
`;

const laserVertex = /* glsl */ `
  varying float vAlong;
  varying float vAcross;
  #include <fog_pars_vertex>
  void main() {
    vAlong = uv.y;
    vAcross = uv.x;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const laserFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLevel;
  varying float vAlong;
  varying float vAcross;
  void main() {
    float core = exp(-pow((vAcross - 0.5) * 9.0, 2.0));
    float fade = (1.0 - vAlong) * (1.0 - vAlong);
    gl_FragColor = vec4(uColor * core * fade * uLevel, 1.0);
  }
`;

/**
 * A steel pontoon barge turned into a floating club: a lit dance floor, a DJ
 * booth between two stacks of speakers, a truss with strings of bulbs and a
 * mirror ball, and at night lasers sweeping the sky. 28 × 12 m.
 */
export function buildBarge(owned: Owned): BargeParts {
  const group = new THREE.Group();
  group.name = "PartyBarge";
  const steel = standard(owned, { color: 0x1f3d5c, roughness: 0.55, metalness: 0.25 });
  const rust = standard(owned, { color: 0x6b3a22, roughness: 0.9 });
  const deckMaterial = standard(owned, { color: 0x8a6a4a, roughness: 0.75 });
  const black = standard(owned, { color: 0x111216, roughness: 0.5 });
  const truss = standard(owned, { color: 0xb8bcc2, roughness: 0.35, metalness: 0.85 });

  const hull = mesh(owned, new THREE.BoxGeometry(12, 2.4, 28), steel);
  hull.position.y = 0.3;
  const stripe = mesh(owned, new THREE.BoxGeometry(12.05, 0.35, 28.05), rust, false);
  stripe.position.y = -0.55;
  const white = standard(owned, { color: 0xe9e6dc, roughness: 0.5 });
  const band = mesh(owned, new THREE.BoxGeometry(12.06, 0.22, 28.06), white, false);
  band.position.y = 1.2;
  group.add(band);
  // A shade sail stretched over the truss.
  const sailcloth = standard(owned, { color: 0xf3efe6, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const shadeGeometry = new THREE.BufferGeometry();
  shadeGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-4.8, 6.3, -8.4, 4.8, 6.3, -8.4, 0, 5.6, 4.6, -4.8, 6.3, 4.6, 4.8, 6.3, 4.6, 0, 5.7, -8.4], 3),
  );
  shadeGeometry.setIndex([0, 2, 1, 3, 4, 5]);
  shadeGeometry.computeVertexNormals();
  const shade = mesh(owned, shadeGeometry, sailcloth);
  group.add(shade);
  const deck = mesh(owned, new THREE.BoxGeometry(11.6, 0.1, 27.6), deckMaterial);
  deck.position.y = 1.55;
  group.add(hull, stripe, deck);

  // Dance floor: 6 × 8 glowing tiles.
  const floor = new THREE.ShaderMaterial({
    name: "DanceFloor",
    vertexShader: floorVertex,
    fragmentShader: floorFragment,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uBeat: { value: 0 }, uLevel: { value: 1 } }]),
    fog: true,
  });
  owned.materials.push(floor);
  const floorMesh = mesh(owned, new THREE.PlaneGeometry(9, 12), floor, false);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(0, 1.62, -2);
  group.add(floorMesh);

  // DJ booth and speaker stacks at the bow end of the floor.
  const booth = mesh(owned, new THREE.BoxGeometry(4, 1.2, 1.6), black);
  booth.position.set(0, 2.2, 6.2);
  const boothStrip = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.2, 1.6, 2.6, THREE.LinearSRGBColorSpace) });
  owned.materials.push(boothStrip);
  const strip = mesh(owned, new THREE.BoxGeometry(4.02, 0.08, 0.02), boothStrip, false);
  strip.position.set(0, 2.55, 5.39);
  group.add(booth, strip);
  const coneMaterial = standard(owned, { color: 0x2a2a30, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const stack = mesh(owned, new THREE.BoxGeometry(1.3, 3, 1.2), black);
    stack.position.set(side * 3.6, 3.1, 6.3);
    group.add(stack);
    for (const height of [2.3, 3.4]) {
      const cone = mesh(owned, new THREE.CircleGeometry(0.42, 20), coneMaterial, false);
      cone.position.set(side * 3.6, height, 5.69);
      cone.rotation.y = Math.PI;
      group.add(cone);
    }
  }

  // Truss: four posts and a frame over the floor.
  const postGeometry = new THREE.CylinderGeometry(0.09, 0.09, 4.6, 8);
  owned.geometries.push(postGeometry);
  const corners: [number, number][] = [[-4.8, -8.4], [4.8, -8.4], [-4.8, 4.6], [4.8, 4.6]];
  for (const [x, z] of corners) {
    const post = new THREE.Mesh(postGeometry, truss);
    post.position.set(x, 3.9, z);
    post.castShadow = true;
    group.add(post);
  }
  const beamAlong = new THREE.CylinderGeometry(0.08, 0.08, 13, 8);
  beamAlong.rotateX(Math.PI / 2);
  const beamAcross = new THREE.CylinderGeometry(0.08, 0.08, 9.6, 8);
  beamAcross.rotateZ(Math.PI / 2);
  owned.geometries.push(beamAlong, beamAcross);
  for (const x of [-4.8, 4.8]) {
    const beam = new THREE.Mesh(beamAlong, truss);
    beam.position.set(x, 6.2, -1.9);
    group.add(beam);
  }
  for (const z of [-8.4, 4.6]) {
    const beam = new THREE.Mesh(beamAcross, truss);
    beam.position.set(0, 6.2, z);
    group.add(beam);
  }

  // Strings of bulbs sagging between the beams, and along the rails.
  const bulbPoints: THREE.Vector3[] = [];
  const sag = (a: THREE.Vector3, b: THREE.Vector3, count: number, depth: number): void => {
    for (let index = 0; index < count; index += 1) {
      const t = (index + 0.5) / count;
      const point = a.clone().lerp(b, t);
      point.y -= Math.sin(t * Math.PI) * depth;
      bulbPoints.push(point);
    }
  };
  for (const [x, z] of [[-4.8, -8.4], [4.8, -8.4]] as const) sag(new THREE.Vector3(x, 6.1, z), new THREE.Vector3(-x, 6.1, z + 13), 14, 1.1);
  for (const x of [-4.8, 4.8]) sag(new THREE.Vector3(x, 6.1, -8.4), new THREE.Vector3(x, 6.1, 4.6), 12, 0.7);
  for (const x of [-5.9, 5.9]) sag(new THREE.Vector3(x, 2.3, -13.6), new THREE.Vector3(x, 2.3, 13.6), 22, 0.5);
  const bulbGeometry = new THREE.SphereGeometry(0.09, 8, 6);
  owned.geometries.push(bulbGeometry);
  const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  owned.materials.push(bulbMaterial);
  const bulbs = new THREE.InstancedMesh(bulbGeometry, bulbMaterial, bulbPoints.length);
  const matrix = new THREE.Matrix4();
  bulbPoints.forEach((point, index) => {
    matrix.makeTranslation(point.x, point.y, point.z);
    bulbs.setMatrixAt(index, matrix);
    bulbs.setColorAt(index, new THREE.Color(1, 1, 1));
  });
  bulbs.frustumCulled = false;
  group.add(bulbs);

  // Rails.
  const railGeometry = new THREE.CylinderGeometry(0.04, 0.04, 27.4, 6);
  railGeometry.rotateX(Math.PI / 2);
  owned.geometries.push(railGeometry);
  for (const x of [-5.9, 5.9]) {
    const rail = new THREE.Mesh(railGeometry, truss);
    rail.position.set(x, 2.5, 0);
    group.add(rail);
  }

  // Mirror ball.
  const ballMaterial = standard(owned, { color: 0xdfe6ee, roughness: 0.05, metalness: 1, flatShading: true, envMapIntensity: 2 });
  const ball = mesh(owned, new THREE.IcosahedronGeometry(0.55, 2), ballMaterial, false);
  ball.position.set(0, 5.2, -1.9);
  const wire = mesh(owned, new THREE.CylinderGeometry(0.01, 0.01, 1, 4), truss, false);
  wire.position.set(0, 5.75, -1.9);
  group.add(ball, wire);

  // Lasers fanning up from the booth (shown at night).
  const laserMaterial = new THREE.ShaderMaterial({
    name: "Laser",
    vertexShader: laserVertex,
    fragmentShader: laserFragment,
    uniforms: { uColor: { value: new THREE.Color().setRGB(0.3, 3.2, 0.9, THREE.LinearSRGBColorSpace) }, uLevel: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  owned.materials.push(laserMaterial);
  const beamGeometry = new THREE.PlaneGeometry(0.5, 160);
  beamGeometry.translate(0, 80, 0);
  owned.geometries.push(beamGeometry);
  const lasers = new THREE.Group();
  lasers.position.set(0, 3, 6.2);
  for (let index = 0; index < 5; index += 1) {
    const beam = new THREE.Mesh(beamGeometry, laserMaterial);
    beam.rotation.z = (index - 2) * 0.28;
    beam.frustumCulled = false;
    lasers.add(beam);
  }
  lasers.visible = false;
  group.add(lasers);

  // The crowd: simple figures that bounce to the beat.
  const skin = standard(owned, { color: 0x8a5a40, roughness: 0.7 });
  const clothes = [0xe0457b, 0x2b2f3a, 0xf2c14e, 0x2bb7b3, 0xf4f1ea, 0x6a4bd6].map((color) => standard(owned, { color, roughness: 0.75 }));
  const bodyGeometry = new THREE.CapsuleGeometry(0.22, 0.75, 4, 8);
  const headGeometry = new THREE.SphereGeometry(0.15, 10, 8);
  const legGeometry = new THREE.CapsuleGeometry(0.09, 0.6, 3, 6);
  owned.geometries.push(bodyGeometry, headGeometry, legGeometry);
  const dancers: THREE.Object3D[] = [];
  const spots: [number, number][] = [[-2.6, -4.5], [-0.8, -6.2], [1.6, -3.4], [2.9, -6.6], [-2.2, 0.4], [0.4, -0.6], [2.4, 1.6], [-0.9, 2.6], [1.1, -8.4], [-3.2, -8]];
  spots.forEach(([x, z], index) => {
    const dancer = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry, clothes[index % clothes.length]!);
    body.position.y = 1.25;
    const head = new THREE.Mesh(headGeometry, skin);
    head.position.y = 1.92;
    const legLeft = new THREE.Mesh(legGeometry, clothes[(index + 1) % clothes.length]!);
    legLeft.position.set(0.11, 0.45, 0);
    const legRight = legLeft.clone();
    legRight.position.x = -0.11;
    dancer.add(body, head, legLeft, legRight);
    dancer.position.set(x, 1.62, z);
    dancer.rotation.y = index * 2.3;
    dancer.scale.setScalar(0.95 + (index % 3) * 0.06);
    dancer.userData.phase = index * 0.37;
    group.add(dancer);
    dancers.push(dancer);
  });

  // A glow of coloured light hanging in the air over the floor.
  const hazeTexture = dataTexture(
    64,
    (x, y) => {
      const r = Math.hypot((x + 0.5) / 64 * 2 - 1, (y + 0.5) / 64 * 2 - 1);
      return [255, 255, 255, 255 * Math.max(0, Math.exp(-r * r * 3.5) - 0.03)];
    },
    false,
  );
  owned.textures.push(hazeTexture);
  const hazeMaterial = new THREE.SpriteMaterial({ map: hazeTexture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  owned.materials.push(hazeMaterial);
  const haze = new THREE.Sprite(hazeMaterial);
  haze.position.set(0, 4.4, -2);
  haze.scale.set(15, 4.6, 1);
  group.add(haze);

  return { group, haze, dancers, floor, bulbs, ball, lasers, laserMaterial, bulbCount: bulbPoints.length };
}

// --- The pirate galleon on the reef -------------------------------------------

/** Weathered planking, dark and salt-bleached, with a few green stains. */
function hullTexture(): THREE.DataTexture {
  return dataTexture(256, (x, y) => {
    const plank = Math.floor(y / 16);
    const inPlank = (y % 16) / 16;
    const grain = smoothNoise(x * 0.05 + plank * 13.1, y * 0.4, 2) * 0.5 + smoothNoise(x * 0.3, y * 0.9 + plank, 3) * 0.2;
    let shade = 0.5 + grain * 0.4;
    if (inPlank < 0.08) shade *= 0.35;
    const butt = (x + plank * 53) % 96 < 2;
    if (butt) shade *= 0.4;
    const stain = smoothNoise(x * 0.02, y * 0.03, 9);
    const salt = smoothNoise(x * 0.04 + 5, y * 0.05, 4);
    let r = 92 * shade;
    let g = 66 * shade;
    let b = 44 * shade;
    // Salt bloom and weed toward the waterline (low y).
    const low = Math.max(0, 1 - y / 256 - 0.45) * 2;
    r += salt * 40 * (1 - low);
    g += salt * 38 * (1 - low) + low * stain * 30;
    b += salt * 34 * (1 - low);
    return [r, g, b, 255];
  });
}

/** Sailcloth rotted to rags: holes, a ragged foot, stains. */
function raggedSailTexture(seed: number): THREE.DataTexture {
  return dataTexture(128, (x, y) => {
    const u = x / 128;
    const v = y / 128;
    const holes = smoothNoise(u * 7 + seed, v * 7, seed) * 0.65 + smoothNoise(u * 19, v * 19 + seed, seed + 1) * 0.35;
    const foot = v < 0.18 + smoothNoise(u * 14, seed, seed + 2) * 0.35;
    const edge = u < 0.03 || u > 0.97;
    const keep = !foot && holes < 0.66 && !edge;
    const dirt = 0.62 + smoothNoise(u * 5, v * 5, seed + 3) * 0.3;
    return [208 * dirt, 196 * dirt, 168 * dirt, keep ? 255 : 0];
  });
}

/** A black flag with a white skull and crossed bones, frayed at the fly. */
function jollyRoger(): THREE.DataTexture {
  return dataTexture(64, (x, y) => {
    const u = x / 64;
    const v = 1 - y / 64;
    const fray = u > 0.85 && smoothNoise(v * 20, 1, 5) > 0.55 + (1 - u) * 2;
    let white = false;
    const sx = (u - 0.45) / 0.16;
    const sy = (v - 0.4) / 0.17;
    if (sx * sx + sy * sy < 1 && !(Math.hypot(sx + 0.38, sy + 0.1) < 0.28 || Math.hypot(sx - 0.38, sy + 0.1) < 0.28)) white = true;
    if (Math.abs(u - 0.45) < 0.08 && v > 0.52 && v < 0.62 && !(Math.abs(u - 0.45) < 0.02)) white = true;
    const along1 = (u - 0.45) + (v - 0.72);
    const along2 = (u - 0.45) - (v - 0.72);
    if (Math.abs(along1) < 0.035 && Math.abs(u - 0.45) < 0.2) white = true;
    if (Math.abs(along2) < 0.035 && Math.abs(u - 0.45) < 0.2) white = true;
    return white ? [230, 226, 214, fray ? 0 : 255] : [14, 14, 16, fray ? 0 : 255];
  });
}

/**
 * The hull of a galleon, lofted from sections: round in the bilge, tumbling
 * home toward the deck, the sheer rising to a high stern and a beakhead
 * bow. Length 30 m, beam 8.4 m, depth 6 m; y = 0 at the keel.
 */
function galleonHull(): THREE.BufferGeometry {
  const sections = 28;
  const around = 18;
  const length = 30;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= sections; i += 1) {
    const s = i / sections; // 0 stern … 1 bow
    const z = (s - 0.5) * length;
    // Beam: full amidships, a broad transom aft, fine at the bow.
    const beam = 4.2 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.18 + s * 0.86)), 0.55) * (s < 0.1 ? 0.92 + s * 0.8 : 1);
    // Sheer: high aft, rising again at the bow.
    const sheer = 6 + Math.pow(1 - s, 3) * 3.2 + Math.pow(s, 4) * 1.6;
    const keel = s > 0.92 ? (s - 0.92) * 18 : 0;
    for (let j = 0; j <= around; j += 1) {
      const t = j / around; // 0 port deck edge … 1 starboard deck edge
      const angle = Math.PI * t;
      // Half-ellipse section with tumblehome near the top.
      const side = -Math.cos(angle);
      const depth = Math.sin(angle);
      const width = beam * side * (1 - 0.12 * Math.pow(1 - depth, 3));
      const y = keel + (sheer - keel) * (1 - Math.pow(depth, 1.6));
      positions.push(width, y, z);
      uvs.push(s * 4, y / 10);
    }
  }
  for (let i = 0; i < sections; i += 1) {
    for (let j = 0; j < around; j += 1) {
      const a = i * (around + 1) + j;
      const b = a + around + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // Transom: close the stern.
  const center = positions.length / 3;
  positions.push(0, 6, -length / 2);
  uvs.push(0, 0.6);
  for (let j = 0; j < around; j += 1) indices.push(center, j + 1, j);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A rock: a lumpy, flattened icosahedron. */
function rockGeometry(seed: number, size: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(size, 1);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const bump = 0.75 + smoothNoise(x * 0.6 + seed, z * 0.6 - seed, seed) * 0.5;
    position.setXYZ(index, x * bump, y * bump * 0.55, z * bump);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The pirate galleon that struck the reef: heeled over and down by the
 * bow, her foremast gone by the board, the main snapped, rags of sail on the
 * mizzen yard and a tattered black flag still flying; rocks of the reef
 * around her, and at night a ghostly green lantern burning on the poop.
 */
export function buildWreck(owned: Owned): WreckParts {
  const group = new THREE.Group();
  group.name = "PirateWreck";
  const texture = hullTexture();
  owned.textures.push(texture);
  const wood = standard(owned, { map: texture, roughness: 0.92, metalness: 0 });
  const darkWood = standard(owned, { color: 0x2c2018, roughness: 0.9 });
  const rockMaterial = standard(owned, { color: 0x4a443c, roughness: 0.95 });
  const weed = standard(owned, { color: 0x3b4a2e, roughness: 0.95 });

  const ship = new THREE.Group();
  const hull = mesh(owned, galleonHull(), wood);
  hull.material = wood;
  ship.add(hull);
  // Deck, sunk into the hull.
  const deck = mesh(owned, new THREE.BoxGeometry(7, 0.3, 26), darkWood);
  deck.position.set(0, 5.6, 0.5);
  ship.add(deck);
  // Poop deck cabin.
  const cabin = mesh(owned, new THREE.BoxGeometry(7.2, 2.6, 6), wood);
  cabin.position.set(0, 7.2, -11.4);
  ship.add(cabin);
  const rail = mesh(owned, new THREE.BoxGeometry(7.6, 0.6, 0.3), darkWood);
  rail.position.set(0, 8.8, -14.2);
  ship.add(rail);

  // Masts: the foremast gone, the main snapped, the mizzen standing.
  const mastGeometry = new THREE.CylinderGeometry(0.28, 0.38, 1, 10);
  owned.geometries.push(mastGeometry);
  const addMast = (z: number, height: number, tiltX = 0, tiltZ = 0): THREE.Mesh => {
    const mast = new THREE.Mesh(mastGeometry, darkWood);
    mast.scale.set(1, height, 1);
    mast.position.set(0, 5.6 + height / 2, z);
    mast.rotation.set(tiltX, 0, tiltZ);
    mast.castShadow = true;
    ship.add(mast);
    return mast;
  };
  addMast(1, 9);
  const mizzen = addMast(-8, 17);
  // The fallen foremast lies across the bulwark into the sea.
  const fallen = new THREE.Mesh(mastGeometry, darkWood);
  fallen.scale.set(0.9, 16, 0.9);
  fallen.position.set(4.2, 6.2, 8.5);
  fallen.rotation.set(0.25, 0, -1.25);
  ship.add(fallen);
  // Splintered top of the main.
  const splinter = mesh(owned, new THREE.ConeGeometry(0.3, 1.4, 6), darkWood);
  splinter.position.set(0.1, 15.3, 1);
  splinter.rotation.z = 0.3;
  ship.add(splinter);

  // Yards with rags of sail.
  const sails: THREE.Mesh[] = [];
  const yardGeometry = new THREE.CylinderGeometry(0.12, 0.12, 9, 6);
  yardGeometry.rotateZ(Math.PI / 2);
  owned.geometries.push(yardGeometry);
  for (const [height, width, drop, seed] of [[19.5, 8, 6, 1], [14.5, 9, 4.5, 2]] as const) {
    const yard = new THREE.Mesh(yardGeometry, darkWood);
    yard.scale.x = width / 9;
    yard.position.set(0, height, -8);
    yard.rotation.y = 0.35;
    ship.add(yard);
    const sailTexture = raggedSailTexture(seed);
    owned.textures.push(sailTexture);
    const sailMaterial = standard(owned, { map: sailTexture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });
    const sail = mesh(owned, new THREE.PlaneGeometry(width * 0.95, drop, 8, 6), sailMaterial);
    sail.geometry.translate(0, -drop / 2, 0);
    sail.position.set(0, height - 0.1, -8);
    sail.rotation.y = 0.35;
    ship.add(sail);
    sails.push(sail);
  }
  // The flag at the mizzen head.
  const flagTexture = jollyRoger();
  owned.textures.push(flagTexture);
  const flagMaterial = standard(owned, { map: flagTexture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  const flag = mesh(owned, new THREE.PlaneGeometry(2.4, 1.6, 6, 2), flagMaterial, false);
  flag.geometry.translate(1.2, 0, 0);
  flag.position.set(0, 5.6 + 17 - 0.6, -8);
  ship.add(flag);
  void mizzen;

  // Lantern on the poop: green, ghostly.
  const lanternMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.6, 3.2, 1.4, THREE.LinearSRGBColorSpace) });
  owned.materials.push(lanternMaterial);
  const lanternBody = mesh(owned, new THREE.CylinderGeometry(0.22, 0.26, 0.5, 8), lanternMaterial, false);
  lanternBody.position.set(2.8, 9.4, -13.6);
  ship.add(lanternBody);
  const glowTexture = dataTexture(
    64,
    (x, y) => {
      const r = Math.hypot((x + 0.5) / 64 * 2 - 1, (y + 0.5) / 64 * 2 - 1);
      return [255, 255, 255, 255 * Math.max(0, Math.exp(-r * r * 5) - 0.006)];
    },
    false,
  );
  owned.textures.push(glowTexture);
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: new THREE.Color().setRGB(0.5, 2.6, 1.2, THREE.LinearSRGBColorSpace),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  owned.materials.push(glowMaterial);
  const lantern = new THREE.Sprite(glowMaterial);
  lantern.position.copy(lanternBody.position);
  lantern.scale.setScalar(5);
  ship.add(lantern);

  // Stranded: heeled to port, down by the bow, the keel on the reef.
  ship.rotation.set(0.06, 0, 0.32);
  ship.position.set(0, -2.2, 0);
  group.add(ship);

  // The reef: rocks breaking the surface around her.
  const rocks: [number, number, number, number][] = [
    [-7, 8, 2.2, 3], [6, 12, 1.8, 2.4], [-9, -3, 2.6, 2.8], [8, -6, 2, 3.2], [-4, 17, 1.6, 2],
    [3, -16, 2.2, 2.6], [10, 4, 1.4, 1.8], [-11, 11, 1.2, 1.6], [0, 21, 1.5, 1.8], [-6, -14, 1.8, 2.2],
  ];
  rocks.forEach(([x, z, size, seed], index) => {
    const rock = mesh(owned, rockGeometry(seed + index, size), index % 3 === 0 ? weed : rockMaterial);
    rock.position.set(x, -0.25 + (index % 2) * 0.35, z);
    rock.rotation.y = index * 1.7;
    group.add(rock);
  });

  return { group, lantern, sails, flag };
}

// --- The monolith ---------------------------------------------------------------

/** Glyphs in a grid: strokes and dots, glowing where the rest is black. */
function runeTexture(): THREE.DataTexture {
  const size = 256;
  const cells = 8;
  const cell = size / cells;
  return dataTexture(
    size,
    (x, y) => {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const u = (x % cell) / cell;
      const v = (y % cell) / cell;
      const seed = cx * 7 + cy * 13;
      let lit = 0;
      // An inscription, not wallpaper: only some cells carry a glyph.
      if (noise2(cx, cy, 9) > 0.42) return [0, 0, 0, 255];
      // Each glyph: a few strokes from a small set.
      for (let stroke = 0; stroke < 4; stroke += 1) {
        const kind = Math.floor(noise2(seed, stroke, 1) * 5);
        const at = 0.25 + noise2(seed, stroke, 2) * 0.5;
        if (noise2(seed, stroke, 3) < 0.35) continue;
        const d =
          kind === 0 ? Math.abs(u - at)
          : kind === 1 ? Math.abs(v - at)
          : kind === 2 ? Math.abs(u - v)
          : kind === 3 ? Math.abs(u + v - 1)
          : Math.abs(Math.hypot(u - 0.5, v - 0.5) - at * 0.5);
        const inside = u > 0.18 && u < 0.82 && v > 0.12 && v < 0.88;
        if (inside && d < 0.035) lit = 1;
      }
      const value = lit * 255;
      return [value, value, value, 255];
    },
    false,
  );
}

const ringVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  varying vec2 vUv;
  void main() {
    // Concentric rings of light spreading outward over the water.
    float r = vUv.x;
    float wave = pow(0.5 + 0.5 * sin(r * 26.0 - uTime * 1.3), 14.0);
    float fade = pow(1.0 - r, 2.0) * smoothstep(0.0, 0.08, r);
    gl_FragColor = vec4(vec3(0.2, 1.3, 1.8) * wave * fade * uLevel * 0.6, 1.0);
  }
`;

/**
 * A black slab of polished stone, 15 m tall, standing straight out of open
 * sea on a plinth of rock: its faces carry rows of glyphs that glow cyan,
 * brighter the nearer the yacht comes, and rings of light spread over the
 * water around it at night.
 */
export function buildMonolith(owned: Owned): MonolithParts {
  const group = new THREE.Group();
  group.name = "Monolith";
  const runeMap = runeTexture();
  runeMap.repeat.set(0.38, 1.4);
  runeMap.offset.set(0.31, 0);
  owned.textures.push(runeMap);
  const runes = standard(owned, {
    color: 0x07080a,
    roughness: 0.08,
    metalness: 0.4,
    envMapIntensity: 1.6,
    emissive: new THREE.Color().setRGB(0.25, 1.5, 2.1, THREE.LinearSRGBColorSpace),
    emissiveMap: runeMap,
    emissiveIntensity: 0.4,
  });
  const slab = mesh(owned, new THREE.BoxGeometry(2.2, 17, 4.2), runes);
  slab.position.y = 6.5;
  group.add(slab);
  const rock = standard(owned, { color: 0x2f2d2b, roughness: 0.95 });
  for (let index = 0; index < 5; index += 1) {
    const plinth = mesh(owned, rockGeometry(index * 3 + 1, 2.2 + (index % 2)), rock);
    const angle = index * 1.26;
    plinth.position.set(Math.cos(angle) * 2.6, -0.6 + (index % 3) * 0.2, Math.sin(angle) * 2.6);
    group.add(plinth);
  }
  const ringMaterial = new THREE.ShaderMaterial({
    name: "MonolithRings",
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.materials.push(ringMaterial);
  // A ring whose UV.x runs from the slab outward.
  const ringGeometry = new THREE.RingGeometry(3.2, 40, 64, 1);
  const uv = ringGeometry.getAttribute("uv") as THREE.BufferAttribute;
  const position = ringGeometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < uv.count; index += 1) {
    const r = Math.hypot(position.getX(index), position.getY(index));
    uv.setXY(index, (r - 3.2) / (40 - 3.2), 0);
  }
  ringGeometry.rotateX(-Math.PI / 2);
  owned.geometries.push(ringGeometry);
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.y = 0.25;
  ring.renderOrder = 3;
  group.add(ring);
  return { group, runes, ring };
}
