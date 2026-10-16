import { Canvas, FillType, Group, rect, Rect, Skia, type SkPath, type SkRect } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { type SharedValue, useDerivedValue } from 'react-native-reanimated';

import { HEADROOM, Layer, SPRITE_H, SPRITE_W } from './Avatar';
import { BODY, findItem } from './catalog';
import type { AvatarConfig } from './types';

// Where the limbs are on the 32 x 48 character (feet on row 46), as drawn
// by scripts/generate-avatar-sprites.py
const LOWER_LEGS = 42; // from this row down, each leg lifts on its own
const MIDDLE = 16; // the left leg is columns 0-15, the right 16 on
const HANDS = { top: 32, bottom: 39 }; // the lower arms and hands, rows 32-38
const LEFT_ARM = 11; // columns 0-10
const RIGHT_ARM = 21; // columns 21 on
// Faces with open eyes, which blink. Each eye is 4 columns from its x - 1
// and rows 13-17; shut, it is the face's closed-eye curve.
const BLINKERS = new Set([
  'face_smile',
  'face_neutral',
  'face_determined',
  'face_surprised',
  'face_cat',
  'face_starry',
  'face_wink',
]);
const EYES = [10, 20];
const EYE_DARK = '#2b1e24';

/**
 * Stardew-style walk, front on, in sprite pixels per frame: stand, left
 * step, stand, right step. On a step the stepping foot lifts, the other
 * hand swings forward (up), and the body above the lower legs drops a
 * pixel onto the standing leg.
 */
const FRAMES = [
  { bob: 0, legL: 0, legR: 0, armL: 0, armR: 0 },
  { bob: 1, legL: -1, legR: 0, armL: 0, armR: -1 },
  { bob: 0, legL: 0, legR: 0, armL: 0, armR: 0 },
  { bob: 1, legL: 0, legR: -1, armL: -1, armR: 0 },
];
export const WALK_FRAMES = FRAMES.length;

export type Pose = {
  /** 0 to 3, a frame of FRAMES */
  frame: SharedValue<number>;
  /** Eyes 1 pixel left (-1), ahead (0) or right (1) */
  look: SharedValue<number>;
  /** 1 while the eyes are shut */
  blink: SharedValue<number>;
};

/**
 * The character as Avatar draws it, walking: the legs, lower arms and
 * the rest are drawn as separate pieces of the same layers and moved a
 * whole pixel at a time, so every item walks without frames of its own.
 */
export function WalkingAvatar({
  config,
  pose,
  scale,
  accessibilityLabel = 'Character',
}: {
  config: AvatarConfig;
  pose: Pose;
  /** Whole number, like Avatar. */
  scale: number;
  accessibilityLabel?: string;
}) {
  const s = scale;
  const hair = findItem('hair', config.hair);
  const cape = findItem('cape', config.cape);
  const outfit = findItem('outfit', config.outfit);
  const hand = findItem('hand', config.hand);
  const face = findItem('face', config.face);
  const blinks = face !== undefined && BLINKERS.has(face.id);

  const clips = useMemo(() => {
    // Sprite columns and rows to canvas points (rows start in the headroom)
    const box = (x0: number, y0: number, x1: number, y1: number) =>
      rect(x0 * s, (y0 + HEADROOM) * s, (x1 - x0) * s, (y1 - y0) * s);
    const upper = box(0, -HEADROOM, SPRITE_W, LOWER_LEGS);
    const armL = box(0, HANDS.top, LEFT_ARM, HANDS.bottom);
    const armR = box(RIGHT_ARM, HANDS.top, SPRITE_W, HANDS.bottom);
    // The upper body with the lower arms cut out
    const torso = Skia.Path.Make();
    [upper, armL, armR].forEach((r) => torso.addRect(r));
    torso.setFillType(FillType.EvenOdd);
    const eyes = Skia.Path.Make();
    EYES.forEach((x) => eyes.addRect(box(x - 1, 13, x + 3, 18)));
    return {
      upper,
      torso,
      armL,
      armR,
      legL: box(0, LOWER_LEGS, MIDDLE, H_ROWS),
      legR: box(MIDDLE, LOWER_LEGS, SPRITE_W, H_ROWS),
      eyes,
    };
  }, [s]);

  const at = (pick: (f: (typeof FRAMES)[number]) => number) => {
    'worklet';
    return [{ translateY: pick(FRAMES[pose.frame.get()] ?? FRAMES[0]) * s }];
  };
  const body = useDerivedValue(() => at((f) => f.bob));
  const armL = useDerivedValue(() => at((f) => f.bob + f.armL));
  const armR = useDerivedValue(() => at((f) => f.bob + f.armR));
  const legL = useDerivedValue(() => at((f) => f.legL));
  const legR = useDerivedValue(() => at((f) => f.legR));
  const head = useDerivedValue(() => [
    { translateX: pose.look.get() * s },
    { translateY: (FRAMES[pose.frame.get()] ?? FRAMES[0]).bob * s },
  ]);
  const open = useDerivedValue(() => (blinks ? 1 - pose.blink.get() : 1));
  const shut = useDerivedValue(() => (blinks ? pose.blink.get() : 0));

  // The layers that walk, back to front. Bottoms and shoes have no arms:
  // a skirt beside the hands stays with the body.
  const walkers = [
    { source: BODY, tint: config.skin, arms: true },
    { source: outfit ? undefined : findItem('bottom', config.bottom)?.image, arms: false },
    { source: findItem('shoes', config.shoes)?.image, arms: false },
    { source: outfit ? outfit.image : findItem('top', config.top)?.image, arms: true },
  ];
  // One piece: each walking layer clipped to it, moved together
  const piece = (transform: typeof body, clip: (arms: boolean) => SkRect | SkPath | null) => (
    <Group transform={transform}>
      {walkers.map((l, i) => {
        const c = clip(l.arms);
        return c ? (
          <Group key={i} clip={c}>
            <Layer source={l.source} scale={s} tint={l.tint} />
          </Group>
        ) : null;
      })}
    </Group>
  );

  return (
    <Canvas
      style={{ width: SPRITE_W * s, height: SPRITE_H * s }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}>
      <Group transform={body}>
        <Layer source={cape?.back} scale={s} />
        <Layer source={hair?.back} scale={s} tint={config.hairColor} />
      </Group>
      {/* Held in their left hand (on the right), so it swings with that arm */}
      <Group transform={armR}>
        <Layer source={hand?.back} scale={s} />
      </Group>
      {piece(armL, (arms) => (arms ? clips.armL : null))}
      {piece(armR, (arms) => (arms ? clips.armR : null))}
      {piece(body, (arms) => (arms ? clips.torso : clips.upper))}
      {/* Last, so a skirt's hem and the legs keep their outline when the
          body drops onto them */}
      {piece(legL, () => clips.legL)}
      {piece(legR, () => clips.legR)}
      <Group transform={head}>
        <Group opacity={open}>
          <Layer source={face?.image} scale={s} />
        </Group>
        {blinks && (
          <Group opacity={shut}>
            <Group clip={clips.eyes} invertClip>
              <Layer source={face?.image} scale={s} />
            </Group>
            {EYES.flatMap((x) =>
              [
                [x - 1, 15],
                [x, 16],
                [x + 1, 16],
                [x + 2, 15],
              ].map(([px, py]) => (
                <Rect key={`${px},${py}`} x={px * s} y={(py + HEADROOM) * s} width={s} height={s} color={EYE_DARK} />
              ))
            )}
          </Group>
        )}
        <Layer source={findItem('glasses', config.glasses)?.image} scale={s} />
      </Group>
      <Group transform={body}>
        <Layer source={hair?.image} scale={s} tint={config.hairColor} />
        <Layer source={findItem('hat', config.hat)?.image} scale={s} />
        <Layer source={cape?.image} scale={s} />
      </Group>
      <Group transform={armR}>
        <Layer source={hand?.image} scale={s} />
      </Group>
    </Canvas>
  );
}

const H_ROWS = SPRITE_H - HEADROOM; // the character's 48 rows
