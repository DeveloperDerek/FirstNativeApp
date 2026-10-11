-- Fill today's shop up to shop_size instead of picking only on the
-- first visit. A day that was picked while the shop held 3 items kept
-- showing 3 after the shop grew to 6; now the missing places are added
-- on the next visit. Items bought today still count as today's picks,
-- so buying something never brings in a replacement.
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
  where d.user_id = uid and d.shop_day = today;

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
      -- or something already in today's shop
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
    where d.user_id = uid and d.shop_day = today and s.active;
end;
$$;
