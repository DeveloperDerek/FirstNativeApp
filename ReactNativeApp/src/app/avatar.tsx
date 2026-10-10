import { useFocusEffect, useRouter } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { saveAvatar } from '@/api/avatar';
import { coinErrorMessage, listOwnedItemsInOrder, listShopPrices } from '@/api/coins';
import { getItemOrder, saveItemOrder } from '@/api/itemOrder';
import { useAuth } from '@/auth/AuthProvider';
import { ItemIcon } from '@/avatar/ItemIcon';
import { CATALOG, findItem, OPTIONAL_SLOTS, type Slot, wear } from '@/avatar/catalog';
import { applyItemOrder, mergeRowOrder } from '@/avatar/item-order';
import { Pet } from '@/avatar/Pet';
import { findPet, PETS } from '@/avatar/pets';
import { type AvatarConfig, DEFAULT_AVATAR, HAIR_COLORS, SKIN_TONES } from '@/avatar/types';
import { DraggableRow, HOLD_MS } from '@/components/draggable-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WalkingScene } from '@/components/walking-scene';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useMapTheme } from '@/hooks/use-map-theme';
import { useTheme } from '@/hooks/use-theme';
import { THEME_LIST } from '@/track/themes';

/** Picks out the items someone can use, in the order they arranged them. */
type Collection = <T extends { id: string }>(items: T[]) => T[];

const TILE_WIDTH = 88;

/** How a row of tiles talks back to the screen while being rearranged. */
type Arrange = {
  dragging: boolean;
  onDragChange: (dragging: boolean) => void;
  onReorder: (ids: string[]) => void;
};

/** A sideways-scrolling row of tiles the user can drag into any order. */
function ItemRow<T extends { id: string }>({
  items,
  leading,
  renderItem,
  arrange,
}: {
  items: T[];
  leading?: ReactNode;
  renderItem: (item: T) => ReactNode;
  arrange: Arrange;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={!arrange.dragging}>
      <DraggableRow
        items={items}
        itemWidth={TILE_WIDTH}
        gap={Spacing.two}
        leading={leading}
        renderItem={renderItem}
        onReorder={arrange.onReorder}
        onDragChange={arrange.onDragChange}
      />
    </ScrollView>
  );
}

const SLOTS: { slot: Slot; title: string }[] = [
  { slot: 'hair', title: 'Hair' },
  { slot: 'face', title: 'Face' },
  { slot: 'glasses', title: 'Face accessory' },
  { slot: 'hat', title: 'Hat' },
  { slot: 'outfit', title: 'Outfit' },
  { slot: 'top', title: 'Top' },
  { slot: 'bottom', title: 'Bottom' },
  { slot: 'shoes', title: 'Shoes' },
  { slot: 'cape', title: 'Cape and wings' },
  { slot: 'hand', title: 'Held item' },
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
            {
              backgroundColor: c,
              borderColor: value === c ? theme.accent : theme.backgroundSelected,
            },
            value === c && styles.swatchSelected,
          ]}
        />
      ))}
    </View>
  );
}

/** A choice shown as a small preview, e.g. the character wearing it. The
 * name only appears in the section heading once it is picked. */
function Tile({
  children,
  label,
  selected,
  onPress,
}: {
  children: ReactNode;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // Holding a tile starts a drag (DraggableRow); without this the
      // release at the end of the drag would also count as a tap
      onLongPress={() => {}}
      delayLongPress={HOLD_MS}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [pressed && styles.pressed]}>
      <ThemedView
        type={selected ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.tile, { borderColor: selected ? theme.accent : 'transparent' }]}>
        {children}
      </ThemedView>
    </Pressable>
  );
}

/**
 * The map drawn behind every page. Unlike the character it is not part of
 * the autosave: picking one saves it straight away (useMapTheme).
 */
function BackgroundPicker({ mine, arrange }: { mine: Collection; arrange: Arrange }) {
  const { theme, pickTheme } = useMapTheme();
  return (
    <View style={styles.slot}>
      <ThemedText type="smallBold">
        Background
        <ThemedText type="small" themeColor="textSecondary">
          {'  '}
          {theme.label}
        </ThemedText>
      </ThemedText>
      <ItemRow
        items={mine(THEME_LIST)}
        arrange={arrange}
        renderItem={(t) => (
          <Tile label={t.label} selected={t.id === theme.id} onPress={() => pickTheme(t.id)}>
            {/* The map's sky over its ground */}
            <View style={styles.mapSwatch}>
              <View style={{ flex: 3, backgroundColor: t.sky }} />
              <View style={{ flex: 2, backgroundColor: t.ground }} />
            </View>
          </Tile>
        )}
      />
    </View>
  );
}

export default function AvatarEditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { theme: mapTheme } = useMapTheme();
  const { session, profile, reloadProfile } = useAuth();
  const [avatar, setAvatar] = useState<AvatarConfig>(profile?.avatar ?? DEFAULT_AVATAR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<{
    prices: Record<string, number>;
    owned: string[];
    order: string[];
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Load prices and owned items: only what the user can wear is shown.
  // Reloads when returning from the Shop so new purchases appear.
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      Promise.all([
        listShopPrices(),
        listOwnedItemsInOrder(),
        // Only the arrangement: without it items show in their default order
        getItemOrder(session.user.id).catch(() => []),
      ])
        .then(([prices, owned, order]) => setItems({ prices, owned, order }))
        .catch(() => setError("Couldn't load your items. Try again."));
    }, [session])
  );

  // Free starter items (not in the shop table at all) come first, in
  // catalog order, then owned items in the order they were bought; any
  // the user has dragged into place go before both, in that order. Even
  // if this had a bug, the database trigger would reject the save.
  const mine: Collection = (list) => {
    if (!items) return [];
    const free = list.filter((x) => items.prices[x.id] === undefined);
    const bought = items.owned.flatMap((id) => list.filter((x) => x.id === id));
    return applyItemOrder([...free, ...bought], items.order);
  };

  // A dropped tile: show the new order straight away, then save it
  const reorder = (rowIds: string[]) => {
    if (!items || !session) return;
    const order = mergeRowOrder(items.order, rowIds);
    if (order.join() === items.order.join()) return;
    setItems({ ...items, order });
    saveItemOrder(session.user.id, order).catch(() =>
      setError("Couldn't save the new order. Try again.")
    );
  };
  const arrange: Arrange = {
    dragging,
    onDragChange: setDragging,
    onReorder: reorder,
  };

  const set = (patch: Partial<AvatarConfig>) => setAvatar((a) => ({ ...a, ...patch }));

  // Every change saves on its own after a short pause, so tapping through
  // colors doesn't send one save per tap. Saves run one at a time, in order.
  const lastSaved = useRef(JSON.stringify(avatar));
  const pending = useRef<AvatarConfig | null>(null);
  const queue = useRef(Promise.resolve());

  const flush = useCallback(() => {
    const next = pending.current;
    pending.current = null;
    if (!next || !session) return;
    queue.current = queue.current.then(async () => {
      const key = JSON.stringify(next);
      if (key === lastSaved.current) return;
      setSaving(true);
      try {
        await saveAvatar(session.user.id, next);
        lastSaved.current = key;
        setError(null);
        await reloadProfile();
      } catch (e) {
        setError(coinErrorMessage(e, 'Could not save your character. Try again.'));
      } finally {
        setSaving(false);
      }
    });
  }, [session, reloadProfile]);

  useEffect(() => {
    if (JSON.stringify(avatar) === lastSaved.current) return;
    pending.current = avatar;
    const timer = setTimeout(flush, 400);
    return () => clearTimeout(timer);
  }, [avatar, flush]);

  // Closing the editor before the pause ends still saves the last change.
  useEffect(() => () => flush(), [flush]);

  return (
    <ThemedView style={styles.container}>
      {/* Big preview stays put while the options scroll underneath: the
          character walking through your map, as on the player card */}
      <WalkingScene
        theme={mapTheme}
        avatar={avatar}
        label="Your character"
        width={windowWidth}
        scale={4}
      />
      <View style={[styles.status, { backgroundColor: mapTheme.ground }]}>
        <ThemedText type="small" style={{ color: mapTheme.ink }}>
          {saving ? 'Saving…' : 'Changes save automatically'}
        </ThemedText>
      </View>

      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}>
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
              <ThemedText type="smallBold">
                {title}
                <ThemedText type="small" themeColor="textSecondary">
                  {'  '}
                  {findItem(slot, avatar[slot])?.label ?? 'None'}
                </ThemedText>
              </ThemedText>
              <ItemRow
                items={mine(CATALOG[slot])}
                arrange={arrange}
                leading={
                  OPTIONAL_SLOTS.has(slot) && (
                    <Tile
                      label="None"
                      selected={avatar[slot] === null}
                      onPress={() => set(wear(slot, null))}>
                      <View style={styles.iconBox}>
                        <ThemedText type="small" themeColor="textSecondary">
                          None
                        </ThemedText>
                      </View>
                    </Tile>
                  )
                }
                renderItem={(item) => (
                  <Tile
                    label={item.label}
                    selected={avatar[slot] === item.id}
                    onPress={() => set(wear(slot, item.id))}>
                    {/* Just the item; tapping it puts it on the character above */}
                    <ItemIcon
                      slot={slot}
                      id={item.id}
                      config={avatar}
                      accessibilityLabel={item.label}
                    />
                  </Tile>
                )}
              />
            </View>
          ))}

          <View style={styles.slot}>
            <ThemedText type="smallBold">
              Pet
              <ThemedText type="small" themeColor="textSecondary">
                {'  '}
                {findPet(avatar.pet)?.label ?? 'None'}
              </ThemedText>
            </ThemedText>
            <ItemRow
              items={mine(PETS)}
              arrange={arrange}
              leading={
                <Tile
                  label="No pet"
                  selected={avatar.pet === null}
                  onPress={() => set({ pet: null })}>
                  <View style={styles.iconBox} />
                </Tile>
              }
              renderItem={(p) => (
                <Tile
                  label={p.label}
                  selected={avatar.pet === p.id}
                  onPress={() => set({ pet: p.id })}>
                  <View style={styles.iconBox}>
                    <Pet id={p.id} scale={4} />
                  </View>
                </Tile>
              )}
            />
          </View>

          <BackgroundPicker mine={mine} arrange={arrange} />

          <ThemedText type="small" themeColor="textSecondary">
            Hold an item, then drag it to move it along its row.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Get more items with coins in the Shop. Each day it offers a different selection.
          </ThemedText>
          <Button title="Open the Shop" variant="secondary" onPress={() => router.push('/shop')} />

          {error && (
            <ThemedText type="small" themeColor="danger">
              {error}
            </ThemedText>
          )}
          <View style={styles.buttons}>
            <Button title="Done" onPress={() => router.back()} />
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
  iconBox: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  status: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
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
  mapSwatch: {
    width: 64,
    height: 64,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#2a1a1a',
  },
  tile: {
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 2,
    width: TILE_WIDTH,
  },
  pressed: {
    opacity: 0.7,
  },
  buttons: {
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
});
