import {
  DarkTheme,
  DefaultTheme,
  type Href,
  Stack,
  ThemeProvider,
  useGlobalSearchParams,
  usePathname,
  useRouter,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { redirectFor } from '@/auth/route';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { LoadFailedScreen, LoadingScreen } from '@/components/startup-screens';
import { MapThemeProvider } from '@/hooks/use-map-theme';
import { useMarkSeen } from '@/hooks/use-mark-seen';
import { useWebFonts } from '@/hooks/use-web-fonts';
import { WalletProvider } from '@/hooks/use-wallet';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useWebFonts();
  return (
    // Swipe gestures (leaderboard rows) need this at the root
    <GestureHandlerRootView style={styles.root}>
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
    </GestureHandlerRootView>
  );
}

// The only place that decides the screen (step-tracker-register.txt,
// section 7). Signed out: sign-in. Signed in: "Set a new password" after a
// reset link, then step 2 until the profile is finished, the blocked or
// Updated Terms screen when those apply, and otherwise the tabs with the
// consent screen, character editor, shop and quest proposal as modals.
function RootNavigator() {
  const { session, route } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useMarkSeen(route === 'app' ? session?.user.id : undefined);

  // Each state on its own screen. The guards alone can land on an
  // email-link page with no link, and its Continue would come straight
  // back there (route.ts, redirectFor).
  const { token_hash } = useGlobalSearchParams<{ token_hash?: string }>();
  useEffect(() => {
    const to = redirectFor(route, pathname, !!token_hash);
    if (to) router.replace(to as Href);
  }, [route, pathname, token_hash, router]);

  if (route === 'starting') return null; // reading the saved session takes a moment
  if (route === 'loading') return <LoadingScreen />;
  if (route === 'loadFailed') return <LoadFailedScreen />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={route === 'app'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="consent" options={{ presentation: 'modal' }} />
        <Stack.Screen name="avatar" options={{ presentation: 'modal' }} />
        <Stack.Screen name="shop" options={{ presentation: 'modal' }} />
        <Stack.Screen name="propose-quest" options={{ presentation: 'modal' }} />
        <Stack.Screen name="change-password" options={{ presentation: 'modal' }} />
        <Stack.Screen name="birthday-correction" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={route === 'setup'}>
        <Stack.Screen name="setup" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={route === 'updatedTerms'}>
        <Stack.Screen name="updated-terms" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={route === 'blocked'}>
        <Stack.Screen name="age-blocked" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={route === 'recovery'}>
        <Stack.Screen name="new-password" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={route === 'signedOut'}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      {/* Links from emails open in any state; they check the token, then
          hand back to the guards above */}
      <Stack.Screen name="auth/confirm" options={{ gestureEnabled: false }} />
      <Stack.Screen name="auth/reset" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
