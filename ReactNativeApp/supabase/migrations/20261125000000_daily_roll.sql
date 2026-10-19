-- StepTracker: the daily roll (step-tracker-daily-roll.txt). Reaching the
-- day's goal gives one free roll of a prize machine instead of the 150
-- daily coins: a shop item the player doesn't own (rarer is less likely)
-- or 100, 250 or 500 coins.
--
-- Off until 'daily_roll_from' is set in app_settings (days since
-- 2000-01-01, like 'goal_is_coin_target_from'). It is set only once a
-- build with the roll screen is out (ROLL-5); until then everything
-- works as before.

-- =====================================================================
-- THE SWITCH DAY
-- =====================================================================
-- INTERNAL. The first day with a roll, or null while the roll is off
create function public.daily_roll_from()
returns date language sql stable security definer set search_path = ''
as $$
  select date '2000-01-01' + (select s.value from public.app_settings s
                              where s.key = 'daily_roll_from')
$$;
revoke all on function public.daily_roll_from() from public, anon, authenticated;

-- =====================================================================
-- daily_rolls: one roll per player per goal day
-- =====================================================================
create table public.daily_rolls (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  day       date not null,
  item_id   text references public.shop_items(id),   -- null for a coins roll
  coins     integer not null,                         -- 0 for an item
  rarity    text not null,
  rolled_at timestamptz not null default now(),
  seen_at   timestamptz,                              -- null until the result was shown
  primary key (user_id, day),
  check (rarity in ('coins', 'common', 'uncommon', 'rare', 'epic', 'legendary')),
  check ((rarity = 'coins') = (item_id is null)),
  check (case when rarity = 'coins' then coins in (100, 250, 500) else coins = 0 end)
);

-- Read your own rows; only the functions below write
alter table public.daily_rolls enable row level security;
create policy "rolls read own" on public.daily_rolls
  for select to authenticated using (user_id = auth.uid());

-- =====================================================================
-- THE CHANCES (section 3)
-- =====================================================================
-- INTERNAL. An item's rarity, from its price (the COIN-5 ladder, ROLL-7)
create function public.roll_rarity(p_price integer)
returns text language sql immutable set search_path = ''
as $$
  select case
    when p_price < 500  then 'common'
    when p_price < 800  then 'uncommon'
    when p_price < 1500 then 'rare'
    when p_price < 2500 then 'epic'
    else 'legendary'
  end
$$;

-- INTERNAL. The outcome for a random number r in [0, 1), given the
-- rarities that still have an item for the player (ROLL-6). Coins are 40%
-- while any item is left; a rarity with nothing left is skipped and its
-- share goes to the others in proportion. Nothing left: always coins.
create function public.roll_outcome(p_rarities text[], p_r double precision)
returns text language plpgsql immutable set search_path = ''
as $$
declare
  ladder constant text[] := array['common', 'uncommon', 'rare', 'epic', 'legendary'];
  weight constant integer[] := array[31, 19, 6, 3, 1];
  total integer := 0;
  pick double precision;
  i integer;
begin
  for i in 1 .. 5 loop
    if ladder[i] = any(p_rarities) then total := total + weight[i]; end if;
  end loop;
  if total = 0 or p_r < 0.4 then return 'coins'; end if;

  pick := (p_r - 0.4) / 0.6 * total;
  for i in 1 .. 5 loop
    if ladder[i] = any(p_rarities) then
      if pick < weight[i] then return ladder[i]; end if;
      pick := pick - weight[i];
    end if;
  end loop;
  -- r a hair under 1 can round past the last one
  return (select l from unnest(ladder) with ordinality u(l, n)
          where l = any(p_rarities) order by n desc limit 1);
end;
$$;

-- INTERNAL. A coins roll's amount for r in [0, 1): 100 (6 in 10), 250
-- (3 in 10), 500 (1 in 10) (ROLL-16)
create function public.roll_coin_amount(p_r double precision)
returns integer language sql immutable set search_path = ''
as $$
  select case when p_r < 0.6 then 100 when p_r < 0.9 then 250 else 500 end
$$;

revoke all on function public.roll_rarity(integer) from public, anon, authenticated;
revoke all on function public.roll_outcome(text[], double precision) from public, anon, authenticated;
revoke all on function public.roll_coin_amount(double precision) from public, anon, authenticated;

-- =====================================================================
-- THE ROLL (section 4)
-- =====================================================================
-- Decides and saves the prize for my_today. Calling it again for a day
-- already rolled returns the same prize with new = false, so two taps,
-- a retry or two phones all get one roll (ROLL-13).
create function public.roll_daily_prize(my_today date)
returns table (item_id text, rarity text, coins integer, new boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  outcome text;
  won     text;
  amount  integer := 0;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then raise exception 'NO_SHARING'; end if;
  if my_today is null or not public.is_today_somewhere(my_today, now()) then
    raise exception 'BAD_DAY';
  end if;
  if public.daily_roll_from() is null or my_today < public.daily_roll_from() then
    raise exception 'ROLL_OFF';
  end if;
  if not exists (select 1 from public.coin_transactions c
                 where c.user_id = uid and c.reason = 'daily_goal'
                   and c.ref = to_char(my_today, 'YYYY-MM-DD')) then
    raise exception 'GOAL_NOT_REACHED';
  end if;

  -- The coin lock (claim_daily_rewards), then the wallet row (purchase_item),
  -- so a roll and a purchase can't both take the last item
  perform pg_advisory_xact_lock(hashtextextended('coins:' || uid::text, 0));
  insert into public.wallets (user_id) values (uid) on conflict (user_id) do nothing;
  perform 1 from public.wallets w where w.user_id = uid for update;

  if exists (select 1 from public.daily_rolls r where r.user_id = uid and r.day = my_today) then
    return query select r.item_id, r.rarity, r.coins, false
                 from public.daily_rolls r where r.user_id = uid and r.day = my_today;
    return;
  end if;

  -- The rarity first, from the rarities with an item left in the pool
  -- (on sale, not an achievement item, not owned), then one of its items
  outcome := public.roll_outcome(array(
    select distinct public.roll_rarity(s.price)
    from public.shop_items s
    where s.active and s.unlocked_by is null and s.price is not null
      and not exists (select 1 from public.user_items u where u.user_id = uid and u.item_id = s.id)
  ), random());

  if outcome = 'coins' then
    amount := public.roll_coin_amount(random());
  else
    select s.id into won
    from public.shop_items s
    where s.active and s.unlocked_by is null and s.price is not null
      and not exists (select 1 from public.user_items u where u.user_id = uid and u.item_id = s.id)
      and public.roll_rarity(s.price) = outcome
    order by random() limit 1;
    insert into public.user_items (user_id, item_id) values (uid, won);
  end if;

  insert into public.daily_rolls (user_id, day, item_id, coins, rarity)
  values (uid, my_today, won, amount, outcome);
  -- Its line in the coin history: 0 for an item, like a starter item
  insert into public.coin_transactions (user_id, amount, reason, ref)
  values (uid, amount, 'roll', to_char(my_today, 'YYYY-MM-DD'));
  if amount > 0 then
    update public.wallets w set balance = w.balance + amount where w.user_id = uid;
  end if;

  perform public.award_achievements(uid);

  return query select won, outcome, amount, true;
end;
$$;

-- The roll screen calls this once the prize card has shown
create function public.mark_roll_seen(my_today date)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  update public.daily_rolls r set seen_at = now()
  where r.user_id = auth.uid() and r.day = my_today and r.seen_at is null;
end;
$$;

-- The roll for my_today, for sync_day (which runs as the caller):
--   null                                        the roll is off, not sharing, or not active
--   {"state": "locked"}                         goal not reached yet
--   {"state": "ready"}                          goal reached, not rolled
--   {"state": "rolled", item_id, rarity, coins, seen}
create function public.my_roll(my_today date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case
    when public.daily_roll_from() is null or my_today < public.daily_roll_from()
         or not public.is_active_account() or not public.has_sharing_consent() then null
    when r.user_id is not null then jsonb_build_object(
      'state', 'rolled', 'item_id', r.item_id, 'rarity', r.rarity,
      'coins', r.coins, 'seen', r.seen_at is not null)
    when exists (select 1 from public.coin_transactions c
                 where c.user_id = auth.uid() and c.reason = 'daily_goal'
                   and c.ref = to_char(my_today, 'YYYY-MM-DD')) then '{"state": "ready"}'::jsonb
    else '{"state": "locked"}'::jsonb
  end
  from (select 1) one
  left join public.daily_rolls r on r.user_id = auth.uid() and r.day = my_today
$$;
revoke all on function public.my_roll(date) from public, anon, authenticated;
grant execute on function public.my_roll(date) to authenticated;

-- =====================================================================
-- THE DAILY COINS STOP AT THE SWITCH DAY (section 7)
-- =====================================================================
-- As in 20261115000000_coin_rebalance.sql, except that from the switch
-- day a goal day pays 0: the 'daily_goal' row is still written, because
-- the activity board and kudos use it to mark a goal day.
create or replace function public.claim_daily_rewards()
returns integer                    -- coins granted by this call
language plpgsql security definer set search_path = ''
as $$
declare
  uid         uuid := auth.uid();
  reward      constant integer := 150;     -- coins per day, before the roll
  window_days constant integer := 7;       -- how far back to pay
  roll_from   date := public.daily_roll_from();
  daily       integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  perform pg_advisory_xact_lock(hashtextextended('coins:' || uid::text, 0));

  with paid as (
    insert into public.coin_transactions (user_id, amount, reason, ref)
    select uid, case when roll_from is not null and s.day >= roll_from then 0 else reward end,
           'daily_goal', s.day::text
    from public.daily_steps s
    where s.user_id = uid
      and s.steps >= public.coin_steps_on(uid, s.day)
      and s.day >= current_date - window_days
      and s.day <= current_date + 1        -- no future days
    on conflict (user_id, reason, ref) do nothing
    returning amount
  )
  select coalesce(sum(amount), 0) into daily from paid;

  if daily > 0 then
    insert into public.wallets (user_id, balance)
    values (uid, daily)
    on conflict (user_id)
    do update set balance = public.wallets.balance + excluded.balance;
  end if;

  perform public.award_achievements(uid);

  return daily;
end;
$$;

-- =====================================================================
-- sync_day: one more key, 'roll' (section 7)
-- =====================================================================
-- As in 20261114000000_sync_day.sql, plus the roll for my_today. Older
-- builds ignore the extra key.
create or replace function public.sync_day(my_today date, p_days jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  uploading boolean := jsonb_array_length(coalesce(p_days, '[]')) > 0;
  earned    integer := 0;
  quests    jsonb := '[]';
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  if uploading then
    insert into public.daily_steps (user_id, day, steps)
    select auth.uid(), (d ->> 'day')::date, (d ->> 'steps')::integer
    from jsonb_array_elements(p_days) d
    on conflict (user_id, day) do update set steps = excluded.steps;
  end if;

  if public.has_sharing_consent() then
    select coalesce(jsonb_agg(to_jsonb(q) - 'ordinality' order by q.ordinality), '[]') into quests
    from public.my_quests() with ordinality q;   -- newest first, as my_quests() gives them
  end if;

  if uploading then
    earned := public.claim_daily_rewards();
  end if;

  return jsonb_build_object(
    'earned', earned,
    'quests', quests,
    'goal',   public.my_goal(my_today),
    'streak', public.my_streak(my_today),
    'roll',   public.my_roll(my_today));
end;
$$;

-- =====================================================================
-- THE ACTIVITY BOARD (ROLL-11)
-- =====================================================================
-- As in 20261124000000_activity_separate_lines.sql, except that a goal
-- line's time is its roll's when the roll came later, so taking the roll
-- moves the line up, as a later achievement does.
create or replace function public.activity_parts(p_users uuid[], p_from date, p_to date)
returns table (user_id uuid, day date, kind text, ref text, at timestamptz, amount integer)
language sql stable security definer set search_path = ''
as $$
  with switch as (
    select date '2000-01-01' + (select s.value from public.app_settings s
                                where s.key = 'goal_is_coin_target_from') as day
  )
  -- ref is compared as text and only cast behind the reason check, since
  -- other reasons' refs are item ids
  select c.user_id, c.ref::date, 'goal', '',
         greatest(c.created_at, (select r.rolled_at from public.daily_rolls r
                                 where r.user_id = c.user_id
                                   and to_char(r.day, 'YYYY-MM-DD') = c.ref)),
         c.amount
  from public.coin_transactions c
  where c.user_id = any(p_users) and c.reason = 'daily_goal'
    and c.ref between to_char(p_from, 'YYYY-MM-DD') and to_char(p_to, 'YYYY-MM-DD')
    and ((select day from switch) is null or c.ref >= to_char((select day from switch), 'YYYY-MM-DD'))
    and exists (select 1 from public.daily_steps s
                where s.user_id = c.user_id
                  and s.day = case when c.reason = 'daily_goal' then c.ref::date end)
  union all
  select a.user_id, a.earned_on, 'achievement', a.achievement_id, a.earned_at, null
  from public.user_achievements a
  where a.user_id = any(p_users) and a.earned_on between p_from and p_to
  union all
  -- On the shop day it was paid, while the item is still owned
  select c.user_id, (c.created_at at time zone 'America/Los_Angeles')::date, 'purchase', c.ref,
         c.created_at, null
  from public.coin_transactions c
  where c.user_id = any(p_users) and c.reason = 'purchase' and c.amount < 0
    and (c.created_at at time zone 'America/Los_Angeles')::date between p_from and p_to
    and exists (select 1 from public.user_items u
                where u.user_id = c.user_id and u.item_id = c.ref)
$$;

-- As in 20261124000000_activity_separate_lines.sql, plus on goal lines:
--   prize_item   the item won that day (yours and friends'), else null
--   prize_coins  yours only: the coins won that day, else null
create or replace function public.activity_feed(
  my_today date,
  before_day date default null,
  before_at timestamptz default null,
  before_id uuid default null,
  before_kind text default null,
  before_ref text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  seen_at timestamptz := coalesce((select n.kudos_seen_at from public.notification_settings n
                                   where n.user_id = auth.uid()), '-infinity');
  result jsonb;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  if (before_day is null) <> (before_at is null) or (before_day is null) <> (before_id is null)
     or (before_day is null) <> (before_kind is null) or (before_day is null) <> (before_ref is null) then
    raise exception 'BAD_CURSOR';
  end if;

  with people as (
    select p.id, p.display_name, p.avatar
    from public.profiles p
    where p.sharing_consent_at is not null
      and (p.id = me
           or (p.id in (select case when f.requester_id = me then f.addressee_id
                                    else f.requester_id end
                        from public.friendships f
                        where f.status = 'accepted'
                          and (f.requester_id = me or f.addressee_id = me))
               and public.can_see(p.id)))
  ),
  page as (
    select l.*, people.display_name, people.avatar
    from public.activity_parts((select array_agg(id) from people), my_today - 29, my_today + 1) l
    join people on people.id = l.user_id
    where before_day is null
       or (l.day, l.at, l.user_id, l.kind, l.ref) < (before_day, before_at, before_id, before_kind, before_ref)
    order by l.day desc, l.at desc, l.user_id desc, l.kind desc, l.ref desc
    limit 20
  ),
  claps as (
    select page.user_id, page.day, page.kind, page.ref,
           count(k.giver_id) filter (where public.kudos_counts(k.giver_id, page.user_id)) as kudos,
           bool_or(k.giver_id = me) as mine,
           count(k.giver_id) filter (where page.user_id = me and k.created_at > seen_at
                                       and public.kudos_counts(k.giver_id, me)) as fresh
    from page
    left join public.kudos k on k.user_id = page.user_id and k.day = page.day
                            and k.kind = page.kind and k.ref = page.ref
    group by page.user_id, page.day, page.kind, page.ref
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', page.day,
           'at', page.at,
           'user_id', page.user_id,
           'display_name', page.display_name,
           'avatar', page.avatar,
           'kind', page.kind,
           'ref', page.ref,
           'goal', page.kind = 'goal',
           'coins', case when page.user_id = me then page.amount end,
           'achievements', case when page.kind = 'achievement' then jsonb_build_array(page.ref)
                                else '[]'::jsonb end,
           'items', case when page.kind = 'purchase' then jsonb_build_array(page.ref)
                         else '[]'::jsonb end,
           'prize_item', case when page.kind = 'goal' then roll.item_id end,
           'prize_coins', case when page.kind = 'goal' and page.user_id = me
                               then nullif(roll.coins, 0) end,
           'kudos', claps.kudos,
           'my_kudos', coalesce(claps.mine, false),
           'new_kudos', case when page.user_id = me then claps.fresh end)
         order by page.day desc, page.at desc, page.user_id desc, page.kind desc, page.ref desc),
         '[]'::jsonb)
  into result
  from page
  join claps on claps.user_id = page.user_id and claps.day = page.day
            and claps.kind = page.kind and claps.ref = page.ref
  left join public.daily_rolls roll on roll.user_id = page.user_id and roll.day = page.day;
  return result;
end;
$$;

-- =====================================================================
-- PERMISSIONS
-- =====================================================================
revoke all on function public.activity_parts(uuid[], date, date) from public, anon, authenticated;
revoke all on function public.roll_daily_prize(date) from public, anon;
revoke all on function public.mark_roll_seen(date) from public, anon;
grant execute on function public.roll_daily_prize(date) to authenticated;
grant execute on function public.mark_roll_seen(date) to authenticated;
