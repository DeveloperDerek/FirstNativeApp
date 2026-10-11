#!/usr/bin/env bash
# step-tracker-safety.txt, sections 3 and 10: a friend request and a block
# between the same two people at the same moment, from two database
# sessions. Never leaves a live request between a blocked pair, whichever
# goes first, with or without a friendship row beforehand.
#
# pgTAP runs everything in one session, so this is a script. It writes
# (and then deletes) two test accounts in the LOCAL database:
#   supabase start && bash supabase/tests/concurrency/block_request_race.sh
set -euo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_ReactNativeApp psql -U postgres -v ON_ERROR_STOP=1 -qAt"}
R=0000000a-7ace-0000-0000-000000000000
S=0000000b-7ace-0000-0000-000000000000
failures=0

sql() { $PSQL; }

reset_pair() {
  sql <<SQL
delete from auth.users where id in ('$R', '$S');
insert into auth.users (id, email) values ('$R', 'race-r@test.dev'), ('$S', 'race-s@test.dev');
update public.profiles set onboarded_at = now(), sharing_consent_at = now()
where id in ('$R', '$S');
SQL
}

# Session as a user: begin, act, hold the transaction open, commit
as_user() { # user, statement, seconds to hold
  sql <<SQL 2>&1 || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$1';
$2;
select pg_sleep($3);
commit;
SQL
}

live_requests() {
  sql <<SQL
select count(*) from public.friendships
where status in ('pending', 'accepted')
  and '$R' in (requester_id, addressee_id) and '$S' in (requester_id, addressee_id);
SQL
}

check() { # name, expected live requests, block statement output, request output
  local live
  live=$(live_requests)
  if [ "$live" = "$2" ]; then
    echo "ok - $1"
  else
    echo "not ok - $1 (live requests: $live, expected $2)"
    echo "  block:   $3"
    echo "  request: $4"
    failures=$((failures + 1))
  fi
}

# 1. The block takes the pair lock first; the request waits, then is refused
reset_pair
as_user "$S" "select public.block_user('$R')" 2 > /tmp/race_block.out &
sleep 0.5
as_user "$R" "insert into public.friendships (requester_id, addressee_id) values ('$R', '$S')" 0 > /tmp/race_req.out
wait
check "block first, no row before: the request is refused" 0 "$(cat /tmp/race_block.out)" "$(cat /tmp/race_req.out)"
grep -q "row-level security" /tmp/race_req.out \
  && echo "ok - ...with the same error as a missing account" \
  || { echo "not ok - the refusal was: $(cat /tmp/race_req.out)"; failures=$((failures + 1)); }

# 2. The request takes the lock first; the block waits, then ends it
reset_pair
as_user "$R" "insert into public.friendships (requester_id, addressee_id) values ('$R', '$S')" 2 > /tmp/race_req.out &
sleep 0.5
as_user "$S" "select public.block_user('$R')" 0 > /tmp/race_block.out
wait
check "request first, no row before: the block ends it" 0 "$(cat /tmp/race_block.out)" "$(cat /tmp/race_req.out)"

# 3. Already friends: a new request can't exist, the block ends the friendship
reset_pair
sql <<SQL
insert into public.friendships (requester_id, addressee_id, status) values ('$R', '$S', 'accepted');
SQL
as_user "$S" "select public.block_user('$R')" 2 > /tmp/race_block.out &
sleep 0.5
as_user "$R" "update public.friendships set status = 'removed' where '$S' in (requester_id, addressee_id)" 0 > /tmp/race_req.out
wait
check "already friends: no live friendship after the block" 0 "$(cat /tmp/race_block.out)" "$(cat /tmp/race_req.out)"

# 4. A request ended earlier (declined): a new one races the block
reset_pair
sql <<SQL
insert into public.friendships (requester_id, addressee_id, status) values ('$R', '$S', 'declined');
SQL
as_user "$R" "insert into public.friendships (requester_id, addressee_id) values ('$R', '$S')" 2 > /tmp/race_req.out &
sleep 0.5
as_user "$S" "select public.block_user('$R')" 0 > /tmp/race_block.out
wait
check "after a decline: the new request is ended by the block" 0 "$(cat /tmp/race_block.out)" "$(cat /tmp/race_req.out)"

sql <<SQL
delete from auth.users where id in ('$R', '$S');
SQL
rm -f /tmp/race_block.out /tmp/race_req.out

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "All race checks passed"
