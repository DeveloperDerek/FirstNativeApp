-- DEV ONLY: removes every fake player made by fake_friends.sql. Deleting
-- the auth user cascades to their profile, steps, goals, items, coins,
-- achievements, requests and friendships. Only touches accounts on the
-- reserved .test domain that are marked fake, so real accounts are never
-- affected.
--
-- Trail Crew (made of fake players only) goes first: otherwise deleting
-- its owner hands it to another fake player being deleted in the same
-- statement.
delete from public.groups where id = 'f4ce9998-0000-4000-8000-000000000001';

delete from auth.users
where email like '%@fake.steptracker.test'
  and raw_app_meta_data ->> 'fake' = 'true';
