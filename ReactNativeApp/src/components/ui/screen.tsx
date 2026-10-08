import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Shows pull-to-refresh when provided. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Tab screens leave room for the tab bar; pushed screens and modals don't. */
  inTabs?: boolean;
  /** Screens under a native header don't need to pad for the status bar. */
  hasHeader?: boolean;
};

/** Scrolling page layout shared by the History, Friends, Groups and Profile screens. */
export function Screen({
  title,
  subtitle,
  children,
  onRefresh,
  refreshing = false,
  inTabs = true,
  hasHeader = false,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior={hasHeader ? 'automatic' : 'never'}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: (hasHeader ? 0 : insets.top) + Spacing.four,
          paddingBottom: insets.bottom + (inTabs ? BottomTabInset : 0) + Spacing.three,
        },
      ]}>
      <View style={styles.inner}>
        {title && <ThemedText type="subtitle">{title}</ThemedText>}
        {subtitle && <ThemedText themeColor="textSecondary">{subtitle}</ThemedText>}
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  inner: {
    flex: 1,
    maxWidth: MaxContentWidth,
    gap: Spacing.two,
  },
});
