import { Image } from 'expo-image';
import { View } from 'react-native';

import { BODY, findItem } from './catalog';
import type { AvatarConfig } from './types';

const SPRITE_W = 32;
const SPRITE_H = 48;

// Web fallback: Skia on web needs CanvasKit loaded first, which this app
// doesn't set up. Stack the layers as plain images instead. Body and hair
// show untinted (gray) here; the native Avatar.tsx is the real one.
export function Avatar({
  config,
  scale = 4,
  accessibilityLabel = 'Character',
}: {
  config: AvatarConfig;
  scale?: number;
  accessibilityLabel?: string;
}) {
  const hair = findItem('hair', config.hair);
  const layers = [
    hair?.back,
    BODY,
    findItem('bottom', config.bottom)?.image,
    findItem('shoes', config.shoes)?.image,
    findItem('top', config.top)?.image,
    findItem('face', config.face)?.image,
    hair?.image,
    findItem('hat', config.hat)?.image,
  ];
  const size = { width: SPRITE_W * scale, height: SPRITE_H * scale };
  return (
    <View style={size} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {layers.map((source, i) =>
        source ? (
          <Image
            key={i}
            source={source}
            style={[size, { position: 'absolute' }]}
            contentFit="fill"
          />
        ) : null
      )}
    </View>
  );
}

/** Web fallback for the native PixelSprite. */
export function PixelSprite({
  source,
  width,
  height,
  scale = 2,
  accessibilityLabel,
}: {
  source: number;
  width: number;
  height: number;
  scale?: number;
  accessibilityLabel?: string;
}) {
  return (
    <Image
      source={source}
      style={{ width: width * scale, height: height * scale }}
      contentFit="fill"
      accessibilityLabel={accessibilityLabel}
    />
  );
}
