-- StepTracker: admin accounts. Admins own every shop item (clothing and
-- maps), including items added to the shop later.

-- Who is an admin. A separate table, NOT a column on profiles: the
-- "profiles update own" policy would let anyone make themselves admin.
-- RLS with no policies: the app can neither read nor change it. Add or
-- remove admins from the Supabase dashboard / SQL Editor only.
create table public.admins (
  user_id  uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Give one admin every item in the shop, recorded as free (0 coins) in
-- their coin history like the grandfathered items.
create function public.grant_all_items(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  with granted as (
    insert into public.user_items (user_id, item_id)
    select p_user, s.id from public.shop_items s
    on conflict do nothing
    returning user_id, item_id
  )
  insert into public.coin_transactions (user_id, amount, reason, ref)
  select user_id, 0, 'admin_grant', item_id from granted
  on conflict (user_id, reason, ref) do nothing;
end;
$$;

-- Only the triggers below and the SQL Editor call it, never the app
revoke all on function public.grant_all_items(uuid) from public, anon, authenticated;

-- A new admin gets everything straight away
create function public.on_admin_added()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.grant_all_items(new.user_id);
  return new;
end;
$$;

create trigger admin_gets_all_items
  after insert on public.admins
  for each row execute function public.on_admin_added();

-- A new shop item goes to every admin straight away
create function public.on_shop_item_added()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  with granted as (
    insert into public.user_items (user_id, item_id)
    select a.user_id, new.id from public.admins a
    on conflict do nothing
    returning user_id, item_id
  )
  insert into public.coin_transactions (user_id, amount, reason, ref)
  select user_id, 0, 'admin_grant', item_id from granted
  on conflict (user_id, reason, ref) do nothing;
  return new;
end;
$$;

create trigger shop_item_to_admins
  after insert on public.shop_items
  for each row execute function public.on_shop_item_added();

-- The first admin. Does nothing if this account has not signed up yet;
-- run this insert again after it has.
insert into public.admins (user_id)
select u.id from auth.users u
where lower(u.email) = 'derekqho@gmail.com'
on conflict do nothing;
