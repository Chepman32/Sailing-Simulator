export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function lerpAngle(current: number, target: number, amount: number): number {
  let delta = ((target - current + Math.PI) % TAU) - Math.PI;
  if (delta < -Math.PI) delta += TAU;
  return current + delta * amount;
}

export function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}
