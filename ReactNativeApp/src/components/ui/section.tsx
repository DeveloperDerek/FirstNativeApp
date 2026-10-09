import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { GroundText } from '@/components/ground-text';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/** Titled rounded card, like the one on the History screen. The title sits on the map's ground. */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.wrapper}>
      {title && (
        <GroundText type="code" style={styles.caps}>
          {title}
        </GroundText>
      )}
      <ThemedView type="backgroundElement" style={styles.card}>
        {children}
      </ThemedView>
    </View>
  );
}

/** One line in a Section: label on the left, optional actions on the right. */
export function Row({
  title,
  detail,
  leading,
  children,
}: {
  title: string;
  detail?: string;
  /** Shown before the text, e.g. the person's character. */
  leading?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      {leading}
      <View style={styles.rowText}>
        <ThemedText type="small" numberOfLines={1}>
          {title}
        </ThemedText>
        {detail && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {detail}
          </ThemedText>
        )}
      </View>
      {children && <View style={styles.actions}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  caps: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowText: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
