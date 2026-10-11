-- DEV ONLY: removes every fake player made by fake_friends.sql. Deleting
-- the auth user cascades to their profile, steps, items, coins and
-- friendships. Only touches accounts on the reserved .test domain that
-- are marked fake, so real accounts are never affected.
delete from auth.users
where email like '%@fake.steptracker.test'
  and raw_app_meta_data ->> 'fake' = 'true';
