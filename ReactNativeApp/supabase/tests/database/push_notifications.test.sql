-- step-tracker-notifications.txt, Phase 3: push addresses and who gets a
-- push. (Expo itself is not called: pg_net only sends after commit, and
-- every test rolls back.)
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- A sends requests; B has two phones; C is someone else; X is blocked
insert into auth.users (id, email) values
  ('000004a1-0000-0000-0000-000000000000', 'a@test.dev'),
  ('000004b1-0000-0000-0000-000000000000', 'b@test.dev'),
  ('000004c1-0000-0000-0000-000000000000', 'c@test.dev'),
  ('000004d1-0000-0000-0000-000000000000', 'x@test.dev');
update public.profiles
set onboarded_at = now(), sharing_consent_at = now(),
    username = case id when '000004a1-0000-0000-0000-000000000000' then 'sam' else username end
where id::text like '000004%';
insert into public.profile_private (user_id, age_blocked_at)
values ('000004d1-0000-0000-0000-000000000000', now());

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true)
$$;
-- The last message sent to Expo, as {token: body}
create function pg_temp.last_push() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(m->>'to', m), '{}'::jsonb)
  from (select body from net.http_request_queue
        where url like '%/push/send' order by id desc limit 1) q,
       jsonb_array_elements(convert_from(q.body, 'utf8')::jsonb) m
$$;
create function pg_temp.sends() returns int language sql as $$
  select count(*)::int from net.http_request_queue where url like '%/push/send'
$$;

set local role authenticated;

-- ---------------------------------------------------------------------
-- Push addresses
-- ---------------------------------------------------------------------
select pg_temp.as_user('000004b1-0000-0000-0000-000000000000');
select lives_ok($$ select public.register_push_device('ExponentPushToken[b-phone]', 'ios') $$,
                'a user can register their device');
select public.register_push_device('ExponentPushToken[b-ipad]', 'ios');
select throws_ok($$ select public.register_push_device('not a token', 'ios') $$,
                 '23514', null, 'only Expo push tokens are accepted');
select throws_ok($$ select * from public.push_devices $$, '42501', null,
                 'push addresses cannot be read, not even your own');
select throws_ok($$ delete from public.push_devices $$, '42501', null,
                 'or deleted directly');
select throws_ok($$ select public.push_friend_request(gen_random_uuid()) $$, '42501', null,
                 'the app can never send a push');
select throws_ok($$ select public.notification_counts_for('000004a1-0000-0000-0000-000000000000') $$,
                 '42501', null, 'or read someone else''s counts');

-- C can't remove B's address
select pg_temp.as_user('000004c1-0000-0000-0000-000000000000');
select public.unregister_push_device('ExponentPushToken[b-phone]');
select public.unregister_other_push_devices(null);
reset role;
select is((select count(*)::int from public.push_devices
           where user_id = '000004b1-0000-0000-0000-000000000000'), 2,
          'nobody can remove another user''s push address');
set local role authenticated;

-- ---------------------------------------------------------------------
-- Who gets a push
-- ---------------------------------------------------------------------
select pg_temp.as_user('000004a1-0000-0000-0000-000000000000');
insert into public.friendships (requester_id, addressee_id)
values ('000004a1-0000-0000-0000-000000000000', '000004b1-0000-0000-0000-000000000000');
reset role;
select is(pg_temp.sends(), 1, 'a new friend request sends one push to Expo');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.last_push()) k),
          array['ExponentPushToken[b-ipad]', 'ExponentPushToken[b-phone]'],
          '...to each of the recipient''s devices');
select is(pg_temp.last_push()->'ExponentPushToken[b-phone]'->>'body', '@sam wants to be friends',
          '...saying who it is from');
select is((pg_temp.last_push()->'ExponentPushToken[b-phone]'->>'badge')::int, 1,
          '...with their total on the app icon');
select is(pg_temp.last_push()->'ExponentPushToken[b-phone]'->'data'->>'url', '/friends',
          '...and tapping it opens Friends');
select is((select tokens from public.push_sends order by sent_at desc limit 1),
          array['ExponentPushToken[b-ipad]', 'ExponentPushToken[b-phone]'],
          'the send is kept so the answer can be matched to the addresses');

-- Notifications turned off
set local role authenticated;
select pg_temp.as_user('000004b1-0000-0000-0000-000000000000');
select public.set_push_enabled(false);
select is((select push_enabled from public.notification_settings), false,
          'a user can turn notifications off, and read their setting');
select pg_temp.as_user('000004c1-0000-0000-0000-000000000000');
insert into public.friendships (requester_id, addressee_id)
values ('000004c1-0000-0000-0000-000000000000', '000004b1-0000-0000-0000-000000000000');
select is(pg_temp.sends(), 1, 'notifications off: no push');
select pg_temp.as_user('000004b1-0000-0000-0000-000000000000');
select public.set_push_enabled(true);
update public.friendships set status = 'declined'
where requester_id = '000004c1-0000-0000-0000-000000000000';

-- Recipient not sharing (no Requests section to see it in)
reset role;
update public.profiles set sharing_consent_at = null
where id = '000004b1-0000-0000-0000-000000000000';
set local role authenticated;
select pg_temp.as_user('000004c1-0000-0000-0000-000000000000');
insert into public.friendships (requester_id, addressee_id)
values ('000004c1-0000-0000-0000-000000000000', '000004b1-0000-0000-0000-000000000000');
select is(pg_temp.sends(), 1, 'recipient not sharing: no push');
reset role;
update public.profiles set sharing_consent_at = now()
where id = '000004b1-0000-0000-0000-000000000000';
delete from public.friendships where requester_id = '000004c1-0000-0000-0000-000000000000';

-- Recipient blocked
insert into public.push_devices (token, user_id, platform)
values ('ExponentPushToken[x-phone]', '000004d1-0000-0000-0000-000000000000', 'ios');
insert into public.friendships (requester_id, addressee_id)
values ('000004c1-0000-0000-0000-000000000000', '000004d1-0000-0000-0000-000000000000');
select is(pg_temp.sends(), 1, 'recipient no longer active: no push');

-- Sender blocked (their requests are hidden from the recipient)
insert into public.push_devices (token, user_id, platform) values
  ('ExponentPushToken[a-phone]', '000004a1-0000-0000-0000-000000000000', 'ios'),
  ('ExponentPushToken[c-phone]', '000004c1-0000-0000-0000-000000000000', 'ios');
insert into public.friendships (requester_id, addressee_id)
values ('000004d1-0000-0000-0000-000000000000', '000004a1-0000-0000-0000-000000000000');
select is(pg_temp.sends(), 1, 'sender no longer active: no push');
delete from public.push_devices where token = 'ExponentPushToken[a-phone]';

-- ---------------------------------------------------------------------
-- Moving and removing addresses
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('000004c1-0000-0000-0000-000000000000');
select public.register_push_device('ExponentPushToken[b-ipad]', 'ios');
reset role;
select is((select user_id::text from public.push_devices where token = 'ExponentPushToken[b-ipad]'),
          '000004c1-0000-0000-0000-000000000000',
          'a device signing in to another account moves there; it is never kept for both');

set local role authenticated;
select pg_temp.as_user('000004b1-0000-0000-0000-000000000000');
select public.unregister_push_device('ExponentPushToken[b-phone]');
reset role;
select is((select count(*)::int from public.push_devices
           where user_id = '000004b1-0000-0000-0000-000000000000'), 0,
          'sign-out removes that device''s address');

insert into public.push_devices (token, user_id, platform) values
  ('ExponentPushToken[c-2]', '000004c1-0000-0000-0000-000000000000', 'ios'),
  ('ExponentPushToken[c-3]', '000004c1-0000-0000-0000-000000000000', 'android');
set local role authenticated;
select pg_temp.as_user('000004c1-0000-0000-0000-000000000000');
select public.unregister_other_push_devices('ExponentPushToken[c-phone]');
reset role;
select is((select array_agg(token) from public.push_devices
           where user_id = '000004c1-0000-0000-0000-000000000000'),
          array['ExponentPushToken[c-phone]'],
          '"Sign out other devices" removes every other address of the account');

set local role authenticated;
select pg_temp.as_user('000004d1-0000-0000-0000-000000000000');
select public.register_push_device('ExponentPushToken[x-new]', 'ios');
select public.unregister_push_device('ExponentPushToken[x-phone]');
reset role;
select is((select count(*)::int from public.push_devices
           where user_id = '000004d1-0000-0000-0000-000000000000'), 0,
          'a blocked account cannot add an address, but can still remove its own');

-- ---------------------------------------------------------------------
-- Dead addresses
-- ---------------------------------------------------------------------
insert into public.push_devices (token, user_id, platform) values
  ('ExponentPushToken[live]', '000004a1-0000-0000-0000-000000000000', 'ios'),
  ('ExponentPushToken[dead-now]', '000004a1-0000-0000-0000-000000000000', 'ios'),
  ('ExponentPushToken[dead-later]', '000004a1-0000-0000-0000-000000000000', 'ios');
insert into public.push_sends (request_id, tokens) values
  (-1, array['ExponentPushToken[dead-later]', 'ExponentPushToken[dead-now]', 'ExponentPushToken[live]']);
insert into net._http_response (id, status_code, content) values
  (-1, 200, '{"data": [{"status": "ok", "id": "t-later"},
                       {"status": "error", "message": "gone",
                        "details": {"error": "DeviceNotRegistered"}},
                       {"status": "ok", "id": "t-live"}]}');
select public.push_cleanup();
select is((select array_agg(token order by token) from public.push_devices
           where user_id = '000004a1-0000-0000-0000-000000000000'),
          array['ExponentPushToken[dead-later]', 'ExponentPushToken[live]'],
          'an address Expo reports dead in the ticket is removed');
select is((select array_agg(token order by token) from public.push_tickets),
          array['ExponentPushToken[dead-later]', 'ExponentPushToken[live]'],
          '...and the accepted tickets are kept for their receipts');

update public.push_tickets set created_at = now() - interval '20 minutes';
select public.push_cleanup();
select is((select count(*)::int from public.push_tickets where receipt_request_id is not null), 2,
          'receipts are asked for after 15 minutes');

insert into net._http_response (id, status_code, content)
select receipt_request_id, 200,
       '{"data": {"t-live": {"status": "ok"},
                  "t-later": {"status": "error", "details": {"error": "DeviceNotRegistered"}}}}'
from public.push_tickets limit 1;
select public.push_cleanup();
select is((select array_agg(token) from public.push_devices
           where user_id = '000004a1-0000-0000-0000-000000000000'),
          array['ExponentPushToken[live]'],
          'an address Expo reports dead in the receipt is removed; the live one stays');

select * from finish();
rollback;
