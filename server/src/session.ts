// Who's asking: the request's session (Better Auth, from its cookie — looked up once per request), and the
// guards every route uses. Roles are the server's (users.role); nothing the client says about itself counts.
//   requireUser: signed in (a guest counts) · requireTerms: and the current terms accepted
//   requireRole('editor'): an editor or admin · requireRole('admin'): an admin
//   requireFull: a full account (not a guest)
// Editors and admins (config.staffMfa): their role's tools also need a session that passed two-factor sign-in, at
// most staffMfa.maxAgeHours ago — 403 MFA_REQUIRED (details.setup: two-factor isn't on yet; else a code again).

import type { FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { EDITOR_ROLES, type Role } from '@kr/shared';
import type { Auth } from './auth.ts';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';

export type SessionUser = {
  id: string; email: string; name: string; emailVerified: boolean; role: Role; isAnonymous: boolean;
  banned: boolean; termsVersion: string | null; nameChangedAt: Date | null; createdAt: Date; twoFactorEnabled: boolean;
};
export type RequestSession = { user: SessionUser; session: { id: string; token: string; createdAt: Date; mfaVerifiedAt: Date | null } } | null;

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
        banned: !!u.banned && (!u.banExpires || new Date(u.banExpires) > new Date()), termsVersion: u.termsVersion ?? null, nameChangedAt: u.nameChangedAt ? new Date(u.nameChangedAt) : null, createdAt: new Date(u.createdAt),
        twoFactorEnabled: !!u.twoFactorEnabled },
      session: { id: s.session.id, token: s.session.token, createdAt: new Date(s.session.createdAt), mfaVerifiedAt: (s.session as any).mfaVerifiedAt ? new Date((s.session as any).mfaVerifiedAt) : null },
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
    const mfa = mfaState(s);
    if (mfa.required && !mfa.ok) {
      throw new AppError(403, 'MFA_REQUIRED', !s.user.twoFactorEnabled
        ? 'Editor and admin accounts need two-factor sign-in: turn it on from your account page (an authenticator app).'
        : 'Enter the code from your authenticator app to carry on (editor and admin tools ask for it again every few hours).', { setup: !s.user.twoFactorEnabled });
    }
    return s;
  };
  // two-factor sign-in, for a session: whether its role needs it, and whether this session passed it recently enough
  const mfaState = (s: NonNullable<RequestSession>) => {
    const required = config.staffMfa.required && EDITOR_ROLES.includes(s.user.role) && !s.user.isAnonymous;
    const at = s.session.mfaVerifiedAt, fresh = !!at && Date.now() - at.getTime() <= config.staffMfa.maxAgeHours * 3600e3;
    return { required, ok: s.user.twoFactorEnabled && fresh, verifiedAt: at };
  };
  return { requireUser, requireTerms, requireFull, requireRole, mfaState };
}
export type Guards = ReturnType<typeof guards>;
