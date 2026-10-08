import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { Avatar } from '@/avatar/Avatar';
import { CoinBalance } from '@/components/coin-balance';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, DailyStepGoal, MaxContentWidth, Spacing } from '@/constants/theme';
import { openHealthSettings, permissionHelp } from '@/health';
import { useSteps } from '@/hooks/use-steps';
import { useTheme } from '@/hooks/use-theme';
import { useWallet } from '@/hooks/use-wallet';

export default function TodayScreen() {
  const theme = useTheme();
  const { today, permission, loading, error, refresh } = useSteps();
  const { profile } = useAuth();
  const { balance } = useWallet();
  const router = useRouter();
  const progress = Math.min((today ?? 0) / DailyStepGoal, 1);

  const blocked = permission === 'denied' || permission === 'unavailable';
  // iOS hides denied read access, so zero steps may really mean "no permission".
  const showIosZeroHint = Platform.OS === 'ios' && permission === 'granted' && today === 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topBar}>
          <CoinBalance balance={balance} />
          <Pressable
            onPress={() => router.push('/shop')}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary">Shop</ThemedText>
          </Pressable>
        </View>
        <View style={styles.hero}>
          {profile && (
            <Avatar config={profile.avatar} scale={3} accessibilityLabel="Your character" />
          )}
          <ThemedText type="code" themeColor="textSecondary" style={styles.caps}>
            Today
          </ThemedText>
          <ThemedText style={styles.count}>{today?.toLocaleString() ?? '--'}</ThemedText>
          <ThemedText themeColor="textSecondary">steps</ThemedText>

          <View style={styles.goal}>
            <ThemedView type="backgroundElement" style={styles.track}>
              <View
                style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: theme.accent }]}
              />
            </ThemedView>
            <ThemedText type="small" themeColor="textSecondary">
              {Math.round(progress * 100)}% of {DailyStepGoal.toLocaleString()} goal
              {progress >= 1 && profile?.sharing_consent_at ? ' · +100 coins' : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.fineprint}>
              Manually entered steps and steps from unsupported apps do not count.
            </ThemedText>
          </View>
        </View>

        {(blocked || showIosZeroHint || error) && (
          <ThemedView type="backgroundElement" style={styles.notice}>
            {error && (
              <ThemedText type="small" themeColor="danger">
                {error}
              </ThemedText>
            )}
            {blocked && <ThemedText type="small">{permissionHelp[permission]}</ThemedText>}
            {showIosZeroHint && (
              <ThemedText type="small">
                Seeing 0? Check Settings › Health › Data Access & Devices › StepTracker and allow
                Steps.
              </ThemedText>
            )}
            {blocked && Platform.OS !== 'web' && (
              <Pressable onPress={() => openHealthSettings(permission)}>
                <ThemedText type="linkPrimary">
                  {permission === 'unavailable' && Platform.OS === 'android'
                    ? 'Get Health Connect'
                    : 'Open settings'}
                </ThemedText>
              </Pressable>
            )}
          </ThemedView>
        )}

        <Pressable
          onPress={refresh}
          disabled={loading}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.accent },
            (pressed || loading) && styles.pressed,
          ]}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.buttonText}>Refresh</ThemedText>
          )}
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.two,
  },
  fineprint: {
    textAlign: 'center',
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  caps: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  count: {
    fontSize: 72,
    lineHeight: 80,
    fontWeight: 700,
    fontVariant: ['tabular-nums'],
  },
  goal: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  track: {
    alignSelf: 'stretch',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 6,
  },
  notice: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  button: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 600,
  },
  pressed: {
    opacity: 0.7,
  },
});
