// The server's owner (ADMIN_EMAIL): the account with that email becomes an admin once the email is verified
// (by the link, or by Google) — never before, so nobody can take the address first and get in. Where emails aren't
// confirmed at all (config.requireEmailVerification off: development, on this computer) the account is the owner as
// soon as it's made. Checked at start (the account may already exist) and whenever an account is made or changes;
// once only (the log says so): an owner who steps down later stays as they chose. Other admins and editors are made
// on the admin page; `npm run owner -w @kr/server -- --email …` (tools/make-owner.ts) makes an owner on this computer.

import { sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import type { Config } from './config.ts';
import { auditLog } from './db/schema.ts';

export async function promoteOwner(db: Db, config: Pick<Config, 'adminEmail'> & { requireEmailVerification?: boolean }, userId: string | null = null) {
  if (!config.adminEmail) return 0;
  const verified = config.requireEmailVerification === false ? sql`true` : sql`email_verified`;
  const r = await db.execute(sql`update users set role = 'admin', updated_at = now()
    where lower(email) = ${config.adminEmail} and ${verified} and not coalesce(is_anonymous, false) and role <> 'admin' ${userId ? sql`and id = ${userId}` : sql``}
      and not exists (select 1 from audit_log a where a.target_id = users.id and a.action = 'owner-admin')
    returning id, role`);
  for (const row of r.rows as any[]) await db.insert(auditLog).values({ actorId: null, action: 'owner-admin', targetId: row.id, reason: 'The server\'s owner (ADMIN_EMAIL)', details: { to: 'admin' } });
  return r.rows.length;
}

// An owner made by hand (tools/make-owner.ts): the account with this email an admin, its email counted as confirmed
// and the current terms accepted — every control on the admin and editor pages. Logged like ADMIN_EMAIL's.
export async function makeOwner(db: Db, email: string, termsVersion: string) {
  const was = ((await db.execute(sql`select role from users where lower(email) = ${email.toLowerCase()} and not coalesce(is_anonymous, false)`)).rows as any[])[0]?.role ?? null;
  const r = await db.execute(sql`update users set role = 'admin', email_verified = true, banned = false, ban_reason = null, ban_expires = null,
      terms_version = coalesce(terms_version, ${termsVersion}), terms_accepted_at = coalesce(terms_accepted_at, now()), updated_at = now()
    where lower(email) = ${email.toLowerCase()} and not coalesce(is_anonymous, false) returning id, name`);
  const row = (r.rows as any[])[0] ?? null;
  if (row && was !== 'admin') await db.insert(auditLog).values({ actorId: null, action: 'owner-admin', targetId: row.id, reason: 'Made the owner on the server\'s own computer (tools/make-owner.ts)', details: { to: 'admin' } });
  return row as { id: string; name: string } | null;
}
