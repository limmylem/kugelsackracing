// @ts-nocheck — (bots and the browser-side modules: not this program's types)
// Multiplayer races end to end with bots (Phase 7 Step 2's tests; docs/MULTIPLAYER.md "Tests"): the API and the
// real-time server in this process — ONE real-time process and no Redis (everything must work that way) — and bot
// players (mp/bot.js: real accounts, real join tickets, the real protocol, QuestSession-timed runs handed in and
// checked). Writes reports/mp-races.md.
//
//   A. a quick race: 8 bots matched from the queue onto a real-world route (Milton Keynes); ranked. The countdown's
//      sync (every bot's lights out within a few ms of the server's, through a simulated 60 ms ± 10 ms network);
//      one bot's connection drops on the final lap and comes back; one hands in a run that fails the check — it's
//      disqualified, the others move up, pay and ratings follow
//   B. a quick race on a generated track (today's): 8 bots; one built the track differently (its hash) and watches
//   C. a party of two queues together and lands in the same race; a lone player takes the NPC offer and races NPCs
//   D. disconnects: in the lobby (back by itself), at the countdown (back, and races), mid-race for good (out after
//      the grace), the host leaving (the host passes on), everyone but one leaving (the last one finishes alone)
//   E. chat: the filter, a block, a mute; the host kicks a player, who can't come back in
//   F. a spectator watches a race: the standings and the cars
//
//   node server/tools/mp-race-test.ts [--only A,B]     (TEST_DATABASE_URL; no Redis needed)

import fs from 'node:fs';
import path from 'node:path';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';
import { verifyTicket } from '../src/rt/tickets.ts';
import { courseOf } from '../src/rt/mp.ts';
import { seedMpRoutes } from './seed-mp-routes.ts';
import { createMpSession } from '../../mp/client.js';
import { createRaceBot } from '../../mp/bot.js';
import { percentile } from '../../mp/match.js';
import { transport } from './rt-bots.ts';

const args = process.argv.slice(2), only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
const PORT = 8792, RT_PORT = 2792, SECRET = 'mp-race-test-secret-mp-race-test-0123456789';
const MP = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/multiplayer.json'), 'utf8'));
const QCFG = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/quests.json'), 'utf8'));
const FAST = { ...MP.npc, corneringG: 1.6, accelG: 0.8, brakeG: 1.2 };
const lines: string[] = [], results: boolean[] = [], json: any = { at: new Date().toISOString(), redis: false };
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); const l = `${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`; console.log(l); lines.push(l); };
const section = (s: string) => { console.log(`\n== ${s}`); lines.push('', `## ${s}`, ''); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => any, ms: number, every = 250) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(every)) { const v = await f(); if (v) return v; } return null; };

const database = await freshDatabase('mprace');
const app: any = await buildApp({ config: testConfig(database.url, { serveClient: false, logLevel: 'warn' }, { PUBLIC_URL: 'http://localhost:8787', RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET }) });
await app.listen({ port: PORT, host: '127.0.0.1' });
await seedMpRoutes(app.content, { regions: ['mk', 'sf'] });
const today = await app.tracks.today();
const rtLog: string[] = [];
const rt = await startRt({
  port: RT_PORT, secret: SECRET, redisUrl: null, rt: { allowGuests: true, maxPlayers: 5000, roomMaxClients: 64, netsim: true }, api: { url: `http://localhost:${PORT}` },
  quickVenue: { mk: { kind: 'route', id: 'route_mpmk' }, track: { kind: 'track', code: today.daily.code }, party: { kind: 'route', id: 'route_mpsf' } },
  log: (m, e) => { if (/fail/.test(m)) rtLog.push(`${m} ${JSON.stringify(e)}`); },
});
const courses = new Map();
const courseFor = async v => { const k = JSON.stringify(v.venue); if (!courses.has(k)) courses.set(k, courseOf(await app.mp.venue(v.venue))); return courses.get(k); };

let made = 0;
async function people(n: number, tag: string, { netsim = null } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = ++made, p = await signUp(app, app.deps.mailer.outbox, { email: `${tag}${k}@example.com`, name: `${tag.toUpperCase()} Racer ${k}`, ip: `10.${30 + (k >> 8)}.${k & 255}.1` });
    const ticket = async () => { const r = await p.post('/api/v1/rt/ticket', {}); if (r.status !== 200) throw new Error(r.text); return r.body; };
    const uid = verifyTicket(SECRET, (await ticket()).ticket).uid;
    // (the real-time server's address from each ticket, as in the browser — not given here)
    const session = createMpSession({ transport, getTicket: ticket, netsim });
    out.push({ p, uid, session, name: `${tag.toUpperCase()} Racer ${k}` });
  }
  return out;
}
const botFor = (x, i, behave = {}) => createRaceBot({ session: x.session, courseFor, quests: QCFG, cfg: FAST, skill: 0.86 + (i % 8) * 0.015, behave });
const raceOf = roomId => rt.races().find(r => r.roomId === roomId);
const finishAll = async (sessions, ms) => until(() => sessions.every(s => s.confirmed), ms, 500);

try {
  // ---------- A ----------
  if (!only || only.has('A')) {
    section('A. A quick race: 8 bots matched onto a real-world route');
    const A = await people(8, 'a', { netsim: { latencyMs: 60, jitterMs: 10, loss: 0 } });
    const bots = A.map((x, i) => botFor(x, i, i === 7 ? { cutCheckpoint: 2 } : i === 5 ? { drop: { atSec: 70 } } : {}));
    const t0 = Date.now();
    await Promise.all(A.map(x => x.session.queue({ region: 'mk', pings: { mk: 40 } })));
    const matched = await until(() => A.every(x => x.session.race) && A.map(x => x.session.race.id), 30000);
    const rooms = new Set(matched ?? []);
    check('the queue: all 8 matched into one race', !!matched && rooms.size === 1, matched ? `in ${((Date.now() - t0) / 1000).toFixed(1)} s` : 'not matched');
    const roomId = [...rooms][0], R = raceOf(roomId);
    await until(() => R?.race.phase === 'racing', 90000);
    const gridLine = A[0].session.lobby?.players.filter(p => p.role === 'racer').sort((a, b) => a.slot - b.slot).map(p => p.name).join(', ');
    check('the race starts with everyone loaded, on the grid by rating', R?.race.phase === 'racing' && A[0].session.lobby?.players.filter(p => p.role === 'racer').every(p => p.slot != null), gridLine);
    // the countdown's sync: each bot's lights out (its own clock's guess at the server's time) against the server's
    await until(() => bots.every(b => b.goWall), 15000);
    const serverGo = R.epoch + R.race.goAt, diffs = bots.map(b => b.goWall - serverGo);
    const spread = Math.max(...diffs) - Math.min(...diffs);
    json.countdown = { diffsMs: diffs.map(d => +d.toFixed(2)), spreadMs: +spread.toFixed(2) };
    check('the countdown: every player\'s lights go out within a few ms of the server\'s (60 ms ± 10 ms network)', diffs.every(d => Math.abs(d) < 8) && spread < 8, `spread ${spread.toFixed(1)} ms; each ${diffs.map(d => d.toFixed(1)).join(', ')} ms`);
    // live positions as it goes
    const mid = await until(() => { const s = A[0].session.standings; return s && s.list.every(x => x.u > 500) ? s : null; }, 120000);
    const ordered = mid?.list.filter(x => x.status === 'racing').every((x, i, l) => i === 0 || x.u <= l[i - 1].u);
    check('live positions: from each car\'s progress, the leader first, gaps given', !!mid && ordered && mid.list.slice(1).some(x => x.gapMs != null), mid ? mid.list.map(x => `${x.place}. ${x.name.split(' ').pop()} ${x.u} m${x.gapMs != null ? ` +${(x.gapMs / 1000).toFixed(1)}` : ''}`).join(' · ') : 'none');
    await finishAll(A.map(x => x.session), 420000);
    const prov = A[0].session.results?.results ?? [], conf = A[0].session.confirmed?.confirmed ?? [];
    const by = Object.fromEntries(conf.map(r => [r.uid, r])), cheat = by[A[7].uid], dropper = by[A[5].uid];
    check('a drop on the final lap: back by itself, and finishes', dropper?.status === 'finished' && bots[5].log.some(l => /dropping/.test(l)), `${dropper?.status} P${dropper?.place}`);
    check('provisional results straight after; confirmed once the runs are checked', prov.length === 8 && conf.length === 8, `${prov.filter(r => r.status === 'finished').length} finished provisionally`);
    const before = prov.find(r => r.uid === A[7].uid);
    const movedUp = conf.filter(r => r.status === 'finished' && r.provisionalPlace > r.place);
    check('a run that fails the check: disqualified, and the others move up', cheat?.status === 'dsq' && (before.place === 8 || movedUp.length > 0), `the cheat: provisional P${before?.place} → ${cheat?.status} (${cheat?.problems?.[0]}); moved up: ${movedUp.length}`);
    check('pay by place, through the server', conf.filter(r => r.status === 'finished').every(r => r.pay?.money > 0 && r.pay?.paid) && cheat?.pay?.money === 0, conf.filter(r => r.status === 'finished').map(r => `P${r.place} ${r.pay?.money}`).join(', '));
    const rated = await Promise.all(A.map(x => app.mp.ratingOf(x.uid)));
    const win = conf.find(r => r.place === 1);
    check('ratings move (a ranked race): the winner up, the disqualified down', rated.every(r => r.races === 1) && rated[A.findIndex(x => x.uid === win.uid)].mu > 25 && rated[7].mu < 25, `winner mu ${rated[A.findIndex(x => x.uid === win.uid)].mu.toFixed(2)}, cheat mu ${rated[7].mu.toFixed(2)}`);
    check('rank changes shown after confirming', conf.every(r => r.rank?.ranked && r.rank.after), `${conf[0].rank?.before?.name} → ${conf[0].rank?.after?.name}`);
    json.A = { spread, prov: prov.map(r => [r.place, r.status, Math.round(r.timeMs)]), conf: conf.map(r => [r.place, r.status, r.pay?.money]) };
    // the podium and rematch: a majority voting yes takes them back to the lobby
    for (const x of A.slice(0, 5)) x.session.send({ t: 'rematch', v: true });
    const back = await until(() => R.race.phase === 'lobby', 10000);
    check('rematch: more than half vote yes and they\'re back in the lobby, together', !!back, R.race.phase);
    await Promise.all(A.map(x => x.session.close()));
  }

  // ---------- B ----------
  if (!only || only.has('B')) {
    section('B. A quick race on a generated track (today\'s)');
    const B = await people(8, 'b');
    const bots = B.map((x, i) => botFor(x, i, i === 3 ? { hash: 'not-the-hash' } : {}));
    await Promise.all(B.map(x => x.session.queue({ region: 'track', pings: { track: 30 } })));
    await until(() => B.every(x => x.session.race), 30000);
    const R = raceOf(B[0].session.race.id);
    await until(() => R?.race.phase === 'racing', 120000);
    const watcher = R.race.players.get(B[3].uid);
    check('loading: generated tracks are checked by their hash; a player whose track differs watches instead', watcher?.role === 'spectator' && [...R.race.players.values()].filter(p => p.role === 'racer').length === 7, `${B[3].name}: ${watcher?.role}`);
    await finishAll(B.filter((_, i) => i !== 3).map(x => x.session), 600000);
    const conf = B[0].session.confirmed?.confirmed ?? [];
    check('the race on a generated track, to confirmed results', conf.length === 7 && conf.every(r => r.status === 'finished' && r.verified), conf.map(r => `P${r.place} ${(r.timeMs / 1000).toFixed(1)} s`).join(', '));
    await Promise.all(B.map(x => x.session.close()));
  }

  // ---------- C ----------
  if (!only || only.has('C')) {
    section('C. A party queues together; a lone player takes NPCs');
    const C = await people(5, 'c');
    // (two friends: a party in the hub; its leader queues, the other is told to)
    await C[0].p.post('/api/v1/friends', { name: C[1].name });
    await C[1].p.post(`/api/v1/friends/${C[0].uid}/accept`, {});
    await Promise.all(C.slice(0, 2).map(x => x.session.hub()));
    C[0].session.hubSend({ t: 'party-create' });
    const party = await until(() => C[0].session.party, 5000);
    C[0].session.hubSend({ t: 'party-invite', to: C[1].uid });
    const inv = await new Promise(r => { const off = C[1].session.on('party-invite', m => { off(); r(m); }); setTimeout(() => r(null), 5000); });
    C[1].session.hubSend({ t: 'party-join', partyId: inv?.partyId });
    await until(() => C[0].session.party?.members.length === 2, 5000);
    for (const x of C.slice(0, 2)) x.session.on('party-queue', m => void x.session.queue({ region: 'party', pings: { party: 30 }, party: m.partyId }));
    C[0].session.hubSend({ t: 'party-queue' });
    // (three others queue too; the party lands with them)
    await sleep(500);
    await Promise.all(C.slice(2, 4).map(x => x.session.queue({ region: 'party', pings: { party: 30 } })));
    const together = await until(() => C[0].session.race && C[1].session.race && C[0].session.race.id === C[1].session.race.id && C[0].session.race.id, (MP.queue.fillAfterSec + 10) * 1000);
    check('a party: friends queue together and land in the same race', !!together && !!party, together ? `room ${together}, with ${C.slice(2, 4).filter(x => x.session.race?.id === together).length} others` : 'not together');
    for (const x of C.slice(0, 4)) await x.session.leaveRace();
    // the lone one: offered NPCs after a wait, says yes, races them
    const solo = C[4];
    const offered = new Promise(r => { solo.session.on('npc-offer', m => r(m)); });
    await solo.session.queue({ region: 'solo', pings: { solo: 20 } });
    const offer = await Promise.race([offered, sleep((MP.queue.npcOfferSec + 10) * 1000).then(() => null)]);
    check('a slow queue: the empty slots offered to NPCs after the wait', !!offer, offer ? `after ${offer.waitedSec} s` : 'no offer');
    solo.session.acceptNpcs(true);
    const bot = botFor(solo, 2);
    await until(() => solo.session.race, 10000);
    const R = solo.session.race && raceOf(solo.session.race.id);
    await until(() => R?.race.phase === 'racing', 120000);
    const npcs = [...(R?.race.players.values() ?? [])].filter(p => p.npc).length;
    const cars = await until(() => solo.session.race?.net.sample(0.016).filter(c => c.pose).length >= 3, 15000);
    check('…and races them: NPC cars on the grid, driven by the server, seen like anyone\'s', npcs >= 3 && !!cars, `${npcs} NPCs`);
    await until(() => solo.session.confirmed, 400000, 500);
    const mine = solo.session.confirmed?.confirmed.find(r => r.uid === solo.uid);
    check('the NPC race to confirmed results, the player\'s run checked', !!solo.session.confirmed && mine?.status === 'finished' && mine?.verified, `${solo.session.confirmed?.confirmed.map(r => `${r.npc ? 'NPC' : 'you'} ${r.status}`).join(', ')}${mine?.problems?.length ? ` — ${mine.problems.join(' ')}` : ''}`);
    void bot;
    await Promise.all(C.map(x => x.session.close()));
  }

  // ---------- D ----------
  if (!only || only.has('D')) {
    section('D. Disconnects');
    const D = await people(7, 'd');
    const [host, b, c, d, e, f, g] = D;
    await host.session.createLobby({ kind: 'custom', settings: { venue: { kind: 'route', id: 'route_mpsf' }, laps: 1, name: 'Disconnects' } });
    const roomId = host.session.race.id, R = raceOf(roomId);
    for (const x of [b, c, d, e, f]) await x.session.joinLobby(roomId);
    await until(() => host.session.lobby?.players.length === 6, 5000);
    // in the lobby: one drops and comes back by itself; one leaves for good
    b.session.race.net.conn.breakConnection();
    await sleep(1500);
    const bBack = await until(() => b.session.race?.net.status === 'online' && host.session.lobby?.players.find(p => p.uid === b.uid && !p.away), 15000);
    await f.session.leaveRace();
    const fGone = await until(() => !host.session.lobby?.players.some(p => p.uid === f.uid), 5000);
    check('in the lobby: a drop comes back by itself; a player who leaves is gone from the list', !!bBack && !!fGone);
    // the host leaves: the host passes on
    await host.session.leaveRace();
    const newHost = await until(() => b.session.lobby?.host && b.session.lobby.host !== host.uid && b.session.lobby.host, 5000);
    check('the host leaves: the player who\'s been there longest is host', newHost === b.uid, `now ${D.find(x => x.uid === newHost)?.name}`);
    // (the new host: c drops at the countdown and comes back; d drops mid-race for good; e drives on)
    const bots = new Map([[b, botFor(b, 0)], [c, botFor(c, 1, { drop: { atPhase: 'countdown' } })], [d, botFor(d, 2, { drop: { atSec: 15, forGood: true } })], [e, botFor(e, 3)]]);
    for (const x of [b, c, d, e]) x.session.send({ t: 'ready', v: true });
    await sleep(300);
    b.session.send({ t: 'start' });
    await until(() => R.race.phase === 'results', 400000, 500);
    await until(() => b.session.confirmed, 60000, 500);
    const conf = b.session.confirmed?.confirmed ?? [], by = Object.fromEntries(conf.map(r => [r.uid, r]));
    check('a drop at the countdown: back, and races to the finish', by[c.uid]?.status === 'finished', by[c.uid]?.status);
    check('a drop mid-race, for good: out (DNF) after the grace, its car gone', by[d.uid]?.status === 'dnf' && /disconnect/.test(by[d.uid]?.why ?? '') && !by[d.uid]?.leftEarly, `${by[d.uid]?.status} (${by[d.uid]?.why})`);
    void bots;
    for (const x of D) await x.session.close();
    // everyone but one leaves mid-race: the last one finishes alone
    const L = await people(4, 'l');
    await L[0].session.createLobby({ kind: 'custom', settings: { venue: { kind: 'route', id: 'route_mpsf' }, laps: 1 } });
    for (const x of L.slice(1)) await x.session.joinLobby(L[0].session.race.id);
    const LR = raceOf(L[0].session.race.id);
    L.forEach((x, i) => botFor(x, i, i === 0 ? {} : { leaveAtSec: 10 + i }));
    for (const x of L) x.session.send({ t: 'ready', v: true });
    await sleep(300); L[0].session.send({ t: 'start' });
    await until(() => L[0].session.confirmed, 400000, 500);
    const lc = L[0].session.confirmed?.confirmed ?? [];
    check('everyone but one leaves: the last one races on and finishes; the leavers are out (and it counts)', lc.find(r => r.uid === L[0].uid)?.status === 'finished' && lc.filter(r => r.leftEarly).length === 3, lc.map(r => `${r.status}${r.leftEarly ? ' (left)' : ''}`).join(', '));
    void LR;
    for (const x of L) await x.session.close();
  }

  // ---------- E ----------
  if (!only || only.has('E')) {
    section('E. Chat, block, mute, kick');
    const E = await people(4, 'e');
    const [host, b, c, d] = E;
    await host.session.createLobby({ kind: 'private', settings: { venue: { kind: 'route', id: 'route_mpsf' } } });
    const code = host.session.lobby?.code;
    for (const x of [b, c, d]) await x.session.joinCode(code);
    check('a private lobby: joined with its invite code', host.session.lobby?.players.length === 4 && /^[A-Z0-9]{6}$/.test(code ?? ''), code);
    // (c blocks b)
    await c.p.post('/api/v1/blocks', { id: b.uid });
    await c.session.leaveRace(); await c.session.joinCode(code);
    await sleep(300);
    b.session.send({ t: 'chat', text: 'what a shitty start, gg though' });
    await sleep(500);
    const seenByHost = host.session.chat.find(m => m.uid === b.uid), seenByC = c.session.chat.find(m => m.uid === b.uid);
    check('chat: the name filter stars out what it matches', !!seenByHost && /\*{4}/.test(seenByHost.text) && !/shit/i.test(seenByHost.text), seenByHost?.text);
    check('block: a blocked player\'s messages don\'t reach the player who blocked them', !seenByC);
    d.session.mute(b.uid);
    b.session.send({ t: 'chat', text: 'second message' });
    await sleep(500);
    check('mute: a muted player\'s messages hidden (the player\'s own choice)', !d.session.chat.some(m => m.uid === b.uid) && host.session.chat.some(m => m.text === 'second message'));
    // the host kicks d; d can't come back in
    host.session.send({ t: 'kick', uid: d.uid });
    const out = await until(() => d.session.race == null || d.session.race.net.status === 'offline', 5000);
    let rejoined = false;
    try { await d.session.joinCode(code); await sleep(500); rejoined = d.session.race?.net.status === 'online' && host.session.lobby?.players.some(p => p.uid === d.uid); } catch { rejoined = false; }
    check('kick: the host removes a player, who can\'t come back in', !!out && !rejoined && !host.session.lobby?.players.some(p => p.uid === d.uid));
    // (and a report through the Phase 6 Step 5 reports)
    const rep = await host.p.post('/api/v1/reports', { targetId: b.uid, kind: 'behaviour', details: 'Swearing in the lobby chat.', ref: { place: `lobby ${code}` } });
    check('report: a player reported from the lobby goes to the admins\' queue', rep.status === 200 || rep.status === 201, `${rep.status}`);
    for (const x of E) await x.session.close();
  }

  // ---------- F ----------
  if (!only || only.has('F')) {
    section('F. Spectating');
    const F = await people(3, 'f');
    await F[0].session.createLobby({ kind: 'custom', settings: { venue: { kind: 'route', id: 'route_mpsf' }, laps: 1, npcFill: true } });
    await F[1].session.joinLobby(F[0].session.race.id);
    F.slice(0, 2).forEach((x, i) => botFor(x, i));
    for (const x of F.slice(0, 2)) x.session.send({ t: 'ready', v: true });
    await sleep(300); F[0].session.send({ t: 'start' });
    const R = raceOf(F[0].session.race.id);
    await until(() => R.race.phase === 'racing', 60000);
    await sleep(5000);
    await F[2].session.joinLobby(F[0].session.race.id, { spectate: true });
    const sees = await until(() => { const s = F[2].session.standings, cars = F[2].session.race?.net.sample(0.016).filter(c => c.pose); return s?.list?.length >= 2 && cars?.length >= 2 ? { s, cars } : null; }, 15000);
    check('a spectator joins a race under way: the standings and every car', !!sees && R.race.players.get(F[2].uid)?.role === 'spectator', sees ? `${sees.cars.length} cars, ${sees.s.list.length} in the standings` : 'nothing');
    for (const x of F) await x.session.close();
  }
} catch (e: any) {
  check('ran to the end', false, e.stack ?? e.message);
}
if (rtLog.length) { lines.push('', '### The race server\'s complaints', '', ...rtLog.slice(0, 20).map(l => `    ${l}`)); console.log(rtLog.slice(0, 10).join('\n')); }
const failed = results.filter(r => !r).length;
const summary = `${results.length - failed} of ${results.length} ok`;
fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
fs.writeFileSync(path.join(REPO_DIR, 'reports/mp-races.md'), `# Multiplayer races: bots, end to end\n\n${json.at}. One real-time process, no Redis. ${summary}.\n${lines.join('\n')}\n`);
fs.writeFileSync(path.join(REPO_DIR, 'reports/mp-races.json'), JSON.stringify(json, null, 2));
console.log(`\n${summary}`);
await rt.stop(); await app.close(); await database.drop();
process.exit(failed ? 1 : 0);
