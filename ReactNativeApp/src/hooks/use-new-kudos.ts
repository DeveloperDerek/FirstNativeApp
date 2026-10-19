import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { NewKudos } from '@/activity/activity';
import { markKudosSeen, newKudos } from '@/api/activity';
import { signedInAccount } from '@/auth/account-guard';
import { errorMessage } from '@/lib/error-message';

type Loaded = { userId: string; list: NewKudos };

/**
 * The "New kudos" list (step-tracker-kudos.txt, sections 4 and 5). Only
 * this list marks kudos seen, once it is on screen, and only up to the
 * newest kudos it held. Kudos stay new until the server confirms: a failed
 * or cut-off seen call is tried again when the app comes back to the
 * foreground and whenever the list is shown, and is dropped if the account
 * changes. `onSeen` runs after the server confirms.
 */
export function useNewKudos(userId: string, onSeen: () => void) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = loaded && loaded.userId === userId ? loaded.list : null;

  // The seen call not yet confirmed, for this account only (memory only:
  // a lost retry just shows the kudos as new once more)
  const pending = useRef<{ userId: string; upTo: string } | null>(null);
  const latest = useRef(0);

  const seenNow = useRef(onSeen);
  useEffect(() => {
    seenNow.current = onSeen;
  }, [onSeen]);

  const sendSeen = useCallback(() => {
    const p = pending.current;
    if (!p || p.userId !== signedInAccount()) return;
    markKudosSeen(p.upTo)
      .then(() => {
        if (pending.current === p) pending.current = null;
        if (signedInAccount() === p.userId) seenNow.current();
      })
      // Still new; tried again on the next foreground or the next showing
      .catch(() => {});
  }, []);

  // Account change: nothing carries over
  useEffect(
    () => () => {
      pending.current = null;
      latest.current++;
      setOpen(false);
    },
    [userId]
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') sendSeen();
    });
    return () => sub.remove();
  }, [sendSeen]);

  const show = useCallback(() => {
    if (!userId) return;
    setOpen(true);
    setError(null);
    const ticket = ++latest.current;
    newKudos()
      .then((l) => {
        if (ticket === latest.current) setLoaded({ userId, list: l });
      })
      .catch((e) => {
        // Nothing is marked; the bar and the dots stay
        if (ticket === latest.current) setError(errorMessage(e));
      });
  }, [userId]);

  // Marked only once the list is on screen (this runs after it renders)
  const upTo = open ? list?.up_to : null;
  useEffect(() => {
    if (!upTo || !userId) return;
    pending.current = { userId, upTo };
    sendSeen();
  }, [upTo, userId, sendSeen]);

  const close = useCallback(() => {
    setOpen(false);
    setLoaded(null);
  }, []);

  return { open, list, error, show, close };
}
