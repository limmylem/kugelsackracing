// World content's endpoints (docs/WORLD_CONTENT.md — the browser's RemoteWorldContentService calls these):
//   GET  /content?lat&lon&km&view&kinds&offered&limit&fields   near a point, nearest first
//   GET  /content/cells/:hash · /content/tiles/:z/:x/:y         in a geohash cell, in a map tile
//   GET  /content/items/:id?view · /content/items/:id/state       one item · its whole state (editors)
//   POST /content/items · PUT /content/items/:id · PUT /content/items/:id/state
//   POST /content/items/:id/publish | unpublish | restore · DELETE /content/items/:id?confirm=true
//   GET  /content/export · POST /content/import · GET /content/stats
//
// Published content is public (the game reads it before anyone signs in) and cached: by the server (the
// responses kept per published version) and by browsers and a CDN (Cache-Control, an ETag from the published
// version: a publish changes it). Drafts and archived items are for editors only, and every write is
// an editor's (checked by the route's role before anything runs).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ContentItem, ContentQuery, ContentState, Geohash, ImportQuery, ImportReport, ItemId, ItemResponse, Items, LIMITS, NearItems, Ok, View, ViewQuery, Lat, Lon, z } from '@kr/shared';
import type { Config } from '../config.ts';
import type { Guards } from '../session.ts';
import { AppError } from '../errors.ts';
import type { ContentService } from '../content/service.ts';

const IdParams = z.object({ id: ItemId });
const author = (s: { user: { id: string; name: string } }) => ({ id: s.user.id, name: s.user.name });

export async function contentRoutes(app0: FastifyInstance, { config, content: svc, G }: { config: Config; content: ContentService; G: Guards }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const editor = G.requireRole('editor');

  // ---------- the published version, and the responses kept for it ----------
  // (kept within a budget of memory, the least recently used dropped first: a free server has 512 MB)
  let epoch = -1, epochAt = 0, bytes = 0;
  const cache = new Map<string, string>(), budget = config.cache.serverMB * 1024 * 1024;
  const keep = (key: string, body: string) => {
    if (body.length > budget / 8) return;
    cache.set(key, body); bytes += body.length;
    for (const [k, b] of cache) { if (bytes <= budget) break; cache.delete(k); bytes -= b.length; }
  };
  const currentEpoch = async () => {
    if (Date.now() - epochAt > 2000) { const e = await svc.epoch(); if (e !== epoch) { epoch = e; cache.clear(); bytes = 0; } epochAt = Date.now(); }
    return epoch;
  };
  const changed = () => { epochAt = 0; };
  // a published read: from the cache, or worked out (as JSON text, by Postgres) and kept; 304 when the
  // browser's copy is current
  const published = async (req: FastifyRequest, reply: FastifyReply, work: () => Promise<string>) => {
    const e = await currentEpoch(), tag = `"c${e}"`;
    reply.header('etag', tag).header('cache-control', `public, max-age=${config.cache.publishedSeconds}, s-maxage=${config.cache.cdnSeconds}, stale-while-revalidate=60`).header('vary', 'accept-encoding');
    if (req.headers['if-none-match'] === tag) return reply.status(304).send();
    const key = req.url;
    let body = cache.get(key);
    if (body === undefined) { body = await work(); if (e === epoch) keep(key, body); }
    else { cache.delete(key); cache.set(key, body); }
    return reply.header('content-type', 'application/json; charset=utf-8').send(body);
  };
  const viewAccess = async (req: FastifyRequest, view: z.infer<typeof View>) => { if (view !== 'published') await editor(req); };
  const draftHeaders = (reply: FastifyReply) => reply.header('cache-control', 'private, no-store');

  app.get('/content', { schema: { querystring: ContentQuery, response: { 200: NearItems } } }, async (req, reply) => {
    await viewAccess(req, req.query.view);
    if (req.query.view === 'published') return published(req, reply, () => svc.queryJson(req.query));
    draftHeaders(reply);
    return svc.query(req.query);
  });
  app.get('/content/cells/:hash', { schema: { params: z.object({ hash: Geohash }), querystring: ViewQuery, response: { 200: Items } } }, async (req, reply) => {
    await viewAccess(req, req.query.view);
    if (req.query.view === 'published') return published(req, reply, () => svc.inCellJson(req.params.hash, req.query));
    draftHeaders(reply);
    return svc.inCell(req.params.hash, req.query);
  });
  app.get('/content/tiles/:z/:x/:y', { schema: { params: z.object({ z: z.coerce.number().int().min(0).max(22), x: z.coerce.number().int().min(0), y: z.coerce.number().int().min(0) }).refine(t => t.x < 2 ** t.z && t.y < 2 ** t.z, 'no such tile'), querystring: ViewQuery, response: { 200: Items } } }, async (req, reply) => {
    await viewAccess(req, req.query.view);
    if (req.params.z < 6) throw new AppError(400, 'BAD_REQUEST', 'Ask for tiles at zoom 6 or closer.');
    if (req.query.view === 'published') return published(req, reply, () => svc.inTileJson(req.params.z, req.params.x, req.params.y, req.query));
    draftHeaders(reply);
    return svc.inTile(req.params.z, req.params.x, req.params.y, req.query);
  });
  app.get('/content/items/:id', { schema: { params: IdParams, querystring: z.object({ view: View.default('published') }), response: { 200: ItemResponse } } }, async (req, reply) => {
    await viewAccess(req, req.query.view);
    if (req.query.view === 'published') return published(req, reply, () => svc.getJson(req.params.id, 'published'));
    draftHeaders(reply);
    return svc.get(req.params.id, req.query.view);
  });
  app.get('/content/items/:id/state', { config: { role: 'editor' }, schema: { params: IdParams, response: { 200: z.object({ ok: z.literal(true), state: ContentState }) } } }, async (req, reply) => {
    draftHeaders(reply);
    return svc.getState(req.params.id) as Promise<any>;
  });

  // ---------- the editor's writes ----------
  const write = { config: { role: 'editor' as const } };
  app.post('/content/items', { ...write, schema: { body: ContentItem, response: { 200: ItemResponse } } }, async req => svc.create(req.body, author((await editor(req)))));
  app.put('/content/items/:id', { ...write, schema: { params: IdParams, body: ContentItem.partial().loose(), response: { 200: ItemResponse } } }, async req => svc.update(req.params.id, req.body, author((await editor(req)))));
  app.put('/content/items/:id/state', { ...write, schema: { params: IdParams, body: ContentState, response: { 200: Ok } } }, async req => { const r = await svc.setState(req.params.id, req.body as any, author((await editor(req)))); changed(); return r; });
  app.post('/content/items/:id/publish', { ...write, schema: { params: IdParams, response: { 200: ItemResponse } } }, async req => { const r = await svc.publish(req.params.id, author((await editor(req)))); changed(); return r; });
  app.post('/content/items/:id/unpublish', { ...write, schema: { params: IdParams, response: { 200: ItemResponse } } }, async req => { const r = await svc.unpublish(req.params.id, author((await editor(req)))); changed(); return r; });
  app.post('/content/items/:id/restore', { ...write, schema: { params: IdParams, response: { 200: ItemResponse } } }, async req => svc.restore(req.params.id, author((await editor(req)))));
  app.delete('/content/items/:id', { ...write, schema: { params: IdParams, querystring: z.object({ confirm: z.enum(['true', 'false']).default('false') }), response: { 200: z.object({ ok: z.literal(true), archived: z.boolean() }) } } }, async req => { const r = await svc.remove(req.params.id, req.query.confirm === 'true', author((await editor(req)))); changed(); return r; });

  app.get('/content/export', { ...write, schema: { querystring: z.object({ lat: Lat.optional(), lon: Lon.optional(), km: z.coerce.number().positive().max(500).optional(), cell: Geohash.optional(), views: z.string().default('draft,published,archived') }) } }, async (req, reply) => {
    const views = req.query.views.split(',').filter(v => View.safeParse(v).success) as any[];
    const area = req.query.lat != null && req.query.lon != null && req.query.km != null ? { lat: req.query.lat, lon: req.query.lon, km: req.query.km } : null;
    draftHeaders(reply).header('content-disposition', 'attachment; filename="world-content.json"');
    return svc.exportContent({ area, cell: req.query.cell ?? null, views });
  });
  app.post('/content/import', { ...write, bodyLimit: LIMITS.importBytes, schema: { querystring: ImportQuery, body: z.object({ format: z.string(), version: z.number(), entries: z.array(z.record(z.string(), z.unknown())).max(200_000) }).loose(), response: { 200: ImportReport } } }, async req => {
    const r = await svc.importContent(req.body, { onConflict: req.query.onConflict }, author((await editor(req))));
    changed();
    return r;
  });
  app.get('/content/stats', { ...write, schema: { response: { 200: z.object({ ok: z.literal(true), draft: z.number(), published: z.number(), archived: z.number() }) } } }, async () => svc.stats());
}

declare module 'fastify' {
  interface FastifyInstance { content: ContentService }
}
