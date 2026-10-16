# Photo mode, profiles and sharing (Phase 8 Step 4)

Photo mode stops the moment and gives the player a free camera, depth of field, exposure, filters, the time of day
and a short video clip. Photos can be saved, shared, or kept on the player's profile page, which also shows their
medals, best times, favourite cars and crew. Links open the game straight at a track, a time to beat, a quest, a
region or a place. This is for whoever changes any of these.

## Photo mode

`play/photoMode.js` (`createPhotoMode`), made by `testtrack/launch.js`.

**Opening it**: the `photo` action, **/** by default (`Slash` in `testtrack/input.js`; rebindable in Settings →
Controls, no gamepad button by default). The same key closes it, and so does Esc or the panel's ×. It works while
driving, in quests and races, in free roam and at meets.

**Holding still, or not** (`testtrack/test-scene.js` `frame`):

- **On your own** (no multiplayer connection, no multiplayer race): the world stops. The frame loop does nothing but
  let photo mode draw: no physics, no other cars, no quest clock.
- **Online** (free roam with others, a multiplayer race): the world can't stop for one player, so it carries on and
  other cars keep moving. Your own car is paused the way the settings panel pauses it (inputs ignored, its physics
  not stepped) while photo mode draws over the top.

**The free camera** starts where the game's camera was:

| Do | Keyboard and mouse | Gamepad |
|---|---|---|
| Move | W A S D or the arrow keys (Shift: faster) | Left stick |
| Look | Drag on the picture | Right stick |
| Down / up | Q / E | Left / right trigger |
| Zoom (field of view) | Mouse wheel | Bumpers |
| Hide the HUD | H | |

It stays within 80 m of the car (`MAX_RANGE`: "a photographer, not a spy") and no lower than 1.2 m below it.

**The panel** (a dialog; every slider labelled and read out):

| Control | Range | What it does |
|---|---|---|
| Focus distance | 1–60 m | Where the picture is sharp |
| Background blur | Sharp to 100% | Depth of field: above 0, the picture is drawn through three.js's `BokehPass` (with `EffectComposer`, `RenderPass`, `OutputPass`, loaded the first time it's used) |
| Exposure | 0.3–2.5× | The renderer's tone-mapping exposure; put back on leaving |
| Field of view | 15–100° | Also the mouse wheel and bumpers |
| Tilt | −30° to 30° | Rolls the camera |
| Time of day | 0–24 h, by quarter hours | The settings' `timeOfDay`; put back on leaving |
| Filter | None, Warm, Cool, Black and white, Sepia, Vivid, Film, Night; After Hours for its owners | `FILTERS`: a 4×5 colour matrix each, shown on screen as an SVG `feColorMatrix` filter on the canvas and applied to the saved photo's pixels (`applyFilter`), so what you see is what's saved. **After Hours** (a cool, high-contrast night grade: a violet-blue tint, greens held back, the contrast up a fifth with crushed blacks and blue shadows) is bought in the ROADBOOK's After Hours season shop ([ROADBOOK.md](ROADBOOK.md); `SHOP_FILTERS`): only players who own it see it (`filtersFor(owns)`, asking `roadbook/client.js` — loaded the first time photo mode opens, and asked again each time); with no ROADBOOK (no server, or nobody signed in) it isn't offered |
| Hide the HUD | on by default | Hides everything over the picture but photo mode's panel (faded until hovered) and, on the real-world maps, the map's credit line |

**Taking a picture** (`capture`):

- **Save photo**: a JPEG up to 2,560 px wide, named `ognistrada-<date and time>.jpg`.
- **Share**: the system's share sheet with the file where the browser has one (phones), else saved instead.
- **Add to my profile** (signed in and online only): a small copy, at most 960 px wide and 200,000 bytes (the JPEG
  quality steps down until it fits), sent to `POST /player/photos` with the region it was taken in.
- A picture of a real-world map carries a small "Map © OpenStreetMap contributors" line in its corner: OpenStreetMap's
  licence asks for it.

**A clip** (where the browser has `MediaRecorder`): the next 8 seconds of the canvas, recorded at 30 frames a second
(WebM with VP9, WebM, or MP4, whichever the browser records; 6 Mbit/s), then shared or saved like a photo. It's the
canvas alone: no HUD, no sound, and the on-screen filter isn't in it.

On your own the world holds still while photo mode is open, so the time-of-day slider relights the held moment as
you move it, and a clip is the free camera moving through that still moment (online, the world goes on). Closing
photo mode puts the time of day back as it was.

## Photos on the profile

`server/src/routes/launch.ts`, limits in `LIMITS`:

| Endpoint | What |
|---|---|
| `POST /player/photos` | `{ image (a data: URL), caption?, place? }`. JPEG or WebP only, checked by the bytes themselves (a JPEG starts `FF D8 FF`, a WebP `RIFF…WEBP`), not just the label; at most **220,000 bytes** (`photoBytes`) and **8 photos** a player (`photos`: remove one first); caption up to 120 characters, place up to 80 |
| `GET /photos/:id` | The picture. Anyone can see it while its owner's profile is public; a private profile's photos only its owner (others get "not found"). Cached privately for a day, `nosniff` |
| `DELETE /player/photos/:id` | Removes one of your own |

Kept in `player_photos` (the picture in the database itself, as `bytea`), in the player's data export (the details;
the pictures at their addresses), deleted with the account.

## The player profile page

`account/profile.html` with `account/profile.js`: your own at `/account/profile.html`, someone else's at
`/account/profile.html?id=<their id>`. Signed in only; in the player's language.

| Section | From |
|---|---|
| Name, crew tag, playing since, guest or not | The account |
| Badges | From the ROADBOOK's season shops ([ROADBOOK.md](ROADBOOK.md)): a small chip each in the season's colour (After Hours violet; the collector's badge gold), its name the tooltip — the profile's `badges` (`[{ id, name, season }]`). The garage's player card (`garage/profileCard.js`) shows them the same way, from `roadbook/client.js` |
| Level, XP, money (your own only), quests finished, cars | The save and its sessions |
| Medals | Gold, silver and bronze: quests' best medals and the driving school's ([ONBOARDING.md](ONBOARDING.md)) |
| Favourite cars | Up to 6, chosen from the cars you own (your own page) |
| The driving school | Each lesson's medal |
| Best times | The 12 most recent track records, each with a **Challenge** button that shares a time-to-beat link |
| Crew | Its name, tag and your role; members; make, join or leave (your own page) |
| Photos | The 8 newest, each removable on your own page |
| Privacy | "Public" (off until you tick it: a profile starts private), and **Share** for your profile's link |

**The endpoints**: `GET /player/profile` (your own, with money), `GET /profiles/:id` (another's; "keeps their profile
to themselves" if it's private), `PUT /player/profile` (`{ favouriteCars?, public? }`).

**Crews**: `POST /crews` (`{ name: 3–40 characters, tag: 2–5 letters or digits }`; a tag is unique whatever its case;
a full account, not a guest; one crew at a time) gives back an invite code; `POST /crews/join` (`{ code }`) joins;
`POST /crews/leave` leaves (the owner leaving hands the crew to the longest-standing member; the last one out ends
it); `GET /crews/:id` lists the members, with the invite code for its owner only.

Tests: `server/test/launch.test.ts` (photos: real JPEG or WebP only, a few each, public and private; crews: made,
joined, handed on).

## Sharing

`ui/share.js`:

- **`shareLink(L)`** makes a link to the game (`KR_SITE.game`, else this page's origin):

| Kind | Link |
|---|---|
| `track` | `/?track=<code>` |
| `challenge` | `/?track=<code>&beat=<ms>&by=<name>&class=<class>` |
| `quest` | `/?quest=<id>` |
| `region` | `/?region=<id>` |
| `meet` | `/?meet=<id>` |
| `place` | `/?at=<lat>,<lon>` (5 decimals) |

- **`readDeepLink(location.search)`** reads one back and checks it: a track code is 10–40 letters and digits; `beat`
  between 1 second and an hour; `by` at most 30 characters, no `<` or `>`; `class` one capital letter; an id
  `[A-Za-z0-9_.:-]`, at most 80; `at` a real latitude and longitude. Anything else is ignored. A track comes first,
  then quest, region, meet, then a place.
- **`share({ url, title, text })`**: the system's share sheet, else copied to the clipboard, else shown to copy by
  hand. It says which (`shared`, `cancelled`, `copied`, `shown`).

**Where links are read**:

- `?track=` (and so a challenge's track): `index.html` opens the track world with that code itself.
- Everything else: `testtrack/launch.js` reads the link once (`readDeepLink`) and acts on it when the first real-world
  region has loaded (`openLink`): a region is travelled to, a place is driven to (`MapV3.travelTo`), a quest's route is
  fetched and fast-travelled to, a meet's spot is driven to (`GET /roam/meets`). A challenge shows "a friend's time to beat" for 12 seconds, 4 seconds in.
- **Not yet**: only the profile page makes links so far (the Challenge button and the profile's own Share); there are no share buttons for
  quests, regions or places in the game yet.

Tests: `tests/unit/launch.test.mjs` (links made and read back, anything odd refused; photo filters the same on screen
and saved).
