// One list of name examples for both sides (step-tracker-safety.txt,
// sections 6 and 10). src/auth/name-rules.test.ts checks the app against
// it, and scripts/gen-name-tests.ts turns it into a database test, so the
// app and the database can't disagree on any of these.
// After changing this file, run: npm run gen:name-tests

import type { NameKind } from './name-rules.ts';

export type NameCase = {
  label: string;
  raw: string;
  kind: NameKind;
  /** The saved name, or null when refused. */
  saved: string | null;
};

const ok = (label: string, raw: string, saved: string, kind: NameKind = 'display'): NameCase => ({
  label,
  raw,
  kind,
  saved,
});
const no = (label: string, raw: string, kind: NameKind = 'display'): NameCase => ({
  label,
  raw,
  kind,
  saved: null,
});

export const NAME_CASES: NameCase[] = [
  // Length (display 30, group 15)
  ok('30 characters', 'x'.repeat(30), 'x'.repeat(30)),
  no('31 characters', 'x'.repeat(31)),
  ok('group: 15 characters', 'y'.repeat(15), 'y'.repeat(15), 'group'),
  no('group: 16 characters', 'y'.repeat(16), 'group'),
  ok('one character', 'Q', 'Q'),

  // Spaces
  no('empty', ''),
  no('spaces only', '   '),
  no('non-breaking space only', ' '),
  no('ideographic space only', '　　'),
  ok('trimmed at both ends', '  Ana Lee  ', 'Ana Lee'),
  ok('non-breaking space inside becomes a space', 'Ana Lee', 'Ana Lee'),
  ok('leading and trailing Unicode spaces removed', '　Ana ', 'Ana'),
  ok('runs of spaces collapse to one', 'Ana     Lee', 'Ana Lee'),
  ok('spaces do not count towards the limit', ' ' + 'x'.repeat(30) + ' ', 'x'.repeat(30)),

  // Line breaks and control characters: refused, never turned into spaces
  no('line feed inside', 'Ana\nLee'),
  no('carriage return inside', 'Ana\rLee'),
  no('tab inside', 'Ana\tLee'),
  no('line feed at the end', 'Ana\n'),
  no('U+0085 next line', 'Ana\u0085Lee'),
  no('U+2028 line separator', 'Ana Lee'),
  no('U+2029 paragraph separator', 'Ana Lee'),

  // Hidden and blank-looking characters
  no('zero-width space at the end', 'Ana​'),
  no('zero-width space splitting a word', 'sh​it'),
  no('zero-width non-joiner', 'Ana‌Lee'),
  no('word joiner', 'Ana⁠Lee'),
  no('byte order mark', '﻿Ana'),
  no('soft hyphen', 'An­a'),
  no('right-to-left override', 'Ana‮eL'),
  no('left-to-right mark', 'Ana‎'),
  no('first strong isolate', '⁨Ana'),
  no('braille blank only', '⠀'),
  no('Hangul filler only', 'ㅤ'),
  no('braille blank inside', 'Ana⠀Lee'),
  no('text-style variation selector', 'Ana︎'),
  no('tag characters', 'Ana\u{e0067}\u{e0062}'),

  // Joiner, emoji style and skin tones: only inside emoji
  ok('family emoji (joiners between emoji)', '👨‍👩‍👧', '👨‍👩‍👧'),
  ok('red heart with emoji style', '❤️', '❤️'),
  ok('thumbs up with a skin tone', '👍🏽', '👍🏽'),
  ok('woman technologist, skin tone then joiner', '👩🏽‍💻', '👩🏽‍💻'),
  ok('rainbow flag (emoji style then joiner)', '🏳️‍🌈', '🏳️‍🌈'),
  ok('flag (two regional indicators)', 'Ana 🇺🇸', 'Ana 🇺🇸'),
  no('joiner between letters', 'a‍b'),
  no('joiner at the end', '👍‍'),
  no('joiner at the start', '‍👍'),
  no('joiner after a letter, before an emoji', 'a‍👍'),
  no('joiner between "sh" and "it"', 'sh‍it'),
  no('emoji style after a letter', 'a️'),
  no('skin tone alone', '🏽'),
  no('skin tone after a letter', 'a🏽'),

  // Counting: one Unicode character each, after NFC
  ok('é typed as one character', 'José', 'José'),
  ok('é typed as e + accent is saved as one character', 'José', 'José'),
  ok('accented 30 typed as e + accent fits', 'é'.repeat(30), 'é'.repeat(30)),
  ok('family emoji counts 5', 'x'.repeat(25) + '👨‍👩‍👧', 'x'.repeat(25) + '👨‍👩‍👧'),
  no('family emoji over the limit', 'x'.repeat(26) + '👨‍👩‍👧'),
  ok('group: flag counts 2', 'x'.repeat(13) + '🇺🇸', 'x'.repeat(13) + '🇺🇸', 'group'),
  no('group: flag over the limit', 'x'.repeat(14) + '🇺🇸', 'group'),

  // Real names that must pass the shape rules
  ok('emoji and accents', 'Bé 🐝', 'Bé 🐝'),
  ok('Japanese', '山下 さくら', '山下 さくら'),
  ok('Arabic', 'نور', 'نور'),
  ok('Devanagari', 'प्रिया', 'प्रिया'),
  ok('apostrophe and hyphen', "O'Brien-Smith", "O'Brien-Smith"),
  ok('group with emoji', 'Walkers 🚶', 'Walkers 🚶', 'group'),
];
