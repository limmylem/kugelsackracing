// Generated tracks in the game (Phase 5 Step 3): a race venue's card (driving up to one in the real world:
// its track events — each with its track, length, laps, rivals, stars, reward and the player's best), the
// track library (official, the day's and the week's tracks, recently played, favourites, a quick race from
// a preset, a code a friend shared: each with its preview map, length, corners, theme, difficulty, best
// times and medals; favourite it, play it again), the loading screen on the way in, and the way back to the
// real world. Going and coming back is play/trackTrip.js; the race itself the quests' own (play/questUi.js).
//
//   const U = createTrackUi({ game, trip, events: data/trackEvents.json, tracks: data/tracks.json, content })
//     game: questUi's game (player, economy, config, currency, carSummary, carInstanceId, say), and
//       go(event, { ghost }) → the trip there and the event started        leave() → back to the real world
//   U.venueCard(item, el) → drew it?      U.openLibrary(tab)  U.closeLibrary()  U.toggleLibrary()  (F4)
//   U.loading.show(title) / .progress(step, share) / .hide()   (the loading screen, with its fade)
//   U.frame(onTrack, busy)  the "back to the real world" button        U.dispose()

import { TYPES, rewardsOf } from '../content/quests.js';
import { starsText, difficultyOf } from '../quest/difficulty.js';
import { routeFeatures } from '../route/stats.js';
import { generateTrack } from '../track/generate.js';
import { dressTrack } from '../track/dress.js';
import { cornerNames } from '../track/names.js';
import { dailyTrack, weeklyTrack, quickTrack, sharedTrack, eventsFor, trackInfo, trackName, recordKey } from '../track/events/model.js';
import { decode } from '../track/code.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MEDAL = { gold: '#ffd24a', silver: '#cfd8e3', bronze: '#d08a4c' };
const fmt = t => t == null ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const CSS = `
#trackLoading{position:fixed;inset:0;z-index:90;background:#07090d;color:#f2f4f7;display:flex;align-items:center;justify-content:center;flex-direction:column;opacity:0;pointer-events:none;transition:opacity .45s ease;font:15px/1.5 Barlow,system-ui,sans-serif}
#trackLoading.on{opacity:1;pointer-events:auto}
#trackLoading h2{margin:0 0 4px;font-size:26px;letter-spacing:.02em}
#trackLoading .sub{opacity:.7;margin-bottom:18px}
#trackLoading .bar{width:min(420px,80vw);height:6px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden}
#trackLoading .bar i{display:block;height:100%;width:0;background:#ffb02e;transition:width .2s}
#trackLoading .step{margin-top:8px;font:12px "JetBrains Mono",monospace;opacity:.75}
#trackLibrary{position:fixed;inset:6vh 6vw;z-index:60;background:rgba(12,16,23,.96);color:#f2f4f7;border:1px solid rgba(255,255,255,.12);border-radius:14px;display:none;flex-direction:column;font:13px/1.45 Barlow,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.55)}
#trackLibrary.on{display:flex}
#trackLibrary header{display:flex;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);flex-wrap:wrap}
#trackLibrary header h3{margin:0 10px 0 0;font-size:18px}
#trackLibrary header button,#trackLibrary .row button,#trackLibrary .codebox button,#trackLibrary select{font:600 12px Barlow,system-ui,sans-serif;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:4px 10px;cursor:pointer}
#trackLibrary header button.on{background:#ffb02e;color:#111;border-color:#ffb02e}
#trackLibrary .body{overflow:auto;padding:8px 14px 14px;flex:1}
#trackLibrary .row{display:grid;grid-template-columns:120px 1fr auto;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07);align-items:center}
#trackLibrary .row svg{width:120px;height:80px;background:rgba(255,255,255,.04);border-radius:6px}
#trackLibrary .row h4{margin:0;font-size:15px}
#trackLibrary .row small{opacity:.75}
#trackLibrary .stars{color:#ffd166}
#trackLibrary .fav{background:none!important;border:0!important;font-size:18px!important;padding:0 4px!important;color:#ffd166}
#trackLibrary .ev{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
#trackLibrary .codebox{display:flex;gap:6px;margin:8px 0}
#trackLibrary .codebox input{font:13px "JetBrains Mono",monospace;flex:1;background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:7px;padding:5px 8px}
#trackLibrary .note{opacity:.7;font-size:12px}
#trackBack{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:45;font:600 13px Barlow,system-ui,sans-serif;color:#fff;background:rgba(14,18,26,.86);border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:6px 14px;cursor:pointer;display:none}
#contentCard .tev{border-top:1px solid rgba(255,255,255,.08);padding:6px 0}
#contentCard .tev b{font-size:14px}
#contentCard .tev .qbtn{margin-top:4px}`;

export function createTrackUi({ game, trip, events: E, tracks: TC, content = null }) {
  if (!document.getElementById('trackUiCss')) { const s = document.createElement('style'); s.id = 'trackUiCss'; s.textContent = CSS; document.head.appendChild(s); }
  const cur = () => game.currency ?? '$', money = n => `${cur()}${Math.round(n).toLocaleString('en-GB')}`;
  let ghostWanted = (() => { try { return localStorage.getItem('driveWorld.trackGhost') === '1'; } catch { return false; } })();

  // ---------- the loading screen ----------
  const load = document.createElement('div'); load.id = 'trackLoading';
  load.innerHTML = '<h2></h2><div class="sub"></div><div class="bar"><i></i></div><div class="step"></div>';
  document.body.appendChild(load);
  const fadeMs = (E.loading?.fadeSeconds ?? 0.45) * 1000;
  const loading = {
    show(title, sub = '') { load.querySelector('h2').textContent = title; load.querySelector('.sub').textContent = sub; loading.progress('', 0); load.classList.add('on'); return new Promise(r => setTimeout(r, fadeMs)); },
    progress(step, share) {
      const what = { track: 'Making the track', reference: 'Timing the AI reference laps (once per track)', cached: 'From this browser\'s cache' }[step] ?? step;
      load.querySelector('.bar i').style.width = `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
      load.querySelector('.step').textContent = what ? `${what}… ${Math.round(share * 100)}%` : '';
    },
    hide() { load.classList.remove('on'); return new Promise(r => setTimeout(r, fadeMs)); },
    get shown() { return load.classList.contains('on'); },
  };

  // ---------- what the player's done on a track ----------
  const profile = () => game.player.profile;
  const carClass = () => game.carSummary(game.carInstanceId())?.className ?? 'open';
  function bestOn(code) {
    const p = profile(), recs = Object.values(p.trackRecords ?? {}).filter(r => r.code === code);
    const mine = recs.find(r => r.carClass === carClass()) ?? null;
    const any = recs.reduce((a, r) => (r.bestLap != null && (a == null || r.bestLap < a.bestLap) ? r : a), null);
    return { mine, any };
  }
  const medalOf = id => profile().quests?.[id]?.medal ?? null;
  const isFav = code => (profile().trackFavs ?? []).some(x => x.code === code);

  // ---------- a track's preview map and what it's like (made once each) ----------
  const previews = new Map();
  function preview(code) {
    if (previews.has(code)) return previews.get(code);
    const p = new Promise(res => setTimeout(() => {
      try {
        const g = generateTrack({ code });
        if (!g.ok) return res(null);
        const T = g.track, xs = Array.from(T.x), zs = Array.from(T.z), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), s = Math.max(x1 - x0, z1 - z0) || 1;
        const pts = []; for (let i = 0; i < T.n; i += Math.max(1, Math.floor(T.n / 160))) pts.push(`${(6 + (T.x[i] - x0) / s * 108).toFixed(1)},${(6 + (T.z[i] - z0) / s * 68).toFixed(1)}`);
        const line = []; for (let i = 0; i < T.n; i += 4) line.push({ x: T.x[i], z: T.z[i], h: T.h[i], w: T.width });
        let s0 = 0; line.forEach((q, k) => { if (k) s0 += Math.hypot(q.x - line[k - 1].x, q.z - line[k - 1].z); q.s = s0; });
        const features = routeFeatures(line, { loop: T.closed });
        // (its notable corners, named: the same names the map and the track show — track/names.js)
        const corners = cornerNames(g, dressTrack(g, TC)), P = c => [(6 + (c.x - x0) / s * 108).toFixed(1), (6 + (c.z - z0) / s * 68).toFixed(1)];
        const dots = corners.slice(0, 4).map(c => { const [cx, cy] = P(c); return `<circle cx="${cx}" cy="${cy}" r="2.2" fill="#ffd166"><title>T${c.n} ${esc(c.name)}</title></circle>`; }).join('');
        res({ svg: `<svg viewBox="0 0 120 80"><polyline points="${pts.join(' ')}${T.closed ? ` ${pts[0]}` : ''}" fill="none" stroke="#ffb02e" stroke-width="2.2" stroke-linejoin="round"/><circle cx="${pts[0].split(',')[0]}" cy="${pts[0].split(',')[1]}" r="3" fill="#fff"/>${dots}</svg>`, info: trackInfo(g), features, corners });
      } catch { res(null); }
    }, 0));
    previews.set(code, p);
    return p;
  }
  // the difficulty a track's events ask (stars: quest/difficulty.js on its line, before its reference times)
  function starsOf(ev, features) {
    if (ev.rating?.stars) return ev.rating.stars;
    if (!features) return null;
    return difficultyOf(ev, { stats: { features }, loop: ev.track.layout !== 'p2p' }, { config: game.config }).stars;
  }

  // ---------- an event's line (the venue card and the library alike) ----------
  function eventLine(ev, features = null) {
    const T = TYPES[ev.type], r = rewardsOf({ ...ev, rating: ev.rating ?? { stars: starsOf(ev, features) ?? 2, km: (ev.track.km ?? 3) * (ev.track.layout === 'loop' ? Math.max(1, ev.params?.laps ?? 1) : 1) } }, game.economy);
    const laps = ev.track.layout !== 'p2p' && ev.params?.laps > 1 ? ` · ${ev.params.laps} laps` : '', rivals = ev.npc?.count ? ` · ${ev.npc.count} rivals` : ' · solo';
    const prog = profile().quests?.[ev.id], best = prog?.bestTime != null ? ` · best ${fmt(prog.bestTime)}` : '', m = medalOf(ev.id);
    const stars = starsOf(ev, features);
    return `<div class="tev"><b>${esc(ev.name)}</b> ${m ? `<span style="color:${MEDAL[m]}">●</span>` : ''}<br>
      <small>${esc(T?.label ?? ev.type)}${laps}${rivals}${ev.params?.start ? ` · ${esc(ev.params.start)} start` : ''}${ev.type === 'hot_lap' ? ` · medals for ${(ev.params?.mode ?? 'best_lap') === 'best_lap' ? 'the best lap' : 'the total'}` : ''}${best}</small><br>
      <small>${stars ? `<span class="stars">${starsText(stars)}</span> · ` : ''}reward up to ${money(r.money)} · ${r.xp} xp${r.fee ? ` · entry ${money(r.fee)}` : ' · free entry'}${ev.track.kind === 'quick' || ev.track.kind === 'shared' ? ' · capped each hour' : ''}</small><br>
      <button class="qbtn primary" data-go="${esc(ev.id)}">Race</button></div>`;
  }

  // ---------- a race venue's card ----------
  const eventCache = new Map();
  async function eventsOfVenue(v) {
    const out = [];
    for (const id of v.events ?? []) {
      if (!eventCache.has(id)) eventCache.set(id, content ? (await content.get(id, { view: 'published' })).item : null);
      const ev = eventCache.get(id);
      if (ev?.track && ev.enabled !== false) out.push(ev);
    }
    return out;
  }
  function venueCard(item, el) {
    if (item.kind !== 'venue') return false;
    el.innerHTML = `<div class="kind">Race venue</div><h4>${esc(item.name)}</h4>${item.description ? `<div>${esc(item.description)}</div>` : ''}<div class="evs"><small>Loading its events…</small></div>
      <div class="qbtns" style="margin-top:6px"><label style="font-size:12px"><input type="checkbox" data-ghost ${ghostWanted ? 'checked' : ''}> Race my best-lap ghost</label><span style="flex:1"></span><button class="qbtn" data-library>Track library</button><button class="qbtn" data-close>Close</button></div>`;
    el.querySelector('[data-library]').onclick = () => openLibrary('official');
    el.querySelector('[data-ghost]').onchange = e => setGhost(e.target.checked);
    eventsOfVenue(item).then(async list => {
      const box = el.querySelector('.evs');
      if (!box) return;
      if (!list.length) { box.innerHTML = '<small>No events here yet.</small>'; return; }
      const feats = await Promise.all(list.map(ev => preview(ev.track.code).then(p => p?.features ?? null)));
      const pv = await preview(list[0].track.code);
      box.innerHTML = `${pv ? `<div style="display:flex;gap:8px;align-items:center;margin:4px 0">${pv.svg.replace('<svg', '<svg style="width:96px;height:64px"')}<small>${esc(list[0].track.name ?? '')}<br>${pv.info.km} km · ${pv.info.corners} corners · ${esc(pv.info.theme ?? '')}${pv.corners?.length ? `<br>${pv.corners.slice(0, 3).map(c => esc(c.name)).join(' · ')}` : ''}</small></div>` : ''}${list.map((ev, k) => eventLine(ev, feats[k])).join('')}`;
      for (const b of box.querySelectorAll('[data-go]')) b.onclick = () => go(list.find(e => e.id === b.dataset.go));
    }).catch(e => { const box = el.querySelector('.evs'); if (box) box.innerHTML = `<small>The events couldn't be loaded: ${esc(e.message)}</small>`; });
    return true;
  }
  function setGhost(on) { ghostWanted = on; try { localStorage.setItem('driveWorld.trackGhost', on ? '1' : '0'); } catch { /* not kept */ } }

  async function go(ev) {
    if (!ev) return;
    closeLibrary();
    const r = await game.go(ev, { ghost: ghostWanted });
    if (r && !r.ok) game.say?.(r.error ?? 'Couldn\'t go to the track', 'warn');
  }

  // ---------- the track library ----------
  const lib = document.createElement('div'); lib.id = 'trackLibrary'; document.body.appendChild(lib);
  let tab = 'official', shown = [];   // shown: [{ track, events }]
  const TABS = [['official', 'Official'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['recent', 'Recent'], ['favourites', 'Favourites'], ['quick', 'Quick race'], ['code', 'Friend\'s code']];
  async function officialTracks() {
    if (!content) return [];
    // (the venues in the baked regions — the finder's way: play/questFinder.js loadVenues)
    const near = game.venues ? await game.venues() : (await content.query({ ...(game.where?.() ?? { lat: 0, lon: 0 }), km: 300, view: 'published', kinds: ['venue'], limit: 500 })).items.map(x => x.item);
    const by = new Map();
    for (const v of near) for (const ev of await eventsOfVenue(v)) { const k = ev.track.code; if (!by.has(k)) by.set(k, { track: { ...ev.track, venue: v.name }, events: [] }); by.get(k).events.push(ev); }
    return [...by.values()];
  }
  function generated(t) { return { track: { code: t.code, kind: t.kind, name: t.name, key: t.key, info: t.info, version: t.version, layout: t.info.layout, km: t.info.km, corners: t.info.corners, theme: t.info.theme }, events: eventsFor(t, E) }; }
  // (a code's events by its kind: a quick race's or a shared code's; an official one's from the venues)
  async function byCode(code, kind = 'shared') {
    if (kind === 'official') { const o = (await officialTracks()).find(x => x.track.code === code); if (o) return o; }
    if (kind === 'daily' || kind === 'weekly') { const t = kind === 'daily' ? dailyTrack(new Date(), E, TC) : weeklyTrack(new Date(), E, TC); if (t.code === code) return generated(t); }
    const t = sharedTrack(code); t.kind = kind === 'quick' ? 'quick' : 'shared';
    return generated(t);
  }
  async function listFor(which) {
    if (which === 'official') return officialTracks();
    if (which === 'daily') return [generated(dailyTrack(new Date(), E, TC))];
    if (which === 'weekly') return [generated(weeklyTrack(new Date(), E, TC))];
    if (which === 'recent' || which === 'favourites') {
      const list = which === 'recent' ? profile().trackRecent ?? [] : profile().trackFavs ?? [], out = [];
      for (const x of list) { try { out.push(await byCode(x.code, x.kind)); } catch { /* a code this game can't make */ } }
      return out;
    }
    return [];
  }
  function trackRow({ track, events }, k) {
    const B = bestOn(track.code), d = (() => { try { return decode(track.code); } catch { return null; } })();
    const medals = events.map(e => medalOf(e.id)).filter(Boolean);
    return `<div class="row" data-k="${k}"><div class="pv" data-code="${esc(track.code)}"><svg viewBox="0 0 120 80"></svg></div>
      <div><h4>${esc(track.name ?? trackName(d?.seed ?? 0, { theme: track.theme, layout: track.layout }))} <button class="fav" data-fav="${k}" title="Favourite">${isFav(track.code) ? '★' : '☆'}</button></h4>
        <small class="meta">${esc(track.kind)}${track.venue ? ` · ${esc(track.venue)}` : ''}${track.key ? ` · ${esc(track.key)}` : ''} · <span class="info">…</span></small><br>
        <small>Your best: ${B.mine ? `${fmt(B.mine.bestTime)} (lap ${fmt(B.mine.bestLap)}, class ${esc(B.mine.carClass)})` : B.any ? `lap ${fmt(B.any.bestLap)} (class ${esc(B.any.carClass)})` : 'not raced yet'}${medals.length ? ` · ${medals.map(m => `<span style="color:${MEDAL[m]}">●</span>`).join('')}` : ''}</small>
        <div class="ev">${events.map(e => `<button data-ev="${esc(e.id)}" title="${esc(TYPES[e.type]?.blurb ?? '')}">${esc(TYPES[e.type]?.label ?? e.type)}${e.npc?.count ? ` · ${e.npc.count} rivals` : ''}${e.params?.laps > 1 && e.track.layout !== 'p2p' ? ` · ${e.params.laps} laps` : ''}</button>`).join('')}</div>
        <small class="note">Code <b style="font-family:'JetBrains Mono',monospace;user-select:all">${esc(track.code)}</b></small></div>
      <div>${profile().trackRecent?.[0]?.code === track.code && profile().trackRecent[0].eventId ? '<button data-again>Play again</button>' : ''}</div></div>`;
  }
  async function render() {
    lib.innerHTML = `<header><h3>Track library</h3>${TABS.map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`).join('')}<span style="flex:1"></span>
      <label style="font-size:12px"><input type="checkbox" data-ghost ${ghostWanted ? 'checked' : ''}> Best-lap ghost</label><button data-closelib>Close (F4)</button></header><div class="body"><small>Loading…</small></div>`;
    const body = lib.querySelector('.body');
    lib.querySelector('[data-ghost]').onchange = e => setGhost(e.target.checked);
    if (tab === 'code') {
      body.innerHTML = `<p class="note">A friend's track code makes the exact same track (and the same hash: a result on it is theirs to compare). Its events are a quick race's.</p><div class="codebox"><input data-code placeholder="e.g. 08028-CG81C-D1K00-02R00-0003M-8" spellcheck="false"><button data-load>Load</button></div><div class="res"></div>`;
      const run = async () => { const v = body.querySelector('[data-code]').value.trim().toUpperCase(); try { shown = [await byCode(v, 'shared')]; body.querySelector('.res').innerHTML = shown.map(trackRow).join(''); fill(body); } catch (e) { body.querySelector('.res').innerHTML = `<p class="note">That code doesn't make a track: ${esc(e.message)}</p>`; } };
      body.querySelector('[data-load]').onclick = run;
      body.querySelector('[data-code]').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') run(); };
      return;
    }
    if (tab === 'quick') {
      body.innerHTML = `<p class="note">A random track from a preset: lower rewards (and capped each hour) — for fun and practice.</p><div class="codebox"><select data-preset>${TC.presets.map(p => `<option value="${esc(p.id)}">${esc(p.id.replace(/_/g, ' '))}</option>`).join('')}</select><button data-roll>Random track</button></div><div class="res"></div>`;
      body.querySelector('[data-roll]').onclick = () => {
        const t = quickTrack(body.querySelector('[data-preset]').value, (Math.random() * 2 ** 32) >>> 0, TC);
        shown = [generated(t)];
        body.querySelector('.res').innerHTML = shown.map(trackRow).join(''); fill(body);
      };
      return;
    }
    try { shown = await listFor(tab); } catch (e) { body.innerHTML = `<p class="note">Couldn't list them: ${esc(e.message)}</p>`; return; }
    if (tab !== (lib.querySelector('header .on')?.dataset.tab)) return;
    const extra = tab === 'daily' ? '<p class="note">Today\'s track (UTC): the same for every player, a new one tomorrow. Its own leaderboard.</p>' : tab === 'weekly' ? '<p class="note">This week\'s track (ISO week, UTC): the same for everyone until Monday. Its own leaderboard.</p>' : '';
    body.innerHTML = extra + (shown.length ? shown.map(trackRow).join('') : `<p class="note">${tab === 'official' ? 'No official tracks published yet.' : tab === 'recent' ? 'No tracks played yet.' : 'No favourites yet: ☆ a track to keep it here.'}</p>`) + (['daily', 'weekly', 'official'].includes(tab) ? boards() : '');
    fill(body);
  }
  // the local leaderboards of what's shown (official, daily, weekly events)
  function boards() {
    const rows = [];
    for (const { events } of shown) for (const e of events) {
      const b = profile().trackBoards?.[e.id] ?? [];
      if (b.length) rows.push(`<div style="margin-top:8px"><b>${esc(e.name)}</b> — your best runs<br>${b.slice(0, 5).map((r, i) => `<small>${i + 1}. ${e.type === 'drift' ? `${(r.score ?? 0).toLocaleString('en-GB')} pts` : fmt(r.rank ?? r.time)}${r.place ? ` · P${r.place}` : ''}${r.medal ? ` <span style="color:${MEDAL[r.medal]}">●</span>` : ''} · ${esc(r.car?.carId ?? '')} (${esc(r.car?.className ?? '?')}) · ${esc(String(r.at ?? '').slice(0, 10))}</small>`).join('<br>')}</div>`);
    }
    return rows.length ? `<h4 style="margin:14px 0 2px">Leaderboards (this device)</h4>${rows.join('')}` : '';
  }
  function fill(body) {
    for (const el of body.querySelectorAll('.row')) {
      const k = +el.dataset.k, item = shown[k];
      preview(item.track.code).then(p => {
        if (!p) return;
        el.querySelector('.pv').innerHTML = p.svg;
        const stars = Math.max(0, ...item.events.map(e => starsOf(e, p.features) ?? 0));
        el.querySelector('.info').innerHTML = `${p.info.km} km · ${p.info.corners} corners · ${esc(p.info.theme ?? '')} · ${p.info.layout === 'loop' ? 'circuit' : 'point to point'}${stars ? ` · <span class="stars">${starsText(stars)}</span>` : ''}${p.corners?.length ? `<br>Notable: ${p.corners.slice(0, 4).map(c => `T${c.n} ${esc(c.name)}`).join(' · ')}` : ''}`;
      });
    }
  }
  lib.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
    if (b.hasAttribute('data-closelib')) { closeLibrary(); return; }
    const row = b.closest('.row'), item = row ? shown[+row.dataset.k] : null;
    if (b.dataset.fav != null && item) { const on = !isFav(item.track.code); await game.player.favouriteTrack({ code: item.track.code, kind: item.track.kind, name: item.track.name }, on); b.textContent = on ? '★' : '☆'; return; }
    if (b.dataset.ev && item) go(item.events.find(x => x.id === b.dataset.ev));
    if (b.hasAttribute('data-again') && item) { const last = profile().trackRecent[0]; go(item.events.find(x => x.id === last.eventId) ?? item.events[0]); }
  });
  function openLibrary(which = tab) { tab = which; lib.classList.add('on'); game.pause?.(true); render(); }
  function closeLibrary() { if (!lib.classList.contains('on')) return; lib.classList.remove('on'); game.pause?.(false); }
  const toggleLibrary = () => lib.classList.contains('on') ? closeLibrary() : openLibrary();
  const onKey = e => {
    if (e.target?.tagName === 'INPUT' || e.repeat) return;
    if (e.code === 'F4' && !game.busy?.()) { e.preventDefault(); toggleLibrary(); }
    else if (e.code === 'Escape' && lib.classList.contains('on')) { e.preventDefault(); e.stopImmediatePropagation(); closeLibrary(); }
  };
  addEventListener('keydown', onKey, true);

  // ---------- on a track: the way back ----------
  const back = document.createElement('button'); back.id = 'trackBack'; back.textContent = '⟵ Back to the real world';
  back.onclick = () => { back.blur(); game.leave(); };
  document.body.appendChild(back);

  return {
    venueCard, openLibrary, closeLibrary, toggleLibrary, loading, go, byCode,
    get libraryOpen() { return lib.classList.contains('on'); },
    get ghostWanted() { return ghostWanted; },
    frame(onTrack, busy) { back.style.display = onTrack && !busy && !loading.shown ? 'block' : 'none'; },
    dispose() { removeEventListener('keydown', onKey, true); load.remove(); lib.remove(); back.remove(); },
  };
}

export { recordKey };
