import { BlendColor, Canvas, Group, Image, type SkImage } from '@shopify/react-native-skia';

import { CRISP, HEADROOM, SPRITE_H, SPRITE_W, useSprite } from './Avatar';
import { BODY, findItem, type Slot } from './catalog';
import type { AvatarConfig } from './types';

// One item on its own, as an inventory icon: just its sprite(s), cropped
// to the pixels it actually covers and scaled up to fill the box. The
// item sprites share the character's 32 x 56 canvas, so without the crop
// a pair of shoes would be a few pixels at the bottom of an empty box.

type Box = { x: number; y: number; w: number; h: number };

// A face is only eyes and a mouth, so it is shown on a plain head:
// the head ellipse plus ears (see HEAD in scripts/generate-avatar-sprites.py).
const HEAD_BOX: Box = { x: 3, y: HEADROOM + 1, w: 26, h: 26 };

// Worked out once per decoded sprite; readPixels copies the image to the CPU
const opaque = new WeakMap<SkImage, Box | null>();

function opaqueBox(image: SkImage): Box | null {
  if (opaque.has(image)) return opaque.get(image)!;
  const w = image.width();
  const h = image.height();
  const px = image.readPixels();
  let box: Box | null = null;
  if (px) {
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] === 0) continue; // alpha is last in RGBA and BGRA
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    // In sprite pixels, in case a sprite is ever exported at another size
    const k = SPRITE_W / w;
    if (x1 >= 0) box = { x: x0 * k, y: y0 * k, w: (x1 - x0 + 1) * k, h: (y1 - y0 + 1) * k };
  }
  opaque.set(image, box);
  return box;
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function ItemIcon({
  slot,
  id,
  config,
  size = 64,
  accessibilityLabel,
}: {
  slot: Slot;
  id: string;
  /** For the colors: hair is drawn in their hair color, a face on their skin. */
  config: AvatarConfig;
  /** Width and height of the square box, in points. */
  size?: number;
  accessibilityLabel: string;
}) {
  const item = findItem(slot, id);
  const tint = slot === 'hair' ? config.hairColor : undefined;
  const head = useSprite(slot === 'face' ? BODY : undefined);
  const back = useSprite(item?.back);
  const front = useSprite(item?.image);

  const worn = union(back && opaqueBox(back), front && opaqueBox(front));
  // Shoes are a matching pair far apart; one shoe can be drawn much bigger
  const box =
    slot === 'face'
      ? HEAD_BOX
      : slot === 'shoes' && worn
        ? { ...worn, w: SPRITE_W / 2 - worn.x }
        : worn;
  // Whole-number scale keeps the pixels even; capped so a tiny item
  // (glasses) doesn't turn into a few giant blocks
  const scale = box ? Math.max(1, Math.min(6, Math.floor(size / Math.max(box.w, box.h)))) : 1;
  const left = box ? Math.round((size - box.w * scale) / 2 - box.x * scale) : 0;
  const top = box ? Math.round((size - box.h * scale) / 2 - box.y * scale) : 0;

  const layer = (image: SkImage | null, color?: string) =>
    image && (
      <Image
        image={image}
        x={left}
        y={top}
        width={SPRITE_W * scale}
        height={SPRITE_H * scale}
        fit="fill"
        sampling={CRISP}>
        {color ? <BlendColor color={color} mode="modulate" /> : null}
      </Image>
    );

  return (
    <Canvas
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}>
      {box && (
        // Only the crop shows (one shoe, not a bit of the other)
        <Group
          clip={{
            x: left + box.x * scale,
            y: top + box.y * scale,
            width: box.w * scale,
            height: box.h * scale,
          }}>
          {layer(back, tint)}
          {layer(head, config.skin)}
          {layer(front, tint)}
        </Group>
      )}
    </Canvas>
  );
}
