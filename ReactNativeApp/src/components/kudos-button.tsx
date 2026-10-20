import { Canvas, Image } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { type ActivityLine, kudosLabel } from '@/activity/activity';
import { CRISP, useSprite } from '@/avatar/Avatar';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';
import { PixelGlyph, textRows } from '@/track/pixel-glyph';

// The kudos button (step-tracker-kudos.txt, section 5): a party popper,
// 20 x 20 pixel art from scripts/generate-avatar-sprites.py, in a rounded
// pill with the count in pixel digits (the road markers' 3 x 5 font, 3
// points a pixel). Light before you give kudos, gold after, and two
// frames of confetti in between.
const SIZE = 20;
const SCALE = 2;
const DIGIT_PX = 3;
const POP_FRAME_MS = 90;
// The digits: the art's outline color, or its off-white in dark mode
const INK = { light: '#3A2A2A', dark: '#ECE6DC' };
// The pill once given: the popper's gold, faint
const GIVEN_PILL = 'rgba(242, 201, 76, 0.28)';

const LOOKS = {
  ready: require('@/assets/badges/kudos.png'),
  given: require('@/assets/badges/kudos_given.png'),
  pop1: require('@/assets/badges/kudos_pop_1.png'),
  pop2: require('@/assets/badges/kudos_pop_2.png'),
};
type Look = keyof typeof LOOKS;

function Popper({ look }: { look: Look }) {
  const image = useSprite(LOOKS[look]);
  return (
    <Canvas style={styles.popper}>
      {image && (
        <Image
          image={image}
          x={0}
          y={0}
          width={SIZE * SCALE}
          height={SIZE * SCALE}
          fit="fill"
          sampling={CRISP}
        />
      )}
    </Canvas>
  );
}

/**
 * On a friend's line: the popper to give kudos, with the count. On your own
 * line: the count (with a dot while some are new), which opens who gave
 * them. Nothing on your own line at 0.
 */
export function KudosButton({
  line,
  name,
  isMe,
  onGive,
  onOpenGivers,
}: {
  line: ActivityLine;
  /** The friend's name, for the screen reader */
  name: string;
  isMe: boolean;
  onGive: () => void;
  onOpenGivers: () => void;
}) {
  const theme = useTheme();
  const ink = INK[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const count = line.kudos ?? 0;
  const [pop, setPop] = useState<Look | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (isMe && count === 0) return null;

  function give() {
    if (line.my_kudos) return; // given already: nothing to do
    setPop('pop1');
    haptics.tap();
    timers.current = [
      setTimeout(() => setPop('pop2'), POP_FRAME_MS),
      setTimeout(() => setPop(null), POP_FRAME_MS * 2),
    ];
    onGive();
  }

  const given = isMe || Boolean(line.my_kudos);
  const look: Look = pop ?? (given ? 'given' : 'ready');
  return (
    <Pressable
      onPress={isMe ? onOpenGivers : give}
      accessibilityRole="button"
      accessibilityLabel={kudosLabel(line, name, isMe)}
      accessibilityState={{ selected: !isMe && Boolean(line.my_kudos) }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: given ? GIVEN_PILL : theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <Popper look={look} />
      {count > 0 && <PixelGlyph rows={textRows(String(count))} outline={ink} fill={ink} px={DIGIT_PX} />}
      {isMe && Boolean(line.new_kudos) && (
        <View style={[styles.dot, { backgroundColor: theme.danger }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48, // easy to hit, apart from the line around it
    minWidth: 56,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  pressed: {
    opacity: 0.6,
  },
  popper: {
    width: SIZE * SCALE,
    height: SIZE * SCALE,
  },
  // In the corner, so it doesn't widen the pill (the board keeps every
  // pill the same width)
  dot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
