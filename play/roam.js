// Multiplayer free roam in the game (Phase 7 Step 4; docs/FREE_ROAM.md): driving the real world with everyone else.
// The zones and handoffs are mp/roamClient.js's; the cars are drawn by Step 1's play/multiplayer.js (through a "net" made of
// the zones: each car once, its level of detail by distance, names fading with distance, cars fading in and out at the edge
// of what's seen); car-to-car contact (Step 3's contact client) with the players you touch — both with contact on, or your
// party; and the free-roam screen (F6): who's near (inspect, challenge, report, block, mute), friends and the party (join a
// friend wherever they are, challenge the party, race a quest together), your settings (privacy, names, nearby chat, contact,
// passive mode), car meets (scheduled ones with a countdown, parking at a meet spot, emotes, photo mode), and chat (nearby,
// party, the quick chat wheel). Challenges arrive as a prompt with the route on the maps; a challenge shows its rolling
// start, checkpoints and results. Coming back: where you left (the API), or the garage.
//
//   const R = await startRoam({ account, region, cfg, mpCfg, adapter, look, player, netsim, serverNetsim, debug, S, game })
//     S: the hub session (mp/client.js) — placing, friends, the party, join friend, party chat
//     game: { regionId(), carPose() → { pos [x, y, z] world frame, headingDeg, speed }, place(pos, headingDeg), switchRegion(id),
//             maps(), latLonOf(x, z), xzOf(lat, lon), say(text, kind), photoMode(on), questsNear() → [{ id, name, route, x, z }],
//             sim(), simTime(), carPhysics(), toSim, toWorld, contactHit, contactEffect, setOpacity(handle, a), horn() }
//   R.M (play/multiplayer.js's api: frame, crash, part, reset, repair, setLook, overlay, others, toNearest)
//   R.frame(dt)  every frame after R.M.frame   R.flash(on)  your headlights flashed (held)   R.horn()   R.leave()

import { joinMultiplayer, ticketGetter, rtEndpoint } from './multiplayer.js';
import { createRoamClient } from '../mp/roamClient.js';
import { lodFor, nameOpacity, meetEventState } from '../mp/roam.js';
import { createContactClient } from '../mp/contactClient.js';
import { createColyseusTransport } from '../net/transport.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const km = m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

const CSS = `
#roamHud { position: fixed; left: 14px; bottom: 14px; z-index: 46; font: 600 12px/1.35 Barlow, system-ui, sans-serif; color: #f2f4f7; background: rgba(14, 18, 26, .82); border: 1px solid rgba(255,255,255,.1); border-radius: 10px; padding: 6px 10px; display: flex; gap: 8px; align-items: center; }
#roamHud button { font: inherit; color: inherit; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); border-radius: 7px; padding: 3px 8px; cursor: pointer; }
#roamHud .tag { font: 700 10px "JetBrains Mono", monospace; letter-spacing: .06em; padding: 2px 6px; border-radius: 6px; background: #2b3444; }
#roamHud .tag.contact { background: #7a3b1e; } #roamHud .tag.passive { background: #1e4f7a; } #roamHud .tag.ghosted { background: #6b1e1e; }
#roamPanel { position: fixed; right: 14px; top: min(64px, 6vh); bottom: min(90px, 12vh); width: min(400px, 94vw); z-index: 60; color: #f2f4f7; background: rgba(14, 18, 26, .95); border: 1px solid rgba(255,255,255,.1); border-radius: 12px; font: 13px/1.45 Barlow, system-ui, sans-serif; display: none; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
#roamPanel.open { display: flex; }
#roamPanel nav { display: flex; gap: 2px; padding: 8px 8px 0; flex-wrap: wrap; }
#roamPanel nav button { flex: 1; font: 600 12px Barlow, system-ui, sans-serif; color: #c9d1d9; background: transparent; border: 0; border-bottom: 2px solid transparent; padding: 6px 4px; cursor: pointer; }
#roamPanel nav button.on { color: #fff; border-bottom-color: #ffb02e; }
#roamPanel .body { overflow: auto; padding: 10px 12px; flex: 1; }
#roamPanel h4 { margin: 10px 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #9aa4b2; }
#roamPanel .row { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
#roamPanel .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#roamPanel .muted { color: #8b949e; font-size: 12px; }
#roamPanel button.s { font: 600 11px Barlow, system-ui, sans-serif; color: #f2f4f7; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 3px 7px; cursor: pointer; }
#roamPanel button.s:hover { background: rgba(255,255,255,.16); }
#roamPanel button.s.go { background: #2f6f3e; border-color: #3f8f52; }
#roamPanel button.s.warn { background: #6b2a24; border-color: #8a3a32; }
#roamPanel label.opt { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
#roamPanel .badge { font: 700 9px "JetBrains Mono", monospace; padding: 1px 5px; border-radius: 5px; background: #2b3444; }
#roamPanel .badge.friend { background: #1f5c3a; } #roamPanel .badge.party { background: #4a2f74; }
#roamPanel .chatlog { height: 180px; overflow: auto; background: rgba(0,0,0,.25); border-radius: 8px; padding: 6px; font-size: 12px; }
#roamPanel input[type=text], #roamPanel select { font: 13px Barlow, system-ui, sans-serif; color: #fff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); border-radius: 7px; padding: 5px 7px; }
#roamPrompt { position: fixed; left: 50%; top: min(80px, 8vh); transform: translateX(-50%); z-index: 70; width: min(440px, 92vw); max-height: calc(100vh - 2 * min(80px, 8vh)); overflow: auto; box-sizing: border-box; color: #f2f4f7; background: rgba(14, 18, 26, .96); border: 1px solid rgba(255,176,46,.5); border-radius: 12px; padding: 12px 14px; font: 13px/1.45 Barlow, system-ui, sans-serif; display: none; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
#roamPrompt h3 { margin: 0 0 4px; font-size: 17px; }
#roamPrompt .actions { display: flex; gap: 8px; margin-top: 10px; }
#roamPrompt button { flex: 1; font: 700 13px Barlow, system-ui, sans-serif; color: #fff; border: 0; border-radius: 8px; padding: 8px; cursor: pointer; background: #3a4352; }
#roamPrompt button.go { background: #2f8f4e; }
#roamChallenge { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); z-index: 58; color: #fff; background: rgba(14, 18, 26, .88); border-radius: 10px; padding: 6px 14px; font: 700 15px Barlow, system-ui, sans-serif; display: none; text-align: center; }
#roamWheel { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 72; width: 300px; height: 300px; display: none; }
#roamWheel button { position: absolute; width: 104px; transform: translate(-50%, -50%); font: 700 12px Barlow, system-ui, sans-serif; color: #fff; background: rgba(14, 18, 26, .9); border: 1px solid rgba(255,255,255,.2); border-radius: 18px; padding: 8px 6px; cursor: pointer; }
#roamWheel button:hover { background: #2f6f3e; }
#roamToasts { position: fixed; left: 14px; bottom: 60px; z-index: 47; display: flex; flex-direction: column; gap: 4px; pointer-events: none; font: 600 12px/1.35 Barlow, system-ui, sans-serif; }
#roamToasts div { color: #fff; background: rgba(14, 18, 26, .8); border-radius: 8px; padding: 4px 9px; max-width: 360px; }
body.roamPhoto #roamHud, body.roamPhoto #roamToasts, body.roamPhoto #worldMini, body.roamPhoto #krMpBanner { display: none !important; }
`;

// the zones as one "net" for Step 1's drawing (play/multiplayer.js): each car once (a stable id per player), the home
// zone's status, every zone's events (by player), the home zone's numbers for the overlay
export function roamNet(RC) {
  const L = { status: new Set(), roster: new Set(), event: new Set(), notice: new Set() };
  const emit = (k, v) => { for (const f of L[k]) { try { f(v); } catch (e) { console.warn(e); } } };
  const players = new Map(), ids = new Map(), looks = new Map();
  let last = [];
  RC.on('status', s => { if (s.zone === RC.home) emit('status', { status: s.status, message: s.message ?? '' }); });
  RC.on('event', e => { const id = e.uid ? ids.get(e.uid) : null; if (id) emit('event', { ...e, from: id }); });
  const home = () => RC.homeNet;
  return {
    update(dt, local) { RC.update(dt, local); },
    sample(dt) {
      last = RC.sample(dt);
      players.clear();
      for (const o of last) { if (o.uid) ids.set(o.uid, o.id); if (!o.leaving && o.uid) looks.set(o.uid, { name: o.name, look: o.look, events: o.events }); players.set(o.id, { id: o.id, uid: o.uid, name: o.name, status: o.status ?? 'here', base: o.pose ? true : null, lastStateAt: o.pose ? performance.now() : -Infinity }); }
      // (a car leaving view keeps its look as it fades: the drawing would otherwise make it afresh)
      for (const uid of [...looks.keys()]) if (!last.some(o => o.uid === uid)) looks.delete(uid);
      return last.filter(o => !o.leaving || o.pose).map(o => o.leaving ? { ...o, ...(looks.get(o.uid) ?? {}) } : o);
    },
    sendEvent(ev) { RC.sendEvent(ev); },
    setLook(look, events) { RC.setLook(look, events); },
    on(k, fn) { L[k]?.add(fn); return () => L[k]?.delete(fn); },
    leave() { return RC.leave(); },
    roomNow: () => home()?.roomNow() ?? 0,
    stampAt: () => home()?.stampAt() ?? 0,
    present: (id, maxMs, t) => { const uid = [...ids].find(([, v]) => v === id)?.[0]; const p = uid && RC.player(uid); return p ? p.net.present(p.id, maxMs, p.net === home() ? t : undefined) : null; },
    setNear(id, n, maxMs) { const uid = [...ids].find(([, v]) => v === id)?.[0]; const p = uid && RC.player(uid); p?.net.setNear(p.id, n, maxMs); },
    setNudge(id, d) { const uid = [...ids].find(([, v]) => v === id)?.[0]; const p = uid && RC.player(uid); p?.net.setNudge(p.id, d); },
    get id() { return 0; },
    get status() { return home()?.status ?? 'connecting'; },
    get message() { return home()?.message ?? ''; },
    get conn() { return { roomId: home()?.conn?.roomId ?? null }; },
    get players() { return players; },
    get stats() { const s = home()?.stats ?? { status: 'connecting', ping: 0, jitter: 0, loss: 0, upKBs: 0, downKBs: 0, bufferMs: 0, remotes: [], netsim: null }; const r = RC.stats; return { ...s, upKBs: r.upKBs, downKBs: r.downKBs, zones: r.zones, handoffs: r.handoffs }; },
    get last() { return last; },
  };
}

export async function startRoam({ account, region, cfg, mpCfg, adapter: A, look, player = null, netsim = null, serverNetsim = null, debug = false, S, game }) {
  if (!document.getElementById('roamCss')) { const st = document.createElement('style'); st.id = 'roamCss'; st.textContent = CSS; document.head.appendChild(st); }
  const Colyseus = await import('../net/vendor/colyseus.js');
  const transport = createColyseusTransport(Colyseus);
  const getTicket = ticketGetter(account, player);
  const RC = createRoamClient({ transport, getTicket, hub: () => S, region, cfg, look, netsim, serverNetsim });
  const N = roamNet(RC);
  const myUid = () => state.you ?? S.myUid;
  const state = { you: null, settings: { ...cfg.privacy.default }, touch: { with: [], passive: false, contact: false, ghostUntil: 0, challenge: null }, map: [], chat: [], muted: new Set(), invite: null, run: null, meet: null, flash: false, zones: [] };
  const offs = [];
  // your saved place (the API's: the account signed in — not a development ?player=), before joining: start there
  let back = null;
  if (!player && account?.me) { try { back = await account.api.get('/roam/me'); } catch { back = null; } }
  const pose = game.carPose();
  await RC.start(pose?.pos ?? [0, 0, 0]);
  const M = await joinMultiplayer({ account, world: `roam:${region}`, look, adapter: A, player, debug, net: N, spread: false,
    lod: (o, d) => lodFor(d, cfg), nameOpacity: (o, d) => state.settings.names === false ? 0 : nameOpacity(d, cfg) });

  // (the page closed or reloaded: gone from every zone now, not "reconnecting…" for the next 20 s)
  const bye = () => { void RC.leave(); };
  addEventListener('pagehide', bye);
  // (leaving the drawing leaves free roam: the zones, the screens)
  const leaveDraw = M.leave;
  M.leave = () => api.leave();

  // ---------- the screens ----------
  const hud = document.createElement('div'); hud.id = 'roamHud';
  const panel = document.createElement('div'); panel.id = 'roamPanel';
  const prompt = document.createElement('div'); prompt.id = 'roamPrompt';
  const banner = document.createElement('div'); banner.id = 'roamChallenge';
  const wheel = document.createElement('div'); wheel.id = 'roamWheel';
  const toasts = document.createElement('div'); toasts.id = 'roamToasts';
  for (const el of [hud, panel, prompt, banner, wheel, toasts]) document.body.appendChild(el);
  const toast = (text, ms = 5000) => { const d = document.createElement('div'); d.textContent = text; toasts.appendChild(d); setTimeout(() => d.remove(), ms); while (toasts.children.length > 5) toasts.firstChild.remove(); };
  const say = (text, kind = 'ok') => game.say?.(text, kind);
  let tab = 'near', panelAt = 0;
  panel.innerHTML = `<nav>${[['near', 'Nearby'], ['friends', 'Friends'], ['meets', 'Meets'], ['chat', 'Chat'], ['settings', 'Settings']].map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</nav><div class="body"></div>`;
  const body = panel.querySelector('.body');
  panel.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.tab) { tab = b.dataset.tab; render(); return; } act(b.dataset, b); });
  panel.addEventListener('change', e => { const el = e.target; if (el.dataset.set) setSetting(el.dataset.set, el.type === 'checkbox' ? el.checked : el.value); });
  panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.id === 'roamChatIn') sendChat(); });
  const open = on => { panel.classList.toggle('open', on); if (on) render(); };
  const isOpen = () => panel.classList.contains('open');

  function relOf(uid) { if (state.partyUids?.has(uid)) return 'party'; if (S.friends?.some(f => f.id === uid)) return 'friend'; return 'other'; }
  function nearList() {
    const me = game.carPose(); if (!me) return [];
    return N.last.filter(o => o.pose && !o.leaving).map(o => ({ uid: o.uid, name: o.name ?? 'Driver', d: Math.hypot(o.pose.pos[0] - me.pos[0], o.pose.pos[2] - me.pos[2]), rel: relOf(o.uid), touch: state.touch.with.includes(o.uid) })).sort((a, b) => a.d - b.d);
  }
  function render() {
    for (const b of panel.querySelectorAll('nav button')) b.classList.toggle('on', b.dataset.tab === tab);
    const T = state.touch, st = state.settings;
    if (tab === 'near') {
      const list = nearList().slice(0, 30);
      body.innerHTML = `<div class="muted">Zone ${esc(RC.home)} · instance ${esc(RC.group ?? '–')} · ${RC.zones.length} zone${RC.zones.length === 1 ? '' : 's'} joined · ${list.length} car${list.length === 1 ? '' : 's'} in view</div>
        ${T.challenge ? '<div class="muted">You\'re in a challenge: everyone else is a ghost to you.</div>' : ''}
        ${list.map(p => `<div class="row"><span class="name">${esc(p.name)} ${p.rel !== 'other' ? `<span class="badge ${p.rel}">${p.rel}</span>` : ''} ${p.touch ? '<span class="badge">contact</span>' : ''}</span><span class="muted">${km(p.d)}</span>
          <button class="s" data-a="inspect" data-uid="${esc(p.uid)}">Inspect</button>
          <button class="s go" data-a="challenge" data-uid="${esc(p.uid)}">Challenge</button>
          <button class="s" data-a="more" data-uid="${esc(p.uid)}">⋯</button></div>
          ${state.more === p.uid ? `<div class="row"><span class="name muted">Challenge to:</span><button class="s" data-a="ch" data-type="sprint" data-uid="${esc(p.uid)}">Sprint somewhere</button><button class="s" data-a="ch" data-type="quest" data-uid="${esc(p.uid)}">A quest marker</button><button class="s" data-a="ch" data-type="follow" data-uid="${esc(p.uid)}">Follow me</button></div>
          <div class="row"><button class="s" data-a="friend" data-uid="${esc(p.uid)}">Add friend</button><button class="s" data-a="mute" data-uid="${esc(p.uid)}">${state.muted.has(p.uid) ? 'Unmute' : 'Mute'}</button><button class="s warn" data-a="block" data-uid="${esc(p.uid)}">Block</button><button class="s warn" data-a="report" data-uid="${esc(p.uid)}">Report</button></div>` : ''}`).join('') || '<div class="muted">Nobody near you right now. Friends\' places are on the map (Tab).</div>'}
        <h4>Your horn and lights</h4><div class="muted">Hold <b>,</b> to flash your headlights (twice at the car ahead challenges it) · <b>'</b> the horn · <b>\`</b> the quick chat wheel · <b>Enter</b> chat</div>`;
    }
    if (tab === 'friends') {
      const fr = S.friends ?? [], party = S.party;
      body.innerHTML = `<h4>Friends</h4>${fr.map(f => `<div class="row"><span class="name">${esc(f.name)} <span class="muted">${f.online ? esc(f.state) : 'offline'}${f.roam ? ` · ${esc(f.roam.region)}` : ''}</span></span>
          ${f.roam ? `<button class="s go" data-a="join" data-uid="${esc(f.id)}">Join</button>` : ''}${party && party.leader === myUid() && !party.members.includes(f.id) && f.online ? `<button class="s" data-a="pinvite" data-uid="${esc(f.id)}">Invite to party</button>` : ''}</div>`).join('') || '<div class="muted">No friends yet: add someone from Nearby, or the multiplayer menu (F7).</div>'}
        <h4>Party</h4>${party ? `<div class="muted">${party.members.map(u => esc(party.names?.[u] ?? u)).join(', ')}</div>
          <div class="row"><button class="s go" data-a="pchallenge" data-type="sprint">Challenge the party: sprint</button><button class="s go" data-a="pchallenge" data-type="follow">Follow me</button></div>
          <div class="row"><button class="s go" data-a="coop">Race the nearest quest together</button><label class="opt"><input type="checkbox" id="roamCoopNpc"> with NPCs</label></div>
          <div class="row"><button class="s warn" data-a="pleave">Leave the party</button></div>` : '<div class="row"><button class="s" data-a="pcreate">Make a party</button></div>'}`;
    }
    if (tab === 'meets') {
      const ev = state.meets ?? [];
      body.innerHTML = `<h4>Car meets</h4>${ev.map(e => `<div class="row"><span class="name">${esc(e.title)} <span class="muted">${esc(e.place?.name ?? '')}</span></span><span class="muted">${e.state === 'live' ? 'on now' : `in ${countdown(e.startsInSec)}`}</span>${e.place ? `<button class="s" data-a="meetgo" data-id="${esc(e.id)}">Go</button>` : ''}</div>`).join('') || '<div class="muted">No meets scheduled. Admins make them on the admin page.</div>'}
        <h4>At a meet spot</h4>${state.meetHere ? `<div class="muted">${esc(state.meetHere.name)}${state.meet ? ` · parked in spot ${state.meet.spot.n}` : ''}</div>
          <div class="row"><button class="s go" data-a="park">Park</button><button class="s" data-a="photo">Photo mode</button></div>
          <div class="row">${cfg.meets.emotes.map(e => `<button class="s" data-a="emote" data-id="${e.id}">${esc(e.id)}</button>`).join('')}</div>` : '<div class="muted">Drive to a meet spot (on the map) to park, take photos and look at the cars.</div>'}`;
    }
    if (tab === 'chat') {
      body.innerHTML = `<div class="chatlog">${state.chat.filter(m => !state.muted.has(m.uid)).slice(-60).map(m => `<div><span class="muted">${m.scope === 'party' ? '[party] ' : ''}${esc(m.name)}:</span> ${esc(m.text)}</div>`).join('')}</div>
        <div class="row"><select id="roamChatScope"><option value="nearby">Nearby</option><option value="party">Party</option></select><input type="text" id="roamChatIn" maxlength="${cfg.chat.maxLength}" placeholder="Say something" style="flex:1"><button class="s go" data-a="send">Send</button></div>
        <div class="row">${cfg.chat.wheel.map(w => `<button class="s" data-a="wheel" data-id="${w.id}">${esc(w.text)}</button>`).join('')}</div>`;
      const log = body.querySelector('.chatlog'); log.scrollTop = log.scrollHeight;
    }
    if (tab === 'settings') {
      body.innerHTML = `<h4>Who sees where you are</h4>${cfg.privacy.locations.map(l => `<label class="opt"><input type="radio" name="roamLoc" data-set="location" value="${l}" ${st.location === l ? 'checked' : ''}> ${l === 'everyone' ? 'Everyone' : l === 'friends' ? 'Friends only' : 'Nobody'}</label>`).join('')}
        <label class="opt"><input type="checkbox" data-set="appearOffline" ${st.appearOffline ? 'checked' : ''}> Appear offline</label>
        <h4>What you see</h4>
        <label class="opt"><input type="checkbox" data-set="names" ${st.names !== false ? 'checked' : ''}> Names over cars</label>
        <label class="opt"><input type="checkbox" data-set="nearbyChat" ${st.nearbyChat !== false ? 'checked' : ''}> Nearby chat</label>
        <h4>Collisions</h4>
        <label class="opt"><input type="checkbox" data-set="contact" ${st.contact ? 'checked' : ''}> Contact (touch others who have it on too)</label>
        <label class="opt"><input type="checkbox" data-set="partyContact" ${st.partyContact !== false ? 'checked' : ''}> Contact with my party</label>
        <label class="opt"><input type="checkbox" data-set="passive" ${st.passive ? 'checked' : ''}> Passive mode (a ghost to everyone, no challenges)</label>
        <div class="muted">Everyone's a ghost to everyone else unless both have contact on. Passive mode can be switched once a minute.${T.ghostUntil > Date.now() ? ` <b>You're a ghost to everyone for ${countdown((T.ghostUntil - Date.now()) / 1000)}: too many hits on other players.</b>` : ''}</div>`;
    }
  }
  const countdown = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h} h ${m} min` : m ? `${m} min ${s} s` : `${s} s`; };
  function renderHud() {
    const T = state.touch, ghost = T.ghostUntil > Date.now();
    // (the next meet, counting down: scheduled meets are on the map at their meet spot too)
    const next = (state.meets ?? []).map(e => ({ ...e, ...meetEventState(e, Date.now(), cfg) })).find(e => e.state === 'live' || e.state === 'announced');
    hud.innerHTML = `<span>Free roam</span><span class="tag ${ghost ? 'ghosted' : T.passive ? 'passive' : T.contact ? 'contact' : ''}">${ghost ? 'GHOSTED' : T.passive ? 'PASSIVE' : T.contact ? `CONTACT${T.with.length ? ` ${T.with.length}` : ''}` : 'GHOST'}</span><span class="muted">${N.last.filter(o => o.pose && !o.leaving).length} near</span>${next ? `<span class="muted">Meet: ${esc(next.title)} ${next.state === 'live' ? 'on now' : `in ${countdown(next.startsInSec)}`}</span>` : ''}<button data-a="panel">F6</button>`;
  }
  hud.addEventListener('click', e => { if (e.target.closest('button')) open(!isOpen()); });

  function setSetting(k, v) {
    state.settings = { ...state.settings, [k]: v };
    RC.setSettings({ [k]: v });
    // (kept by the API for the account: the zone server saves it too — and a development ?player= has its own)
    if (!player && account?.me) void account.api.put?.('/roam/settings', { settings: { [k]: v } }).catch(() => {});
  }
  async function act(d) {
    const uid = d.uid;
    switch (d.a) {
      case 'panel': return open(!isOpen());
      case 'more': state.more = state.more === uid ? null : uid; return render();
      case 'inspect': RC.send({ t: 'inspect', uid }); return;
      case 'challenge': state.more = uid; return render();
      case 'ch': return challenge(uid, d.type);
      case 'friend': S.hubSend({ t: 'friend-add', id: uid }); return;
      case 'mute': if (state.muted.has(uid)) state.muted.delete(uid); else state.muted.add(uid); return render();
      case 'block': if (confirm('Block this player? You won\'t see each other anywhere, and neither can challenge or message the other.')) S.hubSend({ t: 'block', id: uid }); return;
      case 'report': { const why = prompt_('What happened?'); if (why) RC.send({ t: 'report', uid, details: why }); return; }
      case 'join': S.hubSend({ t: 'roam-join', uid }); return;
      case 'pcreate': S.hubSend({ t: 'party-create' }); return;
      case 'pinvite': S.hubSend({ t: 'party-invite', to: uid }); return;
      case 'pleave': S.hubSend({ t: 'party-leave' }); return;
      case 'pchallenge': return challenge('party', d.type);
      case 'coop': return coop();
      case 'meetgo': { const e = state.meets?.find(x => x.id === d.id); if (e?.place) await travelLatLon(e.place.lat, e.place.lon); return; }
      case 'park': if (state.meetHere) RC.send({ t: 'meet-park', meet: state.meetHere.meet }); return;
      case 'photo': return photo(true);
      case 'emote': RC.send({ t: 'emote', id: d.id }); return;
      case 'send': return sendChat();
      case 'wheel': RC.send({ t: 'wheel', id: d.id, scope: 'nearby' }); return;
    }
  }
  const prompt_ = q => globalThis.prompt?.(q) ?? null;
  function sendChat() {
    const inp = body.querySelector('#roamChatIn'), scope = body.querySelector('#roamChatScope')?.value ?? 'nearby';
    const text = inp?.value.trim(); if (!text) return;
    RC.send({ t: 'chat', scope, text }); inp.value = '';
  }
  function challenge(to, type) {
    let dest = null;
    if (type === 'quest') {
      const q = (game.questsNear?.() ?? [])[0];
      if (!q) { say('No quest marker near enough to race to.', 'warn'); return; }
      dest = [q.x, q.z];
    }
    RC.send({ t: 'challenge', to, type, dest });
    state.more = null; render();
  }
  // a party racing a quest together: a private lobby on the quest's route (Step 2's race flow: the lobby, the grid, the
  // race, results and pay per player), the party invited to it
  async function coop() {
    const q = (game.questsNear?.() ?? []).find(x => x.route);
    if (!q) { say('No quest with a route near here.', 'warn'); return; }
    const npc = !!body.querySelector('#roamCoopNpc')?.checked;
    try {
      await S.createLobby({ kind: 'private', settings: { venue: { kind: 'route', id: q.route }, laps: 1, npcFill: npc } });
      const roomId = S.race?.conn?.roomId ?? S.race?.roomId;
      for (const u of S.party?.members ?? []) if (u !== myUid()) S.hubSend({ t: 'invite', to: u, roomId });
      say(`${q.name}: the party's invited to race it`, 'ok');
      open(false);
    } catch (e) { say(e?.message ?? 'Couldn\'t make the lobby.', 'warn'); }
  }
  async function travelLatLon(lat, lon) {
    const [x, z] = game.xzOf(lat, lon);
    game.place([x, 0, z], game.carPose()?.headingDeg ?? 0);
    open(false);
  }
  function photo(on) { document.body.classList.toggle('roamPhoto', on); game.photoMode?.(on); if (on) { open(false); toast('Photo mode: press Esc to come back', 4000); } }
  addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('roamPhoto')) photo(false); });

  // the quick chat wheel (`): eight presets round the middle of the screen; a click or 1–8 says it to those near
  wheel.innerHTML = cfg.chat.wheel.map((w, i) => { const a = i / cfg.chat.wheel.length * Math.PI * 2 - Math.PI / 2; return `<button data-id="${w.id}" style="left:${150 + Math.cos(a) * 110}px;top:${150 + Math.sin(a) * 110}px">${i + 1}. ${esc(w.text)}</button>`; }).join('');
  wheel.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { RC.send({ t: 'wheel', id: b.dataset.id, scope: 'nearby' }); wheel.style.display = 'none'; } });
  const keys = e => {
    if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
    if (e.code === 'F6') { e.preventDefault(); open(!isOpen()); }
    if (e.code === 'Backquote') { e.preventDefault(); wheel.style.display = wheel.style.display === 'block' ? 'none' : 'block'; }
    if (wheel.style.display === 'block' && /^Digit[1-8]$/.test(e.code)) { const w = cfg.chat.wheel[+e.code.slice(5) - 1]; if (w) RC.send({ t: 'wheel', id: w.id, scope: 'nearby' }); wheel.style.display = 'none'; }
    if (e.code === 'Comma' && !e.repeat) { state.flash = true; }
    if (e.code === 'Quote' && !e.repeat) api.horn();
    if (e.code === 'Enter' && !isOpen()) { tab = 'chat'; open(true); setTimeout(() => body.querySelector('#roamChatIn')?.focus(), 0); }
  };
  const keysUp = e => { if (e.code === 'Comma') state.flash = false; };
  addEventListener('keydown', keys); addEventListener('keyup', keysUp);

  // ---------- what the zones say ----------
  offs.push(RC.on('mp', m => {
    switch (m.t) {
      case 'hello': state.you ??= m.you ?? null; if (m.zone === RC.home) { state.settings = { ...state.settings, ...m.settings }; render(); } return;
      case 'settings': state.settings = { ...state.settings, ...m.settings }; if (isOpen()) render(); return;
      case 'touch': if (m.zone === RC.home || m.challenge) { const was = state.touch; state.touch = m; if (m.ghostUntil > Date.now() && !(was.ghostUntil > Date.now())) toast('You\'ve hit other players too often: you\'re a ghost to everyone for a while.'); } return;
      case 'map': if (m.zone === RC.home) { state.map = m.players; drawMap(); } return;
      case 'notice': toast(m.text); return;
      case 'chat': if (!state.muted.has(m.uid)) { state.chat.push(m); if (state.chat.length > 200) state.chat.shift(); toast(`${m.scope === 'party' ? '[party] ' : ''}${m.name}: ${m.text}`); if (isOpen() && tab === 'chat') render(); } return;
      case 'emote': if (!state.muted.has(m.uid)) toast(`${m.name} ${m.text}`); return;
      case 'inspect': return showInspect(m);
      case 'meet-spot': state.meet = { id: m.meet, spot: m.spot }; game.place([m.spot.x, 0, m.spot.z], m.spot.heading); toast(`Parked in spot ${m.spot.n}`); render(); return;
      case 'challenge-invite': return showInvite(m);
      case 'challenge-sent': toast(m.id ? `Challenge sent${m.route ? `: ${km(m.route.length)} to ${(m.route.names ?? []).at(-1) ?? 'somewhere'}` : ''}` : 'Challenge sent'); if (m.route) routeOnMaps(m.route); return;
      case 'challenge-declined': toast(m.why === 'declined' ? 'They said no.' : m.why === 'expired' ? 'No answer.' : 'The challenge is off.'); routeOnMaps(null); return;
      case 'challenge-start': return startChallenge(m);
      case 'challenge-event': return challengeEvent(m);
      case 'challenge-results': return challengeResults(m);
      case 'contact': case 'contact-rejected': case 'ghosts': C?.message(m); return;
      case 'ramming': toast(`${m.name} keeps hitting you — report them from Nearby (the replay goes with it).`); return;
    }
  }));
  offs.push(S.on('roam-goto', m => goToFriend(m)));
  offs.push(S.on('chat', m => { if (m.scope === 'party' && !state.muted.has(m.uid)) { state.chat.push(m); toast(`[party] ${m.name}: ${m.text}`); } }));
  offs.push(S.on('party', p => { state.partyUids = new Set((p?.members ?? []).filter(u => u !== myUid())); RC.setParty(p?.id ?? null); if (isOpen()) render(); }));
  offs.push(S.on('friends', () => { if (isOpen() && tab === 'friends') render(); }));
  offs.push(RC.on('handoff', () => { C?.dispose(); C = null; }));

  function showInspect(m) {
    prompt.innerHTML = `<h3>${esc(m.name)}'s car</h3><div>${esc(m.car?.name ?? m.look?.carId ?? 'a car')}${m.car?.cls ? ` · class ${esc(m.car.cls)} · rating ${esc(m.car.pr)}` : ''}${m.car?.mass ? ` · ${Math.round(m.car.mass)} kg` : ''}</div>
      <div class="muted">${Object.entries(m.look?.parts ?? {}).filter(([, v]) => v).map(([k, v]) => `${esc(k.replace(/^socket_/, ''))}: ${esc(v)}`).join(' · ') || 'Stock parts'}</div>
      <div class="muted">${m.safety ? `Safety ${esc(m.safety.tier?.name ?? '')} (${m.safety.value})` : ''}${m.damaged ? ` · ${m.damaged} crash${m.damaged === 1 ? '' : 'es'} on it` : ''}</div><div class="actions"><button data-x="close">Close</button></div>`;
    prompt.style.display = 'block'; prompt.onclick = e => { if (e.target.closest('button')) prompt.style.display = 'none'; };
  }
  function showInvite(m) {
    state.invite = m;
    const what = m.type === 'follow' ? 'Follow the leader' : m.type === 'quest' ? 'A race to a quest marker' : 'A sprint';
    prompt.innerHTML = `<h3>${esc(m.name)} challenges you${m.group ? ' (and the party)' : ''}</h3><div>${what}${m.route ? `: ${km(m.route.length)} to ${esc((m.route.names ?? []).at(-1) ?? 'the finish')}${m.route.names?.length ? ` via ${esc(m.route.names.slice(0, 3).join(', '))}` : ''} (on your map)` : ''}</div>
      <div class="muted">A rolling start side by side; you're both ghosts to everyone else while it lasts.</div><div class="actions"><button class="go" data-yes="1">Accept</button><button data-yes="0">Decline</button></div><div class="muted" id="roamInviteLeft"></div>`;
    prompt.style.display = 'block';
    if (m.route) routeOnMaps(m.route);
    const until = performance.now() + m.answerSec * 1000;
    const tick = setInterval(() => { const left = Math.ceil((until - performance.now()) / 1000), el = prompt.querySelector('#roamInviteLeft'); if (el) el.textContent = `${Math.max(0, left)} s to answer`; if (left <= 0) { clearInterval(tick); if (state.invite === m) { prompt.style.display = 'none'; state.invite = null; routeOnMaps(null); } } }, 250);
    prompt.onclick = e => { const b = e.target.closest('button'); if (!b) return; clearInterval(tick); RC.sendTo(m.roomId, { t: 'challenge-answer', id: m.id, yes: b.dataset.yes === '1' }); prompt.style.display = 'none'; state.invite = null; if (b.dataset.yes !== '1') routeOnMaps(null); };
  }
  function startChallenge(m) {
    state.run = { id: m.id, roomId: m.roomId, type: m.type, route: m.route, checkpoints: m.checkpoints, next: 0, go: false, racers: m.racers };
    if (m.route) routeOnMaps(m.route);
    banner.style.display = 'block';
    banner.textContent = `${m.type === 'follow' ? 'Follow the leader' : 'Challenge'}: rolling start — side by side, ${m.rolling.minKmh}–${m.rolling.maxKmh} km/h`;
  }
  function challengeEvent(m) {
    const r = state.run, e = m.event; if (!r || m.id !== r.id || !e) return;
    if (e.t === 'hold') banner.textContent = `Rolling start: ${e.why}`;
    if (e.t === 'go') { r.go = true; banner.textContent = 'GO!'; game.say?.('GO!', 'ok'); }
    if (e.t === 'checkpoint' && e.uid === myUid()) banner.textContent = `Checkpoint ${e.n} of ${e.of}`;
    if (e.t === 'penalty' && e.uid === myUid()) toast(`+${e.sec} s: ${e.why}`);
    if (e.t === 'finish') toast(`${r.racers.find(x => x.uid === e.uid)?.name ?? 'Someone'} finished${e.timeMs != null ? ` in ${(e.timeMs / 1000).toFixed(1)} s` : ''}`);
    if (e.t === 'cancelled') toast('The challenge is off: the rolling start never came together.');
  }
  function challengeResults(m) {
    banner.style.display = 'none'; routeOnMaps(null); state.run = null;
    const mine = m.results.find(x => x.uid === myUid());
    prompt.innerHTML = `<h3>${mine?.place === 1 ? 'You won!' : mine?.place ? `Place ${mine.place}` : 'Challenge over'}</h3>${m.results.map(x => `<div>${x.place ?? '–'}. ${esc(x.name)} ${x.timeMs != null ? `${(x.timeMs / 1000).toFixed(1)} s` : x.status}</div>`).join('')}
      <div class="muted">${m.pay ? (m.pay.money > 0 ? `+$${m.pay.money} · +${m.pay.xp} xp (${esc(m.pay.why)})` : `No pay: ${esc(m.pay.why)}`) : m.verdict && !m.verdict.ok ? 'It didn\'t pass its check: no pay.' : ''}</div><div class="actions"><button>Close</button></div>`;
    prompt.style.display = 'block'; prompt.onclick = e => { if (e.target.closest('button')) prompt.style.display = 'none'; };
  }
  function routeOnMaps(route) {
    const maps = game.maps?.(); if (!maps) return;
    if (!route) { maps.setLines([]); return; }
    maps.setLines([{ type: 'Feature', geometry: { type: 'LineString', coordinates: route.line.map(([x, z]) => { const [lat, lon] = game.latLonOf(x, z); return [lon, lat]; }) }, properties: { kind: 'route', colour: '#ff7a1a', width: 5 } }]);
  }
  function drawMap() {
    const maps = game.maps?.(); if (!maps?.setPlayers) return;
    maps.setPlayers(state.map.map(p => { const [lat, lon] = game.latLonOf(p.pos[0], p.pos[1]); return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { uid: p.uid, name: p.name, rel: p.party ? 'party' : p.friend ? 'friend' : 'other', heading: p.heading } }; }), uid => { const f = S.friends?.find(x => x.id === uid); if (f) S.hubSend({ t: 'roam-join', uid }); });
  }
  // join a friend: to their region (if it's another), then beside them — the zone puts you in their instance (friends first)
  async function goToFriend(m) {
    if (!m.pos) { toast('They\'re online, but not sharing where they are.'); return; }
    if (m.region !== region) { toast(`Going to ${m.region}…`); await game.switchRegion(m.region, { joinFriend: m }); return; }
    const h = (m.heading ?? 0) * Math.PI / 180;
    game.place([m.pos[0] - Math.cos(h) * 4, 0, m.pos[1] + Math.sin(h) * 4], m.heading ?? 0);
    toast('Beside your friend');
    open(false);
  }

  // ---------- contact: Step 3's contact client, with the players you touch (both contact on, or the party) ----------
  let C = null, offset = 0;
  function othersForContact() {
    const out = new Map(), home = RC.homeNet, mine = game.carPhysics();
    if (!home) return out;
    for (const uid of state.touch.with) { const np = [...home.players.values()].find(x => x.uid === uid); if (np) out.set(uid, { id: np.id, box: mine.box, mass: mine.mass, name: np.name }); }
    return out;
  }
  function contactFrame(dt) {
    const want = state.touch.with.length > 0 && RC.homeNet && game.sim?.();
    if (want && !C) {
      const home = RC.homeNet;
      C = createContactClient({ sim: game.sim(), net: home, send: m => RC.send(m), cfg: mpCfg.contact, myUid: myUid(), mine: () => game.carPhysics(), others: othersForContact,
        roomAt: simT => (simT + offset) * 1000, mode: () => 'reduced', toSim: game.toSim, toWorld: game.toWorld,
        onImpact: (impact, { scale }) => game.contactHit?.(impact, { scale }), onEffect: e => game.contactEffect?.(e) });
    } else if (!want && C) { C.dispose(); C = null; }
    if (C) { offset = RC.homeNet.stampAt() / 1000 - game.simTime(); C.frame(dt); }
  }

  // ---------- meets near, the scheduled ones ----------
  async function loadMeets() { try { state.meets = (await (account?.api ?? null)?.get('/roam/meets'))?.events ?? []; } catch { state.meets = []; } }
  void loadMeets();
  const meetTimer = setInterval(() => { void loadMeets(); }, 60000);

  // ---------- coming back where you left ----------
  if (back && !back.garage) {
    if (back.region === region) { game.place(back.pos, back.heading ?? 0); toast('Back where you left off'); }
    else toast(`You left off in ${back.region}: open the full map (Tab) to go back there.`, 9000);
  } else if (back?.why && back.why !== 'nothing saved') toast(`Starting at the garage: ${back.why}`, 7000);

  let hudAt = 0;
  const api = {
    M, RC, net: N, state,
    get flashing() { return state.flash; },
    frame(dt) {
      contactFrame(dt);
      hudAt -= dt;
      if (hudAt <= 0) {
        hudAt = 0.5; renderHud();
        // (a meet spot near: the meets tab offers to park)
        const near = game.meetsNear?.()?.[0] ?? null;
        if ((near?.id ?? null) !== (state.meetHere?.id ?? null)) { state.meetHere = near; if (isOpen() && tab === 'meets') render(); }
        if (isOpen() && tab === 'near' && (panelAt -= 0.5) <= 0) { panelAt = 2; render(); }
      }
    },
    horn() { RC.sendEvent({ kind: 'horn' }); game.horn?.(); },
    leave() {
      clearInterval(meetTimer); C?.dispose(); offs.forEach(f => f()); removeEventListener('keydown', keys); removeEventListener('keyup', keysUp);
      for (const el of [hud, panel, prompt, banner, wheel, toasts]) el.remove();
      document.body.classList.remove('roamPhoto');
      game.maps?.()?.setPlayers?.([]);
      removeEventListener('pagehide', bye);
      return Promise.all([leaveDraw(), Promise.race([RC.leave(), new Promise(r => setTimeout(r, 2000))])]);
    },
  };
  renderHud();
  return api;
}

export { rtEndpoint, meetEventState };
