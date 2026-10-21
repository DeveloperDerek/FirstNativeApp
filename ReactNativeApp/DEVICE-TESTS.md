# Device tests: register page

Stage 10 of `step-tracker-register.txt`: every DEVICE test in section 11,
plus the checks the earlier stages couldn't do without a real phone.
Sections 10 onward hold the phone checks from the other blueprints in
`../docs/`, each named in its heading. Run
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

## 10. Notifications (`step-tracker-notifications.txt`)

Needs a build with `EXPO_PUBLIC_PUSH_NOTIFICATIONS=true` (see
`app.config.ts`; the EAS project id it also needs is in `app.json` since
`eas init`), and two accounts on
two phones (or one phone and the web). iPhone first; Android is a
follow-up on a real phone (section 4 of the blueprint).

- [ ] iPhone  - [ ] Android — **Tab badges:** a request sent to you while you are on Today shows a red number on Friends within a few seconds; accepting or declining clears it at once; "9+" above 9.
- [ ] iPhone  - [ ] Android — **Cancelled live:** the sender cancels; your Friends badge drops without leaving Today.
- [ ] iPhone  - [ ] Android — **Groups badge:** stays hidden when a quest is started in your group (quests have no votes since October 2026, so nothing waits for you).
- [ ] iPhone  - [ ] Android — **Permission prompt:** not asked on first launch; asked once, right after you send a friend request.
- [ ] iPhone  - [ ] Android — **Push:** with the app closed, a request sent to you shows "@name wants to be friends", with the total on the app icon. Tapping it opens Friends.
- [ ] iPhone  - [ ] Android — **Icon number:** after a request is cancelled while the app is closed, the icon keeps the old number until you open the app, then shows the real total.
- [ ] iPhone  - [ ] Android — **Profile switch:** turning Notifications off stops pushes (the tab badges stay). Turning it on after denying the prompt offers Open Settings.
- [ ] iPhone  - [ ] Android — **Sign-out:** after signing out, requests to that account no longer reach this phone. Signing in to another account on it brings only the new account's pushes.
- [ ] iPhone  - [ ] Android — **Sign out other devices:** the other phone stops getting this account's pushes.
- [ ] iPhone  - [ ] Android — **Dead address:** delete the app, send a request to that account, and within about half an hour (Expo's receipt + the 10-minute cleanup job) its row is gone from `push_devices`.

---

## 11. Step refresh (`step-tracker-step-refresh.txt`)

- [ ] iPhone  - [ ] Android — **One refresh on launch:** opening the app reads Health and uploads once (one `sync_day` call in the Supabase logs, plus `upload_quest_steps` only while a quest is taking steps), not twice.
- [ ] iPhone  - [ ] Android — **Quiet time:** leave the app and come back within a minute: no refresh. Come back after a minute: one refresh.
- [ ] iPhone  - [ ] Android — **No timer:** leave Today open without touching it for a few minutes: no refresh. Pull to refresh still refreshes.
- [ ] iPhone  - [ ] Android — **Pull twice:** pull to refresh twice quickly: one refresh, and the spinner stops once.
- [ ] iPhone  - [ ] Android — **Two accounts, one phone:** sign in as A, open History, sign out, sign in as B: History shows only B's days (or "--" until they load), never A's.
- [ ] iPhone  - [ ] Android — **Sharing turned on mid-refresh:** turn on step sharing while a refresh runs: the steps still upload without pulling again.
- [ ] iPhone  - [ ] Android — **Account switch mid-upload:** slow the network (iPhone: Settings > Developer > Network Link Conditioner, "Very Bad Network"), sign in as A, pull to refresh, then at once sign out and sign in as B. In the Supabase logs every `sync_day` / `upload_quest_steps` from the first refresh is A's, and B's first upload comes after it, as B. On the phone: no "Goal reached!" for A's coins, only B's balance and History; signing back in as A shows A's coins if that day reached the goal.

## 12. Name limits (`step-tracker-safety.txt`, Part C)

- [ ] iPhone  - [ ] Android — **Profile, bad word:** change your display name to "Sh1t" and save: "That name isn't allowed. Try another." The old name stays.
- [ ] iPhone  - [ ] Android — **Profile, hidden character:** paste a name with a line break or a zero-width space: "Remove line breaks and hidden characters…", nothing saved.
- [ ] iPhone  - [ ] Android — **Emoji count as one:** a display name of 25 letters plus the family emoji 👨‍👩‍👧 saves (it counts 30). The field lets you type it.
- [ ] iPhone  - [ ] Android — **Sign-up:** a display name of only spaces keeps "Create" disabled and says why once something is typed.
- [ ] iPhone  - [ ] Android — **Groups:** create a group named 16 characters: "Use 1 to 15 characters." Rename one to "N4zi": refused. "Walkers 🚶" works.
- [ ] iPhone  - [ ] Android — **Real names:** "Yamashita", "José María" and "Scunthorpe Striders" all save.

## 13. Blocking (`step-tracker-safety.txt`, Part A)

Two phones (A and B), friends, both in one group G.

- [ ] iPhone  - [ ] Android — **Block from the card:** on A, Friends > tap B in the ranking > ••• > Block > Block. The card closes; B is gone from Friends and A's ranking at once.
- [ ] iPhone  - [ ] Android — **On B's phone:** A is gone from search, Friends and the friends ranking. Nothing says why.
- [ ] iPhone  - [ ] Android — **Shared group:** both still in G's ranking (group screen and Today in group mode) and its quest. A's card for B (opened from G) says "You've blocked this person…"; B's card for A says nothing different.
- [ ] iPhone  - [ ] Android — **Requests:** B can't add A (search doesn't find A). From a request row on Friends, ••• > Block removes the request.
- [ ] iPhone  - [ ] Android — **Repeat requests (decision 6):** C declines D's request; D sends again at once and it arrives. C blocks D: D can't find C any more.
- [ ] iPhone  - [ ] Android — **Blocked people:** Profile > Blocked people lists B; Unblock asks first, then B can be found again but isn't a friend.
- [ ] iPhone  - [ ] Android — **VoiceOver / TalkBack:** the ••• button reads as "More options".

Also run `bash supabase/tests/concurrency/block_request_race.sh` against the local database (a request and a block at the same moment).

## 14. Reports and the admin side (`step-tracker-safety.txt`, Parts B and D)

Do these with `reports_enabled` on in a test project, and your account in `public.admins` with push turned on. Turn it back off unless you're ready to review every day (`supabase/admin/reports.sql`, step 5).

- [ ] iPhone  - [ ] Android — **Hidden while off:** with `reports_enabled` = 0, no Report anywhere (player card •••, Friends •••, Blocked people, group screen).
- [ ] iPhone  - [ ] Android — **Turned on:** set it to 1, switch away from the app and back: Report appears without reopening the app.
- [ ] iPhone  - [ ] Android — **Report a person:** player card ••• > Report closes the card and opens the sheet; pick a reason, add a note, Send: "Thanks. We review every report." They are NOT blocked.
- [ ] iPhone  - [ ] Android — **Also block:** report someone with "Also block this person" on: they're blocked too.
- [ ] iPhone  - [ ] Android — **After blocking:** Profile > Blocked people > Report works without unblocking.
- [ ] iPhone  - [ ] Android — **Group name:** as a member (not the owner), "Report group name" offers only "Offensive name" and "Something else".
- [ ] iPhone  - [ ] Android — **Admin push:** each new report pushes "New report" to the admin's phone, with no names in it.
- [ ] iPhone  - [ ] Android — **Paused:** `admin_hide` a test account; on its phone, switching away and back shows "Your account is paused…" with the support email and Sign out. Others can't find it. `admin_unhide` brings it back.
- [ ] iPhone  - [ ] Android — **Username reset:** `admin_rename(..., 'username')`; on its phone, switching away and back shows "Pick a new username"; saving one goes back into the app.
- [ ] iPhone  - [ ] Android — **The whole loop, once:** a test report from a phone, the push, `open_reports()` shows it with its snapshot, an action closes it, `report_history()` shows both.

Also run `bash supabase/tests/concurrency/report_race.sh` against the local database (reports sent at the same moment).

## 15. Group owners (`step-tracker-group-owners.txt`, Part A)

Three phones (O owns a group; A joined before B).

- [ ] iPhone  - [ ] Android — **Owner leaves:** on O, group > Leave group says "@A will become the owner." After leaving, A's phone gets "You're now the owner of …" and A sees Manage (Rename, Delete group).
- [ ] iPhone  - [ ] Android — **Alone:** an owner alone in a group: Leave group says the group will be deleted, and it is.
- [ ] iPhone  - [ ] Android — **Make owner:** as owner, tap B in the group ranking > ••• > Make owner > Make owner. B owns the group; the old owner is still in it.
- [ ] iPhone  - [ ] Android — **Owner deletes their account:** Delete account's message says groups pass on; afterwards the group carries on for A and B with A as owner.

Also run `bash supabase/tests/concurrency/group_owner_race.sh` against the local database (the owner and the next member leaving at the same moment).

**Sign in with Apple on deletion (Part B), once Sign in with Apple is on and the Apple secrets are set:**

- [ ] iPhone — **Confirm with Apple:** an account made with Apple: Delete account > Continue with Apple shows the Apple sheet; after confirming, the account is gone, and Settings > [your name] > Sign in with Apple no longer lists StepTracker.
- [ ] iPhone — **Cancel:** cancelling the Apple sheet deletes nothing.
- [ ] iPhone — **No log row:** `select * from public.apple_revocation_failures;` has nothing for that account (a row means Apple wasn't revoked, with the reason).

## 16. Daily goal, streaks, usernames and quests (`step-tracker-goals-streaks.txt`, `step-tracker-decisions.txt`)

- [ ] iPhone  - [ ] Android — **No goal to pick (GOAL-15):** Profile has no Daily goal section.
- [ ] iPhone  - [ ] Android — **The goal is the coin target (GOAL-16):** Today shows "% of N goal · Daily roll at goal" with N from 6,000 to 10,000 in 500s (GOAL-17; 7,000 to 10,000 before its switch day) (never "150 coins at goal"); walking past N offers the daily roll (section 24), or says "Goal reached!" while the roll is off. The next day's N can differ; reopening the app the same day never changes it.
- [ ] iPhone  - [ ] Android — **The track:** the road's 10,000 tick reads "10k" with the flag, and there's no MINE marker.
- [ ] iPhone  - [ ] Android — **Streak:** walk past your goal (N): Today's line goes up at once ("6-day streak · best 6"). Before reaching it: "5-day streak. 2,140 steps to keep it going."
- [ ] iPhone  - [ ] Android — **7th day:** the streak shows 7, and no streak coins are paid (only the day's coin target pays).
- [ ] iPhone  - [ ] Android — **Friends:** a friend's player card shows your streak; someone who isn't a friend (outside a group) doesn't.
- [ ] iPhone  - [ ] Android — **Not sharing:** Today says "Share your steps to keep a streak".
- [ ] iPhone  - [ ] Android — **Username once a day:** change your username in Profile: saved. Change it again straight away: "You can change your username once a day. Try again tomorrow."
- [ ] iPhone  - [ ] Android — **Start a quest (no vote):** a member who isn't the owner taps Start a quest > Sprint > Right now: the card shows it under way at once on every member's phone, with no Accept / Decline. The goal shown matches the party size (8,000 for 2, 9,600 for 4). A member not sharing steps isn't in the party.
- [ ] iPhone  - [ ] Android — **Quest for later:** start one an hour ahead: it shows "The Sprint starts at …"; another member joining the group meanwhile isn't in it.

## 17. Longer History (`step-tracker-history-reminders.txt`, Part A)

Needs the `my_history` migration on the Supabase project the build uses.

- [ ] iPhone  - [ ] Android — **Views:** History shows Week, Month and Year; ‹ goes back a week / month / year and › comes forward; ‹ stops after a period with no data.
- [ ] iPhone  - [ ] Android — **Agrees with Today:** walk, then open History before the next upload: today's row (Week) and this month's bar (Year) match Today; the streak at the top matches Today's.
- [ ] iPhone  - [ ] Android — **Goals:** change the goal near the end of a month; in the next month, days before and after the change are judged by their own goals, in Month and Year.
- [ ] iPhone  - [ ] Android — **Not synced:** a sharer who didn't open the app for over a week sees "N days not synced"; "What's this?" explains it.
- [ ] iPhone  - [ ] Android — **New phone:** sign in on another phone (sharer, then non-sharer): the same days at goal as on the first phone.
- [ ] iPhone  - [ ] Android — **Not sharing:** History shows a month and a year from Health, no streak ("Share your steps to keep a streak"), and days before your first steps as "without step data", not 0.
- [ ] iPhone  - [ ] Android — **Health access:** turn Steps access off: iPhone shows the "Seeing 0?" hint, not a history of zero days; Android shows that access is off with Open settings. Turn it back on and pull to refresh: the real steps return.
- [ ] Android — **Year speed (decision 5):** not sharing, with a large dataset (a year of phone plus watch), open Year in a development build and note the Metro log lines `[history] Health …: N ms` and `[history] working out the year: N ms`, first open and after going back and forth. Only if it still feels slow (about 2 seconds as a guide) does the 90-day limit go in. Result: ______
- [ ] iPhone  - [ ] Android — **Midnight:** leave History open across midnight, switch away and back: the new day is Today.

## 18. Goal reminders (`step-tracker-history-reminders.txt`, Part B)

Local notifications: these work without push being set up. To see what's scheduled, temporarily log `Notifications.getAllScheduledNotificationsAsync()` ids in a development build.

- [ ] iPhone  - [ ] Android — **Turning on:** a fresh install never asks for notifications on launch. Profile > Reminders > Goal reminder asks once; the time shows 7:00 PM.
- [ ] iPhone  - [ ] Android — **Refused:** say no to the prompt: the switch stays off, "Notifications are off for StepTracker" with Open Settings.
- [ ] iPhone  - [ ] Android — **It comes:** set the time a few minutes ahead, goal not reached: the reminder comes, also with the app open (a banner). With a streak of 2+ (sharing) it says "Keep your N-day streak going…". Tapping it opens Today.
- [ ] iPhone  - [ ] Android — **Not after the goal:** reach the goal, open the app, wait past the time: no reminder today.
- [ ] iPhone  - [ ] Android — **Off, and signing out:** turn it off: none comes. Turn it on, sign out: none comes, and signing in as someone else shows reminders off.
- [ ] iPhone  - [ ] Android — **Permission taken away:** turn notifications off for the app in Settings: Profile says so and none come; turn them back on and open the app: reminders return without turning the switch on again.
- [ ] iPhone  - [ ] Android — **Time zone:** change the phone's time zone and open the app: the reminder comes at the picked time in the new zone.
- [ ] iPhone  - [ ] Android — **Timing:** open the app a minute before the reminder time without reaching the goal: it still comes. Open it just before and just after midnight: the next day's reminder is there.
- [ ] iPhone  - [ ] Android — **Ids (scheduled list):** change the time: exactly one `goal-reminder:` per date, at the new time. Open the app five times quickly: still at most one per date. Turn reminders off: none left. Schedule a test notification with another id first: it's still there after each of these. Schedule the same id twice directly and note whether this phone replaces it (cancelling first covers it either way): ______

## 19. Achievements (`step-tracker-achievements.txt`)

Needs the `achievements` migration on the Supabase project the build uses (RELEASE-GATE step 12).

- [ ] iPhone  - [ ] Android — **First open:** an account that already had 10,000-step days and a streak before the migration: one "Achievements unlocked · You've earned N achievements" message, not one per achievement. Profile > Achievements shows them with their real dates, not today's.
- [ ] iPhone  - [ ] Android — **Earning one:** walk past 10,000 (or use a test account): "Achievement unlocked · First 10K." comes once; the badge shows on Profile straight away. Reopen the app: it doesn't come again.
- [ ] iPhone  - [ ] Android — **Closed while showing:** with the message on screen, close the app before tapping it: it comes again on the next open.
- [ ] iPhone  - [ ] Android — **Two phones:** one account on two phones; tap the message on one: the other doesn't show it after its next refresh.
- [ ] iPhone  - [ ] Android — **Quest won while closed:** the message on the next open ("The Mimic can now walk beside you."), and the Mimic walking beside the character once chosen in Customize.
- [ ] iPhone  - [ ] Android — **Reward items:** before earning, none of the four is in Customize (Profile > Achievements names the item each one unlocks). After earning, it appears in its row, is wearable, and looks right on the character and the player card.
- [ ] iPhone  - [ ] Android — **The list:** Profile > Achievements > See all: earned ones first, newest first, with dates; then the rest closest first, with progress ("640,000 of 1,000,000 steps", "Best streak 12 of 30").
- [ ] iPhone  - [ ] Android — **Not sharing:** the list says "Share your steps to earn these", every achievement locked, no progress.
- [ ] iPhone  - [ ] Android — **Small phone:** the three badges on Profile fit on one line; long progress lines wrap rather than cut off.
- [ ] iPhone  - [ ] Android — **Player card, friend:** open a friend's card (Friends or the map) who has earned some: their three most recent badges and "N achievements ›" on one row, in their map's colors. Tap it: their list, newest first, names and dates only (no progress); Back returns to the card. A friend with none: no row.
- [ ] iPhone  - [ ] Android — **Player card, group:** open a group mate who isn't a friend from the group screen: the same row and list. Open someone who is neither from anywhere else: no row.
- [ ] iPhone  - [ ] Android — **Your own card:** the same row, and the list matches Profile > Achievements' earned ones.
- [ ] iPhone  - [ ] Android — **Small phone (card):** the badge row fits on one line on the card; a list of all 11 scrolls inside the card with Back and Close still on screen.

## 20. Today minimap (`step-tracker-minimap.txt`)

- [ ] iPhone  - [ ] Android — **Alone, 0 steps** (no friends, or sharing off): only your head, at the left end; nothing walked on the dashed line.
- [ ] iPhone  - [ ] Android — **Long road:** in a group where someone has 23,000, the minimap ends at 25,000 and the 10,000 flag sits further left on it.
- [ ] iPhone  - [ ] Android — **Crowded:** several people within 300 steps of each other: their heads stack upward (up to three rows); yours stays on the line, ringed, in front.
- [ ] iPhone  - [ ] Android — **Moving the road:** scroll the road: the darker window on the minimap slides with it, smoothly. Tap the far end: the road scrolls there. Drag along it: the road follows your finger. Tap a head: the road centers on them. After any of these the road stops following your count.
- [ ] iPhone  - [ ] Android — **Scrolls away:** scroll Today's list down: the minimap goes up with it, gone by two thirds of the way; back at the top it returns.
- [ ] iPhone  - [ ] Android — **Your goal:** the road's distance markers show a star with "8.5k goal" (your day's goal); the minimap shows only the 10,000 flag.
- [ ] iPhone  - [ ] Android — **Screen reader:** VoiceOver / TalkBack reads one summary ("Today's road. You're at 6,200 steps, 3,800 to the 10,000 flag, 2nd of 5"); swiping up and down moves the road from milestone to milestone.
- [ ] iPhone  - [ ] Android — **Maps and sizes:** on a few maps at day and night the minimap's colors sit in the scenery and the flag's tag is readable; on a small phone (iPhone SE) heads stay inside the ends.

## 21. Activity board (`step-tracker-activity-board.txt`)

Needs the `activity_board` migration on the Supabase project the build uses (RELEASE-GATE, deploy step 15).

- [ ] iPhone  - [ ] Android — **A line:** reach the goal: a friend's phone shows the line after pulling to refresh. Unlock an achievement the same day: it gets its own line. With the daily roll on, the goal line changes to "won …" once you roll (section 24).
- [ ] iPhone  - [ ] Android — **Opening a card:** tap a line: the player card opens with today's steps.
- [ ] iPhone  - [ ] Android — **Unfriend and block:** unfriend: their lines go on the next load. Block from the card: they go at once.
- [ ] iPhone  - [ ] Android — **Offline:** airplane mode, then pull: the list stays, with "Couldn't refresh. Pull to try again." above it.
- [ ] iPhone  - [ ] Android — **New activity:** with older pages loaded, leave the app for more than 30 seconds and come back after a friend's new line: a "New activity" button at the top swaps in the fresh page instead of jumping.
- [ ] iPhone  - [ ] Android — **Accessibility:** with large text, lines grow and stay tappable; VoiceOver / TalkBack reads each line as one sentence.

## 22. Code cleanup (October 2026)

Nothing here should look or behave differently from before the cleanup.
The build needs a fresh `pod install` / prebuild: three unused native
packages were removed.

- [ ] iPhone  - [ ] Android — **Character layers:** in Customize, a character with a top and bottom, then a one-piece outfit, then a cape and a held item: each draws the same as before, with nothing missing or in front of the wrong layer. Putting the outfit on and off doesn't flash an empty layer.
- [ ] iPhone  - [ ] Android — **Pet spot:** with a pet, change to a wide outfit or cape: the pet still stands just clear of the character in the walking scene.
- [ ] iPhone  - [ ] Android — **Walking scene:** tiles, road and landmarks line up as on the map; the character's feet are on the road.
- [ ] iPhone  - [ ] Android — **Maps on sign-in:** sign in to an account that owns a map: it's usable in Profile straight away, without reopening the app.
- [ ] iPhone  - [ ] Android — **Friends:** switch Today / Last 7 days / Activity: the ranking changes. Accept, decline and remove a friend: the lists and the tab badge update straight away. Pull to refresh updates everything.
- [ ] iPhone  - [ ] Android — **Today:** opens on Friends (no "Just me" choice); switch between Friends and a group: the right people show. Join or leave a group elsewhere, then reopen Today or pull to refresh: the group list is current.
- [ ] iPhone  - [ ] Android — **Today, rearranging the Friends / group buttons:** hold Friends or a group button, then drag it sideways: the others slide out of its way and it stays where it's dropped, without switching to it. A long group name moves the same way. With more buttons than fit, hold one near the edge: the row scrolls. Quit and reopen: the order is kept; a newly joined group shows at the end. A quick tap still switches.
- [ ] iPhone  - [ ] Android — **Shop:** the balance and the refresh countdown are right on opening, after a purchase, and after a shop refresh.
- [ ] iPhone  - [ ] Android — **Dates and times:** History, Activity day labels ("Yesterday", "Mon Oct 13"), achievement dates, the birthday on sign-up and quest times ("It begins at 3:00 PM") show as before, also just after midnight.

---

## 23. Kudos (`step-tracker-kudos.txt`)

Needs the `kudos` migration on the Supabase project the build uses. Two accounts that are friends (A and B), each on its own phone or simulator.

- [ ] iPhone  - [ ] Android — **Give:** as B, open Friends > Activity and tap the party popper on A's goal line: it turns gold with a burst of confetti and the count goes up by one. Tapping again does nothing. Pull to refresh: the count stays.
- [ ] iPhone  - [ ] Android — **Find out, no push:** on A, bring the app to the foreground: a dot (no number) on the Friends tab and on the Activity button, "1 new kudos" at the top of Activity and a dot by the count on that line. No push, no sound, no change to the app icon number.
- [ ] iPhone  - [ ] Android — **Seen only from the list:** open Activity: the dots stay. Tap "1 new kudos": the list shows B for that day. Close it: the dots go (tab, button and line).
- [ ] iPhone  - [ ] Android — **An older line:** as B, give kudos on a line of A's from more than a week ago (under "Show older"). On A it is in the "New kudos" list and stays new until that list is seen.
- [ ] iPhone  - [ ] Android — **Who gave them:** on A, tap the count on your own line: B is listed; tapping B opens B's card. This doesn't clear any dots.
- [ ] iPhone  - [ ] Android — **Requests first:** with a friend request waiting too, the Friends tab shows the red number, not the dot; accept it and the dot shows.
- [ ] iPhone  - [ ] Android — **Offline:** turn on airplane mode on B and tap a popper: it goes back to light and "Couldn't send kudos." shows under the line for a few seconds.
- [ ] iPhone  - [ ] Android — **Block:** on A, block B from B's card: after a refresh B's kudos no longer count, and B's lines are gone from A's board.
- [ ] iPhone  - [ ] Android — **VoiceOver / TalkBack:** the line reads as one sentence ending in its kudos; the kudos pill is its own button ("Give Sam kudos, 4 so far"); the Activity button says "new kudos".
- [ ] iPhone — **The art:** the popper is crisp (pixel art, no blur) at normal and large text sizes.

## 24. Daily roll (`step-tracker-daily-roll.txt`)

Needs the migrations up to `20261127000000_activity_friends_roll_coins.sql` and `daily_roll_from` set to today in `app_settings` on the Supabase project the build uses, and a build made after `expo-haptics` and `expo-audio` were added (new native modules: an older build rolls silently and without haptics). One account that shares steps, plus a friend for the board. Turn the ringer on for the sound tests.

- [ ] iPhone  - [ ] Android — **Before the goal:** Today says "…% of N goal · Daily roll at goal" and shows no machine.
- [ ] iPhone  - [ ] Android — **The small machine:** reach the goal and refresh: the goal line under the step count says "· Goal reached!", and a pill in the ranking board's colors appears centered just above the Friends and group buttons ("Goal reached! Tap to roll", the board's card color in light and dark mode, blue "Tap to roll") with the small machine bobbing, bulbs chasing and its reel changing every second or so. It's crisp, no blur.
- [ ] iPhone  - [ ] Android — **Opening isn't rolling:** tap it (Tap to roll or Tap to see your prize): the small machine grows a little with a light tap, wobbles side to side, then with a firmer buzz expands out of the pill and grows until it fills the screen on a flat charcoal background, with "Goal reached! N / N steps" and "Pull the lever to roll!" blinking. The big machine bounces gently, about once a second, and its shadow shrinks and fades as it rises. Tapping the machine does nothing. Close it with ✕ (or Android's back button): it shrinks back into the pill, and Today still says Tap to roll. With Reduce Motion on, it opens and closes with no growing or wobble. Tapping again during the wobble doesn't open it twice.
- [ ] iPhone  - [ ] Android — **The lever:** drag the red knob down a little and let go: it springs back and nothing spins. Drag it most of the way down and let go: light haptic and a clunk, the lever springs back and the reel spins.
- [ ] iPhone  - [ ] Android — **The spin:** about 5 seconds (longer for Epic and Legendary), with a tick and a light buzz for each tile, spacing out as it slows; it stops a little past the prize, then settles on it with a thunk, a success buzz (plus a heavy one for Epic, Legendary, 500 coins), a shake, and the payline and bulbs flashing in the rarity colour.
- [ ] iPhone  - [ ] Android — **The reel:** no item shows twice, no two tiles next to each other are alike, and no tile is blank.
- [ ] iPhone  - [ ] Android — **An item:** a jingle (a fanfare for Epic or Legendary); it grows out of the window and shrinks back, then the card pops out of the tray with its rarity and name, "Wear it" and "Done". Wear it opens the character editor with the item on (and it saves).
- [ ] iPhone  - [ ] Android — **Coins:** coin dings; the coins leave their row and spray out of the tray, the wallet counts up, the card says "+N coins" with "Done" only. The coins on the reel and the card float and spin; all coin tiles are the same coin size.
- [ ] iPhone  - [ ] Android — **Sound settings:** with the ringer off (iPhone silent switch) the roll is silent. With music playing, the roll's sounds play over it and the music doesn't stop.
- [ ] iPhone  - [ ] Android — **One roll:** the lever no longer moves; the screen says "You've rolled today. Come back tomorrow." Back on Today the line says "Today's prize: …". Friends > Activity: your goal line says "won …" (an item) or "won N coins"; on the friend's phone it says the same.
- [ ] iPhone  - [ ] Android — **Killed mid-spin:** roll, close the app during the spin, reopen: Today says "Tap to see your prize"; the machine shows the same prize again.
- [ ] iPhone  - [ ] Android — **Offline:** airplane mode on, pull the lever: "Couldn't roll. Check your connection and try again." and the lever can be pulled again once online.
- [ ] iPhone  - [ ] Android — **Midnight:** open the roll screen just before midnight and pull just after: "This roll ended at midnight."
- [ ] iPhone  - [ ] Android — **Reminder:** with goal reminders on, reach the goal before the reminder time without rolling: the reminder says "Your daily roll is waiting. Open the app before midnight."
- [ ] iPhone  - [ ] Android — **Reduce Motion:** nothing spins, bounces or flies; the prize sits on the line and the card is shown in place.
- [ ] iPhone  - [ ] Android — **VoiceOver / TalkBack:** Today's line reads "Daily roll ready, opens the prize machine"; the big machine is a button "Pull the prize machine's lever", and activating it rolls; the prize is announced ("You won …").

## Sign-off

| | iPhone | Android |
|---|---|---|
| Model and OS version | | |
| App build | | |
| Supabase (local / hosted) | | |
| Tested by, date | | |
| All boxes ticked, or failures accepted below | | |

Failures accepted for release (what, why, who agreed):
