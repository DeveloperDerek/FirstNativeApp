# StepTracker web pages

Static pages for the StepTracker domain (step-tracker-register.txt, 8c and
8f, task 9). Not deployed yet: there is no domain. Any static host with
HTTPS works.

- `auth/confirm/` - a confirmation link opened somewhere without the app
  (e.g. a laptop). Checks the link and says to go back to the phone.

Copy `config.example.js` to `config.js` and fill in the Supabase project
URL and its **publishable** (public) key. Never the secret or service
role key: anyone can read these pages. `config.js` is not committed.

Try it locally (with `supabase start` running and `config.js` pointing at
http://127.0.0.1:54321):

    python3 -m http.server 8098 --directory site

then open the link from Mailpit (http://127.0.0.1:54324) with
`reactnativeapp://` replaced by `http://localhost:8098/`.
