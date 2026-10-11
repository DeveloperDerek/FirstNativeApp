import { AlphaType, ColorType } from '@shopify/react-native-skia';

import { loadSprite } from './Avatar';

/** A sprite's transparency, one value (0 to 255) per pixel. */
export type SpriteAlpha = { width: number; height: number; alpha: (x: number, y: number) => number };

/** Reads a sprite's pixels. Uses the same decoded image the Avatar draws. */
export async function loadAlpha(source: number): Promise<SpriteAlpha | null> {
  const image = await loadSprite(source);
  if (!image) return null;
  const width = image.width();
  const height = image.height();
  const pixels = image.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!pixels) return null;
  return { width, height, alpha: (x, y) => pixels[(y * width + x) * 4 + 3] };
}
