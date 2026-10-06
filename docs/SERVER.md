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

Everything runs on this computer with Docker Compose (nothing online is needed, and nothing is deployed:
[DEPLOYMENT.md](DEPLOYMENT.md) is paused):

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

- Set `ADMIN_EMAIL` to your email. When that account has signed up and confirmed its email, it becomes an
  admin (once; it's logged). Make other editors and admins on the admin page, `/admin/`.
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
| `node server/tools/deploy-browser.ts` | The deployment's layout in Chromium: game, API, tiles and real time each on an address of its own (cookies, CORS, the admin and editor pages for their roles). |
| `node server/tools/shop-browser.ts` | The shop, dealership, selling and the admin's shop in Chromium (docs/SHOP.md). |
| `node server/tools/shop-load.ts` | 500 players browsing and buying in the shop at once, then the books checked. |
| `npm run load-test:economy -w @kr/server` | 500 players in the garage and on the road, then the books checked (`--burst`: all at the same moment). |

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

## Hosting

**Paused, not yet deployed:** the game runs on localhost until multiplayer works. The online setup (Cloudflare for the game, its files and DNS; Render for the API; Neon for the databases; Resend for
email), how to deploy and roll back, and what to renew: [DEPLOYMENT.md](DEPLOYMENT.md).

In staging and production the server runs with `serveClient: "tools"`:
- It serves only the admin and editor pages (each to its role) and the modules they load.
- The game itself is on `GAME_URL`, and its map files on `TILES_URL`.
- Its settings for that: `GAME_URL`, `TILES_URL`, `RT_URL`, `EDGE_SECRET` (the player's address behind Cloudflare)
  and `HSTS` (`server/.env.example`).

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
