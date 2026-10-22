#!/usr/bin/env node
// Offline generator for the three original aircraft GLBs used by the aviation
// system. The models are authored here from parametric lofts (airfoil wings,
// superellipse fuselages, twisted propeller blades) and exported once with
// three.js GLTFExporter. The runtime never builds aircraft geometry; it loads
// the committed GLBs like every other model.
//
// Conventions shared by every exported model:
// - meters, +Y up, nose/forward along +Z, starboard along +X (simulator axes);
// - origin near the center of gravity;
// - named empties mark runtime attachment points (Propeller, NavPort,
//   NavStarboard, Beacon, TowHook, EngineExhaustPort/Starboard).
//
// Usage: node scripts/models/build-aircraft-models.mjs [output-directory]

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

if (typeof globalThis.FileReader === "undefined") {
  // GLTFExporter relies on the browser FileReader to concatenate binary chunks.
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }

    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onloadend?.();
      });
    }
  };
}

const OUTPUT_DIRECTORY = process.argv[2] ?? "public/models";
const LICENSE = "CC0-1.0";
const AUTHOR = "Sailing Simulator Pro contributors";
const SOURCE = "scripts/models/build-aircraft-models.mjs";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function smoothKeys(keys, t) {
  // Cubic Hermite interpolation over [t, ...values] keys with finite-difference
  // tangents; keys must be sorted by t.
  if (t <= keys[0][0]) return keys[0].slice(1);
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last.slice(1);
  let index = 0;
  while (keys[index + 1][0] < t) index += 1;
  const k0 = keys[Math.max(0, index - 1)];
  const k1 = keys[index];
  const k2 = keys[index + 1];
  const k3 = keys[Math.min(keys.length - 1, index + 2)];
  const span = k2[0] - k1[0];
  const u = (t - k1[0]) / span;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;
  return k1.slice(1).map((value, component) => {
    const m1 = ((k2[component + 1] - k0[component + 1]) / Math.max(1e-6, k2[0] - k0[0])) * span;
    const m2 = ((k3[component + 1] - k1[component + 1]) / Math.max(1e-6, k3[0] - k1[0])) * span;
    return h00 * value + h10 * m1 + h01 * k2[component + 1] + h11 * m2;
  });
}

function ringCenter(ring) {
  const center = new THREE.Vector3();
  ring.forEach((point) => center.add(point));
  return center.multiplyScalar(1 / ring.length);
}

function orientOutward(geometry, referencePoints) {
  // Flip triangle winding when the averaged vertex normals point toward the
  // loft axis. This keeps every generated surface front-facing outward without
  // hand-checking each loft's parameter direction.
  geometry.computeVertexNormals();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const vertex = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();
  let score = 0;
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    vertexNormal.fromBufferAttribute(normal, index);
    score += vertexNormal.dot(vertex.sub(referencePoints(index)));
  }
  if (score < 0) {
    const indices = geometry.index.array;
    for (let index = 0; index < indices.length; index += 3) {
      const swap = indices[index + 1];
      indices[index + 1] = indices[index + 2];
      indices[index + 2] = swap;
    }
    geometry.index.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  return geometry;
}

function loft(rings, { closed = true, capStart = false, capEnd = false } = {}) {
  const pointsPerRing = rings[0].length;
  const positions = [];
  rings.forEach((ring) => ring.forEach((point) => positions.push(point.x, point.y, point.z)));
  const indices = [];
  const segments = closed ? pointsPerRing : pointsPerRing - 1;
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    for (let pointIndex = 0; pointIndex < segments; pointIndex += 1) {
      const next = (pointIndex + 1) % pointsPerRing;
      const a = ringIndex * pointsPerRing + pointIndex;
      const b = ringIndex * pointsPerRing + next;
      const c = (ringIndex + 1) * pointsPerRing + next;
      const d = (ringIndex + 1) * pointsPerRing + pointIndex;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const centers = rings.map(ringCenter);
  orientOutward(geometry, (index) => centers[Math.floor(index / pointsPerRing)]);
  const parts = [geometry];
  if (capStart) parts.push(cap(rings[0], centers[0].clone().sub(centers[1])));
  if (capEnd) parts.push(cap(rings[rings.length - 1], centers[centers.length - 1].clone().sub(centers[centers.length - 2])));
  return parts.length === 1 ? geometry : mergeGeometries(parts.map((part) => part.toNonIndexed()), false);
}

function cap(ring, outward) {
  const center = ringCenter(ring);
  const positions = [center.x, center.y, center.z];
  ring.forEach((point) => positions.push(point.x, point.y, point.z));
  const indices = [];
  for (let index = 0; index < ring.length; index += 1) {
    indices.push(0, 1 + index, 1 + ((index + 1) % ring.length));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normal = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("normal"), 0);
  if (normal.dot(outward) < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      const swap = indices[index + 1];
      indices[index + 1] = indices[index + 2];
      indices[index + 2] = swap;
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  return geometry;
}

function superellipsePoint(theta, halfWidth, halfHeight, exponent) {
  // theta = 0 points up (+Y) and increases toward starboard (+X).
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  const power = 2 / exponent;
  return [
    halfWidth * Math.sign(sin) * Math.abs(sin) ** power,
    halfHeight * Math.sign(cos) * Math.abs(cos) ** power,
  ];
}

function bodyOfRevolution(keys, { stations = 40, segments = 40, exponent = 2.4, thetaStart = 0, thetaEnd = Math.PI * 2, inflate = 0, zStart, zEnd } = {}) {
  // keys: [z, halfWidth, halfHeight, centerY], listed in any z order.
  keys = [...keys].sort((left, right) => left[0] - right[0]);
  const first = zStart ?? keys[0][0];
  const last = zEnd ?? keys[keys.length - 1][0];
  const full = thetaEnd - thetaStart >= Math.PI * 2 - 1e-6;
  const ringPoints = full ? segments : segments + 1;
  const rings = [];
  for (let station = 0; station <= stations; station += 1) {
    // Cosine spacing concentrates rings at the rounded nose and tail.
    const t = 0.5 - 0.5 * Math.cos((station / stations) * Math.PI);
    const z = THREE.MathUtils.lerp(first, last, t);
    const [halfWidth, halfHeight, centerY] = smoothKeys(keys, z);
    const ring = [];
    for (let index = 0; index < ringPoints; index += 1) {
      const theta = thetaStart + ((thetaEnd - thetaStart) * index) / segments;
      const [x, y] = superellipsePoint(theta, Math.max(0.004, halfWidth + inflate), Math.max(0.004, halfHeight + inflate), exponent);
      ring.push(new THREE.Vector3(x, centerY + y, z));
    }
    rings.push(ring);
  }
  return loft(rings, { closed: full, capStart: full, capEnd: full });
}

function airfoil(thickness, camber = 0.02, camberPosition = 0.4, count = 16) {
  // NACA four-digit section; returns a closed loop of [chordwise, normal]
  // pairs starting at the trailing edge, upper surface first.
  const upper = [];
  const lower = [];
  for (let index = 0; index <= count; index += 1) {
    const x = 0.5 - 0.5 * Math.cos((index / count) * Math.PI);
    const yt =
      5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc =
      camber === 0
        ? 0
        : x < camberPosition
          ? (camber / camberPosition ** 2) * (2 * camberPosition * x - x ** 2)
          : (camber / (1 - camberPosition) ** 2) * (1 - 2 * camberPosition + 2 * camberPosition * x - x ** 2);
    upper.push([x, yc + yt]);
    lower.push([x, yc - yt]);
  }
  const loop = [];
  for (let index = upper.length - 1; index >= 0; index -= 1) loop.push(upper[index]);
  for (let index = 1; index < lower.length - 1; index += 1) loop.push(lower[index]);
  return loop;
}

function liftingSurface({
  rootOffset,
  span,
  rootChord,
  tipChord,
  leadingEdgeZ,
  sweep = 0,
  dihedral = 0,
  baseY = 0,
  thickness = 0.12,
  camber = 0.02,
  stations = 10,
  side = 1,
  vertical = false,
}) {
  // Builds one half of a wing or a vertical fin. Chord runs from the leading
  // edge toward -Z; span runs along +X (or +Y for a vertical fin).
  const section = airfoil(thickness, camber);
  const rings = [];
  for (let station = 0; station <= stations; station += 1) {
    const t = station / stations;
    const chord = THREE.MathUtils.lerp(rootChord, tipChord, t);
    const spanPosition = rootOffset + span * t;
    const leadingZ = leadingEdgeZ - Math.tan(sweep) * span * t;
    const lift = Math.tan(dihedral) * span * t;
    // Rounded wing tip: shrink the last station toward the quarter chord.
    const tipRound = station === stations ? 0.55 : 1;
    const ring = section.map(([x, y]) => {
      const chordwise = leadingZ - (x * tipRound + (1 - tipRound) * 0.25) * chord;
      const normal = y * chord * (station === stations ? 0.45 : 1);
      if (vertical) return new THREE.Vector3(normal, baseY + spanPosition, chordwise);
      return new THREE.Vector3(side * spanPosition, baseY + lift + normal, chordwise);
    });
    rings.push(ring);
  }
  return loft(rings, { capStart: true, capEnd: true });
}

function tube(start, end, radius, segments = 10, scaleY = 1) {
  // Streamlined strut or cylinder between two points.
  const axis = end.clone().sub(start);
  const length = axis.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments, 1, false);
  geometry.scale(1, 1, scaleY);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  geometry.applyQuaternion(quaternion);
  const middle = start.clone().add(end).multiplyScalar(0.5);
  geometry.translate(middle.x, middle.y, middle.z);
  return geometry;
}

function wheel(center, radius, width, segments = 22) {
  const geometry = new THREE.TorusGeometry(radius - width * 0.45, width * 0.48, 10, segments);
  geometry.rotateY(Math.PI / 2);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

function hubCap(center, radius, width) {
  const geometry = new THREE.CylinderGeometry(radius, radius, width, 16);
  geometry.rotateZ(Math.PI / 2);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

function lathe(profile, segments = 28) {
  // profile: [radius, z] pairs; revolves around the Z axis.
  const points = profile.map(([radius, z]) => new THREE.Vector2(Math.max(0.0001, radius), z));
  const geometry = new THREE.LatheGeometry(points, segments);
  // LatheGeometry revolves around +Y; rotating +90 degrees about X maps it to +Z.
  geometry.rotateX(Math.PI / 2);
  const axisPoint = new THREE.Vector3();
  const position = geometry.getAttribute("position");
  return orientOutward(geometry, (index) => axisPoint.set(0, 0, position.getZ(index)));
}

function propellerBlades({ bladeCount = 2, radius, rootChord, tipChord, rootPitch, tipPitch, hubRadius }) {
  const section = airfoil(0.1, 0.03, 0.35, 8);
  const blades = [];
  for (let blade = 0; blade < bladeCount; blade += 1) {
    const rings = [];
    const stations = 9;
    for (let station = 0; station <= stations; station += 1) {
      const t = station / stations;
      const r = THREE.MathUtils.lerp(hubRadius * 0.8, radius, t);
      // Paddle planform: widest near 35% radius, rounded at the tip.
      const planform = Math.sin(Math.min(1, t * 1.6 + 0.25) * Math.PI * 0.5) * (t > 0.85 ? Math.cos(((t - 0.85) / 0.15) * 1.1) : 1);
      const chord = THREE.MathUtils.lerp(rootChord, tipChord, t) * Math.max(0.35, planform);
      const pitch = THREE.MathUtils.lerp(rootPitch, tipPitch, t);
      rings.push(
        section.map(([x, y]) => {
          const chordwise = (x - 0.3) * chord;
          const normal = y * chord;
          // Blade lies along +Y; rotate the section around the blade axis.
          const px = chordwise * Math.cos(pitch) - normal * Math.sin(pitch);
          const pz = chordwise * Math.sin(pitch) + normal * Math.cos(pitch);
          return new THREE.Vector3(px, r, -pz);
        }),
      );
    }
    const geometry = loft(rings, { capStart: true, capEnd: true });
    geometry.rotateZ((blade / bladeCount) * Math.PI * 2);
    blades.push(geometry.index ? geometry.toNonIndexed() : geometry);
  }
  return mergeGeometries(blades, false);
}

function nonIndexed(geometry) {
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

function cleanGeometry(geometry) {
  // GLTFExporter keeps only position/normal here; generated UVs are unused.
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", geometry.getAttribute("position"));
  if (geometry.getAttribute("normal")) result.setAttribute("normal", geometry.getAttribute("normal"));
  else result.computeVertexNormals();
  return result;
}

function mergeParts(parts) {
  // Weld identical position+normal pairs so smooth surfaces export indexed
  // while hard edges (caps, trailing edges) keep their split normals.
  return mergeVertices(mergeGeometries(parts.map((part) => cleanGeometry(nonIndexed(part))), false), 1e-5);
}

function mesh(name, parts, material) {
  const object = new THREE.Mesh(mergeParts(parts), material);
  object.name = name;
  return object;
}

function marker(name, x, y, z) {
  const object = new THREE.Object3D();
  object.name = name;
  object.position.set(x, y, z);
  return object;
}

function standard(name, color, roughness, metalness) {
  const material = new THREE.MeshStandardMaterial({ name, color, roughness, metalness });
  return material;
}

// ---------------------------------------------------------------------------
// Light aircraft (tourist seaplane and banner-tow taildragger)
// ---------------------------------------------------------------------------

function buildLightAircraft(variant) {
  const seaplane = variant === "seaplane";
  const root = new THREE.Group();
  root.name = seaplane ? "Tourist_Seaplane" : "Banner_Tow_Plane";

  const paint = standard(seaplane ? "Paint_White" : "Paint_Cub_Yellow", seaplane ? 0xf4f6f4 : 0xf6c21c, 0.34, 0.08);
  const livery = standard(seaplane ? "Livery_Turquoise" : "Livery_Black", seaplane ? 0x0aa6b4 : 0x151515, 0.32, 0.1);
  const accent = standard(seaplane ? "Livery_Coral" : "Livery_Red", seaplane ? 0xff6a4d : 0xc8231d, 0.35, 0.08);
  const glass = standard("Cabin_Glass", 0x1d3446, 0.06, 0.55);
  const metal = standard("Propeller_Metal", 0x2a2d31, 0.38, 0.82);
  const strutMetal = standard("Strut_Aluminium", 0xb7bcc2, 0.3, 0.75);
  const rubber = standard("Tire_Rubber", 0x1a1a1a, 0.88, 0);

  const length = seaplane ? 1 : 0.82;
  const fuselageKeys = [
    [4.08 * length, 0.34, 0.36, 0.06],
    [3.7 * length, 0.5, 0.52, 0.04],
    [2.7 * length, 0.6, 0.66, 0.08],
    [1.9 * length, 0.62, 0.78, 0.18],
    [0.8 * length, 0.62, 0.8, 0.2],
    [-0.6 * length, 0.57, 0.71, 0.17],
    [-1.9 * length, 0.4, 0.5, 0.24],
    [-3.3 * length, 0.2, 0.3, 0.4],
    [-4.45 * length, 0.07, 0.19, 0.5],
    [-4.62 * length, 0.03, 0.12, 0.52],
  ];
  const tailZ = -4.62 * length;
  const noseZ = 4.08 * length;
  const fuselage = bodyOfRevolution(fuselageKeys, { stations: 44, segments: 44, exponent: 2.6 });

  // Livery band along the waist and a cheat line on both sides.
  const band = [
    bodyOfRevolution(fuselageKeys, { stations: 34, segments: 6, exponent: 2.6, thetaStart: Math.PI * 0.6, thetaEnd: Math.PI * 0.68, inflate: 0.006, zStart: tailZ + 0.2, zEnd: noseZ - 0.35 }),
    bodyOfRevolution(fuselageKeys, { stations: 34, segments: 6, exponent: 2.6, thetaStart: -Math.PI * 0.68, thetaEnd: -Math.PI * 0.6, inflate: 0.006, zStart: tailZ + 0.2, zEnd: noseZ - 0.35 }),
  ];
  const accentBand = [
    bodyOfRevolution(fuselageKeys, { stations: 24, segments: 3, exponent: 2.6, thetaStart: Math.PI * 0.69, thetaEnd: Math.PI * 0.72, inflate: 0.006, zStart: tailZ + 0.6, zEnd: noseZ - 0.6 }),
    bodyOfRevolution(fuselageKeys, { stations: 24, segments: 3, exponent: 2.6, thetaStart: -Math.PI * 0.72, thetaEnd: -Math.PI * 0.69, inflate: 0.006, zStart: tailZ + 0.6, zEnd: noseZ - 0.6 }),
  ];
  // Glazing: windshield, cabin side windows, and a skylight under the wing.
  const glazing = [
    bodyOfRevolution(fuselageKeys, { stations: 10, segments: 16, exponent: 2.6, thetaStart: -Math.PI * 0.38, thetaEnd: Math.PI * 0.38, inflate: 0.008, zStart: 1.75 * length, zEnd: 2.45 * length }),
    bodyOfRevolution(fuselageKeys, { stations: 14, segments: 6, exponent: 2.6, thetaStart: Math.PI * 0.3, thetaEnd: Math.PI * 0.5, inflate: 0.008, zStart: (seaplane ? -0.9 : -0.2) * length, zEnd: 1.65 * length }),
    bodyOfRevolution(fuselageKeys, { stations: 14, segments: 6, exponent: 2.6, thetaStart: -Math.PI * 0.5, thetaEnd: -Math.PI * 0.3, inflate: 0.008, zStart: (seaplane ? -0.9 : -0.2) * length, zEnd: 1.65 * length }),
  ];

  const wingY = 0.97;
  const wingSpan = seaplane ? 5.5 : 5.3;
  const wingChord = seaplane ? 1.62 : 1.6;
  const wingLeadingZ = 1.85 * length;
  const wings = [1, -1].map((side) =>
    liftingSurface({
      rootOffset: 0,
      span: wingSpan,
      rootChord: wingChord,
      tipChord: seaplane ? 1.18 : wingChord * 0.98,
      leadingEdgeZ: wingLeadingZ,
      sweep: seaplane ? 0.02 : 0,
      dihedral: THREE.MathUtils.degToRad(1.7),
      baseY: wingY,
      thickness: 0.13,
      stations: 14,
      side,
    }),
  );
  // Wing tips and an outboard livery panel.
  const wingTipPaint = [1, -1].map((side) =>
    liftingSurface({
      rootOffset: wingSpan * 0.82,
      span: wingSpan * 0.185,
      rootChord: THREE.MathUtils.lerp(wingChord, seaplane ? 1.18 : wingChord * 0.98, 0.82) + 0.01,
      tipChord: (seaplane ? 1.18 : wingChord * 0.98) + 0.01,
      leadingEdgeZ: wingLeadingZ - Math.tan(seaplane ? 0.02 : 0) * wingSpan * 0.82 + 0.005,
      sweep: seaplane ? 0.02 : 0,
      dihedral: THREE.MathUtils.degToRad(1.7),
      baseY: wingY + Math.tan(THREE.MathUtils.degToRad(1.7)) * wingSpan * 0.82,
      thickness: 0.135,
      stations: 3,
      side,
    }),
  );

  const stabilizers = [1, -1].map((side) =>
    liftingSurface({
      rootOffset: 0,
      span: seaplane ? 1.75 : 1.55,
      rootChord: 1.05,
      tipChord: 0.68,
      leadingEdgeZ: tailZ + 1.15,
      sweep: 0.12,
      baseY: 0.47,
      thickness: 0.09,
      camber: 0,
      stations: 6,
      side,
    }),
  );
  const fin = liftingSurface({
    rootOffset: 0,
    span: seaplane ? 1.55 : 1.3,
    rootChord: 1.45,
    tipChord: 0.72,
    leadingEdgeZ: tailZ + 1.55,
    sweep: 0.62,
    baseY: 0.55,
    thickness: 0.1,
    camber: 0,
    stations: 7,
    vertical: true,
  });
  const dorsal = liftingSurface({
    rootOffset: 0,
    span: 0.35,
    rootChord: 1.2,
    tipChord: 0.25,
    leadingEdgeZ: tailZ + 2.5,
    sweep: 1.15,
    baseY: 0.5,
    thickness: 0.08,
    camber: 0,
    stations: 3,
    vertical: true,
  });

  // Wing struts from the lower fuselage to ~45% semi-span.
  const struts = [];
  [1, -1].forEach((side) => {
    struts.push(tube(new THREE.Vector3(side * 0.52, -0.38, 1.1 * length), new THREE.Vector3(side * 2.55, wingY + 0.02, 1.32 * length), 0.045, 8, 2.2));
    struts.push(tube(new THREE.Vector3(side * 0.52, -0.38, 0.95 * length), new THREE.Vector3(side * 2.45, wingY + 0.02, 0.62 * length), 0.04, 8, 2.2));
  });

  const cowlFlaps = bodyOfRevolution(fuselageKeys, {
    stations: 4,
    segments: 24,
    exponent: 2.6,
    inflate: 0.012,
    zStart: 2.62 * length,
    zEnd: 2.78 * length,
  });
  const exhaust = [1, -1].map((side) => tube(new THREE.Vector3(side * 0.28, -0.42, 2.9 * length), new THREE.Vector3(side * 0.34, -0.52, 2.45 * length), 0.045, 10));

  const landingGear = [];
  const tires = [];
  const floats = [];
  if (seaplane) {
    // Twin amphibious floats with a stepped hull line and spreader struts.
    [1, -1].forEach((side) => {
      const x = side * 1.32;
      const floatKeys = [
        [3.75, 0.05, 0.08, -1.48],
        [3.3, 0.26, 0.22, -1.52],
        [2.2, 0.36, 0.3, -1.6],
        [0.3, 0.38, 0.32, -1.62],
        [-0.6, 0.36, 0.3, -1.6],
        [-2.2, 0.24, 0.22, -1.56],
        [-3.0, 0.06, 0.1, -1.54],
      ];
      const pontoon = bodyOfRevolution(floatKeys, { stations: 30, segments: 22, exponent: 2.2 });
      pontoon.translate(x, 0, 0);
      floats.push(pontoon);
      const keel = bodyOfRevolution(floatKeys, { stations: 18, segments: 4, exponent: 2.2, thetaStart: Math.PI * 0.94, thetaEnd: Math.PI * 1.06, inflate: 0.006, zStart: -2.6, zEnd: 3.4 });
      keel.translate(x, 0, 0);
      landingGear.push(keel);
      struts.push(tube(new THREE.Vector3(x, -1.32, 1.85), new THREE.Vector3(side * 0.45, -0.42, 1.95), 0.045, 8, 2));
      struts.push(tube(new THREE.Vector3(x, -1.32, 0.15), new THREE.Vector3(side * 0.45, -0.42, 0.35), 0.045, 8, 2));
      struts.push(tube(new THREE.Vector3(x, -1.32, 1.85), new THREE.Vector3(side * 0.45, -0.42, 0.35), 0.03, 6, 1.5));
    });
    struts.push(tube(new THREE.Vector3(-1.32, -1.34, 1.2), new THREE.Vector3(1.32, -1.34, 1.2), 0.035, 8, 1.8));
    struts.push(tube(new THREE.Vector3(-1.32, -1.34, -0.1), new THREE.Vector3(1.32, -1.34, -0.1), 0.035, 8, 1.8));
  } else {
    // Taildragger gear with oversized bush tires and a small tailwheel.
    [1, -1].forEach((side) => {
      const axle = new THREE.Vector3(side * 0.95, -1.18, 1.85 * length);
      struts.push(tube(new THREE.Vector3(side * 0.35, -0.5, 2.2 * length), axle, 0.035, 8));
      struts.push(tube(new THREE.Vector3(side * 0.35, -0.5, 1.25 * length), axle, 0.035, 8));
      struts.push(tube(new THREE.Vector3(side * 0.12, -0.62, 1.8 * length), axle.clone().setX(side * 0.82), 0.03, 8));
      tires.push(wheel(axle, 0.33, 0.24));
      landingGear.push(hubCap(axle, 0.12, 0.26));
    });
    const tailWheel = new THREE.Vector3(0, 0.12, tailZ + 0.35);
    struts.push(tube(new THREE.Vector3(0, 0.36, tailZ + 0.6), tailWheel, 0.025, 6));
    tires.push(wheel(tailWheel, 0.09, 0.06, 14));
  }

  root.add(mesh("Fuselage", [fuselage, cowlFlaps], paint));
  root.add(mesh("Livery", [...band, fin], livery));
  root.add(mesh("Livery_Accent", [...accentBand, ...wingTipPaint, dorsal], accent));
  root.add(mesh("Cabin_Glazing", glazing, glass));
  root.add(mesh("Wings", [...wings, ...stabilizers], paint));
  root.add(mesh("Struts", [...struts, ...exhaust], strutMetal));
  if (floats.length > 0) root.add(mesh("Floats", floats, paint));
  if (landingGear.length > 0) root.add(mesh("Gear_Details", landingGear, seaplane ? livery : strutMetal));
  if (tires.length > 0) root.add(mesh("Tires", tires, rubber));

  // The propeller is its own node so the runtime can spin it about +Z.
  const propeller = new THREE.Group();
  propeller.name = "Propeller";
  propeller.position.set(0, 0.06, noseZ + 0.05);
  const spinner = lathe([
    [0.0, 0.52],
    [0.07, 0.48],
    [0.15, 0.36],
    [0.2, 0.18],
    [0.21, 0.0],
    [0.0, 0.0],
  ]);
  const blades = propellerBlades({
    radius: seaplane ? 1.0 : 0.95,
    rootChord: 0.2,
    tipChord: 0.11,
    rootPitch: 0.95,
    tipPitch: 0.32,
    hubRadius: 0.16,
  });
  blades.translate(0, 0, 0.16);
  const spinnerMesh = mesh("Propeller_Spinner", [spinner], accent);
  const bladeMesh = mesh("Propeller_Blades", [blades], metal);
  propeller.add(spinnerMesh, bladeMesh);
  root.add(propeller);

  const tipY = wingY + Math.tan(THREE.MathUtils.degToRad(1.7)) * wingSpan;
  root.add(marker("NavPort", -wingSpan - 0.02, tipY, wingLeadingZ - 0.5));
  root.add(marker("NavStarboard", wingSpan + 0.02, tipY, wingLeadingZ - 0.5));
  root.add(marker("Beacon", 0, 0.55 + (seaplane ? 1.55 : 1.3) + 0.05, tailZ + 0.9));
  root.add(marker("TowHook", 0, 0.22, tailZ - 0.05));
  return root;
}

// ---------------------------------------------------------------------------
// Narrow-body airliner (seen at altitude while laying contrails)
// ---------------------------------------------------------------------------

function buildAirliner() {
  const root = new THREE.Group();
  root.name = "Narrowbody_Airliner";
  const paint = standard("Paint_White", 0xf2f4f6, 0.3, 0.12);
  const belly = standard("Belly_Grey", 0xa9b1ba, 0.4, 0.2);
  const livery = standard("Livery_Ocean_Blue", 0x0b4f9c, 0.32, 0.1);
  const accent = standard("Livery_Sunset", 0xffa21f, 0.34, 0.08);
  const glass = standard("Cockpit_Glass", 0x111a24, 0.05, 0.6);
  const metal = standard("Engine_Metal", 0x6c737b, 0.36, 0.85);
  const dark = standard("Engine_Intake", 0x15181c, 0.6, 0.4);

  const fuselageKeys = [
    [18.9, 0.12, 0.12, -0.15],
    [18.2, 1.05, 1.1, -0.18],
    [16.8, 1.72, 1.82, 0],
    [15.0, 1.98, 2.08, 0.05],
    [12.0, 2.0, 2.1, 0.05],
    [-8.0, 2.0, 2.1, 0.05],
    [-12.0, 1.72, 1.78, 0.3],
    [-16.0, 0.95, 1.05, 0.9],
    [-18.6, 0.28, 0.4, 1.35],
    [-18.9, 0.12, 0.2, 1.42],
  ];
  const fuselage = bodyOfRevolution(fuselageKeys, { stations: 52, segments: 40, exponent: 2.05 });
  const bellyPanel = bodyOfRevolution(fuselageKeys, { stations: 24, segments: 14, exponent: 2.05, thetaStart: Math.PI * 0.74, thetaEnd: Math.PI * 1.26, inflate: 0.02, zStart: -10.5, zEnd: 15.5 });
  const cheatLine = [Math.PI, -Math.PI].map((sign) =>
    bodyOfRevolution(fuselageKeys, {
      stations: 30,
      segments: 3,
      exponent: 2.05,
      thetaStart: sign > 0 ? Math.PI * 0.6 : -Math.PI * 0.64,
      thetaEnd: sign > 0 ? Math.PI * 0.64 : -Math.PI * 0.6,
      inflate: 0.02,
      zStart: -15.5,
      zEnd: 16.6,
    }),
  );
  const windowBand = [Math.PI, -Math.PI].map((sign) =>
    bodyOfRevolution(fuselageKeys, {
      stations: 24,
      segments: 2,
      exponent: 2.05,
      thetaStart: sign > 0 ? Math.PI * 0.4 : -Math.PI * 0.43,
      thetaEnd: sign > 0 ? Math.PI * 0.43 : -Math.PI * 0.4,
      inflate: 0.02,
      zStart: -12.5,
      zEnd: 14.2,
    }),
  );
  const cockpit = bodyOfRevolution(fuselageKeys, { stations: 6, segments: 12, exponent: 2.05, thetaStart: -Math.PI * 0.36, thetaEnd: Math.PI * 0.36, inflate: 0.02, zStart: 16.5, zEnd: 17.6 });

  const sweep = THREE.MathUtils.degToRad(25);
  const wings = [1, -1].map((side) =>
    liftingSurface({
      rootOffset: 1.6,
      span: 15.6,
      rootChord: 6.4,
      tipChord: 1.6,
      leadingEdgeZ: 4.6,
      sweep,
      dihedral: THREE.MathUtils.degToRad(5),
      baseY: -1.15,
      thickness: 0.12,
      stations: 14,
      side,
    }),
  );
  const winglets = [1, -1].map((side) => {
    const geometry = liftingSurface({
      rootOffset: 0,
      span: 2.3,
      rootChord: 1.6,
      tipChord: 0.6,
      leadingEdgeZ: 4.6 - Math.tan(sweep) * 15.6,
      sweep: 0.75,
      baseY: -1.15 + Math.tan(THREE.MathUtils.degToRad(5)) * 15.6,
      thickness: 0.09,
      camber: 0,
      stations: 4,
      vertical: true,
    });
    geometry.translate(side * 17.2, 0, 0);
    return geometry;
  });
  const fairing = bodyOfRevolution(
    [
      [6.5, 0.3, 0.3, -1.7],
      [4.0, 1.9, 0.9, -1.55],
      [-3.5, 1.9, 0.9, -1.55],
      [-6.5, 0.3, 0.3, -1.5],
    ],
    { stations: 16, segments: 20, exponent: 2.2 },
  );
  const stabilizers = [1, -1].map((side) =>
    liftingSurface({
      rootOffset: 0.5,
      span: 6.0,
      rootChord: 3.7,
      tipChord: 1.3,
      leadingEdgeZ: -13.6,
      sweep: THREE.MathUtils.degToRad(30),
      dihedral: THREE.MathUtils.degToRad(6),
      baseY: 0.9,
      thickness: 0.1,
      camber: 0,
      stations: 6,
      side,
    }),
  );
  const fin = liftingSurface({
    rootOffset: 1.4,
    span: 5.6,
    rootChord: 5.4,
    tipChord: 1.8,
    leadingEdgeZ: -11.8,
    sweep: THREE.MathUtils.degToRad(38),
    baseY: 0,
    thickness: 0.1,
    camber: 0,
    stations: 7,
    vertical: true,
  });

  const nacelles = [];
  const intakes = [];
  const pylons = [];
  const exhaustCones = [];
  [1, -1].forEach((side) => {
    const x = side * 5.8;
    const nacelle = lathe([
      [0.95, 3.0],
      [1.1, 2.6],
      [1.12, 1.5],
      [1.0, -0.6],
      [0.72, -1.4],
    ]);
    nacelle.translate(x, -2.25, 4.7);
    nacelles.push(nacelle);
    const intake = lathe([
      [0.0, 2.8],
      [0.92, 2.8],
      [0.92, 2.95],
    ]);
    intake.translate(x, -2.25, 4.7);
    intakes.push(intake);
    const cone = lathe([
      [0.6, -1.3],
      [0.42, -2.0],
      [0.05, -2.45],
    ]);
    cone.translate(x, -2.25, 4.7);
    exhaustCones.push(cone);
    pylons.push(
      liftingSurface({
        rootOffset: -2.0,
        span: 1.05,
        rootChord: 4.2,
        tipChord: 3.6,
        leadingEdgeZ: 6.5,
        sweep: -0.35,
        baseY: 0,
        thickness: 0.14,
        camber: 0,
        stations: 2,
        vertical: true,
      }).translate(x, 0, 0),
    );
  });

  root.add(mesh("Fuselage", [fuselage, fairing], paint));
  root.add(mesh("Belly", [bellyPanel], belly));
  root.add(mesh("Livery", [...cheatLine, fin], livery));
  root.add(mesh("Livery_Accent", [...winglets], accent));
  root.add(mesh("Window_Band", [...windowBand, cockpit], glass));
  root.add(mesh("Wings", [...wings, ...stabilizers, ...pylons], paint));
  root.add(mesh("Engine_Nacelles", nacelles, paint));
  root.add(mesh("Engine_Intakes", intakes, dark));
  root.add(mesh("Engine_Exhaust", exhaustCones, metal));

  const tipX = 1.6 + 15.6;
  const tipY = -1.15 + Math.tan(THREE.MathUtils.degToRad(5)) * 15.6;
  const tipZ = 4.6 - Math.tan(sweep) * 15.6 - 0.8;
  root.add(marker("NavPort", -tipX, tipY, tipZ));
  root.add(marker("NavStarboard", tipX, tipY, tipZ));
  root.add(marker("Beacon", 0, 2.2, -2));
  root.add(marker("EngineExhaustPort", -5.8, -2.25, 2.2));
  root.add(marker("EngineExhaustStarboard", 5.8, -2.25, 2.2));
  return root;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function triangleCount(root) {
  let count = 0;
  root.traverse((object) => {
    if (object.isMesh) count += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
  });
  return count;
}

function withAssetExtras(glb, extras) {
  // GLTFExporter writes scene extras but not asset extras; patch the JSON chunk
  // so license metadata travels with the binary, like the other models.
  const data = Buffer.from(glb);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
  json.asset = { ...json.asset, extras };
  let jsonText = JSON.stringify(json);
  while (Buffer.byteLength(jsonText) % 4 !== 0) jsonText += " ";
  const jsonChunk = Buffer.from(jsonText, "utf8");
  const binaryChunk = data.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + binaryChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, jsonChunk, binaryChunk]);
}

async function exportModel(root, fileName, title) {
  const scene = new THREE.Scene();
  scene.add(root);
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
  const output = withAssetExtras(glb, {
    title,
    author: AUTHOR,
    license: LICENSE,
    source: SOURCE,
  });
  writeFileSync(join(OUTPUT_DIRECTORY, fileName), output);
  console.log(`${fileName}: ${output.byteLength} bytes, ${Math.round(triangleCount(root))} triangles`);
}

await exportModel(buildLightAircraft("seaplane"), "tourist-seaplane.glb", "Tourist floatplane");
await exportModel(buildLightAircraft("banner"), "banner-tow-plane.glb", "Banner-tow bush plane");
await exportModel(buildAirliner(), "narrowbody-airliner.glb", "Narrow-body airliner");
