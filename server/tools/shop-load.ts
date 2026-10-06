// A load test for the shop (Phase 6 Step 4): 500 players browsing and buying at once — the server on a port of its
// own (a fresh database: 500 verified accounts, signed in, money to spend), the players in a thread of their own,
// each with its own address, cookies and CSRF token, arriving over 20 s:
//   their garage → the settings (the catalogue's prices) → today's used lot → buy a part → buy and fit one →
//   a kit → refund a part → sell several → buy a used car → sell it, keeping a part → the buy/sell ledger
// with a person's pause before each (5–20 s: looking round the shop). Every write with its own Idempotency-Key.
// Reported: each kind's time (p50, p95, worst), the errors, and the books afterwards.
//
//   node server/tools/shop-load.ts [--players 500] [--arrive 20] [--think-min 5 --think-max 20] [--burst]
//   Limits: no errors; every kind's p50 under 150 ms and p95 under 1 s; the books balanced.

import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { nameProblem } from '../src/names.ts';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const arg = (n: string, d: number) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PLAYERS = arg('--players', 500), PORT = arg('--port', 8795), BASE = `http://127.0.0.1:${PORT}`;
// (a player's pause between actions, in seconds: a person in the garage or driving — --burst: none at all)
const BURST = process.argv.includes('--burst'), THINK: [number, number] = BURST ? [0, 0] : [arg('--think-min', 5), arg('--think-max', 20)], ARRIVE = BURST ? 0 : arg('--arrive', 20);
// (the game shows a change at once — garage/player/remote.js — and the server's answer confirms it: these are how
// long that takes)
const LIMITS = BURST ? { p50: Infinity, p95: Infinity } : { p50: 150, p95: 1_000 };

if (!isMainThread) await players();
else {
console.log(`Shop load test: ${PLAYERS} players browsing and buying at once — ${BURST ? 'every action at the same moment (a stress figure: no limits)' : `arriving over ${ARRIVE} s, ${THINK[0]}–${THINK[1]} s between a player's actions`}`);
const database = await freshDatabase('shopload');
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
    await Promise.all(Array.from({ length: Math.min(50, PLAYERS - k) }, (_, j) => app.deps.auth.api.signUpEmail({ body: { email: `shop${k + j}@example.com`, password: 'correct horse battery', name: names[k + j], acceptTerms: config.termsVersion, birthDate: '1990-01-01' } as any })));
  }
  await app.deps.db.execute(sql`update users set email_verified = true`);
  const clients: { h: Record<string, string>; csrf: string }[] = [];
  for (let k = 0; k < PLAYERS; k += 25) {
    clients.push(...await Promise.all(Array.from({ length: Math.min(25, PLAYERS - k) }, async (_, j) => {
      const n = k + j, h: Record<string, string> = { origin: BASE, 'x-forwarded-for': `10.${(n >> 8) & 255}.${n & 255}.9` };
      const s = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ email: `shop${n}@example.com`, password: 'correct horse battery' }) });
      let cookie = (s.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
      const c = await fetch(`${BASE}/api/v1/csrf`, { headers: { ...h, cookie } });
      cookie = [cookie, ...(c.headers.getSetCookie?.() ?? []).map(x => x.split(';')[0])].filter(Boolean).join('; ');
      return { h: { ...h, cookie }, csrf: (await c.json()).token as string };
    })));
  }
  // (their garages made, with money to spend — an admin's grant, a ledger row each — and far enough along for any car)
  const ids = ((await app.deps.db.execute(sql`select id, name from users where email like 'shop%@example.com'`)).rows as any[]);
  for (let k = 0; k < ids.length; k += 50) await Promise.all(ids.slice(k, k + 50).map(async u => { await app.economy.state({ id: u.id, name: u.name }); await app.economy.adminMoney({ id: u.id, name: 'Load test' }, u.id, 200_000, 'Load test: money to shop with'); }));
  await app.deps.db.execute(sql`update player_economy set xp = 200000, rev = rev + 1`);
  report('set up', true, `${PLAYERS} accounts signed in, money to spend, in ${((performance.now() - t) / 1000).toFixed(1)} s`);

  // ---------- 500 players, all at once (in a thread of their own: the server's time is the server's) ----------
  const { times, errors, wall }: { times: Record<string, number[]>; errors: string[]; wall: number } = await new Promise<any>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { BASE, PLAYERS, clients, THINK, ARRIVE } });
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
  const kinds = (await app.deps.db.execute(sql`select kind, count(*)::int as n from ledger group by kind order by kind`)).rows as any[];
  const of = (k: string) => kinds.find(r => r.kind === k)?.n ?? 0;
  report('purchases, sales and refunds in the ledger', of('purchase') >= PLAYERS * 4 && of('sale') >= PLAYERS * 2 && of('refund') === PLAYERS, kinds.map(r => `${r.kind} ${r.n}`).join(', '));
  const cars = Number(((await app.deps.db.execute(sql`select count(*)::int as n from owned_cars`)).rows[0] as any).n);
  report('every used car bought was sold again', cars === PLAYERS, `${cars} cars for ${PLAYERS} players`);
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
  const { BASE, PLAYERS, clients, THINK, ARRIVE } = workerData;
  const pause = () => THINK[1] ? new Promise(r => setTimeout(r, (THINK[0] + Math.random() * (THINK[1] - THINK[0])) * 1000)) : null;
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
  const PARTS = ['cold_air_intake', 'catback_sport', 'ecu_stage1', 'springs_sport', 'brakes_sport', 'arb_front_sport'], KITS = ['kit_street_breathing', 'kit_street_brakes', 'kit_handling', 'kit_lightweight'];
  const player = async (k: number) => {
    const c = clients[k];
    if (ARRIVE) await new Promise(r => setTimeout(r, Math.random() * ARRIVE * 1000));
    const p = (await call('their garage', c, 'GET', '/api/v1/player')).profile, car = p.currentCar;
    await call('the settings (prices)', c, 'GET', '/api/v1/player/config');
    const lot = (await call('today\'s used lot', c, 'GET', '/api/v1/player/used-lot')).listings;
    const bought = (await act('buy a part', c, 'buyPart', { partId: PARTS[k % PARTS.length] })).instanceIds;
    await act('buy and fit', c, 'buyAndInstall', { carInstanceId: car, partId: 'strut_brace' });
    const kit = (await act('buy a kit', c, 'buyBundle', { bundleId: KITS[k % KITS.length] })).instanceIds;
    await act('a refund', c, 'refundPart', { instanceId: bought[0] });
    await act('sell several', c, 'sellParts', { instanceIds: kit });
    const usable = lot.filter((l: any) => !['S', 'X'].includes(l.class)), l = usable[k % usable.length];
    const used = await act('buy a used car', c, 'buyUsedCar', { listingId: l.id });
    const keep = Object.values<any>(used.updatedState.parts).filter(x => x.installedOn?.car === used.carInstanceId).slice(0, 1).map(x => x.instanceId);
    await act('sell a car', c, 'sellCar', { carInstanceId: used.carInstanceId, opts: { keep } });
    await call('the ledger', c, 'GET', '/api/v1/player/ledger?limit=50');
  };
  const t = performance.now();
  await Promise.all(Array.from({ length: PLAYERS }, (_, k) => player(k).catch(e => { if (!errors.some(x => x.startsWith(e.message))) errors.push(`player ${k}: ${e.message}`); })));
  parentPort!.postMessage({ times, errors, wall: (performance.now() - t) / 1000 });
}
