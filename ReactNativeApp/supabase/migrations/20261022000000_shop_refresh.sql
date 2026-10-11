-- StepTracker: refresh the shop once every 12 hours for a new set of
-- items, and earn coins for doing it. Replaced items keep their rows
-- (marked replaced_at) so the rotation still knows they were shown and
-- they don't come straight back.

alter table public.wallets
  add column last_shop_refresh_at timestamptz;

alter table public.user_daily_shop
  add column replaced_at timestamptz;

-- Same as 20261021000000_shop_top_up.sql, but replaced items no longer
-- count toward today's shop and are not returned. They still block
-- being picked again today, and still count as shown for the rotation.
create or replace function public.daily_shop()
returns table (id text, price integer, refreshes_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid       uuid := auth.uid();
  today     date := public.shop_day();
  -- Items per day. With about 80 paid items, 6 a day still takes two
  -- weeks to show everything once.
  shop_size constant integer := 6;
  picked    integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  -- If the app calls this twice at once, make the second call wait so
  -- the user cannot end up with two different shops.
  perform pg_advisory_xact_lock(hashtext(uid::text));

  select count(*) into picked
  from public.user_daily_shop d
  where d.user_id = uid and d.shop_day = today and d.replaced_at is null;

  -- Pick (or top up) this user's items for today and remember them
  if picked < shop_size then
    insert into public.user_daily_shop (user_id, shop_day, item_id)
    select uid, today, s.id
    from public.shop_items s
    left join lateral (
      select max(h.shop_day) as last_shown
      from public.user_daily_shop h
      where h.user_id = uid and h.item_id = s.id
    ) seen on true
    where s.active
      -- never offer something the user already owns
      and not exists (select 1 from public.user_items u
                      where u.user_id = uid and u.item_id = s.id)
      -- or something already in (or refreshed out of) today's shop
      and not exists (select 1 from public.user_daily_shop t
                      where t.user_id = uid and t.shop_day = today and t.item_id = s.id)
    -- Never-shown items first, then the ones shown longest ago.
    -- random() breaks ties, which makes each user's shop different.
    order by seen.last_shown asc nulls first, random()
    limit shop_size - picked;
  end if;

  return query
    select
      s.id,
      s.price,
      ((today + 1)::timestamp at time zone 'America/Los_Angeles')
    from public.user_daily_shop d
    join public.shop_items s on s.id = d.item_id
    where d.user_id = uid and d.shop_day = today and d.replaced_at is null and s.active;
end;
$$;

-- Swap today's items for new ones and pay the refresh bonus. Too soon:
-- nothing changes and next_at says when it is ready.
create function public.refresh_shop()
returns table (refreshed boolean, granted integer, next_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  bonus    constant integer  := 25;                 -- coins per refresh
  cooldown constant interval := interval '12 hours';
  last_at  timestamptz;
  paid     integer := 0;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

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
