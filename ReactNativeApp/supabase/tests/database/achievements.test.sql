-- step-tracker-achievements.txt, section 7: earning, history changes,
-- the launch check, who can read what, and what the app can't do. (Two
-- sessions awarding at once: supabase/tests/concurrency/achievement_race.sh.)
-- Run with `supabase test db`.
--
-- Days are counted back from the database's date (T = current_date).
begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

-- 1 A: days in a row, 2 B: total steps, 3 C: streaks, 4 D: quests,
-- 5 E: in the group but not the party, 6 N: doesn't share, 7 M: a million,
-- 8 F: A's friend, 9 S: a stranger, 10 K: A's friend who blocked A,
-- 11 R: A's former friend, 12 H: A's friend, hidden, 13 X: A's friend,
-- under age, 14 L: for the launch check, 15 G: a goal change
insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-ac11-0000-0000-000000000000')::uuid,
       'ach' || n || '@test.dev'
from generate_series(1, 15) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'ach_' || substr(id::text, 7, 2)
where id::text like '%-ac11-%';
update public.profiles set sharing_consent_at = null where id = '00000006-ac11-0000-0000-000000000000';
insert into public.profile_private (user_id, hidden_at)
values ('0000000c-ac11-0000-0000-000000000000', now());
insert into public.profile_private (user_id, age_blocked_at)
values ('0000000d-ac11-0000-0000-000000000000', now());

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-ac11-0000-0000-000000000000')::uuid
$$;
-- (The step-row check, which only accepts recent days, is off for this
-- test; rolled back at the end.)
alter table public.daily_steps disable trigger daily_steps_check;
create function pg_temp.walk(who integer, d_from integer, d_to integer, n integer)
returns void language sql as $$
  insert into public.daily_steps (user_id, day, steps)
  select pg_temp.u(who), current_date - d, n from generate_series(d_to, d_from) d
  on conflict (user_id, day) do update set steps = excluded.steps
$$;
create function pg_temp.as_user(who integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(who)::text, true)
$$;
create function pg_temp.award(who integer) returns integer language sql as $$
  select public.award_achievements(pg_temp.u(who))
$$;
create function pg_temp.earned(who integer) returns text[] language sql as $$
  select coalesce(array_agg(achievement_id::text order by achievement_id), '{}')
  from public.user_achievements where user_id = pg_temp.u(who)
$$;
create function pg_temp.earned_on(who integer, what text) returns date language sql as $$
  select earned_on from public.user_achievements where user_id = pg_temp.u(who) and achievement_id = what
$$;
create function pg_temp.owns(who integer, item text) returns boolean language sql as $$
  select exists (select 1 from public.user_items where user_id = pg_temp.u(who) and item_id = item)
$$;
create function pg_temp.item_rows(who integer, item text) returns integer language sql as $$
  select count(*)::integer from public.coin_transactions
  where user_id = pg_temp.u(who) and reason = 'achievement' and ref = item
$$;
create function pg_temp.progress(who integer, what text) returns bigint language sql as $$
  select m.progress from public.achievement_measures(pg_temp.u(who)) m where m.achievement_id = what
$$;

-- ---------------------------------------------------------------------
-- The list and the reward items
-- ---------------------------------------------------------------------
select is((select count(*)::int from public.achievements), 11, 'eleven achievements');
select is((select array_agg(id || '>' || unlocked_by order by id) from public.shop_items
           where unlocked_by is not null),
          array['cape_ember>streak_30', 'hat_laurel>streak_100', 'pet_mimic>quest_1',
                'shoes_winged>steps_1m'],
          'four reward items, each unlocked by its achievement');
select is((select bool_and(not active and price is null) from public.shop_items where unlocked_by is not null),
          true, '...none active, none priced');

-- ---------------------------------------------------------------------
-- Steps in a day (A): exactly at the threshold, not one step below
-- ---------------------------------------------------------------------
select pg_temp.walk(1, 5, 5, 9999);
select pg_temp.walk(1, 3, 3, 10000);
select pg_temp.walk(1, 1, 1, 29999);
select is(pg_temp.award(1), 2, 'A: two new achievements');
select is(pg_temp.earned(1), array['big_day', 'first_10k'], '...First 10K and Big day, not Huge day at 29,999');
select is(pg_temp.earned_on(1, 'first_10k'), current_date - 3, 'First 10K dated the first day at 10,000, not the 9,999 one');
select is(pg_temp.earned_on(1, 'big_day'), current_date - 1, 'Big day dated its day');
select is(pg_temp.award(1), 0, 'checked again: nothing new');
select is((select count(*)::int from public.user_achievements where user_id = pg_temp.u(1)), 2, '...and nothing twice');

-- Through the daily claim, as the app does it
select pg_temp.walk(1, 0, 0, 30000);
select pg_temp.as_user(1);
set local role authenticated;
select lives_ok($$ select public.claim_daily_rewards() $$, 'A claims after uploading a 30,000-step day');
reset role;
select is(pg_temp.earned_on(1, 'huge_day'), current_date, '...and has Huge day, dated today');

-- ---------------------------------------------------------------------
-- Steps all together (B): added up oldest first, whatever the upload order
-- ---------------------------------------------------------------------
-- 40,000 on T-2 first, then 30,000 on T-10 and 29,999 on T-6: 99,999
select pg_temp.walk(2, 2, 2, 40000);
select pg_temp.walk(2, 10, 10, 30000);
select pg_temp.walk(2, 6, 6, 29999);
select pg_temp.award(2);
select is(pg_temp.earned_on(2, 'steps_100k'), null, '99,999 in all: no 100,000 steps');
select is(pg_temp.progress(2, 'steps_100k'), 99999::bigint, '...progress 99,999');
-- One step more, on the oldest day: the running total now reaches
-- 100,000 on T-2 (30,001 + 29,999 + 40,000)
select pg_temp.walk(2, 10, 10, 30001);
select pg_temp.award(2);
select is(pg_temp.earned_on(2, 'steps_100k'), current_date - 2, '100,000 dated the day the running total reached it');

-- ---------------------------------------------------------------------
-- Streaks (C): a late upload completes a run
-- ---------------------------------------------------------------------
-- T-8..T-6 and T-4..T-1 at 10,000: two runs of 3 and 4, T-5 missing
select pg_temp.walk(3, 8, 6, 10000);
select pg_temp.walk(3, 4, 1, 10000);
select pg_temp.award(3);
select is(pg_temp.earned_on(3, 'streak_7'), null, 'runs of 3 and 4: no week in a row');
select is(pg_temp.progress(3, 'streak_7'), 4::bigint, '...best streak 4');
select pg_temp.walk(3, 5, 5, 10000);  -- the missing day, uploaded late
select pg_temp.award(3);
select is(pg_temp.earned_on(3, 'streak_7'), current_date - 2, 'the late day joins them: a week, dated the day the run reached 7');

-- A goal change (G) doesn't change a past streak or its achievement
select pg_temp.walk(15, 7, 1, 8000);
insert into public.daily_goal_changes (user_id, starts_on, goal, chosen_at)
values (pg_temp.u(15), current_date - 30, 8000, now() - interval '31 days');
select pg_temp.award(15);
select is(pg_temp.earned_on(15, 'streak_7'), current_date - 1, 'G: a week at an 8,000 goal');
select pg_temp.as_user(15);
select public.set_daily_goal_at(12000, current_date, now());
select pg_temp.award(15);
select is(pg_temp.earned_on(15, 'streak_7'), current_date - 1, '...a higher goal from tomorrow changes nothing');
select is(pg_temp.progress(15, 'streak_7'), 7::bigint, '...nor the best streak');

-- ---------------------------------------------------------------------
-- Quests (D, E): the party of a completed quest, each quest once
-- ---------------------------------------------------------------------
insert into public.groups (id, name, owner_id, invite_code) values
  ('000000aa-ac11-0000-0000-000000000000', 'Q', pg_temp.u(4), 'achgrp01');
insert into public.group_members (group_id, user_id) values
  ('000000aa-ac11-0000-0000-000000000000', pg_temp.u(5));
-- A failed quest with D in the party
insert into public.quests (id, group_id, type_id, status, start_asap, vote_deadline, starts_at,
                           ends_at, goal, party_size)
values ('000000f1-ac11-0000-0000-000000000000', '000000aa-ac11-0000-0000-000000000000', 'sprint',
        'failed', true, now() - interval '3 days', now() - interval '4 days',
        now() - interval '4 days' + interval '2 hours', 8000, 1);
insert into public.quest_party (quest_id, user_id) values ('000000f1-ac11-0000-0000-000000000000', pg_temp.u(4));
select pg_temp.award(4);
select is(pg_temp.earned_on(4, 'quest_1'), null, 'a failed quest doesn''t count');
-- An active one with D in the party (not E), completed as upload_quest_steps does
insert into public.quests (id, group_id, type_id, status, start_asap, vote_deadline, starts_at,
                           ends_at, goal, party_size)
values ('000000f2-ac11-0000-0000-000000000000', '000000aa-ac11-0000-0000-000000000000', 'sprint',
        'active', true, now(), now() - interval '1 hour', now() + interval '1 hour', 8000, 1);
insert into public.quest_party (quest_id, user_id) values ('000000f2-ac11-0000-0000-000000000000', pg_temp.u(4));
update public.quests set status = 'completed', completed_at = now()
where id = '000000f2-ac11-0000-0000-000000000000';
select is(pg_temp.earned_on(4, 'quest_1'), (now() at time zone 'America/Los_Angeles')::date,
          'completed: D has First quest won straight away, dated the day it was won');
select is(pg_temp.owns(4, 'pet_mimic'), true, '...and the Mimic');
select is(pg_temp.item_rows(4, 'pet_mimic'), 1, '...at 0 coins in the coin history');
select is((select amount from public.coin_transactions where user_id = pg_temp.u(4)
           and reason = 'achievement' and ref = 'pet_mimic'), 0, '...0 coins');
select is(pg_temp.earned(5), '{}'::text[], 'E, in the group but not the party: nothing');
-- Settling again (or the trigger firing again) counts it once
update public.quests set status = 'completed' where id = '000000f2-ac11-0000-0000-000000000000';
select is(pg_temp.progress(4, 'quest_10'), 1::bigint, 'the same quest counts once');
-- Nine more, won on the days T-9..T-1: the tenth dates Ten quests won
insert into public.quests (id, group_id, type_id, status, start_asap, vote_deadline, starts_at,
                           ends_at, goal, party_size, completed_at)
select ('000000' || lpad(to_hex(16 + n), 2, '0') || '-ac11-0000-0000-000000000000')::uuid,
       '000000aa-ac11-0000-0000-000000000000', 'sprint', 'completed', true, now(),
       now() - make_interval(days => 20 + n), now() - make_interval(days => 20 + n) + interval '2 hours',
       8000, 1, now() - make_interval(days => 20 + n)
from generate_series(1, 9) n;
insert into public.quest_party (quest_id, user_id)
select ('000000' || lpad(to_hex(16 + n), 2, '0') || '-ac11-0000-0000-000000000000')::uuid, pg_temp.u(4)
from generate_series(1, 9) n;
select pg_temp.award(4);
select is(pg_temp.earned_on(4, 'quest_10'), (now() at time zone 'America/Los_Angeles')::date,
          'ten quests: dated the tenth in the order they were won');
select is(pg_temp.earned_on(4, 'quest_1'), (now() at time zone 'America/Los_Angeles')::date,
          '...First quest won keeps its date, though older quests now count');

-- ---------------------------------------------------------------------
-- Not sharing (N)
-- ---------------------------------------------------------------------
select pg_temp.walk(6, 40, 0, 30000);
select is(pg_temp.award(6), 0, 'N doesn''t share: no achievements');
select is(pg_temp.owns(6, 'shoes_winged'), false, '...and no reward items, past a million steps');

-- ---------------------------------------------------------------------
-- A million steps (M), and history changes
-- ---------------------------------------------------------------------
select pg_temp.walk(7, 40, 1, 25000);  -- 1,000,000 exactly on T-1
select pg_temp.award(7);
select is(pg_temp.earned_on(7, 'steps_1m'), current_date - 1, 'M: a million steps on T-1');
select is(pg_temp.owns(7, 'shoes_winged'), true, '...and the Winged sneakers');
select is(pg_temp.progress(7, 'steps_5m'), 1000000::bigint, 'progress toward five million: 1,000,000');
delete from public.daily_steps where user_id = pg_temp.u(7) and day = current_date - 1;
select pg_temp.award(7);
select is(pg_temp.earned_on(7, 'steps_1m'), current_date - 1, 'a qualifying day deleted: still earned, same date');
select is(pg_temp.owns(7, 'shoes_winged'), true, '...still owns the sneakers');
select is(pg_temp.progress(7, 'steps_5m'), 975000::bigint, '...progress goes down');
select pg_temp.walk(7, 1, 1, 25000);
select is(pg_temp.progress(7, 'steps_5m'), 1000000::bigint, 'uploaded again: progress back up');
select is(pg_temp.item_rows(7, 'shoes_winged'), 1, 'the item recorded once');

-- ---------------------------------------------------------------------
-- A reward item added later
-- ---------------------------------------------------------------------
insert into public.shop_items (id, price, active, unlocked_by) values ('test_reward', null, false, 'first_10k');
select pg_temp.award(1);
select is(pg_temp.owns(1, 'test_reward'), true, 'an item added later reaches A, who already had First 10K');
select pg_temp.award(1);
select is(pg_temp.item_rows(1, 'test_reward'), 1, '...once, run again');
select pg_temp.award(5);
select is(pg_temp.owns(5, 'test_reward'), false, '...and not E, who never earned it');

-- Reward items can't be sold
select throws_ok($$ update public.shop_items set active = true where id = 'shoes_winged' $$, '23514', null,
                 'a reward item can''t be made active');
select throws_ok($$ update public.shop_items set price = 100 where id = 'shoes_winged' $$, '23514', null,
                 '...or priced');
select pg_temp.as_user(2);
set local role authenticated;
select is_empty($$ select 1 from public.daily_shop() where id in ('shoes_winged', 'cape_ember', 'hat_laurel', 'pet_mimic') $$,
                'never in the daily shop');
select throws_ok($$ select public.purchase_item('shoes_winged') $$, 'ITEM_NOT_FOR_SALE', 'buying one is refused');
select throws_ok($$ update public.profiles set avatar = jsonb_set(avatar, '{shoes}', '"shoes_winged"')
                   where id = '00000002-ac11-0000-0000-000000000000' $$,
                 'P0001', 'ITEM_NOT_OWNED: shoes_winged', 'wearing one not owned is refused');
select pg_temp.as_user(7);
select lives_ok($$ update public.profiles set avatar = jsonb_set(avatar, '{shoes}', '"shoes_winged"')
                   where id = '00000007-ac11-0000-0000-000000000000' $$,
                'M, who earned it, can wear it');

-- ---------------------------------------------------------------------
-- Yours: my_achievements, new_achievements, mark_achievements_seen
-- ---------------------------------------------------------------------
select pg_temp.as_user(2);
select is((public.my_achievements()->'earned'->0->>'id'), 'steps_100k', 'B''s earned list');
select is((select (p->>'value')::bigint from jsonb_array_elements(public.my_achievements()->'progress') p
           where p->>'id' = 'steps_1m'), 100000::bigint, '...with progress toward a million');
select is((select count(*)::int from jsonb_array_elements(public.my_achievements()->'progress') p
           where p->>'id' = 'steps_100k'), 0, '...and none for what''s earned');
-- (40,000 on one day: First 10K, Big day and Huge day too)
select is(jsonb_array_length(public.new_achievements()), 4, 'four unseen');
select public.mark_achievements_seen(array['steps_100k', 'first_10k', 'nonsense']);
select is((select array_agg(a->>'id' order by a->>'id') from jsonb_array_elements(public.new_achievements()) a),
          array['big_day', 'huge_day'], 'two marked seen: the other two still unseen');
select lives_ok($$ select public.mark_achievements_seen(array['steps_100k']) $$, 'marking again is fine');
reset role;
select is((select seen_at from public.user_achievements where user_id = pg_temp.u(1) and achievement_id = 'first_10k'),
          null, 'A''s First 10K, named by B, is still unseen');
select pg_temp.as_user(7);
set local role authenticated;
select is((select a->>'item' from jsonb_array_elements(public.new_achievements()) a where a->>'id' = 'steps_1m'),
          'shoes_winged', 'the unseen list names the item each one unlocked');
select pg_temp.as_user(6);
select is(public.my_achievements()->>'sharing', 'false', 'N: not sharing');
select is(public.my_achievements()->'progress', '[]'::jsonb, '...and no progress');
reset role;

-- ---------------------------------------------------------------------
-- Who can read what (player_achievements)
-- ---------------------------------------------------------------------
-- A's friends: F, K (who then blocks A), H (hidden), X (under age);
-- R was a friend and isn't any more
insert into public.friendships (requester_id, addressee_id, status)
select pg_temp.u(1), pg_temp.u(n), 'accepted' from unnest(array[8, 10, 12, 13]) n;
insert into public.user_blocks (blocker_id, blocked_id) values (pg_temp.u(10), pg_temp.u(1));
insert into public.friendships (requester_id, addressee_id, status) values (pg_temp.u(11), pg_temp.u(1), 'accepted');
delete from public.friendships where requester_id = pg_temp.u(11);
create function pg_temp.reads_a(who integer) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(who);
  return public.player_achievements(pg_temp.u(1));
end;
$$;
set local role authenticated;
select is(jsonb_array_length(pg_temp.reads_a(8)), 3, 'a friend sees A''s three');
select is(pg_temp.reads_a(8)->0 ?& array['id', 'earned_on'], true, '...ids and days');
select is((select count(*)::int from jsonb_array_elements(pg_temp.reads_a(8)) e, jsonb_object_keys(e) k
           where k not in ('id', 'earned_on')), 0, '...and nothing else');
select is(pg_temp.reads_a(9), null, 'a stranger: null');
select is(pg_temp.reads_a(10), null, 'blocked: null');
select is(pg_temp.reads_a(11), null, 'a former friend: null');
select throws_ok($$ select pg_temp.reads_a(12) $$, 'ACCOUNT_NOT_ACTIVE', 'a hidden caller is refused');
select throws_ok($$ select pg_temp.reads_a(13) $$, 'ACCOUNT_NOT_ACTIVE', 'an under-age caller is refused');
select pg_temp.as_user(1);
select is(public.player_achievements(pg_temp.u(12)), null, 'A reading a hidden friend: null');
select is(public.player_achievements(pg_temp.u(13)), null, 'A reading an under-age friend: null');
select is(jsonb_array_length(public.player_achievements(pg_temp.u(1))), 3, 'A reading A: their own');
reset role;

-- ---------------------------------------------------------------------
-- What the app can't do
-- ---------------------------------------------------------------------
select pg_temp.as_user(9);
set local role authenticated;
select throws_ok($$ select public.award_achievements('00000009-ac11-0000-0000-000000000000') $$, '42501', null,
                 'the app can''t award achievements');
select throws_ok($$ select * from public.achievement_measures('00000001-ac11-0000-0000-000000000000') $$, '42501', null,
                 '...or read someone''s measures');
select throws_ok($$ select * from public.user_achievements $$, '42501', null,
                 '...or read the table');
select throws_ok($$ insert into public.user_achievements (user_id, achievement_id, earned_on)
                    values ('00000009-ac11-0000-0000-000000000000', 'steps_5m', current_date) $$, '42501', null,
                 '...or write it');
select throws_ok($$ insert into public.user_items (user_id, item_id)
                    values ('00000009-ac11-0000-0000-000000000000', 'hat_laurel') $$, '42501', null,
                 '...or give itself a reward item');
reset role;
select is((select count(*)::int
           from unnest(array['public.achievement_measures(uuid)', 'public.award_achievements(uuid, boolean)',
                             'public.earned_achievements(uuid)', 'public.on_quest_completed()']) f,
                unnest(array['public', 'anon', 'authenticated']) r
           where (r = 'public' and exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                           where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'))
              or (r <> 'public' and has_function_privilege(r, f, 'execute'))), 0,
          'no execute on the internal functions for public, anon or authenticated');
select is((select bool_and(not has_function_privilege('anon', f, 'execute')
                           and has_function_privilege('authenticated', f, 'execute'))
           from unnest(array['public.my_achievements()', 'public.new_achievements()',
                             'public.mark_achievements_seen(text[])', 'public.player_achievements(uuid)']) f),
          true, 'the app-facing ones: authenticated only, never anon');
select is((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p where p.oid in ('public.achievement_measures(uuid)'::regprocedure,
             'public.award_achievements(uuid, boolean)'::regprocedure, 'public.earned_achievements(uuid)'::regprocedure,
             'public.on_quest_completed()'::regprocedure, 'public.my_achievements()'::regprocedure,
             'public.new_achievements()'::regprocedure, 'public.mark_achievements_seen(text[])'::regprocedure,
             'public.player_achievements(uuid)'::regprocedure)),
          true, 'all security definer with an empty search_path');

-- ---------------------------------------------------------------------
-- The launch check (L)
-- ---------------------------------------------------------------------
-- (The migration already ran it for everyone; here the same call for a
-- person with history from before launch.)
select pg_temp.walk(14, 35, 0, 12000);
select is(public.award_achievements(pg_temp.u(14), true), 4, 'L at launch: four earned');
select is(pg_temp.earned_on(14, 'streak_30'), current_date - 6, '...with the real day (the run reached 30 on T-6)');
select is((select bool_and(at_launch) from public.user_achievements where user_id = pg_temp.u(14)), true,
          '...marked as from the launch check, for the one summary');
select is(pg_temp.owns(14, 'cape_ember'), true, '...and the Ember cape');
select is(public.award_achievements(pg_temp.u(14), true), 0, 'run again: nothing added');

select * from finish();
rollback;
