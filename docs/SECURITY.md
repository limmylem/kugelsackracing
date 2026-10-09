# Security (Phase 6 Step 5)

The security review before opening the game to real players: what was checked, every problem found with
its severity and what was done about it, what's still open, and the checklist to repeat before every major
release. The tests that keep each fix in place are in `server/test/security.test.ts`, with the rest of the
server tests (`npm run test:server`).

Severities: **Critical** (anyone can take over accounts or the server), **High** (one account's or the
game's data or items at risk), **Medium** (needs another mistake to hurt, or limited harm), **Low**
(hardening), **Info** (by design, noted).

## What was reviewed

- **Every API endpoint, against the OWASP Top 10 (2021):**
  - every route in `server/src/routes/*.ts` and Better Auth's endpoints under `/api/auth`;
  - for every endpoint that takes an id, whose id it accepts.
- **Accounts and sessions:**
  - session expiry, signing out everywhere, password reset links, email verification;
  - social sign-in and account linking, guests, roles, bans.
- **The client:** the content security policy and the other headers, on the server and on the static site
  (`tools/build-site.mjs`).
- **Secrets:** every tracked file and every commit in the history (`tools/scan-secrets.mjs --history`).
- **Dependencies:** `npm audit`, for what's deployed and for the development tools.

### Endpoints that take an id

Every endpoint that takes an id, and whose data it reaches:

| Endpoint | The id | Checked by |
|---|---|---|
| `POST /player/actions/:action` (garage, shop, repairs, quests: `instanceId`, `carInstanceId`, `sessionId`…) | The player's own items and runs | The action runs on the caller's own profile, loaded by their session's user id. An item that isn't in it is refused (409). Runs are looked up `where user_id = caller`. |
| `GET /player/recordings/:id` | A best run's recording | `where user_id = caller and id = :id` |
| `POST /player/sessions/:id/heartbeat`, `/player/drives/:id/end` | A drive or a quest run | `where id = :id and user_id = caller` |
| `POST /player/drives` | The car to drive | Must be one of the caller's `owned_cars` |
| `GET /player/ledger` | (paging) | `where user_id = caller` |
| `GET /tracks/records` | (a track code) | `where user_id = caller` |
| `GET /replays/:id` | A race replay | Anyone with the id may watch it (it's shared from leaderboards). Ids are 128 random bits. **Info**, by design. |
| `DELETE /replays/:id` | A race replay | `where id = :id and owner_id = caller` |
| `GET/PUT/POST/DELETE /content/items/:id…` | World content | Published copies are public. Drafts, archived copies and every write are editors only (role checked before the body is read). |
| `/admin/players/:id/…`, `/admin/ledger/:id/reverse`, `/admin/economy/…`, `/admin/shop/…` | Any player | Admins only, with two-factor sign-in, and every action is logged. |
| `GET /me/export`, `DELETE /me` | (the caller) | The session's own user only |

`server/test/security.test.ts` ("no player reaches another's data or items") tries another player's
items, drive, recording, ledger, records, replay, export and the admin endpoints, and checks that the
other player's things are untouched afterwards.

### OWASP Top 10

| | Where it stands |
|---|---|
| A01 Broken access control | Every id-taking endpoint is scoped as in the table above. Roles are kept on the server and checked as a request arrives. Better Auth's admin and impersonation endpoints are closed to browsers. Fixed: H1, M3. |
| A02 Cryptographic failures | Passwords are hashed with scrypt (Better Auth). Two-factor secrets are encrypted with the server's secret. Cookies are httpOnly, Secure in staging and production, SameSite=Lax (CSRF cookie: Strict, signed). HSTS turns on with HTTPS. Backups are encrypted with AES-256. |
| A03 Injection | All SQL goes through Drizzle's parameterised `sql` (one `sql.raw` of a fixed list of table names). Every request and response is checked against a Zod schema. Everything people typed is shown as text, never as HTML. |
| A04 Insecure design | Every write is idempotent. The economy is the server's (the client only asks). Rate limits are per address and per account. Fixed: M5 (bot check), plus abuse flags (docs/ABUSE.md). |
| A05 Security misconfiguration | Strict CSP with no inline scripts except the pages' own (M4). nosniff, no framing, CORS for the game's own origins only. `/dev/` isn't served in production. Settings are checked with Zod at start. |
| A06 Vulnerable components | `npm audit` in CI (high or critical fails). Weekly on schedule too (`.github/workflows/security.yml`). See L4. |
| A07 Identification and authentication failures | Email verified before the first sign-in. Passwords 10 to 128 characters. Resets expire in an hour and end every session. Sessions last 30 days and can be signed out everywhere. Fixed: H1, M1, M2. See L3. |
| A08 Software and data integrity failures | Results are checked by the game's own rules against the server's course. Migrations only add to the schema. CI runs before every deploy. |
| A09 Logging and monitoring failures | Every admin action goes in the audit log. Request ids appear on every answer. Logs never hold passwords, tokens or cookies. Sentry reports errors. Alerts: docs/OPERATIONS.md. |
| A10 Server-side request forgery | The server fetches nothing from an address a player gives (OAuth discovery is set in config only). |

## Problems found, and what was done

| # | Severity | Problem | Status |
|---|---|---|---|
| H1 | **High** | **Editor and admin accounts had no two-factor sign-in.** A stolen or reused password was enough to change any player's money and items, the economy's prices, and every published quest. | **Fixed.** Better Auth's two-factor plugin (an authenticator app, plus backup codes). Every editor and admin endpoint, the admin page and the editor need a session that passed it within the last 12 hours (`staffMfa` in `server/config/*.json`). A social sign-in doesn't count. "Trust this device" is switched off. The account page turns it on and asks for the code. Tests: `security.test.ts` (a sign-in with and without the code, a stale code, a session that never passed it, every guarded route), `roles.test.ts`. |
| M1 | Medium | **The client could choose its own IP address** whenever `EDGE_SECRET` wasn't set. Fastify's `trustProxy` took the first address in `X-Forwarded-For`, which the client writes itself. That got around every per-address rate limit (sign-in guessing, sign-up floods), and the sign-in list recorded whatever was claimed. | **Fixed.** Only the last hop (the host's own proxy) counts, or Cloudflare's `CF-Connecting-IP` when the edge secret proves it came through Cloudflare. Test: "the client can't choose its own address". |
| M2 | Medium | **Session tokens reached the page's scripts.** `/api/auth/get-session`, `/list-sessions` (every session of the account) and the sign-in answers included the token that is the session cookie's secret. The cookie is httpOnly so that an injected script can't steal a session, and these answers gave the tokens away anyway. | **Fixed.** Tokens are taken out of every `/api/auth` answer (the game never used them). Test: "session tokens never reach the page". |
| M3 | Medium | **`/api/auth/delete-user` skipped our account deletion rules**: the typed confirmation, and "never the last admin". The only admin could delete their account and leave nobody able to administer the game. | **Fixed.** That path is closed (however it's written). Accounts are deleted only through `DELETE /api/v1/me`. Test: "an account is deleted only through DELETE /me". |
| M4 | Medium | **The content security policy allowed any inline script** (`'unsafe-inline'`), which takes away most of its protection against injected scripts. | **Fixed.** `script-src` lists the hashes of the pages' own inline scripts (import maps, start-up scripts), worked out when the server starts and when the site is built (`server/src/clientFiles.ts` `inlineScriptHashes`). No page sets event handlers in HTML. Test: "the content security policy runs only the pages' own scripts". **Left:** `style-src` still allows inline styles (the pages use many); that's a much smaller risk. |
| M5 | Medium | **No bot protection on sign-up, guest accounts or sign-in** beyond per-address limits. | **Fixed:** docs/ABUSE.md (Cloudflare Turnstile, ready to switch on). |
| L1 | Low | A player could set their account's `image` to any text (a `javascript:` link, say). It isn't shown anywhere yet. | **Fixed.** Refused. |
| L2 | Low | **No limit on live-update streams per account** (`/player/events`): one account could hold thousands open. | **Fixed.** At most 6 per account. |
| L3 | Low | **Signing up with an email that already has an account says so**, which tells someone the address plays. Sign-up is rate limited per address. | **Open (accepted):** Better Auth has no switch for it. Changing it needs our own sign-up endpoint. Revisit if abused. |
| L4 | Low | **7 moderate advisories in development tools only**: esbuild's dev server inside drizzle-kit, and hyperid inside autocannon. Neither runs in production, and the server's image prunes development packages. | **Open:** no fix without downgrading drizzle-kit. CI fails on high or critical. |
| L5 | Low | **CI's typecheck was failing** on a test's types (`shop.test.ts`). | **Fixed.** |
| I1 | Info | Race replays are watchable by anyone with the id (they're shared from the leaderboards). Ids are 128 random bits. | By design. |
| I2 | Info | **Secrets:** none found in the files or anywhere in the git history (only `server/.env.example`, with no values, was ever committed). | Nothing to rotate. The scan runs in CI. |

Also checked and fine:

- password reset links: one use, an hour, every other session ended;
- email verification links: a day;
- sessions: 30 days, renewed daily, refused once expired or signed out everywhere;
- banned accounts are refused;
- Google account linking only for verified Google emails;
- the CSRF token on every cookie write;
- idempotency keys kept per account.

## Rotating a secret

If a secret ever leaks (the scan finds one, a laptop is lost, someone leaves):

1. **Make a new one** where it comes from:
   - `BETTER_AUTH_SECRET`: `openssl rand -base64 32`.
   - `EDGE_SECRET`: `openssl rand -hex 24`.
   - `BACKUP_PASSPHRASE`.
   - OAuth client secrets, Resend and Sentry: in each provider's dashboard.
2. **Put it in GitHub's secrets** (Settings → Secrets and variables → Actions; and the Cloudflare rule for `EDGE_SECRET`), then
   run the `deploy` workflow: it writes the server's `.env` from them (docs/DEPLOYMENT.md).
   - Changing `BETTER_AUTH_SECRET` signs everyone out, and makes the two-factor secrets unreadable: editors and admins turn two-factor sign-in on again.
3. **Revoke the old one** at the provider.
4. If it was committed: removing it from the history doesn't make it safe. Rotate it first; history rewrites are optional.

## Before every major release: the checklist

Copy this into the release's notes and tick each:

- [ ] `npm run test:server`, `npm test`, `npm run test:unit` pass, and `server/test/security.test.ts` is among them.
- [ ] `npm audit --omit=dev --audit-level=high` is clean. Look at anything new in the full `npm audit`.
- [ ] `node tools/scan-secrets.mjs --history` finds nothing.
- [ ] **Every new endpoint that takes an id** is in the table above with its check, and has a test that another player's id is refused.
- [ ] **Every new editor or admin endpoint** has `config: { role }` (the roles test walks them all, so it's covered by the test run).
- [ ] **No new inline script** in a page without a rebuild: hashes are worked out at start and build, so a change to an inline script is picked up automatically. Check the browser console for CSP errors on every page.
- [ ] **Any new personal data** is in docs/PRIVACY_DATA.md, with its retention (and the privacy policy updated).
- [ ] **Rate limits** for any new write fit real use (docs/ABUSE.md).
- [ ] **Migrations only add.** The previous version still runs against the new schema (docs/OPERATIONS.md, safe deploys).
- [ ] **On staging:**
  - sign in as an admin, with the authenticator code;
  - sign out everywhere;
  - reset a password;
  - delete a test account.
- [ ] Sentry shows no new errors from staging. The status page and alerts are green.
