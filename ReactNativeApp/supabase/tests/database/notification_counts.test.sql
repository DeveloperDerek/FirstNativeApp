-- step-tracker-notifications.txt, Phase 1: the Friends tab badge counts
-- pending requests sent TO you, under the same privacy rules as the
-- Friends screen.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- A receives requests; S1, S2 active senders; X blocked sender; N not sharing
insert into auth.users (id, email) values
  ('000002a1-0000-0000-0000-000000000000', 'a@test.dev'),
  ('000002b1-0000-0000-0000-000000000000', 's1@test.dev'),
  ('000002b2-0000-0000-0000-000000000000', 's2@test.dev'),
  ('000002c1-0000-0000-0000-000000000000', 'x@test.dev'),
  ('000002d1-0000-0000-0000-000000000000', 'n@test.dev'),
  ('000002e1-0000-0000-0000-000000000000', 'f@test.dev');

update public.profiles set onboarded_at = now(), sharing_consent_at = now()
where id::text like '000002%';
update public.profiles set sharing_consent_at = null
where id = '000002d1-0000-0000-0000-000000000000';

insert into public.friendships (requester_id, addressee_id, status) values
  ('000002b1-0000-0000-0000-000000000000', '000002a1-0000-0000-0000-000000000000', 'pending'),
  ('000002b2-0000-0000-0000-000000000000', '000002a1-0000-0000-0000-000000000000', 'pending'),
  ('000002c1-0000-0000-0000-000000000000', '000002a1-0000-0000-0000-000000000000', 'pending'),
  ('000002a1-0000-0000-0000-000000000000', '000002d1-0000-0000-0000-000000000000', 'pending'),
  ('000002e1-0000-0000-0000-000000000000', '000002a1-0000-0000-0000-000000000000', 'accepted');

-- X is blocked: their request disappears from the list and the count
insert into public.profile_private (user_id, age_blocked_at)
values ('000002c1-0000-0000-0000-000000000000', now());

set local role authenticated;
set local request.jwt.claim.sub = '000002a1-0000-0000-0000-000000000000';
select is(public.notification_counts(), '{"quest_votes": 0, "next_vote_deadline": null, "friend_requests": 2}'::jsonb,
          'counts pending requests sent to you, without the blocked sender''s');
select is((public.notification_counts()->>'friend_requests')::int,
          (select count(*)::int from public.friendships
           where status = 'pending' and addressee_id = auth.uid()),
          'the badge and the Requests section agree');

update public.friendships set status = 'accepted'
where requester_id = '000002b1-0000-0000-0000-000000000000';
select is(public.notification_counts(), '{"quest_votes": 0, "next_vote_deadline": null, "friend_requests": 1}'::jsonb,
          'accepting drops the count');
update public.friendships set status = 'declined'
where requester_id = '000002b2-0000-0000-0000-000000000000';
select is(public.notification_counts(), '{"quest_votes": 0, "next_vote_deadline": null, "friend_requests": 0}'::jsonb,
          'declining drops the count');

set local request.jwt.claim.sub = '000002b1-0000-0000-0000-000000000000';
select is(public.notification_counts(), '{"quest_votes": 0, "next_vote_deadline": null, "friend_requests": 0}'::jsonb,
          'requests you sent are never counted');

set local request.jwt.claim.sub = '000002d1-0000-0000-0000-000000000000';
select is(public.notification_counts(), '{"quest_votes": 0, "next_vote_deadline": null, "friend_requests": 0}'::jsonb,
          'not sharing: no Requests section, so no count');

set local request.jwt.claim.sub = '000002c1-0000-0000-0000-000000000000';
select is(public.notification_counts(), '{"quest_votes": 0, "next_vote_deadline": null, "friend_requests": 0}'::jsonb,
          'a blocked account gets no counts');

reset role;
set local role anon;
select throws_ok($$ select public.notification_counts() $$, '42501', null,
                 'signed out: cannot call it');

select * from finish();
rollback;
