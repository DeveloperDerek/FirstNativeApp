import { type AvatarConfig, DEFAULT_AVATAR } from './types';

// Metro needs every require() written out literally; you cannot build the
// path from a string at runtime. So each item is listed once here.
// To add an item: drop the 32 x 48 PNG in assets/avatar/ and add a line.

export type Slot = 'face' | 'hair' | 'top' | 'bottom' | 'shoes' | 'hat';
type Item = { id: string; label: string; image: number; back?: number };

export const BODY: number = require('@/assets/avatar/body_base.png');

export const CATALOG: Record<Slot, Item[]> = {
  face: [
    { id: 'face_smile', label: 'Smile', image: require('@/assets/avatar/face_smile.png') },
    { id: 'face_neutral', label: 'Neutral', image: require('@/assets/avatar/face_neutral.png') },
    { id: 'face_wink', label: 'Wink', image: require('@/assets/avatar/face_wink.png') },
    {
      id: 'face_determined',
      label: 'Determined',
      image: require('@/assets/avatar/face_determined.png'),
    },
  ],
  hair: [
    { id: 'hair_spiky', label: 'Spiky', image: require('@/assets/avatar/hair_spiky.png') },
    { id: 'hair_short', label: 'Short', image: require('@/assets/avatar/hair_short.png') },
    { id: 'hair_buzz', label: 'Buzz', image: require('@/assets/avatar/hair_buzz.png') },
    {
      id: 'hair_long',
      label: 'Long',
      image: require('@/assets/avatar/hair_long.png'),
      back: require('@/assets/avatar/hair_long_back.png'),
    },
    {
      id: 'hair_ponytail',
      label: 'Ponytail',
      image: require('@/assets/avatar/hair_ponytail.png'),
      back: require('@/assets/avatar/hair_ponytail_back.png'),
    },
  ],
  top: [
    { id: 'top_hoodie_red', label: 'Red hoodie', image: require('@/assets/avatar/top_hoodie_red.png') },
    { id: 'top_tee_white', label: 'White tee', image: require('@/assets/avatar/top_tee_white.png') },
    {
      id: 'top_jacket_green',
      label: 'Green jacket',
      image: require('@/assets/avatar/top_jacket_green.png'),
    },
    {
      id: 'top_sweater_yellow',
      label: 'Yellow sweater',
      image: require('@/assets/avatar/top_sweater_yellow.png'),
    },
    {
      id: 'top_jersey_blue',
      label: 'Blue jersey',
      image: require('@/assets/avatar/top_jersey_blue.png'),
    },
  ],
  bottom: [
    {
      id: 'bottom_shorts_blue',
      label: 'Blue shorts',
      image: require('@/assets/avatar/bottom_shorts_blue.png'),
    },
    { id: 'bottom_jeans_blue', label: 'Jeans', image: require('@/assets/avatar/bottom_jeans_blue.png') },
    {
      id: 'bottom_pants_black',
      label: 'Black pants',
      image: require('@/assets/avatar/bottom_pants_black.png'),
    },
    {
      id: 'bottom_skirt_pink',
      label: 'Pink skirt',
      image: require('@/assets/avatar/bottom_skirt_pink.png'),
    },
  ],
  shoes: [
    { id: 'shoes_white', label: 'White sneakers', image: require('@/assets/avatar/shoes_white.png') },
    { id: 'shoes_red', label: 'Red sneakers', image: require('@/assets/avatar/shoes_red.png') },
    {
      id: 'shoes_boots_brown',
      label: 'Brown boots',
      image: require('@/assets/avatar/shoes_boots_brown.png'),
    },
  ],
  hat: [
    { id: 'hat_beanie_teal', label: 'Teal beanie', image: require('@/assets/avatar/hat_beanie_teal.png') },
    { id: 'hat_cap_red', label: 'Red cap', image: require('@/assets/avatar/hat_cap_red.png') },
    { id: 'hat_crown_gold', label: 'Gold crown', image: require('@/assets/avatar/hat_crown_gold.png') },
  ],
};

/** Slots that can be set to "None". */
export const OPTIONAL_SLOTS: ReadonlySet<Slot> = new Set(['hair', 'hat']);

export function findItem(slot: Slot, id: string | null | undefined) {
  if (!id) return undefined;
  return CATALOG[slot].find((i) => i.id === id);
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/**
 * Turns whatever is stored in the database into a valid character.
 * The column accepts any JSON, and items may be removed from the catalog
 * later, so unknown ids fall back to the default (or "none" for
 * optional slots) instead of leaving a slot empty.
 */
export function normalizeAvatar(raw: unknown): AvatarConfig {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (slot: Slot): string | null => {
    const id = typeof a[slot] === 'string' ? (a[slot] as string) : null;
    if (findItem(slot, id)) return id;
    if (OPTIONAL_SLOTS.has(slot) && a[slot] === null) return null;
    return DEFAULT_AVATAR[slot];
  };
  return {
    skin: isHex(a.skin) ? a.skin : DEFAULT_AVATAR.skin,
    hairColor: isHex(a.hairColor) ? a.hairColor : DEFAULT_AVATAR.hairColor,
    face: pick('face') ?? DEFAULT_AVATAR.face,
    hair: pick('hair'),
    top: pick('top') ?? DEFAULT_AVATAR.top,
    bottom: pick('bottom') ?? DEFAULT_AVATAR.bottom,
    shoes: pick('shoes') ?? DEFAULT_AVATAR.shoes,
    hat: pick('hat'),
  };
}
