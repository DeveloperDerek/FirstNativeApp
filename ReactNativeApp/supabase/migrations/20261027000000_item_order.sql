-- StepTracker: the order a user drags their items into in the character
-- editor. One row per user: every item id they have arranged, across all
-- slots; each row of tiles sorts by where its ids appear here. Its own
-- table (not a profiles column) because friends can read profiles, and
-- this lists everything the user owns.
create table public.item_order (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  ids        text[] not null default '{}'
             check (cardinality(ids) <= 1000),
  updated_at timestamptz not null default now()
);

alter table public.item_order enable row level security;

create policy "item order read own" on public.item_order
  for select using (user_id = auth.uid());
create policy "item order insert own" on public.item_order
  for insert with check (user_id = auth.uid() and (select public.is_active_account()));
create policy "item order update own" on public.item_order
  for update using (user_id = auth.uid() and (select public.is_active_account()))
  with check (user_id = auth.uid());
