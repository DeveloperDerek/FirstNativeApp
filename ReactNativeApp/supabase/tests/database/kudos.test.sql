-- step-tracker-kudos.txt, section 12: giving, the date window, who
-- counts, "new" and seen, permissions and cleanup. Run with
-- `supabase test db`.
--
-- Days are counted back from the database's date (T = current_date).
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- 1 A: the line owner, 2 F: A's friend (gives most kudos), 3 S: a
-- stranger, 4 K: A's friend who blocked A, 5 N: A's friend, not sharing,
-- 6 R: A's former friend, 7 H: A's friend, hidden, 8 G: A's friend,
-- 9 X: F's friend, not A's
insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-ac7c-0000-0000-000000000000')::uuid,
       'kudos' || n || '@test.dev'
from generate_series(1, 9) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'kud_' || substr(id::text, 7, 2)
where id::text like '%-ac7c-%';
update public.profiles set sharing_consent_at = null where id = '00000005-ac7c-0000-0000-000000000000';
insert into public.profile_private (user_id, hidden_at)
values ('00000007-ac7c-0000-0000-000000000000', now());

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-ac7c-0000-0000-000000000000')::uuid
$$;
-- (The step-row check, which only accepts recent days, is off for this
-- test; rolled back at the end.)
alter table public.daily_steps disable trigger daily_steps_check;
-- A goal day: the uploaded day and its coin row. ago < 0 is a day ahead.
create function pg_temp.goal_day(who integer, ago integer) returns void language sql as $$
  insert into public.daily_steps (user_id, day, steps) values (pg_temp.u(who), current_date - ago, 11000);
  insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
  values (pg_temp.u(who), 150, 'daily_goal', (current_date - ago)::text, (current_date - ago) + interval '1 hour');
$$;
create function pg_temp.as_user(who integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(who)::text, true)
$$;
create function pg_temp.give(owner integer, ago integer) returns integer language sql as $$
  select public.give_kudos(pg_temp.u(owner), current_date - ago, current_date)
$$;
create function pg_temp.line(owner integer, ago integer) returns jsonb language sql as $$
  select l from jsonb_array_elements(public.friends_activity(current_date)) l
  where (l->>'user_id')::uuid = pg_temp.u(owner) and (l->>'day')::date = current_date - ago
$$;
create function pg_temp.claps(l jsonb) returns jsonb language sql as $$
  select jsonb_build_object('kudos', l->'kudos', 'my_kudos', l->'my_kudos', 'new_kudos', l->'new_kudos')
$$;
create function pg_temp.new_count() returns integer language sql as $$
  select (public.notification_counts(current_date)->>'new_kudos')::integer
$$;
create function pg_temp.seen_at() returns timestamptz language sql as $$
  select kudos_seen_at from public.notification_settings where user_id = pg_temp.u(1)
$$;

update public.app_settings set value = (current_date - 40) - date '2000-01-01'
where key = 'goal_is_coin_target_from';

insert into public.friendships (requester_id, addressee_id, status)
select pg_temp.u(1), pg_temp.u(n), 'accepted' from unnest(array[2, 4, 5, 7, 8]) n;
insert into public.friendships (requester_id, addressee_id, status)
values (pg_temp.u(1), pg_temp.u(6), 'removed'), (pg_temp.u(2), pg_temp.u(9), 'accepted');
insert into public.user_blocks (blocker_id, blocked_id) values (pg_temp.u(4), pg_temp.u(1));

-- A: goal days at T-0, T-1, T-29, T-30, T+1 and T+2, an achievement
-- without the goal at T-2, and a goal at T-6 whose day was deleted
select pg_temp.goal_day(1, d) from unnest(array[0, 1, 29, 30, -1, -2, 6]) d;
delete from public.daily_steps where user_id = pg_temp.u(1) and day = current_date - 6;
insert into public.user_achievements (user_id, achievement_id, earned_on, earned_at)
values (pg_temp.u(1), 'streak_7', current_date - 2, current_date - 2 + interval '2 hours');
-- F, N and H reached the goal yesterday
select pg_temp.goal_day(n, 1) from unnest(array[2, 5, 7]) n;

-- ---------------------------------------------------------------------
-- Giving
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(2);
select is(pg_temp.give(1, 1), 1, 'kudos on a friend''s goal line: the count is 1');
select is(pg_temp.give(1, 1), 1, 'again (a double tap): still 1');
select pg_temp.as_user(8);
select is(pg_temp.give(1, 2), 1, 'kudos on an achievement line without the goal');
reset role;
select is((select count(*)::integer from public.kudos
           where giver_id = pg_temp.u(2) and user_id = pg_temp.u(1) and day = current_date - 1),
          1, 'one row for the double tap');

-- The window, at its edges (KUD-13)
set local role authenticated;
select pg_temp.as_user(2);
select lives_ok($$ select pg_temp.give(1, 0) $$, 'my_today itself is accepted');
select lives_ok($$ select pg_temp.give(1, 29) $$, 'my_today - 29 is accepted');
select throws_ok($$ select pg_temp.give(1, 30) $$, 'BAD_DAY', 'my_today - 30 is refused');
select lives_ok($$ select pg_temp.give(1, -1) $$, 'my_today + 1 (a friend ahead of you) is accepted');
select throws_ok($$ select pg_temp.give(1, -2) $$, 'BAD_DAY', 'my_today + 2 is refused');
select throws_ok($$ select public.give_kudos(pg_temp.u(1), current_date + 5, current_date + 5) $$,
                 'BAD_DAY', 'a my_today that isn''t today anywhere is refused');
select is(array[pg_temp.line(1, 0) is not null, pg_temp.line(1, 29) is not null,
                pg_temp.line(1, -1) is not null, pg_temp.line(1, 30) is null, pg_temp.line(1, -2) is null],
          array[true, true, true, true, true],
          'the board shows exactly the lines give_kudos accepts');

-- Refused
select throws_ok($$ select pg_temp.give(1, 5) $$, 'NO_SUCH_LINE', 'a day with no line');
select throws_ok($$ select pg_temp.give(1, 6) $$, 'NO_SUCH_LINE', 'a deleted day with no achievements');
reset role;
update public.app_settings set value = (current_date - 3) - date '2000-01-01'
where key = 'goal_is_coin_target_from';
set local role authenticated;
select pg_temp.as_user(8);
select throws_ok($$ select pg_temp.give(1, 29) $$, 'NO_SUCH_LINE', 'a goal day before the switch day');
reset role;
update public.app_settings set value = (current_date - 40) - date '2000-01-01'
where key = 'goal_is_coin_target_from';
set local role authenticated;
select pg_temp.as_user(1);
select throws_ok($$ select pg_temp.give(1, 1) $$, 'SELF', 'never on your own line');
select throws_ok($$ select pg_temp.give(5, 1) $$, 'CANT_SEE', 'not a friend who doesn''t share');
select throws_ok($$ select pg_temp.give(7, 1) $$, 'CANT_SEE', 'not a hidden friend');
select pg_temp.as_user(3);
select throws_ok($$ select pg_temp.give(1, 1) $$, 'CANT_SEE', 'not from a stranger');
select pg_temp.as_user(4);
select throws_ok($$ select pg_temp.give(1, 1) $$, 'CANT_SEE', 'not from a friend who blocked them');
select pg_temp.as_user(6);
select throws_ok($$ select pg_temp.give(1, 1) $$, 'CANT_SEE', 'not from a former friend');
select pg_temp.as_user(7);
select throws_ok($$ select pg_temp.give(1, 1) $$, 'ACCOUNT_NOT_ACTIVE', 'a hidden caller is refused');
select pg_temp.as_user(5);
select throws_ok($$ select pg_temp.give(1, 1) $$, 'SHARING_REQUIRED', 'a caller who doesn''t share is refused');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$ select pg_temp.give(1, 1) $$, 'Not signed in', 'signed out is refused');

-- F's line: A and X (F's friend, not A's) both give
select pg_temp.as_user(1);
select pg_temp.give(2, 1);
select pg_temp.as_user(9);
select is(pg_temp.give(2, 1), 2, 'a giver the viewer doesn''t know still counts on a friend''s line');
reset role;

-- Times for the kudos on A's lines, oldest first: F T-1, G T-2, F T-29,
-- F T+1, F T-0 (all in one transaction, they'd share now())
update public.kudos k set created_at = now() - make_interval(mins => t.mins)
from (values (2, 1, 50), (8, 2, 40), (2, 29, 30), (2, -1, 20), (2, 0, 10)) t(giver, ago, mins)
where k.giver_id = pg_temp.u(t.giver) and k.user_id = pg_temp.u(1) and k.day = current_date - t.ago;

-- ---------------------------------------------------------------------
-- Counting, listing and "new"
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.claps(pg_temp.line(1, 1)), '{"kudos": 1, "my_kudos": false, "new_kudos": 1}'::jsonb,
          'your line: the count, and how many are new');
select is(pg_temp.claps(pg_temp.line(2, 1)), '{"kudos": 2, "my_kudos": true, "new_kudos": null}'::jsonb,
          'a friend''s line: the count and that you gave one, never "new"');
select is((select array_agg(g->>'user_id') from jsonb_array_elements(public.line_kudos(current_date - 1, current_date)) g),
          array[pg_temp.u(2)::text], 'line_kudos: who gave kudos on your line');
select is(pg_temp.new_count(), 5, 'notification_counts: five new kudos');
select is(public.notification_counts() ? 'new_kudos', false,
          'without my_today (an older app) the counts are as before');
create temp table list on commit drop as select public.new_kudos(current_date) as n;
select is((select array_agg((l->>'day')::date - current_date) from jsonb_array_elements((select n from list)->'lines') l),
          array[0, 1, -29, -2, -1], 'new_kudos: every line with new kudos, newest kudos first, a month back too');
select is(((select n from list)->>'up_to')::timestamptz, now() - interval '10 minutes',
          'up_to is the newest kudos in the list');
select is((select l - 'givers' from jsonb_array_elements((select n from list)->'lines') l
           where (l->>'day')::date = current_date - 2),
          jsonb_build_object('day', current_date - 2, 'kind', 'achievement', 'ref', 'streak_7',
                             'goal', false, 'achievements', '["streak_7"]'::jsonb,
                             'items', '[]'::jsonb),
          'each line says what it was');
reset role;
select is(pg_temp.seen_at(), null, 'reading the board and the list marks nothing seen');

-- Unfriend and block hide kudos; undoing it brings them back (KUD-12)
update public.friendships set status = 'removed'
where requester_id = pg_temp.u(1) and addressee_id = pg_temp.u(8) and status = 'accepted';
set local role authenticated;
select pg_temp.as_user(1);
select is(array[(pg_temp.line(1, 2)->>'kudos')::integer, pg_temp.new_count(),
                jsonb_array_length(public.line_kudos(current_date - 2, current_date))],
          array[0, 4, 0], 'unfriended: the count, "new" and the list all drop the kudos');
reset role;
-- Friends again: a new friendship row (an ended one stays as it is)
insert into public.friendships (requester_id, addressee_id, status)
values (pg_temp.u(1), pg_temp.u(8), 'accepted');
set local role authenticated;
select pg_temp.as_user(1);
select is(array[(pg_temp.line(1, 2)->>'kudos')::integer, pg_temp.new_count()], array[1, 5],
          'friends again: back, and new again because it was never shown');
reset role;
insert into public.user_blocks (blocker_id, blocked_id) values (pg_temp.u(1), pg_temp.u(2));
set local role authenticated;
select pg_temp.as_user(1);
select is(array[(pg_temp.line(1, 1)->>'kudos')::integer, pg_temp.new_count()], array[0, 1],
          'blocked: the blocked giver''s kudos drop out');
reset role;
delete from public.user_blocks where blocker_id = pg_temp.u(1) and blocked_id = pg_temp.u(2);

-- ---------------------------------------------------------------------
-- Marking seen (KUD-11)
-- ---------------------------------------------------------------------
-- G gives on T-1 after the list was loaded (now(), later than up_to)
set local role authenticated;
select pg_temp.as_user(8);
select pg_temp.give(1, 1);
select pg_temp.as_user(1);
select public.mark_kudos_seen(((select n from list)->>'up_to')::timestamptz);
select is(pg_temp.new_count(), 1, 'a kudos that arrived after the list was loaded stays new');
select is(array[(pg_temp.line(1, 1)->>'new_kudos')::integer, (pg_temp.line(1, 0)->>'new_kudos')::integer],
          array[1, 0], '...on its line, and the shown ones are no longer new');
select public.mark_kudos_seen(now() - interval '1 hour');
reset role;
select is(pg_temp.seen_at(), now() - interval '10 minutes', 'an older up_to never moves it back');
set local role authenticated;
select pg_temp.as_user(1);
select public.mark_kudos_seen(((select n from list)->>'up_to')::timestamptz);
reset role;
select is(pg_temp.seen_at(), now() - interval '10 minutes', 'the same up_to twice changes nothing');
set local role authenticated;
select pg_temp.as_user(1);
select public.mark_kudos_seen(now() + interval '1 hour');
reset role;
select is(pg_temp.seen_at(), now(), 'a future up_to is held to now()');

-- A kudos already seen doesn't come back as new after unfriend/refriend
update public.friendships set status = 'removed'
where requester_id = pg_temp.u(1) and addressee_id = pg_temp.u(8) and status = 'accepted';
-- Friends again: a new friendship row (an ended one stays as it is)
insert into public.friendships (requester_id, addressee_id, status)
values (pg_temp.u(1), pg_temp.u(8), 'accepted');
set local role authenticated;
select pg_temp.as_user(1);
select is(array[(pg_temp.line(1, 2)->>'kudos')::integer, pg_temp.new_count()], array[1, 0],
          'friends again after it was seen: counted, not new');
reset role;

-- An unseen kudos (a minute from now, after the seen time), on that day's line
insert into public.kudos (giver_id, user_id, day, kind, ref, created_at)
select pg_temp.u(2), pg_temp.u(1), current_date - 2, f.kind, f.ref, now() + interval '1 minute'
from public.first_line_of_day(pg_temp.u(1), current_date - 2) f;
set local role authenticated;
select pg_temp.as_user(1);
select is(pg_temp.new_count(), 1, 'a new kudos shows in the counts');
select is((public.notification_counts(current_date + 5)->>'new_kudos')::integer, 0,
          'a my_today that isn''t today anywhere counts 0 (the counts never fail over it)');
reset role;
insert into public.kudos (giver_id, user_id, day, kind, ref) values (pg_temp.u(2), pg_temp.u(5), current_date - 1, 'goal', '');
set local role authenticated;
select pg_temp.as_user(5);
select is((public.notification_counts(current_date)->>'new_kudos')::integer, 0,
          'not sharing: new_kudos is 0');
reset role;

select is((select count(*)::integer from public.push_sends), 0, 'giving kudos sends nothing');

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
select is(has_table_privilege('authenticated', 'public.kudos', 'select')
          or has_table_privilege('authenticated', 'public.kudos', 'insert')
          or has_table_privilege('anon', 'public.kudos', 'select'),
          false, 'no direct read or write on kudos from the app');
select is((select bool_and(has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute'))
           from unnest(array['public.give_kudos(uuid, date, date)', 'public.line_kudos(date, date)',
                             'public.new_kudos(date)', 'public.mark_kudos_seen(timestamptz)',
                             'public.notification_counts(date)',
                             'public.friends_activity(date, date, timestamptz, uuid)']) f),
          true, 'the app-facing functions: signed-in users only');
select is((select bool_and(not has_function_privilege('authenticated', f, 'execute'))
           from unnest(array['public.kudos_counts(uuid, uuid)', 'public.activity_line_exists(uuid, date)',
                             'public.new_kudos_rows(uuid, date)']) f),
          true, 'the internal checks: not callable from the app');
select is((select bool_and(prosecdef and proconfig @> array['search_path=""'])
           from pg_proc
           where oid in ('public.give_kudos(uuid, date, date)'::regprocedure,
                         'public.line_kudos(date, date)'::regprocedure,
                         'public.new_kudos(date)'::regprocedure,
                         'public.mark_kudos_seen(timestamptz)'::regprocedure,
                         'public.notification_counts(date)'::regprocedure,
                         'public.kudos_counts(uuid, uuid)'::regprocedure,
                         'public.activity_line_exists(uuid, date)'::regprocedure,
                         'public.new_kudos_rows(uuid, date)'::regprocedure)),
          true, 'security definer with an empty search_path');

-- ---------------------------------------------------------------------
-- Cleanup (KUD-10)
-- ---------------------------------------------------------------------
insert into public.kudos (giver_id, user_id, day, kind, ref)
values (pg_temp.u(2), pg_temp.u(1), current_date - 36, 'goal', ''), (pg_temp.u(2), pg_temp.u(1), current_date - 35, 'goal', '');
do $$ begin execute (select command from cron.job where jobname = 'delete-old-kudos'); end $$;
select is((select array_agg(current_date - day order by day) from public.kudos
           where user_id = pg_temp.u(1) and day < current_date - 30),
          array[35], 'the daily job removes kudos older than 35 days, nothing newer');

select * from finish();
rollback;
