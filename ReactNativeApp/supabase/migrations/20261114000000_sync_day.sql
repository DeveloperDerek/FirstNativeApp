-- StepTracker: one call for the app's step refresh. It used to upload the
-- days, claim coins, list quests, and read the goal and streak one after
-- another, a round trip each; this does the same in one transaction.
--
-- Security invoker: the upload goes through the same row rules as before
-- (your own rows, step sharing on, an active account, the step-row
-- check). The other functions are the ones the app already calls.
--
-- Quests are listed before the claim, the same order as a quest paying
-- out (the quest lock, then each member's coin lock), so the two can
-- never wait on each other.
--
-- p_days: [{"day": "YYYY-MM-DD", "steps": n}, ...]; empty when the app
-- can't read steps. Without days nothing is uploaded or claimed.
create function public.sync_day(my_today date, p_days jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  uploading boolean := jsonb_array_length(coalesce(p_days, '[]')) > 0;
  earned    integer := 0;
  quests    jsonb := '[]';
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_active_account() then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  if uploading then
    insert into public.daily_steps (user_id, day, steps)
    select auth.uid(), (d ->> 'day')::date, (d ->> 'steps')::integer
    from jsonb_array_elements(p_days) d
    on conflict (user_id, day) do update set steps = excluded.steps;
  end if;

  if public.has_sharing_consent() then
    select coalesce(jsonb_agg(to_jsonb(q) - 'ordinality' order by q.ordinality), '[]') into quests
    from public.my_quests() with ordinality q;   -- newest first, as my_quests() gives them
  end if;

  if uploading then
    earned := public.claim_daily_rewards();
  end if;

  return jsonb_build_object(
    'earned', earned,
    'quests', quests,
    'goal',   public.my_goal(my_today),
    'streak', public.my_streak(my_today));
end;
$$;

revoke all on function public.sync_day(date, jsonb) from public, anon;
grant execute on function public.sync_day(date, jsonb) to authenticated;
