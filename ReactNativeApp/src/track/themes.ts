// Map themes for the step road (step-tracker-stage7.txt). A theme is one
// object: colors, background tiles and landmark buildings. The ids double
// as shop item ids (supabase/migrations/*_map_themes.sql); map_village is
// free. The sky and ground colors must match the art exactly (see
// scripts/generate-avatar-sprites.py) or a line shows where they meet.
//
// Metro needs every require() written out, so each image is listed.

export type MapTheme = {
  id: string; // also the shop item id
  label: string;
  sky: string; // everything above the road
  ground: string; // everything below the road
  ink: string; // text drawn on the ground color
  button: string;
  buttonText: string;
  tiles: number[];
  landmarks: { steps: number; label: string; image: number }[];
};

export const DEFAULT_THEME_ID = 'map_village';

/** Text drawn on any of the (all light) sky colors. */
export const SKY_INK = '#2a1a1a';

export const THEMES: Record<string, MapTheme> = {
  map_village: {
    id: 'map_village',
    label: 'Village',
    sky: '#bfe6ff',
    ground: '#c9a26b',
    ink: '#2a1a1a',
    button: '#8c1c15',
    buttonText: '#ffffff',
    tiles: [
      require('@/assets/maps/village/tile_a.png'),
      require('@/assets/maps/village/tile_b.png'),
    ],
    landmarks: [
      { steps: 0, label: 'Village gate', image: require('@/assets/maps/village/start.png') },
      { steps: 5_000, label: 'Bakery', image: require('@/assets/maps/village/mid.png') },
      {
        steps: 10_000,
        label: 'Town hall, the 10,000 step goal',
        image: require('@/assets/maps/village/goal.png'),
      },
      { steps: 15_000, label: 'Windmill', image: require('@/assets/maps/village/far.png') },
    ],
  },

  map_forest: {
    id: 'map_forest',
    label: 'Forest',
    sky: '#cfeedd',
    ground: '#3f5a2a',
    ink: '#ffffff',
    button: '#f7c948',
    buttonText: '#2a1a1a',
    tiles: [
      require('@/assets/maps/forest/tile_a.png'),
      require('@/assets/maps/forest/tile_b.png'),
    ],
    landmarks: [
      { steps: 0, label: 'Trailhead sign', image: require('@/assets/maps/forest/start.png') },
      { steps: 5_000, label: 'Log bridge', image: require('@/assets/maps/forest/mid.png') },
      {
        steps: 10_000,
        label: 'Great tree, the 10,000 step goal',
        image: require('@/assets/maps/forest/goal.png'),
      },
      { steps: 15_000, label: 'Waterfall', image: require('@/assets/maps/forest/far.png') },
    ],
  },

  map_city: {
    id: 'map_city',
    label: 'City',
    sky: '#c9d6e8',
    ground: '#4a4f5a',
    ink: '#ffffff',
    button: '#ff9a3d',
    buttonText: '#2a1a1a',
    tiles: [require('@/assets/maps/city/tile_a.png'), require('@/assets/maps/city/tile_b.png')],
    landmarks: [
      { steps: 0, label: 'Subway entrance', image: require('@/assets/maps/city/start.png') },
      { steps: 5_000, label: 'Coffee cart', image: require('@/assets/maps/city/mid.png') },
      {
        steps: 10_000,
        label: 'Clock tower, the 10,000 step goal',
        image: require('@/assets/maps/city/goal.png'),
      },
      { steps: 15_000, label: 'Stadium', image: require('@/assets/maps/city/far.png') },
    ],
  },

  map_beach: {
    id: 'map_beach',
    label: 'Beach',
    sky: '#9fdcf5',
    ground: '#f0d9a0',
    ink: '#2a1a1a',
    button: '#0f5f5d',
    buttonText: '#ffffff',
    tiles: [require('@/assets/maps/beach/tile_a.png'), require('@/assets/maps/beach/tile_b.png')],
    landmarks: [
      { steps: 0, label: 'Boardwalk arch', image: require('@/assets/maps/beach/start.png') },
      { steps: 5_000, label: 'Surf shack', image: require('@/assets/maps/beach/mid.png') },
      {
        steps: 10_000,
        label: 'Lighthouse, the 10,000 step goal',
        image: require('@/assets/maps/beach/goal.png'),
      },
      { steps: 15_000, label: 'Pier', image: require('@/assets/maps/beach/far.png') },
    ],
  },

  map_mountain: {
    id: 'map_mountain',
    label: 'Mountain',
    sky: '#dfe8f5',
    ground: '#5a5d6b',
    ink: '#ffffff',
    button: '#ffd166',
    buttonText: '#2a1a1a',
    tiles: [
      require('@/assets/maps/mountain/tile_a.png'),
      require('@/assets/maps/mountain/tile_b.png'),
    ],
    landmarks: [
      { steps: 0, label: 'Base camp', image: require('@/assets/maps/mountain/start.png') },
      { steps: 5_000, label: 'Rope bridge', image: require('@/assets/maps/mountain/mid.png') },
      {
        steps: 10_000,
        label: 'Summit flag, the 10,000 step goal',
        image: require('@/assets/maps/mountain/goal.png'),
      },
      { steps: 15_000, label: 'Observatory', image: require('@/assets/maps/mountain/far.png') },
    ],
  },
};

export const THEME_LIST = Object.values(THEMES);

/** Unknown or missing ids fall back to the village. */
export const getTheme = (id: string | null | undefined): MapTheme =>
  (id && THEMES[id]) || THEMES[DEFAULT_THEME_ID];
