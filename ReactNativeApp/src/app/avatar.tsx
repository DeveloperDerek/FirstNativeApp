import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { saveAvatar } from '@/api/avatar';
import { coinErrorMessage, listOwnedItems, listShopPrices } from '@/api/coins';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar } from '@/avatar/Avatar';
import { CATALOG, OPTIONAL_SLOTS, type Slot } from '@/avatar/catalog';
import { type AvatarConfig, DEFAULT_AVATAR, HAIR_COLORS, SKIN_TONES } from '@/avatar/types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const SLOTS: { slot: Slot; title: string }[] = [
  { slot: 'hair', title: 'Hair' },
  { slot: 'face', title: 'Face' },
  { slot: 'top', title: 'Top' },
  { slot: 'bottom', title: 'Bottom' },
  { slot: 'shoes', title: 'Shoes' },
  { slot: 'hat', title: 'Hat' },
];

function Swatches({
  colors,
  value,
  onPick,
  label,
}: {
  colors: string[];
  value: string;
  onPick: (c: string) => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      {colors.map((c, i) => (
        <Pressable
          key={c}
          onPress={() => onPick(c)}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${i + 1}`}
          accessibilityState={{ selected: value === c }}
          style={[
            styles.swatch,
            { backgroundColor: c, borderColor: value === c ? theme.accent : theme.backgroundSelected },
            value === c && styles.swatchSelected,
          ]}
        />
      ))}
    </View>
  );
}

/** A choice shown as a small preview of the character wearing it. */
function Tile({
  preview,
  label,
  selected,
  lockedPrice,
  onPress,
}: {
  preview: AvatarConfig;
  label: string;
  selected: boolean;
  /** Set for shop items the user doesn't own yet. */
  lockedPrice?: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const locked = lockedPrice !== undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityLabel={locked ? `${label}, locked, ${lockedPrice} coins in the shop` : label}
      accessibilityState={{ selected, disabled: locked }}
      style={({ pressed }) => [pressed && styles.pressed]}>
      <ThemedView
        type={selected ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.tile, { borderColor: selected ? theme.accent : 'transparent' }]}>
        <View style={locked && styles.locked}>
          <Avatar config={preview} scale={2} accessibilityLabel={label} />
        </View>
        <ThemedText type="small" numberOfLines={1} style={styles.tileLabel}>
          {label}
        </ThemedText>
        {locked && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            🔒 {lockedPrice.toLocaleString()}
          </ThemedText>
        )}
      </ThemedView>
    </Pressable>
  );
}

export default function AvatarEditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, profile, reloadProfile } = useAuth();
  const [avatar, setAvatar] = useState<AvatarConfig>(profile?.avatar ?? DEFAULT_AVATAR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [owned, setOwned] = useState<Set<string>>(new Set());

  // Load prices and owned items, then lock what the user cannot wear.
  // Reloads when returning from the Shop so new purchases unlock.
  useFocusEffect(
    useCallback(() => {
      listShopPrices().then(setPrices).catch(() => {});
      listOwnedItems().then(setOwned).catch(() => {});
    }, [])
  );

  // Free starter items are not in the shop table at all. Even if this
  // check had a bug, the database trigger would reject the save.
  const lockedPrice = (id: string) => (owned.has(id) ? undefined : prices[id]);

  const set = (patch: Partial<AvatarConfig>) => setAvatar((a) => ({ ...a, ...patch }));

  async function save() {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      await saveAvatar(session.user.id, avatar);
      await reloadProfile();
      router.back();
    } catch (e) {
      setError(coinErrorMessage(e, 'Could not save your character. Try again.'));
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      {/* Big preview stays put while the options scroll underneath */}
      <ThemedView type="backgroundElement" style={[styles.preview, { paddingTop: Spacing.four }]}>
        <Avatar config={avatar} scale={4} accessibilityLabel="Your character" />
      </ThemedView>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.four },
        ]}>
        <View style={styles.inner}>
          <ThemedText type="smallBold">Skin</ThemedText>
          <Swatches
            colors={SKIN_TONES}
            value={avatar.skin}
            onPick={(skin) => set({ skin })}
            label="Skin tone"
          />

          <ThemedText type="smallBold">Hair color</ThemedText>
          <Swatches
            colors={HAIR_COLORS}
            value={avatar.hairColor}
            onPick={(hairColor) => set({ hairColor })}
            label="Hair color"
          />

          {SLOTS.map(({ slot, title }) => (
            <View key={slot} style={styles.slot}>
              <ThemedText type="smallBold">{title}</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.row}>
                  {OPTIONAL_SLOTS.has(slot) && (
                    <Tile
                      label="None"
                      preview={{ ...avatar, [slot]: null }}
                      selected={avatar[slot] === null}
                      onPress={() => set({ [slot]: null })}
                    />
                  )}
                  {CATALOG[slot].map((item) => (
                    <Tile
                      key={item.id}
                      label={item.label}
                      preview={{ ...avatar, [slot]: item.id }}
                      selected={avatar[slot] === item.id}
                      lockedPrice={lockedPrice(item.id)}
                      onPress={() => set({ [slot]: item.id })}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          ))}

          <ThemedText type="small" themeColor="textSecondary">
            Locked items can be bought with coins in the Shop. Each day it offers a different
            selection.
          </ThemedText>
          <Button title="Open the Shop" variant="secondary" onPress={() => router.push('/shop')} />

          {error && (
            <ThemedText type="small" themeColor="danger">
              {error}
            </ThemedText>
          )}
          <View style={styles.buttons}>
            <Button title="Save" onPress={save} loading={saving} />
            <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  preview: {
    alignItems: 'center',
    paddingBottom: Spacing.three,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  inner: {
    flex: 1,
    maxWidth: MaxContentWidth,
    gap: Spacing.two,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
  },
  swatchSelected: {
    borderWidth: 4,
  },
  slot: {
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tile: {
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 2,
    width: 88,
  },
  tileLabel: {
    marginTop: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
  locked: {
    opacity: 0.35,
  },
  buttons: {
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
});
