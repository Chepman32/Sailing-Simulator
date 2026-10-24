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
  /**
   * Height of the model's own waterline in its own units, when the author
   * modelled it (it overrides `keel`): read off the boot top or antifouling.
   */
  waterline?: number;
  /** Credit line kept with the model (CC BY attribution). */
  credit: string;
};

const SKETCHFAB = "https://sketchfab.com/3d-models/";

/** The 3D models used for each kind, in turn; an empty list keeps the procedural ship. */
export const SHIP_MODELS: Record<ShipKind, readonly ShipModelSource[]> = {
  container: [
    {
      url: "/models/ships/container-rm02.glb",
      bow: "+x",
      waterline: 4.3,
      credit: `“Container Ship” by RM02, CC BY 4.0, ${SKETCHFAB}container-ship-aaa41cca946b4a08bc08cf692b7757be`,
    },
  ],
  tanker: [
    {
      url: "/models/ships/tanker-artblender.glb",
      bow: "-z",
      waterline: 0,
      credit: `“Tanker Ship” by Art Blender, CC BY 4.0, ${SKETCHFAB}tanker-ship-96ebf61af42b4062ae98a6ad848e1a25`,
    },
  ],
  cruise: [
    {
      url: "/models/ships/cruise-siuliano.glb",
      bow: "-z",
      waterline: 23,
      credit: `“Finished Cruise Ship” by siuliano, CC BY 4.0, ${SKETCHFAB}finished-cruise-ship-8fd630ce74c54fe986a792c3ebb5d57b`,
    },
    {
      url: "/models/ships/cruise-farhad.glb",
      bow: "+z",
      waterline: 280,
      credit: `“Cruise Ship” by farhad.Guli, CC BY 4.0, ${SKETCHFAB}cruise-ship-bb782326932e4c179e34f3d6c8e36b86`,
    },
  ],
  bulk: [
    {
      url: "/models/ships/bulk-herve.glb",
      bow: "-z",
      waterline: 3.8,
      credit: `“Bulk Carrier - TFCC HERITAGE - IBEE Corp” by Gwenaël Hervé, CC BY 4.0, ${SKETCHFAB}bulk-carrier-tfcc-heritage-ibee-corp-e78b4f1fdc094a63bb7d6c24d8e7e7dd`,
    },
  ],
  // No model was supplied for the car carrier: it stays procedural.
  carrier: [],
  lng: [
    {
      url: "/models/ships/lng-artblender.glb",
      bow: "+z",
      waterline: 0,
      credit: `“LNG Ship” by Art Blender, CC BY 4.0, ${SKETCHFAB}lng-ship-fa335b96450d4344863bbf5d912a0288`,
    },
  ],
  ferry: [
    {
      url: "/models/ships/ferry-fha.glb",
      bow: "+x",
      waterline: -0.16,
      credit: `“Viking Line M/S Europa (1993)” by FHA_studios, CC BY 4.0, ${SKETCHFAB}viking-line-ms-europa-1993-c27533d9b3024e6c835d5f308a8f278e`,
    },
  ],
  cargo: [
    {
      url: "/models/ships/cargo-hungrydrifter.glb",
      bow: "+x",
      waterline: 38.9,
      credit: `“Cargo ship” by hungry_drifter, CC BY 4.0, ${SKETCHFAB}cargo-ship-b7c97df584824ca682d26daabf401f87`,
    },
  ],
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
  const sizeX = mesh.max[0] - mesh.min[0];
  const sizeY = mesh.max[1] - mesh.min[1];
  const sizeZ = mesh.max[2] - mesh.min[2];
  const flat = sizeY < 0.02 * Math.max(sizeX, sizeZ);
  if (!flat) return false;
  // A flat sheet named as the sea; a pool on deck is never flat at this scale.
  if (/(^|[^a-z])(water|ocean|sea)([^a-z]|$)/iu.test(name)) return true;
  if (!rest) return false;
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
export function fitShipModel(bounds: Bounds3, spec: ShipSpec, keel = 1, waterline?: number): ShipModelFit {
  const length = Math.max(1e-6, bounds.max[2] - bounds.min[2]);
  const scale = spec.length / length;
  const centreX = (bounds.min[0] + bounds.max[0]) / 2;
  const centreZ = (bounds.min[2] + bounds.max[2]) / 2;
  const bottom = bounds.min[1] * scale;
  const lift =
    waterline !== undefined ? -waterline * scale : -bottom - spec.draft * Math.min(1, Math.max(0, keel));
  return { scale, offset: [-centreX * scale, lift, -centreZ * scale] };
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
