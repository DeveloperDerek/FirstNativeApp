-- StepTracker: group quests, Stage A (step-tracker-group-quests.txt).
-- A group proposes a quest, everyone must accept, then the party walks
-- toward one shared goal inside a time window. Coins are shared equally.
--
-- There is no scheduler: the quest moves forward (voting -> active ->
-- completed/failed -> paid) whenever anyone in the group looks at it or
-- uploads steps. quest_advance() below does that, using the server clock.
--
-- The app never writes these tables. It only calls propose_quest(),
-- vote_quest(), upload_quest_steps(), group_quest(), my_quests() and
-- mark_quest_seen().

-- =====================================================================
-- QUEST TYPES (section 3). Stage A sells Sprint and Patrol only; the
-- longer ones arrive in Stage C. Must match src/quests/rules.ts.
-- =====================================================================
create table public.quest_types (
  id     text primary key,
  name   text not null,
  hours  integer not null check (hours between 1 and 48),
  goal   integer not null check (goal > 0),
  active boolean not null default true
);

insert into public.quest_types (id, name, hours, goal, active) values
  ('sprint',     'Sprint',           2,   8000, true),
  ('patrol',     'Patrol',           4,  15000, true),
  ('expedition', 'Expedition',       8,  30000, false),
  ('day_trek',   'Day Trek',        12,  50000, false),
  ('weekend',    'Weekend Journey', 48, 120000, false);

-- =====================================================================
-- TABLES (section 9)
-- =====================================================================
create table public.quests (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  type_id       text not null references public.quest_types(id),
  proposer_id   uuid references public.profiles(id) on delete set null,
  status        text not null default 'voting'
                check (status in ('voting', 'active', 'completed', 'failed', 'cancelled')),
  -- null = "as soon as everyone accepts"
  start_asap    boolean not null,
  vote_deadline timestamptz not null,
  -- Set when voting finishes (for a set time, starts_at is known up front)
  starts_at     timestamptz,
  ends_at       timestamptz,
  goal          integer not null,         -- fixed when proposed (difficulty comes later)
  party_size    integer,                  -- fixed when voting finishes
  total_steps   integer not null default 0,
  completed_at  timestamptz,              -- the moment the goal was reached
  cancelled_at  timestamptz,
  declined_by   uuid references public.profiles(id) on delete set null,
  -- After the window and grace period: how the coins were worked out
  settled_at    timestamptz,
  step_coins    integer,
  multiplier    numeric(3, 1),
  coins_each    integer,
  created_at    timestamptz not null default now()
);

create index quests_group_idx on public.quests (group_id, created_at desc);

-- One row per group member who has answered. Members who have not
-- answered yet simply have no row.
create table public.quest_votes (
  quest_id uuid not null references public.quests(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  accepted boolean not null,
  voted_at timestamptz not null default now(),
  primary key (quest_id, user_id)
);

-- The party: the group as it was when voting finished
create table public.quest_party (
  quest_id     uuid not null references public.quests(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  steps        integer not null default 0,   -- their counted quest steps so far
  uploaded_at  timestamptz,
  coins_paid   integer,                       -- null = not paid (yet)
  result_seen  boolean not null default false,
  primary key (quest_id, user_id)
);

create index quest_party_user_idx on public.quest_party (user_id);

-- Steps per hour of the window, replaced on every upload. hour_index 0
-- is starts_at to starts_at + 1 hour, and so on; the last piece is cut
-- to ends_at.
create table public.quest_hours (
  quest_id   uuid not null references public.quests(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  hour_index integer not null check (hour_index >= 0),
  steps      integer not null check (steps between 0 and 15000),
  primary key (quest_id, user_id, hour_index)
);

alter table public.quest_types enable row level security;
alter table public.quests      enable row level security;
alter table public.quest_votes enable row level security;
alter table public.quest_party enable row level security;
alter table public.quest_hours enable row level security;

-- Read-only for group members. No insert, update or delete policies:
-- only the functions below write.
create policy "quest types read" on public.quest_types
  for select to authenticated using (true);
create policy "quests read" on public.quests
  for select to authenticated using (public.is_group_member(group_id));
create policy "quest votes read" on public.quest_votes
  for select to authenticated
  using (exists (select 1 from public.quests q
                 where q.id = quest_id and public.is_group_member(q.group_id)));
create policy "quest party read" on public.quest_party
  for select to authenticated
  using (exists (select 1 from public.quests q
                 where q.id = quest_id and public.is_group_member(q.group_id)));
create policy "quest hours read" on public.quest_hours
  for select to authenticated
  using (exists (select 1 from public.quests q
                 where q.id = quest_id and public.is_group_member(q.group_id)));

-- =====================================================================
-- RULES
-- =====================================================================
create function public.quest_grace()
returns interval language sql immutable set search_path = ''
as $$ select interval '1 hour' $$;

create function public.quest_cooldown()
returns interval language sql immutable set search_path = ''
as $$ select interval '1 hour' $$;

-- Coins each party member gets (section 5). Must match questCoins() in
-- src/quests/rules.ts.
--   1 coin per 200 steps, counting up to 150% of the goal
--   x (1 + 0.2 per member after the first), at most x2.5
--   split equally, rounded, at least 10 each
create function public.quest_multiplier(party integer)
returns numeric language sql immutable set search_path = ''
as $$ select least(2.5, 1 + 0.2 * (greatest(party, 1) - 1))::numeric $$;

create function public.quest_step_coins(steps integer, goal integer)
returns integer language sql immutable set search_path = ''
as $$ select (least(steps, goal * 3 / 2) / 200)::integer $$;

create function public.quest_coins_each(steps integer, goal integer, party integer)
returns integer language sql immutable set search_path = ''
as $$
  select greatest(10, round(public.quest_step_coins(steps, goal)
                            * public.quest_multiplier(party)
                            / greatest(party, 1)))::integer
$$;

-- =====================================================================
-- MOVING A QUEST FORWARD
-- =====================================================================
-- Called at the start of every quest function. Safe to call any number
-- of times: it only does what the clock and the votes already decided.
create function public.quest_advance(qid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q          public.quests%rowtype;
  t          public.quest_types%rowtype;
  everyone   boolean;
  daily_cap  constant integer := 600;
  member     record;
  earned     integer;
  pay        integer;
  today_from timestamptz;
begin
  select * into q from public.quests where id = qid for update;
  if not found then return; end if;
  select * into t from public.quest_types where id = q.type_id;

  -- VOTING: locked in once every current group member has accepted.
  -- Anyone who joined during voting has to accept too.
  if q.status = 'voting' then
    select bool_and(coalesce(v.accepted, false)) into everyone
    from public.group_members m
    left join public.quest_votes v on v.quest_id = q.id and v.user_id = m.user_id
    where m.group_id = q.group_id;

    if coalesce(everyone, false)
       and (select count(*) from public.group_members m where m.group_id = q.group_id) >= 2
       and now() < q.vote_deadline then
      q.starts_at  := case when q.start_asap then now() else q.starts_at end;
      q.ends_at    := q.starts_at + make_interval(hours => t.hours);
      q.status     := 'active';
      q.party_size := (select count(*) from public.group_members m where m.group_id = q.group_id);

      insert into public.quest_party (quest_id, user_id)
      select q.id, m.user_id from public.group_members m where m.group_id = q.group_id;

      update public.quests
      set status = q.status, starts_at = q.starts_at, ends_at = q.ends_at,
          party_size = q.party_size
      where id = q.id;
    elsif now() >= q.vote_deadline then
      -- Not everyone answered in time: cancelled quietly
      update public.quests set status = 'cancelled', cancelled_at = q.vote_deadline
      where id = q.id;
      return;
    else
      return;
    end if;
  end if;

  -- ACTIVE: failed only once the grace period is over. (Completed is
  -- set by upload_quest_steps() the moment the goal is reached.)
  if q.status = 'active' and now() >= q.ends_at + public.quest_grace() then
    q.status := 'failed';
    update public.quests set status = 'failed' where id = q.id;
  end if;

  -- PAID: after the window and grace period, once
  if q.status in ('completed', 'failed') and q.settled_at is null
     and now() >= q.ends_at + public.quest_grace() then
    if q.status = 'completed' then
      q.step_coins := public.quest_step_coins(q.total_steps, q.goal);
      q.multiplier := public.quest_multiplier(q.party_size);
      q.coins_each := public.quest_coins_each(q.total_steps, q.goal, q.party_size);
    end if;

    update public.quests
    set settled_at = now(), step_coins = q.step_coins,
        multiplier = q.multiplier, coins_each = q.coins_each
    where id = q.id;

    if q.status = 'completed' then
      -- The daily cap is counted per shop day, like the daily shop
      today_from := (public.shop_day()::timestamp at time zone 'America/Los_Angeles');

      -- Only party members who are still in the group and still share
      -- their steps are paid (section 8)
      for member in
        select p.user_id
        from public.quest_party p
        join public.group_members m on m.group_id = q.group_id and m.user_id = p.user_id
        join public.profiles pr on pr.id = p.user_id and pr.sharing_consent_at is not null
        where p.quest_id = q.id
      loop
        -- Lock the wallet: two quests paying at once must both see the cap
        insert into public.wallets (user_id) values (member.user_id)
        on conflict (user_id) do nothing;
        perform 1 from public.wallets w where w.user_id = member.user_id for update;

        select coalesce(sum(c.amount), 0) into earned
        from public.coin_transactions c
        where c.user_id = member.user_id and c.reason = 'quest'
          and c.created_at >= today_from;

        pay := least(q.coins_each, greatest(0, daily_cap - earned));

        insert into public.coin_transactions (user_id, amount, reason, ref)
        values (member.user_id, pay, 'quest', q.id::text)
        on conflict (user_id, reason, ref) do nothing;
        if found then
          update public.wallets set balance = balance + pay where user_id = member.user_id;
          update public.quest_party set coins_paid = pay
          where quest_id = q.id and user_id = member.user_id;
        end if;
      end loop;
    end if;
  end if;
end;
$$;

-- Nobody calls this directly; the functions below do
revoke all on function public.quest_advance(uuid) from public, anon, authenticated;

-- The group's quests that may still need moving forward
create function public.quest_advance_group(gid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare qid uuid;
begin
  for qid in
    select id from public.quests
    where group_id = gid
      and (status in ('voting', 'active')
           or (status in ('completed', 'failed') and settled_at is null))
  loop
    perform public.quest_advance(qid);
  end loop;
end;
$$;

revoke all on function public.quest_advance_group(uuid) from public, anon, authenticated;

-- =====================================================================
-- PROPOSE (section 2.1)
-- =====================================================================
-- p_starts_at = null means "as soon as everyone accepts"
create function public.propose_quest(gid uuid, p_type text, p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  t        public.quest_types%rowtype;
  last_end timestamptz;
  qid      uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_group_member(gid) then raise exception 'NOT_A_MEMBER'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;

  select * into t from public.quest_types where id = p_type and active;
  if not found then raise exception 'UNKNOWN_QUEST'; end if;

  -- Two proposals at the same moment: the second waits, then sees the first
  perform pg_advisory_xact_lock(hashtext('quest:' || gid::text));
  perform public.quest_advance_group(gid);

  if (select count(*) from public.group_members where group_id = gid) < 2 then
    raise exception 'GROUP_TOO_SMALL';
  end if;

  -- Only one quest in voting or under way at a time. A quest still in
  -- its window or grace period counts as under way.
  if exists (select 1 from public.quests
             where group_id = gid
               and (status in ('voting', 'active')
                    or (status = 'completed' and settled_at is null))) then
    raise exception 'QUEST_IN_PROGRESS';
  end if;

  -- 1 hour of rest after the last quest ended or was cancelled
  select max(coalesce(cancelled_at, ends_at)) into last_end
  from public.quests where group_id = gid;
  if last_end is not null and now() < last_end + public.quest_cooldown() then
    raise exception 'QUEST_COOLDOWN';
  end if;

  if p_starts_at is not null
     and (p_starts_at < now() + interval '5 minutes'
          or p_starts_at > now() + interval '24 hours') then
    raise exception 'BAD_START_TIME';
  end if;

  insert into public.quests (group_id, type_id, proposer_id, start_asap,
                             vote_deadline, starts_at, goal)
  values (gid, t.id, uid, p_starts_at is null,
          coalesce(p_starts_at, now() + interval '24 hours'), p_starts_at, t.goal)
  returning id into qid;

  -- The proposer counts as having accepted
  insert into public.quest_votes (quest_id, user_id, accepted) values (qid, uid, true);
  return qid;
end;
$$;

-- =====================================================================
-- VOTE (section 2.2)
-- =====================================================================
create function public.vote_quest(qid uuid, p_accept boolean)
returns text                              -- the quest's status afterwards
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q   public.quests%rowtype;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select * into q from public.quests where id = qid;
  if not found or not public.is_group_member(q.group_id) then
    raise exception 'NOT_A_MEMBER';
  end if;

  perform pg_advisory_xact_lock(hashtext('quest:' || q.group_id::text));
  perform public.quest_advance(qid);
  select * into q from public.quests where id = qid;
  if q.status <> 'voting' then raise exception 'VOTING_CLOSED'; end if;

  -- Sharing is needed to take part, like the daily reward
  if p_accept and not public.has_sharing_consent() then
    raise exception 'SHARING_REQUIRED';
  end if;

  insert into public.quest_votes (quest_id, user_id, accepted) values (qid, uid, p_accept)
  on conflict (quest_id, user_id)
  do update set accepted = excluded.accepted, voted_at = now();

  if not p_accept then
    -- Anyone declines: cancelled at once, and the group sees who
    update public.quests
    set status = 'cancelled', cancelled_at = now(), declined_by = uid
    where id = qid;
    return 'cancelled';
  end if;

  perform public.quest_advance(qid);
  return (select status from public.quests where id = qid);
end;
$$;

-- =====================================================================
-- UPLOAD STEPS (section 6)
-- =====================================================================
-- p_hours: [{"hour": 0, "steps": 1240}, {"hour": 1, "steps": 3020}, ...]
-- Replaces this member's earlier upload for the quest.
create function public.upload_quest_steps(qid uuid, p_hours jsonb)
returns integer                           -- the group's total afterwards
language plpgsql security definer set search_path = ''
as $$
declare
  uid        uuid := auth.uid();
  q          public.quests%rowtype;
  pieces     integer;
  hour_sum   integer;
  daily_sum  integer;
  counted    integer;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;

  select * into q from public.quests where id = qid;
  if not found then raise exception 'NOT_IN_PARTY'; end if;
  perform pg_advisory_xact_lock(hashtext('quest:' || q.group_id::text));
  perform public.quest_advance(qid);
  select * into q from public.quests where id = qid;

  if not exists (select 1 from public.quest_party
                 where quest_id = qid and user_id = uid) then
    raise exception 'NOT_IN_PARTY';
  end if;
  -- Left the group: steps so far still count, new ones do not
  if not public.is_group_member(q.group_id) then raise exception 'NOT_A_MEMBER'; end if;

  -- The server's clock decides the window and the grace period
  if q.status not in ('active', 'completed')
     or now() < q.starts_at
     or now() >= q.ends_at + public.quest_grace() then
    raise exception 'QUEST_NOT_OPEN';
  end if;

  pieces := ceil(extract(epoch from q.ends_at - q.starts_at) / 3600)::integer;

  if jsonb_typeof(p_hours) <> 'array' then raise exception 'BAD_STEPS'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_hours) e
    where coalesce(jsonb_typeof(e->'hour'), '') <> 'number'
       or coalesce(jsonb_typeof(e->'steps'), '') <> 'number'
       or (e->>'hour')::integer < 0 or (e->>'hour')::integer >= pieces
       or (e->>'steps')::integer < 0
       -- no steps for an hour that has not started yet
       or q.starts_at + make_interval(hours => (e->>'hour')::integer) > now()
  ) then
    raise exception 'BAD_STEPS';
  end if;
  -- More than 15,000 in an hour is impossible: refuse the whole upload
  if exists (select 1 from jsonb_array_elements(p_hours) e
             where (e->>'steps')::integer > 15000) then
    raise exception 'TOO_MANY_STEPS';
  end if;

  delete from public.quest_hours where quest_id = qid and user_id = uid;
  insert into public.quest_hours (quest_id, user_id, hour_index, steps)
  select qid, uid, (e->>'hour')::integer, max((e->>'steps')::integer)
  from jsonb_array_elements(p_hours) e
  group by (e->>'hour')::integer;

  select coalesce(sum(steps), 0) into hour_sum
  from public.quest_hours where quest_id = qid and user_id = uid;

  -- Never more than their step total for those days. Daily rows are
  -- local days, so look a day either side of the window.
  select coalesce(sum(steps), 0) into daily_sum
  from public.daily_steps
  where user_id = uid
    and day between (q.starts_at at time zone 'utc')::date - 1
                and (q.ends_at at time zone 'utc')::date + 1;
  counted := least(hour_sum, daily_sum);

  update public.quest_party set steps = counted, uploaded_at = now()
  where quest_id = qid and user_id = uid;

  -- Everyone's steps count, including people who have since left
  update public.quests
  set total_steps = (select coalesce(sum(steps), 0) from public.quest_party where quest_id = qid)
  where id = qid
  returning * into q;

  -- Goal reached: completed straight away, even in the grace period
  if q.status = 'active' and q.total_steps >= q.goal then
    update public.quests set status = 'completed', completed_at = now() where id = qid;
  end if;

  return q.total_steps;
end;
$$;

-- =====================================================================
-- READ
-- =====================================================================
-- The group's current quest (voting, under way, or the most recent
-- result), with each member's vote and steps. Moves it forward first.
-- A cancelled quest is shown only during the cooldown after it, and a
-- result for a day after it was paid.
create function public.group_quest(gid uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  q       public.quests%rowtype;
  members jsonb;
  ready   timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_group_member(gid) then raise exception 'NOT_A_MEMBER'; end if;

  perform pg_advisory_xact_lock(hashtext('quest:' || gid::text));
  perform public.quest_advance_group(gid);

  select max(coalesce(cancelled_at, ends_at)) + public.quest_cooldown() into ready
  from public.quests where group_id = gid;

  select * into q from public.quests
  where group_id = gid
    and (status <> 'cancelled' or now() < cancelled_at + public.quest_cooldown())
    and (settled_at is null or now() < settled_at + interval '24 hours')
  order by created_at desc limit 1;

  -- Everyone involved: current group members (they vote) plus anyone in
  -- the party who has since left (their steps still count). With no
  -- quest, q.id is null and this is just the group, for the proposal.
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.steps desc, r.display_name), '[]')
  into members
  from (
    select
      pr.id as user_id,
      pr.display_name,
      pr.avatar,
      (pr.sharing_consent_at is not null) as sharing,
      v.accepted,
      (p.user_id is not null) as in_party,
      (m.user_id is not null) as in_group,
      coalesce(p.steps, 0) as steps,
      p.uploaded_at,
      p.coins_paid,
      -- only for people still in the group, like the player card
      case when m.user_id is not null then ls.seen_at end as last_seen
    from public.profiles pr
    left join public.group_members m on m.group_id = gid and m.user_id = pr.id
    left join public.quest_party p on p.quest_id = q.id and p.user_id = pr.id
    left join public.quest_votes v on v.quest_id = q.id and v.user_id = pr.id
    left join public.last_seen ls on ls.user_id = pr.id
    where m.user_id is not null or p.user_id is not null
  ) r;

  return jsonb_build_object(
    'quest', case when q.id is null then null else jsonb_build_object(
      'id', q.id,
      'type_id', q.type_id,
      'proposer_id', q.proposer_id,
      'status', q.status,
      'start_asap', q.start_asap,
      'vote_deadline', q.vote_deadline,
      'starts_at', q.starts_at,
      'ends_at', q.ends_at,
      'grace_ends_at', q.ends_at + public.quest_grace(),
      'goal', q.goal,
      'party_size', q.party_size,
      'total_steps', q.total_steps,
      'completed_at', q.completed_at,
      'cancelled_at', q.cancelled_at,
      'declined_by', q.declined_by,
      'settled_at', q.settled_at,
      'step_coins', q.step_coins,
      'multiplier', q.multiplier,
      'coins_each', q.coins_each) end,
    'members', members,
    'next_quest_at', ready,
    'server_now', now());
end;
$$;

-- Every quest across my groups that needs my attention: for the banners
-- (Stage A has no push notifications) and for uploading my steps.
create function public.my_quests()
returns table (
  quest_id      uuid,
  group_id      uuid,
  group_name    text,
  type_id       text,
  status        text,
  proposer_name text,
  my_vote       boolean,
  in_party      boolean,
  waiting_for   text[],
  vote_deadline timestamptz,
  starts_at     timestamptz,
  ends_at       timestamptz,
  goal          integer,
  total_steps   integer,
  settled_at    timestamptz,
  coins_paid    integer,
  result_seen   boolean
)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;

  for gid in select m.group_id from public.group_members m where m.user_id = uid loop
    perform pg_advisory_xact_lock(hashtext('quest:' || gid::text));
    perform public.quest_advance_group(gid);
  end loop;

  return query
    select
      q.id, q.group_id, g.name, q.type_id, q.status,
      pp.display_name,
      v.accepted,
      (p.user_id is not null),
      case when q.status = 'voting' then
        array(select coalesce(pr.display_name, 'Someone')
              from public.group_members m
              join public.profiles pr on pr.id = m.user_id
              left join public.quest_votes v2 on v2.quest_id = q.id and v2.user_id = m.user_id
              where m.group_id = q.group_id and v2.user_id is null
              order by pr.display_name)
      end,
      q.vote_deadline, q.starts_at, q.ends_at, q.goal, q.total_steps,
      q.settled_at, p.coins_paid, coalesce(p.result_seen, false)
    from public.quests q
    join public.groups g on g.id = q.group_id
    join public.group_members me on me.group_id = q.group_id and me.user_id = uid
    left join public.profiles pp on pp.id = q.proposer_id
    left join public.quest_votes v on v.quest_id = q.id and v.user_id = uid
    left join public.quest_party p on p.quest_id = q.id and p.user_id = uid
    where q.status = 'voting'
       or (q.status in ('active', 'completed') and q.settled_at is null)
       -- a finished quest I took part in and have not seen the result of
       or (q.status in ('completed', 'failed') and q.settled_at is not null
           and p.user_id is not null and not p.result_seen
           and q.settled_at > now() - interval '7 days')
    order by q.created_at desc;
end;
$$;

-- The member has seen the result: stop showing its banner
create function public.mark_quest_seen(qid uuid)
returns void language sql security definer set search_path = ''
as $$
  update public.quest_party set result_seen = true
  where quest_id = qid and user_id = auth.uid()
    and exists (select 1 from public.quests q where q.id = qid and q.settled_at is not null);
$$;

revoke execute on function public.propose_quest(uuid, text, timestamptz) from public, anon;
revoke execute on function public.vote_quest(uuid, boolean) from public, anon;
revoke execute on function public.upload_quest_steps(uuid, jsonb) from public, anon;
revoke execute on function public.group_quest(uuid) from public, anon;
revoke execute on function public.my_quests() from public, anon;
revoke execute on function public.mark_quest_seen(uuid) from public, anon;
grant execute on function public.propose_quest(uuid, text, timestamptz) to authenticated;
grant execute on function public.vote_quest(uuid, boolean) to authenticated;
grant execute on function public.upload_quest_steps(uuid, jsonb) to authenticated;
grant execute on function public.group_quest(uuid) to authenticated;
grant execute on function public.my_quests() to authenticated;
grant execute on function public.mark_quest_seen(uuid) to authenticated;
