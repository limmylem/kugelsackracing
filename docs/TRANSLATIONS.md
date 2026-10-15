# Translations, units and place names (Phase 8 Step 4)

How the game's words get to the screen in the player's language, in their units, with place names as they choose.
The owner chose English only for launch (with Australian, British and American spellings and formats); the code is
ready for more languages, and this file has the workflow for when the owner decides to add one. This is for anyone
adding words to the game, changing units, or preparing a translation.

## How a message is looked up

`ui/i18n.js`. Every player-facing string is a message in `locales/<language>.json`, found by its key and written in
**ICU message format**, the format Crowdin and Lokalise read:

```js
import { t, i18n } from '../ui/i18n.js';
t('settings.title')               // "Settings"
// (examples of the formats, as in ui/i18n.js's own notes)
t('garage.parts', { count: 3 })   // "{count, plural, =0 {No parts} one {# part} other {# parts}}" → "3 parts"
t('race.place', { place: 2 })     // "{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}" → "2nd"
i18n.number(1234.5) · i18n.date(d, 'medium') · i18n.time(d) · i18n.money(1500)
i18n.relative(-2, 'day') · i18n.list(['a', 'b']) · i18n.dir ('ltr' or 'rtl')
```

| ICU | What it does |
|---|---|
| `{name}` | The value as given (a number is formatted in the language's way) |
| `{n, plural, =0 {…} one {…} other {…}}` | Exact `=n` first, then the language's own plural category (`Intl.PluralRules`); `#` is the number. `offset:` works. |
| `{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` | Ordinals, by the language's rules |
| `{x, select, rain {Wet} other {Dry}}` | A choice by value |
| `{n, number}`, `{n, number, percent}`, `{n, number, integer}`, `{n, number, ::.0}` | Number formats |
| `{d, date, short\|medium\|long\|full\|datetime}`, `{d, time}` | Dates and times in the language's format |
| `''` · `'{'` | An apostrophe · a literal brace |

Every plural, ordinal and select must have `other`. A message that doesn't parse is shown as written (with a console
warning) and fails the check below. Money always shows the game's own `$`, with the language's digit grouping.

**The fallback chain**: the language's own messages (for a language with regions, its base file and then the
region's on top: `fr.json`, then `fr-CA.json`), then English (`en.json`), then the key itself.

**Static pages** use `data-i18n="key"` for an element's text and `data-i18n-attr="aria-label:key,placeholder:key"`
for attributes (`translatePage`, run by `setLanguage`); the page's own text is the fallback.

## The files

| File | What |
|---|---|
| `locales/en.json` | **The source.** Every message, in Commonwealth (Australian and British) English: colour, tyre, kerb. Flat keys, ICU values. |
| `locales/en-AU.json`, `locales/en-GB.json` | Only where Australian or British English differs from the source (now nothing: `{}`). |
| `locales/en-US.json` | **Generated** by `node tools/i18n.mjs us`: each message with American spellings and words (color, tire, curb, hood, transmission, parking lot…), only those that change. Never edit it by hand. |
| `data/languages.json` | The languages players can pick (`languages`), and the pseudo-languages for testing (`testing`). `units` there is informational: the units come from the language's region (below). |
| `data/i18n-baseline.json` | The hard-coded-string ratchet (below). |

## Which language

- **Settings → Language** (`settings.language`): `auto` (the default) or a code from `data/languages.json`, the
  testing ones included. The settings and every screen drawn after that change at once; a screen already on the page
  (the dock) changes when the page is next loaded.
- **`auto`** (`resolveLanguage` in `ui/i18n.js`) goes through the browser's languages in order: a code the game has
  exactly; English from another region → the nearest English the game has (`en-US` for the US, Puerto Rico and the
  Philippines, else `en-GB`); another language → the first listed with the same base; none → `data/languages.json`
  `default` (`en`).
- **There's no URL parameter** for the language: to try a pseudo-language, pick it in Settings → Language.
- `setLanguage` sets `<html lang>` and `<html dir>` (`rtl` for Arabic, Hebrew, Persian and Urdu). The game's screens
  read it before the settings panel is made (`testtrack/launch.js` `prepareLanguage`); the profile page reads the
  saved setting itself.

## The pseudo-languages

Two made-up languages, made from `en.json` as the game runs, to find problems before a real translation does:

- **`en-XA`, "Pseudo (long, accented)"**: every letter accented (`Séţţíñĝš`), every message a third longer with
  tildes, in square brackets. Text that stays plain English is **hard-coded** (not from `locales/`); a message whose
  closing bracket is missing is **cut off** by its box; layouts that break show where a longer language won't fit.
- **`ar-XB`, "Pseudo (right to left)"**: the English text marked right to left, with the page's `dir="rtl"`. Shows
  what mirrors and what doesn't (below). Numbers and dates stay in English's format, so it's the layout that's checked.

Use them on every new screen: pick one in Settings → Language, go through the screen, then back to Auto.

## The check and the ratchet

`tools/i18n.mjs`, run as `npm run i18n -- <command>` (or `node tools/i18n.mjs <command>`):

| Command | What |
|---|---|
| `check` (the default) | Every `t('key')` the game uses is in `locales/en.json` (a template key like ``t(`school.medal.${m}`)`` must match at least one); every message parses, plurals and selects have `other`; every listed language has only English's keys, with the same `{arguments}`; `locales/en-US.json` is up to date; and no file has more hard-coded words than its baseline. Notes messages not used anywhere. |
| `us` | Writes `locales/en-US.json` again from `en.json`. Run it after any change to `en.json`. |
| `baseline` | Writes `data/i18n-baseline.json` again from what's there now: after moving strings into `locales/`. |
| `report` | What's left to move, file by file, most first. |
| `export` | Says where the source file is (it's already in the format a translation service takes). |

**The ratchet**: `hardCoded()` counts words a player reads that aren't from `locales/` (text between tags, in
`textContent`, `title`, `placeholder`, `aria-label`, `alert()`…) in the player-facing folders (`ui`, `testtrack`,
`play`, `garage`, `account`, `site` and the rest; not `editor`, `admin`, `dev` or tests). It's rough on purpose. Each
file may only go down: new words go in `locales/en.json` and through `t()`. At launch about 725 were left (the legal pages aside), mostly in the
garage, the multiplayer screens and free roam.

**Where it runs**: `tests/unit/i18n.test.mjs` runs `check()` and fails on any problem; it's part of `npm run test:unit`,
which CI runs on every push. Run `node tools/i18n.mjs check` yourself before committing words.

**Adding words**: a key named by screen and purpose (`school.lesson.<id>.title`, `settings.tab.privacy`), the message
in `locales/en.json`, `t('the.key', { args })` in the code, then `node tools/i18n.mjs us` and `check`.

## Legal pages

The privacy policy and the terms (`account/privacy.html`, `account/terms.html`) aren't split into messages: a legal
text is translated as a whole document and each language's version checked by a lawyer, so the hard-coded-string
check leaves them out (`WHOLE_DOCUMENTS` in `tools/i18n.mjs`). The same goes for the landing page and the press kit
(`about/`, `press/`), which are English-only pages outside the game. A new language gets its own copy of each.

## Units

`ui/units.js`. Everything inside the game stays metric (SI); only what's shown changes.

- **`systemFor(locale, choice)`**: Settings → Language → Units (`settings.units`): `metric`, `imperial`, or `auto` by
  the language's region: the US, Liberia and Myanmar imperial; the UK metric with miles and mph on the road; everyone
  else metric.
- **`units({ system, locale })`** gives `speed(m/s)`, `speedKmh(kmh)`, `toKmh`, `distance`, `length`, `height`,
  `temperature`, `mass`, `pressure`, `power`, `torque`, `volume`, each `{ value, unit, text }`, and `speedUnit`.
- **`playerUnits()`**: the same for the player's saved setting and the language now, for screens that aren't handed
  the settings (the quest HUD's speed in `play/questUi.js`, the driving school's results in `play/school.js`).
- **The speedometer** (`testtrack/playerHud.js` `setSpeedUnit('mph' | 'km/h')`): set by `testtrack/test-scene.js` at
  start and after every settings change. In mph the dial tops out at 180 (220 for a fast car) instead of 280 (360).
- Not yet in the player's units: the older garage and dyno screens, and numbers written inside messages (the tutorial's
  "40 km/h", the lessons' "100 km/h").

## Place names

Settings → Language → Place names (`settings.placeNames`): **local** (OpenStreetMap's `name`, in the local language)
or **English**.

- **The bake** (`map/bake/bake.ts`) keeps OSM's `name:en` as `en` on each place (suburbs, neighbourhoods, towns) and
  city (council areas) when it differs from `name`. A region baked before this change has no `en`: bake it again
  (`node map/bake/bake.ts --region <id>`) to carry English names.
- **The game** (`map/render/game.ts`, built to `map/build/render/game.js` by `npm run map:build`) reads the setting when
  a region loads and uses `en` where there is one for "where you are" on the HUD. A change takes effect when the map
  next loads (entering a region, or reloading). The old v2 world (`testtrack/realWorld.js`, `?map=v2`) reads `en` too,
  but its bake doesn't write it.
- The maps' own labels (the minimap and full map, from the vector tiles) stay as they are.

## Adding a language with Crowdin or Lokalise

Launching more languages is the owner's decision (English only for launch, chosen 2026-10-12). When the owner
decides, this is the workflow:

1. **Pseudo-language first.** Go through every screen in `en-XA` and `ar-XB` (for a right-to-left language), and move
   what's still hard-coded on the screens that matter (`node tools/i18n.mjs report`), then `baseline`.
2. **The source file** is `locales/en.json` as it is: flat JSON keys, ICU message format (`node tools/i18n.mjs export`
   says so). In Crowdin, a "JSON" file with ICU enabled; in Lokalise, "JSON (flat)" with ICU placeholders. Upload it
   and connect the GitHub repository so the service watches it.
3. **Context**: the key names say where a message is (`settings.tab.privacy`, `school.lesson.drift-intro.text`,
   `tutorial.tyres.text`). Upload screenshots of each screen in English and tag them with the keys on them. Note in the
   service which messages are short labels (buttons, tabs) and which are sentences.
4. **Where translations land**: `locales/<code>.json` (for example `locales/fr.json`; a region, `locales/fr-CA.json`,
   only for what differs). The service opens a pull request with them; never edit those files by hand.
5. **List it**: `{ "code": "fr", "name": "Français" }` in `data/languages.json` `languages` (add `"rtl": true` for a
   right-to-left language).
6. **The check in CI**: `node tools/i18n.mjs check` fails if a translated message has keys English doesn't, different
   `{arguments}`, or doesn't parse. Plural categories are the language's own (Polish has few and many, Arabic zero,
   two, few and many): the tests already cover them (`tests/unit/i18n.test.mjs`).
7. **Review**: a native speaker plays through the first launch, the tutorial, a quest, the garage and the settings in
   the new language, and checks the terms used for car parts and driving. Messages not yet translated fall back to
   English, so a part-done language can be tested.
8. **Money**: translators and reviewers cost money (and the services' paid plans): ask the owner first, with an
   estimate.

## The right-to-left plan

**What `ar-XB` shows now.** With `dir="rtl"` on `<html>`, the text runs right to left and the new screens mirror by
themselves: `ui/a11y.css` uses logical properties (`inset-inline-start`, `margin-inline-start`,
`padding-inline-start`, `text-align: start`), so the cards, the tutorial's coach, the school, news, photo mode, the
touch controls (steering moves to the right) and the sound cues move to the other side; centred dialogs have their
own rule for `[dir="rtl"]`.

**What isn't mirrored yet:**

- **Canvases and dials**: the 3D view (rightly not mirrored), the HUD's dials and gauges (`testtrack/playerHud.js`,
  `testtrack/gauges.js`), and the minimap and full map.
- **Older screens** styled with `left`/`right` and `margin-left` (the garage, multiplayer screens, free roam, the quest
  HUD in `play/questUi.js`, `index.html`).
- **Text in canvases and numbers in mixed text** (lap times, splits) aren't isolated (`<bdi>` or `dir="ltr"`) yet.

**Steps to support Arabic or Hebrew later:**

1. Move the older screens' strings into `locales/` and their CSS to logical properties (`left` → `inset-inline-start`,
   `margin-left` → `margin-inline-start`, `text-align: left` → `start`).
2. Wrap numbers, times and player names inside sentences in `<bdi>`, and keep lap times and speeds `dir="ltr"`.
3. Decide with a native speaker what the HUD mirrors: the speedometer and rev counter usually stay as real cars have
   them; the panels round them move.
4. Check the fonts (Barlow has no Arabic or Hebrew letters): add a font for them through the same Google Fonts link.
5. Play it through in `ar-XB`, then with the real translation, as in step 7 above.
