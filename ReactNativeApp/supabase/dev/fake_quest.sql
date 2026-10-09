-- DEV ONLY: a group of you and the eight fake players from
-- fake_friends.sql (run that first), with a Sprint quest ready to try.
-- Not a migration: run it by hand in Supabase > SQL Editor. Safe to run
-- again: it replaces the group's quests each time.
--
-- Change `mode` below to pick what you get:
--   'voting' - Priya proposed a Sprint, every fake player has accepted,
--              and it is waiting for you. Accept in the app to start it.
--   'active' - everyone accepted 50 minutes ago and the Sprint is under
--              way, with the fake players' hourly steps already uploaded
--              (about 5,000 of 8,000). Walk, or tap "Send my steps now".
--   'ending' - the Sprint window closed 70 minutes ago with the goal
--              reached, so the next look at the group pays everyone.
--
-- Remove the group with fake_quest_remove.sql.

do $$
declare
  mode  text := 'active';
  me    uuid;
  gid   constant uuid := 'f4ce9999-0000-4000-8000-000000000001';
  qid   uuid;
  start timestamptz;
begin
  select id into me from auth.users where lower(email) = 'derekqho@gmail.com';
  if me is null then
    raise exception 'derekqho@gmail.com has not signed up yet. Sign in once in the app, then run this again.';
  end if;
  if (select count(*) from public.profiles where id::text like 'f4ce000_-%') < 8 then
    raise exception 'Run fake_friends.sql first.';
  end if;
  if not exists (select 1 from public.profiles where id = me and sharing_consent_at is not null) then
    raise notice 'You are not sharing steps yet: you can see the quest but not accept it.';
  end if;

  -- The group, owned by you (the trigger adds you as a member)
  insert into public.groups (id, name, owner_id)
  values (gid, 'Quest Testers', me)
  on conflict (id) do nothing;
  insert into public.group_members (group_id, user_id)
  select gid, p.id from public.profiles p where p.id::text like 'f4ce000_-%'
  on conflict do nothing;

  -- Start over: no quests, so no cooldown either
  delete from public.quests where group_id = gid;

  if mode = 'voting' then
    insert into public.quests (group_id, type_id, proposer_id, start_asap, vote_deadline, goal)
    values (gid, 'sprint', 'f4ce0002-0000-4000-8000-000000000002', true,
            now() + interval '23 hours', 8000)
    returning id into qid;
    -- Every member but you has accepted
    insert into public.quest_votes (quest_id, user_id, accepted)
    select qid, m.user_id, true from public.group_members m
    where m.group_id = gid and m.user_id <> me;

  elsif mode in ('active', 'ending') then
    start := case when mode = 'active' then now() - interval '50 minutes'
                  else now() - interval '3 hours 10 minutes' end;
    insert into public.quests (group_id, type_id, proposer_id, status, start_asap,
                               vote_deadline, starts_at, ends_at, goal, party_size)
    values (gid, 'sprint', 'f4ce0002-0000-4000-8000-000000000002', 'active', true,
            start + interval '24 hours', start, start + interval '2 hours', 8000,
            (select count(*) from public.group_members where group_id = gid))
    returning id into qid;

    insert into public.quest_votes (quest_id, user_id, accepted, voted_at)
    select qid, m.user_id, true, start from public.group_members m where m.group_id = gid;
    insert into public.quest_party (quest_id, user_id)
    select qid, m.user_id from public.group_members m where m.group_id = gid;

    -- Hourly steps for the fake players. Priya carries the party; Ava
    -- has not opened the app yet. 'ending' has both hours, and more.
    insert into public.quest_hours (quest_id, user_id, hour_index, steps)
    select qid, f.id, h, round(f.steps * case when mode = 'ending' then 1.4 else 1 end)::int
    from (values
      ('f4ce0001-0000-4000-8000-000000000001'::uuid,  420),
      ('f4ce0002-0000-4000-8000-000000000002',       1950),
      ('f4ce0003-0000-4000-8000-000000000003',        310),
      ('f4ce0004-0000-4000-8000-000000000004',        880),
      ('f4ce0005-0000-4000-8000-000000000005',        560),
      ('f4ce0006-0000-4000-8000-000000000006',        120),
      ('f4ce0007-0000-4000-8000-000000000007',        760)
    ) as f(id, steps)
    cross join generate_series(0, case when mode = 'ending' then 1 else 0 end) as h;

    update public.quest_party p
    set steps = s.total, uploaded_at = now() - interval '10 minutes'
    from (select user_id, sum(steps)::int as total from public.quest_hours
          where quest_id = qid group by user_id) s
    where p.quest_id = qid and p.user_id = s.user_id;

    update public.quests q
    set total_steps = (select coalesce(sum(steps), 0) from public.quest_party where quest_id = qid)
    where q.id = qid;
    update public.quests q
    set status = 'completed', completed_at = q.starts_at + interval '100 minutes'
    where q.id = qid and q.total_steps >= q.goal;

  else
    raise exception 'mode must be voting, active or ending';
  end if;

  raise notice 'Quest Testers: % Sprint ready (quest %)', mode, qid;
end;
$$;
