// The multiplayer test room (Phase 7 Step 1; docs/MULTIPLAYER.md): players in the same world see each other's cars.
// Lobbies and matchmaking come in Step 2; this is one room per world (joinOrCreate with { world }), up to
// rt.roomMaxClients players.
//
// Each player simulates their own car and sends its state (net/codec.js, ~30 a second, only what changed). The room:
//   - checks each state is possible (checks.ts) and keeps the latest;
//   - every tick (NET.tickHz) sends each player the cars near them (interest.ts), the further ones less often, each
//     as only what changed since that player last had it;
//   - passes on events that must arrive (damage, resets, parts off, lights) to everyone, and keeps the damage so far
//     for players who join later;
//   - answers pings with its clock (time sync), and stamps everything with it (ms since the room began);
//   - keeps a dropped player's car for NET.reconnectSec (paused for everyone else) for them to come back to.
// It never runs physics: it's a relay with checks (the race's result is checked afterwards by its replay).

import { Room, ServerError, type Client, matchMaker } from '@colyseus/core';
import { NET } from '../../../net/settings.js';
import { PROTOCOL, C2S, S2C, CODES, MESSAGES, ALL } from '../../../net/protocol.js';
import { decodeStateMessage, dequantise, mergeState, maskFor, encodeSnapshot, encodeValue, decodeValue, decodePing, encodePong } from '../../../net/codec.js';
import { createLink, parseConditions } from '../../../net/netsim.js';
import { verifyTicket, type Ticket } from './tickets.ts';
import { createChecks } from './checks.ts';
import { createGrid } from './interest.ts';

export type RtEnv = { secret: string; allowGuests: boolean; maxPlayers: number; roomMaxClients: number; netsim: boolean; log: (msg: string, extra?: object) => void; api?: import('./mp.ts').RtApi | null; quickVenue?: any };
let ENV: RtEnv;
export const setRtEnv = (e: RtEnv) => { ENV = e; };

const serverMs = () => performance.timeOrigin + performance.now();
// (a join is refused over HTTP — the matchmaking request — so its status must be an HTTP one: 403, with our code in
// the message, '[4010] The game has been updated…'; net/transport.js reads it back out)
const refuse = (code: number, message = MESSAGES[code]) => new ServerError(403, `[${code}] ${message}`);
const EVENT_KINDS = new Set(['impact', 'damage', 'parts', 'reset', 'repair', 'lights', 'horn']);
const KEEP_EVENTS = 64, MAX_EVENT_BYTES = 8192, MAX_LOOK_BYTES = 16384, WS_DOWN = 4, WS_UP = 8;

// players across every process (Redis: a count per process, with when it was last refreshed)
const LOAD = 'rt:load';
async function totalPlayers() {
  const all = await matchMaker.presence.hgetall(LOAD) ?? {}, now = Date.now();
  let n = 0;
  for (const v of Object.values(all)) { const [c, at] = String(v).split(':').map(Number); if (now - at < 30000) n += c; }
  return n;
}
// this thread's CPU time so far, or since prev (µs: process.threadCpuUsage — null on a Node without it)
const threadCpu = (prev?: { user: number; system: number }): { user: number; system: number } | null => (process as any).threadCpuUsage?.(prev) ?? null;
// every room's join check (the test room, and Phase 7 Step 2's hub, queue and race rooms): the game's version, the
// ticket (signed, in date, used once), not banned, a guest only where guests may play, room on the server
export async function authorize(token: string, options: any, { count = true }: { count?: boolean } = {}) {
  if (Number(options?.protocol) !== PROTOCOL) throw refuse(CODES.VERSION, `${MESSAGES[CODES.VERSION]} (game ${options?.protocol ?? '?'}, server ${PROTOCOL})`);
  const t = verifyTicket(ENV.secret, token);
  if (!t) throw refuse(CODES.TICKET);
  // (each ticket once: a copied one is worthless)
  const used = `rt:ticket:${t.jti}`;
  if (await matchMaker.presence.get(used)) throw refuse(CODES.TICKET);
  await matchMaker.presence.setex(used, '1', 600);
  if (await matchMaker.presence.get(`rt:banned:${t.uid}`)) throw refuse(CODES.BANNED);
  if (t.guest && !ENV.allowGuests) throw refuse(CODES.GUESTS);
  if (count && await totalPlayers() >= ENV.maxPlayers) throw refuse(CODES.FULL);
  return t;
}
export { refuse, ENV as rtEnv };

// (rt:kick, once per process: every room here gets each message)
let kicksOn = false;
function subscribeKicks() {
  if (kicksOn) return;
  kicksOn = true;
  void matchMaker.presence.subscribe('rt:kick', (m: any) => {
    for (const room of TestRoom.live) {
      // (the same account joining a room of another sort — free roam's while in a race's lobby — isn't another tab)
      if (m?.scope && room.scope !== m.scope) continue;
      // (Phase 7 Step 4: one page's connections to several free-roam zones are one player — a join from it isn't another tab)
      for (const p of room.players.values()) if (p.t.uid === m?.uid && p.client.sessionId !== m.except && !(m.keep && p.page === m.keep)) room.kick(p, m.code ?? CODES.KICKED, m.message);
    }
  });
}
export const resetKicks = () => { kicksOn = false; };

let processPlayers = 0;
const reportLoad = () => matchMaker.presence.hset(LOAD, matchMaker.processId, `${processPlayers}:${Date.now()}`);
setInterval(() => { if (matchMaker.presence) void Promise.resolve(reportLoad()).catch(() => {}); }, 10000).unref();

export type Player = {
  id: number; client: Client; t: Ticket; look: any; events: any[]; status: 'here' | 'away';
  latest: any | null; latestF: any | null; resetUntil: number; lastReset: number; lastHeard: number;
  checks: ReturnType<typeof createChecks>; sentBase: Map<number, any>; eventTokens: number;
  up: ReturnType<typeof createLink> | null; down: ReturnType<typeof createLink> | null;
  bytesIn: number; bytesOut: number; statesIn: number; dropped: number; kicked: boolean; fullStates: boolean;
  page?: string | null;              // (Phase 7 Step 4: the page this connection is from — a free-roam player is in several zones at once)
};

export class TestRoom extends Room {
  static live = new Set<TestRoom>();               // (the rooms running in this process: tests and metrics)
  maxClients = 64;
  autoDispose = true;
  world = 'test';
  epoch = serverMs();
  tickNo = 0;
  players = new Map<string, Player>();
  grid = createGrid(NET.interest);
  tickMs: number[] = [];
  // (the tick's own CPU time: its wall time less any wait for a core. The thread CPU clock may count in coarse steps — 4 ms
  // on some kernels — so one tick's can't be read; their mean over many ticks can)
  tickCpuMs: number[] = [];
  kicks = 0;
  scope = 'roam';                                   // (one connection per account among the rooms of a sort: free roam, races)
  private unsub: (() => void) | null = null;

  roomNow() { return serverMs() - this.epoch; }

  static async onAuth(token: string, options: any) { return authorize(token, options); }

  onCreate(options: any) {
    TestRoom.live.add(this);
    this.world = typeof options?.world === 'string' ? options.world.slice(0, 64) : 'test';
    this.maxClients = ENV.roomMaxClients;
    void this.setMetadata({ world: this.world });
    this.setSimulationInterval(() => this.tick(), 1000 / NET.tickHz);
    // (its numbers in Redis every 5 s, for monitoring and the load tests: players, the tick's time, bytes)
    this.clock.setInterval(() => { void Promise.resolve(matchMaker.presence.hset('rt:rooms', this.roomId, JSON.stringify({ at: Date.now(), process: matchMaker.processId, world: this.world, ...this.summary() }))).catch(() => {}); }, 5000);
    this.onMessageBytes(C2S.STATE, (c, b: any) => this.inbound(c, b, x => this.onState(c, x)));
    this.onMessageBytes(C2S.EVENT, (c, b: any) => this.inbound(c, b, x => this.onEvent(c, x)));
    this.onMessageBytes(C2S.HELLO, (c, b: any) => this.inbound(c, b, x => this.onHello(c, x)));
    this.onMessageBytes(C2S.PING, (c, b: any) => this.inbound(c, b, x => this.onPing(c, x)));
    this.onMessageBytes(C2S.STATS, (c, b: any) => this.inbound(c, b, () => {}));
    // (another tab or device of the same account joined, anywhere; or an admin banned them: kicked — one subscription
    // for the whole process, handed to each room)
    subscribeKicks();
  }

  onDispose() { void Promise.resolve(matchMaker.presence.hdel('rt:rooms', this.roomId)).catch(() => {}); TestRoom.live.delete(this); this.unsub?.(); for (const p of this.players.values()) { p.up?.close(); p.down?.close(); } }

  onJoin(client: Client, options: any) {
    const t = client.auth as Ticket, page = this.pageOf(options);
    for (const o of this.players.values()) if (o.t.uid === t.uid && !(page && o.page === page)) this.kick(o, CODES.ELSEWHERE);
    void matchMaker.presence.publish('rt:kick', { uid: t.uid, except: client.sessionId, code: CODES.ELSEWHERE, scope: this.scope, keep: page });
    const ids = new Set([...this.players.values()].map(p => p.id));
    let id = 1; while (ids.has(id)) id++;
    // (the network simulator, on the server's side of this player's connection: development and tests only)
    const cond = ENV.netsim ? parseConditions(options?.netsim) : null;
    const p: Player = {
      id, client, t, look: null, events: [], status: 'here', latest: null, latestF: null, resetUntil: 0, lastReset: 0, lastHeard: this.roomNow(),
      checks: createChecks(NET.checks), sentBase: new Map(), eventTokens: 20,
      up: cond ? createLink({ ...cond, seed: id * 7 + 1 }) : null, down: cond ? createLink({ ...cond, seed: id * 7 + 2 }) : null,
      bytesIn: 0, bytesOut: 0, statesIn: 0, dropped: 0, kicked: false,
      // (its link may lose messages — WebTransport datagrams later: complete states every time, not changes)
      fullStates: !!options?.fullStates || !!(cond && cond.mode === 'datagram'),
      page,
    };
    this.players.set(client.sessionId, p);
    this.joining(p, options);
    processPlayers++; void Promise.resolve(reportLoad()).catch(() => {});
    this.out(p, S2C.WELCOME, encodeValue({
      protocol: PROTOCOL, id, roomId: this.roomId, world: this.world, epoch: this.epoch, serverTime: this.roomNow(),
      net: { sendHz: NET.sendHz, detailEvery: NET.detailEvery, keyframeSec: NET.keyframeSec, pingSec: NET.pingSec, tickHz: NET.tickHz }, reconnectSec: NET.reconnectSec,
    }), true);
    this.out(p, S2C.ROSTER, encodeValue({ full: this.rosterFull(p) }), true);
    this.broadcastRoster({ join: this.entry(p) }, p);
    this.joined(p, options);
    ENV.log('rt join', { room: this.roomId, id, uid: t.uid, guest: t.guest, players: this.players.size });
  }

  async onDrop(client: Client) {
    const p = this.players.get(client.sessionId);
    if (!p || p.kicked) return;                   // (a kicked player doesn't come back: onLeave follows)
    // (the car waits, paused for everyone else, for the player to come back)
    p.status = 'away';
    this.broadcastRoster({ status: { id: p.id, status: 'away' } }, p);
    // (refused while the room is closing — the server shutting down: nothing to wait for)
    Promise.resolve(this.allowReconnection(client, NET.reconnectSec)).catch(() => {});
  }

  onReconnect(client: Client) {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    p.client = client; p.status = 'here'; p.lastHeard = this.roomNow();
    p.sentBase.clear();                              // (what it had may be out of date: everything afresh)
    this.out(p, S2C.ROSTER, encodeValue({ full: this.rosterFull(p) }), true);
    this.broadcastRoster({ status: { id: p.id, status: 'here' } }, p);
  }

  onLeave(client: Client) {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    this.players.delete(client.sessionId);
    p.up?.close(); p.down?.close();
    processPlayers = Math.max(0, processPlayers - 1); void Promise.resolve(reportLoad()).catch(() => {});
    for (const o of this.players.values()) o.sentBase.delete(p.id);
    this.broadcastRoster({ leave: { id: p.id } }, p);
    ENV.log('rt leave', { room: this.roomId, id: p.id, uid: p.t.uid, players: this.players.size, strikes: p.checks.reasons });
  }

  // ---------- messages in ----------
  protected inbound(c: Client, bytes: Uint8Array, handle: (b: Uint8Array) => void) {
    const p = this.players.get(c.sessionId);
    if (!p) return;
    p.bytesIn += bytes.length + WS_UP;
    p.lastHeard = this.roomNow();
    const run = (b: Uint8Array) => { if (this.players.get(c.sessionId) !== p) return; try { handle(b); } catch (e: any) { this.strike(p, 'unreadable message'); } };
    if (p.up) p.up.send(run, bytes, { reliable: true }); else run(bytes);
  }
  protected onState(c: Client, bytes: Uint8Array) {
    const p = this.players.get(c.sessionId)!, now = this.roomNow();
    if (!p.checks.rate(now)) { this.strike(p, 'too many messages'); return; }
    const { q, mask } = decodeStateMessage(bytes);
    if (!p.latest && mask !== ALL) return;          // (the first must be complete: wait for its next full one)
    const merged = mergeState(p.latest, q, mask), f = dequantise(merged);
    const why = p.checks.state(p.latestF, f, now, { resetOk: now < p.resetUntil });
    if (why) { p.dropped++; if (why !== 'stale') this.strike(p, why); return; }
    p.latest = merged; p.latestF = f; p.statesIn++;
    this.carAccepted(p, f);
  }
  // (Phase 7 Step 2: a race room follows each car's progress; NPCs driven by the server are cars of their own)
  protected carAccepted(_p: Player, _f: any) {}
  // (Phase 7 Step 3: a race room ghosts a car that's just reset)
  protected carReset(_p: Player) {}
  protected virtualCars(): Iterable<{ id: number; latest: any; latestF: any; entry: any }> { return []; }
  // (whether a player's car goes to the others: a race room sends only the cars racing)
  protected relays(_p: Player) { return true; }
  // (Phase 7 Step 4: free roam — a page's key, so its connections to several zones don't replace each other; who a player
  // never sees (blocked either way); the roster entry a viewer gets (a private player's name); after joining)
  protected pageOf(_options: any): string | null { return null; }
  protected hidden(_viewer: Player, _target: Player): boolean { return false; }
  protected entryFor(_viewer: Player | null, p: Player) { return this.entry(p); }
  protected joining(_p: Player, _options: any) {}       // (before anyone's told: what the roster needs of them)
  protected joined(_p: Player, _options: any) {}
  protected onEvent(c: Client, bytes: Uint8Array) {
    const p = this.players.get(c.sessionId)!, now = this.roomNow();
    if (bytes.length > MAX_EVENT_BYTES) { this.strike(p, 'event too big'); return; }
    p.eventTokens = Math.min(20, p.eventTokens + 0.5);
    if (p.eventTokens < 1) { this.strike(p, 'too many events'); return; }
    p.eventTokens--;
    const ev = decodeValue(bytes) as any;
    if (!ev || typeof ev !== 'object' || !EVENT_KINDS.has(ev.kind)) { this.strike(p, 'unknown event'); return; }
    if (ev.kind === 'reset') {
      // (a reset puts the car somewhere else: allowed, now and then)
      if (now - p.lastReset < NET.checks.resetEverySec * 1000) { this.strike(p, 'resets too often'); return; }
      p.lastReset = now; p.resetUntil = now + 1500;
      this.carReset(p);
    }
    if (ev.kind === 'repair') p.events = [];
    else if (ev.kind === 'damage' || ev.kind === 'parts') { p.events.push(ev); if (p.events.length > KEEP_EVENTS) p.events.splice(0, p.events.length - KEEP_EVENTS); }
    const out = encodeValue({ ...ev, from: p.id, at: now });
    for (const o of this.players.values()) if (o !== p && o.status === 'here' && !this.hidden(o, p)) this.out(o, S2C.EVENT, out, true);
  }
  protected onHello(c: Client, bytes: Uint8Array) {
    const p = this.players.get(c.sessionId)!;
    if (bytes.length > MAX_LOOK_BYTES) { this.strike(p, 'look too big'); return; }
    const v = decodeValue(bytes) as any;
    p.look = v?.look ?? null;
    if (Array.isArray(v?.events)) p.events = v.events.slice(-KEEP_EVENTS);
    this.broadcastRoster({ look: { id: p.id, look: p.look, events: p.events } }, p);
  }
  protected onPing(c: Client, bytes: Uint8Array) {
    const p = this.players.get(c.sessionId)!, { seq, clientMs } = decodePing(bytes);
    // (the server's time as late as possible: when the answer leaves)
    this.out(p, S2C.PONG, null, false, () => encodePong(seq, clientMs, this.roomNow()));
  }

  // ---------- out ----------
  protected out(p: Player, type: number, bytes: Uint8Array | null, reliable = false, late?: () => Uint8Array, force = false) {
    const go = (b: Uint8Array | null) => {
      const out = late ? late() : b!;
      if (!force && (this.players.get(p.client.sessionId) !== p || p.status !== 'here')) return;
      p.bytesOut += out.length + WS_DOWN;
      p.client.sendBytes(type, out);
    };
    if (p.down) p.down.send(go, bytes, { reliable }); else go(bytes);
  }
  protected rosterFull(viewer: Player | null = null) { return [...[...this.players.values()].filter(x => !viewer || !this.hidden(viewer, x)).map(x => this.entryFor(viewer, x)), ...[...this.virtualCars()].map(v => v.entry)]; }
  protected entry(p: Player) { return { id: p.id, uid: p.t.uid, name: p.t.name, guest: p.t.guest, status: p.status, look: p.look, events: p.events }; }
  protected broadcastRoster(msg: any, except?: Player) {
    const b = encodeValue(msg);
    // (Phase 7 Step 4: about a player some can't see, or whose name differs by who's looking — each viewer's own)
    const about = msg.join ?? msg.look ?? msg.status ?? msg.leave, subject = about ? [...this.players.values()].find(x => x.id === about.id) : null;
    for (const o of this.players.values()) {
      if (o === except || o.status !== 'here') continue;
      if (subject && this.hidden(o, subject)) continue;
      if (subject && msg.join) { this.out(o, S2C.ROSTER, encodeValue({ join: this.entryFor(o, subject) }), true); continue; }
      this.out(o, S2C.ROSTER, b, true);
    }
  }
  protected strike(p: Player, reason: string) {
    if (p.checks.strike(reason, this.roomNow())) {
      ENV.log('rt kicked by the live checks', { uid: p.t.uid, reasons: p.checks.reasons });
      this.kick(p, CODES.KICKED, 'Your game sent car movement the server can\'t accept.');
    }
  }
  kick(p: Player, code: number, message?: string) {
    if (p.kicked) return;
    this.kicks++; p.kicked = true;
    try { this.out(p, S2C.NOTICE, encodeValue({ code, message: message ?? MESSAGES[code] }), true, undefined, true); } catch { /* gone */ }
    // (closed a moment after the notice, so the notice gets there first)
    const c = p.client;
    setTimeout(() => { try { c.leave(code, message ?? MESSAGES[code]); } catch { /* gone */ } }, 50 + (p.down?.conditions.latencyMs ?? 0) * 2);
    p.status = 'away';
  }

  // ---------- the tick ----------
  tick() {
    const c0 = threadCpu();
    const t0 = performance.now(), now = this.roomNow(), tick = ++this.tickNo;
    const list = [...this.players.values()], virt = [...this.virtualCars()];
    this.grid.rebuild([...list.filter(p => p.status === 'here' && this.relays(p)).map(p => ({ id: p.id, pos: p.latestF?.pos ?? null })), ...virt.map(v => ({ id: v.id, pos: v.latestF?.pos ?? null }))]);
    const byId = new Map<number, any>([...list.map(p => [p.id, p] as [number, any]), ...virt.map(v => [v.id, { ...v, status: 'here', virtual: true }] as [number, any])]);
    for (const r of list) {
      if (r.status !== 'here') continue;
      // (a dead connection: nothing heard for too long)
      if (now - r.lastHeard > NET.idleSec * 1000) { this.kick(r, CODES.IDLE); continue; }
      // (a car that isn't sent — a spectator's — sees every car: it may be watching any of them)
      const near = r.latestF && this.relays(r) ? this.grid.near({ id: r.id, pos: r.latestF.pos }) : [...byId.values()].filter(o => o !== r && o.latestF && o.status === 'here' && (o.virtual || this.relays(o))).map(o => ({ id: o.id, d: 0, every: 1 }));
      const keep = new Set<number>(), cars: any[] = [];
      for (const n of near) {
        keep.add(n.id);
        if ((tick + n.id) % n.every) continue;
        const o = byId.get(n.id);
        if (!o?.latest) continue;
        if (!o.virtual && this.hidden(r, o)) continue;
        const base = r.sentBase.get(n.id);
        if (base && base.time === o.latest.time) continue;       // (nothing new)
        cars.push({ id: n.id, q: o.latest, mask: r.fullStates ? ALL : maskFor(o.latest, base, true) });
        r.sentBase.set(n.id, o.latest);
      }
      // (cars out of range: forgotten, so they come back complete)
      for (const id of r.sentBase.keys()) if (!keep.has(id)) r.sentBase.delete(id);
      for (let i = 0; i < cars.length; i += 255) this.out(r, S2C.SNAPSHOT, encodeSnapshot(now, cars.slice(i, i + 255)));
    }
    this.tickMs.push(performance.now() - t0);
    if (this.tickMs.length > 600) this.tickMs.shift();
    if (c0) { const c = threadCpu(c0)!; this.tickCpuMs.push((c.user + c.system) / 1000); if (this.tickCpuMs.length > 600) this.tickCpuMs.shift(); }
  }

  summary() {
    const m = this.metrics(), sum = (k: 'bytesIn' | 'bytesOut') => m.perPlayer.reduce((a, p) => a + p[k], 0);
    return { players: m.players, tickMsP50: +m.tickMsP50.toFixed(3), tickMsP95: +m.tickMsP95.toFixed(3), tickMsMax: +m.tickMsMax.toFixed(3), tickCpuMsMean: +m.tickCpuMsMean.toFixed(3), kicks: m.kicks, bytesIn: sum('bytesIn'), bytesOut: sum('bytesOut'), statesIn: m.perPlayer.reduce((a, p) => a + p.statesIn, 0) };
  }
  metrics() {
    const s = [...this.tickMs].sort((a, b) => a - b), q = (x: number) => s.length ? s[Math.min(s.length - 1, Math.floor(s.length * x))] : 0;
    return { players: this.players.size, tickMsP50: q(0.5), tickMsP95: q(0.95), tickMsMax: s[s.length - 1] ?? 0, tickCpuMsMean: this.tickCpuMs.length ? this.tickCpuMs.reduce((a, x) => a + x, 0) / this.tickCpuMs.length : 0, kicks: this.kicks,
      perPlayer: [...this.players.values()].map(p => ({ id: p.id, uid: p.t.uid, status: p.status, bytesIn: p.bytesIn, bytesOut: p.bytesOut, statesIn: p.statesIn, dropped: p.dropped, strikes: p.checks.reasons })) };
  }
}
