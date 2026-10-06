// Quests in the game (Phase 4 Step 3): the quest card (what it is, whether you can enter and why not,
// which of your cars would, the fee, the rewards, your best), "Set route" (a guide line on the maps to its
// start, along the road graph), then the run — the intro fly-along (skippable), the countdown, the race
// HUD, the pause menu (Esc), and the results screen. The run itself is play/questController.js; the money
// and progress go through PlayerService; the game hands in what this needs (game, below).
//
//   const Q = createQuestPlay({ THREE, w, game })
//     game: { player, db, config, currency, economy, projection, carInstanceId(), carSummary(id),
//             ownedCars(), routeItem(id) → Promise<item>, network() → Promise<road network>,
//             adapters() → the controller's adapters (play/questController.js) + frame() + dispose(),
//             carNow() → { x, z, heading, kmh, gear }, repairEstimate() → money, pause(on), openSettings(),
//             toGarage(), say(text, kind) }
//   Q.card(item, el) → true (it drew the card)    Q.start(item)    Q.frame(realDt)    Q.camera(camera)
//   Q.active  Q.paused  Q.auto (the browser tests' autopilot)  Q.autoInput()  Q.noteHit(strength)
//   Q.resetNow()   Q.stateOf(questId) → { state, medal } (for the maps)   Q.preload(item) (fast travel)
//
// Polish (Phase 4 Step 5): the quest's sounds (play/questSounds.js); the camera gliding between free roam,
// the intro, the race and the results' orbit (play/cameraBlend.js); first-time hints (game.hint(when):
// data/hints.json); and the accessibility settings (game.prefs: palette, guides, hudScale — play/palette.js).

import { createQuestController } from './questController.js';
import { trackServer } from './trackServer.js';
import { createRouteDressing } from './routeDressing.js';
import { viewCourse, lineOf } from '../route/model.js';
import { buildRoute } from '../route/build.js';
import { createAutopilot } from '../route/autopilot.js';
import { entryReasons, carsThatQualify, medalTargets, typeLabel, CAR_CODES, levelOf, levelProgress } from '../quest/rules.js';
import { carWarning, starsText } from '../quest/difficulty.js';
import { rewardsOf } from '../content/quests.js';
import { fmtTime, fmtDelta } from '../quest/timing.js';
import { questState, bestOf } from '../garage/player/quests.js';
import { ghostAt } from '../track/events/ghost.js';
import { pinkSlipConfirmations } from '../quest/types/pinkSlip.js';
import { TYPE_MODULES } from '../quest/types/index.js';
import { npcSettings, setupNpcs } from '../race/setup.js';
import { hashSeed } from '../ai/rng.js';
import { createQuestSounds } from './questSounds.js';
import { createCameraBlend, orbitPose } from './cameraBlend.js';
import { paletteOf, guideStyle } from './palette.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MEDAL = { gold: '#f2c230', silver: '#c9d1d9', bronze: '#cd7f32' };
const ord = n => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
const HUD_KEY = 'driveWorld.questHud';
// the palette's colours as CSS variables (the HUD, the screens and the card use them)
function applyPalette(P) {
  const r = document.documentElement.style;
  r.setProperty('--q-good', P.good); r.setProperty('--q-bad', P.bad); r.setProperty('--q-warn', P.warn);
}

const CSS = `
#questHud{position:fixed;inset:0;pointer-events:none;z-index:41;font:600 15px Barlow,system-ui,sans-serif;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.65)}
#questHud .top{position:absolute;top:70px;left:50%;transform:translateX(-50%) scale(var(--qs,1));transform-origin:top center;text-align:center}
#questHud .clock{font:700 36px "JetBrains Mono",monospace;letter-spacing:.02em}
#questHud .clock.low{color:var(--q-bad,#ff7a6a)}
#questHud .row{opacity:.92;margin-top:2px}
#questHud .split{font:700 16px "JetBrains Mono",monospace;margin-top:4px}
#questHud .good{color:var(--q-good,#7ee08a)}#questHud .bad{color:var(--q-bad,#ff7a6a)}
#questHud .side{position:absolute;top:290px;right:18px;transform:scale(var(--qs,1));transform-origin:top right;text-align:right;min-width:150px}
#questHud .side .k{font:700 10px "JetBrains Mono",monospace;letter-spacing:.08em;text-transform:uppercase;opacity:.7}
#questHud .side .v{font:700 22px "JetBrains Mono",monospace;margin-bottom:6px}
#questHud .pos .v{opacity:.55}
#questHud .panel{position:absolute;top:70px;left:18px;transform:scale(var(--qs,1));transform-origin:top left;background:rgba(14,18,26,.55);border-radius:10px;padding:8px 12px;min-width:150px}
#questHud .panel .big{font:700 30px "JetBrains Mono",monospace}
#questHud .bar{height:8px;border-radius:4px;background:rgba(255,255,255,.18);overflow:hidden;margin-top:4px}#questHud .bar i{display:block;height:100%;background:var(--q-good,#7ee08a)}
#questHud .arrow{position:absolute;top:178px;left:50%;width:var(--qa,46px);height:var(--qa,46px);margin-left:calc(var(--qa,46px) / -2);transform-origin:50% 50%;transform:scale(var(--qs,1))}
#questHud .arrow svg{width:100%;height:100%;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
#questHud .speed{position:absolute;bottom:26px;right:24px;transform:scale(var(--qs,1));transform-origin:bottom right;text-align:right;font:700 30px "JetBrains Mono",monospace}
#questHud .speed small{font-size:13px;opacity:.75}
#questHud .msg{position:absolute;top:36%;left:50%;transform:translate(-50%,-50%);font:800 40px Barlow,system-ui,sans-serif;letter-spacing:.04em;white-space:nowrap}
#questHud .msg.warn{color:var(--q-warn,#ffbd4a)}#questHud .msg.bad{color:var(--q-bad,#ff7a6a)}#questHud .msg.go{color:var(--q-good,#7ee08a)}
#questHud .count{position:absolute;top:34%;left:50%;transform:translate(-50%,-50%);font:800 110px Barlow,system-ui,sans-serif;color:#fff;-webkit-text-stroke:2px rgba(0,0,0,.55)}
#questHud .count.go{color:var(--q-good,#7ee08a)}
#questHud .intro{position:absolute;bottom:90px;left:50%;transform:translateX(-50%);text-align:center}
#questHud .intro b{font-size:28px;display:block}
#questHud.hidden .top,#questHud.hidden .side,#questHud.hidden .panel,#questHud.hidden .speed,#questHud.hidden .arrow{display:none}
.questScreen{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(6,8,12,.55);font:14px/1.45 Barlow,system-ui,sans-serif;color:#f2f4f7}
.questScreen .box{background:rgba(16,20,28,.97);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:18px 22px;width:min(520px,94vw);max-height:90vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.questScreen h2{margin:0 0 4px;font-size:24px}.questScreen h3{margin:12px 0 4px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;opacity:.7}
.questScreen .medal{display:inline-block;width:18px;height:18px;border-radius:50%;vertical-align:-3px;margin-right:6px;border:2px solid rgba(255,255,255,.6)}
.questScreen table{width:100%;border-collapse:collapse;font:13px "JetBrains Mono",monospace}.questScreen td{padding:2px 4px}.questScreen td:last-child{text-align:right}
.questScreen .good{color:var(--q-good,#7ee08a)}.questScreen .bad{color:var(--q-bad,#ff7a6a)}.questScreen .money{color:#9be38f;font:700 18px "JetBrains Mono",monospace}
.questScreen .buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.questScreen button,#contentCard .qbtn{font:600 14px Barlow,system-ui,sans-serif;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:7px 14px;cursor:pointer;pointer-events:auto}
.questScreen button.primary,#contentCard .qbtn.primary{background:#2f7d43;border-color:#3f9a57}
.questScreen button.danger{background:#7d2f2f;border-color:#9a3f3f}
.questScreen button:disabled,#contentCard .qbtn:disabled{opacity:.45;cursor:not-allowed}
.questScreen label{display:flex;align-items:center;gap:10px;margin:8px 0}
#contentCard .qrow{display:flex;justify-content:space-between;gap:10px;font-size:13px}
#contentCard .qbest{font:600 12px "JetBrains Mono",monospace;opacity:.9}
#contentCard .qbtns{display:flex;gap:6px;margin-top:8px}
#contentCard .stars{color:#ffd166;letter-spacing:1px}
#contentCard .qwarn{color:var(--q-warn,#ffbd4a);font-size:12px;margin:4px 0}
#contentCard .qold{color:#9aa3ad;font-size:11px}
.questScreen .levelup{color:#ffd166;font-weight:700}`;

export function loadHudSettings() {
  try { return { scale: 1, visible: true, ...JSON.parse(localStorage.getItem(HUD_KEY) || '{}') }; } catch { return { scale: 1, visible: true }; }
}
function saveHudSettings(h) { try { localStorage.setItem(HUD_KEY, JSON.stringify(h)); } catch { /* not kept */ } }

export function createQuestPlay({ THREE, w, game, autopilot = false }) {
  if (!document.getElementById('questCss')) { const s = document.createElement('style'); s.id = 'questCss'; s.textContent = CSS; document.head.appendChild(s); }
  const S = w.stream, P = S.projection, cfg = game.config;
  const hudSettings = { ...{ scale: cfg.hud?.scale ?? 1, visible: cfg.hud?.visible !== false }, ...loadHudSettings() };
  let run = null;          // { item, course, controller, adapters, dressing, hud, pilot, message, … }
  let paused = false, screen = null, guide = null, hit = 0;
  // polish: sounds, the camera's glides, the accessibility settings (applied as they change)
  const sounds = createQuestSounds({ muted: () => !!game.muted?.() });
  const blend = createCameraBlend(cfg.camera?.transitions), orbit = cfg.camera?.orbit ?? {};
  let frameDt = 0, resultsT = 0, look = { palette: null, guides: null };
  const prefs = () => game.prefs ?? {};
  const palette = () => paletteOf(prefs().palette), style = () => guideStyle(prefs().guides);
  const hudScale = () => prefs().hudScale ?? hudSettings.scale;
  const hint = when => game.hint?.(when);
  function dressingFor(course) { return createRouteDressing({ THREE, parent: S.world, compiled: course, guides: course.guides, palette: palette(), style: style() }); }
  // the settings changed (palette or guides): the colours, the route's dressing and the maps' lines again
  function restyle() {
    const p = prefs().palette ?? 'standard', g = prefs().guides ?? 'normal';
    if (look.palette === p && look.guides === g) return;
    look = { palette: p, guides: g };
    applyPalette(palette());
    if (run) { run.dressing.dispose(); run.dressing = dressingFor(run.course); }
    setLines();
  }
  const courses = new Map();

  // ---------- the course (the quest's route, loaded once) ----------
  async function courseOf(item) {
    // (a track event: the course of the track it's on, made ready by the trip there — play/trackTrip.js)
    if (item.track) { const c = await game.trackCourse?.(item); return c ? { course: c, route: null } : null; }
    if (!item.route) return null;
    if (courses.has(item.route)) return courses.get(item.route);
    const route = await game.routeItem(item.route);
    const course = route?.course ? viewCourse(route.course, P) : null;
    courses.set(item.route, course ? { course, route } : null);
    return courses.get(item.route);
  }
  // (the line's colour and width: the accessibility settings — map/render/maps.ts reads them)
  const lineFeature = (line, kind) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: line.map(p => { const [lat, lon] = P.toLatLon(p.x, p.z); return [lon, lat]; }) }, properties: { kind, colour: palette()[kind], width: style().lineWidth } });
  function setLines() {
    const f = [];
    if (run?.course) f.push(lineFeature(run.course.line, 'route'));
    else if (preview) f.push(lineFeature(preview, 'route'));
    if (guide && !run) f.push(lineFeature(guide, 'guide'));
    w.maps?.setLines?.(f);
  }
  let preview = null;

  // ---------- the quest card ----------
  function carInfo(id) { const c = game.carSummary(id); return c ? { ...c, drivable: c.drivable } : null; }
  function reasonsFor(item, id = game.carInstanceId()) {
    const p = game.player.profile;
    return entryReasons({ quest: item, car: carInfo(id), player: { money: p.money, xp: p.xp ?? 0, unlimited: game.player.unlimited }, config: cfg, economy: game.economy });
  }
  function card(item, el) {
    if (item.kind !== 'quest') { preview = null; setLines(); return false; }
    hint(item.type === 'pink_slip' ? 'pinkSlip' : 'questCard');
    const draw = (c = null) => {
      const p = game.player.profile, prog = p.quests?.[item.id], cur = game.currency;
      const reasons = run ? [{ code: 'busy', text: 'Finish or quit the quest you\'re in first.' }] : reasonsFor(item);
      const carBad = reasons.some(r => CAR_CODES.has(r.code));
      const others = carBad ? carsThatQualify(item, game.ownedCars().filter(x => x.instanceId !== game.carInstanceId()), cfg) : [];
      const r = rewardsOf(item, game.economy), T = c ? medalTargets(item, c.course, cfg) : null;
      const laps = c?.course.loop ? Math.max(1, item.params?.laps ?? 1) : 1;
      // (a best set before the route was changed: still shown, marked as from an older version)
      const B = bestOf(prog, c?.course?.version), show = (t, sc) => item.type === 'drift' ? (sc != null ? `${sc.toLocaleString('en-GB')} pts` : null) : (t != null ? fmtTime(t) : null);
      const best = B ? `${show(B.time, B.score) ?? '—'}${B.old ? ' <span class="qold">(older version of this route)</span>' : B.oldBest && show(B.oldBest.time, B.oldBest.score) ? ` <span class="qold">(older version: ${show(B.oldBest.time, B.oldBest.score)})</span>` : ''}` : null;
      const targets = T && T.gold != null ? ['gold', 'silver', 'bronze'].map(t => `<span style="color:${MEDAL[t]}">●</span> ${T.kind === 'score' ? T[t].toLocaleString('en-GB') : fmtTime(T[t], 1)}`).join(' &nbsp;') : '';
      const disabled = TYPE_MODULES[item.type]?.enabled === false;
      el.innerHTML = `<div class="kind">Quest · ${esc(typeLabel(item.type))}</div><h4>${esc(item.name)}</h4>
        ${item.description ? `<div>${esc(item.description)}</div>` : ''}
        <div class="qrow"><span>${c ? `${(c.course.length / 1000).toFixed(2)} km${laps > 1 ? ` × ${laps} laps` : ''} · ${c.course.gates.filter(g => g.required).length} checkpoints · ${(item.params?.start ?? 'standing') === 'rolling' ? 'rolling' : 'standing'} start` : item.route ? 'Loading the route…' : 'No route'}</span></div>
        ${targets ? `<div class="qrow"><span>${targets}</span></div>` : ''}
        <ul>${reasons.length ? reasons.map(x => `<li class="no">${esc(x.text)}</li>`).join('') : `<li class="ok">You can enter with your ${esc(game.carSummary(game.carInstanceId())?.name ?? 'car')}</li>`}</ul>
        ${carBad ? `<div style="font-size:12px">${others.length ? `Your cars that qualify: <b>${others.map(x => esc(x.name)).join(', ')}</b> (switch in the garage)` : 'None of your cars qualify.'}</div>` : ''}
        <div class="qrow"><span class="stars" title="${esc((item.rating?.parts ?? []).map(x => `${x.what} ${x.points}`).join(', '))}">${starsText(r.stars ?? 2)}</span> <span>${esc(r.tierName ?? '')} tier${item.rating?.recommended ? ` · recommended car: rating ${Math.round(item.rating.recommended)}${item.rating.recommendedClass ? ` (class ${esc(item.rating.recommendedClass)})` : ''}` : ''}</span></div>
        ${(() => { const wn = carWarning(item.rating, game.carSummary(game.carInstanceId())?.rating, cfg); return wn ? `<div class="qwarn">⚠ ${esc(wn)}</div>` : ''; })()}
        <div class="money">${item.type === 'pink_slip' ? `Winner takes the loser\'s car · stakes up to class ${esc(r.stakeMaxClass ?? '?')}` : `Reward up to ${esc(cur)}${(r.money ?? 0).toLocaleString('en-GB')} · ${r.xp ?? 0} xp`}${r.fee > 0 ? ` · entry ${esc(cur)}${r.fee.toLocaleString('en-GB')}` : ' · free entry'}</div>
        ${seriesLine}
        <div class="qbest">${prog?.attempts ? `Your best: ${best ?? '—'}${prog.medal ? ` <span style="color:${MEDAL[prog.medal]}">● ${prog.medal}</span>` : ''} · ${prog.attempts} attempt${prog.attempts > 1 ? 's' : ''}` : 'Not tried yet'} · level ${levelOf(p.xp ?? 0, cfg)}</div>
        <div class="qbtns"><button class="qbtn primary" data-start ${reasons.length || !c || disabled ? 'disabled' : ''} title="${esc(reasons[0]?.text ?? '')}">Start${r.fee > 0 ? ` (${esc(cur)}${r.fee.toLocaleString('en-GB')})` : ''}</button>
        <button class="qbtn" data-guide>${guide ? 'Clear route' : 'Set route'}</button><span style="flex:1"></span><button class="qbtn" data-close>Close</button></div>`;
      el.querySelector('[data-start]').onclick = () => start(item);
      el.querySelector('[data-guide]').onclick = () => guide ? clearGuide(() => draw(c)) : setGuide(item, () => draw(c));
    };
    let seriesLine = '', lastC = null;
    draw();
    game.seriesOf?.(item).then(list => {
      const p = game.player.profile;
      seriesLine = list.map(S => { const done = S.item.quests.filter(id => p.quests?.[id]?.completed).length; return `<div class="qrow"><span>Series: <b>${esc(S.item.name)}</b> · ${p.series?.[S.item.id] ? 'complete ✔' : `${done} of ${S.item.quests.length} done · bonus for all`}</span></div>`; }).join('');
      if (seriesLine) draw(lastC);
    }).catch(() => {});
    courseOf(item).then(c => { lastC = c; if (c) { preview = c.course.line; setLines(); } draw(c); }).catch(e => { el.querySelector('.qrow span').textContent = `The route couldn't be loaded: ${e.message}`; });
    return true;
  }

  // "Set route": the way to the quest's start on the road graph, on the maps
  async function setGuide(item, done) {
    try {
      const N = await game.network(), car = game.carNow(), [lat, lon] = P.toLatLon(car.x, car.z);
      const r = buildRoute(N, { kind: 'p2p', waypoints: [{ lat, lon }, { lat: item.location.lat, lon: item.location.lon }], options: { oneway: false } });
      if (!r.ok || r.line.length < 2) { game.say('No way there on the roads', 'warn'); return; }
      guide = r.line; setLines();
      game.say(`Route set: ${(r.length / 1000).toFixed(1)} km`, 'ok');
    } catch (e) { game.say(`Couldn't set a route: ${e.message}`, 'warn'); }
    done?.();
  }
  function clearGuide(done) { guide = null; setLines(); done?.(); }

  // ---------- starting ----------
  async function start(item, { restart = false, ghost = undefined } = {}) {
    if (run && !restart) return { ok: false, error: 'A quest is under way.' };
    // (a ghost to race: the best lap's — track/events/ghost.js — kept for a restart)
    if (ghost === undefined) ghost = restart && run?.item.id === item.id ? run.ghost : null;
    const c = await courseOf(item);
    if (!c) { game.say('This quest has no route to drive', 'warn'); return { ok: false, error: 'no route' }; }
    const id = game.carInstanceId(), car = { ...game.carSummary(id), instanceId: id };
    // rivals (race/setup.js): who, and their cars from the parts system — before anything's paid
    const N = game.npcCfg ? npcSettings(item, game.npcCfg) : { count: 0 };
    let setup = [];
    const seed = hashSeed(item.id, game.player.profile.quests?.[item.id]?.attempts ?? 0, Date.now());
    if (N.count > 0) {
      setup = setupNpcs({ db: game.db, quest: item, course: c.course, cfg: game.npcCfg, qcfg: cfg, seed, playerRating: car.rating ?? null, count: N.count });
      for (const n of setup) await game.prepareNpc(n);
    }
    if (item.type === 'pink_slip' && !(await confirmPinkSlip(item, setup[0]))) return { ok: false, error: 'not confirmed' };
    const prog = game.player.profile.quests?.[item.id];
    // (the run under way first: quit, a DNF — its ending its own, not this one's)
    const prev = run;
    if (prev && ['intro', 'countdown', 'racing'].includes(prev.controller.state)) await prev.controller.quit();
    const A = game.adapters(), me = {};
    // (a run on a generated track: handed to the server — its record and leaderboard are the server's; the
    // race replay kept there with it)
    const report = item.track ? async ({ result, recording }) => {
      const S = await trackServer();
      if (!S) return null;
      const replay = A.raceReplay?.();
      return S.submit({ eventId: item.id, result, recording, replay: replay ? { ...replay, title: item.name } : null });
    } : null;
    const controller = createQuestController({ quest: item, course: c.course, config: cfg, player: game.player, car, adapters: A, race: () => me.race ?? null, series: game.seriesOf ?? null, report,
      best: (() => { const B = bestOf(prog, c.course.version); return B && !B.old ? { splits: B.splits, laps: B.laps, time: B.time, score: B.score } : null; })(),
      onEvent: ev => { if (run === me) event(ev); }, onEnd: res => { if (run === me) ended(res); } });
    run = Object.assign(me, { item, course: c.course, controller, adapters: A, dressing: dressingFor(c.course), message: null, messageFor: 0, results: null, pilot: autopilot ? createAutopilot(c.course.line, { loop: c.course.loop }) : null, startedAt: performance.now(), fee: 0, ghost });
    if (prev) { prev.race && game.endRace(prev.race); prev.dressing.dispose(); prev.adapters.dispose(); prev.controller.dispose(); }
    guide = null; setLines(); hud(); hideScreen();
    const r = await controller.start({ restart });
    if (!r.ok) { if (run === me) { game.say(r.error, 'warn'); stop(); } return r; }
    run.fee = r.fee;
    // the race: the NPCs on the grid behind, their countdown the player's (no rubber-banding for a pink
    // slip, or when the player's turned it off)
    if (setup.length) { me.race = game.startRace({ quest: item, course: c.course, npcs: setup, playerSession: controller.session, seed, rubberBand: N.rubberBand && hudSettings.rubberBand !== false && game.prefs?.rubberBand !== false && item.type !== 'pink_slip' }); hint('npcRace'); }
    return r;
  }
  async function confirmPinkSlip(item, rival) {
    const car = game.carSummary(game.carInstanceId()), steps = pinkSlipConfirmations({ name: car?.name ?? 'car', value: car?.value ?? 0, currency: game.currency }, rival ? `${rival.profile.name} (${game.db.cars[rival.build.carId]?.name ?? rival.build.carId})` : game.db.cars[item.params?.opponentCar]?.name);
    for (const st of steps) {
      const ok = await new Promise(res => {
        showScreen(`<h2>${esc(st.title)}</h2><p>${esc(st.text)}</p>${st.typed ? '<input data-typed style="width:100%;font:16px Barlow;padding:6px">' : ''}<div class="buttons"><button class="danger" data-ok ${st.typed ? 'disabled' : ''}>${esc(st.accept)}</button><button data-no>Don't race</button></div>`, {
          ok: () => res(true), no: () => res(false) });
        const inp = screen.querySelector('[data-typed]');
        if (inp) inp.oninput = () => { screen.querySelector('[data-ok]').disabled = inp.value.trim() !== st.typed; };
      });
      hideScreen();
      if (!ok) return false;
    }
    return true;
  }

  // ---------- during the run ----------
  function say(text, cls = '', secs = 2) { if (run) { run.message = { text, cls }; run.messageFor = secs; } }
  function event(e) {
    if (!run) return;
    sounds.event(e);
    if (e.type === 'go') say('GO', 'go', 0.8);
    else if (e.type === 'jump') say(`Jump start +${e.penalty}s`, 'bad', 2);
    else if (e.type === 'checkpoint') say(`${e.number} / ${e.of}  ${fmtTime(e.time)}${e.delta != null ? `  ${fmtDelta(e.delta)}` : ''}${e.extension ? `  +${e.extension}s` : ''}`, e.delta == null || e.delta <= 0 ? 'go' : 'warn', 1.6);
    else if (e.type === 'bonus') say(`Bonus${e.extension ? ` +${e.extension}s` : ''}`, 'go', 1.4);
    else if (e.type === 'missed') say(e.message, 'bad', 3);
    else if (e.type === 'lap') say(`Lap ${e.lap} · ${fmtTime(e.lapTime)}${e.best ? ' · best' : ''}`, 'go', 2);
    else if (e.type === 'reset') say('Back to the last checkpoint', 'warn', 2);
    else if (e.type === 'drift-lost') say(e.why === 'wall' ? 'Wall! Combo lost' : 'Spun out! Combo lost', 'bad', 1.4);
    else if (e.type === 'drift-bank' && e.points > 0) say(`+${e.points.toLocaleString('en-GB')}`, 'go', 1.2);
    else if (e.type === 'cargo' && e.lost >= 3) say(`Cargo damaged: ${Math.round(e.condition)}%`, 'warn', 1.5);
    else if (e.type === 'finish') say(e.outcome.medal ? `${e.outcome.medal.toUpperCase()}` : 'FINISHED', 'go', 3);
    else if (e.type === 'fail') say(e.outcome.text ?? 'Failed', 'bad', 3);
  }
  function ended(res) {
    if (!run) return;
    run.results = res;
    // (a moment to see the line crossed, then the results)
    setTimeout(() => { if (run?.results === res) results(res); }, res.outcome.status === 'dnf' ? 0 : 1600);
  }

  let hudEl = null;
  function hud() {
    if (!hudEl) { hudEl = document.createElement('div'); hudEl.id = 'questHud'; document.body.appendChild(hudEl); }
    hudEl.style.setProperty('--qs', hudScale());
    hudEl.style.setProperty('--qa', `${style().hudArrow}px`);
    hudEl.classList.toggle('hidden', !hudSettings.visible);
    if (!run) { hudEl.innerHTML = ''; return; }
    const Q = run.controller.session;
    if (!Q) return;
    const H = Q.hud(), st = H.state, car = game.carNow(), panel = H.panel;
    const clock = H.timeLeft != null && H.running ? H.timeLeft : H.clock;
    const lap = H.laps > 1 ? `<div class="row">Lap ${H.lap} / ${H.laps}${H.bestLap != null ? ` · best ${fmtTime(H.bestLap)}` : ''}</div>` : '';
    const sp = H.split ? `<div class="split ${H.split.delta == null ? '' : H.split.delta <= 0 ? 'good' : 'bad'}">${H.split.number}/${H.split.of} ${fmtTime(H.split.time)}${H.split.delta != null ? ` ${fmtDelta(H.split.delta)}` : ''}</div>` : '';
    // the next checkpoint's arrow: its way from the car's heading
    const ang = Math.atan2(H.next.x - car.x, H.next.z - car.z) * 180 / Math.PI - car.heading;
    let panelHtml = '';
    if (panel?.kind === 'drift') panelHtml = `<div class="k">Drift</div><div class="big">${panel.score.toLocaleString('en-GB')}</div><div>${panel.pot ? `+${panel.pot.toLocaleString('en-GB')} × ${panel.multiplier}` : panel.multiplier > 1 ? `× ${panel.multiplier}` : '&nbsp;'}</div>${panel.next ? `<div style="font-size:12px">${panel.next.tier}: ${panel.next.score.toLocaleString('en-GB')}</div>` : panel.medal ? `<div style="color:${MEDAL[panel.medal]}">● ${panel.medal}</div>` : ''}`;
    else if (panel?.kind === 'delivery') panelHtml = `<div class="k">${esc(panel.name)}${panel.fragile ? ' · fragile' : ''}</div><div class="big ${panel.condition < 50 ? 'bad' : ''}">${panel.condition}%</div><div class="bar"><i style="width:${panel.condition}%;background:${panel.condition < 50 ? '#ff7a6a' : panel.condition < 80 ? '#ffbd4a' : '#7ee08a'}"></i></div>`;
    else if (panel?.kind === 'timeTrial' && panel.next) panelHtml = `<div class="k">Target</div><div style="color:${MEDAL[panel.next.tier]}">● ${panel.next.tier} ${fmtTime(panel.next.time, 1)}</div>${panel.countdown ? '<div style="font-size:12px">checkpoints add time</div>' : ''}`;
    else if (panel?.kind === 'target' && panel.next) panelHtml = `<div class="k">Target</div><div style="color:${MEDAL[panel.next.tier]}">● ${panel.next.tier} ${fmtTime(panel.next.time, 1)}</div>`;
    else if (panel?.kind === 'hotLap') panelHtml = `<div class="k">${panel.mode === 'best_lap' ? 'This lap' : 'Total'}</div><div class="big">${fmtTime(Math.max(0, panel.mode === 'best_lap' ? panel.lapTime : H.clock), 1)}</div>${panel.best != null ? `<div style="font-size:12px">best ${fmtTime(panel.best)}${panel.medal ? ` <span style="color:${MEDAL[panel.medal]}">●</span>` : ''}</div>` : ''}${panel.next ? `<div style="color:${MEDAL[panel.next.tier]};font-size:12px">● ${panel.next.tier} ${fmtTime(panel.next.time, 1)}</div>` : ''}`;
    else if (panel?.kind === 'endurance') panelHtml = `<div class="k">Endurance</div><div class="big">Stint ${panel.stint} / ${panel.stints}</div><div style="font-size:12px">lap ${panel.lap} / ${panel.laps}</div>`;
    else if (panel?.kind === 'clock') panelHtml = `<div class="k">Checkpoints</div><div class="big">${panel.passed} / ${panel.of}</div>`;
    const msg = H.message ? { text: H.message, cls: H.message.startsWith('Wrong') ? 'bad' : 'warn' } : run.message;
    hudEl.innerHTML = st === 'intro' ? `<div class="intro"><b>${esc(run.item.name)}</b>${esc(typeLabel(run.item.type))} · Space to skip</div>` : `
      <div class="top"><div class="clock ${H.timeLeft != null && H.timeLeft < 10 && H.running ? 'low' : ''}">${fmtTime(Math.max(0, clock), H.running ? 2 : 3)}</div>
        <div class="row">${H.checkpoints ? `Checkpoint ${Math.min(H.checkpoint, H.checkpoints)} / ${H.checkpoints}` : ''}${H.penalty ? ` · +${H.penalty}s penalty` : ''}</div>${lap}${sp}</div>
      <div class="side">${raceSide(H)}</div>
      ${panelHtml ? `<div class="panel">${panelHtml}</div>` : ''}
      ${st === 'racing' ? `<div class="arrow" style="transform:rotate(${ang}deg) scale(${hudScale()})"><svg viewBox="0 0 40 40"><path d="M20 3 L34 30 L20 23 L6 30 Z" fill="${H.message?.startsWith('Missed') ? palette().arrowMissed : palette().arrow}" stroke="#1b1b1b" stroke-width="1.5"/></svg></div>` : ''}
      <div class="speed">${Math.round(car.kmh)}<small> km/h</small> · ${esc(car.gear ?? '')}</div>
      ${st === 'countdown' && H.count ? `<div class="count">${H.count}</div>` : ''}
      ${msg && st !== 'countdown' ? `<div class="msg ${msg.cls}">${esc(msg.text)}</div>` : ''}`;
  }

  // the race's side of the HUD: my place, the gaps either side, the standings (names, gaps); no race: the
  // position placeholder
  function raceSide(H) {
    const R = run?.race;
    if (!R) return `<div class="pos"><div class="k">Position</div><div class="v">${ord(H.position.place)} / ${H.position.of}</div></div>`;
    const st = R.standings(), me = st.find(x => x.player), gap = g => g == null ? '' : `${g.toFixed(1)}s`;
    const rows = st.map(x => `<div class="row" style="font:600 13px 'JetBrains Mono',monospace;${x.player ? 'color:#ffd24a' : ''}${x.status === 'retired' ? ';opacity:.5' : ''}">${x.place}. ${esc(x.player ? 'You' : x.name)}${x.status === 'retired' ? ' DNF' : x.status === 'finished' ? ' ✓' : ''}</div>`).join('');
    return `<div class="k">Position</div><div class="v" style="opacity:1">${ord(me?.place ?? 1)} / ${st.length}</div>
      <div class="row" style="font:600 13px 'JetBrains Mono',monospace">${me?.gapAhead != null ? `▲ ${gap(me.gapAhead)}` : ''} ${me?.gapBehind != null ? `▼ ${gap(me.gapBehind)}` : ''}</div>
      <div style="margin-top:6px">${rows}</div>`;
  }
  // the drivers' names over their cars (a setting)
  let labelEl = null;
  function labels() {
    const R = run?.race, show = R && hudSettings.names !== false && game.prefs?.npcNames !== false && hudSettings.visible;
    if (!show) { if (labelEl) labelEl.innerHTML = ''; return; }
    if (!labelEl) { labelEl = document.createElement('div'); labelEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;font:700 13px Barlow,system-ui,sans-serif;color:#fff;text-shadow:0 1px 4px #000'; document.body.appendChild(labelEl); }
    const st = R.standings();
    labelEl.innerHTML = R.npcs.map(r => {
      const at = game.screenOf(r);
      if (!at) return '';
      const s = st.find(x => x.id === r.id);
      return `<div style="position:absolute;left:${at.x}px;top:${at.y}px;transform:translate(-50%,-100%);white-space:nowrap;opacity:${Math.max(0.35, Math.min(1, 1.6 - at.dist / 160))}"><span style="color:${esc(r.profile.colour ?? '#fff')}">●</span> ${s?.place ?? ''}. ${esc(r.name)}</div>`;
    }).join('');
  }

  // ---------- screens: results, pause, confirmations ----------
  function showScreen(html, actions = {}) {
    hideScreen();
    screen = document.createElement('div'); screen.className = 'questScreen';
    screen.innerHTML = `<div class="box">${html}</div>`;
    screen.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; for (const [k, fn] of Object.entries(actions)) if (b.hasAttribute(`data-${k}`)) fn(); });
    document.body.appendChild(screen);
    return screen;
  }
  function hideScreen() { screen?.remove(); screen = null; }

  function results(res, { again = false } = {}) {
    if (!run) return;
    // (again: back from its replay — the same screen, not its fanfare)
    if (!again) { run.controller.showResults(); sounds.results(res); if (res.outcome.status === 'finished') hint('medal'); }
    const o = res.outcome, pay = res.pay ?? {}, cur = game.currency, item = run.item, prog = game.player.profile.quests?.[item.id];
    const money = n => `${cur}${Math.round(n).toLocaleString('en-GB')}`;
    const title = o.status === 'finished' ? (o.medal ? `<span class="medal" style="background:${MEDAL[o.medal]}"></span>${o.medal[0].toUpperCase()}${o.medal.slice(1)}` : 'Finished') : o.reason === 'wrecked' ? 'Wrecked' : o.status === 'dnf' ? 'Did not finish' : esc(o.text ?? 'Failed');
    const main = o.score != null && item.type === 'drift' ? `${o.score.toLocaleString('en-GB')} pts` : o.time != null ? fmtTime(o.time) : '—';
    const was = pay.was ? (item.type === 'drift' ? pay.was.score : pay.was.time) : null;
    const pb = o.status === 'finished' && pay.valid ? (pay.pb ? `<span class="good">Personal best${was != null ? ` (${pay.was?.older ? 'on the older version of this route: ' : 'was '}${item.type === 'drift' ? was.toLocaleString('en-GB') : fmtTime(was)})` : ''}</span>` : `Best: ${item.type === 'drift' ? (prog?.bestScore ?? 0).toLocaleString('en-GB') : fmtTime(prog?.bestTime)}`) : '';
    const splits = o.splits?.length ? `<h3>Splits</h3><table>${o.splits.map(s => `<tr><td>${o.laps.length > 1 ? `L${s.lap} ` : ''}CP ${s.number}</td><td>${fmtTime(s.time)}</td><td class="${s.delta == null ? '' : s.delta <= 0 ? 'good' : 'bad'}">${fmtDelta(s.delta)}</td></tr>`).join('')}</table>` : '';
    const laps = o.laps?.length > 1 ? `<h3>Laps</h3><table>${o.laps.map((t, i) => `<tr><td>Lap ${i + 1}</td><td class="${t === o.bestLap ? 'good' : ''}">${fmtTime(t)}${t === o.bestLap ? ' best' : ''}</td></tr>`).join('')}</table>` : '';
    const penalties = o.penalties?.length ? `<div class="bad">${o.penalties.map(p => `${esc(p.what)} +${p.seconds}s`).join(' · ')}</div>` : '';
    const repair = game.repairEstimate();
    const damage = `<h3>Damage</h3><div>${o.damage.taken > 0.05 ? `Condition −${o.damage.taken.toFixed(1)}% (${o.damage.events.length} hit${o.damage.events.length === 1 ? '' : 's'})` : 'No damage'}${o.cargo != null ? ` · cargo ${o.cargo}%` : ''}${repair > 0 ? ` · repairs about ${money(repair)}` : ''}</div>`;
    const earned = o.status !== 'finished' ? `<h3>Reward</h3><div>Nothing for a run that didn't finish${run.fee ? ` (entry ${money(run.fee)} spent)` : ''}.</div>`
      : !pay.valid ? `<h3>Reward</h3><div class="bad">This result couldn't be verified, so it pays nothing: ${esc((pay.problems ?? []).join(' '))}</div>`
        : `<h3>Reward</h3>${(pay.lines ?? []).map(l => `<div>${esc(l.what)}${l.money != null ? ` <span class="bad">${money(l.money)}</span>` : ''}</div>`).join('')}<div class="money">+${money(pay.money)} · +${pay.xp} xp</div>`
          + (pay.series ?? []).map(b => `<div class="good">Series complete: ${esc(b.name)} · +${money(b.money)} · +${b.xp} xp</div>`).join('')
          + (pay.levelUp ? `<div class="levelup">Level ${pay.levelUp}!${(() => { const t = (game.economy.quests.tiers ?? []).find(x => x.level === pay.levelUp); return t ? ` ${esc(t.name)} quests are open.` : ''; })()}</div>` : '')
          + (() => { const L = levelProgress(game.player.profile.xp ?? 0, cfg); return `<div style="font-size:12px;opacity:.8">Level ${L.level} · ${Math.round(L.share * 100)}% to level ${L.level + 1}</div>`; })();
    const itemFee = rewardsOf(item, game.economy).fee, fee = cfg.restart?.free || !itemFee ? '' : ` (${money(itemFee)})`;
    const field = res.field?.length ? `<h3>Standings</h3><table>${res.field.map(f => `<tr style="${f.player ? 'color:#ffd24a' : ''}"><td>${f.place}. ${esc(f.player ? 'You' : f.name)}${f.car ? ` <span style="opacity:.6">${esc(f.car)}</span>` : ''}</td><td>${f.status === 'retired' || f.status === 'dnf' ? `DNF${f.why ? ` (${esc(f.why)})` : ''}` : f.time != null ? `${fmtTime(f.time)}${f.estimated ? ' *' : ''}` : '—'}</td></tr>`).join('')}</table>${res.field.some(f => f.estimated) ? '<div style="font-size:12px;opacity:.7">* still racing when you finished: their time from their pace</div>' : ''}` : '';
    const pink = o.pinkSlip ? `<h3>Pink slip</h3><div class="${o.pinkSlip.won ? 'good' : 'bad'}">${o.pinkSlip.won ? `You won ${esc(o.pinkSlip.rival)}'s ${esc(game.db.cars[o.pinkSlip.car]?.name ?? o.pinkSlip.car)}: it's in your garage.` : `${esc(o.pinkSlip.rival)} takes your car.`}${o.pinkSlip.ok ? '' : ` (${esc(o.pinkSlip.error ?? 'it didn\'t go through')})`}</div>` : '';
    showScreen(`<h2>${title}${o.place ? ` · ${ord(o.place)}` : ''}</h2><div style="font:700 30px 'JetBrains Mono',monospace">${main}</div>${penalties}<div>${pb}</div>${field}${pink}${splits}${laps}${damage}${earned}
      ${trackLine(pay)}
      <div class="buttons"><button class="primary" data-retry>Retry${fee}</button>${game.canReplay?.() ? '<button data-replay>Watch replay</button>' : ''}<button data-roam>${game.leaveTrack ? 'Drive the track' : 'Free roam'}</button>${game.leaveTrack ? '<button data-leave>Back to the real world</button>' : ''}<button data-garage>${o.reason === 'wrecked' ? 'Tow to the garage' : 'Garage (repairs)'}</button></div>`, {
      retry: () => start(item, { restart: true }), roam: () => stop(),
      replay: () => { const me = run; hideScreen(); if (!game.watchReplay({ onEnd: () => { if (run === me) results(res, { again: true }); } })) results(res, { again: true }); }, leave: () => { stop(); game.leaveTrack(); }, garage: () => { stop(); game.leaveTrack ? game.leaveTrack().then(() => game.toGarage()) : game.toGarage(); } });
  }

  // (a generated track: its record for the car's class, and the event's leaderboard — track/events/records.js)
  function trackLine(pay) {
    const T = pay?.track, V = pay?.server;
    // (the server's: the record and the leaderboard every player shares)
    if (V && !V.error) {
      if (!V.accepted) return `<h3>Track record</h3><div class="bad">The server didn't count this run: ${esc(V.problems?.[0] ?? 'it didn\'t check out')}</div>`;
      const R = V.record, drift = R?.bestScore != null;
      return `<h3>Track record (class ${esc(R?.carClass ?? '?')})</h3><div>${V.pb ? '<span class="good">New personal record</span> · ' : ''}${drift ? `best ${Math.round(R.bestScore).toLocaleString('en-GB')} pts` : `best ${fmtTime(R?.bestTime)} · best lap ${fmtTime(R?.bestLap)}`}${V.board?.place ? ` · ${ord(V.board.place)} of ${V.board.of} on this event's leaderboard` : ''}${V.replayId ? ' · replay kept' : ''}</div>${pay.capped ? '<div class="bad">Quick race pay for this hour reached: this run paid less.</div>' : ''}`;
    }
    if (V?.error) return `<h3>Track record</h3><div class="bad">The run couldn't be handed to the server (${esc(V.error)}): it isn't on the leaderboard.</div>`;
    if (!T) return '';
    const R = T.record?.record, cap = pay.capped ? '<div class="bad">Quick race pay for this hour reached: this run paid less.</div>' : '';
    return `<h3>Track record (class ${esc(R?.carClass ?? '?')})</h3><div>${T.record?.pb ? '<span class="good">New track record</span> · ' : ''}best ${fmtTime(R?.bestTime)} · best lap ${fmtTime(R?.bestLap)}${T.board?.place ? ` · ${ord(T.board.place)} on this event's leaderboard` : ''}</div>${cap}`;
  }
  function pause(on) {
    if (!run || run.results) return;
    paused = on; game.pause(on);
    if (!on) { hideScreen(); return; }
    const cur = game.currency, runFee = rewardsOf(run.item, game.economy).fee, fee = cfg.restart?.free || !runFee ? 'free' : `${cur}${runFee.toLocaleString('en-GB')} entry again`;
    showScreen(`<h2>Paused</h2><div>${esc(run.item.name)} · ${esc(typeLabel(run.item.type))}</div>
      <div class="buttons"><button class="primary" data-resume>Resume</button><button data-restart>Restart (${esc(fee)})</button><button class="danger" data-quit>Quit (did not finish)</button>${game.leaveTrack ? '<button class="danger" data-leave>Quit and leave the track</button>' : ''}</div>
      <h3>Settings</h3><label>HUD size <input type="range" min="0.6" max="1.6" step="0.05" value="${hudScale()}" data-scale></label>
      <label><input type="checkbox" ${hudSettings.visible ? 'checked' : ''} data-visible> Show the race HUD</label>
      <label><input type="checkbox" ${hudSettings.names !== false ? 'checked' : ''} data-names> Drivers' names over their cars</label>
      <label><input type="checkbox" ${hudSettings.rubberBand !== false ? 'checked' : ''} data-rubber> Rubber-banding (rivals ease off or push a little by the gap to you; from the next race)</label>
      <div class="buttons"><button data-settings>All settings…</button></div>`, {
      resume: () => pause(false),
      restart: () => { pause(false); start(run.item, { restart: true }); },
      quit: async () => { pause(false); await run.controller.quit(); },
      leave: async () => { pause(false); await run.controller.quit(); stop(); game.leaveTrack(); },
      settings: () => game.openSettings(),
    });
    screen.querySelector('[data-scale]').oninput = e => { hudSettings.scale = +e.target.value; saveHudSettings(hudSettings); game.setPref?.('hudScale', +e.target.value); hud(); };
    screen.querySelector('[data-visible]').onchange = e => { hudSettings.visible = e.target.checked; saveHudSettings(hudSettings); hud(); };
    screen.querySelector('[data-names]').onchange = e => { hudSettings.names = e.target.checked; saveHudSettings(hudSettings); labels(); };
    screen.querySelector('[data-rubber]').onchange = e => { hudSettings.rubberBand = e.target.checked; saveHudSettings(hudSettings); };
  }

  function stop() {
    if (!run) return;
    const r = run; run = null; paused = false;
    if (r.controller.state === 'racing' || r.controller.state === 'countdown' || r.controller.state === 'intro') r.controller.quit();
    if (r.race) game.endRace(r.race);
    r.dressing.dispose(); r.adapters.dispose(); r.controller.dispose();
    if (r.ghost) game.showGhost?.(null);
    game.pause(false); hideScreen(); hud(); labels(); preview = null; setLines();
  }

  function onKey(e) {
    if (!run || game.replaying?.()) return;      // (the race replay's keys are its own)
    const st = run.controller.state;
    if (e.code === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (run.results) stop(); else pause(!paused);
    } else if (st === 'intro' && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); run.controller.skipIntro(); }
    else if (e.code === 'KeyT' || e.code === 'F2') e.stopImmediatePropagation();      // (not another world, mid-quest)
  }
  addEventListener('keydown', onKey, true);

  return {
    card, start, stop, pause, setGuide, clearGuide,
    get active() { return !!run; },
    get run() { return run; },
    // (paused: the pause menu — and the intro, when the camera's away and the car waits)
    get paused() { return paused || run?.controller.state === 'intro'; },
    get state() { return run?.controller.state ?? null; },
    get controller() { return run?.controller ?? null; },
    get hudSettings() { return hudSettings; },
    stateOf: id => questState(game.player.profile, id),
    // (fast travel: its route loaded before the car arrives, so it starts at once)
    preload: item => courseOf(item).catch(() => null),
    // the browser tests: the autopilot drives once it's GO
    get auto() { return !!run?.pilot && run.controller.state === 'racing' && !paused; },
    autoInput(dt) {
      const c = game.carNow();
      const cmd = run.pilot.drive({ x: c.x, z: c.z, fx: Math.sin(c.heading * Math.PI / 180), fz: Math.cos(c.heading * Math.PI / 180), speed: c.forward, dt });
      return { throttle: cmd.throttle, brake: cmd.brake, steer: cmd.steer, handbrake: false, device: 'wheel' };
    },
    // the hardest crash since the last physics tick (the drift's wall hits)
    noteHit(strength) { hit = Math.max(hit, strength); },
    takeHit() { const h = hit; hit = 0; return h; },
    resetNow() {
      const Q = run?.controller.session;
      if (!Q || Q.state.state !== 'racing' || w.spawning) return false;
      const point = Q.tracker.resetPoint();
      run.adapters.resetTo(point); Q.noteReset(point);
      say('Back to the last checkpoint', 'warn', 2);
      return true;
    },
    frame(realDt) {
      frameDt = realDt;
      restyle();
      if (!run) return;
      run.adapters.frame?.();
      const car = game.carNow();
      run.dressing.update(car.x, car.z);
      run.controller.frame(paused ? 0 : realDt);
      // the ghost: the best lap again, from each lap's start (a sprint's: from the start)
      if (run.ghost && game.showGhost) {
        const Q = run.controller.session?.state, racing = Q?.state === 'racing' && Q.t0 != null;
        const t = racing ? (run.ghost.perLap ? Q.clock - Q.lapTimes.reduce((a, b) => a + b, 0) : Q.clock) : -1;
        game.showGhost(racing ? ghostAt(run.ghost.frames, t) : null);
      }
      run.messageFor -= realDt; if (run.messageFor <= 0) run.message = null;
      hud(); labels();
    },
    // The quest's camera, after the game's own has been placed: the intro flies along the route, the
    // results circle the car, and every change between those and the game's camera (free roam, the race)
    // glides (play/cameraBlend.js). Returns whether it moved the camera
    camera(camera) {
      const st = run?.controller.state, dt = frameDt;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const own = { p: camera.position.toArray(), look: camera.position.clone().addScaledVector(fwd, 20).toArray(), fov: camera.fov };
      let source = 'roam', pose = own;
      if (st === 'intro') {
        const c = run.controller.introCamera();
        const p = S.world.localToWorld(new THREE.Vector3(c.x, c.y, c.z)), lk = S.world.localToWorld(new THREE.Vector3(c.lookX, c.lookY, c.lookZ));
        source = 'intro'; pose = { p: p.toArray(), look: lk.toArray(), fov: camera.fov };
      } else if (st === 'countdown' || st === 'racing') source = 'race';
      else if (run && (st === 'finished' || st === 'failed' || st === 'results') && run.results?.outcome.status !== 'dnf') {
        if (blend.source !== 'results') resultsT = 0;
        resultsT += dt;
        const car = w.car.position, e = new THREE.Euler().setFromQuaternion(w.car.quaternion, 'YXZ');
        source = 'results'; pose = orbitPose({ x: car.x, y: car.y, z: car.z, heading: e.y * 180 / Math.PI }, resultsT, orbit);
      }
      const out = blend.view(source, pose, dt);
      // (the game's own camera, not gliding: left as the game placed it, its roll and all)
      if (out === own) return false;
      camera.position.fromArray(out.p); camera.up.set(0, 1, 0); camera.lookAt(new THREE.Vector3().fromArray(out.look));
      if (out.fov && Math.abs(camera.fov - out.fov) > 0.01) { camera.fov = out.fov; camera.updateProjectionMatrix(); }
      return true;
    },
    dispose() { stop(); sounds.dispose(); removeEventListener('keydown', onKey, true); hudEl?.remove(); },
  };
}
