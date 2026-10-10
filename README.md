# Kryin Ephor

A multi-tenant school management app built with React, TypeScript, Vite and Supabase. It includes school and user management, classes, attendance, assessments, fees, student/parent dashboards, AI connections and platform operations.

Built by Arth with Codex. This is proprietary software; see [LICENSE](LICENSE).

## Local development

Use Node.js 22 or later and npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the local environment file. Configure server-only OAuth/MCP secrets separately using the names in `.env.example`. Never prefix server secrets with `VITE_` or commit real environment files.

```sh
npm run build
npm test
```

Tests requiring a migrated test database skip when `DATABASE_URL` / `SUPABASE_DB_URL` is unavailable. The isolated operations database test uses PGlite through `PGLITE_TEST_MODULE`; see [OPERATIONS.md](OPERATIONS.md) for its setup and coverage.

## App and backend

- `src/`: frontend pages, components and shared logic.
- `public/`: website assets, landing page, app icons and service worker.
- `api/`: Vercel OAuth and MCP endpoints.
- `supabase/migrations/`: versioned database changes, policies and RPCs.
- `supabase/functions/`: server-side Edge Functions.
- `monitoring/`: infrastructure health collector used by the live health console.
- `tests/`, `scripts/`, `.github/`: regression tests and CI checks.

[Platform operations](OPERATIONS.md) documents maintenance controls, live health, cache cleanup and activity history. [Identity and access architecture](docs/IDENTITY_AND_ACCESS_ARCHITECTURE.md) documents account relationships and access rules.

Local backups, video projects, AI-tool state, CLI cache and old audit reports are excluded from Git. Their local copies can be kept without deploying them with the website.

## Deployment

The production GitHub repository is [Kryin-Labs/KryinEphor](https://github.com/Kryin-Labs/KryinEphor), using the `kryin` remote. Set the frontend and server environment variables in Vercel before deployment.

```sh
npm run push:deploy
```

The `origin` remote points to the personal backup repository. `npm run push:sync` explicitly updates both remotes.

Supabase migrations and Edge Functions require separate deployment. Pushing website code does not apply database migrations or start the monitoring collector.
