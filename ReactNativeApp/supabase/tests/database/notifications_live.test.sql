-- step-tracker-notifications.txt, Phase 2: friend requests end in a status
-- (so live updates reach the right person), and the Groups badge counts
-- quests waiting for your vote.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- A and B are the pair; C is an outsider
insert into auth.users (id, email) values
  ('000003a1-0000-0000-0000-000000000000', 'a@test.dev'),
  ('000003b1-0000-0000-0000-000000000000', 'b@test.dev'),
  ('000003c1-0000-0000-0000-000000000000', 'c@test.dev');
update public.profiles set onboarded_at = now(), sharing_consent_at = now()
where id::text like '000003%';

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true)
$$;
create function pg_temp.status() returns text language sql as $$
  select status from public.friendships
  where requester_id = '000003a1-0000-0000-0000-000000000000'
    and addressee_id = '000003b1-0000-0000-0000-000000000000'
    and status in ('pending', 'accepted')
$$;

set local role authenticated;

-- ---------------------------------------------------------------------
-- Request lifecycle
-- ---------------------------------------------------------------------
select pg_temp.as_user('000003a1-0000-0000-0000-000000000000');
insert into public.friendships (requester_id, addressee_id)
values ('000003a1-0000-0000-0000-000000000000', '000003b1-0000-0000-0000-000000000000');

select throws_ok($$ update public.friendships set status = 'accepted' $$,
                 '42501', 'FRIENDSHIP_CHANGE_NOT_ALLOWED',
                 'the sender cannot accept their own request');
select throws_ok($$ update public.friendships set status = 'declined' $$,
                 '42501', 'FRIENDSHIP_CHANGE_NOT_ALLOWED',
                 'the sender cannot decline their own request');
update public.friendships set status = 'cancelled';
select is((select status from public.friendships), 'cancelled', 'the sender can cancel');
select isnt((select responded_at from public.friendships), null, '...and the time is kept');

select pg_temp.as_user('000003b1-0000-0000-0000-000000000000');
select is((select status from public.friendships), 'cancelled',
          'the person it was sent to can still read the cancelled row (needed for live updates)');
select is((public.notification_counts()->>'friend_requests')::int, 0,
          'a cancelled request is not counted');

-- A cancelled row doesn't block a new request
select pg_temp.as_user('000003a1-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.friendships (requester_id, addressee_id)
                   values ('000003a1-0000-0000-0000-000000000000',
                           '000003b1-0000-0000-0000-000000000000') $$,
                'after a cancel, a new request can be sent');
select pg_temp.as_user('000003b1-0000-0000-0000-000000000000');
select throws_ok($$ insert into public.friendships (requester_id, addressee_id)
                    values ('000003b1-0000-0000-0000-000000000000',
                            '000003a1-0000-0000-0000-000000000000') $$,
                 '23505', null, 'still only one live request per pair');
select throws_ok($$ update public.friendships set status = 'cancelled' where status = 'pending' $$,
                 '42501', 'FRIENDSHIP_CHANGE_NOT_ALLOWED',
                 'the person it was sent to cannot cancel it');
update public.friendships set status = 'declined' where status = 'pending';
select is(pg_temp.status(), null, 'they can decline');

select pg_temp.as_user('000003a1-0000-0000-0000-000000000000');
select lives_ok($$ insert into public.friendships (requester_id, addressee_id)
                   values ('000003a1-0000-0000-0000-000000000000',
                           '000003b1-0000-0000-0000-000000000000') $$,
                'after a decline, a new request can be sent');
select pg_temp.as_user('000003b1-0000-0000-0000-000000000000');
update public.friendships set status = 'accepted' where status = 'pending';
select is(pg_temp.status(), 'accepted', 'they can accept');

select throws_ok($$ update public.friendships set status = 'declined' where status = 'accepted' $$,
                 '42501', 'FRIENDSHIP_CHANGE_NOT_ALLOWED',
                 'an accepted friendship cannot be declined');
select throws_ok($$ update public.friendships set status = 'pending' where status = 'accepted' $$,
                 '42501', 'FRIENDSHIP_CHANGE_NOT_ALLOWED', 'or sent back to pending');

-- Nothing deletes from the app
select throws_ok($$ delete from public.friendships $$, '42501', null,
                 'friendships cannot be deleted from the app');

-- Remove friend
select pg_temp.as_user('000003c1-0000-0000-0000-000000000000');
update public.friendships set status = 'removed';
select is((select count(*)::int from public.friendships), 0, 'an outsider sees none of it');
select pg_temp.as_user('000003a1-0000-0000-0000-000000000000');
update public.friendships set status = 'removed' where status = 'accepted';
select is(pg_temp.status(), null, 'either friend can remove the friendship');
select is(public.is_friend('000003b1-0000-0000-0000-000000000000'), false,
          '...and they are no longer friends');

-- Live updates
reset role;
select ok(exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'friendships'),
          'friendships send live updates');

-- ---------------------------------------------------------------------
-- Quests waiting for your vote
-- ---------------------------------------------------------------------
insert into public.groups (id, name, owner_id, invite_code) values
  ('000003e1-0000-0000-0000-000000000000', 'Walkers', '000003a1-0000-0000-0000-000000000000', 'walk3rs1'),
  ('000003e2-0000-0000-0000-000000000000', 'Hikers',  '000003a1-0000-0000-0000-000000000000', 'hik3rs01');
insert into public.group_members (group_id, user_id) values
  ('000003e1-0000-0000-0000-000000000000', '000003b1-0000-0000-0000-000000000000'),
  ('000003e2-0000-0000-0000-000000000000', '000003b1-0000-0000-0000-000000000000');

insert into public.quests (id, group_id, type_id, status, start_asap, vote_deadline, goal) values
  -- waiting for B; the soonest deadline
  ('000003f1-0000-0000-0000-000000000000', '000003e1-0000-0000-0000-000000000000',
   'sprint', 'voting', true, now() + interval '30 minutes', 8000),
  ('000003f2-0000-0000-0000-000000000000', '000003e2-0000-0000-0000-000000000000',
   'sprint', 'voting', true, now() + interval '2 hours', 8000),
  -- deadline passed but nothing has moved it on: not counted
  ('000003f3-0000-0000-0000-000000000000', '000003e2-0000-0000-0000-000000000000',
   'sprint', 'voting', true, now() - interval '1 minute', 8000),
  -- already started
  ('000003f4-0000-0000-0000-000000000000', '000003e2-0000-0000-0000-000000000000',
   'sprint', 'active', true, now() + interval '1 hour', 8000);
-- A proposed them, so A has voted on the live ones
insert into public.quest_votes (quest_id, user_id, accepted) values
  ('000003f1-0000-0000-0000-000000000000', '000003a1-0000-0000-0000-000000000000', true),
  ('000003f2-0000-0000-0000-000000000000', '000003a1-0000-0000-0000-000000000000', true);

set local role authenticated;
select pg_temp.as_user('000003b1-0000-0000-0000-000000000000');
select is((public.notification_counts()->>'quest_votes')::int, 2,
          'counts voting quests you haven''t voted on, with deadlines still ahead');
select is((public.notification_counts()->>'next_vote_deadline')::timestamptz,
          (select vote_deadline from public.quests
           where id = '000003f1-0000-0000-0000-000000000000'),
          'gives the soonest deadline, for the app''s timer');

reset role;
insert into public.quest_votes (quest_id, user_id, accepted) values
  ('000003f1-0000-0000-0000-000000000000', '000003b1-0000-0000-0000-000000000000', true);
set local role authenticated;
select pg_temp.as_user('000003b1-0000-0000-0000-000000000000');
select is((public.notification_counts()->>'quest_votes')::int, 1, 'voting clears it');

select pg_temp.as_user('000003a1-0000-0000-0000-000000000000');
select is((public.notification_counts()->>'quest_votes')::int, 0,
          'the proposer (already voted) is not counted');

select pg_temp.as_user('000003c1-0000-0000-0000-000000000000');
select is(public.notification_counts(),
          '{"friend_requests": 0, "quest_votes": 0, "next_vote_deadline": null}'::jsonb,
          'other groups'' quests are never counted');

select * from finish();
rollback;
