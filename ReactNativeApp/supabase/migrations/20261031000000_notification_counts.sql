-- StepTracker: red counts on the tab bar (step-tracker-notifications.txt,
-- Phase 1). One call returns every count the app needs; later counts
-- (group quest votes) are added to the same object.
--
-- Nothing is stored: the counts are worked out from the requests
-- themselves, so they can never drift. The badge clears when the user
-- accepts or declines, not when they open the tab.
--
-- security invoker on purpose: the count reads friendships under the same
-- privacy rules as the Friends screen, so a request from an account that
-- is no longer active is left out of both. Not sharing steps: the Friends
-- tab has no "Requests" section to act on, so nothing is counted. A
-- non-active account sees nothing (6f), so it gets no counts either.
create function public.notification_counts()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'friend_requests', case when public.is_active_account()
                                 and public.has_sharing_consent() then (
      select count(*) from public.friendships f
      where f.addressee_id = auth.uid() and f.status = 'pending')
    else 0 end)
$$;

revoke execute on function public.notification_counts() from public, anon;
grant execute on function public.notification_counts() to authenticated;
