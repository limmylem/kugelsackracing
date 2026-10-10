// @ts-nocheck — (bots and the browser-side modules: not this program's types)
// The live load test (Phase 7 Step 5; docs/DEPLOYMENT.md "Load test"): bots playing on the real servers — online, or a
// local API and real-time server — through the same front doors as players. Their join tickets come from the API with
// the load-test token (POST /api/v1/rt/ticket, header x-kr-loadtest: made-up guests "loadtest-<n>", no accounts — routes/
// rt.ts). By default half drive in free roam (mp/roamBot.js, on Milton Keynes' roads, near each other so each sees the
// others) and half queue for quick races (mp/bot.js; the queue fills the empty places with NPCs after npcFillSec), racing
// again while there's time. Free roam and the races run in two processes of their own, so neither's work shows up as
// the other's stutter. Measured, each against a target (exit code 0 only if every one is met):
//   - every bot joined (free roam placed, the queue joined and a race seated); no connection dropped or closed by the
//     server that the bot didn't close itself
//   - ping (the clock's round trip) p50 and p95 — from far away (GitHub's runners are in the US: ~200 ms to Sydney and
//     back) the targets are wider: --ping-p50 / --ping-p95, by default 120/200 ms against localhost-like addresses and
//     350/500 ms otherwise
//   - each bot's car states actually sent a second while driving (the median second: NET.sendHz, 30, less the frame
//     timing's rounding — at least 80% of it)
//   - the other cars as drawn: snaps per 100,000 car-frames (net/measure.js, as server/tools/roam-test.ts counts them) —
//     free roam's cars within seeing.simpleM, the races' cars while racing; at most --snaps (default 50 per 100,000)
//   - the real-time server's own numbers during the run (GET /health: up all along, players and rooms, nothing draining)
//     and the API's (GET /api/v1/status: ok, and the real-time server "up" where it says)
//   - races finished: every race a bot loaded reached its results (provisional: the bots' runs aren't any account's,
//     so the API keeps them out of ratings and pay — mp/service.ts)
//
//   node server/tools/online-bots.ts --api https://api.ognistrada.com --rt wss://rt.ognistrada.com --token <LOADTEST_TOKEN>
//        [--bots 20] [--seconds 120] [--mode both|roam|race] [--region mk] [--race-wait 420] [--ping-p50 ms] [--ping-p95 ms]
//        [--snaps 50] [--report reports/online-bots.md]
//   (the token can come from LOADTEST_TOKEN instead; --rt defaults to the address in the tickets; with GITHUB_STEP_SUMMARY
//   set — the workflow, .github/workflows/loadtest.yml — the report goes into the job's summary too)

import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), arg = (k: string, d: any) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const PART = process.env.ONLINE_BOTS_PART ? JSON.parse(process.env.ONLINE_BOTS_PART) : null;

// ---------- both parts: tickets, and a transport that counts what's sent and what's lost ----------
async function ticketFor(o: any, bot: number) {
  const r = await fetch(`${o.api}/api/v1/rt/ticket`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), 'x-kr-loadtest': o.token }, body: JSON.stringify({ bot }) });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j?.ticket) throw new Error(`no ticket for bot ${bot}: ${r.status} ${j?.error?.message ?? ''}`.trim());
  return { ticket: j.ticket, url: o.rt ?? j.url };
}
// (each connection: its car states sent, by the second; dropped (the SDK reconnecting), or closed by the server)
function countingTransport(base: any, C2S: any, tally: any) {
  return {
    ...base,
    async join(...a: any[]) {
      const c = await base.join(...a), me = { room: a[1], states: new Map<number, number>(), leaving: false };
      tally.conns.push(me);
      const send = c.send, leave = c.leave;
      c.send = (type: number, bytes: any, opts: any) => { if (type === C2S.STATE) { const s = Math.floor(performance.now() / 1000); me.states.set(s, (me.states.get(s) ?? 0) + 1); } return send.call(c, type, bytes, opts); };
      c.leave = () => { me.leaving = true; return leave.call(c); };
      c.onStatus((s: string, info: any) => {
        if (s === 'dropped') tally.drops.push({ room: me.room, code: info?.code ?? null });
        // (left without asking: the server closed it — 4000/1000 are a room's normal goodbye after the bot's own leave)
        if (s === 'left' && !me.leaving) tally.closed.push({ room: me.room, code: info?.code ?? null, reason: String(info?.reason ?? '').slice(0, 80) });
      });
      return c;
    },
  };
}
// car states a second while driving: the median of the whole seconds a connection sent in (not its first or last)
function sendRate(tally: any) {
  let best = 0;
  for (const c of tally.conns) {
    const secs = [...c.states.keys()].sort((a, b) => a - b).slice(1, -1).map(s => c.states.get(s));
    if (secs.length >= 5) best = Math.max(best, pct(secs, 0.5));
  }
  return best;
}

// ---------- the free-roam part: bots driving road loops near each other ----------
async function roamPart(o: any) {
  const { transport: base } = await import('./rt-bots.ts');
  const { createRoamBot } = await import('../../mp/roamBot.js');
  const { ROAM } = await import('../src/rt/mpData.ts');
  const { createSmoothness } = await import('../../net/measure.js');
  const { C2S } = await import('../../net/protocol.js');
  let seed = 7919;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // each its own oval, side by side near the region's middle (as roam-test.ts F's drivers): what's measured is how the
  // others' cars look, and a road's sharp corners and a there-and-back's about-turn in a scripted car look like snaps
  // that no player's car makes
  const oval = (k: number) => { const z = -100 + (k % 10) * 20, h = 450; return [[-h, 0, z], [h, 0, z], [h + 80, 0, z + 40], [h, 0, z + 80], [-h, 0, z + 80], [-h - 80, 0, z + 40]]; };
  const bots: any[] = [];
  for (const n of o.ids) {
    const tally = { conns: [], drops: [], closed: [] };
    const b: any = (createRoamBot as any)({ transport: countingTransport(base, C2S, tally), getTicket: () => ticketFor(o, n), region: o.region, cfg: ROAM, points: oval(n), drive: { topSpeed: 14 + rng() * 14, startAt: rng() * 800 }, look: { carId: 'starter_car', paint: { colour: `hsl(${n * 47 % 360} 70% 50%)` }, parts: {}, bot: true }, endpoint: null });
    Object.assign(b, { n, tally, pings: [] as number[], meas: new Map(), frames: 0, snaps: 0 });
    bots.push(b);
  }
  // in one after another (a quarter of a second apart, as people arrive), kept alive while the others come in
  const t0 = Date.now();
  let measuring = false, last = performance.now(), lastPing = 0;
  const loop = setInterval(() => {
    const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
    for (const b of bots) {
      if (!b.ok) continue;
      try { b.step(dt, t); } catch (e) { b.err ??= String(e?.message ?? e); continue; }
      // (the others as this game draws them: a car fading in or beyond simpleM isn't drawn as a car — roam-test's rule)
      const here = new Set();
      for (const c of b.sample(dt)) {
        if (!measuring || c.leaving || !c.pose || (c.alpha ?? 1) < 0.5) continue;
        if (Math.hypot(c.pose.pos[0] - b.state.pos[0], c.pose.pos[2] - b.state.pos[2]) > ROAM.seeing.simpleM) continue;
        here.add(c.uid);
        let m = b.meas.get(c.uid); if (!m) b.meas.set(c.uid, m = createSmoothness({ snapCm: ROAM.targets.jumpCm }));
        m.frame(c.pose, dt);
      }
      for (const [uid, m] of b.meas) if (!here.has(uid)) m.frame(null, dt);
    }
    if (t - lastPing >= 1000) { lastPing = t; for (const b of bots) { const p = b.ok ? b.RC?.stats.ping : null; if (measuring && Number.isFinite(p) && p > 0) b.pings.push(p); } }
  }, 1000 / 60);
  for (const b of bots) {
    const j0 = Date.now();
    try { await b.start(); b.ok = true; b.joinMs = Date.now() - j0; } catch (e) { b.ok = false; b.err = String(e?.message ?? e); }
    process.send?.({ progress: { part: 'roam', joined: bots.filter(x => x.ok).length, of: bots.length } });
    await sleep(250);
  }
  // (a few seconds for everyone to see everyone, then the counting starts)
  await sleep(5000);
  measuring = true;
  const left = o.seconds * 1000 - (Date.now() - t0);
  await sleep(Math.max(10000, left));
  measuring = false;
  clearInterval(loop);
  const out = bots.map(b => {
    const r = [...b.meas.values()].map(m => m.result());
    return { n: b.n, ok: !!b.ok, err: b.err ?? null, joinMs: b.joinMs ?? null, pings: b.pings, statesPerSec: sendRate(b.tally), drops: b.tally.drops, closed: b.tally.closed, lost: b.RC?.stats.lost ?? 0, handoffs: b.RC?.handoffs ?? 0,
      saw: b.meas.size, frames: r.reduce((a, x) => a + x.frames, 0), snaps: r.reduce((a, x) => a + x.snaps, 0), worstJumpCm: Math.max(0, ...r.map(x => x.worstJumpCm)), notes: r.flatMap(x => x.notes).slice(0, 3) };
  });
  for (const b of bots) await b.leave().catch(() => {});
  return out;
}

// ---------- the race part: bots queueing for quick races, racing again while there's time ----------
async function racePart(o: any) {
  const { transport: base } = await import('./rt-bots.ts');
  const { createMpSession } = await import('../../mp/client.js');
  const { createRaceBot } = await import('../../mp/bot.js');
  const { courseOf } = await import('../src/rt/mp.ts');
  const { MP } = await import('../src/rt/mpData.ts');
  const { generateTrack } = await import('../../track/generate.js');
  const { buildTrack } = await import('../../track/build.js');
  const { trackHash } = await import('../../track/events/hash.js');
  const { createSmoothness } = await import('../../net/measure.js');
  const { NET } = await import('../../net/settings.js');
  const { C2S } = await import('../../net/protocol.js');
  const { REPO_DIR } = await import('../src/config.ts');
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, f), 'utf8'));
  const QCFG = read('data/quests.json'), TC = read('data/tracks.json');
  // (quicker round the corners than the NPCs: the races take a minute or two, not five — as server/tools/mp-race-test.ts)
  const FAST = { ...MP.npc, corneringG: 1.6, accelG: 0.8, brakeG: 1.2 };
  // a generated track, built here from its code as the game builds it (today's two built before anyone drives: building
  // one takes a moment, and the bots' frames shouldn't wait for it)
  const tracks = new Map<string, any>();
  const trackCourse = (code: string) => {
    if (!tracks.has(code)) {
      const gen = generateTrack({ code });
      if (!gen.ok) throw new Error(gen.error ?? `no track ${code}`);
      const data = buildTrack(gen, TC);
      tracks.set(code, courseOf({ course: data.course, frame: { kind: 'track' }, trackHash: trackHash(data) }));
    }
    return tracks.get(code);
  };
  try { const today: any = await (await fetch(`${o.api}/api/v1/tracks/today`)).json(); for (const k of ['daily', 'weekly']) if (today?.[k]?.code) trackCourse(today[k].code); } catch (e) { process.send?.({ note: `today's tracks not built ahead: ${e?.message ?? e}` }); }
  const t0 = Date.now(), until = t0 + o.seconds * 1000, hardStop = until + o.raceWait * 1000;
  const bots: any[] = [];
  for (const [k, n] of o.ids.entries()) {
    const tally = { conns: [], drops: [], closed: [] };
    const S: any = createMpSession({ transport: countingTransport(base, C2S, tally), getTicket: () => ticketFor(o, n), endpoint: o.rt ?? null, look: { carId: 'starter_car', paint: { colour: `hsl(${n * 47 % 360} 70% 50%)` }, bot: true } });
    const b: any = { n, S, tally, pings: [] as number[], races: new Map<string, any>(), meas: new Map(), queued: 0, matched: 0, err: null, notices: [] as string[] };
    // (the course: a route's comes with the race's 'load'; a track's is built from its code — before the bot hears of it)
    let course: any = null;
    S.on('load', (m: any) => {
      try { course = m.course ? courseOf({ course: m.course, frame: m.venue?.frame, trackHash: m.venue?.trackHash ?? null }) : m.venue?.venue?.kind === 'track' ? trackCourse(m.venue.venue.code) : null; }
      catch (e) { b.err = `course: ${e?.message ?? e}`; course = null; }
      b.races.set(m.raceId, { raceId: m.raceId, venue: m.venue?.name ?? null, loadedAt: Date.now(), results: null, confirmed: null });
    });
    createRaceBot({ session: S, courseFor: async () => { if (!course) throw new Error('no course'); return course; }, quests: QCFG, cfg: FAST, skill: 0.86 + (k % 8) * 0.015 });
    S.on('matched', () => { b.matched++; });
    S.on('results', (m: any) => { const r = b.races.get(m.raceId); if (r) { r.results = (m.results ?? []).find((x: any) => x.uid === S.myUid) ?? { status: 'listed' }; r.at = Date.now(); } });
    S.on('confirmed', (m: any) => { const r = b.races.get(m.race?.id); if (r) r.confirmed = true; });
    S.on('notice', (t: any) => { if (b.notices.length < 5) b.notices.push(String(t?.text ?? t)); });
    bots.push(b);
  }
  // (the other cars as this game draws them, while racing: the race's connection's sample, measured as it's taken)
  const watch = (b: any) => {
    const net = b.S.race?.net;
    if (!net || net === b.watched) return;
    b.watched = net;
    const sample = net.sample;
    net.sample = (dt: number) => {
      const list = sample.call(net, dt), here = new Set();
      if (b.S.phase === 'racing') for (const c of list) {
        if (!c.pose) continue;
        here.add(c.id);
        let m = b.meas.get(`${b.S.raceId}|${c.id}`); if (!m) b.meas.set(`${b.S.raceId}|${c.id}`, m = createSmoothness({ snapCm: NET.interp.snapCm }));
        // (the race bots drive mp/npc.js's line, whose states carry no spin: a car turning would count as turned too far
        // every frame of a bend — its position only, here)
        m.frame({ ...c.pose, rot: [0, 0, 0, 1], ang: [0, 0, 0] }, dt);
      }
      for (const [k, m] of b.meas) if (k.startsWith(`${b.S.raceId}|`) && !here.has(Number(k.split('|')[1]))) m.frame(null, dt);
      return list;
    };
  };
  const queueUp = async (b: any) => {
    try { await b.S.queue({ region: o.queueRegion, pings: { [o.queueRegion]: o.pingGuess } }); b.queued++; }
    catch (e) { b.err = `queue: ${e?.message ?? e}`; }
  };
  for (const b of bots) { await queueUp(b); await sleep(150); }
  process.send?.({ progress: { part: 'race', queued: bots.filter(b => b.queued).length, of: bots.length } });
  // each second: pings; a bot whose race is over goes back in the queue while there's time; done when time's up and no
  // race is under way (at most raceWait more)
  const racing = (b: any) => ['loading', 'countdown', 'racing'].includes(b.S.phase);
  while (Date.now() < hardStop) {
    await sleep(1000);
    for (const b of bots) {
      watch(b);
      const p = b.S.race?.net?.stats.ping;
      if (racing(b) && Number.isFinite(p) && p > 0) b.pings.push(p);
      const r = b.S.raceId && b.races.get(b.S.raceId);
      if (r?.results && Date.now() - r.at > 8000 && Date.now() < until - 20000) { await b.S.leaveRace(); await queueUp(b); }
    }
    if (Date.now() >= until && !bots.some(racing)) break;
  }
  // (what's still waiting in the queue goes; a race still under way at the hard stop counts as not finished)
  const out = bots.map(b => {
    const r = [...b.meas.values()].map(m => m.result());
    return { n: b.n, ok: b.queued > 0 && b.matched > 0, err: b.err, queued: b.queued, matched: b.matched, pings: b.pings, statesPerSec: sendRate(b.tally), drops: b.tally.drops, closed: b.tally.closed, notices: b.notices,
      races: [...b.races.values()].map(x => ({ raceId: x.raceId, venue: x.venue, status: x.results?.status ?? null, place: x.results?.place ?? null, confirmed: !!x.confirmed })),
      frames: r.reduce((a, x) => a + x.frames, 0), snaps: r.reduce((a, x) => a + x.snaps, 0), worstJumpCm: Math.max(0, ...r.map(x => x.worstJumpCm)), notes: r.flatMap(x => x.notes).slice(0, 3) };
  });
  for (const b of bots) await b.S.close().catch(() => {});
  return out;
}

if (PART) {
  const out = PART.part === 'roam' ? await roamPart(PART) : await racePart(PART);
  process.send?.({ results: out });
  setTimeout(() => process.exit(0), 3000).unref();
} else {
  // ---------- the test ----------
  const { REPO_DIR } = await import('../src/config.ts');
  const { NET } = await import('../../net/settings.js');
  const { MP } = await import('../src/rt/mpData.ts');
  const { regionsFor } = await import('../../mp/match.js');
  const api = String(arg('api', 'http://localhost:8787')).replace(/\/$/, ''), token = arg('token', process.env.LOADTEST_TOKEN ?? '');
  const rtArg = arg('rt', null), BOTS = Math.max(1, Math.min(200, Number(arg('bots', 20)))), SECONDS = Math.max(30, Number(arg('seconds', 120))), MODE = arg('mode', 'both');
  const REGION = arg('region', 'mk'), RACE_WAIT = Number(arg('race-wait', 420)), SNAPS = Number(arg('snaps', 50));
  if (!token) { console.error('The load-test token is needed: --token, or LOADTEST_TOKEN.'); process.exit(2); }
  if (!['both', 'roam', 'race'].includes(MODE)) { console.error('--mode is both, roam or race.'); process.exit(2); }
  const local = (u: string) => /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u);
  const near = local(api) && (!rtArg || local(rtArg));
  const P50 = Number(arg('ping-p50', near ? 120 : 350)), P95 = Number(arg('ping-p95', near ? 200 : 500));
  const lines: string[] = [], results: boolean[] = [];
  const say = (s = '') => { console.log(s); lines.push(s); };
  const check = (name: string, ok: boolean, detail = '') => { results.push(!!ok); say(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
  const getJson = async (u: string) => { const t = performance.now(); const r = await fetch(u, { headers: { 'cache-control': 'no-store' } }); const j: any = await r.json().catch(() => null); return { status: r.status, json: j, ms: performance.now() - t }; };

  // where things are: the environment (its race region), the real-time server's address, how far away it is
  const cc = await getJson(`${api}/api/v1/client-config`).catch(e => ({ status: 0, json: null, error: e.message }));
  if (cc.status !== 200) { console.error(`The API at ${api} didn't answer (${cc.status}${cc.error ? `: ${cc.error}` : ''}).`); process.exit(1); }
  const env = cc.json.env, queueRegion = regionsFor(MP.regions, env)[0].id;
  let rt = rtArg ? String(rtArg).replace(/\/$/, '') : null;
  if (!rt) { const r = await fetch(`${api}/api/v1/rt/ticket`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), 'x-kr-loadtest': token }, body: JSON.stringify({ bot: 1 }) }); const j: any = await r.json().catch(() => null); rt = j?.url ?? null; }
  if (!rt) { console.error('No real-time server address: --rt, or a ticket (is the token right? is RT_URL set on the API?).'); process.exit(1); }
  const health = rt.replace(/^ws/, 'http') + '/health';
  const firstPings: number[] = [];
  for (let i = 0; i < 5; i++) { const h = await getJson(health).catch(() => null); if (h?.status === 200) firstPings.push(h.ms); }
  const pingGuess = Math.round(pct(firstPings, 0.5) || 50);
  const roamN = MODE === 'race' ? 0 : MODE === 'roam' ? BOTS : Math.ceil(BOTS / 2), raceN = BOTS - roamN;
  say(`# Online bots: ${BOTS} for ${SECONDS} s (${roamN} in free roam on "${REGION}", ${raceN} in quick races in "${queueRegion}")`);
  say('');
  say(`${new Date().toISOString()} · API ${api} (${env}) · real-time server ${rt} · from here ${pingGuess} ms to its /health and back`);
  say('');

  // the two parts, in processes of their own; this one reads the servers' numbers every two seconds
  const self = fileURLToPath(import.meta.url), part = (name: string, ids: number[]) => new Promise<any[]>(res => {
    const kid = fork(self, [], { env: { ...process.env, ONLINE_BOTS_PART: JSON.stringify({ part: name, ids, api, rt: rtArg ? rt : null, token, seconds: SECONDS, raceWait: RACE_WAIT, region: REGION, queueRegion, pingGuess }) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let got: any[] = [];
    kid.on('message', (m: any) => { if (m?.results) got = m.results; else if (m?.progress) console.log(`  ${JSON.stringify(m.progress)}`); else if (m?.note) console.log(`  ${m.note}`); });
    kid.on('exit', () => res(got));
  });
  const samples: any[] = [];
  let polling = true;
  const poll = (async () => {
    while (polling) {
      const [h, s] = await Promise.all([getJson(health).catch(e => ({ status: 0, json: null, error: e.message })), getJson(`${api}/api/v1/status`).catch(e => ({ status: 0, json: null, error: e.message }))]);
      samples.push({ at: Date.now(), h: h.json, hStatus: h.status, s: s.json, sStatus: s.status });
      await sleep(2000);
    }
  })();
  const ids = Array.from({ length: BOTS }, (_, i) => i + 1);
  const [roam, race] = await Promise.all([roamN ? part('roam', ids.slice(0, roamN)) : [], raceN ? part('race', ids.slice(roamN)) : []]);
  polling = false; await poll;
  const all = [...roam, ...race];

  // ---------- the checks ----------
  say('## Checks');
  say('');
  const failedJoin = [...roam.filter(b => !b.ok), ...race.filter(b => !b.ok)];
  check(`all ${BOTS} bots joined (free roam placed; the queue joined and a race seated)`, all.length === BOTS && !failedJoin.length,
    `${roam.filter(b => b.ok).length}/${roamN} in free roam${roam.length ? ` (p95 ${Math.round(pct(roam.filter(b => b.joinMs != null).map(b => b.joinMs), 0.95) || 0)} ms to join)` : ''}, ${race.filter(b => b.ok).length}/${raceN} raced${failedJoin.length ? `; ${failedJoin.slice(0, 3).map(b => `bot ${b.n}: ${b.err ?? 'not matched'}`).join('; ')}` : ''}`);
  const drops = all.flatMap(b => b.drops.map((d: any) => ({ n: b.n, ...d }))), closed = all.flatMap(b => b.closed.map((d: any) => ({ n: b.n, ...d }))), lost = roam.reduce((a, b) => a + (b.lost ?? 0), 0);
  // (--crash: the real-time server is killed during the run (.github/workflows/crash-live.yml) — the drops are the point;
  // what counts is that it comes back by itself and the bots with it, the API all the while)
  const CRASH = args.includes('--crash');
  if (CRASH) {
    const procs = samples.filter(x => x.h?.process), first = procs[0]?.h.process, after = procs.find(x => x.h.process !== first);
    const before = Math.max(0, ...samples.filter(x => !after || x.at < after.at).map(x => x.h?.players ?? 0));
    const gap = samples.filter(x => x.hStatus !== 200 || !x.h?.ok);
    check('the real-time server killed mid-run came back by itself (a new process)', !!after && gap.length > 0, after ? `down for about ${gap.length * 2} s; process ${first} → ${after.h.process}` : `still ${first ?? '?'}: it was never killed, or never came back`);
    const back = after && samples.find(x => x.at >= after.at && (x.h?.players ?? 0) >= Math.ceil(before * 0.9));
    check('the bots back on it by themselves: at least 90% of its players within 90 s', !!back && back.at - after.at <= 90000, back ? `${back.h.players} players (${before} before) ${Math.round((back.at - after.at) / 1000)} s after it was back` : `at most ${Math.max(0, ...samples.filter(x => after && x.at >= after.at).map(x => x.h?.players ?? 0))} players after (${before} before)`);
    const sDown = samples.filter(x => x.sStatus !== 200 || !x.s?.ok);
    check('the API ok all along (the real-time server down only meanwhile)', samples.length > 0 && !sDown.length, `${samples.length} readings, ${sDown.length} not ok`);
  }
  if (!CRASH) check('no unexpected disconnects (dropped, closed by the server, a zone lost)', !drops.length && !closed.length && !lost, `${drops.length} dropped, ${closed.length} closed, ${lost} zone connections lost${[...drops, ...closed].length ? `: ${[...drops, ...closed].slice(0, 4).map(d => `bot ${d.n} ${d.room} ${d.code}${d.reason ? ` ${d.reason}` : ''}`).join('; ')}` : ''}`);
  const pings = all.flatMap(b => b.pings), p50 = pct(pings, 0.5), p95 = pct(pings, 0.95);
  check(`ping p50 ≤ ${P50} ms, p95 ≤ ${P95} ms (${near ? 'this computer' : 'from afar: the targets allow for the distance'})`, pings.length > 0 && p50 <= P50 && p95 <= P95, pings.length ? `p50 ${Math.round(p50)} ms, p95 ${Math.round(p95)} ms (${pings.length} samples; ${pingGuess} ms to /health before the start)` : 'no samples');
  const minRate = NET.sendHz * 0.8, rates = all.filter(b => b.statesPerSec > 0).map(b => b.statesPerSec), slow = all.filter(b => b.ok && b.statesPerSec < minRate);
  check(`each bot's car states sent while driving: at least ${minRate} a second (NET.sendHz ${NET.sendHz})`, rates.length > 0 && !slow.length, `${rates.length} bots: lowest ${Math.min(...rates)}, median ${pct(rates, 0.5)} a second${slow.length ? `; slow: ${slow.slice(0, 5).map(b => `bot ${b.n} ${b.statesPerSec}`).join(', ')}` : ''}`);
  const frames = all.reduce((a, b) => a + b.frames, 0), snaps = all.reduce((a, b) => a + b.snaps, 0), per = frames ? snaps / frames * 1e5 : NaN;
  const rf = roam.reduce((a, b) => a + b.frames, 0), rs = roam.reduce((a, b) => a + b.snaps, 0), cf = race.reduce((a, b) => a + b.frames, 0), cs = race.reduce((a, b) => a + b.snaps, 0);
  check(`the other cars as drawn: at most ${SNAPS} snaps per 100,000 car-frames (net/measure.js)`, frames > 0 && per <= SNAPS, frames ? `${snaps} in ${frames} car-frames: ${per.toFixed(1)} per 100,000 (free roam ${rs} in ${rf}, races ${cs} in ${cf}); worst jump ${Math.max(0, ...all.map(b => b.worstJumpCm))} cm` : 'no car-frames: nobody saw anyone');
  const hs = samples.filter(x => x.h), down = samples.filter(x => x.hStatus !== 200 || !x.h?.ok), peak = Math.max(0, ...hs.map(x => x.h.players ?? 0)), rooms = Math.max(0, ...hs.map(x => x.h.rooms ?? 0)), racesUnder = Math.max(0, ...hs.map(x => x.h.races ?? 0));
  if (!CRASH) check(`the real-time server's /health: up all along, its players at least the bots (${BOTS}), not draining`, samples.length > 0 && !down.length && peak >= BOTS && !hs.some(x => x.h.draining),
    `${samples.length} readings, ${down.length} not ok; at most ${peak} players (connections: free roam holds 2–4 a bot), ${rooms} rooms, ${racesUnder} races under way; version ${hs.at(-1)?.h.version ?? '?'}`);
  const sBad = samples.filter(x => x.sStatus !== 200 || !x.s?.ok || (x.s?.rt != null && x.s.rt !== 'up'));
  if (!CRASH) check('the API\'s /api/v1/status: ok all along (and the real-time server "up" where it says)', samples.length > 0 && !sBad.length, `${samples.length} readings, ${sBad.length} not ok${sBad.length ? ` (${JSON.stringify(sBad[0].s ?? sBad[0].sStatus).slice(0, 120)})` : ''}; rt ${samples.at(-1)?.s?.rt ?? 'not reported'}`);
  if (raceN && !CRASH) {
    const byRace = new Map<string, any[]>();
    for (const b of race) for (const r of b.races) { if (!byRace.has(r.raceId)) byRace.set(r.raceId, []); byRace.get(r.raceId)!.push({ n: b.n, ...r }); }
    const done = [...byRace.values()].filter(rs => rs.every(r => r.status)), confirmed = [...byRace.values()].filter(rs => rs.some(r => r.confirmed)).length;
    check('races finished with results (every race a bot loaded)', byRace.size > 0 && done.length === byRace.size,
      `${done.length} of ${byRace.size} races with results; ${confirmed} confirmed by the API before the end${[...byRace.values()].slice(0, 4).map(rs => ` · ${rs[0].venue ?? '?'}: ${rs.map(r => `bot ${r.n} ${r.status ?? 'none'}${r.place ? ` P${r.place}` : ''}`).join(', ')}`).join('')}`);
  }
  const passed = results.filter(Boolean).length;
  say('');
  say(`${passed} of ${results.length} checks passed.`);
  const notes = all.flatMap(b => b.notices ?? []).slice(0, 5);
  if (notes.length) { say(''); say(`Notices the bots were given: ${notes.join(' | ')}`); }
  const report = arg('report', null);
  if (report) { fs.mkdirSync(path.dirname(path.resolve(REPO_DIR, report)), { recursive: true }); fs.writeFileSync(path.resolve(REPO_DIR, report), lines.join('\n') + '\n'); fs.writeFileSync(path.resolve(REPO_DIR, report).replace(/\.md$/, '') + '.json', JSON.stringify({ roam, race, samples }, null, 2)); }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  process.exit(passed === results.length ? 0 : 1);
}
