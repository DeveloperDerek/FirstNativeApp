import { Asset } from 'expo-asset';

import type { SpriteAlpha } from './sprite-alpha';

/** Web version: draws the sprite on a hidden canvas to read its pixels. */
export async function loadAlpha(source: number): Promise<SpriteAlpha | null> {
  const asset = Asset.fromModule(source);
  const image = new window.Image();
  image.src = asset.localUri ?? asset.uri;
  await image.decode();

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;
  return { width, height, alpha: (x, y) => pixels[(y * width + x) * 4 + 3] };
}
