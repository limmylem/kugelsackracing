// The player service on the server (Phase 6 Step 2): the only place money, cars, parts, builds, damage and
// XP change. The game sends what the player wants to do; this decides.
//
// Every action is one database transaction, holding the player's lock (an advisory lock on their id: two
// actions of theirs at once wait their turn — they can't spend the same money or move the same part twice).
// In it the player's economy is read from the tables, the game's own rules (garage/player/service.js — the
// same code the game ran in the browser, so the behaviour is the same) work the action out on it — every
// price from the server's economy settings (economy/config.ts), every part and car from the server's own
// data — and what changed is written back (economy/store.ts): the items, the build, and the money as a
// ledger row saying what it was for. The database checks it again (no balance below zero; a part in one
// place; the ledger following on, append-only).
//
// What the game can't ask for: anything that makes money or items from nothing (the development commands,
// importing a save, resetting the profile), a quest the server doesn't know (quests and track events are the
// server's: published world content, the day's tracks), a car's stats (worked out here from its build), a
// pink slip's prize (the quest's rival car, stock, and only for a win the server believes), damage that mends
// anything, or damage outside a session of theirs.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';
import type { EconomyConfig } from './config.ts';
import { loadProfile, saveProfile, type SaveMeta } from './store.ts';
import type { TrackService } from '../tracks/service.ts';
import { LocalPlayerService } from '../../../garage/player/service.js';
import { garageFor, carName } from '../../../garage/player/profile.js';
import { viewCourse } from '../../../route/model.js';
import { transverseMercator } from '../../../map/build/format/projection.js';
import { validateResult } from '../../../quest/validate.js';
import { decodePath } from './geometry.ts';

type Tx = Pick<Db, 'execute'>;
type User = { id: string; name: string };
export type Ctx = { idemKey?: string | null };

// how a session's damage reports are kept sensible (not economy values: limits on what one report can say)
const DAMAGE = { partsPerReport: 64, hitsPerPart: 32, reportsPerSession: 20000, refundWindowSec: 120, timeoutMin: 10 };

// the actions a player may ask for (their arguments are checked by the routes' schemas first)
export const PLAYER_ACTIONS = ['buyPart', 'sellPart', 'repairPart', 'repairParts', 'repairBody', 'repairCar', 'replaceWithSpare', 'basicRepair', 'installPart', 'removePart', 'buyAndInstall',
  'setBuild', 'setTuning', 'setPaint', 'setPartFinish', 'selectCar', 'buyCar', 'saveSetup', 'renameSetup', 'deleteSetup', 'switchSetup', 'markHint', 'favouriteTrack',
  'startQuest', 'refundQuest', 'finishQuest', 'failQuest', 'awardCar', 'forfeitCar', 'damageCar', 'wearPart', 'sessionReset'] as const;
export type PlayerAction = typeof PLAYER_ACTIONS[number];

const KIND: Record<string, string> = { buyPart: 'purchase', buyAndInstall: 'purchase', buyCar: 'purchase', sellPart: 'sale', repairPart: 'repair', repairParts: 'repair', repairBody: 'repair', repairCar: 'repair', replaceWithSpare: 'repair', basicRepair: 'repair', startQuest: 'entry_fee', refundQuest: 'refund', finishQuest: 'reward', failQuest: 'reward' };

export function createEconomy({ db, config, tracks, log = () => {} }: { db: Db; config: EconomyConfig; tracks: TrackService; log?: (o: object, m: string) => void }) {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const now = () => new Date().toISOString();

  // ---------- one player at a time ----------
  const withPlayer = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`economy:${userId}`}, 0))`);
    return fn(tx);
  }) as Promise<T>;

  // the game's rules on this player's profile: a service whose storage is the profile read, and catches what it saves
  async function engine(tx: Tx, userId: string, before: any) {
    const { db: game, quests: questsConfig, version } = await config.gameDb();
    let saved: any = null;
    const strip = (p: any) => { if (!p) return null; const { __rev, ...rest } = p; return rest; };
    const recordings = {
      put: async (id: string, rec: unknown) => { await tx.execute(sql`insert into player_recordings (user_id, id, data) values (${userId}, ${id}, ${zlib.gzipSync(Buffer.from(JSON.stringify(rec)))}) on conflict (user_id, id) do update set data = excluded.data`); },
      get: async (id: string) => { const r = (await tx.execute(sql`select data from player_recordings where user_id = ${userId} and id = ${id}`)).rows[0] as any; return r ? JSON.parse(zlib.gunzipSync(r.data).toString('utf8')) : null; },
      delete: async (id: string) => { await tx.execute(sql`delete from player_recordings where user_id = ${userId} and id = ${id}`); },
    };
    const idPrefix = BigInt('0x' + crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12)).toString(36).slice(0, 8);
    const svc: any = new (LocalPlayerService as any)({ db: game, idPrefix, storage: { load: async () => strip(before), save: async (p: any) => { saved = p; } }, quests: { config: questsConfig, recordings }, now });
    const init = await svc.init();
    return { svc, init, game, questsConfig, version, take: () => { const s = saved; saved = null; return s; } };
  }

  // A player's economy as it is now (made, the first time: the starting car and money — a ledger row)
  async function state(user: User) {
    const r = await withPlayer(user.id, async tx => {
      const before = await loadProfile(tx, user.id), E = await engine(tx, user.id, before);
      const first = E.take();
      let rev = before?.__rev ?? 0;
      if (first) rev = (await saveProfile(tx, user.id, before, first, { kind: before ? 'adjustment' : 'start', reason: before ? `Your save was put right: ${E.init.notices.join(' ')}` : 'Starting money', action: before ? 'adjust' : 'start', questsConfig: E.questsConfig })).rev;
      return { profile: E.init.updatedState, rev, notices: E.init.notices, configVersion: E.version, created: !before };
    });
    if (r.created) events.emit('change', user.id, r.rev);
    return r;
  }

  // ---------- quests: the server's own ----------
  async function questById(questId: string, trackCode: string | null) {
    if (/^trk_/.test(questId)) {
      const r = await tracks.resolveEvent(questId, trackCode, Date.now());
      return { quest: r.event, course: r.built.view, kind: r.kind };
    }
    const q = (await db.execute(sql`select data from content_items where id = ${questId} and view = 'published'`)).rows[0] as any;
    const quest = q?.data;
    if (!quest || quest.kind !== 'quest') throw new AppError(404, 'NOT_FOUND', 'There\'s no such quest (or it isn\'t open any more).');
    if (quest.enabled === false) throw new AppError(409, 'CONFLICT', 'That quest is switched off.');
    if (quest.track) { const b = await tracks.built(quest.track.code); return { quest: { ...quest, track: { ...quest.track, hash: quest.track.hash ?? b.hash } }, course: b.view, kind: 'official' }; }
    return { quest, course: await routeCourse(quest), kind: 'content' };
  }
  // a quest's route as the game drives it (route/model.js viewCourse), on a projection of its own
  async function routeCourse(quest: any) {
    if (!quest.route) return null;
    const r = (await db.execute(sql`select data from content_items where id = ${quest.route} and view = 'published'`)).rows[0] as any;
    const course = r?.data?.course;
    if (!course) return null;
    const first = decodePath(course)?.[0] ?? quest.location;
    return viewCourse(course, transverseMercator(first.lat, first.lon));
  }
  async function seriesOf(questId: string) {
    const rows = (await db.execute(sql`select data from content_items where view = 'published' and kind = 'series' and data->'quests' ? ${questId}`)).rows as any[];
    const out: any[] = [];
    for (const r of rows) {
      const ids: string[] = r.data.quests ?? [], qs = (await db.execute(sql`select data from content_items where view = 'published' and id = any(${`{${ids.map(i => `"${i.replace(/"/g, '')}"`).join(',')}}`}::text[])`)).rows.map((x: any) => x.data);
      out.push({ item: r.data, quests: qs });
    }
    return out;
  }
  // a car's numbers for a quest's entry rules: from its build, here — never the game's say-so
  function carSummary(E: any, profile: any, carInstanceId: string) {
    const c = profile.cars[carInstanceId];
    if (!c) return null;
    const t = garageFor(profile, E.game, carInstanceId).stats().totals;
    return { instanceId: carInstanceId, carId: c.carId, className: t?.rating?.class ?? null, kw: t?.peakPower?.kw ?? 0, kg: t?.mass ?? 0, topSpeed: (t?.rating?.estimates?.topSpeed ?? 250) / 3.6 };
  }

  // ---------- sessions ----------
  async function sessionOf(tx: Tx, userId: string, id: string | null | undefined, { active = true } = {}) {
    if (!id) throw new AppError(400, 'BAD_REQUEST', 'That needs the run or drive it belongs to (a session).');
    const s = (await tx.execute(sql`select * from economy_sessions where id = ${id} and user_id = ${userId}`)).rows[0] as any;
    if (!s) throw new AppError(404, 'NOT_FOUND', 'There\'s no such session of yours.');
    if (active && s.state !== 'active') throw new AppError(409, 'CONFLICT', `That session has ended (${s.state}).`);
    return s;
  }
  const touch = (tx: Tx, id: string) => tx.execute(sql`update economy_sessions set last_seen = now() where id = ${id}`);
  const endSession = (tx: Tx, id: string, state: string, reason: string | null, extra: { result?: unknown; paid?: boolean } = {}) =>
    tx.execute(sql`update economy_sessions set state = ${state}, end_reason = ${reason}, ended_at = now(), last_seen = now(),
      result = coalesce(${extra.result === undefined ? null : JSON.stringify(extra.result)}::jsonb, result), paid = paid or ${!!extra.paid} where id = ${id}`);

  // damage as a session may report it: about this car, only adding (the game's own rules then keep conditions
  // and parts coming off going one way) — mechanical damage merged with what's there, never replaced by less
  function sensibleDamage(profile: any, carInstanceId: string, report: any) {
    const parts = Object.entries(report?.parts ?? {});
    if (parts.length > DAMAGE.partsPerReport) throw new AppError(400, 'BAD_REQUEST', 'Too much in one damage report.');
    const out: any = { parts: {} };
    for (const [id, d] of parts as [string, any][]) {
      const x = profile.parts[id];
      if (!x || x.installedOn?.car !== carInstanceId) throw new AppError(400, 'BAD_REQUEST', `That part isn't on the car being driven.`);
      const r: any = {};
      if (d.condition !== undefined) r.condition = d.condition;
      if (d.hits !== undefined) { if (!Array.isArray(d.hits) || d.hits.length > DAMAGE.hitsPerPart) throw new AppError(400, 'BAD_REQUEST', 'Too many hits in one report.'); r.hits = d.hits; }
      if (d.attach !== undefined) r.attach = d.attach;
      if (d.damage !== undefined) r.damage = mergeDamage(x.damage, d.damage);
      out.parts[id] = r;
    }
    if (report?.shell) {
      const s = report.shell, r: any = {};
      if (s.condition !== undefined) r.condition = s.condition;
      if (s.hits !== undefined) { if (!Array.isArray(s.hits) || s.hits.length > DAMAGE.hitsPerPart) throw new AppError(400, 'BAD_REQUEST', 'Too many hits in one report.'); r.hits = s.hits; }
      if (s.broken !== undefined) r.broken = Array.isArray(s.broken) ? s.broken.slice(0, 64) : [];
      out.shell = r;
    }
    return out;
  }

  // ---------- an action ----------
  async function act(user: User, action: PlayerAction, args: any, ctx: Ctx = {}) {
    const result = await withPlayer(user.id, async tx => {
      const before = await loadProfile(tx, user.id), E = await engine(tx, user.id, before);
      let cur = before;
      const first = E.take();
      if (first) cur = { ...first, __rev: (await saveProfile(tx, user.id, before, first, { kind: before ? 'adjustment' : 'start', reason: before ? `Your save was put right: ${E.init.notices.join(' ')}` : 'Starting money', action: before ? 'adjust' : 'start', questsConfig: E.questsConfig })).rev };
      const profile = E.init.updatedState;
      const name = (kind: 'part' | 'car', id: string) => kind === 'part' ? E.game.parts[id]?.name ?? id : E.game.cars[id]?.name ?? id;
      let answer: any, meta: SaveMeta = { kind: KIND[action] ?? 'other', reason: action, action, idemKey: ctx.idemKey ?? null, questsConfig: E.questsConfig, ref: {} };
      const S = E.svc;
      switch (action) {
        // ---------- the garage, the shop, the workshop ----------
        case 'buyPart': answer = await S.buyPart(args.partId, { quantity: args.quantity }); meta.reason = `Bought ${answer.instanceIds?.length > 1 ? `${answer.instanceIds.length} × ` : ''}${name('part', args.partId)}`; meta.ref = { partId: args.partId, instanceIds: answer.instanceIds ?? [] }; break;
        case 'buyAndInstall': answer = await S.buyAndInstall(args.carInstanceId, args.partId, args.opts ?? {}); meta.reason = `Bought and fitted ${name('part', args.partId)}`; meta.ref = { partId: args.partId, car: args.carInstanceId }; break;
        case 'buyCar': answer = await S.buyCar(args.carId); meta.reason = `Bought a ${name('car', args.carId)}`; meta.ref = { carId: args.carId, carInstanceId: answer.carInstanceId ?? null, cost: answer.cost ?? null }; break;
        case 'sellPart': { const x = profile.parts[args.instanceId]; answer = await S.sellPart(args.instanceId); meta.reason = `Sold ${x ? name('part', x.partId) : args.instanceId}`; meta.ref = { instanceId: args.instanceId, partId: x?.partId ?? null }; break; }
        case 'repairPart': answer = await S.repairPart(args.instanceId); meta.reason = `Repaired ${name('part', profile.parts[args.instanceId]?.partId ?? args.instanceId)}`; meta.ref = { instanceIds: [args.instanceId] }; break;
        case 'repairParts': answer = await S.repairParts(args.instanceIds); meta.reason = `Repaired ${args.instanceIds.length} part${args.instanceIds.length === 1 ? '' : 's'}`; meta.ref = { instanceIds: args.instanceIds }; break;
        case 'repairBody': answer = await S.repairBody(args.carInstanceId); meta.reason = `Repaired the body of the ${profile.cars[args.carInstanceId] ? carName(profile, E.game, args.carInstanceId) : 'car'}`; meta.ref = { car: args.carInstanceId }; break;
        case 'repairCar': answer = await S.repairCar(args.carInstanceId, args.opts ?? {}); meta.reason = `${args.opts?.kind === 'quick' ? 'Quick' : 'Full'} repair on the ${profile.cars[args.carInstanceId] ? carName(profile, E.game, args.carInstanceId) : 'car'}`; meta.ref = { car: args.carInstanceId, items: args.opts?.items ?? 'all' }; break;
        case 'replaceWithSpare': answer = await S.replaceWithSpare(args.carInstanceId, args.socket, args.instanceId); meta.reason = `Fitted a spare ${name('part', profile.parts[args.instanceId]?.partId ?? '')}`; meta.ref = { car: args.carInstanceId, socket: args.socket, instanceId: args.instanceId }; break;
        case 'basicRepair': answer = await S.basicRepair(args.carInstanceId); meta.reason = 'The free basic repair'; meta.ref = { car: args.carInstanceId }; break;
        case 'installPart': answer = await S.installPart(args.carInstanceId, args.instanceId, args.opts ?? {}); break;
        case 'removePart': answer = await S.removePart(args.carInstanceId, args.which, args.opts ?? {}); break;
        case 'setBuild': answer = await S.setBuild(args.carInstanceId, args.build ?? {}); break;
        case 'setTuning': answer = await S.setTuning(args.instanceId, args.settings ?? {}); break;
        case 'setPaint': answer = await S.setPaint(args.carInstanceId, args.paint ?? null); break;
        case 'setPartFinish': answer = await S.setPartFinish(args.instanceIds, args.look ?? null); break;
        case 'selectCar': answer = await S.selectCar(args.carInstanceId); break;
        case 'saveSetup': answer = await S.saveSetup(args.carInstanceId, args.opts ?? {}); break;
        case 'renameSetup': answer = await S.renameSetup(args.carInstanceId, args.setupId, args.name); break;
        case 'deleteSetup': answer = await S.deleteSetup(args.carInstanceId, args.setupId); break;
        case 'switchSetup': answer = await S.switchSetup(args.carInstanceId, args.setupId, args.opts ?? {}); break;
        case 'markHint': answer = await S.markHint(args.id); break;
        case 'favouriteTrack': answer = await S.favouriteTrack(args.track, args.on); break;

        // ---------- quests and track events: a session each ----------
        case 'startQuest': {
          const { quest, kind } = await questById(args.questId, args.trackCode ?? null);
          const carId = args.carInstanceId ?? profile.currentCar, car = carSummary(E, profile, carId);
          if (!car) throw new AppError(400, 'BAD_REQUEST', 'That car isn\'t yours.');
          // (one run at a time: one still going is ended — its fee spent, as a quit's is)
          await tx.execute(sql`update economy_sessions set state = 'failed', end_reason = 'another started', ended_at = now() where user_id = ${user.id} and kind = 'quest' and state = 'active'`);
          const sessionId = `ses_${crypto.randomUUID()}`, attemptId = `att_${crypto.randomBytes(6).toString('hex')}`;
          answer = await S.startQuest(quest, { carInstanceId: carId, car, restart: !!args.restart, attemptId });
          if (answer.ok) {
            await tx.execute(sql`insert into economy_sessions (id, user_id, kind, quest_id, attempt_id, car_instance_id, fee, state, quest)
              values (${sessionId}, ${user.id}, 'quest', ${quest.id}, ${attemptId}, ${carId}, ${answer.fee ?? 0}, 'active', ${JSON.stringify({ ...quest, __kind: kind })}::jsonb)`);
            answer.sessionId = sessionId;
          }
          meta = { ...meta, reason: `Entry fee: ${quest.name}`, ref: { questId: quest.id }, sessionId };
          break;
        }
        case 'refundQuest': {
          const s = await sessionOf(tx, user.id, args.sessionId);
          if (Date.now() - new Date(s.started_at).getTime() > DAMAGE.refundWindowSec * 1000 || s.damage_reports > 0) throw new AppError(409, 'CONFLICT', 'That run got under way: its fee isn\'t refunded (quit it instead).');
          answer = await S.refundQuest(s.attempt_id);
          if (answer.ok) await endSession(tx, s.id, 'refunded', 'the game couldn\'t start it');
          meta = { ...meta, reason: `Entry fee refunded: ${s.quest?.name ?? s.quest_id}`, ref: { questId: s.quest_id }, sessionId: s.id };
          break;
        }
        case 'finishQuest': {
          const s = await sessionOf(tx, user.id, args.sessionId);
          const quest = s.quest, { __kind, ...q } = quest, course = q.track ? (await tracks.built(q.track.code)).view : await routeCourse(q);
          if (args.result?.attemptId !== s.attempt_id) throw new AppError(400, 'BAD_REQUEST', 'That result is for another run.');
          answer = await S.finishQuest(args.result, { quest: q, course, recording: args.recording ?? null, series: await seriesOf(q.id) });
          if (answer.ok) await endSession(tx, s.id, 'finished', answer.valid ? 'finished' : 'not believed', { result: { result: args.result, valid: answer.valid, problems: answer.problems ?? [] }, paid: true });
          meta = { ...meta, reason: `${answer.valid ? 'Reward' : 'Run not counted'}: ${q.name}${answer.medal ? ` (${answer.medal})` : ''}`, ref: { questId: q.id, medal: answer.medal ?? null, xp: answer.xp ?? 0 }, sessionId: s.id };
          break;
        }
        case 'failQuest': {
          const s = await sessionOf(tx, user.id, args.sessionId);
          answer = await S.failQuest(s.attempt_id, { questId: s.quest_id, status: args.status ?? 'dnf', reason: args.reason ?? null });
          if (answer.ok) await endSession(tx, s.id, 'failed', args.status ?? 'dnf');
          meta = { ...meta, reason: `Didn't finish: ${s.quest?.name ?? s.quest_id}`, sessionId: s.id };
          break;
        }
        // a pink slip: the prize is the quest's rival car, stock — for a win the server believes (once)
        case 'awardCar': {
          const s = await sessionOf(tx, user.id, args.sessionId), q = s.quest;
          if (q?.type !== 'pink_slip') throw new AppError(409, 'CONFLICT', 'A car only changes hands in a pink-slip race.');
          if (s.result?.awarded) throw new AppError(409, 'CONFLICT', 'That pink slip has been paid out.');
          const { __kind, ...quest } = q, course = quest.track ? (await tracks.built(quest.track.code)).view : await routeCourse(quest);
          const v = validateResult(args.result, { quest, course, config: E.questsConfig });
          if (!v.ok || args.result?.attemptId !== s.attempt_id || args.result?.status !== 'finished' || args.result?.place !== 1) throw new AppError(409, 'CONFLICT', `That run doesn't win the pink slip${v.problems[0] ? `: ${v.problems[0]}` : ''}.`);
          const prize = quest.params?.opponentCar;
          if (!prize || !E.game.cars[prize]) throw new AppError(409, 'CONFLICT', 'That pink slip has no car to win.');
          answer = await S.awardCar(prize, { attemptId: s.attempt_id, parts: [] });
          if (answer.ok) await tx.execute(sql`update economy_sessions set result = coalesce(result, '{}'::jsonb) || ${JSON.stringify({ awarded: prize })}::jsonb where id = ${s.id}`);
          meta = { ...meta, kind: 'other', reason: `Won a ${name('car', prize)} (pink slip)`, ref: { carId: prize }, sessionId: s.id };
          break;
        }
        case 'forfeitCar': {
          const s = await sessionOf(tx, user.id, args.sessionId);
          answer = await S.forfeitCar(args.carInstanceId, { attemptId: s.attempt_id });
          meta = { ...meta, kind: 'other', reason: 'Lost a car (pink slip)', ref: { car: args.carInstanceId }, sessionId: s.id };
          break;
        }
        // ---------- driving: damage, wear, a session's reset ----------
        case 'damageCar': case 'wearPart': case 'sessionReset': {
          const s = await sessionOf(tx, user.id, args.sessionId);
          if (s.damage_reports >= DAMAGE.reportsPerSession) throw new AppError(429, 'RATE_LIMITED', 'Too many damage reports in one session.');
          const car = s.car_instance_id ?? profile.currentCar;
          if (action === 'damageCar') {
            if (args.carInstanceId !== car) throw new AppError(400, 'BAD_REQUEST', 'That isn\'t the car being driven in this session.');
            answer = await S.damageCar(car, sensibleDamage(profile, car, args.report), { cause: String(args.cause ?? 'crash').slice(0, 80) });
          } else if (action === 'wearPart') {
            if (profile.parts[args.instanceId]?.installedOn?.car !== car) throw new AppError(400, 'BAD_REQUEST', 'That part isn\'t on the car being driven.');
            answer = await S.wearPart(args.instanceId, args.condition, { cause: String(args.cause ?? 'wear').slice(0, 80) });
          } else {
            // (a run's reset puts back only what a race's does; a test drive's, what a test's does — never the player's choice)
            const kind = s.kind === 'quest' ? 'race' : s.quest?.mode === 'test' ? 'test' : 'race';
            answer = await S.sessionReset(car, { kind });
          }
          await tx.execute(sql`update economy_sessions set damage_reports = damage_reports + 1, last_seen = now() where id = ${s.id}`);
          meta = { ...meta, kind: 'other', reason: action, sessionId: s.id };
          break;
        }
        default: throw new AppError(400, 'BAD_REQUEST', `There's no action "${action}".`);
      }
      const saved = E.take();
      let rev = cur?.__rev ?? 0, ledgerId: number | null = null;
      if (answer?.ok && saved) { const r = await saveProfile(tx, user.id, cur, saved, meta); rev = r.rev; ledgerId = r.ledgerId; }
      return { ...answer, rev, ledgerId, configVersion: E.version };
    });
    if (result.ok) events.emit('change', user.id, result.rev);
    return result;
  }

  // ---------- drives: free roam and test drives (where crash damage comes from) ----------
  async function startDrive(user: User, { carInstanceId, mode }: { carInstanceId: string; mode: 'free' | 'test' }) {
    return withPlayer(user.id, async tx => {
      const own = (await tx.execute(sql`select 1 from owned_cars where user_id = ${user.id} and instance_id = ${carInstanceId}`)).rows.length;
      if (!own) throw new AppError(400, 'BAD_REQUEST', 'That car isn\'t yours.');
      await tx.execute(sql`update economy_sessions set state = 'finished', end_reason = 'another drive', ended_at = now() where user_id = ${user.id} and kind = 'drive' and state = 'active'`);
      const id = `drv_${crypto.randomUUID()}`;
      await tx.execute(sql`insert into economy_sessions (id, user_id, kind, car_instance_id, state, quest) values (${id}, ${user.id}, 'drive', ${carInstanceId}, 'active', ${JSON.stringify({ mode })}::jsonb)`);
      return { ok: true as const, sessionId: id };
    });
  }
  async function heartbeat(user: User, sessionId: string) {
    const r = await db.execute(sql`update economy_sessions set last_seen = now() where id = ${sessionId} and user_id = ${user.id} and state = 'active' returning id`);
    if (!r.rows.length) throw new AppError(409, 'CONFLICT', 'That session has ended.');
    return { ok: true as const };
  }
  async function endDrive(user: User, sessionId: string) {
    await db.execute(sql`update economy_sessions set state = 'finished', end_reason = 'ended', ended_at = now() where id = ${sessionId} and user_id = ${user.id} and kind = 'drive' and state = 'active'`);
    return { ok: true as const };
  }
  // runs and drives gone quiet (the game closed, the connection lost): a run ends as a quit (its fee spent,
  // nothing paid), a drive simply ends
  async function sweep() {
    const stale = (await db.execute(sql`select id, user_id, kind, attempt_id, quest_id from economy_sessions where state = 'active' and last_seen < now() - make_interval(mins => ${DAMAGE.timeoutMin})`)).rows as any[];
    for (const s of stale) {
      try {
        if (s.kind === 'drive') { await db.execute(sql`update economy_sessions set state = 'expired', end_reason = 'no word from the game', ended_at = now() where id = ${s.id} and state = 'active'`); continue; }
        await withPlayer(s.user_id, async tx => {
          const still = (await tx.execute(sql`select state from economy_sessions where id = ${s.id} for update`)).rows[0] as any;
          if (still?.state !== 'active') return;
          const before = await loadProfile(tx, s.user_id), E = await engine(tx, s.user_id, before);
          E.take();
          const a = await E.svc.failQuest(s.attempt_id, { questId: s.quest_id, status: 'disconnected', reason: 'no word from the game' });
          const saved = E.take();
          if (a.ok && saved) await saveProfile(tx, s.user_id, before, saved, { kind: 'other', reason: 'Run ended: no word from the game', action: 'timeout', sessionId: s.id, questsConfig: E.questsConfig });
          await endSession(tx, s.id, 'expired', 'no word from the game');
        });
        events.emit('change', s.user_id, -1);
      } catch (e) { log({ err: e, session: s.id }, 'ending a quiet session failed'); }
    }
    return stale.length;
  }

  // ---------- admins: money and items put right, by hand (always with a reason; the caller logs it) ----------
  async function adminMoney(admin: User, userId: string, amount: number, reason: string) {
    return withPlayer(userId, async tx => {
      const before = await loadProfile(tx, userId);
      if (!before) throw new AppError(404, 'NOT_FOUND', 'That player hasn\'t played yet.');
      if (before.money + amount < 0) throw new AppError(409, 'CONFLICT', `They have ${before.money}: that would take them below zero.`);
      const r = await saveProfile(tx, userId, before, { ...before, money: before.money + amount }, { kind: amount > 0 ? 'grant' : 'removal', reason, actorId: admin.id, action: 'admin', ref: {} });
      return { ok: true as const, ledgerId: r.ledgerId, rev: r.rev };
    }).then(r => { events.emit('change', userId, r.rev); return r; });
  }
  async function adminReverse(admin: User, ledgerId: number, reason: string) {
    const row = (await db.execute(sql`select * from ledger where id = ${ledgerId}`)).rows[0] as any;
    if (!row) throw new AppError(404, 'NOT_FOUND', 'There\'s no such transaction.');
    if (row.kind === 'reversal') throw new AppError(409, 'CONFLICT', 'A reversal can\'t itself be reversed: grant or remove money instead.');
    return withPlayer(row.user_id, async tx => {
      if ((await tx.execute(sql`select 1 from ledger where reverses = ${ledgerId}`)).rows.length) throw new AppError(409, 'CONFLICT', 'That transaction has been reversed already.');
      const before = await loadProfile(tx, row.user_id), amount = -Number(row.amount);
      if (before.money + amount < 0) throw new AppError(409, 'CONFLICT', `Reversing it would take them below zero (they have ${before.money}).`);
      const r = (await tx.execute(sql`insert into ledger (user_id, amount, balance_after, kind, reason, ref, actor_id, reverses) values (${row.user_id}, ${amount}, ${before.money + amount}, 'reversal', ${reason}, ${JSON.stringify({ reverses: ledgerId, was: row.reason })}::jsonb, ${admin.id}, ${ledgerId}) returning id`)).rows[0] as any;
      await tx.execute(sql`update player_economy set rev = rev + 1 where user_id = ${row.user_id}`);
      return { ok: true as const, ledgerId: Number(r.id), userId: row.user_id as string };
    }).then(r => { events.emit('change', r.userId, -1); return r; });
  }
  // items: given (a new copy of a part, a car with its stock parts) or taken away (a copy not on a car; a car and what's on it)
  async function adminItem(admin: User, userId: string, op: { give?: { partId?: string; carId?: string; quantity?: number }; remove?: { instanceId?: string; carInstanceId?: string } }, reason: string) {
    return withPlayer(userId, async tx => {
      const before = await loadProfile(tx, userId);
      if (!before) throw new AppError(404, 'NOT_FOUND', 'That player hasn\'t played yet.');
      const E = await engine(tx, userId, before);
      E.take();
      const p = JSON.parse(JSON.stringify(E.init.updatedState));
      const { addPart, addCar, packProfile } = await import('../../../garage/player/profile.js');
      if (op.give?.partId) { if (!E.game.parts[op.give.partId]) throw new AppError(400, 'BAD_REQUEST', `There's no part "${op.give.partId}".`); for (let k = 0; k < Math.min(20, op.give.quantity ?? 1); k++) addPart(p, E.game, op.give.partId); }
      if (op.give?.carId) { if (!E.game.cars[op.give.carId]) throw new AppError(400, 'BAD_REQUEST', `There's no car "${op.give.carId}".`); addCar(p, E.game, op.give.carId); }
      if (op.remove?.instanceId) { const x = p.parts[op.remove.instanceId]; if (!x) throw new AppError(404, 'NOT_FOUND', 'They have no such part.'); if (x.installedOn) throw new AppError(409, 'CONFLICT', 'That part is on a car: take the car, or take it off first.'); delete p.parts[op.remove.instanceId]; }
      if (op.remove?.carInstanceId) {
        const id = op.remove.carInstanceId;
        if (!p.cars[id]) throw new AppError(404, 'NOT_FOUND', 'They have no such car.');
        if (Object.keys(p.cars).length < 2) throw new AppError(409, 'CONFLICT', 'That\'s their only car.');
        for (const [pid, x] of Object.entries<any>(p.parts)) if (x.installedOn?.car === id) delete p.parts[pid];
        delete p.cars[id];
        if (p.currentCar === id) p.currentCar = Object.keys(p.cars)[0];
      }
      const r = await saveProfile(tx, userId, before, { ...packProfile(p), __rev: undefined }, { kind: 'other', reason, actorId: admin.id, action: `admin: ${op.give ? 'given' : 'taken'}`, questsConfig: E.questsConfig });
      return { ok: true as const, rev: r.rev };
    }).then(r => { events.emit('change', userId, r.rev); return r; });
  }

  return {
    events, state, act, startDrive, heartbeat, endDrive, sweep, adminMoney, adminReverse, adminItem, withPlayer,
    // (for the checks: every balance equals its ledger's sum)
    async ledgerCheck() {
      return (await db.execute(sql`select e.user_id, e.balance, coalesce(sum(l.amount), 0) as total, (select balance_after from ledger x where x.user_id = e.user_id order by id desc limit 1) as last
        from player_economy e left join ledger l on l.user_id = e.user_id group by e.user_id, e.balance having e.balance <> coalesce(sum(l.amount), 0)`)).rows;
    },
    DAMAGE,
  };
}
export type Economy = ReturnType<typeof createEconomy>;

// mechanical damage: what's there kept, and only made worse — each value the bigger (in size) of what was
// and what's reported
function mergeDamage(was: any, now: any) {
  const out: any = JSON.parse(JSON.stringify(was ?? {}));
  if (!now || typeof now !== 'object') return out;
  for (const [k, v] of Object.entries<any>(now)) {
    if (Number.isFinite(v)) { if (!Number.isFinite(out[k]) || Math.abs(v) > Math.abs(out[k])) out[k] = v; }
    else if (v && typeof v === 'object') { out[k] = typeof out[k] === 'object' && out[k] ? out[k] : {}; for (const [j, x] of Object.entries<any>(v)) if (Number.isFinite(x) && (!Number.isFinite(out[k][j]) || Math.abs(x) > Math.abs(out[k][j]))) out[k][j] = x; }
  }
  return out;
}
