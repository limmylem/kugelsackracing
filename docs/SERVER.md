# The game's server (Phase 6 Step 1)

The server keeps accounts, roles, world content, the day's and the week's tracks, records, leaderboards and
race replays. It also serves the game itself from the same address, so the session cookie stays
first-party. The economy (money, cars, parts) is still kept in each player's browser, tied to their
account; Phase 6 Step 2 moves it to the server.

- **Stack:** Fastify 5 and TypeScript (Node 22 runs the `.ts` files directly), PostgreSQL 16 with PostGIS,
  Drizzle migrations, Better Auth for accounts, and Zod schemas shared by the client and the server
  (`packages/shared`).
- **Code:** `server/src` (`main.ts` starts it, `app.ts` builds it). Tests are in `server/test`, tools in
  `server/tools`, migrations in `server/drizzle`, settings for each environment in `server/config/*.json`.
- **Secrets** come only from environment variables (`server/.env.example` lists them). Nothing secret is
  in the code, the config files or the game's pages.

## Running it on your computer

Either with Docker:

```sh
docker compose up --build        # the game and the API on http://localhost:8787, emails at http://localhost:8025
```

Or with a PostgreSQL that has PostGIS:

```sh
cp server/.env.example server/.env   # fill in DATABASE_URL and BETTER_AUTH_SECRET (openssl rand -base64 32)
npm run server:dev                    # migrates the database, then serves on PUBLIC_URL
```

- Set `ADMIN_EMAIL` to your email. When that account has signed up and confirmed its email, it becomes an
  admin (once; it's logged). Make other editors and admins on the admin page, `/admin/`.
- Development mail: `SMTP_URL=memory://` keeps it in memory. Mailpit (with Docker) shows every email.
- A page served without the server (the old `npm start`) still works as the local-only game.

## Tests

| Command | What |
|---|---|
| `npm run test:server` | Every server test against a real PostgreSQL with PostGIS: accounts, roles, world content, tracks and the API's defences. Set `TEST_DATABASE_URL` to an admin connection; each test file makes its own database. |
| `npm run server:typecheck` | The server's TypeScript, strict. |
| `npm run stress:content -w @kr/server` | 50,000 markers in PostGIS against the Phase 4 limits. |
| `npm run test:browser -w @kr/server` | The account flows in Chromium: sign up, confirm, reset, guest to account, delete, offline. |
| `npm run load-test -w @kr/server` | 500 players signing in at once and loading nearby content. |

The pre-commit hook doesn't run these, because they need PostgreSQL. CI runs them on every push
(`.github/workflows/server.yml`).

## The API

Everything is under `/api/v1` and uses Zod schemas from `packages/shared` on every request and response.
Errors always have one shape: `{ error: { code, message, details?, requestId } }`.

- **Accounts** are Better Auth's endpoints under `/api/auth`. Ours are `/me`, `/me/terms`,
  `/me/name-check`, `PATCH /me/name`, `/me/sign-out-everywhere`, `/me/export` and `DELETE /me`.
- **Admin** (admins only): `/admin/players`, `/admin/players/:id`, and for a player `/role`, `/suspend`,
  `/ban`, `/unban` and `/sign-out`. `/admin/audit` is the log. Better Auth's own admin endpoints are closed
  to browsers.
- **World content** (`/content`, `/content/cells/:hash`, `/content/tiles/:z/:x/:y`, `/content/items/…`):
  - The same requests as the local service (docs/WORLD_CONTENT.md).
  - Published content is public and cached by the server, browsers and a CDN (an ETag that changes on
    publish).
  - Drafts and every write are for editors only.
- **Tracks:**
  - `/tracks/today` gives the day's and the week's tracks.
  - `POST /tracks/results` hands a run in; it's checked by the game's own rules against the course the
    server built.
  - `/tracks/leaderboard` and `/tracks/records` give leaderboards and records.
  - `/replays` stores race replays.
- **Every write** needs:
  - an `Idempotency-Key` (a retry is applied once);
  - with a session cookie, the CSRF token from `/csrf` in `x-csrf-token`.
- **Rate limits:** per address for everything, stricter on signing in, signing up and the emails, and per
  account for writes.

## Security

- **Passwords:** Better Auth hashes them with scrypt (Node's native implementation). They're never logged
  or returned.
- **Session:** an httpOnly cookie, SameSite=Lax, and Secure in staging and production. You can sign out
  everywhere. Resetting a password ends every other session.
- **Headers:** a strict content security policy, HSTS in staging and production, nosniff, no framing.
  CORS allows only the game's own origin.
- **Logs** never hold a password, token, cookie or secret query value; reset tokens in paths are redacted.
- **Sentry** (server and browser) collects nothing personal.
- **Roles** are the server's. Editor and admin endpoints check the role as the request arrives, before
  its body is read. Every admin action is logged.
- `npm audit --omit=dev --audit-level=high` runs in CI.

## Hosting: one-time setup

Everything below is on free plans. Paid plans come later, when there are more players.

### 1. Neon (the databases)

1. Sign up at neon.com.
2. Create two projects, `kugelsack-staging` and `kugelsack-production` (PostgreSQL 16, a region near you).
3. In each, copy the connection string (Connect → "Connection string", with `sslmode=require`). These
   become `DATABASE_URL` for that environment.
4. Nothing else is needed: the server switches PostGIS on and runs every migration when it starts.

### 2. Gmail (email: confirmations and password resets)

1. On the Google account that will send the mail, turn on 2-Step Verification.
2. Go to myaccount.google.com → Security → App passwords, and create one called "Kugelsack Racing".
3. `SMTP_URL` is `smtps://YOUR.ADDRESS%40gmail.com:THE-APP-PASSWORD@smtp.gmail.com:465` (the `@` in the
   address written as `%40`). `MAIL_FROM` is `Kugelsack Racing <YOUR.ADDRESS@gmail.com>`.
4. Gmail sends about 500 a day. Move to Resend with your own domain later.

### 3. Render (the server: staging and production)

1. Sign up at render.com with GitHub, then New → Blueprint, and pick this repository. It reads
   `render.yaml` and makes `kugelsack-staging` and `kugelsack-production` (free web services).
2. In each service's Environment, fill in the values it asks for:
   - `PUBLIC_URL` is the service's own address (e.g. `https://kugelsack-staging.onrender.com`).
   - `DATABASE_URL` comes from Neon.
   - `BETTER_AUTH_SECRET`: a new `openssl rand -base64 32` for each service, different for each.
   - `SMTP_URL` and `MAIL_FROM` come from Gmail.
   - `ADMIN_EMAIL` is your email.
   - The Google, Discord and Sentry values come from steps 4 to 6 (leave them empty until then).
3. In each service's Settings, copy the Deploy Hook URL (for step 7).
4. Free services sleep after 15 minutes without players. The first visit after that waits about a
   minute, and the game shows "Waking the server…".

### 4. Google sign-in

1. Go to console.cloud.google.com, make a project, then APIs & Services:
   - OAuth consent screen: External, the app's name, your email.
   - Credentials → Create credentials → OAuth client ID → Web application.
2. Authorised redirect URIs: `https://kugelsack-staging.onrender.com/api/auth/callback/google` and the
   production one.
3. Put the client ID and secret in Render as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### 5. Discord sign-in

1. Go to discord.com/developers → New Application → OAuth2.
2. Add the redirects `…/api/auth/callback/discord` for staging and production.
3. Put the client ID and secret in Render as `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.

### 6. Sentry (errors)

1. Go to sentry.io (free plan) and make two projects: a Node.js one (its DSN is `SENTRY_DSN`) and a
   browser JavaScript one (`SENTRY_CLIENT_DSN`).
2. Set them on both Render services. Sentry's own environment filter tells staging from production.

### 7. GitHub (tests, deploys, backups)

1. Settings → Environments:
   - Make `staging`, with the variable `STAGING_URL` and the secret `RENDER_STAGING_DEPLOY_HOOK`.
   - Make `production`, with the variable `PRODUCTION_URL` and the secret `RENDER_PRODUCTION_DEPLOY_HOOK`.
     Under "Required reviewers" add yourself: a production deploy waits for your approval.
2. Settings → Secrets → Actions (repository secrets):
   - `PRODUCTION_DATABASE_URL` and `STAGING_DATABASE_URL` (from Neon).
   - `BACKUP_PASSPHRASE`: a long random passphrase. Keep a copy somewhere safe too; without it the backups
     can't be read.

After that, every push to `main` runs the tests (`server.yml`). When they pass, staging deploys and is
checked healthy, then production waits for your approval in the Actions tab.

## Backups

- **Daily** (`.github/workflows/backup.yml`, 03:17 UTC): production's database is dumped
  (`server/scripts/backup.sh`) and encrypted with AES-256 using `BACKUP_PASSPHRASE`.
- **Checked the same day:** each backup is restored straight away into a fresh PostgreSQL with PostGIS,
  so a broken one is noticed at once.
- **Kept 30 days**, as workflow artifacts.

### Restoring

1. Download the backup: Actions → backup → the run → the artifact `database-backup-…`. Unzip it to
   get `kugelsack-YYYY-MM-DD.dump.gpg`.
2. Restore it with PostgreSQL 16 or 17's tools:

   ```sh
   TARGET_URL='postgres://…' BACKUP_PASSPHRASE='…' server/scripts/restore.sh kugelsack-YYYY-MM-DD.dump.gpg --clean
   ```

   `--clean` replaces what the target database has. The script decrypts the backup, restores it, and
   prints the migrations, users, content, results and replays it finds.
3. **To restore over production:** first stop the production service in Render (Settings → Suspend). Then
   restore into production's `DATABASE_URL`, resume the service, and check `/api/v1/health` and the admin
   page.
4. **The restore test on staging:** Actions → backup → Run workflow, ticking "Also restore this backup into
   the staging database". It makes a fresh backup and restores it over staging.

This was tested on 2026-10-06 against a local database: restored with every table's rows the same, and a
wrong passphrase refused.

## Importing local content

World content made in the browser before the server is imported from the editor's export files:

```sh
DATABASE_URL=… npm run content:import -w @kr/server -- world-content.json --as you@example.com --dry-run
DATABASE_URL=… npm run content:import -w @kr/server -- world-content.json --as you@example.com
```

- Every item is checked with the editor's own rules: older versions are migrated and bad ones skipped with
  the reason.
- A report goes to `reports/`.
- The same import is in the API for editors (`POST /api/v1/content/import`).
