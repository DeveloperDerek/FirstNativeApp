import { useEffect, useState } from 'react';

import { ThemedText } from '@/components/themed-text';

/** "Next bonus in 3h 12m" for the check-in bonus; nothing when not sharing. */
export function CheckinCountdown({ nextAt, color }: { nextAt: Date | null; color?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!nextAt) return null;
  const ms = nextAt.getTime() - now;
  return (
    <ThemedText type="small" themeColor="textSecondary" style={color ? { color } : null}>
      {ms <= 0
        ? 'Check-in bonus ready! Pull down to collect.'
        : `Next check-in bonus in ${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`}
    </ThemedText>
  );
}
