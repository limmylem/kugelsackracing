// Free roam on the API (Phase 7 Step 4; docs/FREE_ROAM.md): what needs the database. The zone servers run free roam (no
// database); this keeps each player's settings (privacy, contact, passive) and where they were (so they come back there),
// checks and pays challenges (capped against farming), drops the safety rating of a player the zone servers auto-ghosted,
// keeps the scheduled car meets, and gathers the zone servers' numbers for the admin page's live dashboard.
//
//   settingsOf(uid) · saveSettings(uid, s) · ticket(uid) → what a join ticket carries for free roam
//   save(rows)  (the zone servers: where each player is)        comeBack(uid, { carIds? }) → restorePoint (mp/roam.js)
//   challenge(record) → { verdict, pay: { uid: { money, xp, why } } }      myChallenges(uid)
//   incident({ uid, hits, drop, until })                       meets: listMeets(now), createMeet(admin, m), cancelMeet(admin, id)
//   stats(s) (a zone process's numbers) · dashboard() → zones, instances, handoffs, bandwidth, load, and the cost estimate

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { REPO_DIR } from '../config.ts';
import { AppError } from '../errors.ts';
import { restorePoint, meetEventState } from '../../../mp/roam.js';
import { verifyChallenge, challengePay, groupKey } from '../../../mp/challenge.js';
import { START } from '../../../mp/rank.js';
import { createNetwork } from '../../../route/network.js';
import { transverseMercator } from '../../../map/build/format/projection.js';

const json = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, f), 'utf8'));
export const ROAM = json('data/roam.json');
const MPC = json('data/multiplayer.json').contact;

// the baked regions (assets/map/<id>/manifest.json) and, for coming back, each one's spawn and road graph (read once)
const MAP_DIR = path.join(REPO_DIR, 'assets/map');
export function bakedRegions(): string[] { try { return fs.readdirSync(MAP_DIR).filter(d => fs.existsSync(path.join(MAP_DIR, d, 'manifest.json'))).sort(); } catch { return []; } }
const manifests = new Map<string, any>(), graphs = new Map<string, any>();
const manifest = (r: string) => { if (!manifests.has(r)) { try { manifests.set(r, JSON.parse(fs.readFileSync(path.join(MAP_DIR, r, 'manifest.json'), 'utf8'))); } catch { manifests.set(r, null); } } return manifests.get(r); };
function graph(r: string) {
  if (graphs.has(r)) return graphs.get(r);
  let N: any = null;
  try { const m = manifest(r); N = createNetwork(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(MAP_DIR, r, 'graph.json.gz'))).toString()), { P: transverseMercator(m.projection.lat0, m.projection.lon0), region: r, version: m.version, bbox: m.bbox } as any); } catch { N = null; }
  graphs.set(r, N);
  return N;
}

type Db = any;
export function createRoamService({ db, economy, log = () => {}, now = () => Date.now() }: { db: Db; economy: any; log?: (o: object, m: string) => void; now?: () => number }) {
  const rows = async (q: any) => (await db.execute(q)).rows as any[];
  const one = async (q: any) => (await rows(q))[0] ?? null;
  const statsLog = new Map<string, any>();       // process → its latest numbers
  const history: any[] = [];                     // (a point a minute: the dashboard's graph)

  // ---------- settings ----------
  const clean = (s: any, base = ROAM.privacy.default) => {
    const out: any = { ...base };
    if (s && typeof s === 'object') {
      if (ROAM.privacy.locations.includes(s.location)) out.location = s.location;
      for (const k of ['appearOffline', 'nearbyChat', 'names', 'contact', 'passive', 'partyContact']) if (typeof s[k] === 'boolean') out[k] = s[k];
    }
    return out;
  };
  async function settingsOf(uid: string) {
    const r = await one(sql`select settings from roam_players where user_id = ${uid}`);
    return clean(r?.settings ?? {});
  }
  async function saveSettings(uid: string, s: any) {
    const next = clean(s, await settingsOf(uid));
    await db.execute(sql`insert into roam_players (user_id, settings) values (${uid}, ${JSON.stringify(next)}::jsonb)
      on conflict (user_id) do update set settings = excluded.settings, updated_at = now()`);
    return next;
  }
  // what a join ticket carries for free roam (mp/service.ts ticketClaims): the settings, and whether they're auto-ghosted
  async function ticket(uid: string) {
    const r = await one(sql`select settings, ghost_until from roam_players where user_id = ${uid}`);
    return { settings: clean(r?.settings ?? {}), ghostUntil: r?.ghost_until ? new Date(r.ghost_until).getTime() : 0 };
  }

  // ---------- where players are ----------
  async function save(list: any[]) {
    let n = 0;
    for (const x of (Array.isArray(list) ? list : []).slice(0, 500)) {
      if (typeof x?.uid !== 'string' || typeof x.region !== 'string' || !Array.isArray(x.pos) || x.pos.length !== 3 || !x.pos.every(Number.isFinite)) continue;
      const pos = x.pos.map((v: number) => Math.round(v * 100) / 100), heading = Number.isFinite(x.heading) ? Number(x.heading) : 0;
      const damage = x.damage || (Array.isArray(x.events) && x.events.length) ? JSON.stringify({ look: x.damage ?? null, events: (x.events ?? []).slice(-32) }) : null;
      await db.execute(sql`insert into roam_players (user_id, region, pos, heading, car_id, instance_id, damage, saved_at)
        values (${x.uid}, ${x.region.slice(0, 32)}, ${JSON.stringify(pos)}::jsonb, ${heading}, ${x.carId ?? null}, ${x.instanceId ?? null}, ${damage}::jsonb, now())
        on conflict (user_id) do update set region = excluded.region, pos = excluded.pos, heading = excluded.heading, car_id = excluded.car_id, instance_id = excluded.instance_id, damage = excluded.damage, saved_at = now(), updated_at = now()`).catch((e: any) => log({ err: e, uid: x.uid }, 'roam save failed'));
      n++;
    }
    return { saved: n };
  }
  // where a player comes back to: where they left, if that region is baked and the spot is on a road — else the garage
  // (the region's spawn); their car, and its damage (the economy's — the car's own state — and the look saved with it)
  async function comeBack(uid: string) {
    const r = await one(sql`select region, pos, heading, car_id, instance_id, damage, saved_at, settings from roam_players where user_id = ${uid}`);
    const regions = bakedRegions();
    const saved = r?.region ? { region: r.region, pos: r.pos, heading: r.heading, carId: r.car_id, damage: r.damage, at: r.saved_at ? new Date(r.saved_at).toISOString() : null } : null;
    const point = (restorePoint as any)(saved, {
      regions, cfg: ROAM, now: now(),
      roadDistance: (reg: string, x: number, z: number) => { const N = graph(reg); if (!N) return null; const n = N.nearest(x, z, undefined, ROAM.persistence.maxOffRoadM * 4); return n ? n.d : Infinity; },
      spawnOf: (reg: string) => { const m = manifest(reg); return m ? { pos: [m.spawn?.xz?.[0] ?? 0, 0, m.spawn?.xz?.[1] ?? 0], heading: m.spawn?.bearing ?? 0 } : null; },
    });
    return { ...point, instanceId: r?.instance_id ?? null, settings: clean(r?.settings ?? {}) };
  }

  // ---------- challenges: checked, then paid (capped) ----------
  async function challenge(rec: any) {
    if (typeof rec?.id !== 'string' || !Array.isArray(rec.racers) || rec.racers.length < 2) throw new AppError(400, 'BAD_REQUEST', 'Not a challenge.');
    const id = rec.id.slice(0, 120), was = await one(sql`select verdict from roam_challenges where id = ${id}`);
    if (was) return { verdict: was.verdict, pay: Object.fromEntries((await rows(sql`select user_id, money, xp, why from roam_challenge_players where challenge_id = ${id}`)).map(r => [r.user_id, { money: r.money, xp: r.xp, why: r.why }])) };
    const verdict = verifyChallenge(rec, ROAM), key = groupKey(rec.racers), km = Number.isFinite(rec.length) ? rec.length / 1000 : 0;
    // (how many times this same group has been paid today, and each player's paid challenges today: the caps)
    const day = sql`created_at > now() - interval '24 hours'`;
    const groupToday = Number((await one(sql`select count(*) as n from roam_challenges c where group_key = ${key} and ${day} and exists (select 1 from roam_challenge_players p where p.challenge_id = c.id and p.money > 0)`))?.n ?? 0);
    await db.execute(sql`insert into roam_challenges (id, type, region, players, group_key, km, record, verdict) values (${id}, ${String(rec.type).slice(0, 20)}, ${rec.region ?? null}, ${sql.raw(`ARRAY[${rec.racers.map((u: string) => `'${String(u).replace(/'/g, "''")}'`).join(',')}]::text[]`)}, ${key}, ${km}, ${JSON.stringify(rec)}::jsonb, ${JSON.stringify(verdict)}::jsonb)`);
    const pay: Record<string, any> = {};
    for (const r of rec.results ?? []) {
      if (!rec.racers.includes(r.uid)) continue;
      const paidToday = Number((await one(sql`select count(*) as n from roam_challenge_players where user_id = ${r.uid} and money > 0 and ${day}`))?.n ?? 0);
      let p = verdict.ok ? challengePay(ROAM, { km, place: r.place, players: rec.racers.length, pairToday: groupToday, paidToday }) : { money: 0, xp: 0, why: 'the challenge didn\'t pass its check' };
      if (p.money > 0 || p.xp > 0) {
        try { const res = await economy.payRace(r.uid, { money: p.money, xp: p.xp, raceId: `${id}`, reason: `Free roam challenge: ${p.why}` }); if (!res?.paid) p = { money: 0, xp: 0, why: res?.why ?? 'not paid' }; }
        catch (e) { log({ err: e, uid: r.uid }, 'paying a challenge failed'); p = { money: 0, xp: 0, why: 'not paid' }; }
      }
      pay[r.uid] = p;
      await db.execute(sql`insert into roam_challenge_players (challenge_id, user_id, place, status, time_ms, money, xp, why) values (${id}, ${r.uid}, ${r.place ?? null}, ${r.status}, ${r.timeMs ?? null}, ${p.money}, ${p.xp}, ${p.why}) on conflict do nothing`).catch(() => {});
    }
    if (!verdict.ok) log({ challenge: id, problems: verdict.problems }, 'a challenge failed its check');
    return { verdict, pay };
  }
  async function myChallenges(uid: string, limit = 20) {
    return (await rows(sql`select c.id, c.type, c.km, c.created_at, p.place, p.status, p.time_ms, p.money, p.xp, p.why from roam_challenge_players p join roam_challenges c on c.id = p.challenge_id where p.user_id = ${uid} order by c.created_at desc limit ${limit}`))
      .map(r => ({ id: r.id, type: r.type, km: r.km, at: r.created_at, place: r.place, status: r.status, timeMs: r.time_ms, money: r.money, xp: r.xp, why: r.why }));
  }

  // ---------- the automatic protection: a player who kept hitting others ----------
  async function incident({ uid, hits, drop, until }: any) {
    if (typeof uid !== 'string' || !(drop > 0)) throw new AppError(400, 'BAD_REQUEST', 'No incident.');
    const d = Math.min(30, Number(drop));
    await db.execute(sql`insert into mp_ratings (user_id, mu, sigma, safety) values (${uid}, ${START.mu}, ${START.sigma}, ${Math.max(MPC.safety.min, MPC.safety.start - d)})
      on conflict (user_id) do update set safety = greatest(${MPC.safety.min}, mp_ratings.safety - ${d}), updated_at = now()`);
    await db.execute(sql`insert into roam_players (user_id, ghost_until, auto_ghosts) values (${uid}, ${until ?? null}, 1)
      on conflict (user_id) do update set ghost_until = excluded.ghost_until, auto_ghosts = roam_players.auto_ghosts + 1, updated_at = now()`);
    log({ uid, hits, drop: d }, 'free roam: auto-ghosted for ramming');
    return { ok: true };
  }

  // ---------- meets ----------
  async function listMeets(at = now()) {
    const list = await rows(sql`select e.*, ci.data as meet from meet_events e left join content_items ci on ci.id = e.meet_id and ci.view = 'published' where not e.cancelled and e.starts_at > now() - interval '12 hours' order by e.starts_at limit 200`);
    return list.map(r => {
      const st = meetEventState({ startsAt: new Date(r.starts_at).toISOString(), hours: r.hours }, at, ROAM);
      return { id: r.id, meetId: r.meet_id, title: r.title, startsAt: new Date(r.starts_at).toISOString(), hours: r.hours, ...st, place: r.meet ? { name: r.meet.name, lat: r.meet.location?.lat, lon: r.meet.location?.lon } : null };
    }).filter(e => e.state !== 'over');
  }
  async function createMeet(adminId: string, m: { meetId: string; title: string; startsAt: string; hours?: number }) {
    const meet = await one(sql`select id, data from content_items where id = ${m.meetId} and view = 'published' and kind = 'meet'`);
    if (!meet) throw new AppError(404, 'NOT_FOUND', 'There\'s no published meet spot with that id (make one in the editor: Meet spot, 7).');
    const start = Date.parse(m.startsAt);
    if (!Number.isFinite(start) || start < now() - 3600e3) throw new AppError(400, 'BAD_REQUEST', 'Pick a start time from now on.');
    const hours = Math.max(0.5, Math.min(ROAM.meets.eventMaxHours, Number(m.hours ?? 2)));
    const id = `meetev_${crypto.randomBytes(6).toString('hex')}`;
    await db.execute(sql`insert into meet_events (id, meet_id, title, starts_at, hours, created_by) values (${id}, ${m.meetId}, ${m.title.trim().slice(0, 80)}, ${new Date(start).toISOString()}, ${hours}, ${adminId})`);
    return { id };
  }
  async function cancelMeet(id: string) {
    const r = await db.execute(sql`update meet_events set cancelled = true where id = ${id} returning id`);
    if (!r.rows.length) throw new AppError(404, 'NOT_FOUND', 'There\'s no such meet event.');
    return { ok: true };
  }

  // ---------- the zone servers' numbers: the live dashboard ----------
  function stats(s: any) {
    if (typeof s?.process !== 'string') return;
    const prev = statsLog.get(s.process);
    statsLog.set(s.process, { ...s, at: s.at ?? now(), prev: prev ? { at: prev.at, counters: prev.counters, bytes: bytesOf(prev) } : null });
    const t = now();
    // (a process gone 10 minutes — stopped, or replaced by a deploy — forgotten)
    for (const [k, x] of statsLog) if (t - x.at > 600000) statsLog.delete(k);
    if (!history.length || t - history.at(-1).at >= 60000) { const d = dashboard(); history.push({ at: t, players: d.totals.players, instances: d.totals.instances, downKBs: d.totals.downKBs, handoffsPerMin: d.totals.handoffsPerMin, cpu: d.totals.cpu }); while (history.length > 24 * 60) history.shift(); }
  }
  const bytesOf = (s: any) => (s.rooms ?? []).reduce((a: any, r: any) => ({ in: a.in + (r.bytesIn ?? 0), out: a.out + (r.bytesOut ?? 0), states: a.states + (r.statesIn ?? 0) }), { in: 0, out: 0, states: 0 });
  function dashboard() {
    const t = now(), live = [...statsLog.values()].filter(s => t - s.at < 20000);
    const zones = new Map<string, any>();
    let handoffsPerMin = 0, downKBs = 0, upKBs = 0, statesPerSec = 0, cpu = 0, rss = 0, homes = 0;
    for (const s of live) {
      for (const r of s.rooms ?? []) {
        const key = `${r.region}:${r.zone}`, z = zones.get(key) ?? { region: r.region, zone: r.zone, players: 0, instances: [] as any[] };
        z.players += r.players; homes += r.homes ?? 0; z.instances.push({ group: r.group, players: r.players, tickMsP50: r.tickMsP50 ?? null, tickMsP95: r.tickMsP95, tickCpuMsMean: r.tickCpuMsMean ?? null, challenges: r.challenges ?? 0, process: s.process });
        zones.set(key, z);
      }
      if (s.prev) {
        const dt = Math.max(1, (s.at - s.prev.at) / 1000), b = bytesOf(s);
        handoffsPerMin += Math.max(0, (s.counters?.handoffs ?? 0) - (s.prev.counters?.handoffs ?? 0)) / dt * 60;
        downKBs += Math.max(0, b.out - s.prev.bytes.out) / 1024 / dt; upKBs += Math.max(0, b.in - s.prev.bytes.in) / 1024 / dt;
        statesPerSec += Math.max(0, b.states - (s.prev.bytes.states ?? 0)) / dt;
      }
      cpu += s.cpu ?? 0; rss += s.rssMB ?? 0;
    }
    // (a player near a border is connected to up to 4 zones: connections; each is at home in one zone: players)
    const connections = [...zones.values()].reduce((a, z) => a + z.players, 0), players = homes || connections;
    return {
      at: t, processes: live.map(s => ({ process: s.process, ageS: Math.round((t - s.at) / 1000), rooms: (s.rooms ?? []).length, players: (s.rooms ?? []).reduce((a: number, r: any) => a + r.players, 0), cpu: s.cpu, rssMB: s.rssMB, counters: s.counters,
        tickMsP50: Math.max(0, ...(s.rooms ?? []).map((r: any) => r.tickMsP50 ?? 0)), tickMsP95: Math.max(0, ...(s.rooms ?? []).map((r: any) => r.tickMsP95 ?? 0)),
        tickCpuMsMean: Math.max(0, ...(s.rooms ?? []).map((r: any) => r.tickCpuMsMean ?? 0)) })),
      zones: [...zones.values()].sort((a, b) => b.players - a.players),
      // (a zone process that has stopped reporting for 20 s: left out of the numbers, listed here)
      silent: [...statsLog.values()].filter(s => t - s.at >= 20000).map(s => ({ process: s.process, ageS: Math.round((t - s.at) / 1000) })),
      totals: { players, connections, instances: [...zones.values()].reduce((a, z) => a + z.instances.length, 0), zones: zones.size, handoffsPerMin: Math.round(handoffsPerMin), downKBs: Math.round(downKBs), upKBs: Math.round(upKBs), statesPerSec: Math.round(statesPerSec), cpu: +cpu.toFixed(2), rssMB: rss },
      cost: costPer1000({ players, downKBs, cpu }),
      history: history.slice(-180), targets: ROAM.targets,
    };
  }
  return { settingsOf, saveSettings, ticket, save, comeBack, challenge, myChallenges, incident, listMeets, createMeet, cancelMeet, stats, dashboard };
}

// Hosting cost per 1,000 free roam players (docs/COSTS.md): from the measured download and CPU a player (the bot swarm:
// server/tools/roam-test.ts, or the live numbers), priced at data/roam.json costs. Two views: 1,000 monthly active players
// (peakShare of them on at once — the zone servers are sized for the peak; bandwidth for their hours), and 1,000 on at
// once all month (the worst case).
export function costPer1000({ players, downKBs, cpu }: { players: number; downKBs: number; cpu: number }, C = ROAM.costs) {
  if (!C) return null;
  const per = players >= 20 ? { kbs: downKBs / players, cores: cpu / players, measured: true } : { kbs: C.assumed.downKBsPerPlayer, cores: C.assumed.coresPerPlayer, measured: false };
  const price = (atOnce: number, hours: number, players1000 = 1000) => {
    const instances = Math.max(1, Math.ceil(per.cores * atOnce / C.coreTarget / C.coresPerInstance));
    const gb = per.kbs * hours * 3600 * players1000 / 1024 / 1024;
    const servers = instances * C.instanceMonthly, bandwidth = Math.max(0, gb - C.includedGB * instances) * C.perGB;
    return { atOnce, instances, gbMonth: Math.round(gb), monthly: { servers: Math.round(servers), bandwidth: Math.round(bandwidth), redis: C.redisMonthly, total: Math.round(servers + bandwidth + C.redisMonthly) } };
  };
  return {
    perPlayer: { downKBs: +per.kbs.toFixed(2), cores: +per.cores.toFixed(4), measured: per.measured },
    monthlyActive: price(Math.ceil(1000 * C.peakShare), C.hoursPerPlayerMonth),
    allAtOnce: price(1000, 730),
  };
}
