// The server's owner (ADMIN_EMAIL): the account with that email becomes an admin once the email is verified
// (by the link, or by Google) — never before, so nobody can take the address first and get in. Checked at
// start (the account may already exist) and whenever an account is made or changes; once only (the log says
// so): an owner who steps down later stays as they chose. Other admins and editors are made on the admin page.

import { sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import type { Config } from './config.ts';
import { auditLog } from './db/schema.ts';

export async function promoteOwner(db: Db, config: Pick<Config, 'adminEmail'>, userId: string | null = null) {
  if (!config.adminEmail) return 0;
  const r = await db.execute(sql`update users set role = 'admin', updated_at = now()
    where lower(email) = ${config.adminEmail} and email_verified and not coalesce(is_anonymous, false) and role <> 'admin' ${userId ? sql`and id = ${userId}` : sql``}
      and not exists (select 1 from audit_log a where a.target_id = users.id and a.action = 'owner-admin')
    returning id, role`);
  for (const row of r.rows as any[]) await db.insert(auditLog).values({ actorId: null, action: 'owner-admin', targetId: row.id, reason: 'The server\'s owner (ADMIN_EMAIL), email verified', details: { to: 'admin' } });
  return r.rows.length;
}
