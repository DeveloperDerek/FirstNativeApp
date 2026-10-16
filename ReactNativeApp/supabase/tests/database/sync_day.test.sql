-- sync_day(): the app's step refresh in one call (upload, quests, coins,
-- goal and streak). Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- U1, U2 share steps and are in group G with a quest under way. U3 doesn't share.
insert into auth.users (id, email)
select ('000000' || lpad(to_hex(n), 2, '0') || '-5d10-0000-0000-000000000000')::uuid,
       'sd' || n || '@test.dev'
from generate_series(1, 3) n;
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(), username = 'sync_' || substr(id::text, 7, 2)
where id::text like '%-5d10-%';
update public.profiles set sharing_consent_at = null where id = '00000003-5d10-0000-0000-000000000000';

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-5d10-0000-0000-000000000000')::uuid
$$;
create function pg_temp.as_user(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.u(n)::text, true)
$$;
create function pg_temp.days(today_steps integer) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('day', current_date, 'steps', today_steps),
    jsonb_build_object('day', current_date - 1, 'steps', 3000))
$$;

insert into public.groups (id, name, owner_id, invite_code) values
  ('000000a1-5d10-0000-0000-000000000000', 'G', pg_temp.u(1), 'syncdy01');
insert into public.group_members (group_id, user_id) values
  ('000000a1-5d10-0000-0000-000000000000', pg_temp.u(2));

set local role authenticated;
select pg_temp.as_user(1);
select public.propose_quest('000000a1-5d10-0000-0000-000000000000', 'sprint', null);

-- Uploading pays for a day over the coin target, once
create temp table r1 as select public.sync_day(current_date, pg_temp.days(20000)) as r;
select is((select steps from public.daily_steps where user_id = pg_temp.u(1) and day = current_date),
          20000, 'today is uploaded');
select is((select steps from public.daily_steps where user_id = pg_temp.u(1) and day = current_date - 1),
          3000, '...and yesterday');
select is((select (r ->> 'earned')::int from r1), 150, 'the day over the coin target pays 150 coins');
select is((select r -> 'goal' from r1), public.my_goal(current_date), 'the goal is my_goal()');
select is((select r -> 'streak' from r1), public.my_streak(current_date), 'the streak is my_streak()');
select is((select (r -> 'streak' ->> 'today_done')::boolean from r1), true,
          '...counting the steps just uploaded');
select is((select r -> 'quests' from r1),
          (select jsonb_agg(to_jsonb(q)) from public.my_quests() q),
          'the quests are my_quests()');
select is((select jsonb_array_length(r -> 'quests') from r1), 1, '...the one under way');

create temp table r2 as select public.sync_day(current_date, pg_temp.days(21000)) as r;
select is((select (r ->> 'earned')::int from r2), 0, 'the same day isn''t paid twice');
select is((select steps from public.daily_steps where user_id = pg_temp.u(1) and day = current_date),
          21000, 'a new reading replaces the old one');

-- Without days: nothing written or claimed, the rest still comes back
create temp table r3 as select public.sync_day(current_date, '[]') as r;
select is((select (r ->> 'earned')::int from r3), 0, 'no days, no claim');
select is((select jsonb_array_length(r -> 'quests') from r3), 1, '...but the quests still come back');

-- Not sharing: no quests, no streak, and an upload is refused as before
select pg_temp.as_user(3);
select is((select public.sync_day(current_date, '[]') -> 'streak'), '{"sharing": false}'::jsonb,
          'not sharing: no streak');
select throws_ok($$ select public.sync_day(current_date, pg_temp.days(20000)) $$, '42501', null,
                 'not sharing: the upload is refused by the row rules');

-- The step-row check still applies
select pg_temp.as_user(2);
select throws_ok($$ select public.sync_day(current_date,
                     jsonb_build_array(jsonb_build_object('day', current_date - 30, 'steps', 5000))) $$,
                 'Day is too old to change', 'days too old are refused');
reset role;

select ok(not has_function_privilege('anon', 'public.sync_day(date, jsonb)', 'execute'),
          'signed-out callers can''t use it');

select * from finish();
rollback;
