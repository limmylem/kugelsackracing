// The admin page's Devlog tab (DEVLOG.md "From the admin page"; server/src/devlog.ts): the devlog workflow's runs, a
// new one started with every box it has (and what the video is about), a run's progress, its video played and
// downloaded with its script and the post's caption, a run cancelled. Admins only; starting and cancelling ask why.

import fs from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from '@kr/shared';
import type { Guards } from '../session.ts';
import type { Devlog } from '../devlog.ts';

const admin = { config: { role: 'admin' as const } };
const Reason = z.string().trim().min(3).max(500);
const RunId = z.object({ id: z.coerce.number().int().positive() });

export async function adminDevlogRoutes(app0: FastifyInstance, { devlog, G }: { devlog: Devlog; G: Guards }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const me = async (req: FastifyRequest) => { const s = await G.requireRole('admin')(req); return { id: s.user.id, name: s.user.name }; };
  const P = '/admin/devlog';

  app.get(P, admin, async req => { await me(req); return devlog.overview(); });
  app.post(`${P}/runs`, { ...admin, schema: { body: z.object({
    focus: z.string().max(2000).optional(), script: z.string().max(2000).optional(), target: z.enum(['local', 'live']).optional(), multiplayer: z.boolean().optional(),
    musicUrl: z.string().max(500).optional(), reuseClipsFrom: z.string().max(20).optional(), tag: z.boolean().optional(), reason: Reason,
  }).strict() } }, async req => { const a = await me(req); const { reason, ...input } = req.body; return devlog.run(input, a, reason); });
  app.get(`${P}/runs/:id`, { ...admin, schema: { params: RunId } }, async req => { await me(req); return devlog.detail(req.params.id); });
  app.post(`${P}/runs/:id/cancel`, { ...admin, schema: { params: RunId, body: z.object({ reason: Reason }) } }, async req => { const a = await me(req); return devlog.cancel(req.params.id, a, req.body.reason); });
  // the video (the page's player: byte ranges, so it can seek; ?download for the Download button)
  app.get(`${P}/runs/:id/video`, { ...admin, schema: { params: RunId, querystring: z.object({ download: z.string().optional() }) } }, async (req, reply) => {
    await me(req);
    const { file, name } = await devlog.video(req.params.id), size = fs.statSync(file).size;
    reply.header('content-type', 'video/mp4').header('accept-ranges', 'bytes').header('cache-control', 'private, max-age=3600');
    if (req.query.download != null) reply.header('content-disposition', `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`);
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (m && (m[1] || m[2])) {
      const start = m[1] ? +m[1] : Math.max(0, size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (start >= size || start > end) return reply.code(416).header('content-range', `bytes */${size}`).send();
      return reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1).send(fs.createReadStream(file, { start, end }));
    }
    return reply.header('content-length', size).send(fs.createReadStream(file));
  });
}
