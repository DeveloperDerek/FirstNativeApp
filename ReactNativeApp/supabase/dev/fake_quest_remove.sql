-- DEV ONLY: removes the Quest Testers group made by fake_quest.sql. Its
-- quests, votes and steps go with it. Coins already paid stay paid.
delete from public.groups where id = 'f4ce9999-0000-4000-8000-000000000001';
