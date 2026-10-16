// The ROADBOOK on the server (docs/ROADBOOK.md): the seasons, their challenges and chapters, Expeditions, Season Tokens
// and the season's shop, and each player's Personal History. The only place points, tokens, Expedition progress and
// shop items change: the game shows them, and reports positions; the rest it hears from the game's own server-side
// systems (economy.events: a quest the server checked, a car bought, a part fitted, a multiplayer race confirmed, a photo
// saved) — never what the game says it did.
//
// Every change is one transaction holding the player's ROADBOOK lock. Tokens are a ledger (token_ledger): each row a
// change with its reason and a key that can only be used once in a season (an award, a purchase, the season's end), so
// nothing is paid or bought twice, however often it's asked for.
//
// The seasons' clock (roadbook_seasons): a season is "testing" until it starts — only admins and editors see it; it
// starts on its date, or (start: "beta_open") when sign-ups open to everyone (the Launch tab's closed-beta switch) or
// an admin starts it; what was played while testing is cleared then. It ends lengthDays later: each player's tokens left
// become cash (conversion.cashPerToken, in the economy's ledger), once.

import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';
import type { Economy } from '../economy/service.ts';
import type { RoadbookConfig } from './config.ts';
import { applyEvent, applyPing, challengeProgress, chapterOpen, newProgress, seasonView, startExpedition, unlocksOf } from '../../../roadbook/engine.js';
import { currentStage, stageTargets } from '../../../roadbook/expedition.js';
import { LIMITS, metresBetween } from '../../../roadbook/geo.js';

type Tx = Pick<Db, 'execute'>;
type User = { id: string; name?: string; role?: string | null };
const DAY = 86_400_000;
const staffRole = (r?: string | null) => r === 'admin' || r === 'editor';

export function createRoadbook({ db, config, economy, log = () => {}, clock = () => Date.now() }: { db: Db; config: RoadbookConfig; economy: Economy; log?: (o: object, m: string) => void; clock?: () => number }) {
  const rows = async (q: ReturnType<typeof sql>, tx: Tx = db) => (await tx.execute(q)).rows as any[];
  const withLock = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`roadbook:${userId}`}, 0))`);
    return fn(tx);
  }) as Promise<T>;

  // ---------- the seasons' clock ----------
  async function clockOf(seasonId: string) {
    const all = await config.data(), v = seasonView(all, seasonId);
    if (!v) return null;
    let [r] = await rows(sql`select * from roadbook_seasons where season_id = ${seasonId}`);
    if (!r) {
      // (a season with a date of its own starts on it; "beta_open" waits)
      const date = v.season.start !== 'beta_open' ? Date.parse(v.season.start) : NaN;
      await db.execute(sql`insert into roadbook_seasons (season_id, status) values (${seasonId}, 'testing') on conflict do nothing`);
      if (Number.isFinite(date) && date <= clock()) await start(seasonId, { at: date });
      [r] = await rows(sql`select * from roadbook_seasons where season_id = ${seasonId}`);
    }
    const t = (x: any) => x ? new Date(x).getTime() : null;
    return { id: seasonId, status: r.status as 'testing' | 'live' | 'ended', startedAt: t(r.started_at), endsAt: t(r.ends_at), endedAt: t(r.ended_at), view: v };
  }
  // the season a player plays now: the current one, if it's live (or ended: shown, nothing more earned) — or testing,
  // for admins and editors
  async function seasonFor(user: User) {
    const all = await config.data(), c = await clockOf(all.current);
    if (!c) return null;
    if (c.status === 'live' && c.endsAt && clock() >= c.endsAt) { await end(c.id); return seasonFor(user); }
    const visible = c.status !== 'testing' || staffRole(user.role);
    return visible ? { ...c, all } : null;
  }
  // a season started: testing's progress cleared (the testers start again with everyone), its clock running
  async function start(seasonId: string, { at = clock(), by = null as string | null } = {}) {
    const v = seasonView(await config.data(), seasonId);
    if (!v) throw new AppError(404, 'NOT_FOUND', 'There\'s no such season.');
    return db.transaction(async tx => {
      const [r] = await rows(sql`select status from roadbook_seasons where season_id = ${seasonId} for update`, tx);
      if (r && r.status !== 'testing') return { ok: false as const, error: `That season is ${r.status} already.` };
      const ends = new Date(at + v.season.lengthDays * DAY).toISOString();
      for (const t of ['roadbook_progress', 'token_ledger', 'player_items']) await tx.execute(sql`delete from ${sql.raw(t)} where season_id = ${seasonId}`);
      await tx.execute(sql`insert into roadbook_seasons (season_id, status, started_at, ends_at, updated_at) values (${seasonId}, 'live', ${new Date(at).toISOString()}, ${ends}, now())
        on conflict (season_id) do update set status = 'live', started_at = excluded.started_at, ends_at = excluded.ends_at, ended_at = null, updated_at = now()`);
      log({ season: seasonId, by, ends }, 'ROADBOOK season started');
      return { ok: true as const, startedAt: new Date(at).toISOString(), endsAt: ends };
    });
  }
  // the season over: marked ended, then every player's tokens turned into cash (here, or the sweep, or the player's
  // next visit — each player once)
  async function end(seasonId: string, { by = null as string | null } = {}) {
    await db.execute(sql`update roadbook_seasons set status = 'ended', ended_at = coalesce(ended_at, now()), ends_at = least(coalesce(ends_at, now()), now()), updated_at = now() where season_id = ${seasonId} and status <> 'ended'`);
    log({ season: seasonId, by }, 'ROADBOOK season ended');
    return convertAll(seasonId);
  }
  async function convertAll(seasonId: string) {
    const left = await rows(sql`select user_id from token_ledger where season_id = ${seasonId} group by user_id having sum(amount) > 0`);
    let n = 0;
    for (const r of left) { try { if ((await convert(r.user_id, seasonId)).converted) n++; } catch (e) { log({ err: e, user: r.user_id, season: seasonId }, 'turning tokens into cash failed'); } }
    return { ok: true as const, converted: n };
  }
  // a player's tokens left at a season's end: cash at its rate (the economy's ledger, once by its key), then the tokens
  // gone (their ledger, once by its key) — either step done twice does nothing more
  async function convert(userId: string, seasonId: string) {
    const v = seasonView(await config.data(), seasonId);
    const tokens = await balance(db, userId, seasonId);
    if (tokens <= 0) return { converted: false };
    const rate = v?.season.conversion?.cashPerToken ?? 0, money = Math.floor(tokens * rate);
    if (money > 0) await economy.payReward(userId, { money, xp: 0, reason: `Season Tokens left at the end of ${v?.season.name ?? seasonId}: ${tokens} × $${rate}`, key: `season-end:${seasonId}` });
    await withLock(userId, async tx => { await ledger(tx, userId, seasonId, { amount: -(await balance(tx, userId, seasonId)), kind: 'season_end', reason: `The season ended: tokens turned into $${money}`, key: 'season-end', ref: { money, rate } }); });
    return { converted: true, tokens, money };
  }
  // seasons whose time is up, ended (every minute: the server's sweep)
  async function sweep() {
    const due = await rows(sql`select season_id from roadbook_seasons where status = 'live' and ends_at <= ${new Date(clock()).toISOString()}`);
    for (const r of due) await end(r.season_id);
    // (and any player whose conversion didn't happen — the database away a moment)
    for (const r of await rows(sql`select season_id from roadbook_seasons where status = 'ended'`)) await convertAll(r.season_id);
    return due.length;
  }
  // the beta opened (the Launch tab): the current season, if it waits for that, starts now
  async function betaOpened(by: string | null) {
    const all = await config.data(), c = await clockOf(all.current);
    if (c?.status === 'testing' && c.view.season.start === 'beta_open') return start(c.id, { by });
    return { ok: false as const, error: 'No season was waiting for the beta.' };
  }

  // ---------- tokens ----------
  async function balance(tx: Tx, userId: string, seasonId: string) {
    const [r] = await rows(sql`select coalesce(sum(amount), 0)::int as n from token_ledger where user_id = ${userId} and season_id = ${seasonId}`, tx);
    return Number(r.n);
  }
  // a ledger row, once by its key (false: that key's been used — nothing done)
  async function ledger(tx: Tx, userId: string, seasonId: string, e: { amount: number; kind: string; reason: string; key: string; ref?: object; actorId?: string | null }) {
    if (!e.amount) return false;
    const have = await balance(tx, userId, seasonId), after = have + e.amount;
    if (after < 0) throw new AppError(409, 'CONFLICT', `You have ${have} Season Tokens: not enough.`);
    const r = await rows(sql`insert into token_ledger (user_id, season_id, amount, balance_after, kind, reason, key, ref, actor_id) values (${userId}, ${seasonId}, ${e.amount}, ${after}, ${e.kind}, ${e.reason}, ${e.key}, ${JSON.stringify(e.ref ?? {})}::jsonb, ${e.actorId ?? null})
      on conflict (user_id, season_id, key) do nothing returning id`, tx);
    return r.length > 0;
  }

  // ---------- progress and history ----------
  async function loadProgress(tx: Tx, userId: string, season: any) {
    const [r] = await rows(sql`select data from roadbook_progress where user_id = ${userId} and season_id = ${season.id} for update`, tx);
    return r ? { ...newProgress(season), ...r.data } : newProgress(season);
  }
  const saveProgress = (tx: Tx, userId: string, seasonId: string, P: any) => tx.execute(sql`insert into roadbook_progress (user_id, season_id, data, points, updated_at) values (${userId}, ${seasonId}, ${JSON.stringify(P)}::jsonb, ${P.points}, now())
    on conflict (user_id, season_id) do update set data = excluded.data, points = excluded.points, updated_at = now()`);
  async function loadHistory(tx: Tx, userId: string) {
    const [r] = await rows(sql`select data from player_history where user_id = ${userId} for update`, tx);
    return { distanceM: 0, byCar: {}, places: {}, expeditions: [], wins: 0, track: null, ...(r?.data ?? {}) } as any;
  }
  const saveHistory = (tx: Tx, userId: string, h: any) => tx.execute(sql`insert into player_history (user_id, data, updated_at) values (${userId}, ${JSON.stringify(h)}::jsonb, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now()`);
  // what's owed, recorded: each award's tokens (its points are in the progress already), and what the history keeps
  async function settle(tx: Tx, userId: string, seasonId: string, awards: any[], events: any[], H: any) {
    const paid: any[] = [];
    // (an award with tokens: paid once by its key — one already paid isn't paid or shown again)
    for (const a of awards) {
      if (!(a.tokens > 0)) { paid.push(a); continue; }
      if (await ledger(tx, userId, seasonId, { amount: a.tokens, kind: a.kind, reason: a.reason, key: a.key, ref: a.ref })) paid.push(a);
    }
    for (const e of events) {
      if (e.type === 'place_discovered') H.places[e.data.place] ??= new Date(clock()).toISOString();
      if (e.type === 'expedition_completed' && !H.expeditions.some((x: any) => x.id === e.data.expedition && x.season === seasonId)) H.expeditions.push({ id: e.data.expedition, season: seasonId, at: new Date(clock()).toISOString() });
    }
    return paid;
  }

  // An event from the game's own server-side systems, once by its key: the history's counts (always); the season's
  // challenges (when the player has a season)
  async function hear(userId: string, key: string, ev: { type: string; data: any }) {
    const [u] = await rows(sql`select role from users where id = ${userId}`);
    if (!u) return null;
    const S = await seasonFor({ id: userId, role: u.role });
    return withLock(userId, async tx => {
      const fresh = await rows(sql`insert into roadbook_seen (user_id, key) values (${userId}, ${key}) on conflict do nothing returning key`, tx);
      if (!fresh.length) return null;
      const H = await loadHistory(tx, userId);
      // (quests won: counted here from the ROADBOOK's start — the game kept no count of them; online wins are in mp_race_players)
      if (ev.type === 'race_finished' && ev.data.win && !ev.data.mp) H.wins++;
      let paid: any[] = [];
      if (S && S.status !== 'ended') {
        const P = await loadProgress(tx, userId, S.view.season), r = applyEvent(S.view.bundle, S.view.season, P, ev);
        paid = await settle(tx, userId, S.id, r.awards, r.events, H);
        await saveProgress(tx, userId, S.id, P);
      }
      await saveHistory(tx, userId, H);
      return paid;
    });
  }

  // A ping: positions driven since the last (roadbook/geo.js). The history (distance, by car; places found) whatever the
  // season; the season's challenges, places and Expeditions when there is one. What it answers: what was paid, what
  // happened (a place found, an Expedition's stage), and the Expeditions' next targets.
  async function ping(user: User, body: { samples: [number, number, number][]; carInstanceId?: string | null }) {
    const S = await seasonFor(user);
    const carId: string | null = body.carInstanceId ? (await rows(sql`select car_id from owned_cars where user_id = ${user.id} and instance_id = ${body.carInstanceId}`))[0]?.car_id ?? null : null;
    return withLock(user.id, async tx => {
      const H = await loadHistory(tx, user.id), now = clock();
      const live = S && S.status !== 'ended';
      // (no season to play: a throwaway progress — its awards dropped — for the history's sake)
      const season = live ? S.view.season : (S?.view.season ?? { id: '-', challenges: [], chapters: [], expeditions: [] });
      const bundle = live ? S.view.bundle : { places: (await config.data()).places ?? [], expeditions: {} };
      const P = live ? await loadProgress(tx, user.id, season) : newProgress(season);
      P.track = H.track ?? P.track;
      const r = applyPing(bundle, season, P, H, { samples: body.samples, carId }, now);
      H.track = P.track;
      if (r.metres > 0) { H.distanceM += r.metres; if (carId) H.byCar[carId] = (H.byCar[carId] ?? 0) + r.metres; }
      // (a clue's place shown once near it; the hint once its time has come)
      if (live) for (const [id, st] of Object.entries<any>(P.expeditions)) {
        const exp = bundle.expeditions[id], stage = currentStage(exp, st);
        if (stage?.type === 'clue' && !st.revealed && r.points.some((p: any) => p.trusted && metresBetween(p, stage.location) <= (stage.revealWithin ?? 150))) st.revealed = stage.id;
      }
      const paid = live ? await settle(tx, user.id, season.id, r.awards, r.events, H) : (await settle(tx, user.id, '-', [], r.events, H), []);
      if (live) await saveProgress(tx, user.id, season.id, P);
      await saveHistory(tx, user.id, H);
      return { ok: true as const, metres: Math.round(r.metres), awards: paid.map(publicAward), events: r.events.filter((e: any) => e.type !== 'distance_driven'), expeditions: live ? expeditionsView(S.view, P) : [] };
    });
  }
  const publicAward = (a: any) => ({ key: a.key, kind: a.kind, points: a.points, tokens: a.tokens, reason: a.reason });

  async function beginExpedition(user: User, id: string) {
    const S = await seasonFor(user);
    if (!S || S.status === 'ended') throw new AppError(409, 'CONFLICT', 'There\'s no season on to start an Expedition in.');
    return withLock(user.id, async tx => {
      const P = await loadProgress(tx, user.id, S.view.season), r = startExpedition(S.view.bundle, S.view.season, P, id, clock());
      if (!r.ok) throw new AppError(404, 'NOT_FOUND', r.error ?? 'There\'s no such Expedition.');
      await saveProgress(tx, user.id, S.id, P);
      return { ok: true as const, expeditions: expeditionsView(S.view, P) };
    });
  }

  // ---------- the shop ----------
  async function buy(user: User, itemId: string) {
    const S = await seasonFor(user);
    if (!S) throw new AppError(409, 'CONFLICT', 'There\'s no season on.');
    if (S.status === 'ended') throw new AppError(409, 'CONFLICT', 'The season has ended: its shop is closed.');
    const item = (S.view.shop?.items ?? []).find((x: any) => x.id === itemId);
    if (!item) throw new AppError(404, 'NOT_FOUND', 'That isn\'t in this season\'s shop.');
    return withLock(user.id, async tx => {
      if ((await rows(sql`select 1 from player_items where user_id = ${user.id} and item_id = ${itemId}`, tx)).length) throw new AppError(409, 'CONFLICT', `You have the ${item.name} already.`);
      const have = await balance(tx, user.id, S.id);
      if (have < item.price) throw new AppError(409, 'CONFLICT', `The ${item.name} is ${item.price} Season Tokens: you have ${have}.`);
      await ledger(tx, user.id, S.id, { amount: -item.price, kind: 'purchase', reason: `Bought: ${item.name}`, key: `buy:${itemId}`, ref: { item: itemId } });
      await tx.execute(sql`insert into player_items (user_id, item_id, season_id, price) values (${user.id}, ${itemId}, ${S.id}, ${item.price})`);
      return { ok: true as const, item: itemId, tokens: await balance(tx, user.id, S.id) };
    });
  }
  // what a player owns, and what that unlocks (finishes, photo filters, badges) — for every season they've played
  async function owned(userId: string) {
    const items = (await rows(sql`select item_id, season_id, price, bought_at from player_items where user_id = ${userId} order by bought_at`)).map(r => ({ id: r.item_id, season: r.season_id, price: r.price, at: new Date(r.bought_at).toISOString() }));
    const u = unlocksOf(await config.data(), items.map(i => i.id));
    return { items, unlocks: Object.fromEntries(Object.entries(u).map(([k, v]) => [k, [...v]])) as Record<string, string[]> };
  }
  // the badges a player's items give (the profile card): each with the name of the item it came with
  async function badges(userId: string) {
    const all = await config.data(), mine = (await owned(userId)).items, out: { id: string; name: string; season: string }[] = [];
    for (const s of Object.values<any>(all.seasons ?? {})) for (const it of s.shop?.items ?? []) if (mine.some(m => m.id === it.id)) for (const b of it.grants?.badges ?? []) out.push({ id: b, name: it.name, season: s.season.id });
    return out;
  }
  // the finishes only owners can use (data/finishes.json locked: true) — the economy asks before a paint or a refinish
  async function mayUseFinish(userId: string, finish: string | null | undefined, lockedFinishes: Set<string>) {
    if (!finish || !lockedFinishes.has(finish)) return true;
    return (await owned(userId)).unlocks.finishes?.includes(finish) ?? false;
  }

  // ---------- what the game shows ----------
  function expeditionsView(v: any, P: any) {
    return (v.season.expeditions ?? []).map((id: string) => {
      const exp = v.bundle.expeditions[id], st = P.expeditions[id] ?? null, stage = st ? currentStage(exp, st) : null;
      const hintDue = stage?.type === 'clue' && st && clock() - st.stageStartedAt >= (stage.hintAfterMin ?? 10) * 60_000;
      return {
        id, name: exp.name, blurb: exp.blurb, region: exp.region, started: !!st, done: !!st?.done, doneAt: st?.doneAt ? new Date(st.doneAt).toISOString() : null, times: st?.times ?? {},
        stages: exp.stages.map((s: any, i: number) => ({ id: s.id, name: s.name, type: s.type, finale: !!s.finale, points: s.points ?? 0, tokens: s.tokens ?? 0, done: !!st && (st.done || i < st.stage), current: !!stage && stage.id === s.id })),
        // (the stage under way: its text, a clue's words — its place only once found near it — the hint when due, the
        // items left, a run's next checkpoint, its time limit)
        stage: stage ? {
          id: stage.id, type: stage.type, name: stage.name, text: stage.text, clue: stage.clue ?? null, hint: hintDue ? stage.hint ?? null : null,
          hintIn: stage.type === 'clue' && !hintDue && st ? Math.max(0, Math.round(((stage.hintAfterMin ?? 10) * 60_000 - (clock() - st.stageStartedAt)) / 1000)) : null,
          timeLimitSec: stage.timeLimitSec ?? null, run: st.run ? { startedAt: new Date(st.run.startedAt).toISOString(), next: st.run.next, of: stage.checkpoints.length } : null,
          collected: st.collected ?? [], items: stage.type === 'collect' ? stage.items.length : null,
          targets: stage.type === 'clue' && st.revealed !== stage.id ? [] : stageTargets(stage, st),
        } : null,
      };
    });
  }
  async function view(user: User) {
    const S = await seasonFor(user);
    const mine = await owned(user.id);
    if (!S) return { season: null, owned: mine, history: await history(user.id) };
    const P = (await rows(sql`select data from roadbook_progress where user_id = ${user.id} and season_id = ${S.id}`))[0]?.data ?? newProgress(S.view.season);
    const season = S.view.season, tokens = await balance(db, user.id, S.id), now = clock();
    const tokenHistory = (await rows(sql`select amount, balance_after, kind, reason, at from token_ledger where user_id = ${user.id} and season_id = ${S.id} order by id desc limit 60`)).map(r => ({ amount: r.amount, balance: r.balance_after, kind: r.kind, reason: r.reason, at: new Date(r.at).toISOString() }));
    const discovered = Object.keys(P.discovered ?? {});
    return {
      season: {
        id: season.id, name: season.name, tagline: season.tagline, colour: season.colour, status: S.status,
        startedAt: S.startedAt ? new Date(S.startedAt).toISOString() : null, endsAt: S.endsAt ? new Date(S.endsAt).toISOString() : null,
        lengthDays: season.lengthDays, warning: S.status === 'live' && !!S.endsAt && S.endsAt - now <= (season.warningDays ?? 7) * DAY,
        conversion: { cashPerToken: season.conversion?.cashPerToken ?? 0 },
      },
      points: P.points, tokens,
      chapters: season.chapters.map((c: any) => ({ id: c.id, name: c.name, blurb: c.blurb, unlockAt: c.unlockAt, open: chapterOpen(season, P, c.id), milestoneTokens: c.milestoneTokens ?? 0, milestone: !!P.milestones?.[c.id] })),
      challenges: season.challenges.map((ch: any) => ({ id: ch.id, chapter: ch.chapter, style: ch.style ?? null, name: ch.name, description: ch.description, points: ch.points, tokens: ch.tokens, done: !!P.challenges?.[ch.id]?.done, ...challengeProgress(ch, P.challenges?.[ch.id]) })),
      expeditions: expeditionsView(S.view, P),
      shop: (S.view.shop?.items ?? []).map((it: any) => ({ id: it.id, name: it.name, description: it.description, price: it.price, icon: it.icon ?? null, owned: mine.items.some(x => x.id === it.id) })),
      // (places this season: the ones on show, and hidden ones only once found)
      places: S.view.bundle.places.filter((p: any) => !p.hidden || discovered.includes(p.id)).map((p: any) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, radius: p.radius ?? 60, hidden: !!p.hidden, found: discovered.includes(p.id) })),
      hiddenLeft: S.view.bundle.places.filter((p: any) => p.hidden && !discovered.includes(p.id)).length,
      tokenHistory, owned: mine, history: await history(user.id),
    };
  }

  // Personal History: what never resets — from the ROADBOOK's own (distance, places, Expeditions) and from what the game
  // already keeps (races and results, records, the cars bought, won and sold, the parts fitted)
  async function history(userId: string) {
    const H = (await rows(sql`select data from player_history where user_id = ${userId}`))[0]?.data ?? {};
    const one = async (q: ReturnType<typeof sql>) => (await rows(q))[0] ?? {};
    const quests = await rows(sql`select quest_id, medal, data from quest_progress where user_id = ${userId}`);
    const mp = await one(sql`select count(*)::int as races, count(*) filter (where place = 1 and status = 'finished')::int as wins from mp_race_players where user_id = ${userId}`);
    const tracks = await one(sql`select count(*)::int as runs from track_results where user_id = ${userId}`);
    const records = await rows(sql`select code, car_class, best_time, best_lap, best_score, at from track_records where user_id = ${userId} order by at desc limit 10`);
    const items = await one(sql`select count(*) filter (where item_type = 'car' and event in ('buyCar: new', 'buyUsedCar: new'))::int as bought,
      count(*) filter (where item_type = 'car' and event = 'awardCar: new')::int as won, count(*) filter (where item_type = 'car' and event = 'sellCar: gone')::int as sold,
      count(*) filter (where item_type = 'part' and event in ('installPart: fitted', 'buyAndInstall: fitted'))::int as fitted from item_history where user_id = ${userId}`);
    const questRaces = quests.reduce((a, q) => a + (q.data?.attempts ?? 0), 0);
    const medals = { gold: 0, silver: 0, bronze: 0 } as Record<string, number>;
    for (const q of quests) if (q.medal in medals) medals[q.medal]++;
    const byCar = Object.entries<number>(H.byCar ?? {}).sort((a, b) => b[1] - a[1]);
    const placesAll = (await config.data()).places ?? [];
    return {
      distanceKm: Math.round((H.distanceM ?? 0) / 100) / 10,
      racesEntered: questRaces + (mp.races ?? 0) + (tracks.runs ?? 0),
      wins: (H.wins ?? 0) + (mp.wins ?? 0),
      medals,
      personalRecords: [
        ...quests.filter(q => q.data?.bestTime != null || q.data?.bestScore != null).map(q => ({ kind: 'quest', id: q.quest_id, time: q.data.bestTime ?? null, score: q.data.bestScore ?? null, medal: q.medal ?? null })),
        ...records.map(r => ({ kind: 'track', id: r.code, carClass: r.car_class, time: r.best_time, lap: r.best_lap, score: r.best_score, at: new Date(r.at).toISOString() })),
      ].slice(0, 20),
      cars: { bought: items.bought ?? 0, won: items.won ?? 0, sold: items.sold ?? 0, partsFitted: items.fitted ?? 0 },
      mostUsedCar: byCar[0] ? { carId: byCar[0][0], km: Math.round(byCar[0][1] / 100) / 10 } : null,
      places: Object.entries<string>(H.places ?? {}).map(([id, at]) => ({ id, name: placesAll.find((p: any) => p.id === id)?.name ?? id, at })),
      placesTotal: placesAll.length,
      expeditions: H.expeditions ?? [],
      // (quest wins are counted from the ROADBOOK's start: the game kept no count of them before)
      winsNote: 'Quest wins count from the start of the ROADBOOK; online wins from your first race.',
    };
  }

  // ---------- development and admins ----------
  // (fake events and tokens: on a development server for anyone signed in, on the live one for admins only — the
  // routes decide; each with its reason in the token history)
  async function devEvent(user: User, ev: { type: string; data: any }, key: string) { return hear(user.id, `dev:${key}`, ev); }
  async function grantTokens(user: User, target: string, amount: number, reason: string, key: string) {
    const [u] = await rows(sql`select role from users where id = ${target}`);
    if (!u) throw new AppError(404, 'NOT_FOUND', 'There\'s no such player.');
    const S = await seasonFor({ id: target, role: u.role }) ?? await seasonFor({ id: target, role: 'admin' });
    if (!S) throw new AppError(409, 'CONFLICT', 'There\'s no season to give tokens in.');
    return withLock(target, async tx => {
      const done = await ledger(tx, target, S.id, { amount, kind: amount > 0 ? 'grant' : 'removal', reason, key: `admin:${key}`, actorId: user.id });
      return { ok: true as const, done, tokens: await balance(tx, target, S.id) };
    });
  }
  // (development) arriving at a place as if driven there — the debug teleport's other half: the track settled just beside
  // it (a teleport alone counts for nothing: roadbook/geo.js), then one sample on it
  async function devArrive(user: User, lat: number, lon: number) {
    await withLock(user.id, async tx => {
      const H = await loadHistory(tx, user.id);
      H.track = { lat: lat + 0.0001, lon, at: clock() - 1000, clientT: 1, driven: LIMITS.settleM };
      await saveHistory(tx, user.id, H);
    });
    return ping(user, { samples: [[lat, lon, 1001]] });
  }
  // the next Expedition target, for the debug teleport (the game drives there itself)
  async function nextTarget(user: User) {
    const v = await view(user);
    const x = (v as any).expeditions?.find((e: any) => e.started && !e.done) ?? (v as any).expeditions?.find((e: any) => !e.done);
    if (!x) return null;
    if (!x.started) return { expedition: x.id, start: true };
    const S = await seasonFor(user), P = (await rows(sql`select data from roadbook_progress where user_id = ${user.id} and season_id = ${S!.id}`))[0]?.data;
    const exp = S!.view.bundle.expeditions[x.id], st = P.expeditions[x.id], stage = currentStage(exp, st);
    const t = stageTargets(stage, st)[0];
    return t ? { expedition: x.id, stage: stage!.id, ...t } : null;
  }
  // an admin's look at the season: its clock, how many play, tokens in and out
  async function status() {
    const all = await config.data(), c = await clockOf(all.current);
    const [n] = await rows(sql`select count(*)::int as players, coalesce(sum(points), 0)::int as points from roadbook_progress where season_id = ${all.current}`);
    const [t] = await rows(sql`select coalesce(sum(amount) filter (where amount > 0), 0)::int as earned, coalesce(-sum(amount) filter (where kind = 'purchase'), 0)::int as spent from token_ledger where season_id = ${all.current}`);
    const items = await rows(sql`select item_id, count(*)::int as n from player_items where season_id = ${all.current} group by item_id`);
    return { current: all.current, status: c?.status ?? null, startedAt: c?.startedAt ? new Date(c.startedAt).toISOString() : null, endsAt: c?.endsAt ? new Date(c.endsAt).toISOString() : null, endedAt: c?.endedAt ? new Date(c.endedAt).toISOString() : null,
      start: c?.view.season.start ?? null, players: n.players, points: n.points, tokens: t, items: Object.fromEntries(items.map(r => [r.item_id, r.n])) };
  }

  // ---------- what the game's own systems report ----------
  economy.events.on('action', (e: any) => {
    const map: Record<string, () => [string, { type: string; data: any }] | null> = {
      finishQuest: () => e.facts?.valid ? [`quest:${e.facts.sessionId}`, { type: 'race_finished', data: { questType: e.facts.questType, medal: e.facts.medal ?? null, place: e.facts.place ?? null, win: e.facts.place != null ? e.facts.place === 1 : null, mp: false } }] : null,
      buyCar: () => [`car:${e.rev}`, { type: 'car_purchased', data: { carId: e.args.carId, used: false } }],
      buyUsedCar: () => [`car:${e.rev}`, { type: 'car_purchased', data: { carId: e.facts?.carId ?? null, used: true } }],
      sellCar: () => [`sold:${e.rev}`, { type: 'car_sold', data: { carId: e.facts?.carId ?? null } }],
      installPart: () => [`fit:${e.rev}`, { type: 'part_installed', data: { partId: e.facts?.partId ?? null } }],
      buyAndInstall: () => [`fit:${e.rev}`, { type: 'part_installed', data: { partId: e.args.partId } }],
    };
    const m = map[e.action]?.();
    if (m) void hear(e.userId, m[0], m[1]).catch(err => log({ err, user: e.userId, action: e.action }, 'the ROADBOOK missed an action'));
  });
  economy.events.on('mpRaceResult', (e: any) => { void hear(e.userId, `mp:${e.raceId}`, { type: 'race_finished', data: { questType: 'multiplayer', medal: null, place: e.place, win: e.place === 1 && e.status === 'finished', mp: true } }).catch(err => log({ err, user: e.userId }, 'the ROADBOOK missed a race')); });
  economy.events.on('photoSaved', (e: any) => { void hear(e.userId, `photo:${e.photoId}`, { type: 'photo_saved', data: {} }).catch(err => log({ err, user: e.userId }, 'the ROADBOOK missed a photo')); });

  return { view, ping, beginExpedition, buy, owned, badges, mayUseFinish, history, hear, start, end, sweep, betaOpened, convert, devEvent, devArrive, grantTokens, nextTarget, status, clock, seasonFor };
}
export type Roadbook = ReturnType<typeof createRoadbook>;
