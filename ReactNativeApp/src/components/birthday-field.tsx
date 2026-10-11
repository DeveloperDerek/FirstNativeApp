import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { toIsoDay } from '@/auth/register';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

function yearsAgo(years: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

export const formatDay = (d: Date) =>
  d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * A date picker, not free typing (step-tracker-register.txt, section 3):
 * a wheel on iOS, the system dialog on Android. Nothing is chosen until
 * the person picks; `onChange` gets 'YYYY-MM-DD' or null.
 */
export function BirthdayField({
  label,
  hint,
  onChange,
}: {
  label: string;
  hint?: string;
  onChange: (day: string | null) => void;
}) {
  const theme = useTheme();
  const [birth, setBirth] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  function pick(d: Date) {
    setBirth(d);
    onChange(toIsoDay(d));
  }

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {Platform.OS === 'ios' && birth ? (
        <DateTimePicker
          value={birth}
          mode="date"
          display="spinner"
          minimumDate={yearsAgo(120)}
          maximumDate={new Date()}
          onValueChange={(_, d) => pick(d)}
        />
      ) : (
        <Pressable
          onPress={() => {
            if (!birth) pick(yearsAgo(20));
            setPickerOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={birth ? `${label}, ${formatDay(birth)}. Change` : `Choose ${label}`}
          style={[styles.dateButton, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText themeColor={birth ? 'text' : 'textSecondary'}>
            {birth ? formatDay(birth) : 'Choose a date'}
          </ThemedText>
        </Pressable>
      )}
      {Platform.OS === 'android' && pickerOpen && birth && (
        <DateTimePicker
          value={birth}
          mode="date"
          minimumDate={yearsAgo(120)}
          maximumDate={new Date()}
          onValueChange={(_, d) => {
            pick(d);
            setPickerOpen(false);
          }}
          onDismiss={() => setPickerOpen(false)}
        />
      )}
      {hint && (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  dateButton: {
    height: 48,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
});
