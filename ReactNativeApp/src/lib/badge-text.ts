/** What a tab badge shows: nothing at 0, "9+" above 9. */
export function badgeText(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 9 ? '9+' : String(count);
}
