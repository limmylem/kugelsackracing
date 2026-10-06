// The signed-in player's own account (the game's account screens):
//   GET  /me                    who they are: name, role, guest or not, terms to accept, how they sign in
//   POST /me/terms              accept the current terms (a guest's or a social sign-up's first step)
//   GET  /me/name-check?name=   whether a display name is free and allowed
//   PATCH /me/name              change the display name (filtered, unique, at most once in 30 days)
//   POST /me/sign-out-everywhere every session of the account ended (this one too)
//   GET  /me/export             everything the server keeps about them, as JSON (privacy laws)
//   DELETE /me                  the account and its data deleted (confirm: "DELETE"; a password, or a recent sign-in)

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { fromNodeHeaders } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { AcceptTermsBody, ChangeNameBody, DeleteAccountBody, LIMITS, Me, NameCheck, Ok, z } from '@kr/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { Auth } from '../auth.ts';
import { termsProblem } from '../auth.ts';
import { sessionOf, type Guards } from '../session.ts';
import type { Mailer } from '../mail.ts';
import { AppError } from '../errors.ts';
import { nameProblem } from '../names.ts';
import { exportUserData } from '../data.ts';

const DAY = 864e5;

export async function meRoutes(app0: FastifyInstance, { config, db, auth, G }: { config: Config; db: Db; auth: Auth; G: Guards; mailer: Mailer }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const nameTaken = async (name: string, except: string | null = null) => (await db.execute(sql`select 1 from users where lower(name) = lower(${name}) and (${except}::text is null or id <> ${except}) limit 1`)).rows.length > 0;

  app.get('/me', { schema: { response: { 200: Me } } }, async (req, reply) => {
    const s = await G.requireUser(req);
    reply.header('cache-control', 'no-store');
    const providers = (await db.execute(sql`select provider_id from accounts where user_id = ${s.user.id}`)).rows.map((r: any) => r.provider_id as string);
    const next = s.user.nameChangedAt ? new Date(s.user.nameChangedAt.getTime() + LIMITS.nameChangeDays * DAY) : null;
    return {
      user: {
        id: s.user.id, email: s.user.isAnonymous ? null : s.user.email, emailVerified: s.user.emailVerified, displayName: s.user.name, role: s.user.role,
        isGuest: s.user.isAnonymous, needsTerms: s.user.termsVersion !== config.termsVersion,
        nameChangeAvailableAt: next && next > new Date() ? next.toISOString() : null, createdAt: s.user.createdAt.toISOString(),
        providers: s.user.isAnonymous ? ['anonymous'] : providers,
        twoFactor: (() => { const m = G.mfaState(s); return { enabled: s.user.twoFactorEnabled, verifiedAt: m.verifiedAt?.toISOString() ?? null, required: m.required }; })(),
      },
      terms: { version: config.termsVersion, privacyVersion: config.privacyVersion, minAge: config.minAge },
    };
  });

  app.post('/me/terms', { schema: { body: AcceptTermsBody, response: { 200: Ok } } }, async req => {
    const s = await G.requireUser(req);
    const why = termsProblem(config, req.body);
    if (why) throw new AppError(400, 'TERMS_REQUIRED', why);
    await db.execute(sql`update users set terms_version = ${config.termsVersion}, terms_accepted_at = now(), updated_at = now() where id = ${s.user.id}`);
    return { ok: true as const };
  });

  // (anyone: someone signing up checks the name they want — display names are public on the boards anyway)
  app.get('/me/name-check', { schema: { querystring: z.object({ name: z.string().max(100) }), response: { 200: NameCheck } } }, async req => {
    const s = await sessionOf(auth, req);
    const bad = nameProblem(req.query.name);
    if (bad) return { available: false, reason: bad };
    if (await nameTaken(req.query.name.trim(), s?.user.id ?? null)) return { available: false, reason: 'That name is taken.' };
    return { available: true };
  });

  app.patch('/me/name', { schema: { body: ChangeNameBody, response: { 200: Ok } } }, async req => {
    const s = await G.requireTerms(req);
    const name = req.body.displayName.trim();
    const bad = nameProblem(name);
    if (bad) throw new AppError(400, 'NAME_NOT_ALLOWED', bad);
    if (s.user.nameChangedAt && Date.now() - s.user.nameChangedAt.getTime() < LIMITS.nameChangeDays * DAY) {
      const at = new Date(s.user.nameChangedAt.getTime() + LIMITS.nameChangeDays * DAY);
      throw new AppError(429, 'NAME_CHANGE_TOO_SOON', `You can change your name again on ${at.toISOString().slice(0, 10)}.`, { availableAt: at.toISOString() });
    }
    if (await nameTaken(name, s.user.id)) throw new AppError(409, 'NAME_TAKEN', 'That name is taken: try another.');
    try { await db.execute(sql`update users set name = ${name}, name_changed_at = now(), updated_at = now() where id = ${s.user.id}`); }
    catch (e: any) { if (e?.code === '23505' || e?.cause?.code === '23505') throw new AppError(409, 'NAME_TAKEN', 'That name is taken: try another.'); throw e; }
    return { ok: true as const };
  });

  app.post('/me/sign-out-everywhere', { schema: { response: { 200: Ok } } }, async (req, reply) => {
    await G.requireUser(req);
    const r = await auth.api.revokeSessions({ headers: fromNodeHeaders(req.headers), returnHeaders: true });
    const cookies = r.headers?.getSetCookie?.() ?? [];
    // (this browser's cookie cleared too)
    reply.header('set-cookie', [...cookies, ...clearAuthCookies(config)]);
    return { ok: true as const };
  });

  app.get('/me/export', async (req, reply) => {
    const s = await G.requireUser(req);
    reply.header('cache-control', 'no-store').header('content-disposition', `attachment; filename="kugelsack-racing-${s.user.id}.json"`);
    return exportUserData(db, s.user.id);
  });

  app.delete('/me', { schema: { body: DeleteAccountBody, response: { 200: Ok } } }, async (req, reply) => {
    const s = await G.requireUser(req);
    if (s.user.role === 'admin') {
      const admins = (await db.execute(sql`select count(*)::int as n from users where role = 'admin'`)).rows[0] as any;
      if (admins.n <= 1) throw new AppError(409, 'CONFLICT', 'You\'re the only admin: make someone else an admin first.');
    }
    let r: any;
    try { r = await auth.api.deleteUser({ body: { ...(req.body.password ? { password: req.body.password } : {}) }, headers: fromNodeHeaders(req.headers), returnHeaders: true }); }
    catch (e: any) {
      const msg = String(e?.body?.code ?? e?.message ?? '');
      if (/SESSION_EXPIRED|fresh|SESSION_NOT_FRESH/i.test(msg)) throw new AppError(403, 'FORBIDDEN', 'For your safety, sign in again (or give your password) to delete your account.');
      if (/INVALID_PASSWORD|password/i.test(msg)) throw new AppError(403, 'FORBIDDEN', 'That password isn\'t right.');
      throw e;
    }
    reply.header('set-cookie', [...(r.headers?.getSetCookie?.() ?? []), ...clearAuthCookies(config)]);
    return { ok: true as const };
  });
}

// (the session cookies, expired: names as Better Auth makes them with our prefix)
function clearAuthCookies(config: Config) {
  const secure = config.cookieSecure ? '; Secure' : '';
  const pre = config.cookieSecure ? '__Secure-' : '';
  return ['session_token', 'session_data', 'dont_remember'].map(n => `${pre}kr.${n}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
}
