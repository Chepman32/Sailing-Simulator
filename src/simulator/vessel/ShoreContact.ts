/**
 * Contact between the hulls and an island's rendered shore.
 *
 * The yacht is a rigid body in the horizontal plane. Points around both hulls
 * are tested against the real, irregular waterline: inside a short cushion
 * the sloping bottom starts to push the hull off, and at contact the hull
 * rebounds with an impulse that also spins her away from the beach, so she
 * never ends up parked on the sand.
 */

export type ShoreSampler = (x: number, z: number, normal: { x: number; z: number }) => number;

export type PlanarBody = {
  position: { x: number; z: number };
  velocity: { x: number; z: number };
  heading: number;
  yawRate: number;
};

/** [starboard, forward] offsets of the hull outline in metres. */
export const HULL_OUTLINE: readonly (readonly [number, number])[] = [
  [-1.75, 4.7], [1.75, 4.7],
  [-1.85, 2.4], [1.85, 2.4],
  [-1.85, 0], [1.85, 0],
  [-1.85, -2.4], [1.85, -2.4],
  [-1.75, -4.6], [1.75, -4.6],
];

/** Water the keels need between the hull outline and the waterline. */
export const SHORE_CONTACT_CLEARANCE = 1.4;
/** Distance over which the shoaling bottom eases the hull away before contact. */
export const SHORE_CUSHION = 7;
const CUSHION_ACCELERATION = 3.2;
export const SHORE_RESTITUTION = 0.5;
const SHORE_FRICTION = 0.18;
/** Extra yaw toward the shoreline tangent per m/s of impact. */
const TURN_KICK = 0.3;
const MAX_TURN_KICK = 1.0;

const normal = { x: 0, z: 1 };

/**
 * Applies cushion and contact to `body` in place. Returns the impact speed of
 * a contact this step (0 if none), for spray and sound.
 */
export function resolveShoreContact(
  body: PlanarBody,
  shore: ShoreSampler,
  mass: number,
  inertia: number,
  delta: number,
): number {
  const fx = Math.sin(body.heading);
  const fz = Math.cos(body.heading);
  // Starboard is +X at heading zero.
  const rx = fz;
  const rz = -fx;
  let impact = 0;

  // Soft cushion: points closing on the shore inside the cushion are pushed off.
  for (const [side, ahead] of HULL_OUTLINE) {
    const offX = rx * side + fx * ahead;
    const offZ = rz * side + fz * ahead;
    const clearance = shore(body.position.x + offX, body.position.z + offZ, normal);
    if (clearance >= SHORE_CUSHION) continue;
    const pointVx = body.velocity.x + body.yawRate * offZ;
    const pointVz = body.velocity.z - body.yawRate * offX;
    const closing = pointVx * normal.x + pointVz * normal.z;
    if (closing >= 0.2) continue;
    const closeness = Math.min(1, Math.max(0, 1 - (clearance - SHORE_CONTACT_CLEARANCE) / (SHORE_CUSHION - SHORE_CONTACT_CLEARANCE)));
    const push = (CUSHION_ACCELERATION * closeness * closeness * delta) / HULL_OUTLINE.length * 4;
    body.velocity.x += normal.x * push;
    body.velocity.z += normal.z * push;
    const lever = offZ * normal.x - offX * normal.z;
    body.yawRate += (push * mass * lever) / inertia;
  }

  // Contact: resolve the deepest point, twice, so a corner and a side both settle.
  for (let pass = 0; pass < 2; pass += 1) {
    let deepest = 0;
    let offX = 0;
    let offZ = 0;
    let nX = 0;
    let nZ = 1;
    for (const [side, ahead] of HULL_OUTLINE) {
      const px = rx * side + fx * ahead;
      const pz = rz * side + fz * ahead;
      const clearance = shore(body.position.x + px, body.position.z + pz, normal);
      const penetration = SHORE_CONTACT_CLEARANCE - clearance;
      if (penetration > deepest) {
        deepest = penetration;
        offX = px;
        offZ = pz;
        nX = normal.x;
        nZ = normal.z;
      }
    }
    if (deepest <= 0) break;

    const pointVx = body.velocity.x + body.yawRate * offZ;
    const pointVz = body.velocity.z - body.yawRate * offX;
    const closing = pointVx * nX + pointVz * nZ;
    const lever = offZ * nX - offX * nZ;
    if (closing < 0) {
      const impulse = (-(1 + SHORE_RESTITUTION) * closing) / (1 / mass + (lever * lever) / inertia);
      body.velocity.x += (impulse / mass) * nX;
      body.velocity.z += (impulse / mass) * nZ;
      body.yawRate += (impulse * lever) / inertia;
      // Sand scuffs the sliding component.
      const tangentX = -nZ;
      const tangentZ = nX;
      const sliding = body.velocity.x * tangentX + body.velocity.z * tangentZ;
      body.velocity.x -= tangentX * sliding * SHORE_FRICTION;
      body.velocity.z -= tangentZ * sliding * SHORE_FRICTION;
      // Swing the bow toward whichever way along the shore it already favours.
      const alongX = fx * tangentX + fz * tangentZ >= 0 ? tangentX : -tangentX;
      const alongZ = fx * tangentX + fz * tangentZ >= 0 ? tangentZ : -tangentZ;
      const turn = Math.sign(fz * alongX - fx * alongZ) || 1;
      body.yawRate += turn * Math.min(MAX_TURN_KICK, TURN_KICK * -closing);
      impact = Math.max(impact, -closing);
    }
    // Lift the hull back out of the sand.
    body.position.x += nX * deepest;
    body.position.z += nZ * deepest;
  }
  return impact;
}
