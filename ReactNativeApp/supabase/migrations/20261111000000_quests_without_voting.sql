-- StepTracker: group quests without voting, and a goal that grows with
-- the party (step-tracker-decisions.txt, QUEST-1, QUEST-2 and QUEST-5).
--
-- Any member who shares steps starts a quest, and it is locked in at
-- once: nobody has to accept and nobody can decline. The party is every
-- active member sharing steps at that moment; anyone joining later isn't
-- in it. A quest for a set time is under way (status 'active') from the
-- moment it is started, and takes steps from its start time.
--
-- The goal is the quest type's goal for 2 people plus 10% for each
-- member after the second, up to 8 members (x1.6), rounded to 100 steps.
--
-- quest_votes, vote_deadline and declined_by stay for the quests that
-- had them; nothing new writes them.

-- Quests still waiting for votes: cancelled, so their groups can start
-- one the new way straight away (no cooldown after these)
update public.quests set status = 'cancelled', cancelled_at = now() - public.quest_cooldown()
where status = 'voting';

alter table public.quests alter column status set default 'active';
alter table public.quests alter column vote_deadline drop not null;

drop function public.vote_quest(uuid, boolean);

-- The goal for a party (QUEST-5). Must match questGoal() in
-- src/quests/rules.ts.
create function public.quest_goal(base integer, party integer)
returns integer language sql immutable set search_path = ''
as $$
  select (round(base * (1 + 0.1 * (least(greatest(party, 2), 8) - 2)) / 100) * 100)::integer
$$;

-- As in 20261023000000_register.sql, without the voting step
create or replace function public.quest_advance(qid uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q          public.quests%rowtype;
  daily_cap  constant integer := 600;
  member     record;
  earned     integer;
  pay        integer;
  today_from timestamptz;
begin
  select * into q from public.quests where id = qid for update;
  if not found then return; end if;

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

-- Starts a quest for the group (any member, QUEST-1). p_starts_at = null
-- means right now. The party is every active member sharing steps.
create or replace function public.propose_quest(gid uuid, p_type text, p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  t        public.quest_types%rowtype;
  last_end timestamptz;
  party    integer;
  starts   timestamptz;
  qid      uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.is_group_member(gid) then raise exception 'NOT_A_MEMBER'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;

  select * into t from public.quest_types where id = p_type and active;
  if not found then raise exception 'UNKNOWN_QUEST'; end if;

  -- Two starts at the same moment: the second waits, then sees the first
  perform pg_advisory_xact_lock(hashtext('quest:' || gid::text));
  perform public.quest_advance_group(gid);

  select count(*) into party
  from public.group_members m
  join public.profiles pr on pr.id = m.user_id and pr.sharing_consent_at is not null
  where m.group_id = gid and public.is_active_user(m.user_id);
  if party < 2 then raise exception 'GROUP_TOO_SMALL'; end if;

  -- Only one quest under way at a time. A quest still in its window or
  -- grace period counts as under way.
  if exists (select 1 from public.quests
             where group_id = gid
               and (status = 'active' or (status = 'completed' and settled_at is null))) then
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
  starts := coalesce(p_starts_at, now());

  insert into public.quests (group_id, type_id, proposer_id, status, start_asap,
                             starts_at, ends_at, goal, party_size)
  values (gid, t.id, uid, 'active', p_starts_at is null,
          starts, starts + make_interval(hours => t.hours),
          public.quest_goal(t.goal, party), party)
  returning id into qid;

  insert into public.quest_party (quest_id, user_id)
  select qid, m.user_id
  from public.group_members m
  join public.profiles pr on pr.id = m.user_id and pr.sharing_consent_at is not null
  where m.group_id = gid and public.is_active_user(m.user_id);

  return qid;
end;
$$;

-- As in 20261023000000_register.sql, without the votes
create or replace function public.group_quest(gid uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  q       public.quests%rowtype;
  members jsonb;
  ready   timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
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

  -- Everyone involved: current group members plus anyone in the party
  -- who has since left (their steps still count). With no quest, q.id is
  -- null and this is just the group, for starting one.
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.steps desc, r.display_name), '[]')
  into members
  from (
    select
      pr.id as user_id,
      pr.display_name,
      pr.avatar,
      (pr.sharing_consent_at is not null) as sharing,
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
    left join public.last_seen ls on ls.user_id = pr.id
    where (m.user_id is not null or p.user_id is not null)
      and public.is_active_user(pr.id)
  ) r;

  return jsonb_build_object(
    'quest', case when q.id is null then null else jsonb_build_object(
      'id', q.id,
      'type_id', q.type_id,
      'proposer_id', q.proposer_id,
      'status', q.status,
      'start_asap', q.start_asap,
      'starts_at', q.starts_at,
      'ends_at', q.ends_at,
      'grace_ends_at', q.ends_at + public.quest_grace(),
      'goal', q.goal,
      'party_size', q.party_size,
      'total_steps', q.total_steps,
      'completed_at', q.completed_at,
      'cancelled_at', q.cancelled_at,
      'settled_at', q.settled_at,
      'step_coins', q.step_coins,
      'multiplier', q.multiplier,
      'coins_each', q.coins_each) end,
    'members', members,
    'next_quest_at', ready,
    'server_now', now());
end;
$$;

-- As in 20261023000000_register.sql, without the votes (so the columns
-- change, and it has to be made again)
drop function public.my_quests();
create function public.my_quests()
returns table (
  quest_id      uuid,
  group_id      uuid,
  group_name    text,
  type_id       text,
  status        text,
  proposer_name text,
  in_party      boolean,
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
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  for gid in select m.group_id from public.group_members m where m.user_id = uid loop
    perform pg_advisory_xact_lock(hashtext('quest:' || gid::text));
    perform public.quest_advance_group(gid);
  end loop;

  return query
    select
      q.id, q.group_id, g.name, q.type_id, q.status,
      pp.display_name,
      (p.user_id is not null),
      q.starts_at, q.ends_at, q.goal, q.total_steps,
      q.settled_at, p.coins_paid, coalesce(p.result_seen, false)
    from public.quests q
    join public.groups g on g.id = q.group_id
    join public.group_members me on me.group_id = q.group_id and me.user_id = uid
    left join public.profiles pp on pp.id = q.proposer_id and public.is_active_user(pp.id)
    left join public.quest_party p on p.quest_id = q.id and p.user_id = uid
    where (q.status in ('active', 'completed') and q.settled_at is null)
       -- a finished quest I took part in and have not seen the result of
       or (q.status in ('completed', 'failed') and q.settled_at is not null
           and p.user_id is not null and not p.result_seen
           and q.settled_at > now() - interval '7 days')
    order by q.created_at desc;
end;
$$;

revoke all on function public.quest_goal(integer, integer) from public, anon, authenticated;
revoke all on function public.my_quests() from public, anon;
grant execute on function public.my_quests() to authenticated;
