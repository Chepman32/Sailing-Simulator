import type * as THREE from "three";

type ShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

/**
 * Adds a shader modification to a built-in material without discarding the
 * ones already installed. Several systems decorate the same material (the
 * sail is deformed by the wind, given seams, and darkened under water), so
 * each patch runs after the previous one and the program cache key records
 * every patch that was applied.
 */
const APPLIED = new WeakMap<THREE.Material, Set<string>>();

export function patchMaterialShader(material: THREE.Material, key: string, patch: ShaderPatch): void {
  // Once per key: a material shared by two users (a model's school of fish
  // built again when more assets arrive) must not get the same declarations
  // twice. Kept beside the material, not in its userData: a clone copies
  // userData but not the patch itself, and must be patchable afresh.
  let applied = APPLIED.get(material);
  if (!applied) APPLIED.set(material, (applied = new Set()));
  if (applied.has(key)) return;
  applied.add(key);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.call(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patch(shader, renderer);
  };
  material.customProgramCacheKey = () => `${previousKey}|${key}`;
  material.needsUpdate = true;
}

/** Replaces one chunk include, failing loudly if three.js renamed it. */
export function injectAfter(source: string, chunk: string, code: string): string {
  const include = `#include <${chunk}>`;
  if (!source.includes(include)) throw new Error(`Shader chunk ${chunk} not found while patching a material.`);
  return source.replace(include, `${include}\n${code}`);
}

export function injectBefore(source: string, chunk: string, code: string): string {
  const include = `#include <${chunk}>`;
  if (!source.includes(include)) throw new Error(`Shader chunk ${chunk} not found while patching a material.`);
  return source.replace(include, `${code}\n${include}`);
}
