// Multiplayer's screens (Phase 7 Step 2; docs/MULTIPLAYER.md): the menu (a quick race, a private or custom lobby,
// joining by code, the lobby browser, friends and the party), the lobby (players with their car, performance rating,
// ready, ping and rank; the host's settings; changing car; chat with mute, block and report; the host's kick), the
// loading screen, the start lights on the server's clock, the race HUD (live positions from the server), the results
// (provisional, then confirmed once the runs are checked: pay and rank changes) with the podium and the rematch vote,
// and the watching bar (whose car, which camera). All of it is the page's DOM over the 3D view; the session (mp/
// client.js) and the race as the game plays it (play/mpRace.js) are what it shows.
//
//   const M = createMpScreens({ S, R, game, cfg (data/multiplayer.json) })
//     game: { say(text, kind), currency, region, regions, routes (the venues to offer: [{ id, name }]), self (who you
//             are, for the menu's title), pause(on), leaveRace() (back to free roam) }
//   M.toggle() / M.show(on)    the menu (F7, or the Multiplayer button)    M.frame(dt) every frame    M.dispose()
//   Every screen has its id (#mpMenu #mpLobby #mpLoading #mpLights #mpHud #mpResults #mpWatch #mpToasts): the browser
//   tests find them by it and check what's drawn. The lights record when they went out (window.__krMpLightsOut).

import { cameraName } from './mpRace.js';
import { fmtTime } from '../quest/timing.js';
import { tierLabel } from '../mp/rank.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ord = n => n == null ? '—' : `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
const VENUE_KINDS = { random: 'Random (a real-world route or a generated track)', official: 'Official track', route: 'Real-world route', track: 'Track code' };
const TIME_NAMES = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
const GRID_NAMES = { rating: 'By rating', random: 'Random', reverse: 'Reverse of the last race' };
const STATE_NAMES = { menu: 'Online', 'free roam': 'Free roam', queue: 'Looking for a race', lobby: 'In a lobby', racing: 'Racing', spectating: 'Watching a race', offline: 'Offline' };

const CSS = `
#mpMenu[hidden],#mpLobby[hidden],#mpLoading[hidden],#mpLights[hidden],#mpHud[hidden],#mpResults[hidden],#mpWatch[hidden],#mpButton[hidden]{display:none!important}
/* (above the account chip and the HUD — 70 — and below the account's own dialogs, 95 and up) */
.mpBox{position:fixed;z-index:80;background:rgba(14,18,26,.96);color:#eef1f5;border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);font:13px/1.4 Barlow,system-ui,sans-serif}
.mpBox h2{margin:0 0 6px;font-size:20px}.mpBox h3{margin:10px 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.7}
.mpBox button{font:600 13px Barlow,system-ui,sans-serif;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:7px;padding:5px 11px;cursor:pointer}
.mpBox button.primary{background:#2f7d43;border-color:#3f9a57}.mpBox button.danger{background:#7d2f2f;border-color:#9a3f3f}.mpBox button:disabled{opacity:.45;cursor:not-allowed}
.mpBox input,.mpBox select{font:13px Barlow,system-ui,sans-serif;background:#0b0e14;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 6px}
.mpBox table{width:100%;border-collapse:collapse}.mpBox td,.mpBox th{padding:3px 5px;text-align:left;white-space:nowrap}.mpBox th{font-size:10px;letter-spacing:.06em;text-transform:uppercase;opacity:.6;font-weight:600}
.mpBox tr.me td{color:#ffd24a}.mpBox .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:5px 0}.mpBox .dim{opacity:.65}.mpBox .good{color:#7ee08a}.mpBox .bad{color:#ff7a6a}.mpBox .warn{color:#ffbd4a}
.mpBox .tier{display:inline-block;padding:0 6px;border-radius:9px;background:rgba(255,255,255,.12);font-size:11px;font-weight:700}
#mpMenu{left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,96vw);max-height:94vh;overflow:auto;padding:14px 16px}
#mpLobby{left:50%;top:50%;transform:translate(-50%,-50%);width:min(860px,98vw);max-height:96vh;overflow:auto;padding:12px 14px}
#mpLobby .cols{display:flex;gap:14px;flex-wrap:wrap}#mpLobby .cols>div{flex:1 1 320px;min-width:0}
#mpLobby .chat{height:120px;overflow:auto;background:rgba(0,0,0,.25);border-radius:6px;padding:4px 6px;font-size:12px}
#mpLobby .who{cursor:pointer;text-decoration:underline dotted}
#mpLoading{left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,92vw);padding:14px 16px;text-align:center}
#mpLights{position:fixed;z-index:61;left:50%;top:14%;transform:translateX(-50%);display:flex;gap:10px;padding:10px 14px;background:rgba(10,12,16,.85);border-radius:12px;pointer-events:none}
#mpLights i{display:block;width:34px;height:34px;border-radius:50%;background:#2a2e36;border:2px solid #111}#mpLights i.red{background:#ff2a1f;box-shadow:0 0 14px #ff2a1f}#mpLights i.green{background:#2fe05a;box-shadow:0 0 14px #2fe05a}
#mpHud{position:fixed;z-index:58;right:14px;top:70px;min-width:190px;padding:8px 10px;pointer-events:none;background:rgba(14,18,26,.72)}
#mpHud .pos{font:800 34px Barlow,system-ui,sans-serif;line-height:1}#mpHud .pos small{font-size:16px;opacity:.75}
#mpHud .clock{font:700 16px "JetBrains Mono",monospace}#mpHud table{font:600 12px "JetBrains Mono",monospace}
#mpResults{left:50%;top:50%;transform:translate(-50%,-50%);width:min(640px,96vw);max-height:94vh;overflow:auto;padding:12px 16px}
#mpResults .podium{display:flex;align-items:flex-end;justify-content:center;gap:8px;margin:8px 0 4px}
#mpResults .podium div{width:30%;text-align:center;border-radius:8px 8px 0 0;padding:6px 4px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mpResults .p1{height:80px;background:#b8921d}#mpResults .p2{height:62px;background:#7d858d}#mpResults .p3{height:48px;background:#8a5a2b}
#mpWatch{position:fixed;z-index:58;left:50%;bottom:16px;transform:translateX(-50%);padding:6px 12px;pointer-events:none;text-align:center}
#mpButton{position:fixed;z-index:57;left:50%;top:8px;transform:translateX(-50%)}
#mpToasts{position:fixed;z-index:90;left:50%;top:60px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}
#mpToasts .mpBox{position:static;padding:7px 12px;pointer-events:auto}
`;

export function createMpScreens({ S, R, game, cfg }) {
  if (!document.getElementById('mpCss')) { const st = document.createElement('style'); st.id = 'mpCss'; st.textContent = CSS; document.head.appendChild(st); }
  const el = (id, cls = 'mpBox') => { let e = document.getElementById(id); if (!e) { e = document.createElement('div'); e.id = id; if (cls) e.className = cls; e.hidden = true; document.body.appendChild(e); } return e; };
  const menu = el('mpMenu'), lobby = el('mpLobby'), loading = el('mpLoading'), lights = el('mpLights', ''), hud = el('mpHud'), results = el('mpResults'), watchBar = el('mpWatch'), toasts = el('mpToasts', '');
  toasts.hidden = false;
  lights.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
  const button = document.createElement('button');
  button.id = 'mpButton'; button.className = 'mpBox'; button.textContent = 'Multiplayer (F7)';
  button.style.cssText = 'font:600 13px Barlow,system-ui,sans-serif;padding:6px 12px;cursor:pointer';
  button.onclick = () => { button.blur(); toggle(); };
  document.body.appendChild(button);

  let myVote = false, menuOpen = false, queueing = null, offer = null, lobbyList = null, lobbyKey = '', resultsKey = '', hudAt = 0, resultsHidden = false, menuKey = '';
  const offs = [];
  const money = n => `${game.currency ?? '$'}${Math.round(n).toLocaleString('en-GB')}`;
  const toast = (html, actions = {}, secs = 12) => {
    const t = document.createElement('div'); t.className = 'mpBox'; t.innerHTML = html;
    t.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; for (const [k, fn] of Object.entries(actions)) if (b.hasAttribute(`data-${k}`)) fn(); t.remove(); });
    toasts.appendChild(t);
    setTimeout(() => t.remove(), secs * 1000);
    return t;
  };
  const notice = text => toast(esc(text), {}, 5);

  // ---------- the session's news ----------
  offs.push(S.on('notice', text => notice(text)));
  offs.push(S.on('invite', m => toast(`<b>${esc(m.name)}</b> invited you to ${m.kind === 'private' ? 'their private lobby' : `“${esc(m.lobby)}”`}${m.venue ? ` · ${esc(m.venue)}` : ''} <button class="primary" data-join>Join</button> <button data-no>Not now</button>`, { join: () => joinRoom(m.roomId) }, 30)));
  offs.push(S.on('party-invite', m => toast(`<b>${esc(m.name)}</b> asked you into their party <button class="primary" data-yes>Join the party</button> <button data-no>No</button>`, { yes: () => S.hubSend({ t: 'party-join', partyId: m.partyId }) }, 30)));
  offs.push(S.on('party-queue', m => { void quickRace({ party: m.partyId }); }));
  offs.push(S.on('goto', m => { void joinRoom(m.roomId, { spectate: !!m.spectate }); }));
  offs.push(S.on('queued', () => drawMenu()));
  offs.push(S.on('npc-offer', m => { offer = m; drawMenu(); }));
  offs.push(S.on('matched', () => { queueing = null; offer = null; show(false); }));
  offs.push(S.on('queue-left', info => { if (queueing) { queueing = null; offer = null; if (info?.message) notice(info.message); drawMenu(); } }));
  offs.push(S.on('friends', () => drawMenu()));
  offs.push(S.on('party', () => drawMenu()));
  offs.push(S.on('lobbies', m => { lobbyList = m.list; drawMenu(); }));
  offs.push(S.on('lobby', () => { show(false); drawLobby(); }));
  offs.push(S.on('chat', () => drawChat())); offs.push(S.on('chat-log', () => drawChat()));
  offs.push(S.on('results', () => { resultsHidden = false; myVote = false; drawResults(); }));
  offs.push(S.on('confirmed', () => drawResults()));
  offs.push(S.on('verdict', () => drawResults()));
  offs.push(S.on('votes', () => drawResults()));
  offs.push(S.on('left', st => { lobby.hidden = true; results.hidden = true; hud.hidden = true; loading.hidden = true; lights.hidden = true; watchBar.hidden = true; if (st?.message && !leaving) notice(`You left the lobby: ${st.message}`); leaving = false; game.leaveRace?.(); }));
  let leaving = false;

  // ---------- the menu ----------
  function show(on = !menuOpen) {
    menuOpen = on;
    menu.hidden = !on || !!S.race;
    if (on && !S.race) { void S.hub().then(() => { S.hubSend({ t: 'friends' }); drawMenu(); }).catch(e => notice(`Multiplayer: ${e.message}`)); drawMenu(); }
    // (in a lobby: the lobby is the menu)
    if (on && S.race) { lobby.hidden = false; drawLobby(true); }
  }
  const toggle = () => show(!menuOpen);
  async function quickRace({ party = null } = {}) {
    try {
      const ping = await S.ping();
      queueing = { since: performance.now(), party };
      offer = null; drawMenu();
      await S.queue({ region: game.region ?? 'local', pings: { [game.region ?? 'local']: ping ?? 80 }, party: party ?? S.party?.id ?? null });
    } catch (e) { queueing = null; notice(e.message ?? String(e)); drawMenu(); }
  }
  async function joinRoom(roomId, { spectate = false } = {}) {
    try { await S.leaveQueue(); queueing = null; await S.joinLobby(roomId, { spectate }); show(false); }
    catch (e) { notice(e.message ?? String(e)); }
  }
  function drawMenu() {
    if (!menuOpen || S.race) { menu.hidden = true; return; }
    menu.hidden = false;
    const friends = S.friends ?? [], req = S.requests ?? { incoming: [], outgoing: [] }, party = S.party;
    const q = queueing ? `<div class="row"><b>Looking for a race…</b> <span data-qtime>${Math.round((performance.now() - queueing.since) / 1000)} s</span> <button data-cancel>Cancel</button></div>
      ${offer ? `<div class="row warn">Nobody else close enough yet. Race NPCs in the empty places? <button class="primary" data-npcyes>Race with NPCs</button> <button data-npcno>Keep waiting</button></div>` : ''}` : '';
    const html = `<h2>Multiplayer</h2><div class="dim">${esc(game.self?.() ?? '')}</div>
      <h3>Race</h3>
      <div class="row"><button class="primary" data-quick ${queueing ? 'disabled' : ''}>Quick race</button><span class="dim">matched with players near your skill and car${party ? ` · your party of ${party.members.length} queues together` : ''}</span></div>${q}
      <div class="row"><button data-private>Private lobby</button><button data-custom>Custom lobby</button>
        <input data-code placeholder="Invite code" maxlength="12" size="9"><button data-joincode>Join</button></div>
      <h3>Lobbies <button data-browse>Refresh</button></h3>
      ${lobbyList ? (lobbyList.length ? `<table>${lobbyList.map(l => `<tr><td>${esc(l.name)}</td><td class="dim">${esc(l.venue ?? '')}</td><td>${l.players}/${l.max}</td><td>${l.phase === 'lobby' ? 'waiting' : 'racing'}</td><td><button data-join="${esc(l.roomId)}" ${l.phase !== 'lobby' ? 'disabled' : ''}>Join</button> <button data-watch="${esc(l.roomId)}">Watch</button></td></tr>`).join('')}</table>` : '<div class="dim">No open lobbies right now: make one.</div>') : '<div class="dim">…</div>'}
      <h3>Friends</h3>
      ${friends.length ? `<table>${friends.map(f => `<tr><td>${esc(f.name)}</td><td class="${f.online ? 'good' : 'dim'}">${esc(STATE_NAMES[f.state] ?? f.state)}${f.venue ? ` · ${esc(f.venue)}` : ''}</td><td>${f.roomId && ['lobby', 'racing', 'spectating'].includes(f.state) ? `<button data-joinfriend="${esc(f.id)}">${f.state === 'lobby' ? 'Join' : 'Watch'}</button>` : ''} ${f.online && party ? `<button data-partyinvite="${esc(f.id)}">Invite to party</button>` : ''} <button data-unfriend="${esc(f.id)}" title="Remove friend">✕</button></td></tr>`).join('')}</table>` : '<div class="dim">No friends yet: add one by their name.</div>'}
      ${req.incoming.length ? `<div>${req.incoming.map(r => `<div class="row">${esc(r.name)} wants to be friends <button class="primary" data-accept="${esc(r.id)}">Accept</button> <button data-unfriend="${esc(r.id)}">Decline</button></div>`).join('')}</div>` : ''}
      ${req.outgoing.length ? `<div class="dim">Asked: ${req.outgoing.map(r => esc(r.name)).join(', ')}</div>` : ''}
      <div class="row"><input data-friend placeholder="A player's name" maxlength="40"><button data-addfriend>Add friend</button></div>
      <h3>Party</h3>
      ${party ? `<div class="row">${party.members.map(u => esc(party.names?.[u] ?? u)).join(', ')} ${party.leader === S.myUid || !S.myUid ? '<span class="dim">(you lead: Quick race queues everyone)</span>' : ''} <button data-partyleave>Leave the party</button></div>` : '<div class="row"><button data-partynew>Make a party</button><span class="dim">then invite friends: you queue together</span></div>'}
      <div class="row" style="justify-content:flex-end"><button data-close>Close</button></div>`;
    if (html === menuKey) return;
    menuKey = html;
    const keep = menu.querySelector('[data-code]')?.value ?? '', keepF = menu.querySelector('[data-friend]')?.value ?? '';
    menu.innerHTML = html;
    menu.querySelector('[data-code]').value = keep; menu.querySelector('[data-friend]').value = keepF;
  }
  menu.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if ('quick' in d) void quickRace();
    if ('cancel' in d) { queueing = null; offer = null; void S.leaveQueue(); drawMenu(); }
    if ('npcyes' in d) { S.acceptNpcs(true); offer = null; drawMenu(); }
    if ('npcno' in d) { S.acceptNpcs(false); offer = null; drawMenu(); }
    if ('private' in d || 'custom' in d) void S.createLobby({ kind: 'private' in d ? 'private' : 'custom', settings: { laps: 3 } }).then(() => show(false), err => notice(err.message));
    if ('joincode' in d) { const code = menu.querySelector('[data-code]').value; void S.joinCode(code).then(() => show(false), err => notice(err.message)); }
    if ('browse' in d) { lobbyList = null; S.hubSend({ t: 'lobbies' }); drawMenu(); }
    if (d.join) void joinRoom(d.join);
    if (d.watch) void joinRoom(d.watch, { spectate: true });
    if (d.joinfriend) S.hubSend({ t: 'join-friend', uid: d.joinfriend });
    if (d.partyinvite) S.hubSend({ t: 'party-invite', to: d.partyinvite });
    if (d.unfriend) S.hubSend({ t: 'friend-remove', id: d.unfriend });
    if (d.accept) S.hubSend({ t: 'friend-accept', id: d.accept });
    if ('addfriend' in d) { const n = menu.querySelector('[data-friend]').value.trim(); if (n) S.hubSend({ t: 'friend-add', name: n }); menu.querySelector('[data-friend]').value = ''; }
    if ('partynew' in d) S.hubSend({ t: 'party-create' });
    if ('partyleave' in d) S.hubSend({ t: 'party-leave' });
    if ('close' in d) show(false);
  });

  // ---------- the lobby ----------
  function venueLine(L) {
    const v = L.venue;
    if (!v) return L.venueError ? `<span class="bad">${esc(L.venueError)}</span>` : 'Choosing…';
    return `<b>${esc(v.name)}</b> · ${v.km} km${v.loop ? ` · ${L.laps} lap${L.laps > 1 ? 's' : ''}` : ' · a sprint'}${v.official ? ` · ${v.official === 'weekly' ? 'this week\'s' : 'today\'s'} official track` : v.venue?.kind === 'track' ? ' · generated track' : ' · real-world route'}`;
  }
  function drawLobby(force = false) {
    const L = S.lobby;
    if (!L || !S.race) { lobby.hidden = true; return; }
    const inLobby = L.phase === 'lobby';
    lobby.hidden = !inLobby;
    if (!inLobby) return;
    // (back in the lobby — a rematch: the last race's screens away)
    results.hidden = true; hud.hidden = true; watchBar.hidden = true; resultsKey = '';
    const meP = S.me, host = S.isHost, set = L.settings, cars = L.cars ?? [];
    const racers = L.players.filter(p => p.role === 'racer'), watchers = L.players.filter(p => p.role === 'spectator');
    const allReady = racers.filter(p => !p.npc).every(p => p.ready);
    const kind = L.kind === 'quick' ? 'Quick race' : L.kind === 'private' ? 'Private lobby' : 'Custom lobby';
    const row = p => `<tr class="${p.uid === S.myUid ? 'me' : ''}" data-player="${esc(p.uid)}">
      <td>${p.host ? '♛ ' : ''}<span class="${p.uid !== S.myUid && !p.npc ? 'who' : ''}" data-who="${esc(p.uid)}">${esc(p.name)}</span>${S.muted.has(p.uid) ? ' <span class="dim">(muted)</span>' : ''}</td>
      <td>${esc(p.car?.name ?? '—')} <span class="dim">${esc(p.car?.cls ?? '')}${p.car?.pr ? ` ${p.car.pr}` : ''}</span></td>
      <td class="${p.ready ? 'good' : 'dim'}" data-ready>${p.npc ? 'NPC' : p.ready ? 'Ready' : 'Not ready'}</td>
      <td class="dim">${p.ping != null ? `${p.ping} ms` : '—'}</td>
      <td>${p.tier ? `<span class="tier" title="${p.tier.placement ? `${p.tier.placement} placement race${p.tier.placement > 1 ? 's' : ''} to go` : ''}">${esc(tierLabel(p.tier))}</span>` : ''}</td>
      <td>${host && p.uid !== S.myUid && !p.npc ? `<button data-kick="${esc(p.uid)}">Kick</button>` : ''}${p.away ? ' <span class="warn">reconnecting…</span>' : ''}</td></tr>`;
    const venueSel = host ? `<select data-set="venueKind">${Object.entries(VENUE_KINDS).map(([k, n]) => `<option value="${k}" ${set.venue.kind === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      ${set.venue.kind === 'route' ? `<select data-set="route">${(game.routes ?? []).map(r => `<option value="${esc(r.id)}" ${set.venue.id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}${set.venue.id && !(game.routes ?? []).some(r => r.id === set.venue.id) ? `<option value="${esc(set.venue.id)}" selected>${esc(set.venue.id)}</option>` : ''}</select>` : ''}
      ${set.venue.kind === 'official' ? `<select data-set="official"><option value="daily" ${set.venue.which !== 'weekly' ? 'selected' : ''}>Today's</option><option value="weekly" ${set.venue.which === 'weekly' ? 'selected' : ''}>This week's</option></select>` : ''}
      ${set.venue.kind === 'track' ? `<input data-set="code" value="${esc(set.venue.code ?? '')}" size="26" placeholder="A track's code">` : ''}` : '';
    const settings = host ? `
      <div class="row">Venue ${venueSel}</div>
      <div class="row">Laps <input data-set="laps" type="number" min="1" max="${cfg.lobby.lapsMax}" value="${set.laps}" style="width:52px" ${L.venue && !L.venue.loop ? 'disabled title="A sprint: one run, start to finish"' : ''}>
        Grid <select data-set="gridOrder">${cfg.lobby.gridOrders.map(g => `<option value="${g}" ${set.gridOrder === g ? 'selected' : ''}>${esc(GRID_NAMES[g] ?? g)}</option>`).join('')}</select></div>
      <div class="row">Classes ${['D', 'C', 'B', 'A', 'S', 'X'].map(c => `<label><input type="checkbox" data-class="${c}" ${set.classes?.includes(c) ? 'checked' : ''}>${c}</label>`).join(' ')} <span class="dim">(none ticked: any)</span></div>
      <div class="row"><label><input type="checkbox" data-set="npcFill" ${set.npcFill ? 'checked' : ''}> NPCs in the empty places</label>
        ${L.kind === 'custom' ? `<label><input type="checkbox" data-set="listed" ${set.listed ? 'checked' : ''}> Listed in the lobby browser</label>` : ''}</div>
      <div class="row">Time <select data-set="timeOfDay">${cfg.lobby.times.map(t => `<option value="${t}" ${set.timeOfDay === t ? 'selected' : ''}>${esc(TIME_NAMES[t] ?? t)}</option>`).join('')}</select>
        Weather <select data-set="weather">${cfg.lobby.weathers.map(t => `<option value="${t}" ${set.weather === t ? 'selected' : ''}>${esc(t[0].toUpperCase() + t.slice(1))}</option>`).join('')}</select>
        Collisions <select disabled title="Car contact between players comes in a later update"><option>Ghost (no contact)</option></select></div>`
      : `<div class="row dim">${set.classes ? `Classes ${set.classes.join(', ')}` : 'Any class'} · grid ${esc((GRID_NAMES[set.gridOrder] ?? set.gridOrder).toLowerCase())} · ${esc(TIME_NAMES[set.timeOfDay] ?? set.timeOfDay)}, ${esc(set.weather)} · ghost mode${set.npcFill ? ' · NPCs fill the grid' : ''}</div>`;
    const html = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(kind)}${set.name ? `: ${esc(set.name)}` : ''}</h2>${L.code ? `<div>Invite code <b data-code style="font:700 18px 'JetBrains Mono',monospace;letter-spacing:.1em">${esc(L.code)}</b></div>` : ''}</div>
      <div class="row" data-venue>${venueLine(L)}</div>
      <div class="cols"><div>
        <h3>Players · ${racers.length}/${L.maxRacers}</h3>
        <table data-players><tr><th>Player</th><th>Car</th><th></th><th>Ping</th><th>Rank</th><th></th></tr>${racers.map(row).join('')}</table>
        ${watchers.length ? `<div class="dim">Watching: ${watchers.map(p => esc(p.name)).join(', ')}</div>` : ''}
        <div class="row">${meP?.role === 'racer' ? `<button class="${meP.ready ? '' : 'primary'}" data-ready>${meP.ready ? 'Not ready' : 'Ready'}</button>` : '<button data-race>Race</button>'}
          ${meP?.role === 'racer' ? '<button data-spectate>Watch instead</button>' : ''}
          ${host ? `<button class="primary" data-start ${allReady ? '' : 'title="Not everyone is ready"'}>Start the race</button>` : ''}
          ${L.kind === 'quick' ? '<span class="dim">Starts as soon as everyone is in</span>' : ''}
          <button class="danger" data-leave>Leave</button></div>
        ${meP?.role === 'racer' && cars.length ? `<div class="row">Your car <select data-car>${cars.map(c => `<option value="${esc(c.instanceId)}" ${meP.car?.instanceId === c.instanceId ? 'selected' : ''} ${c.allowed ? '' : 'disabled'}>${esc(c.name)} · ${esc(c.cls)} ${c.pr}${c.allowed ? '' : ' (not allowed here)'}</option>`).join('')}</select></div>` : ''}
        ${S.friends?.some(f => f.online) && L.kind !== 'quick' ? `<div class="row">Invite <select data-invitewho>${S.friends.filter(f => f.online).map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select><button data-invite>Invite</button></div>` : ''}
      </div><div>
        <h3>Settings${host ? ' (you\'re the host)' : ''}</h3>${settings}
        <h3>Chat</h3><div class="chat" data-chatlog></div>
        <div class="row"><input data-chat maxlength="${cfg.lobby.chat.maxLength}" placeholder="Say something" style="flex:1"><button data-send>Send</button></div>
        <div class="dim" data-whomenu></div>
      </div></div>`;
    const key = html + (force ? Math.random() : '');
    if (key === lobbyKey) return;
    // (what's being typed is kept across a redraw)
    const typed = lobby.querySelector('[data-chat]')?.value ?? '', focused = document.activeElement?.hasAttribute?.('data-chat');
    lobbyKey = key;
    lobby.innerHTML = html;
    const inp = lobby.querySelector('[data-chat]'); inp.value = typed; if (focused) inp.focus();
    drawChat();
    if (whoMenu) openWho(whoMenu);
  }
  function drawChat() {
    const log = lobby.querySelector('[data-chatlog]');
    if (!log) return;
    log.innerHTML = S.chat.map(m => `<div data-msg="${esc(m.id)}"><b>${esc(m.name)}</b>: ${esc(m.text)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }
  // a player's name clicked: mute, block, report (and add as a friend)
  let whoMenu = null;
  function openWho(uid) {
    whoMenu = uid;
    const p = S.lobby?.players.find(x => x.uid === uid), box = lobby.querySelector('[data-whomenu]');
    if (!p || !box) return;
    const muted = S.muted.has(uid), friend = S.friends?.some(f => f.id === uid);
    box.innerHTML = `<div class="row"><b>${esc(p.name)}</b> <button data-mute="${esc(uid)}">${muted ? 'Unmute' : 'Mute'}</button> ${friend ? '' : `<button data-befriend="${esc(uid)}">Add friend</button>`} <button data-block="${esc(uid)}">Block</button> <button data-report="${esc(uid)}">Report</button> <button data-whoclose>✕</button></div>`;
  }
  function sendSettings(patch) { S.send({ t: 'settings', settings: patch }); }
  lobby.addEventListener('click', e => {
    const w = e.target.closest('[data-who]'); if (w && w.dataset.who) { openWho(w.dataset.who); return; }
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if ('ready' in d) S.send({ t: 'ready', v: !S.me?.ready });
    if ('race' in d) S.send({ t: 'race' });
    if ('spectate' in d) S.send({ t: 'spectate' });
    if ('start' in d) S.send({ t: 'start' });
    if ('leave' in d) { leaving = true; void S.leaveRace().then(() => { lobby.hidden = true; game.leaveRace?.(); show(true); }); }
    if (d.kick) S.send({ t: 'kick', uid: d.kick });
    if ('send' in d) sendChat();
    if ('invite' in d) S.hubSend({ t: 'invite', to: lobby.querySelector('[data-invitewho]').value, roomId: S.lobby.roomId });
    if (d.mute) { S.mute(d.mute, !S.muted.has(d.mute)); lobbyKey = ''; drawLobby(); drawChat(); }
    if (d.befriend) { S.hubSend({ t: 'friend-add', id: d.befriend }); whoMenu = null; lobbyKey = ''; drawLobby(); }
    if (d.block) { S.hubSend({ t: 'block', id: d.block }); S.send({ t: 'block', uid: d.block }); S.mute(d.block, true); whoMenu = null; lobbyKey = ''; drawLobby(); }
    if (d.report) {
      const why = prompt('What did they do? (an admin will look at it: say what happened)');
      if (why && why.trim().length >= 5) S.hubSend({ t: 'report', id: d.report, kind: 'behaviour', details: why.trim(), ref: { roomId: S.lobby?.roomId, raceId: S.raceId ?? undefined } });
      else if (why) notice('Say what happened (a few words at least).');
    }
    if ('whoclose' in d) { whoMenu = null; lobby.querySelector('[data-whomenu]').innerHTML = ''; }
  });
  function sendChat() { const inp = lobby.querySelector('[data-chat]'); const t = inp.value.trim(); if (t) S.send({ t: 'chat', text: t }); inp.value = ''; }
  lobby.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.hasAttribute('data-chat')) sendChat(); }, true);
  lobby.addEventListener('keyup', e => e.stopPropagation(), true);
  menu.addEventListener('keydown', e => e.stopPropagation(), true);
  lobby.addEventListener('change', e => {
    const t = e.target, set = S.lobby?.settings;
    if (t.hasAttribute('data-car')) return S.send({ t: 'car', instanceId: t.value });
    if (!set) return;
    if (t.dataset.class) { const on = [...lobby.querySelectorAll('[data-class]')].filter(x => x.checked).map(x => x.dataset.class); return sendSettings({ classes: on.length ? on : null }); }
    const k = t.dataset.set;
    if (k === 'venueKind') return sendSettings({ venue: t.value === 'route' ? { kind: 'route', id: game.routes?.[0]?.id } : t.value === 'official' ? { kind: 'official', which: 'daily' } : t.value === 'track' ? { kind: 'track', code: set.venue.code ?? '' } : { kind: 'random' } });
    if (k === 'route') return sendSettings({ venue: { kind: 'route', id: t.value } });
    if (k === 'official') return sendSettings({ venue: { kind: 'official', which: t.value } });
    if (k === 'code') return sendSettings({ venue: { kind: 'track', code: t.value.trim() } });
    if (k === 'laps') return sendSettings({ laps: Number(t.value) });
    if (k === 'npcFill' || k === 'listed') return sendSettings({ [k]: t.checked });
    if (k) return sendSettings({ [k]: t.value });
  });

  // ---------- the lights: on the server's clock, to the millisecond (timers, not frames) ----------
  let lightTimer = null, lightsState = '';
  function setLights(L) {
    const k = `${L.red}|${L.green}`;
    if (k === lightsState) return;
    const was = lightsState;
    lightsState = k;
    [...lights.children].forEach((i, n) => { i.className = n < L.red ? 'red' : L.green ? 'green' : ''; });
    // (the moment they went out, on this computer's clock: the tests compare every window's with the server's)
    if (L.red === 0 && L.green && was.startsWith('5|')) globalThis.__krMpLightsOut = performance.timeOrigin + performance.now();
  }
  function armLights() {
    clearTimeout(lightTimer); lightTimer = null;
    const go = S.goAt, net = S.race?.net;
    if (go == null || !net || !['countdown', 'racing'].includes(S.phase)) return;
    const L = R.lights();
    setLights(L);
    const left = go - net.roomNow(), step = cfg.race.lightsSec * 1000 / 5;
    // (when this window's clock says the lights go out, on this computer's clock: the tests compare it with the
    // server's goAt — the clocks' sync — and with when they really went out — the page keeping up)
    if (left > 0) globalThis.__krMpLightsAim = performance.timeOrigin + performance.now() + left;
    if (left <= -4000) return;
    // (the next change: the next light on, or all out at GO)
    const next = left > 0 ? (left > cfg.race.lightsSec * 1000 ? left - cfg.race.lightsSec * 1000 : left - Math.floor((left - 1e-6) / step) * step) : 1000;
    lightTimer = setTimeout(armLights, Math.max(0, Math.min(next + 0.5, 250)));
  }

  // ---------- the race HUD ----------
  function drawHud() {
    const st = S.standings?.list ?? [], meS = st.find(x => x.pid === S.myUid), clock = R.clock(), lap = R.lap;
    const showHud = !!S.race && ['countdown', 'racing'].includes(S.phase) && R.state !== 'loading' && R.state !== 'idle';
    hud.hidden = !showHud;
    if (!showHud) return;
    const gap = x => x.status === 'finished' ? fmtTime(x.timeMs / 1000) : x.status === 'dnf' ? 'DNF' : x.gapMs != null && x.place > 1 ? `+${(x.gapMs / 1000).toFixed(1)}` : '';
    const deadline = S.lobby?.finishDeadline, left = deadline != null ? (deadline - S.race.net.roomNow()) / 1000 : null;
    hud.innerHTML = `${meS ? `<div class="pos" data-pos>${ord(meS.place)}<small> / ${st.length}</small></div>` : '<div class="dim">Watching</div>'}
      ${lap && lap.laps > 1 ? `<div data-lap>Lap ${Math.min(lap.lap, lap.laps)} / ${lap.laps}</div>` : ''}
      <div class="clock" data-clock>${clock != null && clock > 0 ? fmtTime(clock) : '0:00.00'}</div>
      ${left != null && left > 0 ? `<div class="warn">Finish within ${Math.ceil(left)} s</div>` : ''}
      <table data-standings>${st.map(x => `<tr class="${x.pid === S.myUid ? 'me' : ''}" data-pid="${esc(x.pid)}"><td>${x.place}.</td><td>${esc(x.pid === S.myUid ? 'You' : x.name)}${x.away ? ' ⚠' : ''}</td><td>${esc(gap(x))}</td></tr>`).join('')}</table>`;
  }

  // ---------- the results: provisional, then confirmed; the podium; the rematch vote ----------
  function drawResults() {
    const res = S.results, conf = S.confirmed;
    if (!res || !S.race || resultsHidden || S.phase === 'lobby') { results.hidden = true; return; }
    results.hidden = false;
    const confirmed = !!conf && conf.state === 'confirmed' && conf.id === res.raceId;
    const list = confirmed && conf.confirmed?.length ? conf.confirmed : res.results;
    const top = list.filter(r => r.status === 'finished').slice(0, 3);
    const mine = confirmed ? conf.confirmed.find(p => p.uid === S.myUid) : null;
    const row = r => {
      const uid = r.uid ?? r.pid, you = uid === S.myUid;
      const status = r.status === 'dsq' ? `<span class="bad">DSQ</span> <span class="dim">${esc(r.problems?.[0] ?? '')}</span>` : r.status === 'finished' ? `${fmtTime(r.timeMs / 1000)}${r.penaltyMs ? ` <span class="bad">+${r.penaltyMs / 1000}s</span>` : ''}` : `DNF${r.why ? ` <span class="dim">(${esc(r.why)})</span>` : ''}`;
      const pay = r.pay ? `${r.pay.money ? `<span class="good">+${money(r.pay.money)}</span>` : ''}${r.pay.xp ? ` +${r.pay.xp} xp` : ''}` : '';
      const rank = r.rank ? (tierLabel(r.rank.before) !== tierLabel(r.rank.after) ? `${esc(tierLabel(r.rank.before))} → <b class="${r.rank.change?.down ? 'bad' : 'good'}">${esc(tierLabel(r.rank.after))}</b>` : `<span class="tier">${esc(tierLabel(r.rank.after))}</span>${r.rank.change?.ordinalDelta ? ` <span class="${r.rank.change.ordinalDelta > 0 ? 'good' : 'bad'}">${r.rank.change.ordinalDelta > 0 ? '▲' : '▼'}</span>` : ''}`) : '';
      return `<tr class="${you ? 'me' : ''}" data-uid="${esc(uid)}"><td>${r.place ?? '—'}.</td><td>${esc(you ? 'You' : r.name)}${r.npc ? ' <span class="dim">NPC</span>' : ''}</td><td>${status}</td>${confirmed ? `<td>${pay}</td><td>${rank}</td>` : ''}</tr>`;
    };
    const votes = S.votes;
    const html = `<h2 data-state="${confirmed ? 'confirmed' : 'provisional'}">Results · ${confirmed ? '<span class="good">confirmed</span>' : '<span class="warn">provisional — checking the runs…</span>'}</h2>
      ${top.length ? `<div class="podium" data-podium>${[1, 0, 2].filter(i => top[i]).map(i => `<div class="p${i + 1}" data-podium-place="${i + 1}">${i + 1}. ${esc((top[i].uid ?? top[i].pid) === S.myUid ? 'You' : top[i].name)}</div>`).join('')}</div>` : ''}
      <table data-results><tr><th></th><th>Driver</th><th>Time</th>${confirmed ? '<th>Pay</th><th>Rank</th>' : ''}</tr>${list.map(row).join('')}</table>
      ${S.verdict && !S.verdict.ok ? `<div class="bad">Your run didn't pass the check: ${esc((S.verdict.problems ?? []).join(' '))}</div>` : ''}
      ${mine?.rank ? `<div data-mytier>Your rank: ${esc(tierLabel(mine.rank.before))} → <b>${esc(tierLabel(mine.rank.after))}</b>${mine.rank.after?.placement ? ` <span class="dim">(${mine.rank.after.placement} placement race${mine.rank.after.placement > 1 ? 's' : ''} to go)</span>` : ''}${conf.ranked ? '' : ' <span class="dim">(not a ranked race: no change)</span>'}${mine.pay ? ` · <span class="good">+${money(mine.pay.money)}</span> +${mine.pay.xp} xp` : ''}</div>` : ''}
      <div class="row"><button class="primary" data-rematch>${myVote ? 'Voted: rematch ✓' : 'Rematch'}</button>${votes ? `<span class="dim" data-votes>${votes.yes} of ${votes.of} want a rematch</span>` : ''}
        <button data-watchothers>Watch</button><button class="danger" data-leaveres>Back to the menu</button></div>`;
    const key = html;
    if (key === resultsKey) return;
    resultsKey = key; results.innerHTML = html;
  }
  results.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if ('rematch' in d) { myVote = !myVote; S.send({ t: 'rematch', v: myVote }); resultsKey = ''; drawResults(); }
    if ('watchothers' in d) { resultsHidden = true; results.hidden = true; R.watch(true); }
    if ('leaveres' in d) { leaving = true; void S.leaveRace().then(() => { results.hidden = true; game.leaveRace?.(); show(true); }); }
  });

  // ---------- keys in a race: watching (W), the car (← →) and camera (C); Esc: leave ----------
  function onKey(e) {
    if (!S.race || e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return;
    const ph = S.phase, inRace = ph && ph !== 'lobby';
    if (e.code === 'F7') { e.preventDefault(); toggle(); return; }
    if (!inRace) return;
    const watchable = R.watching || S.me?.role === 'spectator' || ['finished', 'out', 'loaded'].includes(R.state) || ph === 'results';
    if (e.code === 'KeyW' && watchable && !R.racing) { e.preventDefault(); e.stopImmediatePropagation(); R.watch(!R.watching); if (ph === 'results') { resultsHidden = !!R.watching; drawResults(); } }
    else if (R.watching && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) { e.preventDefault(); e.stopImmediatePropagation(); R.nextCar(e.code === 'ArrowRight' ? 1 : -1); }
    else if (R.watching && e.code === 'KeyC') { e.preventDefault(); e.stopImmediatePropagation(); R.nextCamera(); }
    else if (e.code === 'Escape' && R.watching && ph === 'results') { e.preventDefault(); e.stopImmediatePropagation(); R.watch(false); resultsHidden = false; resultsKey = ''; drawResults(); }
    else if (e.code === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      const ranked = S.lobby?.settings?.ranked && ['countdown', 'racing'].includes(ph) && R.racing;
      if (confirm(ranked ? 'Leave the race? In a ranked race it counts as last place, and leaving often means a wait before the next quick race.' : 'Leave the race?')) { leaving = true; void S.leaveRace().then(() => { game.leaveRace?.(); }); }
    } else if (e.code === 'KeyT' || e.code === 'F2') e.stopImmediatePropagation();          // (not another world, mid-race)
  }
  addEventListener('keydown', onKey, true);
  addEventListener('keydown', e => { if (e.code === 'F7' && !S.race && e.target?.tagName !== 'INPUT') { e.preventDefault(); toggle(); } });

  let lastFrameAt = null;
  function frame() {
    // (how long frames really take — the tests judge the lights by it)
    const tNow = performance.now();
    if (lastFrameAt != null) globalThis.__krMpFrameMs = (globalThis.__krMpFrameMs ?? tNow - lastFrameAt) * 0.8 + (tNow - lastFrameAt) * 0.2;
    lastFrameAt = tNow;
    const ph = S.phase, inRace = !!S.race && ph && ph !== 'lobby';
    // loading: where it's going, and who's in
    const showLoading = inRace && (R.state === 'loading' || (R.state === 'loaded' && ph === 'loading'));
    loading.hidden = !showLoading;
    if (showLoading) {
      const L = S.lobby, n = L?.players.filter(p => p.role === 'racer' && !p.npc) ?? [], done = n.filter(p => p.loaded).length;
      const html = `<h2>${esc(L?.venue?.name ?? 'Loading')}</h2><div data-progress>${esc(R.state === 'loading' ? R.progress : 'Waiting for the others to load…')}</div><div class="dim">${done} of ${n.length} loaded${L?.loadDeadline ? ` · starting in at most ${Math.max(0, Math.ceil((L.loadDeadline - S.race.net.roomNow()) / 1000))} s` : ''}</div>`;
      if (loading.innerHTML !== html) loading.innerHTML = html;
    }
    // the lights: shown through the countdown and a moment after GO
    const L = R.lights(), cd = inRace && (ph === 'countdown' || (ph === 'racing' && (R.clock() ?? 99) < 3)) && !L.waiting;
    lights.hidden = !cd;
    if (cd && !lightTimer) armLights();
    if (cd) setLights(L);
    if (!cd && lightsState) { lightsState = ''; clearTimeout(lightTimer); lightTimer = null; }
    hudAt -= 1; if (hudAt <= 0) { hudAt = 6; drawHud(); }
    if (!inRace) { hud.hidden = true; results.hidden = !!(results.hidden || !S.results); }
    if (inRace && ph === 'results' && results.hidden && !resultsHidden) drawResults();
    // watching: whose car, which camera
    const w = R.watching;
    watchBar.hidden = !inRace || (!w && !(['finished', 'out'].includes(R.state) || S.me?.role === 'spectator'));
    if (!watchBar.hidden) {
      const html = w ? `<div class="mpBox" style="position:static;padding:6px 12px">Watching <b data-watching>${w.place && w.place < 99 ? `${w.place}. ` : ''}${esc(w.name ?? '…')}</b> · <span data-camera>${esc(cameraName(w.mode))}</span> camera · ← → car · C camera · ${ph === 'results' ? 'Esc results' : 'W stop watching'}</div>`
        : `<div class="mpBox" style="position:static;padding:6px 12px">${R.state === 'finished' ? 'Finished! ' : ''}W: watch the others</div>`;
      if (watchBar.innerHTML !== html) watchBar.innerHTML = html;
    }
    if (menuOpen && queueing) { const q = menu.querySelector('[data-qtime]'); if (q) q.textContent = `${Math.round((performance.now() - queueing.since) / 1000)} s`; }
    button.hidden = !!S.race;
  }

  return {
    show, toggle,
    get open() { return menuOpen; },
    frame,
    dispose() { removeEventListener('keydown', onKey, true); for (const f of offs) f(); for (const e of [menu, lobby, loading, lights, hud, results, watchBar, toasts, button]) e.remove(); clearTimeout(lightTimer); },
  };
}
