-- StepTracker: themed item sets, sold piece by piece like everything
-- else in the daily shop. Each set finishes with items the shop already
-- has (cowboy boots, the eyepatch, the knight's armor and sword...).
-- Ids match src/avatar/catalog.ts. Admins get them automatically
-- (20261013000000_admins.sql).
insert into public.shop_items (id, price) values
  -- Cowboy (+ shoes_cowboy)
  ('hat_cowboy',             900),
  ('top_cowboy_vest',        700),
  ('hand_lasso',             700),
  -- Chef
  ('hat_chef',               700),
  ('outfit_chef',           1500),
  ('hand_spatula',           400),
  -- Pirate (+ glasses_eyepatch, shoes_boots_brown)
  ('hat_pirate',            1000),
  ('outfit_pirate',         2000),
  ('hand_spyglass',          800),
  -- Knight (+ outfit_knight, hand_sword, hand_shield)
  ('hat_knight',            1200),
  -- Astronaut (+ hand_flag)
  ('hat_astronaut',         1500),
  ('outfit_astronaut',      2500),
  -- Summer (+ top_aloha, shoes_sandals) and viking
  ('hat_straw',              600),
  ('hat_viking',            1000);
