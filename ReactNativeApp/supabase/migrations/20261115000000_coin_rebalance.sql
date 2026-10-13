-- StepTracker: coin rebalance (step-tracker-coins-items.txt, section 5;
-- step-tracker-decisions.txt, COIN-1 to COIN-5).
--
--   Daily step reward     100 -> 150 coins
--   Shop refresh payout    25 -> 10 coins (the refresh itself is unchanged)
--   Quest coins           1 per 200 steps -> 1 per 100 steps
--   Quest daily cap       600 -> 400 coins
--   Welcome bonus         300 coins with a player's first check-in
--   Prices                pets up, maps down, plain bottoms down, odd
--                         prices rounded
--
-- Past payouts and purchases stay as they were: nobody is refunded or
-- charged the difference.

-- =====================================================================
-- DAILY STEP REWARD (COIN-2)
-- =====================================================================
-- As in 20261112000000_goal_range_coin_steps.sql, with 150 coins a day
create or replace function public.claim_daily_rewards()
returns integer                    -- coins granted by this call
language plpgsql security definer set search_path = ''
as $$
declare
  uid         uuid := auth.uid();
  reward      constant integer := 150;     -- coins per day
  window_days constant integer := 7;       -- how far back to pay
  daily       integer;
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
-- CHECK-IN AND WELCOME BONUS (COIN-1)
-- =====================================================================
-- As in 20261023000000_register.sql, plus a one-time welcome bonus on a
-- player's first check-in ever. The app checks in as soon as sharing is
-- turned on, so a new player can buy something in their first session.
-- Players who have checked in before never get it. The 'welcome' row's
-- unique key makes it once per account whatever happens to the wallet.
-- A new column, so the function is replaced; older app builds read only
-- granted and next_at and keep working.
drop function public.claim_checkin();
create function public.claim_checkin()
returns table (granted integer, next_at timestamptz, welcome integer)
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  bonus    constant integer  := 10;                 -- coins per check-in
  first    constant integer  := 300;                -- welcome bonus, once
  cooldown constant interval := interval '6 hours';
  last_at  timestamptz;
  extra    integer := 0;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  -- Same rule as step rewards: sharing is required to earn coins
  if not public.has_sharing_consent() then
    return query select 0, null::timestamptz, 0;
    return;
  end if;

  -- Lock the wallet so two taps at once cannot both collect
  insert into public.wallets (user_id) values (uid)
  on conflict (user_id) do nothing;
  select w.last_checkin_at into last_at
  from public.wallets w where w.user_id = uid for update;

  -- Too soon: grant nothing, say when the next one is ready.
  -- now() is the server's clock, so changing the phone's time does nothing.
  if last_at is not null and now() < last_at + cooldown then
    return query select 0, last_at + cooldown, 0;
    return;
  end if;

  if last_at is null then
    insert into public.coin_transactions (user_id, amount, reason, ref)
    values (uid, first, 'welcome', 'once')
    on conflict (user_id, reason, ref) do nothing;
    if found then extra := first; end if;
  end if;

  update public.wallets w
  set balance = w.balance + bonus + extra, last_checkin_at = now()
  where w.user_id = uid;

  insert into public.coin_transactions (user_id, amount, reason, ref)
  values (uid, bonus, 'checkin',
          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS'));

  return query select bonus + extra, now() + cooldown, extra;
end;
$$;

-- =====================================================================
-- SHOP REFRESH (COIN-2)
-- =====================================================================
-- As in 20261023000000_register.sql, paying 10 coins instead of 25
create or replace function public.refresh_shop()
returns table (refreshed boolean, granted integer, next_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  bonus    constant integer  := 10;                 -- coins per refresh
  cooldown constant interval := interval '12 hours';
  last_at  timestamptz;
  paid     integer := 0;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  -- The same lock daily_shop() takes, so a purchase or a shop load
  -- can't run in the middle of the swap
  perform pg_advisory_xact_lock(hashtext(uid::text));

  -- Lock the wallet so two taps at once cannot both refresh
  insert into public.wallets (user_id) values (uid)
  on conflict (user_id) do nothing;
  select w.last_shop_refresh_at into last_at
  from public.wallets w where w.user_id = uid for update;

  -- now() is the server's clock, so changing the phone's time does nothing
  if last_at is not null and now() < last_at + cooldown then
    return query select false, 0, last_at + cooldown;
    return;
  end if;

  -- Everything in today's shop goes, bought items included, so the
  -- refresh always brings a full set. daily_shop() below picks it.
  update public.user_daily_shop d
  set replaced_at = now()
  where d.user_id = uid and d.shop_day = public.shop_day() and d.replaced_at is null;

  perform 1 from public.daily_shop();

  -- Same rule as step rewards: sharing is required to earn coins
  if public.has_sharing_consent() then
    paid := bonus;
    insert into public.coin_transactions (user_id, amount, reason, ref)
    values (uid, bonus, 'shop_refresh',
            to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS'));
  end if;

  update public.wallets w
  set balance = w.balance + paid, last_shop_refresh_at = now()
  where w.user_id = uid;

  return query select true, paid, now() + cooldown;
end;
$$;

-- =====================================================================
-- QUEST COINS (COIN-3)
-- =====================================================================
-- 1 coin per 100 steps (was 200), counting up to 150% of the goal. Must
-- match stepCoins() in src/quests/rules.ts. Quests already paid keep
-- their step_coins and coins_each.
create or replace function public.quest_step_coins(steps integer, goal integer)
returns integer language sql immutable set search_path = ''
as $$ select (least(steps, goal * 3 / 2) / 100)::integer $$;

-- As in 20261111000000_quests_without_voting.sql, with a daily cap of 400
create or replace function public.quest_advance(qid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q          public.quests%rowtype;
  daily_cap  constant integer := 400;
  member     record;
  earned     integer;
  pay        integer;
  today_from timestamptz;
begin
  select * into q from public.quests where id = qid for update;
  if not found then return; end if;

  -- ACTIVE: failed only once the grace period is over. (Completed is
  -- set by upload_quest_steps() the moment the goal is reached.)
  if q.status = 'active' and now() >= q.ends_at + public.quest_grace() then
    q.status := 'failed';
    update public.quests set status = 'failed' where id = q.id;
  end if;

  -- PAID: after the window and grace period, once
  if q.status in ('completed', 'failed') and q.settled_at is null
     and now() >= q.ends_at + public.quest_grace() then
    if q.status = 'completed' then
      q.step_coins := public.quest_step_coins(q.total_steps, q.goal);
      q.multiplier := public.quest_multiplier(q.party_size);
      q.coins_each := public.quest_coins_each(q.total_steps, q.goal, q.party_size);
    end if;

    update public.quests
    set settled_at = now(), step_coins = q.step_coins,
        multiplier = q.multiplier, coins_each = q.coins_each
    where id = q.id;

    if q.status = 'completed' then
      -- The daily cap is counted per shop day, like the daily shop
      today_from := (public.shop_day()::timestamp at time zone 'America/Los_Angeles');

      -- Only party members who are still in the group and still share
      -- their steps are paid (section 8)
      for member in
        select p.user_id
        from public.quest_party p
        join public.group_members m on m.group_id = q.group_id and m.user_id = p.user_id
        join public.profiles pr on pr.id = p.user_id and pr.sharing_consent_at is not null
        where p.quest_id = q.id
      loop
        -- Lock the wallet: two quests paying at once must both see the cap
        insert into public.wallets (user_id) values (member.user_id)
        on conflict (user_id) do nothing;
        perform 1 from public.wallets w where w.user_id = member.user_id for update;

        select coalesce(sum(c.amount), 0) into earned
        from public.coin_transactions c
        where c.user_id = member.user_id and c.reason = 'quest'
          and c.created_at >= today_from;

        pay := least(q.coins_each, greatest(0, daily_cap - earned));

        insert into public.coin_transactions (user_id, amount, reason, ref)
        values (member.user_id, pay, 'quest', q.id::text)
        on conflict (user_id, reason, ref) do nothing;
        if found then
          update public.wallets set balance = balance + pay where user_id = member.user_id;
          update public.quest_party set coins_paid = pay
          where quest_id = q.id and user_id = member.user_id;
        end if;
      end loop;
    end if;
  end if;
end;
$$;

-- =====================================================================
-- PRICES (COIN-4)
-- =====================================================================
update public.shop_items s
set price = v.price
from (values
  -- Pets: always on show, so they move up. The snail stays the cheap one.
  ('pet_pig',               800),
  ('pet_mushroom',          900),
  ('pet_orange_mushroom',   900),
  ('pet_dog',              1000),
  ('pet_fox',              1000),
  ('pet_octopus',          1200),
  ('pet_stump',            1200),
  ('pet_slime',            1500),
  -- Maps: only you see yours, so they move down
  ('map_forest',           1500),
  ('map_beach',            1500),
  ('map_ocean',            1500),
  ('map_city',             2000),
  ('map_mountain',         2000),
  ('map_dungeon',          2500),
  ('map_space',            2500),
  ('map_neon',             3000),
  -- Plain bottoms are colour swaps: impulse-buy price
  ('bottom_pants_black',    300),
  ('bottom_pants_white',    300),
  ('bottom_cargo_khaki',    300),
  ('bottom_track_red',      300),
  -- Round prices only, and one top price for the big prizes
  ('face_starry',           400),
  ('shoes_clogs_green',     300),
  ('shoes_running_blue',    500),
  ('outfit_knight',        2500)
) as v(id, price)
where s.id = v.id;
