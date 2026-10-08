// A player's report of another (Phase 6 Step 5; docs/ABUSE.md): from the account pages (POST /reports) and from the
// game's multiplayer screens (Phase 7 Step 2: a lobby's player list, through the real-time server's hub). The same
// rules either way: not yourself, REPORTS_PER_DAY a day, one open report of a kind per player.

import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { AppError, notFound } from '../errors.ts';

export const REPORT_KINDS = ['cheating', 'name', 'behaviour', 'other'] as const;
export const REPORTS_PER_DAY = 10;
export type ReportRef = { eventId?: string; replayId?: string; resultId?: string; place?: string; raceId?: string; roomId?: string };

export async function fileReport(db: Db, reporterId: string, b: { targetId?: string; targetName?: string; kind: typeof REPORT_KINDS[number]; details: string; ref?: ReportRef }) {
  const t = (await db.execute(b.targetId ? sql`select id, name from users where id = ${b.targetId}` : sql`select id, name from users where lower(name) = lower(${b.targetName!})`)).rows[0] as any;
  if (!t) throw notFound('That player');
  if (t.id === reporterId) throw new AppError(400, 'BAD_REQUEST', 'You can\'t report yourself.');
  const today = Number(((await db.execute(sql`select count(*) as n from reports where reporter_id = ${reporterId} and created_at > now() - interval '24 hours'`)).rows[0] as any).n);
  if (today >= REPORTS_PER_DAY) throw new AppError(429, 'RATE_LIMITED', `You can send ${REPORTS_PER_DAY} reports a day: thanks — the admins are looking at them.`);
  // (the same report again while the first is open: one is enough)
  const open = (await db.execute(sql`select id from reports where reporter_id = ${reporterId} and target_id = ${t.id} and kind = ${b.kind} and status = 'open' limit 1`)).rows[0] as any;
  if (open) return { ok: true as const, id: Number(open.id), already: true };
  const r = (await db.execute(sql`insert into reports (reporter_id, target_id, target_name, kind, details, ref) values (${reporterId}, ${t.id}, ${t.name}, ${b.kind}, ${b.details}, ${b.ref ? JSON.stringify(b.ref) : null}::jsonb) returning id`)).rows[0] as any;
  return { ok: true as const, id: Number(r.id), already: false };
}
