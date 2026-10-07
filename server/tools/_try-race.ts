// @ts-nocheck — scratch: one lobby, three bots, a real route, to the confirmed results
import fs from 'node:fs';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { startRt } from '../src/rt/server.ts';
import { seedMpRoutes } from './seed-mp-routes.ts';
import { createMpSession } from '../../mp/client.js';
import { createRaceBot } from '../../mp/bot.js';
import { courseOf } from '../src/rt/mp.ts';
import { transport } from './rt-bots.ts';

const PORT = 8791, RT_PORT = 2791, SECRET = 'try-race-secret-try-race-secret-0123456789';
const MP = JSON.parse(fs.readFileSync(new URL('../../data/multiplayer.json', import.meta.url), 'utf8'));
const QCFG = JSON.parse(fs.readFileSync(new URL('../../data/quests.json', import.meta.url), 'utf8'));
const database = await freshDatabase('tryrace');
const app = await buildApp({ config: testConfig(database.url, { serveClient: false, logLevel: 'warn' }, { PUBLIC_URL: `http://localhost:8787`, RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET }) });
await app.listen({ port: PORT, host: '127.0.0.1' });
await seedMpRoutes(app.content, { regions: ['mk'] });
const rt = await startRt({ port: RT_PORT, secret: SECRET, rt: { allowGuests: true, maxPlayers: 1000, roomMaxClients: 64, netsim: true }, api: { url: `http://localhost:${PORT}` }, log: (m, e) => { if (/fail/.test(m)) console.log('RT', m, JSON.stringify(e)); } });
const venueCache = new Map();
const courseFor = async (v) => { const k = JSON.stringify(v.venue); if (!venueCache.has(k)) venueCache.set(k, courseOf(await app.mp.venue(v.venue))); return venueCache.get(k); };
const players = [];
for (let i = 0; i < 3; i++) players.push(await signUp(app, app.deps.mailer.outbox, { email: `bot${i}@example.com`, name: `Bot Racer ${i}`, ip: `10.20.0.${i + 1}` }));
const sessions = players.map(p => createMpSession({ transport, endpoint: `http://localhost:${RT_PORT}`, getTicket: async () => { const r = await p.post('/api/v1/rt/ticket', {}); if (r.status !== 200) throw new Error(r.text); return r.body; } }));
const bots = sessions.map((s, i) => createRaceBot({ session: s, courseFor, quests: QCFG, cfg: { ...MP.npc, corneringG: 1.6, accelG: 0.8, brakeG: 1.2 }, skill: 0.9 + i * 0.03 }));
const host = sessions[0];
await host.createLobby({ kind: 'custom', settings: { venue: { kind: 'route', id: 'route_mpmk' }, laps: 1, name: 'Try' } });
const roomId = host.race.id;
for (const s of sessions.slice(1)) await s.joinLobby(roomId);
await new Promise(r => setTimeout(r, 1000));
console.log('lobby', host.lobby?.players.map(p => `${p.name}:${p.role}:${p.car?.cls}:${p.tier?.name}`).join(' | '), host.lobby?.venue?.name, host.lobby?.venueError);
for (const s of sessions) s.send({ t: 'ready', v: true });
await new Promise(r => setTimeout(r, 300));
host.send({ t: 'start' });
const t0 = Date.now();
let last = '';
while (Date.now() - t0 < 240000 && !host.confirmed) {
  await new Promise(r => setTimeout(r, 1000));
  const st = host.standings?.list?.map(s => `${s.place}.${s.name}(${s.status},${s.u}m)`).join(' ') ?? '';
  const line = `${host.phase} ${st}`;
  if (line !== last) { console.log(Math.round((Date.now() - t0) / 1000), line); last = line; }
}
console.log('provisional', JSON.stringify(host.results?.results?.map(r => [r.place, r.name, r.status, r.timeMs])));
console.log('confirmed', JSON.stringify(host.confirmed?.confirmed?.map(r => [r.place, r.name, r.status, r.pay?.money, r.rank?.after?.name, r.problems])));
for (const b of bots) console.log(b.log.slice(-4).join(' / '));
for (const s of sessions) await s.close();
await rt.stop(); await app.close(); await database.drop();
process.exit(0);
