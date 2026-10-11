-- StepTracker: a group carries on when its owner goes
-- (step-tracker-group-owners.txt, Part A).
--
-- A group always has an owner who is in it. When the owner leaves, or
-- their account is deleted (by them, an admin or the under-age job), the
-- group passes to the member who has been in it longest, active members
-- first, and keeps its members, quests and invite code. Only a group with
-- nobody else in it is deleted. The database does this, so every route
-- is covered, including older app builds.

-- =====================================================================
-- WHO IS NEXT
-- =====================================================================
-- INTERNAL. The longest-standing active member other than `leaving`; if
-- none is active, the longest-standing member; null if nobody is left.
create function public.next_owner_of(gid uuid, leaving uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select m.user_id
  from public.group_members m
  where m.group_id = gid and m.user_id is distinct from leaving
  order by public.is_active_user(m.user_id) desc, m.joined_at, m.user_id
  limit 1
$$;

-- INTERNAL. "You're now the owner of <group>", if they have push on. A
-- failed push never stops the handover.
create function public.push_new_owner(gid uuid, person uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  tokens text[];
  gname  text;
  req    bigint;
begin
  if not public.is_active_user(person)
     or not coalesce((select s.push_enabled from public.notification_settings s
                      where s.user_id = person), true) then
    return;
  end if;
  select array_agg(d.token order by d.token) into tokens
  from public.push_devices d where d.user_id = person;
  if tokens is null then return; end if;
  select g.name into gname from public.groups g where g.id = gid;

  select net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body    := (select jsonb_agg(jsonb_build_object(
                  'to', t,
                  'title', 'New group owner',
                  'body', 'You''re now the owner of ' || gname,
                  'sound', 'default',
                  -- Tapping it opens the group
                  'data', jsonb_build_object('url', '/groups/' || gid)) order by t)
                from unnest(tokens) t))
  into req;
  insert into public.push_sends (request_id, tokens) values (req, tokens);
exception when others then
  raise warning 'New owner push failed: %', sqlerrm;
end;
$$;

-- =====================================================================
-- THE HANDOVER
-- =====================================================================
-- INTERNAL. If `leaving` owns the group, it passes to the next owner, or
-- the group is deleted when nobody is left. Locks the group row first, so
-- two things at once (the owner leaving while the next member leaves)
-- can't both pick the same person or leave it ownerless. Returns the
-- owner afterwards (null if the group is gone).
create function public.pass_group_on(gid uuid, leaving uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  owner uuid;
  nxt   uuid;
begin
  select g.owner_id into owner from public.groups g where g.id = gid for update;
  if not found then return null; end if;
  if owner is distinct from leaving then return owner; end if;

  nxt := public.next_owner_of(gid, leaving);
  if nxt is null then
    delete from public.groups where id = gid;
    return null;
  end if;
  update public.groups set owner_id = nxt where id = gid;
  perform public.push_new_owner(gid, nxt);
  return nxt;
end;
$$;

-- The owner's membership removed, by any route (Leave group, an older
-- app, a direct call): pass the group on. When the whole group is being
-- deleted its row is already gone, so this does nothing.
--
-- EVERY removal locks the group row first, then checks who owns it with
-- a fresh read. Otherwise a member leaving at the same moment as the
-- owner could be picked as the next owner while on the way out
-- (supabase/tests/concurrency/group_owner_race.sh).
create function public.on_member_removed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.groups g where g.id = old.group_id for update;
  if exists (select 1 from public.groups g
             where g.id = old.group_id and g.owner_id = old.user_id) then
    perform public.pass_group_on(old.group_id, old.user_id);
  end if;
  return null;
end;
$$;

create trigger group_members_pass_on
  after delete on public.group_members
  for each row execute function public.on_member_removed();

-- An account being deleted: every group it owns passes on first (before
-- its membership rows go)
create function public.pass_groups_on_account_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare gid uuid;
begin
  for gid in select g.id from public.groups g where g.owner_id = old.id order by g.id loop
    perform public.pass_group_on(gid, old.id);
  end loop;
  return old;
end;
$$;

create trigger profiles_pass_groups_on
  before delete on public.profiles
  for each row execute function public.pass_groups_on_account_delete();

-- Groups no longer go with their owner's account: the step above always
-- moves or deletes them first, so this only ever stops a mistake
alter table public.groups drop constraint groups_owner_id_fkey;
alter table public.groups add constraint groups_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete restrict;

-- =====================================================================
-- FOR THE APP
-- =====================================================================

-- Who would take over if you (the owner) left now, for the Leave group
-- confirmation. Null if you're the only member.
create function public.next_group_owner(gid uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare nxt uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not exists (select 1 from public.groups g where g.id = gid and g.owner_id = auth.uid()) then
    raise exception 'NOT_THE_OWNER';
  end if;
  nxt := public.next_owner_of(gid, auth.uid());
  if nxt is null then return null; end if;
  return (select jsonb_build_object('user_id', p.id, 'username', p.username,
                                    'display_name', p.display_name)
          from public.profiles p where p.id = nxt);
end;
$$;

-- The owner hands the group over on purpose, to a current active member.
-- The old owner stays in the group.
create function public.make_group_owner(gid uuid, person uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare owner uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  select g.owner_id into owner from public.groups g where g.id = gid for update;
  if owner is distinct from auth.uid() then raise exception 'NOT_THE_OWNER'; end if;
  if person is null or person = auth.uid()
     or not exists (select 1 from public.group_members m
                    where m.group_id = gid and m.user_id = person)
     or not public.is_active_user(person) then
    raise exception 'NOT_A_MEMBER';
  end if;
  update public.groups set owner_id = person where id = gid;
  perform public.push_new_owner(gid, person);
end;
$$;

-- =====================================================================
-- OLD DATA
-- =====================================================================
-- Groups whose owner isn't in them (an owner who left before this) pass
-- on now by the same rule. A group with nobody in it is deleted.
do $$
declare g record;
begin
  for g in
    select x.id, x.owner_id from public.groups x
    where not exists (select 1 from public.group_members m
                      where m.group_id = x.id and m.user_id = x.owner_id)
  loop
    perform public.pass_group_on(g.id, g.owner_id);
  end loop;
end;
$$;

-- =====================================================================
-- PERMISSIONS
-- =====================================================================
revoke all on function public.next_owner_of(uuid, uuid) from public, anon, authenticated;
revoke all on function public.push_new_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pass_group_on(uuid, uuid) from public, anon, authenticated;
revoke all on function public.on_member_removed() from public, anon, authenticated;
revoke all on function public.pass_groups_on_account_delete() from public, anon, authenticated;
revoke all on function public.next_group_owner(uuid) from public, anon;
revoke all on function public.make_group_owner(uuid, uuid) from public, anon;
grant execute on function public.next_group_owner(uuid) to authenticated;
grant execute on function public.make_group_owner(uuid, uuid) to authenticated;
