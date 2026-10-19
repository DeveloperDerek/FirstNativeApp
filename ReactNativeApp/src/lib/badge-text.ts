/** What a tab badge shows: nothing at 0, "9+" above 9. */
export function badgeText(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 9 ? '9+' : String(count);
}

/**
 * The Friends tab badge: the number of friend requests, or a dot (no
 * number) for new kudos when no request is waiting. A number means
 * something needs you; a dot means something to see (step-tracker-kudos.txt,
 * KUD-6). `text` undefined with `hidden` false is the dot.
 */
export function friendsBadge(requests: number, newKudos: number): { hidden: boolean; text?: string } {
  const text = badgeText(requests);
  if (text) return { hidden: false, text };
  return { hidden: newKudos <= 0 };
}
