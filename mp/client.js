// A player's multiplayer, the game's side (Phase 7 Step 2; docs/MULTIPLAYER.md): the hub (friends, invites, parties,
// the lobby browser), the quick-race queue, and the lobby and race they're in — the same for the game's screens
// (play/mpScreens.js) and the bots (mp/bot.js). Nothing of the page in here.
//
//   const S = createMpSession({ transport, endpoint, getTicket, look, now })
//     getTicket() → { ticket, url }: a fresh one each join (they're used once)
//   await S.hub()                  the hub: S.friends, S.requests { incoming, outgoing }, S.party; events 'friends' 'invite' 'party'
//                                  'party-invite' 'goto' 'notice' — S.hubSend({ t: 'friend-add', name }) and the like (server/src/rt/hub.ts)
//   await S.queue({ region, pings, car, party })   the quick-race queue: 'queued' then 'matched' (NPCs fill the empty places after npcFillSec) — and the race joined by itself
//   S.acceptNpcs(yes)  S.leaveQueue()
//   await S.createLobby({ kind: 'private' | 'custom', settings })    await S.joinLobby(roomId, { spectate })    await S.joinCode(code)
//   S.race: the lobby/race joined — S.race.net (net/client.js: cars), S.lobby (its latest view), S.chat, S.standings, S.results, S.confirmed
//   S.send(msg)  to the lobby/race: ready, car, settings, start, kick, chat, loaded, spectate, race, run, rematch, ping
//   S.sendRun(result, recording, contact)  a finished run, its recording (and its contact record) in pieces if long
//   S.leaveRace()   S.on(event, fn) → off   S.close()
//   S.mute(uid, on)   a player's chat hidden here (this game's choice: kept by the screens, nothing sent); S.muted
//   S.me (this player in the lobby's view)  S.isHost  S.votes (the rematch vote: { yes, of })
//   events: 'lobby' 'chat' 'phase' 'load' 'event' 'standings' 'results' 'confirmed' 'verdict' 'votes' 'notice' 'left' (and the hub's and queue's)
// (Phase 7 Step 5) the server restarting — an update, a crash: a race or lobby lost for good says so in a notice (and its
// 'left' has nothing more to say); the queue's 'queue-left' carries a message; the hub joins again by itself, with a
// fresh ticket, waiting longer each time (NET.rejoin) — 'hub-back' — unless it was closed for good (banned, another tab,
// an old game, signed out, S.close()).

import { createNetClient } from '../net/client.js';
import { PROTOCOL, CODES, messageFor } from '../net/protocol.js';
import { NET } from '../net/settings.js';

// (leaving a room that's already gone — kicked, closed — never answers: give up waiting after a moment)
const settle = (p, ms = 2000) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise(r => setTimeout(r, ms))]);
// (a connection gone because the server went: closed for an update (CLOSED), shut down (Colyseus's 4001), or reconnecting
// gave up (4003) — the server it was on isn't there any more)
const GONE = new Set([CODES.CLOSED, 4001, 4003]);
// (the hub closed for good, or no ticket for it — signed out, banned, an old game: not joined again)
const FINAL = new Set([4000, 1000, CODES.BANNED, CODES.ELSEWHERE, CODES.VERSION, CODES.KICKED, CODES.TICKET, CODES.GUESTS, 'BANNED', 'UNAUTHENTICATED', 'TERMS_REQUIRED', 'FORBIDDEN', 'CLIENT_TOO_OLD']);
const RESTARTED = {
  race: 'The race server restarted, so this race was called off. Nothing was lost.',
  lobby: 'The race server restarted, so the lobby closed. Nothing was lost.',
  queue: 'The race server is restarting, so you left the queue. Nothing was lost: queue again in a minute.',
};

export function createMpSession({ transport, endpoint = null, getTicket, look = null, now = () => performance.now(), netsim = null, serverNetsim = null }) {
  const listeners = new Map();
  const emit = (k, v) => { for (const f of listeners.get(k) ?? []) { try { f(v); } catch (e) { console.warn(e); } } };
  let hub = null, queue = null, race = null, codeWait = null, hubState = 'menu', hubRetry = null, hubJoining = null, stopped = false;
  const say = text => { S.notices.push(text); if (S.notices.length > 50) S.notices.shift(); emit('notice', text); };
  // the hub joined again after the server went: a fresh ticket each try (S.hub), waiting longer each time
  const rejoinHub = (n = 0) => {
    if (stopped || hub || hubRetry) return;
    const ms = Math.min(NET.rejoin.maxMs, NET.rejoin.firstMs * 2 ** n) * (0.8 + Math.random() * 0.4);
    hubRetry = setTimeout(async () => {
      hubRetry = null;
      if (stopped || hub) return;
      try { await joinHub(hubState); emit('hub-back', {}); }
      catch (e) { if (FINAL.has(e?.code)) emit('hub-left', { code: e.code, reason: e.message }); else rejoinHub(n + 1); }
    }, ms);
    hubRetry.unref?.();
  };
  // (one join at a time: asked again meanwhile, the same one)
  const joinHub = state => hub ? Promise.resolve(hub) : (hubJoining ??= openHub(state).finally(() => { hubJoining = null; }));
  async function openHub(state) {
    const t = await getTicket();
    const h = await transport.join(endpoint ?? t.url, 'hub', { ticket: t.ticket, protocol: PROTOCOL, state });
    hub = h;
    hub.onJson(m => {
      if (codeWait && m.t === 'goto') return codeWait.res(m.roomId);
      if (codeWait && m.t === 'notice') return codeWait.rej(new Error(m.text));
      if (m.t === 'hello') { S.friends = m.friends; S.requests = { incoming: m.incoming ?? [], outgoing: m.outgoing ?? [] }; S.party = m.party; emit('friends', S.friends); }
      if (m.t === 'friends') { S.friends = m.list; S.requests = { incoming: m.incoming ?? [], outgoing: m.outgoing ?? [] }; emit('friends', S.friends); }
      if (m.t === 'party') { S.party = m.party; emit('party', S.party); }
      if (m.t === 'party-queue') emit('party-queue', m);
      if (m.t === 'notice') say(m.text);
      if (['invite', 'party-invite', 'goto', 'lobbies', 'pong', 'roam-place', 'roam-goto', 'chat'].includes(m.t)) emit(m.t, m);   // (Phase 7 Step 4: free roam's placing, joining a friend, party chat)
    });
    hub.onStatus((s, info) => { if (s === 'left' && hub === h) { hub = null; emit('hub-left', info); if (!FINAL.has(info?.code)) rejoinHub(); } });
    return hub;
  }
  const S = {
    friends: [], requests: { incoming: [], outgoing: [] }, party: null, lobby: null, myUid: null, muted: new Set(), votes: null,
    mute(uid, on = true) { if (on) S.muted.add(uid); else S.muted.delete(uid); S.chat = S.chat.filter(m => !S.muted.has(m.uid)); emit('chat-log', S.chat); }, chat: [], standings: null, results: null, confirmed: null, verdict: null, raceId: null, venue: null, phase: null, goAt: null, notices: [],
    on(k, fn) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(fn); return () => listeners.get(k)?.delete(fn); },
    get race() { return race; }, get hubConn() { return hub; }, get queueConn() { return queue; },
    // (this player in the lobby's view, and whether they're its host)
    get me() { return S.lobby?.players.find(p => p.uid === S.myUid) ?? null; }, get isHost() { return !!S.lobby && S.lobby.host === S.myUid && S.lobby.kind !== 'quick'; },

    async hub(state) {
      stopped = false;
      if (state) hubState = state;
      return joinHub(hubState);
    },
    hubSend(m) { if (m?.t === 'status' && typeof m.state === 'string') hubState = m.state; hub?.sendJson(m); },
    // (the round trip to the real-time server, ms: the queue matches players by it)
    async ping() { await S.hub(); const id = Math.random().toString(36).slice(2), t0 = now(); return new Promise(res => { const off = S.on('pong', m => { if (m.id === id) { off(); res(Math.round(now() - t0)); } }); S.hubSend({ t: 'ping', id }); setTimeout(() => { off(); res(null); }, 3000); }); },
    lobbies() { return new Promise(res => { const off = S.on('lobbies', m => { off(); res(m.list); }); S.hubSend({ t: 'lobbies' }); setTimeout(() => { off(); res([]); }, 5000); }); },

    async queue({ region = 'local', pings = { local: 50 }, car = null, party = null } = {}) {
      if (queue) return queue;
      const t = await getTicket();
      const url = endpoint ?? t.url;
      // (refused — the server restarting, a cooldown: the caller says why, once)
      queue = await transport.join(url, 'queue', { ticket: t.ticket, protocol: PROTOCOL, region, pings, car, party });
      queue.onJson(async m => {
        if (m.t === 'queued') emit('queued', m);
        if (m.t === 'matched') {
          emit('matched', m);
          const q = queue; queue = null;
          // (a reserved seat takes no ticket, so no address from one: the queue's server's)
          try { await S.joinRace({ how: 'reservation', reservation: m.reservation, endpoint: url }); } catch (e) { emit('notice', e.message ?? 'Couldn\'t join the race.'); }
          void settle(q?.leave());
        }
      });
      // (closed by the server: why, for the screens — the server restarting said plainly)
      queue.onStatus((s, info) => { if (s === 'left' && queue) { queue = null; emit('queue-left', { ...info, message: info?.code === 4000 || info?.code === 1000 ? '' : GONE.has(info?.code) ? RESTARTED.queue : messageFor(info?.code, info?.reason || 'Disconnected from the game server.') }); } });
      return queue;
    },
    acceptNpcs(yes = true) { queue?.sendJson({ t: 'npc', yes }); },
    async leaveQueue() { const q = queue; queue = null; await settle(q?.leave()); },

    async createLobby({ kind = 'custom', settings = {} } = {}) { return S.joinRace({ how: 'create', options: { kind, settings } }); },
    async joinLobby(roomId, { spectate = false } = {}) { return S.joinRace({ how: 'joinById', roomId, options: { spectate } }); },
    async joinCode(code) {
      await S.hub();
      // (the hub's answer is for this, not a 'goto' for anyone else listening)
      const roomId = await new Promise((res, rej) => {
        const done = f => v => { clearTimeout(t); codeWait = null; f(v); };
        codeWait = { res: done(res), rej: done(rej) };
        S.hubSend({ t: 'code', code });
        const t = setTimeout(() => codeWait?.rej(new Error('No answer.')), 8000);
      });
      return S.joinLobby(roomId);
    },
    async joinRace(join) {
      if (race) await S.leaveRace();
      Object.assign(S, { lobby: null, chat: [], standings: null, results: null, confirmed: null, verdict: null, raceId: null, phase: null, goAt: null, votes: null, venue: null });
      const net = createNetClient({ transport, endpoint: join.endpoint ?? endpoint, getTicket, roomName: 'race', join, world: 'race', look, now, netsim, serverNetsim });
      await net.connect();
      // (kept alive while nobody's drawing cars — in the lobby, on the results: the server closes a connection it hasn't
      // heard from for NET.idleSec; racing, the game's frames do it)
      let heard = now();
      const update = net.update;
      net.update = (dt, local) => { heard = now(); return update(dt, local); };
      let pingAt = 0;
      const keep = setInterval(() => {
        if (now() - heard > 1000) net.update(0.25, () => null);
        // (the round trip, measured by the clock's sync, for the lobby's ping column)
        if (now() - pingAt > 5000) { pingAt = now(); const ms = net.stats.ping; if (Number.isFinite(ms) && ms > 0) net.conn?.sendJson({ t: 'ping', ms: Math.round(ms) }); }
      }, 500);
      race = { net, id: net.conn.roomId, keep };
      net.conn.onJson(m => onRace(m));
      // (lost for good because the server went: a notice says so — the race called off, or the lobby closed — and 'left'
      // has nothing more to say)
      net.on('status', st => {
        if (st.status === 'offline' && race?.net === net && GONE.has(st.code)) { say(['loading', 'countdown', 'racing'].includes(S.phase) ? RESTARTED.race : RESTARTED.lobby); emit('left', { ...st, message: '', restarted: true }); }
        else if (st.status === 'offline') emit('left', st);
        emit('race-status', st);
      });
      return race;
    },
    send(m) { race?.net.conn?.sendJson(m); },
    // a finished run handed in to be checked: its recording in pieces when it's long (a message is at most 64 kB)
    // (and, Phase 7 Step 3, its contact record — mp/runRecord.js: inputs, pushes, the car's changes — in pieces too)
    sendRun(result, recording, contact = null) {
      const size = 40000;
      const pieces = (text, field) => { const of = Math.ceil(text.length / size); for (let i = 0; i < of; i++) S.send({ t: 'run-part', field, i, of, data: text.slice(i * size, (i + 1) * size) }); return of; };
      const data = recording?.data ?? '', ctext = contact ? JSON.stringify(contact) : '';
      const rec = data.length > size ? { ...recording, data: null, parts: pieces(data, 'data') } : recording;
      const contactParts = ctext.length > size ? pieces(ctext, 'contact') : 0;
      S.send({ t: 'run', result, recording: rec, ...(ctext ? contactParts ? { contactParts } : { contact: ctext } : {}) });
    },
    async leaveRace() { const r = race; race = null; clearInterval(r?.keep); Object.assign(S, { lobby: null, phase: null, goAt: null, standings: null, results: null, confirmed: null, verdict: null, votes: null, raceId: null, venue: null, chat: [] }); await settle(r?.net.leave()); },
    async close() { stopped = true; clearTimeout(hubRetry); hubRetry = null; await S.leaveQueue(); await S.leaveRace(); const h = hub; hub = null; await settle(h?.leave()); },
  };
  function onRace(m) {
    switch (m.t) {
      case 'lobby': if (m.phase === 'lobby' && S.phase && S.phase !== 'lobby') Object.assign(S, { standings: null, results: null, confirmed: null, verdict: null, votes: null }); S.lobby = m; S.myUid = m.you ?? S.myUid; S.phase = m.phase; S.goAt = m.goAt; S.raceId = m.raceId ?? S.raceId; if (m.confirmed) S.confirmed = m.confirmed; break;
      case 'chat-log': S.chat = m.messages.filter(x => !S.muted.has(x.uid)); break;
      case 'chat': if (S.muted.has(m.uid)) return; S.chat.push(m); if (S.chat.length > 100) S.chat.shift(); break;
      case 'load': S.raceId = m.raceId; S.venue = m.venue; break;
      case 'phase': S.phase = m.phase; if (m.goAt != null) S.goAt = m.goAt; break;
      case 'standings': S.standings = m; if (m.goAt != null) S.goAt = m.goAt; break;
      case 'results': S.results = m; S.raceId = m.raceId; S.phase = 'results'; break;
      case 'confirmed': S.confirmed = m.race; break;
      case 'verdict': S.verdict = m.verdict; break;
      // (its text, as the hub's: the screens show it)
      case 'notice': say(m.text); return;
      case 'votes': S.votes = m; break;
    }
    emit(m.t, m);
  }
  return S;
}

