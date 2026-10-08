import type { ConfigContext, ExpoConfig } from 'expo/config';

// Extends app.json. Sign-in providers are only added to the native
// project when their keys are set in .env, so the app still builds
// before they are configured:
//  - Sign in with Apple needs a paid Apple Developer account; a free
//    Personal Team cannot sign an app that has the entitlement.
//  - The Google plugin refuses to run without the iOS client ID.
// Run `npx expo prebuild --clean` after changing these values.
export default ({ config }: ConfigContext): ExpoConfig => {
  const appleSignIn = process.env.EXPO_PUBLIC_APPLE_SIGN_IN === 'true';
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  const plugins: ExpoConfig['plugins'] = [...(config.plugins ?? [])];
  if (appleSignIn) plugins.push('expo-apple-authentication');
  if (googleIosClientId) {
    // "1234-abc.apps.googleusercontent.com" -> "com.googleusercontent.apps.1234-abc"
    const iosUrlScheme = googleIosClientId.split('.').reverse().join('.');
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  }

  return {
    ...config,
    name: config.name ?? 'StepTracker',
    slug: config.slug ?? 'ReactNativeApp',
    ios: { ...config.ios, usesAppleSignIn: appleSignIn },
    plugins,
  };
};
