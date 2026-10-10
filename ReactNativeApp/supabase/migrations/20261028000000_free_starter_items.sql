-- StepTracker: four items become free starter items, so new players can
-- start with a women's look (STARTER_LOOKS in src/avatar/types.ts):
-- hair_long, hair_ponytail, top_sweater_yellow and bottom_skirt_pink.
-- An item is free when it has no shop_items row, so they leave the shop
-- and everyone can wear them.
--
-- Anyone who bought one gets back exactly what they paid (their
-- 'purchase' transaction, in case the price changed since). Items an
-- admin was given, or that were grandfathered, cost nothing and are not
-- refunded. The unique (user_id, reason, ref) key means running this
-- twice cannot pay twice.

with paid as (
  insert into public.coin_transactions (user_id, amount, reason, ref)
  select t.user_id, -t.amount, 'refund', t.ref
  from public.coin_transactions t
  where t.reason = 'purchase' and t.amount < 0
    and t.ref in ('hair_long', 'hair_ponytail', 'top_sweater_yellow', 'bottom_skirt_pink')
  on conflict (user_id, reason, ref) do nothing
  returning user_id, amount
)
update public.wallets w
set balance = w.balance + r.total
from (select user_id, sum(amount)::integer as total from paid group by user_id) r
where w.user_id = r.user_id;

-- Rows that point at the shop entries go first (foreign keys)
delete from public.user_daily_shop
where item_id in ('hair_long', 'hair_ponytail', 'top_sweater_yellow', 'bottom_skirt_pink');
delete from public.user_items
where item_id in ('hair_long', 'hair_ponytail', 'top_sweater_yellow', 'bottom_skirt_pink');
delete from public.shop_items
where id in ('hair_long', 'hair_ponytail', 'top_sweater_yellow', 'bottom_skirt_pink');
