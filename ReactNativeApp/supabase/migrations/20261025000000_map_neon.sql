-- StepTracker: a neon city at dusk joins the map backgrounds. The id
-- matches src/track/themes.ts. daily_shop() and purchase_item() already
-- work for any row here, and admins are given new items automatically
-- (20261013000000_admins.sql).
insert into public.shop_items (id, price) values
  ('map_neon', 3500);
