#!/usr/bin/env bash
# step-tracker-group-owners.txt, section 5: the owner leaves at the same
# moment as the member who would take over, from two database sessions.
# The group must end with an owner who is in it (or be deleted if they
# were the last two).
#
# pgTAP runs everything in one session, so this is a script. It writes
# (and then deletes) test accounts in the LOCAL database:
#   supabase start && bash supabase/tests/concurrency/group_owner_race.sh
set -euo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_ReactNativeApp psql -U postgres -v ON_ERROR_STOP=1 -qAt"}
O=0000000a-0a0e-0000-0000-000000000000 # owner
A=0000000b-0a0e-0000-0000-000000000000 # next in line
B=0000000c-0a0e-0000-0000-000000000000 # after that
G=0000000d-0a0e-0000-0000-000000000000
failures=0

sql() { $PSQL; }

reset_group() { # members after the owner: "A B" or "A"
  sql <<SQL
delete from public.groups where id = '$G';
delete from auth.users where id in ('$O', '$A', '$B');
insert into auth.users (id, email) values
  ('$O', 'race-o@test.dev'), ('$A', 'race-a@test.dev'), ('$B', 'race-b@test.dev');
update public.profiles set onboarded_at = now() where id in ('$O', '$A', '$B');
insert into public.groups (id, name, owner_id, invite_code) values ('$G', 'Race', '$O', 'raceown1');
update public.group_members set joined_at = now() - interval '3 days' where group_id = '$G';
insert into public.group_members (group_id, user_id, joined_at)
select '$G', u, now() - interval '2 days' + (n || ' hours')::interval
from unnest(array[$1]::uuid[]) with ordinality as t(u, n);
SQL
}

# A person leaves the group, holding the transaction open, then commits
leave() { # user, seconds to hold
  sql <<SQL 2>&1 || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$1';
delete from public.group_members where group_id = '$G' and user_id = '$1';
select pg_sleep($2);
commit;
SQL
}

state() {
  sql <<SQL
select case
  when not exists (select 1 from public.groups where id = '$G') then 'deleted'
  when exists (select 1 from public.groups g join public.group_members m
               on m.group_id = g.id and m.user_id = g.owner_id where g.id = '$G')
    then 'owner is a member'
  else 'OWNER NOT IN GROUP' end;
SQL
}

check() { # name, expected
  local got
  got=$(state)
  if [ "$got" = "$2" ]; then echo "ok - $1"; else echo "not ok - $1 (got: $got)"; failures=$((failures + 1)); fi
}

# 1. The next in line (A) leaves first and holds; the owner leaves meanwhile
reset_group "'$A', '$B'"
leave "$A" 2 > /dev/null &
sleep 0.5
leave "$O" 0 > /dev/null
wait
check "A leaving while the owner leaves: B takes over" "owner is a member"

# 2. The owner leaves first and holds; A leaves meanwhile
reset_group "'$A', '$B'"
leave "$O" 2 > /dev/null &
sleep 0.5
leave "$A" 0 > /dev/null
wait
check "the owner leaving while A leaves: B ends up owner" "owner is a member"

# 3. The last two leave at once: the group is deleted
reset_group "'$A'"
leave "$A" 2 > /dev/null &
sleep 0.5
leave "$O" 0 > /dev/null
wait
check "the last two leave at once: the group is deleted" "deleted"

sql <<SQL
delete from public.groups where id = '$G';
delete from auth.users where id in ('$O', '$A', '$B');
SQL

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "All race checks passed"
