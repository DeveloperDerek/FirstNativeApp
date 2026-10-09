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
  skyInk: string; // text drawn on the sky color (headers, coin balance)
  statusBar: 'dark' | 'light'; // status bar text over the sky
  button: string;
  buttonText: string;
  tiles: number[];
  landmarks: { steps: number; label: string; image: number }[];
};

export const DEFAULT_THEME_ID = 'map_village';

export const THEMES: Record<string, MapTheme> = {
  map_village: {
    id: 'map_village',
    label: 'Village',
    sky: '#bfe6ff',
    ground: '#c9a26b',
    ink: '#2a1a1a',
    skyInk: '#2a1a1a',
    statusBar: 'dark',
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
    skyInk: '#2a1a1a',
    statusBar: 'dark',
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
    skyInk: '#2a1a1a',
    statusBar: 'dark',
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
    skyInk: '#2a1a1a',
    statusBar: 'dark',
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
    skyInk: '#2a1a1a',
    statusBar: 'dark',
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

  // Dark skies: light text and a light status bar over them
  map_dungeon: {
    id: 'map_dungeon',
    label: 'Dungeon',
    sky: '#2b2635',
    ground: '#4f4756',
    ink: '#ffffff',
    skyInk: '#ffffff',
    statusBar: 'light',
    button: '#f2a03d',
    buttonText: '#2a1a1a',
    tiles: [
      require('@/assets/maps/dungeon/tile_a.png'),
      require('@/assets/maps/dungeon/tile_b.png'),
    ],
    landmarks: [
      { steps: 0, label: 'Iron gate', image: require('@/assets/maps/dungeon/start.png') },
      { steps: 5_000, label: 'Treasure chest', image: require('@/assets/maps/dungeon/mid.png') },
      {
        steps: 10_000,
        label: 'Crystal altar, the 10,000 step goal',
        image: require('@/assets/maps/dungeon/goal.png'),
      },
      { steps: 15_000, label: 'Stairway out', image: require('@/assets/maps/dungeon/far.png') },
    ],
  },

  map_space: {
    id: 'map_space',
    label: 'Space',
    sky: '#141a33',
    ground: '#a3a5b3',
    ink: '#1d1d2a',
    skyInk: '#ffffff',
    statusBar: 'light',
    button: '#3d2a9e',
    buttonText: '#ffffff',
    tiles: [require('@/assets/maps/space/tile_a.png'), require('@/assets/maps/space/tile_b.png')],
    landmarks: [
      { steps: 0, label: 'Launch pad', image: require('@/assets/maps/space/start.png') },
      { steps: 5_000, label: 'Moon rover', image: require('@/assets/maps/space/mid.png') },
      {
        steps: 10_000,
        label: 'Moon base, the 10,000 step goal',
        image: require('@/assets/maps/space/goal.png'),
      },
      { steps: 15_000, label: 'Radio telescope', image: require('@/assets/maps/space/far.png') },
    ],
  },

  // Under the sea: the "sky" is the water, the road is the seabed
  map_ocean: {
    id: 'map_ocean',
    label: 'Ocean',
    sky: '#276e9c',
    ground: '#e3cf9a',
    ink: '#2a1a1a',
    skyInk: '#ffffff',
    statusBar: 'light',
    button: '#1d3f73',
    buttonText: '#ffffff',
    tiles: [require('@/assets/maps/ocean/tile_a.png'), require('@/assets/maps/ocean/tile_b.png')],
    landmarks: [
      { steps: 0, label: 'Anchor', image: require('@/assets/maps/ocean/start.png') },
      { steps: 5_000, label: 'Giant clam', image: require('@/assets/maps/ocean/mid.png') },
      {
        steps: 10_000,
        label: 'Sunken ship, the 10,000 step goal',
        image: require('@/assets/maps/ocean/goal.png'),
      },
      { steps: 15_000, label: 'Submarine', image: require('@/assets/maps/ocean/far.png') },
    ],
  },
};

export const THEME_LIST = Object.values(THEMES);

/** Unknown or missing ids fall back to the village. */
export const getTheme = (id: string | null | undefined): MapTheme =>
  (id && THEMES[id]) || THEMES[DEFAULT_THEME_ID];
