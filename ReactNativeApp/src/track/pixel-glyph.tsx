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

export const DIAMOND = ['.O.', 'OFO', '.O.'];

// A pole with a pennant at the top
export const FLAG = ['OFFF', 'OFF.', 'OF..', 'O...', 'O...', 'O...', 'O...'];

export const GLYPH_PX = 2;

export function glyphSize(rows: string[]) {
  return { width: rows[0].length * GLYPH_PX, height: rows.length * GLYPH_PX };
}

/** One glyph: `outline` and `fill` colors for its O and F pixels. */
export function PixelGlyph({ rows, outline, fill }: { rows: string[]; outline: string; fill: string }) {
  return (
    <View style={glyphSize(rows)} pointerEvents="none">
      {rows.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === 'O' || c === 'F' ? (
            <View
              key={`${x},${y}`}
              style={{
                position: 'absolute',
                left: x * GLYPH_PX,
                top: y * GLYPH_PX,
                width: GLYPH_PX,
                height: GLYPH_PX,
                backgroundColor: c === 'O' ? outline : fill,
              }}
            />
          ) : null
        )
      )}
    </View>
  );
}
