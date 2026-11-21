# Medical_center

Booking and website platform for a multi-specialty medical center: Arabic and English, mobile-first, WhatsApp-friendly. Runs on Cloudflare (Free plan for the pilot).

- [MVP Specification](docs/MVP-SPEC.md)

## Structure

```
apps/
  api/        Backend API (Hono on Cloudflare Workers, D1 + Drizzle). Also serves the dashboard's static files.
  dashboard/  Staff dashboard (React + Vite, Tailwind). Reception, manager, doctor, super admin.
  web/        Public website (Astro, server-rendered on Workers).
packages/
  shared/     Types, enums, validation, phone handling, Arabic/English messages.
```

## Requirements

- Node.js 22+
- pnpm 10 (`corepack enable`)

## Getting started (local)

```sh
pnpm install
pnpm db:migrate:local          # create the local D1 database
pnpm db:seed:local             # super admin + pilot center + manager + receptionist; prints passwords

pnpm --filter @mc/dashboard build
pnpm dev:api                   # API + built dashboard on http://localhost:8787
```

For dashboard development with hot reload, run `pnpm dev:api` and `pnpm dev:dashboard` together, then open http://localhost:5173 (Vite forwards `/api` to the Worker).

Public website: `pnpm dev:web` and open http://localhost:4321.

## Checks

```sh
pnpm typecheck
pnpm test        # API tests run inside the Workers runtime against a real local D1
```

## Database changes

1. Edit `apps/api/src/db/schema.ts`.
2. `pnpm --filter @mc/api db:generate` to create a migration in `apps/api/migrations/`.
3. `pnpm db:migrate:local` and commit the migration. CI fails if the schema and migrations disagree.

## Deploying (first time)

```sh
cd apps/api
npx wrangler login
npx wrangler d1 create medical-center-staging      # put the id into wrangler.jsonc (env.staging)
npx wrangler d1 migrations apply DB --remote --env staging
SEED_SUPERADMIN_EMAIL=you@example.com SEED_SUPERADMIN_PASSWORD='a-long-password' node scripts/seed.ts --env staging
pnpm --filter @mc/dashboard build && pnpm deploy:staging
```

The website deploys with `pnpm --filter @mc/web deploy:staging`.
