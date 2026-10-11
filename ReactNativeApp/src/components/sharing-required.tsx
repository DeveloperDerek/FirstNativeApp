import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/section';

/** Shown on Friends and Groups until the user agrees to share their steps (section 14c). */
export function SharingRequired() {
  const router = useRouter();
  return (
    <Section>
      <ThemedText type="small">
        To compare steps with friends and groups, StepTracker needs your permission to upload your
        daily totals. Your own steps on the Today and History tabs work either way.
      </ThemedText>
      <Button title="Review and share" onPress={() => router.push('/consent')} />
    </Section>
  );
}
