# FamHack Registration

This version keeps the static site theme and adds a real registration backend:

- Supabase Auth sends email OTP codes.
- Supabase Postgres stores teams, join codes, and approval state.
- Vercel Functions handle secure team creation, join requests, and parent approvals.
- Resend is the recommended free SMTP provider for the OTP emails.

## Required setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Create a Resend account, add your domain, and verify the DNS records Resend gives you.
4. In Supabase Auth:
   - enable Email auth
   - configure a custom SMTP sender using the SMTP credentials from Resend
   - update the email template to show `{{ .Token }}` so users receive a 6-digit code
5. Add the variables from `.env.example` to Vercel.
   - Resend itself is configured inside Supabase Auth, so there are no extra Resend env vars in this repo.
6. Deploy the repo to Vercel.

## Local development

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Run `npm run dev`.

## Flow

- `register.html`: parent logs in with email OTP, creates a family/team, receives a join code.
- `join.html`: child logs in, enters the join code, and submits a join request.
- `dashboard.html`: parent approves or declines requests; children can see pending status.
