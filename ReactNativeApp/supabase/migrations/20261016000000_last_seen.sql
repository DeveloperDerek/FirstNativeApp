-- StepTracker: "Last seen" on the player card. The app calls mark_seen()
-- whenever it is opened or comes back to the foreground.
--
-- Not a column on profiles: every signed-in user can read profiles, and
-- when someone was last online is only for the people who can already see
-- their steps (themselves, friends, group mates). Like steps, it is only
-- recorded for users who have agreed to share.
create table public.last_seen (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.last_seen enable row level security;

create policy "last seen read" on public.last_seen
  for select to authenticated
  using (user_id = auth.uid()
         or public.is_friend(user_id)
         or public.shares_group(user_id));

-- No insert or update policies: only mark_seen() writes, with the
-- server's clock, so a changed phone clock can't fake it.
create function public.mark_seen()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_sharing_consent() then
    return;
  end if;
  insert into public.last_seen (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = now();
end;
$$;

revoke execute on function public.mark_seen() from public, anon;
grant execute on function public.mark_seen() to authenticated;
