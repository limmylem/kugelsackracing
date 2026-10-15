// The driving school (Phase 8 Step 4; docs/ONBOARDING.md): short lessons on the proving ground, one thing each about how
// the cars really behave — braking zones, threshold braking without ABS, cornering on the line, trail braking, a first
// drift, a wet course, car control through a slalom — with bronze, silver and gold (data/school.json) and a small reward
// for each medal the first time (the server's: POST /player/school/:lesson). The lesson's rules are play/schoolLogic.js;
// this lays its course out (gates, cones, a stop line, a skid-pad circle), puts the car at its start with the lesson's
// aids, shows what to do, and hands the result in.
//
//   const school = createSchool({ THREE, game, lessons, t })
//   game: { scene(), enterProving() (to the proving ground), start() → { origin: [x, z], heading, y } (its spawn),
//           resetCar({ position, headingDeg }), setAids(aids) / restoreAids(), setWet(on), api, track() }
//   school.open() (the lesson list) · school.begin(id) · school.frame(sample) · school.end()

import { t as tr, esc, i18n } from '../ui/i18n.js';
import { trapFocus, announce } from '../ui/accessibility.js';
import { createLesson, medalOf } from './schoolLogic.js';
import { playerUnits } from '../ui/units.js';

const MEDAL_ICON = { gold: '🥇', silver: '🥈', bronze: '🥉' };

export function createSchool({ THREE, game, lessons, rewards = {}, t = tr }) {
  let list = null, release = null, run = null, hud = null, results = {};
  const group = new THREE.Group();
  group.name = 'drivingSchool';
  const mat = c => new THREE.MeshBasicMaterial({ color: c });
  const at = (start, [x, z]) => { const c = Math.cos(start.heading), s = Math.sin(start.heading); return [start.origin[0] + x * c + z * s, start.origin[1] - x * s + z * c]; };
  function lay(lesson, start) {
    group.clear();
    const L = lesson.layout, y = start.y ?? 0;
    for (const g of L.gates) {
      const [cx, cz] = at(start, g.at);
      for (const side of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.4, 8), mat(0xffd400)); p.position.set(cx + side * g.width / 2 * Math.cos(start.heading), y + 1.2, cz - side * g.width / 2 * Math.sin(start.heading)); group.add(p); }
    }
    for (const c of L.cones) { const [cx, cz] = at(start, c); const m = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 10), mat(0xff6a00)); m.position.set(cx, y + 0.35, cz); group.add(m); }
    if (L.line) { const [cx, cz] = at(start, [0, L.line.z]); const m = new THREE.Mesh(new THREE.BoxGeometry(10, 0.02, 0.5), mat(0xffffff)); m.position.set(cx, y + 0.02, cz); m.rotation.y = start.heading; group.add(m); }
    if (L.circle) { const [cx, cz] = at(start, L.circle.at); const m = new THREE.Mesh(new THREE.RingGeometry(L.circle.r - 0.25, L.circle.r + 0.25, 64), mat(0xffffff)); m.rotation.x = -Math.PI / 2; m.position.set(cx, y + 0.02, cz); group.add(m); }
    game.scene().add(group);
  }
  async function refresh() { try { const r = await game.api?.get('/player/school'); for (const l of r?.lessons ?? []) results[l.id] = l; } catch { /* offline: the list without medals */ } }

  async function open() {
    await refresh();
    close();
    list = document.createElement('div');
    list.className = 'schoolList'; list.setAttribute('role', 'dialog'); list.setAttribute('aria-modal', 'true'); list.setAttribute('aria-labelledby', 'schoolTitle');
    list.innerHTML = `<div class="head"><h2 id="schoolTitle">${t('school.title')}</h2><button type="button" class="close" data-a="close" aria-label="${t('common.close')}">×</button></div>
      <p>${t('school.intro')}</p><ol>${lessons.map(l => {
        const r = results[l.id], m = r?.medal && r.medal !== 'none' ? r.medal : null;
        return `<li><button type="button" data-a="begin" data-id="${esc(l.id)}"><b>${t(`school.lesson.${l.id}.title`)}</b> <small>${t(`school.topic.${l.topic}`)}</small>
          <span class="medal">${m ? `${MEDAL_ICON[m]} ${t(`school.medal.${m}`)}` : t('school.noMedal')}${r?.best != null ? ` · ${t('school.best', { value: fmt(l, r.best) })}` : ''}</span></button></li>`;
      }).join('')}</ol>`;
    document.body.append(list);
    release = trapFocus(list, { onEscape: close });
    list.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'close') close(); if (b.dataset.a === 'begin') { close(); begin(b.dataset.id); } });
  }
  function close() { release?.(); release = null; list?.remove(); list = null; }
  const fmt = (l, v) => l.unit === 's' ? `${i18n.number(v, { maximumFractionDigits: 1 })} s` : l.unit === 'km/h' ? playerUnits().speedKmh(v).text : l.unit === 'm' ? playerUnits().length(v).text : i18n.number(v);

  async function begin(id) {
    const def = lessons.find(l => l.id === id);
    if (!def) return;
    await game.enterProving?.();
    const start = game.start();
    const lesson = createLesson(def);
    lay(lesson, start);
    game.resetCar({ position: [start.origin[0], start.y ?? 0, start.origin[1]], headingDeg: start.heading * 180 / Math.PI });
    game.setAids?.(def.setup?.aids ?? null);
    game.setWet?.(def.setup?.weather === 'wet');
    run = { def, lesson, start, t: 0 };
    hud?.remove();
    hud = document.createElement('div');
    hud.className = 'schoolHud'; hud.setAttribute('role', 'region'); hud.setAttribute('aria-live', 'polite'); hud.setAttribute('aria-label', t('school.title'));
    document.body.append(hud);
    hud.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'retry') begin(id); if (b.dataset.a === 'list') { end(); open(); } if (b.dataset.a === 'quit') end(); });
    drawHud(lesson.state());
    game.track?.('school', def.id, { state: 'start' });
  }
  let lastTip = null;
  function drawHud(st) {
    if (!hud || !run) return;
    const def = run.def;
    if (st.done || st.failed) return;
    if (st.tip === lastTip) return;
    lastTip = st.tip;
    hud.innerHTML = `<h3>${t(`school.lesson.${def.id}.title`)}</h3><p>${t(`school.lesson.${def.id}.text`)}</p><p class="tip"><b>${t(st.tip)}</b></p>
      <p class="small">${t('school.goals', { bronze: fmt(def, def.medals.bronze), silver: fmt(def, def.medals.silver), gold: fmt(def, def.medals.gold), better: def.better })}</p>
      <div class="buttons"><button type="button" data-a="retry" class="quiet">${t('school.restart')}</button><button type="button" data-a="quit" class="quiet">${t('school.quit')}</button></div>`;
  }
  async function finished(st) {
    const def = run.def, medal = st.done ? medalOf(def, st.value) : null;
    let paid = [];
    if (st.done && st.value != null) {
      try { const r = await game.api?.post(`/player/school/${def.id}`, { value: st.value }); paid = r?.paid ?? []; results[def.id] = { id: def.id, medal: r?.medal ?? medal, best: r?.best ?? st.value }; } catch { /* offline: shown, not kept */ }
    }
    game.track?.('school', def.id, { state: st.done ? 'done' : 'failed', medal: medal ?? 'none' });
    const money = paid.reduce((a, m) => a + (rewards[m]?.money ?? 0), 0);
    hud.innerHTML = `<h3>${t(`school.lesson.${def.id}.title`)}</h3>
      ${st.done ? `<p class="result">${medal ? `${MEDAL_ICON[medal]} ${t(`school.medal.${medal}`)}` : t('school.noMedal')} · ${fmt(def, st.value)}</p>${money ? `<p>${t('school.reward', { money: i18n.money(money) })}</p>` : ''}<p>${t(`school.lesson.${def.id}.lesson`)}</p>` : `<p class="result">${t(st.tip)}</p>`}
      <div class="buttons"><button type="button" data-a="retry">${t('school.again')}</button><button type="button" data-a="list">${t('school.lessons')}</button><button type="button" data-a="quit" class="quiet">${t('school.quit')}</button></div>`;
    announce(hud.querySelector('.result')?.textContent ?? '');
    hud.querySelector('[data-a=retry]')?.focus();
  }
  return {
    group, open, begin,
    get running() { return !!run; },
    frame(sample) {
      if (!run || run.over) return;
      const st = run.lesson.update({ ...sample, t: (run.t += sample.dt ?? 0) });
      drawHud(st);
      if (st.done || st.failed) { run.over = true; finished(st); }
    },
    end() { end(); },
  };
  function end() { run = null; lastTip = null; hud?.remove(); hud = null; group.removeFromParent(); group.clear(); game.restoreAids?.(); game.setWet?.(false); }
}
