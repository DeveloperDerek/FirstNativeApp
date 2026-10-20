// The daily roll (step-tracker-daily-roll.txt): what the server's answer
// means, the reel, the spin's timing, and the slot machine's pixel art.
// The server decides the prize (supabase/migrations/*_daily_roll.sql); the
// machine only shows it. No React Native imports, so `npm test` can run it.

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Outcome = Rarity | 'coins';

/** What a roll gave: an item, or coins (item_id null). */
export type Prize = { item_id: string | null; rarity: Outcome; coins: number };

/** The 'roll' key from sync_day: null while the roll is off or not sharing. */
export type RollState =
  | null
  | { state: 'locked' }
  | { state: 'ready' }
  | ({ state: 'rolled'; seen: boolean } & Prize);

/** The capsule colours of the blueprint, now each tile's edge and the payline's flash. */
export const RARITY_COLOR: Record<Outcome, string> = {
  coins: '#f2c230',
  common: '#9aa0a8',
  uncommon: '#4cb86a',
  rare: '#3c8deb',
  epic: '#9a5be0',
  legendary: '#f5a000',
};

export const RARITY_LABEL: Record<Outcome, string> = {
  coins: 'Coins',
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/** An item's rarity from its price (the COIN-5 ladder, ROLL-7); the same as roll_rarity(). */
export function rarityOf(price: number): Rarity {
  if (price < 500) return 'common';
  if (price < 800) return 'uncommon';
  if (price < 1500) return 'rare';
  if (price < 2500) return 'epic';
  return 'legendary';
}

/** Epic, Legendary and 500 coins get the strong haptic and the long spin's crawl. */
export const isBigWin = (p: Prize) =>
  p.rarity === 'epic' || p.rarity === 'legendary' || (p.rarity === 'coins' && p.coins === 500);

/** "+250 coins", or the item's name; "a new item" for an id this app doesn't know. */
export function prizeName(p: Prize, itemName: (id: string) => string | undefined): string {
  if (p.item_id === null) return `+${p.coins.toLocaleString('en-US')} coins`;
  return itemName(p.item_id) ?? 'a new item';
}

/** The words the server's refusals mean on the roll screen. */
export function rollErrorText(message: string): string {
  if (message.includes('BAD_DAY')) return 'This roll ended at midnight.';
  if (message.includes('GOAL_NOT_REACHED')) return 'Reach today’s goal first, then roll.';
  if (message.includes('NO_SHARING')) return 'Turn on step sharing to get a daily roll.';
  if (message.includes('ROLL_OFF')) return 'The daily roll isn’t on yet.';
  return 'Couldn’t roll. Check your connection and try again.';
}

// ---------------------------------------------------------------- the reel

/** One tile on the reel. */
export type Tile = { kind: 'coins'; coins: 100 | 250 | 500 } | { kind: 'item'; id: string; rarity: Rarity };

/** An item the player could win, for the reel's other tiles. */
export type PoolItem = { id: string; rarity: Rarity };

/** The real chances, as roll_outcome() on the server picks them (ROLL-6). */
export const ROLL_CHANCES: [Outcome, number][] = [
  ['coins', 40],
  ['common', 31],
  ['uncommon', 19],
  ['rare', 6],
  ['epic', 3],
  ['legendary', 1],
];

/**
 * How often each kind shows on the reel's other tiles, which are only for
 * show (ROLL-17): fewer coins, so more of the items go by, and the items
 * among themselves at the real chances, so rare ones don't look likelier
 * next to the common ones than they are.
 */
export const REEL_CHANCES: [Outcome, number][] = [['coins', 10], ...ROLL_CHANCES.filter(([k]) => k !== 'coins')];
const COIN_CHANCES: [100 | 250 | 500, number][] = [
  [100, 6],
  [250, 3],
  [500, 1],
];

function pickWeighted<T>(pairs: [T, number][], random: () => number): T {
  let n = random() * pairs.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of pairs) if ((n -= w) < 0) return v;
  return pairs[0][0];
}

/** A random tile from what's left to win, at `chances` (rarities with nothing left skipped). */
export function randomTile(
  pool: PoolItem[],
  random: () => number = Math.random,
  chances: [Outcome, number][] = REEL_CHANCES
): Tile {
  const kinds = chances.filter(([k]) => k === 'coins' || pool.some((i) => i.rarity === k));
  const kind = pickWeighted(kinds, random);
  if (kind === 'coins') return { kind: 'coins', coins: pickWeighted(COIN_CHANCES, random) };
  const items = pool.filter((i) => i.rarity === kind);
  const item = items[Math.floor(random() * items.length)];
  return { kind: 'item', id: item.id, rarity: item.rarity };
}

export const tileFor = (p: Prize): Tile =>
  p.item_id === null
    ? { kind: 'coins', coins: p.coins as 100 | 250 | 500 }
    : { kind: 'item', id: p.item_id, rarity: p.rarity as Rarity };

export const sameTile = (a: Tile, b: Tile) =>
  a.kind === b.kind && (a.kind === 'coins' ? a.coins === (b as typeof a).coins : a.id === (b as typeof a).id);

/** Where the reel rests before a spin: this tile is on the line. */
export const REEL_START = 2;

/** Tiles a reel needs: the longest spin's stop, plus spare tiles past it for the overshoot. */
export const REEL_LENGTH = REEL_START + 48 + 3;

/** A reel of random tiles, built when the screen opens, before the prize is known. */
export function buildReel(pool: PoolItem[], random: () => number = Math.random): Tile[] {
  return Array.from({ length: REEL_LENGTH }, () => randomTile(pool, random));
}

/**
 * The reel with `prize` at `stop` and never a twin of it right next to
 * it, so the stop reads clearly. Only those three tiles change.
 */
export function placePrize(
  tiles: Tile[],
  stop: number,
  prize: Tile,
  pool: PoolItem[],
  random: () => number = Math.random
): Tile[] {
  const out = [...tiles];
  out[stop] = prize;
  for (const j of [stop - 1, stop + 1]) {
    for (let tries = 0; tries < 20 && sameTile(out[j], prize); tries++) out[j] = randomTile(pool, random);
  }
  return out;
}

// ---------------------------------------------------------------- the spin

export type SpinPlan = {
  /** The nudge back before it goes */
  windMs: number;
  /** Full speed down to the stop, past it by `overshoot` tiles */
  spinMs: number;
  /** Back onto the prize */
  settleMs: number;
  /** Tiles from the resting tile to the prize */
  tiles: number;
  overshoot: number;
  /** A longer crawl at the end (Epic, Legendary) */
  crawl: boolean;
};

/**
 * Rarer prizes spin longer, with a slower crawl at the end (section 5).
 * Long enough to watch a good run of prizes go by, not just a blur.
 */
export function spinPlan(rarity: Outcome): SpinPlan {
  const long = rarity === 'legendary' ? 2 : rarity === 'epic' ? 1 : 0;
  return {
    windMs: 160,
    spinMs: [5000, 5600, 6200][long],
    settleMs: 260,
    tiles: [40, 44, 48][long],
    overshoot: 0.22,
    crawl: long > 0,
  };
}

export function spinTotalMs(p: SpinPlan): number {
  'worklet';
  return p.windMs + p.spinMs + p.settleMs;
}

/** The tile on the line (fractional) t ms after the tap; the reel starts on REEL_START. */
export function reelPosition(t: number, p: SpinPlan): number {
  'worklet';
  const start = REEL_START;
  const stop = REEL_START + p.tiles;
  if (t <= 0) return start;
  if (t < p.windMs) return start - 0.25 * Math.sin(((t / p.windMs) * Math.PI) / 2);
  if (t < p.windMs + p.spinMs) {
    const u = (t - p.windMs) / p.spinMs;
    const quint = 1 - Math.pow(1 - u, 5);
    const cubic = 1 - Math.pow(1 - u, 3);
    const eased = p.crawl ? quint : 0.5 * cubic + 0.5 * quint;
    const from = start - 0.25;
    return from + (stop + p.overshoot - from) * eased;
  }
  if (t < p.windMs + p.spinMs + p.settleMs) {
    const u = (t - p.windMs - p.spinMs) / p.settleMs;
    return stop + p.overshoot * Math.pow(1 - u, 3);
  }
  return stop;
}

// ---------------------------------------------------------------- the art
// Pixel art drawn from code: [x, y, width, height, colour] rectangles in
// art pixels, scaled up by a whole number on screen.

export type Px = [number, number, number, number, string];

export const P = {
  out: '#1a1020',
  red: '#d23b4a',
  redHi: '#ef6a6f',
  redLo: '#8e2236',
  side: '#6a1a2c',
  sideLo: '#4a1220',
  gold: '#ffcf3a',
  goldLo: '#c08a10',
  chrome: '#c9cdd8',
  chromeHi: '#eef0f6',
  chromeLo: '#7d8394',
  marquee: '#3a1d5c',
  marqueeHi: '#5a2f8a',
  bulbOff: '#5b4a2a',
  bulbOn: '#fff2a8',
  bulbRed: '#ff8a8a',
  tray: '#2b1830',
  shadow: 'rgba(0,0,0,0.35)',
  knob: '#e23b3b',
  knobHi: '#ffb0a8',
  reel: '#f7f3e8',
  reelLine: '#ded6c2',
};

// 3 x 5 letters for the sign
const FONT: Record<string, string[]> = {
  D: ['110', '101', '101', '101', '110'],
  A: ['010', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
  Y: ['101', '101', '010', '010', '010'],
  R: ['110', '101', '110', '101', '101'],
  O: ['010', '101', '101', '101', '010'],
  ' ': ['000', '000', '000', '000', '000'],
};

/** Text centred on cx, `k` art pixels per letter pixel, with a shadow one pixel down. */
export function pixelText(text: string, cx: number, y: number, color: string, shade: string, k = 1): Px[] {
  const out: Px[] = [];
  let x = Math.round(cx - ((text.length * 4 - 1) * k) / 2);
  for (const ch of text) {
    FONT[ch].forEach((row, j) =>
      [...row].forEach((b, i) => {
        if (b !== '1') return;
        out.push([x + i * k, y + j * k + 1, k, k, shade]);
        out.push([x + i * k, y + j * k, k, k, color]);
      })
    );
    x += 4 * k;
  }
  // Shadows first, so no shadow lands on a letter
  return [...out.filter((_, i) => i % 2 === 0), ...out.filter((_, i) => i % 2 === 1)];
}

/** The big machine: 120 x 152 art pixels. */
export const MACHINE = {
  w: 120,
  h: 152,
  /** The reel window: three 24-pixel tiles, the middle one on the line */
  reel: { x: 22, y: 40, w: 64, h: 72 },
  tile: 24,
  /** The prize tray's mouth, where the prize card comes out */
  tray: { x: 54, y: 126 },
  lever: { baseY: 80, topY: 44, downY: 112 },
};

/** The parts that never move. */
export function machineBody(): Px[] {
  const r: Px[] = [];
  const add = (x: number, y: number, w: number, h: number, c: string) => r.push([x, y, w, h, c]);
  add(10, 146, 92, 4, P.shadow);
  // The darker right side (2.5D), 3 pixels higher than the front
  add(98, 23, 6, 97, P.side);
  add(98, 120, 6, 21, P.sideLo);
  add(98, 22, 6, 1, P.out);
  add(104, 23, 1, 121, P.out);
  // The front
  add(8, 24, 91, 121, P.out);
  add(9, 25, 89, 119, P.red);
  add(9, 25, 89, 2, P.redHi);
  add(9, 25, 2, 119, P.redHi);
  add(9, 132, 89, 12, P.redLo);
  add(8, 131, 91, 1, P.out);
  add(9, 118, 89, 2, P.gold);
  add(9, 120, 89, 1, P.goldLo);
  // The sign, with its own side
  add(4, 4, 100, 24, P.out);
  add(5, 5, 98, 22, P.marquee);
  add(5, 5, 98, 2, P.marqueeHi);
  add(104, 2, 5, 23, P.sideLo);
  add(104, 1, 5, 1, P.out);
  add(109, 2, 1, 23, P.out);
  r.push(...pixelText('DAILY ROLL', 54, 11, P.gold, P.goldLo, 2));
  // The chrome frame round the reel
  add(18, 36, 72, 80, P.out);
  add(19, 37, 70, 78, P.chrome);
  add(19, 37, 70, 1, P.chromeHi);
  add(19, 37, 1, 78, P.chromeHi);
  add(19, 114, 70, 1, P.chromeLo);
  add(88, 37, 1, 78, P.chromeLo);
  add(21, 39, 66, 74, P.out);
  // The tray and feet
  add(30, 122, 48, 8, P.out);
  add(31, 123, 46, 6, P.tray);
  add(31, 123, 46, 1, '#000000');
  add(12, 144, 10, 3, P.out);
  add(86, 144, 10, 3, P.out);
  // The lever's mount
  add(104, 76, 7, 12, P.out);
  add(105, 77, 5, 10, P.chromeLo);
  add(105, 77, 5, 1, P.chrome);
  add(110, MACHINE.lever.baseY - 1, 4, 3, P.out);
  return r;
}

/** The payline arrows either side of the middle tile. */
export function paylineArrows(): Px[] {
  const r: Px[] = [];
  for (let i = 0; i < 4; i++) {
    r.push([12 + i, 73 + i, 1, 7 - i * 2, '']);
    r.push([95 - i, 73 + i, 1, 7 - i * 2, '']);
  }
  return r;
}

/** The sign's bulbs, in chase order: along the top, then back along the bottom. */
export function machineBulbs(): [number, number][] {
  const b: [number, number][] = [];
  for (let x = 8; x <= 99; x += 6) b.push([x, 7]);
  for (let x = 99; x >= 8; x -= 6) b.push([x, 23]);
  return b;
}

/**
 * Whether bulb i is lit. Idle: every 4th, chasing slowly. Spinning: every
 * 3rd, chasing fast. Won: all blinking together.
 */
export function bulbOn(i: number, chase: number, mode: 'idle' | 'spin' | 'win'): boolean {
  'worklet';
  const c = Math.floor(chase);
  if (mode === 'win') return c % 2 === 0;
  return (i + c) % (mode === 'spin' ? 3 : 4) === 0;
}

/** The small machine on Today: its own 32 x 40 sprite. */
export const MINI = {
  w: 32,
  h: 40,
  reel: { x: 7, y: 14, w: 16, h: 14 },
};

export function miniBody(): Px[] {
  const r: Px[] = [];
  const add = (x: number, y: number, w: number, h: number, c: string) => r.push([x, y, w, h, c]);
  add(3, 38, 24, 2, P.shadow);
  add(27, 11, 2, 27, P.side);
  add(29, 11, 1, 27, P.out);
  add(2, 10, 25, 28, P.out);
  add(3, 11, 23, 26, P.red);
  add(3, 11, 1, 26, P.redHi);
  add(3, 33, 23, 1, P.gold);
  add(3, 34, 23, 3, P.redLo);
  add(1, 0, 28, 11, P.out);
  add(2, 1, 26, 9, P.marquee);
  r.push(...pixelText('ROLL', 15, 3, P.gold, P.marquee));
  add(5, 12, 20, 18, P.chrome);
  add(6, 13, 18, 16, P.out);
  add(4, 20, 1, 2, P.gold);
  add(25, 20, 1, 2, P.gold);
  add(10, 30, 10, 2, P.out);
  add(30, 22, 2, 5, P.chromeLo);
  add(30, 14, 1, 8, P.chrome);
  add(29, 11, 3, 3, P.knob);
  add(29, 11, 1, 1, P.knobHi);
  return r;
}

export function miniBulbs(): [number, number][] {
  const b: [number, number][] = [];
  for (let i = 0; i < 9; i++) b.push([3 + i * 3, 1]);
  for (let i = 0; i < 9; i++) b.push([27 - i * 3, 9]);
  return b;
}

// ---------------------------------------------------------------- coins
// One 12 x 12 coin spinning in four frames: front, three-quarter turn,
// edge, three-quarter turn the other way; a white shine crosses the front
// every third turn.

export const COIN_PALETTE: Record<string, string> = {
  k: '#1f1d36',
  l: '#ffe27a',
  y: '#ffc12e',
  o: '#f08a1c',
  w: '#ffffff',
};

const FACE = [
  '...kkkkkk...',
  '..kllllllk..',
  '.kllyyyyyok.',
  'klyooooooyok',
  'klyolllyoyok',
  'klyolyyyoyok',
  'klyolyyyoyok',
  'klyoyyyyoyok',
  'klyooooooyok',
  '.kyyyyyyyok.',
  '..kooooook..',
  '...kkkkkk...',
];
const TURN = [
  '....kkkk....',
  '...kllyyk...',
  '..klyyyyok..',
  '..kloooyok..',
  '..kloloyok..',
  '..kloyoyok..',
  '..kloyoyok..',
  '..kloyoyok..',
  '..kloooyok..',
  '..kyyyyyok..',
  '...kooook...',
  '....kkkk....',
];
const EDGE = ['.....kk.....', ...Array<string>(10).fill('....klok....'), '.....kk.....'];
const flipX = (rows: string[]) => rows.map((r) => [...r].reverse().join(''));
const GLINT = FACE.map((r, j) =>
  [...r].map((ch, i) => (ch !== '.' && ch !== 'k' && (i + j === 6 || i + j === 7) ? 'w' : ch)).join('')
);

/** The frames, in order: front, turn, edge, turn back, then the front with its shine. */
export const COIN_FRAMES = [FACE, TURN, EDGE, flipX(TURN), GLINT];
export const COIN_SIZE = 12;
/** Each frame shows this long */
export const COIN_FRAME_MS = 120;
/** How far a coin floats up and down, in art pixels */
export const COIN_BOB = 2;

/** A frame's pixels as rectangles, one per run of a colour along a row. */
export function framePixels(rows: string[]): Px[] {
  const out: Px[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== '.') out.push([x, y, end - x, 1, COIN_PALETTE[ch]]);
      x = end;
    }
  });
  return out;
}

/** The frame (an index into COIN_FRAMES) showing at `ms` for a coin starting at `phase`. */
export function coinFrame(ms: number, phase: number): number {
  'worklet';
  const step = Math.floor(ms / COIN_FRAME_MS + phase);
  const f = step % 4;
  return f === 0 && Math.floor(step / 4) % 3 === 0 ? 4 : f;
}

/** How high a coin floats (0 to COIN_BOB, in whole art pixels) at `ms`. */
export function coinLift(ms: number, phase: number): number {
  'worklet';
  return Math.round(((1 + Math.sin(ms / 450 + phase * 1.7)) * COIN_BOB) / 2);
}

/**
 * 100 is one coin, 250 three in a row (the middle one higher), 500 two
 * staggered rows of three. 500 is the widest and sets the one scale every
 * coin tile on the reel uses, so coins are the same size on every tile.
 */
export const COIN_GROUPS: Record<100 | 250 | 500, { w: number; h: number; at: [number, number][] }> = {
  100: { w: 12, h: 12, at: [[0, 0]] },
  250: { w: 38, h: 16, at: [[0, 4], [13, 0], [26, 4]] },
  500: { w: 44, h: 16, at: [[0, 0], [13, 0], [26, 0], [6, 4], [19, 4], [32, 4]] },
};
