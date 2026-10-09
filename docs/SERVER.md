# The game's server (Phase 6 Steps 1 and 2)

The server keeps accounts, roles, world content, the day's and the week's tracks, records, leaderboards and
race replays. Since Step 2 it also owns the economy: money, cars, parts, builds, damage, XP and quest
progress ([ECONOMY_SERVER.md](ECONOMY_SERVER.md)). It serves the game itself from the same address, so the
session cookie stays first-party.

- **Stack:** Fastify 5 and TypeScript (Node 22 runs the `.ts` files directly), PostgreSQL 16 with PostGIS,
  Drizzle migrations, Better Auth for accounts, and Zod schemas shared by the client and the server
  (`packages/shared`).
- **Code:** `server/src` (`main.ts` starts it, `app.ts` builds it). Tests are in `server/test`, tools in
  `server/tools`, migrations in `server/drizzle`, settings for each environment in `server/config/*.json`.
- **Secrets** come only from environment variables (`server/.env.example` lists them). Nothing secret is
  in the code, the config files or the game's pages.

## Running it on your computer

Everything runs on this computer with Docker Compose (nothing online is needed; the game online is in
[DEPLOYMENT.md](DEPLOYMENT.md)):

```sh
docker compose up --build
```

| Address | What |
|---|---|
| http://localhost:8787 | The game, the API, the admin page (`/admin/`) and the editor |
| http://localhost:8788 | The map files, cars, parts and sounds (`assets/`) on their own address, as online: byte ranges, CORS for the game only (nginx, `docker/tiles.nginx.conf`) |
| http://localhost:8025 | Mailpit: every email the game sends (sign-up confirmations, password resets) — open it and click the link |
| localhost:5432 | PostgreSQL 16 with PostGIS (user `kr`, password `kr`, database `kr_dev`) |

To check the whole thing works (the server, the tiles, signing up and resetting a password through Mailpit, the
game loading, streaming its map from the tiles address, driving, and buying a part through the server), with the
stack running:

```sh
node server/tools/local-check.ts     # --local-libs: three.js, Rapier and MapLibre from node_modules, not jsDelivr
```

Or with a PostgreSQL that has PostGIS:

```sh
cp server/.env.example server/.env   # fill in DATABASE_URL and BETTER_AUTH_SECRET (openssl rand -base64 32)
npm run server:dev                    # migrates the database, then serves on PUBLIC_URL
```

- **On this computer, signing up needs no email.** `server/config/development.json` has
  `requireEmailVerification` off: a new account is signed in as soon as it's made, and no confirmation email is
  sent. `staffMfa.required` is off too, so the admin and editor pages don't ask for an authenticator app. Production
  keeps both on (`server/config/production.json`).
- **Your owner account** (an admin: every control on `/admin/` and the editor):
  ```sh
  npm run owner -w @kr/server -- --email you@example.com --password 'at least 10 characters' --name YourName
  # with Docker Compose running:
  docker compose exec server node server/tools/make-owner.ts --email you@example.com --password '…' --name YourName
  ```
  It makes the account if there isn't one with that email, or promotes the one there is (logged once).
- Or set `ADMIN_EMAIL` to your email (`server/.env`, or a `.env` file beside `docker-compose.yml` for Docker
  Compose: both are git-ignored, so your email never goes in the repository). That account becomes an admin when it
  signs up (once; it's logged). Online, where emails are confirmed, only once its email is confirmed. Make other
  editors and admins on the admin page, `/admin/`.
- Development mail: `SMTP_URL=memory://` keeps it in memory. Mailpit (with Docker) shows every email.
- A page served without the server (the old `npm start`) still works as the local-only game.

## Tests

| Command | What |
|---|---|
| `npm run test:server` | Every server test against a real PostgreSQL with PostGIS: accounts, roles, world content, tracks, the economy and the API's defences. Set `TEST_DATABASE_URL` to an admin connection; each test file makes its own database. |
| `npm run server:typecheck` | The server's TypeScript, strict. |
| `npm run stress:content -w @kr/server` | 50,000 markers in PostGIS against the Phase 4 limits. |
| `npm run test:browser -w @kr/server` | The account flows in Chromium: sign up, confirm, reset, guest to account, delete, offline. |
| `npm run load-test -w @kr/server` | 500 players signing in at once and loading nearby content. |
| `npm run test:browser:economy -w @kr/server` | The economy in Chromium: a change shown at once and confirmed, a refusal put back, offline and back, two tabs; the admin page's economy tools. |
| `node server/tools/deploy-browser.ts` | The deployment's layout in Chromium: the game as built for production, the API, the tiles and the real-time server each on an address of its own (cookies, CORS, a real-time ticket and room, the admin and editor pages for their roles). |
| `node server/tools/shop-browser.ts` | The shop, dealership, selling and the admin's shop in Chromium (docs/SHOP.md). |
| `node server/tools/shop-load.ts` | 500 players browsing and buying in the shop at once, then the books checked. |
| `npm run load-test:economy -w @kr/server` | 500 players in the garage and on the road, then the books checked (`--burst`: all at the same moment). |
| `npm run load-test:full -w @kr/server` | **The whole game, 500 players at once** (Phase 6 Step 5): sign in, the world, the garage, the shop, a drive, a repair, the daily event, the leaderboard; limits per step, the books checked, and what one player costs (`reports/load-test.md`, [COSTS.md](COSTS.md)). `--players N`. |
| `npm run test:browser:launch -w @kr/server` | The launch screens in Chromium: support and feedback with the game's version and device, the credits and status pages; the admin's Support, Launch (closed beta, invite codes used by a new player), Reports, Monitoring and a player's full history. |
| `npm run drill:dr -w @kr/server` · `npm run drill:rollback -w @kr/server` | The disaster recovery and rollback drills ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md), [OPERATIONS.md](OPERATIONS.md)). |

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
- **The economy** ([ECONOMY_SERVER.md](ECONOMY_SERVER.md)):
  - `/player` (the profile), `POST /player/actions/:action` (every garage, shop, repair, quest and
    damage action), `/player/config`, `/player/ledger`, `/player/events`;
  - drives and heartbeats: `/player/drives`, `/player/sessions/:id/heartbeat`;
  - admins: `/admin/players/:id/economy`, `/money`, `/items`, `/admin/ledger/:id/reverse`,
    `/admin/economy/config` (with its history and rollback) and `/admin/economy/dashboard`.
- **Tracks:**
  - `/tracks/today` gives the day's and the week's tracks.
  - `POST /tracks/results` hands a run in; it's checked by the game's own rules against the course the
    server built.
  - `/tracks/leaderboard` and `/tracks/records` give leaderboards and records.
  - `/replays` stores race replays.
- **Launch (Phase 6 Step 5):**
  - `/status` (public: up, maintenance, features off), `/metrics` (Prometheus, with `METRICS_TOKEN`);
  - players: `POST /reports`, `POST /support`, `POST /feedback`;
  - admins: `/admin/reports`, `/admin/flags` (multi-account and earning flags), `/admin/support` (with `/reply`),
    `/admin/settings/:key` (features and gradual rollouts, maintenance, the closed beta, the oldest game taken),
    `/admin/invites`, `/admin/players/:id/history`, `/admin/monitoring`, `/admin/retention`.
  - [SECURITY.md](SECURITY.md), [ABUSE.md](ABUSE.md), [OPERATIONS.md](OPERATIONS.md), [PRIVACY_DATA.md](PRIVACY_DATA.md).
- **Multiplayer (Phase 7 Steps 1 and 2):** `POST /rt/ticket` gives a signed-in player (or a guest) a one-use join
  ticket for the real-time server, a separate process (`npm run rt -w @kr/server`; one process needs no Redis,
  several share it). The ticket carries what matchmaking needs: the player's rating, their cars' classes and
  performance ratings, who they've blocked, any queue cooldown. Races (Step 2): `/friends`, `/blocks`, `/mp/me` (your
  tier), `/mp/races/:id` (a race's results, provisional then confirmed), `/mp/leaderboard`, and the admins'
  `/admin/mp/dashboard` (the queue against its targets). The real-time server's own calls are under
  `/internal/mp/…` (the `RT_SECRET` in `x-kr-internal`): a venue resolved, a race's results, each run handed in to be
  checked, friends, blocks and reports from the game's screens, the queue's numbers. The tables: `friendships`,
  `blocks`, `mp_ratings`, `mp_races`, `mp_race_players` (migration 0012). [MULTIPLAYER.md](MULTIPLAYER.md).
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
- **Editors and admins need two-factor sign-in** (an authenticator app), passed within the last 12 hours, in staging
  and production (`staffMfa`; off in development, on this computer only).
- **When the database's connections run out**, a request answers `503 BUSY` with `Retry-After: 2`, not a 500.
- The whole review, its findings and the release checklist: [SECURITY.md](SECURITY.md).
- `npm audit --omit=dev --audit-level=high` runs in CI.

## Hosting

**Online since Phase 7 Step 5** (friends testing, production only): one OVHcloud VPS in Sydney running the API, the
real-time server and a Cloudflare Tunnel in Docker Compose; PlanetScale Postgres in Sydney; Cloudflare for the game,
its files, DNS and the way in; Resend for email. How it's set up, deployed, rolled back, checked and renewed:
[DEPLOYMENT.md](DEPLOYMENT.md); the owner's steps: [GO_LIVE.md](GO_LIVE.md).

Online the server runs with `serveClient: "tools"`:
- It serves only the admin and editor pages (each to its role) and the modules they load.
- The game itself is on `GAME_URL` (Cloudflare Pages), its map files on `TILES_URL` (R2), real time on `RT_URL`.

### Settings online

Every deploy writes `/opt/ognistrada/.env` on the server (mode 600) from GitHub's secrets and variables
(`server/scripts/deploy-server.sh`); `deploy/compose.yml` adds the real-time server's own. Both containers read the
whole file. Nothing here is in the repository.

| Setting | Value online | From |
|---|---|---|
| `APP_ENV` | `production` | the deploy |
| `PUBLIC_URL` · `GAME_URL` · `TILES_URL` · `RT_URL` | `https://api.ognistrada.com` · `https://ognistrada.com` · `https://tiles.ognistrada.com` · `wss://rt.ognistrada.com` | the deploy |
| `MAIL_FROM` | `Kugelsack Racing <noreply@ognistrada.com>` | the deploy |
| `SMTP_URL` | `smtps://resend:<RESEND_SMTP_KEY>@smtp.resend.com:465` | the secret `RESEND_SMTP_KEY` |
| `DATABASE_URL` | PlanetScale's direct connection (port 5432, `sslmode=verify-full`) | secret |
| `DATABASE_POOL_MAX` | 10 (the default; not set) | — |
| `BETTER_AUTH_SECRET`, `EDGE_SECRET`, `TURNSTILE_SECRET_KEY` | | secrets |
| `TURNSTILE_SITE_KEY` | | variable |
| `ADMIN_EMAIL`, `ALERT_EMAIL` | The owner's account (admin once its email is confirmed); where alerts go | secrets |
| `HSTS` | `off` until the variable `HSTS` is `on` | variable |
| `SENTRY_DSN` (optional) | Errors from the API and the real-time server | secret |
| `SENTRY_CLIENT_DSN` (optional) | The game's errors (the API's `/api/v1/client-config` hands it to the game) | variable |
| `LOADTEST_TOKEN` (optional) | Lets the `loadtest` workflow's bots get tickets: the header `x-kr-loadtest` | secret |
| `RT_SECRET` | Signs the join tickets (API) and checks them (real-time server); the API's internal calls | `/opt/ognistrada/rt.secret`, made once on the server by `server-setup` |
| `GIT_COMMIT` | The commit (the health checks report it; the deploy waits for it) | the image (`Dockerfile`'s build argument) |
| `IMAGE_TAG` · `TUNNEL_TOKEN` | Compose's: the image's tag; `cloudflared`'s token (only that container gets it) | the deploy; read from Cloudflare |
| **The real-time server only** (`deploy/compose.yml`) | | |
| `RT_PORT` · `RT_HOST` | `2567` · `0.0.0.0` | compose |
| `RT_PUBLIC_ADDRESS` | `rt.ognistrada.com` (how browsers reach it) | compose |
| `API_INTERNAL_URL` | `http://api:8787` (the API over Docker's own network) | compose |
| `RT_DRAIN_SEC` | `600`: on SIGTERM it waits up to this long for races under way to finish (Docker's `stop_grace_period` is 11 minutes) | compose |
| `REDIS_URL` | Not set: one process, everything in memory ([DEPLOYMENT.md](DEPLOYMENT.md#redis-not-used)) | — |
| `RT_MAX_PLAYERS` | Not set: `production.json`'s `rt.maxPlayers` (500) | — |

Locally the same names apply (`server/.env.example`); `RT_SECRET` is then made from `BETTER_AUTH_SECRET`.

## Backups

- **Nightly** (`.github/workflows/backup.yml`, 16:17 UTC, about 03:00 in Adelaide): production's database is dumped
  (`server/scripts/backup.sh`) and encrypted with AES-256 using `BACKUP_PASSPHRASE`.
- **Checked the same night:** each backup is restored straight away into a fresh PostgreSQL with PostGIS, so a broken
  one is noticed at once. Healthchecks.io emails if a night is missed.
- **Kept 35 days** in the private R2 bucket `ognistrada-backups` (`daily/<date>.dump.gpg`; R2 deletes older ones).
  Nothing is kept on GitHub: the repository is public.
- PlanetScale keeps its own backups and point-in-time restore besides ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)).

### Restoring

1. Download the backup: Cloudflare → R2 → `ognistrada-backups` → `daily/` → the file, or with the R2 keys
   `rclone copyto r2:ognistrada-backups/daily/<date>.dump.gpg .`
2. Restore it with PostgreSQL tools at least as new as the database (17 or 18):

   ```sh
   TARGET_URL='postgresql://…' BACKUP_PASSPHRASE='…' server/scripts/restore.sh <date>.dump.gpg --clean
   ```

   `--clean` replaces what the target database has. The script decrypts the backup, restores it, and prints the
   migrations, users, content, results and replays it finds.
3. **To restore over production:** maintenance on (or `docker compose stop api rt` on the server), restore into
   production's `DATABASE_URL` (or a new database, then the secret `DATABASE_URL` changed and a redeploy), start
   again, and check `/api/v1/health` and the admin page. The steps: [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).
4. **The restore drill:** Actions → backup → Run workflow with *drill* ticked: the backup restored, and the image
   production runs started on it and checked healthy.

This was tested on 2026-10-06 against a local database: restored with every table's rows the same, and a wrong
passphrase refused.

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
