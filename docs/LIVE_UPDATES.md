# News, patch notes, notices and the event calendar (Phase 8 Step 4)

How the game tells players what's going on without a deploy: news, what's new after an update, planned maintenance
and outage notices, and a calendar of events, meets and tournaments they can say they're going to. All of it is
written on the admin page's **Live** tab and shown in the game's news panel. This is for the owner and admins
running the game, and for whoever changes the code.

## What players see

`ui/news.js` (`mountNews`, mounted by `index.html` once the account is known):

- **The News button**, top right, with a count of news and patch notes not yet seen. It opens the **news panel** (a
  dialog: Tab and Esc work) with three tabs: **News** (news, maintenance and outage items), **What's new** (patch
  notes) and **Events** (the calendar). A link at the bottom goes to the status page.
- **Patch notes after an update**: the first time a player loads a new version of the game, the panel opens on
  "What's new" by itself, once, if there are patch notes for that version (their Version is the build's) or published
  since the player last played (`patchNotesToShow`).
- **A banner** across the top (`#liveBanner`) while a maintenance or outage item is up: its title, the first line of
  its text, and a link (its own, or the status page).
- **Event reminders**: an event the player is going to, starting within 15 minutes, gets a notice once (with a Close
  button; read out to screen readers).
- **"I'm going"** on each upcoming event (signed in; not on cancelled events or free-roam meets), with how many are
  going.
- The game asks the server again every 5 minutes, and when the connection comes back. Text is plain: lines starting
  with `- ` become a list, nothing is read as HTML.

**Settings → Notifications** (`settings.notifications`):

| Setting | What it does |
|---|---|
| News | Counts news items on the button |
| What's new after an update | Counts patch notes on the button, and opens them after an update |
| Events | Counts events newly on the calendar on the button (the Events tab is always there) |
| Event reminders | The notice before an event you're going to |

## The server

`server/src/routes/launch.ts`, under `/api/v1`:

| Endpoint | Who | What |
|---|---|---|
| `GET /news` | Anyone | Published items whose start has come and whose end hasn't, newest first, at most 30 (cached 60 s) |
| `GET /admin/news` | Admins | Every item, drafts too (the last 200) |
| `POST /admin/news` · `PUT /admin/news/:id` · `DELETE /admin/news/:id` | Admins | Add, change, delete an item |
| `GET /calendar` | Anyone (signed in: with "mine") | Events from a day ago to 60 days ahead (100 at most) with how many are going, and the free-roam meets made on the admin page's Free roam tab |
| `POST /calendar/:id/rsvp` · `DELETE /calendar/:id/rsvp` | Signed-in players | Going, or not any more (not to a cancelled event) |
| `POST /admin/calendar` · `PUT /admin/calendar/:id` · `DELETE /admin/calendar/:id` | Admins | Add, change, delete an event |

A news item: `kind` (`news`, `patch`, `maintenance`, `outage`), `title` (3–120), `body` (up to 4,000 characters),
`version` (up to 40), `link`, `startsAt` (empty: now), `endsAt` (empty: no end), `published` (default no: a draft).
An event: `kind` (`event`, `meet`, `tournament`), `title`, `body` (up to 2,000), `link`, `region`, `startsAt` and
`endsAt` (both needed, the end after the start), `cancelled`. Every admin change is written to the audit log
(`news-add`, `news-edit`, `news-delete`, `calendar-add`, `calendar-edit`, `calendar-delete`).

**The tables** (`server/drizzle/0016_launch.sql`): `news_items`, `calendar_events`, and `calendar_rsvps` (an event and
a player; deleted with either). A player's going-to list is in their data export and goes with their account.

## The admin Live tab

`/admin/` → **Live** (`admin/live.js` `showLive`):

- **News, patch notes and notices**: a list of every item (start, kind, title and version, end, published or draft),
  each with Edit and Delete, and **New item**. The form: Kind, Version, Title, Text (plain; `- ` for a list), Link,
  Shown from, until, Published.
- **Event calendar**: the next 60 days, with how many are going; **New event**. The form: Kind, Region, Title,
  About it, Link, Starts, Ends, Cancelled. Free-roam meets show here too, marked, and are edited on the Free roam tab.
- Times are typed in the admin's own time zone and kept in UTC; players see them in theirs.

## Maintenance mode, the banner and the status page

They work together, but they're different things:

| | What it does | Where |
|---|---|---|
| A **maintenance notice** (news kind "Planned maintenance") | Tells players beforehand: the banner and the News tab, between its "from" and "until" | Live tab |
| **Maintenance mode** | Stops the game's server for everyone but editors and admins: every request gets `503 MAINTENANCE` with your message and "back at" | Launch tab (`admin/launch.js`, [OPERATIONS.md](OPERATIONS.md) "Switches") |
| An **outage notice** (news kind "Outage") | Tells players something's wrong while it's being fixed: the banner | Live tab |
| **The status page** (`site/status.html`) | Says whether the game is up, checked from the player's browser every 30 seconds: maintenance and its message, features switched off, the database | Automatic ([OPERATIONS.md](OPERATIONS.md) "The status page") |

While maintenance mode is on, `/news` doesn't answer either (only the status, the client's settings and signing in
do), so players see the maintenance message itself, not the banner. The notice is for the time before.

## How to

### Post patch notes on a deploy

1. While the deploy waits for approval, on **Live** → **New item**: Kind **Patch notes**; **Version**: the deploy's
   commit, its first 7 characters (the build's version, as `tools/build-site.mjs` names it, so it matches exactly);
   a short title ("Faster loading, better brakes"); the changes as `- ` lines, in plain words a player knows. Leave
   Published off: it's a draft.
2. When the deploy is approved and live, edit it, tick **Published**, save.
3. Each player sees it once the first time they load the new version (if "What's new after an update" is on). A
   player coming back after several updates sees each one published since their last visit.

Publish it before players load the new version: the game notes the version as soon as it loads, so notes published
later don't open by themselves (they still count on the News button).

### Announce planned maintenance

1. A day or so ahead, **Live** → **New item**: Kind **Planned maintenance**; a title ("Maintenance on Saturday");
   the first line of the text is what the banner shows, so put the when there ("Saturday 10:00–10:30 AEST: the game
   will be offline"); Link empty (the status page) or a page with more; **Shown from** now (or when players should be
   told), **until** when the work will be done; Published.
2. At the time: **Launch** → Maintenance: the message and "back at", then **Start maintenance**.
3. Afterwards: **End maintenance**; the notice ends by itself at its "until" (or edit its end, or untick Published).

For something unplanned: Kind **Outage** with what's known and Link empty (the status page), published straight away;
unpublish or end it when it's fixed (and post a short news item if players lost anything).

### Add an event

1. **Live** → **New event**: Kind (Event, Meet, Tournament); Region if it's in one (`sf`, `adelaide`…); a title;
   About it (what, which cars, any rules); Link if there's somewhere to go (`/?track=<code>` opens a track); Starts and
   Ends (both needed); Save.
2. It's on every player's Events tab at once, and on the calendar until a day after it ends. Players who say "I'm
   going" get a reminder 15 minutes before.
3. Called off: edit it and tick **Cancelled**: it stays on the calendar, struck through, and nobody new can say
   they're going. Delete only something added by mistake.

A free-roam meet made on the **Free roam** tab is on the calendar by itself, with a `/?meet=<id>` link, which opens the game
and takes the player to the meet's spot once the real world has loaded.

## Tests

- `server/test/launch.test.ts`: only published items in their window; the calendar with who's going.
- `tests/unit/launch.test.mjs`: patch notes after an update, once; the text plain with lists, never HTML.
