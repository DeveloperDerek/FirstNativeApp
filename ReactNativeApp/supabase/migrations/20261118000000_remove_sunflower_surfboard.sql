-- StepTracker: the sunflower and the surfboard leave the game (removed
-- from src/avatar/catalog.ts).
--
-- Anyone who bought one gets back exactly what they paid (their
-- 'purchase' transaction, in case the price changed since). Items an
-- admin was given cost nothing and are not refunded. The unique
-- (user_id, reason, ref) key means running this twice cannot pay twice.

with paid as (
  insert into public.coin_transactions (user_id, amount, reason, ref)
  select t.user_id, -t.amount, 'refund', t.ref
  from public.coin_transactions t
  where t.reason = 'purchase' and t.amount < 0
    and t.ref in ('hand_sunflower', 'hand_surfboard')
  on conflict (user_id, reason, ref) do nothing
  returning user_id, amount
)
update public.wallets w
set balance = w.balance + r.total
from (select user_id, sum(amount)::integer as total from paid group by user_id) r
where w.user_id = r.user_id;

-- Anyone holding one puts it down. The app already shows them empty
-- handed (normalizeAvatar drops ids it doesn't know); this keeps the
-- saved character from naming an item that no longer exists.
update public.profiles
set avatar = jsonb_set(avatar, '{hand}', 'null')
where avatar ->> 'hand' in ('hand_sunflower', 'hand_surfboard');

-- Rows that point at the shop entries go first (foreign keys)
delete from public.user_daily_shop where item_id in ('hand_sunflower', 'hand_surfboard');
delete from public.user_items where item_id in ('hand_sunflower', 'hand_surfboard');
delete from public.shop_items where id in ('hand_sunflower', 'hand_surfboard');
