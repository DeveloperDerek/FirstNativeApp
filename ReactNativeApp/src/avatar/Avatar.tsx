import {
  BlendColor,
  Canvas,
  FilterMode,
  Image,
  loadData,
  MipmapMode,
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
const CRISP = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

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

function useSprite(source: number | undefined): SkImage | null {
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
function Layer({ source, scale, tint }: { source: number | undefined; scale: number; tint?: string }) {
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
};

export function Avatar({ config, scale = 4, accessibilityLabel = 'Character' }: AvatarProps) {
  const hair = findItem('hair', config.hair);
  const cape = findItem('cape', config.cape);
  // A one-piece outfit is drawn instead of the top and bottom
  const outfit = findItem('outfit', config.outfit);
  return (
    <Canvas
      style={{ width: SPRITE_W * scale, height: SPRITE_H * scale }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}>
      {/* Back to front */}
      <Layer source={cape?.back} scale={scale} />
      <Layer source={hair?.back} scale={scale} tint={config.hairColor} />
      <Layer source={BODY} scale={scale} tint={config.skin} />
      {!outfit && <Layer source={findItem('bottom', config.bottom)?.image} scale={scale} />}
      <Layer source={findItem('shoes', config.shoes)?.image} scale={scale} />
      <Layer source={outfit ? outfit.image : findItem('top', config.top)?.image} scale={scale} />
      <Layer source={findItem('face', config.face)?.image} scale={scale} />
      <Layer source={findItem('glasses', config.glasses)?.image} scale={scale} />
      <Layer source={hair?.image} scale={scale} tint={config.hairColor} />
      <Layer source={findItem('hat', config.hat)?.image} scale={scale} />
      <Layer source={cape?.image} scale={scale} />
      <Layer source={findItem('hand', config.hand)?.image} scale={scale} />
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
