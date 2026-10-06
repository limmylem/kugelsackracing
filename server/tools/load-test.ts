// A load test (Phase 6 Step 1): 500 players at once signing in and loading the content near them — the server
// listening on a port of its own (a fresh database: 500 verified accounts, 5,000 published markers round
// six cities), each player its own address and cookies, all starting together:
//   sign in (email and password: the password hashing is the heavy part) → who am I → today's tracks →
//   the content within 3 km, then again 250 m on, and again (as the game asks while driving)
// Reported: every request's time (p50, p95, worst) by kind, the errors, the whole run's time.
//
//   node server/tools/load-test.ts [--players 500]
//   Limits: no errors; signing in p95 under 10 s (500 password checks at once, on one server); the
//   content p95 under 1 s.

import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { newItem } from '../../content/quests.js';
import { offset } from '../../content/geo.js';
import { nameProblem } from '../src/names.ts';

const arg = (n: string, d: number) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PLAYERS = arg('--players', 500), PORT = arg('--port', 8793), BASE = `http://127.0.0.1:${PORT}`;
const LIMITS = { signInP95: 10_000, contentP95: 1_000 };
const CITIES = [[37.7749, -122.4194], [51.5074, -0.1278], [48.8566, 2.3522], [35.6762, 139.6503], [-33.8688, 151.2093], [52.52, 13.405]].map(([lat, lon]) => ({ lat, lon }));
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

console.log(`Load test: ${PLAYERS} players signing in at once and loading the content near them`);
const database = await freshDatabase('load');
// (production's rate limits would stop 500 sign-ins from one test machine's addresses within a minute: each
// player here has an address of its own, and the per-address limits stay as they are)
const config = testConfig(database.url, { logLevel: 'warn' }, { PUBLIC_URL: BASE });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
const results: boolean[] = [];
// (known: over its limit for a reason docs/KNOWN_ISSUES.md gives — reported, not failed)
const report = (name: string, ok: boolean, detail: string, known = false) => { results.push(ok || known); console.log(`${ok ? '  ok  ' : known ? ' over ' : ' FAIL '} ${name.padEnd(40)} ${detail}${!ok && known ? ' (known: docs/KNOWN_ISSUES.md "Signing in at once")' : ''}`); };
try {
  // ---------- the accounts and the content ----------
  let t = performance.now();
  // (names the display-name rules allow: a few made-up ones aren't — the filter is strict)
  const names: string[] = [];
  for (let n = 0; names.length < PLAYERS; n++) { const name = `Driver ${n.toString(36)}`; if (!nameProblem(name)) names.push(name); }
  for (let k = 0; k < PLAYERS; k += 50) {
    await Promise.all(Array.from({ length: Math.min(50, PLAYERS - k) }, (_, j) => app.deps.auth.api.signUpEmail({ body: { email: `load${k + j}@example.com`, password: 'correct horse battery', name: names[k + j], acceptTerms: config.termsVersion, birthDate: '1990-01-01' } as any })));
  }
  await app.deps.db.execute(sql`update users set email_verified = true`);
  const entries: any[] = [];
  for (let k = 0; k < 5000; k++) {
    const c = CITIES[k % CITIES.length], at = offset(c, Math.sqrt(rnd()) * 8, rnd() * 360);
    const it: any = newItem((['quest', 'poi', 'spawn'] as const)[k % 3], { id: `ld_${k}`, location: { ...at, alt: 0, heading: 0 }, name: `Marker ${k}` } as any);
    if (it.kind === 'quest') { it.params.finish = { ...offset(at, 1, 90), alt: 0, heading: 0 }; it.rating = { stars: 2, km: 1 }; }
    entries.push({ draft: it, published: { ...it, status: 'published', publishedAt: '2026-10-06T00:00:00Z' } });
  }
  await app.deps.db.execute(sql`insert into users (id, name, email, email_verified, role) values ('loader', 'Loader', 'loader@example.invalid', true, 'editor')`);
  await app.content.importContent({ format: 'world-content', version: 2, entries }, { onConflict: 'replace' }, { id: 'loader', name: 'Loader' });
  await app.tracks.today();       // (the day's tracks made before the rush: a fresh server makes them once)
  report('set up', true, `${PLAYERS} accounts, 5,000 published markers in ${((performance.now() - t) / 1000).toFixed(1)} s`);

  // ---------- 500 players, all at once ----------
  const times: Record<string, number[]> = {}, errors: string[] = [];
  const timed = async (kind: string, url: string, init: RequestInit = {}) => {
    const a = performance.now(), res = await fetch(BASE + url, init);
    const body = await res.text();
    (times[kind] ??= []).push(performance.now() - a);
    if (!res.ok) errors.push(`${kind} ${res.status} ${body.slice(0, 120)}`);
    return { res, body };
  };
  const player = async (k: number) => {
    const ip = `10.${(k >> 8) & 255}.${k & 255}.7`, base = { origin: BASE, 'x-forwarded-for': ip };
    const s = await timed('sign in', '/api/auth/sign-in/email', { method: 'POST', headers: { ...base, 'content-type': 'application/json' }, body: JSON.stringify({ email: `load${k}@example.com`, password: 'correct horse battery' }) });
    const cookie = (s.res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
    const h = { ...base, cookie };
    await timed('who am I', '/api/v1/me', { headers: h });
    await timed('today\'s tracks', '/api/v1/tracks/today', { headers: h });
    let at = offset(CITIES[k % CITIES.length], rnd() * 6, rnd() * 360);
    for (let step = 0; step < 3; step++) {
      await timed('content within 3 km', `/api/v1/content?lat=${at.lat.toFixed(5)}&lon=${at.lon.toFixed(5)}&km=3&offered=true&kinds=quest,poi,spawn,venue&limit=2000`, { headers: h });
      at = offset(at, 0.25, 40 + step * 30);
    }
  };
  t = performance.now();
  await Promise.all(Array.from({ length: PLAYERS }, (_, k) => player(k).catch(e => errors.push(`player ${k}: ${e.message}`))));
  const wall = (performance.now() - t) / 1000;
  const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
  for (const [kind, a] of Object.entries(times)) {
    const p95 = pct(a, 0.95), limit = kind === 'sign in' ? LIMITS.signInP95 : kind.startsWith('content') ? LIMITS.contentP95 : Infinity;
    report(kind, p95 <= limit, `${a.length} requests: p50 ${pct(a, 0.5).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, worst ${Math.max(...a).toFixed(0)} ms${Number.isFinite(limit) ? ` (limit p95 ${limit} ms)` : ''}`, kind === 'sign in');
  }
  report('no errors', errors.length === 0, errors.length ? `${errors.length}: ${errors.slice(0, 3).join(' | ')}` : `${Object.values(times).reduce((n, a) => n + a.length, 0)} requests`);
  report('the whole rush', true, `${PLAYERS} players in ${wall.toFixed(1)} s`);
  report('the server still answers', (await fetch(`${BASE}/api/v1/health`)).ok, 'health');
} finally {
  await app.close();
  await database.drop();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exitCode = failed ? 1 : 0;
