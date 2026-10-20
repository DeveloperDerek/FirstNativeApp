# Release gate: register page

Stage 11 of `step-tracker-register.txt`. The new sign-up flow is built
(stages 0–9b); this is what stands between it and real users. Nothing
here is a coding task, and none of it is decided by the coding agent:
each item is done or approved by the owner, and the legal review by a
qualified person.

Status as of 2026-10-20: **not ready for release** (gates 1 to 3 are
still open). Every migration up to
`20261127000000_activity_friends_roll_coins.sql` and the app features
they serve (through the daily roll, kudos and the activity board) are
built; deploy steps 15 and 16 below cover the newest ones.

---

## Gate 1: legal and store review (decision 9D) — OPEN

A qualified person reviews the points below and their answers are recorded
here. The 13+ age check does not settle any of them on its own.
This is a checklist for that person, not legal advice.

- [ ] **COPPA.** Could StepTracker's audience, marketing (schools, youth
  sports, families) or look and feel make it count as aimed at children
  under 13? If so, a birthday question isn't enough. Keep marketing to
  adults and teens 13+.
- [ ] **California (Southern California launch).** CCPA/CPRA: StepTracker
  should not sell or share data at all (opt-in would be needed for under
  16s). The California Age-Appropriate Design Code Act: check its current
  legal status.
- [ ] **Health data laws** in other states the app reaches (e.g.
  Washington's My Health My Data Act): step counts can count as consumer
  health data.
- [ ] **App store age laws and the stores' age signals** (Apple's and
  Google's age range APIs): do any apply, and must the app use them?
- [ ] **App Store and Google Play** rules for health and fitness apps, the
  content rating questionnaire, and Google Play's Families policy (don't
  opt in unless families are the intended audience).
- [ ] **Teens 13–17:** do they need stricter defaults, e.g. not appearing
  in search to strangers? (Today anyone signed in can search usernames.)
- [ ] **Minimum age** stays 13? It is a server setting
  (`public.app_settings`, key `minimum_age`), changed without a new build.

Reviewed by: ______  Date: ______  Answers / conditions:

---

## Gate 2: domain and links (stage 3b, section 8f) — BLOCKED on the owner

Nothing here is bought, started or created without the owner's OK.
Credentials go into the dashboards only, never into the app or the repo.
`[$]` = may cost money.

- [ ] 1. [$] Domain: chosen and bought by the owner.
- [ ] 2. DNS for the domain (or a subdomain) pointing at the host.
- [ ] 3. [$] Static hosting with HTTPS.
- [ ] 4. iOS Universal Links: `/.well-known/apple-app-site-association`
  (Team ID + `com.derekho.steptracker`, paths `/auth/*`) and
  `ios.associatedDomains` in `app.json`. New build needed.
- [ ] 5. Android App Links: `/.well-known/assetlinks.json` with the
  SHA-256 of **both** the EAS upload key and the Play App Signing key, and
  `android.intentFilters` with `autoVerify` in `app.json`. New build needed.
- [ ] 6. Supabase (hosted) Site URL = `https://<domain>`, redirect URLs
  `https://<domain>/auth/*` and the app's scheme; remove
  `http://127.0.0.1:3000`.
- [ ] 7. Email templates in the dashboard: "Confirm signup" →
  `https://<domain>/auth/confirm?token_hash={{ .TokenHash }}&type=email`,
  "Reset password" →
  `https://<domain>/auth/reset?token_hash={{ .TokenHash }}&type=recovery`
  (the local versions are in `supabase/templates/`).
- [ ] 8. [$] Email sender (custom SMTP, e.g. Resend or Postmark) with SPF,
  DKIM and DMARC. Without it, emails stop after a few an hour.
- [ ] 9. Web pages on the domain: `/auth/confirm` (built: `site/`),
  `/auth/reset` (not built yet: set a new password in the browser),
  `/privacy`, `/terms`, a home page. Replace the
  `https://yourdomain.com/privacy` fallback in `src/lib/supabase.ts`.
- [ ] 10. Apple's and Google's link checkers pass; links open the app
  from Mail and Gmail on a real iPhone and Android phone; the EMAIL LINKS
  tests in `DEVICE-TESTS.md` pass with the https links.
- [ ] Rename the custom scheme from `reactnativeapp` to something less
  generic (e.g. `steptracker`) before release (8b). New build needed; update
  `supabase/templates/` and the redirect URLs.

---

## Gate 3: existing accounts and the Terms (decision 9F) — OPEN

Accounts made before this change never ticked a box. While no Terms
versions are published (today), nobody has to accept anything. Publishing
the first versions decides it, through one column:

- **Recommended:** `requires_reacceptance = true`. Existing users see
  "Updated Terms" once on their next open and accept (recorded as
  `reacceptance`). Changes their experience, so it needs the owner's OK.
- **Alternative:** `requires_reacceptance = false`. Existing users are
  treated as having accepted, and no record is kept for them.

Needs the real `/terms` and `/privacy` pages first (gate 2, task 9). Then,
in SQL (versions are permanent once published):

```sql
insert into public.legal_documents (document, version, url, requires_reacceptance) values
  ('terms',   '2026-11-01', 'https://<domain>/terms/2026-11-01',   true),
  ('privacy', '2026-11-01', 'https://<domain>/privacy/2026-11-01', true);
```

Decision: ______  By: ______  Date: ______

Later material changes: always a new version with
`requires_reacceptance = true`, decided by the owner (with legal advice).

---

## Other open items from building it

| Item | Needs | From |
|---|---|---|
| Opening the app offline shows "Can't reach StepTracker" instead of opening normally: sections 7 and 8a disagree | Owner decision | Stages 2, 4 |
| Support contact on the sign-in screen for people who lost access to their email | A support address | Stage 6 |
| Same email across email / Apple / Google: the four checks | Device results (`DEVICE-TESTS.md` §7) | Stage 7 |
| Google nonce error on iOS, if it happens | Review before changing (see `src/auth/signIn.ts`) | Stage 7 |
| Accounts from before birthdays were asked have none; ask in a Profile banner? | Owner decision, only if needed | Stage 9 |
| Email-verified birthday corrections for people who can't use the app (send the link) | Gate 2 (domain, email) | Stage 1 |
| The `/auth/reset` web page | Gate 2 | 8f task 9 |
| Error messages read aloud on iOS on every sign-up screen (done for the username check only) | A small change, if wanted | Stage 8 |
| The web build doesn't start with `"output": "static"` (session storage runs during pre-rendering) | A fix, if the web build matters | Stage 2 |
| Every test in `DEVICE-TESTS.md`, on an iPhone and an Android phone | The owner, with the phones | Stage 10 |
| The daily roll's sounds are generated placeholders | Final sounds, with their licences recorded (`assets/sounds/README.md`) | Daily roll |
| Paid spins (ROLL-18 to ROLL-24) | Not built; owner decisions and a lawyer's check first (`step-tracker-daily-roll.txt`, section 12) | Daily roll |

---

## Hosted Supabase settings (dashboard)

The local `supabase/config.toml` already has these; the hosted project
needs them set by hand.

- [ ] Auth > Email: **Confirm email** on.
- [ ] Auth > Email: **Secure password change** on.
- [ ] Auth > Passwords: minimum length **8**.
- [ ] Auth > Passwords: **leaked password protection** on ([$] may need a
  paid plan; owner's call).
- [ ] Optional: **require the current password** when changing it (the
  app already checks it).
- [ ] Auth > Sessions: refresh token rotation and reuse detection on; JWT
  expiry 1 hour (or shorter).
- [ ] Auth > Rate limits: email resend wait 60 seconds.
- [ ] Identity linking: set according to the results of
  `DEVICE-TESTS.md` §7.

---

## Deploy, in this order

1. Review and commit. (Done: everything is committed, including the
   shop migrations `20261021000000_shop_top_up.sql` and
   `20261022000000_shop_refresh.sql`, which go before the register
   migration because it is built on them.)
2. Push the migrations (`supabase db push`):
   `20261023000000_register.sql` and `20261024000000_blocked_cleanup.sql`.
   Existing accounts are marked onboarded; nobody is locked out.
3. Check the grants on the hosted database, not just that the app works
   (section 6b):

   ```sql
   select has_table_privilege('authenticated', 'public.profiles', 'UPDATE');      -- false
   select distinct column_name from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'profiles'
     and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 1;     -- avatar, display_name, map_theme, sharing_consent_at
   select jobname, schedule from cron.job;                                       -- delete-blocked-accounts, 0 * * * *
   ```
4. Then, without delay, a **new native build** of the app (EAS): it needs
   `expo-secure-store` and calls `account_status()`, so an over-the-air
   update is not enough, and the old app can't rename usernames against
   the new database. The new app must not reach users before step 2.
5. Publish the Terms versions (gate 3) once the pages exist.
6. Name limits (`step-tracker-safety.txt`, Part C): push
   `20261103000000_name_limits.sql`, then run
   `supabase/admin/name_audit.sql` in the SQL Editor and decide each name
   it lists (nothing is renamed automatically; names nobody fixes keep
   working). Run the audit again after any change to the word list. An
   app build from before this shows a refused name's code
   (`NAME_NOT_ALLOWED`) instead of words, so ship the new build soon
   after.
7. Blocking (`step-tracker-safety.txt`, Part A): push
   `20261104000000_blocking.sql`. Older app builds keep working: their
   date-based leaderboard calls are mapped onto the new periods. In them,
   a group mate's card no longer shows "last seen" (group mates who
   aren't friends can't read it from the table any more), and there is
   no Block button, so ship the new build soon after. Once no older
   build is in use, drop `group_leaderboard(uuid, date, date)` and
   `friends_leaderboard(date, date)`.
8. Reports (`step-tracker-safety.txt`, Parts B and D): push
   `20261105000000_reports.sql`. Reports start turned OFF
   (`app_settings.reports_enabled` = 0); nothing changes for users until
   it's on. Before turning it on: the support email is live
   (`EXPO_PUBLIC_SUPPORT_EMAIL`, shown on the paused screen, and in the
   store listings), the published Terms include the content rules (gate
   3), your account is in `public.admins` with push on, and one test
   report has gone end to end (`DEVICE-TESTS.md` §14). Then use
   `supabase/admin/reports.sql` daily. Check the two new scheduled jobs:
   `select jobname, schedule from cron.job;` (remind-old-reports
   `15 * * * *`, delete-old-reports `30 3 * * *`).
9. Group owners (`step-tracker-group-owners.txt`, Part A): push
   `20261106000000_group_owners.sql`. From then on a group passes to its
   longest-standing member when the owner leaves or deletes their
   account, for older app builds too. The migration also fixes any group
   whose owner had already left it. Older builds have no "Leave group"
   for owners and still say "any groups you own" will be deleted, so
   ship the new build soon after.
10. Sign in with Apple on deletion (`step-tracker-group-owners.txt`,
   Part B): push `20261107000000_apple_revocation_log.sql` and deploy the
   function (`supabase functions deploy delete-account`). Until the Apple
   secrets are set, an Apple account is still deleted and a row in
   `public.apple_revocation_failures` says Apple wasn't revoked. Needed
   before Sign in with Apple is turned on: in the Apple Developer account,
   a Sign in with Apple key (.p8); then, in Supabase > Edge Functions >
   Secrets, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the .p8
   file's contents) and `APPLE_CLIENT_ID` (`com.derekho.steptracker`).
   Then the Part B checks in `DEVICE-TESTS.md` §15.
11. Daily goal and streaks (`step-tracker-goals-streaks.txt`): push
   `20261108000000_goals_streaks.sql`. The day it runs on the hosted
   database becomes the launch day (`app_settings.streak_bonus_from`):
   streaks show from history at once, and only milestones reached from
   that day on pay a bonus. Daily coins are unchanged (10,000). Then a
   new build: older builds keep 10,000 everywhere, show no streak, and
   still say "+100 coins" at 10,000 (which stays true).
12. Achievements (`step-tracker-achievements.txt`): push
   `20261110000000_achievements.sql` BEFORE the new build reaches anyone.
   The build lists the four reward items (Winged sneakers, Ember cape,
   Laurel wreath, Mimic); the server lets anyone wear an item with no
   `shop_items` row, so without the migration they'd be free to wear
   through an old or modified app. (This build itself keeps them out of
   Customize unless owned either way.) The migration gives everyone who shares
   what they'd already earned; the first open of the new build shows it
   as one summary. Older builds show no achievements and never offer the
   items. Then the checks in `DEVICE-TESTS.md` §19, and
   `bash supabase/tests/concurrency/achievement_race.sh` locally.
13. Personal goals removed (`step-tracker-goals-streaks.txt`, GOAL-15):
   ship the new build first, then push
   `20261116000000_remove_personal_goal.sql`. The migration moves
   everyone to 10,000 from the next day and removes `set_daily_goal`, so
   an older build's Profile > Daily goal shows an error on Save (nothing
   else in it breaks). Until it runs, the new build still shows anyone's
   old goal on Today ("% of 7,500 goal"). Then the checks in
   `DEVICE-TESTS.md` §16.
14. The goal is the daily target (`step-tracker-goals-streaks.txt`,
   GOAL-16): push `20261117000000_goal_is_coin_target.sql`, then the new
   build. The migration alone already makes every build's goal the
   target (they read it from the server); older builds still show the
   coin target as a separate "coins at N", which stays true. The new
   build shows one number. Then the checks in `DEVICE-TESTS.md` §16.
15. The migrations not named above. `supabase db push` applies every
   pending migration in filename order, so these go with the steps
   around them: `20261109` to `20261115` by step 13 at the latest, and
   `20261118` to `20261127` after step 14. The new build calls the
   functions marked "the build needs it", so those must be on the hosted
   database before it reaches anyone.
   - `20261109000000_my_history.sql`: History's Month and Year views
     (`my_history`, `my_history_by_month`). The build needs it.
   - `20261111000000_quests_without_voting.sql`: quests start at once
     for everyone sharing, with no vote; quests still waiting for votes
     are cancelled. The build's Start a quest needs it.
   - `20261112000000_goal_range_coin_steps.sql`: the 7,000 to 10,000
     daily coin target; streaks stop paying coins.
   - `20261113000000_username_daily_limit.sql`: one username change a
     day.
   - `20261114000000_sync_day.sql`: the step refresh in one call
     (`sync_day`). The build needs it.
   - `20261115000000_coin_rebalance.sql`: payouts, the welcome bonus
     and the new prices (`step-tracker-coins-items.txt`).
   - `20261118000000_remove_sunflower_surfboard.sql`: refunds and
     removes the two items, which the build no longer lists.
   - `20261119000000_starter_pets.sql`: new accounts get the dog.
   - `20261120000000_item_sets.sql`: the item sets' shop rows. Push it
     BEFORE the build reaches anyone: the build lists the new items,
     and an item with no `shop_items` row is free to wear (as in
     step 12).
   - `20261121000000_activity_board.sql`: Friends > Activity
     (`friends_activity`). The build needs it. Then the checks in
     `DEVICE-TESTS.md` §21.
   - `20261122000000_kudos.sql`: kudos on the activity board
     (`step-tracker-kudos.txt`). The build needs it. Then the checks in
     `DEVICE-TESTS.md` §23.
   - `20261123000000_activity_purchases.sql`: items bought show on the
     board.
   - `20261124000000_activity_separate_lines.sql`: one board line per
     thing done (`activity_feed`). The build needs it; older builds
     keep reading `friends_activity`.
   - `20261125000000_daily_roll.sql`: the daily roll, switched off
     (step 16). The build needs it (`sync_day` returns the roll's
     state).
   - `20261126000000_remove_lasso_spatula_spyglass.sql`: refunds and
     retires the three items, which the build no longer draws (they
     showed as blank reel tiles).
   - `20261127000000_activity_friends_roll_coins.sql`: friends' goal
     lines name the coins they rolled ("won 250 coins").
16. The daily roll (`step-tracker-daily-roll.txt`): with step 15 pushed,
   the roll stays off until `app_settings.daily_roll_from` is set, and
   everyone keeps the 150 daily coins. Ship the new build first (it
   needs `expo-haptics` and `expo-audio`, so an over-the-air update is
   not enough), wait about two weeks so most players have it, then set
   the switch day. An older build on a day after it says "+150 coins"
   at the goal and pays nothing. Then the checks in `DEVICE-TESTS.md`
   §24.
