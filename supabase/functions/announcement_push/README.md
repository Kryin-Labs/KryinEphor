# Announcement Web Push setup

1. Apply `supabase/migrations/20260929120000_announcements.sql` and deploy `announcement_push` with the Supabase CLI.
2. Generate a VAPID key pair with `npx web-push generate-vapid-keys`.
3. Set Edge Function secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` address or HTTPS URL). Keep the private key out of the frontend and Git.
4. Set the matching `VITE_VAPID_PUBLIC_KEY` on the web deployment and rebuild it. Add the web origin to `ALLOWED_ORIGINS` when it is outside the existing app origins.

Users opt in from **Announcements → Enable device alerts**. On iPhone and iPad, install the site to the Home Screen before enabling alerts. The in-app bell and dashboard work without VAPID keys; background delivery requires the steps above.
