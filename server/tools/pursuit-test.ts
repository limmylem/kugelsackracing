// @ts-nocheck — (bots and the browser-side modules: not this program's types)
// Co-op police pursuits end to end (docs/PURSUIT.md "Co-op"): the API and the real-time server in this process (no
// Redis), a party of bots (mp/bot.js: real accounts, tickets and protocol, driving the route as racers do), and a
// stand-in for the host's game: it carries out the room's police orders as a game would — answers each unit asked for,
// sends the police cars' states (kept a little behind the players), and says which can see whom. Writes
// reports/pursuit.md.
//
//   A. a convoy: the leader starts it from the party; everyone's taken into the room; the countdown and GO; the room's
//      first police car parked behind the grid (u0), more asked for; the heat rises while they're seen; out of sight the
//      cooldown and its search area; out of it, escaped — the room's end, and each player paid by the API (once)
//   B. the host leaves mid-pursuit: the police pass to another player (pursuit-host, with the units to take over)
//
//   node server/tools/pursuit-test.ts [--only A,B]     (TEST_DATABASE_URL)

import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';
import { verifyTicket } from '../src/rt/tickets.ts';
import { courseOf } from '../src/rt/mp.ts';
import { PursuitRoom } from '../src/rt/pursuit.ts';
import { seedMpRoutes } from './seed-mp-routes.ts';
import { createMpSession } from '../../mp/client.js';
import { createRaceBot } from '../../mp/bot.js';
import { newItem } from '../../content/quests.js';
import { transport } from './rt-bots.ts';

const args = process.argv.slice(2), only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
const PORT = 8794, RT_PORT = 2794, SECRET = 'pursuit-test-secret-pursuit-test-0123456789';
const MP = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/multiplayer.json'), 'utf8'));
const QCFG = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/quests.json'), 'utf8'));
const PCFG = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/pursuit.json'), 'utf8'));
const FAST = { ...MP.npc, corneringG: 1.6, accelG: 0.8, brakeG: 1.2 };
const lines: string[] = [], results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); const l = `${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`; console.log(l); lines.push(l); };
const section = (s: string) => { console.log(`\n== ${s}`); lines.push('', `## ${s}`, ''); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => any, ms: number, every = 250) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(every)) { const v = await f(); if (v) return v; } return null; };

const database = await freshDatabase('pursuit');
const app: any = await buildApp({ config: testConfig(database.url, { serveClient: false, logLevel: 'warn' }, { PUBLIC_URL: 'http://localhost:8787', RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET }) });
await app.listen({ port: PORT, host: '127.0.0.1' });
await seedMpRoutes(app.content, { regions: ['sf'] });
// the co-op pursuit: on San Francisco's route, a convoy that gets away
const author = { id: null, name: 'Kugelsack Racing' };
async function quest(id: string, params: any) {
  const route = (await app.content.get('route_mpsf', 'published')).item;
  const q = { ...newItem('quest', { id, location: route.location, type: 'pursuit_coop', name: `Pursuit test ${id}`, author: author.name }), route: 'route_mpsf' };
  q.params = { ...q.params, ...params };
  await app.content.create(q, author);
  const p = await app.content.publish(id, author);
  if (!p.ok) throw new Error(`publish: ${JSON.stringify(p.problems ?? p.error)}`);
  return id;
}
const rtSaid: string[] = [];
const rt = await startRt({ port: RT_PORT, secret: SECRET, redisUrl: null, rt: { allowGuests: true, maxPlayers: 500, roomMaxClients: 64, netsim: true }, api: { url: `http://localhost:${PORT}` }, log: (m, e) => { rtSaid.push(`${m} ${JSON.stringify(e ?? {})}`); } });
const courses = new Map();
const courseFor = async v => { const k = JSON.stringify(v.venue); if (!courses.has(k)) courses.set(k, courseOf(await app.mp.venue(v.venue))); return courses.get(k); };

let made = 0;
async function people(n: number, tag: string) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = ++made, p = await signUp(app, app.deps.mailer.outbox, { email: `${tag}${k}@example.com`, name: `${tag.toUpperCase()} Driver ${k}`, ip: `10.70.${k & 255}.1` });
    const ticket = async () => { const r = await p.post('/api/v1/rt/ticket', {}); if (r.status !== 200) throw new Error(r.text); return r.body; };
    const uid = verifyTicket(SECRET, (await ticket()).ticket).uid;
    const session = createMpSession({ transport, getTicket: ticket });
    // (the hub's goto: into the room, as the screens do — play/mpScreens.js)
    session.on('goto', m => { void session.joinLobby(m.roomId); });
    out.push({ p, uid, session, name: `${tag.toUpperCase()} Driver ${k}` });
  }
  return out;
}
const pursuitOf = () => [...PursuitRoom.pursuits].at(-1);

// the stand-in for the host's game: units answered for and driven (kept behind their players, as police chasing would
// be), their states and who can see whom sent back — `seen` says whether the police can see anyone just now
function standInHost(people, { seen = () => true, gap = 35 } = {}) {
  const units = new Map(), byUid = new Map(people.map(x => [x.uid, x]));
  let stopped = false;
  const offs = people.map(x => x.session.on('pursuit-cmd', m => {
    for (const s of m.spawn ?? []) units.set(s.id, { id: s.id, target: s.target, added: false });
    for (const r of m.roadblock ?? []) for (const id of r.ids) units.set(id, { id, target: r.target, added: false });
    for (const id of m.remove ?? []) units.delete(id);
  }));
  const tick = setInterval(() => {
    if (stopped) return;
    const P = pursuitOf();
    if (!P?.P) return;
    const host = people.find(x => x.uid === P.P.host);
    // where each player is: the room's own relayed states (what a host's game sees of its teammates)
    const where = uid => { const pl = [...P.players.values()].find(p => p.t.uid === uid); return pl?.latestF ?? null; };
    if (host) {
      const list = [], added = [];
      for (const u of units.values()) {
        if (!u.added) { u.added = true; added.push({ id: u.id, ok: true, carId: 'strada_evo' }); }
        const f = where(u.target ?? host.uid) ?? where(host.uid);
        if (!f) continue;
        const v = f.vel ?? [0, 0, 0], sp = Math.hypot(v[0], v[2]) || 1;
        list.push({ id: u.id, pos: [f.pos[0] - v[0] / sp * gap, f.pos[1], f.pos[2] - v[2] / sp * gap], rot: [0, 0, 0, 1], vel: v, ang: [0, 0, 0], drivable: true });
      }
      host.session.send({ t: 'police', units: list, added, hits: [] });
    }
    for (const x of people) if (x.session.race) x.session.send({ t: 'police-seen', units: seen() ? [...units.keys()] : [] });
  }, 100);
  return { units, stop() { stopped = true; clearInterval(tick); offs.forEach(f => f()); } };
}

try {
  // ---------- A ----------
  if (!only || only.has('A')) {
    section('A. A convoy: started from the party, chased, lost, escaped, paid');
    const qid = await quest('quest_pursuitconvoy', { kind: 'convoy', objective: 'escape', startHeat: 2, maxHeat: 3, busted: 'respawn', rewards: 'shared' });
    const A = await people(3, 'pa');
    const bots = A.map((x, i) => createRaceBot({ session: x.session, courseFor, quests: QCFG, cfg: FAST, skill: 0.85 + i * 0.03 }));
    for (const x of A) await x.session.hub('test');
    await sleep(2000);
    // the party: the first makes it, the others join it
    A[0].session.hubSend({ t: 'party-create' });
    const party = await until(() => A[0].session.party, 5000);
    for (const x of A.slice(1)) x.session.hubSend({ t: 'party-join', partyId: party.id });
    await until(() => A[0].session.party?.members.length === 3, 5000);
    await sleep(800);
    // the leader starts it: everyone into the pursuit's room
    let seeing = true;
    const H = standInHost(A, { seen: () => seeing });
    A[0].session.hubSend({ t: 'party-pursuit', questId: qid });
    const inRoom = await until(() => A.every(x => x.session.race) && new Set(A.map(x => x.session.race.id)).size === 1, 30000);
    check('the leader starts it: the whole party in one pursuit room', !!inRoom, inRoom ? A[0].session.race.id : 'not all in');
    const R = pursuitOf();
    check('the room is the quest\'s: its route, the co-op pursuit with the load', !!R && R.quest?.id === qid && !!R.course, R?.venueError ?? '');
    const started = await until(() => R?.P?.running, 90000);
    check('GO on the server\'s clock: the pursuit under way, a host chosen (the leader)', !!started && R.P.host === A[0].uid, `host ${R?.P?.host === A[0].uid ? 'the leader' : R?.P?.host}`);
    check('the first police car was asked for at the countdown (u0, behind the grid)', R.P.units.has('u0'), [...R.P.units.keys()].join(', '));
    const seen = await until(() => A.every(x => x.session.pursuit?.status?.players?.find(p => p.id === x.uid)?.seen != null) && A[0].session.pursuit, 10000);
    check('everyone hears the room\'s pursuit state, 10 times a second', !!seen, `phase ${A[0].session.pursuit?.status?.phase}`);
    await sleep(15000);
    const st = A[0].session.pursuit.status;
    check('the heat rises while they can see you; more units asked for', st.heat > 2 && R.P.units.size >= 2, `heat ${st.heat.toFixed(2)}, ${R.P.units.size} units`);
    check('the police cars go to everyone as cars (virtual cars in the roster)', A[1].session.race?.net && [...A[1].session.race.net.players.values()].some(p => p.uid?.startsWith?.('police:')), [...(A[1].session.race?.net.players.values() ?? [])].map(p => p.uid).filter(Boolean).join(', '));
    // out of sight: the cooldown, its search area; driving on, out of it — escaped
    seeing = false;
    const cool = await until(() => A[0].session.pursuit?.status?.phase === 'cooldown' && A[0].session.pursuit.status.cooldown, 10000);
    check('out of sight: the cooldown and its search area', !!cool, cool ? `${cool.radius} m, ${cool.left.toFixed(1)} s` : A[0].session.pursuit?.status?.phase);
    const done = await until(() => A[0].session.pursuitDone, 90000);
    check('out of the search area: escaped — the room ends it, finished', done?.status === 'finished' && /escaped/.test(done.reason), done ? `${done.status}: ${done.reason}; scores ${JSON.stringify(done.scores)}` : 'not over');
    const paid = await until(() => A[0].session.pursuitPaid, 15000);
    const rows = (await app.deps.db.execute(sql`select user_id, amount, ref from ledger where kind = 'reward' and ref->>'reward' like 'pursuit:%'`)).rows;
    check('paid by the API, after its own check: each of the party once, the same share (shared)', !!paid && rows.length === 3 && new Set(rows.map(r => Number(r.amount))).size === 1 && rows.every(r => Number(r.amount) > 0), `${rows.length} payments of ${rows.map(r => r.amount).join(', ')}`);
    // (asked again — the outbox retrying — nothing more paid)
    const again = await app.mp.recordPursuit({ id: `${R.P.runId}`, questId: qid, startedAt: 0, endedAt: 60000, status: 'finished', heatMax: 3, seconds: 60, disabled: 0, players: A.map(x => ({ uid: x.uid, score: 1000, share: 1 })) });
    const rows2 = (await app.deps.db.execute(sql`select 1 from ledger where kind = 'reward' and ref->>'reward' like 'pursuit:%'`)).rows;
    check('the same run handed in again pays nothing more', rows2.length === 3 && Object.values(again.pay).every(p => !p.paid));
    // (a padded score is held to what the run allows)
    const most = (await app.mp.recordPursuit({ id: 'padded', questId: qid, startedAt: 0, endedAt: 10000, status: 'finished', heatMax: 9, seconds: 9999, disabled: 0, players: [{ uid: A[0].uid, score: 1e9, share: 1 }] })).pay[A[0].uid];
    // (10 s at heat 3 at the most — the quest's most heat — an escape and the drop: 10 × 3 × 12 + 400 × 3 + 600)
    check('a padded score is held to what the run\'s length and heat allow', most.score <= 2160, `score held to ${most.score}`);
    H.stop(); bots.forEach(b => b.stop?.());
    for (const x of A) await x.session.close();
  }
  // ---------- B ----------
  if (!only || only.has('B')) {
    section('B. The host leaves: the police pass to another player');
    const qid = await quest('quest_pursuithost', { kind: 'convoy', objective: 'escape', startHeat: 1, maxHeat: 2 });
    const B = await people(2, 'pb');
    const bots = B.map((x, i) => createRaceBot({ session: x.session, courseFor, quests: QCFG, cfg: FAST, skill: 0.88, behave: i === 0 ? { leaveAtSec: 6 } : {} }));
    for (const x of B) await x.session.hub('test');
    await sleep(2000);
    B[0].session.hubSend({ t: 'party-create' });
    const party = await until(() => B[0].session.party, 5000);
    B[1].session.hubSend({ t: 'party-join', partyId: party.id });
    await sleep(800);
    const H = standInHost(B);
    let handed = null;
    B[1].session.on('pursuit-host', m => { if (m.uid === B[1].uid) handed = m; });
    B[0].session.hubSend({ t: 'party-pursuit', questId: qid });
    const R = await until(() => { const P = pursuitOf(); return P?.questId === qid && P.P?.running ? P : null; }, 90000);
    check('under way, the leader the host', !!R && R.P.host === B[0].uid);
    const moved = await until(() => R?.P?.host === B[1].uid && handed, 30000);
    check('the leader leaves: the other player is the host, told the units to take over', !!moved, moved ? `${moved.units.length} unit(s) handed over` : `host ${R?.P?.host}`);
    H.stop(); bots.forEach(b => b.stop?.());
    for (const x of B) await x.session.close();
  }
} catch (e) { check('ran without throwing', false, e?.stack ?? String(e)); }
finally {
  const ok = results.every(Boolean);
  fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(REPO_DIR, 'reports/pursuit.md'), `# Co-op pursuits end to end\n\n${new Date().toISOString()}\n${lines.join('\n')}\n\n${results.filter(Boolean).length} of ${results.length} passed\n`);
  console.log(`\n${results.filter(Boolean).length} of ${results.length} passed`);
  if (!ok) console.log(rtSaid.filter(s => /pursuit|fail/.test(s)).slice(-20).join('\n'));
  await rt.stop?.().catch?.(() => {});
  await app.close();
  await database.drop?.();
  process.exit(ok ? 0 : 1);
}
