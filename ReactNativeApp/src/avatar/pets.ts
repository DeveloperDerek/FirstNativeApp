// Pets walk beside the character instead of being drawn on it, so they
// have their own small sprites: 16 x 16, facing right (the way the
// character walks on the player card), with two frames for the walk.
// To add a pet: drop name_a.png and name_b.png in assets/pets/ and add a
// line. A paid pet also needs a row in shop_items.

export const PET_SIZE = 16;

export type Pet = { id: string; label: string; frames: [number, number] };

export const PETS: Pet[] = [
  {
    id: 'pet_cat',
    label: 'Cat',
    frames: [require('@/assets/pets/cat_a.png'), require('@/assets/pets/cat_b.png')],
  },
  {
    // Drawn as a fluffy white Samoyed: round head, small ears, plume tail
    // curled over the back, chest ruff and shaggy belly
    id: 'pet_dog',
    label: 'Dog',
    frames: [require('@/assets/pets/dog_a.png'), require('@/assets/pets/dog_b.png')],
  },
  {
    id: 'pet_slime',
    label: 'Slime',
    frames: [require('@/assets/pets/slime_a.png'), require('@/assets/pets/slime_b.png')],
  },
  {
    id: 'pet_snail',
    label: 'Snail',
    frames: [require('@/assets/pets/snail_a.png'), require('@/assets/pets/snail_b.png')],
  },
  {
    id: 'pet_mushroom',
    label: 'Mushroom',
    frames: [require('@/assets/pets/mushroom_a.png'), require('@/assets/pets/mushroom_b.png')],
  },
  {
    id: 'pet_pig',
    label: 'Pig',
    frames: [require('@/assets/pets/pig_a.png'), require('@/assets/pets/pig_b.png')],
  },
  {
    id: 'pet_stump',
    label: 'Stump',
    frames: [require('@/assets/pets/stump_a.png'), require('@/assets/pets/stump_b.png')],
  },
  {
    // Big fringed ears, cream chest and back legs, dark tail tip
    id: 'pet_fox',
    label: 'Fox',
    frames: [require('@/assets/pets/fox_a.png'), require('@/assets/pets/fox_b.png')],
  },
];

export function findPet(id: string | null | undefined) {
  if (!id) return undefined;
  return PETS.find((p) => p.id === id);
}
