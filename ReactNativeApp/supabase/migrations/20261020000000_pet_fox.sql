-- StepTracker: a fox joins the pets. Id matches src/avatar/pets.ts.
-- Admins get it automatically (20261013000000_admins.sql).
insert into public.shop_items (id, price) values
  ('pet_fox', 800);

-- The fox was free in the app until this price arrived. Anyone wearing
-- it without owning it loses it now, or check_avatar_items() would
-- refuse every later change to their character.
update public.profiles p
set avatar = jsonb_set(p.avatar, '{pet}', 'null')
where p.avatar ->> 'pet' = 'pet_fox'
  and not exists (select 1 from public.user_items u
                  where u.user_id = p.id and u.item_id = 'pet_fox');
