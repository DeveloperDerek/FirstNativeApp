-- StepTracker: the bigger character collection. Four new slots (glasses,
-- cape, hand, outfit) and more items for every slot. Ids match
-- src/avatar/catalog.ts. Admins get the new items automatically
-- (20261013000000_admins.sql).

-- Refuse unowned items in the new slots too. Same check as before, with
-- the four new slots added to the list.
create or replace function public.check_avatar_items()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  slot text;
  item text;
begin
  -- If you add a new avatar slot later, add it to this array.
  foreach slot in array array['hair','face','top','bottom','shoes','hat',
                              'glasses','cape','hand','outfit']
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

-- Rarer looks cost more: wings, outfits and the halo are the big prizes.
insert into public.shop_items (id, price) values
  ('face_joy',              300),
  ('face_surprised',        300),
  ('face_sleepy',           300),
  ('face_starry',           500),
  ('face_cat',              400),
  ('hair_bob',              600),
  ('hair_twintails',        700),
  ('hair_afro',             700),
  ('hair_mohawk',           700),
  ('hair_bun',              600),
  ('hair_wavy',             800),
  ('top_stripe_navy',       400),
  ('top_blazer',            700),
  ('top_tank_orange',       300),
  ('top_varsity',           800),
  ('top_aloha',             500),
  ('top_puffer_purple',     700),
  ('bottom_cargo_khaki',    400),
  ('bottom_skirt_plaid',    500),
  ('bottom_track_red',      400),
  ('bottom_pants_white',    400),
  ('shoes_rain_yellow',     500),
  ('shoes_hightop_black',   600),
  ('shoes_sandals',         300),
  ('shoes_gold',           1200),
  ('hat_bunny',             900),
  ('hat_cat',               900),
  ('hat_witch',            1000),
  ('hat_tophat',           1000),
  ('hat_halo',             1500),
  ('hat_flowers',           700),
  ('hat_headphones',        800),
  ('hat_propeller',         600),
  ('glasses_round',         400),
  ('glasses_shades',        500),
  ('glasses_star',          700),
  ('glasses_heart',         700),
  ('glasses_eyepatch',      500),
  ('glasses_mask',          900),
  ('cape_red',             1200),
  ('cape_royal',           1800),
  ('wings_angel',          2500),
  ('wings_bat',            2500),
  ('wings_fairy',          2500),
  ('hand_balloon',          500),
  ('hand_umbrella',         700),
  ('hand_sword',            800),
  ('hand_wand',             900),
  ('hand_lollipop',         400),
  ('hand_lantern',          700),
  ('outfit_sailor',        1500),
  ('outfit_tuxedo',        1800),
  ('outfit_wizard',        2000),
  ('outfit_knight',        2200),
  ('outfit_pajamas',       1200),
  ('outfit_dress',         1500);

-- A bigger daily shop now that there is more to sell. Same as before
-- except shop_size.
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
