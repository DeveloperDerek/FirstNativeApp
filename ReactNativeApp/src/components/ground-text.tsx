import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { useMapTheme } from '@/hooks/use-map-theme';

/**
 * Text drawn straight onto the map's ground color. Three of the five
 * grounds are dark, so plain text disappears on them; anything with
 * several lines per row belongs in a Section card instead.
 */
export function GroundText({ style, ...rest }: Omit<ThemedTextProps, 'themeColor'>) {
  const { theme } = useMapTheme();
  return <ThemedText {...rest} style={[{ color: theme.ink }, style]} />;
}
