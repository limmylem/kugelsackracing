// Generated tracks on the server (Phase 6 Step 1): the day's and the week's tracks, records and leaderboards
// are worked out here, the same for every player, and replays are kept here.
//
//   - The day's and the week's track: the game's own search (track/events/model.js), in a worker, once per
//     day or week, kept in track_days (and the next ones made ahead of time). Their events carry the hash
//     of the track as built here: a player whose game builds it differently drives something else.
//   - A track built from its code (in the worker): its course as stored, its hash — kept in track_courses,
//     the recent ones in memory as the course the game races (route/model.js viewCourse).
//   - A run's result: checked by the game's own rules (quest/validate.js) against the event as the server
//     knows it (the day's, the week's, a quick race's from its code, an official one from published world
//     content) and its course — then kept (accepted or not, with why), the player's record for the track,
//     its code, generator version and car class, and their place on the event's leaderboard.
//   - Leaderboards (official, daily and weekly events): each player's best accepted run, best first (a
//     drift's by score); suspended and banned players left out.
//   - Replays (race/raceReplay.js recordings): compressed, the newest 50 a player kept (and any their
//     records point to), readable by anyone with the id (only their owner lists or deletes them).
//
// The money a run pays stays with the game for now (Phase 6 Step 2 moves the economy here).

import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { LIMITS } from '@kr/shared';
import { dayKey, weekKey, eventsFor } from '../../../track/events/model.js';
import { viewCourse } from '../../../route/model.js';
import { trackProjection } from '../../../track/build.js';
import { validateResult } from '../../../quest/validate.js';
import { rankedTime } from '../../../quest/rules.js';
import { decodeRecording } from '../../../quest/recording.js';

const read = (f: string) => JSON.parse(fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8'));
const BOARD_KINDS = new Set(['official', 'daily', 'weekly']);
const DAY = 864e5;
const r3 = (x: number | null | undefined) => x == null ? null : Math.round(x * 1000) / 1000;
const gzip = (o: unknown) => zlib.gzipSync(Buffer.from(JSON.stringify(o)), { level: 6 });
const gunzip = (b: Buffer) => JSON.parse(zlib.gunzipSync(b).toString('utf8'));
// when the day's (UTC midnight) and the week's (Monday, UTC) tracks change
export const endOf = (kind: 'daily' | 'weekly', at: number) => {
  const day0 = Math.floor(at / DAY) * DAY;
  return kind === 'daily' ? day0 + DAY : day0 - ((new Date(day0).getUTCDay() + 6) % 7) * DAY + 7 * DAY;
};

type Day = { kind: 'daily' | 'weekly'; key: string; code: string; name: string; seed: number; version: number; preset: string | null; info: any; quality: any };
type Built = { code: string; version: number; hash: string; view: any; info: any; name: string; seed: number };
type User = { id: string; name: string };

// ---------- the worker: one, restarted if it dies; each job once at a time however many ask ----------
function createWorkerPool({ timeoutMs, log }: { timeoutMs: number; log: (o: object, m: string) => void }) {
  let worker: Worker | null = null, seq = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  const inflight = new Map<string, Promise<any>>();
  const start = () => {
    const w = new Worker(new URL('./worker.ts', import.meta.url));
    w.unref();
    w.on('message', (m: any) => { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); m.ok ? p.resolve(m.out) : p.reject(new Error(m.error)); });
    const fail = (e: Error) => { if (worker === w) worker = null; for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(e); pending.delete(id); } };
    w.on('error', e => { log({ err: e }, 'track worker failed'); fail(e); });
    w.on('exit', code => { if (code !== 0) fail(new Error(`The track worker stopped (${code}).`)); else if (worker === w) worker = null; });
    return w;
  };
  return {
    run<T>(op: string, args: Record<string, unknown>): Promise<T> {
      const key = `${op}:${JSON.stringify(args)}`;
      const had = inflight.get(key);
      if (had) return had;
      const p = new Promise<T>((resolve, reject) => {
        worker ??= start();
        const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`The track worker took too long (${op}).`)); worker?.terminate(); worker = null; }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, op, ...args });
      }).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    async close() { const w = worker; worker = null; await w?.terminate(); },
  };
}

export function createTrackService({ db, config, log = () => {} }: { db: Db; config: Config; log?: (o: object, m: string) => void }) {
  const E = read('data/trackEvents.json'), qcfg = read('data/quests.json');
  const pool = createWorkerPool({ timeoutMs: config.tracks.workerTimeoutSec * 1000, log });
  const courses = new Map<string, Built>(), days = new Map<string, Promise<Day>>();

  // ---------- the day's and the week's track ----------
  function day(kind: 'daily' | 'weekly', at: number): Promise<Day> {
    const key = kind === 'daily' ? dayKey(at) : weekKey(at), id = `${kind}:${key}`;
    let p = days.get(id);
    if (!p) {
      p = (async () => {
        const row = (await db.execute(sql`select data from track_days where kind = ${kind} and key = ${key}`)).rows[0] as any;
        if (row) return row.data as Day;
        const d = await pool.run<Day & { skipped: number }>('day', { kind, at });
        await db.execute(sql`insert into track_days (kind, key, data) values (${kind}, ${key}, ${JSON.stringify(d)}::jsonb) on conflict do nothing`);
        log({ kind, key, code: d.code, skipped: d.skipped }, 'track of the day made');
        return d;
      })();
      p.catch(() => days.delete(id));
      days.set(id, p);
      if (days.size > 16) days.delete(days.keys().next().value!);
    }
    return p;
  }
  // ---------- a track built from its code ----------
  async function built(code: string): Promise<Built> {
    const hit = courses.get(code);
    if (hit) { courses.delete(code); courses.set(code, hit); return hit; }
    let row = (await db.execute(sql`select code, version, hash, course, info from track_courses where code = ${code}`)).rows[0] as any;
    if (!row) {
      const b = await pool.run<any>('build', { code });
      row = { code: b.code, version: b.version, hash: b.hash, course: b.course, info: { ...b.info, name: b.name, seed: b.seed } };
      await db.execute(sql`insert into track_courses (code, version, hash, course, info) values (${row.code}, ${row.version}, ${row.hash}, ${JSON.stringify(row.course)}::jsonb, ${JSON.stringify(row.info)}::jsonb) on conflict do nothing`);
    }
    const out: Built = { code: row.code, version: row.version, hash: row.hash, view: viewCourse(row.course, trackProjection) as any, info: row.info, name: row.info.name, seed: row.info.seed };
    out.view.trackHash = row.hash;
    courses.set(code, out);
    if (courses.size > 24) courses.delete(courses.keys().next().value!);
    return out;
  }
  // a track's events as the game makes them (data/trackEvents.json), with the hash of the track built here
  const eventsOf = (t: { kind: string; key?: string | null; code: string; name: string; seed: number; version: number; info: any; preset?: string | null }, hash: string) =>
    eventsFor({ ...t, key: t.key ?? null }, E).map((ev: any) => ({ ...ev, track: { ...ev.track, hash } }));

  async function dayView(kind: 'daily' | 'weekly', at: number) {
    const d = await day(kind, at), b = await built(d.code);
    return { kind, key: d.key, code: d.code, name: d.name, version: d.version, preset: d.preset, seed: d.seed, info: d.info, quality: d.quality, hash: b.hash, endsAt: new Date(endOf(kind, at)).toISOString(), events: eventsOf(d, b.hash) };
  }

  // ---------- which event a result is for, as the server knows it ----------
  async function eventFor(eventId: string, result: any, now: number) {
    const m = /^trk_(daily|weekly|quick|shared)_([0-9A-Z]+)_[a-z0-9_]+$/i.exec(eventId);
    if (m) {
      const kind = m[1] as 'daily' | 'weekly' | 'quick' | 'shared', code = result.track?.code as string | undefined;
      if (!code || code.replace(/-/g, '') !== m[2].toUpperCase()) throw new AppError(400, 'BAD_REQUEST', 'The result is for another track than its event.');
      let t: any;
      if (kind === 'daily' || kind === 'weekly') {
        // (today's; or the one before, for a run finished just as it changed)
        const grace = config.tracks.graceMinutes * 60e3, period = kind === 'daily' ? DAY : 7 * DAY;
        const at = [now, ...(now - (endOf(kind, now) - period) < grace ? [now - grace] : [])];
        for (const a of at) { const d = await day(kind, a); if (d.code === code) { t = d; break; } }
        if (!t) throw new AppError(410, 'GONE', `That ${kind === 'daily' ? 'day' : 'week'}'s event has ended: there's a new track.`);
      }
      const b = await built(code);
      t ??= { kind, key: null, code: b.code, name: b.name, seed: b.seed, version: b.version, info: b.info };
      const event = eventsOf({ ...t, kind }, b.hash).find((e: any) => e.id === eventId);
      if (!event) throw new AppError(404, 'NOT_FOUND', 'There\'s no such event on that track.');
      return { event, kind, built: b };
    }
    // an official event: published world content with a track
    const row = (await db.execute(sql`select data from content_items where id = ${eventId} and view = 'published'`)).rows[0] as any;
    const event = row?.data;
    if (!event?.track?.code) throw new AppError(404, 'NOT_FOUND', 'There\'s no such event (or it isn\'t published).');
    const b = await built(event.track.code);
    return { event: { ...event, track: { ...event.track, hash: event.track.hash ?? b.hash } }, kind: 'official' as const, built: b };
  }

  // ---------- leaderboards ----------
  const boardSql = (eventId: string, scored: boolean) => sql`
    with best as (
      select distinct on (r.user_id) r.user_id, r.rank, r.score, r.car_class, r.at, r.replay_id
      from track_results r join users u on u.id = r.user_id
      where r.event_id = ${eventId} and r.accepted and (not u.banned or (u.ban_expires is not null and u.ban_expires < now()))
      order by r.user_id, ${scored ? sql`r.score desc` : sql`r.rank asc`}, r.at asc)
    select b.*, u.name from best b join users u on u.id = b.user_id`;
  const scoredEvent = (event: any) => event?.type === 'drift';
  // a player's place on an event's board (and how many are on it): with the run just kept, inside its transaction
  async function placeOf(exec: Pick<Db, 'execute'>, eventId: string, scored: boolean, userId: string) {
    const better = scored ? sql`b.score > me.score or (b.score = me.score and b.at < me.at)` : sql`b.rank < me.rank or (b.rank = me.rank and b.at < me.at)`;
    const r = (await exec.execute(sql`with board as (${boardSql(eventId, scored)}), me as (select * from board where user_id = ${userId})
      select (select count(*)::int from board) as of, (select ${scored ? sql`score` : sql`rank`} from me) as value,
        (select 1 + count(*)::int from board b, me where ${better}) as place, (select count(*)::int from me) as here`)).rows[0] as any;
    return { of: r.of as number, value: r.value as number | null, place: r.here ? r.place as number : null };
  }
  // (an event's board is by score if it's a drift: its results say)
  const scoredBoard = async (eventId: string) => ((await db.execute(sql`select type from track_results where event_id = ${eventId} limit 1`)).rows[0] as any)?.type === 'drift';

  // ---------- replays ----------
  async function replayMeta(id: string, userId: string | null) {
    const r = (await db.execute(sql`select id, owner_id, title, event_id, code, duration, cars, bytes, created_at from replays where id = ${id}`)).rows[0] as any;
    if (!r) throw new AppError(404, 'NOT_FOUND', 'There\'s no such replay (it may have been deleted).');
    return { id: r.id, title: r.title, eventId: r.event_id, code: r.code, duration: r.duration, cars: r.cars, bytes: r.bytes, createdAt: new Date(r.created_at).toISOString(), mine: r.owner_id === userId };
  }

  const recordOut = (r: any) => r && { code: r.code, version: r.version, carClass: r.car_class, bestTime: r.best_time, bestLap: r.best_lap, bestScore: r.best_score, runs: r.runs, at: new Date(r.at).toISOString(), replayId: r.replay_id ?? null };

  return {
    endOf,
    // the day's and the week's tracks, with their events
    async today(now = Date.now()) {
      const [daily, weekly] = await Promise.all([dayView('daily', now), dayView('weekly', now)]);
      return { now: new Date(now).toISOString(), daily, weekly };
    },
    // the coming ones made ahead (and today's, if nobody's asked yet): on start, then every hour
    async prepare(now = Date.now()) {
      for (const [kind, at] of [['daily', now], ['weekly', now], ['daily', now + DAY], ['weekly', endOf('weekly', now) + 1000]] as const) {
        try { const d = await day(kind, at); await built(d.code); } catch (e) { log({ err: e, kind }, 'making a track ahead failed'); }
      }
    },
    built,
    // (an event as the server knows it, for the economy's runs: the day's, the week's, a code's)
    resolveEvent: (eventId: string, code: string | null, now = Date.now()) => eventFor(eventId, { track: { code } }, now),

    // a run handed in: checked, kept; the record and the leaderboard place
    async submit(user: User, body: { eventId: string; result: any; recording?: any; replayId?: string | null }, now = Date.now()) {
      const { event, kind, built: b } = await eventFor(body.eventId, body.result, now);
      const v = validateResult(body.result, { quest: event, course: b.view, config: qcfg });
      const scored = scoredEvent(event) && body.result.score != null;
      const rank = r3(rankedTime(event, body.result)), cls = String(body.result.car?.className ?? 'open').slice(0, 16), version = b.version;
      const laps = (body.result.laps ?? []).map(r3), lap = laps.length ? Math.min(...laps) : null;
      // (a replay named with it: only the player's own)
      const replayId = body.replayId ? (((await db.execute(sql`select id from replays where id = ${body.replayId} and owner_id = ${user.id}`)).rows[0] as any)?.id ?? null) : null;
      return db.transaction(async tx => {
        const ins = (await tx.execute(sql`insert into track_results (user_id, event_id, kind, code, version, car_class, type, time, rank, score, best_lap, laps, accepted, problems, result, recording, replay_id)
          values (${user.id}, ${body.eventId}, ${kind}, ${b.code}, ${version}, ${cls}, ${String(event.type)}, ${r3(body.result.time) ?? 0}, ${rank}, ${scored ? body.result.score : null}, ${lap}, ${JSON.stringify(laps)}::jsonb,
            ${v.ok}, ${JSON.stringify(v.problems)}::jsonb, ${JSON.stringify({ ...body.result, damage: { taken: body.result.damage?.taken ?? 0, events: [] } })}::jsonb, ${body.recording ? gzip(body.recording) : null}, ${replayId})
          returning id`)).rows[0] as any;
        const current = (await tx.execute(sql`select * from track_records where user_id = ${user.id} and code = ${b.code} and version = ${version} and car_class = ${cls} for update`)).rows[0] as any;
        if (!v.ok) return { ok: true as const, accepted: false, problems: v.problems, pb: false, record: recordOut(current) ?? null, board: null };
        const pb = scored ? (current?.best_score == null || body.result.score > current.best_score) : rank != null && (current?.best_time == null || rank < current.best_time);
        const rec = (await tx.execute(sql`insert into track_records (user_id, code, version, car_class, best_time, best_lap, best_score, result_id, replay_id, runs, at)
          values (${user.id}, ${b.code}, ${version}, ${cls}, ${scored ? null : rank}, ${lap}, ${scored ? body.result.score : null}, ${ins.id}, ${replayId}, 1, now())
          on conflict (user_id, code, version, car_class) do update set
            runs = track_records.runs + 1,
            best_lap = least(track_records.best_lap, excluded.best_lap),
            best_time = case when ${pb && !scored} then excluded.best_time else track_records.best_time end,
            best_score = case when ${pb && scored} then excluded.best_score else track_records.best_score end,
            result_id = case when ${pb} then excluded.result_id else track_records.result_id end,
            replay_id = case when ${pb} then excluded.replay_id else track_records.replay_id end,
            at = case when ${pb} then now() else track_records.at end
          returning *`)).rows[0];
        let board: { place: number | null; of: number } | null = null;
        if (BOARD_KINDS.has(kind)) { const p = await placeOf(tx, body.eventId, scoredEvent(event), user.id); board = { place: p.place, of: p.of }; }
        return { ok: true as const, accepted: true, problems: [] as string[], pb, record: recordOut(rec), board };
      });
    },

    async leaderboard(eventId: string, limit: number, userId: string | null) {
      const scored = await scoredBoard(eventId);
      const rows = (await db.execute(sql`${boardSql(eventId, scored)} order by ${scored ? sql`score desc` : sql`rank asc`}, at asc limit ${limit}`)).rows as any[];
      const mine = userId ? await placeOf(db, eventId, scored, userId) : null;
      const of = mine?.of ?? Number(((await db.execute(sql`select count(distinct user_id)::int as n from track_results where event_id = ${eventId} and accepted`)).rows[0] as any).n);
      return {
        eventId, scored, of,
        entries: rows.map((r, i) => ({ place: i + 1, displayName: r.name, value: scored ? r.score : r.rank, carClass: r.car_class, at: new Date(r.at).toISOString(), replayId: r.replay_id ?? null, you: r.user_id === userId })),
        mine: mine?.place != null ? { place: mine.place, value: mine.value! } : null,
      };
    },
    async records(userId: string, code: string | null) {
      const rows = (await db.execute(sql`select * from track_records where user_id = ${userId} ${code ? sql`and code = ${code}` : sql``} order by at desc limit 500`)).rows;
      return { records: rows.map(recordOut) };
    },

    // ---------- replays ----------
    async saveReplay(user: User, body: { eventId: string | null; code: string | null; title: string; recording: any }) {
      // (each car's recording decodes: what's kept is what plays)
      for (const c of body.recording.cars) {
        try {
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(c.rec.data)) throw new Error('not base64');
          const s = decodeRecording(c.rec);
          if (s.length !== c.rec.frames || !s.every((f: any) => Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.z) && Number.isFinite(f.vx) && f.q.every(Number.isFinite))) throw new Error('frames');
        }
        catch { throw new AppError(400, 'BAD_REQUEST', `The replay's recording of "${c.name ?? c.id}" isn't readable.`); }
      }
      const data = gzip(body.recording);
      if (data.length > LIMITS.replayBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `That replay is too long to keep (${(data.length / 1048576).toFixed(1)} MB compressed; the most is ${LIMITS.replayBytes / 1048576} MB).`);
      const id = `rp_${crypto.randomBytes(16).toString('base64url')}`;
      await db.execute(sql`insert into replays (id, owner_id, event_id, code, title, duration, cars, bytes, data)
        values (${id}, ${user.id}, ${body.eventId}, ${body.code}, ${body.title}, ${body.recording.duration}, ${body.recording.cars.length}, ${data.length}, ${data})`);
      // (the newest kept, and any a record points to)
      await db.execute(sql`delete from replays where owner_id = ${user.id} and id not in (
          select id from replays where owner_id = ${user.id} order by created_at desc, id desc limit ${config.replays.keepPerPlayer})
        and id not in (select replay_id from track_records where user_id = ${user.id} and replay_id is not null)`);
      return replayMeta(id, user.id);
    },
    replayMeta,
    async replay(id: string, userId: string | null) {
      const meta = await replayMeta(id, userId);
      const r = (await db.execute(sql`select data from replays where id = ${id}`)).rows[0] as any;
      return { meta, recording: gunzip(r.data) };
    },
    async myReplays(userId: string) {
      const rows = (await db.execute(sql`select id, owner_id, title, event_id, code, duration, cars, bytes, created_at from replays where owner_id = ${userId} order by created_at desc, id desc`)).rows as any[];
      return { replays: rows.map(r => ({ id: r.id, title: r.title, eventId: r.event_id, code: r.code, duration: r.duration, cars: r.cars, bytes: r.bytes, createdAt: new Date(r.created_at).toISOString(), mine: true })) };
    },
    async deleteReplay(id: string, userId: string) {
      const r = (await db.execute(sql`delete from replays where id = ${id} and owner_id = ${userId} returning id`)).rows;
      if (!r.length) throw new AppError(404, 'NOT_FOUND', 'There\'s no such replay of yours.');
      await db.execute(sql`update track_records set replay_id = null where user_id = ${userId} and replay_id = ${id}`);
      await db.execute(sql`update track_results set replay_id = null where user_id = ${userId} and replay_id = ${id}`);
      return { ok: true as const };
    },
    close: () => pool.close(),
  };
}
export type TrackService = ReturnType<typeof createTrackService>;
