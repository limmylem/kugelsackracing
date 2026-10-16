// Phase 8 Step 4 in the game (docs/ONBOARDING.md, ACCESSIBILITY.md, TRANSLATIONS.md, PHOTO_MODE.md, ANALYTICS.md): what
// the test worlds' scene (testtrack/test-scene.js) hands to the new parts, so it only needs a few calls —
//   the language and accessibility, from the settings · the touch controls · the important sounds shown (sound cues)
//   · the settings following the player (ui/settingsSync.js) · anonymous statistics with consent (ui/analytics.js)
//   · the first launch, the driving tutorial and the guided first steps (play/onboarding.js) · the driving school
//   (play/school.js) · the music (audio/music.js) · photo mode (play/photoMode.js) · links that open the game at
//   something (ui/share.js)
//
//   const L = await prepareLanguage(prefs)                       // before the settings panel is made
//   const launch = createLaunch(shared, ctx)                     // ctx: below
//   launch.frame(w, snapshot, seconds) · launch.action(act) → handled · launch.settingsChanged() · launch.audioStarted(A)
//   launch.entered(w) (a world entered) · launch.drawFrame(w, seconds) → true when photo mode drew the frame
// ctx: { THREE, renderer, active() (the world now), switchTo(file), MapV3, regionId(w), worldContent(), player, A? }

import { setLanguage, loadLanguages, t, i18n } from '../ui/i18n.js';
import { applyAccessibility, a11yOf, motionOf } from '../ui/accessibility.js';
import { createTouchControls } from '../ui/touchControls.js';
import { createSoundCues } from '../ui/soundCues.js';
import { startSettingsSync } from '../ui/settingsSync.js';
import { startAnalytics, askConsent } from '../ui/analytics.js';
import { readDeepLink } from '../ui/share.js';
import { createOnboarding, sampleOf } from '../play/onboarding.js';
import { createSchool } from '../play/school.js';
import { createPhotoMode } from '../play/photoMode.js';
import { createMusic, raceIntensity } from '../audio/music.js';
import { paletteOf } from '../play/palette.js';
import { paletteName } from '../ui/accessibility.js';
import { saveSettings } from './settings.js';

const getJson = p => fetch(p, { cache: 'no-cache' }).then(r => r.json());
let lastLanguage = null;
export async function prepareLanguage(prefs) {
  const L = await loadLanguages('/').catch(() => null);
  lastLanguage = prefs.language ?? 'auto';
  await setLanguage(lastLanguage).catch(e => console.warn(`The game's words: ${e.message}`));
  applyAccessibility(prefs);
  return L;
}

export function createLaunch(s, ctx) {
  const prefs = s.prefs, { THREE, renderer } = ctx;
  const out = {};
  // ---------- touch controls and the sound cues ----------
  const touch = createTouchControls(s.input, prefs, { t });
  document.body.append(touch.el);
  const cues = createSoundCues({ t, palette: () => paletteOf(paletteName(prefs)) });
  cues.el.hidden = !a11yOf(prefs).visualSounds;
  document.body.append(cues.el);
  // ---------- statistics, with consent (asked once, after the first steps or a few minutes in) ----------
  const stats = startAnalytics({ settings: prefs, tier: () => s.G?.preset ?? null });
  let asked = false, perfAt = 0;
  function maybeAskConsent() {
    if (asked || prefs.privacy?.analytics != null || document.querySelector('.onboardCard, .a11yDialog, .tutorialCoach')) return;
    asked = true;
    askConsent({ t, onAnswer: v => { prefs.privacy = { ...(prefs.privacy ?? {}), analytics: v }; saveSettings(prefs); stats.consent(v); } });
  }
  // (a generated track's run goes through the same quest machinery: it's counted as a track — the admin's "Tracks played")
  addEventListener('kr:questStart', e => { const q = e.detail.quest; if (q.track) stats.track('track_start', q.track, { type: q.type, rivals: q.rivals }); else stats.track('quest_start', q.id, { type: q.type, rivals: q.rivals }); });
  addEventListener('kr:quest', e => {
    const d = e.detail;
    stats.track(d.quest.track ? 'track_end' : 'quest_end', d.quest.track ?? d.quest.id, { result: d.status, medal: d.medal ?? 'none', type: d.quest.type });
    if (d.quest.rivals) stats.track('race_end', d.quest.track ?? d.quest.id, { result: d.status, place: d.place ?? null });
    if (d.status === 'finished') { onboarding.event('quest'); if (d.quest.rivals) onboarding.event('npcRace'); }
  });
  // ---------- the settings, following the player (with an account) ----------
  let sync = null;
  const accountReady = import('../account/session.js').then(({ account }) => account()).then(A => {
    out.A = A;
    sync = startSettingsSync({ A, settings: prefs, apply: () => { s.panel?.render?.(); out.settingsChanged(); } });
    return A;
  }).catch(() => null);   // (no server: settings stay on this device)
  // ---------- the first launch, the tutorial, the first steps ----------
  let data = { starters: {}, places: {} }, lessons = [], rewards = {};
  const ready = Promise.all([getJson('data/onboarding.json').then(d => { data = d; }), getJson('data/school.json').then(d => { lessons = d.lessons; rewards = d.rewards; })]).catch(() => {});
  const game = {
    get A() { return out.A ?? null; }, get player() { return s.session.player; }, get prefs() { return prefs; }, get data() { return data; },
    get cars() { return Object.fromEntries(Object.entries(s.session.db.cars).map(([id, c]) => [id, { name: c.name, class: c.class }])); },
    applyAids(aids) { Object.assign(prefs.aids, aids); saveSettings(prefs); s.panel?.render?.(); },
    openSettings(tab) { s.panel.show(tab); },
    openMap() { s.input?.pressedKeys?.add?.('Tab'); },
    toGarage(tab) { ctx.toGarage?.(tab); },
    async travelToStart() {
      const w = ctx.active();
      if (!w?.stream) return;
      const region = ctx.regionId(w), p = data.places?.[region];
      if (p) ctx.MapV3.travelTo(w, { lat: p.lat, lon: p.lon, heading: p.heading ?? 0 });
      const t0 = performance.now();
      await new Promise(res => { const tick = () => (!w.spawning || performance.now() - t0 > 30000) ? res() : setTimeout(tick, 100); tick(); });
    },
    track: (kind, name, props) => stats.track(kind, name, props),
  };
  const onboarding = createOnboarding({ game, t });
  // (the guided first steps' moments: the car damaged, the garage, the map)
  s.session.player.on(({ what }) => {
    if (what === 'repair') onboarding.event('repair');
    const P = s.session.player.profile;
    if ((what === 'install' || what === 'build' || what === 'buy') && Object.values(P?.parts ?? {}).some(x => x.boughtAt && x.installedOn)) onboarding.event('part');
    if (what === 'damage') onboarding.event('damaged');
    if (what === 'repair') stats.track('repair');
    if (what === 'buy') stats.track('purchase');
  });
  // ---------- the driving school ----------
  let school = null, provingSpawn = null, savedAids = null, savedSurface = null;
  const schoolGame = {
    scene: () => ctx.active().scene,
    api: null,
    async enterProving() { if (ctx.active()?.file !== 'scenes/proving_ground.json') await ctx.switchTo('scenes/proving_ground.json'); provingSpawn ??= (await getJson('scenes/proving_ground.json')).spawn; },
    start() { const w = ctx.active(), p = provingSpawn?.position ?? [0, 0, 0], h = (provingSpawn?.headingDeg ?? 0) * Math.PI / 180; return { origin: [p[0], p[2]], heading: h, y: w.heightAt?.(p[0], p[2]) ?? 0 }; },
    resetCar({ position, headingDeg }) { const w = ctx.active(); w.sim.resetCar({ position: [position[0], (w.heightAt?.(position[0], position[2]) ?? 0) + (w.sim.vehicle.spec.spawnHeight ?? 0.6), position[2]], headingDeg }); w.rig.reset(); },
    setAids(aids) { savedAids ??= { ...prefs.aids }; if (aids) Object.assign(prefs.aids, aids); },
    restoreAids() { if (savedAids) Object.assign(prefs.aids, savedAids); savedAids = null; },
    setWet(on) {
      const v = ctx.active()?.sim?.vehicle;
      if (!v) return;
      if (on) { savedSurface ??= { fn: v.surfaceAt }; const base = savedSurface.fn; v.surfaceAt = (x, z) => { const S = base?.(x, z) ?? { name: 'asphalt', grip: 1 }; return { ...S, grip: (S.grip ?? 1) * 0.62, name: 'wet' }; }; }
      else if (savedSurface) { v.surfaceAt = savedSurface.fn; savedSurface = null; }
    },
    track: (kind, name, props) => stats.track(kind, name, props),
  };
  async function openSchool() {
    await ready;
    school ??= createSchool({ THREE, game: schoolGame, lessons, rewards, t });
    schoolGame.api = out.A?.me && out.A.online ? out.A.api : null;
    school.open();
  }
  // ---------- photo mode ----------
  const photo = createPhotoMode({
    THREE, renderer, t,
    game: {
      scene: () => ctx.active().scene, camera: () => ctx.active().camera,
      target: () => { const p = ctx.active()?.car?.position; return p ? [p.x, p.y, p.z] : null; },
      hours: () => prefs.timeOfDay ?? 13, setHours: h => { prefs.timeOfDay = h; },
      pause: on => { s.photoPaused = !!on; },
      render: (scene, camera) => s.gfx.render(ctx.active().fxDraw, scene, camera, { speed: 0 }),
      get api() { return out.A?.me && out.A.online ? out.A.api : null; },
      place: () => ctx.regionId(ctx.active()) ?? undefined,
      track: (kind, name, props) => stats.track(kind, name, props),
    },
  });
  // ---------- music ----------
  let music = null;
  // ---------- links that open the game at something ----------
  const link = readDeepLink(location.search);
  let linkDone = !link || link.kind === 'track' || link.kind === 'challenge';
  async function openLink(w) {
    if (linkDone || !w?.stream) return;
    linkDone = true;
    try {
      if (link.kind === 'region') await ctx.travelToRegion?.(link.id);
      else if (link.kind === 'place') ctx.MapV3.travelTo(w, { lat: link.lat, lon: link.lon, heading: 0 });
      else if (link.kind === 'quest') { const item = await ctx.routeItem?.(link.id); if (item) await ctx.fastTravel?.(item); }
      // (a car meet, from the calendar: its spot, as the free-roam panel's Go — GET /roam/meets)
      else if (link.kind === 'meet') {
        const meets = (await (await accountReady)?.api?.get('/roam/meets'))?.events ?? [];
        const m = meets.find(e => e.meetId === link.id || e.id === link.id);
        if (m?.place?.lat != null) ctx.MapV3.travelTo(w, { lat: m.place.lat, lon: m.place.lon, heading: 0 });
      }
      stats.track('share', `open:${link.kind}`);
    } catch (e) { console.warn(`The link: ${e.message}`); }
  }
  // (a time to beat, from a friend's link: shown while on that track)
  if (link?.kind === 'challenge') {
    const note = document.createElement('div');
    note.className = 'onboardToast'; note.setAttribute('role', 'status');
    const ms = link.ms, txt = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    note.textContent = t('share.beat', { by: link.by ?? t('share.aFriend'), time: txt, cls: link.carClass ?? 'none' });
    setTimeout(() => { document.body.append(note); setTimeout(() => note.remove(), 12000); }, 4000);
  }

  addEventListener('kr:school', () => openSchool());
  // the ROADBOOK's journal (ui/roadbook.js; docs/ROADBOOK.md): the dock's tile, kr.roadbook.show()
  addEventListener('kr:roadbook', () => { import('../ui/roadbook.js').then(m => m.roadbookOpen() ? m.closeRoadbook() : m.openRoadbook()).catch(e => console.error(e)); screen('roadbook'); });
  // (the guided first steps' moments: the garage opened (index.html), the world map opened, a while spent driving)
  addEventListener('kr:garage', () => { onboarding.event('garage'); screen('garage'); });
  // (the screen the player is on: counted when it changes, and sent as where they were if they leave — ui/analytics.js)
  const screen = name => { if (name && stats.screen !== name) { stats.screen = name; stats.track('screen', name); } };
  let drivenFor = 0, nextFirstAt = 40, settingAt = null, lastSetting = null;
  let started = false, lastMotion = null;
  Object.assign(out, {
    stats, photo, onboarding, cues, touch,
    syncStatus: () => sync?.status() ?? 'local',
    consent: v => stats.consent(v),
    tutorial: () => onboarding.startTutorial(),
    openSchool,
    // a world entered: the first launch's flow once (in the real world), a link, the touch controls
    async entered(w) {
      touch.show(true);
      screen(w?.file?.split('/').pop()?.replace(/\.json.*$/, '') ?? 'world');
      if (!started && w?.stream) {
        started = true;
        await ready;
        // (the first launch's screens, the warning first; a browser driven by a test skips them unless it asks with
        // ?onboarding — tools/first-launch-browser.mjs — so the other tests' cars aren't held up behind a card)
        if (!navigator.webdriver || new URLSearchParams(location.search).has('onboarding')) onboarding.start().then(() => setTimeout(maybeAskConsent, 120_000));
      }
      openLink(w);
    },
    exited() { touch.show(false); school?.end(); },
    settingsChanged() {
      applyAccessibility(prefs);
      // (the statistics: which accessibility and language choices are in use — sent when they change, a few seconds on)
      clearTimeout(settingAt); settingAt = setTimeout(() => {
        const A = a11yOf(prefs), now = JSON.stringify({ text: A.textSize, contrast: A.contrast, colours: A.colours, motion: A.motion, flashing: A.flashing, cues: !!A.visualSounds, units: prefs.units ?? 'auto', language: prefs.language ?? 'auto', toggles: Object.values(prefs.toggles ?? {}).some(Boolean) });
        if (now !== lastSetting) { lastSetting = now; stats.track('setting', 'accessibility', JSON.parse(now)); }
      }, 5000);
      if ((prefs.language ?? 'auto') !== lastLanguage) { lastLanguage = prefs.language ?? 'auto'; setLanguage(lastLanguage).then(() => s.panel?.render?.()); }
      touch.apply();
      cues.el.hidden = !a11yOf(prefs).visualSounds;
      music?.apply(prefs);
      lastMotion = motionOf(prefs);
    },
    get motion() { return lastMotion ??= motionOf(prefs); },
    audioStarted(A) { music ??= createMusic(A, { settings: prefs }); out.music = music; globalThis.__krMusic = music; },
    action(act) {
      if (act === 'worldMap') { onboarding.event('map'); return false; }
      if (act === 'photo') { if (photo.on) photo.close(); else photo.open(); return true; }
      if (act === 'school') { openSchool(); return true; }
      return false;
    },
    // each frame: the cues, the tutorial and school, the music, the statistics' frame rate now and then
    frame(w, b, seconds) {
      const P = prefs;
      if (a11yOf(P).visualSounds && b) {
        const others = [...(w.others?.values?.() ?? [])].map(o => o.group?.position ?? o.car?.position).filter(Boolean).map(p => ({ position: [p.x, p.y, p.z] }));
        const me = w.car ? { position: [w.car.position.x, w.car.position.y, w.car.position.z], heading: new THREE.Euler().setFromQuaternion(w.car.quaternion, 'YXZ').y } : null;
        cues.update(b, { others, me, dt: seconds, redline: s.spec?.engine?.redlineRpm });
      }
      if (b && (onboarding.tutorialRunning || school?.running)) {
        const sample = sampleOf(b, seconds, school?.running && provingSpawn ? { origin: [provingSpawn.position[0], provingSpawn.position[2]], headingRad: (provingSpawn.headingDeg ?? 0) * Math.PI / 180 } : {});
        if (onboarding.tutorialRunning) onboarding.frame(sample);
        if (school?.running) school.frame(sample);
      }
      // the music: a race's (building at the end and when it's close), the menus' while one is open, else none
      if (music) {
        const racing = !!(w.quests?.active || s.mpRace?.racing);
        const menu = s.panel?.open || !!document.querySelector('.onboardCard:not(.first), .schoolList, #newsPanel:not([hidden])');
        music.play(racing ? 'race' : menu ? 'menu' : null);
        if (racing) { const R = w.quests?.raceInfo?.() ?? s.mpRace?.raceInfo?.() ?? {}; music.setIntensity(raceIntensity(R)); }
      }
      // (driving about on your own for a while — not a quest, race or lesson: the moment for the next first step's card;
      // asked again after a few minutes more if it was put off)
      if (b && Math.abs(b.speed ?? 0) * 3.6 > 15 && !w.quests?.active && !s.mpRace?.racing && !school?.running && !onboarding.tutorialRunning) {
        drivenFor += seconds;
        if (drivenFor >= nextFirstAt) { nextFirstAt = drivenFor + 180; onboarding.event('drive'); }
      }
      if (stats.allowed && performance.now() - perfAt > 60_000) { perfAt = performance.now(); const pf = s.prof?.summary?.() ?? {}; stats.track('perf', w.file?.split('/').pop() ?? null, { fps: Math.round(s.fps), low1: pf.low1PctFps ?? null, preset: s.G?.preset ?? null }); }
    },
    // photo mode draws the frame (the world held still, single-player)
    drawFrame(w, seconds) { return photo.on ? photo.frame(seconds) : false; },
    crash(strength) { if (a11yOf(prefs).visualSounds) cues.event(strength > 8 ? 'bigCrash' : 'crash'); },
    cue(kind) { if (a11yOf(prefs).visualSounds) cues.event(kind); },
  });
  out.settingsChanged();
  return out;
}
