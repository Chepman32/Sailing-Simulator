import type { ShipKind, ShipSpec } from "./ShipMath";

/**
 * How an imported ship model is fitted to the simulation, as pure numbers.
 *
 * A downloaded model comes in its author's frame: any axis may be the bow,
 * any unit may be a metre, the keel or the waterline may be at zero, and the
 * scene often carries a sea plane under the hull. These helpers decide which
 * meshes are the sea, how to turn the model so its bow lies along +Z, how far
 * to scale it so its length is the type's real length, and where to put it so
 * it floats at its draught. `ShipModels` applies the result.
 */

/** The model's own axis that points from stern to bow. */
export type BowAxis = "+x" | "-x" | "+z" | "-z";

export type ShipModelSource = {
  /** Published URL of the optimized GLB under `public/`. */
  url: string;
  /** Stern-to-bow axis in the model's own frame. */
  bow: BowAxis;
  /**
   * Height of the waterline above the lowest point of the hull, as a fraction
   * of the draught (1 = the model is a full hull, keel included; 0 = the
   * model is cut off at the waterline). Default 1.
   */
  keel?: number;
  /** Credit line kept with the model (CC BY attribution). */
  credit: string;
};

/** The 3D models used for each kind, in turn; an empty list keeps the procedural ship. */
export const SHIP_MODELS: Record<ShipKind, readonly ShipModelSource[]> = {
  container: [],
  tanker: [],
  cruise: [],
  bulk: [],
  carrier: [],
  lng: [],
  ferry: [],
  cargo: [],
};

export type Bounds3 = { min: [number, number, number]; max: [number, number, number] };

/** Rotation about +Y (three.js convention) that turns `bow` into +Z. */
export function bowYaw(bow: BowAxis): number {
  switch (bow) {
    case "+z":
      return 0;
    case "-z":
      return Math.PI;
    case "+x":
      return -Math.PI / 2;
    case "-x":
      return Math.PI / 2;
  }
}

/**
 * Whether a mesh is the sea or a ground plane the author left in the scene:
 * named so, or flat and reaching well beyond everything else on both
 * horizontal axes (a deck is flat too, but never wider than the hull).
 */
export function isSeaSurface(name: string, mesh: Bounds3, rest: Bounds3 | null): boolean {
  if (/(water|ocean|sea(?!t)|wave|ground|plane_sea)/iu.test(name)) return true;
  const sizeX = mesh.max[0] - mesh.min[0];
  const sizeY = mesh.max[1] - mesh.min[1];
  const sizeZ = mesh.max[2] - mesh.min[2];
  const flat = sizeY < 0.02 * Math.max(sizeX, sizeZ);
  if (!flat || !rest) return false;
  const restX = rest.max[0] - rest.min[0];
  const restZ = rest.max[2] - rest.min[2];
  return sizeX > restX * 1.15 && sizeZ > restZ * 1.15;
}

export type ShipModelFit = {
  /** Uniform scale from model units to metres. */
  scale: number;
  /** Translation applied after the yaw and the scale, metres. */
  offset: [number, number, number];
};

/**
 * Scale and offset for a model whose bounds (already turned bow to +Z) are
 * `bounds`: the length along Z becomes the type's length, the hull is centred
 * on the ship's origin, and the waterline is at y = 0 with the keel `draft`
 * below (or the model's bottom at the waterline if it has no underwater part).
 */
export function fitShipModel(bounds: Bounds3, spec: ShipSpec, keel = 1): ShipModelFit {
  const length = Math.max(1e-6, bounds.max[2] - bounds.min[2]);
  const scale = spec.length / length;
  const centreX = (bounds.min[0] + bounds.max[0]) / 2;
  const centreZ = (bounds.min[2] + bounds.max[2]) / 2;
  const bottom = bounds.min[1] * scale;
  return {
    scale,
    offset: [-centreX * scale, -bottom - spec.draft * Math.min(1, Math.max(0, keel)), -centreZ * scale],
  };
}

/** Bounds of a set of boxes; null for none. */
export function unionBounds(boxes: readonly Bounds3[]): Bounds3 | null {
  if (boxes.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, box.min[axis]!);
      max[axis] = Math.max(max[axis]!, box.max[axis]!);
    }
  }
  return { min, max };
}
