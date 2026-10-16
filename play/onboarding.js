// The new player's first minutes (Phase 8 Step 4; docs/ONBOARDING.md):
//   1. the photosensitivity warning (ui/accessibility.js), before anything moves
//   2. play as a guest or sign in (or make an account) — or just drive, offline
//   3. pick a starter car (data/onboarding.json: the cars and their pictures; the server's chooseStarter)
//   4. a short guided drive on a real road at a recognisable place in the region (its spawn: Victoria Square in
//      Adelaide, the Embarcadero in San Francisco) — the driving tutorial (play/tutorialLogic.js): throttle, braking,
//      cornering, the racing line, what the tyres and sounds say; then the assists its driving suggests, and where to
//      change them later (Settings → Gameplay → Driver aids)
//   5. the guided first steps, each once and skippable, each when it fits: the first quest, the first repair, the first
//      part bought and fitted, the first race against NPC rivals — each a small card that points the way
// Everything can be skipped (the card's Skip, or Esc), and comes back from Settings → Gameplay ("Show the hints and
// first steps again"). What's done is kept in this browser and, with an account, on the server (/player/firsts).
//
//   const ob = createOnboarding({ game, t })   // game: below
//   ob.start()                                  // the first launch's flow, if it hasn't been done
//   ob.frame(sample, dt)                        // each frame while driving: the tutorial's progress
//   ob.event(kind)                              // 'quest' | 'repair' | 'part' | 'npcRace' | 'damaged' | 'garage' | 'map'
//
// game: { A (account), player, prefs, applyAids(aids), openSettings(tab), openMap(), toGarage(tab), travelToStart(),
//         track(kind, name, props), data: data/onboarding.json, cars: { id: { name, class } } }

import { t as tr, esc } from '../ui/i18n.js';
import { trapFocus, announce, photosensitivityWarning } from '../ui/accessibility.js';
import { createTutorial, STEPS } from './tutorialLogic.js';

const STORE = 'ognistrada.onboarding.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { return {}; } };
const save = s => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* asked again next time */ } };
export const FIRSTS = ['quest', 'repair', 'part', 'npcRace'];

export function createOnboarding({ game, t = tr }) {
  let S = load(), card = null, release = null, tutorial = null, coach = null, lastStep = null;
  const done = id => S[id] === 'done' || S[id] === 'skipped';
  const mark = (id, state) => { S[id] = state; save(S); if (id.startsWith('first:') || id === 'tutorial') report(id.replace(/^first:/, ''), state); game.track?.(id === 'tutorial' ? 'tutorial' : 'first_step', id.replace(/^first:/, ''), { state }); };
  // (with an account: the server keeps it too, and pays its small thanks for a step done)
  const report = (step, state) => { if (game.A?.me && game.A.online && (step === 'tutorial' || FIRSTS.includes(step))) game.A.api.post(`/player/firsts/${step}`, { skipped: state !== 'done' }).catch(() => {}); };

  function show(html, { onClick, label, modal = true, cls = '' }) {
    close();
    card = document.createElement('div');
    card.className = `onboardCard ${cls}`;
    card.setAttribute('role', modal ? 'dialog' : 'region');
    if (modal) card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', label);
    card.innerHTML = html;
    document.body.append(card);
    if (modal) release = trapFocus(card, { onEscape: () => onClick('skip') });
    card.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) onClick(b.dataset.a, b); });
    announce(label);
    return card;
  }
  function close() { release?.(); release = null; card?.remove(); card = null; }

  // ---------- 1–3: the first launch ----------
  async function start() {
    await photosensitivityWarning({ t });
    if (!S.welcome) await welcome();
    if (!S.starter) await pickStarter();
    if (!done('tutorial')) offerTutorial();
  }
  function welcome() {
    return new Promise(resolve => {
      const A = game.A, signedIn = !!A?.me;
      if (signedIn || !A?.server) { S.welcome = signedIn ? 'account' : 'offline'; save(S); return resolve(); }
      show(`<h2>${t('onboard.welcome.title')}</h2><p>${t('onboard.welcome.text')}</p>
        <div class="buttons"><button type="button" data-a="guest" autofocus>${t('onboard.welcome.guest')}</button>
        <button type="button" data-a="signin">${t('onboard.welcome.signIn')}</button>
        <button type="button" data-a="skip" class="quiet">${t('onboard.welcome.justDrive')}</button></div>
        <p class="small">${t('onboard.welcome.guestNote')}</p>`, {
        label: t('onboard.welcome.title'),
        onClick: a => {
          S.welcome = a; save(S); close();
          const next = encodeURIComponent(location.pathname + location.search);
          if (a === 'guest') location.href = `/account/?mode=guest&next=${next}`;
          else if (a === 'signin') location.href = `/account/?next=${next}`;
          else resolve();
        },
      });
    });
  }
  function pickStarter() {
    return new Promise(resolve => {
      const P = game.player?.profile, E = game.player?.db?.economy ?? {}, choices = (E.starterChoices ?? []).filter(id => game.cars?.[id]);
      const ids = Object.keys(P?.cars ?? {});
      // (only at the very start: one car, the starting one, nothing played)
      if (choices.length < 2 || P?.starterChosen || ids.length !== 1 || P.cars[ids[0]].carId !== E.startingCar || Object.keys(P.quests ?? {}).length) { S.starter = P?.starterChosen ?? 'kept'; save(S); return resolve(); }
      const pic = id => game.data?.starters?.[id]?.picture;
      show(`<h2>${t('onboard.starter.title')}</h2><p>${t('onboard.starter.text')}</p>
        <div class="starters" role="radiogroup" aria-label="${t('onboard.starter.title')}">${choices.map((id, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-a="car" data-id="${esc(id)}" class="starter">
          ${pic(id) ? `<img src="/${esc(pic(id))}" alt="" width="240" height="150">` : ''}<b>${esc(game.cars[id].name)}</b><small>${t(`onboard.starter.about.${id}`)}</small><small>${t('onboard.starter.class', { cls: game.cars[id].class ?? '?' })}</small></button>`).join('')}</div>
        <p class="small">${t('onboard.starter.later')}</p>`, {
        label: t('onboard.starter.title'),
        onClick: async (a, b) => {
          if (a === 'skip') { S.starter = 'kept'; save(S); close(); return resolve(); }
          if (a !== 'car') return;
          b.disabled = true;
          const r = await game.player.chooseStarter(b.dataset.id);
          if (r?.ok === false || r?.error) { announce(r.error ?? t('onboard.starter.failed')); b.disabled = false; return; }
          S.starter = b.dataset.id; save(S); close();
          game.track?.('first_step', 'starter', { car: b.dataset.id });
          resolve();
        },
      });
    });
  }

  // ---------- 4: the guided drive ----------
  function offerTutorial() {
    show(`<h2>${t('onboard.tutorial.title')}</h2><p>${t('onboard.tutorial.text')}</p>
      <div class="buttons"><button type="button" data-a="go" autofocus>${t('onboard.tutorial.go')}</button><button type="button" data-a="skip" class="quiet">${t('onboard.tutorial.skip')}</button></div>`, {
      label: t('onboard.tutorial.title'),
      onClick: async a => {
        close();
        if (a === 'skip') { mark('tutorial', 'skipped'); return; }
        await game.travelToStart?.();
        startTutorial();
      },
    });
  }
  function startTutorial() {
    tutorial = createTutorial({ aids: game.prefs?.aids ?? {} });
    lastStep = null;
    coach = document.createElement('div');
    coach.className = 'tutorialCoach'; coach.setAttribute('role', 'region'); coach.setAttribute('aria-live', 'polite'); coach.setAttribute('aria-label', t('onboard.tutorial.title'));
    document.body.append(coach);
    coach.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'skip') endTutorial('skipped');
      if (b.dataset.a === 'apply') { applyAdvice(); endTutorial('done'); }
      if (b.dataset.a === 'keep') endTutorial('done');
      if (b.dataset.a === 'settings') { game.openSettings?.('gameplay'); }
    });
    drawCoach(tutorial.update({ dt: 0, kmh: 0 }));
    game.track?.('tutorial', 'start');
  }
  function drawCoach(st) {
    if (!coach) return;
    if (st.step === lastStep && st.step !== 'assists') return;
    if (st.step !== lastStep && lastStep) game.track?.('tutorial', lastStep, { state: 'done' });
    lastStep = st.step;
    if (st.step === 'assists' || st.done) {
      const advice = tutorial.advice();
      coach.innerHTML = `<h3>${t('tutorial.assists.title')}</h3>
        ${advice.length ? `<ul>${advice.map(x => `<li>${t(`tutorial.advice.${x.why}`, { aid: t(`aids.${x.aid}.name`), on: x.on ? 'on' : 'off' })}</li>`).join('')}</ul>` : `<p>${t('tutorial.advice.none')}</p>`}
        <p>${t('tutorial.assists.where')}</p>
        <div class="buttons">${advice.length ? `<button type="button" data-a="apply">${t('tutorial.assists.apply')}</button><button type="button" data-a="keep">${t('tutorial.assists.keep')}</button>` : `<button type="button" data-a="keep">${t('common.done')}</button>`}<button type="button" data-a="settings" class="quiet">${t('tutorial.assists.open')}</button></div>`;
      return;
    }
    coach.innerHTML = `<p class="step">${t('tutorial.progress', { n: st.index + 1, of: st.of })}</p><h3>${t(`tutorial.${st.step}.title`)}</h3><p>${t(`tutorial.${st.step}.text`)}</p>
      <button type="button" data-a="skip" class="quiet">${t('onboard.tutorial.skip')}</button>`;
    announce(t(`tutorial.${st.step}.title`));
  }
  function applyAdvice() {
    const aids = { ...(game.prefs?.aids ?? {}) };
    for (const x of tutorial.advice()) aids[x.aid] = x.on;
    game.applyAids?.(aids);
  }
  function endTutorial(state) {
    mark('tutorial', state);
    coach?.remove(); coach = null; tutorial = null;
    if (state === 'done') toast(t('onboard.tutorial.finished'));
  }

  // ---------- 5: the guided first steps ----------
  // each: when it's the moment (a card, small, not in the way), and what counts as done
  const FIRST_CARDS = {
    quest: { when: ['drive', 'map'], go: () => game.openMap?.() },
    repair: { when: ['damaged'], go: () => game.toGarage?.('damage') },
    part: { when: ['garage'], go: () => game.toGarage?.('shop') },
    npcRace: { when: ['drive', 'map'], after: 'quest', go: () => game.openMap?.() },
  };
  let shownFirst = null;
  function event(kind) {
    // (a step done, whenever it happens: it's done — a card for it goes)
    if (FIRSTS.includes(kind)) { if (!done(`first:${kind}`)) { mark(`first:${kind}`, 'done'); if (shownFirst === kind) { close(); shownFirst = null; } toast(t(`first.${kind}.done`)); } return; }
    if (game.prefs?.hints === false || tutorial || card) return;
    // (the moment for one not done yet: its card — one at a time, the tutorial first)
    if (!done('tutorial')) return;
    for (const id of FIRSTS) {
      const F = FIRST_CARDS[id];
      if (done(`first:${id}`) || !F.when.includes(kind) || (F.after && !done(`first:${F.after}`))) continue;
      shownFirst = id;
      show(`<p class="step">${t('first.label')}</p><h3>${t(`first.${id}.title`)}</h3><p>${t(`first.${id}.text`)}</p>
        <div class="buttons"><button type="button" data-a="go">${t(`first.${id}.go`)}</button><button type="button" data-a="later" class="quiet">${t('common.later')}</button><button type="button" data-a="skip" class="quiet">${t('first.skip')}</button></div>`, {
        label: t(`first.${id}.title`), modal: false, cls: 'first',
        onClick: a => { close(); shownFirst = null; if (a === 'go') F.go(); if (a === 'skip') mark(`first:${id}`, 'skipped'); },
      });
      return;
    }
  }
  function toast(text) {
    const x = document.createElement('div');
    x.className = 'onboardToast'; x.setAttribute('role', 'status'); x.textContent = text;
    document.body.append(x); setTimeout(() => x.remove(), 4000);
  }
  return {
    start, event,
    // each frame while driving (a sample from the car: play/onboarding's sampleOf)
    frame(sample) { if (!tutorial) return; const st = tutorial.update(sample); drawCoach(st); if (st.done && coach && !coach.querySelector('[data-a=keep]')) drawCoach(st); },
    get tutorialRunning() { return !!tutorial; },
    startTutorial, close,
    // (Settings → "show the hints and first steps again")
    reset() { S = {}; save(S); },
    state: () => ({ ...S }),
    steps: STEPS.map(s => s.id),
  };
}

// What the tutorial and the driving school read from the car's snapshot (physics/vehicle.js)
export function sampleOf(b, dt, { origin = [0, 0], headingRad = 0 } = {}) {
  const W = b.wheels ?? [], kmh = Math.abs(b.speed ?? 0) * 3.6;
  const gripUsed = Math.max(0, ...W.filter(w => w.grounded).map(w => w.gripUsed ?? 0));
  const rear = W.filter(w => !w.front), rearSlipDeg = rear.length ? rear.reduce((a, w) => a + (w.slipAngle ?? 0), 0) / rear.length * 180 / Math.PI : 0;
  // (positions in the lesson's own frame: from its start, the car facing +z)
  const p = b.position ?? [0, 0, 0], dx = p[0] - origin[0], dz = p[2] - origin[1], c = Math.cos(headingRad), s = Math.sin(headingRad);
  return {
    dt, kmh, throttle: b.throttle ?? 0, brake: b.brake ?? 0, steer: b.steer ?? 0, yawRate: b.yawRate ?? 0, gripUsed, rearSlipDeg,
    wheelspin: W.some(w => w.grounded && w.driven && (w.slipRatio ?? 0) > 0.35 && kmh > 3),
    lockup: W.some(w => w.grounded && (w.slipRatio ?? 0) < -0.5 && kmh > 10),
    spin: kmh > 20 && Math.abs((b.yawRate ?? 0) - (b.yawExpected ?? b.yawRate ?? 0)) > 0.6,
    offRoad: W.filter(w => w.grounded).some(w => /grass|dirt|gravel|sand|mud/.test(w.surface ?? '')),
    pos: [dx * c - dz * s, dx * s + dz * c],
  };
}
