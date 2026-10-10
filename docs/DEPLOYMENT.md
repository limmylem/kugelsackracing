# Deployment: the game online at ognistrada.com

> **Status: being set up for friends testing (Phase 7 Step 5, approved by the owner on 2026-10-08).** Production
> only, no staging: the owner and up to ~5 friends at once, all in Australia. The owner's step-by-step is
> [GO_LIVE.md](GO_LIVE.md): Parts 0–5 are done (the accounts, the server at OVHcloud, the database at PlanetScale,
> GitHub's secrets and variables). Next: the `infra` workflow, the R2 key, `server-setup`, the first deploy, the
> monitors, and the test with a friend on another network (GO_LIVE.md steps 6–11).

Every service, address and setting the online game uses; how it's set up, deployed, rolled back, checked, backed up
and watched; and what to renew. For the server's code see [SERVER.md](SERVER.md), for running it day to day
[OPERATIONS.md](OPERATIONS.md), and for losing something [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

## The addresses

| Address | What | Where it runs |
|---|---|---|
| `ognistrada.com` | The game | Cloudflare Pages, project `ognistrada` |
| `www.ognistrada.com` | Redirects (301) to `ognistrada.com`, keeping the path and query | A Cloudflare redirect rule |
| `api.ognistrada.com` | The API, plus the admin and editor pages (only for admin and editor accounts) | The VPS in Sydney (container `api`), through the Cloudflare Tunnel |
| `rt.ognistrada.com` | The real-time server: races, lobbies, free roam (WebSockets); `/health` | The VPS in Sydney (container `rt`), through the Cloudflare Tunnel |
| `tiles.ognistrada.com` | Map files, the world, cars, parts, icons, sounds (`assets/`, about 280 MB) | Cloudflare R2, bucket `ognistrada-tiles` |
| `noreply@ognistrada.com` | Sends verification, password-reset and support emails, and the alerts | Resend (region Tokyo) |

The backups are in a second R2 bucket, `ognistrada-backups`, which is private (no address at all).

## How the parts connect

```
players ──► Cloudflare (HTTPS, protection) ──┬─► ognistrada.com ........ the game (Pages)
                                             ├─► tiles.ognistrada.com .. map files (R2: ognistrada-tiles)
                                             └─► api. / rt.ognistrada.com ── the tunnel ──► the VPS (OVHcloud, Sydney)
                                                                                             │ Docker Compose:
                                                                                             ├─ cloudflared (the tunnel)
                                                                                             ├─ api  :8787
                                                                                             └─ rt   :2567 ──► api (inside)
the VPS ──► the database (PlanetScale Postgres, AWS Sydney; TLS) · email (Resend, Tokyo)
GitHub Actions ──► deploys (SSH to the VPS, Pages, R2) · nightly backups ──► R2: ognistrada-backups
```

- **The server opens no web ports.** `cloudflared` connects out to Cloudflare and carries `api.` and `rt.` to the
  containers (the tunnel `ognistrada`, its routes kept in Cloudflare: `api.ognistrada.com → http://api:8787`,
  `rt.ognistrada.com → http://rt:2567`, anything else 404). The firewall lets in only SSH, by key. There are no
  certificates on the server: Cloudflare's cover every address.
- **Telling the game where everything is.** Each page loads `/site/config.js` first. The site build
  (`tools/build-site.mjs`) writes it: the API's, the tiles' and real time's addresses, the commit, and
  `multiplayer: true`, so the game plays online without `?mp` (`?mp=0` turns it off). Locally (`npm start`, or the
  server in development) it's empty and everything stays on one address.
- **The session cookie** is set on `api.ognistrada.com` only (host-only), `HttpOnly`, `Secure`, `SameSite=Lax`.
  `ognistrada.com` and `api.ognistrada.com` are the same site, so the browser sends it on the game's requests to the
  API (`credentials: 'include'`): no third-party cookies needed. The CSRF cookie is `SameSite=Strict`, on the API's
  address too. Email links and sign-in redirects go to the API's address, which sends the browser back to the game.
- **CORS.** The API lets only `GAME_URL` (and its own address) read it, with cookies. The tiles allow only the game's
  and the API's addresses: R2's CORS settings, plus a Cloudflare response rule that sets `Access-Control-Allow-Origin`
  on every answer, cached or not (R2's own answer would be cached with the first visitor's origin).
- **Map files.** `site/urls.js`'s `assetUrl()` sends the map streamers straight to the tiles address; anything else
  asking the game's address for `/assets/…` gets a 302 there (`_redirects`). PMTiles reads byte ranges (206), and
  Cloudflare caches the files (a cache rule, an hour, from each file's `Cache-Control`).
- **The admin page** is at `api.ognistrada.com/admin/` (`ognistrada.com/admin` redirects there). Signed out: sent to
  sign in on the game, then back. A player: refused (403). An admin: the page, after two-factor sign-in.
- **The editor's code** (`editor/`) isn't on the game's address: the game loads it from the API's with the session
  (`site/urls.js`'s `importTool()`), served only to editors and admins. The game's import map points the editor's
  imports of shared modules back at the game's address, so they load once. `editor/access.js` (whether the editor's
  button shows) stays on the game's address.
- **Real time.** The game asks the API for a one-use join ticket (`POST /api/v1/rt/ticket`), then joins a room on
  `rt.ognistrada.com` with it (Colyseus over WebSockets, through Cloudflare and the tunnel). The real-time server
  calls the API for lobbies, races and free roam inside Docker's own network (`API_INTERNAL_URL=http://api:8787`,
  with `RT_SECRET`), and sends its numbers every 5 seconds — which is how the API knows it's up.
- **The player's IP address** (rate limits, the sign-in list). Through the tunnel every request arrives from the
  `cloudflared` container, so the address comes from `CF-Connecting-IP`, believed only when the request carries
  Cloudflare's secret header (`x-kr-edge` = `EDGE_SECRET`, added by a Cloudflare rule for `api.` and `rt.`).
- **Cross-origin isolation (COOP/COEP) isn't needed.** The game doesn't use `SharedArrayBuffer`, and COEP would block
  the libraries and fonts from jsDelivr and Google Fonts. The pages do send `Cross-Origin-Opener-Policy: same-origin`.

## The services, and what they cost

| Service | Plan | A month | What it holds |
|---|---|---|---|
| OVHcloud | VPS-1, Sydney: 2 vCores, 4 GB, 40 GB, Ubuntu 24.04 | A$6.29 + GST ≈ US$4.60 | The API, the real-time server and the tunnel (Docker Compose, `/opt/ognistrada`) |
| PlanetScale | Postgres PS-5, AWS `ap-southeast-2` (Sydney), PostGIS on | ≈ US$5 (*check* the invoice) | The database: accounts, the economy, results, world content, everything |
| Cloudflare | Free (a card on file for R2) | $0 | DNS, certificates, Pages (the game), R2 (files and backups), Turnstile, the tunnel, rules |
| Resend | Free | $0 | Email from `noreply@ognistrada.com` (region Tokyo) |
| GitHub | Free (public repository) | $0 | Code, tests, the image (`ghcr.io/limmylem/kugelsackracing`), deploys, the nightly backup |
| UptimeRobot, Sentry, Healthchecks.io | Free | $0 | Watching it ([Monitoring and alerts](#monitoring-and-alerts)) |
| The domain | `ognistrada.com` at Namecheap | ≈ US$1 (its yearly renewal) | |
| **Total** | | **≈ US$10.50–11.50** | |

Nothing else is paid for. **Ask the owner before anything that costs money** (a bigger server, a second server or
region, Redis elsewhere, a paid plan of a free service), with a monthly estimate.

The free plans' limits that matter (October 2026; *check* each pricing page):
- **Cloudflare Pages:** 500 deploys a month, 25 MiB a file, 20,000 files (the game: about 910 files, 7 MB).
- **Cloudflare R2:** 10 GB stored, 1 million writes and 10 million reads a month, downloads free. We use about
  0.3 GB (the files) plus the backups (35 small files).
- **Resend:** 3,000 emails a month, at most 100 a day, one domain. Its logs: a day on the free plan (*check*).
- **The VPS:** OVHcloud's VPS traffic is unmetered at 250 Mbit/s (*check* the order page). Free roam is the biggest
  user (8–35 kB/s a player: [COSTS.md](COSTS.md)); five friends are nowhere near it.
- **PlanetScale PS-5:** its storage and connections are the plan's (*check* the dashboard). The game uses one pool of
  at most `DATABASE_POOL_MAX` (10) connections from the API.

## The server

- **Ubuntu 24.04**, user `ubuntu`, set up by `deploy/server-setup.sh` (the `server-setup` workflow): Docker and Compose
  from Ubuntu's own packages; security updates installed every night by themselves, and when one needs a reboot the
  server reboots at 17:30 UTC (about 04:00 in Adelaide); the firewall (ufw) letting in only SSH; fail2ban; SSH by key
  only; a 1 GB swap file; `/opt/ognistrada` for the deploy; the real-time server's secret, made once in
  `/opt/ognistrada/rt.secret` (it never leaves the server: each deploy adds it to `.env` as `RT_SECRET`).
- **Docker Compose** (`deploy/compose.yml` → `/opt/ognistrada/compose.yml`, the project `ognistrada`), three services,
  the first two from one image, `ghcr.io/limmylem/kugelsackracing:<commit>`:
  - `api`: `node server/src/main.ts` on 8787 (its migrations run as it starts);
  - `rt`: `node server/src/rt/main.ts` on 2567, one process, everything in memory (no Redis);
  - `cloudflared`: the tunnel, with `TUNNEL_TOKEN`.
  No port is published. Each restarts by itself if it stops, and after a reboot (`restart: unless-stopped`); Docker's
  health checks read `/api/v1/health` and `/health`. Logs rotate at 10 MB, three files a container.
- **The settings** are in `/opt/ognistrada/.env` (mode 600), written by every deploy from GitHub's secrets and
  variables ([SERVER.md](SERVER.md#settings-online) lists them).
- **By hand** (rarely): `ssh -i ~/.ssh/ognistrada_deploy ubuntu@<SERVER_HOST>`, then
  `cd /opt/ognistrada && docker compose ps` · `docker compose logs --tail 100 api rt` · `docker compose restart api`.
  The deploys' history: `/opt/ognistrada/deployed.log` (one line a deploy: the time, the commit; newest last).

## The workflows

| Workflow | When | What | Approval |
|---|---|---|---|
| `infra` | By hand, a dry run first | Cloudflare and Resend set up (`tools/cloudflare-setup.mjs`): HTTPS settings, DNS records in the way, the Pages project and its domain, the R2 buckets (the tiles' CORS and address; the backups private, each file deleted after 35 days), the tunnel and its routes, the rules (www, the edge secret, the tiles' CORS, caching), Resend's domain (Tokyo) and its SPF, DKIM and DMARC records. Safe to run again: it only adds what's missing and puts right what's different. Uses the setup token. | `infra` environment |
| `server-setup` | By hand, a dry run first; now and then to bring the packages up to date | `deploy/server-setup.sh` on the server over SSH ([The server](#the-server)). Safe to run again. | `infra` environment |
| `server` | Every push and pull request | Typecheck, every server test, the browser tests (this file's layout: `deploy-browser.ts`), the dependency audit. On `main`: the image built and pushed (`:<commit>` and `:main`; the newest 20 kept), then `deploy` — once the repository variable `DEPLOY_ENABLED` is `"true"`. | — |
| `deploy` | Called by `server` and `rollback` | [Deploying](#deploying) | `production` environment |
| `rollback` | By hand: a commit | `deploy` at an earlier commit ([Rolling back](#rolling-back)) | `production` environment |
| `check` | By hand | `tools/check-deploy.mjs` against production ([Checks](#checks)) | — |
| `backup` | Every night (16:17 UTC, about 03:00 in Adelaide); by hand with *drill* | [Backups](#backups-and-restoring) | — |
| `loadtest` | By hand | 20 online bots on demand (up to 200): half in free roam, half in quick races, for a couple of minutes against the real servers, each number against its target (`server/tools/online-bots.ts`; tickets with `LOADTEST_TOKEN`). GitHub's runners are in the US, so the pings include the trip to Sydney. | — |

## Deploying

Every push to `main` runs `server.yml`: the tests, the image, then (with `DEPLOY_ENABLED` on) `deploy.yml`, which waits
for the owner's **Approve** (GitHub emails; Actions → the run → **Review deployments**). One deploy at a time. In order,
so nothing ever points at something that isn't there yet:
1. **Map files:** `assets/` → R2 `ognistrada-tiles` (`rclone sync --checksum`: only what changed).
2. **The server** at this commit (`server/scripts/deploy-server.sh` over SSH): `compose.yml` and `.env` put there, the
   tunnel's token read from Cloudflare (the deploy token's Tunnel Edit: Cloudflare gives a tunnel's token only to Edit), the image pulled, `docker compose up -d` on
   the server by itself (a dropped connection can't leave it half done), then a wait — up to 13 minutes — until the API
   and the real-time server, as players reach them, both say they're this commit and healthy. Images unused for a week
   are removed from the server.
3. **The game:** `tools/build-site.mjs` builds it, `wrangler pages deploy` publishes it to the Pages project `ognistrada`.
4. **The checks** (`tools/check-deploy.mjs`). A failed check fails the deploy, and the run's summary says how to roll back.

**What players notice.** The API restarts in seconds (there's one of it: requests in those seconds fail, and the game
retries). **The real-time server drains first:** on SIGTERM nobody new joins, races under way finish and their results
reach the API (up to `RT_DRAIN_SEC`, 600 s; Docker waits 11 minutes before killing it), then it stops and the new one
starts. Free-roam players are told "The game server is restarting. Reconnecting…" when it stops, and join the new
one. So deploy when few are racing, or expect the deploy to wait for the races.

**Migrations only ever add** (tables, nullable or defaulted columns, indexes with `IF NOT EXISTS`): the game already
online, and a server rolled back, keep working with the newer database. Removing or renaming takes two deploys: stop
using it, then remove it ([OPERATIONS.md](OPERATIONS.md#safe-deploys)).

## Rolling back

| What | One step |
|---|---|
| Everything, kept in step | **Actions → rollback → Run workflow**, the commit to go back to (from `/opt/ognistrada/deployed.log`, or the `server` runs whose production job succeeded), then approve it. It runs `deploy.yml` at that commit: map files, the server (that commit's image), the game, the checks. Only the newest 20 commits built on `main` have an image. |
| The game alone | Cloudflare → Workers & Pages → `ognistrada` → Deployments → an earlier one → **Rollback** (Pages keeps every deployment). |
| A feature alone | Switch it off on the admin page's Launch tab (seconds). |
| A database mistake | PlanetScale's point-in-time restore, or a nightly backup ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)). |

A rollback never undoes migrations; the older server runs on the newer schema (`server/tools/rollback-test.ts` drills it).

## Checks

**After every deploy, and on demand (Actions → check).** `tools/check-deploy.mjs`, from GitHub's runner, through
Cloudflare as players reach it:
- every address (the game, the API, the tiles, `rt.`) over HTTPS with a valid certificate; `http://` → `https://`;
  `www` → the game with the path and query kept; HSTS, once it's on;
- the API: healthy, `production`, its database answering; CORS for the game (with cookies), not for another site; the
  admin page and the editor's code, signed out, send you to sign in;
- the game: its page loads its settings first; `site/config.js` names every address and has `multiplayer: true`; it's
  the commit the API runs; `/assets/` goes to the tiles, `/admin/` to the API; the editor's code isn't on its address;
- the tiles: a byte range (206), from Cloudflare's cache the second time (`cf-cache-status: HIT`), CORS for the game's
  and the API's addresses even from the cache, not for another site;
- real time: `https://rt.ognistrada.com/health` is ok (and not draining), the same commit as the API, and 10 round
  trips' times through Cloudflare and the tunnel; the API's `/api/v1/status` says `"rt":"up"`.

**Before anything is online:** `node server/tools/deploy-browser.ts` (also in CI) runs the same layout on one machine
in Chromium, each part on an address of its own (the game as built for production, the API, the tiles, the real-time
server, another site): signing up across addresses, a purchase, server-sent events, map files, a real-time ticket and
a room joined, the admin and editor pages for their roles.

**By the owner, once at the start and after big changes:**
1. Sign up from a phone on mobile data (Wi-Fi off). The verification email should arrive in the inbox, not spam: try
   Gmail and Outlook. Gmail's **Show original**: `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
2. Sign in and load the world: the map streams in.
3. **The two-network check** (deferred since Phase 7 Step 1): the owner on home Wi-Fi and a friend on a phone hotspot
   sign up with invite codes, get the verification emails, meet in free roam and race each other.

## Backups and restoring

- **Nightly** (`backup.yml`, 16:17 UTC): production's database dumped (`server/scripts/backup.sh`, `pg_dump`'s custom
  format), encrypted with AES-256 (`BACKUP_PASSPHRASE`), **restored straight away** into a fresh PostgreSQL with
  PostGIS and checked (`server/scripts/restore.sh`), then kept in R2 `ognistrada-backups` as
  `daily/<date>.dump.gpg`. R2 deletes each after **35 days**. Nothing is kept on GitHub (the repository is public).
  Healthchecks.io is told it's done; a night without one emails the owner.
- **The restore drill:** Actions → backup → Run workflow with *drill* ticked: the backup is restored, and the image
  production runs is started on the restored copy and must answer healthy with its database. Every 3 months.
- **PlanetScale's own backups** and point-in-time restore, on top (*check* how far back on PS-5 in its dashboard).
- The PostgreSQL tools must be at least as new as the database: `PG_MAJOR` (17 unless the repository variable says 18).
- Restoring, step by step: [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

## Monitoring and alerts

| What | Watches | Tells |
|---|---|---|
| **UptimeRobot** (free: four monitors, every 5 minutes — *check* the free plan's interval) | `https://ognistrada.com/` (up) · `https://api.ognistrada.com/api/v1/status`, keyword `"api":"up"` · the same address, keyword `"rt":"up"` (the API hears from the real-time server) · `https://rt.ognistrada.com/health`, keyword `"ok":true` | The owner's email (and its app); its public status page |
| **The API's own alerts** (`server/src/ops/alerts.ts`, every minute) | Server errors, slow answers, the database, the verification queue, the economy's money, and **the real-time server going quiet** (nothing from it for 90 s: `realtime`) | `ALERT_EMAIL`, from `noreply@ognistrada.com`; once, hourly while it lasts, and "Fixed" |
| **Sentry** (free) | Errors with their stack traces, nothing personal: the API and the real-time server (`SENTRY_DSN`, a secret) and the game (`SENTRY_CLIENT_DSN`, a variable; the API's `client-config` hands it to the game) | Email on a new kind of error or a spike |
| **Healthchecks.io** (free) | The nightly backup: a check expecting a ping a day (`HEALTHCHECKS_BACKUP_URL`, a secret; the workflow pings `/fail` when it fails) | Email when a night is missed or fails |
| **GitHub** | Failed workflows (a deploy, a backup) | Email to the owner |
| **Docker** | Each container's health check; a stopped container is restarted | — |

The admin page's Monitoring tab shows the live numbers ([OPERATIONS.md](OPERATIONS.md)).

## Redis: not used

With one real-time process on one server, rooms, presence, the matchmaking queue, parties, invite codes, one-use
tickets and bans are all in that process's memory (Colyseus's `LocalPresence`). A deploy restarts it, so they start
afresh (players simply join again). **Redis is needed only for a second real-time process or a second server**: they
share their rooms, the queue and the free-roam instances through it.

To add it (ask first if it costs anything):
- **On this server** (a second process, `--processes 2`): a `redis` service in `deploy/compose.yml`
  (`redis:7-alpine`, no published port, a little memory), and `REDIS_URL=redis://redis:6379` for `api` and `rt`. Free,
  but each process needs an address of its own (`RT_PUBLIC_ADDRESS_PATTERN` and a tunnel route each).
- **Across servers:** one Redis both reach, privately (a managed one near Sydney, or on one of the servers behind the
  firewall over a private link) — a cost to estimate first.

## Scaling later

Nothing is rebuilt; each step adds:
- **A bigger server** (OVHcloud VPS-2 or more): a resize in OVHcloud's control panel, then `server-setup` and a deploy.
- **A second real-time server, or a region elsewhere** (players outside Australia): a new VPS set up the same way
  (`server-setup`) running only `rt` and `cloudflared`, an `rt-<region>.ognistrada.com` route on a tunnel, Redis
  ([above](#redis-not-used)), and a region entry in `data/multiplayer.json` `regions.production` and `data/roam.json`
  `regions.list.production` (the game measures its ping to each and picks). The API stays one.
- **More API capacity:** a second `api` container behind the same tunnel route (cloudflared spreads requests), once the
  Monitoring tab's answer times say so. The database (PS-5) grows with a plan change in PlanetScale.

## Once everything works

1. **HSTS** (browsers then refuse plain `http://` for a year): set the repository variable `HSTS` to `on`, run **infra**
   with *hsts* ticked (Cloudflare adds it on every address), deploy, then run **check** with *hsts* ticked.
2. **DMARC:** after a couple of weeks of reports showing only Resend sending as `ognistrada.com`, tighten it to
   `p=quarantine` (in `tools/cloudflare-setup.mjs`, then run **infra** with *only* `email`).
3. **Automatic deploys:** the repository variable `DEPLOY_ENABLED` = `true` (each still waits for approval).

## What expires, and renewing it

| What | When | What to do |
|---|---|---|
| The domain `ognistrada.com` | Yearly, at Namecheap | Keep auto-renew on and the card up to date. The DNS is Cloudflare's; the registration stays at Namecheap. |
| Cloudflare API tokens (`ognistrada setup`, `ognistrada deploy`) | A year after they were made (October 2027) | Make new ones with the same permissions (GO_LIVE.md Part 1 step 7), replace `CLOUDFLARE_SETUP_TOKEN` (environment `infra`) and `CLOUDFLARE_API_TOKEN`, delete the old ones. Claude reminds the owner a month before. |
| R2 access keys (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) | Never, unless an expiry was set | Replace yearly: a new token, the two secrets updated, the old token deleted |
| Cloudflare's certificates | Every few months | Automatic (Universal SSL); there are none on the server |
| The tunnel's token | Never | Read from Cloudflare at each deploy. To replace it: rotate it in Cloudflare (Zero Trust → Networks → Tunnels), then deploy. |
| Resend keys, the deploy SSH key | Never | Replace if anyone else may have seen them |
| `BETTER_AUTH_SECRET` | Never; replace if exposed | A new one signs everyone out, and editors and admins set up two-factor sign-in again |
| `EDGE_SECRET` | Never; replace if exposed | Update the secret, run **infra** (*only* `rules`), then deploy |
| `RT_SECRET` | Never | It's on the server only (`/opt/ognistrada/rt.secret`); deleting the file and re-running `server-setup` makes a new one |
| `BACKUP_PASSPHRASE` | Never | **Never lose it**: every backup needs it. Keep it in the password manager. |
| Backups | Each kept 35 days | Download one now and then and keep it elsewhere (it stays encrypted) |
| Images on GitHub | The newest 20 kept | Pruned by `server.yml`; a rollback can go back only that far |
| OVHcloud, PlanetScale | Monthly | Billed to the owner's card: keep it up to date |

## Considered and not chosen

- **Render** (the earlier plan, with staging): no Australian region (Singapore, ~90–100 ms from Sydney), the free plan
  sleeps, and the paid always-on services plus Redis cost more than one VPS for this size.
- **Fly.io:** a Sydney region, but billed per machine and per GB, and more parts to keep for one small server.
- **Neon:** the earlier database (Singapore on the free plan; Sydney is possible). PlanetScale Postgres PS-5 is in
  Sydney at about the same price, with backups included; Neon in Sydney stays the fallback.
- **Hetzner:** cheapest per core, but no Australian location (the nearest is Singapore).
- **Oracle Cloud Always Free:** in Sydney, but free machines idle for a week can be reclaimed, capacity is often short,
  and the free allowance has been cut.

## Files

| File | What |
|---|---|
| `docs/GO_LIVE.md` | The owner's step-by-step (accounts, secrets, then what Claude runs) |
| `deploy/compose.yml` | The server's three containers |
| `deploy/server-setup.sh` | The server's setup (run by `server-setup.yml`) |
| `server/scripts/ssh-setup.sh`, `server/scripts/deploy-server.sh` | SSH from a workflow; the server at one commit |
| `server/scripts/backup.sh`, `server/scripts/restore.sh` | A backup made; a backup put back and checked |
| `Dockerfile` | The image (API and real-time server) |
| `tools/cloudflare-setup.mjs` | Cloudflare and Resend set up (run by `infra.yml`; its pure parts tested in `tests/unit/cloudflareSetup.test.mjs`) |
| `tools/build-site.mjs` | The game for Cloudflare Pages: `site/config.js`, `_headers`, `_redirects`, the import map |
| `tools/check-deploy.mjs` | The checks (run by `deploy.yml` and `check.yml`) |
| `.github/workflows/server.yml`, `deploy.yml`, `rollback.yml` | Tests and the image, then deploying; rolling back |
| `.github/workflows/infra.yml`, `server-setup.yml`, `check.yml`, `backup.yml`, `loadtest.yml` | Setting up, checking, backups, the load test |
| `server/tools/online-bots.ts` | The bots of the load test |
| `site/config.js`, `site/urls.js` | Where the game finds the API, tiles and real time; the editor loader |
| `server/tools/deploy-browser.ts` | The whole layout tested in a browser, locally and in CI |
