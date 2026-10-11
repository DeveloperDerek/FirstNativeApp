-- StepTracker: three more map backgrounds in the coin shop. The ids
-- match src/track/themes.ts. daily_shop() and purchase_item() already
-- work for any row here, and admins are given new items automatically
-- (20261013000000_admins.sql).
insert into public.shop_items (id, price) values
  ('map_ocean',   2000),
  ('map_dungeon', 3000),
  ('map_space',   3000);
