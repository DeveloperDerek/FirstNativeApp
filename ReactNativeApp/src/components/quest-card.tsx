import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { GroupQuest, Quest, QuestMember } from '@/api/quests';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clockTime as clock } from '@/lib/day';
import {
  coinsEach,
  durationText,
  groupMultiplier,
  MIN_PARTY,
  OVERSHOOT,
  questType,
  stepCoins,
} from '@/quests/rules';

/** Re-renders every 30 seconds for the countdowns, on the server's clock. */
function useNow(offset: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now + offset;
}

const nameOf = (m: QuestMember | undefined) => m?.display_name || 'Someone';

/** "3:00 PM", or "tomorrow 8:00 AM" when it is not today */
function when(iso: string, now: number) {
  const d = new Date(iso);
  const today = new Date(now).toDateString() === d.toDateString();
  return today ? clock(iso) : `tomorrow ${clock(iso)}`;
}

function Bar({ value, max, highlight }: { value: number; max: number; highlight?: boolean }) {
  const theme = useTheme();
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <ThemedView type="backgroundSelected" style={styles.track}>
      <View
        style={[
          styles.bar,
          {
            width: `${share * 100}%`,
            backgroundColor: theme.accent,
            opacity: highlight === false ? 0.55 : 1,
          },
        ]}
      />
    </ThemedView>
  );
}

type Props = {
  data: GroupQuest;
  myId: string;
  onPropose: () => void;
  /** Read and send my steps now, then reload */
  onSendSteps: () => void;
};

/**
 * The quest card at the top of the group page (section 7A and 7C): the
 * start button, the shared progress bar with per-member bars, and the
 * result. Quests have no vote: any member starts one and it is on.
 */
export function QuestCard({ data, myId, onPropose, onSendSteps }: Props) {
  const now = useNow(data.clockOffset);
  const { quest } = data;

  if (!quest) {
    return <NoQuest data={data} now={now} onPropose={onPropose} />;
  }
  if (quest.status === 'cancelled') {
    return (
      <Section title="Quest">
        <ThemedText type="small">The {questType(quest.type_id).name} was cancelled.</ThemedText>
        <CooldownLine data={data} now={now} />
      </Section>
    );
  }
  return <Running quest={quest} data={data} myId={myId} now={now} onSendSteps={onSendSteps} />;
}

function CooldownLine({ data, now }: { data: GroupQuest; now: number }) {
  if (!data.nextQuestAt || data.nextQuestAt.getTime() <= now) return null;
  return (
    <ThemedText type="small" themeColor="textSecondary">
      Next quest in {durationText(data.nextQuestAt.getTime() - now)}
    </ThemedText>
  );
}

function NoQuest({
  data,
  now,
  onPropose,
}: {
  data: GroupQuest;
  now: number;
  onPropose: () => void;
}) {
  const members = data.members.filter((m) => m.in_group);
  const sharing = members.filter((m) => m.sharing);
  const resting = data.nextQuestAt !== null && data.nextQuestAt.getTime() > now;
  return (
    <Section title="Quest">
      <ThemedText type="small">
        Walk toward one goal together. Anyone in the group can start a quest, and everyone who
        shares their steps is in it. If the group makes it, everyone earns coins.
      </ThemedText>
      {members.length < MIN_PARTY ? (
        <ThemedText type="small" themeColor="textSecondary">
          Quests need at least {MIN_PARTY} people. Share the invite code below.
        </ThemedText>
      ) : sharing.length < MIN_PARTY ? (
        <ThemedText type="small" themeColor="textSecondary">
          Quests need at least {MIN_PARTY} people with step sharing on.
        </ThemedText>
      ) : (
        <>
          <CooldownLine data={data} now={now} />
          <Button title="Start a quest" onPress={onPropose} disabled={resting} />
        </>
      )}
    </Section>
  );
}

function Running({
  quest,
  data,
  myId,
  now,
  onSendSteps,
}: {
  quest: Quest;
  data: GroupQuest;
  myId: string;
  now: number;
  onSendSteps: () => void;
}) {
  const type = questType(quest.type_id);
  const party = data.members.filter((m) => m.in_party);
  const start = new Date(quest.starts_at!).getTime();
  const end = new Date(quest.ends_at!).getTime();
  const graceEnd = end + 3_600_000;
  const total = quest.total_steps;
  const percent = Math.floor((total / quest.goal) * 100);
  const size = quest.party_size ?? party.length;
  const settled = quest.settled_at !== null;
  const me = party.find((m) => m.user_id === myId);

  let header: string;
  if (settled) header = quest.status === 'completed' ? 'Quest complete!' : 'Quest over';
  else if (now < start) header = `Starts in ${durationText(start - now)}`;
  else if (now < end) header = `${durationText(end - now)} left`;
  else header = "Time's up";

  return (
    <Section title={`Quest: ${type.name}`}>
      <View style={styles.titleRow}>
        <ThemedText type="smallBold">{type.name.toUpperCase()}</ThemedText>
        <ThemedText type="smallBold">{header}</ThemedText>
      </View>

      {now < start && !settled ? (
        <ThemedText type="small">
          The {type.name} starts at {when(quest.starts_at!, now)}:{' '}
          {quest.goal.toLocaleString()} steps together in {type.hours} hours.
        </ThemedText>
      ) : (
        <View style={styles.block}>
          <Bar value={total} max={quest.goal} />
          <ThemedText type="smallBold" style={styles.num}>
            {total.toLocaleString()} / {quest.goal.toLocaleString()}
          </ThemedText>
        </View>
      )}

      {/* Each person's share of the group total: who is carrying the party */}
      {now >= start && (
        <View style={styles.block}>
          {party.map((m) => {
            const isMe = m.user_id === myId;
            return (
              <View key={m.user_id} style={styles.member}>
                <ThemedText
                  type={isMe ? 'smallBold' : 'small'}
                  numberOfLines={1}
                  style={styles.memberName}>
                  {isMe ? 'You' : nameOf(m)}
                  {m.in_group ? '' : ' (left)'}
                </ThemedText>
                <View style={styles.flex}>
                  <Bar value={m.steps} max={Math.max(total, 1)} highlight={isMe} />
                </View>
                <ThemedText type="small" style={[styles.num, styles.memberSteps]}>
                  {m.steps.toLocaleString()}
                </ThemedText>
              </View>
            );
          })}
        </View>
      )}

      {!settled && now >= start && (
        <Progress
          quest={quest}
          size={size}
          now={now}
          end={end}
          graceEnd={graceEnd}
          percent={percent}
        />
      )}

      {settled && quest.status === 'completed' && <Payout quest={quest} me={me} party={party} />}
      {settled && quest.status === 'failed' && (
        <>
          <ThemedText type="small">
            So close! The party reached {percent}% of the goal.
          </ThemedText>
          <CooldownLine data={data} now={now} />
        </>
      )}

      {!settled && me && now >= start && now < graceEnd && (
        <Button title="Send my steps now" variant="secondary" size="small" onPress={onSendSteps} />
      )}
    </Section>
  );
}

function Progress({
  quest,
  size,
  now,
  end,
  graceEnd,
  percent,
}: {
  quest: Quest;
  size: number;
  now: number;
  end: number;
  graceEnd: number;
  percent: number;
}) {
  const total = quest.total_steps;
  const soFar = coinsEach(total, quest.goal, size);
  const most = coinsEach(Math.floor(quest.goal * OVERSHOOT), quest.goal, size);
  const reached = total >= quest.goal;

  if (now >= end) {
    return (
      <>
        <ThemedText type="small">
          Time&apos;s up! Open the app within {durationText(graceEnd - now)} so your steps are
          added.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {reached
            ? `Goal reached! Coins (about ${soFar} each) arrive when the hour is up.`
            : `The party is at ${percent}%. Late steps can still finish it.`}
        </ThemedText>
      </>
    );
  }
  if (reached) {
    return (
      <>
        <ThemedText type="smallBold">
          Goal reached! Keep walking until {clock(quest.ends_at!)} to earn more coins.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          So far: about {soFar} coins each (up to {most} each at {OVERSHOOT * 100}%)
        </ThemedText>
      </>
    );
  }
  return (
    <>
      <ThemedText type="small">
        {(quest.goal - total).toLocaleString()} steps to go. Every step from anyone counts.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Reach the goal for about {coinsEach(quest.goal, quest.goal, size)} coins each (up to{' '}
        {most} each at {OVERSHOOT * 100}%)
      </ThemedText>
    </>
  );
}

/** "10,000 steps -> 100 coins, x1.6 for 4 members -> 160, shared: +40 coins each" */
function Payout({
  quest,
  me,
  party,
}: {
  quest: Quest;
  me: QuestMember | undefined;
  party: QuestMember[];
}) {
  const size = quest.party_size ?? party.length;
  const coins = quest.step_coins ?? stepCoins(quest.total_steps, quest.goal);
  const multiplier = Number(quest.multiplier ?? groupMultiplier(size));
  const pool = Math.round(coins * multiplier);
  const top = party[0]; // most steps first
  const took =
    quest.completed_at && quest.starts_at
      ? durationText(new Date(quest.completed_at).getTime() - new Date(quest.starts_at).getTime())
      : null;

  return (
    <View style={styles.block}>
      <ThemedText type="small">
        {quest.total_steps.toLocaleString()} steps → {coins} coins, x{multiplier} for {size}{' '}
        members → {pool}, shared: +{quest.coins_each} coins each
      </ThemedText>
      {took && (
        <ThemedText type="small" themeColor="textSecondary">
          Goal reached in {took}
          {top && top.steps > 0 ? `. Most steps: ${nameOf(top)}` : ''}
        </ThemedText>
      )}
      {me && me.coins_paid !== null && me.coins_paid !== quest.coins_each && (
        <ThemedText type="small" themeColor="textSecondary">
          You got +{me.coins_paid}: quest coins are capped at 400 a day.
        </ThemedText>
      )}
      {me && me.coins_paid === null && (
        <ThemedText type="small" themeColor="textSecondary">
          No coins for you this time: only members still in the group and sharing their steps are
          paid.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.one,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  memberName: {
    width: 80,
  },
  memberSteps: {
    width: 56,
    textAlign: 'right',
  },
  num: {
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
  },
});
