#!/usr/bin/env bash
# step-tracker-goals-streaks.txt, "Paid once": two phones claiming at the
# same moment, one of them having just uploaded an earlier missing day.
# Phone 2 then sees the run start a day earlier, so it would reach 7 on a
# DIFFERENT day and the coin history's once-only rule alone wouldn't stop
# a second payment. The per-person lock makes phone 2 wait, then see phone
# 1's payment inside the same run, and pay nothing.
#
# pgTAP runs everything in one session, so this is a script. It writes
# (and then deletes) a test account in the LOCAL database:
#   supabase start && bash supabase/tests/concurrency/streak_race.sh
set -euo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_ReactNativeApp psql -U postgres -v ON_ERROR_STOP=1 -qAt"}
R=0000000a-57ea-0000-0000-000000000000
failures=0

sql() { $PSQL; }

launch_was=$(sql <<SQL
select value from public.app_settings where key = 'streak_bonus_from';
SQL
)

sql <<SQL
delete from auth.users where id = '$R';
insert into auth.users (id, email) values ('$R', 'race-streak@test.dev');
update public.profiles set onboarded_at = now(), sharing_consent_at = now() where id = '$R';
-- Milestones count from long ago, for this run only (put back below)
update public.app_settings set value = to_char(current_date - 100, 'YYYYMMDD')::integer
where key = 'streak_bonus_from';
-- A 7,500 goal and seven days at 8,000 ending today: the run reaches 7
-- today. Under 10,000, so no daily coins: those would make the two
-- claims wait on each other anyway and hide what the lock does.
insert into public.daily_goal_changes (user_id, starts_on, goal)
values ('$R', current_date - 100, 7500);
insert into public.daily_steps (user_id, day, steps)
select '$R', current_date - d, 8000 from generate_series(0, 6) d;
SQL

claim() { # extra statement before claiming, seconds to hold
  sql <<SQL 2>&1 || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$R';
$1
select public.claim_daily_rewards();
select pg_sleep($2);
commit;
SQL
}

# Phone 1 claims and holds; phone 2 uploads the day before and claims
claim "" 2 > /dev/null &
sleep 0.5
claim "insert into public.daily_steps (user_id, day, steps) values ('$R', current_date - 7, 8000);" 0 > /dev/null
wait

paid=$(sql <<SQL
select count(*) from public.coin_transactions where user_id = '$R' and reason = 'streak_7';
SQL
)
if [ "$paid" = "1" ]; then
  echo "ok - two phones claiming at once: one 7-day bonus"
else
  echo "not ok - two phones claiming at once: $paid 7-day bonuses"
  failures=$((failures + 1))
fi

sql <<SQL
delete from public.coin_transactions where user_id = '$R';
delete from auth.users where id = '$R';
update public.app_settings set value = $launch_was where key = 'streak_bonus_from';
SQL

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "All race checks passed"
