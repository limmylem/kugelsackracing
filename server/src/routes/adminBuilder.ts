// The family builder's routes (the admin page's Content tab › New family, New engine, New car; docs/CONTENT_PIPELINE.md
// "A family from the admin page"): what can be made, what a setup would make (before anything is made), making and
// changing families and engines as drafts (build and check as background jobs, with their progress, logs and results,
// cancellable), previews, presets and variations, new cars. Admins only; every change asks why, and goes in the
// history and the admins' log (server/src/content/builder.ts).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from '@kr/shared';
import type { Guards } from '../session.ts';
import type { ContentBuilder } from '../content/builder.ts';

const admin = { config: { role: 'admin' as const } };
const Id = z.string().regex(/^[a-z0-9_]{1,80}$/);
const Reason = z.string().trim().min(3).max(500);
const Scalar = z.union([z.number(), z.string().max(80), z.boolean(), z.null()]);
const Value = z.union([Scalar, z.array(z.union([Scalar, z.record(z.string().max(40), z.union([z.number(), z.string().max(40)]))])).max(64), z.object({ from: z.number(), to: z.number(), step: z.number() }).strict(), z.record(z.string().max(40), z.union([z.number(), z.string().max(40)]))]);
// (a family as the form sends it: the fields a family file has, every value checked against its kind by the pipeline)
const Family = z.object({
  _note: z.string().max(1000).optional(), id: Id.optional(), kind: z.string().max(40), name: z.string().max(60).default(''),
  settings: z.record(z.string().max(40), Value).default({}), shape: z.record(z.string().max(40), Value).optional(),
  finishes: z.array(z.string().max(40)).max(20).default([]), skip: z.array(z.record(z.string().max(40), Scalar)).max(200).optional(),
  leaveOff: z.record(Id, z.string().max(200)).optional(), status: z.enum(['draft', 'review', 'published']).optional(),
  aim: z.object({ tiers: z.array(z.string().max(20)).max(5).optional(), price: z.array(z.number().nullable()).length(2).optional(), unlock: z.array(z.number().int().nullable()).length(2).optional() }).strict().optional(),
}).strict();
const Engine = z.object({
  _note: z.string().max(1000).optional(), id: z.string().max(40), maker: z.string().max(60), name: z.string().max(60).optional(), layout: z.string().max(20), cylinders: z.coerce.number(), displacement: z.coerce.number(),
  aspiration: z.string().max(20).default('natural'), boost: z.coerce.number().optional(), idle: z.coerce.number(), redline: z.coerce.number(), character: z.coerce.number(), mount: z.string().max(20), sound: z.string().max(40),
  colour: z.string().max(20).default('grey'), status: z.enum(['draft', 'review', 'published']).optional(), overrides: z.record(z.string(), z.any()).optional(),
}).strict();

export async function adminBuilderRoutes(app0: FastifyInstance, { builder, G }: { builder: ContentBuilder; G: Guards }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const me = async (req: FastifyRequest) => { const s = await G.requireRole('admin')(req); return { id: s.user.id, name: s.user.name }; };
  const P = '/admin/builder';

  app.get(P, admin, async req => { await me(req); const a = await builder.available(); return a.ok ? { available: true, mode: a.mode, canMake: a.canMake, ...(await builder.overview()), jobs: await builder.jobs() } : { available: false, why: a.why, jobs: [] }; });
  app.get(`${P}/kinds/:kind`, { ...admin, schema: { params: z.object({ kind: Id }) } }, async req => { await me(req); return builder.kind(req.params.kind); });
  app.post(`${P}/names`, { ...admin, schema: { body: z.object({ kind: Id, seed: z.number().int().min(0).max(2 ** 31).default(1) }) } }, async req => { await me(req); return { names: await builder.names(req.body.kind, req.body.seed) }; });
  app.post(`${P}/name`, { ...admin, schema: { body: z.object({ name: z.string().max(60) }) } }, async req => { await me(req); return { problem: await builder.nameProblem(req.body.name) }; });
  app.post(`${P}/summary`, { ...admin, schema: { body: z.object({ family: Family, editing: Id.nullable().default(null) }) } }, async req => { await me(req); return builder.summary(req.body.family, { editing: req.body.editing }); });
  app.post(`${P}/shape`, { ...admin, schema: { body: z.object({ family: Family, part: Id.nullable().default(null), editing: Id.nullable().default(null) }) } }, async req => { await me(req); return builder.shapeModel({ ...req.body.family, ...(req.body.editing && { id: req.body.editing }) }, req.body.part); });
  // families: made, read, changed, built and checked again
  app.post(`${P}/families`, { ...admin, schema: { body: z.object({ family: Family, reason: Reason }) } }, async req => { const a = await me(req); return builder.make(req.body.family, a, req.body.reason); });
  app.get(`${P}/families/:id`, { ...admin, schema: { params: z.object({ id: Id }) } }, async req => { await me(req); return builder.family(req.params.id); });
  app.put(`${P}/families/:id`, { ...admin, schema: { params: z.object({ id: Id }), body: z.object({ family: Family, reason: Reason }) } }, async req => { const a = await me(req); return builder.change(req.params.id, req.body.family, a, req.body.reason); });
  app.post(`${P}/build`, { ...admin, schema: { body: z.object({ ids: z.array(Id).min(1).max(20), reason: Reason }) } }, async req => { const a = await me(req); return { job: await builder.rebuild(req.body.ids, a, req.body.reason) }; });
  // previews (nothing saved as a part), their files and a part on a car
  app.post(`${P}/preview`, { ...admin, schema: { body: z.object({ family: Family, editing: Id.nullable().default(null), parts: z.array(Id).max(40).nullable().default(null), cars: z.array(Id).max(10).nullable().default(null), reason: z.string().max(500).default('a preview') }) } }, async req => {
    const a = await me(req);
    return builder.preview({ ...req.body.family, ...(req.body.editing && { id: req.body.editing, editing: req.body.editing }) }, req.body.parts, req.body.cars, a, req.body.reason.trim().length >= 3 ? req.body.reason : 'a preview');
  });
  app.get(`${P}/files/:job/:file`, { ...admin, schema: { params: z.object({ job: z.string().regex(/^job_[a-z0-9_]{1,40}$/), file: z.string().max(120) }) } }, async (req, reply) => {
    await me(req);
    const f = await builder.previewFile(req.params.job, req.params.file);
    return reply.header('content-type', f.type).header('cache-control', 'private, max-age=600').send(f.body);
  });
  app.get(`${P}/preview/:job/:part/:car`, { ...admin, schema: { params: z.object({ job: z.string().regex(/^job_[a-z0-9_]{1,40}$/), part: Id, car: Id }) } }, async req => {
    await me(req);
    return builder.previewOnCar(req.params.job, req.params.part, req.params.car, f => `/api/v1${P}/files/${req.params.job}/${f}`);
  });
  // jobs
  app.get(`${P}/jobs`, admin, async req => { await me(req); return { jobs: await builder.jobs() }; });
  app.get(`${P}/jobs/:id`, { ...admin, schema: { params: z.object({ id: z.string().max(60) }) } }, async req => { await me(req); return builder.job(req.params.id); });
  app.post(`${P}/jobs/:id/cancel`, { ...admin, schema: { params: z.object({ id: z.string().max(60) }), body: z.object({ reason: Reason }) } }, async req => { const a = await me(req); return builder.cancel(req.params.id, a, req.body.reason); });
  // presets and variations
  app.get(`${P}/presets`, admin, async req => { await me(req); return { presets: await builder.presets() }; });
  app.post(`${P}/presets`, { ...admin, schema: { body: z.object({ name: z.string().max(60), family: Family, reason: Reason }) } }, async req => { const a = await me(req); return builder.savePreset(req.body.name, req.body.family, a, req.body.reason); });
  app.delete(`${P}/presets/:name`, { ...admin, schema: { params: z.object({ name: z.string().max(60) }), body: z.object({ reason: Reason }) } }, async req => { const a = await me(req); return builder.deletePreset(req.params.name, a, req.body.reason); });
  app.post(`${P}/variations/plan`, { ...admin, schema: { body: z.object({ from: z.object({ preset: z.string().max(60).optional(), family: Id.optional() }).strict(), vary: z.array(z.string().max(40)).min(1).max(6), count: z.number().int().min(1).max(20).default(5), seed: z.number().int().min(0).max(2 ** 31).default(1) }) } }, async req => {
    await me(req);
    return { variations: await builder.variationsPlan(req.body.from, req.body.vary, req.body.count, req.body.seed) };
  });
  app.post(`${P}/variations`, { ...admin, schema: { body: z.object({ families: z.array(Family).min(1).max(20), reason: Reason }) } }, async req => { const a = await me(req); return builder.makeVariations(req.body.families, a, req.body.reason); });
  // engines and cars
  app.get(`${P}/engines`, admin, async req => { await me(req); return builder.engineOptions(); });
  app.get(`${P}/engines/:id`, { ...admin, schema: { params: z.object({ id: Id }) } }, async req => { await me(req); return builder.engine(req.params.id); });
  app.post(`${P}/engines/summary`, { ...admin, schema: { body: z.object({ engine: Engine, editing: Id.nullable().default(null) }) } }, async req => { await me(req); return builder.engineSummary(req.body.engine, { editing: req.body.editing }); });
  app.post(`${P}/engines`, { ...admin, schema: { body: z.object({ engine: Engine, reason: Reason }) } }, async req => { const a = await me(req); return builder.makeEngine(req.body.engine, a, req.body.reason); });
  app.put(`${P}/engines/:id`, { ...admin, schema: { params: z.object({ id: Id }), body: z.object({ engine: Engine, reason: Reason }) } }, async req => { const a = await me(req); return builder.makeEngine({ ...req.body.engine, id: req.params.id }, a, req.body.reason, { editing: req.params.id }); });
  app.get(`${P}/cars/:id/preview`, { ...admin, schema: { params: z.object({ id: Id }) } }, async req => { await me(req); return builder.carPreview(req.params.id); });
  app.post(`${P}/cars`, { ...admin, bodyLimit: 30 * 1024 * 1024, schema: { body: z.object({ id: z.string().max(40), type: z.string().max(20), name: z.string().max(40).optional(), model: z.string().max(40_000_000).nullable().default(null), reason: Reason }) } }, async req => {
    const a = await me(req);
    return { job: await builder.makeCar({ id: req.body.id, type: req.body.type, name: req.body.name, model: req.body.model }, a, req.body.reason) };
  });
}
