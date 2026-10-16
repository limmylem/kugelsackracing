# Release requirements (Phase 8 Step 4)

What has to be in place for players and the public before the game opens to everyone: the age rating question,
credits and licences, the terms and privacy policy, the landing page and the press kit. The owner's choices
(2026-10-12): **web only** (no app stores or consoles); **the owner drafts, a lawyer reviews** anything legal; English
only; our own music; our own statistics. Nothing here costs money except the lawyer.

The checklist that tracks all of it is [LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md).

## Age rating — a legal decision for the owner and the lawyer

**The owner's decision (2026-10-16): 13+.** The game is for players aged 13 and over — the same as its minimum age
(`minAge`: 13), the terms ("Who can play") and the privacy policy ("Children"). The landing page and the press kit say
so. What follows is for the lawyer: whether a formal rating (IARC) is also needed in Australia.

The game is web-only, so no store asks for a rating. Whether a free browser game needs one is a question for the
lawyer. The facts to take to them:

- **Australia** (where the owner and the first players are): the National Classification Scheme covers computer
  games, and online games can be classified through the IARC tool (the International Age Rating Coalition), which the
  Classification Board accepts. Ask: does a free game played in a browser, from an Australian operator, need a
  classification, and if so, is an IARC rating enough?
- **Elsewhere**: PEGI (Europe), ESRB (North America) and USK (Germany) rate through IARC for digital games too. None
  of them requires a rating for a website in itself; storefronts do.
- **What a rating would look at in this game**: no blood, gore, drugs, gambling or sexual content; car crashes with
  dents and broken parts but no people hurt (there are no people in the cars or on the streets); online text chat
  (filtered, with mute and report) and other players' names; no purchases. A self-assessment would likely land at
  the lowest bands (PEGI 3 or 7, ESRB Everyone, Australia G or PG), with an "online interactions" notice — the
  rating body decides, not us.
- **The game's own minimum age** is a separate setting (`minAge`, 13 now): see [PRIVACY_DATA.md](PRIVACY_DATA.md),
  "The minimum age". It follows the privacy laws (COPPA, GDPR article 8, the UK's Children's Code), not the rating.
- **Photosensitivity**: the warning shows on first launch and is in the terms ("Health warning"); flashing is reduced
  by default ([ACCESSIBILITY.md](ACCESSIBILITY.md)).

**To do (owner):** ask the lawyer the questions above with the terms and privacy review. If a rating is needed,
IARC's questionnaire is free and takes about half an hour.

## Credits and licences

- **The credits screen** (`/account/credits.html`, from `account/credits.json`, written by `npm run credits` —
  `tools/credits.mjs`): the people (`data/credits-people.json`: names as each person wants them, nobody listed
  without saying yes, no emails), every open data source by region, the map tools, the libraries the browser loads,
  the fonts, what was made for the game (cars, sounds, tracks, **the music**, the words), and every package the server
  runs with its licence. CI fails if it's out of date (`npm run credits -- --check`).
- **The music** is composed by the game itself, live (`audio/music.js`; [AUDIO.md](AUDIO.md#music)): no samples, no
  recordings, nobody else's music. That makes it the project's own work, safe for streams and videos.
- **Map data**: OpenStreetMap (ODbL) and Overture Maps — the credit line shows on the map, and on every photo of a
  real place saved from photo mode ([PHOTO_MODE.md](PHOTO_MODE.md)).
- **Cars**: no real makes, models or brands, anywhere. The car models' origin is still on the checklist to confirm.
- **Open questions** (on the checklist): self-hosting Google Fonts and jsDelivr ([PRIVACY_DATA.md](PRIVACY_DATA.md),
  question 4).

## Terms and privacy policy — drafts for the lawyer

`account/terms.html` and `account/privacy.html` are drafts, marked as drafts on the page. Phase 8 Step 4 added: the
play statistics (consent, what's sent, 400 days; `#statistics`), settings kept with the account, profiles (private
until the player makes them public), photos, crews, event RSVPs, and a health warning in the terms. Words in
[square brackets] are for the owner to fill in (their legal name, address, contact, governing law). The reviewer's
questions are in [PRIVACY_DATA.md](PRIVACY_DATA.md#open-questions-for-the-reviewer), now including the statistics.

When the lawyer's version comes back: replace the drafts, take the "DRAFT" notice off, give each a new version date —
and set `termsVersion` and `privacyVersion` in `server/config/production.json` to them: players are asked to
accept the new terms the next time they play.

## The landing page

`/about/` (`about/index.html`, styles `press/site.css`): what the game is, what you can do in it, four screenshots, how
it's made for everyone, what it needs, and Play / Sign up. Plain HTML and CSS, no scripts, so it loads fast and works
everywhere; English only (outside the game, like the legal pages). Linked from the press kit and the account page's
footer. Its Open Graph tags give link previews a picture (`/press/shots/drive-sf.jpg`).

## The press kit

`/press/` (`press/index.html`): a fact sheet, the game in a sentence and a paragraph, the features, the screenshots,
the logo (`press/logo.svg`, `press/logo.png`), the video plan, credits, and contact (the support form — no email
address is published). The developer is credited as Zane Darley (the owner's choice, 2026-10-16), on the press kit and the credits screen.

- **Screenshots** are taken from the game by `node tools/press-shots.mjs` (writes `press/shots/*.jpg` and
  `shots.json`): driving in San Francisco and Adelaide, photo mode, the accessibility settings, the driving school.
  This computer has no graphics card, so they're drawn by a software renderer; on a computer with one,
  `node tools/press-shots.mjs --gpu` makes nicer ones. Run it again after a visible change.
- **The logo PNG** is drawn from the SVG in a browser with its fonts (`tools/press-shots.mjs --logo`).
- **The trailer** (`assets/press/ognistrada-trailer.mp4`, 1920×1080, about 50 seconds; on the press kit and the
  landing page, served from the tiles' address like the map files): made from the game itself by
  `cd devlog && node trailer/make.mjs` —
  - **filmed** by the devlog's capture (`devlog/capture/capture.mjs`, frame by frame, so it's smooth on a computer
    without a graphics card): Adelaide, San Francisco, Monaco and the Stelvio Pass driven along real roads by the
    game's autopilot (the routes the tests drive, `tests/map/realRoutes.ts`), then a race track from several cameras
    and a second car online (`devlog/trailer/shots.json`);
  - **the music**: the game's own race music (`audio/music.js`), rendered offline to the trailer's plan — calm under
    the title, building through the cities, flat out on the tracks — under the game's own engine and tyre sound;
  - **cut** by `devlog/remotion/Trailer.jsx` (the timeline and captions: `devlog/remotion/trailerPlan.js`): the logo
    and "In your browser · Free", each city named, the map's credit while a real place is on screen, an end card with
    ognistrada.com, "Closed beta · Rated 13+".
  - Filming takes about an hour here; `--reuse-clips` re-cuts or re-scores without filming again. Change the shots in
    `devlog/trailer/shots.json`, the words in `trailerPlan.js`. On a computer with a graphics card it looks better.
