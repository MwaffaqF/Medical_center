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
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then put a key in SECRETS_KEY (command in the file)
pnpm db:migrate:local          # create the local D1 database
pnpm db:seed:local             # super admin + pilot center + manager + receptionist; prints passwords

pnpm --filter @mc/dashboard build
pnpm dev:api                   # API + built dashboard on http://localhost:8787
```

For dashboard development with hot reload, run `pnpm dev:api` and `pnpm dev:dashboard` together, then open http://localhost:5173 (Vite forwards `/api` to the Worker).

Public website: keep `pnpm dev:api` running, then `pnpm dev:web` and open http://localhost:4321. Locally the website reads data from the API at `API_ORIGIN` (see `apps/web/wrangler.jsonc`); deployed, it uses a Cloudflare service binding. It shows the center whose slug is `CENTER_SLUG` (`pilot` by default).

## Checks

```sh
pnpm typecheck
pnpm test        # API tests run inside the Workers runtime against a real local D1
```

## Database changes

1. Edit `apps/api/src/db/schema.ts`.
2. `pnpm --filter @mc/api db:generate` to create a migration in `apps/api/migrations/`.
3. `pnpm db:migrate:local` and commit the migration. CI fails if the schema and migrations disagree.

## Accounts and sign-in

- **Super admin** (platform owner): signs in at the dashboard, then must set up two-factor sign-in with an authenticator app on first sign-in, and enter a 6-digit code at every sign-in after that.
- **Center staff** are created by the super admin (first manager) or by the center's manager. They get a one-time password and must choose their own at first sign-in.
- After 5 wrong passwords for an email (or 20 from one network) within 15 minutes, sign-in is paused for that email or network.

**Lost the authenticator phone?** Reset two-factor for the super admin from a terminal, then sign in and set it up again:

```sh
cd apps/api
npx wrangler d1 execute DB --remote --env production \
  --command "UPDATE users SET totp_secret=NULL, totp_pending_secret=NULL, totp_last_step=NULL WHERE role='super_admin' AND email='you@example.com'"
```

## Test site (staging)

- Dashboard: https://medical-center-app-staging.mwaffaqfanari.workers.dev
- Website: https://medical-center-web-staging.mwaffaqfanari.workers.dev/ar

GitHub puts the test site online after every change merged into `main` (workflow "Deploy test site"; it can also be run by hand from the Actions tab). It needs the repository secret `CLOUDFLARE_API_TOKEN` (permissions: Workers Scripts Edit, D1 Edit, Workers KV Storage Edit, Account Settings Read). The test site has no bot check (Turnstile) yet.

## Deploying (first time)

```sh
cd apps/api
npx wrangler login
npx wrangler d1 create medical-center-staging --location eeur  # put the id into wrangler.jsonc (env.staging)
npx wrangler kv namespace create medical-center-media-staging  # put the id into wrangler.jsonc (env.staging)
npx wrangler secret put SECRETS_KEY --env staging        # paste a new key (see .dev.vars.example)
npx wrangler d1 migrations apply DB --remote --env staging
SEED_SUPERADMIN_EMAIL=you@example.com SEED_SUPERADMIN_PASSWORD='a-long-password' node scripts/seed.ts --env staging --pilot-center
pnpm --filter @mc/dashboard build && pnpm deploy:staging
```

Everything above works on Cloudflare's **Free plan with no payment card**: Workers, D1, KV (photos and logos) and Turnstile.

Keep `SECRETS_KEY` safe: it encrypts the two-factor secrets. If it is lost, reset two-factor as described above.

The website deploys with `pnpm --filter @mc/web deploy:staging`. Before that:

- Create a **Turnstile** widget in the Cloudflare dashboard for the website's domain. Put its site key in `TURNSTILE_SITE_KEY` (`apps/web/wrangler.jsonc`) and its secret in the API: `npx wrangler secret put TURNSTILE_SECRET --env staging` (in `apps/api`). Without the secret, production refuses online bookings.
- Set `CENTER_SLUG` and `DASHBOARD_URL` for the environment, and deploy the API first: the website calls it through a service binding.
