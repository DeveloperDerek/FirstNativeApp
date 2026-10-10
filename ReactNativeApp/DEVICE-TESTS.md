# Device tests: register page

Stage 10 of `step-tracker-register.txt`: every DEVICE test in section 11,
plus the checks the earlier stages couldn't do without a real phone. Run
each on a real **iPhone** and a real **Android** phone and tick both boxes.
The blueprint asks for these to be ticked off before release; this file is
where that happens (section 11 points here).

Items marked *(web)* already passed on the web build against the local
Supabase while it was built; they still need a phone.

Write anything unexpected under the test as `Notes:` (what you did, what
you expected, what happened). A failure blocks release until fixed or
accepted in writing.

---

## 0. Before you start

**Builds.** A development build on each phone (Expo Go can't run this app):

```sh
npx expo run:ios --device       # iPhone
npx expo run:android --device   # Android (generates android/ the first time)
```

**Which Supabase.** Most tests run against the local one on your Mac:

```sh
supabase start
ipconfig getifaddr en0          # your Mac's address on the Wi-Fi, e.g. 192.168.1.216
```

Then start Metro with that address instead of 127.0.0.1 (the phone can't
reach your Mac's 127.0.0.1):

```sh
EXPO_PUBLIC_SUPABASE_URL=http://<mac-ip>:54321 \
EXPO_PUBLIC_SUPABASE_KEY=<publishable key from `supabase status`> \
npx expo start
```

The phone and the Mac must be on the same Wi-Fi. The Apple and Google
tests (sections 6 and 7) need the hosted project instead, because the
providers are set up there.

**Reading the emails.** Local emails don't leave your Mac: open Mailpit on
the phone at `http://<mac-ip>:54324` and tap the link there. Links use the
app's scheme (`reactnativeapp://auth/...`) until the domain exists; the
link tests are redone with the real https links after stage 3b.

**SQL.** "Run in SQL" means the local Studio's SQL Editor
(`http://127.0.0.1:54323`) or the hosted dashboard's.

**Test accounts.** Use a fresh email for each sign-up test, e.g.
`you+t1@gmail.com`, `you+t2@gmail.com` (locally any address works; the
emails all land in Mailpit).

---

## 1. Sign-up (step 1)

- [ ] iPhone  - [ ] Android — **Create an account.** Sign in screen > New here? Create an account. A mistyped email (`me@gmail`) shows "Enter a valid email address." when you leave the field. The password shows Weak / OK / Strong as you type; `short1`, `password1` and your own email are refused with their messages; Show / Hide works. *(web)*
- [ ] iPhone  - [ ] Android — **Terms checkbox** (only when Terms versions are published). Continue stays disabled until it is ticked; both links open the exact versions. *(web)*
- [ ] iPhone  - [ ] Android — **Check your inbox.** After Continue: "Check your inbox", the email shown as `y***@...`. Resend email is then blocked with a countdown for 60 seconds. *(web)*
- [ ] iPhone  - [ ] Android — **Closing the app while waiting.** Force-quit and reopen: still "Check your inbox". "Use a different email" goes back to Create your account. *(web)*
- [ ] iPhone  - [ ] Android — **Signing in before confirming.** I've confirmed, sign in > enter the password without having confirmed: "Confirm your email first" with Resend email. *(web)*
- [ ] iPhone  - [ ] Android — **Screen reader.** With VoiceOver / TalkBack on, every field is read with its label, the strength bar is read as "Password strength: Strong" etc., and error messages are read out when they appear.

## 2. Email links

Until stage 3b these use the app's scheme; redo the first three with the
real https links once the domain exists.

- [ ] iPhone  - [ ] Android — **Confirm, app closed.** Force-quit the app, tap the confirmation link in Mailpit on the phone: the app opens, signs in, and shows "Set up your profile".
- [ ] iPhone  - [ ] Android — **Confirm, app in the background.** Same, with the app open in the background.
- [ ] iPhone  - [ ] Android — **Confirm on a laptop.** Open the link on the Mac instead (replace `reactnativeapp://` with the fallback page's address; see `site/README.md`): the page says "Email confirmed". On the phone, I've confirmed, sign in works. *(web)*
- [ ] iPhone  - [ ] Android — **Used twice.** Tap the same link again: "This link has expired" with Send a new link and Sign in. *(web)*
- [ ] iPhone  - [ ] Android — **Expired.** In `supabase/config.toml` set `otp_expiry = 60`, `supabase stop && supabase start`, sign up, wait 2 minutes, tap the link: "This link has expired"; Send a new link works (email pre-filled on the phone that signed up). Put `otp_expiry` back to 3600.
- [ ] iPhone  - [ ] Android — **Older link after a newer one.** Sign up, wait a minute, Resend email, then tap the *first* email's link: refused as expired; the second works.
- [ ] iPhone  - [ ] Android — **Signed in as someone else.** While signed in as account A, tap a confirmation link for account B: "Sign out of @a and continue?" first. *(web)*
- [ ] iPhone — **Only one app answers the link.** If more than one StepTracker build is installed (the simulator had `com.yourname.steptracker` too), iOS may ask or pick the wrong one. Delete old builds; note what happens.

## 3. Step 2 and getting into the app

- [ ] iPhone  - [ ] Android — **Birthday picker.** iPhone: tap "Choose a date", a wheel appears. Android: the calendar dialog opens; Cancel leaves it empty. "Used to check your age. Never shown to anyone." is shown.
- [ ] iPhone  - [ ] Android — **Username.** A suggestion appears; typing a taken name shows ✗, a free one ✓; capitals become lower-case, spaces underscores; in airplane mode: "Can't check right now". With VoiceOver on (iPhone), the ✓ / ✗ answer is read out. *(web)*
- [ ] iPhone  - [ ] Android — **Quit on step 2.** Fill half of step 2, force-quit, reopen: step 2 again, not the tabs.
- [ ] iPhone  - [ ] Android — **Airplane mode, then Start walking.** Answers kept, "Couldn't save. Check your connection and try again." Turn the network on, Try again: into the app.
- [ ] iPhone  - [ ] Android — **Saved, but the reply was lost.** Tap Start walking and switch on airplane mode at once (try a few times to hit it). Then network on, Try again: straight into the app, no error, and only one profile (`select count(*) from profiles p join auth.users u on u.id = p.id where u.email = '...'` is 1).
- [ ] iPhone  - [ ] Android — **Under 13.** A birthday 10 years ago: "StepTracker is for people 13 and older." with Sign out only. Reopening the app shows it again. *(web)*
- [ ] iPhone  - [ ] Android — **Server unreachable at launch.** Signed in, `supabase stop`, open the app: "Can't reach StepTracker". `supabase start`, Try again: back in.
- [ ] iPhone  - [ ] Android — **Leave sign-up.** On step 2, Sign out (and on Android the back button): "Leave sign-up?" first.

## 4. Staying signed in

- [ ] iPhone  - [ ] Android — **Force-quit and reopen:** still signed in. **Restart the phone:** still signed in.
- [ ] iPhone  - [ ] Android — **Open offline.** Signed in, airplane mode, open the app. Not signed out. *(Known: it currently shows "Can't reach StepTracker" rather than opening normally: sections 7 and 8a of the blueprint disagree; decision pending.)*
- [ ] iPhone  - [ ] Android — **Past the token's lifetime.** Leave the app in the background for over an hour (JWT expiry), reopen: still signed in, nothing to do.
- [ ] iPhone  - [ ] Android — **Session ended by the server.** Run in SQL: `delete from auth.sessions where user_id = (select id from auth.users where email = '...');` then reopen the app (within the hour, after the token expires): the sign-in screen says "You've been signed out. Sign in again."
- [ ] iPhone  - [ ] Android — **The saved session is encrypted.** iOS simulator: open `~/Library/Developer/CoreSimulator/Devices/<device>/data/Containers/Data/Application/<app>/Library/Application Support/com.derekho.steptracker/RCTAsyncLocalStorage_V1/` and check the `sb-...-auth-token` value starts with `enc1:` and contains no `access_token`. (Checked on the simulator in stage 4.) Android emulator: `adb shell run-as com.derekho.steptracker` and look at the AsyncStorage database the same way.
- [ ] iPhone  - [ ] Android — **Next person starts clean.** Sign out, sign in as someone else: nothing of the first person shows (profile, step history, the consent prompt, coins).

## 5. Passwords

- [ ] iPhone  - [ ] Android — **Forgot password, real and made-up email:** the same "If an account exists for that email, we've sent a reset link." both times, then a 60-second wait. *(web)*
- [ ] iPhone  - [ ] Android — **Reset link:** opens "Set a new password" before anything else (even for an account still on step 2). Force-quit before saving: reopening shows it again. Cancel signs out. *(web, except the force-quit)*
- [ ] iPhone  - [ ] Android — **Two phones.** Sign in on both. Reset the password on phone 1. Phone 2 is signed out within an hour (or at once when it next refreshes), and the old password no longer works anywhere. *(web)*
- [ ] iPhone  - [ ] Android — **Expired / reused reset links:** "This link has expired" with Send a new link.
- [ ] iPhone  - [ ] Android — **Force-quit straight after "Save new password".** Reopen: if the other devices weren't signed out yet, Profile says "Your other devices may still be signed in." and it clears by itself once done; phone 2 ends up signed out.
- [ ] iPhone  - [ ] Android — **Airplane mode right after saving.** The warning shows on Profile; network back on: it clears within about 30 seconds (or on reopening). *(web, with the request blocked)*
- [ ] iPhone  - [ ] Android — **Sign out other devices** (Profile): phone 2 is signed out.
- [ ] iPhone  - [ ] Android — **Change password** (Profile): a wrong current password is refused; the right one works and other devices are signed out. If you signed in more than a day ago, a code is emailed first and asked for. *(web)*
- [ ] iPhone  - [ ] Android — **Breached password** (hosted project, with "leaked password protection" turned on): sign up with a password from the breach service's test examples: "This password has appeared in a data breach. Choose a different one."

## 6. Apple and Google (hosted project)

- [ ] iPhone  - [ ] Android — **Cancel** the Apple sheet / Google picker: no message, the buttons work again.
- [ ] iPhone  - [ ] Android — **No network:** "No connection. Check your internet and try again.", never a raw error.
- [ ] iPhone  - [ ] Android — **New Apple / Google user:** step 2, display name pre-filled from the account's name, and the Terms checkbox shown when Terms are published; Start walking stays disabled until it is ticked.
- [ ] iPhone  - [ ] Android — **Returning user who has finished step 2:** straight to the tabs (or "Updated Terms" first, if a version needs accepting).
- [ ] iPhone — **Apple button hidden** where Apple sign-in isn't available.
- [ ] Android — **Google button hidden without Google Play services** (an emulator image without Play Store).
- [ ] iPhone  - [ ] Android — **One at a time:** while one sign-in is running, the others don't respond.
- [ ] iPhone — **Google nonce.** If Google sign-in fails on iOS with a nonce error: don't switch on "Skip nonce checks" without reviewing it first (see the note in `src/auth/signIn.ts`). Record the exact error here.

## 7. Same email, different sign-in methods (hosted project)

Don't assume a matching email means "the same person". For each one,
record what really happened: the account ids before and after (`select id,
email, raw_app_meta_data->'providers' from auth.users where email = '...'`),
and whether coins and friends are still there.

| # | Do this | Must not happen | What happened | Same account? | Coins and friends kept? |
|---|---------|-----------------|---------------|---------------|-------------------------|
| 1 | Email account (confirmed) first, then Google or Apple with the same email | Coins and friends split off into a new empty account | | | |
| 2 | Google or Apple first, then sign up by email with the same email | The email sign-up gets into the provider account without its password | | | |
| 3 | Email account **not confirmed**, then Google with the same email | Whoever signs in with Google takes over the unconfirmed account | | | |
| 4 | Apple with "Hide my email" | It merges with an unrelated account | | | |

If 1–3 aren't safe: turn automatic linking off and add "Link Apple/Google"
on Profile (section 8e), before writing any help text.

## 8. Under-13 cleanup (hosted project, after deploying)

- [ ] **The job is scheduled.** Dashboard > Database > Cron (or `select jobname, schedule from cron.job;`): `delete-blocked-accounts`, `0 * * * *`.
- [ ] **It deletes.** Make a test account under 13 (step 2 with a recent birthday). Within about two hours it is gone from Authentication > Users, and `select * from public.account_cleanup_log order by run_at desc;` shows `deleted`. (A failing run, kept blocked and retried, passed in the database tests.)

## 9. Profile

- [ ] iPhone  - [ ] Android — **Birthday:** shown with the age, "only you can see this". Wrong date? opens the form (the date picker as on step 2); after sending, "Correction requested. Support will be in touch." *(web)*
- [ ] iPhone  - [ ] Android — **Rename:** a new username saves; the old one can't be taken by another account for 30 days (try it from a second account: "That username is taken."). *(database tests)*
- [ ] iPhone  - [ ] Android — **Signed in with Apple / Google:** shows "Signed in with Apple/Google" instead of Change password.

---

## Sign-off

| | iPhone | Android |
|---|---|---|
| Model and OS version | | |
| App build | | |
| Supabase (local / hosted) | | |
| Tested by, date | | |
| All boxes ticked, or failures accepted below | | |

Failures accepted for release (what, why, who agreed):
