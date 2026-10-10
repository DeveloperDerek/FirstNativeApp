-- StepTracker: six more pairs of shoes. Ids match src/avatar/catalog.ts.
-- Admins get them automatically (20261013000000_admins.sql).
insert into public.shop_items (id, price) values
  ('shoes_clogs_green',     350),
  ('shoes_running_blue',    450),
  ('shoes_slippers_bunny',  700),
  ('shoes_cowboy',          700),
  ('shoes_skates_pink',     900),
  ('shoes_rocket',         1500);
