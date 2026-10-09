import { useFonts } from 'expo-font';

/**
 * Web has no build step for fonts, so load the MapleStory font here under
 * the same names as Android (GameFont in constants/theme.ts). Text shows in
 * the browser's font for a moment until it arrives.
 */
export function useWebFonts() {
  useFonts({
    'Maplestory-Light': require('@/assets/fonts/Maplestory-Light.ttf'),
    'Maplestory-Bold': require('@/assets/fonts/Maplestory-Bold.ttf'),
  });
}
