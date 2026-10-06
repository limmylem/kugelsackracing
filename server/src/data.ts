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
      insert into track_records (user_id, code, version, car_class, best_time, best_lap, best_score, result_id, runs, replay_id, at)
      select ${to}, code, version, car_class, best_time, best_lap, best_score, result_id, runs, replay_id, at from track_records where user_id = ${from}
      on conflict (user_id, code, version, car_class) do update set
        best_time = least(track_records.best_time, excluded.best_time),
        best_lap = least(track_records.best_lap, excluded.best_lap),
        best_score = greatest(track_records.best_score, excluded.best_score),
        runs = track_records.runs + excluded.runs,
        result_id = case when excluded.best_time < track_records.best_time or excluded.best_score > track_records.best_score then excluded.result_id else track_records.result_id end,
        replay_id = case when excluded.best_time < track_records.best_time or excluded.best_score > track_records.best_score then excluded.replay_id else track_records.replay_id end`);
    await tx.execute(sql`delete from track_records where user_id = ${from}`);
    // the economy (Phase 6 Step 2): the guest's comes with them — if the account hasn't one of its own yet
    const has = (await tx.execute(sql`select 1 from player_economy where user_id = ${to}`)).rows.length;
    if (!has && (await tx.execute(sql`select 1 from player_economy where user_id = ${from}`)).rows.length) {
      await tx.execute(sql`select set_config('kr.ledger_move', 'on', true)`);
      await tx.execute(sql`set constraints all deferred`);
      await tx.execute(sql`update player_economy set user_id = ${to} where user_id = ${from}`);
      await tx.execute(sql`update ledger set user_id = ${to} where user_id = ${from}`);
      for (const t of ['owned_cars', 'owned_parts', 'car_build_slots', 'quest_progress', 'item_history', 'economy_sessions', 'player_recordings']) await tx.execute(sql`update ${sql.raw(t)} set user_id = ${to} where user_id = ${from}`);
    }
  });
}

export async function deleteUserData(db: Db, userId: string) {
  // (the ledger is append-only: an account's rows go with it only here, the rule lifted for this transaction)
  await db.transaction(async tx => {
    await tx.execute(sql`select set_config('kr.ledger_delete', 'on', true)`);
    await tx.execute(sql`delete from ledger where user_id = ${userId}`);
    await tx.execute(sql`delete from player_economy where user_id = ${userId}`);
  });
  // (their results, records, replays and sessions go with the users row: on delete cascade. What they authored
  // as an editor stays in the world, its author cleared — on delete set null — and so do the admins' log entries)
  await db.execute(sql`delete from idempotency_keys where scope = ${`u:${userId}`}`);
  // (Phase 6 Step 5) what links them to other accounts, the invite they used, and their id in abuse flags: gone too
  // (reports they made stay for the reported player's sake, without them — on delete set null; their support messages,
  // reports about them and two-factor secret go by the cascade)
  await db.execute(sql`delete from account_signals where user_id = ${userId}`);
  await db.execute(sql`delete from invite_uses where user_id = ${userId}`);
  await db.execute(sql`update abuse_flags set user_ids = array_remove(user_ids, ${userId}) where ${userId} = any(user_ids)`);
  await db.execute(sql`delete from abuse_flags where cardinality(user_ids) = 0`);
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
    trackResults: await one(sql`select event_id, kind, code, version, car_class, type, time, rank, score, best_lap, laps, accepted, problems, replay_id, at from track_results where user_id = ${userId} order by at`),
    trackRecords: await one(sql`select code, version, car_class, best_time, best_lap, best_score, runs, replay_id, at from track_records where user_id = ${userId}`),
    replays: await one(sql`select id, event_id, code, title, duration, cars, bytes, created_at from replays where owner_id = ${userId} order by created_at`),
    worldContent: await one(sql`select id, view, kind, (data->>'name') as name, created_at, updated_at, published_at from content_items where author_id = ${userId}`),
    adminActions: await one(sql`select at, action, reason from audit_log where target_id = ${userId} order by at`),
    // (Phase 6 Steps 2–5: the economy is the server's — the save, money, cars, parts, quest progress and their history)
    economy: (await one(sql`select balance, xp, level, profile_version, current_car, state, created_at, updated_at from player_economy where user_id = ${userId}`))[0] ?? null,
    ledger: await one(sql`select amount, balance_after, kind, reason, ref, at from ledger where user_id = ${userId} order by id`),
    cars: await one(sql`select * from owned_cars where user_id = ${userId}`),
    parts: await one(sql`select * from owned_parts where user_id = ${userId}`),
    questProgress: await one(sql`select * from quest_progress where user_id = ${userId}`),
    itemHistory: await one(sql`select item_type, instance_id, event, details, at from item_history where user_id = ${userId} order by id`),
    runs: await one(sql`select id, kind, quest_id, car_instance_id, state, end_reason, started_at, ended_at from economy_sessions where user_id = ${userId} order by started_at`),
    twoFactor: { enabled: !!((await one(sql`select two_factor_enabled from users where id = ${userId}`))[0] as any)?.two_factor_enabled, note: 'The authenticator\'s secret and backup codes are kept encrypted and aren\'t shown here.' },
    // what links accounts for abuse review: the addresses you played from, and your browser's id as kept (scrambled)
    accountLinks: await one(sql`select kind, value, first_seen, last_seen, hits from account_signals where user_id = ${userId} order by kind, last_seen desc`),
    reportsMade: await one(sql`select kind, target_name, details, status, created_at from reports where reporter_id = ${userId} order by created_at`),
    reportsAboutYou: await one(sql`select kind, status, resolution, created_at from reports where target_id = ${userId} order by created_at`),
    supportMessages: await one(sql`select kind, category, message, contact_email, client, status, created_at from support_tickets where user_id = ${userId} order by created_at`),
    note: 'Also kept in your browser (not on the server): your settings, the game\'s random browser id, map files and ghost recordings.',
  };
}
