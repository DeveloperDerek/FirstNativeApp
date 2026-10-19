import { View } from 'react-native';

// Small pixel-art markers drawn from Views, 2 points per pixel like the
// rest of the art. Each row is a string: O outline, F fill, anything
// else empty.

export const STAR = [
  '...O...',
  '..OFO..',
  'OOOFOOO',
  'OFFFFFO',
  '.OFFFO.',
  '.OFOFO.',
  '.OO.OO.',
];

// A pole with a pennant at the top
export const FLAG = ['OFFF', 'OFF.', 'OF..', 'O...', 'O...', 'O...', 'O...'];

// 3 x 5 digits and K, for the step count on the road's markers
const CHARS: Record<string, string[]> = {
  '0': ['FFF', 'F.F', 'F.F', 'F.F', 'FFF'],
  '1': ['.F.', 'FF.', '.F.', '.F.', 'FFF'],
  '2': ['FFF', '..F', 'FFF', 'F..', 'FFF'],
  '3': ['FFF', '..F', '.FF', '..F', 'FFF'],
  '4': ['F.F', 'F.F', 'FFF', '..F', '..F'],
  '5': ['FFF', 'F..', 'FFF', '..F', 'FFF'],
  '6': ['FFF', 'F..', 'FFF', 'F.F', 'FFF'],
  '7': ['FFF', '..F', '.F.', '.F.', '.F.'],
  '8': ['FFF', 'F.F', 'FFF', 'F.F', 'FFF'],
  '9': ['FFF', 'F.F', 'FFF', '..F', 'FFF'],
  K: ['F.F', 'F.F', 'FF.', 'F.F', 'F.F'],
};

/** Rows for a short text of digits and K, a pixel apart. */
export function textRows(text: string): string[] {
  const chars = [...text].map((c) => CHARS[c]);
  return CHARS['0'].map((_, y) => chars.map((rows) => rows[y]).join('.'));
}

export const GLYPH_PX = 2;

export function glyphSize(rows: string[], px = GLYPH_PX) {
  return { width: rows[0].length * px, height: rows.length * px };
}

/** One glyph: `outline` and `fill` colors for its O and F pixels, `px` points each. */
export function PixelGlyph({
  rows,
  outline,
  fill,
  px = GLYPH_PX,
}: {
  rows: string[];
  outline: string;
  fill: string;
  px?: number;
}) {
  return (
    <View style={glyphSize(rows, px)} pointerEvents="none">
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === 'O' || c === 'F' ? (
            <View
              key={`${x},${y}`}
              style={{
                position: 'absolute',
                left: x * px,
                top: y * px,
                width: px,
                height: px,
                backgroundColor: c === 'O' ? outline : fill,
              }}
            />
          ) : null
        )
      )}
    </View>
  );
}
