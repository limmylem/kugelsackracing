// Keeping personal data only as long as it's needed (Phase 6 Step 5; docs/PRIVACY_DATA.md): what's deleted and when,
// once a day on every server (the work is idempotent, so two servers doing it is harmless), and from the admin page.
//
//   guests          a guest account nobody has played for guestInactiveDays: deleted, with everything it had
//   sessions        expired ones, sessionsExpiredDays after expiry (Better Auth refuses them anyway)
//   verifications   email and reset links, and two-factor sign-in steps, once expired
//   accountSignals  what links accounts (hashed browser ids, addresses), signalsDays after last seen
//   support         support and feedback messages, supportDays after they were sent
//   reports         resolved reports, reportsDays after resolution (open ones wait for an admin)
//   flags           reviewed abuse flags, flagsDays after review
//   inviteUses      who used an invite code (the email's hash), inviteUsesDays after use
//   audit           the admins' log, auditDays after the action
//   alerts          cleared alerts, alertsDays after
// Results, records, replays, the ledger and the save stay while the account does (deleting the account deletes them).

import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { deleteUserData } from '../data.ts';

export type RetentionRules = {
  guestInactiveDays: number; sessionsExpiredDays: number; signalsDays: number; supportDays: number; reportsDays: number;
  flagsDays: number; inviteUsesDays: number; auditDays: number; alertsDays: number;
};
export const DEFAULT_RETENTION: RetentionRules = { guestInactiveDays: 30, sessionsExpiredDays: 7, signalsDays: 90, supportDays: 365, reportsDays: 365, flagsDays: 365, inviteUsesDays: 365, auditDays: 730, alertsDays: 90 };

export async function runRetention(db: Db, R: RetentionRules = DEFAULT_RETENTION, { dryRun = false } = {}) {
  const n = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)).rows[0] as any)?.n ?? 0);
  const del = async (count: ReturnType<typeof sql>, remove: ReturnType<typeof sql>) => dryRun ? n(count) : (await db.execute(remove)).rowCount ?? 0;
  const out: Record<string, number> = {};
  // guests nobody has played for a while: their last session, the save's last change, the account's
  const guests = (await db.execute(sql`select u.id from users u left join player_economy e on e.user_id = u.id
    where u.is_anonymous and greatest(u.updated_at, u.created_at, coalesce(e.updated_at, u.created_at), coalesce((select max(s.updated_at) from sessions s where s.user_id = u.id), u.created_at))
      < now() - make_interval(days => ${R.guestInactiveDays}) limit 5000`)).rows.map((r: any) => r.id as string);
  out.guests = guests.length;
  if (!dryRun) for (const id of guests) { await deleteUserData(db, id); await db.execute(sql`delete from users where id = ${id}`); }
  out.sessions = await del(sql`select count(*) as n from sessions where expires_at < now() - make_interval(days => ${R.sessionsExpiredDays})`, sql`delete from sessions where expires_at < now() - make_interval(days => ${R.sessionsExpiredDays})`);
  out.verifications = await del(sql`select count(*) as n from verifications where expires_at < now()`, sql`delete from verifications where expires_at < now()`);
  out.accountSignals = await del(sql`select count(*) as n from account_signals where last_seen < now() - make_interval(days => ${R.signalsDays})`, sql`delete from account_signals where last_seen < now() - make_interval(days => ${R.signalsDays})`);
  out.support = await del(sql`select count(*) as n from support_tickets where created_at < now() - make_interval(days => ${R.supportDays})`, sql`delete from support_tickets where created_at < now() - make_interval(days => ${R.supportDays})`);
  out.reports = await del(sql`select count(*) as n from reports where status <> 'open' and resolved_at < now() - make_interval(days => ${R.reportsDays})`, sql`delete from reports where status <> 'open' and resolved_at < now() - make_interval(days => ${R.reportsDays})`);
  out.flags = await del(sql`select count(*) as n from abuse_flags where status <> 'open' and reviewed_at < now() - make_interval(days => ${R.flagsDays})`, sql`delete from abuse_flags where status <> 'open' and reviewed_at < now() - make_interval(days => ${R.flagsDays})`);
  out.inviteUses = await del(sql`select count(*) as n from invite_uses where used_at < now() - make_interval(days => ${R.inviteUsesDays})`, sql`delete from invite_uses where used_at < now() - make_interval(days => ${R.inviteUsesDays})`);
  out.audit = await del(sql`select count(*) as n from audit_log where at < now() - make_interval(days => ${R.auditDays})`, sql`delete from audit_log where at < now() - make_interval(days => ${R.auditDays})`);
  out.alerts = await del(sql`select count(*) as n from alerts where state = 'resolved' and last_at < now() - make_interval(days => ${R.alertsDays})`, sql`delete from alerts where state = 'resolved' and last_at < now() - make_interval(days => ${R.alertsDays})`);
  return { dryRun, deleted: out };
}
