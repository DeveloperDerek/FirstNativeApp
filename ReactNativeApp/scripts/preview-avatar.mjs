#!/usr/bin/env node
/**
 * Draws characters the way the app does (src/avatar/Avatar.tsx: the same
 * layer order, skin and hair tinting, crisp pixel art and smooth
 * high-resolution art), side by side, into a PNG. For checking new art
 * without a phone.
 *
 * Usage: node scripts/preview-avatar.mjs [out.png] [scale]
 *   out.png  default: art-preview.png in the current folder
 *   scale    points per unit, as the Avatar's scale prop (default 4)
 *
 * Draws both starter looks in three skin tones, plus each look at the
 * step track's size (scale 2) to check small sizes.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const CK = await require('canvaskit-wasm/bin/full/canvaskit.js')();

const AVATAR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'avatar');
const SPRITE_W = 32;
const SPRITE_H = 56;

// As in src/avatar/types.ts (DEFAULT_AVATAR, STARTER_LOOKS, SKIN_TONES)
const MEN = {
  skin: '#f6c9a0',
  hair: 'hair_spiky',
  hairColor: '#7a4a2a',
  face: 'face_smile',
  top: 'top_hoodie_red',
  bottom: 'bottom_shorts_blue',
  shoes: 'shoes_white',
};
const WOMEN = { ...MEN, hair: 'hair_long', top: 'top_sweater_yellow', bottom: 'bottom_skirt_pink' };
const LOOKS = [
  MEN,
  { ...MEN, skin: '#fde0c8', hairColor: '#2a1a1a' },
  { ...MEN, skin: '#6f4428', hairColor: '#f2d16b' },
  WOMEN,
  { ...WOMEN, skin: '#c68655', hairColor: '#d9534f' },
];

const images = new Map();
function image(name) {
  if (!images.has(name)) {
    const file = path.join(AVATAR, `${name}.png`);
    images.set(name, existsSync(file) ? CK.MakeImageFromEncoded(readFileSync(file)) : null);
  }
  return images.get(name);
}

/** Back to front, as in Avatar.tsx. [file name, tint] pairs. */
function layers(c) {
  const hair = c.hair;
  const outfit = c.outfit;
  return [
    c.cape && [`${c.cape}_back`],
    hair && [`${hair}_back`, c.hairColor],
    c.hand && [`${c.hand}_back`],
    ['body_base', c.skin],
    !outfit && [c.bottom],
    [c.shoes],
    [outfit ?? c.top],
    [c.face],
    c.glasses && [c.glasses],
    hair && [hair, c.hairColor],
    c.hat && [c.hat],
    c.cape && [c.cape],
    c.hand && [c.hand],
  ].filter(Boolean);
}

function hex(s) {
  const n = parseInt(s.slice(1), 16);
  return CK.Color((n >> 16) & 255, (n >> 8) & 255, n & 255, 1);
}

function drawAvatar(canvas, config, x, y, scale) {
  for (const [name, tint] of layers(config)) {
    const img = image(name);
    if (!img) continue; // e.g. a hair style with no back
    const paint = new CK.Paint();
    if (tint) paint.setColorFilter(CK.ColorFilter.MakeBlend(hex(tint), CK.BlendMode.Modulate));
    const pixelArt = img.width() <= SPRITE_W;
    const src = img;
    canvas.drawImageRectOptions(
      pixelArt ? src : src.makeCopyWithDefaultMipmaps(),
      CK.XYWHRect(0, 0, img.width(), img.height()),
      CK.XYWHRect(x, y, SPRITE_W * scale, SPRITE_H * scale),
      pixelArt ? CK.FilterMode.Nearest : CK.FilterMode.Linear,
      pixelArt ? CK.MipmapMode.None : CK.MipmapMode.Linear,
      paint,
    );
  }
}

const out = process.argv[2] ?? 'art-preview.png';
const scale = Number(process.argv[3] ?? 4);
const GAP = 16;
const cellW = SPRITE_W * scale + GAP;
const small = 2;
const width = GAP + LOOKS.length * cellW + 2 * (SPRITE_W * small + GAP);
const height = SPRITE_H * scale + 2 * GAP;

const surface = CK.MakeSurface(width, height);
const canvas = surface.getCanvas();
canvas.clear(CK.Color(191, 230, 255, 1)); // the village sky
LOOKS.forEach((look, i) => drawAvatar(canvas, look, GAP + i * cellW, GAP, scale));
// The two starter looks at the step track's size, standing at the bottom
[MEN, WOMEN].forEach((look, i) =>
  drawAvatar(
    canvas,
    look,
    GAP + LOOKS.length * cellW + i * (SPRITE_W * small + GAP),
    height - GAP - SPRITE_H * small,
    small,
  ),
);
writeFileSync(out, surface.makeImageSnapshot().encodeToBytes());
console.log(`wrote ${out} (${width} x ${height})`);
