// Final polish and launch (Phase 8 Step 4): what the game's new screens ask the server for —
//   settings      GET/PUT /player/settings — a player's settings, following them between devices (the newer copy wins)
//   profile       GET /profiles/:id (another player's, if public) · GET /player/profile · PUT /player/profile
//   photos        POST /player/photos (a small JPEG or WebP from photo mode) · GET /photos/:id · DELETE /player/photos/:id
//   crews         POST /crews · POST /crews/join · POST /crews/leave · GET /crews/:id
//   school        GET /player/school · POST /player/school/:lesson (a lesson's result: its medal, paid once)
//   first steps   POST /player/firsts/:step (the guided first steps: done or skipped, once; done pays a small thanks)
//   analytics     POST /analytics (anonymous, only with the player's consent: docs/ANALYTICS.md) · GET /admin/analytics
//   news          GET /news · admin: GET/POST /admin/news, PUT/DELETE /admin/news/:id
//   calendar      GET /calendar · POST/DELETE /calendar/:id/rsvp · admin: POST /admin/calendar, PUT/DELETE /admin/calendar/:id
// docs/ONBOARDING.md, docs/ANALYTICS.md, docs/LIVE_UPDATES.md, docs/PHOTO_MODE.md

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from '@kr/shared';
import type { Db } from '../db/index.ts';
import type { Guards } from '../session.ts';
import type { Economy } from '../economy/service.ts';
import { auditLog } from '../db/schema.ts';
import { AppError, notFound } from '../errors.ts';
import { REPO_DIR } from '../config.ts';

const admin = { config: { role: 'admin' as const } };
const Id = z.object({ id: z.string().min(1).max(80) });
export const LIMITS = { settingsBytes: 48_000, photoBytes: 220_000, photos: 8, analyticsBatch: 60, analyticsPropsBytes: 2_000, crewName: 40, crewTag: 5 };
const newId = (n = 12) => crypto.randomBytes(n).toString('base64url');
const iso = (d: any) => d ? new Date(d).toISOString() : null;
const school = () => JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/school.json'), 'utf8'));
const MEDALS = ['bronze', 'silver', 'gold'] as const;

// the medal a result earns in a lesson (null: none) — or 'invalid' when no real run measures that
export function medalFor(lesson: any, value: number): typeof MEDALS[number] | null | 'invalid' {
  if (!Number.isFinite(value) || value < lesson.bounds[0] || value > lesson.bounds[1]) return 'invalid';
  let got: typeof MEDALS[number] | null = null;
  for (const m of MEDALS) if (lesson.better === 'lower' ? value <= lesson.medals[m] : value >= lesson.medals[m]) got = m;
  return got;
}
const better = (lesson: any, a: number | null, b: number) => a == null || (lesson.better === 'lower' ? b < a : b > a);

// ---------- analytics: the events the game may send (anything else is refused) ----------
export const EVENT_KINDS = ['session_start', 'session_end', 'screen', 'tutorial', 'first_step', 'school', 'quest_start', 'quest_end', 'track_start', 'track_end', 'race_end', 'purchase', 'repair', 'perf', 'error', 'quit', 'setting', 'photo', 'share'] as const;
const AnalyticsBody = z.object({
  consent: z.literal(true),
  anon: z.string().min(8).max(64), session: z.string().min(4).max(64), version: z.string().max(40).optional(),
  device: z.object({ tier: z.string().max(20).optional(), browser: z.string().max(30).optional(), os: z.string().max(30).optional(), mobile: z.boolean().optional(), gpu: z.string().max(80).optional(), memory: z.number().optional(), cores: z.number().optional(), screen: z.string().max(20).optional(), language: z.string().max(20).optional() }).default({}),
  events: z.array(z.object({ kind: z.enum(EVENT_KINDS), name: z.string().max(80).optional(), at: z.number().optional(), props: z.record(z.string(), z.unknown()).optional() })).min(1).max(LIMITS.analyticsBatch),
});

export async function launchRoutes(app0: FastifyInstance, { db, economy, G, authSecret, badges }: { db: Db; economy: Economy; G: Guards; authSecret: string; badges?: (userId: string) => Promise<{ id: string; name: string; season: string }[]> }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const who = async (req: FastifyRequest) => (await G.requireTerms(req)).user;
  const adminWho = async (req: FastifyRequest) => (await G.requireRole('admin')(req)).user;
  const log = (actorId: string, action: string, targetId: string | null, reason: string | null, details: object = {}) => db.insert(auditLog).values({ actorId, action, targetId, reason, details });
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as any[];

  // ---------- settings ----------
  app.get('/player/settings', async req => {
    const u = await who(req);
    const [r] = await rows(sql`select data, changed_at, updated_at from player_settings where user_id = ${u.id}`);
    return r ? { data: r.data, changedAt: Number(r.changed_at), updatedAt: iso(r.updated_at) } : { data: null, changedAt: 0, updatedAt: null };
  });
  app.put('/player/settings', { schema: { body: z.object({ data: z.record(z.string(), z.unknown()), changedAt: z.number().int().min(0) }) } }, async req => {
    const u = await who(req);
    if (Buffer.byteLength(JSON.stringify(req.body.data)) > LIMITS.settingsBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Those settings are too big to keep.');
    const { graphics: _g, ...data } = req.body.data as any;       // (the graphics stay on their device)
    // the newer copy wins: an older one (another device changed them since) gets the newer back
    const [r] = await rows(sql`insert into player_settings (user_id, data, changed_at) values (${u.id}, ${JSON.stringify(data)}::jsonb, ${req.body.changedAt})
      on conflict (user_id) do update set data = excluded.data, changed_at = excluded.changed_at, updated_at = now() where player_settings.changed_at <= excluded.changed_at
      returning changed_at`);
    if (r) return { saved: true, changedAt: Number(r.changed_at) };
    const [cur] = await rows(sql`select data, changed_at from player_settings where user_id = ${u.id}`);
    return { saved: false, newer: { data: cur.data, changedAt: Number(cur.changed_at) } };
  });

  // ---------- the profile ----------
  async function profileOf(userId: string, viewer: string | null) {
    const [u] = await rows(sql`select u.id, u.name, u.created_at, u.is_anonymous, p.favourite_cars, coalesce(p.public, false) as public, e.level, e.xp, e.balance
      from users u left join player_profiles p on p.user_id = u.id left join player_economy e on e.user_id = u.id where u.id = ${userId} and not u.banned`);
    if (!u) throw notFound('That player');
    const own = viewer === userId;
    if (!u.public && !own) throw new AppError(403, 'FORBIDDEN', 'This player keeps their profile to themselves.');
    const [stats] = await rows(sql`select count(*) filter (where kind = 'quest') as quests, count(*) filter (where kind = 'quest' and end_reason = 'finished') as finished from economy_sessions where user_id = ${userId}`);
    // (the quest's best medal is quest_progress.medal: this asked for a best_medal column there isn't, and its error was
    // swallowed — quest medals never counted)
    const quests = await rows(sql`select quest_id, medal from quest_progress where user_id = ${userId}`);
    const medals = { gold: 0, silver: 0, bronze: 0 } as Record<string, number>;
    for (const q of quests) if (q.medal && q.medal in medals) medals[q.medal]++;
    const lessons = await rows(sql`select lesson_id, medal, best from school_results where user_id = ${userId} and lesson_id not like 'first:%'`);
    for (const l of lessons) if (l.medal in medals) medals[l.medal]++;
    const best = await rows(sql`select code, car_class, best_time, best_lap, best_score, at from track_records where user_id = ${userId} order by at desc limit 12`);
    const [crew] = await rows(sql`select c.id, c.name, c.tag, m.role from crew_members m join crews c on c.id = m.crew_id where m.user_id = ${userId}`);
    const photos = await rows(sql`select id, caption, place, created_at from player_photos where user_id = ${userId} order by created_at desc limit ${LIMITS.photos}`);
    const cars = await rows(sql`select car_id from owned_cars where user_id = ${userId}`).catch(() => []);
    return {
      id: u.id, name: u.name, since: iso(u.created_at), guest: !!u.is_anonymous, public: u.public, own,
      level: u.level ?? 1, xp: Number(u.xp ?? 0), ...(own ? { money: Number(u.balance ?? 0) } : {}),
      stats: { quests: Number(stats?.quests ?? 0), finished: Number(stats?.finished ?? 0), cars: cars.length, tracks: best.length },
      medals, school: lessons.map(l => ({ lesson: l.lesson_id, medal: l.medal, best: l.best })),
      favourites: u.favourite_cars ?? [], cars: [...new Set(cars.map(c => c.car_id))],
      bestTimes: best.map(b => ({ code: b.code, carClass: b.car_class, time: b.best_time, lap: b.best_lap, score: b.best_score, at: iso(b.at) })),
      crew: crew ? { id: crew.id, name: crew.name, tag: crew.tag, role: crew.role } : null,
      photos: photos.map(p => ({ id: p.id, caption: p.caption, place: p.place, at: iso(p.created_at), url: `/api/v1/photos/${p.id}` })),
      // (badges from the ROADBOOK's season shops: docs/ROADBOOK.md)
      badges: badges ? await badges(userId).catch(() => []) : [],
    };
  }
  app.get('/player/profile', async req => { const u = await who(req); return profileOf(u.id, u.id); });
  app.get('/profiles/:id', { schema: { params: Id } }, async req => { const u = await who(req); return profileOf(req.params.id, u.id); });
  app.put('/player/profile', { schema: { body: z.object({ favouriteCars: z.array(z.string().max(60)).max(6).optional(), public: z.boolean().optional() }) } }, async req => {
    const u = await who(req), b = req.body;
    await db.execute(sql`insert into player_profiles (user_id, favourite_cars, public) values (${u.id}, ${JSON.stringify(b.favouriteCars ?? [])}::jsonb, ${b.public ?? false})
      on conflict (user_id) do update set ${b.favouriteCars ? sql`favourite_cars = excluded.favourite_cars,` : sql``} ${b.public !== undefined ? sql`public = excluded.public,` : sql``} updated_at = now()`);
    return profileOf(u.id, u.id);
  });

  // ---------- photos ----------
  app.post('/player/photos', { bodyLimit: Math.ceil(LIMITS.photoBytes * 1.4) + 4000, schema: { body: z.object({ image: z.string().max(Math.ceil(LIMITS.photoBytes * 1.37) + 100), caption: z.string().max(120).optional(), place: z.string().max(80).optional() }) } }, async req => {
    const u = await who(req);
    const m = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(req.body.image);
    if (!m) throw new AppError(400, 'BAD_REQUEST', 'A photo is a JPEG or WebP image.');
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length > LIMITS.photoBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'That photo is too big (photo mode makes them small enough).');
    // (what the bytes are, not what they say: a JPEG starts FF D8 FF, a WebP RIFF….WEBP)
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, webp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!(m[1] === 'image/jpeg' ? jpeg : webp)) throw new AppError(400, 'BAD_REQUEST', 'That isn\'t a JPEG or WebP image.');
    const [{ n }] = await rows(sql`select count(*)::int as n from player_photos where user_id = ${u.id}`);
    if (n >= LIMITS.photos) throw new AppError(409, 'CONFLICT', `Your profile keeps ${LIMITS.photos} photos: remove one first.`);
    const id = newId();
    await db.execute(sql`insert into player_photos (id, user_id, caption, place, mime, bytes, data) values (${id}, ${u.id}, ${req.body.caption ?? null}, ${req.body.place ?? null}, ${m[1]}, ${bytes.length}, ${bytes})`);
    economy.events.emit('photoSaved', { userId: u.id, photoId: id });      // (the ROADBOOK: roadbook/service.ts)
    return { id, url: `/api/v1/photos/${id}` };
  });
  app.get('/photos/:id', { schema: { params: Id } }, async (req, reply) => {
    const [p] = await rows(sql`select p.mime, p.data, coalesce(pr.public, false) as public, p.user_id from player_photos p left join player_profiles pr on pr.user_id = p.user_id where p.id = ${req.params.id}`);
    if (!p) throw notFound('That photo');
    if (!p.public) { const u = await who(req); if (u.id !== p.user_id) throw notFound('That photo'); }
    reply.header('content-type', p.mime).header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff');
    return reply.send(p.data);
  });
  app.delete('/player/photos/:id', { schema: { params: Id } }, async req => {
    const u = await who(req);
    const r = await rows(sql`delete from player_photos where id = ${req.params.id} and user_id = ${u.id} returning id`);
    if (!r.length) throw notFound('That photo');
    return { deleted: true };
  });

  // ---------- crews ----------
  const crewOf = async (id: string) => {
    const [c] = await rows(sql`select id, name, tag, owner_id, created_at from crews where id = ${id}`);
    if (!c) throw notFound('That crew');
    const members = await rows(sql`select u.id, u.name, m.role, m.joined_at, e.level from crew_members m join users u on u.id = m.user_id left join player_economy e on e.user_id = u.id where m.crew_id = ${id} order by m.joined_at`);
    return { id: c.id, name: c.name, tag: c.tag, since: iso(c.created_at), members: members.map(m => ({ id: m.id, name: m.name, role: m.role, level: m.level ?? 1, joined: iso(m.joined_at) })) };
  };
  app.get('/crews/:id', { schema: { params: Id } }, async req => { const u = await who(req); const c = await crewOf(req.params.id); const mine = c.members.find(m => m.id === u.id); return { ...c, ...(mine?.role === 'owner' ? { inviteCode: (await rows(sql`select invite_code from crews where id = ${c.id}`))[0].invite_code } : {}) }; });
  app.post('/crews', { schema: { body: z.object({ name: z.string().trim().min(3).max(LIMITS.crewName), tag: z.string().trim().regex(/^[A-Za-z0-9]{2,5}$/) }) } }, async req => {
    const u = (await G.requireFull(req)).user;
    if ((await rows(sql`select 1 from crew_members where user_id = ${u.id}`)).length) throw new AppError(409, 'CONFLICT', 'Leave your crew first.');
    if ((await rows(sql`select 1 from crews where lower(tag) = lower(${req.body.tag})`)).length) throw new AppError(409, 'CONFLICT', 'Another crew has that tag.');
    const id = newId(9), code = newId(6);
    await db.transaction(async tx => {
      await tx.execute(sql`insert into crews (id, name, tag, owner_id, invite_code) values (${id}, ${req.body.name}, ${req.body.tag.toUpperCase()}, ${u.id}, ${code})`);
      await tx.execute(sql`insert into crew_members (user_id, crew_id, role) values (${u.id}, ${id}, 'owner')`);
    });
    return { ...(await crewOf(id)), inviteCode: code };
  });
  app.post('/crews/join', { schema: { body: z.object({ code: z.string().trim().min(4).max(20) }) } }, async req => {
    const u = (await G.requireFull(req)).user;
    const [c] = await rows(sql`select id from crews where invite_code = ${req.body.code}`);
    if (!c) throw new AppError(404, 'NOT_FOUND', 'That invite code isn\'t a crew\'s.');
    if ((await rows(sql`select 1 from crew_members where user_id = ${u.id}`)).length) throw new AppError(409, 'CONFLICT', 'Leave your crew first.');
    await db.execute(sql`insert into crew_members (user_id, crew_id) values (${u.id}, ${c.id})`);
    return crewOf(c.id);
  });
  app.post('/crews/leave', async req => {
    const u = await who(req);
    const [m] = await rows(sql`delete from crew_members where user_id = ${u.id} returning crew_id, role`);
    if (!m) return { left: false };
    // (the owner gone: the longest-standing member owns it; nobody left: the crew goes)
    const [next] = await rows(sql`select user_id from crew_members where crew_id = ${m.crew_id} order by joined_at limit 1`);
    if (!next) await db.execute(sql`delete from crews where id = ${m.crew_id}`);
    else if (m.role === 'owner') { await db.execute(sql`update crew_members set role = 'owner' where user_id = ${next.user_id}`); await db.execute(sql`update crews set owner_id = ${next.user_id} where id = ${m.crew_id}`); }
    return { left: true };
  });

  // ---------- the driving school ----------
  app.get('/player/school', async req => {
    const u = await who(req), S = school();
    const done = await rows(sql`select lesson_id, medal, best, attempts, at from school_results where user_id = ${u.id}`);
    return { lessons: S.lessons.map((l: any) => ({ id: l.id, ...(done.find(d => d.lesson_id === l.id) ? { medal: done.find(d => d.lesson_id === l.id).medal, best: done.find(d => d.lesson_id === l.id).best } : {}) })), firsts: Object.fromEntries(done.filter(d => d.lesson_id.startsWith('first:')).map(d => [d.lesson_id.slice(6), d.medal])) };
  });
  app.post('/player/school/:lesson', { schema: { params: z.object({ lesson: z.string().max(60) }), body: z.object({ value: z.number() }) } }, async req => {
    const u = await who(req), S = school(), lesson = S.lessons.find((l: any) => l.id === req.params.lesson);
    if (!lesson) throw notFound('That lesson');
    const got = medalFor(lesson, req.body.value);
    if (got === 'invalid') throw new AppError(400, 'BAD_REQUEST', 'That result isn\'t one a real run can measure.');
    const [prev] = await rows(sql`select medal, best, paid from school_results where user_id = ${u.id} and lesson_id = ${lesson.id}`);
    const rank = (m: string | null) => m ? MEDALS.indexOf(m as any) : -1;
    const medal = rank(got) > rank(prev?.medal ?? null) ? got : (prev?.medal ?? (got ?? 'none'));
    const best = better(lesson, prev?.best ?? null, req.body.value) ? req.body.value : prev.best;
    await db.execute(sql`insert into school_results (user_id, lesson_id, medal, best) values (${u.id}, ${lesson.id}, ${medal ?? 'none'}, ${best})
      on conflict (user_id, lesson_id) do update set medal = excluded.medal, best = excluded.best, attempts = school_results.attempts + 1, at = now()`);
    // each medal paid once, up to its own reward: bronze its reward, silver what it adds over bronze, gold over silver —
    // so a lesson's best medal has paid exactly its reward in all, however it was reached (data/school.json)
    const paid: string[] = [];
    if (got) for (const [i, m] of MEDALS.slice(0, rank(got) + 1).entries()) {
      const R = S.rewards[m], below = i ? S.rewards[MEDALS[i - 1]] : { money: 0, xp: 0 };
      const r = await economy.payReward(u.id, { money: Math.max(0, R.money - below.money), xp: Math.max(0, R.xp - below.xp), reason: `Driving school: ${lesson.id} (${m})`, key: `school:${lesson.id}:${m}` });
      if (r.paid) paid.push(m);
    }
    if (paid.length) await db.execute(sql`update school_results set paid = ${paid.at(-1)} where user_id = ${u.id} and lesson_id = ${lesson.id}`);
    return { medal: got, best, newBest: best === req.body.value, paid };
  });
  app.post('/player/firsts/:step', { schema: { params: z.object({ step: z.string().max(30) }), body: z.object({ skipped: z.boolean().default(false) }) } }, async req => {
    const u = await who(req), S = school();
    if (!S.firsts.steps.includes(req.params.step)) throw notFound('That step');
    const done = !req.body.skipped;
    await db.execute(sql`insert into school_results (user_id, lesson_id, medal) values (${u.id}, ${`first:${req.params.step}`}, ${done ? 'done' : 'skipped'})
      on conflict (user_id, lesson_id) do update set medal = case when school_results.medal = 'done' then 'done' else excluded.medal end, at = now()`);
    const r = done ? await economy.payReward(u.id, { money: S.firsts.reward.money, xp: S.firsts.reward.xp, reason: `First steps: ${req.params.step}`, key: `first:${req.params.step}` }) : { paid: false };
    return { step: req.params.step, state: done ? 'done' : 'skipped', paid: r.paid };
  });

  // ---------- analytics (anonymous, with consent) ----------
  app.post('/analytics', { config: { csrf: false }, bodyLimit: 64_000, schema: { body: AnalyticsBody } }, async (req, reply) => {
    const b = req.body;
    // (the browser's id hashed again with the server's secret: nothing stored links to it or to an account)
    const anon = crypto.createHmac('sha256', authSecret).update(`analytics:${b.anon}`).digest('base64url').slice(0, 22);
    const values = b.events.map(e => {
      const props = JSON.stringify(e.props ?? {});
      return sql`(${anon}, ${b.session.slice(0, 64)}, ${e.kind}, ${e.name ?? null}, ${b.version ?? null}, ${JSON.stringify(b.device)}::jsonb, ${props.length > LIMITS.analyticsPropsBytes ? '{}' : props}::jsonb)`;
    });
    await db.execute(sql`insert into analytics_events (anon, session, kind, name, version, device, props) values ${sql.join(values, sql`, `)}`);
    reply.status(204);
  });
  app.get('/admin/analytics', { ...admin, schema: { querystring: z.object({ days: z.coerce.number().int().min(1).max(400).default(30) }) } }, async req => {
    await adminWho(req);
    const since = sql`now() - make_interval(days => ${req.query.days})`;
    const players = await rows(sql`select count(distinct anon)::int as players, count(distinct session)::int as sessions, count(*)::int as events from analytics_events where at > ${since}`);
    const tutorial = await rows(sql`select name, count(distinct anon)::int as players from analytics_events where kind = 'tutorial' and at > ${since} group by name order by players desc`);
    const firsts = await rows(sql`select name, props->>'state' as state, count(distinct anon)::int as players from analytics_events where kind = 'first_step' and at > ${since} group by 1, 2 order by 1, 2`);
    // where new players stop: the last screen or step of each player whose first session was in the window and who
    // hasn't come back since
    const quits = await rows(sql`with firsts as (select anon, min(at) as first from analytics_events group by anon having min(at) > ${since}),
      gone as (select f.anon from firsts f where not exists (select 1 from analytics_events e where e.anon = f.anon and e.at > f.first + interval '1 day')),
      last as (select distinct on (e.anon) e.anon, e.kind, coalesce(e.name, '') as name from analytics_events e join gone g on g.anon = e.anon where e.kind in ('screen', 'tutorial', 'first_step', 'quit') order by e.anon, e.at desc)
      select kind, name, count(*)::int as players from last group by kind, name order by players desc limit 15`);
    const quests = await rows(sql`select name, count(*) filter (where kind = 'quest_start')::int as started, count(*) filter (where kind = 'quest_end' and props->>'result' = 'finished')::int as finished from analytics_events where kind in ('quest_start', 'quest_end') and at > ${since} and name is not null group by name order by started desc limit 15`);
    const tracks = await rows(sql`select name, count(*)::int as plays from analytics_events where kind = 'track_start' and at > ${since} and name is not null group by name order by plays desc limit 15`);
    const school2 = await rows(sql`select name, props->>'medal' as medal, count(*)::int as n from analytics_events where kind = 'school' and at > ${since} group by 1, 2 order by 1, 2`);
    // retention: of players who started on a day, how many came back 1 and 7 days later
    const retention = await rows(sql`with firsts as (select anon, date_trunc('day', min(at)) as d from analytics_events group by anon having min(at) > ${since})
      select f.d::date as day, count(*)::int as new_players,
        count(*) filter (where exists (select 1 from analytics_events e where e.anon = f.anon and e.at >= f.d + interval '1 day' and e.at < f.d + interval '2 days'))::int as d1,
        count(*) filter (where exists (select 1 from analytics_events e where e.anon = f.anon and e.at >= f.d + interval '7 days' and e.at < f.d + interval '8 days'))::int as d7
      from firsts f group by f.d order by f.d`);
    const perf = await rows(sql`select coalesce(device->>'tier', '?') as tier, coalesce(device->>'browser', '?') as browser, count(*)::int as samples,
        round(percentile_cont(0.5) within group (order by (props->>'fps')::float)::numeric, 1)::float as fps,
        round(percentile_cont(0.5) within group (order by (props->>'low1')::float)::numeric, 1)::float as low1
      from analytics_events where kind = 'perf' and at > ${since} and props ? 'fps' group by 1, 2 order by samples desc limit 20`);
    // crashes and errors by version: sessions with an error, of all sessions
    const errors = await rows(sql`select coalesce(version, '?') as version, count(distinct session)::int as sessions,
        count(distinct session) filter (where kind = 'error')::int as with_errors, count(*) filter (where kind = 'error')::int as errors,
        count(distinct session) filter (where kind = 'error' and props->>'fatal' = 'true')::int as crashed
      from analytics_events where at > ${since} group by 1 order by max(at) desc limit 10`);
    const topErrors = await rows(sql`select left(name, 80) as message, coalesce(version, '?') as version, count(*)::int as n from analytics_events where kind = 'error' and at > ${since} group by 1, 2 order by n desc limit 10`);
    // which accessibility and language choices players use (each player's latest)
    const access = (await rows(sql`with latest as (select distinct on (anon) props from analytics_events where kind = 'setting' and name = 'accessibility' and at > ${since} order by anon, at desc)
      select count(*)::int as players,
        count(*) filter (where (props->>'text')::float > 1.05)::int as bigger_text, count(*) filter (where props->>'contrast' = 'high')::int as high_contrast,
        count(*) filter (where coalesce(props->>'colours', 'standard') <> 'standard')::int as colour_blind, count(*) filter (where props->>'motion' = 'reduced')::int as reduced_motion,
        count(*) filter (where props->>'flashing' = 'full')::int as full_flashing, count(*) filter (where (props->>'cues')::boolean)::int as sound_cues,
        count(*) filter (where (props->>'toggles')::boolean)::int as toggles, count(*) filter (where props->>'units' = 'imperial')::int as imperial
      from latest`))[0];
    return { days: req.query.days, totals: players[0], access, tutorial, firsts, quits, quests, tracks, school: school2, retention, perf, errors, topErrors };
  });

  // ---------- news, patch notes and maintenance notices ----------
  const NewsBody = z.object({ kind: z.enum(['news', 'patch', 'maintenance', 'outage']), title: z.string().trim().min(3).max(120), body: z.string().max(4000), version: z.string().max(40).nullish(), link: z.string().max(300).nullish(), startsAt: z.string().datetime().nullish(), endsAt: z.string().datetime().nullish(), published: z.boolean().default(false) });
  const newsOut = (r: any) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, version: r.version, link: r.link, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), published: r.published, createdAt: iso(r.created_at) });
  app.get('/news', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    const items = await rows(sql`select * from news_items where published and starts_at <= now() and (ends_at is null or ends_at > now()) order by starts_at desc limit 30`);
    return { items: items.map(newsOut) };
  });
  app.get('/admin/news', admin, async req => { await adminWho(req); return { items: (await rows(sql`select * from news_items order by starts_at desc limit 200`)).map(newsOut) }; });
  app.post('/admin/news', { ...admin, schema: { body: NewsBody } }, async req => {
    const a = await adminWho(req), b = req.body, id = newId(9);
    await db.execute(sql`insert into news_items (id, kind, title, body, version, link, starts_at, ends_at, published, created_by) values (${id}, ${b.kind}, ${b.title}, ${b.body}, ${b.version ?? null}, ${b.link ?? null}, ${b.startsAt ?? new Date().toISOString()}, ${b.endsAt ?? null}, ${b.published}, ${a.id})`);
    await log(a.id, 'news-add', null, b.title, { id, kind: b.kind, published: b.published });
    return newsOut((await rows(sql`select * from news_items where id = ${id}`))[0]);
  });
  app.put('/admin/news/:id', { ...admin, schema: { params: Id, body: NewsBody } }, async req => {
    const a = await adminWho(req), b = req.body;
    const r = await rows(sql`update news_items set kind = ${b.kind}, title = ${b.title}, body = ${b.body}, version = ${b.version ?? null}, link = ${b.link ?? null}, starts_at = coalesce(${b.startsAt ?? null}::timestamptz, starts_at), ends_at = ${b.endsAt ?? null}, published = ${b.published} where id = ${req.params.id} returning *`);
    if (!r.length) throw notFound('That news item');
    await log(a.id, 'news-edit', null, b.title, { id: req.params.id, published: b.published });
    return newsOut(r[0]);
  });
  app.delete('/admin/news/:id', { ...admin, schema: { params: Id } }, async req => {
    const a = await adminWho(req);
    const r = await rows(sql`delete from news_items where id = ${req.params.id} returning title`);
    if (!r.length) throw notFound('That news item');
    await log(a.id, 'news-delete', null, r[0].title, { id: req.params.id });
    return { deleted: true };
  });

  // ---------- the event calendar ----------
  const EventBody = z.object({ kind: z.enum(['event', 'meet', 'tournament']), title: z.string().trim().min(3).max(120), body: z.string().max(2000).default(''), link: z.string().max(300).nullish(), region: z.string().max(40).nullish(), startsAt: z.string().datetime(), endsAt: z.string().datetime(), cancelled: z.boolean().default(false) });
  const eventOut = (r: any) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, region: r.region, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), cancelled: r.cancelled, going: Number(r.going ?? 0), mine: !!r.mine });
  app.get('/calendar', async req => {
    const s = await G.requireUser(req).catch(() => null), me = s?.user.id ?? '';
    // (meets made on the admin page's Free roam tab are on the calendar too)
    const items = await rows(sql`select c.*, (select count(*) from calendar_rsvps r where r.event_id = c.id) as going, exists (select 1 from calendar_rsvps r where r.event_id = c.id and r.user_id = ${me}) as mine
      from calendar_events c where c.ends_at > now() - interval '1 day' and c.starts_at < now() + interval '60 days' order by c.starts_at limit 100`);
    const meets = await rows(sql`select id, title, meet_id, starts_at, hours, cancelled from meet_events where starts_at + make_interval(hours => hours::int) > now() and starts_at < now() + interval '60 days' order by starts_at limit 50`).catch(() => []);
    return { events: [...items.map(eventOut), ...meets.map(m => ({ id: `meet:${m.id}`, kind: 'meet', title: m.title, body: '', link: `/?meet=${encodeURIComponent(m.meet_id)}`, region: null, startsAt: iso(m.starts_at), endsAt: new Date(new Date(m.starts_at).getTime() + Number(m.hours) * 3600e3).toISOString(), cancelled: m.cancelled, going: 0, mine: false }))].sort((a, b) => a.startsAt!.localeCompare(b.startsAt!)) };
  });
  app.post('/calendar/:id/rsvp', { schema: { params: Id } }, async req => {
    const u = await who(req);
    const [e] = await rows(sql`select id from calendar_events where id = ${req.params.id} and not cancelled`);
    if (!e) throw notFound('That event');
    await db.execute(sql`insert into calendar_rsvps (event_id, user_id) values (${e.id}, ${u.id}) on conflict do nothing`);
    return { going: true };
  });
  app.delete('/calendar/:id/rsvp', { schema: { params: Id } }, async req => { const u = await who(req); await db.execute(sql`delete from calendar_rsvps where event_id = ${req.params.id} and user_id = ${u.id}`); return { going: false }; });
  app.post('/admin/calendar', { ...admin, schema: { body: EventBody } }, async req => {
    const a = await adminWho(req), b = req.body, id = newId(9);
    if (new Date(b.endsAt) <= new Date(b.startsAt)) throw new AppError(400, 'BAD_REQUEST', 'An event ends after it starts.');
    await db.execute(sql`insert into calendar_events (id, kind, title, body, link, region, starts_at, ends_at, cancelled, created_by) values (${id}, ${b.kind}, ${b.title}, ${b.body}, ${b.link ?? null}, ${b.region ?? null}, ${b.startsAt}, ${b.endsAt}, ${b.cancelled}, ${a.id})`);
    await log(a.id, 'calendar-add', null, b.title, { id, kind: b.kind });
    return eventOut((await rows(sql`select * from calendar_events where id = ${id}`))[0]);
  });
  app.put('/admin/calendar/:id', { ...admin, schema: { params: Id, body: EventBody } }, async req => {
    const a = await adminWho(req), b = req.body;
    const r = await rows(sql`update calendar_events set kind = ${b.kind}, title = ${b.title}, body = ${b.body}, link = ${b.link ?? null}, region = ${b.region ?? null}, starts_at = ${b.startsAt}, ends_at = ${b.endsAt}, cancelled = ${b.cancelled} where id = ${req.params.id} returning *`);
    if (!r.length) throw notFound('That event');
    await log(a.id, 'calendar-edit', null, b.title, { id: req.params.id, cancelled: b.cancelled });
    return eventOut(r[0]);
  });
  app.delete('/admin/calendar/:id', { ...admin, schema: { params: Id } }, async req => {
    const a = await adminWho(req);
    const r = await rows(sql`delete from calendar_events where id = ${req.params.id} returning title`);
    if (!r.length) throw notFound('That event');
    await log(a.id, 'calendar-delete', null, r[0].title, { id: req.params.id });
    return { deleted: true };
  });
}
