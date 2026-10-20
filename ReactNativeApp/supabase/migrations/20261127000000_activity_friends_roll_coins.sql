-- StepTracker: the activity board shows what a friend won with the daily
-- roll, coins too. A goal line now names the prize instead of "reached
-- their goal", so a friend's coins roll needs its amount: "won 250 coins".
-- The roll's coins are a prize, not the wallet; the wallet, prices and the
-- day's own coins stay private.

-- As in 20261125000000_daily_roll.sql, except that prize_coins is sent on
-- friends' goal lines as well:
--   prize_item   the item won that day (yours and friends'), else null
--   prize_coins  the coins won that day (yours and friends'), else null
create or replace function public.activity_feed(
  my_today date,
  before_day date default null,
  before_at timestamptz default null,
  before_id uuid default null,
  before_kind text default null,
  before_ref text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  seen_at timestamptz := coalesce((select n.kudos_seen_at from public.notification_settings n
                                   where n.user_id = auth.uid()), '-infinity');
  result jsonb;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if not public.has_sharing_consent() then raise exception 'SHARING_REQUIRED'; end if;
  if not public.is_today_somewhere(my_today, now()) then raise exception 'BAD_DAY'; end if;
  if (before_day is null) <> (before_at is null) or (before_day is null) <> (before_id is null)
     or (before_day is null) <> (before_kind is null) or (before_day is null) <> (before_ref is null) then
    raise exception 'BAD_CURSOR';
  end if;

  with people as (
    select p.id, p.display_name, p.avatar
    from public.profiles p
    where p.sharing_consent_at is not null
      and (p.id = me
           or (p.id in (select case when f.requester_id = me then f.addressee_id
                                    else f.requester_id end
                        from public.friendships f
                        where f.status = 'accepted'
                          and (f.requester_id = me or f.addressee_id = me))
               and public.can_see(p.id)))
  ),
  page as (
    select l.*, people.display_name, people.avatar
    from public.activity_parts((select array_agg(id) from people), my_today - 29, my_today + 1) l
    join people on people.id = l.user_id
    where before_day is null
       or (l.day, l.at, l.user_id, l.kind, l.ref) < (before_day, before_at, before_id, before_kind, before_ref)
    order by l.day desc, l.at desc, l.user_id desc, l.kind desc, l.ref desc
    limit 20
  ),
  claps as (
    select page.user_id, page.day, page.kind, page.ref,
           count(k.giver_id) filter (where public.kudos_counts(k.giver_id, page.user_id)) as kudos,
           bool_or(k.giver_id = me) as mine,
           count(k.giver_id) filter (where page.user_id = me and k.created_at > seen_at
                                       and public.kudos_counts(k.giver_id, me)) as fresh
    from page
    left join public.kudos k on k.user_id = page.user_id and k.day = page.day
                            and k.kind = page.kind and k.ref = page.ref
    group by page.user_id, page.day, page.kind, page.ref
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', page.day,
           'at', page.at,
           'user_id', page.user_id,
           'display_name', page.display_name,
           'avatar', page.avatar,
           'kind', page.kind,
           'ref', page.ref,
           'goal', page.kind = 'goal',
           'coins', case when page.user_id = me then page.amount end,
           'achievements', case when page.kind = 'achievement' then jsonb_build_array(page.ref)
                                else '[]'::jsonb end,
           'items', case when page.kind = 'purchase' then jsonb_build_array(page.ref)
                         else '[]'::jsonb end,
           'prize_item', case when page.kind = 'goal' then roll.item_id end,
           'prize_coins', case when page.kind = 'goal' then nullif(roll.coins, 0) end,
           'kudos', claps.kudos,
           'my_kudos', coalesce(claps.mine, false),
           'new_kudos', case when page.user_id = me then claps.fresh end)
         order by page.day desc, page.at desc, page.user_id desc, page.kind desc, page.ref desc),
         '[]'::jsonb)
  into result
  from page
  join claps on claps.user_id = page.user_id and claps.day = page.day
            and claps.kind = page.kind and claps.ref = page.ref
  left join public.daily_rolls roll on roll.user_id = page.user_id and roll.day = page.day;
  return result;
end;
$$;

