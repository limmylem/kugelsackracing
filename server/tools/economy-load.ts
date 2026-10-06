// A load test for the server's economy (Phase 6 Step 2): 500 players online at once, in the garage and on the
// road — the server on a port of its own (a fresh database: 500 verified accounts, signed in, their garages made
// and far enough along for any of today's events), the players in a thread of their own (so the times are the
// server's), each with its own address, cookies and CSRF token, arriving over 20 s:
//   their garage → the settings → buy a part → fit it → take it off → sell it → a drive: started, three crash
//   reports, a heartbeat, ended → a repair → today's daily event: started (fee, if any), finished (paid once)
// with a person's pause before each (5–20 s: a look round the shop, a click, a crash while driving). Every write with its
// own Idempotency-Key, one database transaction each, under the player's lock.
// Reported: each kind's time (p50, p95, worst), the errors, and the books afterwards (every balance equal to
// its ledger; one start row and one reward a player).
//
//   node server/tools/economy-load.ts [--players 500] [--arrive 20] [--think-min 5 --think-max 20] [--burst]
//   Limits: no errors; every kind's p50 under 150 ms and p95 under 1 s (the game shows each change at once:
//   this is the server confirming it); the books balanced.
//   --burst: no pauses — all 500 ask at the same moment, every step (a stress figure, no time limits:
//   docs/KNOWN_ISSUES.md "Everyone at the same moment")

import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { nameProblem } from '../src/names.ts';
import { questVersionOf } from '../../quest/result.js';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const arg = (n: string, d: number) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PLAYERS = arg('--players', 500), PORT = arg('--port', 8794), BASE = `http://127.0.0.1:${PORT}`;
// (a player's pause between actions, in seconds: a person in the garage or driving — --burst: none at all)
const BURST = process.argv.includes('--burst'), THINK: [number, number] = BURST ? [0, 0] : [arg('--think-min', 5), arg('--think-max', 20)], ARRIVE = BURST ? 0 : arg('--arrive', 20);
// (the game shows a change at once — garage/player/remote.js — and the server's answer confirms it: these are how
// long that takes)
const LIMITS = BURST ? { p50: Infinity, p95: Infinity } : { p50: 150, p95: 1_000 };

// a run handed in as the game would (as server/test/sessions.test.ts makes them)
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
console.log(`Economy load test: ${PLAYERS} players in the garage and on the road at once — ${BURST ? 'every action at the same moment (a stress figure: no limits)' : `arriving over ${ARRIVE} s, ${THINK[0]}–${THINK[1]} s between a player's actions`}`);
const database = await freshDatabase('ecoload');
const config = testConfig(database.url, { logLevel: 'warn' }, { PUBLIC_URL: BASE, DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX ?? '10' });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
const results: boolean[] = [];
const report = (name: string, ok: boolean, detail: string) => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(36)} ${detail}`); };

try {
  // ---------- the accounts, signed in ----------
  let t = performance.now();
  const names: string[] = [];
  for (let n = 0; names.length < PLAYERS; n++) { const name = `Racer ${n.toString(36)}`; if (!nameProblem(name)) names.push(name); }
  for (let k = 0; k < PLAYERS; k += 50) {
    await Promise.all(Array.from({ length: Math.min(50, PLAYERS - k) }, (_, j) => app.deps.auth.api.signUpEmail({ body: { email: `eco${k + j}@example.com`, password: 'correct horse battery', name: names[k + j], acceptTerms: config.termsVersion, birthDate: '1990-01-01' } as any })));
  }
  await app.deps.db.execute(sql`update users set email_verified = true`);
  const clients: { h: Record<string, string>; csrf: string }[] = [];
  for (let k = 0; k < PLAYERS; k += 25) {
    clients.push(...await Promise.all(Array.from({ length: Math.min(25, PLAYERS - k) }, async (_, j) => {
      const n = k + j, h: Record<string, string> = { origin: BASE, 'x-forwarded-for': `10.${(n >> 8) & 255}.${n & 255}.9` };
      const s = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ email: `eco${n}@example.com`, password: 'correct horse battery' }) });
      let cookie = (s.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
      const c = await fetch(`${BASE}/api/v1/csrf`, { headers: { ...h, cookie } });
      cookie = [cookie, ...(c.headers.getSetCookie?.() ?? []).map(x => x.split(';')[0])].filter(Boolean).join('; ');
      return { h: { ...h, cookie }, csrf: (await c.json()).token as string };
    })));
  }
  // (their garages made, and each far enough along for today's events — the daily track can be a pro one)
  const ids = ((await app.deps.db.execute(sql`select id, name from users where email like 'eco%@example.com'`)).rows as any[]);
  for (let k = 0; k < ids.length; k += 50) await Promise.all(ids.slice(k, k + 50).map(u => app.economy.state({ id: u.id, name: u.name })));
  await app.deps.db.execute(sql`update player_economy set xp = 200000, rev = rev + 1`);
  const today = await app.tracks.today(), ev = today.daily.events.find((e: any) => !e.npc?.count) ?? today.daily.events[0];
  const course = (await app.tracks.built(today.daily.code)).view;
  report('set up', true, `${PLAYERS} accounts signed in, today's tracks made, in ${((performance.now() - t) / 1000).toFixed(1)} s`);

  // ---------- 500 players, all at once (in a thread of their own: the server's time is the server's) ----------
  const { times, errors, wall }: { times: Record<string, number[]>; errors: string[]; wall: number } = await new Promise<any>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { BASE, PLAYERS, clients, ev, course, code: today.daily.code, THINK, ARRIVE } });
    w.once('message', resolve); w.once('error', reject);
  });
  const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
  for (const [kind, a] of Object.entries(times)) {
    const p50 = pct(a, 0.5), p95 = pct(a, 0.95);
    report(kind, p50 <= LIMITS.p50 && p95 <= LIMITS.p95, `${a.length} requests: p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, worst ${Math.max(...a).toFixed(0)} ms${BURST ? '' : ` (limits ${LIMITS.p50} / ${LIMITS.p95} ms)`}`);
  }
  report('no errors', errors.length === 0, errors.length ? `${errors.length}: ${errors.slice(0, 3).join(' | ')}` : `${Object.values(times).reduce((n, a) => n + a.length, 0)} requests`);
  const n = Object.values(times).reduce((m, a) => m + a.length, 0);
  report('the whole rush', true, `${PLAYERS} players, ${n} requests in ${wall.toFixed(1)} s (${(n / wall).toFixed(0)} a second)`);

  // ---------- the books afterwards ----------
  const mismatches = await app.economy.ledgerCheck();
  report('every balance equals its ledger', mismatches.length === 0, mismatches.length ? JSON.stringify(mismatches.slice(0, 3)) : `${PLAYERS} players`);
  const kinds = (await app.deps.db.execute(sql`select kind, count(*)::int as n, count(distinct user_id)::int as players from ledger group by kind order by kind`)).rows as any[];
  const of = (k: string) => kinds.find(r => r.kind === k) ?? { n: 0, players: 0 };
  report('one start and one reward a player', of('start').n === PLAYERS && of('reward').n === of('reward').players && of('reward').players === PLAYERS, kinds.map(r => `${r.kind} ${r.n}`).join(', '));
  report('the server still answers', (await fetch(`${BASE}/api/v1/health`)).ok, 'health');
} finally {
  await app.close();
  await database.drop();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exitCode = failed ? 1 : 0;
}

// ---------- the players' thread ----------
async function players() {
  const { BASE, PLAYERS, clients, ev, course, code, THINK, ARRIVE } = workerData;
  const pause = () => THINK[1] ? new Promise(r => setTimeout(r, (THINK[0] + Math.random() * (THINK[1] - THINK[0])) * 1000)) : null;
  const today = { daily: { code } };
  const times: Record<string, number[]> = {}, errors: string[] = [];
  const call = async (kind: string, c: { h: Record<string, string>; csrf: string }, method: string, url: string, body?: unknown) => {
    await pause();
    const a = performance.now();
    const res = await fetch(BASE + url, { method, headers: { ...c.h, ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf-token': c.csrf, 'idempotency-key': crypto.randomUUID() }) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const text = await res.text();
    (times[kind] ??= []).push(performance.now() - a);
    if (!res.ok) { errors.push(`${kind} ${res.status} ${text.slice(0, 140)}`); throw new Error(kind); }
    return text ? JSON.parse(text) : null;
  };
  const act = (kind: string, c: any, action: string, args: object) => call(kind, c, 'POST', `/api/v1/player/actions/${action}`, { args });
  const player = async (k: number) => {
    const c = clients[k];
    if (ARRIVE) await new Promise(r => setTimeout(r, Math.random() * ARRIVE * 1000));
    const p = (await call('their garage', c, 'GET', '/api/v1/player')).profile, car = p.currentCar;
    await call('the settings', c, 'GET', '/api/v1/player/config');
    const id = (await act('buy a part', c, 'buyPart', { partId: 'cold_air_intake' })).instanceIds[0];
    const socket = (await act('fit it', c, 'installPart', { carInstanceId: car, instanceId: id })).updatedState.parts[id].installedOn.socket;
    await act('take it off', c, 'removePart', { carInstanceId: car, which: socket });
    const now = (await act('sell it', c, 'sellPart', { instanceId: id })).updatedState;
    // a drive: crash reports, a heartbeat, the end
    const d = await call('start a drive', c, 'POST', '/api/v1/player/drives', { carInstanceId: car, mode: 'free' });
    const fitted = Object.values<any>(now.parts).filter(x => x.installedOn?.car === car).slice(0, 3);
    for (let i = 0; i < 3; i++) {
      const part = fitted[i % fitted.length];
      await act('crash report', c, 'damageCar', { sessionId: d.sessionId, carInstanceId: car, report: { parts: { [part.instanceId]: { condition: 90 - i * 10 } }, shell: { condition: 95 - i * 5 } }, cause: 'wall' });
    }
    await call('heartbeat', c, 'POST', `/api/v1/player/sessions/${d.sessionId}/heartbeat`);
    await call('end a drive', c, 'POST', `/api/v1/player/drives/${d.sessionId}/end`);
    await act('a repair', c, 'repairCar', { carInstanceId: car, opts: {} });
    // today's daily event: started, finished — paid once
    const s = await act('start an event', c, 'startQuest', { questId: ev.id, trackCode: today.daily.code });
    await act('finish it (the reward)', c, 'finishQuest', { sessionId: s.sessionId, result: run(ev, course, s.attemptId, 40 + (k % 10)) });
  };
  const t = performance.now();
  await Promise.all(Array.from({ length: PLAYERS }, (_, k) => player(k).catch(e => { if (!errors.some(x => x.startsWith(e.message))) errors.push(`player ${k}: ${e.message}`); })));
  parentPort!.postMessage({ times, errors, wall: (performance.now() - t) / 1000 });
}
