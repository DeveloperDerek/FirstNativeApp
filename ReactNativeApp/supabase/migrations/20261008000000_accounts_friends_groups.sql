-- StepTracker Part 2: accounts, friends, groups, leaderboards, consent.
-- Sections 4, 5 and 14a of step-tracker-stage2.txt in one script.
-- Run it once in Supabase > SQL Editor, or with `supabase db push`.

-- =====================================================================
-- PROFILES
-- =====================================================================
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  username           text unique not null
                     check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name       text,
  sharing_consent_at timestamptz, -- null until the user agrees to share steps (14a)
  created_at         timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8),
    coalesce(new.raw_user_meta_data->>'full_name',
             split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- DAILY STEPS
-- =====================================================================
create table public.daily_steps (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  steps      integer not null check (steps >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- =====================================================================
-- FRIENDSHIPS
-- =====================================================================
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

-- One row per pair, regardless of who sent the request
create unique index friendships_pair_idx on public.friendships (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
);

-- =====================================================================
-- GROUPS
-- =====================================================================
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  invite_code text unique not null
              default substr(md5(gen_random_uuid()::text), 1, 8),
  created_at  timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Owner automatically becomes a member
create function public.add_owner_as_member()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id)
  values (new.id, new.owner_id);
  return new;
end;
$$;

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.add_owner_as_member();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

-- Helper functions. "security definer" lets them check membership
-- without triggering RLS on the tables they read (avoids the
-- "infinite recursion in policy" error).

create function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = auth.uid() and addressee_id = other)
        or (addressee_id = auth.uid() and requester_id = other))
  );
$$;

create function public.is_group_member(gid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

create function public.shares_group(other uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members me
    join public.group_members them on them.group_id = me.group_id
    where me.user_id = auth.uid() and them.user_id = other
  );
$$;

create function public.has_sharing_consent()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and sharing_consent_at is not null
  );
$$;

alter table public.profiles      enable row level security;
alter table public.daily_steps   enable row level security;
alter table public.friendships   enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- PROFILES: any signed-in user can look people up; edit only your own
create policy "profiles read" on public.profiles
  for select to authenticated using (true);
create policy "profiles update own" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- DAILY STEPS: read your own, your friends', your group mates'.
-- Uploads are refused unless the user has agreed to share (14a).
create policy "steps read" on public.daily_steps
  for select to authenticated
  using (user_id = auth.uid()
         or public.is_friend(user_id)
         or public.shares_group(user_id));
create policy "steps insert own" on public.daily_steps
  for insert to authenticated
  with check (user_id = auth.uid() and public.has_sharing_consent());
create policy "steps update own" on public.daily_steps
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.has_sharing_consent());
create policy "steps delete own" on public.daily_steps
  for delete to authenticated using (user_id = auth.uid());

-- FRIENDSHIPS
create policy "friendships read" on public.friendships
  for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
create policy "friendships request" on public.friendships
  for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');
create policy "friendships accept" on public.friendships
  for update to authenticated
  using (addressee_id = auth.uid())
  with check (addressee_id = auth.uid() and status = 'accepted');
create policy "friendships remove" on public.friendships
  for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- Accepting may only change the status. Without this, the addressee
-- could rewrite requester_id to any user and become their "friend".
revoke update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;

-- GROUPS
create policy "groups read" on public.groups
  for select to authenticated
  using (owner_id = auth.uid() or public.is_group_member(id));
create policy "groups create" on public.groups
  for insert to authenticated with check (owner_id = auth.uid());
create policy "groups update" on public.groups
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "groups delete" on public.groups
  for delete to authenticated using (owner_id = auth.uid());

-- GROUP MEMBERS (joining goes through join_group() below)
create policy "members read" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));
create policy "members leave or kick" on public.group_members
  for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.groups g
                    where g.id = group_id and g.owner_id = auth.uid()));

-- Join a group with an invite code
create function public.join_group(code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into gid from public.groups where invite_code = lower(trim(code));
  if gid is null then raise exception 'Invalid invite code'; end if;
  insert into public.group_members (group_id, user_id)
  values (gid, auth.uid())
  on conflict do nothing;
  return gid;
end;
$$;

-- Leaderboards. Run as the caller, so RLS above still applies.
create function public.group_leaderboard(gid uuid, from_day date, to_day date)
returns table (user_id uuid, display_name text, total_steps bigint)
language sql stable
as $$
  select p.id, p.display_name, coalesce(sum(s.steps), 0)::bigint
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  left join public.daily_steps s
    on s.user_id = m.user_id and s.day between from_day and to_day
  where m.group_id = gid
  group by p.id, p.display_name
  order by 3 desc;
$$;

create function public.friends_leaderboard(from_day date, to_day date)
returns table (user_id uuid, display_name text, total_steps bigint)
language sql stable
as $$
  select p.id, p.display_name, coalesce(sum(s.steps), 0)::bigint
  from public.profiles p
  left join public.daily_steps s
    on s.user_id = p.id and s.day between from_day and to_day
  where p.id = auth.uid() or public.is_friend(p.id)
  group by p.id, p.display_name
  order by 3 desc;
$$;
