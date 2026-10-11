# Release gate: register page

Stage 11 of `step-tracker-register.txt`. The new sign-up flow is built
(stages 0–9b); this is what stands between it and real users. Nothing
here is a coding task, and none of it is decided by the coding agent:
each item is done or approved by the owner, and the legal review by a
qualified person.

Status as of 2026-10-10: **not ready for release.**

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

1. Review and commit (nothing is committed yet). The uncommitted shop
   migrations `20261021000000_shop_top_up.sql` and
   `20261022000000_shop_refresh.sql` go first: the register migration is
   built on them.
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
