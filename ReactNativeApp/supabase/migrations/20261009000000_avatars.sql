-- StepTracker Part 3: customizable characters (step-tracker-stage3.txt, section 5).
-- A character is a small JSON object of choices, drawn by the app from sprites.

alter table public.profiles
  add column avatar jsonb not null default '{
    "skin": "#f6c9a0",
    "hair": "hair_spiky",
    "hairColor": "#7a4a2a",
    "face": "face_smile",
    "top": "top_hoodie_red",
    "bottom": "bottom_shorts_blue",
    "shoes": "shoes_white",
    "hat": null
  }'::jsonb;

-- Basic sanity limits so nobody stores junk in the column
alter table public.profiles
  add constraint avatar_is_small_object
  check (jsonb_typeof(avatar) = 'object'
         and pg_column_size(avatar) < 2000);

-- No new security rules: "profiles update own" already limits edits to
-- your own row, and "profiles read" lets other signed-in users see it.

-- Leaderboards return the character too. The return type changes, so
-- drop and recreate both functions from Part 2.
drop function public.group_leaderboard(uuid, date, date);
drop function public.friends_leaderboard(date, date);

create function public.group_leaderboard(gid uuid, from_day date, to_day date)
returns table (user_id uuid, display_name text, avatar jsonb, total_steps bigint)
language sql stable
as $$
  select p.id, p.display_name, p.avatar, coalesce(sum(s.steps), 0)::bigint
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  left join public.daily_steps s
    on s.user_id = m.user_id and s.day between from_day and to_day
  where m.group_id = gid
  group by p.id, p.display_name, p.avatar
  order by 4 desc;
$$;

create function public.friends_leaderboard(from_day date, to_day date)
returns table (user_id uuid, display_name text, avatar jsonb, total_steps bigint)
language sql stable
as $$
  select p.id, p.display_name, p.avatar, coalesce(sum(s.steps), 0)::bigint
  from public.profiles p
  left join public.daily_steps s
    on s.user_id = p.id and s.day between from_day and to_day
  where p.id = auth.uid() or public.is_friend(p.id)
  group by p.id, p.display_name, p.avatar
  order by 4 desc;
$$;
