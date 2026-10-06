// A player's data across the tables: moved when a guest becomes a full account (their results, records and
// replays come with them — the better record kept where both have one), deleted with an account (results,
// records and replays by the database's cascade; content they wrote stays, no longer theirs), and gathered
// for a data export.

import { sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';

export async function moveGuestData(db: Db, from: string, to: string) {
  if (from === to) return;
  await db.transaction(async tx => {
    await tx.execute(sql`update track_results set user_id = ${to} where user_id = ${from}`);
    await tx.execute(sql`update replays set owner_id = ${to} where owner_id = ${from}`);
    // (records: the guest's where the account has none for that track and class, or a better one)
    await tx.execute(sql`
      insert into track_records (user_id, code, version, car_class, best_time, best_lap, replay_id, at)
      select ${to}, code, version, car_class, best_time, best_lap, replay_id, at from track_records where user_id = ${from}
      on conflict (user_id, code, version, car_class) do update set
        best_time = least(track_records.best_time, excluded.best_time),
        best_lap = least(track_records.best_lap, excluded.best_lap),
        replay_id = case when excluded.best_time < track_records.best_time then excluded.replay_id else track_records.replay_id end`);
    await tx.execute(sql`delete from track_records where user_id = ${from}`);
  });
}

export async function deleteUserData(db: Db, userId: string) {
  // (their results, records, replays and sessions go with the users row: on delete cascade. What they authored
  // as an editor stays in the world, its author cleared — on delete set null — and so do the admins' log entries)
  await db.execute(sql`delete from idempotency_keys where scope = ${`u:${userId}`}`);
}

export async function exportUserData(db: Db, userId: string) {
  const one = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows;
  const [user] = await one(sql`select id, name as display_name, email, email_verified, image, created_at, updated_at, is_anonymous, role, banned, ban_reason, ban_expires, terms_version, terms_accepted_at, name_changed_at from users where id = ${userId}`);
  return {
    format: 'kugelsack-racing-account-export', version: 1, exported: new Date().toISOString(),
    account: user ?? null,
    // (how they sign in — never the password's hash or any provider token)
    signIns: await one(sql`select provider_id, account_id, scope, created_at from accounts where user_id = ${userId}`),
    sessions: await one(sql`select created_at, updated_at, expires_at, ip_address, user_agent from sessions where user_id = ${userId}`),
    trackResults: await one(sql`select event_id, kind, code, version, car_class, type, time, best_lap, laps, accepted, problems, replay_id, at from track_results where user_id = ${userId} order by at`),
    trackRecords: await one(sql`select code, version, car_class, best_time, best_lap, replay_id, at from track_records where user_id = ${userId}`),
    replays: await one(sql`select id, event_id, code, title, duration, cars, bytes, created_at from replays where owner_id = ${userId} order by created_at`),
    worldContent: await one(sql`select id, view, kind, (data->>'name') as name, created_at, updated_at, published_at from content_items where author_id = ${userId}`),
    adminActions: await one(sql`select at, action, reason from audit_log where target_id = ${userId} order by at`),
    note: 'Your game progress (cars, parts, money, quest bests) is kept in your browser in this version of the game: it is not on the server yet.',
  };
}
