-- StepTracker: the lasso, spatula and spyglass leave the game. They were
-- dropped from src/avatar/catalog.ts and from 20261120000000_item_sets.sql
-- (b3e76ed), but that migration had already run on the live project, so
-- they stayed in its shop: sold, rolled, and drawn as blank reel tiles.
--
-- The same as 20261118000000_remove_sunflower_surfboard.sql: anyone who
-- bought one gets back exactly what they paid (their 'purchase'
-- transaction, in case the price changed since). Items an admin was given
-- cost nothing and are not refunded. The unique (user_id, reason, ref)
-- key means running this twice cannot pay twice.

with paid as (
  insert into public.coin_transactions (user_id, amount, reason, ref)
  select t.user_id, -t.amount, 'refund', t.ref
  from public.coin_transactions t
  where t.reason = 'purchase' and t.amount < 0
    and t.ref in ('hand_lasso', 'hand_spatula', 'hand_spyglass')
  on conflict (user_id, reason, ref) do nothing
  returning user_id, amount
)
update public.wallets w
set balance = w.balance + r.total
from (select user_id, sum(amount)::integer as total from paid group by user_id) r
where w.user_id = r.user_id;

-- Anyone holding one puts it down
update public.profiles
set avatar = jsonb_set(avatar, '{hand}', 'null')
where avatar ->> 'hand' in ('hand_lasso', 'hand_spatula', 'hand_spyglass');

-- Rows that point at the shop entries go first (foreign keys)
delete from public.user_daily_shop where item_id in ('hand_lasso', 'hand_spatula', 'hand_spyglass');
delete from public.user_items where item_id in ('hand_lasso', 'hand_spatula', 'hand_spyglass');

-- A roll that gave one is history and keeps its row (daily_rolls points
-- at the item), so such an item stays in the table, off sale and out of
-- the roll; the rest are deleted
update public.shop_items set active = false
where id in ('hand_lasso', 'hand_spatula', 'hand_spyglass');
delete from public.shop_items s
where s.id in ('hand_lasso', 'hand_spatula', 'hand_spyglass')
  and not exists (select 1 from public.daily_rolls r where r.item_id = s.id);
