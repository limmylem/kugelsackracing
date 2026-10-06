// The player's economy (Phase 6 Step 2; economy/service.ts): the game asks, the server decides.
//   GET  /player                       the player's economy now (their profile, its revision, the settings' version)
//   POST /player/actions/:action       { args } → the action's answer and the profile after it
//                                      (refused: 409 REFUSED, the reason in plain words, the profile as it is)
//   GET  /player/events                changes as they happen (server-sent events: { rev }) — another tab or device
//   GET  /player/config                the economy's settings, read-only (prices to show; the server charges by its own)
//   GET  /player/ledger                the player's own money changes, newest first
//   GET  /player/recordings/:id        a best run's recording (a ghost)
//   POST /player/drives · /player/sessions/:id/heartbeat · /player/drives/:id/end    drives (free roam, test drives)
// Every one: a signed-in player (a guest counts) who has accepted the terms. Every write: an Idempotency-Key.

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DriveStart, LIMITS, PLAYER_ACTION_ARGS, PlayerActionBody, z } from '@kr/shared';
import type { Guards } from '../session.ts';
import { AppError } from '../errors.ts';
import { PLAYER_ACTIONS, type Economy, type PlayerAction } from '../economy/service.ts';
import type { EconomyConfig } from '../economy/config.ts';

export async function playerRoutes(app0: FastifyInstance, { economy, config: econ, G }: { economy: Economy; config: EconomyConfig; G: Guards }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const who = async (req: any) => { const s = await G.requireTerms(req); return { id: s.user.id, name: s.user.name }; };

  app.get('/player', async (req, reply) => {
    reply.header('cache-control', 'private, no-store');
    const r = await economy.state(await who(req));
    return { ok: true, profile: r.profile, rev: r.rev, configVersion: r.configVersion, notices: r.notices };
  });

  app.post('/player/actions/:action', { bodyLimit: LIMITS.resultBytes, schema: { params: z.object({ action: z.enum(PLAYER_ACTIONS) }), body: PlayerActionBody } }, async (req, reply) => {
    const user = await who(req), action = req.params.action as PlayerAction;
    const parsed = (PLAYER_ACTION_ARGS as any)[action].safeParse(req.body.args);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      throw new AppError(400, 'VALIDATION', `That request isn't right: ${i.path.join('.') || 'args'}: ${i.message}`, parsed.error.issues.slice(0, 10).map((x: any) => ({ path: x.path.join('.'), message: x.message })));
    }
    const r = await economy.act(user, action, parsed.data, { idemKey: (req.headers['idempotency-key'] as string) ?? null });
    // (said no: the reason, and the profile as it stands — the game puts back what it showed)
    if (!r.ok) throw new AppError(409, 'REFUSED', r.error ?? 'That can\'t be done.', { updatedState: r.updatedState, rev: r.rev, reasons: r.reasons ?? undefined });
    reply.header('cache-control', 'no-store');
    return r;
  });

  // ---------- another tab or device: the changes as they happen ----------
  app.get('/player/events', async (req, reply) => {
    const user = await who(req);
    reply.hijack();
    const res = reply.raw;
    // (the headers set so far — CORS for the game's own address, the security headers — kept: the stream is written
    // past Fastify's reply)
    res.writeHead(200, { ...reply.getHeaders(), 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' } as any);
    res.write(`retry: 3000\n\n`);
    const on = (userId: string, rev: number) => { if (userId === user.id) res.write(`event: change\ndata: ${JSON.stringify({ rev })}\n\n`); };
    economy.events.on('change', on);
    const beat = setInterval(() => res.write(': still here\n\n'), 25_000);
    req.raw.on('close', () => { clearInterval(beat); economy.events.off('change', on); });
  });

  app.get('/player/config', async (req, reply) => {
    const a = await econ.active(), tag = `"e${a.version}"`;
    reply.header('etag', tag).header('cache-control', 'public, max-age=60');
    if (req.headers['if-none-match'] === tag) return reply.status(304).send();
    return { version: a.version, economy: a.data.economy, quests: a.data.quests };
  });

  app.get('/player/ledger', { schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.number().int().positive().optional() }) } }, async (req, reply) => {
    const user = await who(req);
    reply.header('cache-control', 'private, no-store');
    const { sql } = await import('drizzle-orm');
    const rows = (await app.deps.db.execute(sql`select id, amount, balance_after, kind, reason, ref, session_id, at from ledger where user_id = ${user.id} ${req.query.before ? sql`and id < ${req.query.before}` : sql``} order by id desc limit ${req.query.limit}`)).rows as any[];
    return { entries: rows.map(r => ({ id: Number(r.id), amount: Number(r.amount), balanceAfter: Number(r.balance_after), kind: r.kind, reason: r.reason, ref: r.ref, sessionId: r.session_id, at: new Date(r.at).toISOString() })) };
  });

  app.get('/player/recordings/:id', { schema: { params: z.object({ id: z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/) }) } }, async (req, reply) => {
    const user = await who(req);
    const { sql } = await import('drizzle-orm'), zlib = await import('node:zlib');
    const r = (await app.deps.db.execute(sql`select data from player_recordings where user_id = ${user.id} and id = ${req.params.id}`)).rows[0] as any;
    if (!r) throw new AppError(404, 'NOT_FOUND', 'There\'s no recording of that run.');
    reply.header('cache-control', 'private, max-age=3600');
    return { recording: JSON.parse(zlib.gunzipSync(r.data).toString('utf8')) };
  });

  // ---------- drives ----------
  app.post('/player/drives', { schema: { body: DriveStart } }, async req => economy.startDrive(await who(req), req.body));
  const Sid = z.object({ id: z.string().regex(/^(ses|drv)_[0-9a-f-]{36}$/) });
  app.post('/player/sessions/:id/heartbeat', { schema: { params: Sid } }, async req => economy.heartbeat(await who(req), req.params.id));
  app.post('/player/drives/:id/end', { schema: { params: Sid } }, async req => economy.endDrive(await who(req), req.params.id));
}
