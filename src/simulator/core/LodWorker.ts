/// <reference lib="webworker" />
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { simplifyLevel, type LodGroup } from "./LodSimplify";

/**
 * Builds screen-size LOD levels off the main thread (see `ScreenLod`): a
 * ship model of a hundred thousand triangles takes longer to simplify than
 * several frames, and on the main thread it stalled the game each time a
 * model arrived.
 */
type Job = { id: number; positions: Float32Array; indices: Uint32Array; groups: LodGroup[]; ratios: number[] };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<Job>) => {
  const { id, positions, indices, groups, ratios } = event.data;
  try {
    await MeshoptSimplifier.ready;
    const levels = ratios.map((ratio) => simplifyLevel(MeshoptSimplifier, positions, indices, groups, ratio));
    scope.postMessage({ id, levels }, levels.map((level) => level.indices.buffer));
  } catch (error) {
    scope.postMessage({ id, levels: null, error: String(error) });
  }
};
