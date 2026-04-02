# FamHack Registration

This version keeps the static site theme and adds a real registration backend:

- Supabase Auth sends email OTP codes.
- Supabase Postgres stores teams, join codes, and approval state.
- Vercel Functions handle secure team creation, join requests, and parent approvals.
- Resend is the recommended free SMTP provider for the OTP emails.
- Resend can also send themed parent-invite emails from the child flow.
- Teams are capped at 15 approved members.
- Children can cancel pending requests or leave an approved family from the dashboard.
- Parents can transfer ownership to an approved child before leaving.
- Children can pick `Hunter` or `Hacker`, join a child pool, or email a parent a registration link.
- Parents can choose between registering their own family or becoming a volunteer parent for children who need a random family.
- The CTF now saves progress per individual user and uses an individual leaderboard.

## Required setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
   - If you already set this project up earlier, re-run the file so the team-size trigger, parent-transfer function, and individual CTF tables are installed.
3. Create a Resend account, add your domain, and verify the DNS records Resend gives you.
4. In Supabase Auth:
   - enable Email auth
   - configure a custom SMTP sender using the SMTP credentials from Resend
   - update the email template to show `{{ .Token }}` so users receive a 6-digit code
5. Add the variables from `.env.example` to Vercel.
   - `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are only required for the child -> parent invite emails.
6. Deploy the repo to Vercel.

## Local development

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Run `npm run dev`.

## Flow

- `register.html`: parent logs in with email OTP, creates a family/team, receives a join code.
- `join.html`: child logs in, chooses `Hunter` or `Hacker`, then joins a family by code, joins a random volunteer family, or emails a parent an invite link.
- `dashboard.html`: parents choose `family` or `volunteer parent` when creating their team. Volunteer parents can browse the random-family pool and add a waiting child directly.
- Parent-to-child invite links now open a themed invite letter instead of just dropping the child on the page.
- `ctf.html`: each signed-in user has their own saved CTF run and appears on the individual leaderboard.
- Team limits and parent transfers are enforced on the server. The frontend cannot bypass the 15-person cap.
