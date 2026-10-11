-- StepTracker: your own daily goal, and streaks
-- (step-tracker-goals-streaks.txt).
--
-- Daily coins stay at 10,000 steps for everyone (decision 2). The goal
-- drives Today, History and streaks; streak bonuses (7 and 30 days)
-- follow the goal, not the 10,000-step coins. The shared step track and
-- group quests are unchanged, and so is the suspicious-steps view.

-- =====================================================================
-- DAYS
-- =====================================================================
-- INTERNAL. Is this a date that is "today" somewhere on Earth at p_now
-- (between the UTC-12 and UTC+14 dates)? The same check the leaderboards
-- use (step_period_at); takes the clock so tests can fix it.
create function public.is_today_somewhere(p_day date, p_now timestamptz)
returns boolean language sql immutable set search_path = ''
as $$
  select p_day is not null
     and p_day between (p_now at time zone 'Etc/GMT+12')::date   -- UTC-12
                   and (p_now at time zone 'Etc/GMT-14')::date   -- UTC+14
$$;

-- =====================================================================
-- PART A - YOUR OWN DAILY GOAL
-- =====================================================================
-- Every change is kept: which goal, from which day, chosen when. The goal
-- for a day is the latest change starting on or before it; two changes
-- for the same day are told apart by when they were chosen (the later
-- wins). Never changed: 10,000.
create table public.daily_goal_changes (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  starts_on date not null,
  goal      integer not null check (goal between 3000 and 25000 and goal % 500 = 0),
  chosen_at timestamptz not null default now()
);
create index daily_goal_changes_lookup_idx
  on public.daily_goal_changes (user_id, starts_on desc, chosen_at desc, id desc);

alter table public.daily_goal_changes enable row level security;
create policy "goal changes read own" on public.daily_goal_changes
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.daily_goal_changes from anon, authenticated;

-- INTERNAL. The goal that applied to a day
create function public.goal_on(p_user uuid, p_day date)
returns integer language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select c.goal from public.daily_goal_changes c
    where c.user_id = p_user and c.starts_on <= p_day
    order by c.starts_on desc, c.chosen_at desc, c.id desc
    limit 1), 10000)
$$;

-- INTERNAL, with the clock as an argument for tests. A new goal starts the
-- day after the phone's date (decision 14), which must be "today"
-- somewhere on Earth. A phone sending an earlier, still-valid date can
-- make a lower goal apply to a day already under way; that is accepted,
-- because it can never earn more than a 3,000 goal set openly (see the
-- blueprint, "What a tampered phone can do").
create function public.set_daily_goal_at(p_goal integer, my_today date, p_now timestamptz)
returns date language plpgsql security definer set search_path = ''
as $$
declare starts date;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if p_goal is null or p_goal not between 3000 and 25000 or p_goal % 500 <> 0 then
    raise exception 'BAD_GOAL';
  end if;
  if not public.is_today_somewhere(my_today, p_now) then raise exception 'BAD_DAY'; end if;
  starts := my_today + 1;
  insert into public.daily_goal_changes (user_id, starts_on, goal, chosen_at)
  values (auth.uid(), starts, p_goal, p_now);
  return starts;
end;
$$;

-- Profile > Daily goal. Returns the day the new goal starts.
create function public.set_daily_goal(p_goal integer, my_today date)
returns date language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  return public.set_daily_goal_at(p_goal, my_today, now());
end;
$$;

-- Your goal for today, a change waiting to start, and the last 7 days'
-- goals (for History)
create function public.my_goal(my_today date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  return jsonb_build_object(
    'today', public.goal_on(uid, my_today),
    'upcoming', (select jsonb_build_object('goal', c.goal, 'starts_on', c.starts_on)
                 from public.daily_goal_changes c
                 where c.user_id = uid and c.starts_on > my_today
                 order by c.starts_on desc, c.chosen_at desc, c.id desc
                 limit 1),
    'recent', (select jsonb_agg(jsonb_build_object('day', d::date,
                                                   'goal', public.goal_on(uid, d::date))
                                order by d)
               from generate_series(my_today - 6, my_today, '1 day') d));
end;
$$;

-- =====================================================================
-- PART B - STREAKS
-- =====================================================================
-- Worked out from the uploaded days and the goal history every time
-- they're asked; never stored, so late uploads simply count.

-- INTERNAL. Runs of days in a row at the goal of each day
create function public.goal_runs(p_user uuid, p_until date default null)
returns table (run_start date, run_end date, days integer)
language sql stable security definer set search_path = ''
as $$
  with hit as (
    select s.day
    from public.daily_steps s
    where s.user_id = p_user
      and (p_until is null or s.day <= p_until)
      and s.steps >= public.goal_on(p_user, s.day)
  ),
  grouped as (
    select h.day, h.day - (row_number() over (order by h.day))::integer as grp from hit h
  )
  select min(g.day), max(g.day), count(*)::integer from grouped g group by g.grp
$$;

-- INTERNAL. A person's streak as of their today: current (a run ending
-- today, or yesterday while today isn't reached yet), best, whether today
-- is done, and today's goal and uploaded steps.
create function public.streak_info(p_user uuid, p_today date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with runs as (select * from public.goal_runs(p_user, p_today))
  select jsonb_build_object(
    'current', coalesce((select r.days from runs r where r.run_end >= p_today - 1
                         order by r.run_end desc limit 1), 0),
    'best', coalesce((select max(r.days) from runs r), 0),
    'today_done', exists (select 1 from runs r where r.run_end = p_today),
    'goal_today', public.goal_on(p_user, p_today),
    'steps_today', coalesce((select s.steps from public.daily_steps s
                             where s.user_id = p_user and s.day = p_today), 0))
$$;

-- Your streak, for Today and Profile. Needs step sharing, like coins.
create function public.my_streak(my_today date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  if not public.has_sharing_consent() then
    return jsonb_build_object('sharing', false);
  end if;
  return public.streak_info(uid, my_today) || jsonb_build_object('sharing', true);
end;
$$;

-- A friend's current streak, for the player card outside a group (inside
-- one, group_member_card has it). Null when they don't share steps.
create function public.player_streak(person uuid, my_today date)
returns integer language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  if person is null
     or not (person = auth.uid() or (public.is_friend(person) and public.can_see(person))) then
    return null;
  end if;
  if not exists (select 1 from public.profiles p
                 where p.id = person and p.sharing_consent_at is not null) then
    return null;
  end if;
  return (public.streak_info(person, my_today)->>'current')::integer;
end;
$$;

-- =====================================================================
-- STREAK BONUSES, IN THE DAILY COINS STEP
-- =====================================================================
-- Bonuses for milestones reached on or after this day only (decision 8):
-- launching never pays for runs that were already long. Stored as
-- YYYYMMDD; the day this migration runs.
insert into public.app_settings (key, value)
values ('streak_bonus_from', to_char(current_date, 'YYYYMMDD')::integer);

create function public.streak_bonus_from()
returns date language sql stable security definer set search_path = ''
as $$
  select to_date((select s.value from public.app_settings s
                  where s.key = 'streak_bonus_from')::text, 'YYYYMMDD')
$$;

-- As in 20261023000000_register.sql (daily coins unchanged: 10,000 steps),
-- plus the per-person lock and the streak bonuses.
--
-- One claim at a time per person: the lock is taken first, then the days
-- are read fresh, so two phones claiming at once go in turn and the
-- second sees both uploads. The coin history's once-only rule is a second
-- layer.
--
-- Bonuses (decisions 6, 8, 9, 10): 200 coins when a run of days at the
-- goal reaches 7, 1,000 when it reaches 30. Recorded with the day the run
-- reached it. Not paid if that day is before the launch day, or if this
-- run of days already has that milestone paid anywhere inside it (so a
-- late upload joining runs never pays again). Already paid bonuses are
-- never taken back.
create or replace function public.claim_daily_rewards()
returns integer                    -- coins granted by this call
language plpgsql security definer set search_path = ''
as $$
declare
  uid         uuid := auth.uid();
  goal        constant integer := 10000;   -- steps needed for daily coins
  reward      constant integer := 100;     -- coins per day
  window_days constant integer := 7;       -- how far back to pay
  daily       integer;
  bonus       integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  perform pg_advisory_xact_lock(hashtextextended('coins:' || uid::text, 0));

  with paid as (
    insert into public.coin_transactions (user_id, amount, reason, ref)
    select uid, reward, 'daily_goal', s.day::text
    from public.daily_steps s
    where s.user_id = uid
      and s.steps >= goal
      and s.day >= current_date - window_days
      and s.day <= current_date + 1        -- no future days
    on conflict (user_id, reason, ref) do nothing
    returning amount
  )
  select coalesce(sum(amount), 0) into daily from paid;

  with milestones (len, coins) as (values (7, 200), (30, 1000)),
  due as (
    select m.len, m.coins, (r.run_start + (m.len - 1)) as reached, r.run_start, r.run_end
    from public.goal_runs(uid) r
    join milestones m on r.days >= m.len
  ),
  paid as (
    insert into public.coin_transactions (user_id, amount, reason, ref)
    select uid, d.coins, 'streak_' || d.len, d.reached::text
    from due d
    where d.reached >= public.streak_bonus_from()
      -- "YYYY-MM-DD" sorts as text in date order, so this needs no cast
      and not exists (select 1 from public.coin_transactions t
                      where t.user_id = uid and t.reason = 'streak_' || d.len
                        and t.ref between d.run_start::text and d.run_end::text)
    on conflict (user_id, reason, ref) do nothing
    returning amount
  )
  select coalesce(sum(amount), 0) into bonus from paid;

  if daily + bonus > 0 then
    insert into public.wallets (user_id, balance)
    values (uid, daily + bonus)
    on conflict (user_id)
    do update set balance = public.wallets.balance + excluded.balance;
  end if;

  return daily + bonus;
end;
$$;

-- =====================================================================
-- THE PLAYER CARD IN A GROUP: plus the streak
-- =====================================================================
-- As in 20261104000000_blocking.sql, plus 'streak' (null when they don't
-- share steps).
create or replace function public.group_member_card(gid uuid, person uuid, my_today date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  d record;
  p public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_group_member(gid) then raise exception 'NOT_A_MEMBER'; end if;
  if not exists (select 1 from public.group_members m
                 where m.group_id = gid and m.user_id = person)
     or not public.is_active_user(person) then
    raise exception 'NOT_A_MEMBER';
  end if;
  select * into d from public.step_period('week', my_today);
  select * into p from public.profiles where id = person;

  return jsonb_build_object(
    'user_id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar', p.avatar,
    'map_theme', p.map_theme,
    'today_steps', (select coalesce(sum(s.steps), 0) from public.daily_steps s
                    where s.user_id = person and s.day = d.to_day),
    'week_steps', (select coalesce(sum(s.steps), 0) from public.daily_steps s
                   where s.user_id = person and s.day between d.from_day and d.to_day),
    'last_seen', (select l.seen_at from public.last_seen l where l.user_id = person),
    'blocked_by_me', exists (select 1 from public.user_blocks b
                             where b.blocker_id = auth.uid() and b.blocked_id = person),
    'streak', case when p.sharing_consent_at is not null
                   then (public.streak_info(person, d.to_day)->>'current')::integer end);
end;
$$;

-- =====================================================================
-- PERMISSIONS
-- =====================================================================
revoke all on function public.is_today_somewhere(date, timestamptz) from public, anon, authenticated;
revoke all on function public.goal_on(uuid, date) from public, anon, authenticated;
revoke all on function public.set_daily_goal_at(integer, date, timestamptz) from public, anon, authenticated;
revoke all on function public.goal_runs(uuid, date) from public, anon, authenticated;
revoke all on function public.streak_info(uuid, date) from public, anon, authenticated;
revoke all on function public.streak_bonus_from() from public, anon, authenticated;

revoke all on function public.set_daily_goal(integer, date) from public, anon;
revoke all on function public.my_goal(date) from public, anon;
revoke all on function public.my_streak(date) from public, anon;
revoke all on function public.player_streak(uuid, date) from public, anon;
grant execute on function public.set_daily_goal(integer, date) to authenticated;
grant execute on function public.my_goal(date) to authenticated;
grant execute on function public.my_streak(date) to authenticated;
grant execute on function public.player_streak(uuid, date) to authenticated;
