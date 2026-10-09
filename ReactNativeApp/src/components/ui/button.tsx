import { ThemedButton } from '@/components/themed-button';
import { useMapTheme } from '@/hooks/use-map-theme';

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'large' | 'small';
  loading?: boolean;
  disabled?: boolean;
};

/**
 * The app-wide button: a ThemedButton in the user's map colors, so every
 * screen matches the step road. Secondary buttons use the swapped colors;
 * danger stays red on every map.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'large',
  loading = false,
  disabled = false,
}: ButtonProps) {
  const theme = useMapTheme();
  return (
    <ThemedButton
      title={title}
      onPress={onPress}
      theme={theme}
      size={size}
      loading={loading}
      disabled={disabled}
      selected={variant === 'secondary'}
      danger={variant === 'danger'}
    />
  );
}
