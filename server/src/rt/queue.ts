// The quick-race queue (Phase 7 Step 2; docs/MULTIPLAYER.md "Matchmaking"): one room per region (joinOrCreate with
// { region }: across processes too, through Redis). Players wait here; every queue.cycleMs the matchmaker (mp/match.js)
// runs over everyone waiting, and each race it makes gets a room of its own (a quick race: race.ts), each player a
// seat reserved in it ('matched': the game takes the seat and leaves the queue).
//
//   joining: { region, pings: { region: ms }, car: instanceId, party: partyId }   — a party is matched once all of
//   its members are here (the hub tells them to queue when their leader does), or those here once the first has waited
//   queue.npcFillSec (one not coming — a game closed — keeps nobody waiting); a player still cooling down after
//   leaving ranked races early is refused (COOLDOWN); online, a region that isn't this environment's is refused (an old
//   game: VERSION)
//   messages: npc { yes } (race now, NPCs in the empty slots: no waiting) · ping { pings }
//   sent: queued { waiting, region, npcFillSec (the most anyone waits: then NPCs fill the empty slots) } · matched { reservation, quality }
// Every few seconds its numbers go to the API (the admin page's dashboard): how many wait, how long they've waited,
// and each race made: its players' spread in skill, car and ping.

import { Room, matchMaker, type Client } from '@colyseus/core';
import { CODES, MESSAGES } from '../../../net/protocol.js';
import { matchQueue, percentile } from '../../../mp/match.js';
import { ordinalOf } from '../../../mp/rank.js';
import { authorize, refuse, rtEnv } from './room.ts';
import { getParty, setStatus, clearStatus } from './mp.ts';
import { MP } from './mpData.ts';

type Entry = { client: Client; uid: string; name: string; since: number; pings: Record<string, number>; npcOk: boolean; party: string | null; player: { uid: string; skill: number; pr: number; cls: string; safety?: number } };
// (Phase 7 Step 5: online, only this environment's own regions have a queue — data/multiplayer.json regions; development
// and the tests queue in any they name)
const OWN: string[] | null = MP.regions?.[process.env.APP_ENV ?? '']?.map((r: any) => r.id) ?? null;

export class QueueRoom extends Room {
  static queues = new Set<QueueRoom>();
  // (every race made and every cycle's time in this process — the rooms come and go; the load test reads these)
  static made: any[] = [];
  static cycles: number[] = [];
  maxClients = 10000;
  autoDispose = true;
  region = 'local';
  entries = new Map<string, Entry>();
  // (what's happened, for the dashboard and the load test)
  made: any[] = [];
  report: any[] = [];
  cycleMs: number[] = [];
  private running = false;

  static async onAuth(token: string, options: any) {
    if (OWN && !OWN.includes(options?.region)) throw refuse(CODES.VERSION, `There's no race server for "${String(options?.region ?? '').slice(0, 32)}" here. ${MESSAGES[CODES.VERSION]}`);
    const t: any = await authorize(token, options, { count: false });
    const until = t.mp?.cooldownUntil;
    if (until && until > Date.now()) throw refuse(CODES.COOLDOWN, `${MESSAGES[CODES.COOLDOWN].replace('in a few minutes', `in ${Math.ceil((until - Date.now()) / 60000)} min`)}`);
    return t;
  }
  onCreate(options: any) {
    QueueRoom.queues.add(this);
    this.region = typeof options?.region === 'string' ? options.region.slice(0, 32) : 'local';
    void this.setMetadata({ region: this.region });
    this.onMessage('mp', (c, m) => {
      const e = this.entries.get(c.sessionId);
      if (!e || !m) return;
      if (m.t === 'npc') e.npcOk = !!m.yes;
      if (m.t === 'ping' && m.pings && typeof m.pings === 'object') e.pings = clean(m.pings, this.region);
    });
    this.clock.setInterval(() => void this.cycle(), MP.queue.cycleMs);
    this.clock.setInterval(() => void this.sendStats(), 5000);
  }
  onDispose() { QueueRoom.queues.delete(this); }
  onJoin(client: Client, options: any) {
    const t: any = client.auth;
    // (the same player queuing again — another tab: the newer one waits)
    for (const [id, e] of this.entries) if (e.uid === t.uid) { this.entries.delete(id); try { e.client.leave(CODES.ELSEWHERE); } catch { /* gone */ } }
    const cars = t.mp?.cars ?? [], car = cars.find((c: any) => c.instanceId === options?.car) ?? cars.find((c: any) => c.current) ?? cars[0] ?? { cls: 'D', pr: 300 };
    this.entries.set(client.sessionId, {
      client, uid: t.uid, name: t.name, since: Date.now(), pings: clean(options?.pings, this.region), npcOk: false,
      party: typeof options?.party === 'string' ? options.party.slice(0, 40) : null,
      player: { uid: t.uid, skill: ordinalOf(t.mp?.rating), pr: car.pr ?? 300, cls: car.cls ?? 'D', safety: t.mp?.safety ?? MP.contact.safety.start },
    });
    void Promise.resolve(setStatus(t.uid, { state: 'queue', region: this.region })).catch(() => {});
    client.send('mp', { t: 'queued', waiting: this.entries.size, region: this.region, npcFillSec: MP.queue.npcFillSec });
  }
  onLeave(client: Client) {
    const e = this.entries.get(client.sessionId);
    this.entries.delete(client.sessionId);
    if (e && !e.client.userData?.matched) void Promise.resolve(clearStatus(e.uid)).catch(() => {});
  }

  // the queue as the matchmaker sees it: each player on their own, each party (once all of it's here) as one
  private async asEntries(now: number) {
    const out: any[] = [], parties = new Map<string, Entry[]>();
    for (const [id, e] of this.entries) {
      if (e.party) { const l = parties.get(e.party) ?? []; l.push(e); parties.set(e.party, l); continue; }
      out.push({ id, since: e.since, players: [e.player], pings: e.pings, npcOk: e.npcOk, sessions: [id] });
    }
    for (const [pid, list] of parties) {
      const party = await getParty(pid).catch(() => null);
      const want: string[] = party?.members ?? list.map(e => e.uid), since = Math.min(...list.map(e => e.since));
      // (still on their way — not past the fill, though: then those here go without the rest)
      if (!want.every(u => list.some(e => e.uid === u)) && now - since < MP.queue.npcFillSec * 1000) continue;
      const lead = list.find(e => e.uid === party?.leader) ?? list[0];
      const regions = new Set(list.flatMap(e => Object.keys(e.pings)));
      const pings = Object.fromEntries([...regions].map(r => [r, Math.max(...list.map(e => e.pings[r] ?? 999))]));
      out.push({ id: `party:${pid}`, since, players: list.map(e => e.player), pings, npcOk: lead.npcOk, sessions: list.map(e => e.client.sessionId) });
    }
    return out;
  }
  async cycle() {
    if (this.running) return;
    this.running = true;
    const t0 = performance.now(), now = Date.now();
    try {
      const list = await this.asEntries(now);
      const { matches } = matchQueue(list, now, MP);
      for (const m of matches) {
        const sessions: string[] = m.entries.flatMap((x: any) => x.sessions);
        const es = sessions.map(s => this.entries.get(s)).filter(Boolean) as Entry[];
        for (const s of sessions) this.entries.delete(s);
        const quality = { ...m.quality, npcFill: m.npcFill, region: m.region, at: now };
        this.made.push(quality); if (this.made.length > 5000) this.made.splice(0, 1000);
        QueueRoom.made.push(quality); if (QueueRoom.made.length > 20000) QueueRoom.made.splice(0, 5000);
        this.report.push(quality);
        void this.seat(es, m, quality);
      }
    } catch (e: any) { rtEnv.log('rt queue cycle failed', { err: e?.message }); }
    finally { this.running = false; const ms = performance.now() - t0; this.cycleMs.push(ms); if (this.cycleMs.length > 1000) this.cycleMs.shift(); QueueRoom.cycles.push(ms); if (QueueRoom.cycles.length > 20000) QueueRoom.cycles.splice(0, 5000); }
  }
  // a race room for them, and a seat for each
  private async seat(es: Entry[], m: any, quality: any) {
    try {
      const room = await matchMaker.createRoom('race', { kind: 'quick', region: this.region, expect: es.map(e => e.uid), npcFill: m.npcFill });
      for (const e of es) {
        const reservation = await matchMaker.reserveSeatFor(room, { quick: true }, e.client.auth);
        e.client.userData = { ...(e.client.userData ?? {}), matched: true };
        e.client.send('mp', { t: 'matched', reservation, roomId: room.roomId, quality: { skillSpread: quality.skillSpread, performanceSpread: quality.performanceSpread, humans: quality.humans, npcFill: quality.npcFill } });
      }
    } catch (err: any) {
      rtEnv.log('rt queue seat failed', { err: err?.message });
      // (back in the queue, at the front)
      for (const e of es) if (!this.entries.has(e.client.sessionId)) this.entries.set(e.client.sessionId, e);
    }
  }
  stats(now = Date.now()) {
    const waits = [...this.entries.values()].map(e => (now - e.since) / 1000);
    return { region: this.region, waiting: this.entries.size, waitNowP50Sec: percentile(waits, 0.5), waitNowP95Sec: percentile(waits, 0.95), cycleMsP95: percentile(this.cycleMs, 0.95) };
  }
  private async sendStats() {
    const matches = this.report.splice(0);
    try { await rtEnv.api?.queueStats({ ...this.stats(), at: Date.now(), matches }); } catch { /* the dashboard misses one */ }
  }
}

// (no pings given: this queue's own region, at a middling ping)
function clean(pings: any, region: string) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(pings ?? {})) if (typeof k === 'string' && k.length <= 32 && Number.isFinite(v as number)) out[k] = Math.max(0, Math.min(5000, Math.round(v as number)));
  if (!Object.keys(out).length) out[region] = 50;
  return out;
}
