import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Procedural aircraft, built to real dimensions:
 *
 * - a high-wing light floatplane (8.3 m long, 11 m span) in the manner of
 *   the classic four-seat bush planes: a lofted fuselage with a round cowling,
 *   a tapering tail cone, a cambered wing with struts and rounded tips, a
 *   swept fin, two long floats on their struts, a spinner and a two-blade
 *   propeller (blades plus a motion-blurred disc), navigation lights and a
 *   painted livery (windows, cheat line, registration) on a canvas texture;
 * - an airliner (a twin-engine narrow-body, 38 m), seen only from ten
 *   kilometres, where its silhouette is all that matters.
 *
 * Nose toward +Z, up +Y, right wing toward +X. Owned geometries and
 * materials are returned for disposal.
 */

export type Owned = { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] };

type Section = { z: number; w: number; h: number; cy: number; n: number };

/** A body lofted through superelliptic sections (front to back), with UVs (u along, v around). */
function loft(sections: Section[], around = 28, closeFront = true, closeBack = true): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const front = sections[0]!.z;
  const length = front - sections[sections.length - 1]!.z;
  sections.forEach((section) => {
    for (let j = 0; j <= around; j += 1) {
      const angle = (j / around) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const e = 2 / section.n;
      const x = section.w * Math.sign(c) * Math.pow(Math.abs(c), e);
      const y = section.cy + section.h * Math.sign(s) * Math.pow(Math.abs(s), e);
      positions.push(x, y, section.z);
      uvs.push((front - section.z) / length, j / around);
    }
  });
  const ring = around + 1;
  for (let i = 0; i < sections.length - 1; i += 1) {
    for (let j = 0; j < around; j += 1) {
      const a = i * ring + j;
      const b = a + ring;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const cap = (index: number, flip: boolean) => {
    const section = sections[index]!;
    const center = positions.length / 3;
    positions.push(0, section.cy, section.z);
    uvs.push((front - section.z) / length, 0.5);
    for (let j = 0; j < around; j += 1) {
      const a = index * ring + j;
      if (flip) indices.push(center, a + 1, a);
      else indices.push(center, a, a + 1);
    }
  };
  if (closeFront) cap(0, true);
  if (closeBack) cap(sections.length - 1, false);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type Station = { x: number; chord: number; lead: number; y: number; thickness: number };

/** A cambered airfoil profile (NACA-like, 2 % camber) at chord fraction t. */
function airfoil(t: number, thickness: number): { upper: number; lower: number } {
  const half = 5 * thickness * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1036 * t * t * t * t);
  const camber = t < 0.4 ? (0.02 / 0.16) * (0.8 * t - t * t) : (0.02 / 0.36) * (0.2 + 0.8 * t - t * t);
  return { upper: camber + half, lower: camber - half };
}

/**
 * A lifting surface swept through spanwise stations (x across, the leading
 * edge at `lead` (z), the chord running back toward −Z). `vertical` lays it
 * up the fin instead (x becomes height).
 */
function wing(stations: Station[], vertical = false, points = 14): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const profile: { t: number; side: 1 | -1 }[] = [];
  for (let i = points; i >= 0; i -= 1) profile.push({ t: 0.5 - 0.5 * Math.cos((i / points) * Math.PI), side: 1 });
  for (let i = 1; i <= points; i += 1) profile.push({ t: 0.5 - 0.5 * Math.cos((i / points) * Math.PI), side: -1 });
  const count = profile.length;
  for (const station of stations) {
    for (const { t, side } of profile) {
      const foil = airfoil(t, station.thickness);
      const across = (side === 1 ? foil.upper : foil.lower) * station.chord;
      const z = station.lead - t * station.chord;
      if (vertical) positions.push(across, station.y + station.x, z);
      else positions.push(station.x, station.y + across, z);
    }
  }
  for (let s = 0; s < stations.length - 1; s += 1) {
    for (let p = 0; p < count - 1; p += 1) {
      const a = s * count + p;
      const b = a + count;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // Tip caps (fan).
  const cap = (s: number, flip: boolean) => {
    for (let p = 1; p < count - 1; p += 1) {
      const a = s * count;
      if (flip) indices.push(a, a + p + 1, a + p);
      else indices.push(a, a + p, a + p + 1);
    }
  };
  cap(0, false);
  cap(stations.length - 1, true);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A thin streamlined strut between two points. */
function strut(from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number): THREE.BufferGeometry {
  const length = from.distanceTo(to);
  const geometry = new THREE.CylinderGeometry(1, 1, length, 10, 1);
  geometry.scale(width / 2, 1, depth / 2);
  const middle = from.clone().add(to).multiplyScalar(0.5);
  const direction = to.clone().sub(from).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  geometry.applyQuaternion(quaternion);
  geometry.translate(middle.x, middle.y, middle.z);
  return geometry;
}

export type Livery = { base: string; accent: string; trim: string; registration: string };

export const LIVERIES: readonly Livery[] = [
  { base: "#f4f2ec", accent: "#1d5fa8", trim: "#e7b416", registration: "VP-SEA" },
  { base: "#f7d23a", accent: "#c8261c", trim: "#1d1d1f", registration: "VP-TKI" },
  { base: "#f4f2ec", accent: "#d43a2c", trim: "#20304a", registration: "VP-LAG" },
];

/**
 * The fuselage paint: base colour, a two-tone cheat line along each side,
 * a coloured belly and cowling, tinted cabin glass with a sky reflection,
 * and the registration on the rear fuselage. u runs nose → tail, v around
 * from the right side (0) over the top (0.25) and the left (0.5).
 */
function liveryTexture(livery: Livery): THREE.Texture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  const at = (u: number, v: number): [number, number] => [u * width, (1 - v) * height];
  const band = (u0: number, u1: number, v0: number, v1: number, color: string) => {
    const [x0, y1] = at(u0, v0);
    const [x1, y0] = at(u1, v1);
    g.fillStyle = color;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  g.fillStyle = livery.base;
  g.fillRect(0, 0, width, height);
  // Belly (around v = 0.75) and the cowling.
  band(0, 1, 0.64, 0.86, livery.accent);
  band(0, 0.13, 0, 1, livery.accent);
  // Cheat lines on both sides, sweeping up toward the tail.
  for (const side of [0, 0.5]) {
    for (let u = 0.1; u < 1; u += 0.004) {
      const rise = Math.max(0, u - 0.45) * 0.06;
      band(u, u + 0.005, side + 0.015 + rise, side + 0.05 + rise, livery.accent);
      band(u, u + 0.005, side + 0.055 + rise, side + 0.068 + rise, livery.trim);
      if (side === 0) {
        band(u, u + 0.005, 1 - 0.005, 1, livery.accent);
      }
    }
  }
  // Cabin glass: side windows on both sides and the windscreen over the top.
  const glass = (u0: number, u1: number, v0: number, v1: number) => {
    const [x0, y1] = at(u0, v0);
    const [x1, y0] = at(u1, v1);
    const gradient = g.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, "#5f7f99");
    gradient.addColorStop(0.45, "#1c2a38");
    gradient.addColorStop(1, "#0e1620");
    g.fillStyle = gradient;
    const r = Math.min(x1 - x0, y1 - y0) * 0.25;
    g.beginPath();
    g.roundRect(x0, y0, x1 - x0, y1 - y0, r);
    g.fill();
  };
  for (const side of [0, 0.5]) {
    glass(0.235, 0.33, side + 0.085, side + 0.17);
    glass(0.345, 0.43, side + 0.085, side + 0.165);
  }
  glass(0.175, 0.235, 0.12, 0.38);
  // Registration, on both sides.
  g.fillStyle = livery.trim;
  g.font = "bold 46px Arial, sans-serif";
  g.textBaseline = "middle";
  const [rx, ry] = at(0.58, 0.1);
  g.fillText(livery.registration, rx, ry);
  g.save();
  const [lx, ly] = at(0.79, 0.4);
  g.translate(lx, ly);
  g.scale(-1, 1);
  g.fillText(livery.registration, 0, 0);
  g.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export type FloatplaneParts = {
  group: THREE.Group;
  /** Turns with the engine. */
  propeller: THREE.Group;
  blurDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  /** Navigation lights: red (left tip), green (right tip), white (tail), red beacon. */
  lights: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[];
  /** Where the banner's tow line is made fast (plane space). */
  towPoint: THREE.Vector3;
};

export function buildFloatplane(livery: Livery, owned: Owned): FloatplaneParts {
  const group = new THREE.Group();
  group.name = "Floatplane";
  const liveryMap = liveryTexture(livery);
  owned.textures.push(liveryMap);
  const paint = new THREE.MeshStandardMaterial({ map: liveryMap, roughness: 0.32, metalness: 0.05, envMapIntensity: 1.2 });
  const wingPaint = new THREE.MeshStandardMaterial({ color: new THREE.Color(livery.base), roughness: 0.35, metalness: 0.05, envMapIntensity: 1.1 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(livery.accent), roughness: 0.35 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.35, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.2 });
  const floatPaint = new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.4 });
  owned.materials.push(paint, wingPaint, accent, metal, dark, floatPaint);

  // Fuselage.
  const fuselage = loft([
    { z: 0.05, w: 0.36, h: 0.36, cy: 0.02, n: 2 },
    { z: -0.3, w: 0.5, h: 0.5, cy: 0.02, n: 2.2 },
    { z: -1.0, w: 0.57, h: 0.6, cy: 0.06, n: 2.5 },
    { z: -1.55, w: 0.6, h: 0.7, cy: 0.14, n: 2.9 },
    { z: -2.2, w: 0.6, h: 0.76, cy: 0.18, n: 3.1 },
    { z: -3.4, w: 0.58, h: 0.74, cy: 0.18, n: 3.1 },
    { z: -4.3, w: 0.46, h: 0.58, cy: 0.24, n: 2.7 },
    { z: -5.5, w: 0.31, h: 0.4, cy: 0.34, n: 2.4 },
    { z: -6.8, w: 0.19, h: 0.27, cy: 0.44, n: 2.2 },
    { z: -8.0, w: 0.09, h: 0.15, cy: 0.52, n: 2 },
  ]);
  owned.geometries.push(fuselage);
  group.add(new THREE.Mesh(fuselage, paint));

  // Wing: a constant-chord centre panel, tapered outer panels, rounded tips, 1.7° dihedral.
  const dihedral = Math.tan((1.7 * Math.PI) / 180);
  const wingStations: Station[] = [];
  const spanStations = [-5.5, -5.35, -5.0, -4.0, -2.6, -1.2, 0, 1.2, 2.6, 4.0, 5.0, 5.35, 5.5];
  for (const x of spanStations) {
    const outer = Math.max(0, Math.abs(x) - 2.6) / 2.9;
    const tip = Math.max(0, Math.abs(x) - 5.0) / 0.5;
    const chord = 1.55 * (1 - 0.3 * outer) * Math.sqrt(Math.max(0.05, 1 - tip * tip * 0.85));
    wingStations.push({ x, chord, lead: -1.75 - outer * 0.12 - (1.55 * (1 - 0.3 * outer) - chord) * 0.5, y: 0.93 + Math.abs(x) * dihedral, thickness: 0.13 - outer * 0.02 });
  }
  const wingGeometry = wing(wingStations);
  owned.geometries.push(wingGeometry);
  group.add(new THREE.Mesh(wingGeometry, wingPaint));

  // Tailplane and fin.
  const tailStations: Station[] = [-1.75, -1.6, -1.0, 0, 1.0, 1.6, 1.75].map((x) => {
    const tip = Math.max(0, Math.abs(x) - 1.55) / 0.2;
    const chord = (1.05 - Math.abs(x) * 0.12) * Math.sqrt(Math.max(0.1, 1 - tip * tip * 0.8));
    return { x, chord, lead: -6.95 - Math.abs(x) * 0.15, y: 0.47, thickness: 0.1 };
  });
  const finStations: Station[] = [0, 0.4, 0.9, 1.35, 1.55].map((height) => ({
    x: height,
    chord: 1.5 - height * 0.42,
    lead: -6.55 - height * 0.62,
    y: 0.6,
    thickness: 0.1,
  }));
  const tail = mergeGeometries([wing(tailStations), wing(finStations, true)], false)!;
  owned.geometries.push(tail);
  group.add(new THREE.Mesh(tail, wingPaint));
  // A painted band across the fin.
  const finBand = new THREE.Mesh(
    wing(
      [0.8, 1.05].map((height) => ({ x: height, chord: 1.5 - height * 0.42 + 0.004, lead: -6.55 - height * 0.62 + 0.002, y: 0.6, thickness: 0.104 })),
      true,
    ),
    accent,
  );
  owned.geometries.push(finBand.geometry);
  group.add(finBand);

  // Wing struts.
  const struts = mergeGeometries(
    [-1, 1].flatMap((side) => [
      strut(new THREE.Vector3(side * 0.55, -0.32, -2.15), new THREE.Vector3(side * 2.7, 0.9 + 2.7 * dihedral, -2.2), 0.09, 0.22),
      strut(new THREE.Vector3(side * 0.55, -0.32, -2.3), new THREE.Vector3(side * 2.7, 0.9 + 2.7 * dihedral, -2.85), 0.07, 0.18),
    ]),
    false,
  )!;
  owned.geometries.push(struts);
  group.add(new THREE.Mesh(struts, wingPaint));

  // Floats: long, flat-bottomed, an upturned bow and a step; and their struts.
  const floatGeometry = loft([
    { z: 1.2, w: 0.05, h: 0.05, cy: -1.42, n: 2 },
    { z: 0.9, w: 0.2, h: 0.18, cy: -1.5, n: 2.2 },
    { z: 0.3, w: 0.3, h: 0.27, cy: -1.62, n: 2.6 },
    { z: -0.8, w: 0.31, h: 0.29, cy: -1.64, n: 2.8 },
    { z: -2.2, w: 0.31, h: 0.29, cy: -1.64, n: 2.8 },
    { z: -2.3, w: 0.3, h: 0.25, cy: -1.61, n: 2.6 },
    { z: -3.8, w: 0.22, h: 0.18, cy: -1.58, n: 2.4 },
    { z: -5.0, w: 0.08, h: 0.07, cy: -1.55, n: 2 },
  ], 20);
  const floats = mergeGeometries(
    [-1.25, 1.25].map((x) => floatGeometry.clone().translate(x, 0, 0)),
    false,
  )!;
  floatGeometry.dispose();
  owned.geometries.push(floats);
  group.add(new THREE.Mesh(floats, floatPaint));
  const floatStruts = mergeGeometries(
    [-1, 1].flatMap((side) => [
      strut(new THREE.Vector3(side * 0.45, -0.4, -0.9), new THREE.Vector3(side * 1.25, -1.36, -0.6), 0.06, 0.12),
      strut(new THREE.Vector3(side * 0.45, -0.4, -2.6), new THREE.Vector3(side * 1.25, -1.36, -2.4), 0.06, 0.12),
      strut(new THREE.Vector3(side * 0.2, -0.45, -0.9), new THREE.Vector3(side * 1.25, -1.36, -2.4), 0.04, 0.08),
    ]),
    false,
  )!;
  owned.geometries.push(floatStruts);
  group.add(new THREE.Mesh(floatStruts, metal));

  // Spinner and propeller.
  const spinner = new THREE.ConeGeometry(0.17, 0.42, 20);
  spinner.rotateX(Math.PI / 2);
  spinner.translate(0, 0.02, 0.26);
  owned.geometries.push(spinner);
  group.add(new THREE.Mesh(spinner, accent));
  const propeller = new THREE.Group();
  propeller.position.set(0, 0.02, 0.12);
  const bladeGeometry = new THREE.BoxGeometry(0.11, 0.95, 0.025);
  bladeGeometry.translate(0, 0.52, 0);
  const blades = mergeGeometries([bladeGeometry, bladeGeometry.clone().rotateZ(Math.PI)], false)!;
  bladeGeometry.dispose();
  owned.geometries.push(blades);
  propeller.add(new THREE.Mesh(blades, dark));
  group.add(propeller);
  const discMaterial = new THREE.MeshBasicMaterial({ color: 0x2a2d33, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  owned.materials.push(discMaterial);
  const blurDisc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 40), discMaterial);
  blurDisc.position.set(0, 0.02, 0.13);
  owned.geometries.push(blurDisc.geometry);
  group.add(blurDisc);

  // Navigation lights (brighter than white: the bloom makes them glow).
  const lightGeometry = new THREE.SphereGeometry(0.06, 8, 6);
  owned.geometries.push(lightGeometry);
  const lights = (
    [
      [-5.52, 0.93 + 5.5 * dihedral, -1.9, [4, 0.2, 0.15]],
      [5.52, 0.93 + 5.5 * dihedral, -1.9, [0.15, 4, 0.6]],
      [0, 0.54, -8.05, [3, 3, 3]],
      [0, 2.18, -7.6, [4, 0.3, 0.2]],
    ] as const
  ).map(([x, y, z, rgb]) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace) });
    owned.materials.push(material);
    const lamp = new THREE.Mesh(lightGeometry, material);
    lamp.position.set(x, y, z);
    group.add(lamp);
    return lamp;
  });

  group.traverse((object) => {
    if (object instanceof THREE.Mesh && object !== blurDisc) object.castShadow = true;
  });
  return { group, propeller, blurDisc, lights, towPoint: new THREE.Vector3(0, -0.2, -7.9) };
}

/** A twin-engine narrow-body airliner (silhouette detail for ten kilometres away). */
export function buildAirliner(owned: Owned): { group: THREE.Group; strobes: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] } {
  const group = new THREE.Group();
  group.name = "Airliner";
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f2f4, roughness: 0.35, metalness: 0.1 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.4, metalness: 0.3 });
  owned.materials.push(white, grey);
  const body = loft([
    { z: 19.5, w: 0.3, h: 0.3, cy: 0, n: 2 },
    { z: 18, w: 1.6, h: 1.7, cy: 0, n: 2 },
    { z: 14, w: 1.95, h: 2.0, cy: 0, n: 2 },
    { z: -10, w: 1.95, h: 2.0, cy: 0, n: 2 },
    { z: -15, w: 1.3, h: 1.5, cy: 0.4, n: 2 },
    { z: -18.5, w: 0.3, h: 0.4, cy: 1.2, n: 2 },
  ], 16);
  const sweep = Math.tan((25 * Math.PI) / 180);
  const wingGeometry = wing(
    [-17, -12, -6, -2, 0, 2, 6, 12, 17].map((x) => ({
      x,
      chord: 6.5 - Math.abs(x) * 0.27,
      lead: 2 - Math.abs(x) * sweep,
      y: -0.8 + Math.abs(x) * 0.06,
      thickness: 0.12,
    })),
  );
  const stabiliser = wing(
    [-6.5, 0, 6.5].map((x) => ({ x, chord: 3.6 - Math.abs(x) * 0.3, lead: -13.5 - Math.abs(x) * sweep * 1.1, y: 0.8, thickness: 0.1 })),
  );
  const fin = wing(
    [0, 3.5, 7].map((h) => ({ x: h, chord: 6 - h * 0.45, lead: -11.5 - h * 0.75, y: 1.4, thickness: 0.1 })),
    true,
  );
  body.deleteAttribute("uv");
  const engine = new THREE.CylinderGeometry(1.0, 0.9, 4.2, 14);
  engine.rotateX(Math.PI / 2);
  const engines = mergeGeometries([engine.clone().translate(-5.8, -1.6, 2.6), engine.clone().translate(5.8, -1.6, 2.6)], false)!;
  engine.dispose();
  const airframe = mergeGeometries([body, wingGeometry, stabiliser, fin], false)!;
  [body, wingGeometry, stabiliser, fin].forEach((geometry) => geometry.dispose());
  owned.geometries.push(airframe, engines);
  group.add(new THREE.Mesh(airframe, white), new THREE.Mesh(engines, grey));
  const strobeGeometry = new THREE.SphereGeometry(0.35, 6, 4);
  owned.geometries.push(strobeGeometry);
  const strobes = (
    [
      [-17.2, -0.3, -2.4],
      [17.2, -0.3, -2.4],
      [0, 2.1, -2],
    ] as const
  ).map(([x, y, z], index) => {
    const material = new THREE.MeshBasicMaterial({ color: index === 2 ? new THREE.Color(8, 0.4, 0.3) : new THREE.Color(9, 9, 9) });
    owned.materials.push(material);
    const strobe = new THREE.Mesh(strobeGeometry, material);
    strobe.position.set(x, y, z);
    group.add(strobe);
    return strobe;
  });
  return { group, strobes };
}
