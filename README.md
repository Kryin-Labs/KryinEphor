# KryinEphor

School management app built with React, Vite, and Supabase.

## Local development

1. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Run `npm ci` and `npm run dev`.

## Vercel

Import this repository as a Vite project. Use `npm run build` and output directory `dist`. Set the same Supabase variables in Vercel. Set `VITE_VAPID_PUBLIC_KEY` to enable background announcement notifications.

The Supabase migrations and Edge Functions are in `supabase/`. Keep service credentials and VAPID private keys in Supabase secrets, never in this repository.