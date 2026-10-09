import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { MapThemeProvider } from '@/hooks/use-map-theme';
import { useMarkSeen } from '@/hooks/use-mark-seen';
import { useWebFonts } from '@/hooks/use-web-fonts';
import { WalletProvider } from '@/hooks/use-wallet';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useWebFonts();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <WalletProvider>
          <MapThemeProvider>
            <RootNavigator />
            <AnimatedSplashOverlay />
          </MapThemeProvider>
        </WalletProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

// Signed out: only the sign-in screen. Signed in: the tabs, plus the
// consent screen, character editor, shop and quest proposal as modals.
function RootNavigator() {
  const { session, loading } = useAuth();
  useMarkSeen(session?.user.id);
  if (loading) return null; // reading the saved session takes a moment

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="consent" options={{ presentation: 'modal' }} />
        <Stack.Screen name="avatar" options={{ presentation: 'modal' }} />
        <Stack.Screen name="shop" options={{ presentation: 'modal' }} />
        <Stack.Screen name="propose-quest" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
