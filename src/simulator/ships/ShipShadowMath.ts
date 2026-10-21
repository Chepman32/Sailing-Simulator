import * as THREE from "three";

/**
 * Sun shadows of the big ships, as numbers and GLSL.
 *
 * The sun's own shadow map covers a few metres around the yacht, at the
 * resolution her rigging needs; a 300 m ship a kilometre off is far outside
 * it. The nearest ships therefore get their own shadow map: each is drawn,
 * depth only, from the sun into one quarter of an atlas (`ShipShadows`), and
 * the ships' materials and the sea look themselves up in it. A ship then
 * shades her own decks and superstructure and lays her shadow on the water.
 */

/** Ships with a shadow at once: the four nearest, in the quarters of the atlas. */
export const SHIP_SHADOW_SLOTS = 4;
/** Ships farther than this from the camera need no shadow of their own, m. */
export const SHIP_SHADOW_RANGE = 2600;
/** Height above the waterline the shadow volume reaches (funnels, cranes), m. */
export const SHIP_SHADOW_HEIGHT = 70;
/** Depth bias of the comparison, metres along the sun. */
export const SHIP_SHADOW_BIAS_METRES = 0.35;

/** Lower-left corner of a slot in the atlas, in texture coordinates. */
export function shadowSlotOrigin(slot: number): [number, number] {
  return [(slot % 2) * 0.5, Math.floor(slot / 2) * 0.5];
}

/**
 * The matrix that takes a slot camera's clip space (x, y, z in −1…1) to the
 * atlas: x and y to that slot's quarter, z to the 0…1 depth the depth
 * texture stores.
 */
export function shadowAtlasMatrix(slot: number, target = new THREE.Matrix4()): THREE.Matrix4 {
  const [u, v] = shadowSlotOrigin(slot);
  return target.set(
    0.25, 0, 0, u + 0.25,
    0, 0.25, 0, v + 0.25,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
  );
}

export type ShadowCandidate = { active: boolean; x: number; z: number; halfLength: number };

/**
 * Indices of the ships that get a shadow: active, within range of
 * (x, z), nearest first, at most `SHIP_SHADOW_SLOTS`.
 */
export function pickShadowShips(ships: readonly ShadowCandidate[], x: number, z: number, out: number[] = []): number[] {
  out.length = 0;
  const order: { index: number; distance: number }[] = [];
  ships.forEach((ship, index) => {
    if (!ship.active) return;
    const distance = Math.hypot(ship.x - x, ship.z - z) - ship.halfLength;
    if (distance > SHIP_SHADOW_RANGE) return;
    order.push({ index, distance });
  });
  order.sort((a, b) => a.distance - b.distance);
  for (let slot = 0; slot < Math.min(SHIP_SHADOW_SLOTS, order.length); slot += 1) out.push(order[slot]!.index);
  return out;
}

/** Half extent of a slot camera around a ship, m: her length and the height of her upperworks. */
export function shadowSlotRadius(halfLength: number): number {
  return Math.hypot(halfLength + 8, SHIP_SHADOW_HEIGHT * 0.6);
}

export type ShipShadowUniforms = {
  uShipShadowMap: THREE.IUniform<THREE.Texture | null>;
  uShipShadowMatrix: THREE.IUniform<THREE.Matrix4[]>;
  uShipShadowCount: THREE.IUniform<number>;
  uShipShadowTexel: THREE.IUniform<number>;
  /** Depth bias per slot, in that slot's 0…1 depth units. */
  uShipShadowBias: THREE.IUniform<THREE.Vector4>;
};

export function createShipShadowUniforms(): ShipShadowUniforms {
  return {
    uShipShadowMap: { value: null },
    uShipShadowMatrix: { value: Array.from({ length: SHIP_SHADOW_SLOTS }, () => new THREE.Matrix4()) },
    uShipShadowCount: { value: 0 },
    uShipShadowTexel: { value: 1 / 2048 },
    uShipShadowBias: { value: new THREE.Vector4() },
  };
}

/**
 * GLSL: `shipShadowAt(world)` — 1 in sunlight, 0 in a ship's shadow, soft at
 * the edge (five taps). Shared by the ships' materials and the sea.
 */
export const SHIP_SHADOW_GLSL = /* glsl */ `
  #ifndef SHIP_SHADOW_GLSL
  #define SHIP_SHADOW_GLSL
  uniform sampler2D uShipShadowMap;
  uniform mat4 uShipShadowMatrix[${SHIP_SHADOW_SLOTS}];
  uniform int uShipShadowCount;
  uniform float uShipShadowTexel;
  uniform vec4 uShipShadowBias;

  float shipShadowTap(vec2 uv, vec2 lo, float depth) {
    uv = clamp(uv, lo + uShipShadowTexel, lo + 0.5 - uShipShadowTexel);
    return step(depth, texture2D(uShipShadowMap, uv).r);
  }

  float shipShadowAt(vec3 world) {
    float lit = 1.0;
    for (int slot = 0; slot < ${SHIP_SHADOW_SLOTS}; slot++) {
      if (slot >= uShipShadowCount) break;
      vec4 p = uShipShadowMatrix[slot] * vec4(world, 1.0);
      vec2 lo = vec2(mod(float(slot), 2.0), floor(float(slot) / 2.0)) * 0.5;
      if (p.x <= lo.x || p.y <= lo.y || p.x >= lo.x + 0.5 || p.y >= lo.y + 0.5 || p.z <= 0.0 || p.z >= 1.0) continue;
      float depth = p.z - uShipShadowBias[slot];
      float t = uShipShadowTexel * 1.25;
      float s = shipShadowTap(p.xy, lo, depth) * 2.0;
      s += shipShadowTap(p.xy + vec2(t, 0.0), lo, depth);
      s += shipShadowTap(p.xy - vec2(t, 0.0), lo, depth);
      s += shipShadowTap(p.xy + vec2(0.0, t), lo, depth);
      s += shipShadowTap(p.xy - vec2(0.0, t), lo, depth);
      lit = min(lit, s / 6.0);
    }
    return lit;
  }
  #endif
`;
