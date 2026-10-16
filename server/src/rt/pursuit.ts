// A co-op police pursuit's room (docs/PURSUIT.md): a party against the police. It's a race room (./race.ts: the lobby,
// the loading, the countdown and its server-clock GO, every car relayed to the others) whose "race" from GO is a
// pursuit, decided here: the director (pursuit/director.js — the shared heat, who can see whom, the units' orders,
// busts, the escape) and the mission (pursuit/coop.js — convoy, getaway, split up; respawns; reward shares) run on
// this server, from the cars as they're relayed and what the players' games report.
//
// Why the police's physics isn't here: this server has no world — no streamed roads, buildings or ground to drive into
// — and the police must drive with the same physics and take the same damage as the players. So one player's game, the
// host (the party's leader; another if they leave), drives the police cars in its own physics, as this room orders, and
// sends their states back; this room relays them to everyone as cars (virtual cars, as its NPCs are), so each game
// draws them. What's decided — the heat, the orders, busts, escapes, the end and the pay — is decided here; the host
// only drives. Sight lines need the world too: each game says which police cars can see its own car (a ray against
// its ground and buildings).
//
//   created by the hub for a party (party-pursuit): { questId, expect: [uid], leader }
//   from the host:  { t: 'police', units: [{ id, pos, rot, vel, ang, steer, throttle, brake, gear, rpm, drivable, carId }],
//                     hits: [{ unit, uid, strength }], added: [{ id, ok, carId }] }
//   from everyone:  { t: 'police-seen', units: [id] }  { t: 'pursuit-health', drivable, condition }
//   to everyone:    { t: 'pursuit-quest', quest }  { t: 'pursuit', at, host, status }  10 a second
//                   { t: 'pursuit-done', status, reason, scores }  { t: 'pursuit-paid', pay }
//   to the host:    { t: 'pursuit-cmd', orders, spawn: [{ id, kind, target, rating, joinAt, near? }], roadblock, spikes, remove }
//                   { t: 'pursuit-host', uid, units } (to everyone: who drives the police now — the new host adopts them)

import fs from 'node:fs';
import type { Client } from '@colyseus/core';
import { quantise } from '../../../net/codec.js';
import { createDirector } from '../../../pursuit/director.js';
import { createCoopMission } from '../../../pursuit/coop.js';
import { pursuitRules } from '../../../quest/types/pursuit.js';
import { RaceRoom } from './race.ts';
import { rtEnv, type Player } from './room.ts';
import { courseOf } from './mp.ts';
import { send } from './outbox.ts';
import { transverseMercator } from '../../../map/build/format/projection.js';

const read = (f: string) => JSON.parse(fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8'));
const CFG = read('data/pursuit.json'), QCFG = read('data/quests.json');
const MAX_SPEED = 95;            // (m/s: a police car reported faster than this isn't believed)
const UNIT_NET = 300;            // (the police cars' net ids: past the players' and the NPCs')

type Unit = { id: string; net: number; carId: string; state: any | null; latest: any; latestF: any; entry: any; drivable: boolean };

export class PursuitRoom extends RaceRoom {
  static pursuits = new Set<PursuitRoom>();
  questId: string | null = null;
  quest: any = null;
  leader: string | null = null;
  P: null | {
    D: any; M: any; units: Map<string, Unit>; pending: Map<string, any>;
    seen: Map<string, Set<string>>; health: Map<string, { drivable: boolean; condition: number }>; hits: any[]; host: string | null;
    strips?: any[]; next: number; startedAt: number; last: number; runId: string; done: boolean; lastStatus: number; running: boolean;
  } = null;

  async onCreate(options: any) {
    this.questId = options?.questId ? String(options.questId).slice(0, 120) : null;
    this.leader = options?.leader ? String(options.leader) : null;
    PursuitRoom.pursuits.add(this);
    await super.onCreate({ ...options, kind: 'quick', npcFill: false });
  }
  onDispose() { super.onDispose(); PursuitRoom.pursuits.delete(this); }

  // the venue: the quest's route (from the API, with the quest)
  async setVenue(venue: any) {
    if (!this.questId) return super.setVenue(venue);
    try {
      const api = rtEnv.api;
      if (!api) throw new Error('No API to ask');
      const m = await api.pursuitMission(this.questId);
      this.quest = m.quest; this.resolved = m.venue; this.course = courseOf(this.resolved);
      if (!this.course) throw new Error('That pursuit\'s route has no course.');
      this.venueError = null;
    } catch (e: any) {
      this.venueError = e?.message ?? 'Couldn\'t load that pursuit.';
      rtEnv.log('rt pursuit mission failed', { room: this.roomId, err: this.venueError });
    }
    this.newRace();
  }
  // (the quest with the load: each game's session is a co-op pursuit, not a race — play/mpRace.js)
  begin(now: number) {
    super.begin(now);
    if (this.loadMsg && this.quest) { this.loadMsg = { ...this.loadMsg, pursuit: { quest: this.quest } }; this.broadcastJson({ t: 'pursuit-quest', quest: this.quest }); }
  }
  handle(events: any[]) {
    super.handle(events);
    // (at the countdown: the pursuit set up — its first police car parked behind the grid, by the host; from GO it runs)
    for (const e of events) if (e.type === 'phase' && (e.phase === 'countdown' || e.phase === 'racing') && !this.P && this.quest) this.startPursuit();
    for (const e of events) if (e.type === 'phase' && e.phase === 'racing' && this.P) { this.P.running = true; this.P.startedAt = this.P.last = this.roomNow(); }
  }

  // ---------- the pursuit ----------
  racers() { return [...this.race.players.values()].filter((q: any) => !q.npc && q.role === 'racer').map((q: any) => q.pid as string); }
  here(uid: string) { return [...this.players.values()].some(p => p.t.uid === uid && p.status === 'here'); }
  startPursuit() {
    const q = this.quest, P = q.params ?? {}, ids = this.racers(), now = this.roomNow();
    const D: any = createDirector({ cfg: CFG, mission: { startHeat: P.startHeat, maxHeat: P.maxHeat, maxUnits: P.maxUnits, totalUnits: P.totalUnits, coop: true, players: ids.length, timerEnds: P.timerEnds || null, roadblocks: P.roadblocks !== false, spikes: P.spikes !== false, targeting: P.kind === 'split' ? { spread: 1.6 } : undefined } });
    const finish = this.course?.finish, toXZ = (p: any) => p && Number.isFinite(p.lat) ? this.placeOf(p) : p;
    const M: any = createCoopMission({ cfg: CFG, mission: { kind: P.kind ?? 'convoy', players: ids, destination: P.objective === 'destination' || P.kind === 'getaway' ? (finish ? { x: finish.x, z: finish.z } : null) : null,
      drops: (P.drops ?? []).map(toXZ).filter(Boolean), busted: P.busted, respawn: P.respawnSeconds, rewards: P.rewards, escapeFirst: !!P.escapeFirst, dropM: QCFG.pursuit?.destinationM ?? 18 } });
    this.P = { D, M, units: new Map(), pending: new Map(), seen: new Map(), health: new Map(), hits: [], host: null, next: 1, startedAt: now, last: now, runId: `${this.raceId ?? this.roomId}-pursuit`, done: false, lastStatus: 0, running: false };
    this.pickHost();
    // (the first unit: parked behind the grid by the host now, for the intro — u0)
    D.expect(1); this.P.pending.set('u0', { kind: 'chase', target: ids[0] ?? null });
    const host = [...this.players.values()].find(p => p.t.uid === this.P!.host);
    if (host) this.sendTo(host, { t: 'pursuit-cmd', orders: [], spawn: [{ id: 'u0', kind: 'chase', target: ids[0] ?? null, rating: CFG.levels[D.state.level - 1].rating, start: true }], roadblock: [], spikes: [], remove: [] });
    rtEnv.log('rt pursuit started', { room: this.roomId, quest: q.id, players: ids.length, kind: P.kind ?? 'convoy' });
  }
  // a place given as lat/lon (a split-up drop) in the cars' frame
  placeOf(p: any) {
    const f = this.resolved?.frame;
    if (f?.kind !== 'region') return null;
    const [x, z] = transverseMercator(f.lat0, f.lon0).toXZ(p.lat, p.lon);
    return { x, z };
  }
  // the host: the leader if they're here, else the first racer who is; when it changes, everyone's told (and the units)
  pickHost() {
    const P = this.P!, want = this.leader && this.here(this.leader) && this.racers().includes(this.leader) ? this.leader : this.racers().find(u => this.here(u)) ?? null;
    if (want === P.host) return;
    P.host = want;
    this.broadcastJson({ t: 'pursuit-host', uid: want, units: [...P.units.values()].map(u => ({ id: u.id, carId: u.carId, state: u.state })) });
  }
  raceTick() {
    if (!this.P?.running || this.P.done) return super.raceTick();
    this.pursuitTick();
  }
  pursuitTick() {
    const P = this.P!, now = this.roomNow(), dt = Math.min(0.5, (now - P.last) / 1000), q = this.quest.params ?? {};
    P.last = now;
    this.pickHost();
    // the players: as their cars are relayed (the ones still here)
    const cars = new Map<string, any>();
    for (const p of this.players.values()) if (p.latestF && this.racers().includes(p.t.uid)) cars.set(p.t.uid, p.latestF);
    const M = P.M, carrier = M.status.carrier;
    for (const uid of this.racers()) if (!this.here(uid)) M.leave(uid);
    const players = [...cars.entries()].filter(([uid]) => this.here(uid)).map(([uid, f]) => {
      const vx = f.vel?.[0] ?? 0, vz = f.vel?.[2] ?? 0, H = P.health.get(uid);
      return { id: uid, x: f.pos[0], z: f.pos[2], vx, vz, speed: Math.hypot(vx, vz), heading: Math.atan2(vx, vz), drivable: H?.drivable ?? true, condition: H?.condition ?? 100, carrying: carrier === uid };
    });
    const units = [...P.units.values()].filter(u => u.state).map(u => ({ id: u.id, x: u.state.pos[0], z: u.state.pos[2], vx: u.state.vel?.[0] ?? 0, vz: u.state.vel?.[2] ?? 0, speed: Math.hypot(u.state.vel?.[0] ?? 0, u.state.vel?.[2] ?? 0), drivable: u.drivable }));
    const out = P.D.tick({ dt, players, units, los: (u: string, p: string) => P.seen.get(p)?.has(u) ?? false, hits: P.hits.splice(0) });
    for (const e of P.D.drain()) this.broadcastJson({ t: 'pursuit-event', e });
    for (const e of M.tick({ dt, players, status: P.D.status, revive: (uid: string) => P.D.revive(uid) })) this.broadcastJson({ t: 'pursuit-event', e });
    // the host's orders: what each unit does, and what to put in or take away
    const cmd: any = { t: 'pursuit-cmd', orders: out.orders, spawn: [], roadblock: [], spikes: [], remove: [] };
    for (const r of out.requests) {
      if (r.kind === 'unit') { const id = `u${P.next++}`; P.pending.set(id, { kind: 'chase', target: r.target }); cmd.spawn.push({ id, kind: 'chase', target: r.target, rating: r.rating }); }
      else if (r.kind === 'roadblock') { const ids = Array.from({ length: r.units }, () => `u${P.next++}`); for (const id of ids) P.pending.set(id, { kind: 'block', target: r.target, joinAt: P.D.state.t + CFG.roadblock.joinAfter }); cmd.roadblock.push({ ids, target: r.target, rating: r.rating, joinAt: P.D.state.t + CFG.roadblock.joinAfter }); }
      else if (r.kind === 'spikes') cmd.spikes.push({ target: r.target });
      else if (r.kind === 'remove') { cmd.remove.push(r.id); this.dropUnit(r.id); }
    }
    const host = P.host ? [...this.players.values()].find(p => p.t.uid === P.host) : null;
    if (host) this.sendTo(host, cmd);
    // everyone: the state of it, 10 times a second
    this.broadcastJson({ t: 'pursuit', at: now, host: P.host, status: this.statusView() });
    // the time limit; the end
    if (q.timeLimitSeconds && (now - P.startedAt) / 1000 > q.timeLimitSeconds) M.end('failed', 'time');
    if (M.status.done) void this.endPursuit();
  }
  statusView() {
    const P = this.P!, S: any = P.D.status;
    return { ...S, strips: P.strips ?? [], units: S.units.map((u: any) => { const x = P.units.get(u.id); return { ...u, net: x?.net ?? null, pos: x?.state?.pos ?? null }; }), coop: P.M.status };
  }
  dropUnit(id: string) {
    const P = this.P!, u = P.units.get(id);
    P.units.delete(id); P.pending.delete(id); P.D.removeUnit(id);
    if (u) this.broadcastRoster({ leave: { id: u.net } });
  }
  // the score each player made: the chase they were in × the heat, the end's bonus, the police cars put out of action
  scores() {
    const P = this.P!, R = pursuitRules(QCFG), S = P.M.status, D = P.D.status, done = S.done;
    const bonus = done?.status === 'finished' ? (D.phase === 'escaped' ? R.escapeBonus * D.level : 0) + (done.reason === 'delivered' || done.reason?.includes('drop') ? R.destinationBonus : 0) : 0;
    return Object.fromEntries(S.players.map((p: any) => [p.id, Math.round(R.perSecond * p.score + bonus + R.perDisabled * D.disabled)]));
  }
  async endPursuit() {
    const P = this.P!;
    if (P.done) return;
    P.done = true;
    const S = P.M.status, done = S.done!, scores = this.scores(), shares = P.M.shares(), now = this.roomNow();
    this.broadcastJson({ t: 'pursuit-done', status: done.status, reason: done.reason, scores, shares });
    for (const u of [...P.units.keys()]) this.dropUnit(u);
    const rec = { id: P.runId, questId: this.questId, startedAt: P.startedAt, endedAt: now, status: done.status, reason: done.reason, heatMax: P.D.status.level, seconds: (now - P.startedAt) / 1000, disabled: P.D.status.disabled,
      players: S.players.map((p: any) => ({ uid: p.id, score: scores[p.id] ?? 0, share: shares[p.id] ?? 0, state: p.state })) };
    const api = rtEnv.api;
    if (!api) return;
    const r: any = await send(`pursuit ${P.runId}`, () => api.recordPursuit(rec), rtEnv.log);
    if (r?.pay) this.broadcastJson({ t: 'pursuit-paid', pay: r.pay });
  }

  // ---------- what the games say ----------
  onMp(c: Client, m: any) {
    const P = this.P, p = [...this.players.values()].find(x => x.client === c);
    if (!P || !p || P.done) return super.onMp(c, m);
    const uid = p.t.uid;
    if (m?.t === 'police-seen') { P.seen.set(uid, new Set((Array.isArray(m.units) ? m.units : []).slice(0, 40).map(String))); return; }
    if (m?.t === 'pursuit-health') { P.health.set(uid, { drivable: m.drivable !== false, condition: Math.max(0, Math.min(100, Number(m.condition) || 0)) }); return; }
    if (m?.t === 'police') {
      if (uid !== P.host) return;
      const now = this.roomNow();
      for (const a of (Array.isArray(m.added) ? m.added : []).slice(0, 12)) {
        const id = String(a?.id ?? ''), want = P.pending.get(id);
        if (!want) continue;
        P.pending.delete(id);
        if (!a.ok) { P.D.spawnFailed(); continue; }
        const net = UNIT_NET + (Number(id.slice(1)) % 600), carId = String(a.carId ?? 'starter_car').slice(0, 60);
        const entry = { id: net, uid: `police:${id}`, name: 'Police', guest: false, status: 'here', npc: true, police: true, look: { carId, paint: { colour: CFG.police.livery.body, finish: CFG.police.livery.finish }, name: 'Police' }, events: [] };
        P.units.set(id, { id, net, carId, state: null, latest: null, latestF: null, entry, drivable: true });
        P.D.addUnit(id, { kind: want.kind, target: want.target, joinAt: want.joinAt ?? null });
        this.broadcastRoster({ join: entry });
      }
      for (const s of (Array.isArray(m.units) ? m.units : []).slice(0, 24)) {
        const u = P.units.get(String(s?.id ?? ''));
        if (!u || !Array.isArray(s.pos) || s.pos.length !== 3 || !s.pos.every(Number.isFinite)) continue;
        const vel = Array.isArray(s.vel) && s.vel.every(Number.isFinite) ? s.vel : [0, 0, 0];
        if (Math.hypot(vel[0], vel[2]) > MAX_SPEED) continue;
        u.state = { pos: s.pos, rot: Array.isArray(s.rot) && s.rot.length === 4 ? s.rot : [0, 0, 0, 1], vel, ang: s.ang ?? [0, 0, 0], steer: +s.steer || 0, throttle: +s.throttle || 0, brake: +s.brake || 0, gear: s.gear | 0, rpm: +s.rpm || 0, wheels: [] };
        u.drivable = s.drivable !== false;
        u.latest = quantise({ ...u.state, tick: Math.floor(now / 10), time: now }); u.latestF = { pos: u.state.pos, vel, time: now };
      }
      if (Array.isArray(m.strips)) P.strips = m.strips.slice(0, 8).filter((x: any) => [x?.x, x?.z, x?.dx, x?.dz, x?.width].every(Number.isFinite)).map((x: any) => ({ id: String(x.id ?? '').slice(0, 20), x: x.x, z: x.z, dx: x.dx, dz: x.dz, width: x.width }));
      for (const h of (Array.isArray(m.hits) ? m.hits : []).slice(0, 12)) if (P.units.has(String(h?.unit)) && this.racers().includes(String(h?.uid))) P.hits.push({ unit: String(h.unit), player: String(h.uid), strength: Math.max(0, Math.min(40, Number(h.strength) || 0)) });
      return;
    }
    return super.onMp(c, m);
  }
  // (the police cars go to everyone as cars, as the NPCs do)
  protected virtualCars() { const out: any[] = [...super.virtualCars()]; for (const u of this.P?.units.values() ?? []) if (u.latest) out.push({ id: u.net, latest: u.latest, latestF: u.latestF, entry: u.entry }); return out; }
  // (from GO the race's own tracking is off: no finish line, no DNF for going off the route — it's a pursuit)
  protected carAccepted(p: Player, f: any) { if (!this.P) super.carAccepted(p, f); }
  protected relays(p: Player) { return this.P ? this.racers().includes(p.t.uid) : super.relays(p); }
}
