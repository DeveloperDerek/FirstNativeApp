-- StepTracker: coins for opening the app, once every 6 hours
-- (step-tracker-stage6.txt, PART 2). Uses wallets, coin_transactions and
-- has_sharing_consent() from earlier migrations.

alter table public.wallets
  add column last_checkin_at timestamptz;

create function public.claim_checkin()
returns table (granted integer, next_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  bonus    constant integer  := 10;                 -- coins per check-in
  cooldown constant interval := interval '6 hours';
  last_at  timestamptz;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  -- Same rule as step rewards: sharing is required to earn coins
  if not public.has_sharing_consent() then
    return query select 0, null::timestamptz;
    return;
  end if;

  -- Lock the wallet so two taps at once cannot both collect
  insert into public.wallets (user_id) values (uid)
  on conflict (user_id) do nothing;
  select w.last_checkin_at into last_at
  from public.wallets w where w.user_id = uid for update;

  -- Too soon: grant nothing, say when the next one is ready.
  -- now() is the server's clock, so changing the phone's time does nothing.
  if last_at is not null and now() < last_at + cooldown then
    return query select 0, last_at + cooldown;
    return;
  end if;

  update public.wallets w
  set balance = w.balance + bonus, last_checkin_at = now()
  where w.user_id = uid;

  insert into public.coin_transactions (user_id, amount, reason, ref)
  values (uid, bonus, 'checkin',
          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS'));

  return query select bonus, now() + cooldown;
end;
$$;
