import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { loadGroupMemberCard, loadPlayerProfile, type PlayerProfile, timeAgo } from '@/api/players';
import { normalizeAvatar } from '@/avatar/catalog';
import { useAuth } from '@/auth/AuthProvider';
import { personMenu, reportHref } from '@/components/block-actions';
import { MoreButton } from '@/components/more-button';
import { ThemedButton } from '@/components/themed-button';
import { ThemedText } from '@/components/themed-text';
import { sceneHeight, WalkingScene } from '@/components/walking-scene';
import { Spacing } from '@/constants/theme';
import type { Walker } from '@/track/StepTrack';
import { getTheme } from '@/track/themes';

const AVATAR_SCALE = 3; // whole number keeps the pixels crisp
const LOADING = '#e9e2d0'; // neutral while loading, so no wrong background flashes
const INK = '#2a1a1a';

type Loaded = {
  /** Whose card, and from where: a late reply never shows on the wrong card. */
  key: string;
  profile: PlayerProfile | null;
  failed: boolean;
  /** Not someone you can see (blocked either way, or no longer active). */
  unavailable: boolean;
};

/**
 * A profile card over the page, drawn in the OTHER person's map colors so
 * you can see what they have unlocked. Closes on the Close button, a tap
 * outside, or the Android back button. Opened from a group, it reads
 * through the group (step-tracker-safety.txt, section 2), so it shows
 * any member of that group, including someone you blocked.
 */
export function PlayerCard({
  walker,
  stepsLabel = 'Today',
  group,
  onClose,
  onEditMine,
  onBlockChanged,
  onMakeOwner,
}: {
  /** null = the card is closed */
  walker: Walker | null;
  /** Which days walker.steps covers. */
  stepsLabel?: string;
  /** The group the card was opened from, if any. */
  group?: { id: string; name: string };
  onClose: () => void;
  /** Shown as "Edit profile" on your own card. */
  onEditMine?: () => void;
  /** After blocking or unblocking from the card, so the page can reload. */
  onBlockChanged?: () => void;
  /** Group owners on the group screen: hand the group to this person. */
  onMakeOwner?: (person: { id: string; username: string }) => void;
}) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { account } = useAuth();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Bumped to read the card again (after Block / Unblock in a group)
  const [version, setVersion] = useState(0);
  const walkerId = walker?.id;
  const groupId = group?.id;
  const key = `${walkerId}:${groupId ?? ''}:${version}`;

  // Read the username and chosen background each time a card opens;
  // nothing is cached, so a changed background shows next time.
  useEffect(() => {
    if (!walkerId) return;
    let cancelled = false;
    const load = groupId ? loadGroupMemberCard(groupId, walkerId) : loadPlayerProfile(walkerId);
    load
      .then(
        (profile) =>
          !cancelled && setLoaded({ key, profile, failed: false, unavailable: profile === null })
      )
      .catch(
        () => !cancelled && setLoaded({ key, profile: null, failed: true, unavailable: false })
      );
    return () => {
      cancelled = true;
    };
  }, [walkerId, groupId, key]);

  if (!walker) return null;

  const current = loaded?.key === key ? loaded : null;
  const profile = current?.profile ?? null;
  const failed = Boolean(current?.failed);
  const unavailable = Boolean(current?.unavailable);
  const ready = current !== null;

  function openMenu() {
    if (!profile || !walker) return;
    const person = { id: walker.id, username: profile.username };
    personMenu(person, {
      blocked: profile.blockedByMe,
      onChanged: () => {
        onBlockChanged?.();
        // In a group you still see each other, so the card stays (with or
        // without the note); anywhere else a blocked person is gone, so it
        // closes
        if (group || profile.blockedByMe) setVersion((v) => v + 1);
        else onClose();
      },
      onMakeOwner: onMakeOwner ? () => onMakeOwner(person) : undefined,
      // The card is a modal over the page: close it first, or it would sit
      // on top of the report sheet
      onReport: account?.reportsEnabled
        ? () => {
            onClose();
            router.push(reportHref('person', person.id, `@${person.username}`));
          }
        : undefined,
    });
  }

  // THEIR theme, not the viewer's; unknown ids fall back to the village
  const theme = getTheme(profile?.mapTheme);
  const ink = ready ? theme.ink : INK;
  const cardW = Math.min(width - 2 * Spacing.three, 360);
  const name = walker.isMe
    ? 'You'
    : unavailable
      ? 'Player'
      : profile?.displayName || walker.name;
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
          {ready && profile && !walker.isMe && (
            <View style={styles.more}>
              <MoreButton onPress={openMenu} color={ink} />
            </View>
          )}
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
            {unavailable ? (
              <ThemedText style={{ color: ink }}>This player isn&apos;t available.</ThemedText>
            ) : (
              <ThemedText style={{ color: ink }}>
                {stepsLabel}: {walker.steps.toLocaleString()} steps
              </ThemedText>
            )}
            {/* Only ever shown to the person who blocked */}
            {group && profile?.blockedByMe && (
              <ThemedText type="small" style={{ color: ink }}>
                You&apos;ve blocked this person. You&apos;re both in {group.name}: leave it, or
                ask the owner to remove them.
              </ThemedText>
            )}
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
  more: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    zIndex: 1,
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
