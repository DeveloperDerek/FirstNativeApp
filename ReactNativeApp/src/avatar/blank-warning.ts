import { useEffect } from 'react';

/**
 * Dev builds only: warns when an icon is still drawing nothing two
 * seconds after it showed, naming it, so a blank tile can be traced to
 * its item (no art for it, art that never decoded, or nothing visible).
 */
export function useBlankWarning(blank: boolean, what: string) {
  useEffect(() => {
    if (!__DEV__ || !blank) return;
    const t = setTimeout(() => console.warn(`Blank icon: ${what}`), 2000);
    return () => clearTimeout(t);
  }, [blank, what]);
}
