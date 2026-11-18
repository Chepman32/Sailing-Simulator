import * as THREE from "three";

/** Decoded RGBA plus mipmaps, per imported model on a handheld device. */
export const MOBILE_MODEL_TEXTURE_BYTES = 12 * 1024 * 1024;
export const MOBILE_TEXTURE_EDGE = 1024;

type ImageSize = { width: number; height: number };

/** Bound decoded texture memory, not the compressed GLB's download size. */
export function modelTextureSizes(images: readonly ImageSize[]): ImageSize[] {
  const capped = images.map(({ width, height }) => {
    const scale = Math.min(1, MOBILE_TEXTURE_EDGE / Math.max(width, height));
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
  });
  const pixels = capped.reduce((sum, image) => sum + image.width * image.height, 0);
  const scale = Math.min(1, Math.sqrt(MOBILE_MODEL_TEXTURE_BYTES / (pixels * 4 * 4 / 3)));
  return capped.map(({ width, height }) => ({ width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }));
}

function modelTextures(roots: readonly THREE.Object3D[]): Set<THREE.Texture> {
  const textures = new Set<THREE.Texture>();
  for (const root of roots) root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return textures;
}

type TextureImage = ImageSize & { close?: () => void };
type ResizeImage = (image: TextureImage, size: ImageSize) => Promise<TextureImage>;

const resizeImage: ResizeImage = async (image, size) => {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(image as ImageBitmap, {
        resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high",
        premultiplyAlpha: "none", colorSpaceConversion: "none",
      });
    } catch {
      // Older Safari can decode a GLB but cannot resize its image bitmap.
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot prepare mobile model textures");
  context.drawImage(image as CanvasImageSource, 0, 0, size.width, size.height);
  return canvas;
};

/** Run before a model reaches the renderer; shared sources stay shared. */
export async function limitModelTextures(roots: readonly THREE.Object3D[], resize: ResizeImage = resizeImage): Promise<void> {
  const images = new Map<TextureImage, Set<THREE.Source>>();
  for (const texture of modelTextures(roots)) {
    const image = texture.source.data as TextureImage | undefined;
    if (!image || !(image.width > 0 && image.height > 0) || texture.isRenderTargetTexture) continue;
    const sources = images.get(image) ?? new Set<THREE.Source>();
    sources.add(texture.source);
    images.set(image, sources);
  }
  const sizes = modelTextureSizes([...images.keys()]);
  let index = 0;
  // Sequential resizing avoids keeping a second full set of decoded images alive.
  for (const [image, sources] of images) {
    const size = sizes[index++]!;
    if (size.width === image.width && size.height === image.height) continue;
    const replacement = await resize(image, size);
    for (const source of sources) source.data = replacement;
    image.close?.();
  }
}

/** Only the model owner calls this, after all its shared instances are gone. */
export function disposeModel(roots: readonly THREE.Object3D[]): void {
  const textures = modelTextures(roots);
  const images = new Set<TextureImage>();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  for (const root of roots) root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const texture of textures) {
    if (texture.source.data) images.add(texture.source.data as TextureImage);
    texture.dispose();
  }
  for (const image of images) image.close?.();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}
