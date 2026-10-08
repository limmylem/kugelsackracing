// Multiplayer on the API (Phase 7 Step 2; docs/MULTIPLAYER.md "Lobbies, matchmaking and races"): the parts that need
// the database. The real-time server runs the lobbies and races (no database); this keeps who's friends with whom,
// skill ratings, each race's results, and pays.
//
//   - friends and blocks: a request, accepted by the other; a block ends a friendship and keeps the two apart (no
//     chat, invites or requests between them; never matched together)
//   - ratings: OpenSkill (Plackett-Luce), changed only by a ranked race's confirmed results
//   - what a join ticket carries (ticketClaims): the rating, the cars (class and performance rating from each build,
//     here), who they've blocked, and a cooldown after leaving ranked races early (data/multiplayer.json leaving)
//   - venues: a race's route or track resolved (random, today's track, a route, a track code) to its stored course and
//     the frame it's raced in (a region's map frame, or a generated track's)
//   - a race's results: reported by the race server as it ends (provisional), each player's run handed in through it
//     and checked (quest/validate.js against the race's quest and course — Phase 6 Step 3's rules — and against what
//     the race server saw), then confirmed (mp/results.js): ratings moved, each player paid (the economy), the
//     standings kept. Confirmed when every finisher's run is in, or race.resultsWaitSec after the race.
//   - the queue's numbers, as the race server reports them (the admin page's dashboard)
//   - development (config rt.devPlayers): ?player=A in a window is a guest user of its own, made on first use

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { sql } from 'drizzle-orm';
import { rating as osRating, rate as osRate } from 'openskill';
import { REPO_DIR } from '../config.ts';
import { AppError } from '../errors.ts';
import { confirmResults, ratingOrder, payFor } from '../../../mp/results.js';
import { raceQuest } from '../../../mp/quest.js';
import { tierOf, tierChange, START } from '../../../mp/rank.js';
import { validateResult } from '../../../quest/validate.js';
import { viewCourse } from '../../../route/model.js';
import { transverseMercator } from '../../../map/build/format/projection.js';
import { trackProjection } from '../../../track/build.js';
import { decodePath } from '../economy/geometry.ts';
import { fileReport, REPORT_KINDS } from '../abuse/reports.ts';

const json = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, f), 'utf8'));
export const MP = json('data/multiplayer.json');
const QCFG = json('data/quests.json');
const MAX_FRIENDS = 200;

type Db = any;
export type Venue = { kind: 'route'; id: string } | { kind: 'track'; code: string } | { kind: 'official'; which?: 'daily' | 'weekly' } | { kind: 'random' };

export function createMpService({ db, tracks, economy, economyConfig, log = () => {}, now = () => Date.now() }: { db: Db; tracks: any; economy: any; economyConfig: any; log?: (o: object, m: string) => void; now?: () => number }) {
  const rows = async (q: any) => (await db.execute(q)).rows as any[];
  const one = async (q: any) => (await rows(q))[0] ?? null;
  const pair = (a: string, b: string) => a < b ? [a, b] : [b, a];
  const timers = new Map<string, NodeJS.Timeout>();

  // ---------- friends and blocks ----------
  async function userByIdOrName({ id, name }: { id?: string; name?: string }) {
    if (id) return one(sql`select id, name, is_anonymous from users where id = ${id}`);
    if (name) return one(sql`select id, name, is_anonymous from users where lower(name) = lower(${name.trim()})`);
    return null;
  }
  async function blockedEither(a: string, b: string) {
    return !!(await one(sql`select 1 from blocks where (user_id = ${a} and blocked_id = ${b}) or (user_id = ${b} and blocked_id = ${a})`));
  }
  async function friends(userId: string) {
    const list = await rows(sql`select f.status, f.requested_by, u.id, u.name from friendships f join users u on u.id = case when f.a_id = ${userId} then f.b_id else f.a_id end
      where f.a_id = ${userId} or f.b_id = ${userId} order by u.name`);
    const blocked = await rows(sql`select u.id, u.name from blocks b join users u on u.id = b.blocked_id where b.user_id = ${userId} order by u.name`);
    return {
      friends: list.map(r => ({ id: r.id, name: r.name, status: r.status === 'accepted' ? 'friend' : r.requested_by === userId ? 'outgoing' : 'incoming' })),
      blocked: blocked.map(r => ({ id: r.id, name: r.name })),
    };
  }
  async function requestFriend(userId: string, target: { id?: string; name?: string }) {
    const t = await userByIdOrName(target);
    if (!t || t.id === userId) throw new AppError(404, 'NOT_FOUND', 'There\'s no player by that name.');
    if (await blockedEither(userId, t.id)) throw new AppError(403, 'FORBIDDEN', 'You can\'t add this player.');
    const [a, b] = pair(userId, t.id);
    const was = await one(sql`select status, requested_by from friendships where a_id = ${a} and b_id = ${b}`);
    if (was?.status === 'accepted') return { status: 'friend', id: t.id, name: t.name };
    if (was && was.requested_by !== userId) { await db.execute(sql`update friendships set status = 'accepted', accepted_at = now() where a_id = ${a} and b_id = ${b}`); return { status: 'friend', id: t.id, name: t.name }; }
    if (was) return { status: 'outgoing', id: t.id, name: t.name };
    const n = Number((await one(sql`select count(*) as n from friendships where a_id = ${userId} or b_id = ${userId}`)).n);
    if (n >= MAX_FRIENDS) throw new AppError(409, 'CONFLICT', `You have ${MAX_FRIENDS} friends and requests already.`);
    await db.execute(sql`insert into friendships (a_id, b_id, status, requested_by) values (${a}, ${b}, 'pending', ${userId})`);
    return { status: 'outgoing', id: t.id, name: t.name };
  }
  async function acceptFriend(userId: string, otherId: string) {
    const [a, b] = pair(userId, otherId);
    const r = await rows(sql`update friendships set status = 'accepted', accepted_at = now() where a_id = ${a} and b_id = ${b} and status = 'pending' and requested_by <> ${userId} returning a_id`);
    if (!r.length) throw new AppError(404, 'NOT_FOUND', 'There\'s no request from that player.');
    return { ok: true };
  }
  async function removeFriend(userId: string, otherId: string) {
    const [a, b] = pair(userId, otherId);
    await db.execute(sql`delete from friendships where a_id = ${a} and b_id = ${b}`);
    return { ok: true };
  }
  async function block(userId: string, otherId: string) {
    if (userId === otherId || !(await userByIdOrName({ id: otherId }))) throw new AppError(404, 'NOT_FOUND', 'There\'s no such player.');
    await removeFriend(userId, otherId);
    await db.execute(sql`insert into blocks (user_id, blocked_id) values (${userId}, ${otherId}) on conflict do nothing`);
    return { ok: true };
  }
  async function unblock(userId: string, otherId: string) { await db.execute(sql`delete from blocks where user_id = ${userId} and blocked_id = ${otherId}`); return { ok: true }; }
  // (the race server's view: who's a friend, who's blocked either way — names for the friends list)
  async function relations(userId: string) {
    const f = await rows(sql`select u.id, u.name from friendships f join users u on u.id = case when f.a_id = ${userId} then f.b_id else f.a_id end where (f.a_id = ${userId} or f.b_id = ${userId}) and f.status = 'accepted'`);
    const b = await rows(sql`select blocked_id as id from blocks where user_id = ${userId}`), by = await rows(sql`select user_id as id from blocks where blocked_id = ${userId}`);
    const req = await rows(sql`select u.id, u.name, f.requested_by from friendships f join users u on u.id = case when f.a_id = ${userId} then f.b_id else f.a_id end where (f.a_id = ${userId} or f.b_id = ${userId}) and f.status = 'pending'`);
    return { friends: f.map(r => ({ id: r.id, name: r.name })), blocked: b.map(r => r.id), blockedBy: by.map(r => r.id),
      incoming: req.filter(r => r.requested_by !== userId).map(r => ({ id: r.id, name: r.name })), outgoing: req.filter(r => r.requested_by === userId).map(r => ({ id: r.id, name: r.name })) };
  }

  // ---------- ratings, cooldowns, what a ticket carries ----------
  async function ratingOf(userId: string) {
    const r = await one(sql`select mu, sigma, races, wins from mp_ratings where user_id = ${userId}`);
    return r ? { mu: Number(r.mu), sigma: Number(r.sigma), races: Number(r.races), wins: Number(r.wins) } : { ...START, races: 0, wins: 0 };
  }
  async function cooldown(userId: string, at = now()) {
    const L = MP.leaving;
    const left = await rows(sql`select p.created_at from mp_race_players p join mp_races r on r.id = p.race_id
      where p.user_id = ${userId} and p.left_early and r.ranked and p.created_at > ${new Date(at - L.windowHours * 3600e3).toISOString()}::timestamptz order by p.created_at desc`);
    if (left.length <= L.freeLeaves) return { until: null, leaves: left.length };
    const minutes = L.cooldownMinutes[Math.min(L.cooldownMinutes.length - 1, left.length - L.freeLeaves - 1)];
    const until = new Date(left[0].created_at).getTime() + minutes * 60e3;
    return { until: until > at ? until : null, leaves: left.length, minutes };
  }
  async function ticketClaims(user: { id: string; name: string; isAnonymous?: boolean }) {
    const [r, rel, cd] = await Promise.all([ratingOf(user.id), relations(user.id), cooldown(user.id)]);
    let cars: any[] = [];
    try { cars = (await economy.racingCars(user)).slice(0, 40); } catch (e) { log({ err: e }, 'racing cars failed'); }
    return { rating: { mu: r.mu, sigma: r.sigma, races: r.races }, cars, blocked: [...new Set([...rel.blocked, ...rel.blockedBy])].slice(0, 200), cooldownUntil: cd.until };
  }
  async function me(userId: string) {
    const r = await ratingOf(userId), cd = await cooldown(userId);
    return { tier: tierOf(r, MP.rank), races: r.races, wins: r.wins, cooldownUntil: cd.until ? new Date(cd.until).toISOString() : null, leaves: cd.leaves };
  }
  // (development: Player A, a guest of its own — made on first use, its terms accepted)
  async function devPlayer(letter: string) {
    const id = `dev-player-${letter.toLowerCase()}`;
    let u = await one(sql`select id, name, is_anonymous from users where id = ${id}`);
    if (!u) {
      await db.execute(sql`insert into users (id, name, email, email_verified, is_anonymous, terms_version, terms_accepted_at) values (${id}, ${`Player ${letter}`}, ${`${id}@dev.invalid`}, true, true, 'dev', now()) on conflict do nothing`);
      u = await one(sql`select id, name, is_anonymous from users where id = ${id}`);
    }
    return { id: u.id as string, name: u.name as string, isAnonymous: true };
  }

  // ---------- venues ----------
  const manifests = new Map<string, any>();
  const regionFrame = (region: string) => {
    if (!manifests.has(region)) { try { manifests.set(region, json(`assets/map/${region}/manifest.json`)); } catch { manifests.set(region, null); } }
    const m = manifests.get(region);
    return m?.projection ? { kind: 'region' as const, region, lat0: m.projection.lat0, lon0: m.projection.lon0 } : null;
  };
  async function publishedRoutes() {
    return rows(sql`select id, data from content_items where view = 'published' and kind = 'route' order by id`);
  }
  // a venue resolved: what's raced and its course as stored, the frame the race server tracks it in, and the course as
  // the API checks runs on it
  async function venue(v: Venue): Promise<any> {
    if (v.kind === 'random') {
      const routes = (await publishedRoutes()).filter(r => r.data?.course && regionFrame(r.data.course.region));
      const pickRoute = routes.length && Math.random() < 0.6;
      if (pickRoute) return venue({ kind: 'route', id: routes[Math.floor(Math.random() * routes.length)].id });
      return venue({ kind: 'official', which: Math.random() < 0.5 ? 'daily' : 'weekly' });
    }
    if (v.kind === 'official') {
      const t = await tracks.today(now());
      const d = v.which === 'weekly' ? t.weekly : t.daily;
      return { ...(await venue({ kind: 'track', code: d.code })), official: v.which ?? 'daily' };
    }
    if (v.kind === 'route') {
      const r = await one(sql`select id, data from content_items where id = ${v.id} and view = 'published' and kind = 'route'`);
      const course = r?.data?.course;
      if (!course) throw new AppError(404, 'NOT_FOUND', 'There\'s no such route (or it isn\'t published).');
      const frame = regionFrame(course.region);
      if (!frame) throw new AppError(409, 'CONFLICT', `That route's region (${course.region}) isn't one the game has.`);
      const first = decodePath(course)?.[0];
      const check = viewCourse(course, transverseMercator(first!.lat, first!.lon));
      return { venue: { kind: 'route', id: r.id }, name: r.data.name ?? 'A route', loop: course.kind === 'loop', km: (course.length ?? check?.length ?? 0) / 1000, course, frame, trackHash: null, routeVersion: check?.version ?? null, check };
    }
    if (v.kind === 'track') {
      const b = await tracks.built(v.code);
      const row = await one(sql`select course from track_courses where code = ${b.code}`);
      return { venue: { kind: 'track', code: b.code }, name: b.name, loop: b.view.loop, km: b.view.length / 1000, course: row.course, frame: { kind: 'track' }, trackHash: b.hash, routeVersion: b.view.version, check: b.view };
    }
    throw new AppError(400, 'BAD_REQUEST', 'Not a venue.');
  }
  const checkCourse = new Map<string, any>();
  async function courseToCheck(v: Venue) {
    const key = JSON.stringify(v);
    if (!checkCourse.has(key)) { checkCourse.set(key, (await venue(v)).check); if (checkCourse.size > 64) checkCourse.delete(checkCourse.keys().next().value!); }
    return checkCourse.get(key);
  }

  // ---------- a race's results ----------
  const exists = async (uid: string) => !!(await one(sql`select 1 from users where id = ${uid}`));
  async function recordRace(rec: any) {
    if (!rec?.id || !Array.isArray(rec.results)) throw new AppError(400, 'BAD_REQUEST', 'Not a race.');
    const had = await one(sql`select id from mp_races where id = ${rec.id}`);
    if (had) return raceView(rec.id);
    const humans = rec.results.filter((r: any) => !r.npc), npcs = rec.results.length - humans.length;
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`insert into mp_races (id, kind, ranked, venue, settings, course_version, track_hash, km, humans, npcs, state, provisional)
        values (${rec.id}, ${rec.kind}, ${!!rec.ranked}, ${JSON.stringify(rec.venue)}::jsonb, ${JSON.stringify(rec.settings ?? {})}::jsonb, ${rec.courseVersion ?? null}, ${rec.trackHash ?? null}, ${Number(rec.km) || 0}, ${humans.length}, ${npcs}, 'provisional', ${JSON.stringify(rec.results)}::jsonb)`);
      for (const r of humans) {
        if (!(await exists(r.uid))) continue;
        await tx.execute(sql`insert into mp_race_players (race_id, user_id, provisional_place, status, left_early, server_time_ms) values (${rec.id}, ${r.uid}, ${r.place}, ${r.status}, ${!!r.leftEarly}, ${r.timeMs != null ? Math.round(r.timeMs) : null}) on conflict do nothing`);
      }
    });
    const finishers = humans.filter((r: any) => r.status === 'finished');
    if (!finishers.length) await finalize(rec.id);
    else timers.set(rec.id, setTimeout(() => { timers.delete(rec.id); void finalize(rec.id).catch(e => log({ err: e, race: rec.id }, 'confirming a race failed')); }, MP.race.resultsWaitSec * 1000).unref());
    return raceView(rec.id);
  }
  async function submitRun(raceId: string, uid: string, body: { result: any; recording?: any }) {
    const race = await one(sql`select * from mp_races where id = ${raceId}`);
    if (!race) throw new AppError(404, 'NOT_FOUND', 'There\'s no such race.');
    const p = await one(sql`select * from mp_race_players where race_id = ${raceId} and user_id = ${uid}`);
    if (!p) throw new AppError(404, 'NOT_FOUND', 'You weren\'t in that race.');
    if (race.state !== 'provisional') return { verdict: p.verdict, late: true };
    if (p.run) return { verdict: p.verdict };
    const settings = race.settings ?? {}, course = await courseToCheck(race.venue);
    const quest = raceQuest({ raceId, venue: race.venue, laps: settings.laps, loop: !!course?.loop, trackHash: race.track_hash });
    const v = validateResult(body.result, { quest, course, config: QCFG });
    const verdict = { ok: v.ok, problems: v.problems, rawMs: Number.isFinite(body.result?.rawTime) ? Math.round(body.result.rawTime * 1000) : null };
    const rec = body.recording ? zlib.gzipSync(Buffer.from(JSON.stringify(body.recording))) : null;
    await db.execute(sql`update mp_race_players set run = ${JSON.stringify(body.result ?? null)}::jsonb, recording = ${rec}, verdict = ${JSON.stringify(verdict)}::jsonb where race_id = ${raceId} and user_id = ${uid}`);
    // (everyone who finished has handed theirs in: confirmed now)
    const waiting = await rows(sql`select 1 from mp_race_players where race_id = ${raceId} and status = 'finished' and run is null`);
    if (!waiting.length) { clearTimeout(timers.get(raceId)); timers.delete(raceId); await finalize(raceId); }
    return { verdict };
  }
  async function todayRaces(uids: string[]) {
    if (!uids.length) return {};
    const r = await rows(sql`select user_id, count(*) as n from mp_race_players where user_id = any(${`{${uids.map(u => `"${u.replace(/"/g, '')}"`).join(',')}}`}::text[]) and pay is not null and (pay->>'money')::int > 0 and created_at > now() - interval '1 day' group by user_id`);
    return Object.fromEntries(r.map(x => [x.user_id, Number(x.n)]));
  }
  const finalizing = new Map<string, Promise<any>>();
  function finalize(raceId: string) {
    if (!finalizing.has(raceId)) finalizing.set(raceId, doFinalize(raceId).finally(() => finalizing.delete(raceId)));
    return finalizing.get(raceId)!;
  }
  async function doFinalize(raceId: string) {
    const race = await one(sql`select * from mp_races where id = ${raceId}`);
    if (!race || race.state === 'confirmed') return raceView(raceId);
    const players = await rows(sql`select user_id, verdict, run is not null as handed from mp_race_players where race_id = ${raceId}`);
    const known = new Set(players.map(p => p.user_id));
    const verdicts = Object.fromEntries(players.filter(p => p.verdict).map(p => [p.user_id, p.verdict]));
    // (a player with no account here — a bot's made-up id — is the race server's word alone)
    const provisional = (race.provisional as any[]).map(r => r.npc || known.has(r.uid) ? r : { ...r, npc: true, unrated: true });
    const confirmed = confirmResults(provisional, verdicts, { toleranceMs: 300 });
    // ratings: a ranked race moves them (the order: mp/results ratingOrder)
    const rated = confirmed.filter(r => !r.npc && known.has(r.uid));
    const before: Record<string, any> = {};
    for (const r of rated) before[r.uid] = await ratingOf(r.uid);
    const after: Record<string, any> = { ...before };
    if (race.ranked && rated.length >= 2) {
      const order = ratingOrder(rated);
      const teams = order.map(o => [osRating({ mu: before[o.uid].mu, sigma: before[o.uid].sigma })]);
      const next = osRate(teams, { rank: order.map(o => o.rank) });
      order.forEach((o, i) => { after[o.uid] = { ...before[o.uid], mu: next[i][0].mu, sigma: next[i][0].sigma, races: before[o.uid].races + 1, wins: before[o.uid].wins + (confirmed.find(c => c.uid === o.uid)?.place === 1 && confirmed.find(c => c.uid === o.uid)?.status === 'finished' ? 1 : 0) }; });
    }
    // pay: by place, the economy's multiplayer rules
    const G = await economyConfig.gameDb(), rules = G.db.economy.multiplayer;
    const pay = rules ? payFor(confirmed.map(r => known.has(r.uid) ? r : { ...r, npc: true }), rules, { ranked: race.ranked, humans: race.humans, npcs: race.npcs, km: race.km, todayRaces: await todayRaces(rated.map(r => r.uid)) }) : {};
    const out: any[] = [];
    for (const r of confirmed) {
      const entry: any = { ...r };
      if (known.has(r.uid)) {
        const p = pay[r.uid] ?? { money: 0, xp: 0, why: '' };
        let paid: any = { paid: false };
        if (p.money > 0 || p.xp > 0) { try { paid = await economy.payRace(r.uid, { money: p.money, xp: p.xp, raceId, reason: `Multiplayer race: ${p.why}` }); } catch (e) { log({ err: e, race: raceId, uid: r.uid }, 'paying a race failed'); } }
        entry.pay = { ...p, paid: !!paid.paid };
        entry.rank = { before: tierOf(before[r.uid], MP.rank), after: tierOf(after[r.uid], MP.rank), change: tierChange(before[r.uid], after[r.uid], MP.rank), ranked: race.ranked };
        await db.execute(sql`update mp_race_players set place = ${r.place}, status = ${r.status}, pay = ${JSON.stringify(entry.pay)}::jsonb, rating_before = ${JSON.stringify(before[r.uid])}::jsonb, rating_after = ${JSON.stringify(after[r.uid])}::jsonb where race_id = ${raceId} and user_id = ${r.uid}`);
        if (race.ranked && after[r.uid] !== before[r.uid]) {
          const a = after[r.uid];
          await db.execute(sql`insert into mp_ratings (user_id, mu, sigma, races, wins) values (${r.uid}, ${a.mu}, ${a.sigma}, ${a.races}, ${a.wins})
            on conflict (user_id) do update set mu = excluded.mu, sigma = excluded.sigma, races = excluded.races, wins = excluded.wins, updated_at = now()`);
        }
      }
      delete entry.rating; delete entry.flags;
      out.push(entry);
    }
    await db.execute(sql`update mp_races set state = 'confirmed', confirmed = ${JSON.stringify(out)}::jsonb, confirmed_at = now() where id = ${raceId}`);
    log({ race: raceId, players: out.length, dsq: out.filter(r => r.status === 'dsq').length }, 'multiplayer race confirmed');
    return raceView(raceId);
  }
  async function raceView(raceId: string) {
    const r = await one(sql`select id, kind, ranked, venue, settings, km, humans, npcs, state, provisional, confirmed, created_at, confirmed_at from mp_races where id = ${raceId}`);
    if (!r) throw new AppError(404, 'NOT_FOUND', 'There\'s no such race.');
    const strip = (list: any[]) => list?.map(({ flags, rating, ...x }: any) => x) ?? null;
    return { id: r.id, kind: r.kind, ranked: r.ranked, venue: r.venue, settings: r.settings, km: r.km, state: r.state, provisional: strip(r.provisional), confirmed: r.confirmed ?? null, at: r.created_at, confirmedAt: r.confirmed_at };
  }
  // (on start: any race the server stopped before confirming, confirmed now)
  async function sweep() {
    const stale = await rows(sql`select id from mp_races where state = 'provisional' and created_at < now() - make_interval(secs => ${MP.race.resultsWaitSec})`);
    for (const r of stale) await finalize(r.id).catch(e => log({ err: e, race: r.id }, 'confirming a race failed'));
    return stale.length;
  }
  async function leaderboard(limit = 50) {
    const r = await rows(sql`select u.id, u.name, m.mu, m.sigma, m.races, m.wins from mp_ratings m join users u on u.id = m.user_id
      where m.races >= ${MP.rank.placementRaces} and coalesce(u.banned, false) = false order by (m.mu - 3 * m.sigma) desc limit ${limit}`);
    return r.map((x, i) => ({ place: i + 1, id: x.id, name: x.name, tier: tierOf({ mu: Number(x.mu), sigma: Number(x.sigma), races: Number(x.races) }, MP.rank), races: Number(x.races), wins: Number(x.wins) }));
  }

  // ---------- the queue's numbers (the race server reports them every few seconds) ----------
  const queueLog: any[] = [];
  function queueStats(s: any) { queueLog.push({ ...s, at: s.at ?? now() }); while (queueLog.length && queueLog[0].at < now() - 24 * 3600e3) queueLog.shift(); if (queueLog.length > 20000) queueLog.splice(0, 5000); }
  function dashboard() {
    const last = queueLog.at(-1) ?? null, recent = queueLog.filter(x => x.at > now() - 3600e3);
    const matches = recent.flatMap(x => x.matches ?? []);
    const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
    const waits = matches.flatMap((m: any) => m.waitSec ?? []);
    return {
      targets: MP.queue.targets, now: last,
      hour: { matches: matches.length, players: matches.reduce((a: number, m: any) => a + (m.humans ?? 0), 0), waitP50Sec: pct(waits, 0.5), waitP95Sec: pct(waits, 0.95),
        skillSpreadP95: pct(matches.map((m: any) => m.skillSpread), 0.95), performanceSpreadP95: pct(matches.map((m: any) => m.performanceSpread), 0.95),
        sameClassShare: matches.length ? matches.filter((m: any) => m.sameClass).length / matches.length : null, npcFill: matches.filter((m: any) => m.npcFill).length },
      series: queueLog.slice(-360).map(x => ({ at: x.at, waiting: x.waiting, waitP95Sec: x.waitP95Sec ?? null })),
    };
  }

  // ---------- what a player does from the game's multiplayer screens (through the hub: it knows who they are) ----------
  async function act(uid: string, a: any) {
    const id = typeof a?.id === 'string' ? a.id.slice(0, 80) : undefined;
    switch (a?.action) {
      case 'friend-add': {
        // (as POST /friends: a guest makes a full account first — the development players, guests of their own, aside)
        const me = await one(sql`select is_anonymous from users where id = ${uid}`);
        if (!me) throw new AppError(404, 'NOT_FOUND', 'There\'s no such player.');
        if (me.is_anonymous && !uid.startsWith('dev-player-')) throw new AppError(403, 'FORBIDDEN', 'Make a full account to add friends (your progress comes with you).');
        return requestFriend(uid, { id, name: typeof a.name === 'string' ? a.name.slice(0, 40) : undefined });
      }
      case 'friend-accept': return acceptFriend(uid, id!);
      case 'friend-remove': return removeFriend(uid, id!);
      case 'block': return block(uid, id!);
      case 'unblock': return unblock(uid, id!);
      case 'report': {
        const kind = REPORT_KINDS.includes(a.kind) ? a.kind : 'behaviour', details = String(a.details ?? '').trim().slice(0, 1000);
        if (details.length < 5) throw new AppError(400, 'BAD_REQUEST', 'Say what happened (a few words at least).');
        const ref = a.ref && typeof a.ref === 'object' ? Object.fromEntries(Object.entries(a.ref).filter(([k, v]) => ['raceId', 'roomId', 'place'].includes(k) && typeof v === 'string').map(([k, v]) => [k, String(v).slice(0, 80)])) : undefined;
        return fileReport(db, uid, { targetId: id, kind, details, ref });
      }
    }
    throw new AppError(400, 'BAD_REQUEST', 'Not something the game can do.');
  }
  return { act, friends, requestFriend, acceptFriend, removeFriend, block, unblock, relations, ratingOf, cooldown, ticketClaims, me, devPlayer, venue, recordRace, submitRun, finalize, raceView, sweep, leaderboard, queueStats, dashboard, close() { for (const t of timers.values()) clearTimeout(t); timers.clear(); } };
}
