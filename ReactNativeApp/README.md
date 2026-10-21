# StepTracker

The plans and decisions behind the app are in `../docs/` (the
`step-tracker-*.txt` files; code comments refer to their sections). Start
with `step-tracker-recommendations.txt`.

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

## Crash reports (Sentry)

On only in real builds once `EXPO_PUBLIC_SENTRY_DSN` is set
(`src/lib/crash-reports.ts`). Reports carry no user id, IP, device name,
steps, names, emails or tokens, and no network or console trail
(`src/lib/crash-scrub.ts`, tested by `npm test`).

Once:
1. At sentry.io, a free account and a React Native project.
2. In `.env`: `EXPO_PUBLIC_SENTRY_DSN` (the project's DSN), `SENTRY_ORG` and
   `SENTRY_PROJECT` (the org and project slugs). Then `bash scripts/eas-env.sh`.
3. For readable crash reports, an auth token from Sentry (Settings > Auth
   Tokens) as an EAS **secret**, never in `.env` or the repo:
   `npx eas-cli@latest env:set --name SENTRY_AUTH_TOKEN --value <token> --visibility secret --environment preview --environment production`
4. The next build reports crashes.

## Checks

CI runs on every push (`.github/workflows/ci.yml`). The same, locally:

```bash
npx tsc --noEmit && npx expo lint && npm test   # the app
supabase start && supabase test db              # the database
for f in supabase/tests/concurrency/*.sh; do bash "$f"; done   # two sessions at once
```

## Running it locally

1. `npm install` (Node version in `.nvmrc`).
2. `cp .env.example .env` and fill it in. For the local database, use the
   URL and publishable key that `supabase status` prints.
3. `supabase start` runs the database in Docker with every migration in
   `supabase/migrations` applied.
4. A development build on the phone or simulator (`npx expo run:ios`, or
   the `development` profile above), then `npx expo start`. Expo Go
   can't run this app (it uses native modules Expo Go doesn't include,
   such as HealthKit and Health Connect). Add `--tunnel` when the phone isn't on the same
   network.
5. After changing the sign-in or push settings in `.env`, run
   `npx expo prebuild --clean` (see `app.config.ts`).

Screens live in `src/app` (Expo Router: every file there is a route);
everything else is outside it (see `AGENTS.md`).

## Other scripts

| Script | What it does |
|---|---|
| `npm test` | Unit tests with Node's own test runner (`src/**/*.test.ts`, `supabase/functions/**/*.test.ts`) |
| `npm run gen:name-tests` | Regenerates the database's name tests from `src/auth/name-rules.ts` and `name-cases.ts` |
| `scripts/generate-avatar-sprites.py` | Draws the pixel art in `assets/` (characters, items, badges, maps, the Mimic) |
| `scripts/generate-map-lighting.py` | The maps' day, sunset and night art; writes `src/track/lighting.generated.ts` |
| `scripts/generate-roll-sounds.py` | The daily roll's placeholder sounds (`assets/sounds/`; see its `README.md` before swapping one) |
| `scripts/subset-fonts.sh` | Shrinks the Maplestory fonts (drops the Korean characters) |
| `scripts/eas-env.sh` | Copies the public `.env` settings into EAS |
| `supabase/dev/fake_friends.sql`, `fake_quest.sql` | Fake players and a test quest, run by hand in the SQL Editor (each has a `_remove` script) |
| `supabase/admin/*.sql` | The admin's name audit and daily report review (`RELEASE-GATE.md`) |
