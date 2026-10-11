#!/usr/bin/env bash
# step-tracker-safety.txt, sections 4 and 10: reports sent at the same
# moment from two database sessions.
#   - the same report twice (a person, and a group): one is saved
#   - the 10th and 11th report in 24 hours together: exactly 10 are saved
#
# pgTAP runs everything in one session, so this is a script. It writes
# (and then deletes) test accounts in the LOCAL database, and turns
# reports_enabled on for the run (put back afterwards):
#   supabase start && bash supabase/tests/concurrency/report_race.sh
set -euo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_ReactNativeApp psql -U postgres -v ON_ERROR_STOP=1 -qAt"}
R=0000000a-4ace-0000-0000-000000000000 # reporter
T=0000000b-4ace-0000-0000-000000000000 # reported person
G=0000000c-4ace-0000-0000-000000000000 # reported group
failures=0

sql() { $PSQL; }

was_enabled=$(sql <<SQL
select value from public.app_settings where key = 'reports_enabled';
SQL
)

reset_people() {
  sql <<SQL
update public.app_settings set value = 1 where key = 'reports_enabled';
delete from public.reports where reporter_id = '$R';
delete from auth.users where id in ('$R', '$T');
insert into auth.users (id, email) values ('$R', 'race-r@test.dev'), ('$T', 'race-t@test.dev');
update public.profiles set onboarded_at = now(), sharing_consent_at = now() where id in ('$R', '$T');
insert into public.groups (id, name, owner_id, invite_code) values ('$G', 'Race', '$R', 'racegrp1');
SQL
}

# Session as R: one report in a transaction held open, then commit
report_as_r() { # statement, seconds to hold
  sql <<SQL 2>&1 || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$R';
$1;
select pg_sleep($2);
commit;
SQL
}

count_reports() { # where clause
  sql <<SQL
select count(*) from public.reports where reporter_id = '$R' and $1;
SQL
}

check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (got $2, expected $3)"; failures=$((failures + 1)); fi
}

# 1. The same person report from two sessions at once
reset_people
report_as_r "select public.report_user('$T', 'spam')" 2 > /dev/null &
sleep 0.5
report_as_r "select public.report_user('$T', 'spam')" 0 > /dev/null
wait
check "the same person report twice at once: one saved" "$(count_reports "person_id = '$T'")" 1

# 2. The same group report from two sessions at once
report_as_r "select public.report_group('$G', 'other')" 2 > /dev/null &
sleep 0.5
report_as_r "select public.report_group('$G', 'other')" 0 > /dev/null
wait
check "the same group report twice at once: one saved" "$(count_reports "group_id = '$G'")" 1

# 3. Nine reports already; the 10th and 11th sent together. Without the
# per-person lock both would count nine and both be saved.
reset_people
sql <<SQL
insert into public.reports (reporter_id, target_kind, reason)
select '$R', 'person', 'spam' from generate_series(1, 9);
SQL
report_as_r "select public.report_user('$T', 'spam')" 2 > /tmp/race_r1.out &
sleep 0.5
report_as_r "select public.report_group('$G', 'other')" 0 > /tmp/race_r2.out
wait
check "the 10th and 11th at once: exactly 10 saved" "$(count_reports "true")" 10
grep -q REPORT_LIMIT /tmp/race_r1.out /tmp/race_r2.out \
  && echo "ok - ...the other was refused (REPORT_LIMIT)" \
  || { echo "not ok - neither was refused"; failures=$((failures + 1)); }

sql <<SQL
delete from public.reports where reporter_id = '$R';
delete from auth.users where id in ('$R', '$T');
update public.app_settings set value = $was_enabled where key = 'reports_enabled';
SQL
rm -f /tmp/race_r1.out /tmp/race_r2.out

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "All race checks passed"
