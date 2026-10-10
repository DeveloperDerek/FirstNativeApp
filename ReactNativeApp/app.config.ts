import type { ConfigContext, ExpoConfig } from 'expo/config';
import { type ConfigPlugin, withEntitlementsPlist } from 'expo/config-plugins';

// Expo applies expo-apple-authentication's plugin automatically whenever the
// package is installed, and it always adds the Sign in with Apple
// entitlement. Strip it again while Apple sign-in is turned off.
const withoutAppleSignIn: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (c) => {
    delete c.modResults['com.apple.developer.applesignin'];
    return c;
  });

// Extends app.json. Sign-in providers are only added to the native
// project when their keys are set in .env, so the app still builds
// before they are configured:
//  - Sign in with Apple needs a paid Apple Developer account; a free
//    Personal Team cannot sign an app that has the entitlement.
//  - The Google plugin refuses to run without the iOS client ID.
//  - Push notifications need a paid Apple Developer account too (the push
//    entitlement), and an EAS project for Expo push tokens
//    (EXPO_PUBLIC_EAS_PROJECT_ID, from `npx eas-cli@latest init`).
// Run `npx expo prebuild --clean` after changing these values.
export default ({ config }: ConfigContext): ExpoConfig => {
  const appleSignIn = process.env.EXPO_PUBLIC_APPLE_SIGN_IN === 'true';
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const pushNotifications = process.env.EXPO_PUBLIC_PUSH_NOTIFICATIONS === 'true';
  const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

  const plugins: ExpoConfig['plugins'] = [...(config.plugins ?? [])];
  if (appleSignIn) plugins.push('expo-apple-authentication');
  // Always listed, so the module is set up; the iOS push entitlement is
  // only added when turned on.
  plugins.push(['expo-notifications', { enableRemoteNotifications: pushNotifications }]);
  if (googleIosClientId) {
    // "1234-abc.apps.googleusercontent.com" -> "com.googleusercontent.apps.1234-abc"
    const iosUrlScheme = googleIosClientId.split('.').reverse().join('.');
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  }

  const result: ExpoConfig = {
    ...config,
    name: config.name ?? 'StepTracker',
    slug: config.slug ?? 'ReactNativeApp',
    ios: {
      ...config.ios,
      usesAppleSignIn: appleSignIn,
      // Keeps code signing set up after `prebuild --clean` regenerates ios/.
      appleTeamId: process.env.APPLE_TEAM_ID || config.ios?.appleTeamId,
    },
    plugins,
    extra: {
      ...config.extra,
      ...(easProjectId ? { eas: { ...config.extra?.eas, projectId: easProjectId } } : {}),
    },
  };
  return appleSignIn ? result : withoutAppleSignIn(result);
};
