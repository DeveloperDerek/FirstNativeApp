import {
  BlendColor,
  Canvas,
  ColorMatrix,
  FilterMode,
  Group,
  Image,
  loadData,
  MipmapMode,
  Paint,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';

import { BODY, findItem } from './catalog';
import type { AvatarConfig } from './types';

export const SPRITE_W = 32;
// 48 rows of character plus 8 rows of headroom above it for tall hats
export const SPRITE_H = 56;
export const HEADROOM = 8;
// Nearest-neighbor sampling keeps pixel art crisp when scaled up.
export const CRISP = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

// Each sprite is decoded once and shared by every character on screen,
// so a leaderboard of 20 people doesn't decode 160 images.
const decoded = new Map<number, Promise<SkImage | null>>();

export function loadSprite(source: number) {
  let promise = decoded.get(source);
  if (!promise) {
    promise = loadData(source, (data) => Skia.Image.MakeImageFromEncoded(data));
    decoded.set(source, promise);
  }
  return promise;
}

export function useSprite(source: number | undefined): SkImage | null {
  // Kept in state (not read from the cache during render) so the React
  // Compiler re-renders when the image arrives.
  const [loaded, setLoaded] = useState<{ source: number; image: SkImage | null } | null>(null);

  useEffect(() => {
    if (source === undefined) return;
    let alive = true;
    loadSprite(source).then((image) => {
      if (alive) setLoaded({ source, image });
    });
    return () => {
      alive = false;
    };
  }, [source]);

  return loaded && loaded.source === source ? loaded.image : null;
}

// One sprite layer. tint multiplies a grayscale sprite by a color.
// Also drawn in pieces by WalkingAvatar.
export function Layer({ source, scale, tint }: { source: number | undefined; scale: number; tint?: string }) {
  const image = useSprite(source);
  if (!image) return null;
  return (
    <Image
      image={image}
      x={0}
      y={0}
      width={SPRITE_W * scale}
      height={SPRITE_H * scale}
      fit="fill"
      sampling={CRISP}>
      {tint ? <BlendColor color={tint} mode="modulate" /> : null}
    </Image>
  );
}

type AvatarProps = {
  config: AvatarConfig;
  /** Must be a whole number (1, 2, 3...) or the pixels look uneven. */
  scale?: number;
  /** Read by screen readers, e.g. "Sam's character". */
  accessibilityLabel?: string;
  /** A color matrix that puts the character in the map's light (see track/lighting) */
  light?: number[];
};

export function Avatar({ config, scale = 4, accessibilityLabel = 'Character', light }: AvatarProps) {
  const hair = findItem('hair', config.hair);
  const cape = findItem('cape', config.cape);
  // A one-piece outfit is drawn instead of the top and bottom
  const outfit = findItem('outfit', config.outfit);
  const hand = findItem('hand', config.hand);
  return (
    <Canvas
      style={{ width: SPRITE_W * scale, height: SPRITE_H * scale }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}>
      {/* The whole character goes through the light together, so the tints
          and layers stay as they are relative to each other */}
      <Group
        layer={
          light ? (
            <Paint>
              <ColorMatrix matrix={light} />
            </Paint>
          ) : undefined
        }>
        {/* Back to front */}
        <Layer source={cape?.back} scale={scale} />
        <Layer source={hair?.back} scale={scale} tint={config.hairColor} />
        <Layer source={hand?.back} scale={scale} />
        <Layer source={BODY} scale={scale} tint={config.skin} />
        {!outfit && <Layer source={findItem('bottom', config.bottom)?.image} scale={scale} />}
        <Layer source={findItem('shoes', config.shoes)?.image} scale={scale} />
        <Layer source={outfit ? outfit.image : findItem('top', config.top)?.image} scale={scale} />
        <Layer source={findItem('face', config.face)?.image} scale={scale} />
        <Layer source={findItem('glasses', config.glasses)?.image} scale={scale} />
        <Layer source={hair?.image} scale={scale} tint={config.hairColor} />
        <Layer source={findItem('hat', config.hat)?.image} scale={scale} />
        <Layer source={cape?.image} scale={scale} />
        <Layer source={hand?.image} scale={scale} />
      </Group>
    </Canvas>
  );
}

/** A single pixel-art image (e.g. the goal flag), scaled crisply. */
export function PixelSprite({
  source,
  width,
  height,
  scale = 2,
  accessibilityLabel,
}: {
  source: number;
  /** Size of the PNG in pixels. */
  width: number;
  height: number;
  /** Whole number, like Avatar. */
  scale?: number;
  accessibilityLabel?: string;
}) {
  const image = useSprite(source);
  return (
    <Canvas
      style={{ width: width * scale, height: height * scale }}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}>
      {image && (
        <Image
          image={image}
          x={0}
          y={0}
          width={width * scale}
          height={height * scale}
          fit="fill"
          sampling={CRISP}
        />
      )}
    </Canvas>
  );
}

/** Sprite rows a HeadIcon shows: the headroom and the head, down to the chin. */
export const HEAD_ROWS = HEADROOM + 26;

/**
 * Just the head: hair, face, glasses and hat, cropped from the top of
 * the sprite, for small markers like Today's minimap. Capes and held
 * items are left out so they don't stick into the next icon.
 */
export function HeadIcon({
  config,
  scale = 1,
  accessibilityLabel,
}: {
  config: AvatarConfig;
  /** Whole number, like Avatar. */
  scale?: number;
  accessibilityLabel?: string;
}) {
  const hair = findItem('hair', config.hair);
  return (
    <Canvas
      style={{ width: SPRITE_W * scale, height: HEAD_ROWS * scale }}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}>
      <Layer source={hair?.back} scale={scale} tint={config.hairColor} />
      <Layer source={BODY} scale={scale} tint={config.skin} />
      <Layer source={findItem('face', config.face)?.image} scale={scale} />
      <Layer source={findItem('glasses', config.glasses)?.image} scale={scale} />
      <Layer source={hair?.image} scale={scale} tint={config.hairColor} />
      <Layer source={findItem('hat', config.hat)?.image} scale={scale} />
    </Canvas>
  );
}
