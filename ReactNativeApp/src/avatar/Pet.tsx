import { PixelSprite } from './Avatar';
import { findPet, PET_SIZE } from './pets';

/** A pet standing still (first walk frame). Draws nothing for no pet. */
export function Pet({
  id,
  scale = 3,
  frame = 0,
}: {
  id: string | null;
  /** Whole number, like Avatar. */
  scale?: number;
  frame?: 0 | 1;
}) {
  const pet = findPet(id);
  if (!pet) return null;
  return (
    <PixelSprite
      source={pet.frames[frame]}
      width={PET_SIZE}
      height={PET_SIZE}
      scale={scale}
      accessibilityLabel={pet.label}
    />
  );
}
