#!/usr/bin/env bash
# step-tracker-achievements.txt, "Exactly once, even at the same moment":
# two sessions award the same person at once. Each must end with one
# achievement row, one reward item and one coin-history row, never an
# achievement without its item.
#   1. two phones claiming at once (both take the per-person lock)
#   2. the launch check (no lock) running while a phone claims: only the
#      skip-what's-there inserts keep it to one of each
#
# pgTAP runs everything in one session, so this is a script. It writes
# (and then deletes) test accounts in the LOCAL database:
#   supabase start && bash supabase/tests/concurrency/achievement_race.sh
set -euo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_ReactNativeApp psql -U postgres -v ON_ERROR_STOP=1 -qAt"}
R1=0000000a-ac1e-0000-0000-000000000000
R2=0000000b-ac1e-0000-0000-000000000000
failures=0

sql() { $PSQL; }

# A million steps waiting to be noticed: 40 days of 25,000 ending today.
# (Skips the step-row trigger, which only accepts recent days.)
sql <<SQL
delete from auth.users where id in ('$R1', '$R2');
insert into auth.users (id, email) values ('$R1', 'race-ach1@test.dev'), ('$R2', 'race-ach2@test.dev');
update public.profiles set onboarded_at = now(), sharing_consent_at = now() where id in ('$R1', '$R2');
set session_replication_role = replica;
insert into public.daily_steps (user_id, day, steps)
select r, current_date - d, 25000 from generate_series(0, 39) d, unnest(array['$R1', '$R2']::uuid[]) r;
set session_replication_role = origin;
SQL

session() { # user, statement, seconds to hold before committing
  sql <<SQL 2>&1 || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$1';
$2;
select pg_sleep($3);
commit;
SQL
}

check() { # user, label
  counts=$(sql <<SQL
select (select count(*) from public.user_achievements where user_id = '$1' and achievement_id = 'steps_1m')
    || ' ' || (select count(*) from public.user_items where user_id = '$1' and item_id = 'shoes_winged')
    || ' ' || (select count(*) from public.coin_transactions
               where user_id = '$1' and reason = 'achievement' and ref = 'shoes_winged');
SQL
)
  if [ "$counts" = "1 1 1" ]; then
    echo "ok - $2: one achievement, one item, one coin-history row"
  else
    echo "not ok - $2: achievement, item, coin rows = $counts"
    failures=$((failures + 1))
  fi
}

# 1. Phone 1 claims and holds; phone 2 claims meanwhile
session "$R1" "select public.claim_daily_rewards()" 2 > /dev/null &
sleep 0.5
session "$R1" "select public.claim_daily_rewards()" 0 > /dev/null
wait
check "$R1" "two phones claiming at once"

# 2. The launch check (as the migration runs it, no lock) holds; a phone
# claims meanwhile and has to wait on its uncommitted rows
sql <<SQL > /dev/null &
begin;
select public.award_achievements('$R2', true);
select pg_sleep(2);
commit;
SQL
sleep 0.5
session "$R2" "select public.claim_daily_rewards()" 0 > /dev/null
wait
check "$R2" "the launch check and a claim at once"

sql <<SQL
delete from public.coin_transactions where user_id in ('$R1', '$R2');
delete from auth.users where id in ('$R1', '$R2');
SQL

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "All race checks passed"
