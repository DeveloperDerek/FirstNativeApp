-- StepTracker: name limits (step-tracker-safety.txt, Part C, section 6).
--
-- Display names and group names are checked by the database every time
-- they are saved, by any route (sign-up, Profile, creating or renaming a
-- group), not only at sign-up. Usernames get the better word matching.
--
-- The shape rules (characters, spaces, length) are the twin of
-- src/auth/name-rules.ts in the app. The generated test
-- supabase/tests/database/name_rules.generated.test.sql checks the two
-- agree on every shared example and every range edge; change both
-- together and run `npm run gen:name-tests`.
--
-- Names saved before this keep working: the check only runs when a name
-- changes. List the ones that would fail with public.name_audit()
-- (supabase/admin/name_audit.sql).

-- =====================================================================
-- THE WORD LIST: TWO SETTINGS PER WORD
-- =====================================================================
--   kind   reserved    usernames only (help, admin, official...)
--          offensive   every kind of name
--   match  exact       the whole name (after flattening, below)
--          whole_word  a word of its own, or the whole name spread out
--          contains    anywhere, even inside another word
-- "exact" stays: making the reserved words "whole_word" would refuse
-- names like call_me_al or team_rocket, which today are fine.
alter table public.reserved_usernames
  add column kind text not null default 'reserved'
  check (kind in ('reserved', 'offensive'));
alter table public.reserved_usernames drop constraint reserved_usernames_match_check;
alter table public.reserved_usernames add constraint reserved_usernames_match_check
  check (match in ('exact', 'whole_word', 'contains'));

update public.reserved_usernames set kind = 'offensive'
where word in ('fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'nazi', 'hitler',
               'rapist', 'porn');

-- Words found inside real names and ordinary words stop matching inside
-- them: shit (Yamashita, Matsushita), cunt (Scunthorpe), nazi (Nazir,
-- Nazira), rapist (therapist), porn (Thai names like Pornthip), whore,
-- slut. Add compounds (e.g. 'shithead') as their own rows if needed.
update public.reserved_usernames set match = 'whole_word'
where word in ('shit', 'cunt', 'whore', 'slut', 'nazi', 'rapist', 'porn');

-- =====================================================================
-- SHAPE: characters, spaces, length (twin of checkName in the app)
-- =====================================================================

-- Refused anywhere: control, line-break, invisible and blank-looking
-- characters. Same list as REFUSED in src/auth/name-rules.ts.
create function public.name_refused_char(cp integer)
returns boolean language sql immutable set search_path = ''
as $$
  select cp between 0 and 31 or cp between 127 and 159
      or cp = 173 or cp = 847
      or cp between 1536 and 1541 or cp = 1564 or cp = 1757 or cp = 1807
      or cp between 2192 and 2193 or cp = 2274
      or cp between 4447 and 4448 or cp between 6068 and 6069
      or cp between 6155 and 6159
      or cp between 8203 and 8204 or cp between 8206 and 8207
      or cp between 8232 and 8238 or cp between 8288 and 8303
      or cp = 10240 or cp = 12644
      or cp between 65024 and 65038 or cp = 65279 or cp = 65440
      or cp between 65529 and 65531
      or cp = 69821 or cp = 69837 or cp between 78896 and 78911
      or cp between 113824 and 113827 or cp between 119155 and 119162
      or cp = 917505 or cp between 917536 and 917631
      or cp between 917760 and 917999
$$;

-- Emoji that a joiner, emoji style or skin tone may follow. Same list as
-- EMOJI in src/auth/name-rules.ts.
create function public.name_emoji_char(cp integer)
returns boolean language sql immutable set search_path = ''
as $$
  select cp = 169 or cp = 174 or cp = 8252 or cp = 8265 or cp = 8482 or cp = 8505
      or cp between 8596 and 8618 or cp between 8986 and 9215 or cp = 9410
      or cp between 9642 and 9726 or cp between 9728 and 10175
      or cp between 10548 and 10549 or cp between 11013 and 11093
      or cp = 12336 or cp = 12349 or cp = 12951 or cp = 12953
      or cp between 126976 and 127994 or cp between 128000 and 129791
$$;

-- The name as it will be saved, or why not. In this order: NFC; refuse
-- control, line-break, hidden and blank-looking characters (joiner,
-- emoji style and skin tones only inside emoji); trim the allowed spaces
-- and collapse each run inside to one ordinary space; visible content;
-- length in Unicode characters.
create function public.name_shape_check(
  p_name text, p_max integer,
  out saved text, out reason text, out detail text)
language plpgsql immutable set search_path = ''
as $$
declare
  s    text;
  cps  integer[];
  n    integer;
  cp   integer;
  prev integer;
  nxt  integer;
  ok   boolean;
  part boolean := false; -- the previous character was part of an emoji
begin
  if p_name is null then
    reason := 'empty'; detail := 'no visible characters'; return;
  end if;
  -- Far too long either way; saves checking every character
  if char_length(p_name) > 1000 then
    reason := 'too_long'; detail := char_length(p_name) || ' characters (max ' || p_max || ')';
    return;
  end if;

  s := normalize(p_name, NFC);
  select coalesce(array_agg(ascii(c) order by i), '{}')
  into cps
  from regexp_split_to_table(s, '') with ordinality as t(c, i);
  n := coalesce(array_length(cps, 1), 0);

  for i in 1 .. n loop
    cp   := cps[i];
    prev := case when i > 1 then cps[i - 1] else -1 end;
    nxt  := case when i < n then cps[i + 1] else -1 end;
    if public.name_refused_char(cp) then
      ok := false;
    elsif cp = 8205 then                                  -- zero-width joiner
      ok := part and public.name_emoji_char(nxt);
    elsif cp = 65039 or cp between 127995 and 127999 then -- emoji style, skin tones
      ok := public.name_emoji_char(prev);
    else
      ok := true;
    end if;
    if not ok then
      reason := 'character';
      detail := 'U+' || lpad(upper(to_hex(cp)), 4, '0');
      return;
    end if;
    part := public.name_emoji_char(cp)
            or ((cp = 65039 or cp between 127995 and 127999) and part);
  end loop;

  -- Same list as SPACES in src/auth/name-rules.ts
  s := regexp_replace(s, '[    -   　]+', ' ', 'g');
  s := regexp_replace(s, '^ | $', '', 'g');

  if s = '' then
    reason := 'empty'; detail := 'no visible characters'; return;
  end if;
  if char_length(s) > p_max then
    reason := 'too_long'; detail := char_length(s) || ' characters (max ' || p_max || ')';
    return;
  end if;
  saved := s;
end;
$$;

-- Just the saved name (null if refused), for the generated test
create function public.name_shape(p_name text, p_max integer)
returns text language sql immutable set search_path = ''
as $$ select (public.name_shape_check(p_name, p_max)).saved $$;

-- =====================================================================
-- WORDS
-- =====================================================================

-- For matching words only (the saved name keeps its accents):
-- lower-case, accents dropped (é -> e however it was typed), common
-- swaps undone (0->o, 1->i, 3->e, 4->a, 5->s, 7->t, $->s, @->a, !->i).
create function public.name_flat(p text)
returns text language sql immutable set search_path = ''
as $$
  select translate(
    regexp_replace(normalize(lower(normalize(p, NFC)), NFD), '[̀-ͯ]', '', 'g'),
    '013457$@!', 'oieastsai')
$$;

-- The first listed word of these kinds in the name, or null. JOINED is
-- the flattened name with every non-letter removed ("s h i t" -> shit);
-- WORDS is it split on non-letters. The words in the list are flattened
-- the same way, so 'step_tracker' or 'sh1t' would work as entries too.
create function public.name_bad_word(p_name text, p_kinds text[])
returns text language sql stable security definer set search_path = ''
as $$
  with flat as (select public.name_flat(p_name) as f),
  parts as (
    select regexp_replace(f, '[^a-z]', '', 'g') as joined,
           regexp_split_to_array(f, '[^a-z]+') as words
    from flat
  ),
  list as (
    select r.word, r.match,
           regexp_replace(public.name_flat(r.word), '[^a-z]', '', 'g') as w
    from public.reserved_usernames r
    where r.kind = any (p_kinds)
  )
  select l.word
  from list l, parts p
  where l.w <> ''
    and ((l.match = 'contains'   and strpos(p.joined, l.w) > 0)
      or (l.match = 'whole_word' and (l.w = any (p.words) or l.w = p.joined))
      or (l.match = 'exact'      and l.w = p.joined))
  order by l.word
  limit 1
$$;

-- =====================================================================
-- ONE CHECK FOR EVERY KIND OF NAME
-- =====================================================================
-- p_kind: 'username', 'display' or 'group'. saved is the name as it would
-- be stored; problem is the error code; detail says which rule (for the
-- audit query). Usernames: shape and words only (taken / held names are
-- username_problem's job).
create function public.name_check(
  p_name text, p_kind text,
  out saved text, out problem text, out detail text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  shape record;
  bad   text;
begin
  if p_kind = 'username' then
    if p_name is null or p_name !~ '^[a-z0-9_]{3,20}$' then
      problem := 'BAD_USERNAME'; detail := 'not 3-20 of a-z, 0-9 and _'; return;
    end if;
    bad := public.name_bad_word(p_name, array['reserved', 'offensive']);
    if bad is not null then
      problem := 'USERNAME_NOT_ALLOWED'; detail := 'word "' || bad || '"'; return;
    end if;
    saved := p_name;
    return;
  end if;

  if p_kind not in ('display', 'group') then
    raise exception 'Unknown name kind %', p_kind;
  end if;
  select * into shape
  from public.name_shape_check(p_name, case p_kind when 'display' then 30 else 15 end);
  if shape.saved is null then
    problem := case p_kind when 'display' then 'BAD_DISPLAY_NAME' else 'BAD_GROUP_NAME' end;
    detail := shape.reason || ': ' || shape.detail;
    return;
  end if;
  bad := public.name_bad_word(shape.saved, array['offensive']);
  if bad is not null then
    problem := 'NAME_NOT_ALLOWED'; detail := 'word "' || bad || '"'; return;
  end if;
  saved := shape.saved;
end;
$$;

-- The name as it will be saved, or an error with the code
create function public.checked_name(p_name text, p_kind text)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare r record;
begin
  select * into r from public.name_check(p_name, p_kind);
  if r.problem is not null then raise exception '%', r.problem; end if;
  return r.saved;
end;
$$;

-- =====================================================================
-- CHECKED ON EVERY SAVE
-- =====================================================================

-- Display names: whenever one changes, by any route. Not on insert: the
-- sign-up trigger's placeholder is replaced at step 2, which is checked.
create function public.check_display_name()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.display_name is distinct from old.display_name then
    new.display_name := public.checked_name(new.display_name, 'display');
  end if;
  return new;
end;
$$;

create trigger profiles_display_name
  before update of display_name on public.profiles
  for each row execute function public.check_display_name();

-- Group names: on create and on rename
create function public.check_group_name()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    new.name := public.checked_name(new.name, 'group');
  end if;
  return new;
end;
$$;

create trigger groups_name
  before insert or update of name on public.groups
  for each row execute function public.check_group_name();

-- =====================================================================
-- USERNAMES AND SIGN-UP: the same rules
-- =====================================================================
-- Bodies as in 20261023000000_register.sql, except the marked lines.

create or replace function public.username_problem(p_name text, p_user uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when p_name is null or p_name !~ '^[a-z0-9_]{3,20}$' then 'BAD_USERNAME'
    -- The sign-up trigger's placeholder shape. If someone took one, the
    -- account whose id it matches could never be created.
    when p_name ~ '^user_[0-9a-f]{8}$' then 'USERNAME_NOT_ALLOWED'
    -- Reserved and offensive words, with the better matching (sh1t...)
    when public.name_bad_word(p_name, array['reserved', 'offensive']) is not null
      then 'USERNAME_NOT_ALLOWED'
    when exists (select 1 from public.username_holds h
                 where h.username = p_name and h.user_id <> p_user
                   and h.held_until > now())
      then 'USERNAME_TAKEN'
    when exists (select 1 from public.profiles p
                 where p.username = p_name and p.id <> p_user)
      then 'USERNAME_TAKEN'
  end
$$;

create or replace function public.complete_signup(
  p_username     text,
  p_display_name text,
  p_birth_date   date,
  p_terms        jsonb default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  wanted   text := lower(btrim(p_username));
  shown    text;
  finished timestamptz;
  problem  text;
begin
  if uid is null then raise exception 'Not signed in'; end if;

  -- One save at a time per account: a retry waits for the first one
  select p.onboarded_at into finished
  from public.profiles p where p.id = uid for update;
  if not found then raise exception 'Not signed in'; end if;

  -- Whatever birthday is sent next, a blocked account stays blocked
  if public.is_age_blocked(uid) then raise exception 'AGE_BLOCKED'; end if;
  if finished is not null then return 'ALREADY_ONBOARDED'; end if;

  if public.is_bad_birth_date(p_birth_date) then
    raise exception 'BAD_BIRTH_DATE';
  end if;

  -- A normal answer, not an error, so the block is kept. The birth date
  -- itself is not stored.
  if public.is_under_minimum_age(p_birth_date) then
    insert into public.profile_private (user_id, birth_date, age_blocked_at)
    values (uid, null, now())
    on conflict (user_id) do update set birth_date = null, age_blocked_at = now();
    return 'UNDER_AGE';
  end if;

  -- The shared name rules (BAD_DISPLAY_NAME or NAME_NOT_ALLOWED); the
  -- name is saved as they shape it
  shown := public.checked_name(p_display_name, 'display');

  -- The same lock change_username() takes on this name
  perform pg_advisory_xact_lock(hashtext('username:' || coalesce(wanted, '')));
  problem := public.username_problem(wanted, uid);
  if problem is not null then raise exception '%', problem; end if;

  if p_terms is not null and not public.legal_versions_valid(p_terms) then
    raise exception 'LEGAL_VERSION_NOT_CURRENT';
  end if;
  -- Nobody is onboarded without an acceptance of the current versions,
  -- either from step 1 (the sign-up trigger) or sent now
  if exists (
    select 1 from public.current_legal_versions() c
    where not exists (select 1 from public.legal_acceptances a
                      where a.user_id = uid and a.document = c.document
                        and a.version = c.version)
      and (p_terms ->> c.document) is distinct from c.version
  ) then
    raise exception 'TERMS_NOT_ACCEPTED';
  end if;

  insert into public.legal_acceptances (user_id, document, version, source)
  select uid, c.document, c.version, 'onboarding'
  from public.current_legal_versions() c
  where (p_terms ->> c.document) = c.version
  on conflict (user_id, document, version) do nothing;

  update public.profiles
  set username = wanted, display_name = shown, onboarded_at = now()
  where id = uid;

  -- Their own held name, taken back
  delete from public.username_holds h where h.username = wanted and h.user_id = uid;

  insert into public.profile_private (user_id, birth_date)
  values (uid, p_birth_date)
  on conflict (user_id) do update set birth_date = excluded.birth_date;

  return 'OK';
exception
  -- Two people claimed the same name at the same moment: the unique
  -- constraint lets one through. Everything above is undone.
  when unique_violation then raise exception 'USERNAME_TAKEN';
end;
$$;

-- =====================================================================
-- NAMES THAT ALREADY BREAK THE RULES (ADMIN ONLY)
-- =====================================================================
-- Every existing username, display name and group name that would be
-- refused now, or saved differently (e.g. a trailing non-breaking
-- space), and which rule. Nothing is changed: you decide each one. Run
-- before deploying, and again after any change to the word list:
--   select * from public.name_audit();   (supabase/admin/name_audit.sql)
create function public.name_audit()
returns table (kind text, account uuid, group_id uuid, name text,
               problem text, detail text, saved_as text)
language sql stable security definer set search_path = ''
as $$
  select 'username', p.id, null::uuid, p.username, c.problem, c.detail, c.saved
  from public.profiles p, public.name_check(p.username, 'username') c
  where p.onboarded_at is not null and c.problem is not null
  union all
  select 'display', p.id, null::uuid, p.display_name, c.problem,
         coalesce(c.detail, 'saved differently'), c.saved
  from public.profiles p, public.name_check(p.display_name, 'display') c
  where p.onboarded_at is not null
    and (c.problem is not null or c.saved is distinct from p.display_name)
  union all
  select 'group', g.owner_id, g.id, g.name, c.problem,
         coalesce(c.detail, 'saved differently'), c.saved
  from public.groups g, public.name_check(g.name, 'group') c
  where c.problem is not null or c.saved is distinct from g.name
  order by 1, 4
$$;

-- =====================================================================
-- PERMISSIONS
-- =====================================================================
-- Only the triggers and functions above (and the SQL Editor) use these.
-- The word list must never be readable from the app.
revoke all on function public.name_refused_char(integer) from public, anon, authenticated;
revoke all on function public.name_emoji_char(integer) from public, anon, authenticated;
revoke all on function public.name_shape_check(text, integer) from public, anon, authenticated;
revoke all on function public.name_shape(text, integer) from public, anon, authenticated;
revoke all on function public.name_flat(text) from public, anon, authenticated;
revoke all on function public.name_bad_word(text, text[]) from public, anon, authenticated;
revoke all on function public.name_check(text, text) from public, anon, authenticated;
revoke all on function public.checked_name(text, text) from public, anon, authenticated;
revoke all on function public.check_display_name() from public, anon, authenticated;
revoke all on function public.check_group_name() from public, anon, authenticated;
revoke all on function public.name_audit() from public, anon, authenticated;
