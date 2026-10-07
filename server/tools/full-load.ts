// The whole game under load (Phase 6 Step 5; the owner's target: 500 players at once — reports/load-test.md):
// every player through the game as a person plays it, over real HTTP to the server on a port of its own, from a thread
// of their own (so the times are the server's), each with its own address, cookies and CSRF token:
//   sign in (a real password check) → the game starts (settings, who you are, the status) → the world loads (content
//   near San Francisco: 2,000 published markers; a map cell; today's tracks) → the garage (the profile, the economy's
//   settings, today's used cars) → the shop (buy a part, fit it, take it off, sell it) → a drive (a crash report, a
//   heartbeat, the end) → a repair → today's daily event (started, finished: the server checks the run and pays) →
//   the result handed in for the leaderboard → the leaderboard
// with a person's pause (2–8 s) before each, arriving over 60 s. Then the books (every balance equal to its ledger).
// Limits (p95 by request kind): sign in 1.5 s (a password hash is meant to be slow), every other request 1 s; no errors.
//
//   TEST_DATABASE_URL=… node server/tools/full-load.ts [--players 500] [--arrive 60] [--think-min 2 --think-max 8] [--pool 10]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { nameProblem } from '../src/names.ts';
import { questVersionOf } from '../../quest/result.js';
import { newItem } from '../../content/quests.js';
import { offset, encode } from '../../content/geo.js';

const arg = (n: string, d: number) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PLAYERS = arg('--players', 500), PORT = arg('--port', 8796), BASE = `http://127.0.0.1:${PORT}`, POOL = arg('--pool', 10);
const THINK: [number, number] = [arg('--think-min', 2), arg('--think-max', 8)], ARRIVE = arg('--arrive', 60);
const LIMIT_MS = (kind: string) => kind === 'sign in' ? 1500 : 1000;
const SF = { lat: 37.7749, lon: -122.4194 };

const r3 = (x: number) => Math.round(x * 1000) / 1000;
function run(event: any, course: any, attemptId: string, speed = 45) {
  const loop = course.loop, L = course.length, startS = course.grid.startS, lapLength = loop ? L : course.grid.finishS - startS;
  const laps = loop ? Math.max(1, event.params?.laps ?? 1) : 1, rel = (s: number) => loop ? (((s - startS) % L) + L) % L : s - startS;
  const gates = course.gates.filter((g: any) => g.required).map((g: any) => ({ id: g.id, r: rel(g.s) })).sort((a: any, b: any) => a.r - b.r);
  const checkpoints: any[] = [];
  for (let lap = 1; lap <= laps; lap++) for (const g of gates) checkpoints.push({ id: g.id, lap, time: r3(((lap - 1) * lapLength + g.r) / speed + 0.001 * (checkpoints.length + 1)) });
  const lapTimes = Array.from({ length: laps }, (_, k) => r3(lapLength / speed + (k === 0 ? 0.5 : 0))), raw = r3(lapTimes.reduce((a, b) => a + b, 0));
  return { format: 1, attemptId, at: new Date().toISOString(), questId: event.id, questVersion: questVersionOf(event), type: event.type, routeId: null, routeVersion: course.version, status: 'finished', reason: null,
    car: { carId: 'starter_car', instanceId: 'x', fingerprint: 'f', className: 'D', kw: 90, kg: 1100, topSpeed: 60 }, start: { mode: 'rolling', jump: false }, checkpoints, laps: lapTimes, rawTime: raw, time: raw,
    penalties: [], score: null, medal: null, damage: { taken: 0, events: [] }, resets: 0, track: { code: event.track.code, kind: event.track.kind, hash: course.trackHash, version: event.track.version ?? null }, recording: null };
}

if (!isMainThread) await players();
else {
  console.log(`The whole game under load: ${PLAYERS} players, arriving over ${ARRIVE} s, ${THINK[0]}–${THINK[1]} s between actions, database pool ${POOL}`);
  const database = await freshDatabase('fullload');
  const config = testConfig(database.url, { logLevel: 'warn' }, { PUBLIC_URL: BASE, DATABASE_POOL_MAX: String(POOL) });
  const app = await buildApp({ config });
  await app.listen({ port: PORT, host: '127.0.0.1' });
  const lines: string[] = [], results: boolean[] = [];
  const report = (name: string, ok: boolean, detail: string) => { results.push(ok); const l = `${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(34)} ${detail}`; lines.push(l); console.log(l); };
  let out: any = null;
  try {
    let t = performance.now();
    // the world: 2,000 published markers round San Francisco
    await app.deps.db.execute(sql`insert into users (id, name, email, email_verified, role) values ('loadeditor', 'Load Editor', 'loadeditor@example.invalid', true, 'editor')`);
    const entries: any[] = [];
    for (let k = 0; k < 2000; k++) {
      const at = offset(SF, Math.sqrt((k * 7919 % 1000) / 1000) * 12, (k * 137) % 360);
      const it: any = newItem((['quest', 'poi', 'spawn'] as const)[k % 3], { id: `ld_${k.toString(36).padStart(5, '0')}`, location: { ...at, alt: 0, heading: k % 360 }, now: '2026-10-04T00:00:00Z', name: `Spot ${k}` } as any);
      if (it.kind === 'quest') { it.params.finish = { ...offset(at, 1, 90), alt: 0, heading: 0 }; it.rating = { stars: 1 + k % 5, km: 1 }; }
      entries.push({ draft: it, published: { ...it, status: 'published', publishedAt: '2026-10-04T00:00:00Z' } });
    }
    await app.content.importContent({ format: 'world-content', version: 2, entries }, { onConflict: 'skip' }, { id: 'loadeditor', name: 'Load Editor' });
    // the accounts (made directly: signing up isn't what's measured; signing in is)
    const names: string[] = [];
    for (let n = 0; names.length < PLAYERS; n++) { const name = `Racer ${n.toString(36)}`; if (!nameProblem(name)) names.push(name); }
    for (let k = 0; k < PLAYERS; k += 50) await Promise.all(Array.from({ length: Math.min(50, PLAYERS - k) }, (_, j) => app.deps.auth.api.signUpEmail({ body: { email: `load${k + j}@example.com`, password: 'correct horse battery', name: names[k + j], acceptTerms: config.termsVersion, birthDate: '1990-01-01' } as any })));
    await app.deps.db.execute(sql`update users set email_verified = true`);
    // (far enough along for today's events — the daily track can be a pro one)
    const ids = (await app.deps.db.execute(sql`select id, name from users where email like 'load%@example.com'`)).rows as any[];
    for (let k = 0; k < ids.length; k += 50) await Promise.all(ids.slice(k, k + 50).map(u => app.economy.state({ id: u.id, name: u.name })));
    await app.deps.db.execute(sql`update player_economy set xp = 200000, rev = rev + 1`);
    const today = await app.tracks.today(), ev = today.daily.events.find((e: any) => !e.npc?.count) ?? today.daily.events[0];
    const course = (await app.tracks.built(today.daily.code)).view;
    const dbSize = async () => Number(((await app.deps.db.execute(sql`select pg_database_size(current_database()) as b`)).rows[0] as any).b);
    const tables = async () => Object.fromEntries(((await app.deps.db.execute(sql`select relname as t, pg_total_relation_size(relid)::bigint as b from pg_catalog.pg_statio_user_tables`)).rows as any[]).map(r => [r.t, Number(r.b)]));
    const dbBefore = await dbSize(), tablesBefore = await tables(), cpuBefore = process.cpuUsage();
    report('set up', true, `${PLAYERS} accounts, 2,000 markers, today's tracks, in ${((performance.now() - t) / 1000).toFixed(1)} s`);

    out = await new Promise<any>((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { BASE, PLAYERS, ev, course, code: today.daily.code, THINK, ARRIVE, cell: encode(SF.lat, SF.lon, 5) } });
      w.once('message', resolve); w.once('error', reject);
    });
    const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
    out.kinds = {};
    for (const [kind, a] of Object.entries(out.times as Record<string, number[]>)) {
      const p50 = pct(a, 0.5), p95 = pct(a, 0.95), worst = Math.max(...a);
      out.kinds[kind] = { n: a.length, p50: Math.round(p50), p95: Math.round(p95), worst: Math.round(worst) };
      report(kind, p95 <= LIMIT_MS(kind), `${a.length}: p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, worst ${worst.toFixed(0)} ms (limit p95 ${LIMIT_MS(kind)} ms)`);
    }
    report('no errors', out.errors.length === 0, out.errors.length ? `${out.errors.length}: ${out.errors.slice(0, 3).join(' | ')}` : 'none');
    const n = Object.values(out.times as Record<string, number[]>).reduce((m, a) => m + a.length, 0);
    report('players at once', out.peak >= Math.min(PLAYERS, PLAYERS * 0.9), `${out.peak} playing at the busiest moment; ${n} requests in ${out.wall.toFixed(0)} s (${(n / out.wall).toFixed(0)} a second)`);
    const mismatches = await app.economy.ledgerCheck();
    report('every balance equals its ledger', mismatches.length === 0, mismatches.length ? JSON.stringify(mismatches.slice(0, 3)) : `${PLAYERS} players`);
    const paid = (await app.deps.db.execute(sql`select count(distinct user_id)::int as n from ledger where kind = 'reward'`)).rows[0] as any;
    report('each player paid once for the event', paid.n === PLAYERS, `${paid.n} of ${PLAYERS}`);
    const board = (await app.deps.db.execute(sql`select count(distinct user_id)::int as n from track_results where accepted`)).rows[0] as any;
    report('every result on the leaderboard', board.n === PLAYERS, `${board.n} of ${PLAYERS}`);
    report('the server still answers', (await fetch(`${BASE}/api/v1/health`)).ok, 'health');
    // (for the costs: what one player's session sent, stored and used — docs/COSTS.md)
    const cpu = process.cpuUsage(cpuBefore), dbGrowth = (await dbSize()) - dbBefore;
    const tablesAfter = await tables(), byTable = Object.entries(tablesAfter as Record<string, number>).map(([t, b]) => [t, Math.round((b - (tablesBefore[t] ?? 0)) / PLAYERS)] as [string, number]).filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]);
    out.usage = { dbByTablePerPlayer: Object.fromEntries(byTable), bytesPerPlayer: Math.round(out.bytes / PLAYERS), requestsPerPlayer: Math.round(n / PLAYERS), dbBytesPerPlayer: Math.round(dbGrowth / PLAYERS), cpuMsPerPlayer: Math.round((cpu.user + cpu.system) / 1000 / PLAYERS) };
    lines.push(`  ..   one player's session              ${out.usage.requestsPerPlayer} requests, ${(out.usage.bytesPerPlayer / 1024).toFixed(0)} KB sent to them, ${(out.usage.dbBytesPerPlayer / 1024).toFixed(0)} KB more in the database, ${out.usage.cpuMsPerPlayer} ms of CPU (this process: the server and the players' requests)`);
    lines.push(`       the database, by table (per player): ${byTable.slice(0, 8).map(([t, b]) => `${t} ${(b / 1024).toFixed(1)} KB`).join(', ')}`);
    console.log(lines.slice(-2).join('\n'));
    const slow = app.metrics.window(30).routes.slice(0, 5).map(r => `${r.route} p95 ${Math.round(r.p95)} ms (${r.n})`);
    lines.push('', 'Slowest on the server (its own timing, last 30 minutes): ' + slow.join('; '));
  } finally {
    await app.close();
    await database.drop();
  }
  const ok = results.every(Boolean);
  fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(REPO_DIR, 'reports/load-test.json'), JSON.stringify({ at: new Date().toISOString(), ok, players: PLAYERS, arriveSec: ARRIVE, think: THINK, pool: POOL, kinds: out?.kinds, peak: out?.peak, wallSec: out?.wall, usage: out?.usage, errors: out?.errors?.slice(0, 20) }, null, 1) + '\n');
  fs.writeFileSync(path.join(REPO_DIR, 'reports/load-test.md'), `# Load test: the whole game, ${PLAYERS} players at once\n\n${new Date().toISOString()} · ${ok ? '**passed**' : '**FAILED**'} · server/tools/full-load.ts, this computer (${(await import('node:os')).cpus().length} cores), one server process, PostgreSQL 16 on the same machine, database pool ${POOL}\n\nEach player: sign in → the game starts → the world loads → the garage → the shop → a drive → a repair → the daily event (checked, paid) → the leaderboard; a person's pause of ${THINK[0]}–${THINK[1]} s before each, arriving over ${ARRIVE} s.\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  console.log(ok ? `\n${results.length} of ${results.length} ok` : `\n${results.filter(r => !r).length} failed`);
  process.exitCode = ok ? 0 : 1;
}

// ---------- the players' thread ----------
async function players() {
  const { BASE, PLAYERS, ev, course, code, THINK, ARRIVE, cell } = workerData;
  const pause = () => new Promise(r => setTimeout(r, (THINK[0] + Math.random() * (THINK[1] - THINK[0])) * 1000));
  const times: Record<string, number[]> = {}, errors: string[] = [];
  let playing = 0, peak = 0, bytes = 0;
  const player = async (k: number) => {
    await new Promise(r => setTimeout(r, Math.random() * ARRIVE * 1000));
    playing++; peak = Math.max(peak, playing);
    const h: Record<string, string> = { origin: BASE, 'x-forwarded-for': `10.${(k >> 8) & 255}.${k & 255}.7`, 'x-kr-client': '1', 'x-kr-device': crypto.randomUUID() };
    let csrf = '';
    const call = async (kind: string, method: string, url: string, body?: unknown, think = true) => {
      if (think) await pause();
      const a = performance.now();
      const res = await fetch(BASE + url, { method, headers: { ...h, ...(method === 'GET' ? {} : { 'content-type': 'application/json', ...(url.startsWith('/api/v1') ? { 'x-csrf-token': csrf, 'idempotency-key': crypto.randomUUID() } : {}) }) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
      const text = await res.text();
      bytes += text.length;
      (times[kind] ??= []).push(performance.now() - a);
      for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'), name = pair.split('=')[0]; h.cookie = [...(h.cookie ?? '').split('; ').filter(x => x && !x.startsWith(`${name}=`)), pair].join('; '); }
      if (!res.ok) { errors.push(`${kind} ${res.status} ${text.slice(0, 140)}`); throw new Error(kind); }
      return text ? JSON.parse(text) : null;
    };
    const act = (kind: string, action: string, args: object) => call(kind, 'POST', `/api/v1/player/actions/${action}`, { args });
    try {
      await call('sign in', 'POST', '/api/auth/sign-in/email', { email: `load${k}@example.com`, password: 'correct horse battery' }, false);
      csrf = (await call('the game starts', 'GET', '/api/v1/csrf', undefined, false)).token;
      await Promise.all([call('the game starts', 'GET', '/api/v1/client-config', undefined, false), call('the game starts', 'GET', '/api/v1/me', undefined, false), call('the game starts', 'GET', '/api/v1/status', undefined, false)]);
      await call('the world loads', 'GET', `/api/v1/content?lat=${37.77 + (k % 10) / 1000}&lon=-122.419&km=3&view=published&offered=true`);
      await Promise.all([call('the world loads', 'GET', `/api/v1/content/cells/${cell}?view=published`, undefined, false), call('the world loads', 'GET', '/api/v1/tracks/today', undefined, false)]);
      const p = (await call('the garage', 'GET', '/api/v1/player')).profile, car = p.currentCar;
      await Promise.all([call('the garage', 'GET', '/api/v1/player/config', undefined, false), call('the shop', 'GET', '/api/v1/player/used-lot', undefined, false)]);
      const id = (await act('the shop', 'buyPart', { partId: 'cold_air_intake' })).instanceIds[0];
      const socket = (await act('the garage', 'installPart', { carInstanceId: car, instanceId: id })).updatedState.parts[id].installedOn.socket;
      await act('the garage', 'removePart', { carInstanceId: car, which: socket });
      const now = (await act('the shop', 'sellPart', { instanceId: id })).updatedState;
      const d = await call('a drive', 'POST', '/api/v1/player/drives', { carInstanceId: car, mode: 'free' });
      const part = Object.values<any>(now.parts).find(x => x.installedOn?.car === car);
      await act('a drive', 'damageCar', { sessionId: d.sessionId, carInstanceId: car, report: { parts: { [part.instanceId]: { condition: 85 } }, shell: { condition: 92 } }, cause: 'wall' });
      await call('a drive', 'POST', `/api/v1/player/sessions/${d.sessionId}/heartbeat`);
      await call('a drive', 'POST', `/api/v1/player/drives/${d.sessionId}/end`);
      await act('the garage', 'repairCar', { carInstanceId: car, opts: {} });
      const s = await act('an event', 'startQuest', { questId: ev.id, trackCode: code });
      const result = run(ev, course, s.attemptId, 40 + (k % 10));
      await act('an event: checked and paid', 'finishQuest', { sessionId: s.sessionId, result });
      await call('the leaderboard', 'POST', '/api/v1/tracks/results', { eventId: ev.id, result: { ...result, attemptId: `lb-${s.attemptId}` } });
      await call('the leaderboard', 'GET', `/api/v1/tracks/leaderboard?eventId=${encodeURIComponent(ev.id)}&limit=20`);
    } catch (e: any) { if (!errors.some(x => x.startsWith(e.message))) errors.push(`player ${k}: ${e.message}`); }
    finally { playing--; }
  };
  const t = performance.now();
  await Promise.all(Array.from({ length: PLAYERS }, (_, k) => player(k)));
  parentPort!.postMessage({ times, errors, wall: (performance.now() - t) / 1000, peak, bytes });
}
