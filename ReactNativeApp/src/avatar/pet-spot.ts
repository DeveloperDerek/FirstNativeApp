import { useEffect, useState } from 'react';

import { wornLayers } from './catalog';
import { findPet, PET_SIZE } from './pets';
import { loadAlpha, type SpriteAlpha } from './sprite-alpha';
import type { AvatarConfig } from './types';

// Sizes in sprite pixels, as in Avatar.tsx
const SPRITE_W = 32;
const SPRITE_H = 56;
/** The pet stands one row above the bottom of the character's sprite. */
const PET_BOTTOM_ROW = SPRITE_H - 2;
/**
 * Where the pet's right edge goes when nothing is in the way: one pixel
 * short of the body, which fills the middle half of the sprite (8 to 23).
 */
export const PET_EDGE = 7;
/** Walking left, the pet's left edge: the mirror of PET_EDGE. */
export const PET_EDGE_RIGHT = SPRITE_W - PET_EDGE;

/** Where the pet goes behind the character, either way it walks. */
export type PetEdges = { left: number; right: number };

/** First row with any opaque pixel, or null for an empty sprite. */
export function topRow(sprite: SpriteAlpha): number | null {
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      if (sprite.alpha(x, y) > 0) return Math.floor((y * PET_SIZE) / sprite.height);
    }
  }
  return null;
}

/**
 * Leftmost column (in sprite pixels) with an opaque pixel between rows
 * `top` and `bottom` inclusive, or null if those rows are empty. Works
 * for sprites stored larger than 32 x 56 too.
 */
export function leftmostColumn(sprite: SpriteAlpha, top: number, bottom: number): number | null {
  const sx = sprite.width / SPRITE_W;
  const sy = sprite.height / SPRITE_H;
  const fromY = Math.max(0, Math.floor(top * sy));
  const toY = Math.min(sprite.height, Math.ceil((bottom + 1) * sy));
  for (let x = 0; x < sprite.width; x++) {
    for (let y = fromY; y < toY; y++) {
      if (sprite.alpha(x, y) > 0) return Math.floor(x / sx);
    }
  }
  return null;
}

/** Rightmost column like leftmostColumn, or null if those rows are empty. */
export function rightmostColumn(sprite: SpriteAlpha, top: number, bottom: number): number | null {
  const sx = sprite.width / SPRITE_W;
  const sy = sprite.height / SPRITE_H;
  const fromY = Math.max(0, Math.floor(top * sy));
  const toY = Math.min(sprite.height, Math.ceil((bottom + 1) * sy));
  for (let x = sprite.width - 1; x >= 0; x--) {
    for (let y = fromY; y < toY; y++) {
      if (sprite.alpha(x, y) > 0) return Math.floor(x / sx);
    }
  }
  return null;
}

// Each sprite is read once; measuring a character again costs nothing
const alphas = new Map<number, Promise<SpriteAlpha | null>>();
function cachedAlpha(source: number) {
  let promise = alphas.get(source);
  if (!promise) {
    promise = loadAlpha(source).catch(() => null);
    alphas.set(source, promise);
  }
  return promise;
}

/**
 * Where the pet goes, in sprite pixels from the left of the character's
 * sprite: walking right, its right edge (`left`) just short of the body;
 * walking left, its left edge (`right`) just past it. Further back when a
 * cape, wings, long hair or a held item reach into the rows the pet walks
 * in. Measured from the art, so new items need nothing extra.
 */
export async function measurePetEdge(config: AvatarConfig, petId: string): Promise<PetEdges> {
  const pet = findPet(petId);
  const petSprite = pet ? await cachedAlpha(pet.frames[0]) : null;
  const petTop = (petSprite && topRow(petSprite)) ?? 0;
  const top = PET_BOTTOM_ROW - (PET_SIZE - 1) + petTop;

  const sprites = await Promise.all(wornLayers(config).map(cachedAlpha));
  const edges = { left: PET_EDGE, right: PET_EDGE_RIGHT };
  for (const sprite of sprites) {
    const left = sprite ? leftmostColumn(sprite, top, PET_BOTTOM_ROW) : null;
    if (left !== null) edges.left = Math.min(edges.left, left);
    const right = sprite ? rightmostColumn(sprite, top, PET_BOTTOM_ROW) : null;
    if (right !== null) edges.right = Math.max(edges.right, right + 1);
  }
  return edges;
}

/** measurePetEdge() as a hook. null until measured, so the pet never jumps. */
export function usePetEdge(config: AvatarConfig): PetEdges | null {
  const key = JSON.stringify(config);
  const [measured, setMeasured] = useState<{ key: string; edge: PetEdges } | null>(null);

  useEffect(() => {
    if (!config.pet) return;
    let alive = true;
    measurePetEdge(config, config.pet)
      .then((edge) => alive && setMeasured({ key, edge }))
      .catch(() => alive && setMeasured({ key, edge: { left: PET_EDGE, right: PET_EDGE_RIGHT } }));
    return () => {
      alive = false;
    };
    // The key stands for the whole config
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return measured && measured.key === key ? measured.edge : null;
}
