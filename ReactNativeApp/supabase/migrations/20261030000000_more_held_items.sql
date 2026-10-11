-- StepTracker: seven more held items. Ids match src/avatar/catalog.ts.
-- Admins get them automatically (20261013000000_admins.sql).
insert into public.shop_items (id, price) values
  ('hand_sunflower',        500),
  ('hand_flag',             600),
  ('hand_bug_net',          700),
  ('hand_fishing_rod',      900),
  ('hand_shield',          1200),
  ('hand_surfboard',       1200),
  ('hand_guitar',          1500);
