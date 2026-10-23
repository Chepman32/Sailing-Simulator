// Parametric geometry helpers for the aircraft generator. Every surface gets
// texture coordinates laid out for painting liveries:
// - bodies of revolution: u runs tail -> nose along +Z, v = theta / 2PI where
//   theta = 0 is the top (+Y) and increases toward starboard (+X), so
//   v 0 -> 0.5 is the starboard side top-to-bottom and 0.5 -> 1 the port side
//   bottom-to-top;
// - lifting surfaces: u runs root -> tip, v = 0.5 * (1 - x) on the upper (or
//   starboard) skin and 0.5 + 0.5 * x on the lower (or port) skin, where x is
//   the physical chord fraction from the leading edge.

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export function smoothKeys(keys, t) {
  // Cubic Hermite interpolation over [t, ...values] keys sorted by t.
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

function flipWinding(geometry) {
  const indices = geometry.index.array;
  for (let index = 0; index < indices.length; index += 3) {
    const swap = indices[index + 1];
    indices[index + 1] = indices[index + 2];
    indices[index + 2] = swap;
  }
  geometry.index.needsUpdate = true;
}

export function orientOutward(geometry, referencePoint) {
  // Flip the winding when averaged vertex normals point toward the loft axis,
  // so every generated surface faces outward regardless of parameter order.
  geometry.computeVertexNormals();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const vertex = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();
  let score = 0;
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    vertexNormal.fromBufferAttribute(normal, index);
    score += vertexNormal.dot(vertex.sub(referencePoint(index)));
  }
  if (score < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  return geometry;
}

function cap(ring, outward, uv) {
  const center = ringCenter(ring);
  const positions = [center.x, center.y, center.z];
  ring.forEach((point) => positions.push(point.x, point.y, point.z));
  const indices = [];
  for (let index = 0; index < ring.length - 1; index += 1) indices.push(0, 1 + index, 2 + index);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((ring.length + 1) * 2).fill(0).map((_, i) => uv[i % 2]), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normal = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("normal"), 0);
  if (normal.dot(outward) < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/**
 * Builds a surface through rings of equal point count. Rings are open strips
 * (callers duplicate the seam point when a closed loop is needed) so texture
 * coordinates never wrap across a seam.
 */
export function loft(rings, uvs, { capStart = false, capEnd = false, capUv = [0.02, 0.02] } = {}) {
  const pointsPerRing = rings[0].length;
  const positions = [];
  const coordinates = [];
  rings.forEach((ring, ringIndex) =>
    ring.forEach((point, pointIndex) => {
      positions.push(point.x, point.y, point.z);
      coordinates.push(...uvs[ringIndex][pointIndex]);
    }),
  );
  const indices = [];
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    for (let pointIndex = 0; pointIndex < pointsPerRing - 1; pointIndex += 1) {
      const a = ringIndex * pointsPerRing + pointIndex;
      const b = a + 1;
      const c = b + pointsPerRing;
      const d = a + pointsPerRing;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(coordinates, 2));
  geometry.setIndex(indices);
  const centers = rings.map(ringCenter);
  orientOutward(geometry, (index) => centers[Math.floor(index / pointsPerRing)]);
  const parts = [geometry];
  if (capStart) parts.push(cap(rings[0], centers[0].clone().sub(centers[1]), capUv));
  if (capEnd) parts.push(cap(rings[rings.length - 1], centers[centers.length - 1].clone().sub(centers[centers.length - 2]), capUv));
  return parts.length === 1 ? geometry : mergeGeometries(parts.map((part) => part.toNonIndexed()), false);
}

export function superellipsePoint(theta, halfWidth, halfHeight, exponent) {
  // theta = 0 points up (+Y) and increases toward starboard (+X).
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  const power = 2 / exponent;
  return [halfWidth * Math.sign(sin) * Math.abs(sin) ** power, halfHeight * Math.sign(cos) * Math.abs(cos) ** power];
}

/** Polar angle on the starboard side whose point sits at a height fraction f in [-1, 1] of the half-height. */
export function thetaForHeightFraction(fraction, exponent) {
  const clamped = Math.max(-1, Math.min(1, fraction));
  const cosine = Math.sign(clamped) * Math.abs(clamped) ** (exponent / 2);
  return Math.acos(cosine);
}

export function sortKeys(keys) {
  return [...keys].sort((left, right) => left[0] - right[0]);
}

export function bodyOfRevolution(
  keys,
  { stations = 40, segments = 40, exponent = 2.4, thetaStart = 0, thetaEnd = Math.PI * 2, inflate = 0, zStart, zEnd, uRange } = {},
) {
  // keys: [z, halfWidth, halfHeight, centerY] in any z order.
  const sorted = sortKeys(keys);
  const first = zStart ?? sorted[0][0];
  const last = zEnd ?? sorted[sorted.length - 1][0];
  const [uMin, uMax] = uRange ?? [sorted[0][0], sorted[sorted.length - 1][0]];
  const full = thetaEnd - thetaStart >= Math.PI * 2 - 1e-6;
  const rings = [];
  const uvs = [];
  for (let station = 0; station <= stations; station += 1) {
    // Cosine spacing concentrates rings at the rounded nose and tail.
    const t = 0.5 - 0.5 * Math.cos((station / stations) * Math.PI);
    const z = THREE.MathUtils.lerp(first, last, t);
    const [halfWidth, halfHeight, centerY] = smoothKeys(sorted, z);
    const ring = [];
    const ringUv = [];
    for (let index = 0; index <= segments; index += 1) {
      const theta = thetaStart + ((thetaEnd - thetaStart) * index) / segments;
      const [x, y] = superellipsePoint(theta, Math.max(0.004, halfWidth + inflate), Math.max(0.004, halfHeight + inflate), exponent);
      ring.push(new THREE.Vector3(x, centerY + y, z));
      const wrapped = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      // The duplicated seam vertex of a full ring closes the texture at v = 1.
      const v = full && index === segments ? 1 : wrapped / (Math.PI * 2);
      ringUv.push([(z - uMin) / (uMax - uMin), v]);
    }
    rings.push(ring);
    uvs.push(ringUv);
  }
  const noseUv = [1, 0.25];
  const tailUv = [0, 0.25];
  const geometry = loft(rings, uvs, { capStart: full, capEnd: full, capUv: tailUv });
  if (full) {
    // Point the nose cap at the nose end of the texture instead of the tail.
    const uv = geometry.getAttribute("uv");
    const position = geometry.getAttribute("position");
    for (let index = 0; index < uv.count; index += 1) {
      if (uv.getX(index) === tailUv[0] && uv.getY(index) === tailUv[1] && position.getZ(index) > (first + last) / 2) {
        uv.setXY(index, noseUv[0], noseUv[1]);
      }
    }
  }
  return geometry;
}

export function airfoil(thickness, camber = 0.02, camberPosition = 0.4, count = 16) {
  // NACA four-digit section as an open loop from the upper trailing edge over
  // the leading edge to the lower trailing edge; each entry carries the
  // physical chord fraction and which skin it belongs to for texturing.
  const upper = [];
  const lower = [];
  for (let index = 0; index <= count; index += 1) {
    const x = 0.5 - 0.5 * Math.cos((index / count) * Math.PI);
    const yt = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc =
      camber === 0
        ? 0
        : x < camberPosition
          ? (camber / camberPosition ** 2) * (2 * camberPosition * x - x ** 2)
          : (camber / (1 - camberPosition) ** 2) * (1 - 2 * camberPosition + 2 * camberPosition * x - x ** 2);
    upper.push({ x, y: yc + yt, v: 0.5 * (1 - x) });
    lower.push({ x, y: yc - yt, v: 0.5 + 0.5 * x });
  }
  const loop = [];
  for (let index = upper.length - 1; index >= 0; index -= 1) loop.push(upper[index]);
  for (let index = 1; index < lower.length; index += 1) loop.push(lower[index]);
  return loop;
}

export function liftingSurface({
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
  roundTip = true,
}) {
  // One half of a wing or a vertical fin. Chord runs from the leading edge
  // toward -Z; span runs along +X (or +Y for a fin).
  const section = airfoil(thickness, camber);
  const rings = [];
  const uvs = [];
  for (let station = 0; station <= stations; station += 1) {
    const t = station / stations;
    const chord = THREE.MathUtils.lerp(rootChord, tipChord, t);
    const spanPosition = rootOffset + span * t;
    const leadingZ = leadingEdgeZ - Math.tan(sweep) * span * t;
    const lift = Math.tan(dihedral) * span * t;
    const tipRound = roundTip && station === stations ? 0.55 : 1;
    const ring = section.map(({ x, y }) => {
      const chordwise = leadingZ - (x * tipRound + (1 - tipRound) * 0.25) * chord;
      const normal = y * chord * (roundTip && station === stations ? 0.45 : 1);
      if (vertical) return new THREE.Vector3(normal, baseY + spanPosition, chordwise);
      return new THREE.Vector3(side * spanPosition, baseY + lift + normal, chordwise);
    });
    rings.push(ring);
    uvs.push(section.map(({ v }) => [t, v]));
  }
  return loft(rings, uvs, { capStart: true, capEnd: true, capUv: [0.995, 0.25] });
}

export function tube(start, end, radius, segments = 10, scaleY = 1) {
  const axis = end.clone().sub(start);
  const length = axis.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments, 1, false);
  geometry.scale(1, 1, scaleY);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
  const middle = start.clone().add(end).multiplyScalar(0.5);
  geometry.translate(middle.x, middle.y, middle.z);
  return geometry;
}

export function wheel(center, radius, width, segments = 24) {
  const geometry = new THREE.TorusGeometry(radius - width * 0.45, width * 0.48, 12, segments);
  geometry.rotateY(Math.PI / 2);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

export function disc(center, radius, thickness, axis = "x", segments = 18) {
  const geometry = new THREE.CylinderGeometry(radius, radius, thickness, segments);
  if (axis === "x") geometry.rotateZ(Math.PI / 2);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

export function lathe(profile, segments = 32) {
  // profile: [radius, z] pairs revolved around the Z axis; u follows the
  // profile, v runs around the circumference.
  const points = profile.map(([radius, z]) => new THREE.Vector2(Math.max(0.0001, radius), z));
  const geometry = new THREE.LatheGeometry(points, segments);
  // LatheGeometry revolves around +Y; rotating +90 degrees about X maps it to +Z.
  geometry.rotateX(Math.PI / 2);
  const axisPoint = new THREE.Vector3();
  const position = geometry.getAttribute("position");
  return orientOutward(geometry, (index) => axisPoint.set(0, 0, position.getZ(index)));
}

export function propellerBlades({ bladeCount = 2, radius, rootChord, tipChord, rootPitch, tipPitch, hubRadius }) {
  const section = airfoil(0.1, 0.03, 0.35, 8);
  const blades = [];
  for (let blade = 0; blade < bladeCount; blade += 1) {
    const rings = [];
    const uvs = [];
    const stations = 12;
    for (let station = 0; station <= stations; station += 1) {
      const t = station / stations;
      const r = THREE.MathUtils.lerp(hubRadius * 0.8, radius, t);
      // Paddle planform: widest near 35% radius, rounded at the tip.
      const planform = Math.sin(Math.min(1, t * 1.6 + 0.25) * Math.PI * 0.5) * (t > 0.85 ? Math.cos(((t - 0.85) / 0.15) * 1.1) : 1);
      const chord = THREE.MathUtils.lerp(rootChord, tipChord, t) * Math.max(0.35, planform);
      const pitch = THREE.MathUtils.lerp(rootPitch, tipPitch, t);
      rings.push(
        section.map(({ x, y }) => {
          const chordwise = (x - 0.3) * chord;
          const normal = y * chord;
          const px = chordwise * Math.cos(pitch) - normal * Math.sin(pitch);
          const pz = chordwise * Math.sin(pitch) + normal * Math.cos(pitch);
          return new THREE.Vector3(px, r, -pz);
        }),
      );
      uvs.push(section.map(({ v }) => [t, v]));
    }
    const geometry = loft(rings, uvs, { capStart: true, capEnd: true, capUv: [0.99, 0.5] });
    geometry.rotateZ((blade / bladeCount) * Math.PI * 2);
    blades.push(geometry.index ? geometry.toNonIndexed() : geometry);
  }
  return mergeGeometries(blades, false);
}

function prepare(geometry, uvOverride) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", source.getAttribute("position"));
  if (source.getAttribute("normal")) result.setAttribute("normal", source.getAttribute("normal"));
  else result.computeVertexNormals();
  const count = source.getAttribute("position").count;
  if (uvOverride) {
    // Small parts sample one texel of the atlas (e.g. a plain paint swatch).
    const uv = new Float32Array(count * 2);
    for (let index = 0; index < count; index += 1) uv.set(uvOverride, index * 2);
    result.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  } else if (source.getAttribute("uv")) {
    result.setAttribute("uv", source.getAttribute("uv"));
  } else {
    result.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  return result;
}

/**
 * Merges parts into one mesh. Each part may be a geometry or [geometry, uv]
 * to pin that part to a single texture coordinate. Identical
 * position/normal/uv vertices are welded so smooth skins export indexed.
 */
export function mesh(name, parts, material) {
  const prepared = parts.map((part) => (Array.isArray(part) ? prepare(part[0], part[1]) : prepare(part)));
  const geometry = mergeVertices(mergeGeometries(prepared, false), 1e-5);
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  return object;
}

export function marker(name, x, y, z) {
  const object = new THREE.Object3D();
  object.name = name;
  object.position.set(x, y, z);
  return object;
}

export function triangleCount(root) {
  let count = 0;
  root.traverse((object) => {
    if (object.isMesh) count += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
  });
  return Math.round(count);
}
