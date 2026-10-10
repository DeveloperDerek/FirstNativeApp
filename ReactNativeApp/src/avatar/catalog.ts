import { findPet } from './pets';
import { type AvatarConfig, DEFAULT_AVATAR } from './types';

// Metro needs every require() written out literally; you cannot build the
// path from a string at runtime. So each item is listed once here.
// To add an item: drop the 32 x 56 PNG in assets/avatar/ and add a line.

export type Slot =
  | 'face'
  | 'hair'
  | 'top'
  | 'bottom'
  | 'shoes'
  | 'hat'
  | 'glasses'
  | 'cape'
  | 'hand'
  | 'outfit';
// image is drawn in the item's place; back (if any) behind the body.
type Item = { id: string; label: string; image?: number; back?: number };

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

    { id: 'face_joy', label: 'Joyful', image: require('@/assets/avatar/face_joy.png') },
    {
      id: 'face_surprised',
      label: 'Surprised',
      image: require('@/assets/avatar/face_surprised.png'),
    },
    { id: 'face_sleepy', label: 'Sleepy', image: require('@/assets/avatar/face_sleepy.png') },
    { id: 'face_starry', label: 'Starry eyes', image: require('@/assets/avatar/face_starry.png') },
    { id: 'face_cat', label: 'Cat smile', image: require('@/assets/avatar/face_cat.png') },  ],
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

    {
      id: 'hair_bob',
      label: 'Bob',
      image: require('@/assets/avatar/hair_bob.png'),
      back: require('@/assets/avatar/hair_bob_back.png'),
    },
    {
      id: 'hair_twintails',
      label: 'Twin tails',
      image: require('@/assets/avatar/hair_twintails.png'),
      back: require('@/assets/avatar/hair_twintails_back.png'),
    },
    {
      id: 'hair_afro',
      label: 'Afro',
      image: require('@/assets/avatar/hair_afro.png'),
      back: require('@/assets/avatar/hair_afro_back.png'),
    },
    { id: 'hair_mohawk', label: 'Mohawk', image: require('@/assets/avatar/hair_mohawk.png') },
    { id: 'hair_bun', label: 'Top bun', image: require('@/assets/avatar/hair_bun.png') },
    {
      id: 'hair_wavy',
      label: 'Long waves',
      image: require('@/assets/avatar/hair_wavy.png'),
      back: require('@/assets/avatar/hair_wavy_back.png'),
    },  ],
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

    {
      id: 'top_stripe_navy',
      label: 'Striped shirt',
      image: require('@/assets/avatar/top_stripe_navy.png'),
    },
    { id: 'top_blazer', label: 'School blazer', image: require('@/assets/avatar/top_blazer.png') },
    {
      id: 'top_tank_orange',
      label: 'Orange tank',
      image: require('@/assets/avatar/top_tank_orange.png'),
    },
    {
      id: 'top_varsity',
      label: 'Varsity jacket',
      image: require('@/assets/avatar/top_varsity.png'),
    },
    { id: 'top_aloha', label: 'Aloha shirt', image: require('@/assets/avatar/top_aloha.png') },
    {
      id: 'top_puffer_purple',
      label: 'Puffer jacket',
      image: require('@/assets/avatar/top_puffer_purple.png'),
    },  ],
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

    {
      id: 'bottom_cargo_khaki',
      label: 'Cargo shorts',
      image: require('@/assets/avatar/bottom_cargo_khaki.png'),
    },
    {
      id: 'bottom_skirt_plaid',
      label: 'Plaid skirt',
      image: require('@/assets/avatar/bottom_skirt_plaid.png'),
    },
    {
      id: 'bottom_track_red',
      label: 'Track pants',
      image: require('@/assets/avatar/bottom_track_red.png'),
    },
    {
      id: 'bottom_pants_white',
      label: 'White pants',
      image: require('@/assets/avatar/bottom_pants_white.png'),
    },  ],
  shoes: [
    { id: 'shoes_white', label: 'White sneakers', image: require('@/assets/avatar/shoes_white.png') },
    { id: 'shoes_red', label: 'Red sneakers', image: require('@/assets/avatar/shoes_red.png') },
    {
      id: 'shoes_boots_brown',
      label: 'Brown boots',
      image: require('@/assets/avatar/shoes_boots_brown.png'),
    },

    {
      id: 'shoes_rain_yellow',
      label: 'Rain boots',
      image: require('@/assets/avatar/shoes_rain_yellow.png'),
    },
    {
      id: 'shoes_hightop_black',
      label: 'High-tops',
      image: require('@/assets/avatar/shoes_hightop_black.png'),
    },
    { id: 'shoes_sandals', label: 'Sandals', image: require('@/assets/avatar/shoes_sandals.png') },
    { id: 'shoes_gold', label: 'Gold sneakers', image: require('@/assets/avatar/shoes_gold.png') },
    {
      id: 'shoes_running_blue',
      label: 'Running shoes',
      image: require('@/assets/avatar/shoes_running_blue.png'),
    },
    { id: 'shoes_cowboy', label: 'Cowboy boots', image: require('@/assets/avatar/shoes_cowboy.png') },
    {
      id: 'shoes_slippers_bunny',
      label: 'Bunny slippers',
      image: require('@/assets/avatar/shoes_slippers_bunny.png'),
    },
    {
      id: 'shoes_clogs_green',
      label: 'Green clogs',
      image: require('@/assets/avatar/shoes_clogs_green.png'),
    },
    {
      id: 'shoes_skates_pink',
      label: 'Roller skates',
      image: require('@/assets/avatar/shoes_skates_pink.png'),
    },
    { id: 'shoes_rocket', label: 'Rocket boots', image: require('@/assets/avatar/shoes_rocket.png') },  ],
  hat: [
    { id: 'hat_beanie_teal', label: 'Teal beanie', image: require('@/assets/avatar/hat_beanie_teal.png') },
    { id: 'hat_cap_red', label: 'Red cap', image: require('@/assets/avatar/hat_cap_red.png') },
    { id: 'hat_crown_gold', label: 'Gold crown', image: require('@/assets/avatar/hat_crown_gold.png') },

    { id: 'hat_bunny', label: 'Bunny ears', image: require('@/assets/avatar/hat_bunny.png') },
    { id: 'hat_cat', label: 'Cat ears', image: require('@/assets/avatar/hat_cat.png') },
    { id: 'hat_witch', label: 'Witch hat', image: require('@/assets/avatar/hat_witch.png') },
    { id: 'hat_tophat', label: 'Top hat', image: require('@/assets/avatar/hat_tophat.png') },
    { id: 'hat_halo', label: 'Halo', image: require('@/assets/avatar/hat_halo.png') },
    { id: 'hat_flowers', label: 'Flower crown', image: require('@/assets/avatar/hat_flowers.png') },
    {
      id: 'hat_headphones',
      label: 'Headphones',
      image: require('@/assets/avatar/hat_headphones.png'),
    },
    {
      id: 'hat_propeller',
      label: 'Propeller cap',
      image: require('@/assets/avatar/hat_propeller.png'),
    },  ],
  // Face accessories, over the eyes
  glasses: [
    {
      id: 'glasses_round',
      label: 'Round glasses',
      image: require('@/assets/avatar/glasses_round.png'),
    },
    { id: 'glasses_shades', label: 'Shades', image: require('@/assets/avatar/glasses_shades.png') },
    {
      id: 'glasses_star',
      label: 'Star shades',
      image: require('@/assets/avatar/glasses_star.png'),
    },
    {
      id: 'glasses_heart',
      label: 'Heart shades',
      image: require('@/assets/avatar/glasses_heart.png'),
    },
    {
      id: 'glasses_eyepatch',
      label: 'Eyepatch',
      image: require('@/assets/avatar/glasses_eyepatch.png'),
    },
    {
      id: 'glasses_mask',
      label: 'Masquerade mask',
      image: require('@/assets/avatar/glasses_mask.png'),
    },
  ],
  // Capes and wings: back is drawn behind the body, image (a clasp) in front
  cape: [
    {
      id: 'cape_red',
      label: 'Red cape',
      image: require('@/assets/avatar/cape_red.png'),
      back: require('@/assets/avatar/cape_red_back.png'),
    },
    {
      id: 'cape_royal',
      label: 'Royal cape',
      image: require('@/assets/avatar/cape_royal.png'),
      back: require('@/assets/avatar/cape_royal_back.png'),
    },
    {
      id: 'wings_angel',
      label: 'Angel wings',
      back: require('@/assets/avatar/wings_angel_back.png'),
    },
    { id: 'wings_bat', label: 'Bat wings', back: require('@/assets/avatar/wings_bat_back.png') },
    {
      id: 'wings_fairy',
      label: 'Fairy wings',
      back: require('@/assets/avatar/wings_fairy_back.png'),
    },
  ],
  // Held in the hand on the left
  hand: [
    {
      id: 'hand_balloon',
      label: 'Heart balloon',
      image: require('@/assets/avatar/hand_balloon.png'),
    },
    { id: 'hand_umbrella', label: 'Parasol', image: require('@/assets/avatar/hand_umbrella.png') },
    { id: 'hand_sword', label: 'Toy sword', image: require('@/assets/avatar/hand_sword.png') },
    { id: 'hand_wand', label: 'Star wand', image: require('@/assets/avatar/hand_wand.png') },
    { id: 'hand_lollipop', label: 'Lollipop', image: require('@/assets/avatar/hand_lollipop.png') },
    { id: 'hand_lantern', label: 'Lantern', image: require('@/assets/avatar/hand_lantern.png') },
  ],
  // One-piece outfits: drawn instead of the top and bottom
  outfit: [
    {
      id: 'outfit_sailor',
      label: 'Sailor uniform',
      image: require('@/assets/avatar/outfit_sailor.png'),
    },
    { id: 'outfit_tuxedo', label: 'Tuxedo', image: require('@/assets/avatar/outfit_tuxedo.png') },
    {
      id: 'outfit_wizard',
      label: 'Wizard robe',
      image: require('@/assets/avatar/outfit_wizard.png'),
    },
    {
      id: 'outfit_knight',
      label: 'Knight armor',
      image: require('@/assets/avatar/outfit_knight.png'),
    },
    {
      id: 'outfit_pajamas',
      label: 'Pajamas',
      image: require('@/assets/avatar/outfit_pajamas.png'),
    },
    {
      id: 'outfit_dress',
      label: 'Party dress',
      image: require('@/assets/avatar/outfit_dress.png'),
    },
  ],
};

/** Slots that can be set to "None". */
export const OPTIONAL_SLOTS: ReadonlySet<Slot> = new Set([
  'hair',
  'hat',
  'glasses',
  'cape',
  'hand',
  'outfit',
]);

/**
 * The change for wearing `id` in `slot`. An outfit replaces the top and
 * bottom, so choosing a top or bottom takes the outfit off.
 */
export function wear(slot: Slot, id: string | null): Partial<AvatarConfig> {
  return slot === 'top' || slot === 'bottom' ? { [slot]: id, outfit: null } : { [slot]: id };
}

export function findItem(slot: Slot, id: string | null | undefined) {
  if (!id) return undefined;
  return CATALOG[slot].find((i) => i.id === id);
}

/**
 * Every sprite drawn for this character, in no particular order. Keep in
 * step with the layers in Avatar.tsx.
 */
export function wornLayers(config: AvatarConfig): number[] {
  const hair = findItem('hair', config.hair);
  const cape = findItem('cape', config.cape);
  const outfit = findItem('outfit', config.outfit);
  const layers = [
    cape?.back,
    hair?.back,
    BODY,
    outfit ? undefined : findItem('bottom', config.bottom)?.image,
    findItem('shoes', config.shoes)?.image,
    outfit ? outfit.image : findItem('top', config.top)?.image,
    findItem('face', config.face)?.image,
    findItem('glasses', config.glasses)?.image,
    hair?.image,
    findItem('hat', config.hat)?.image,
    cape?.image,
    findItem('hand', config.hand)?.image,
  ];
  return layers.filter((l): l is number => l !== undefined);
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
    glasses: pick('glasses'),
    cape: pick('cape'),
    hand: pick('hand'),
    outfit: pick('outfit'),
    pet: typeof a.pet === 'string' && findPet(a.pet) ? a.pet : null,
  };
}
