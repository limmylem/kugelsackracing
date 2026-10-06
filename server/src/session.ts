// Who's asking: the request's session (Better Auth, from its cookie — looked up once per request), and the
// guards every route uses. Roles are the server's (users.role); nothing the client says about itself counts.
//   requireUser: signed in (a guest counts) · requireTerms: and the current terms accepted
//   requireRole('editor'): an editor or admin · requireRole('admin'): an admin
//   requireFull: a full account (not a guest)

import type { FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { EDITOR_ROLES, type Role } from '@kr/shared';
import type { Auth } from './auth.ts';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';

export type SessionUser = {
  id: string; email: string; name: string; emailVerified: boolean; role: Role; isAnonymous: boolean;
  banned: boolean; termsVersion: string | null; nameChangedAt: Date | null; createdAt: Date;
};
export type RequestSession = { user: SessionUser; session: { id: string; token: string; createdAt: Date } } | null;

declare module 'fastify' {
  interface FastifyRequest { sessionCache?: Promise<RequestSession> }
}

export function sessionOf(auth: Auth, req: FastifyRequest): Promise<RequestSession> {
  return req.sessionCache ??= (async () => {
    if (!req.headers.cookie) return null;
    const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
    if (!s) return null;
    const u = s.user as any;
    return {
      user: { id: u.id, email: u.email, name: u.name, emailVerified: !!u.emailVerified, role: (u.role ?? 'player') as Role, isAnonymous: !!u.isAnonymous,
        banned: !!u.banned && (!u.banExpires || new Date(u.banExpires) > new Date()), termsVersion: u.termsVersion ?? null, nameChangedAt: u.nameChangedAt ? new Date(u.nameChangedAt) : null, createdAt: new Date(u.createdAt) },
      session: { id: s.session.id, token: s.session.token, createdAt: new Date(s.session.createdAt) },
    };
  })();
}

export function guards(auth: Auth, config: Config) {
  const requireUser = async (req: FastifyRequest) => {
    const s = await sessionOf(auth, req);
    if (!s) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in (or play as a guest) first.');
    if (s.user.banned) throw new AppError(403, 'BANNED', 'This account is suspended or banned.');
    return s;
  };
  const requireTerms = async (req: FastifyRequest) => {
    const s = await requireUser(req);
    if (s.user.termsVersion !== config.termsVersion) throw new AppError(403, 'TERMS_REQUIRED', 'Accept the current terms of service and privacy policy first.');
    return s;
  };
  const requireFull = async (req: FastifyRequest) => {
    const s = await requireTerms(req);
    if (s.user.isAnonymous) throw new AppError(403, 'FORBIDDEN', 'Make a full account first (your progress comes with you).');
    return s;
  };
  const requireRole = (role: 'editor' | 'admin') => async (req: FastifyRequest) => {
    const s = await requireTerms(req);
    const ok = role === 'admin' ? s.user.role === 'admin' : EDITOR_ROLES.includes(s.user.role);
    if (!ok || s.user.isAnonymous) throw new AppError(403, 'FORBIDDEN', role === 'admin' ? 'Only admins can do that.' : 'Only editor accounts can do that.');
    return s;
  };
  return { requireUser, requireTerms, requireFull, requireRole };
}
export type Guards = ReturnType<typeof guards>;
