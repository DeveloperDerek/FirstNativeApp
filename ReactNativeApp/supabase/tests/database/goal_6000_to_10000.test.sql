-- step-tracker-decisions.txt, GOAL-17: from the switch day the daily goal
-- is 6,000 to 10,000 in 500s; days before it keep 7,000 to 10,000. Run
-- with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create function pg_temp.u(n integer) returns uuid language sql as $$
  select ('000000' || lpad(to_hex(n), 2, '0') || '-6000-0000-0000-000000000000')::uuid
$$;

-- The migration's own switch day: two days after the server's date
select is((select date '2000-01-01' + s.value from public.app_settings s where s.key = 'goal_6000_from'),
          current_date + 2, 'the switch is two days ahead, so no started day changes');
select is(array(select distinct public.coin_steps_on(pg_temp.u(n), current_date + 1 - d)
                 from generate_series(1, 20) n, generate_series(0, 60) d order by 1),
          array[7000, 7500, 8000, 8500, 9000, 9500, 10000],
          'up to the day before it: 7,000 to 10,000, as before');

-- Move the switch 30 days back, so there are days on both sides of it
update public.app_settings set value = (current_date - 30) - date '2000-01-01'
where key = 'goal_6000_from';
select is(array(select distinct public.coin_steps_on(pg_temp.u(n), current_date - d)
                 from generate_series(1, 20) n, generate_series(0, 30) d order by 1),
          array[6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000],
          'from the switch day: 6,000 to 10,000 in 500s, and each one comes up');
select is(array(select distinct public.coin_steps_on(pg_temp.u(n), current_date - d)
                 from generate_series(1, 20) n, generate_series(31, 90) d order by 1),
          array[7000, 7500, 8000, 8500, 9000, 9500, 10000],
          'days before it keep 7,000 to 10,000');
select ok((select count(distinct public.coin_steps_on(pg_temp.u(3), current_date - d))
           from generate_series(0, 30) d) > 1, 'one player''s target changes from day to day');
select is(public.coin_steps_on(pg_temp.u(4), current_date), public.coin_steps_on(pg_temp.u(4), current_date),
          'the same player and day always get the same target');

-- No setting: every day keeps the old range
delete from public.app_settings where key = 'goal_6000_from';
select ok((select bool_and(public.coin_steps_on(pg_temp.u(n), current_date - d) between 7000 and 10000)
           from generate_series(1, 20) n, generate_series(0, 60) d),
          'without the switch day: 7,000 to 10,000');
select is(public.coin_steps_on(pg_temp.u(5), current_date) % 500, 0, '...still in 500s');

select * from finish();
rollback;
