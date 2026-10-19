import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  type ActivityCursor,
  type ActivityLine,
  appendPage,
  hasNew,
  lineKey,
  nextCursor,
  showable,
  withKudosGiven,
  withoutKudosGiven,
  withoutPerson,
} from '@/activity/activity';
import { friendsActivity, giveKudos } from '@/api/activity';
import { errorMessage } from '@/lib/error-message';
import { boardItemName } from '@/lib/shop-entries';

// Not again within this long when the view opens or the app comes back
// (pull-to-refresh always asks)
const AUTO_REFRESH_GAP_MS = 30_000;

type Board = {
  /** Whose board, so a previous account's is never shown */
  userId: string;
  lines: ActivityLine[];
  /** Pages shown: 1 = only the first */
  pages: number;
  cursor: ActivityCursor | null;
  /** A first page a refresh found while older pages were open */
  fresh: ActivityLine[] | null;
  error: string | null;
  updatedAt: number | null;
};

/**
 * The activity board's list in Friends (step-tracker-activity-board.txt,
 * section 5). Loads the first page while `active`, and again when the app
 * comes back to the foreground; older pages on request. A refresh with
 * older pages open keeps the list where it is and says there's something
 * new instead of replacing it. Only the newest answer for this account is
 * kept, as with the tab badges.
 */
export function useFriendsActivity(userId: string, active: boolean) {
  const [loaded, setLoaded] = useState<Board | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const board = loaded && loaded.userId === userId ? loaded : null;

  // Each request is numbered; an answer that isn't the newest is dropped
  const latest = useRef(0);
  const lastLoad = useRef(0);

  // Account change: outdate anything in flight
  useEffect(
    () => () => {
      latest.current++;
      lastLoad.current = 0;
    },
    [userId]
  );

  const refresh = useCallback(
    ({ force = false, replace = false } = {}) => {
      if (!userId) return Promise.resolve();
      if (!force && Date.now() - lastLoad.current < AUTO_REFRESH_GAP_MS) return Promise.resolve();
      lastLoad.current = Date.now();
      const ticket = ++latest.current;
      return friendsActivity()
        .then((page) => {
          if (ticket !== latest.current) return;
          const first = showable(page, boardItemName);
          setLoaded((b) => {
            const mine = b && b.userId === userId ? b : null;
            const base = { userId, error: null, updatedAt: Date.now() };
            if (replace || !mine || mine.pages <= 1) {
              return { ...base, lines: first, pages: 1, cursor: nextCursor(page), fresh: null };
            }
            return { ...mine, ...base, fresh: hasNew(mine.lines, first) ? page : mine.fresh };
          });
        })
        .catch((e) => {
          // What's on screen stays
          if (ticket !== latest.current) return;
          setLoaded((b) =>
            b && b.userId === userId
              ? { ...b, error: errorMessage(e) }
              : {
                  userId,
                  lines: [],
                  pages: 0,
                  cursor: null,
                  fresh: null,
                  error: errorMessage(e),
                  updatedAt: null,
                }
          );
        });
    },
    [userId]
  );

  const cursor = board?.cursor ?? null;
  const loadOlder = useCallback(() => {
    if (!cursor || loadingOlder) return;
    const ticket = ++latest.current;
    setLoadingOlder(true);
    friendsActivity(cursor)
      .then((page) => {
        if (ticket !== latest.current) return;
        setLoaded((b) =>
          b && b.userId === userId
            ? {
                ...b,
                lines: appendPage(b.lines, showable(page, boardItemName)),
                pages: b.pages + 1,
                cursor: nextCursor(page),
                error: null,
              }
            : b
        );
      })
      .catch((e) => {
        if (ticket !== latest.current) return;
        setLoaded((b) => (b ? { ...b, error: errorMessage(e) } : b));
      })
      .finally(() => setLoadingOlder(false));
  }, [cursor, loadingOlder, userId]);

  /** Back to the top with the page a refresh found. */
  const showNew = useCallback(() => {
    setLoaded((b) =>
      b?.fresh
        ? { ...b, lines: showable(b.fresh, boardItemName), pages: 1, cursor: nextCursor(b.fresh), fresh: null }
        : b
    );
  }, []);

  /** Straight after blocking or removing someone on this phone. */
  const dropPerson = useCallback((id: string) => {
    setLoaded((b) =>
      b
        ? { ...b, lines: withoutPerson(b.lines, id), fresh: b.fresh && withoutPerson(b.fresh, id) }
        : b
    );
  }, []);

  /** Changes the lines on screen (and a waiting fresh page), for this account only. */
  const editLines = useCallback(
    (edit: (lines: ActivityLine[]) => ActivityLine[]) => {
      setLoaded((b) =>
        b && b.userId === userId ? { ...b, lines: edit(b.lines), fresh: b.fresh && edit(b.fresh) } : b
      );
    },
    [userId]
  );

  /**
   * Kudos on a friend's line (step-tracker-kudos.txt): counted up at once,
   * then the server's count; back as it was if it fails. True if it worked.
   */
  const giveKudosOn = useCallback(
    async (line: ActivityLine) => {
      const key = lineKey(line);
      editLines((lines) => withKudosGiven(lines, key));
      try {
        const count = await giveKudos(line);
        editLines((lines) => withKudosGiven(lines, key, count));
        return true;
      } catch {
        editLines((lines) => withoutKudosGiven(lines, key));
        return false;
      }
    },
    [editLines]
  );

  /** The server confirmed the "New kudos" list was seen: the dots go. */
  const clearNewKudos = useCallback(() => {
    editLines((lines) => lines.map((l) => (l.new_kudos ? { ...l, new_kudos: 0 } : l)));
  }, [editLines]);

  useEffect(() => {
    if (!active) return;
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [active, refresh]);

  return {
    lines: board?.lines ?? [],
    loaded: board !== null,
    hasOlder: cursor !== null,
    loadingOlder,
    hasNew: Boolean(board?.fresh),
    error: board?.error ?? null,
    updatedAt: board?.updatedAt ?? null,
    refresh,
    loadOlder,
    showNew,
    dropPerson,
    giveKudos: giveKudosOn,
    clearNewKudos,
  };
}
