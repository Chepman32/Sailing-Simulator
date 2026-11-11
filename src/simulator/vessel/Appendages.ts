import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Underwater appendages the source model lacks: a saildrive leg with a
 * three-bladed folding-style propeller and a balanced spade rudder for each
 * hull. They are built once at load time from a few hundred triangles.
 *
 * Conventions match the vessel: +Z bow, +Y up, +X starboard. The propeller
 * shaft runs along Z; the rudder stock is vertical.
 */

export const PROPELLER_DIAMETER = 0.4;
export const PROPELLER_BLADES = 3;
export const PROPELLER_PITCH_ANGLE = 0.42;
export const RUDDER_CHORD = 0.34;
export const RUDDER_SPAN = 0.62;

/** Symmetric NACA 00xx half-thickness at a fraction of the chord. */
export function nacaHalfThickness(fraction: number, thickness: number): number {
  const x = THREE.MathUtils.clamp(fraction, 0, 1);
  return 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

function foilShape(chord: number, thickness: number, leadingEdge: number): THREE.Shape {
  const shape = new THREE.Shape();
  const steps = 14;
  // Shape x runs along the chord (bow positive), y across it.
  for (let step = 0; step <= steps; step += 1) {
    const fraction = 1 - step / steps;
    const x = leadingEdge - fraction * chord;
    const y = nacaHalfThickness(fraction, thickness) * chord;
    if (step === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    shape.lineTo(leadingEdge - fraction * chord, -nacaHalfThickness(fraction, thickness) * chord);
  }
  return shape;
}

/** A twisted, rounded propeller blade lying along +Y from the hub. */
function createBlade(hubRadius: number, tipRadius: number): THREE.BufferGeometry {
  const outline = new THREE.Shape();
  const length = tipRadius - hubRadius;
  outline.moveTo(-0.025, 0);
  outline.bezierCurveTo(-0.07, length * 0.35, -0.065, length * 0.85, 0, length);
  outline.bezierCurveTo(0.06, length * 0.85, 0.055, length * 0.3, 0.025, 0);
  outline.lineTo(-0.025, 0);
  const blade = new THREE.ExtrudeGeometry(outline, { depth: 0.008, bevelEnabled: false, curveSegments: 8 });
  blade.translate(0, hubRadius, -0.004);
  // Pitch: rotate the blade face about its own radial axis.
  blade.rotateY(PROPELLER_PITCH_ANGLE);
  return blade;
}

/** Propeller centred on the origin, spinning about +Z. */
export function createPropellerGeometry(): THREE.BufferGeometry {
  const hubRadius = 0.045;
  const tipRadius = PROPELLER_DIAMETER / 2;
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.CylinderGeometry(0.03, hubRadius, 0.13, 14);
  hub.rotateX(Math.PI / 2);
  parts.push(hub.toNonIndexed());
  const cone = new THREE.ConeGeometry(0.03, 0.06, 14);
  cone.rotateX(-Math.PI / 2);
  cone.translate(0, 0, -0.095);
  parts.push(cone.toNonIndexed());
  for (let index = 0; index < PROPELLER_BLADES; index += 1) {
    const blade = createBlade(hubRadius * 0.8, tipRadius);
    blade.rotateZ((index / PROPELLER_BLADES) * Math.PI * 2);
    parts.push(blade);
  }
  const merged = mergeGeometries(parts.map((part) => {
    part.deleteAttribute("uv");
    return part;
  }));
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error("Propeller geometry could not be merged.");
  merged.computeVertexNormals();
  return merged;
}

/**
 * Saildrive leg: a faired strut from inside the hull down to a torpedo pod
 * whose aft end carries the propeller. Origin at the pod's propeller end.
 * @param height Distance from the pod centre up into the hull.
 */
export function createSaildriveGeometry(height: number): THREE.BufferGeometry {
  const strut = new THREE.ExtrudeGeometry(foilShape(0.26, 0.2, 0.3), {
    depth: height,
    bevelEnabled: false,
    curveSegments: 4,
  });
  // Shape x → vessel Z, shape y → vessel X, extrusion → vessel +Y.
  strut.rotateX(-Math.PI / 2);
  strut.rotateY(-Math.PI / 2);
  const pod = new THREE.CapsuleGeometry(0.058, 0.3, 6, 14);
  pod.rotateX(Math.PI / 2);
  pod.translate(0, 0, 0.21);
  const podFlat = pod.toNonIndexed();
  pod.dispose();
  const parts = [strut, podFlat];
  parts.forEach((part) => part.deleteAttribute("uv"));
  const merged = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error("Saildrive geometry could not be merged.");
  merged.computeVertexNormals();
  return merged;
}

/**
 * Balanced spade rudder hanging down from the origin (the top of the stock).
 * A quarter of the chord sits ahead of the stock, as on a real balanced
 * rudder, so the blade turns about a point near its centre of pressure.
 */
export function createRudderGeometry(): THREE.BufferGeometry {
  const blade = new THREE.ExtrudeGeometry(foilShape(RUDDER_CHORD, 0.12, RUDDER_CHORD * 0.25), {
    depth: RUDDER_SPAN,
    bevelEnabled: false,
    curveSegments: 4,
  });
  blade.rotateX(Math.PI / 2);
  blade.rotateY(-Math.PI / 2);
  // Taper toward the tip so the planform reads as a real blade.
  const position = blade.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const depth = THREE.MathUtils.clamp(-position.getY(index) / RUDDER_SPAN, 0, 1);
    const taper = 1 - depth * 0.28;
    position.setZ(index, position.getZ(index) * taper);
    position.setX(index, position.getX(index) * taper);
  }
  blade.deleteAttribute("uv");
  blade.computeVertexNormals();
  return blade;
}
