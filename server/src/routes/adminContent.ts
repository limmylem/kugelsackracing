// The content manager's routes (Phase 8 Step 3; the admin page's Content tab; docs/CONTENT_PIPELINE.md): every part
// and car with its status and checks (search and filters), one in full (its versions, history, checks, the cars it
// fits — for the 3D preview), edits (one or many: price, a price multiple, unlock level, tier, name, its family's
// stats), status changes (draft, review, published: publishing needs passing checks), CSV out and in. Admins only;
// every change written to the admins' log with its reason.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from '@kr/shared';
import type { Db } from '../db/index.ts';
import type { Guards } from '../session.ts';
import type { ContentManager } from '../content/manager.ts';
import { auditLog } from '../db/schema.ts';

const admin = { config: { role: 'admin' as const } };
const Kind = z.enum(['part', 'car']);
const Id = z.string().regex(/^[a-z0-9_]{1,80}$/);
const Reason = z.string().trim().min(3).max(500);
const Filters = z.object({
  kind: Kind.optional(), q: z.string().max(80).optional(), slot: z.string().max(40).optional(), family: z.string().max(60).optional(),
  tier: z.string().max(20).optional(), status: z.enum(['draft', 'review', 'published', 'live']).optional(), problems: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(200), offset: z.coerce.number().int().min(0).default(0),
});
const Changes = z.object({
  price: z.number().int().positive().max(1_000_000).optional(), priceTimes: z.number().positive().max(10).optional(),
  unlockLevel: z.number().int().min(1).max(50).nullable().optional(), tier: z.enum(['street', 'sport', 'race', 'extreme']).optional(),
  name: z.string().trim().min(3).max(80).optional(), stats: z.record(z.string().max(40), z.number()).optional(),
}).strict();

export async function adminContentRoutes(app0: FastifyInstance, { db, manager, G }: { db: Db; manager: ContentManager; G: Guards }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const me = async (req: FastifyRequest) => { const s = await G.requireRole('admin')(req); return { id: s.user.id, name: s.user.name }; };
  const log = (actorId: string, action: string, reason: string, details: object) => db.insert(auditLog).values({ actorId, action, targetId: null, reason, details });

  app.get('/admin/content/items', { ...admin, schema: { querystring: Filters } }, async req => { await me(req); return manager.items(req.query); });
  app.get('/admin/content/items/:kind/:id', { ...admin, schema: { params: z.object({ kind: Kind, id: Id }) } }, async req => { await me(req); return manager.item(req.params.kind, req.params.id); });
  app.get('/admin/content/preview/:car/:part', { ...admin, schema: { params: z.object({ car: Id, part: Id }) } }, async req => { await me(req); return manager.preview(req.params.car, req.params.part); });
  app.post('/admin/content/edit', { ...admin, schema: { body: z.object({ ids: z.array(Id).min(1).max(1000), changes: Changes, reason: Reason }) } }, async req => {
    const a = await me(req), r = await manager.edit({ ids: req.body.ids, changes: req.body.changes, actorId: a.id, reason: req.body.reason });
    await log(a.id, 'content-edit', req.body.reason, { ids: req.body.ids.slice(0, 200), count: req.body.ids.length, changes: req.body.changes });
    return r;
  });
  app.post('/admin/content/status', { ...admin, schema: { body: z.object({ items: z.array(z.object({ kind: Kind, id: Id })).min(1).max(5000), status: z.enum(['draft', 'review', 'published']), reason: Reason }) } }, async req => {
    const a = await me(req), r = await manager.setStatus({ items: req.body.items, status: req.body.status, actorId: a.id, reason: req.body.reason });
    await log(a.id, `content-${req.body.status}`, req.body.reason, { done: r.done.length, refused: r.refused.length, items: req.body.items.slice(0, 200) });
    return r;
  });
  app.get('/admin/content/export.csv', { ...admin, schema: { querystring: Filters.omit({ limit: true, offset: true }) } }, async (req, reply) => {
    await me(req);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="content-${new Date().toISOString().slice(0, 10)}.csv"`);
    return manager.exportCsv(req.query);
  });
  app.post('/admin/content/import', { ...admin, bodyLimit: 4 * 1024 * 1024, schema: { body: z.object({ csv: z.string().min(1).max(4_000_000), reason: Reason, dryRun: z.boolean().default(false) }) } }, async req => {
    const a = await me(req), r = await manager.importCsv({ csv: req.body.csv, actorId: a.id, reason: req.body.reason, dryRun: req.body.dryRun });
    if (r.applied) await log(a.id, 'content-import', req.body.reason, { edits: r.edits, statuses: r.statuses });
    return r;
  });
}
