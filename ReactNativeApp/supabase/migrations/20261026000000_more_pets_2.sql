-- StepTracker: an orange mushroom and an octopus join the pets. Ids
-- match src/avatar/pets.ts. Admins get them automatically
-- (20261013000000_admins.sql).
insert into public.shop_items (id, price) values
  ('pet_orange_mushroom', 750),
  ('pet_octopus',         850);
