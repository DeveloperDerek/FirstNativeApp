-- StepTracker: push notifications, Phase 3 (step-tracker-notifications.txt,
-- section 4). When someone sends you a friend request, your phones get
-- "@sam wants to be friends", with your total waiting count on the app icon.
--
-- Sent from inside the database, like the account cleanup job: a trigger
-- on new requests posts to Expo's push service with pg_net (which sends
-- only once the request is committed), and a pg_cron job reads Expo's
-- answers to remove dead push addresses. No key or secret is stored.

create extension if not exists pg_net;

-- =====================================================================
-- PUSH ADDRESSES: one per device
-- =====================================================================
-- The token is the key, so a device belongs to one account at a time:
-- signing in to another account on the same phone moves it.
create table public.push_devices (
  token      text primary key check (token ~ '^Expo(nent)?PushToken\[.+\]$'),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

create index push_devices_user_idx on public.push_devices (user_id);

-- Never readable or writable from the app, not even your own rows: the
-- functions below add or remove only the calling device's address.
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;

-- Called on every launch while notifications are allowed (tokens can
-- change). A token already saved for another account moves to this one.
create function public.register_push_device(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then return; end if;
  insert into public.push_devices (token, user_id, platform)
  values (p_token, auth.uid(), p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

-- Sign-out. Works for accounts that are not active too (the blocked and
-- Updated Terms screens have a Sign out button), and only ever removes
-- the caller's own address.
create function public.unregister_push_device(p_token text)
returns void language sql security definer set search_path = ''
as $$
  delete from public.push_devices where token = p_token and user_id = auth.uid()
$$;

-- "Sign out other devices" (and every password change): their push
-- addresses go too, or a signed-out phone would keep getting this
-- account's notifications. p_keep = this phone's token, or null.
create function public.unregister_other_push_devices(p_keep text)
returns void language sql security definer set search_path = ''
as $$
  delete from public.push_devices
  where user_id = auth.uid() and token is distinct from p_keep
$$;

revoke execute on function public.register_push_device(text, text) from public, anon;
revoke execute on function public.unregister_push_device(text) from public, anon;
revoke execute on function public.unregister_other_push_devices(text) from public, anon;
grant execute on function public.register_push_device(text, text) to authenticated;
grant execute on function public.unregister_push_device(text) to authenticated;
grant execute on function public.unregister_other_push_devices(text) to authenticated;

-- =====================================================================
-- THE "NOTIFICATIONS" SETTING ON PROFILE (no row = on)
-- =====================================================================
create table public.notification_settings (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  push_enabled boolean not null default true
);

alter table public.notification_settings enable row level security;
create policy "notification settings read own" on public.notification_settings
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.notification_settings from anon, authenticated;

create function public.set_push_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'NOT_ACTIVE'; end if;
  insert into public.notification_settings (user_id, push_enabled)
  values (auth.uid(), p_enabled)
  on conflict (user_id) do update set push_enabled = excluded.push_enabled;
end;
$$;

revoke execute on function public.set_push_enabled(boolean) from public, anon;
grant execute on function public.set_push_enabled(boolean) to authenticated;

-- =====================================================================
-- COUNTS FOR ANY USER
-- =====================================================================
-- The push puts the recipient's total on the app icon, so the server has
-- to work out someone else's counts. One function for both, so the icon,
-- the tab badges and the Requests section can't disagree. It spells out
-- the privacy rules the app's own reads get from row level security:
-- both people active (6f), sharing turned on.
create function public.notification_counts_for(p_user uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with live as (
    select public.is_active_user(p_user)
       and exists (select 1 from public.profiles p
                   where p.id = p_user and p.sharing_consent_at is not null) as ok
  ),
  waiting as (
    select q.vote_deadline
    from public.quests q
    where (select ok from live)
      and q.status = 'voting'
      and q.vote_deadline > now()
      and exists (select 1 from public.group_members m
                  where m.group_id = q.group_id and m.user_id = p_user)
      and not exists (select 1 from public.quest_votes v
                      where v.quest_id = q.id and v.user_id = p_user)
  )
  select jsonb_build_object(
    'friend_requests', case when (select ok from live) then (
      select count(*) from public.friendships f
      where f.addressee_id = p_user and f.status = 'pending'
        and public.is_active_user(f.requester_id))
    else 0 end,
    'quest_votes', (select count(*) from waiting),
    'next_vote_deadline', (select min(vote_deadline) from waiting))
$$;

revoke execute on function public.notification_counts_for(uuid) from public, anon, authenticated;

create or replace function public.notification_counts()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when public.is_active_account()
    then public.notification_counts_for(auth.uid())
    else jsonb_build_object('friend_requests', 0, 'quest_votes', 0,
                            'next_vote_deadline', null) end
$$;

-- =====================================================================
-- SENDING
-- =====================================================================
-- Each post to Expo, so the cleanup job can match its answer (one ticket
-- per token, in order) to the addresses it was sent to.
create table public.push_sends (
  request_id bigint primary key,       -- pg_net's id; the answer lands in net._http_response
  tokens     text[] not null,
  sent_at    timestamptz not null default now()
);

-- Tickets Expo accepted. Its receipt (asked for about 15 minutes later)
-- says whether the phone could actually be reached.
create table public.push_tickets (
  ticket_id          text primary key,
  token              text not null,
  created_at         timestamptz not null default now(),
  receipt_request_id bigint            -- set once the receipt has been asked for
);

alter table public.push_sends   enable row level security;
alter table public.push_tickets enable row level security;
revoke all on public.push_sends, public.push_tickets from anon, authenticated;

-- Server only: never callable from the app, so push addresses can't be
-- used for one user to message another. Checks the recipient again at
-- the moment of sending.
create function public.push_friend_request(fid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  f       public.friendships%rowtype;
  sender  text;
  total   integer;
  counts  jsonb;
  tokens  text[];
  req     bigint;
begin
  select * into f from public.friendships where id = fid;
  if not found or f.status <> 'pending' then return; end if;

  -- Both still active, and the recipient could see the request (the same
  -- rules as their Requests section, which needs sharing turned on)
  counts := public.notification_counts_for(f.addressee_id);
  if not public.is_active_user(f.requester_id)
     or (counts->>'friend_requests')::int = 0 then
    return;
  end if;
  if not coalesce((select push_enabled from public.notification_settings
                   where user_id = f.addressee_id), true) then
    return;
  end if;

  select array_agg(token order by token) into tokens
  from public.push_devices where user_id = f.addressee_id;
  if tokens is null then return; end if;

  select username into sender from public.profiles where id = f.requester_id;
  total := (counts->>'friend_requests')::int + (counts->>'quest_votes')::int;

  select net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body    := (select jsonb_agg(jsonb_build_object(
                  'to', t,
                  'title', 'New friend request',
                  'body', '@' || sender || ' wants to be friends',
                  'sound', 'default',
                  'badge', total,
                  -- Tapping it opens the Friends tab
                  'data', jsonb_build_object('url', '/friends')) order by t)
                from unnest(tokens) t))
  into req;

  insert into public.push_sends (request_id, tokens) values (req, tokens);
end;
$$;

revoke execute on function public.push_friend_request(uuid) from public, anon, authenticated;

-- A failed push must never stop the friend request itself
create function public.on_friend_request()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform public.push_friend_request(new.id);
  exception when others then
    raise warning 'Friend request push failed: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger friendships_push
  after insert on public.friendships
  for each row when (new.status = 'pending')
  execute function public.on_friend_request();

-- =====================================================================
-- CLEANING UP DEAD PUSH ADDRESSES
-- =====================================================================
-- Expo says "DeviceNotRegistered" when the app was deleted or
-- notifications were turned off, either at once (in the ticket) or later
-- (in the receipt). Either way that address is removed. pg_net keeps
-- answers for 6 hours; anything older without one is let go.
create function public.push_cleanup()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  s     record;
  r     record;
  i     integer;
  t     jsonb;
  ids   text[];
  req   bigint;
begin
  -- 1. Answers to sends: one ticket per token, in order
  for s in
    select ps.request_id, ps.tokens, resp.status_code, resp.content
    from public.push_sends ps
    join net._http_response resp on resp.id = ps.request_id
  loop
    if s.status_code = 200 then
      for i in 1 .. coalesce(array_length(s.tokens, 1), 0) loop
        t := (s.content::jsonb)->'data'->(i - 1);
        if t->>'status' = 'ok' then
          insert into public.push_tickets (ticket_id, token)
          values (t->>'id', s.tokens[i]) on conflict do nothing;
        elsif t->'details'->>'error' = 'DeviceNotRegistered' then
          delete from public.push_devices where token = s.tokens[i];
        end if;
      end loop;
    end if;
    delete from public.push_sends where request_id = s.request_id;
  end loop;
  delete from public.push_sends where sent_at < now() - interval '6 hours';

  -- 2. Ask for receipts about 15 minutes after sending (up to 1000 a call)
  loop
    select array_agg(ticket_id) into ids from (
      select ticket_id from public.push_tickets
      where receipt_request_id is null and created_at < now() - interval '15 minutes'
      limit 1000) x;
    exit when ids is null;
    select net.http_post(
      url     := 'https://exp.host/--/api/v2/push/getReceipts',
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
      body    := jsonb_build_object('ids', to_jsonb(ids)))
    into req;
    update public.push_tickets set receipt_request_id = req where ticket_id = any (ids);
  end loop;

  -- 3. Receipts that have come back
  for r in
    select pt.ticket_id, pt.token, resp.status_code, resp.content
    from public.push_tickets pt
    join net._http_response resp on resp.id = pt.receipt_request_id
  loop
    if r.status_code = 200
       and (r.content::jsonb)->'data'->r.ticket_id->'details'->>'error' = 'DeviceNotRegistered' then
      delete from public.push_devices where token = r.token;
    end if;
    delete from public.push_tickets where ticket_id = r.ticket_id;
  end loop;
  delete from public.push_tickets where created_at < now() - interval '6 hours';
end;
$$;

revoke all on function public.push_cleanup() from public, anon, authenticated;

select cron.schedule('push-cleanup', '*/10 * * * *', $$ select public.push_cleanup() $$);
