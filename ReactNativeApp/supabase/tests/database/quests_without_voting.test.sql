-- step-tracker-decisions.txt, QUEST-1, QUEST-2 and QUEST-5: any member
-- starts a quest with no vote, the party is everyone sharing steps, and
-- the goal grows with the party. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- G: owner O and members M1-M4 (M4 doesn't share steps). S: O and M4 only.
insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-9e57-0000-0000-000000000000')::uuid,
       'q' || n || '@test.dev'
from generate_series(1, 5) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'quest_' || substr(id::text, 7, 2)
where id::text like '%-9e57-%';
update public.profiles set sharing_consent_at = null where id = '00000005-9e57-0000-0000-000000000000';

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-9e57-0000-0000-000000000000')::uuid
$$;
create function pg_temp.as_user(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(n)::text, true)
$$;

insert into public.groups (id, name, owner_id, invite_code) values
  ('000000a1-9e57-0000-0000-000000000000', 'G', pg_temp.u(1), 'questg01'),
  ('000000a2-9e57-0000-0000-000000000000', 'S', pg_temp.u(1), 'quests01');
insert into public.group_members (group_id, user_id)
select '000000a1-9e57-0000-0000-000000000000'::uuid, pg_temp.u(n) from generate_series(2, 5) n
union all select '000000a2-9e57-0000-0000-000000000000'::uuid, pg_temp.u(5);

-- The goal (QUEST-5)
select is(public.quest_goal(8000, 2), 8000, 'Sprint for 2: 8,000');
select is(public.quest_goal(8000, 4), 9600, 'Sprint for 4: 9,600');
select is(public.quest_goal(8000, 8), 12800, 'Sprint for 8: 12,800');
select is(public.quest_goal(8000, 20), 12800, '...and no more past 8');
select is(public.quest_goal(15000, 5), 19500, 'Patrol for 5: 19,500');

-- A member who isn't the owner starts one: on at once, no vote (QUEST-1, QUEST-2)
set local role authenticated;
select pg_temp.as_user(3);
create temp table started (id uuid);
insert into started select public.propose_quest('000000a1-9e57-0000-0000-000000000000', 'sprint', null);
reset role;
select is((select status from public.quests where id = (select id from started)), 'active',
          'a member (not the owner) starts a quest and it is under way straight away');
select ok((select starts_at <= now() and ends_at = starts_at + interval '2 hours'
           from public.quests where id = (select id from started)), '...from now, for 2 hours');
select is((select party_size from public.quests where id = (select id from started)), 4,
          'the party is the 4 members sharing steps');
select is((select array_agg(user_id order by user_id) from public.quest_party
           where quest_id = (select id from started)),
          array[pg_temp.u(1), pg_temp.u(2), pg_temp.u(3), pg_temp.u(4)],
          '...not the one who doesn''t share');
select is((select goal from public.quests where id = (select id from started)), 9600,
          'the goal is for a party of 4');
select is_empty($$ select 1 from public.quest_votes $$, 'nobody votes');

set local role authenticated;
select pg_temp.as_user(2);
select throws_ok($$ select public.propose_quest('000000a1-9e57-0000-0000-000000000000', 'patrol', null) $$,
                 'QUEST_IN_PROGRESS', 'one quest at a time');
select is((select status from public.my_quests() where quest_id = (select id from started)), 'active',
          'it shows in my quests');
select throws_ok($$ select public.vote_quest((select id from started), true) $$,
                 '42883', null, 'there is no voting any more');

-- A quest for later: under way, but not taking steps until it starts
select pg_temp.as_user(1);
delete from started;
reset role;
update public.quests set status = 'failed', settled_at = now(),
                         ends_at = now() - interval '3 hours', starts_at = now() - interval '5 hours'
where group_id = '000000a1-9e57-0000-0000-000000000000';
set local role authenticated;
insert into started select public.propose_quest('000000a1-9e57-0000-0000-000000000000', 'patrol',
                                                now() + interval '2 hours');
select is((select status from public.quests where id = (select id from started)), 'active',
          'a quest for later is locked in at once');
select throws_ok($$ select public.upload_quest_steps((select id from started), '[]') $$,
                 'QUEST_NOT_OPEN', '...and takes no steps before it starts');
reset role;
select is((select goal from public.quests where id = (select id from started)), 18000,
          'Patrol for 4: 18,000');

-- Two sharing members are needed (QUEST-11)
set local role authenticated;
select throws_ok($$ select public.propose_quest('000000a2-9e57-0000-0000-000000000000', 'sprint', null) $$,
                 'GROUP_TOO_SMALL', 'a group with one member sharing steps can''t start one');

-- The goal helper is internal
reset role;
select ok(not has_function_privilege('authenticated', 'public.quest_goal(integer, integer)', 'execute'),
          'quest_goal can''t be called from the app');

select * from finish();
rollback;
