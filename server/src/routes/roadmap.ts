// The roadmap (docs/ROADMAP.md): what's being worked on, voted for by the players —
//   players   GET /roadmap (anyone; signed in, with their own votes and ideas) · POST /roadmap/ideas (a full account)
//             POST/DELETE /roadmap/:id/vote
//   admins    GET /admin/roadmap · POST /admin/roadmap (a feature or bug) · PUT /admin/roadmap/:id (edit; accept or
//             reject an idea by its status) · DELETE /admin/roadmap/:id
// A player's idea waits ('pending') until an admin accepts it: until then only its author and the admins see it.

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from '@kr/shared';
import type { Db } from '../db/index.ts';
import type { Guards } from '../session.ts';
import { auditLog } from '../db/schema.ts';
import { AppError, notFound } from '../errors.ts';
import { rudeText } from '../names.ts';

export const KINDS = ['feature', 'bug', 'idea'] as const;
// (pending and rejected: ideas no player but their author sees)
export const STATUSES = ['pending', 'rejected', 'open', 'planned', 'working', 'done'] as const;
export const SHOWN = ['open', 'planned', 'working', 'done'] as const;
export const LIMITS = { title: [6, 80], body: 1000, ideasPerDay: 3, waiting: 5, note: 300 } as const;

const admin = { config: { role: 'admin' as const } };
const Id = z.object({ id: z.string().min(1).max(40) });
const newId = () => crypto.randomBytes(9).toString('base64url');
const iso = (d: any) => d ? new Date(d).toISOString() : null;
const clean = (s: string) => s.normalize('NFKC').replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const Title = z.string().transform(clean).pipe(z.string().min(LIMITS.title[0], 'A few more words for the title.').max(LIMITS.title[1], 'A shorter title, please.'));
const Body = z.string().max(LIMITS.body * 2).transform(clean).pipe(z.string().max(LIMITS.body, 'A shorter description, please.'));

export async function roadmapRoutes(app0: FastifyInstance, { db, G }: { db: Db; G: Guards }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const adminWho = async (req: FastifyRequest) => (await G.requireRole('admin')(req)).user;
  const log = (actorId: string, action: string, targetId: string | null, reason: string | null, details: object = {}) => db.insert(auditLog).values({ actorId, action, targetId, reason, details });
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as any[];
  const out = (r: any, me = '') => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body, status: r.status, note: r.note ?? null,
    // (an idea's author by name, once it's shown; the team's own items by nobody)
    author: r.kind === 'idea' ? r.author_name ?? null : null, mine: !!me && r.author_id === me,
    votes: Number(r.votes ?? 0), voted: !!r.voted, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  });
  const select = (me: string) => sql`select i.*, u.name as author_name, (select count(*) from roadmap_votes v where v.item_id = i.id) as votes,
    exists (select 1 from roadmap_votes v where v.item_id = i.id and v.user_id = ${me}) as voted
    from roadmap_items i left join users u on u.id = i.author_id`;
  const shown = sql.raw(`(${SHOWN.map(s => `'${s}'`).join(', ')})`);

  // ---------- the players ----------
  app.get('/roadmap', async req => {
    const s = await G.requireUser(req).catch(() => null), me = s?.user.id ?? '';
    // (done: the last 90 days of it)
    const items = await rows(sql`${select(me)} where i.status in ${shown} and (i.status <> 'done' or i.updated_at > now() - interval '90 days') order by i.created_at desc limit 300`);
    const waiting = me ? await rows(sql`${select(me)} where i.author_id = ${me} and i.status in ('pending', 'rejected') and i.updated_at > now() - interval '30 days' order by i.created_at desc limit 20`) : [];
    return { items: items.map(r => out(r, me)), mine: waiting.map(r => out(r, me)), signedIn: !!s, canPost: !!s && !s.user.isAnonymous };
  });
  app.post('/roadmap/ideas', { schema: { body: z.object({ title: Title, body: Body.default('') }) } }, async req => {
    const s = await G.requireFull(req), b = req.body;
    if (rudeText(b.title) || rudeText(b.body)) throw new AppError(400, 'BAD_REQUEST', 'Please keep it friendly: some of those words aren\'t allowed.');
    const [n] = await rows(sql`select count(*) filter (where created_at > now() - interval '24 hours')::int as today, count(*) filter (where status = 'pending')::int as waiting from roadmap_items where author_id = ${s.user.id}`);
    if (n.today >= LIMITS.ideasPerDay) throw new AppError(429, 'RATE_LIMITED', `That's ${LIMITS.ideasPerDay} ideas today: thank you! Send more tomorrow.`);
    if (n.waiting >= LIMITS.waiting) throw new AppError(429, 'RATE_LIMITED', 'You have several ideas waiting to be read: send more once they have been.');
    const id = newId();
    await db.execute(sql`insert into roadmap_items (id, kind, title, body, status, author_id) values (${id}, 'idea', ${b.title}, ${b.body}, 'pending', ${s.user.id})`);
    return out((await rows(sql`${select(s.user.id)} where i.id = ${id}`))[0], s.user.id);
  });
  const votes = async (id: string, me: string) => { const [r] = await rows(sql`select count(*)::int as n, exists (select 1 from roadmap_votes where item_id = ${id} and user_id = ${me}) as voted from roadmap_votes where item_id = ${id}`); return { votes: r.n, voted: r.voted }; };
  app.post('/roadmap/:id/vote', { schema: { params: Id } }, async req => {
    const s = await G.requireFull(req);
    const [i] = await rows(sql`select id, status from roadmap_items where id = ${req.params.id} and status in ${shown}`);
    if (!i) throw notFound('That item');
    if (i.status === 'done') throw new AppError(409, 'CONFLICT', 'That one\'s done already.');
    await db.execute(sql`insert into roadmap_votes (item_id, user_id) values (${i.id}, ${s.user.id}) on conflict do nothing`);
    return votes(i.id, s.user.id);
  });
  app.delete('/roadmap/:id/vote', { schema: { params: Id } }, async req => {
    const s = await G.requireFull(req);
    await db.execute(sql`delete from roadmap_votes where item_id = ${req.params.id} and user_id = ${s.user.id}`);
    return votes(req.params.id, s.user.id);
  });

  // ---------- the admins ----------
  const Item = z.object({ kind: z.enum(KINDS), title: Title, body: Body.default(''), status: z.enum(STATUSES), note: z.string().max(LIMITS.note).transform(clean).nullish() });
  app.get('/admin/roadmap', { ...admin, schema: { querystring: z.object({ status: z.enum([...STATUSES, 'all']).default('all') }) } }, async req => {
    const a = await adminWho(req), st = req.query.status;
    const items = await rows(sql`${select(a.id)} ${st === 'all' ? sql`` : sql`where i.status = ${st}`} order by (i.status = 'pending') desc, i.created_at desc limit 500`);
    const [c] = await rows(sql`select count(*) filter (where status = 'pending')::int as pending from roadmap_items`);
    return { items: items.map(r => ({ ...out(r, a.id), author: r.author_name ?? null, authorId: r.author_id ?? null, reviewedAt: iso(r.reviewed_at) })), pending: c.pending };
  });
  app.post('/admin/roadmap', { ...admin, schema: { body: Item } }, async req => {
    const a = await adminWho(req), b = req.body, id = newId();
    await db.execute(sql`insert into roadmap_items (id, kind, title, body, status, note, author_id, reviewed_by, reviewed_at) values (${id}, ${b.kind}, ${b.title}, ${b.body}, ${b.status}, ${b.note ?? null}, ${a.id}, ${a.id}, now())`);
    await log(a.id, 'roadmap-add', null, b.title, { id, kind: b.kind, status: b.status });
    return out((await rows(sql`${select(a.id)} where i.id = ${id}`))[0], a.id);
  });
  app.put('/admin/roadmap/:id', { ...admin, schema: { params: Id, body: Item } }, async req => {
    const a = await adminWho(req), b = req.body;
    const [was] = await rows(sql`select status, author_id from roadmap_items where id = ${req.params.id}`);
    if (!was) throw notFound('That item');
    const reviewed = was.status !== b.status;
    await db.execute(sql`update roadmap_items set kind = ${b.kind}, title = ${b.title}, body = ${b.body}, status = ${b.status}, note = ${b.note ?? null}, updated_at = now(),
      reviewed_by = ${reviewed ? a.id : sql`reviewed_by`}, reviewed_at = ${reviewed ? sql`now()` : sql`reviewed_at`} where id = ${req.params.id}`);
    const action = was.status === 'pending' && b.status !== 'pending' ? (b.status === 'rejected' ? 'roadmap-reject' : 'roadmap-accept') : 'roadmap-edit';
    await log(a.id, action, was.author_id ?? null, b.title, { id: req.params.id, from: was.status, to: b.status });
    return out((await rows(sql`${select(a.id)} where i.id = ${req.params.id}`))[0], a.id);
  });
  app.delete('/admin/roadmap/:id', { ...admin, schema: { params: Id } }, async req => {
    const a = await adminWho(req);
    const [r] = await rows(sql`delete from roadmap_items where id = ${req.params.id} returning title, author_id`);
    if (!r) throw notFound('That item');
    await log(a.id, 'roadmap-delete', r.author_id ?? null, r.title, { id: req.params.id });
    return { deleted: true };
  });
}
