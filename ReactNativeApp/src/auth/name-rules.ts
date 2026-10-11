// Display names and group names: the shape rules, the same in the app and
// the database (step-tracker-safety.txt, section 6). The database has the
// same lists in 20261103000000_name_limits.sql; the generated test
// supabase/tests/database/name_rules.generated.test.sql checks that it
// agrees with this file on every example and every range edge below.
// No imports, so `npm test` and scripts/gen-name-tests.ts can load it.
//
// The word list (offensive words) is only on the server.

type Range = readonly [number, number];

export const NAME_MAX = { display: 30, group: 15 } as const;
export type NameKind = keyof typeof NAME_MAX;

/** Refused anywhere in a name: control, line-break, invisible and blank-looking characters. */
export const REFUSED: readonly Range[] = [
  [0x0000, 0x001f], // control characters (tab, line feed, carriage return...)
  [0x007f, 0x009f], // control characters (including U+0085)
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x0600, 0x0605], // Arabic number signs (format)
  [0x061c, 0x061c], // Arabic letter mark
  [0x06dd, 0x06dd],
  [0x070f, 0x070f],
  [0x0890, 0x0891],
  [0x08e2, 0x08e2],
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5], // Khmer invisible vowels
  [0x180b, 0x180f], // Mongolian variation selectors and vowel separator
  [0x200b, 0x200c], // zero-width space, zero-width non-joiner
  [0x200e, 0x200f], // left-to-right / right-to-left marks
  [0x2028, 0x202e], // line and paragraph separators, text-direction controls
  [0x2060, 0x206f], // word joiner, invisible operators, text-direction isolates
  [0x2800, 0x2800], // braille blank
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0e], // variation selectors (U+FE0F is allowed after an emoji)
  [0xfeff, 0xfeff], // zero-width no-break space
  [0xffa0, 0xffa0], // halfwidth Hangul filler
  [0xfff9, 0xfffb], // interlinear annotation
  [0x110bd, 0x110bd],
  [0x110cd, 0x110cd],
  [0x13430, 0x1343f], // Egyptian hieroglyph format controls
  [0x1bca0, 0x1bca3], // shorthand format controls
  [0x1d173, 0x1d17a], // musical format controls
  [0xe0001, 0xe0001], // language tag
  [0xe0020, 0xe007f], // tag characters
  [0xe0100, 0xe01ef], // variation selectors supplement
];

/** Allowed spaces: trimmed at the ends, each run inside becomes one ordinary space. */
export const SPACES: readonly Range[] = [
  [0x0020, 0x0020],
  [0x00a0, 0x00a0], // non-breaking space
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000], // ideographic space
];

/** Emoji that a joiner, emoji style or skin tone may follow. */
export const EMOJI: readonly Range[] = [
  [0x00a9, 0x00a9],
  [0x00ae, 0x00ae],
  [0x203c, 0x203c],
  [0x2049, 0x2049],
  [0x2122, 0x2122],
  [0x2139, 0x2139],
  [0x2194, 0x21aa],
  [0x231a, 0x23ff],
  [0x24c2, 0x24c2],
  [0x25aa, 0x25fe],
  [0x2600, 0x27bf],
  [0x2934, 0x2935],
  [0x2b05, 0x2b55],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3297],
  [0x3299, 0x3299],
  [0x1f000, 0x1f3fa],
  [0x1f400, 0x1faff], // (U+1F3FB-1F3FF, the skin tones, are not emoji on their own)
];

export const ZWJ = 0x200d; // zero-width joiner
export const EMOJI_STYLE = 0xfe0f;
export const SKIN_TONES: Range = [0x1f3fb, 0x1f3ff];

const within = (ranges: readonly Range[], cp: number) =>
  ranges.some(([from, to]) => cp >= from && cp <= to);
const isSkinTone = (cp: number) => cp >= SKIN_TONES[0] && cp <= SKIN_TONES[1];

export type NameCheck =
  | { ok: true; name: string; length: number }
  | { ok: false; reason: 'character' | 'empty' | 'too_long'; detail: string };

const hex = (cp: number) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

/**
 * The name as it will be saved, or why not. In this order: NFC; refuse
 * control, line-break, hidden and blank-looking characters (joiner,
 * emoji style and skin tones only inside emoji); trim and collapse the
 * allowed spaces; visible content; length in Unicode characters.
 */
export function checkName(raw: string, kind: NameKind): NameCheck {
  const chars = Array.from(raw.normalize('NFC'));
  const cps = chars.map((c) => c.codePointAt(0)!);

  // An emoji part is an emoji, or emoji style / a skin tone right after one
  let previousEmojiPart = false;
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    const previous = i > 0 ? cps[i - 1] : -1;
    const next = i + 1 < cps.length ? cps[i + 1] : -1;
    let allowed: boolean;
    if (within(REFUSED, cp)) allowed = false;
    else if (cp === ZWJ) allowed = previousEmojiPart && within(EMOJI, next);
    else if (cp === EMOJI_STYLE || isSkinTone(cp)) allowed = within(EMOJI, previous);
    else allowed = true;
    if (!allowed) return { ok: false, reason: 'character', detail: hex(cp) };
    previousEmojiPart =
      within(EMOJI, cp) || ((cp === EMOJI_STYLE || isSkinTone(cp)) && previousEmojiPart);
  }

  const isSpace = (c: string) => within(SPACES, c.codePointAt(0)!);
  const out: string[] = [];
  for (const c of chars) {
    if (isSpace(c)) {
      if (out.length > 0 && out[out.length - 1] !== ' ') out.push(' ');
    } else {
      out.push(c);
    }
  }
  if (out[out.length - 1] === ' ') out.pop();

  if (out.length === 0) return { ok: false, reason: 'empty', detail: 'no visible characters' };
  if (out.length > NAME_MAX[kind]) {
    return { ok: false, reason: 'too_long', detail: `${out.length} characters (max ${NAME_MAX[kind]})` };
  }
  return { ok: true, name: out.join(''), length: out.length };
}
