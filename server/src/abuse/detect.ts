// Several accounts used by one person to farm or pass on money and items (Phase 6 Step 5; docs/ABUSE.md). Nothing
// here acts on an account: it flags accounts for an admin to look at (the admin page's Reports & flags), with
// what was seen, because a family or a school shares a computer and a phone network shares addresses.
//
// What links accounts (account_signals, 90 days): the game's random device id (kept only as an HMAC with the
// server's secret: the id itself can't be read back) and the address each account used. Recorded at most every
// 10 minutes per account and value. What's flagged (each flag once per group of accounts; seen again, updated):
//   shared-device   two or more accounts from the same browser
//   signup-burst    four or more new accounts from one address within a day
//   farm-group      three or more accounts linked by a device, each earning in its first days and passing value on
//                   (selling everything, or losing its cars in pink slips): accounts made to feed another
//   earning-rate    an account earning far faster than playing allows (economy settings: abuse.maxRewardPerHour)
// Scores: higher is more likely; the queue is sorted by them. Thresholds in config/<env>.json abuse.
// (Phase 7 Step 5) the game's own checks flag too — flagForReview — rather than acting (the owner: flag, never ban):
//   live-checks       the race server dropped a player's impossible car states, again and again (rt/room.ts)
//   mp-verify         a race's run that failed its check, kept (antiCheat.action 'flag': mp/service.ts)
//   challenge-verify  a free-roam challenge's record that failed its check, kept and paid (roam/service.ts)

import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';

export type AbuseRules = { maxRewardPerHour: number; burstAccounts: number; farmGroup: number; keepDays: number };
export const DEFAULT_RULES: AbuseRules = { maxRewardPerHour: 60_000, burstAccounts: 4, farmGroup: 3, keepDays: 90 };

const DEVICE = /^[0-9a-f-]{20,64}$/i;
export function createSignals(db: Db, secret: string) {
  const recent = new Map<string, number>();
  const hash = (v: string) => crypto.createHmac('sha256', secret).update(`device:${v}`).digest('hex').slice(0, 32);
  async function note(userId: string, kind: 'device' | 'ip', value: string) {
    const key = `${userId}|${kind}|${value}`, now = Date.now();
    if ((recent.get(key) ?? 0) > now - 600_000) return;
    recent.set(key, now);
    if (recent.size > 50_000) for (const [k, t] of recent) if (t < now - 600_000) recent.delete(k);
    await db.execute(sql`insert into account_signals (user_id, kind, value) values (${userId}, ${kind}, ${value})
      on conflict (user_id, kind, value) do update set last_seen = now(), hits = account_signals.hits + 1`);
  }
  return {
    // a request from a signed-in account: its device id (if it sent a sensible one) and address
    async seen(userId: string, deviceId: string | undefined, ip: string) {
      const jobs = [ip ? note(userId, 'ip', ip) : null, deviceId && DEVICE.test(deviceId) ? note(userId, 'device', hash(deviceId)) : null].filter(Boolean);
      await Promise.all(jobs).catch(() => {});
    },
    hash,
  };
}
export type Signals = ReturnType<typeof createSignals>;

type Flag = { kind: string; userIds: string[]; score: number; evidence: object };

export async function scanForAbuse(db: Db, rules: AbuseRules = DEFAULT_RULES): Promise<{ flagged: number; kinds: Record<string, number> }> {
  const flags: Flag[] = [];
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as any[];
  // shared devices (90 days)
  for (const r of await rows(sql`select value, array_agg(distinct user_id order by user_id) as users, min(first_seen) as first, max(last_seen) as last
      from account_signals where kind = 'device' and last_seen > now() - make_interval(days => ${rules.keepDays}) group by value having count(distinct user_id) >= 2`)) {
    flags.push({ kind: 'shared-device', userIds: r.users, score: Math.min(90, 40 + 10 * (r.users.length - 2)), evidence: { device: `${r.value.slice(0, 8)}…`, accounts: r.users.length, firstSeen: r.first, lastSeen: r.last } });
  }
  // sign-up bursts: accounts made within a day of each other, first seen from the same address
  // (the address each new account was first seen at: its first session's — kept by Better Auth — or a request's)
  for (const r of await rows(sql`with seen as (select user_id, value, first_seen as at from account_signals where kind = 'ip'
        union all select user_id, ip_address, created_at from sessions where ip_address is not null and ip_address <> ''),
      firsts as (select distinct on (s.user_id) s.user_id, s.value, u.created_at from seen s join users u on u.id = s.user_id
        where u.created_at > now() - interval '7 days' order by s.user_id, s.at)
      select value, array_agg(user_id order by user_id) as users, min(created_at) as first, max(created_at) as last from firsts
      group by value having count(*) >= ${rules.burstAccounts} and max(created_at) - min(created_at) < interval '24 hours'`)) {
    flags.push({ kind: 'signup-burst', userIds: r.users, score: Math.min(80, 25 + 5 * r.users.length), evidence: { address: maskIp(r.value), accounts: r.users.length, from: r.first, to: r.last } });
  }
  // farm groups: linked by a device; each earned rewards and then sold or lost what it had
  for (const r of await rows(sql`with groups as (select value, array_agg(distinct user_id) as users from account_signals where kind = 'device' group by value having count(distinct user_id) >= ${rules.farmGroup}),
      member as (select g.value, unnest(g.users) as user_id from groups g),
      money as (select m.value, m.user_id, coalesce(sum(l.amount) filter (where l.kind = 'reward'), 0) as earned, coalesce(sum(l.amount) filter (where l.kind = 'sale'), 0) as sold,
        count(*) filter (where l.reason ilike '%pink slip%' or l.reason ilike '%forfeit%') as lost
        from member m left join ledger l on l.user_id = m.user_id and l.at > now() - interval '30 days' group by m.value, m.user_id)
      select value, array_agg(user_id order by user_id) as users, sum(earned)::bigint as earned, sum(sold)::bigint as sold, sum(lost)::int as lost,
        count(*) filter (where earned > 0 and (sold > 0 or lost > 0))::int as feeders
      from money group by value`)) {
    if (r.feeders >= rules.farmGroup) flags.push({ kind: 'farm-group', userIds: r.users, score: Math.min(95, 60 + 5 * r.feeders), evidence: { device: `${r.value.slice(0, 8)}…`, accounts: r.users.length, feeders: r.feeders, earned: Number(r.earned), sold: Number(r.sold), carsLost: r.lost } });
  }
  // earning faster than the game pays (any hour in the last day)
  for (const r of await rows(sql`select user_id, date_trunc('hour', at) as hour, sum(amount)::bigint as earned from ledger
      where kind = 'reward' and amount > 0 and at > now() - interval '24 hours' group by user_id, hour having sum(amount) > ${rules.maxRewardPerHour}`)) {
    flags.push({ kind: 'earning-rate', userIds: [r.user_id], score: Math.min(90, 50 + Math.round(10 * Number(r.earned) / rules.maxRewardPerHour)), evidence: { hour: r.hour, earned: Number(r.earned), limit: rules.maxRewardPerHour } });
  }
  const kinds: Record<string, number> = {};
  for (const f of flags) {
    const key = `${f.kind}:${[...f.userIds].sort().join(',')}`;
    // (one flag per group: seen again, its evidence and score brought up to date; a dismissed one stays dismissed
    // unless the group grows — then it's a new key)
    await db.execute(sql`insert into abuse_flags (kind, key, user_ids, score, evidence) values (${f.kind}, ${key}, array(select jsonb_array_elements_text(${JSON.stringify(f.userIds)}::jsonb)), ${f.score}, ${JSON.stringify(f.evidence)}::jsonb)
      on conflict (key) do update set score = excluded.score, evidence = excluded.evidence, updated_at = now()`);
    kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  }
  return { flagged: flags.length, kinds };
}

// a flag from the game's own checks: once per key (the same one again — a retry, the next few minutes' — brings its
// evidence up to date; a dismissed one stays dismissed)
export const FLAG_KINDS = ['live-checks', 'mp-verify', 'challenge-verify'] as const;
export async function flagForReview(db: Db, f: { kind: typeof FLAG_KINDS[number]; key: string; userIds: string[]; score: number; evidence: object }) {
  if (!FLAG_KINDS.includes(f.kind) || !f.userIds.length) return { ok: false as const };
  await db.execute(sql`insert into abuse_flags (kind, key, user_ids, score, evidence) values (${f.kind}, ${`${f.kind}:${f.key}`.slice(0, 300)}, array(select jsonb_array_elements_text(${JSON.stringify(f.userIds)}::jsonb)), ${Math.round(f.score)}, ${JSON.stringify(f.evidence)}::jsonb)
    on conflict (key) do update set score = greatest(abuse_flags.score, excluded.score), evidence = excluded.evidence, updated_at = now()`);
  return { ok: true as const };
}

// an address shown to admins in flags: enough to see they're the same, not the whole of it
export const maskIp = (ip: string) => ip.includes(':') ? `${ip.split(':').slice(0, 3).join(':')}:…` : ip.replace(/\.\d+$/, '.x');
