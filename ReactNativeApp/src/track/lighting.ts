// Time-of-day lighting for the maps. scripts/generate-map-lighting.py
// draws each lit map (day, sunset, night) and writes
// lighting.generated.ts; lightTheme() swaps a theme's colors and art for
// the current phase, so every screen that paints with the theme follows
// the clock. Maps without lighting yet are returned unchanged.

import { LIGHTING } from './lighting.generated';
import type { MapTheme } from './themes';
import type { DayPhase } from './time-of-day';

/** One map at one time of day (all sizes in art pixels, 2 points each). */
export type PhaseLighting = {
  sky: string;
  skyInk: string;
  statusBar: 'dark' | 'light';
  ground: string;
  ink: string;
  /** The road's color in shadow, for the characters' shadows */
  shadowColor: string;
  tiles: number[];
  /** start, mid, goal, far: the order of MapTheme.landmarks */
  landmarks: number[];
  landmarkShadows: number[];
  /** Where each landmark's shadow image sits, from the landmark's left edge */
  shadowBoxes: { left: number; width: number }[];
  /** Fixed to the screen behind the scenery */
  skyImage: number;
  /** Far and near hill strips, 256 wide, seamless */
  hills: number[];
  /** Stars in skyImage, for twinkling */
  stars: number[][];
  /** Skia color matrix that puts a character in this light */
  avatarMatrix: number[];
  /** How far a shadow reaches sideways per unit of height (negative: to the left) */
  shadowLength: number;
  /** A character's shadow; row 0 is at their feet, left is from the sprite's left edge */
  walkerShadow: { source: number; left: number; width: number; height: number };
};

export type ThemeLighting = {
  phases: Record<DayPhase, PhaseLighting>;
  /** Chimney tops [x, y] on tile_a and tile_b */
  chimneys: number[][][];
  landmarkChimneys: number[][][];
  /** Window glass [x, y, w, h] on tile_a and tile_b */
  windows: number[][][];
  landmarkWindows: number[][][];
};

export type LightingTable = Record<string, ThemeLighting>;

/** What the road draws beyond the theme's tiles and landmarks. */
export type Scenery = PhaseLighting &
  Omit<ThemeLighting, 'phases'> & {
    phase: DayPhase;
  };

/** Theme ids are map_<name>; the table is keyed by <name>. */
const lightingFor = (theme: MapTheme) => LIGHTING[theme.id.replace(/^map_/, '')];

export function lightTheme(theme: MapTheme, phase: DayPhase): MapTheme {
  const table = lightingFor(theme);
  if (!table) return theme;
  const { phases, ...anchors } = table;
  const lit = phases[phase];
  return {
    ...theme,
    sky: lit.sky,
    skyInk: lit.skyInk,
    statusBar: lit.statusBar,
    ground: lit.ground,
    ink: lit.ink,
    tiles: lit.tiles,
    landmarks: theme.landmarks.map((l, i) => ({ ...l, image: lit.landmarks[i] ?? l.image })),
    scenery: { ...lit, ...anchors, phase },
  };
}
