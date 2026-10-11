// Expo's default Metro config, through Sentry's helper so each bundle and
// its source map share an id: crash reports then show readable code
// (step-tracker-builds.txt, Part B).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
