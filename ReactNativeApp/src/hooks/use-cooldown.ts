import { useEffect, useState } from 'react';

/**
 * A wait between sends ("Resend email" and "Send a new link": 60 seconds,
 * the same as Supabase's own limit). `start()` after each send.
 */
export function useCooldown(ms: number) {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);

  return {
    secondsLeft: until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000)),
    start() {
      const t = Date.now();
      setNow(t);
      setUntil(t + ms);
    },
  };
}
