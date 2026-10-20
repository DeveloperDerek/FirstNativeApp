-- DEV ONLY: eight fake players, each an accepted friend of
-- derekqho@gmail.com, plus two strangers with friend requests, for trying
-- out the Friends ranking, the step road, the profile cards and the
-- requests. Not a migration: run it by hand in Supabase > SQL Editor.
-- Safe to run again (it updates the same ten, and resets the requests).
-- Remove them all with fake_friends_remove.sql.
--
-- Each fake player has:
--   - an auth user on the reserved .test domain (no password, so nobody
--     can sign in as them), marked fake in its app metadata
--   - a finished sign-up: onboarded, an adult birthday, and the current
--     Terms and Privacy Policy accepted. Without these they'd count as
--     not active, and nobody could see them (step-tracker-register.txt).
--   - a character and background, with the paid items given to them,
--     including some of the newer shoes, held items, pets and the neon map
--   - step sharing turned on, and a step history long enough for streaks
--     of different lengths (the history goes back past the 8 days the app
--     can upload; the step-row check is skipped for this script only).
--     The daily goal is everyone's coin target (6,000 to 10,000), so
--     streak days are 10,000 or more, which meets any goal.
--   - today's steps set on purpose, to try out the road and its minimap:
--       Marcus      0       hasn't walked yet: stands at the start
--       Sam, Hana,
--       Ava         4,100 to 4,350, close together: their heads stack
--       Diego       7,600
--       Priya       9,800   just short of the 10,000 flag
--       Theo        10,400  past the flag: the road grows to 15,000
--       Luna        16,300  far ahead: the road grows to 20,000
--     (Nina and Omar aren't your friends, so you don't see their steps.)
--   - nearly every pet and held item worn by someone (all but the snail
--     and the bug net), the new dog included (Marcus)
--   - achievements worked out from that history (badges on the player
--     card), and the reward items that come with them, which some wear:
--       Priya   100-day streak, a million steps   Laurel crown
--       Luna    a million steps, a 30,000 day      Winged shoes
--       Sam     30-day streak                      Ember cape
--       Diego   ten quests won                     the Mimic
--     The quests were won in "Trail Crew", a group of Diego, Priya and
--     Theo that you aren't in (fake_quest.sql makes one with you in it).
--   - a "Last seen" time from just now to yesterday (Ava has none, to
--     show a card without it); times count back from when you run this
--   - the daily goal coins for each of the last 30 days at the coin
--     target, as claim_daily_rewards would have paid them, with their
--     wallets to match: these are what the activity board's goal lines
--     are read from (step-tracker-activity-board.txt). With the
--     achievements earned in those days (Luna's 30,000 day is 6 days
--     back, Theo's 22,000 day 3 days back), every friend but Ava has
--     lines on Friends > Activity
--   - the daily roll (20261125000000_daily_roll.sql) on each friend's goal
--     day of the last 14, so their goal lines say what they won, the
--     items owned and the coins in their wallets; those days' goal coins
--     are 0, as after the switch day. Most are rolled like the server
--     would; a few are set, to show each kind of line:
--       Luna   today       a legendary item
--       Priya  today       500 coins (if her steps reach her goal)
--       Theo   today       not rolled yet: "reached their goal"
--       Sam    yesterday   an epic item
--       Hana   yesterday   a rare item
--       Diego  yesterday   250 coins
--     These show whether or not the roll is switched on (daily_roll_from)
--
-- The eight friends: an accepted friendship with you. Ava has no streak
-- or achievements, to show an empty card.
-- The two strangers (not friends, so you see no steps for them):
--   Nina Alvarez  has sent YOU a request (Friends badge, Requests section;
--                 if you have push on, your phone gets a push too)
--   Omar Haddad   you have sent HIM a request (Sent requests)

do $$
declare
  me          uuid;
  goal_day    record;
  outcome     text;
  prize_item  text;
  prize_coins integer;
  rolled      timestamptz;
begin
  select id into me from auth.users where lower(email) = 'derekqho@gmail.com';
  if me is null then
    raise exception 'derekqho@gmail.com has not signed up yet. Sign in once in the app, then run this again.';
  end if;

  drop table if exists fake_players, won, my_lines;
  create temp table fake_players on commit drop as
  select * from (values
    -- id, username, display name, relation to you, background, typical
    -- steps a day, steps so far today, days in a row at the goal ending
    -- yesterday, days of history, last seen (how long ago), character.
    -- The first 8 characters of each id must differ: the sign-up trigger
    -- makes a temporary username from them (user_xxxxxxxx). The friends
    -- are f4ce0001-8 (fake_quest.sql finds them by that); the strangers
    -- are f4ce0010 and f4ce0011, so it doesn't.
    ('f4ce0001-0000-4000-8000-000000000001'::uuid, 'sam_rivera', 'Sam Rivera', 'friend', 'map_forest',
     9000, 4100, 34, 45, interval '2 minutes',
     '{"skin":"#e0a878","hairColor":"#d9534f","hair":"hair_ponytail","face":"face_wink","top":"top_jacket_green","bottom":"bottom_jeans_blue","shoes":"shoes_running_blue","hat":null,"glasses":"glasses_round","cape":null,"hand":"hand_flag","outfit":null,"pet":"pet_cat"}'::jsonb),
    ('f4ce0002-0000-4000-8000-000000000002', 'priya_walks', 'Priya Patel', 'friend', 'map_beach',
     12000, 9800, 104, 120, interval '25 minutes',
     '{"skin":"#c68655","hairColor":"#2a1a1a","hair":"hair_long","face":"face_joy","top":"top_tee_white","bottom":"bottom_shorts_blue","shoes":"shoes_sandals","hat":"hat_flowers","glasses":null,"cape":null,"hand":"hand_fishing_rod","outfit":"outfit_dress","pet":"pet_mushroom"}'),
    ('f4ce0003-0000-4000-8000-000000000003', 'marcus_c', 'Marcus Chen', 'friend', 'map_neon',
     7000, 0, 3, 20, interval '3 hours',
     '{"skin":"#f6c9a0","hairColor":"#2a1a1a","hair":"hair_short","face":"face_determined","top":"top_varsity","bottom":"bottom_track_red","shoes":"shoes_rocket","hat":"hat_headphones","glasses":null,"cape":null,"hand":"hand_guitar","outfit":null,"pet":"pet_dog"}'),
    ('f4ce0004-0000-4000-8000-000000000004', 'luna_okafor', 'Luna Okafor', 'friend', 'map_space',
     15000, 16300, 75, 90, interval '20 seconds',
     '{"skin":"#6f4428","hairColor":"#2a1a1a","hair":"hair_afro","face":"face_starry","top":"top_puffer_purple","bottom":"bottom_pants_black","shoes":"shoes_gold","hat":null,"glasses":"glasses_star","cape":"wings_fairy","hand":"hand_wand","outfit":null,"pet":"pet_slime"}'),
    ('f4ce0005-0000-4000-8000-000000000005', 'diego_m', 'Diego Morales', 'friend', 'map_mountain',
     11000, 7600, 9, 30, interval '26 hours',
     '{"skin":"#a86b45","hairColor":"#7a4a2a","hair":"hair_buzz","face":"face_smile","top":"top_sweater_yellow","bottom":"bottom_cargo_khaki","shoes":"shoes_cowboy","hat":"hat_beanie_teal","glasses":null,"cape":null,"hand":"hand_sword","outfit":null,"pet":null}'),
    ('f4ce0006-0000-4000-8000-000000000006', 'hana_k', 'Hana Kim', 'friend', 'map_ocean',
     6000, 4250, 12, 20, interval '1 hour',
     '{"skin":"#fde0c8","hairColor":"#f48fb1","hair":"hair_bob","face":"face_cat","top":"top_stripe_navy","bottom":"bottom_skirt_plaid","shoes":"shoes_slippers_bunny","hat":"hat_cat","glasses":null,"cape":null,"hand":"hand_balloon","outfit":null,"pet":"pet_octopus"}'),
    ('f4ce0007-0000-4000-8000-000000000007', 'theo_b', 'Theo Bennett', 'friend', 'map_dungeon',
     13000, 10400, 30, 40, interval '9 hours',
     '{"skin":"#e0a878","hairColor":"#5b8def","hair":"hair_mohawk","face":"face_determined","top":"top_hoodie_red","bottom":"bottom_jeans_blue","shoes":"shoes_boots_brown","hat":null,"glasses":"glasses_eyepatch","cape":"cape_red","hand":"hand_shield","outfit":"outfit_knight","pet":"pet_stump"}'),
    ('f4ce0008-0000-4000-8000-000000000008', 'ava_rossi', 'Ava Rossi', 'friend', 'map_village',
     3500, 4350, 0, 8, null,
     '{"skin":"#f6c9a0","hairColor":"#f2d16b","hair":"hair_twintails","face":"face_sleepy","top":"top_tee_white","bottom":"bottom_skirt_pink","shoes":"shoes_skates_pink","hat":null,"glasses":null,"cape":null,"hand":"hand_lollipop","outfit":"outfit_pajamas","pet":"pet_fox"}'),
    ('f4ce0010-0000-4000-8000-000000000010', 'nina_alvarez', 'Nina Alvarez', 'asks_me', 'map_forest',
     8000, 5200, 2, 8, interval '15 minutes',
     '{"skin":"#c68655","hairColor":"#7a4a2a","hair":"hair_wavy","face":"face_smile","top":"top_sweater_yellow","bottom":"bottom_jeans_blue","shoes":"shoes_clogs_green","hat":null,"glasses":null,"cape":null,"hand":"hand_umbrella","outfit":null,"pet":"pet_orange_mushroom"}'),
    ('f4ce0011-0000-4000-8000-000000000011', 'omar_h', 'Omar Haddad', 'i_asked', 'map_city',
     10000, 6100, 5, 8, interval '4 hours',
     '{"skin":"#a86b45","hairColor":"#2a1a1a","hair":"hair_spiky","face":"face_surprised","top":"top_hoodie_red","bottom":"bottom_pants_black","shoes":"shoes_hightop_black","hat":"hat_cap_red","glasses":null,"cape":null,"hand":"hand_lantern","outfit":null,"pet":"pet_pig"}')
  ) as t(id, username, display_name, relation, map_theme, typical_steps, today_steps, streak_days,
         history_days, seen_ago, avatar);

  -- Auth users. The on_auth_user_created trigger makes their profiles.
  -- The empty token columns keep the Supabase dashboard's user list happy.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    f.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    f.username || '@fake.steptracker.test', '', now(),
    '{"provider":"email","providers":["email"],"fake":true}'::jsonb,
    jsonb_build_object('full_name', f.display_name), now(), now(),
    '', '', '', ''
  from fake_players f
  on conflict (id) do nothing;

  -- A finished sign-up: an adult birthday (private), and the current Terms
  -- and Privacy Policy accepted (nothing to accept while none are published)
  insert into public.profile_private (user_id, birth_date)
  select f.id, date '1988-03-14' + (row_number() over (order by f.id))::integer * 400
  from fake_players f
  on conflict (user_id) do update set birth_date = excluded.birth_date;

  insert into public.legal_acceptances (user_id, document, version, source)
  select f.id, c.document, c.version, 'signup'
  from fake_players f
  cross join public.current_legal_versions() c
  on conflict (user_id, document, version) do nothing;

  -- Give them the paid items they wear and their background, so the
  -- owned-item triggers accept the profile update below. Reward items
  -- aren't given here: they come with the achievements, further down.
  insert into public.user_items (user_id, item_id)
  select f.id, s.id
  from fake_players f
  join public.shop_items s
    on s.unlocked_by is null
   and (s.id = f.map_theme or s.id in (select value from jsonb_each_text(f.avatar)))
  on conflict do nothing;

  update public.profiles p set
    username           = f.username,
    display_name       = f.display_name,
    avatar             = f.avatar,
    map_theme          = f.map_theme,
    onboarded_at       = coalesce(p.onboarded_at, now()),
    sharing_consent_at = coalesce(p.sharing_consent_at, now())
  from fake_players f
  where p.id = f.id;

  -- No personal goals any more (GOAL-15): earlier runs of this script
  -- gave them some, which would still apply to their older days
  delete from public.daily_goal_changes c using fake_players f where c.user_id = f.id;

  -- Steps. Today is the set count (above); the streak's days (ending
  -- yesterday) are 10,000 or more, over any goal; the day before the
  -- streak falls short of every goal, to start it; older days vary
  -- around the typical day. A couple of big days for the day-steps
  -- achievements.
  alter table public.daily_steps disable trigger daily_steps_check;
  insert into public.daily_steps (user_id, day, steps)
  select
    f.id,
    current_date - d,
    case
      when f.id = 'f4ce0004-0000-4000-8000-000000000004' and d = 6 then 31000    -- Luna
      when f.id = 'f4ce0007-0000-4000-8000-000000000007' and d = 3 then 22000    -- Theo
      when d = 0 then f.today_steps
      when d <= f.streak_days then 10000 + round(random() * f.typical_steps * 0.4)
      when d = f.streak_days + 1 then 5000
      else round(f.typical_steps * (0.6 + random() * 0.8))
    end::int
  from fake_players f
  cross join lateral generate_series(0, f.history_days - 1) as d
  on conflict (user_id, day) do update set steps = excluded.steps;
  alter table public.daily_steps enable trigger daily_steps_check;

  -- The daily goal coins for the last 30 days, worked out afresh (the
  -- steps above are new each run): the old rows go, with their coins
  -- out of the wallet, then a row for each day at the coin target, paid
  -- in that evening (or a minute ago for today), with the coins in
  with gone as (
    delete from public.coin_transactions c
    using fake_players f
    where c.user_id = f.id and c.reason = 'daily_goal'
      and c.ref >= to_char(current_date - 29, 'YYYY-MM-DD')
    returning c.user_id, c.amount
  )
  update public.wallets w set balance = greatest(0, w.balance - g.total)
  from (select user_id, sum(amount)::int as total from gone group by user_id) g
  where w.user_id = g.user_id;

  with paid as (
    insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
    select s.user_id, 150, 'daily_goal', s.day::text,
           least(now() - interval '1 minute',
                 (s.day + time '17:00')::timestamptz + make_interval(mins => (random() * 240)::int))
    from public.daily_steps s
    join fake_players f on f.id = s.user_id
    where s.day > current_date - 30
      and s.steps >= public.coin_steps_on(s.user_id, s.day)
    on conflict (user_id, reason, ref) do nothing
    returning user_id, amount
  )
  insert into public.wallets (user_id, balance)
  select user_id, sum(amount)::int from paid group by user_id
  on conflict (user_id) do update set balance = public.wallets.balance + excluded.balance;

  -- The daily roll on the friends' goal days of the last 14 (see the top),
  -- made fresh each run: the last run's rolls go first, with the items
  -- they gave (never worn: a roll only gives what they didn't own) and
  -- their coins out of the wallet. Then each day in turn, oldest first, so
  -- an item won once isn't won again. Before purchases, so nothing bought
  -- is also won.
  if to_regclass('public.daily_rolls') is not null then
    with gone as (
      delete from public.daily_rolls r using fake_players f
      where r.user_id = f.id
      returning r.user_id, r.item_id
    )
    delete from public.user_items u using gone g
    where u.user_id = g.user_id and u.item_id = g.item_id;

    with gone as (
      delete from public.coin_transactions c using fake_players f
      where c.user_id = f.id and c.reason = 'roll'
      returning c.user_id, c.amount
    )
    update public.wallets w set balance = greatest(0, w.balance - g.total)
    from (select user_id, sum(amount)::int as total from gone group by user_id) g
    where w.user_id = g.user_id;

    for goal_day in
      select c.user_id, c.ref::date as day, c.created_at, f.username
      from public.coin_transactions c
      join fake_players f on f.id = c.user_id
      where c.reason = 'daily_goal' and f.relation = 'friend'
        and c.ref >= to_char(current_date - 13, 'YYYY-MM-DD')
        and not (f.username = 'theo_b' and c.ref = to_char(current_date, 'YYYY-MM-DD'))
      order by c.ref, c.user_id
    loop
      -- The rarity: set for the days listed at the top, else as the
      -- server rolls it, from the rarities with an item left for them
      outcome := case
        when goal_day.day = current_date and goal_day.username = 'luna_okafor' then 'legendary'
        when goal_day.day = current_date and goal_day.username = 'priya_walks' then 'coins'
        when goal_day.day = current_date - 1 and goal_day.username = 'sam_rivera' then 'epic'
        when goal_day.day = current_date - 1 and goal_day.username = 'hana_k' then 'rare'
        when goal_day.day = current_date - 1 and goal_day.username = 'diego_m' then 'coins'
        else public.roll_outcome(array(
          select distinct public.roll_rarity(s.price) from public.shop_items s
          where s.active and s.unlocked_by is null and s.price is not null
            and not exists (select 1 from public.user_items u
                            where u.user_id = goal_day.user_id and u.item_id = s.id)), random())
      end;
      prize_item := null;
      if outcome <> 'coins' then
        select s.id into prize_item from public.shop_items s
        where s.active and s.unlocked_by is null and s.price is not null
          and not exists (select 1 from public.user_items u
                          where u.user_id = goal_day.user_id and u.item_id = s.id)
          and public.roll_rarity(s.price) = outcome
        order by random() limit 1;
        if prize_item is null then outcome := 'coins'; end if;   -- none of that rarity left
      end if;
      prize_coins := case
        when outcome <> 'coins' then 0
        when goal_day.day = current_date and goal_day.username = 'priya_walks' then 500
        when goal_day.day = current_date - 1 and goal_day.username = 'diego_m' then 250
        else public.roll_coin_amount(random())
      end;
      -- Rolled soon after the goal was reached, and seen
      rolled := least(now() - interval '1 minute', goal_day.created_at + make_interval(mins => 1 + (random() * 90)::int));

      insert into public.daily_rolls (user_id, day, item_id, coins, rarity, rolled_at, seen_at)
      values (goal_day.user_id, goal_day.day, prize_item, prize_coins, outcome, rolled, rolled);
      if prize_item is not null then
        insert into public.user_items (user_id, item_id, acquired_at) values (goal_day.user_id, prize_item, rolled);
      end if;
      insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
      values (goal_day.user_id, prize_coins, 'roll', goal_day.day::text, rolled);
      -- A rolled day's goal pays nothing, so its 150 come back out
      update public.coin_transactions c set amount = 0
      where c.user_id = goal_day.user_id and c.reason = 'daily_goal' and c.ref = goal_day.day::text;
      update public.wallets w set balance = greatest(0, w.balance - 150 + prize_coins)
      where w.user_id = goal_day.user_id;
    end loop;

    raise notice 'Daily rolls: % (% items, % coin prizes)',
      (select count(*) from public.daily_rolls r join fake_players f on f.id = r.user_id),
      (select count(*) from public.daily_rolls r join fake_players f on f.id = r.user_id where r.item_id is not null),
      (select count(*) from public.daily_rolls r join fake_players f on f.id = r.user_id where r.item_id is null);
  end if;

  -- Trail Crew: Diego's group with Priya and Theo, and ten Sprints they
  -- won together, one every three days
  insert into public.groups (id, name, owner_id)
  values ('f4ce9998-0000-4000-8000-000000000001', 'Trail Crew', 'f4ce0005-0000-4000-8000-000000000005')
  on conflict (id) do nothing;
  insert into public.group_members (group_id, user_id) values
    ('f4ce9998-0000-4000-8000-000000000001', 'f4ce0002-0000-4000-8000-000000000002'),
    ('f4ce9998-0000-4000-8000-000000000001', 'f4ce0007-0000-4000-8000-000000000007')
  on conflict do nothing;
  delete from public.quests where group_id = 'f4ce9998-0000-4000-8000-000000000001';

  create temp table won on commit drop as
  select gen_random_uuid() as id, now() - make_interval(days => 3 * n, hours => 5) as starts_at
  from generate_series(1, 10) n;
  insert into public.quests (id, group_id, type_id, proposer_id, status, start_asap,
                             starts_at, ends_at, goal, party_size, total_steps,
                             completed_at, settled_at, step_coins, multiplier, coins_each)
  select w.id, 'f4ce9998-0000-4000-8000-000000000001', 'sprint',
         'f4ce0005-0000-4000-8000-000000000005', 'completed', true,
         w.starts_at, w.starts_at + interval '2 hours', public.quest_goal(8000, 3), 3, 10200,
         w.starts_at + interval '95 minutes', w.starts_at + interval '3 hours',
         51, 1.4, 24
  from won w;
  insert into public.quest_party (quest_id, user_id, steps, uploaded_at, result_seen)
  select w.id, p.user_id, p.steps, w.starts_at + interval '2 hours', true
  from won w
  cross join (values ('f4ce0005-0000-4000-8000-000000000005'::uuid, 4100),
                     ('f4ce0002-0000-4000-8000-000000000002', 3900),
                     ('f4ce0007-0000-4000-8000-000000000007', 2200)) as p(user_id, steps);

  -- Achievements from all of that, worked out afresh (with their reward
  -- items), then the reward items some of them wear
  delete from public.user_achievements a using fake_players f where a.user_id = f.id;
  perform public.award_achievements(f.id, true) from fake_players f;

  update public.profiles p
  set avatar = p.avatar || w.items
  from (values
    ('f4ce0002-0000-4000-8000-000000000002'::uuid, '{"hat":"hat_laurel"}'::jsonb),
    ('f4ce0004-0000-4000-8000-000000000004', '{"shoes":"shoes_winged"}'),
    ('f4ce0001-0000-4000-8000-000000000001', '{"cape":"cape_ember"}'),
    ('f4ce0005-0000-4000-8000-000000000005', '{"pet":"pet_mimic"}')
  ) as w(id, items)
  where p.id = w.id;

  -- Last seen, spread out so the card shows each kind of wording
  insert into public.last_seen (user_id, seen_at)
  select f.id, now() - f.seen_ago
  from fake_players f
  where f.seen_ago is not null
  on conflict (user_id) do update set seen_at = excluded.seen_at;

  -- Accepted friendships with you (one row per pair, either direction)
  insert into public.friendships (requester_id, addressee_id, status)
  select f.id, me, 'accepted' from fake_players f where f.relation = 'friend'
  on conflict do nothing;
  update public.friendships fr set status = 'accepted'
  from fake_players f
  where f.relation = 'friend'
    and least(fr.requester_id, fr.addressee_id) = least(f.id, me)
    and greatest(fr.requester_id, fr.addressee_id) = greatest(f.id, me);

  -- The two requests, made fresh each time so they're always pending
  delete from public.friendships fr
  using fake_players f
  where f.relation in ('asks_me', 'i_asked')
    and least(fr.requester_id, fr.addressee_id) = least(f.id, me)
    and greatest(fr.requester_id, fr.addressee_id) = greatest(f.id, me);
  insert into public.friendships (requester_id, addressee_id, status)
  select case f.relation when 'asks_me' then f.id else me end,
         case f.relation when 'asks_me' then me else f.id end,
         'pending'
  from fake_players f
  where f.relation in ('asks_me', 'i_asked');

  -- Shop purchases on the activity board (20261123000000_activity_
  -- purchases.sql): the item, its 'purchase' coin row on that shop day
  -- and the coins out of the wallet, made fresh each run (the last run's
  -- purchases go first, coins back). None of them worn, so they only show
  -- on the board. Four picked, each kind of picture once:
  --   Hana   Red cap, an hour ago             clothing
  --   Ava    Snail, yesterday evening          pet (her only line)
  --   Theo   City map, 2 days ago              map
  --   Sam    Heart shades, then Pirate hat,    two on one line; the
  --          4 days ago                        newer one is the picture
  -- and then, to fill the board, every friend buys something they don't
  -- own on about half of the last 14 days (now and then two things).
  -- Only once the purchases migration is in: before it, the board
  -- doesn't show them.
  if to_regprocedure('public.bought_on(uuid, date)') is not null then
    with gone as (
      delete from public.coin_transactions c
      using fake_players f
      where c.user_id = f.id and c.reason = 'purchase'
      returning c.user_id, c.ref, c.amount
    ),
    refunded as (
      update public.wallets w set balance = w.balance - g.total
      from (select user_id, sum(amount)::int as total from gone group by user_id) g
      where w.user_id = g.user_id
    )
    -- Bought here, so not worn and not their background (see above)
    delete from public.user_items u
    using gone g
    where u.user_id = g.user_id and u.item_id = g.ref;

    drop table if exists fake_buys;
    create temp table fake_buys on commit drop as
    select f.id as user_id, b.item_id, s.price,
           least(now() - interval '1 minute',
                 coalesce(((public.shop_day() - b.ago)::timestamp + b.at) at time zone 'America/Los_Angeles',
                          now() - interval '1 hour')) as paid_at
    from (values
      ('hana_k', 'hat_cap_red', 0, null::interval),   -- an hour ago, whatever the time of day
      ('ava_rossi', 'pet_snail', 1, interval '18 hours'),
      ('theo_b', 'map_city', 2, interval '20 hours'),
      ('sam_rivera', 'glasses_heart', 4, interval '12 hours'),
      ('sam_rivera', 'hat_pirate', 4, interval '12 hours 30 minutes')
    ) as b(username, item_id, ago, at)
    join fake_players f on f.username = b.username
    join public.shop_items s on s.id = b.item_id;

    -- The rest: on about half the days, one or two items, from 9am to 9pm
    -- in the shop's time zone; each a different item they don't own yet
    insert into fake_buys (user_id, item_id, price, paid_at)
    select distinct on (pick.user_id, pick.item_id) pick.user_id, pick.item_id, pick.price, pick.paid_at
    from (
      select f.id as user_id, s.id as item_id, s.price,
             least(now() - interval '1 minute',
                   ((public.shop_day() - d.ago)::timestamp
                     + make_interval(hours => 9, mins => (random() * 720)::int))
                   at time zone 'America/Los_Angeles') as paid_at
      from fake_players f
      cross join lateral generate_series(0, 13) as d(ago)
      cross join lateral (
        select s.id, s.price from public.shop_items s
        where s.active and s.unlocked_by is null and d.ago is not null and f.id is not null
          and not exists (select 1 from public.user_items u where u.user_id = f.id and u.item_id = s.id)
          and not exists (select 1 from fake_buys b where b.user_id = f.id and b.item_id = s.id)
        order by random()
        limit case when random() < 0.5 then 0 when random() < 0.75 then 1 else 2 end
      ) s
      where f.relation = 'friend'
    ) pick
    order by pick.user_id, pick.item_id, pick.paid_at;

    insert into public.user_items (user_id, item_id, acquired_at)
    select user_id, item_id, paid_at from fake_buys
    on conflict (user_id, item_id) do nothing;
    insert into public.coin_transactions (user_id, amount, reason, ref, created_at)
    select user_id, -price, 'purchase', item_id, paid_at from fake_buys;
    update public.wallets w set balance = greatest(0, w.balance - b.total)
    from (select user_id, sum(price)::int as total from fake_buys group by user_id) b
    where w.user_id = b.user_id;

    raise notice 'Purchases: % items bought by % friends over the last 14 days',
      (select count(*) from fake_buys), (select count(distinct user_id) from fake_buys);
  end if;

  raise notice 'Added % fake friends and 2 friend requests for derekqho@gmail.com; % achievements earned; % goal days in the last 30',
    (select count(*) from fake_players where relation = 'friend'),
    (select count(*) from public.user_achievements a join fake_players f on f.id = a.user_id),
    (select count(*) from public.coin_transactions c join fake_players f on f.id = c.user_id
     where c.reason = 'daily_goal' and c.ref >= to_char(current_date - 29, 'YYYY-MM-DD'));

  -- Kudos (step-tracker-kudos.txt), on each line (a goal, an achievement
  -- or a purchase: 20261124000000_activity_separate_lines.sql), only once
  -- that migration is in. Made fresh each run:
  --   - the eight friends are friends with each other too (a kudos only
  --     counts from the line owner's friend), and give each other kudos
  --     on about a third of their lines from the last 10 days
  --   - you have given kudos on Priya's and Luna's latest lines, to show
  --     the gold "given" look without tapping
  --   - your own lines get kudos from 1 to 4 friends: the older ones
  --     already seen, and 3 from the last hour still new (the Friends
  --     tab dot, "3 new kudos"), one of them on a line over a week old
  --     (under "Show older") when you have one
  if to_regprocedure('public.activity_parts(uuid[], date, date)') is not null then
    delete from public.kudos k
    using fake_players f
    where f.relation = 'friend' and (k.giver_id = f.id or k.user_id = f.id);

    insert into public.friendships (requester_id, addressee_id, status)
    select a.id, b.id, 'accepted'
    from fake_players a
    join fake_players b on a.id < b.id and b.relation = 'friend'
    where a.relation = 'friend'
      and not exists (select 1 from public.friendships fr
                      where fr.status in ('pending', 'accepted')
                        and least(fr.requester_id, fr.addressee_id) = a.id
                        and greatest(fr.requester_id, fr.addressee_id) = b.id);
    update public.friendships fr set status = 'accepted'
    from fake_players a, fake_players b
    where a.relation = 'friend' and b.relation = 'friend' and a.id < b.id
      and fr.status = 'pending'
      and least(fr.requester_id, fr.addressee_id) = a.id
      and greatest(fr.requester_id, fr.addressee_id) = b.id;

    -- Between the friends, the evening after each line's day
    insert into public.kudos (giver_id, user_id, day, kind, ref, created_at)
    select g.id, o.id, d.day, d.kind, d.ref,
           least(now() - interval '2 hours',
                 (d.day + time '19:00')::timestamptz + make_interval(mins => (random() * 600)::int))
    from fake_players o
    cross join lateral public.activity_parts(array[o.id], current_date - 9, current_date) d
    join fake_players g on g.relation = 'friend' and g.id <> o.id
    where o.relation = 'friend'
      and random() < 0.33;

    -- Yours on Priya's and Luna's latest lines
    insert into public.kudos (giver_id, user_id, day, kind, ref, created_at)
    select me, o.id, latest.day, latest.kind, latest.ref, now() - interval '3 hours'
    from fake_players o
    cross join lateral (select p.day, p.kind, p.ref
                        from public.activity_parts(array[o.id], current_date - 9, current_date) p
                        order by p.day desc, p.at desc limit 1) latest
    where o.username in ('priya_walks', 'luna_okafor')
    on conflict do nothing;

    -- On your lines: seen up to 2 hours ago, so only the newest are new
    delete from public.kudos k using fake_players f where k.user_id = me and k.giver_id = f.id;
    create temp table my_lines on commit drop as
    select p.day, p.kind, p.ref, row_number() over (order by p.day desc, p.at desc, p.kind, p.ref) as newest
    from public.activity_parts(array[me], current_date - 29, current_date) p;

    insert into public.kudos (giver_id, user_id, day, kind, ref, created_at)
    select g.id, me, l.day, l.kind, l.ref,
           least(now() - interval '3 hours',
                 (l.day + time '20:00')::timestamptz + make_interval(mins => (random() * 600)::int))
    from my_lines l
    -- (refers to the line, so it is picked again for each one)
    cross join lateral (select f.id from fake_players f
                        where f.relation = 'friend' and l.day is not null
                        order by random() limit 1 + (random() * 3)::int) g;

    insert into public.notification_settings (user_id, kudos_seen_at)
    values (me, now() - interval '2 hours')
    on conflict (user_id) do update set kudos_seen_at = excluded.kudos_seen_at;

    -- The 3 new ones: on your newest line, the next, and an old one
    insert into public.kudos (giver_id, user_id, day, kind, ref, created_at)
    select g.id, me, l.day, l.kind, l.ref, now() - make_interval(mins => 10 * l.pick::int)
    from (
      select day, kind, ref, row_number() over (order by newest) as pick from (
        (select day, kind, ref, newest from my_lines order by newest limit 2)
        union
        (select day, kind, ref, newest from my_lines where day <= current_date - 8 order by newest limit 1)
      ) x
    ) l
    -- Someone who hasn't given kudos on that line yet (Luna, Theo, Hana in turn)
    cross join lateral (select f.id from fake_players f
                        where f.username = (array['luna_okafor', 'theo_b', 'hana_k'])[l.pick]) g
    on conflict (giver_id, user_id, day, kind, ref) do update set created_at = excluded.created_at;

    raise notice 'Kudos: % between your friends, % on your % lines (% new)',
      (select count(*) from public.kudos k join fake_players f on f.id = k.user_id),
      (select count(*) from public.kudos where user_id = me),
      (select count(*) from my_lines),
      (select count(*) from public.kudos where user_id = me and created_at > now() - interval '2 hours');
    if not exists (select 1 from my_lines) then
      raise notice 'You have no lines on the board in the last 30 days (reach your goal, earn an achievement or buy something), so no kudos on yours yet';
    end if;
  end if;
end;
$$;
