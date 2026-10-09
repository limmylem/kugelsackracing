// A lobby and its races (Phase 7 Step 2; docs/MULTIPLAYER.md "Lobbies" and "Race flow"): one room from the lobby to
// the results and back (a rematch). It's Step 1's room (room.ts: every car relayed, checked, interest-managed, time
// synced, reconnecting) with the race on top — the lobby's settings, players and chat, and the race itself, owned by
// the server (mp/race.js: loading, the grid, the countdown on the server's clock, live positions, the finish, DNFs).
//
//   kinds: quick (made by the queue: its players expected, ranked, it starts once they're in), private (an invite
//   code; the host's settings), custom (the host's settings; listed in the lobby browser unless the host says not)
//
// The game's messages ('mp', JSON):  ready { v } · car { instanceId } · settings { settings } (host) · start (host) ·
//   kick { uid } (host) · chat { text } · block { uid } · loaded { hash } · spectate · race · run { result, recording } (a long
//   recording first in pieces: run-part { i, of, data }) ·
//   rematch { v } · ping { ms } · contact-report (Phase 7 Step 3: a contact the game saw; ./contact.ts) ·
//   report-ramming { evidenceId, details } (the victim's one-tap report)
// What it sends:  lobby (everything: settings, players, host, phase, venue, code) · chat · event (the race's) ·
//   standings (4 a second while racing) · results (provisional) · confirmed (once the runs are checked) · notice ·
//   contact (the agreed result) · contact-rejected · ghosts (who touches nobody, and why) · ramming (to its victim)
// (Phase 7 Step 5) the results and runs reach the API however long it takes (outbox.ts: tried again for ~15 minutes);
// while the server drains for an update no race starts here, and it waits for the one under way (busy())

import type { Client } from '@colyseus/core';
import { CODES } from '../../../net/protocol.js';
import { quantise } from '../../../net/codec.js';
import { createRace } from '../../../mp/race.js';
import { normaliseSettings, carAllowed, createChatGate, nextHost } from '../../../mp/lobby.js';
import { speedPlan, createNpcDriver } from '../../../mp/npc.js';
import { tierOf } from '../../../mp/rank.js';
import { TestRoom, rtEnv, drain, DRAINING, type Player } from './room.ts';
import { send } from './outbox.ts';
import { loadtestBot } from './tickets.ts';
import { courseOf, setStatus, clearStatus, claimCode, renewCode, dropCode } from './mp.ts';
import { cleanChat } from '../names.ts';
import { MP, NPC_DRIVERS } from './mpData.ts';
import { createReferee } from './contact.ts';
import { generateTrack } from '../../../track/generate.js';
import { pitSpan, PIT } from '../../../track/gen/v2.js';
import { safetyTier } from '../../../mp/contact.js';

const MAX_RUN_PARTS = 200;
// (just after the finish, the players' runs come in: a server stopping for an update waits this long for them)
const RUNS_WAIT_MS = 30000;
// (a car as the race keeps it: its mass and body box from the ticket — the API's word, for car-to-car contact)
const STOCK = { mass: 1300, box: { halfExtents: [0.9, 0.6, 2.2], centre: [0, 0.7, 0] } };
const carOf = (c: any) => ({ instanceId: c.instanceId, carId: c.carId, name: c.name, cls: c.cls, pr: c.pr, mass: c.mass ?? STOCK.mass, box: c.box ?? STOCK.box });

type Npc = { pid: string; id: number; name: string; driver: any; latest: any; latestF: any; entry: any };

export class RaceRoom extends TestRoom {
  static races = new Set<RaceRoom>();
  kind: 'quick' | 'private' | 'custom' = 'custom';
  scope = 'race';
  settings: any;
  code: string | null = null;
  host: string | null = null;
  race: any = null;
  resolved: any = null;
  course: any = null;
  venueError: string | null = null;
  npcs = new Map<string, Npc>();
  gates = new Map<string, (now: number) => boolean>();
  kicked = new Map<string, number>();
  chat: any[] = [];
  expected: string[] = [];
  expectBy = 0;
  pings = new Map<string, number>();
  results: { raceId: string; at: number; posted: boolean; confirmed: any; polls: number; runs: Set<string> } | null = null;
  votes = new Map<string, boolean>();
  raceNo = 0;
  raceId: string | null = null;
  private lastStandings = 0;
  loadMsg: any = null;
  private plan: any = null;
  referee: ReturnType<typeof createReferee> | null = null;
  pit: any = null;

  async onCreate(options: any) {
    super.onCreate({ world: 'race' });
    RaceRoom.races.add(this);
    this.kind = ['quick', 'private', 'custom'].includes(options?.kind) ? options.kind : 'custom';
    this.maxClients = MP.lobby.maxPlayers + MP.spectate.maxSpectators;
    this.settings = normaliseSettings(options?.settings ?? {}, MP, { kind: this.kind }).settings;
    if (this.kind === 'quick') { this.settings.npcFill = !!options?.npcFill; this.settings.laps = 1; const v = rtEnv.quickVenue?.[options?.region] ?? rtEnv.quickVenue?.['*']; if (v) this.settings.venue = v; }
    this.expected = Array.isArray(options?.expect) ? options.expect.map(String) : [];
    this.expectBy = this.roomNow() + 20000;
    if (this.kind === 'private') { this.code = await claimCode(this.roomId, MP.lobby.codeLength); await this.setPrivate(true); }
    if (this.kind === 'quick') await this.setPrivate(true);
    this.onMessage('mp', (c, m) => { try { this.onMp(c, m); } catch (e: any) { rtEnv.log('rt race message failed', { err: e?.message }); } });
    this.clock.setInterval(() => this.raceTick(), 100);
    this.clock.setInterval(() => { if (this.code) void Promise.resolve(renewCode(this.code, this.roomId)).catch(() => {}); }, 600000);
    // (each player's status kept fresh for their friends)
    this.clock.setInterval(() => { for (const p of this.race?.players.values() ?? []) if (!p.npc && !p.gone && this.isHere(p.pid)) void this.status(p.pid); }, 30000);
    await this.setVenue(this.settings.venue);
    await this.meta();
  }
  onDispose() { super.onDispose(); RaceRoom.races.delete(this); if (this.code) void Promise.resolve(dropCode(this.code)).catch(() => {}); }

  // ---------- the venue: resolved by the API, its course in the cars' frame ----------
  async setVenue(venue: any) {
    const api = rtEnv.api;
    this.venueError = null;
    try {
      if (!api) throw new Error('No API to ask');
      this.resolved = await api.venue(venue);
      this.course = courseOf(this.resolved);
      if (!this.course) throw new Error('That route has no course.');
      this.plan = null;
      this.pit = this.pitOf(this.resolved);
    } catch (e: any) {
      this.venueError = e?.message ?? 'Couldn\'t load that route or track.';
      rtEnv.log('rt race venue failed', { room: this.roomId, err: this.venueError });
      if (venue?.kind !== 'random' && !this.course) return this.setVenue({ kind: 'random' });
    }
    this.newRace();
  }
  // a generated track's pit lane (Phase 7 Step 3: cars in it are ghosted) — along the main straight, beyond the road's
  // edge on its side (track/gen/v2.js)
  pitOf(v: any) {
    try {
      const code = v?.venue?.code ?? v?.code;
      if (!code || v?.frame?.kind === 'region') return null;
      const g: any = generateTrack({ code });
      if (!g?.ok || !g.track?.pit?.side) return null;
      const [from, to] = pitSpan(g.track);
      return { side: g.track.pit.side, from, to, edge: g.track.width / 2 + PIT.wall };
    } catch { return null; }
  }
  // (a race with the lobby's players in it, as they are)
  newRace() {
    const old = this.race;
    this.race = createRace({ cfg: MP, settings: { ...this.settings, maxPlayers: this.settings.maxPlayers, lastOrder: old?.state?.lastOrder ?? null }, course: this.course, now: this.roomNow(), seed: (Math.random() * 2 ** 31) | 0 });
    for (const p of this.players.values()) {
      if (p.status !== 'here' && !old) continue;
      const was = old?.players.get(p.t.uid);
      this.race.join(p.t.uid, { uid: p.t.uid, name: p.t.name, guest: p.t.guest, car: was?.car ?? this.defaultCar(p), rating: p.t.mp?.rating ?? null, spectator: was?.role === 'spectator' });
      const q = this.race.players.get(p.t.uid); if (q && was) q.joinedAt = was.joinedAt;
    }
  }
  defaultCar(p: Player) {
    const cars = p.t.mp?.cars ?? [];
    const allowed = cars.filter((c: any) => carAllowed(c, this.settings));
    const c = allowed.find((c: any) => c.current) ?? allowed[0] ?? cars.find((c: any) => c.current) ?? cars[0] ?? { instanceId: null, carId: 'starter_car', name: 'Starter car', cls: 'D', pr: 300 };
    return carOf(c);
  }

  // ---------- players ----------
  onJoin(client: Client, options: any) {
    const t: any = client.auth;
    const until = this.kicked.get(t.uid);
    if (until && until > Date.now()) { super.onJoin(client, options); const p = this.players.get(client.sessionId)!; this.kick(p, CODES.KICKED, 'The host removed you from this lobby.'); return; }
    super.onJoin(client, options);
    const p = this.players.get(client.sessionId)!;
    const r = this.race;
    const had = r.players.get(t.uid);
    if (had && !had.gone) { r.back(t.uid); this.referee?.onRejoin(t.uid); }
    else {
      if (had) r.players.delete(t.uid);
      const role = r.join(t.uid, { uid: t.uid, name: t.name, guest: t.guest, car: this.defaultCar(p), rating: t.mp?.rating ?? null, spectator: !!options?.spectate });
      r.players.get(t.uid).joinedAt = Date.now();
      if (role === 'spectator' && r.phase === 'lobby' && !options?.spectate) this.say(p, 'The grid is full: you\'re watching. A place may free up.');
    }
    if (!this.host || !this.isHere(this.host)) this.host = t.uid;
    if (!this.gates.has(t.uid)) this.gates.set(t.uid, createChatGate(MP.lobby.chat));
    void this.status(t.uid);
    this.sendTo(p, { t: 'chat-log', messages: this.chat.slice(-MP.lobby.chat.keep) });
    // (joining a race under way — to watch, or back after a page reload: what's being raced)
    if (r.phase !== 'lobby' && this.loadMsg) this.sendTo(p, this.loadMsg);
    this.broadcastLobby();
    void this.meta();
  }
  onDrop(client: Client) { const p = this.players.get(client.sessionId); if (p) this.race?.drop(p.t.uid, this.roomNow()); return super.onDrop(client); }
  onReconnect(client: Client) { super.onReconnect(client); const p = this.players.get(client.sessionId); if (p) { this.race?.back(p.t.uid); this.referee?.onRejoin(p.t.uid); this.broadcastLobby(); } }
  onLeave(client: Client, code?: number) {
    const p = this.players.get(client.sessionId);
    super.onLeave(client);
    if (!p) return;
    const uid = p.t.uid;
    // (the same player back in a new connection: nothing's lost)
    if ([...this.players.values()].some(o => o.t.uid === uid)) return;
    const consented = code === 4000 || p.kicked;
    if (consented || this.race.phase === 'lobby' || this.race.phase === 'results') this.race.leave(uid, this.roomNow());
    else this.race.drop(uid, this.roomNow());                         // (gone without a word: out after the grace)
    this.votes.delete(uid);
    void Promise.resolve(clearStatus(uid)).catch(() => {});
    if (this.host === uid) { const n = nextHost([...this.race.players.values()].filter((x: any) => this.isHere(x.pid)), uid); this.host = n?.pid ?? null; if (this.host) this.broadcastJson({ t: 'notice', text: `${this.race.players.get(this.host)?.name} is the host now.` }); }
    this.broadcastLobby();
    void this.meta();
  }
  isHere(uid: string) { return [...this.players.values()].some(p => p.t.uid === uid && p.status === 'here'); }
  playerOf(c: Client) { return this.players.get(c.sessionId); }

  // ---------- the game's messages ----------
  onMp(c: Client, m: any) {
    const p = this.playerOf(c);
    if (!p || !m || typeof m.t !== 'string') return;
    const uid = p.t.uid, r = this.race, now = this.roomNow(), isHost = uid === this.host && this.kind !== 'quick';
    switch (m.t) {
      case 'ready': r.setReady(uid, !!m.v); break;
      case 'car': {
        const car = (p.t.mp?.cars ?? []).find((x: any) => x.instanceId === m.instanceId);
        if (!car) return this.say(p, 'That car isn\'t one of yours.');
        if (!carAllowed(car, this.settings)) return this.say(p, `This lobby is for class ${this.settings.classes.join(', ')} cars.`);
        r.setCar(uid, carOf(car));
        break;
      }
      case 'settings': {
        if (!isHost) return this.say(p, 'Only the host changes the settings.');
        if (r.phase !== 'lobby') return;
        const { settings, problems } = normaliseSettings({ ...this.settings, ...m.settings }, MP, { kind: this.kind });
        const venueChanged = JSON.stringify(settings.venue) !== JSON.stringify(this.settings.venue);
        this.settings = settings;
        for (const pr of problems) this.say(p, pr);
        // (cars that aren't allowed any more: back to one that is)
        if (venueChanged) { void this.setVenue(settings.venue).then(() => { this.fixCars(); this.broadcastLobby(); void this.meta(); }); return; }
        this.newRace(); this.fixCars();
        break;
      }
      case 'start': {
        if (!isHost) return this.say(p, 'Only the host starts the race.');
        if (drain.on) return this.say(p, DRAINING);
        this.begin(now);
        break;
      }
      case 'kick': {
        if (!isHost) return;
        const target = [...this.players.values()].find(o => o.t.uid === m.uid);
        if (!target || m.uid === uid) return;
        this.kicked.set(m.uid, Date.now() + MP.lobby.kickBanSec * 1000);
        this.broadcastJson({ t: 'notice', text: `${target.t.name} was removed by the host.` });
        this.kick(target, CODES.KICKED, 'The host removed you from this lobby.');
        break;
      }
      case 'chat': {
        if (!this.gates.get(uid)?.(now)) return this.say(p, 'Slow down: a message a second or so.');
        const text = cleanChat(m.text, MP.lobby.chat.maxLength);
        if (!text) return;
        const msg = { t: 'chat', id: `${now.toFixed(0)}-${uid.slice(-4)}`, uid, name: p.t.name, text, at: Date.now() };
        this.chat.push(msg); if (this.chat.length > MP.lobby.chat.keep) this.chat.shift();
        // (blocked either way: not shown to them — the game hides it too, and mutes are the game's own)
        for (const o of this.players.values()) if (!(o.t.mp?.blocked ?? []).includes(uid) && !(p.t.mp?.blocked ?? []).includes(o.t.uid)) this.sendTo(o, msg);
        return;
      }
      case 'loaded': {
        const res = r.loaded(uid, { hash: m.hash ?? null }, now);
        if (!res.ok) this.say(p, res.why);
        break;
      }
      // (blocked from here: their chat hidden from now on — the block itself is kept by the API, through the hub)
      case 'block': if (typeof m.uid === 'string' && m.uid !== uid) { const t: any = p.t; t.mp ??= {}; t.mp.blocked = [...new Set([...(t.mp.blocked ?? []), m.uid.slice(0, 80)])].slice(-400); } return;
      case 'spectate': r.makeSpectator(uid); break;
      case 'race': r.makeRacer(uid); break;
      case 'contact-report': if (r.phase === 'countdown' || r.phase === 'racing') this.referee?.report(uid, m); return;
      case 'contact-replay': {
        // (a racer's F10 replay: the contact as the server logged it — both games' views, its own record of the cars)
        const c = this.referee?.contacts.find((x: any) => x.cid === m.cid);
        if (!c || !c.cars?.[uid]) { this.sendTo(p, { t: 'contact-replay', cid: m.cid, contact: null, why: c ? 'Only the players in a contact can replay it here.' : 'That contact isn\'t kept any more.' }); return; }
        this.sendTo(p, { t: 'contact-replay', cid: m.cid, contact: c });
        return;
      }
      case 'report-ramming': {
        // (the victim's one-tap report: the race server's replay attached — the API checks it's theirs)
        if (typeof m.evidenceId !== 'string' || typeof m.by !== 'string') return;
        void rtEnv.api?.act(uid, { action: 'report', id: m.by, kind: 'behaviour', details: String(m.details ?? 'Rammed me again and again in a race.').slice(0, 500), ref: { raceId: this.raceId ?? '', evidenceId: m.evidenceId } })
          .then(() => this.say(p, 'Reported, with the replay: thanks — the admins will look at it.'), (e: any) => this.say(p, `The report didn't go: ${e?.message ?? 'try again'}`));
        return;
      }
      case 'run-part': this.runPart(p, m); return;
      case 'run': void this.handIn(p, m); return;
      case 'rematch': this.votes.set(uid, !!m.v); this.checkRematch(); break;
      case 'ping': {
        if (!Number.isFinite(m.ms)) return;
        const was = this.pings.get(uid), ms = Math.max(0, Math.min(9999, Math.round(m.ms)));
        this.pings.set(uid, ms);
        // (the lobby's ping column: shown again when someone's has changed by much)
        if (r.phase === 'lobby' && (was == null || Math.abs(was - ms) > 20)) break;
        return;
      }
      default: return;
    }
    this.broadcastLobby();
  }
  fixCars() { for (const q of this.race.players.values()) if (!q.npc && q.car && !carAllowed(q.car, this.settings)) { const p = [...this.players.values()].find(x => x.t.uid === q.pid); if (p) { q.car = this.defaultCar(p); q.ready = false; } } }

  // ---------- the race ----------
  begin(now: number) {
    const r = this.race;
    if (r.phase !== 'lobby' || !this.course || drain.on) return;
    // (NPCs into the empty slots, if this lobby has them)
    if (this.settings.npcFill) {
      const racing = [...r.players.values()].filter((x: any) => x.role === 'racer').length, want = Math.max(0, r.maxRacers - racing);
      const pool = [...NPC_DRIVERS].sort(() => Math.random() - 0.5);
      for (let i = 0; i < want && i < pool.length; i++) {
        const d = pool[i], pid = `npc:${d.id}`;
        r.join(pid, { uid: pid, name: d.name, npc: true, car: { carId: d.car, name: d.car, cls: this.settings.classes?.[0] ?? 'C', pr: 0 }, rating: { mu: 25, sigma: 8 } });
      }
    }
    this.raceNo++;
    this.freshStates();
    // (the race's id from the start: each player's run is a quest named after it — mp/quest.js)
    this.raceId = `${this.roomId}-${this.raceNo}-${Date.now().toString(36)}`;
    this.results = null; this.votes.clear();
    this.referee = this.makeReferee();
    r.start(now);
    this.handle(r.drain());
    // (a real-world route's course with it, as stored: the game lays it out in its own world the way the server does)
    this.loadMsg = { t: 'load', raceId: this.raceId, venue: this.venueView(), course: this.resolved?.venue?.kind === 'route' ? this.resolved.course : null, laps: r.laps, deadline: r.state.loadDeadline };
    this.broadcastJson(this.loadMsg);
    this.broadcastLobby();
    void this.meta();
  }
  // car-to-car contact's referee for this race (./contact.ts)
  makeReferee() {
    const r = this.race, byUid = (uid: string) => [...this.players.values()].find(x => x.t.uid === uid);
    return createReferee({
      cfg: MP.contact, mode: () => this.settings.collisions ?? 'ghost', now: () => this.roomNow(), course: this.course, pit: this.pit,
      car: uid => { const q = r.players.get(uid); return q && !q.npc ? { uid, name: q.name, mass: q.car?.mass ?? STOCK.mass, box: q.car?.box ?? STOCK.box } : null; },
      isRacer: uid => { const q = r.players.get(uid); return !!q && !q.npc && q.role === 'racer' && q.status !== 'dnf' && (r.phase === 'countdown' || r.phase === 'racing'); },
      raceOf: uid => { const st = r.standings(this.roomNow()).find((x: any) => x.pid === uid); return st ? { lap: st.lap, u: st.u, status: st.status } : null; },
      send: (uid, msg) => { const p = byUid(uid); if (p) this.sendTo(p, msg); },
      broadcast: msg => this.broadcastJson(msg),
      penalize: (uid, sec, why) => { if (r.penalize(uid, sec, why)) this.handle(r.drain()); },
      saveEvidence: e => rtEnv.api ? rtEnv.api.saveEvidence(e) : Promise.reject(new Error('no API')),
      raceId: () => this.raceId,
    });
  }
  raceTick() {
    const r = this.race;
    if (!r) return;
    const now = this.roomNow();
    if (this.referee && (r.phase === 'countdown' || r.phase === 'racing')) this.referee.tick();
    // quick: off once everyone expected is in (or after a short wait for anyone who isn't)
    if (this.kind === 'quick' && r.phase === 'lobby' && this.course && !drain.on) {
      const here = new Set([...this.players.values()].map(p => p.t.uid));
      if ((this.expected.length && this.expected.every(u => here.has(u))) || (here.size && now >= this.expectBy)) this.begin(now);
    }
    // the NPCs: driven here, raced like anyone
    for (const n of this.npcs.values()) {
      const s = n.driver.state(now);
      const q = quantise({ ...s, tick: Math.floor(now / 10), time: now });
      n.latest = q; n.latestF = { pos: s.pos, vel: s.vel, time: now };
      this.handle(r.carState(n.pid, { t: now, pos: s.pos, vel: s.vel }));
    }
    this.handle(r.update(now));
    if ((r.phase === 'countdown' || r.phase === 'racing') && now - this.lastStandings >= 250) {
      this.lastStandings = now;
      this.broadcastJson({ t: 'standings', at: now, goAt: r.goAt, list: r.standings(now) });
    }
    if (r.phase === 'results' && this.results && !this.results.confirmed) void this.pollResults();
  }
  handle(events: any[]) {
    for (const e of events) {
      if (e.type === 'phase') {
        if (e.phase === 'countdown') { this.startNpcs(); this.freshStates(); }
        if (e.phase === 'racing') for (const n of this.npcs.values()) n.driver.go(this.race.goAt);
        if (e.phase === 'results') void this.finished(e);
        if (e.phase !== 'results') this.broadcastJson({ t: 'phase', phase: e.phase, at: e.at, goAt: e.goAt ?? this.race.goAt, deadline: e.deadline ?? null, lightsSec: e.lightsSec ?? MP.race.lightsSec });
        for (const p of this.race.players.values()) if (!p.npc) void this.status(p.pid);
        this.broadcastLobby();
        void this.meta();
        continue;
      }
      if (e.type === 'finish' && e.pid?.startsWith('npc:')) this.npcs.get(e.pid)?.driver.finish();
      if (e.type === 'dnf' && e.pid?.startsWith('npc:')) { this.npcs.delete(e.pid); }
      // (a player out: their car taken off everyone's screen — even one still waiting to come back)
      if (e.type === 'dnf' && !e.pid?.startsWith('npc:')) for (const o of this.players.values()) if (o.t.uid === e.pid) this.broadcastRoster({ status: { id: o.id, status: 'out' } });
      // (a flag is for the results' check and the player concerned, not everyone)
      if (e.type === 'flag') { const p = [...this.players.values()].find(x => x.t.uid === e.pid); if (p) this.sendTo(p, { t: 'event', e }); continue; }
      this.broadcastJson({ t: 'event', e });
      if (e.type === 'grid' || e.type === 'spectate' || e.type === 'late') this.broadcastLobby();
    }
  }
  // every car's last state forgotten: it's put somewhere else for the race (its grid slot — after the last race, the
  // other end of town), which the live checks would take for a teleport and refuse, and every state after it
  freshStates() {
    const now = this.roomNow();
    for (const p of this.players.values()) { p.latest = null; p.latestF = null; p.resetUntil = now + 3000; p.sentBase.clear(); }
  }
  startNpcs() {
    this.npcs.clear();
    const r = this.race, c = this.course;
    this.plan ??= speedPlan(c.line, { loop: c.loop, cfg: MP.npc });
    let id = 200;
    for (const p of r.players.values()) {
      if (!p.npc || p.slot == null) continue;
      const d = NPC_DRIVERS.find((x: any) => `npc:${x.id}` === p.pid);
      const [lo, hi] = MP.npc.skill, skill = lo + (hi - lo) * (d?.skill ?? Math.random());
      const driver = createNpcDriver({ line: c.line, loop: c.loop, plan: this.plan, slot: c.grid.slots[p.slot], skill });
      const entry = { id, uid: p.pid, name: p.name, guest: false, status: 'here', npc: true, look: { carId: d?.car ?? 'starter_car', paint: { colour: d?.colour ?? '#888', finish: 'metallic' }, name: p.name }, events: [] };
      this.npcs.set(p.pid, { pid: p.pid, id: id++, name: p.name, driver, latest: null, latestF: null, entry });
    }
    // (everyone told about the NPCs' cars)
    for (const n of this.npcs.values()) this.broadcastRoster({ join: n.entry });
  }
  protected virtualCars() { return [...this.npcs.values()].filter(n => n.latest).map(n => ({ id: n.id, latest: n.latest, latestF: n.latestF, entry: n.entry })); }
  protected carAccepted(p: Player, f: any) { this.handle(this.race.carState(p.t.uid, { t: f.time, pos: f.pos, vel: f.vel })); if (this.referee && this.race.phase !== 'lobby') this.referee.onState(p.t.uid, f, this.roomNow()); }
  protected carReset(p: Player) { this.referee?.onReset(p.t.uid); }
  // (only the cars racing go to the others: not in the lobby, not a spectator's, not once its player is out)
  protected relays(p: Player) {
    const r = this.race, q = r?.players.get(p.t.uid);
    return !!q && r.phase !== 'lobby' && q.role === 'racer' && q.status !== 'dnf';
  }

  // ---------- the results ----------
  async finished(e: any) {
    const r = this.race, raceId = this.raceId ?? `${this.roomId}-${this.raceNo}-${Date.now().toString(36)}`;
    const res: NonNullable<RaceRoom['results']> = this.results = { raceId, at: this.roomNow(), posted: false, confirmed: null, polls: 0, runs: new Set<string>() };
    const results = e.results ?? r.results();
    this.broadcastJson({ t: 'results', raceId, results: results.map(({ flags, rating, ...x }: any) => x) });
    for (const n of this.npcs.values()) this.broadcastRoster({ leave: { id: n.id } });
    this.npcs.clear();
    const rec = {
      id: raceId, kind: this.kind, ranked: this.settings.ranked, venue: this.resolved?.venue ?? this.settings.venue, settings: { ...this.settings, laps: r.laps },
      courseVersion: this.course?.version ?? null, trackHash: this.course?.trackHash ?? null, km: (this.course?.length ?? 0) * r.laps / 1000, results,
      // (Phase 7 Step 3: the agreed contacts — each run's pushes are checked against them — and each player's incidents)
      ...(this.referee ? this.referee.forRecord(results.filter((x: any) => !x.npc).map((x: any) => x.uid ?? x.pid)) : {}),
    };
    // (the server's about to stop for an update: no rematch here)
    if (drain.on) this.broadcastJson({ t: 'notice', text: DRAINING });
    const api = rtEnv.api;
    // (load-test bots and NPCs only: nobody with an account — nothing for the API)
    if (!api || !results.some((x: any) => !x.npc && !loadtestBot(x.uid ?? x.pid))) { this.reportOf(raceId).resolve(false); return; }
    // (until the API has it: the runs handed in wait for it — reportOf)
    const ok = (await send(`race ${raceId}`, () => api.recordRace(rec), rtEnv.log)) !== null;
    res.posted = ok;
    this.reportOf(raceId).resolve(ok);
  }
  // each race's report to the API, once it's in (or given up): a run handed in — even before the race is over, as its
  // player finishes — is sent on after it
  private reports = new Map<string, { done: Promise<boolean>; resolve: (ok: boolean) => void }>();
  private reportOf(raceId: string) {
    let r = this.reports.get(raceId);
    if (!r) {
      let resolve!: (ok: boolean) => void;
      r = { done: new Promise<boolean>(res => { resolve = res; }), resolve };
      this.reports.set(raceId, r);
      while (this.reports.size > 8) this.reports.delete(this.reports.keys().next().value!);
    }
    return r;
  }
  private handed = new Set<string>();
  // a long race's recording comes in pieces (a message is at most 64 kB): run-part { i, of, data } each, then the run
  // with recording.parts — put back together here (at most MAX_RUN_PARTS, ~6 MB: hours of driving)
  runParts = new Map<string, string[]>();
  runPart(p: Player, m: any) {
    const key = `${this.raceId}:${p.t.uid}${m.field === 'contact' ? ':contact' : ''}`, of = Number(m.of), i = Number(m.i);
    if (!this.raceId || !Number.isInteger(of) || !Number.isInteger(i) || of < 1 || of > MAX_RUN_PARTS || i < 0 || i >= of || typeof m.data !== 'string') return;
    const list = this.runParts.get(key) ?? new Array(of).fill(null);
    if (list.length !== of) return;
    list[i] = m.data;
    this.runParts.set(key, list);
  }
  async handIn(p: Player, m: any) {
    const raceId = this.raceId;
    if (!raceId || this.race.phase === 'lobby') return this.say(p, 'There\'s no race to hand a run in for.');
    const key = `${raceId}:${p.t.uid}`;
    if (this.handed.has(key) || loadtestBot(p.t.uid)) return;      // (a load-test bot's run: nothing for the API)
    let recording = m.recording ?? null;
    if (recording?.parts) {
      const list = this.runParts.get(key);
      this.runParts.delete(key);
      recording = list && list.length === recording.parts && list.every(x => x != null) ? { ...recording, data: list.join(''), parts: undefined } : null;
    }
    // (Phase 7 Step 3: the run's contact record — what pushed the car, step by step — for the verifier)
    let contact: string | null = typeof m.contact === 'string' ? m.contact : null;
    if (Number.isInteger(m.contactParts)) {
      const list = this.runParts.get(`${key}:contact`);
      this.runParts.delete(`${key}:contact`);
      contact = list && list.length === m.contactParts && list.every(x => x != null) ? list.join('') : null;
    }
    this.handed.add(key);
    await this.forwardRun(raceId, p.t.uid, { result: m.result ?? null, recording, contact });
  }
  async forwardRun(raceId: string, uid: string, body: any) {
    const api = rtEnv.api;
    if (!api || !(await this.reportOf(raceId).done)) return;
    const v: any = await send(`run ${raceId} ${uid}`, () => api.submitRun(raceId, uid, body), rtEnv.log);
    const p = [...this.players.values()].find(x => x.t.uid === uid);
    if (p && v) this.sendTo(p, { t: 'verdict', verdict: v.verdict ?? null });
  }
  // (Phase 7 Step 5: the server waits for this before it stops for an update — a race under way, or one just finished
  // whose players' runs are still coming in)
  busy() {
    const ph = this.race?.phase, res = this.results;
    if (ph === 'loading' || ph === 'countdown' || ph === 'racing') return true;
    if (ph !== 'results' || !res || this.roomNow() - res.at > RUNS_WAIT_MS) return false;
    return [...this.race.players.values()].some((q: any) => !q.npc && q.status === 'finished' && this.isHere(q.pid) && !this.handed.has(`${res.raceId}:${q.pid}`));
  }
  // (the server starts to drain: a lobby, or a race's podium, told — a race under way is told at its finish)
  draining() { if (!['loading', 'countdown', 'racing'].includes(this.race?.phase)) this.broadcastJson({ t: 'notice', text: DRAINING }); }
  protected flagRef() { return { raceId: this.raceId, phase: this.race?.phase ?? null }; }
  private polling = false;
  async pollResults() {
    const res = this.results;
    if (!res?.posted || this.polling || res.confirmed) return;
    this.polling = true;
    try {
      await new Promise(r => setTimeout(r, 1000));
      const v = await rtEnv.api!.race(res.raceId);
      if (v?.state === 'confirmed') { res.confirmed = v; this.broadcastJson({ t: 'confirmed', race: v }); }
    } catch { /* again next tick */ } finally { this.polling = false; }
  }
  checkRematch() {
    const r = this.race;
    if (r.phase !== 'results') return;
    if (drain.on) { this.broadcastJson({ t: 'notice', text: DRAINING }); return; }
    const here = [...new Set([...this.players.values()].filter(p => p.status === 'here').map(p => p.t.uid))];
    const yes = here.filter(u => this.votes.get(u) === true).length;
    this.broadcastJson({ t: 'votes', yes, of: here.length });
    // (more than half want another: back to the lobby, the same settings — the host can still change them)
    if (here.length && yes * 2 > here.length) {
      r.rematch(this.roomNow());
      this.votes.clear(); this.results = null;
      this.handle(r.drain());
      if (this.kind === 'quick') { this.expected = []; this.expectBy = this.roomNow() + 10000; }
    }
  }

  // ---------- telling people ----------
  venueView() {
    const v = this.resolved;
    if (!v) return null;
    return { venue: v.venue, name: v.name, loop: v.loop, km: Math.round(v.km * 10) / 10, frame: v.frame, trackHash: v.trackHash ?? null, routeVersion: this.course?.version ?? null, length: this.course?.length ?? null, official: v.official ?? null };
  }
  lobbyView() {
    const r = this.race, now = this.roomNow();
    const view = r.view(now);
    for (const p of view.players) {
      const q = r.players.get(p.pid);
      p.tier = q?.npc ? null : tierOf(q?.rating, MP.rank);
      // (the safety rating, Phase 7 Step 3: a letter and number — the ticket's)
      if (!q?.npc) { const sr = [...this.players.values()].find(x => x.t.uid === p.pid)?.t.mp?.safety; p.safety = sr != null ? { value: Math.round(sr), tier: safetyTier(sr, MP.contact) } : null; }
      p.ping = this.pings.get(p.pid) ?? null;
      p.host = p.pid === this.host;
      p.here = q?.npc ? true : this.isHere(p.pid);
      delete p.rating;
    }
    return { t: 'lobby', roomId: this.roomId, kind: this.kind, code: this.code, host: this.host, settings: this.settings, venue: this.venueView(), venueError: this.venueError, serverNow: now, ...view, raceId: this.raceId, confirmed: this.results?.confirmed ?? null };
  }
  // (each told who they are, and which of their cars they can race here)
  broadcastLobby() { const v = this.lobbyView(); for (const p of this.players.values()) this.sendTo(p, { ...v, you: p.t.uid, cars: (p.t.mp?.cars ?? []).map((c: any) => ({ ...c, allowed: carAllowed(c, this.settings) })) }); }
  broadcastJson(m: any) { for (const p of this.players.values()) this.sendTo(p, m); }
  sendTo(p: Player, m: any) { if (p.status !== 'here') return; try { p.client.send('mp', m); } catch { /* gone */ } }
  say(p: Player, text: string) { this.sendTo(p, { t: 'notice', text }); }
  async status(uid: string) {
    const r = this.race, q = r.players.get(uid);
    const state = r.phase === 'lobby' ? 'lobby' : q?.role === 'spectator' ? 'spectating' : r.phase === 'results' ? 'lobby' : 'racing';
    try { await setStatus(uid, { state, roomId: this.roomId, kind: this.kind, name: this.resolved?.name ?? null, code: this.code }); } catch { /* presence */ }
  }
  async meta() {
    const r = this.race;
    try {
      await this.setMetadata({ kind: this.kind, name: this.settings.name || `${this.race?.players.get(this.host!)?.name ?? 'A'}'s lobby`, listed: this.kind === 'custom' && this.settings.listed, phase: r?.phase ?? 'lobby',
        players: [...(r?.players.values() ?? [])].filter((p: any) => !p.npc && !p.gone).length, max: r?.maxRacers ?? MP.grid.maxPlayers, venue: this.resolved?.name ?? null, classes: this.settings.classes, laps: this.settings.laps });
    } catch { /* metadata */ }
  }
  // (the race's numbers, for the tests)
  get raceNow() { return this.roomNow(); }
}
