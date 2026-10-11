# StepTracker support: birthday corrections

For whoever answers support email. The rules behind this are in
`step-tracker-register.txt`, section 6g (and 6f for under-age accounts).
The commands match `supabase/migrations/20261023000000_register.sql`; if
those functions change, update this file in the same commit.

People can't change their birthday in the app. They ask, support checks
the request, and the database applies it. Nothing here needs, or should
ever involve, the person's password.

## Where to run the commands

Supabase dashboard > SQL Editor, signed in to the StepTracker project.
The editor runs with admin rights, which these functions require (the app
can't run them). Never paste the service role key anywhere else, and never
send it to anyone.

## 1. Is the request really from the account's owner?

An email that only *looks* like it comes from the account's address is
not proof: the sender of an email can be faked. Only these count:

- **In the app (the normal way).** Profile > Wrong date? creates a
  request tied to the signed-in account. It is already verified; there
  is nothing to check.
- **By a link sent to the account's email.** Not available yet: it needs
  the domain and email sender from section 8f. Until then, if someone
  writes in and can't use the app:
  - If they can't sign in, point them to "Forgot password?" on the
    sign-in screen. Once signed in, they use Wrong date?.
  - If they no longer have access to the email address, there is no
    self-service way back (section 8d). Don't change anything.

Never ask for their password, and never accept a screenshot or a
"from" address as proof.

## 2. Find the open requests

```sql
select r.id            as request_id,
       u.email,
       p.username,
       x.birth_date    as birthday_now,
       r.requested_birth_date,
       r.note,
       r.verified_via,
       r.verified_at,
       r.created_at
from public.birthday_correction_requests r
join auth.users u on u.id = r.user_id
join public.profiles p on p.id = r.user_id
left join public.profile_private x on x.user_id = r.user_id
where r.status = 'open'
order by r.created_at;
```

Only requests with a `verified_at` can be applied.

## 3. Before applying: would the new date make them too young?

```sql
select public.is_under_minimum_age('2015-06-01');  -- the requested date
```

If this says `true`, the correction **closes the account**: it is blocked
at once and deleted, with everything in it, within about an hour. Tell
the person this first and wait for them to confirm. This is the same rule
as at sign-up, even for an account that has been in use for years.

## 4. Apply it

```sql
select public.correct_birth_date(
  '<request_id>',
  'Typo at sign-up, confirmed by the user in the app',  -- the reason
  'Your name'                                           -- who ran it
);
```

It answers `corrected` (birthday replaced) or `blocked` (under the
minimum age, see step 3). It uses the date from the request; there is no
way to type a different one here.

If it refuses:

| Message                | Meaning                                                         |
|------------------------|-----------------------------------------------------------------|
| `REQUEST_NOT_VERIFIED` | Not verified, already handled, or no such request.              |
| `AGE_BLOCKED`          | The account is already blocked for age. A correction can't undo that. |
| `BAD_BIRTH_DATE`       | The date is in the future or over 120 years ago.                |
| `REASON_REQUIRED`, `RUN_BY_REQUIRED` | Fill in the reason and your name.                 |

## 5. Or turn it down

```sql
select public.reject_birthday_correction(
  '<request_id>',
  'Why it was turned down',
  'Your name'
);
```

Either way the requested date is deleted from the request once it is
handled, and the person can send a new request from the app.

## 6. The record

Every correction and refusal is kept, even after an account is deleted.
The dates themselves are never copied into it.

```sql
select run_at, run_by, user_id, request_id, verified_via, reason, outcome
from public.birthday_correction_audit
order by run_at desc;
```

## Also worth checking now and then

Accounts blocked for age are deleted by an hourly job. If a deletion
fails, the account stays blocked and the job tries again the next hour.
Failures show up here:

```sql
select run_at, user_id, error
from public.account_cleanup_log
where outcome = 'failed'
order by run_at desc;
```

One failure that keeps repeating for the same account needs a developer.
