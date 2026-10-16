# The first launch, the tutorial and the driving school (Phase 8 Step 4)

What a new player meets in their first minutes: a photosensitivity warning, a choice of how to play, a starter car,
a short guided drive on a real road, then a few one-time "first steps" cards. Later, the driving school teaches one
thing at a time about how the cars behave, with medals and small rewards. This is for whoever changes any of it: what
each part does, where it's wired in, where the words and numbers live, and how to test it.

Everything can be skipped, and nothing here is needed to play.

## The order of things

`play/onboarding.js` runs it (`createOnboarding({ game, t })`, then `start()`):

| Step | What the player sees | Kept where |
|---|---|---|
| 1. Photosensitivity warning | A dialog before anything moves (`ui/accessibility.js` `photosensitivityWarning`). One button, "I understand". | `localStorage` `ognistrada.photosensitivity.v1` |
| 2. Welcome | Play as a guest, sign in (or make an account), or just drive. Only shown when signed out and a server is there. | `ognistrada.onboarding.v1` `welcome` |
| 3. Starter car | One of `data/economy.json` `starterChoices`, with a picture and a line each. | The save (`starterChosen`) |
| 4. The driving tutorial | Offered on a card: "go" or skip. | `ognistrada.onboarding.v1` `tutorial`, and the server |
| 5. Guided first steps | Small cards, one at a time, when the moment fits. | `ognistrada.onboarding.v1` `first:<step>`, and the server |

- **When it runs.** `testtrack/launch.js` `entered(w)` starts it the first time a real-world region is entered
  (Map v3, `w.stream`). Under browser automation (`navigator.webdriver`) only the warning is shown, unless the address
  has `?onboarding`.
- **The welcome.** Guest goes to `/account/?mode=guest&next=…`, sign in to `/account/?next=…`; both come back to the
  game. "Just drive" carries on without an account. Signed in already: no card.
- **Showing it all again.** Settings → Gameplay → "Show the hints and first steps again" clears
  `ognistrada.onboarding.v1` (`onboarding.reset()`), so the cards come back next time. The photosensitivity warning
  has its own button in Settings → Accessibility.
- **Keyboard and screen readers.** Each card is a dialog (`role="dialog"`, labelled) that keeps focus inside it
  (`trapFocus`); Esc is the same as Skip. Each new card or step is read out (`announce`).

## The starter car

- **The choices**: `data/economy.json` `starterChoices` (now `starter_car` and `hana_roadster`), checked against the
  cars by `garage/data.js` and the schema (`data/schemas/economy.schema.json`).
- **Their pictures**: `data/onboarding.json` `starters.<id>.picture` (studio thumbnails in `assets/thumbs/`). Their
  one-line descriptions: `onboard.starter.about.<id>` in `locales/en.json`.
- **The rule** (`garage/player/service.js` `chooseStarter`; on the server through the economy's `act`, action
  `chooseStarter` in `server/src/economy/service.ts`): once, and only while the garage still holds just the starting
  car with no quest played. Picking the starting car itself keeps it. The chosen car becomes the current car, and like
  the starting car it can't be staked in a pink-slip race.
- The card is skipped silently when there are fewer than two choices or the player has already moved on (a second
  car, a quest done). Esc keeps the starting car.

## The driving tutorial

**Where.** "Go" takes the player to the region's start place (`data/onboarding.json` `places`: Victoria Square in
Adelaide, the Embarcadero in San Francisco; a region not listed stays where the car is) and waits for the car to land
(at most 30 s). A coach panel sits top left (`.tutorialCoach`, `aria-live="polite"`), with Skip on every step.

**The steps** (`play/tutorialLogic.js` `STEPS`, measured from the car each frame by `sampleOf` in
`play/onboarding.js`). Progress counts from the start of the drive, so a step already done when it comes up passes
at once.

| Step | Done when |
|---|---|
| `throttle` | The car has reached 40 km/h |
| `braking` | Braking firmly (over 40% brake) from 35 km/h or more, down to a stop (under 2 km/h) |
| `cornering` | Two clean turns: at least about 60° of heading (1.05 rad) swept above 15 km/h, without a spin or the grip used past 1.05 |
| `line` | One of those turns taken quickly: never below 35 km/h, with more than 60% of the grip used |
| `tyres` | One second in all near the limit: grip used between 0.85 and 1.1, above 20 km/h |
| `assists` | The advice card is answered (its buttons end the tutorial) |

The words for each are `tutorial.<step>.title` and `.text` in `locales/en.json`.

**The assist advice** (`createTutorial().advice()`). Shares are of the time driven (counted as at least 10 s):

| What the drive showed | Suggests |
|---|---|
| Wheelspin more than 8% of the time, traction control off | Traction control on |
| Wheels locked more than 5% of the time, ABS off | ABS on |
| Two spins or more, stability control off | Stability control on |
| Three slides or more, countersteer help off | Countersteer on |
| A clean drive (no spins, no slides, under 1% wheelspin and lock-up) | The first of steering help, countersteer help or traction control that's on, turned off |

The card offers "Use these suggestions" (saved to the settings' driver aids), "Keep them as they are", and "Open the
settings" (Gameplay). Either way the tutorial counts as done. Settings → Gameplay → "Which aids suit my driving? (a
short drive)" runs it again from where the car is.

## The guided first steps

Four one-time steps (`FIRSTS` in `play/onboarding.js`; the server's list is `data/school.json` `firsts.steps`, which
also has `tutorial`):

| Step | Its card shows on | Counts as done when |
|---|---|---|
| `quest` | a while spent driving, or the world map opened | A quest is finished (`kr:quest` from `play/questController.js`) |
| `repair` | the car being damaged | A repair is made in the garage |
| `part` | the garage opened | A part bought new is fitted to a car |
| `npcRace` | driving or the map, after `quest` | A quest with rivals is finished |

The moments come from `testtrack/launch.js`: `drive` after 40 seconds of driving about on your own (not in a quest,
race, lesson or the tutorial), then again after each 3 more minutes if a card was put off; `map` when the world map
opens (Tab); `garage` when the garage opens (`kr:garage`, sent by `index.html`); `damaged` when the car is damaged.

- A step done counts whenever it happens, card or not, and shows a short "done" toast. A card has Go (the map, the
  garage's damage tab or shop), Later, and "Don't show this" (skipped). One card at a time, never during the tutorial,
  and none when Settings → Gameplay → "First-time hints and guided first steps" is off.
- **With an account**, each step done or skipped is sent to `POST /player/firsts/:step` (`{ skipped }`;
  `server/src/routes/launch.ts`). It's kept in `school_results` as `first:<step>`. A step done pays
  `firsts.reward` (now $200 and 50 XP) once; skipped pays nothing, and a skipped step can still be done later. The
  tutorial is reported the same way.
- A card's Go into the garage opens the tab it names (the shop for `part`, damage for `repair`).

## The driving school

Seven short lessons on the proving ground (`scenes/proving_ground.json`), each about one thing the physics really
does. Opened from the dock's **School** tile (`play/dock.js` sends `kr:school`) or the `school` action, which has no
key by default (bind one in Settings → Controls).

**How a lesson runs** (`play/school.js`): the list shows each lesson's medal and best (from `GET /player/school` when
signed in). A lesson switches to the proving ground, lays its course out from the ground's spawn (gates, cones, a stop
line, a skid-pad circle), puts the car at the start, sets the lesson's aids (put back afterwards) and, for the wet
lesson, the grip × 0.62. The panel shows what to do, the tip now and the medal targets. The rules are
`play/schoolLogic.js` `createLesson`; positions are metres from the start, the car facing +z.

| Lesson (`id`) | Topic | The task | Measure | Bronze / silver / gold | Set-up |
|---|---|---|---|---|---|
| `braking-zone` | braking | Reach 100 km/h, stop with the front wheels on the line (120 m out) | metres off the line, lower | 6 / 3 / 1.2 | ABS on |
| `threshold-braking` | braking | From 100 km/h, the shortest stop without locking | stopping distance (m), lower | 52 / 46 / 42 | ABS off |
| `cornering-line` | cornering | Six gates through hairpins, fastest time | seconds, lower | 24 / 21.5 / 20 | |
| `trail-braking` | cornering | Enter at 110 km/h, brake into the turn, exit fast | exit speed (km/h), higher | 70 / 78 / 84 | |
| `drift-intro` | drifting | Hold a slide on the 18 m circle for 30 s | seconds sliding, higher | 2 / 4 / 7 | ESC and TC off |
| `wet-control` | wet | The hairpins, soaked | seconds, lower | 30 / 27 / 25 | wet |
| `car-control` | control | A ten-cone slalom inside 40 s | cones hit, lower | 4 / 1 / 0 | |

A run fails on a missed gate, overshooting the line by 60 m, entering too slowly, or taking too long (the tips say
which). Results show in the player's units (`ui/units.js`).

**Medals and rewards** (`POST /player/school/:lesson` with `{ value }`, `server/src/routes/launch.ts`):

- The server works the medal out itself (`medalFor`, the same rule as `medalOf` in `play/schoolLogic.js`) and refuses
  a value outside the lesson's `bounds` as one no real run could measure (400). It can't see the run, so the rewards
  are kept small on purpose.
- It keeps the best medal and best value per lesson (`school_results`) and counts attempts.
- **Each medal pays once**, through `payReward` in `server/src/economy/service.ts`: money and XP to the save, written
  to the ledger as a `reward` with the key `school:<lesson>:<medal>`. Before paying, it looks for that key in the
  ledger inside the same transaction, so asking twice never pays twice. A better medal pays the difference up to its own
  reward, so a lesson's best medal has paid exactly its reward in all: bronze $150 and 40 XP; silver $300 and 80 XP
  in all (bronze, then $150 more); gold $600 and 150 XP in all, however it was reached.
  No garage yet: nothing paid, and the next run tries again.
- Offline or signed out, a run still shows its medal; nothing is kept or paid.

## Where it's wired in

- `testtrack/launch.js` `createLaunch`: builds the onboarding, the school (with `data/onboarding.json` and
  `data/school.json`), passes the game's hooks (aids, settings, the map, the garage, travelling, the proving ground),
  turns quest and garage events into first steps, and feeds the tutorial and the school a car sample each frame.
- `testtrack/test-scene.js`: makes the launch in `createShared`, calls `launch.entered(w)` when a world is entered,
  `launch.frame(...)` each frame and `launch.action(act)` for keys (photo mode, the school). The settings panel's
  "Which aids suit my driving?" and "Show the hints and first steps again" call into it.
- `play/dock.js`: the School tile. `index.html`: the account chip's own welcome is held back until the first launch's
  welcome has been answered.

## Testing it

- `tests/unit/launch.test.mjs` (`npm run test:unit`): the tutorial step by step with made-up drives and its advice;
  each lesson measured from a made-up drive, medals as the server gives them, impossible runs refused; the lesson
  frame; choosing a starter car (once, only at the start, only a listed car).
- `server/test/launch.test.ts` (`npm run test:server`, or `node --test test/launch.test.ts` in `server/` with
  `TEST_DATABASE_URL` set): medals and rewards paid once, a better medal paying the difference up to its own, impossible results refused;
  first steps paying once, skipped paying nothing and done later.
- By hand: a private window (fresh storage), enter a real-world region, go through every card with the keyboard only.
  Settings → Gameplay → "Show the hints and first steps again" to see them again.

## Changing lessons and rewards

- **Medal targets, bounds, rewards**: `data/school.json`. The server reads the file on each request, so a deploy is
  all it takes. Medals already won and rewards already paid stay as they are.
- **A new lesson**: an entry in `data/school.json` (`id`, `topic`, `measure`, `unit`, `better`, `medals`, `bounds`,
  `setup`); its rules as a `case` in `play/schoolLogic.js` `createLesson` (and a course in `COURSES` if it needs one);
  its words in `locales/en.json` (`school.lesson.<id>.title`, `.text`, `.lesson`, and `school.topic.<topic>` if new);
  then `node tools/i18n.mjs us` and `node tools/i18n.mjs check`; and a test in `tests/unit/launch.test.mjs`. Make
  `bounds` wide enough for any honest run and no wider.
- **The first steps' thanks**: `data/school.json` `firsts.reward`.
- **Starter cars**: `data/economy.json` `starterChoices`, a picture in `data/onboarding.json` `starters`, a line in
  `onboard.starter.about.<id>`.
- **The tutorial's start places**: `data/onboarding.json` `places.<region>` (`lat`, `lon`, `heading` in degrees).
- **The tutorial's steps and advice**: `play/tutorialLogic.js` (thresholds in each step's `done`, the shares in
  `advice()`), with their tests.
