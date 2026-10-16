// The ROADBOOK while driving (docs/ROADBOOK.md): where the car has been, sent to the server (a ping: the positions twice a
// second since the last one — it works out distance, places found and Expedition stages itself, roadbook/geo.js); the
// Expedition under way on screen (its stage, the clue, the flyers left, a run's clock, where to go — a beam of light on
// each target in the world); what was earned, as it's earned; and the development commands (kr.roadbook in the console).
//
//   const RB = createRoadbookPlay({ THREE, w, carInstanceId: () => id, travel: (lat, lon, heading) => …,
//                                   quests: () => w.quests (the route guide: play/questUi.js), setHours: h => … (null: the player's own) })
//   RB.frame(seconds, { lat, lon })    every frame in the real world
//   RB.dispose()

import { roadbook } from '../roadbook/client.js';
import { metresBetween } from '../roadbook/geo.js';
import { t } from '../ui/i18n.js';

const SAMPLE_MS = 500, PING_MS = 5000, MAX_SAMPLES = 40;
const CSS = `
/* (the page's own styles don't reach in) */
#rbHud, #rbHud *, #rbToasts, #rbToasts * { all: revert; box-sizing: border-box; }
#rbHud { position: fixed; right: 14px; top: 150px; z-index: 56; width: 300px; max-width: calc(100vw - 28px); color: #f3ecdc; font: 500 13px/1.35 Barlow, system-ui, sans-serif;
  background: linear-gradient(180deg, rgba(28, 20, 44, .92), rgba(14, 10, 22, .92)); border: 1px solid rgba(138, 92, 255, .45); border-radius: 12px; box-shadow: 0 10px 28px rgba(0, 0, 0, .45); overflow: hidden; }
#rbHud[hidden], body.garage-mode #rbHud, body.roamPhoto #rbHud { display: none !important; }
#rbHud header { display: flex; align-items: center; gap: 8px; padding: 8px 10px 6px; background: rgba(138, 92, 255, .16); cursor: pointer; }
#rbHud header .ic { font-family: 'Material Symbols Outlined'; font-size: 18px; color: #b89cff; }
#rbHud header b { flex: 1; font-weight: 700; letter-spacing: .02em; }
#rbHud header small { color: #b6a9d6; }
#rbHud .body { padding: 8px 10px 10px; display: grid; gap: 6px; }
#rbHud.folded .body { display: none; }
#rbHud .stage { font-weight: 700; color: #fff; }
#rbHud .clue { font-style: italic; color: #e9dcff; border-left: 3px solid #8a5cff; padding-left: 8px; }
#rbHud .hint { color: #ffd27a; }
#rbHud .row { display: flex; justify-content: space-between; gap: 8px; color: #cfc4e8; }
#rbHud .go { display: flex; align-items: center; gap: 8px; font-weight: 700; color: #fff; }
#rbHud .go .arrow { display: inline-block; width: 22px; height: 22px; text-align: center; line-height: 22px; border-radius: 50%; background: #8a5cff; transition: transform .2s; }
#rbHud .clock { font: 700 18px/1 "JetBrains Mono", monospace; color: #fff; }
#rbHud .clock.low { color: #ff6a52; }
#rbToasts { position: fixed; left: 50%; top: 96px; transform: translateX(-50%); z-index: 62; display: grid; gap: 6px; justify-items: center; pointer-events: none; }
#rbToasts .t { padding: 8px 14px; border-radius: 10px; background: rgba(20, 14, 32, .95); border: 1px solid rgba(138, 92, 255, .55); color: #f3ecdc; font: 600 14px Barlow, system-ui, sans-serif; box-shadow: 0 8px 22px rgba(0, 0, 0, .45); animation: rbIn .25s ease-out; }
#rbToasts .t b { color: #c9b3ff; }
@keyframes rbIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
`;
const compass = deg => t(`roadbook.dir.${['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'][Math.round(((deg % 360) + 360) % 360 / 45) % 8]}`);
const bearing = (a, b) => { const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r); return (Math.atan2(y, x) / r + 360) % 360; };
const km = m => m >= 1000 ? t('roadbook.hud.km', { n: (m / 1000).toFixed(m >= 10000 ? 0 : 1) }) : t('roadbook.hud.m', { n: Math.round(m / 10) * 10 });
// (a message, ready for the page: its words from locales/en.json, escaped)
const T = (key, vars) => esc(t(key, vars));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The Expedition under way (started, not done) and the target to show the way to: the one already being guided to while
// it's still there (the flyers: one at a time, not swapping as you pass between them), else the nearest. null: none (no
// Expedition under way, or a clue whose place hasn't been found)
export function guideTargetOf(view, at, currentKey = null) {
  const x = (view?.expeditions ?? []).find(e => e.started && !e.done && e.stage?.targets?.length);
  if (!x) return null;
  const list = x.stage.targets.map(t => ({ key: `rb:${x.id}:${x.stage.id}:${t.id}`, target: t }));
  const kept = currentKey && list.find(g => g.key === currentKey);
  if (kept) return kept;
  return at ? list.sort((a, b) => metresBetween(at, a.target) - metresBetween(at, b.target))[0] : list[0];
}
// The time of day an Expedition under way sets the world to (its stage's, else its own; null: the player's own). Not in a
// race: a quest keeps the player's time
export function expeditionHours(view, inRace = false) {
  if (inRace) return null;
  const x = (view?.expeditions ?? []).find(e => e.started && !e.done);
  const h = x ? x.stage?.timeOfDay ?? x.timeOfDay ?? null : null;
  return Number.isFinite(h) ? h : null;
}

export function createRoadbookPlay({ THREE, w, carInstanceId = () => null, travel = null, quests = () => null, setHours = null }) {
  const R = roadbook();
  if (!document.getElementById('rbCss')) { const s = document.createElement('style'); s.id = 'rbCss'; s.textContent = CSS; document.head.append(s); }
  const hud = document.createElement('div');
  hud.id = 'rbHud'; hud.hidden = true; hud.setAttribute('aria-live', 'polite');
  document.body.append(hud);
  const toasts = document.getElementById('rbToasts') ?? Object.assign(document.createElement('div'), { id: 'rbToasts' });
  if (!toasts.isConnected) document.body.append(toasts);
  let folded = false;
  hud.addEventListener('click', e => { if (e.target.closest('header')) { folded = !folded; hud.classList.toggle('folded', folded); } });

  // ---------- what was earned, as it's earned ----------
  function toast(html, ms = 5000) {
    const box = document.createElement('div');
    box.className = 't'; box.innerHTML = html;
    toasts.append(box);
    setTimeout(() => box.remove(), ms);
  }
  function tell(r) {
    for (const a of r?.awards ?? []) toast(`${esc(a.reason)}${a.tokens ? ` · <b>${T('roadbook.toast.tokens', { n: a.tokens })}</b>` : ''}${a.points ? ` · ${T('roadbook.toast.points', { n: a.points })}` : ''}`, 7000);
    for (const e of r?.events ?? []) {
      if (e.type === 'place_discovered') toast(`${T('roadbook.toast.discovered')} <b>${esc(placeName(e.data.place))}</b>${e.data.hidden ? ` ${T('roadbook.toast.hidden')}` : ''}`);
      else if (e.type === 'notice') toast(esc(e.data.text), e.data.kind === 'failed' ? 7000 : 4000);
      else if (e.type === 'expedition_completed') toast(`<b>${T('roadbook.toast.expDone')}</b> ${T('roadbook.toast.expDoneMore')}`, 8000);
    }
  }
  const placeName = id => R.view?.places?.find(p => p.id === id)?.name ?? id;

  // ---------- where the car has been, to the server ----------
  let samples = [], lastSample = 0, lastPing = 0, sending = false, last = null, nearPinged = 0;
  async function send() {
    if (sending || !samples.length) return;
    sending = true;
    const batch = samples.slice(-MAX_SAMPLES);
    try {
      const r = await R.ping(batch, carInstanceId());
      samples = samples.filter(s => s[2] > batch[batch.length - 1][2]);
      lastPing = performance.now();
      tell(r);
      draw();
    } catch (e) {
      // (offline, or the server busy: kept — the most recent ones — for the next try)
      samples = samples.slice(-MAX_SAMPLES);
      lastPing = performance.now();
      if (e?.status === 401 || e?.status === 403) samples = [];
    } finally { sending = false; }
  }
  // the targets the player might be at now: the Expedition's (and places not found yet), for an answer straight away
  const targets = () => [
    ...(R.view?.expeditions ?? []).filter(x => x.started && !x.done).flatMap(x => x.stage?.targets ?? []),
    ...(R.view?.places ?? []).filter(p => !p.found),
  ];

  // ---------- beams of light on the targets ----------
  const beams = new Map();
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x9a6bff, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xc9b3ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  function beamsFor(list, carY) {
    const want = new Set(list.map(t => `${t.lat},${t.lon}`));
    for (const [k, b] of beams) if (!want.has(k)) { w.scene.remove(b); b.traverse(o => o.geometry?.dispose()); beams.delete(k); }
    const S = w.stream;
    if (!S?.projection) return;
    for (const t of list) {
      const k = `${t.lat},${t.lon}`;
      let b = beams.get(k);
      if (!b) {
        b = new THREE.Group();
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 120, 16, 1, true), beamMat); beam.position.y = 60;
        const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(4, (t.radius ?? 30) * 0.4), Math.max(4.6, (t.radius ?? 30) * 0.4 + 0.8), 48), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3;
        b.add(beam, ring); b.renderOrder = 5;
        w.scene.add(b); beams.set(k, b);
      }
      // (the world's origin follows the car: placed again every frame)
      const [wx, wz] = S.projection.toXZ(t.lat, t.lon), [x, z] = S.toSim(wx, wz);
      b.position.set(x, carY - 1, z);
    }
  }

  // ---------- the Expedition on screen ----------
  let runClock = null;
  function draw() {
    const x = (R.view?.expeditions ?? []).find(e => e.started && !e.done);
    if (!x || !x.stage) { hud.hidden = true; runClock = null; return; }
    hud.hidden = false;
    const st = x.stage, idx = x.stages.findIndex(s => s.current) + 1;
    const lines = [`<div class="stage">${esc(st.name)}</div>`, `<div>${esc(st.text)}</div>`];
    if (st.clue) lines.push(`<div class="clue">${esc(st.clue)}</div>`);
    if (st.hint) lines.push(`<div class="hint">${T('roadbook.exp.hint', { hint: st.hint })}</div>`);
    else if (st.hintIn) lines.push(`<div class="row"><span>${T('roadbook.hud.hintIn')}</span><span>${T('roadbook.hud.min', { n: Math.ceil(st.hintIn / 60) })}</span></div>`);
    if (st.items) lines.push(`<div class="row"><span>${T('roadbook.hud.picked')}</span><span>${T('roadbook.hud.ofItems', { n: st.collected.length, of: st.items })}</span></div>`);
    if (st.timeLimitSec) lines.push(st.run ? `<div class="row"><span>${st.run.next >= st.run.of - 1 ? T('roadbook.hud.nextFinish') : T('roadbook.hud.nextCheckpoint', { n: st.run.next, of: st.run.of - 2 })}</span><span class="clock" data-k="clock"></span></div>` : `<div class="row"><span>${T('roadbook.hud.limit')}</span><span>${Math.floor(st.timeLimitSec / 60)}:${String(st.timeLimitSec % 60).padStart(2, '0')}</span></div>`);
    lines.push(`<div class="go" data-k="go"></div>`);
    hud.innerHTML = `<header><span class="ic" aria-hidden="true">explore</span><b>${esc(x.name)}</b><small>${T('roadbook.hud.stage', { n: idx, of: x.stages.length })}</small></header><div class="body">${lines.join('')}</div>`;
    hud.classList.toggle('folded', folded);
    runClock = st.run ? { startedAt: Date.parse(st.run.startedAt), limit: st.timeLimitSec * 1000 } : null;
  }
  R.on(() => draw());

  // ---------- every frame ----------
  let lastHud = 0;
  function frame(seconds, at) {
    if (!at || !Number.isFinite(at.lat)) return;
    const now = performance.now();
    if (!R.view) return;
    // a sample twice a second, when the car has moved
    if (now - lastSample >= SAMPLE_MS) {
      lastSample = now;
      // (the wall clock: it carries on across a reload, which the server's "only samples after the last one" needs)
      if (!last || metresBetween(last, at) > 0.5) { samples.push([+at.lat.toFixed(7), +at.lon.toFixed(7), Date.now()]); last = { ...at }; }
      if (samples.length > MAX_SAMPLES * 3) samples = samples.slice(-MAX_SAMPLES);
    }
    const nearAny = targets().some(x => metresBetween(at, x) <= (x.radius ?? 60) + 5);
    if (samples.length && (now - lastPing >= PING_MS || (nearAny && now - nearPinged > 1500))) { if (nearAny) nearPinged = now; void send(); }
    // the beams (the Expedition's targets only) and the way there, a few times a second
    const carY = w.sim?.vehicle?.body?.translation().y ?? 0;
    const xT = (R.view?.expeditions ?? []).filter(x => x.started && !x.done).flatMap(x => x.stage?.targets ?? []);
    beamsFor(xT, carY);
    // the way there on the road and on the maps, and the Expedition's time of day
    guideFrame(now, at);
    const hours = expeditionHours(R.view, !!quests()?.active);
    if (hours !== hoursSet) { hoursSet = hours; setHours?.(hours); }
    if (now - lastHud > 250 && !hud.hidden) {
      lastHud = now;
      const go = hud.querySelector('[data-k="go"]');
      if (go) {
        const near = xT.map(x => ({ t: x, d: metresBetween(at, x) })).sort((a, b) => a.d - b.d)[0];
        go.innerHTML = near ? `<span class="arrow">➤</span><span>${T('roadbook.hud.way', { name: near.t.name, distance: km(near.d), direction: compass(bearing(at, near.t)) })}</span>` : `<span>${T('roadbook.hud.findIt')}</span>`;
        const arrow = go.querySelector('.arrow');
        if (arrow && near) arrow.style.transform = `rotate(${bearing(at, near.t) - 90}deg)`;
      }
      const clock = hud.querySelector('[data-k="clock"]');
      if (clock && runClock) { const left = Math.max(0, runClock.limit - (Date.now() - runClock.startedAt)) / 1000; clock.textContent = `${Math.floor(left / 60)}:${(left % 60).toFixed(1).padStart(4, '0')}`; clock.classList.toggle('low', left < 30); }
    }
  }

  // ---------- the way there: the quests' route guide (play/questUi.js) to the target ----------
  // Arrows on the road and the line on both maps, with a pin where it ends; a new one for each target; worked out again
  // from where the car is when it's been off the route a few seconds (at most every 15 s). The player clearing it (the
  // map's Clear route) leaves it cleared until the next target.
  let guidedKey = null, offSince = 0, rerouteAt = 0, offCheckAt = 0, hoursSet = null;
  function guideFrame(now, at) {
    const Q = quests();
    if (!Q || Q.active) return;
    const g = guideTargetOf(R.view, at, guidedKey);
    if (!g) { if (guidedKey && Q.guideFor === guidedKey) Q.clearGuide(); guidedKey = null; return; }
    const to = { id: g.key, location: { lat: g.target.lat, lon: g.target.lon }, pin: true };
    if (g.key !== guidedKey) { guidedKey = g.key; offSince = 0; void Q.setGuide(to); return; }
    if (Q.guideFor !== guidedKey || !Q.guideLine?.length || now - offCheckAt < 1000 || !w.stream?.projection) return;
    offCheckAt = now;
    const [x, z] = w.stream.projection.toXZ(at.lat, at.lon);
    let best = Infinity;
    for (const p of Q.guideLine) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
    if (Math.sqrt(best) <= 80) { offSince = 0; return; }
    offSince ||= now;
    if (now - offSince > 4000 && now - rerouteAt > 15000) { rerouteAt = now; offSince = 0; void Q.setGuide({ ...to, quiet: true }); }
  }

  // ---------- the development commands: kr.roadbook in the console ----------
  const dev = {
    help() { console.log('kr.roadbook.fire(type, data) · kr.roadbook.tokens(n) · kr.roadbook.nextStage() · kr.roadbook.endSeason() · kr.roadbook.show()\nEvents: race_finished { win, medal, questType }, part_installed, car_purchased, car_sold, photo_saved, distance_driven { metres }, place_discovered { place }, expedition_completed { expedition }'); },
    async fire(type, data = {}) { const r = await R.dev.event(type, data); tell({ awards: r.awards }); return r.awards; },
    async tokens(n = 500) { const r = await R.dev.tokens(n); toast(`Development: <b>${n > 0 ? '+' : ''}${n} tokens</b> (now ${r.tokens})`); return r.tokens; },
    async endSeason() { const r = await R.dev.endSeason(); toast('Development: the season ended (tokens turned into cash).'); return r; },
    // the next Expedition stage: started if it isn't, the car taken there, and arriving counted (a teleport alone never
    // counts — the server's development command says it was driven)
    async nextStage() {
      let t = await R.dev.nextTarget();
      if (!t) { toast('No Expedition left to do.'); return null; }
      if (t.start) { await R.startExpedition(t.expedition); t = await R.dev.nextTarget(); }
      if (!t) return null;
      if (travel) await travel(t.lat, t.lon, 0);
      const r = await R.dev.arrive(t.lat, t.lon);
      tell(r); draw();
      return t;
    },
    show() { dispatchEvent(new CustomEvent('kr:roadbook')); },
  };
  globalThis.kr ??= {};
  globalThis.kr.roadbook = dev;
  void R.refresh();

  return {
    frame, toast, tell, dev,
    dispose() {
      hud.remove(); for (const b of beams.values()) { w.scene.remove(b); b.traverse(o => o.geometry?.dispose()); } beams.clear();
      if (hoursSet != null) setHours?.(null);
      const Q = quests(); if (guidedKey && Q?.guideFor === guidedKey) Q.clearGuide();
    },
  };
}
