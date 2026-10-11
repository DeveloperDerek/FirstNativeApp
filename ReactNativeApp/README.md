# StepTracker

## Making a build (EAS)

Builds are made in the cloud by EAS, Expo's build service
(`step-tracker-builds.txt`, Part A). Three kinds, set in `eas.json`:

| Profile | For | Install |
|---|---|---|
| `development` | you, while working on the app (replaces `npx expo run:ios`) | a link or QR code; then `npx expo start` |
| `preview` | testers, outside the stores | Android: an APK link. iOS: needs the paid Apple Developer account |
| `production` | TestFlight and Google Play | through the stores |

The app version (`version` in `app.json`) is yours to change for each
release. Build numbers are kept by EAS and go up by one on every
production build.

### Once, to set up

1. A free Expo account at expo.dev, then `npx eas-cli@latest login`.
2. `npx eas-cli@latest init` creates the EAS project and saves its ID in
   `app.json` (`extra.eas.projectId`; not a secret). Push notifications
   use the same ID. Done: @derekqho/ReactNativeApp.
3. `bash scripts/eas-env.sh` copies the app's settings from `.env` into
   EAS (`.env` itself is never uploaded). Only the public `EXPO_PUBLIC_*`
   values and `APPLE_TEAM_ID` are sent; never `SUPABASE_DB_PASSWORD` or any
   other secret. Run it again whenever `.env` changes.

### Each build

```bash
npx eas-cli@latest build --profile preview --platform android      # an APK for an Android phone
npx eas-cli@latest build --profile development --platform ios      # for your own iPhone
npx eas-cli@latest build --profile production --platform all       # for the stores
npx eas-cli@latest submit --profile production --platform android  # send the latest build to Google Play
```

The free plan includes a number of builds a month in a slower queue; see
expo.dev/pricing. Google wants the first upload of a new app done by hand
in the Play Console; after that `submit` works.

## Checks

CI runs on every push (`.github/workflows/ci.yml`). The same, locally:

```bash
npx tsc --noEmit && npx expo lint && npm test   # the app
supabase start && supabase test db              # the database
for f in supabase/tests/concurrency/*.sh; do bash "$f"; done   # two sessions at once
```

---

# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
