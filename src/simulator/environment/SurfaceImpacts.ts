/**
 * Ring waves and slicks left on the sea by things that hit or break it: a
 * whale's fluke, a dolphin re-entering, a shark's fin cutting the surface.
 *
 * An impulse on deep water spreads as a ring-shaped wave group. The group
 * travels outward at a steady speed while the individual crests run through
 * it faster, appearing at its back and fading at its front. Behind the group
 * the surface is left glassy for a while: the "footprint" a diving whale
 * leaves, where the disturbed water damps the wind ripples.
 *
 * These waves are a few centimetres to a couple of decimetres high, far too
 * small to move the yacht, so like the detail spectrum they only shape the
 * shading normal. The same constants generate the GLSL and the pure function
 * below, which the tests exercise.
 */

/** Simultaneous impacts the ocean shader keeps track of. */
export const MAX_SURFACE_IMPACTS = 8;

/** Lifetime of an impact's rings and slick, in seconds. */
export const IMPACT_LIFE_BASE = 5;
export const IMPACT_LIFE_PER_STRENGTH = 2.4;
/** Largest strength accepted; a heavy whale fluke slap is about 5. */
export const MAX_IMPACT_STRENGTH = 6;

export function surfaceImpactLife(strength: number): number {
  return IMPACT_LIFE_BASE + Math.min(MAX_IMPACT_STRENGTH, Math.max(0, strength)) * IMPACT_LIFE_PER_STRENGTH;
}

export type SurfaceImpactShape = {
  /** Radial surface slope of the ring waves. */
  slope: number;
  /** 0–1: how strongly the wind ripples are smoothed into a slick. */
  calm: number;
  /** Radius of the leading ring. */
  front: number;
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Ring-wave slope and slick strength at `distance` metres from an impact of
 * the given strength, `age` seconds after it.
 */
export function surfaceImpactShape(distance: number, age: number, strength: number): SurfaceImpactShape {
  const bounded = Math.min(MAX_IMPACT_STRENGTH, Math.max(0, strength));
  const life = surfaceImpactLife(bounded);
  if (bounded <= 0 || age <= 0 || age >= life) return { slope: 0, calm: 0, front: 0 };
  const groupSpeed = 1.1 + 0.36 * bounded;
  const front = groupSpeed * age + 0.3;
  const wavelength = 1.1 + 0.42 * bounded;
  const waveNumber = (Math.PI * 2) / wavelength;
  const position = distance / front;
  const envelope = smoothstep(0.22, 0.86, position) * (1 - smoothstep(0.97, 1.12, position));
  const amplitude = ((0.018 + 0.032 * bounded) * Math.exp((-3 * age) / life)) / Math.sqrt(1 + distance * 0.45);
  // Crests travel through the group at 1.6 times its speed.
  const phase = waveNumber * (distance - groupSpeed * 1.6 * age);
  const slope = amplitude * waveNumber * envelope * Math.cos(phase);
  const slickRadius = Math.min(front * 0.72, 2.2 + 1.6 * bounded);
  const fade = 1 - smoothstep(life * 0.5, life, age);
  const calm = (1 - smoothstep(slickRadius * 0.45, slickRadius * 1.1, distance)) * fade * smoothstep(0, 0.6, age);
  return { slope, calm, front };
}

function glsl(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : value.toFixed(6);
}

/**
 * Fragment-stage twin of {@link surfaceImpactShape}. Accumulates the ring
 * slope into `slope` and returns the strongest slick at `position`.
 * `uImpacts[i]` holds (x, z, start time, strength).
 */
export const SURFACE_IMPACT_GLSL = /* glsl */ `
  uniform vec4 uImpacts[${MAX_SURFACE_IMPACTS}];

  float surfaceImpacts(vec2 position, float footprint, inout vec2 slope) {
    float calm = 0.0;
    for (int index = 0; index < ${MAX_SURFACE_IMPACTS}; index++) {
      vec4 impact = uImpacts[index];
      float strength = min(impact.w, ${glsl(MAX_IMPACT_STRENGTH)});
      if (strength <= 0.0) continue;
      float age = uTime - impact.z;
      float life = ${glsl(IMPACT_LIFE_BASE)} + strength * ${glsl(IMPACT_LIFE_PER_STRENGTH)};
      if (age <= 0.0 || age >= life) continue;
      vec2 delta = position - impact.xy;
      float radius = length(delta);
      float groupSpeed = 1.1 + 0.36 * strength;
      float front = groupSpeed * age + 0.3;
      if (radius > front * 1.15 + 1.0) continue;
      float wavelength = 1.1 + 0.42 * strength;
      float waveNumber = 6.283185307 / wavelength;
      float along = radius / front;
      float envelope = smoothstep(0.22, 0.86, along) * (1.0 - smoothstep(0.97, 1.12, along));
      float amplitude = (0.018 + 0.032 * strength) * exp(-3.0 * age / life) / sqrt(1.0 + radius * 0.45);
      float phase = waveNumber * (radius - groupSpeed * 1.6 * age);
      // Rings finer than the pixel footprint would alias into noise.
      float resolved = 1.0 - smoothstep(wavelength * 0.15, wavelength * 0.45, footprint);
      float radial = amplitude * waveNumber * envelope * cos(phase) * resolved;
      slope += delta / max(radius, 0.001) * radial;
      float slickRadius = min(front * 0.72, 2.2 + 1.6 * strength);
      float fade = 1.0 - smoothstep(life * 0.5, life, age);
      calm = max(calm, (1.0 - smoothstep(slickRadius * 0.45, slickRadius * 1.1, radius)) * fade * smoothstep(0.0, 0.6, age));
    }
    return calm;
  }
`;
