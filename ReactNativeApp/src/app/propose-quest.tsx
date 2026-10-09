import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { getGroupQuest, proposeQuest, type QuestMember } from '@/api/quests';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Section } from '@/components/ui/section';
import { Spacing } from '@/constants/theme';
import { errorMessage } from '@/lib/error-message';
import { coinsEach, OVERSHOOT, QUEST_TYPES, type QuestTypeId } from '@/quests/rules';

type StartOption = { key: string; label: string; at: Date | null };

const QUARTER = 15 * 60_000;

/**
 * "As soon as everyone accepts", a couple of hours from now, and the next
 * morning, lunch and evening that fall within the 24 hours voting allows.
 */
function startOptions(now = new Date()): StartOption[] {
  const fmt = (d: Date) => {
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? `Today ${time}` : `Tomorrow ${time}`;
  };
  const inHours = (h: number) =>
    new Date(Math.ceil((now.getTime() + h * 3_600_000) / QUARTER) * QUARTER);

  const later: Date[] = [inHours(1), inHours(3)];
  for (const hour of [7, 12, 18]) {
    const d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    if (d.getTime() < now.getTime() + 30 * 60_000) d.setDate(d.getDate() + 1);
    if (d.getTime() <= now.getTime() + 23.5 * 3_600_000) later.push(d);
  }
  later.sort((a, b) => a.getTime() - b.getTime());

  return [
    { key: 'asap', label: 'As soon as everyone accepts', at: null },
    ...later
      .filter((d, i) => i === 0 || d.getTime() !== later[i - 1].getTime())
      .map((d) => ({ key: d.toISOString(), label: fmt(d), at: d })),
  ];
}

/** A selectable line, like the period picker's pills. */
function Choice({
  selected,
  onPress,
  title,
  detail,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  detail?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}>
      <ThemedView
        type={selected ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.choice, selected && styles.choiceSelected]}>
        <ThemedText type={selected ? 'smallBold' : 'small'}>{title}</ThemedText>
        {detail && (
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        )}
      </ThemedView>
    </Pressable>
  );
}

/** Proposing a quest (section 7B). Opened from the group page. */
export default function ProposeQuestScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const [members, setMembers] = useState<QuestMember[] | null>(null);
  const [typeId, setTypeId] = useState<QuestTypeId>('sprint');
  const options = useMemo(() => startOptions(), []);
  const [start, setStart] = useState(options[0].key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGroupQuest(groupId)
      .then((g) => setMembers(g.members.filter((m) => m.in_group)))
      .catch((e) => setError(errorMessage(e)));
  }, [groupId]);

  const size = members?.length ?? 0;
  const notSharing = (members ?? []).filter((m) => !m.sharing);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const at = options.find((o) => o.key === start)?.at ?? null;
      await proposeQuest(groupId, typeId, at);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Propose a quest" inTabs={false}>
      {error && (
        <Section>
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        </Section>
      )}

      <Section title="Quest">
        {QUEST_TYPES.map((t) => (
          <Choice
            key={t.id}
            selected={typeId === t.id}
            onPress={() => setTypeId(t.id)}
            title={`${t.name}: ${t.goal.toLocaleString()} steps in ${t.hours} hours`}
            detail={
              size > 0
                ? `About ${coinsEach(t.goal, t.goal, size)} coins each, up to ${coinsEach(
                    t.goal * OVERSHOOT,
                    t.goal,
                    size
                  )} if you walk past the goal`
                : undefined
            }
          />
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          The goal is for the whole group: it does not matter who walks the steps.
        </ThemedText>
      </Section>

      <Section title="When">
        {options.map((o) => (
          <Choice
            key={o.key}
            selected={start === o.key}
            onPress={() => setStart(o.key)}
            title={o.label}
          />
        ))}
      </Section>

      <Section>
        {members && (
          <ThemedText type="small">
            Everyone in the group ({size} {size === 1 ? 'person' : 'people'}) must accept.
          </ThemedText>
        )}
        {notSharing.map((m) => (
          <ThemedText key={m.user_id} type="small" themeColor="textSecondary">
            {m.display_name || 'Someone'} needs to turn on step sharing to take part.
          </ThemedText>
        ))}
        <Button title="Propose quest" onPress={propose} loading={busy} disabled={!members} />
        <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  choice: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  choiceSelected: {
    borderColor: 'rgba(127,127,127,0.5)',
  },
});
