-- StepTracker: four more pets. Ids match src/avatar/pets.ts. The dog
-- (pet_dog) is now drawn as a Samoyed; its id and price are unchanged.
-- Admins get these automatically (20261013000000_admins.sql).
insert into public.shop_items (id, price) values
  ('pet_snail',     500),
  ('pet_pig',       600),
  ('pet_mushroom',  700),
  ('pet_stump',     900);
