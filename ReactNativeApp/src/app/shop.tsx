import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';

import { type DailyShop, listDailyShop, listOwnedItems, purchaseItem } from '@/api/coins';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar } from '@/avatar/Avatar';
import { CATALOG, type Slot, wear } from '@/avatar/catalog';
import { DEFAULT_AVATAR } from '@/avatar/types';
import { CoinBalance } from '@/components/coin-balance';
import { GroundText } from '@/components/ground-text';
import { SharingRequired } from '@/components/sharing-required';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Section } from '@/components/ui/section';
import { Spacing } from '@/constants/theme';
import { useMapTheme } from '@/hooks/use-map-theme';
import { useWallet } from '@/hooks/use-wallet';
import { errorMessage } from '@/lib/error-message';
import { THEME_LIST } from '@/track/themes';

// Everything the shop can sell: clothing (remembering each item's slot)
// and map themes (with the art and sky color for a thumbnail).
type Entry =
  | { kind: 'clothing'; id: string; label: string; slot: Slot }
  | { kind: 'map'; id: string; label: string; tile: number; sky: string };

const ALL_ENTRIES: Entry[] = [
  ...(Object.keys(CATALOG) as Slot[]).flatMap((slot) =>
    CATALOG[slot].map((item) => ({
      kind: 'clothing' as const,
      id: item.id,
      label: item.label,
      slot,
    }))
  ),
  ...THEME_LIST.map((t) => ({
    kind: 'map' as const,
    id: t.id,
    label: `${t.label} map`,
    tile: t.tiles[0],
    sky: t.sky,
  })),
];

/** A window onto the map's street art, on its own sky and ground colors. */
function MapThumb({ entry }: { entry: Extract<Entry, { kind: 'map' }> }) {
  return (
    <View
      style={[styles.thumb, { backgroundColor: entry.sky }]}
      accessibilityRole="image"
      accessibilityLabel={entry.label}>
      <Image source={entry.tile} style={styles.thumbTile} resizeMode="stretch" />
    </View>
  );
}

function countdownText(msLeft: number) {
  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  return `New items in ${hours}h ${minutes}m`;
}

export default function ShopScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { balance, setBalance, refreshBalance } = useWallet();
  const { theme, refreshOwned } = useMapTheme();
  const sharing = Boolean(profile?.sharing_consent_at);

  const [shop, setShop] = useState<DailyShop>({ items: [], refreshesAt: null });
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([listDailyShop(), listOwnedItems(), refreshBalance()]);
      setShop(s);
      setOwned(o);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoaded(true);
    }
  }, [refreshBalance]);

  // Load on open, and again when coming back from the character editor.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Tick once a minute for the countdown. When the refresh time passes,
  // fetch the new selection so nobody taps Buy on yesterday's items.
  const refreshesAt = shop.refreshesAt?.getTime();
  useEffect(() => {
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (refreshesAt !== undefined && t >= refreshesAt) load();
    }, 60_000);
    return () => clearInterval(timer);
  }, [refreshesAt, load]);

  const msLeft = refreshesAt !== undefined ? refreshesAt - now : null;

  // Today's items only, in the order the server picked them
  const prices = Object.fromEntries(shop.items.map((i) => [i.id, i.price]));
  const forSale = shop.items
    .map((s) => ALL_ENTRIES.find((e) => e.id === s.id))
    .filter((e): e is Entry => e !== undefined);

  function buy(itemId: string, label: string, price: number) {
    Alert.alert('Buy item?', `${label} for ${price.toLocaleString()} coins`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Buy',
        onPress: async () => {
          setBusy(itemId);
          try {
            setBalance(await purchaseItem(itemId));
            setOwned((prev) => new Set(prev).add(itemId));
            refreshOwned(); // a new background unlocks on Profile straight away
          } catch (e) {
            Alert.alert('Not purchased', errorMessage(e));
            load(); // e.g. the shop just refreshed
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  if (!sharing) {
    return (
      <Screen title="Shop" inTabs={false}>
        <GroundText>
          Earn 100 coins for every day you reach 10,000 steps, then spend them on clothes for your
          character.
        </GroundText>
        <SharingRequired />
      </Screen>
    );
  }

  const character = profile?.avatar ?? DEFAULT_AVATAR;

  return (
    <Screen title="Shop" inTabs={false}>
      <View style={styles.header}>
        <GroundText type="small">
          {msLeft !== null && msLeft > 0 ? countdownText(msLeft) : ' '}
        </GroundText>
        <CoinBalance balance={balance} color={theme.ink} />
      </View>
      <GroundText type="small">
        Your shop is unique to you and changes every day at midnight Pacific time. Earn 100 coins
        for each day you reach 10,000 steps.
      </GroundText>

      {error && (
        // In a card, so the red reads on every map's ground
        <Section>
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        </Section>
      )}

      <Section title="Today's items">
        {loaded && forSale.length === 0 && !error && (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing new today. You own everything in the shop!
          </ThemedText>
        )}
        {forSale.map((item) => {
          const price = prices[item.id];
          const isOwned = owned.has(item.id);
          const affordable = balance !== null && balance >= price;
          return (
            <View key={item.id} style={styles.item}>
              {item.kind === 'map' ? (
                <MapThumb entry={item} />
              ) : (
                // Preview: your own character wearing this item
                <Avatar
                  config={{ ...character, ...wear(item.slot, item.id) }}
                  scale={2}
                  accessibilityLabel={`Your character wearing ${item.label}`}
                />
              )}
              <View style={styles.itemText}>
                <ThemedText>{item.label}</ThemedText>
                {item.kind === 'map' && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Change backgrounds in Profile
                  </ThemedText>
                )}
                <ThemedText type="small" themeColor="textSecondary">
                  {isOwned
                    ? 'Owned'
                    : `${price.toLocaleString()} coins${affordable ? '' : ' (not enough yet)'}`}
                </ThemedText>
              </View>
              <Button
                title={isOwned ? 'Owned' : 'Buy'}
                size="small"
                variant={isOwned ? 'secondary' : 'primary'}
                loading={busy === item.id}
                disabled={isOwned || !affordable}
                onPress={() => buy(item.id, item.label, price)}
              />
            </View>
          );
        })}
      </Section>

      <View style={styles.footer}>
        <Button
          title="Customize character"
          variant="secondary"
          onPress={() => router.push('/avatar')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  thumb: {
    width: 64,
    height: 96,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#2a1a1a',
    overflow: 'hidden',
  },
  // The street art at its real size (2 points per pixel), bottom-aligned
  // so the window shows scenery and road.
  thumbTile: {
    position: 'absolute',
    bottom: 0,
    left: -40,
    width: 512,
    height: 160,
  },
  itemText: {
    flex: 1,
  },
  footer: {
    marginTop: Spacing.four,
  },
});
