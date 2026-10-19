import { CATALOG, type Slot } from '@/avatar/catalog';
import { findPet, PETS } from '@/avatar/pets';
import { THEME_LIST } from '@/track/themes';

// Everything the shop can sell: clothing (remembering each item's slot),
// pets, and map themes (with the art and sky color for a thumbnail). The
// shop lists them; the activity board names and draws what friends bought.
export type ShopEntry =
  | { kind: 'clothing'; id: string; label: string; slot: Slot }
  | { kind: 'pet'; id: string; label: string }
  | { kind: 'map'; id: string; label: string; tile: number; sky: string };

export const SHOP_ENTRIES: ShopEntry[] = [
  ...(Object.keys(CATALOG) as Slot[]).flatMap((slot) =>
    CATALOG[slot].map((item) => ({
      kind: 'clothing' as const,
      id: item.id,
      label: item.label,
      slot,
    }))
  ),
  ...PETS.map((p) => ({ kind: 'pet' as const, id: p.id, label: `${p.label} (pet)` })),
  ...THEME_LIST.map((t) => ({
    kind: 'map' as const,
    id: t.id,
    label: `${t.label} map`,
    tile: t.tiles[0],
    sky: t.sky,
  })),
];

const BY_ID = new Map(SHOP_ENTRIES.map((e) => [e.id, e]));

/** Undefined for an id this app doesn't know (a newer server's item). */
export const findShopEntry = (id: string) => BY_ID.get(id);

/**
 * What the activity board calls an item: "red cap", "spiky hair", "slime
 * pet", "forest map". A hair or face label alone ("Spiky", "Smile") doesn't
 * say what it is. Undefined for an id this app doesn't know.
 */
export function boardItemName(id: string): string | undefined {
  const e = findShopEntry(id);
  if (!e) return undefined;
  if (e.kind === 'pet') return `${findPet(id)!.label} pet`;
  if (e.kind === 'clothing' && e.slot === 'hair') return `${e.label} hair`;
  if (e.kind === 'clothing' && e.slot === 'face') return `${e.label} face`;
  return e.label;
}
