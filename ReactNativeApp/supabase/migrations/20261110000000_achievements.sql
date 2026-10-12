-- StepTracker: achievements and the items they unlock
-- (step-tracker-achievements.txt).
--
-- One-time awards for milestones, worked out on the server from the days,
-- goals and quests it already keeps. Earned once and kept for good, with
-- the day the milestone was first reached. Four of them unlock an item
-- that can't be bought. No coins.

-- =====================================================================
-- TABLES
-- =====================================================================
-- The list. Names and descriptions live in the app; the server knows only
-- the kind and the threshold. Readable by the app, never writable.
create table public.achievements (
  id         text primary key,
  kind       text not null check (kind in ('day_steps', 'total_steps', 'streak', 'quests')),
  threshold  integer not null check (threshold > 0),
  sort_order integer not null
);

alter table public.achievements enable row level security;
create policy "achievements read" on public.achievements
  for select to authenticated using (true);
revoke insert, update, delete, truncate on public.achievements from anon, authenticated;

insert into public.achievements (id, kind, threshold, sort_order) values
  ('first_10k',  'day_steps',     10000,  1),
  ('big_day',    'day_steps',     20000,  2),
  ('huge_day',   'day_steps',     30000,  3),
  ('steps_100k', 'total_steps',  100000,  4),
  ('steps_1m',   'total_steps', 1000000,  5),
  ('steps_5m',   'total_steps', 5000000,  6),
  ('streak_7',   'streak',            7,  7),
  ('streak_30',  'streak',           30,  8),
  ('streak_100', 'streak',          100,  9),
  ('quest_1',    'quests',            1, 10),
  ('quest_10',   'quests',           10, 11);

-- Who earned what, and when. earned_on is the day the milestone was first
-- reached (never the day the server noticed); seen_at is empty until the
-- app has shown the message; at_launch marks the ones the launch check
-- gave, so the app can show them as one summary.
-- Row level security with NO policies: the app reads it only through the
-- functions below.
create table public.user_achievements (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  achievement_id text not null references public.achievements(id),
  earned_on      date not null,
  earned_at      timestamptz not null default now(),
  seen_at        timestamptz,
  at_launch      boolean not null default false,
  primary key (user_id, achievement_id)
);

alter table public.user_achievements enable row level security;
revoke all on public.user_achievements from anon, authenticated;

-- =====================================================================
-- REWARD ITEMS
-- =====================================================================
-- An item with unlocked_by set is never sold: it has no price, is never
-- active (so the daily shop skips it and purchase_item refuses it with
-- ITEM_NOT_FOR_SALE), and comes only with its achievement. Turning one
-- into a shop item takes a migration that clears unlocked_by first.
alter table public.shop_items
  add column unlocked_by text references public.achievements(id);
alter table public.shop_items alter column price drop not null;
alter table public.shop_items drop constraint shop_items_price_check;
alter table public.shop_items add constraint shop_items_sold_or_earned check (
  (unlocked_by is null and price is not null and price > 0)
  or (unlocked_by is not null and price is null and not active));

-- In one statement each, so none ever exists in a state where it could be
-- sold. Admins get them through their existing grant (on_shop_item_added).
insert into public.shop_items (id, price, active, unlocked_by) values
  ('shoes_winged', null, false, 'steps_1m'),
  ('cape_ember',   null, false, 'streak_30'),
  ('hat_laurel',   null, false, 'streak_100'),
  ('pet_mimic',    null, false, 'quest_1');

-- =====================================================================
-- WORKING THEM OUT
-- =====================================================================
-- INTERNAL. Every achievement's measure for a person, from the records as
-- they are now, and the day it first reached the threshold (null if it
-- hasn't):
--   day_steps    the highest uploaded day; the first day at or over it
--   total_steps  all uploaded days added up oldest first; the first day
--                the running total reached it
--   streak       the longest run at each day's own goal (goal_runs); the
--                day a run first reached it
--   quests       completed quests you were in the party of, each once;
--                the day (shop time zone, like the quest coin cap) the
--                one that reached it was completed
create function public.achievement_measures(p_user uuid)
returns table (achievement_id text, progress bigint, reached_on date)
language sql stable security definer set search_path = ''
as $$
  with days as (
    select s.day, s.steps, sum(s.steps) over (order by s.day) as running
    from public.daily_steps s
    where s.user_id = p_user
  ),
  runs as (select * from public.goal_runs(p_user)),
  won as (
    select (coalesce(q.completed_at, q.ends_at) at time zone 'America/Los_Angeles')::date as day,
           row_number() over (order by coalesce(q.completed_at, q.ends_at), q.id) as n
    from public.quests q
    join public.quest_party p on p.quest_id = q.id
    where p.user_id = p_user and q.status = 'completed'
  )
  select a.id,
    case a.kind
      when 'day_steps'   then (select coalesce(max(d.steps), 0) from days d)
      when 'total_steps' then (select coalesce(sum(d.steps), 0) from days d)
      when 'streak'      then (select coalesce(max(r.days), 0) from runs r)
      when 'quests'      then (select count(*) from won)
    end::bigint,
    case a.kind
      when 'day_steps'   then (select min(d.day) from days d where d.steps >= a.threshold)
      when 'total_steps' then (select min(d.day) from days d where d.running >= a.threshold)
      when 'streak'      then (select min(r.run_start + (a.threshold - 1)) from runs r
                               where r.days >= a.threshold)
      when 'quests'      then (select w.day from won w where w.n = a.threshold)
    end
  from public.achievements a
$$;

-- INTERNAL. Records every achievement a person has newly reached, and
-- gives every reward item whose achievement they have (earned now or long
-- ago) and don't own yet, at 0 coins in the coin history. Safe to run any
-- number of times, and at the same moment from two places: every insert
-- skips what's already there, and the per-person lock claim_daily_rewards
-- uses makes two calls go in turn. Earned stays earned: nothing here ever
-- deletes or redates a row. New achievements need step sharing; items
-- for achievements already earned are topped up either way.
-- p_at_launch is for the launch check only (below).
create function public.award_achievements(p_user uuid, p_at_launch boolean default false)
returns integer                           -- achievements newly earned
language plpgsql security definer set search_path = ''
as $$
declare added integer := 0;
begin
  if not p_at_launch then
    perform pg_advisory_xact_lock(hashtextextended('coins:' || p_user::text, 0));
  end if;

  if exists (select 1 from public.profiles p
             where p.id = p_user and p.sharing_consent_at is not null) then
    insert into public.user_achievements (user_id, achievement_id, earned_on, at_launch)
    select p_user, m.achievement_id, m.reached_on, p_at_launch
    from public.achievement_measures(p_user) m
    where m.reached_on is not null
    on conflict (user_id, achievement_id) do nothing;
    get diagnostics added = row_count;
  end if;

  with granted as (
    insert into public.user_items (user_id, item_id)
    select p_user, s.id
    from public.shop_items s
    join public.user_achievements a
      on a.user_id = p_user and a.achievement_id = s.unlocked_by
    on conflict do nothing
    returning item_id
  )
  insert into public.coin_transactions (user_id, amount, reason, ref)
  select p_user, 0, 'achievement', g.item_id from granted g
  on conflict (user_id, reason, ref) do nothing;

  return added;
end;
$$;

-- INTERNAL. A person's earned achievements, newest first: ids and days
create function public.earned_achievements(p_user uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.achievement_id, 'earned_on', u.earned_on)
                            order by u.earned_on desc, a.sort_order desc), '[]'::jsonb)
  from public.user_achievements u
  join public.achievements a on a.id = u.achievement_id
  where u.user_id = p_user
$$;

-- =====================================================================
-- WHEN THEY'RE CHECKED
-- =====================================================================
-- After each upload: as in 20261108000000_goals_streaks.sql, plus the
-- achievements at the end, under the same lock, counted from the days
-- just uploaded. Still returns only the coins, so older app builds keep
-- working; new achievements come from new_achievements().
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

  perform public.award_achievements(uid);

  return daily + bonus;
end;
$$;

-- A quest won: everyone in its party, the moment it's completed (in
-- upload_quest_steps), not after the grace period. The party in id order,
-- so two quests finishing at once take the per-person locks in the same
-- order and can't deadlock.
create function public.on_quest_completed()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare member uuid;
begin
  for member in
    select p.user_id from public.quest_party p where p.quest_id = new.id order by p.user_id
  loop
    perform public.award_achievements(member);
  end loop;
  return new;
end;
$$;

create trigger quest_completed_achievements
  after update of status on public.quests
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.on_quest_completed();

-- =====================================================================
-- READING THEM
-- =====================================================================
-- Yours: what you've earned, and while you share steps, how far along the
-- rest are ("640,000 of 1,000,000"). Progress follows the records as they
-- are now, so deleting days lowers it; what's earned stays.
create function public.my_achievements()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  sharing boolean;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  sharing := public.has_sharing_consent();
  return jsonb_build_object(
    'sharing', sharing,
    'earned', public.earned_achievements(uid),
    'progress', case when sharing then (
      select coalesce(jsonb_agg(jsonb_build_object('id', m.achievement_id,
                                                   'value', m.progress,
                                                   'threshold', a.threshold)
                                order by a.sort_order), '[]'::jsonb)
      from public.achievement_measures(uid) m
      join public.achievements a on a.id = m.achievement_id
      where not exists (select 1 from public.user_achievements u
                        where u.user_id = uid and u.achievement_id = m.achievement_id))
    else '[]'::jsonb end);
end;
$$;

-- Yours not shown yet, oldest first, each with the item it unlocked
create function public.new_achievements()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', u.achievement_id,
             'earned_on', u.earned_on,
             'at_launch', u.at_launch,
             'item', (select s.id from public.shop_items s where s.unlocked_by = u.achievement_id
                      order by s.id limit 1))
           order by u.earned_on, a.sort_order), '[]'::jsonb)
    from public.user_achievements u
    join public.achievements a on a.id = u.achievement_id
    where u.user_id = uid and u.seen_at is null);
end;
$$;

-- The app has shown these: marks YOUR rows with these ids as seen. Ids
-- that aren't yours, or are seen already, are ignored. Safe to repeat.
create function public.mark_achievements_seen(ids text[])
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  update public.user_achievements
  set seen_at = now()
  where user_id = auth.uid() and achievement_id = any(ids) and seen_at is null;
end;
$$;

-- Someone's earned achievements for their player card outside a group
-- (inside one, group_member_card has them): ids and days, nothing else.
-- The same rules as player_streak: yourself, or a friend you can see;
-- null for anyone else, without saying why.
create function public.player_achievements(person uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if person is null
     or not (person = auth.uid() or (public.is_friend(person) and public.can_see(person))) then
    return null;
  end if;
  return public.earned_achievements(person);
end;
$$;

-- As in 20261108000000_goals_streaks.sql, plus 'achievements'
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
                   then (public.streak_info(person, d.to_day)->>'current')::integer end,
    'achievements', public.earned_achievements(person));
end;
$$;

-- =====================================================================
-- PERMISSIONS
-- =====================================================================
revoke all on function public.achievement_measures(uuid) from public, anon, authenticated;
revoke all on function public.award_achievements(uuid, boolean) from public, anon, authenticated;
revoke all on function public.earned_achievements(uuid) from public, anon, authenticated;
revoke all on function public.on_quest_completed() from public, anon, authenticated;

revoke all on function public.my_achievements() from public, anon;
revoke all on function public.new_achievements() from public, anon;
revoke all on function public.mark_achievements_seen(text[]) from public, anon;
revoke all on function public.player_achievements(uuid) from public, anon;
grant execute on function public.my_achievements() to authenticated;
grant execute on function public.new_achievements() to authenticated;
grant execute on function public.mark_achievements_seen(text[]) to authenticated;
grant execute on function public.player_achievements(uuid) to authenticated;

-- =====================================================================
-- THE LAUNCH CHECK
-- =====================================================================
-- Everyone who shares steps starts with what they've already earned, with
-- the real days from their records (and the reward items that come with
-- them). Part of this migration's transaction, so a failure part way
-- leaves nothing; and because award_achievements only adds what's
-- missing, running it again by hand after any partial run ends the same
-- as one full run. Without the per-person lock, so a big launch doesn't
-- hold one lock per person until the end: the skip-what's-there inserts
-- alone keep a claim running at the same moment from adding anything
-- twice.
select public.award_achievements(p.id, true)
from public.profiles p
where p.sharing_consent_at is not null;
