// Accounts, through Better Auth (a proven library: the password hashing, sessions, cookies, OAuth, email
// verification and resets are all its own — none of it written here). What this adds is configuration and
// the game's rules around it:
//   - email + password (verified by email before the first sign-in where config.requireEmailVerification — not in
//     development, where a new account is signed in at once), password reset, Google and Discord when
//     their apps are set up (the tests use a mock OAuth server through the generic OAuth plugin)
//   - guests (the anonymous plugin): play first, then sign up — their records and replays move to the account
//   - display names: unique, filtered (names.ts); changed only through PATCH /api/v1/me/name (its limits)
//   - the terms and the minimum age: accepted on sign-up (only the check's result is kept, not the birth date);
//     a social or guest account accepts them before anything else (/api/v1/me/terms)
//   - roles player / editor / admin, bans and suspensions (the admin plugin); its endpoints are only used by
//     our admin API (routes/admin.ts: checked, logged), never called from a browser directly
//   - sessions: httpOnly cookies, Secure in staging and production, SameSite=Lax; every session can be signed
//     out at once; deleting an account deletes the player's data (routes/me.ts export first)

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { anonymous, admin, genericOAuth, twoFactor } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';
import { sql } from 'drizzle-orm';
import { SignUpExtra } from '@kr/shared';
import type { Config } from './config.ts';
import type { Db } from './db/index.ts';
import { users, sessions, accounts, verifications, twoFactors } from './db/schema.ts';
import { linkMail, type Mailer } from './mail.ts';
import { guestName, nameFromProfile, nameProblem, withTag } from './names.ts';

export const ac = createAccessControl(defaultStatements);
export const roles = {
  player: ac.newRole({ user: [], session: [] }),
  editor: ac.newRole({ user: [], session: [] }),
  admin: adminAc,
};

// how old someone is on a date, from a birth date (whole years)
export function ageOn(birth: string, today = new Date()): number {
  const [y, m, d] = birth.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age;
}
export function termsProblem(config: Config, body: unknown): string | null {
  const b = body as any;
  const p = SignUpExtra.safeParse({ acceptTerms: b?.acceptTerms ?? b?.termsVersion, birthDate: b?.birthDate });
  if (!p.success) return 'Accept the terms of service and privacy policy, and give your date of birth.';
  if (p.data.acceptTerms !== config.termsVersion) return 'The terms have changed: read and accept the current ones.';
  const age = ageOn(p.data.birthDate);
  if (!(age >= 0 && age < 130)) return 'That date of birth isn\'t right.';
  if (age < config.minAge) return `You need to be at least ${config.minAge} to play.`;
  return null;
}

export type GuestLink = (from: string, to: string) => Promise<void>;

export function createAuth({ config, db, mailer, onGuestLinked, onUserDeleted, onUserChanged = async () => {}, closedBeta = async () => false, mockOAuth = null }: {
  config: Config; db: Db; mailer: Mailer; onGuestLinked: GuestLink; onUserDeleted: (userId: string) => Promise<void>; onUserChanged?: (userId: string) => Promise<void>;
  closedBeta?: () => Promise<boolean>;
  mockOAuth?: { discoveryUrl: string; clientId: string; clientSecret: string } | null;
}) {
  const nameTaken = async (name: string) => (await db.execute(sql`select 1 from users where lower(name) = lower(${name}) limit 1`)).rows.length > 0;
  const freeName = async (name: string) => { let n = name; for (let k = 0; k < 6 && await nameTaken(n); k++) n = withTag(name); return n; };

  return betterAuth({
    appName: 'Kugelsack Racing',
    baseURL: config.publicUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, { provider: 'pg', schema: { user: users, session: sessions, account: accounts, verification: verifications, twoFactor: twoFactors } }),
    user: {
      additionalFields: {
        termsVersion: { type: 'string', required: false, input: false },
        termsAcceptedAt: { type: 'date', required: false, input: false },
        nameChangedAt: { type: 'date', required: false, input: false },
      },
      changeEmail: { enabled: false },
      deleteUser: {
        enabled: true,
        // (the player's own data goes with the account: results, records and replays by the database's
        // cascade; what they authored is kept but no longer theirs; the admins' log keeps the id only)
        beforeDelete: async user => { await onUserDeleted(user.id); },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: config.requireEmailVerification,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // (no email to confirm — development, on this computer: signed in as soon as the account is made)
      autoSignIn: !config.requireEmailVerification,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send(linkMail('reset-password', user.email, 'Reset your Kugelsack Racing password', 'Someone (we hope you) asked to reset the password for this account. To choose a new one, open this link within an hour:', url, 'If it wasn\'t you, ignore this email: your password stays as it is.'));
      },
    },
    emailVerification: {
      sendOnSignUp: config.requireEmailVerification,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send(linkMail('verify-email', user.email, 'Confirm your email for Kugelsack Racing', `Welcome, ${user.name}! Confirm this is your email address by opening this link (it works for a day):`, url, 'If you didn\'t sign up, ignore this email.'));
      },
    },
    socialProviders: {
      ...(config.social.google ? { google: { ...config.social.google, prompt: 'select_account' as const } } : {}),
      ...(config.social.discord ? { discord: { ...config.social.discord } } : {}),
    },
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    session: {
      expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, freshAge: 60 * 15,
      // (when this session passed two-factor sign-in: set by the hook below, never by the client)
      additionalFields: { mfaVerifiedAt: { type: 'date', required: false, input: false } },
    },
    advanced: {
      useSecureCookies: config.cookieSecure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      cookiePrefix: 'kr',
    },
    rateLimit: {
      enabled: config.env !== 'test',
      window: config.rateLimits.auth.windowSec,
      max: config.rateLimits.auth.max,
      customRules: {
        '/sign-in/email': { window: 60, max: 15 },
        '/sign-up/email': { window: config.rateLimits.signUp.windowSec, max: config.rateLimits.signUp.max },
        '/request-password-reset': { window: 3600, max: 5 },
        '/send-verification-email': { window: 3600, max: 5 },
        '/sign-in/anonymous': { window: 3600, max: 20 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const path = ctx?.path ?? '';
            if (path === '/sign-up/email') {
              // (the terms, the age; the name as the player chose it — refused if it's taken or not allowed)
              const why = termsProblem(config, ctx?.body);
              if (why) throw new APIError('BAD_REQUEST', { message: why, code: 'TERMS_REQUIRED' });
              const bad = nameProblem(user.name);
              if (bad) throw new APIError('BAD_REQUEST', { message: bad, code: 'NAME_NOT_ALLOWED' });
              if (await nameTaken(user.name)) throw new APIError('BAD_REQUEST', { message: 'That name is taken: try another.', code: 'NAME_TAKEN' });
              return { data: { ...user, name: user.name.trim(), role: 'player', termsVersion: config.termsVersion, termsAcceptedAt: new Date() } };
            }
            // (the closed beta: a new account needs an invite code, which only the email sign-up form takes — the server
            // checked it before this; a first social sign-in, or a new guest, waits for the open beta)
            if (await closedBeta()) throw new APIError('FORBIDDEN', { message: 'The game is in a closed beta: sign up with your invite code and your email.', code: 'INVITE_REQUIRED' });
            // a guest's generated name, or a social profile's: made to fit and unique; the terms still to accept
            const base = path === '/sign-in/anonymous' ? user.name : nameFromProfile(user.name);
            return { data: { ...user, name: await freeName(base), role: 'player', termsVersion: null, termsAcceptedAt: null } };
          },
          after: async user => { await onUserChanged(user.id); },
        },
        // (an email verified: the server's owner becomes an admin — owner.ts)
        update: { after: async user => { await onUserChanged(user.id); } },
      },
    },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        // (a display name changes only through our own endpoint, with its filter and limits)
        if (ctx.path === '/update-user' && ctx.body && 'name' in ctx.body) throw new APIError('BAD_REQUEST', { message: 'Change your display name from your account page.' });
        // (the game has no pictures for accounts: nothing is kept there — a link someone else's page might show)
        if (ctx.path === '/update-user' && ctx.body && 'image' in ctx.body) throw new APIError('BAD_REQUEST', { message: 'Accounts don\'t have pictures.' });
        // (two-factor sign-in every time: no "trust this device" — an editor's or admin's stolen laptop shouldn't be enough)
        if (ctx.path.startsWith('/two-factor/verify') && ctx.body && typeof ctx.body === 'object') return { context: { body: { ...ctx.body, trustDevice: false } } };
      }),
      after: createAuthMiddleware(async ctx => {
        // a session that just passed two-factor sign-in (signing in, or entering a code again in a signed-in
        // session; turning it on counts too): marked, so the editor's and admin's tools know it did
        if (!/^\/two-factor\/(verify-totp|verify-backup-code)$/.test(ctx.path)) return;
        const returned: any = ctx.context.returned;
        if (returned instanceof Error || (returned && typeof returned === 'object' && 'statusCode' in returned && returned.statusCode >= 400)) return;
        const id = ctx.context.newSession?.session.id ?? ctx.context.session?.session.id;
        if (id) await db.execute(sql`update sessions set mfa_verified_at = now() where id = ${id}`);
      }),
    },
    plugins: [
      anonymous({
        emailDomainName: 'guest.invalid',
        generateName: async () => freeName(guestName()),
        // (a guest who signs up or in, in the same browser: their results, records and replays come along)
        onLinkAccount: async ({ anonymousUser, newUser }) => { await onGuestLinked(anonymousUser.user.id, newUser.user.id); },
      }),
      // two-factor sign-in with an authenticator app (and backup codes): anyone can turn it on; editors and
      // admins must (session.ts requireRole). A password sign-in then asks for a code before there's a session.
      twoFactor({ issuer: 'Kugelsack Racing', skipVerificationOnEnable: false }),
      admin({ defaultRole: 'player', adminRoles: ['admin'], ac, roles, bannedUserMessage: 'This account is suspended or banned. If you think that\'s a mistake, contact support.' }),
      ...(mockOAuth ? [genericOAuth({ config: [{ providerId: 'mock', discoveryUrl: mockOAuth.discoveryUrl, clientId: mockOAuth.clientId, clientSecret: mockOAuth.clientSecret, scopes: ['openid', 'email', 'profile'], pkce: true }] })] : []),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
