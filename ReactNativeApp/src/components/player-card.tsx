import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { loadPlayerProfile, type PlayerProfile, timeAgo } from '@/api/players';
import { normalizeAvatar } from '@/avatar/catalog';
import { ThemedButton } from '@/components/themed-button';
import { ThemedText } from '@/components/themed-text';
import { sceneHeight, WalkingScene } from '@/components/walking-scene';
import { Spacing } from '@/constants/theme';
import type { Walker } from '@/track/StepTrack';
import { getTheme } from '@/track/themes';

const AVATAR_SCALE = 3; // whole number keeps the pixels crisp
const LOADING = '#e9e2d0'; // neutral while loading, so no wrong background flashes
const INK = '#2a1a1a';

type Loaded = { id: string; profile: PlayerProfile | null; failed: boolean };

/**
 * A profile card over the page, drawn in the OTHER person's map colors so
 * you can see what they have unlocked. Closes on the Close button, a tap
 * outside, or the Android back button.
 */
export function PlayerCard({
  walker,
  stepsLabel = 'Today',
  onClose,
  onEditMine,
}: {
  /** null = the card is closed */
  walker: Walker | null;
  /** Which days walker.steps covers. */
  stepsLabel?: string;
  onClose: () => void;
  /** Shown as "Edit profile" on your own card. */
  onEditMine?: () => void;
}) {
  const { width } = useWindowDimensions();
  // The answer remembers whose it is, so a late reply for someone tapped
  // earlier never shows on the wrong card.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const walkerId = walker?.id;

  // Read the username and chosen background each time a card opens;
  // nothing is cached, so a changed background shows next time.
  useEffect(() => {
    if (!walkerId) return;
    let cancelled = false;
    loadPlayerProfile(walkerId)
      .then((profile) => !cancelled && setLoaded({ id: walkerId, profile, failed: false }))
      .catch(() => !cancelled && setLoaded({ id: walkerId, profile: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [walkerId]);

  if (!walker) return null;

  const current = loaded?.id === walker.id ? loaded : null;
  const profile = current?.profile ?? null;
  const failed = Boolean(current?.failed);
  const ready = current !== null;

  // THEIR theme, not the viewer's; unknown ids fall back to the village
  const theme = getTheme(profile?.mapTheme);
  const ink = ready ? theme.ink : INK;
  const cardW = Math.min(width - 2 * Spacing.three, 360);
  const name = walker.isMe ? 'You' : profile?.displayName || walker.name;
  // Prefer the freshly loaded character; fall back to the map's copy
  const avatar = profile?.avatar ?? normalizeAvatar(walker.avatar);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* Dimmed backdrop: tap it to close */}
      <Pressable onPress={onClose} accessibilityLabel="Close profile" style={styles.backdrop}>
        {/* Taps on the card itself must not close it */}
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          style={[styles.card, { width: cardW, backgroundColor: ready ? theme.ground : LOADING }]}>
          {/* Their sky, their scenery, their character */}
          {!ready ? (
            <View style={[styles.loading, { height: sceneHeight(AVATAR_SCALE) }]}>
              <ActivityIndicator color={INK} />
            </View>
          ) : (
            <WalkingScene
              theme={theme}
              avatar={avatar}
              label={`${name === 'You' ? 'Your' : `${name}'s`} character`}
              width={cardW - 6} // inside the 3-point border
              scale={AVATAR_SCALE}
            />
          )}

          {/* Details, on their ground color */}
          <View style={styles.details}>
            <ThemedText type="subtitle" accessibilityRole="header" style={[styles.name, { color: ink }]}>
              {name}
            </ThemedText>
            {profile && <ThemedText style={{ color: ink }}>@{profile.username}</ThemedText>}
            <ThemedText style={{ color: ink }}>
              {stepsLabel}: {walker.steps.toLocaleString()} steps
            </ThemedText>
            {profile?.lastSeen && (
              <ThemedText style={{ color: ink }}>Last seen {timeAgo(profile.lastSeen)}</ThemedText>
            )}
            {failed && (
              <ThemedText type="small" style={{ color: ink }}>
                Could not load the rest of this profile.
              </ThemedText>
            )}

            <View style={styles.buttons}>
              {walker.isMe && onEditMine && (
                <ThemedButton
                  theme={theme}
                  title="Edit profile"
                  onPress={() => {
                    onClose();
                    onEditMine();
                  }}
                />
              )}
              <ThemedButton theme={theme} title="Close" onPress={onClose} />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 12,
    borderWidth: 3,
    borderColor: INK,
    overflow: 'hidden',
  },
  loading: {
    backgroundColor: LOADING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  name: {
    fontSize: 24,
    lineHeight: 30,
  },
  buttons: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
});
