# Deployment: the game online at ognistrada.com

> **Status: paused, not yet deployed** (decided after the deployment step, before Phase 6 Step 4). The game runs
> on localhost only, with Docker Compose ([SERVER.md](SERVER.md#running-it-on-your-computer)), until multiplayer
> fully works; then a cheap paid server. No accounts have been made and the `infra` workflow has never run. Everything
> below is built and ready (the workflows skip themselves while `CLOUDFLARE_ACCOUNT_ID` isn't set); what's left is
> in [To do when we deploy](#to-do-when-we-deploy). Keep this file up to date with anything that will matter online.

Every service, address and setting the online game uses; how to set it up, deploy it, roll it back and keep it
running; and what to renew. For the server itself see [SERVER.md](SERVER.md), and for the economy
[ECONOMY_SERVER.md](ECONOMY_SERVER.md).

**Plan for now: free plans only** (decided Phase 6, deployment step), while it's one person testing. Everything is
set up so going to the paid plan is a settings change: see [Upgrading](#upgrading-about-13-a-month).

> **Reminder:** upgrade to at least the ~$13/month plan **before Phase 7 multiplayer testing, or before inviting
> beta testers**, whichever comes first. The free plans sleep, and they lose data more easily (see
> [Free plans: what to watch](#free-plans-what-to-watch)).

## To do when we deploy

In order. Nothing here has been done yet; each needs the owner (accounts, money, DNS).

1. **Choose the plan.** The plan below is free plans; since the plan is now to go online once multiplayer works,
   start on the paid one instead ([Upgrading](#upgrading-about-13-a-month), about $13 a month). Ask before paying.
2. **Make the accounts** ([Setting it up](#setting-it-up-once) 1–5): Cloudflare (the domain's DNS, Pages, R2),
   Neon (two databases with PostGIS), Resend (two keys, the sending domain), Render (two services from
   `render.yaml`), and GitHub's environments, variables and secrets.
3. **Run the `infra` workflow** (step 6): DNS records, the R2 buckets and their CORS, the Pages projects, the
   redirect rule, Resend's domain records.
4. **The first deploy** (step 7), then the [Checks](#checks): `tools/check-deploy.mjs` against staging, then
   production.
5. **Real email:** Resend instead of Mailpit (`SMTP_URL` on Render). On this computer every email goes to Mailpit;
   the sending domain's SPF/DKIM records and real delivery have only been tested on paper.
6. **What only the real setup can check:** Cloudflare's CDN caching of the tiles (range requests through the
   edge), WebSockets through Cloudflare to `rt.` ([Real time](#real-time-through-cloudflare-or-straight)), the
   player's address via `EDGE_SECRET`, HSTS (turn `HSTS` on once HTTPS works everywhere), a status page or uptime
   check (built in Phase 6 Step 5: [OPERATIONS.md](OPERATIONS.md); the outside monitor needs an account).
7. **Hosts the game reaches besides its own:** jsDelivr (three.js, Rapier, MapLibre and its worker), Google Fonts,
   `demotiles.maplibre.org` (the map's lettering) and `tiles.openfreemap.org` (the photoreal world's minimap). The
   content security policy (`server/src/app.ts`, `tools/build-site.mjs`) allows them; recheck it if any moves.
8. **Launch readiness (Phase 6 Step 5):** follow [LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md). For hosting, that means:
   - Turnstile keys ([ABUSE.md](ABUSE.md)) and Cloudflare's WAF rules;
   - `ALERT_EMAIL` and `ALERT_WEBHOOK_URL`, an uptime monitor and `status.` ([OPERATIONS.md](OPERATIONS.md#when-we-deploy));
   - `METRICS_TOKEN` if a dashboard reads `/api/v1/metrics`;
   - budget alerts on every paid service ([COSTS.md](COSTS.md));
   - point-in-time recovery, with the paid database ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md));
   - the DR drill once on real staging.
9. **Multiplayer's real-time server** (Phase 7 Step 1, [MULTIPLAYER.md](MULTIPLAYER.md)). Built and tested on this
   computer only; online it needs:
   - **Where it runs, and Redis.** Both cost money and the region is the owner's choice: ask first. The real-time
     server is a long-running Node process (`node server/src/rt/main.ts`, the same image as the API). Options:
     a second Render service (Starter, $7 a month, Singapore) or a small machine nearer the players (Fly.io
     `syd`, a few dollars a month); measure with `site/ping.html`. Redis: Render Key Value (Starter about $10 a
     month; the free one has no persistence, which is fine for rooms and tickets) or Upstash (pay per request).
   - **Secrets and settings:** `RT_SECRET` (the same long random value on the API and the real-time server: join
     tickets), `REDIS_URL` on both (the API writes bans to it), `RT_PUBLIC_ADDRESS` on the real-time server (its
     public `host:port`, or `rt.<domain>`), and `RT_URL=wss://rt.<domain>` on the API (`site/config.js` for the
     game).
   - **`rt.` moves** from the API's ping/pong stand-in (`server/src/rt/health.ts`) to the real-time server. Check
     WebSockets through Cloudflare ([Real time](#real-time-through-cloudflare-or-straight)), including that
     reconnecting works after Cloudflare drops an idle socket.
   - **Several processes** (`--processes N`) need one public address each, or a proxy that routes by the room's
     process (`RT_PUBLIC_ADDRESS_PATTERN`). One process holds 256 players, so start with one.
   - **The two-player check** on different networks (CLAUDE.md): two players on different networks (home Wi-Fi
     and a phone hotspot) sign in, join the same room (`?mp`) and see each other. Do it on the paid plan
     (step 1), before inviting beta testers.
   - Later: WebTransport, which needs HTTP/3 and UDP through to the real-time server (not through Cloudflare's
     proxy), so a host that allows it.

What changed for localhost since this file was written, and matters online too:
- The economy's settings: when the server starts, settings the game has gained (Phase 6 Step 4's `shop`, `sell`
  values) are added to the active version as a new version, without changing anything already there. The first
  start online with Step 4 makes that version: look for it in the admin page's Economy settings.
- The per-address rate limit counts only `/api/` and `/rt/` (the game's own files were being counted: a page
  load is hundreds of modules).
- The content security policy allows the tiles and real-time addresses by name (`TILES_URL`, `RT_URL`), and
  MapLibre's worker from jsDelivr (the maps were blocked).

## The addresses

| Address | What | Where it runs |
|---|---|---|
| `ognistrada.com` | The game | Cloudflare Pages (project `ognistrada`) |
| `www.ognistrada.com` | Redirects (301) to `ognistrada.com`, keeping the path | A Cloudflare redirect rule |
| `api.ognistrada.com` | The API server, plus the admin and editor pages, served only to admin and editor accounts | Render, `ognistrada-production` (Singapore) |
| `rt.ognistrada.com` | Real time: for now only a WebSocket ping/pong check | The same Render service (the real-time server, built in Phase 7 Step 1, replaces it: "To do when we deploy" 9) |
| `tiles.ognistrada.com` | Map files, the world, cars, parts, icons, sounds (`assets/`, 277 MB) | Cloudflare R2, bucket `ognistrada-tiles` |
| `staging.ognistrada.com` | The test version of the game | Pages project `ognistrada-staging` |
| `staging-api.ognistrada.com`, `staging-rt.ognistrada.com` | The test API and real time | Render, `ognistrada-staging` (Singapore) |
| `staging-tiles.ognistrada.com` | The test version's files | R2, bucket `ognistrada-tiles-staging` |
| `status.ognistrada.com` | Status page | Later (Phase 6 Step 5) |
| `noreply@ognistrada.com` | Sends verification and password-reset emails | Resend |

Staging is written `staging-api`, not `api.staging`. Cloudflare's free certificate covers `ognistrada.com` and one
level below it (`*.ognistrada.com`), but not two.

**Staging and production share nothing:** each has its own Pages project, R2 bucket, Render service, Neon database
and secrets. The checks confirm the databases differ.

## How the parts connect

- **Telling the game where everything is.** Each page loads `/site/config.js` first. The site build
  (`tools/build-site.mjs`) writes it for each environment, with the addresses of the API, the tiles and real time.
  On a single local address (`npm start`, or the server in development) it's empty, and everything stays on one
  address as before.
- **The session cookie.** The API sets it on `api.ognistrada.com` only (host-only), with `HttpOnly`, `Secure` and
  `SameSite=Lax`.
  - `ognistrada.com` and `api.ognistrada.com` count as the same site, so the browser sends the cookie on the game's
    requests to the API (`credentials: 'include'`). This doesn't depend on third-party cookies.
  - The CSRF cookie is `SameSite=Strict`, on the API's address too.
  - Email links and sign-in redirects go to the API's address, which sends the browser back to the game.
- **CORS.**
  - The API lets only `GAME_URL` (and its own address) read it, with cookies. It exposes `X-Request-Id`.
  - The tiles allow only the game's and the API's addresses: R2's CORS settings, plus a Cloudflare response rule.
    The rule sets `Access-Control-Allow-Origin` on every answer, cached or not, because R2's own answer would be
    cached with the first visitor's origin.
- **Map files.**
  - The game asks for `assets/...` as before. `site/urls.js`'s `assetUrl()` sends the map streamers straight to the
    tiles address.
  - Anything else that asks the game's address for `/assets/...` gets a 302 there (`_redirects`).
  - PMTiles reads byte ranges, which R2 serves (206 responses). Cloudflare caches the files (a cache rule; one hour,
    from each file's `Cache-Control`).
- **The admin page** is on the API's address, at `api.ognistrada.com/admin/`.
  - Signed out: the server sends you to sign in on the game, then back.
  - A player: refused (403).
  - An admin: the page.
  - `ognistrada.com/admin` redirects there.
- **The editor's code.** The editor runs inside the game, but its code (`editor/`) isn't on the game's address.
  - The game loads it from the API's address with the session (`site/urls.js`'s `importTool()`), and the server
    serves it only to editor and admin accounts.
  - The game's import map points the editor's imports of shared modules back to the game's address, so they load
    once.
  - `editor/access.js`, which only decides whether the editor's button shows, stays on the game's address.
- **Real time.**
  - `rt.ognistrada.com/rt/health` answers a ping with a pong (`server/src/rt/health.ts`).
  - It goes through Cloudflare, like the API: the TLS certificate is managed, attacks are filtered, and the player's
    IP address arrives with Cloudflare's header.
  - `ognistrada.com/site/ping.html` measures the round trip from your browser. If, from Australia, it's clearly
    slower than going straight to Render, switch `rt` to DNS only (see [Real time: through Cloudflare or straight](#real-time-through-cloudflare-or-straight)).
- **The player's IP address** is used for rate limits and the account's sign-in list.
  - Behind Cloudflare it comes from `CF-Connecting-IP`. The server only trusts that header when the request carries
    Cloudflare's secret (`EDGE_SECRET`, added by a Cloudflare request rule).
  - A request that skips Cloudflare (Render's own `onrender.com` address) is taken at the address Render saw.
- **Cross-origin isolation (COOP/COEP) isn't needed.**
  - The game doesn't use `SharedArrayBuffer`.
  - Turning COEP on would block the libraries and fonts loaded from jsDelivr and Google Fonts.
  - The pages do send `Cross-Origin-Opener-Policy: same-origin`, which needs nothing else.

## The services

| Service | Plan | Cost | What it holds |
|---|---|---|---|
| Cloudflare | Free | $0 | DNS, HTTPS certificates, Pages (the game), R2 (files), rules |
| Render | Free (Hobby workspace) | $0 | Two web services: the API and the real-time check, staging and production |
| Neon | Free | $0 | Two PostgreSQL 16 databases with PostGIS, region AWS Asia Pacific (Singapore) |
| Resend | Free | $0 | Email from `noreply@ognistrada.com` (region Tokyo) |
| GitHub | Free | $0 | Code, tests, deploys, daily backups (Actions) |
| Sentry | Free (optional) | $0 | Error reports |
| The domain | Bought | (your registrar's yearly fee) | `ognistrada.com` |

The free plans' limits as of October 2026 (check each service's pricing page):
- **Cloudflare:**
  - Pages: unlimited bandwidth, 500 deploys a month, 25 MiB a file, 20,000 files. The game is about 860 files and
    6 MB.
  - R2: 10 GB storage, 1 million writes and 10 million reads a month, downloads free. Our files are about 280 MB in
    each environment.
- **Render (Hobby, free):**
  - 512 MB of memory and 0.1 CPU per service.
  - Sleeps after 15 minutes without a request or WebSocket message, and wakes in about a minute.
  - 750 running hours a month, shared by both services.
  - 5 GB of bandwidth a month, then $0.15/GB.
  - Custom domains with free certificates.
- **Neon (free), per project:** 0.5 GB of storage, 100 compute-hours a month, the database pausing after 5 minutes
  idle, 6 hours of history to restore from, and 5 GB of network transfer a month.
- **Resend (free):** 3,000 emails a month, at most 100 a day, one domain.

## Free plans: what to watch

What could cause problems, or lose data, and what's in place for each:

1. **Database history is only 6 hours (Neon free).** A mistake noticed later can't be undone from Neon alone.
   - In place: `backup.yml` dumps production every day at 03:17 UTC, encrypted, test-restores it into a fresh
     database, and keeps it 30 days.
   - Keep `BACKUP_PASSPHRASE` somewhere safe; without it the backups can't be read.
   - Worst case: up to a day's progress lost.
2. **Database storage is 0.5 GB per project.** When it's full, writes fail; nothing is lost, but players can't save.
   - What fills it: run recordings and replays, the ledger, world content.
   - The economy dashboard on the admin page shows totals. Check Neon's dashboard for storage.
3. **Neon compute is 100 hours a month per project.** With the database pausing when idle, that's plenty for one
   tester. If it ran out, the database would stop until the next month.
4. **The API sleeps (Render free).**
   - The first visit after 15 quiet minutes waits about a minute; the game says "Waking the server…" and retries.
   - WebSocket connections drop when it sleeps or restarts.
   - The two services share 750 hours a month. If both stayed awake all month (2 × 730 hours), the second would stop
     near the end of the month. While it's one tester, they sleep most of the time.
5. **Render's bandwidth: 5 GB a month.** The game and its files come from Cloudflare (free bandwidth), so only the
   API's answers count.
6. **R2 needs a payment method on file**, even on the free plan. Cloudflare charges only beyond the free amounts.
   Set a billing notification (Cloudflare → Billing → Notifications) so you hear if usage nears them.
7. **Resend: 100 emails a day, shared by staging and production.**
   - Past that, verification and reset emails fail until the next day; players can sign in later and ask for a new
     link.
   - Resend's free plan keeps its logs for one day.
8. **The database is reachable from the internet (Neon free has no IP allow-list).**
   - It's protected by a strong generated password and TLS (`sslmode=require`).
   - The connection strings live only in Render's and GitHub's secret settings.
   - Neon's IP allow-list is on its paid Scale plan. Render's paid Postgres can refuse outside connections entirely
     (see [Upgrading](#upgrading-about-13-a-month)).
9. **Singapore, not Australia.** Render has no Australian region, so the API is about 90–100 ms from Sydney. That's
   fine for the API. Phase 7's real-time racing should be closer: see the end of [Upgrading](#upgrading-about-13-a-month).

### Considered: Oracle Cloud Always Free

Oracle's free virtual machines run in Sydney and Melbourne and don't sleep, which would help ping. They're not the
better choice now:
- **Smaller allowance:** Oracle has been reported to be cutting its free Arm allowance (from 4 cores and 24 GB to 2
  cores and 12 GB, from 18 August 2026).
- **Idle reclaiming:** free machines that sit mostly idle for a week (CPU, network and memory under 20%) can be
  reclaimed, and a test server is idle most of the time.
- **Capacity:** new free machines often fail with "out of host capacity".
- **Everything is ours to run:** operating system updates, TLS, restarts, deploys and monitoring. That's more
  security work than a managed host.

Revisit for Phase 7 if Sydney latency matters before paying for a server there.

## Setting it up (once)

Steps marked **you** need your accounts. The rest is done by the `infra` workflow
(`tools/cloudflare-setup.mjs`), because only GitHub Actions can reach Cloudflare's and Resend's APIs. The
workflow is safe to run again.

### 1. Cloudflare (you): the site, R2, three tokens

1. Sign up at cloudflare.com and **Add a site**: `ognistrada.com`, Free plan.
2. At your domain's registrar, replace its nameservers with the two Cloudflare shows. When the site says
   **Active** (minutes to a day), Cloudflare is in charge of the DNS.
3. **R2 → Purchase R2 (free plan)**: add a payment method. It isn't charged within the free amounts.
4. Copy the **Account ID** (right-hand side of the site's overview).
5. **My Profile → API Tokens → Create token**, three of them:
   - **`ognistrada setup`**, for the `infra` workflow:
     - Account: *Cloudflare Pages: Edit*, *Workers R2 Storage: Edit*.
     - Zone `ognistrada.com`: *Zone: Read*, *DNS: Edit*, *Zone Settings: Edit*, *Transform Rules: Edit*,
       *Single Redirect: Edit*, *Cache Rules: Edit*.
     - Set it to expire in a year.
   - **`ognistrada deploy`**, for deploys: Account: *Cloudflare Pages: Edit*, nothing else. Also a year.
   - **R2 → Manage R2 API tokens → Create**: *Object Read & Write*, both buckets (`ognistrada-tiles`,
     `ognistrada-tiles-staging`; create the token after the `infra` workflow has made them). Copy the **Access Key
     ID** and **Secret Access Key**.
6. Optional: **Email → DMARC Management**, so Cloudflare collects the DMARC reports for you.

### 2. Neon (you): two databases

1. Sign up at neon.com and create two projects: `ognistrada-staging` and `ognistrada-production`. Use PostgreSQL 16
   and region **AWS Asia Pacific (Singapore)**, the same as Render.
2. In each, **Connect** → copy the connection string **without** "-pooler" in the host (the direct one, with
   `sslmode=require`).
   - The server takes a lock while it migrates, which needs a direct connection.
   - These become `DATABASE_URL` for that environment.
3. Nothing else: the server switches PostGIS on and runs every migration when it starts.

### 3. Resend (you): two keys

1. Sign up at resend.com.
2. **API Keys → Create**:
   - One with *Full access*, named `ognistrada setup`: the `infra` workflow adds the domain and its DNS records with
     it.
   - Two with *Sending access*, named `ognistrada staging` and `ognistrada production`: these send the email.
3. Each environment's `SMTP_URL` is `smtps://resend:THE-SENDING-KEY@smtp.resend.com:465`.

### 4. Render (you): the API servers

1. Sign up at render.com with GitHub → **New → Blueprint** → this repository. It reads `render.yaml` and makes
   `ognistrada-staging` and `ognistrada-production` (Singapore, free).
2. In each service's **Environment**, fill in the secrets it asks for:

   | Setting | Value |
   |---|---|
   | `DATABASE_URL` | That environment's Neon connection string |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32`, different for each |
   | `EDGE_SECRET` | `openssl rand -hex 24`, different for each (it also goes into GitHub, below) |
   | `SMTP_URL` | From Resend (above) |
   | `ADMIN_EMAIL` | Your email (that account becomes an admin once its email is confirmed) |
   | `GOOGLE_*`, `DISCORD_*`, `SENTRY_*` | Optional (see SERVER.md); Google's redirect URI is `https://api.ognistrada.com/api/auth/callback/google` (and `staging-api…`) |

   The addresses (`PUBLIC_URL`, `GAME_URL`, `TILES_URL`, `RT_URL`, `MAIL_FROM`, `HSTS`) come from `render.yaml`.
3. Note each service's `….onrender.com` host and its ID (`srv-…`, in its URL).
4. **Account Settings → API Keys → Create**: that's `RENDER_API_KEY`.

### 5. GitHub (you): environments, variables, secrets

**Settings → Environments:**

| Environment | Variables | Secrets | Protection |
|---|---|---|---|
| `staging` | `GAME_URL=https://staging.ognistrada.com`, `API_URL=https://staging-api.ognistrada.com`, `TILES_URL=https://staging-tiles.ognistrada.com`, `RT_URL=wss://staging-rt.ognistrada.com`, `PAGES_PROJECT=ognistrada-staging`, `R2_BUCKET=ognistrada-tiles-staging`, `RENDER_SERVICE_ID=srv-…`, `OTHER_API_URL=https://api.ognistrada.com`, `HSTS=off` | — | none |
| `production` | The same for production: `https://ognistrada.com`, `https://api.ognistrada.com`, `https://tiles.ognistrada.com`, `wss://rt.ognistrada.com`, `ognistrada`, `ognistrada-tiles`, its `srv-…`, `OTHER_API_URL=https://staging-api.ognistrada.com`, `HSTS=off` | — | **Required reviewers: you** |
| `infra` | `RENDER_STAGING_HOST`, `RENDER_PRODUCTION_HOST` (the `….onrender.com` hosts) | `CLOUDFLARE_SETUP_TOKEN`, `RESEND_API_KEY` (full access), `EDGE_SECRET_STAGING`, `EDGE_SECRET_PRODUCTION` (the same values as in Render) | Required reviewers: you (recommended) |

**Settings → Secrets and variables → Actions:**
- Repository variable: `CLOUDFLARE_ACCOUNT_ID`. Setting it switches automatic deploys on.
- Repository secrets:
  - `CLOUDFLARE_API_TOKEN` (the deploy token), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `RENDER_API_KEY`;
  - for the backups (SERVER.md): `PRODUCTION_DATABASE_URL`, `STAGING_DATABASE_URL`, `BACKUP_PASSPHRASE`.

### 6. Cloudflare and Resend, set up (the `infra` workflow)

1. **Actions → infra → Run workflow** with *dry run* ticked: it lists everything it would do.
2. Run it again without *dry run*. It sets up:
   - HTTPS: Full (strict), HTTP to HTTPS, TLS 1.2 at least;
   - the two Pages projects on `ognistrada.com` and `staging.ognistrada.com`;
   - the two R2 buckets with CORS, on `tiles.` and `staging-tiles.`;
   - DNS for the API and real-time addresses, DNS only for now, so Render can issue their certificates;
   - the `www` redirect, the edge-secret rule, the tiles' CORS rule and the tiles' cache rule;
   - Resend's domain, its SPF and DKIM records, and a DMARC record.
3. In Render, each service's **Settings → Custom Domains** turns *Verified*, with a certificate, within minutes.
   Then run **infra** again with *proxy_api* ticked: the API and real-time addresses go through Cloudflare.
4. In Resend, **Domains** shows `ognistrada.com` *Verified*. If it doesn't, run **infra** with *only* `email` once
   the DNS has spread.

### 7. The first deploy

Push to `main`. When the tests pass, **staging** deploys. Then **production** waits for your approval: **Actions →
the run → Review deployments**.

## Deploying

Every push to `main` runs `server.yml`: the tests, then `deploy.yml` for staging, then (approved) for production.

`deploy.yml`, for one environment:
1. **Map files:** `assets/` to that environment's R2 bucket with `rclone sync --checksum`, so only changed files
   upload.
2. **The API:** Render deploys this commit (Render's API, `commitId`).
   - The server's migrations run as it starts, one server at a time (an advisory lock).
   - The workflow waits until `/api/v1/health` reports this commit and healthy.
3. **The game:** `tools/build-site.mjs` builds it for this environment and `wrangler pages deploy` publishes it.
4. **The checks:** `tools/check-deploy.mjs` (see [Checks](#checks)). A failed check fails the deploy.

**Migrations only ever add** (new tables, new columns with defaults, new indexes). The game already online, and
the API rolled back, keep working with the newer database. Removing or renaming something takes two deploys: first
stop using it, then remove it.

## Rolling back

| What | One step |
|---|---|
| Everything, kept in step | **Actions → rollback → Run workflow**: the environment and the commit to go back to. It runs `deploy.yml` at that commit (map files, API, game, checks); production still needs your approval. |
| The game alone | Cloudflare → Workers & Pages → `ognistrada` → Deployments → an earlier one → **Rollback**. |
| The API alone | Render → `ognistrada-production` → Events → an earlier deploy → **Rollback**. |
| A database mistake | Neon → the project → **Restore** (up to 6 hours back), or the latest `backup.yml` backup (SERVER.md "Restoring"). |

A rollback never undoes database migrations (they only add), so the older API works with the newer database.

## Checks

**Automatic:** after every deploy, and on demand from **Actions → check**. `tools/check-deploy.mjs` checks, from
GitHub's runner:
- every address loads over HTTPS with a valid certificate, and `http://` redirects to `https://`;
- `www` redirects to the game (production);
- HSTS, once it's switched on;
- the game's page knows every address;
- the game's `/assets/` goes to the tiles address, and `/admin` to the API's;
- the editor's code isn't on the game's address;
- the API is healthy, in this environment, with its database answering;
- CORS: the game may read the API, another site may not;
- the admin page and the editor's code, signed out, send you to sign in;
- tiles:
  - a byte range comes back (206), and comes from Cloudflare's cache the second time (`cf-cache-status: HIT`);
  - CORS answers for the game's and the API's addresses, even from the cache, and not for another site;
- real time: 10 WebSocket pings through Cloudflare all answered, with the round trip's time;
- staging and production use different databases (each health check's `dbId`).

**Before anything is online:** `node server/tools/deploy-browser.ts` (also in CI) runs the same layout on this
machine in Chromium, each part on an address of its own: game, API, tiles, real time, and another site.

**By you, once at the start and after big changes:**
1. **Sign up from a phone on mobile data** (Wi-Fi off) at `ognistrada.com`. The verification email should arrive in
   the inbox, not spam: try a Gmail address and an Outlook/Hotmail address.
   - In Gmail, **Show original** should say `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
   - In Outlook, the message details should show `spf=pass`, `dkim=pass`, `dmarc=pass`.
2. Sign in and load the world. The map should stream in.
3. Open `ognistrada.com/site/ping.html` and run the check: it shows the real-time round trip from where you are.
4. **Two players on different networks in the same room:** moved to Phase 7 Step 1's tests, along with the real
   multiplayer server. For now, `rt` only proves that WebSockets reach the server through Cloudflare.

## Once everything works

1. **HSTS:** browsers then refuse plain `http://` for a year.
   1. Set `HSTS=on` in both GitHub environments.
   2. Set `HSTS=on` on both Render services.
   3. Run **infra** with *hsts* ticked: Cloudflare adds it on every address.
   4. Deploy, and run **check** with *hsts* ticked.
2. **DMARC:** after a couple of weeks of reports showing only Resend sending as `ognistrada.com`, tighten it to
   `p=quarantine` (in `tools/cloudflare-setup.mjs`, then run **infra** with *only* `email`).

## Real time: through Cloudflare or straight

`rt.` goes through Cloudflare because that gives:
- a managed certificate;
- Cloudflare in front of the server against attacks;
- the player's real IP address, carried by Cloudflare's header and trusted only with the edge secret.

The extra hop from Cloudflare's Sydney data centre to Render's Singapore is usually small.

`site/ping.html` measures it. To compare with going straight:
1. Point `rt.` at Render without Cloudflare: in Cloudflare's DNS, switch the `rt` record's cloud to grey ("DNS
   only").
2. Run the ping page again.
3. Keep whichever is clearly lower. Going straight, the server takes the address Render saw, so IP addresses still
   work.

## Upgrading (about $13 a month)

| Part | Now | Upgraded | How |
|---|---|---|---|
| The API and real time | Render free | Render **Starter**, $7 a month per service: always on, 0.5 CPU | `render.yaml`: `plan: free` → `plan: starter` for production (staging can stay free), then sync the blueprint. Nothing else changes. |
| The database | Neon free | **Render Postgres Basic-256mb**, $6 a month: private network (not reachable from the internet), daily backups | Not only a setting: the data moves (below). |
| Real time on its own (later) | Inside the API | A second Render service, or a host in Sydney | Point `rt.` at it and set `RT_URL`. The game already reads it from `site/config.js`. |

**Moving the database to Render Postgres**, about 10 minutes, with the game briefly offline:
1. In Render, **New → PostgreSQL**: Basic-256mb, Singapore, PostgreSQL 16. In its **Access Control**, remove every
   outside IP address.
2. Put the game into maintenance by suspending the production web service in Render.
3. From a computer with PostgreSQL 16+ tools:

   ```sh
   pg_dump --format=custom --no-owner "NEON_URL" > move.dump
   pg_restore --no-owner --dbname="RENDER_EXTERNAL_URL" move.dump
   ```

   For this, temporarily allow your own IP address in the new database's Access Control, and remove it again
   afterwards.
4. Set `DATABASE_URL` on the service to the database's **Internal** URL, resume the service, and run **check**.
5. Point the backup secrets at the new database. Keep the Neon project for a week, then delete it.

(Staying on Neon and moving to its paid plan instead keeps the same connection string, so that is a setting
change. Check Neon's pricing page.)

**For Phase 7** (real-time racing), consider a real-time server in Sydney, for example a small machine on Fly.io
(region `syd`, a few dollars a month). Measure with `site/ping.html` first.

## What expires, and renewing it

| What | When | What to do |
|---|---|---|
| The domain `ognistrada.com` | Yearly, at your registrar | Keep auto-renew on, and the payment card up to date |
| Cloudflare's certificates | Every few months | Automatic (Universal SSL) |
| Render's certificates | Every few months | Automatic. If Render shows a renewal error, switch the API and real-time records to DNS only (run **infra** without *proxy_api*), let it renew, then switch back. |
| Cloudflare API tokens (setup, deploy) | The expiry you set (a year) | Make new ones with the same permissions and replace the GitHub secrets. The old ones stop working on their own. |
| R2 access keys | Never, unless you set an expiry | Replace yearly: make a new pair, update the GitHub secrets, delete the old pair |
| Render API key, Resend keys | Never | Replace if anyone else may have seen them |
| `BETTER_AUTH_SECRET` | Never; replace if exposed | A new one signs everyone out |
| `EDGE_SECRET` | Never; replace if exposed | Set the new value on the Render service and in GitHub's `infra` environment, then run **infra**. Requests are briefly taken at Render's view of the address in between. |
| `BACKUP_PASSPHRASE` | Never | **Never lose it.** Old backups need it. |
| Backups | Each kept 30 days | Download one now and then and keep it elsewhere |
| Free-plan allowances (Render hours, Neon compute) | Monthly | Reset automatically |
| Google sign-in (if used) | The consent screen needs verification for over 100 users | Submit it before opening sign-ups widely |

## Files

| File | What |
|---|---|
| `render.yaml` | The Render services (the API and real time), their addresses and settings |
| `tools/build-site.mjs` | Builds the game for Cloudflare Pages: `site/config.js`, `_headers`, `_redirects`, import map |
| `tools/cloudflare-setup.mjs` | Sets up Cloudflare and Resend (run by `infra.yml`) |
| `tools/check-deploy.mjs` | The checks (run by `deploy.yml` and `check.yml`) |
| `.github/workflows/server.yml` | Tests, then deploys (staging, then production with approval) |
| `.github/workflows/deploy.yml` | One environment's deploy: files, API, game, checks |
| `.github/workflows/rollback.yml`, `infra.yml`, `check.yml` | Rolling back, setting up, checking |
| `site/config.js`, `site/urls.js` | Where the game finds the API, tiles and real time; the editor loader |
| `site/ping.html` | The real-time round-trip check |
| `server/src/rt/health.ts` | The real-time stand-in (ping/pong) |
| `server/tools/deploy-browser.ts` | The whole layout tested in a browser, locally and in CI |
