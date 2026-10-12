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
--   - step sharing turned on, their own daily goal, and a step history
--     long enough for streaks of different lengths (the history goes back
--     past the 8 days the app can upload; the step-row check is skipped
--     for this script only)
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
--
-- The eight friends: an accepted friendship with you. Ava has no streak
-- or achievements, to show an empty card.
-- The two strangers (not friends, so you see no steps for them):
--   Nina Alvarez  has sent YOU a request (Friends badge, Requests section;
--                 if you have push on, your phone gets a push too)
--   Omar Haddad   you have sent HIM a request (Sent requests)

do $$
declare
  me uuid;
begin
  select id into me from auth.users where lower(email) = 'derekqho@gmail.com';
  if me is null then
    raise exception 'derekqho@gmail.com has not signed up yet. Sign in once in the app, then run this again.';
  end if;

  drop table if exists fake_players, won;
  create temp table fake_players on commit drop as
  select * from (values
    -- id, username, display name, relation to you, background, typical
    -- steps a day, own goal, days in a row at the goal ending yesterday,
    -- days of history, last seen (how long ago), character.
    -- The first 8 characters of each id must differ: the sign-up trigger
    -- makes a temporary username from them (user_xxxxxxxx). The friends
    -- are f4ce0001-8 (fake_quest.sql finds them by that); the strangers
    -- are f4ce0010 and f4ce0011, so it doesn't.
    ('f4ce0001-0000-4000-8000-000000000001'::uuid, 'sam_rivera', 'Sam Rivera', 'friend', 'map_forest',
     9000, 8000, 34, 45, interval '2 minutes',
     '{"skin":"#e0a878","hairColor":"#d9534f","hair":"hair_ponytail","face":"face_wink","top":"top_jacket_green","bottom":"bottom_jeans_blue","shoes":"shoes_running_blue","hat":null,"glasses":"glasses_round","cape":null,"hand":"hand_flag","outfit":null,"pet":"pet_cat"}'::jsonb),
    ('f4ce0002-0000-4000-8000-000000000002', 'priya_walks', 'Priya Patel', 'friend', 'map_beach',
     12000, 10000, 104, 120, interval '25 minutes',
     '{"skin":"#c68655","hairColor":"#2a1a1a","hair":"hair_long","face":"face_joy","top":"top_tee_white","bottom":"bottom_shorts_blue","shoes":"shoes_sandals","hat":"hat_flowers","glasses":null,"cape":null,"hand":"hand_surfboard","outfit":"outfit_dress","pet":"pet_mushroom"}'),
    ('f4ce0003-0000-4000-8000-000000000003', 'marcus_c', 'Marcus Chen', 'friend', 'map_neon',
     7000, 6000, 3, 20, interval '3 hours',
     '{"skin":"#f6c9a0","hairColor":"#2a1a1a","hair":"hair_short","face":"face_determined","top":"top_varsity","bottom":"bottom_track_red","shoes":"shoes_rocket","hat":"hat_headphones","glasses":null,"cape":null,"hand":"hand_guitar","outfit":null}'),
    ('f4ce0004-0000-4000-8000-000000000004', 'luna_okafor', 'Luna Okafor', 'friend', 'map_space',
     15000, 12000, 75, 90, interval '20 seconds',
     '{"skin":"#6f4428","hairColor":"#2a1a1a","hair":"hair_afro","face":"face_starry","top":"top_puffer_purple","bottom":"bottom_pants_black","shoes":"shoes_gold","hat":null,"glasses":"glasses_star","cape":"wings_fairy","hand":null,"outfit":null,"pet":"pet_slime"}'),
    ('f4ce0005-0000-4000-8000-000000000005', 'diego_m', 'Diego Morales', 'friend', 'map_mountain',
     11000, 10000, 9, 30, interval '26 hours',
     '{"skin":"#a86b45","hairColor":"#7a4a2a","hair":"hair_buzz","face":"face_smile","top":"top_sweater_yellow","bottom":"bottom_cargo_khaki","shoes":"shoes_cowboy","hat":"hat_beanie_teal","glasses":null,"cape":null,"hand":"hand_fishing_rod","outfit":null,"pet":"pet_dog"}'),
    ('f4ce0006-0000-4000-8000-000000000006', 'hana_k', 'Hana Kim', 'friend', 'map_ocean',
     6000, 5000, 12, 20, interval '1 hour',
     '{"skin":"#fde0c8","hairColor":"#f48fb1","hair":"hair_bob","face":"face_cat","top":"top_stripe_navy","bottom":"bottom_skirt_plaid","shoes":"shoes_slippers_bunny","hat":"hat_cat","glasses":null,"cape":null,"hand":"hand_balloon","outfit":null,"pet":"pet_octopus"}'),
    ('f4ce0007-0000-4000-8000-000000000007', 'theo_b', 'Theo Bennett', 'friend', 'map_dungeon',
     13000, 12000, 30, 40, interval '9 hours',
     '{"skin":"#e0a878","hairColor":"#5b8def","hair":"hair_mohawk","face":"face_determined","top":"top_hoodie_red","bottom":"bottom_jeans_blue","shoes":"shoes_boots_brown","hat":null,"glasses":"glasses_eyepatch","cape":"cape_red","hand":"hand_shield","outfit":"outfit_knight","pet":"pet_stump"}'),
    ('f4ce0008-0000-4000-8000-000000000008', 'ava_rossi', 'Ava Rossi', 'friend', 'map_village',
     3500, 5000, 0, 8, null,
     '{"skin":"#f6c9a0","hairColor":"#f2d16b","hair":"hair_twintails","face":"face_sleepy","top":"top_tee_white","bottom":"bottom_skirt_pink","shoes":"shoes_skates_pink","hat":null,"glasses":null,"cape":null,"hand":"hand_lollipop","outfit":"outfit_pajamas","pet":"pet_fox"}'),
    ('f4ce0010-0000-4000-8000-000000000010', 'nina_alvarez', 'Nina Alvarez', 'asks_me', 'map_forest',
     8000, 10000, 2, 8, interval '15 minutes',
     '{"skin":"#c68655","hairColor":"#7a4a2a","hair":"hair_wavy","face":"face_smile","top":"top_sweater_yellow","bottom":"bottom_jeans_blue","shoes":"shoes_clogs_green","hat":null,"glasses":null,"cape":null,"hand":"hand_sunflower","outfit":null,"pet":"pet_orange_mushroom"}'),
    ('f4ce0011-0000-4000-8000-000000000011', 'omar_h', 'Omar Haddad', 'i_asked', 'map_city',
     10000, 10000, 5, 8, interval '4 hours',
     '{"skin":"#a86b45","hairColor":"#2a1a1a","hair":"hair_spiky","face":"face_surprised","top":"top_hoodie_red","bottom":"bottom_pants_black","shoes":"shoes_hightop_black","hat":"hat_cap_red","glasses":null,"cape":null,"hand":"hand_bug_net","outfit":null}')
  ) as t(id, username, display_name, relation, map_theme, typical_steps, goal, streak_days,
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

  -- Their own daily goal, set long before their history starts
  delete from public.daily_goal_changes c using fake_players f where c.user_id = f.id;
  insert into public.daily_goal_changes (user_id, starts_on, goal, chosen_at)
  select f.id, current_date - f.history_days - 1, f.goal, now() - interval '1 year'
  from fake_players f;

  -- Steps. Today is partway through; the streak's days (ending yesterday)
  -- are at or over the goal; the day before the streak falls short, to
  -- start it; older days vary around the typical day. A couple of big
  -- days for the day-steps achievements.
  alter table public.daily_steps disable trigger daily_steps_check;
  insert into public.daily_steps (user_id, day, steps)
  select
    f.id,
    current_date - d,
    case
      when f.id = 'f4ce0004-0000-4000-8000-000000000004' and d = 40 then 31000   -- Luna
      when f.id = 'f4ce0007-0000-4000-8000-000000000007' and d = 3 then 22000    -- Theo
      when d = 0 then round(f.typical_steps * (0.3 + random() * 0.5))
      when d <= f.streak_days then f.goal + round(random() * f.typical_steps * 0.4)
      when d = f.streak_days + 1 then round(f.goal * 0.5)
      else round(f.typical_steps * (0.6 + random() * 0.8))
    end::int
  from fake_players f
  cross join lateral generate_series(0, f.history_days - 1) as d
  on conflict (user_id, day) do update set steps = excluded.steps;
  alter table public.daily_steps enable trigger daily_steps_check;

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

  raise notice 'Added % fake friends and 2 friend requests for derekqho@gmail.com; % achievements earned',
    (select count(*) from fake_players where relation = 'friend'),
    (select count(*) from public.user_achievements a join fake_players f on f.id = a.user_id);
end;
$$;
