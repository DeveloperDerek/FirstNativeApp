-- DEV ONLY: eight fake players, each an accepted friend of
-- derekqho@gmail.com, for trying out the Friends ranking, the step road
-- and the profile cards. Not a migration: run it by hand in
-- Supabase > SQL Editor. Safe to run again (it updates the same eight).
-- Remove them all with fake_friends_remove.sql.
--
-- Each fake player has:
--   - an auth user on the reserved .test domain (no password, so nobody
--     can sign in as them), marked fake in its app metadata
--   - a character and background, with the paid items given to them
--   - step sharing turned on and 8 days of steps, including today
--   - an accepted friendship with you

do $$
declare
  me uuid;
begin
  select id into me from auth.users where lower(email) = 'derekqho@gmail.com';
  if me is null then
    raise exception 'derekqho@gmail.com has not signed up yet. Sign in once in the app, then run this again.';
  end if;

  create temp table fake_players on commit drop as
  select * from (values
    -- id, username, display name, background, typical steps a day, character.
    -- The first 8 characters of each id must differ: the sign-up trigger
    -- makes a temporary username from them (user_xxxxxxxx).
    ('f4ce0001-0000-4000-8000-000000000001'::uuid, 'sam_rivera', 'Sam Rivera', 'map_forest', 9000,
     '{"skin":"#e0a878","hairColor":"#d9534f","hair":"hair_ponytail","face":"face_wink","top":"top_jacket_green","bottom":"bottom_jeans_blue","shoes":"shoes_boots_brown","hat":null,"glasses":"glasses_round","cape":null,"hand":null,"outfit":null}'::jsonb),
    ('f4ce0002-0000-4000-8000-000000000002', 'priya_walks', 'Priya Patel', 'map_beach', 12000,
     '{"skin":"#c68655","hairColor":"#2a1a1a","hair":"hair_long","face":"face_joy","top":"top_tee_white","bottom":"bottom_shorts_blue","shoes":"shoes_sandals","hat":"hat_flowers","glasses":null,"cape":null,"hand":"hand_umbrella","outfit":"outfit_dress"}'),
    ('f4ce0003-0000-4000-8000-000000000003', 'marcus_c', 'Marcus Chen', 'map_city', 7000,
     '{"skin":"#f6c9a0","hairColor":"#2a1a1a","hair":"hair_short","face":"face_determined","top":"top_varsity","bottom":"bottom_track_red","shoes":"shoes_hightop_black","hat":"hat_headphones","glasses":null,"cape":null,"hand":null,"outfit":null}'),
    ('f4ce0004-0000-4000-8000-000000000004', 'luna_okafor', 'Luna Okafor', 'map_space', 15000,
     '{"skin":"#6f4428","hairColor":"#2a1a1a","hair":"hair_afro","face":"face_starry","top":"top_puffer_purple","bottom":"bottom_pants_black","shoes":"shoes_gold","hat":null,"glasses":"glasses_star","cape":"wings_fairy","hand":null,"outfit":null}'),
    ('f4ce0005-0000-4000-8000-000000000005', 'diego_m', 'Diego Morales', 'map_mountain', 11000,
     '{"skin":"#a86b45","hairColor":"#7a4a2a","hair":"hair_buzz","face":"face_smile","top":"top_sweater_yellow","bottom":"bottom_cargo_khaki","shoes":"shoes_rain_yellow","hat":"hat_beanie_teal","glasses":null,"cape":null,"hand":"hand_lantern","outfit":null}'),
    ('f4ce0006-0000-4000-8000-000000000006', 'hana_k', 'Hana Kim', 'map_ocean', 6000,
     '{"skin":"#fde0c8","hairColor":"#f48fb1","hair":"hair_bob","face":"face_cat","top":"top_stripe_navy","bottom":"bottom_skirt_plaid","shoes":"shoes_white","hat":"hat_cat","glasses":null,"cape":null,"hand":"hand_balloon","outfit":null}'),
    ('f4ce0007-0000-4000-8000-000000000007', 'theo_b', 'Theo Bennett', 'map_dungeon', 13000,
     '{"skin":"#e0a878","hairColor":"#5b8def","hair":"hair_mohawk","face":"face_determined","top":"top_hoodie_red","bottom":"bottom_jeans_blue","shoes":"shoes_boots_brown","hat":null,"glasses":"glasses_eyepatch","cape":"cape_red","hand":"hand_sword","outfit":"outfit_knight"}'),
    ('f4ce0008-0000-4000-8000-000000000008', 'ava_rossi', 'Ava Rossi', 'map_village', 3500,
     '{"skin":"#f6c9a0","hairColor":"#f2d16b","hair":"hair_twintails","face":"face_sleepy","top":"top_tee_white","bottom":"bottom_shorts_blue","shoes":"shoes_white","hat":null,"glasses":null,"cape":null,"hand":"hand_lollipop","outfit":"outfit_pajamas"}')
  ) as t(id, username, display_name, map_theme, typical_steps, avatar);

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

  -- Give them the paid items they wear and their background, so the
  -- owned-item triggers accept the profile update below
  insert into public.user_items (user_id, item_id)
  select f.id, s.id
  from fake_players f
  join public.shop_items s
    on s.id = f.map_theme
    or s.id in (select value from jsonb_each_text(f.avatar))
  on conflict do nothing;

  update public.profiles p set
    username           = f.username,
    display_name       = f.display_name,
    avatar             = f.avatar,
    map_theme          = f.map_theme,
    sharing_consent_at = coalesce(p.sharing_consent_at, now())
  from fake_players f
  where p.id = f.id;

  -- 8 days of steps (the oldest the database accepts), today partway
  -- through. Each player varies around their typical day.
  insert into public.daily_steps (user_id, day, steps)
  select
    f.id,
    current_date - d,
    round(f.typical_steps * case when d = 0 then 0.3 + random() * 0.5
                                 else 0.6 + random() * 0.8 end)::int
  from fake_players f
  cross join generate_series(0, 7) as d
  on conflict (user_id, day) do update set steps = excluded.steps;

  -- Accepted friendships with you (one row per pair, either direction)
  insert into public.friendships (requester_id, addressee_id, status)
  select f.id, me, 'accepted' from fake_players f
  on conflict do nothing;
  update public.friendships fr set status = 'accepted'
  from fake_players f
  where least(fr.requester_id, fr.addressee_id) = least(f.id, me)
    and greatest(fr.requester_id, fr.addressee_id) = greatest(f.id, me);

  raise notice 'Added % fake friends for derekqho@gmail.com', (select count(*) from fake_players);
end;
$$;
