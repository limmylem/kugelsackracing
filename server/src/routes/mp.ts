// Multiplayer's API (Phase 7 Step 2; docs/MULTIPLAYER.md):
//   GET    /friends                      your friends (and requests both ways) and who you've blocked
//   POST   /friends                      { name } or { id }: a request (or, if they asked you, accepted)
//   POST   /friends/:id/accept · DELETE /friends/:id     accept a request · remove a friend (or a request)
//   POST   /blocks { id } · DELETE /blocks/:id           block a player (ends a friendship) · unblock
//   GET    /mp/me                        your tier, races, wins and any queue cooldown
//   GET    /mp/races/:id                 a race's results: provisional, then confirmed (pay, rank changes)
//   GET    /mp/leaderboard               the best-rated players (tiers, not numbers)
//   GET    /admin/mp/dashboard           the queue: times and match quality against the targets (admins)
//   GET    /admin/mp/evidence/:id        a ramming report's replay (Phase 7 Step 3): both cars round the hits (admins)
//   GET    /admin/mp/races/:id/contacts  a race's agreed contacts, with each player's report and perspective (admins)
// The real-time server's (RT_SECRET in x-kr-internal; never the game's):
//   GET    /internal/mp/relations/:uid   friends, blocked both ways (the hub: friends' status, invites)
//   POST   /internal/mp/venue            { venue } → what's raced: its course as stored and the frame it's raced in
//   POST   /internal/mp/races            a race just ended: its provisional results
//   POST   /internal/mp/races/:id/runs   { uid, result, recording } a player's run, handed in through the race server
//   GET    /internal/mp/races/:id        its results (the race server waits for them confirmed)
//   POST   /internal/mp/queue-stats      the queue's numbers, every few seconds
//   POST   /internal/mp/evidence         { id, raceId, kind, fault, victim, data } what the race server kept of repeated hits
//                                        (Phase 7 Step 3: ramming), for the victim's report
//   POST   /internal/mp/act              { uid, action: friend-add | friend-accept | friend-remove | block | unblock | report, id?,
//                                         name?, kind?, details?, ref? } — a player's, from the game's multiplayer screens

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { timingSafeEqual } from 'node:crypto';
import { z } from '@kr/shared';
import type { Config } from '../config.ts';
import type { Guards } from '../session.ts';
import { AppError } from '../errors.ts';

export async function mpRoutes(api: FastifyInstance, { config, G, mp }: { config: Config; G: Guards; mp: any }) {
  const app = api.withTypeProvider<ZodTypeProvider>();
  const Id = z.object({ id: z.string().min(1).max(80) });

  // ---------- players ----------
  app.get('/friends', async req => { const s = await G.requireTerms(req); return mp.friends(s.user.id); });
  app.post('/friends', { schema: { body: z.object({ name: z.string().min(1).max(40).optional(), id: z.string().min(1).max(80).optional() }).strict() } }, async req => {
    const s = await G.requireTerms(req);
    if (s.user.isAnonymous) throw new AppError(403, 'FORBIDDEN', 'Make a full account to add friends (your progress comes with you).');
    return mp.requestFriend(s.user.id, req.body);
  });
  app.post('/friends/:id/accept', { schema: { params: Id } }, async req => { const s = await G.requireTerms(req); return mp.acceptFriend(s.user.id, req.params.id); });
  app.delete('/friends/:id', { schema: { params: Id } }, async req => { const s = await G.requireTerms(req); return mp.removeFriend(s.user.id, req.params.id); });
  app.post('/blocks', { schema: { body: Id.strict() } }, async req => { const s = await G.requireTerms(req); return mp.block(s.user.id, req.body.id); });
  app.delete('/blocks/:id', { schema: { params: Id } }, async req => { const s = await G.requireTerms(req); return mp.unblock(s.user.id, req.params.id); });
  app.get('/mp/me', async req => { const s = await G.requireTerms(req); return mp.me(s.user.id); });
  app.get('/mp/races/:id', { schema: { params: Id } }, async req => { await G.requireUser(req); return mp.raceView(req.params.id); });
  app.get('/mp/leaderboard', async () => ({ players: await mp.leaderboard(50) }));
  app.get('/admin/mp/dashboard', { config: { role: 'admin' } }, async () => mp.dashboard());
  // (Phase 7 Step 3) a ramming report's replay: both cars round the hits (the contact replay draws it); a race's contacts
  app.get('/admin/mp/evidence/:id', { config: { role: 'admin' } }, async (req: any) => mp.evidence(String(req.params.id).slice(0, 80)));
  app.get('/admin/mp/races/:id/contacts', { config: { role: 'admin' } }, async (req: any) => mp.contactsOf(String(req.params.id).slice(0, 80)));

  // ---------- the real-time server's ----------
  const secret = Buffer.from(config.rtSecret);
  const internal = (req: any) => {
    const got = Buffer.from(String(req.headers['x-kr-internal'] ?? ''));
    if (got.length !== secret.length || !timingSafeEqual(got, secret)) throw new AppError(403, 'FORBIDDEN', 'Not for you.');
  };
  // (big: a race's results, a run with its recording)
  const big = { bodyLimit: 16 * 1024 * 1024, config: { csrf: false, idempotent: false } } as any;   // (a long run with its contact record: Phase 7 Step 3)
  app.get('/internal/mp/relations/:id', { config: { csrf: false } } as any, async (req: any) => { internal(req); return mp.relations(String(req.params.id).slice(0, 80)); });
  app.post('/internal/mp/venue', { ...big }, async (req: any) => { internal(req); const v = await mp.venue(req.body?.venue ?? { kind: 'random' }); const { check, ...out } = v; return out; });
  app.post('/internal/mp/races', { ...big }, async (req: any) => { internal(req); return mp.recordRace(req.body); });
  app.post('/internal/mp/races/:id/runs', { ...big }, async (req: any) => { internal(req); return mp.submitRun(req.params.id, String(req.body?.uid ?? ''), { result: req.body?.result, recording: req.body?.recording, contact: typeof req.body?.contact === 'string' ? req.body.contact : null }); });
  app.get('/internal/mp/races/:id', { config: { csrf: false } } as any, async (req: any) => { internal(req); return mp.raceView(req.params.id); });
  app.post('/internal/mp/act', { config: { csrf: false, idempotent: false } } as any, async (req: any) => { internal(req); return mp.act(String(req.body?.uid ?? '').slice(0, 80), req.body ?? {}); });
  app.post('/internal/mp/queue-stats', { ...big }, async (req: any) => { internal(req); mp.queueStats(req.body ?? {}); return { ok: true }; });
  app.post('/internal/mp/evidence', { ...big }, async (req: any) => { internal(req); return mp.saveEvidence(req.body ?? {}); });
}
