-- StepTracker Part 4: coins and clothing shop (step-tracker-stage4.txt).
-- The app never writes coins or ownership directly. It only calls the
-- functions below; the database decides.

-- =====================================================================
-- TABLES (section 2)
-- =====================================================================

-- Coins are NOT a column on profiles: "profiles update own" would let
-- users set their own balance.
create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0)
);

-- Every coin movement, for history and to block double payouts
create table public.coin_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     integer not null,          -- positive = earned, negative = spent
  reason     text not null,             -- 'daily_goal', 'purchase', 'grandfathered'
  ref        text not null,             -- the day, or the item id
  created_at timestamptz not null default now(),
  unique (user_id, reason, ref)         -- one reward per day, one buy per item
);

-- What is for sale. id must match an item id in src/avatar/catalog.ts.
-- Any catalog item NOT listed here is a free starter item.
create table public.shop_items (
  id     text primary key,
  price  integer not null check (price > 0),
  active boolean not null default true
);

-- Who owns what
create table public.user_items (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  item_id     text not null references public.shop_items(id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.wallets           enable row level security;
alter table public.coin_transactions enable row level security;
alter table public.shop_items        enable row level security;
alter table public.user_items        enable row level security;

-- Read-only for the app. There are deliberately NO insert, update, or
-- delete policies: only the functions below can change these.
create policy "wallet read own" on public.wallets
  for select to authenticated using (user_id = auth.uid());
create policy "transactions read own" on public.coin_transactions
  for select to authenticated using (user_id = auth.uid());
create policy "shop read" on public.shop_items
  for select to authenticated using (true);
create policy "items read own" on public.user_items
  for select to authenticated using (user_id = auth.uid());

-- Keep step counts believable (blocks uploading 9,999,999)
alter table public.daily_steps
  add constraint steps_sane check (steps <= 100000);

-- =====================================================================
-- REWARDS (section 3)
-- =====================================================================
create function public.claim_daily_rewards()
returns integer                    -- coins granted by this call
language plpgsql security definer set search_path = ''
as $$
declare
  uid         uuid := auth.uid();
  goal        constant integer := 10000;   -- steps needed
  reward      constant integer := 100;     -- coins per day
  window_days constant integer := 7;       -- how far back to pay
  granted     integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

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
  select coalesce(sum(amount), 0) into granted from paid;

  if granted > 0 then
    insert into public.wallets (user_id, balance)
    values (uid, granted)
    on conflict (user_id)
    do update set balance = public.wallets.balance + excluded.balance;
  end if;

  return granted;
end;
$$;

-- =====================================================================
-- DAILY SHOP (section 4a)
-- =====================================================================

-- The shop's calendar day. One fixed time zone for everyone, so every
-- shop flips at the same moment.
create function public.shop_day()
returns date language sql stable set search_path = ''
as $$
  select (now() at time zone 'America/Los_Angeles')::date;
$$;

-- What each user was shown on each day
create table public.user_daily_shop (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  shop_day date not null,
  item_id  text not null references public.shop_items(id),
  primary key (user_id, shop_day, item_id)
);

-- No policies at all: the app reads it only through daily_shop()
alter table public.user_daily_shop enable row level security;

create function public.daily_shop()
returns table (id text, price integer, refreshes_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid       uuid := auth.uid();
  today     date := public.shop_day();
  -- Items per day. Kept small until there is more art: with 14 paid
  -- items, 6 a day would bring repeats back almost immediately.
  shop_size constant integer := 3;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  -- If the app calls this twice at once, make the second call wait so
  -- the user cannot end up with two different shops.
  perform pg_advisory_xact_lock(hashtext(uid::text));

  -- First visit today: pick this user's items and remember them
  if not exists (select 1 from public.user_daily_shop d
                 where d.user_id = uid and d.shop_day = today) then
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
    -- Never-shown items first, then the ones shown longest ago.
    -- random() breaks ties, which makes each user's shop different.
    order by seen.last_shown asc nulls first, random()
    limit shop_size;
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

-- =====================================================================
-- PURCHASE (section 4b)
-- =====================================================================
create function public.purchase_item(p_item text)
returns integer                    -- new balance
language plpgsql security definer set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  cost integer;
  bal  integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  select s.price into cost
  from public.shop_items s where s.id = p_item and s.active;
  if cost is null then
    raise exception 'ITEM_NOT_FOR_SALE';
  end if;

  -- Must be in today's rotation. Without this, someone could buy any
  -- item on any day by calling this function directly.
  if not exists (select 1 from public.daily_shop() d where d.id = p_item) then
    raise exception 'NOT_IN_TODAYS_SHOP';
  end if;

  -- Make sure a wallet row exists, then lock it so two purchases at the
  -- same moment cannot both spend the same coins.
  insert into public.wallets (user_id) values (uid)
  on conflict (user_id) do nothing;
  select w.balance into bal
  from public.wallets w where w.user_id = uid for update;

  if exists (select 1 from public.user_items u
             where u.user_id = uid and u.item_id = p_item) then
    raise exception 'ALREADY_OWNED';
  end if;

  if bal < cost then
    raise exception 'NOT_ENOUGH_COINS';
  end if;

  update public.wallets set balance = balance - cost where user_id = uid;
  insert into public.user_items (user_id, item_id) values (uid, p_item);
  insert into public.coin_transactions (user_id, amount, reason, ref)
  values (uid, -cost, 'purchase', p_item);

  return bal - cost;
end;
$$;

-- =====================================================================
-- BLOCK EQUIPPING UNOWNED ITEMS (section 5)
-- =====================================================================
create function public.check_avatar_items()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  slot text;
  item text;
begin
  -- If you add a new avatar slot later, add it to this array.
  foreach slot in array array['hair','face','top','bottom','shoes','hat']
  loop
    item := new.avatar ->> slot;
    if item is not null
       and exists (select 1 from public.shop_items where id = item)
       and not exists (select 1 from public.user_items
                       where user_id = new.id and item_id = item)
    then
      raise exception 'ITEM_NOT_OWNED: %', item;
    end if;
  end loop;
  return new;
end;
$$;

create trigger avatar_items_owned
  before update of avatar on public.profiles
  for each row execute function public.check_avatar_items();

-- =====================================================================
-- STOCK THE SHOP (section 6)
-- =====================================================================
-- Free starters (not listed): face_smile, face_neutral, hair_spiky,
-- hair_short, hair_buzz, top_hoodie_red, top_tee_white,
-- bottom_shorts_blue, bottom_jeans_blue, shoes_white, and "no hat".
-- The default character must only use free items.
insert into public.shop_items (id, price) values
  ('face_wink',           300),
  ('face_determined',     300),
  ('hair_long',           600),
  ('hair_ponytail',       600),
  ('top_jacket_green',    400),
  ('top_sweater_yellow',  500),
  ('top_jersey_blue',     700),
  ('bottom_pants_black',  400),
  ('bottom_skirt_pink',   500),
  ('shoes_red',           300),
  ('shoes_boots_brown',   600),
  ('hat_beanie_teal',     400),
  ('hat_cap_red',         500),
  ('hat_crown_gold',     1500);

-- Anyone already wearing an item that just became paid keeps it, so
-- their next character save isn't rejected by the trigger above.
with worn as (
  select p.id as user_id, p.avatar ->> slot as item_id
  from public.profiles p
  cross join unnest(array['hair','face','top','bottom','shoes','hat']) as slot
)
, granted as (
  insert into public.user_items (user_id, item_id)
  select distinct w.user_id, w.item_id
  from worn w join public.shop_items s on s.id = w.item_id
  on conflict do nothing
  returning user_id, item_id
)
insert into public.coin_transactions (user_id, amount, reason, ref)
select user_id, 0, 'grandfathered', item_id from granted;

-- =====================================================================
-- ANTI-CHEAT LAYER 3: server sanity limits (section 13c)
-- =====================================================================
-- A day cannot be changed once it is more than 8 days old, and nobody
-- can upload a day in the future.
create function public.check_step_row()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.day > current_date + 1 then
    raise exception 'Future day';
  end if;
  if new.day < current_date - 8 then
    raise exception 'Day is too old to change';
  end if;
  new.updated_at := now();     -- never trust the client's timestamp
  return new;
end;
$$;

create trigger daily_steps_check
  before insert or update on public.daily_steps
  for each row execute function public.check_step_row();

-- =====================================================================
-- ANTI-CHEAT LAYER 5: flag suspicious accounts (section 13e)
-- =====================================================================
-- Check this from the Supabase dashboard. Not readable from the app.
create view public.suspicious_steps
with (security_invoker = true) as
select
  s.user_id,
  p.username,
  count(*) filter (where s.steps >= 40000)                  as days_over_40k,
  count(*) filter (where s.steps % 1000 = 0 and s.steps > 0) as round_number_days,
  max(s.steps)                                              as best_day,
  count(*) filter (where s.steps >= 10000)                  as goal_days
from public.daily_steps s
join public.profiles p on p.id = s.user_id
where s.day >= current_date - 30
group by s.user_id, p.username
having count(*) filter (where s.steps >= 40000) >= 3
    or count(*) filter (where s.steps % 1000 = 0 and s.steps > 0) >= 3;

revoke all on public.suspicious_steps from anon, authenticated;
