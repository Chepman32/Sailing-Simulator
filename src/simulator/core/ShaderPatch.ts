import type * as THREE from "three";

type ShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

/**
 * Adds a shader modification to a built-in material without discarding the
 * ones already installed. Several systems decorate the same material (the
 * sail is deformed by the wind, given seams, and darkened under water), so
 * each patch runs after the previous one and the program cache key records
 * every patch that was applied.
 */
export function patchMaterialShader(material: THREE.Material, key: string, patch: ShaderPatch): void {
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
