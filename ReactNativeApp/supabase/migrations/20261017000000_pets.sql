-- StepTracker: pets that walk beside the character. A pet is stored in
-- profiles.avatar like any other choice ("pet": "pet_dog" or null). Ids
-- match src/avatar/pets.ts. The cat is free (not listed here); admins get
-- the paid pets automatically (20261013000000_admins.sql).

-- Refuse unowned pets too. Same check as before, with 'pet' added.
create or replace function public.check_avatar_items()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  slot text;
  item text;
begin
  -- If you add a new avatar slot later, add it to this array.
  foreach slot in array array['hair','face','top','bottom','shoes','hat',
                              'glasses','cape','hand','outfit','pet']
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

insert into public.shop_items (id, price) values
  ('pet_dog',    800),
  ('pet_slime', 1200);
