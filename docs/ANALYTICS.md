# Play statistics (Phase 8 Step 4)

Anonymous statistics about how the game is played, so we can see where new players get stuck, which quests are
finished, how fast it runs on which devices, and which errors happen in which version. The owner chose our own
statistics on our own server: no outside analytics service, nothing sent anywhere else, and **nothing at all
without the player's consent**. This is for whoever reads the admin page's Statistics tab or adds something to measure.

## Consent first

- **Asked once**, on a small card (`askConsent` in `ui/analytics.js`): "Help us make the game better?", with "Yes,
  that's fine" and "No thanks" equally easy, a line on what's never sent, and a link to the privacy page
  (`/account/privacy.html#statistics`). Esc is no.
- **When**: about two minutes after the first launch's flow (`testtrack/launch.js` `maybeAskConsent`), and only if no
  other card is up then; otherwise the next visit. Never under browser automation.
- **The answer** is the setting `privacy.analytics` (`true`, `false`, or `null` for not asked), changeable any time in
  Settings → Privacy. Like other settings it follows the player's account ([ACCESSIBILITY.md](ACCESSIBILITY.md)).
- **Without a yes, nothing happens**: `track()` returns at once, nothing is queued, the browser's statistics id isn't
  even made. Saying no later empties what's waiting.

## What's sent

`startAnalytics({ settings, tier })` in `ui/analytics.js` (started by `testtrack/launch.js`). Each request:

| Field | What |
|---|---|
| `consent` | Always `true` (the server refuses anything else) |
| `anon` | A random id made in this browser for the statistics alone (`localStorage` `ognistrada.stats.id`): not the account, not the device id the abuse checks use |
| `session` | A random id for this visit |
| `version` | The game's build (`KR_SITE.version`, the commit) |
| `device` | `deviceInfo()`: the graphics tier, browser, system, phone or not, memory, cores, screen size, language |
| `events` | `{ kind, name, at, props }` each |

**The event kinds** (`KINDS` in `ui/analytics.js`, the same list as `EVENT_KINDS` on the server), and what sends them now:

| Kind | Sent by | Name · props |
|---|---|---|
| `session_start`, `session_end` | Start (and on saying yes); leaving the page | |
| `tutorial` | `play/onboarding.js` | `start`, each step done, `tutorial` with `{ state: done/skipped }` |
| `first_step` | `play/onboarding.js` | the step (`quest`, `repair`, `part`, `npcRace`, `starter`) · `{ state }` or `{ car }` |
| `school` | `play/school.js` | the lesson · `{ state: start/done/failed, medal }` |
| `quest_start`, `quest_end` | `testtrack/launch.js` (the `kr:questStart`, `kr:quest` events) | the quest id · `{ type, rivals }`, `{ result, medal, type }` |
| `purchase`, `repair` | `testtrack/launch.js` (the save's changes) | nothing more: that one happened |
| `perf` | `testtrack/launch.js`, once a minute while playing | the world · `{ fps, low1, preset }` |
| `error` | `ui/analytics.js` (`error`, `unhandledrejection`) | the message (80 characters) · `{ where (the file's name), line, fatal: false }` |
| `photo`, `share` | `play/photoMode.js`, `testtrack/launch.js` | `capture`, `clip`, `photo`, `open:<link kind>` |
| `screen`, `quit`, `track_start`, `track_end`, `race_end`, `setting` | Accepted, but **nothing sends them yet** | |

Never a name, an email, an account id, the IP address, where on the map, or any money.

**Timing**: events wait in a queue and go 20 seconds after the first, or at once when 40 are waiting, at most 60 a
request (`fetch` with no cookies, `credentials: 'omit'`). Leaving the page sends `session_end` and what's left with
`navigator.sendBeacon`. A request that fails is dropped: these are statistics, not records.

## The server

`server/src/routes/launch.ts`:

- **`POST /api/v1/analytics`** (no session, no CSRF token). The body is checked against `AnalyticsBody`: `consent`
  must be `true`; `anon` 8–64 characters, `session` 4–64, `version` up to 40; the device fields capped; **1 to 60
  events** (`LIMITS.analyticsBatch`), each `kind` one of `EVENT_KINDS`, `name` up to 80 characters; the whole body up to
  64,000 bytes. An event's `props` over 2,000 bytes (`LIMITS.analyticsPropsBytes`) is stored as `{}`. Answers 204.
- **The id is hashed again**: `HMAC-SHA-256(authSecret, 'analytics:' + anon)`, the first 22 characters. Nothing
  stored can be matched back to the browser's id, let alone an account. No user id and no IP address are stored with
  the events. (The server's request log, like for any request, has the address; the statistics don't.)
- The server's usual per-address rate limits apply.
- **`GET /api/v1/admin/analytics?days=30`** (admins; 1–400 days): the totals and tables below.

**The table**: `analytics_events` (`server/drizzle/0016_launch.sql`): `id`, `at`, `anon`, `session`, `kind`, `name`,
`version`, `device` (JSON), `props` (JSON), indexed by time and by kind and time.

**Kept 400 days**: the daily retention job (`server/src/ops/retention.ts`, `runRetention`) deletes events older than
`analyticsDays`. It defaults to 400; set `retention.analyticsDays` in `server/config/<environment>.json` to change it.
The admin page's retention dry run counts them too.

## The admin Statistics tab

`/admin/` → **Statistics** (`admin/live.js` `showAnalytics`), over the last 7, 30, 90 or 400 days:

| Section | What it means |
|---|---|
| Players · Sessions · Events | Distinct statistics ids, visits and events in the window. Players who said no aren't in any of it. |
| Errors and crashes by version | For the 10 most recent versions: sessions, sessions with an error, the error rate, sessions that crashed (an error marked `fatal`), the crash rate (red over 2%), and errors in all. A new version with a higher rate than the last is the thing to look at after a deploy. |
| The commonest errors | The top 10 messages with their version and how often. |
| The tutorial | How many players reached each step (`start`, then each step's name as it's done). The drop between steps is where they gave up. |
| First steps | Each step, done or skipped, by how many players. |
| Where new players stopped | Players whose first visit was in the window and who never came back more than a day after it: their last screen, tutorial step, first step or quit, counted. The top of this list is what to fix first. |
| Coming back | For each first day: new players, how many came back the next day, and a week later. |
| Quests | Each quest's starts, finishes and finish rate (top 15). A low finish rate is a quest too hard, too long or broken. |
| Tracks played | Plays per track (top 15). |
| The driving school | Each lesson by medal (or `none`), with tries. |
| Frame rates by device | For each quality tier and browser: samples, the median frames a second and the median of the worst 1%. |

**What fills each table** (`testtrack/launch.js`): `screen` when the world or the garage changes; `quit` (the
screen they were on) when the page closes; `track_start` and `track_end` for a generated track's run (it goes through
the quest machinery, with its track named), `quest_start` and `quest_end` for the rest; `race_end` for any race with
rivals; `setting` (`accessibility`) a few seconds after the accessibility or language choices change, with what they
are now — the "Accessibility and language choices" table counts each player's latest. A crash, for a game in a
browser, is the graphics context lost (`webglcontextlost`: the picture gone) or a `kr:fatal` event: those errors are
sent as `fatal`. A crash that kills the page outright can't report itself.

## Privacy

- The player-facing words: the consent card, `account/privacy.html#statistics`, and Settings → Privacy.
- The register: [PRIVACY_DATA.md](PRIVACY_DATA.md) (the "Play statistics" row: consent, `analytics_events`, 400 days).
- A player's data export says that statistics carry no account id, so they can't be found by account or exported
  (`server/src/data.ts`).

## Adding an event kind

1. Add it to `KINDS` in `ui/analytics.js` **and** to `EVENT_KINDS` in `server/src/routes/launch.ts`. The server checks
   each event's kind with that list (`z.enum`), and a batch with one unknown kind is refused whole, so deploy the
   server's list before (or with) the game's.
2. Send it: `stats.track(kind, name, props)` (or `game.track(...)` in the screens `testtrack/launch.js` hands it to).
   Keep `name` short (80 characters) and `props` small (under 2,000 bytes), and never personal: no names, emails,
   positions, chat or balances.
3. Show it: a query in `GET /admin/analytics` and a table in `admin/live.js` `showAnalytics`.
4. If it's a new sort of information, say so on the privacy page (`account/privacy.html#statistics`) and in
   [PRIVACY_DATA.md](PRIVACY_DATA.md) before it ships.
5. Test it in `server/test/launch.test.ts`.

## Cost

None: the events go to our own API and our own PostgreSQL ([DEPLOYMENT.md](DEPLOYMENT.md)), and old ones are deleted
after 400 days. No outside service, no extra plan.
