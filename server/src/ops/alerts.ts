// Alerts (Phase 6 Step 5; docs/OPERATIONS.md): checked every minute on each server, sent to the owner — by email
// (ALERT_EMAIL) and to a phone (ALERT_WEBHOOK_URL: an ntfy.sh topic, or any webhook taking plain text) — once when
// something goes wrong, again every hour while it stays wrong, and once when it's put right. What each watches,
// and its threshold (config/<env>.json alerts):
//   errors      server errors over errorRate of requests in 5 minutes (at least minRequests of them)
//   slow        the 95th percentile answer over slowP95Ms in 5 minutes (at least minRequests)
//   database    the database not answering, answering slower than dbSlowMs, or connections queueing
//   queue       results waiting to be checked: more than queueWaiting, or one waiting over queueOldestSec
//   money       money made in the last hour (rewards, grants) over moneyPerHour, or over moneySpike × the hourly
//               average of the last week
//   realtime    (Phase 7 Step 5) the real-time server not reporting: its numbers come every 5 s (rt/server.ts → POST
//               /internal/mp/roam/stats) — nothing for RT_SILENT_SEC, when RT_URL says there is one (createRtWatch;
//               GET /status says the same: rt up, down, or unknown just after the API starts)
// The site being down altogether, and spending over budget, can't be seen from inside: an external uptime monitor and
// each provider's billing alerts do those (docs/OPERATIONS.md).

import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import type { Mailer } from '../mail.ts';
import type { Metrics } from './metrics.ts';

export type AlertRules = { errorRate: number; minRequests: number; slowP95Ms: number; dbSlowMs: number; queueWaiting: number; queueOldestSec: number; moneyPerHour: number; moneySpike: number; repeatMinutes: number };
export const DEFAULT_ALERTS: AlertRules = { errorRate: 0.05, minRequests: 20, slowP95Ms: 1500, dbSlowMs: 1000, queueWaiting: 20, queueOldestSec: 120, moneyPerHour: 5_000_000, moneySpike: 5, repeatMinutes: 60 };

export type Health = { db: { ok: boolean; ms: number; waiting: number; total: number; idle: number }; queue: { waiting: number; oldestMs: number }; money: { lastHour: number; weekHourly: number } };

export async function healthNow(db: Db, pool: any, tracks: { queue(): { waiting: number; oldestMs: number } }): Promise<Health> {
  const t0 = performance.now();
  let ok = true;
  try { await db.execute(sql`select 1`); } catch { ok = false; }
  const ms = Math.round(performance.now() - t0);
  let money = { lastHour: 0, weekHourly: 0 };
  if (ok) {
    try {
      const r = (await db.execute(sql`select coalesce(sum(amount) filter (where at > now() - interval '1 hour'), 0)::bigint as hour, coalesce(sum(amount) filter (where at > now() - interval '7 days'), 0)::bigint as week
        from ledger where amount > 0 and kind in ('reward', 'grant', 'start') and at > now() - interval '7 days'`)).rows[0] as any;
      money = { lastHour: Number(r.hour), weekHourly: Number(r.week) / (7 * 24) };
    } catch { /* the database is answering slowly: the database alert says so */ }
  }
  return { db: { ok, ms, waiting: pool?.waitingCount ?? 0, total: pool?.totalCount ?? 0, idle: pool?.idleCount ?? 0 }, queue: tracks.queue(), money };
}

// the real-time server's heartbeat, as the API hears it: its numbers every few seconds
//   const W = createRtWatch({ url: RT_URL })   W.heard()   W.state() → 'up' | 'down' | 'unknown'   W.view() (for evaluate)
// (with RT_URL it's expected: before its first report, 'unknown' for RT_SILENT_SEC after the API starts, then 'down'. Without,
// 'unknown' until it's heard from — local development's may or may not be running)
export const RT_SILENT_SEC = 90;
export type RtState = { state: 'up' | 'down' | 'unknown'; expected: boolean; silentSec: number | null; health: string | null };
export function createRtWatch({ url, now = () => Date.now() }: { url: string | null; now?: () => number }) {
  const started = now(), expected = !!url, health = url ? `${url.replace(/^ws/, 'http')}/health` : null;
  let last = 0;
  const W = {
    heard() { last = now(); },
    silentSec: () => Math.round((now() - (last || started)) / 1000),
    state(): RtState['state'] {
      const quiet = now() - (last || started) >= RT_SILENT_SEC * 1000;
      if (last) return quiet ? 'down' : 'up';
      return expected && quiet ? 'down' : 'unknown';
    },
    view: (): RtState => ({ state: W.state(), expected, silentSec: last || expected ? W.silentSec() : null, health }),
  };
  return W;
}

// what's wrong now: key → message
export function evaluate(m: Metrics, h: Health, R: AlertRules, rt: RtState | null = null): Map<string, string> {
  const out = new Map<string, string>(), w = m.window(5);
  if (w.requests >= R.minRequests && w.errorRate > R.errorRate) out.set('errors', `Server errors: ${w.serverErrors} of ${w.requests} requests in the last 5 minutes (${(w.errorRate * 100).toFixed(1)}%; the limit is ${R.errorRate * 100}%).`);
  if (w.requests >= R.minRequests && w.p95 > R.slowP95Ms) out.set('slow', `Slow answers: the slowest 5% took over ${w.p95} ms in the last 5 minutes (the limit is ${R.slowP95Ms} ms). Slowest: ${w.routes.slice(0, 3).map(r => `${r.route} ${r.p95} ms`).join(', ')}.`);
  if (!h.db.ok) out.set('database', 'The database isn\'t answering.');
  else if (h.db.ms > R.dbSlowMs) out.set('database', `The database took ${h.db.ms} ms to answer a simple query (the limit is ${R.dbSlowMs} ms).`);
  else if (h.db.waiting > 5) out.set('database', `${h.db.waiting} requests are queueing for a database connection (${h.db.total} open): the pool is too small or queries are stuck.`);
  if (h.queue.waiting > R.queueWaiting || h.queue.oldestMs > R.queueOldestSec * 1000) out.set('queue', `The verification queue is backing up: ${h.queue.waiting} waiting, the oldest for ${Math.round(h.queue.oldestMs / 1000)} s.`);
  if (h.money.lastHour > R.moneyPerHour || (h.money.weekHourly > 0 && h.money.lastHour > R.moneySpike * h.money.weekHourly && h.money.lastHour > R.moneyPerHour / 10))
    out.set('money', `Unusual money creation: ${h.money.lastHour.toLocaleString('en-GB')} made in the last hour (a normal hour this week: ${Math.round(h.money.weekHourly).toLocaleString('en-GB')}). Check the economy dashboard and the abuse flags.`);
  if (rt?.expected && rt.state === 'down') out.set('realtime', `The real-time server isn't reporting: nothing from it for ${rt.silentSec} s, so races, lobbies and free roam are probably down. Check ${rt.health} and its container on the server (docker compose ps; docker compose logs rt).`);
  return out;
}

export function createAlerter({ db, mailer, email, webhook, env, rules, log, fetchImpl = globalThis.fetch }: { db: Db; mailer: Mailer; email: string | null; webhook: string | null; env: string; rules: AlertRules; log: (o: object, m: string) => void; fetchImpl?: typeof fetch }) {
  async function send(subject: string, text: string) {
    log({ subject }, 'alert');
    const jobs: Promise<unknown>[] = [];
    if (email) jobs.push(mailer.send({ kind: 'alert', to: email, subject, text, html: `<p>${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</p>` }));
    if (webhook) jobs.push(fetchImpl(webhook, { method: 'POST', body: `${subject}\n${text}`, headers: { title: subject.slice(0, 120), priority: subject.startsWith('Fixed') ? '3' : '5' }, signal: AbortSignal.timeout(5000) }));
    const r = await Promise.allSettled(jobs);
    for (const x of r) if (x.status === 'rejected') log({ err: String(x.reason) }, 'alert not delivered');
  }
  return {
    // one round: what's wrong now against what was; new ones and repeats sent, cleared ones said so
    async check(now: Map<string, string>) {
      const rows = (await db.execute(sql`select key, state, sent_at from alerts`)).rows as any[], was = new Map(rows.map(r => [r.key, r]));
      const sent: string[] = [];
      for (const [key, message] of now) {
        const r = was.get(key), due = !r || r.state !== 'firing' || !r.sent_at || Date.now() - new Date(r.sent_at).getTime() > rules.repeatMinutes * 60000;
        await db.execute(sql`insert into alerts (key, state, message, first_at, last_at, sent_at, count) values (${key}, 'firing', ${message}, now(), now(), ${due ? sql`now()` : null}, 1)
          on conflict (key) do update set state = 'firing', message = excluded.message, last_at = now(), first_at = case when alerts.state = 'firing' then alerts.first_at else now() end,
            sent_at = coalesce(${due ? sql`now()` : null}, alerts.sent_at), count = case when alerts.state = 'firing' then alerts.count + 1 else 1 end`);
        if (due) { await send(`[${env}] ${r?.state === 'firing' ? 'Still: ' : ''}${key}`, message); sent.push(key); }
      }
      for (const [key, r] of was) if (r.state === 'firing' && !now.has(key)) {
        await db.execute(sql`update alerts set state = 'resolved', last_at = now() where key = ${key}`);
        await send(`[${env}] Fixed: ${key}`, `${key} is back to normal.`); sent.push(`${key}:resolved`);
      }
      return sent;
    },
  };
}
