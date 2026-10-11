import { Linking } from 'react-native';

import type { LegalDoc } from '@/auth/route';
import { ThemedText } from '@/components/themed-text';

const TITLES = { terms: 'Terms', privacy: 'Privacy Policy' } as const;
const ORDER = ['terms', 'privacy'];

/** "I agree to the Terms and Privacy Policy", each a link to the exact version. */
export function LegalAgreementText({ docs }: { docs: LegalDoc[] }) {
  const ordered = [...docs].sort((a, b) => ORDER.indexOf(a.document) - ORDER.indexOf(b.document));
  return (
    <ThemedText type="small">
      I agree to the{' '}
      {ordered.map((doc, i) => (
        <ThemedText key={doc.document} type="small">
          {i > 0 && (i === ordered.length - 1 ? ' and ' : ', ')}
          <ThemedText
            type="small"
            themeColor="accent"
            accessibilityRole="link"
            onPress={() => Linking.openURL(doc.url)}>
            {TITLES[doc.document]}
          </ThemedText>
        </ThemedText>
      ))}
    </ThemedText>
  );
}
