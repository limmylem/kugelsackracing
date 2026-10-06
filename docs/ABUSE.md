# Abuse protection (Phase 6 Step 5)

How the game keeps bots out, notices people farming with several accounts, lets players report each other,
keeps names clean, and limits how fast anyone can ask the server for things. What runs on Cloudflare in
front of it is at the end: it's part of [DEPLOYMENT.md](DEPLOYMENT.md)'s "To do when we deploy".

**Nothing here bans anyone by itself.** The scan and the reports go into queues on the admin page
(Reports & flags), and an admin decides, with a reason that goes into the audit log.

## The bot check (Cloudflare Turnstile)

- **Where:**
  - signing up (`/api/auth/sign-up/email`);
  - signing in with a password (`/api/auth/sign-in/email`);
  - becoming a guest (`/api/auth/sign-in/anonymous`);
  - on the account page and the admin page's sign-in.
- **How:**
  - The form shows Turnstile's widget (`account/botCheck.js`; usually just a tick, nothing to solve).
  - Its one-use answer goes with the request in the `x-bot-check` header.
  - The server asks Cloudflare whether it's good, for that address, before Better Auth sees the request (`server/src/abuse/botCheck.ts`).
  - Refused: `403 BOT_CHECK`, and no account is made.
  - If Cloudflare can't be reached, the request is refused rather than let through.
- **Settings:** `TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET_KEY` (secret), from Cloudflare's dashboard → Turnstile → Add site.
  - The widget mode is "Managed".
  - Allowed hostnames: the game's address and the API's.
  - **Free**, with no limits for this use.
  - Without the keys the check is off (development, the tests).
  - **Production refuses to start without them** (`botCheck.required` in `server/config/production.json`).
- **Cloudflare's test keys** (for staging before the real ones):

  | Key | Value | Does |
  |---|---|---|
  | site key | `1x00000000000000000000AA` | Always passes |
  | secret | `1x0000000000000000000000000000000AA` | Always passes |
  | secret | `2x0000000000000000000000000000000AA` | Always fails |
- **The content security policy** allows `https://challenges.cloudflare.com` for scripts and frames: on the server when the keys are set, and always on the static site.
- **Tests:** `server/test/abuse.test.ts` checks:
  - no answer, or a wrong one, refused on every checked path, and no account made;
  - 40 bot sign-ups from 40 addresses all refused;
  - the real verifier refusing when Cloudflare can't be reached.

## Several accounts, one person

### What links accounts

Kept in `account_signals`, per account, for 90 days (`abuse.keepDays`; the retention job deletes older ones,
see [PRIVACY_DATA.md](PRIVACY_DATA.md)):

- **The browser.**
  - The game keeps a random id in the browser's storage (`kr.device`, made the first time; nothing about the device itself).
  - It sends the id with each request (`x-kr-device`).
  - The server keeps only an HMAC of it with the server's secret, so the id can't be read back from the database.
- **The address** each signed-in request came from (the sessions table already keeps the address each sign-in came from).

### What the scan flags

`server/src/abuse/detect.ts`, every hour, or from the admin page ("Scan now"):

| Flag | When | Score |
|---|---|---|
| `shared-device` | Two or more accounts from the same browser (90 days) | 40, +10 per extra account |
| `signup-burst` | Four or more new accounts first seen at one address within 24 hours (last 7 days) | 25 + 5 per account |
| `farm-group` | Three or more accounts sharing a browser, each earning rewards and then selling everything or losing cars in pink slips (30 days): accounts made to feed another | 60 + 5 per feeding account |
| `earning-rate` | An account earning more than `abuse.maxRewardPerHour` (60,000) in quest rewards in one hour, more than playing pays (the economy simulation's skilled player earns about a tenth of that) | 50 and up |

- **One flag per group of accounts.** Seen again, its evidence is brought up to date. A group that grows is a new flag.
- **Expected false alarms:**
  - a family or a school sharing a computer;
  - a phone network or a university sharing one address.

  That's why these are flags and not bans, and why `signup-burst` scores low.
- **Reviewing:** each flag is marked "Not abuse" or "Dealt with" with a reason (logged).
  - Acting on it (suspend, ban, take money back) is done on the player's page, which has the full history: the ledger, results, reports, flags and linked accounts.
- **Players trading with each other** doesn't exist yet. When it does (Phase 7), add a `transfer` flag here for value moving between linked accounts.

## Player reports

- **In the game:** each name on a leaderboard (not your own) has "report".
  - Pick what for: cheating, an offensive name, behaviour, or something else.
  - Then a few words. `POST /api/v1/reports`.
- **Limits:**
  - not yourself;
  - 10 a day;
  - the same report of the same player while it's open counts once;
  - it needs a few words to say what happened.
- **The admin page, Reports & flags:**
  - Reports are sorted by how many different players are reporting someone now.
  - Each shows the name it was reported under (if they've changed it since).
- **Resolving:**

  | Action | Does |
  |---|---|
  | Dismiss | Nothing |
  | Warned | Recorded; tell the player by email from Support |
  | Rename | Replaces their name with `Racer-XXXXX`; they can choose a new one at once |
  | Suspend | 7 days |
  | Ban | Permanently |

  Each closes every open report of that player for that reason, and goes in the audit log.

## Names

`server/src/names.ts`, on signing up, every name change, and generated names:

- **The profanity filter** (obscenity's English list, with its handling of leetspeak, repeated letters and spacing). It's applied to the name as written and with digits read as letters.
- **Names kept for the team:**
  - admin, moderator ("mod" as a word), support, staff, official, Kugelsack, Ognistrada, system, developer, game master;
  - however they're written: "4dm1n", "Mod.Team", "Kugel Sack Support".

  Ordinary words that contain them ("Modular", "Admiral") are fine.
- **Social sign-ins** with a name that fails get a generated one (`Racer-XXXXX`).
- Names are unique (case doesn't matter), and change at most once in 30 days.

## Rate limits, against real use

How a normal player uses the server, from the game's code and the load tests:

| What | Requests |
|---|---|
| Opening the game | About 10 API requests: client config, `/me`, the CSRF token, the profile, the economy settings, the used-car lot, today's tracks, nearby content (published content is cached by the CDN) |
| Just playing | 2 a minute in the background: the account's and the drive's heartbeats, every 60 s |
| In the garage | One write per click. A quick player makes 10 to 30 a minute; dragging a tuning slider sends one per release. |
| Racing | A few writes a run (starting it, crash reports, handing the result in) |

The limits (`server/config/<env>.json` `rateLimits`; Better Auth's own in `server/src/auth.ts`), staging and
production:

| Limit | Per | Allowed | Why this much |
|---|---|---|---|
| Anything under `/api/` | Address | **1,200 a minute** (was 600) | A school or a phone network puts many players behind one address. 1,200 a minute is about 40 players opening the game together, and hundreds playing. |
| Writes | Account | 120 a minute | Four times the quickest garage clicking seen. A script hammering the economy hits it at once. |
| Signing in, sign-up, emails (Better Auth's paths) | Address | **30 a minute** (was 20) | A class signing in together. The bot check now does the heavy lifting. |
| Password sign-in | Address | **15 a minute** (Better Auth's; was 10) | Guessing passwords: 15 a minute from one address is hopeless against 10-character passwords. Cloudflare's rule (below) stops wider floods. |
| Sign-ups and guests | Address | **20 an hour** (was 5) | A class making accounts together. Bots are stopped by the bot check, not by this. |
| Password reset and verification emails | Address | 5 an hour | Nobody needs more. It stops the game being used to send email at someone. |
| Reports | Account | 10 a day | |
| Support and feedback messages | Account | 5 a day | |
| Live-update streams | Account | 6 at once | One per open tab. |

- Development and tests keep their own (high) values.
- **Check against real numbers after launch:**
  - the monitoring dashboard ([OPERATIONS.md](OPERATIONS.md)) shows the busiest accounts' requests a minute, and the number of 429s;
  - raise a limit if real players hit it;
  - lower it if nobody comes near.

## Cloudflare in front (when we deploy)

All on Cloudflare's **free** plan. The DNS is already planned there ([DEPLOYMENT.md](DEPLOYMENT.md)).

1. **Proxy everything.** `ognistrada.com`, `api.`, `tiles.` and `rt.` are orange-clouded, which brings DDoS protection at the edge (always on and unmetered on every plan) and hides Render's address.
   - **Render's own `*.onrender.com` address** still answers. Requests through it skip Cloudflare's checks, but still meet the server's own limits, by the address Render saw (`EDGE_SECRET`: only Cloudflare's requests are believed about the player's address).
2. **Security → WAF → Managed rules:** turn on the free managed ruleset.
3. **Security → WAF → Rate limiting rules** (the free plan allows one):
   - match: URI path starts with `/api/auth/`;
   - limit: 60 requests in 10 seconds per IP;
   - action: block for 10 seconds.

   This stops floods before they reach Render at all. The server's own limits stay as the finer layer.
4. **Security → Bots:** leave "Bot Fight Mode" **off** for `api.` (it challenges the game's own API requests). Turnstile protects the forms instead.
5. **Caching** (already in DEPLOYMENT.md):
   - map tiles and assets an hour;
   - published world content by its `Cache-Control` (`s-maxage=300` with an ETag);
   - leaderboards for signed-out visitors 15 s;
   - nothing private (the server marks every private answer `private, no-store`).
6. **Turnstile:** add a site for `ognistrada.com` and `api.ognistrada.com`, and put its keys in Render's environment (production and staging; staging can use the always-pass test keys).

## Files

| File | What |
|---|---|
| `server/src/abuse/botCheck.ts` | The Turnstile check |
| `server/src/abuse/detect.ts` | The account links and the scan |
| `server/src/routes/abuse.ts` | Reports and the admins' queues |
| `server/src/names.ts` | Names |
| `account/botCheck.js` | The widget |
| `admin/launch.js` | The admin page's Reports & flags |
| `server/test/abuse.test.ts` | The tests |
