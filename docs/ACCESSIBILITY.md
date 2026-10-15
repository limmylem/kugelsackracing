# Accessibility (Phase 8 Step 4)

How the game is made playable for more people: controls that can be held or toggled and remapped on every device,
on-screen controls, text size, high contrast, colour-blind colours, reduced motion and flashing, important sounds
shown on screen, and menus a keyboard and a screen reader can use. The settings follow the player to other devices.
This is for anyone changing the settings or a screen, and for checking a release by hand.

## The settings

`testtrack/settings.js` builds one panel of tabs. It opens with **O**, the gamepad's Menu button (button 9) or the
touch controls' Menu button; **O** or **Esc** closes it, and while it's open the car is paused.

| Tab | What's in it |
|---|---|
| Gameplay | Driver aids (and "Which aids suit my driving?", the tutorial's short drive: [ONBOARDING.md](ONBOARDING.md)), damage, crash replays, races (rubber-banding, rivals' names, quest notices, first-time hints), the session, brakes, altitude, time of day |
| Controls | The device (auto, keyboard, gamepad, wheel, touch), wheel range, deadzones and curves, rumble, **hold or toggle**, **the touch controls**, **every action rebindable** on keyboard, gamepad and wheel, reset |
| Graphics | The preset and each setting (this device's own, below) |
| Sound | Master and each group's volume, quality, and the music ([AUDIO.md](AUDIO.md) "Music") |
| Accessibility | Text size, HUD size, contrast, colours, route guides, motion, camera shake, flashing, "Show important sounds", the photosensitivity warning again |
| Language | Language, units, place names ([TRANSLATIONS.md](TRANSLATIONS.md)) |
| Privacy | Play statistics yes or no ([ANALYTICS.md](ANALYTICS.md)), show me as online |
| Notifications | News, what's new after an update, events, event reminders ([LIVE_UPDATES.md](LIVE_UPDATES.md)) |

- **Hold or toggle** (`TOGGLEABLE` in `testtrack/input.js`: throttle, brake, handbrake, clutch, half pedal). Toggle:
  one press on, the next off, on a key, a gamepad or wheel button, or a touch button. Kept in `settings.toggles`.
- **Remapping**: each action's key, gamepad and wheel binding is a button in the Controls table; press it, then the
  key or button (or move the axis). Esc cancels. "Reset controls" puts back the defaults, toggles and touch layout.
- **What doesn't follow the player**: `DEVICE_ONLY` (`graphics`, `pad`, `wheel`): each device keeps the preset its own benchmark
  chose. Everything else goes to the account (below).

## What the accessibility settings do

The `a11y` group (defaults `DEFAULT_A11Y` in `ui/accessibility.js`) is applied to the page by `applyAccessibility`
after any change:

| Setting | Values | What it changes |
|---|---|---|
| `textSize` | 0.85–1.6 | The root font size (16 px × the value) and `--text-scale`, which the new screens' text uses (`ui/a11y.css`). The HUD has its own size (`hudScale`, 0.6–1.6). |
| `contrast` | normal, high | `.a11y-contrast` on `<html>`: solid black panels, white text, white outlines on buttons, thicker focus rings. |
| `colours` | standard, deuteranopia, protanopia, tritanopia | The palette for everything colour-coded (below). |
| `motion` | auto (the system's "reduce motion"), full, reduced | `motionOf(settings)` → `{ reduced, cameraShake, motionBlur, speedEffects }`, and `.a11y-reduced-motion` (CSS animations and transitions off). |
| `cameraShake` | 0–1 | Scales the camera's shake when motion isn't reduced. |
| `flashing` | reduced (default), full | `.a11y-no-flash` stops CSS blinking (`.blink`, anything with "flash" in its class, the dash lamps); the shift light (`testtrack/playerHud.js`) and the overheat lamp (`testtrack/dashboard.js`) glow steadily. Full: nothing blinks more than three times a second (WCAG 2.3.1). |
| `visualSounds` | on, off | The sound cues (below). |

**Colour-blind palettes** (`play/palette.js` `PALETTES`): `standard`; `colourblind` (Okabe and Ito: sky blue for good,
orange for bad; used for deuteranopia and protanopia); `tritanopia` (teal against red, the route magenta);
`highContrast` (sky blue against orange at full brightness; chosen by Contrast: high, unless a colour-blind palette is
chosen). `paletteName(settings)` picks one; `applyAccessibility` also sets `--c-good`, `--c-bad`, `--c-warn`,
`--c-route` and `--c-guide` for the screens' CSS. Nothing is told apart by colour alone: a split has its sign, the
arrow its shape, a cue its word. `tests/unit/polish.test.mjs` simulates each kind of colour vision and checks the
`colourblind` palette's pairs stay apart, the `tritanopia` palette's for tritanopia, and the `highContrast` palette's
for every kind of colour vision (and that every palette has the same keys). "Route guides: More visible" (`guides: 'bold'`) makes the
arrows, gates and route line bigger and brighter.

**Reduced motion in the camera** (`testtrack/camera.js`): `update(..., motion)` takes `motionOf`'s answer. The shake
(bumps, kerbs, speed, crashes) is multiplied by `motion.cameraShake` (0 when reduced), and the chase and bonnet views
don't widen with speed when `speedEffects` is off. `testtrack/test-scene.js` also scales crash and strike shakes by
it, and draws with speed 0 when speed effects are off, which turns motion blur's streaks off.

## Screens a keyboard and a screen reader can use

- **Dialogs** (the settings, onboarding cards, the driving school, news, photo mode, the consent card, the
  photosensitivity warning) have `role="dialog"` (or `alertdialog`), a label, and `trapFocus(el, { onEscape })`:
  Tab and Shift+Tab cycle inside, Esc closes where that's allowed, and focus goes back where it was.
- **Tabs**: the settings' tabs are a `tablist`; the arrow keys, Home and End move between them. Every control has a
  `<label>`, sliders an `aria-valuetext`, help text is tied with `aria-describedby`, and the bindings table has
  headers and a caption.
- **Announcements**: `announce(text, { assertive })` speaks through one live region (`#srLive`): a new card, a
  tutorial step, a school result, a photo saved. The tutorial's coach and the school's panel are polite live regions.
- **The dock** (`play/dock.js`) is a labelled `<nav>` of buttons; its icon-font names are `aria-hidden`.
- **Focus** is always visible (`:focus-visible`, a 3 px yellow outline; 4 px in high contrast). Pages outside the
  game (the profile) start with a "Skip to the content" link.

## Touch controls

`ui/touchControls.js`, shown on a touch screen (`pointer: coarse`) or when Settings → Controls → "Show" is on. The
layout is the player's (`settings.touch`): steering as left and right buttons, a slider, or tilting the device;
pedals and steering swapped sides; size (0.7–1.5) and opacity (0.2–1). Buttons: throttle, brake, handbrake, shift
up and down, camera, back on the road, the menu. They feed `input.touch` in `testtrack/input.js`, which drives with
them while they're in use; a toggle action flips with one tap. Every button is labelled for screen readers and works
with Enter or Space.

## Sound shown on screen

`ui/soundCues.js`, with "Show important sounds" on (`a11y.visualSounds`):

- **Tyre grip**: four corners round a car outline, each filling as its tyre uses its grip, the warning colour near
  the limit, the bad colour when it slides.
- **The engine**: a word with a ⚠ when it's blown, in limp mode, overheating, damaged, or at the rev limiter.
- **Cars nearby**: an arrow at the screen's edge toward each car within 25 m (up to four), bigger and redder nearer.
- **Moments**: a word under the speed for a couple of seconds (crash, big crash). The colours come from the chosen
  palette, and every cue has a shape or a word too.

`testtrack/launch.js` feeds it each frame and on crashes.

## The photosensitivity warning

Shown once on the first launch, before anything moves (`photosensitivityWarning`; seen is kept in
`ognistrada.photosensitivity.v1`), and again from Settings → Accessibility. It says flashing is reduced by default and
where to turn off camera shake and speed effects.

## Settings that follow the player

`ui/settingsSync.js`, for a player with an account or a guest:

- Every save (`saveSettings`) is stamped (`updatedAt`, milliseconds) and sent a moment later (1.5 s; a burst of
  changes goes once) with `PUT /player/settings` (`{ data, changedAt }`; `server/src/routes/launch.ts`). The
  server drops `graphics`, refuses more than 48,000 bytes, and keeps the copy only if it's at least as new as the one
  it has; an older copy gets `{ saved: false, newer }` back, and the game takes the newer one.
- On start and on signing in, `GET /player/settings`: the newer of the two wins (the account's is merged in, this
  device's graphics, gamepad and wheel kept).
- Offline, changes wait and go when the connection's back. The panel's header says which: saved on this device,
  saving, saved to your account, or offline.
- Stored in `player_settings` (`server/drizzle/0016_launch.sql`), in the player's data export, deleted with the
  account.

## Checking it

By hand, before a release (on the deployed game, a fresh browser profile):

1. **Keyboard only**: from the first launch to a quest and back, without the mouse. Every card, the settings (all
   tabs, a rebind, Esc), the school, news and photo mode reachable; focus always visible; Esc never traps.
2. **Screen reader** (NVDA with Firefox or Chrome, VoiceOver with Safari): the cards and dialogs read their titles,
   the settings' controls read their names and values, a tutorial step and a school result are announced.
3. **200% text**: browser zoom 200%, and the Text size slider at its top. Nothing cut off or overlapping in the new
   screens.
4. **High contrast**: every new panel solid black with white text and outlined buttons.
5. **Each colour-blind mode**: splits, the route, gates, the sound cues' tyres, in each mode; with a simulator (the
   browser's developer tools' vision emulation) the good and bad colours still look different.
6. **Reduced motion**: set the system's "reduce motion" with Motion on "As my system is set", then on "Reduced": no
   camera shake on kerbs or crashes, no widening at speed, no motion blur, menus that don't slide.
7. **Flashing reduced**: nothing on screen flashes more than three times a second.
8. **Touch**: a phone, each steering kind, swapped sides, toggles.

## Known gaps

- **Hard-coded English**: about 725 player-facing strings, mostly in older screens (the garage, multiplayer screens,
  free roam, the quest HUD, `index.html`), aren't in `locales/` yet (`data/i18n-baseline.json`;
  [TRANSLATIONS.md](TRANSLATIONS.md)). Many of those screens also have fixed pixel font sizes, so the Text size setting
  doesn't reach them (the HUD has its own size slider).
- **Canvases without text alternatives**: the 3D view, the minimap and full map (MapLibre's canvases,
  `map/render/maps.ts`), the gauges (`testtrack/gauges.js`). The driving HUD (`testtrack/playerHud.js`) is
  `aria-hidden`, so speed, gear, revs and where you are aren't read out. `index.html` itself has no landmarks or
  labels outside the dock.
- **Sound cues**: crashes and gears grinding are sent as moments; lock-ups and the limiter show on the tyre corners
  and the engine line instead. The words for a puncture, a blow-off, a kerb and a horn exist (`cues.event.*`) but
  nothing sends them yet.
- **The news panel's tabs** don't move with the arrow keys (Tab and Enter work).
- **The tutorial's and lessons' texts** say km/h in words, whatever the units setting.
