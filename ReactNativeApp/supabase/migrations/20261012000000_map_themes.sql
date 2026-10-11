-- StepTracker: selectable map themes sold in the coin shop
-- (step-tracker-stage7.txt, section 4).

-- Which map each user has selected
alter table public.profiles
  add column map_theme text not null default 'map_village'
  check (char_length(map_theme) < 40);

-- Refuse a map the user has not bought. A map that is not in shop_items
-- (map_village) is free.
create function public.check_map_theme()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.shop_items where id = new.map_theme)
     and not exists (select 1 from public.user_items
                     where user_id = new.id and item_id = new.map_theme)
  then
    raise exception 'ITEM_NOT_OWNED: %', new.map_theme;
  end if;
  return new;
end;
$$;

create trigger map_theme_owned
  before update of map_theme on public.profiles
  for each row execute function public.check_map_theme();

-- Put the maps in the shop pool. daily_shop() and purchase_item() already
-- work for any row here, including "never offer something already owned".
insert into public.shop_items (id, price) values
  ('map_forest',   2000),
  ('map_beach',    2000),
  ('map_city',     2500),
  ('map_mountain', 2500);
