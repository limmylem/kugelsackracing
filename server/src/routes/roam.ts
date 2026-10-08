// Free roam's API (Phase 7 Step 4; docs/FREE_ROAM.md):
//   GET    /roam/me                      your settings, and where you come back to (where you left, or the garage — and why)
//   PUT    /roam/settings { settings }   privacy (location: everyone | friends | nobody; appear offline), nearby chat, names,
//                                        contact, passive mode, party contact (the zone servers enforce the cooldowns live)
//   GET    /roam/challenges              your recent challenges: place, time, pay (or why not)
//   GET    /roam/meets                   the scheduled car meets still to come or on now, with a countdown
//   GET    /admin/roam/dashboard         the zone servers live: players per zone and instance, handoffs, bandwidth, load, cost (admins)
//   GET    /admin/roam/meets · POST /admin/roam/meets { meetId, title, startsAt, hours } · DELETE /admin/roam/meets/:id   (admins)
// The zone servers' (RT_SECRET in x-kr-internal; never the game's):
//   POST   /internal/mp/roam/save { rows }          where each player is (they come back there)
//   POST   /internal/mp/roam/settings { uid, settings }   a player's settings changed in the game
//   POST   /internal/mp/roam/incident { uid, hits, drop, until }   auto-ghosted for ramming: their safety rating drops
//   POST   /internal/mp/roam/challenges { record }  a challenge as the zone server recorded it: checked, then paid (capped)
//   POST   /internal/mp/roam/stats { … }            a zone process's numbers (the dashboard)

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { timingSafeEqual } from 'node:crypto';
import { z } from '@kr/shared';
import type { Config } from '../config.ts';
import type { Guards } from '../session.ts';
import { AppError } from '../errors.ts';

const Settings = z.object({
  location: z.enum(['everyone', 'friends', 'nobody']).optional(), appearOffline: z.boolean().optional(), nearbyChat: z.boolean().optional(), names: z.boolean().optional(),
  contact: z.boolean().optional(), passive: z.boolean().optional(), partyContact: z.boolean().optional(),
}).strict();

export async function roamRoutes(api: FastifyInstance, { config, G, roam }: { config: Config; G: Guards; roam: any }) {
  const app = api.withTypeProvider<ZodTypeProvider>();
  app.get('/roam/me', async (req, reply) => { const s = await G.requireTerms(req); reply.header('cache-control', 'no-store'); return roam.comeBack(s.user.id); });
  app.put('/roam/settings', { schema: { body: z.object({ settings: Settings }).strict() } }, async req => { const s = await G.requireTerms(req); return { settings: await roam.saveSettings(s.user.id, req.body.settings) }; });
  app.get('/roam/challenges', async req => { const s = await G.requireTerms(req); return { challenges: await roam.myChallenges(s.user.id) }; });
  app.get('/roam/meets', async () => ({ events: await roam.listMeets() }));
  app.get('/admin/roam/dashboard', { config: { role: 'admin' } }, async () => roam.dashboard());
  app.get('/admin/roam/meets', { config: { role: 'admin' } }, async () => ({ events: await roam.listMeets() }));
  app.post('/admin/roam/meets', { config: { role: 'admin' }, schema: { body: z.object({ meetId: z.string().regex(/^meet_[0-9a-z]{4,40}$/), title: z.string().min(3).max(80), startsAt: z.string().max(40), hours: z.number().min(0.5).max(24).optional() }).strict() } }, async req => {
    const s = await G.requireRole('admin')(req);
    return roam.createMeet(s.user.id, req.body);
  });
  app.delete('/admin/roam/meets/:id', { config: { role: 'admin' }, schema: { params: z.object({ id: z.string().max(60) }) } }, async req => roam.cancelMeet(req.params.id));

  // ---------- the zone servers' ----------
  const secret = Buffer.from(config.rtSecret);
  const internal = (req: any) => {
    const got = Buffer.from(String(req.headers['x-kr-internal'] ?? ''));
    if (got.length !== secret.length || !timingSafeEqual(got, secret)) throw new AppError(403, 'FORBIDDEN', 'Not for you.');
  };
  const big = { bodyLimit: 4 * 1024 * 1024, config: { csrf: false, idempotent: false } } as any;
  app.post('/internal/mp/roam/save', { ...big }, async (req: any) => { internal(req); return roam.save(req.body?.rows ?? []); });
  app.post('/internal/mp/roam/settings', { ...big }, async (req: any) => { internal(req); return { settings: await roam.saveSettings(String(req.body?.uid ?? '').slice(0, 80), req.body?.settings ?? {}) }; });
  app.post('/internal/mp/roam/incident', { ...big }, async (req: any) => { internal(req); return roam.incident(req.body ?? {}); });
  app.post('/internal/mp/roam/challenges', { ...big }, async (req: any) => { internal(req); return roam.challenge(req.body ?? {}); });
  app.post('/internal/mp/roam/stats', { ...big }, async (req: any) => { internal(req); roam.stats(req.body ?? {}); return { ok: true }; });
}
