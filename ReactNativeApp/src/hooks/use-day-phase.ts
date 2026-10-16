import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { type DayPhase, phaseAt } from '@/track/time-of-day';

/**
 * Day, sunset or night by the phone's clock. Checked once a minute while
 * the app is open and again whenever it comes back to the foreground, so
 * the map changes light on its own.
 */
export function useDayPhase(): DayPhase {
  const [phase, setPhase] = useState(() => phaseAt(new Date()));

  useEffect(() => {
    const check = () => setPhase(phaseAt(new Date()));
    const timer = setInterval(check, 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  return phase;
}
