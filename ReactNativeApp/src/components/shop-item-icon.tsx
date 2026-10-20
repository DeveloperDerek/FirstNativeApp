import { Image, StyleSheet, View } from 'react-native';

import { ItemIcon } from '@/avatar/ItemIcon';
import { Pet } from '@/avatar/Pet';
import type { AvatarConfig } from '@/avatar/types';
import { useBlankWarning } from '@/avatar/blank-warning';
import { findShopEntry } from '@/lib/shop-entries';

// The same size as an achievement badge at scale 2, so a line with an
// item lines up with the others
const SIZE = 44;
// The shop's map thumbnail (64 x 96 onto a 512 x 160 tile), scaled to fit
const MAP_K = SIZE / 96;

/**
 * A shop item on its own: the clothing piece, the pet, or a window onto
 * the map. Hair and faces in the buyer's colors. Nothing for an id this
 * app doesn't know.
 */
export function ShopItemIcon({
  id,
  wearer,
  accessibilityLabel,
}: {
  id: string;
  /** The buyer's character, for the hair or skin color */
  wearer: AvatarConfig;
  accessibilityLabel: string;
}) {
  const entry = findShopEntry(id);
  useBlankWarning(!entry, `${id} (not in this app's shop)`);
  if (!entry) return null;
  if (entry.kind === 'clothing') {
    return (
      <ItemIcon
        slot={entry.slot}
        id={id}
        color={entry.slot === 'face' ? wearer.skin : wearer.hairColor}
        size={SIZE}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }
  if (entry.kind === 'pet') {
    return (
      <View style={styles.box} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        <Pet id={id} scale={2} />
      </View>
    );
  }
  return (
    <View
      style={[styles.box, styles.map, { backgroundColor: entry.sky }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}>
      <Image
        source={entry.tile}
        style={styles.mapTile}
        resizeMode="stretch"
        onError={() => __DEV__ && console.warn(`Blank icon: ${id} (map art failed to load)`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  map: {
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#2a1a1a',
    overflow: 'hidden',
  },
  mapTile: {
    position: 'absolute',
    bottom: 0,
    left: -40 * MAP_K,
    width: 512 * MAP_K,
    height: 160 * MAP_K,
  },
});
