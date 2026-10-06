// Writes applied once: every POST, PUT, PATCH and DELETE under /api/v1 carries an Idempotency-Key (8–128
// characters). The first request with a key runs and its answer is kept (24 hours); a retry with the same
// key gets that answer again (Idempotent-Replayed: true) without running again; the same key with a
// different request is refused (422); one still running answers 409. A failure on the server (5xx) isn't
// kept, so it can be retried. Keys are per account (or per address for a request that isn't signed in).

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, lt, sql } from 'drizzle-orm';
import { API_PREFIX, IDEMPOTENCY_HEADER, LIMITS } from '@kr/shared';
import type { Db } from './db/index.ts';
import { idempotencyKeys } from './db/schema.ts';
import { AppError } from './errors.ts';
import type { Auth } from './auth.ts';
import { sessionOf } from './session.ts';

declare module 'fastify' {
  interface FastifyRequest { idem?: { scope: string; key: string } }
  interface FastifyContextConfig { idempotent?: boolean }
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY = /^[A-Za-z0-9_.:-]+$/;

export function installIdempotency(app: FastifyInstance, { db, auth }: { db: Db; auth: Auth }) {
  app.addHook('preHandler', async (req, reply) => {
    if (!WRITES.has(req.method) || !req.url.startsWith(API_PREFIX) || req.routeOptions.config?.idempotent === false) return;
    const key = req.headers[IDEMPOTENCY_HEADER];
    if (typeof key !== 'string' || !key) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Every change needs an Idempotency-Key header (a fresh random id for each action).');
    if (key.length < LIMITS.idempotencyKey.min || key.length > LIMITS.idempotencyKey.max || !KEY.test(key)) throw new AppError(400, 'BAD_REQUEST', 'The Idempotency-Key must be 8–128 letters, digits, _ . : or -.');
    const s = await sessionOf(auth, req);
    const scope = s ? `u:${s.user.id}` : `ip:${req.ip}`;
    const hash = crypto.createHash('sha256').update(`${req.method} ${req.url}\n${JSON.stringify(req.body ?? null)}`).digest('hex');
    const inserted = await db.insert(idempotencyKeys).values({ scope, key, method: req.method, path: req.url.split('?')[0], requestHash: hash }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
    if (inserted.length) { req.idem = { scope, key }; return; }
    const [row] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    if (!row) throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'That action is still being applied: try again in a moment.');
    if (row.requestHash !== hash) throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'That Idempotency-Key was already used for a different request.');
    if (row.state !== 'done') throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'That action is still being applied: try again in a moment.');
    return reply.status(row.status ?? 200).header('idempotent-replayed', 'true').header('content-type', 'application/json; charset=utf-8').send(row.response);
  });
  app.addHook('onSend', async (req: FastifyRequest, reply, payload) => {
    const idem = req.idem;
    if (!idem) return payload;
    req.idem = undefined;
    const where = and(eq(idempotencyKeys.scope, idem.scope), eq(idempotencyKeys.key, idem.key));
    if (reply.statusCode >= 500) { await db.delete(idempotencyKeys).where(where); return payload; }
    let response: unknown = null;
    try { response = typeof payload === 'string' ? JSON.parse(payload) : null; } catch { response = null; }
    await db.update(idempotencyKeys).set({ state: 'done', status: reply.statusCode, response }).where(where);
    return payload;
  });
  // (kept a day, then forgotten)
  const sweep = async () => { try { await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, sql`now() - interval '24 hours'`)); } catch (e) { app.log.warn({ err: e }, 'idempotency sweep failed'); } };
  const timer = setInterval(sweep, 60 * 60 * 1000); timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
