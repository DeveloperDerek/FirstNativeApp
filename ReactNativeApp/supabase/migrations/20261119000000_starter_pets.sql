-- StepTracker: every new account starts with two pets, the cat and the
-- dog. The cat is free for everyone already (it has no shop_items row);
-- the dog stays a shop item, so here new accounts are given it, recorded
-- as free (0 coins) in their coin history like the admin grants.
-- Accounts made before this keep what they have.

create function public.grant_starter_pets()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  with granted as (
    insert into public.user_items (user_id, item_id)
    select new.id, s.id from public.shop_items s
    where s.id in ('pet_dog')
    on conflict do nothing
    returning user_id, item_id
  )
  insert into public.coin_transactions (user_id, amount, reason, ref)
  select user_id, 0, 'starter', item_id from granted
  on conflict (user_id, reason, ref) do nothing;
  return new;
end;
$$;

-- Only the trigger calls it, never the app
revoke all on function public.grant_starter_pets() from public, anon, authenticated;

-- Every sign-up makes a profile (handle_new_user), so this covers them all
create trigger new_account_gets_starter_pets
  after insert on public.profiles
  for each row execute function public.grant_starter_pets();
