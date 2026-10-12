// The content manager (Phase 8 Step 3; docs/CONTENT_PIPELINE.md; the admin page's Content tab): every part and car,
// where it is in the workflow (draft → review → published: only published reaches players), its checks, its versions
// and their history; stat, price and bulk edits (each a new version, a draft until it's published again — the version
// players have stays until then), CSV out and in. The game's files are where content comes from (npm run content);
// this keeps what's been decided about it since, in the database (catalogue_items, catalogue_history), and gives the game
// the published picture (overlay: garage/content.js applyContent / withContent).
//
// Publishing needs the part's checks passed: the content checks run when it was made (data/content/checks.json, in
// the image) and, after an edit here, the live checks of the edited version (garage/liveChecks.js — the class limits
// with it in each car's most powerful build, its tier — run in a worker thread so the API stays quick).

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { REPO_DIR } from '../config.ts';
import { AppError, badRequest, notFound } from '../errors.ts';
import { gameData } from '../economy/config.ts';
import { editFields, editNeeds, editProblems, STATUSES, statusOf, withContent } from '../../../garage/content.js';
import { editableStats } from '../../../garage/families.js';
import { forCar } from '../../../garage/balance.js';

const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, p), 'utf8'));
const readMaybe = (p: string, fallback: any) => fs.existsSync(path.join(REPO_DIR, p)) ? readJson(p) : fallback;
export type Kind = 'part' | 'car';
export type ItemRef = { kind: Kind; id: string };
const KIND_WORDS: Record<string, string> = { fit: 'fit', drive: 'drive', crash: 'crash', sound: 'sound', budget: 'budget', economy: 'economy', classes: 'class limits', live: 'live checks' };
const clone = (x: any) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));

export function createContentManager(db: Db, { log = (..._: any[]) => {} } = {}) {
  const formulas = readJson('data/content/formulas.json'), tiers = readJson('data/content/tiers.json'), balance = readJson('data/content/balance.json');
  const checks = readMaybe('data/content/checks.json', { parts: {}, classes: {} });
  let cached: { at: number; overlay: any } | null = null;

  // ---------- the published picture, for the game ----------
  async function rows() { return (await db.execute(sql`select * from catalogue_items`)).rows as any[]; }
  async function overlay() {
    if (cached && Date.now() - cached.at < 5000) return cached.overlay;
    const all = await rows(), v = Number(((await db.execute(sql`select coalesce(max(seq), 0) as v from catalogue_history`)).rows[0] as any).v);
    const o: any = { version: v, parts: {}, cars: {} };
    for (const r of all) {
      const entry = r.live ? { status: 'published', ...(Object.keys(r.live_set ?? {}).length && { set: r.live_set }) } : { status: r.status === 'published' ? 'draft' : r.status };
      if (r.kind === 'part') o.parts[r.id] = entry; else o.cars[r.id] = { status: entry.status };
    }
    cached = { at: Date.now(), overlay: o };
    return o;
  }
  const forget = () => { cached = null; };

  // ---------- what each item is now ----------
  async function state() {
    const { db: game } = await gameData(), all = await rows(), byKey = new Map(all.map(r => [`${r.kind}:${r.id}`, r]));
    return { game, row: (kind: Kind, id: string) => byKey.get(`${kind}:${id}`) ?? null };
  }
  // an item as its latest version is: the file with the version's fields, its status, what checks say
  function view(game: any, kind: Kind, id: string, row: any) {
    const file = kind === 'part' ? game.parts[id] : game.cars[id];
    if (!file) return null;
    const latest = { ...file, ...(row?.set ?? {}) };
    if (latest.unlock === null) delete latest.unlock;
    const status = row ? row.status : statusOf(file);
    const live = row ? row.live : statusOf(file) === 'published';
    const c = kind === 'part' ? checks.parts?.[id] : checks.classes?.[id];
    const failing: string[] = [], problems: string[] = [];
    if (kind === 'part') {
      if (!c) { failing.push('missing'); problems.push('no content checks for it: npm run content -- check'); }
      else for (const k of ['fit', 'drive', 'crash', 'sound', 'budget', 'economy', 'classes']) if (c[k]?.ok === false) { failing.push(k); problems.push(...(c[k].problems ?? []).slice(0, 4).map((p: string) => `${KIND_WORDS[k]}: ${p}`)); }
    } else if (c && !c.ok) { failing.push('classes'); problems.push(...(c.problems ?? []).map((p: string) => `class limits: ${p}`)); }
    const edited = !!row && Object.keys(row.set ?? {}).length > 0;
    if (edited) {
      if (!row.checks || row.checks.version !== row.version) { failing.push('pending'); problems.push('live checks of the edited version still running'); }
      else if (!row.checks.ok) { failing.push('live'); problems.push(...row.checks.problems.slice(0, 4).map((p: string) => `live checks: ${p}`)); }
    }
    return { kind, id, name: latest.name, slot: latest.slot ?? null, category: latest.category ?? null, family: latest.generated?.family ?? latest.generated?.engine ?? latest.generated?.table ?? null,
      tier: latest.tier ?? latest.class ?? null, price: latest.price ?? null, unlockLevel: latest.unlock?.level ?? null, status, live, version: row?.version ?? 0, edited,
      checksOk: !failing.length, failing, problems, icon: latest.icon ?? null, model: kind === 'car' ? latest.model?.file ?? null : latest.model ?? null, retired: !!latest.retired, latest, file, row };
  }

  async function items(q: { kind?: Kind; q?: string; slot?: string; family?: string; tier?: string; status?: string; problems?: string; limit?: number; offset?: number } = {}) {
    const { game, row } = await state(), out: any[] = [];
    for (const kind of (q.kind ? [q.kind] : ['part', 'car']) as Kind[]) for (const id of Object.keys(kind === 'part' ? game.parts : game.cars)) {
      const v = view(game, kind, id, row(kind, id));
      if (!v || v.retired) continue;
      if (q.q && !`${v.id} ${v.name} ${v.family ?? ''}`.toLowerCase().includes(q.q.toLowerCase())) continue;
      if (q.slot && v.slot !== q.slot) continue;
      if (q.family && v.family !== q.family) continue;
      if (q.tier && v.tier !== q.tier) continue;
      if (q.status && (q.status === 'live' ? !v.live : v.status !== q.status)) continue;
      if (q.problems === 'any' && v.checksOk) continue;
      if (q.problems === 'none' && !v.checksOk) continue;
      if (q.problems && !['any', 'none'].includes(q.problems) && !v.failing.includes(q.problems)) continue;
      out.push(v);
    }
    out.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    const facets = { status: count(out, v => v.status), slot: count(out, v => v.slot), family: count(out, v => v.family), tier: count(out, v => v.tier), problems: count(out.flatMap(v => v.failing.length ? v.failing : ['none']), x => x) };
    const offset = q.offset ?? 0, limit = q.limit ?? 200;
    return { total: out.length, facets, items: out.slice(offset, offset + limit).map(({ latest, file, row: _r, ...v }) => v) };
  }

  async function item(kind: Kind, id: string) {
    const { game, row } = await state(), r = row(kind, id), v = view(game, kind, id, r);
    if (!v) throw notFound(`The ${kind} "${id}"`);
    const history = (await db.execute(sql`select h.seq, h.version, h.action, h.status, h.set, h.edits, h.reason, h.at, u.name as actor from catalogue_history h left join users u on u.id = h.actor_id where h.kind = ${kind} and h.id = ${id} order by h.seq desc limit 100`)).rows as any[];
    const kindDef = v.latest.generated?.kind ? formulas.families[v.latest.generated.kind] : null;
    const withLatest = kind === 'part' ? { ...game, parts: { ...game.parts, [id]: v.latest } } : game;
    const cars = kind === 'part' ? Object.keys(game.cars).filter(c => forCar(withLatest, c, v.latest)).map(c => ({ id: c, name: game.cars[c].name, model: game.cars[c].model?.file ?? null, socket: game.cars[c].sockets.find((s: any) => s.slot === v.latest.slot || game.cars[c].socketGroups?.[v.latest.slot]?.includes(s.name))?.name ?? null })) : [];
    return {
      ...(({ latest, file, row: _r, ...x }) => x)(v),
      part: v.latest, filePart: v.file, livePart: r?.live ? { ...v.file, ...(r.live_set ?? {}) } : (statusOf(v.file) === 'published' && !r ? v.file : null),
      checks: kind === 'part' ? checks.parts?.[id] ?? null : checks.classes?.[id] ?? null, liveChecks: r?.checks ?? null,
      stats: kindDef ? Object.entries(editableStats(kindDef)).map(([k, s]: any) => ({ key: k, ...s, value: v.latest.generated?.stats?.[k] ?? null })) : [],
      cars, history: history.map(h => ({ seq: Number(h.seq), version: h.version, action: h.action, status: h.status, set: h.set, edits: h.edits, reason: h.reason, actor: h.actor ?? null, at: new Date(h.at).toISOString() })),
    };
  }

  // ---------- changing them ----------
  async function record(tx: any, { kind, id }: ItemRef, row: any, action: string, actorId: string, reason: string) {
    await tx.execute(sql`insert into catalogue_items (id, kind, version, status, set, edits, checks, live, live_version, live_set, actor_id, updated_at)
      values (${id}, ${kind}, ${row.version}, ${row.status}, ${JSON.stringify(row.set ?? {})}::jsonb, ${JSON.stringify(row.edits ?? {})}::jsonb, ${row.checks ? JSON.stringify(row.checks) : null}::jsonb, ${row.live}, ${row.live_version ?? null}, ${JSON.stringify(row.live_set ?? {})}::jsonb, ${actorId}, now())
      on conflict (kind, id) do update set version = excluded.version, status = excluded.status, set = excluded.set, edits = excluded.edits, checks = excluded.checks, live = excluded.live, live_version = excluded.live_version, live_set = excluded.live_set, actor_id = excluded.actor_id, updated_at = now()`);
    await tx.execute(sql`insert into catalogue_history (id, kind, version, action, status, set, edits, actor_id, reason) values (${id}, ${kind}, ${row.version}, ${action}, ${row.live && action === 'publish' ? 'published' : row.status}, ${JSON.stringify(row.set ?? {})}::jsonb, ${JSON.stringify(row.edits ?? {})}::jsonb, ${actorId}, ${reason})`);
  }
  // (a row for an item that hasn't one: as its file is — live if its file is published)
  const fresh = (file: any) => ({ version: 0, status: statusOf(file), set: {}, edits: {}, checks: null, live: statusOf(file) === 'published', live_version: statusOf(file) === 'published' ? 0 : null, live_set: {} });

  // Edits to parts, all or none: { price, priceTimes, unlockLevel, tier, name, stats } — each a new version, a draft
  async function edit({ ids, changes, actorId, reason }: { ids: string[]; changes: any; actorId: string; reason: string }) {
    if (!ids.length) throw badRequest('Pick the parts to change.');
    if (ids.length > 1000) throw badRequest('At most 1,000 parts at once.');
    const { game, row } = await state(), problems: { id: string; problems: string[] }[] = [], plans: any[] = [];
    for (const id of [...new Set(ids)]) {
      const r = row('part', id), v = view(game, 'part', id, r);
      if (!v) { problems.push({ id, problems: ['there is no such part'] }); continue; }
      const ask = { ...changes };
      if (ask.priceTimes != null) { if (!(ask.priceTimes > 0 && ask.priceTimes <= 10)) { problems.push({ id, problems: ['a price change is a multiple from 0 to 10'] }); continue; } ask.price = Math.max(10, Math.round(v.latest.price * ask.priceTimes / 10) * 10); delete ask.priceTimes; }
      if (ask.stats && !Object.keys(ask.stats).length) delete ask.stats;
      const p = editProblems(v.latest, ask, { formulas, tiers });
      if (p.length) { problems.push({ id, problems: p }); continue; }
      const set = { ...(r?.set ?? {}), ...editFields(v.latest, ask, { formulas }) };
      plans.push({ id, r: r ?? fresh(v.file), set, ask, needs: editNeeds(ask) });
    }
    if (problems.length) throw new AppError(400, 'VALIDATION', `${problems.length} of them can't be changed like that: ${problems[0].id}: ${problems[0].problems[0]}`, problems.slice(0, 50));
    await db.transaction(async tx => {
      for (const p of plans) {
        const row = { ...p.r, version: p.r.version + 1, status: 'draft', set: p.set, edits: { ...(p.r.edits ?? {}), ...p.ask }, checks: null };
        p.row = row;
        await record(tx, { kind: 'part', id: p.id }, row, 'edit', actorId, reason);
      }
    });
    forget();
    for (const p of plans) checkLater('part', p.id, p.row.version);
    return { changed: plans.map(p => p.id), version: (await overlay()).version };
  }

  // A status for items: draft, review or published. Publishing needs passing checks — each that can't is left as it
  // was, with why
  async function setStatus({ items: refs, status, actorId, reason }: { items: ItemRef[]; status: string; actorId: string; reason: string }) {
    if (!STATUSES.includes(status)) throw badRequest(`The status is one of ${STATUSES.join(', ')}.`);
    const { game, row } = await state(), done: ItemRef[] = [], refused: { kind: Kind; id: string; why: string }[] = [], plans: any[] = [];
    for (const ref of refs) {
      const r = row(ref.kind, ref.id), v = view(game, ref.kind, ref.id, r);
      if (!v) { refused.push({ ...ref, why: `there's no ${ref.kind} "${ref.id}"` }); continue; }
      if (status === 'published' && !v.checksOk) { refused.push({ ...ref, why: v.problems[0] ?? 'its checks don\'t pass' }); continue; }
      if (status === 'published' && v.live && v.status === 'published' && !v.edited) { done.push(ref); continue; }
      const base = r ?? fresh(v.file), next = { ...base, version: base.version + 1, status };
      if (status === 'published') Object.assign(next, { live: true, live_version: next.version, live_set: clone(base.set ?? {}) });
      // (back to a draft or into review: no longer what players have — unless it's an edit of a published version,
      // whose published version stays until this one's published)
      else if (!v.edited) Object.assign(next, { live: false });
      plans.push({ ref, next });
    }
    await db.transaction(async tx => { for (const p of plans) { await record(tx, p.ref, p.next, status === 'published' ? 'publish' : status === 'review' ? 'review' : 'draft', actorId, reason); done.push(p.ref); } });
    forget();
    return { done, refused, version: (await overlay()).version };
  }

  async function history(kind: Kind, id: string) { return (await item(kind, id)).history; }

  // ---------- CSV ----------
  const COLS = ['kind', 'id', 'name', 'slot', 'family', 'tier', 'price', 'unlock_level', 'status', 'live', 'checks', 'stats', 'problems'];
  const cell = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  async function exportCsv(q: any = {}) {
    const { game, row } = await state(), list = (await items({ ...q, limit: 100000 })).items;
    const lines = [COLS.join(',')];
    for (const v of list) {
      const p = v.kind === 'part' ? { ...game.parts[v.id], ...(row('part', v.id)?.set ?? {}) } : null;
      const stats = p?.generated?.stats && p.generated.kind ? Object.keys(editableStats(formulas.families[p.generated.kind])).map(k => `${k}=${p.generated.stats[k]}`).join('; ') : '';
      lines.push([v.kind, v.id, v.name, v.slot, v.family, v.tier, v.price, v.unlockLevel, v.status, v.live ? 'yes' : 'no', v.checksOk ? 'pass' : v.failing.join(' '), stats, v.problems.join(' | ')].map(cell).join(','));
    }
    return lines.join('\n') + '\n';
  }
  function parseCsv(text: string) {
    const rowsOut: string[][] = [];
    let cur: string[] = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; continue; }
      if (ch === '"') q = true; else if (ch === ',') { cur.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; cur.push(f); f = ''; if (cur.some(x => x !== '')) rowsOut.push(cur); cur = []; } else f += ch;
    }
    cur.push(f); if (cur.some(x => x !== '')) rowsOut.push(cur);
    return rowsOut;
  }
  // A spreadsheet back in: each row whose name, tier, price, unlock level or stats differ is an edit; a different
  // status a status change (publishing still needs passing checks)
  async function importCsv({ csv, actorId, reason, dryRun = false }: { csv: string; actorId: string; reason: string; dryRun?: boolean }) {
    const table = parseCsv(csv);
    if (!table.length) throw badRequest('The file is empty.');
    const head = table[0].map(h => h.trim().toLowerCase()), at = (r: string[], c: string) => { const i = head.indexOf(c); return i >= 0 ? (r[i] ?? '').trim() : undefined; };
    if (!head.includes('id')) throw badRequest('The first row names the columns: it needs at least "id" (and kind, name, tier, price, unlock_level, status, stats).');
    const { game, row } = await state(), edits: { id: string; changes: any }[] = [], statuses: Record<string, ItemRef[]> = {}, problems: { line: number; id: string; problem: string }[] = [];
    table.slice(1).forEach((r, i) => {
      const line = i + 2, id = at(r, 'id') ?? '', kind = (at(r, 'kind') || 'part') as Kind, v = view(game, kind, id, row(kind, id));
      if (!v) { problems.push({ line, id, problem: `there's no ${kind} "${id}"` }); return; }
      const ch: any = {}, name = at(r, 'name'), tier = at(r, 'tier'), price = at(r, 'price'), lvl = at(r, 'unlock_level'), status = at(r, 'status'), stats = at(r, 'stats');
      if (kind === 'part') {
        if (name !== undefined && name !== '' && name !== v.name) ch.name = name;
        if (tier !== undefined && tier !== '' && tier !== v.tier) ch.tier = tier;
        if (price !== undefined && price !== '' && Number(price) !== v.price) { const n = Number(price); if (!Number.isFinite(n)) { problems.push({ line, id, problem: `price "${price}" isn't a number` }); return; } ch.price = Math.round(n); }
        if (lvl !== undefined && String(v.unlockLevel ?? '') !== lvl) ch.unlockLevel = lvl === '' ? null : Number(lvl);
        if (stats) {
          const want: any = {};
          for (const pair of stats.split(';').map(x => x.trim()).filter(Boolean)) { const [k, val] = pair.split('=').map(x => x.trim()); const n = Number(val); if (!Number.isFinite(n)) { problems.push({ line, id, problem: `stat ${k} = "${val}" isn't a number` }); return; } if (v.latest.generated?.stats?.[k] !== n) want[k] = n; }
          if (Object.keys(want).length) ch.stats = want;
        }
        if (Object.keys(ch).length) {
          const p = editProblems(v.latest, ch, { formulas, tiers });
          if (p.length) { problems.push({ line, id, problem: p.join('; ') }); return; }
          edits.push({ id, changes: ch });
        }
      }
      if (status && status !== v.status) { if (!STATUSES.includes(status)) { problems.push({ line, id, problem: `status "${status}" isn't one (${STATUSES.join(', ')})` }); return; } (statuses[status] ??= []).push({ kind, id }); }
    });
    if (dryRun || problems.length) return { edits: edits.length, statuses: Object.values(statuses).flat().length, problems, applied: false };
    for (const e of edits) await edit({ ids: [e.id], changes: e.changes, actorId, reason });
    const refused: any[] = [];
    for (const [status, refs] of Object.entries(statuses)) refused.push(...(await setStatus({ items: refs, status, actorId, reason })).refused);
    return { edits: edits.length, statuses: Object.values(statuses).flat().length, problems, refused, applied: true };
  }

  // ---------- the live checks, in a worker thread ----------
  let worker: Worker | null = null;
  const queue: { kind: Kind; id: string; version: number }[] = [];
  let busy = false;
  function checkLater(kind: Kind, id: string, version: number) { queue.push({ kind, id, version }); pump(); }
  function pump() {
    if (busy || !queue.length) return;
    busy = true;
    const job = queue.shift()!;
    run(job).catch(err => log({ err, job }, 'content live check failed')).finally(() => { busy = false; pump(); });
  }
  async function run(job: { kind: Kind; id: string; version: number }) {
    const r = ((await db.execute(sql`select * from catalogue_items where kind = ${job.kind} and id = ${job.id}`)).rows[0] as any);
    if (!r || r.version !== job.version) return;                    // (edited again since: that version's check is queued)
    const o = await overlay(), parts = { ...o.parts, [job.id]: { status: 'draft', set: r.set } };
    worker ??= new Worker(new URL('./liveCheckWorker.ts', import.meta.url), { workerData: { repo: REPO_DIR } });
    const result: any = await new Promise((resolve, reject) => {
      const onMsg = (m: any) => { if (m.id === job.id) { worker!.off('message', onMsg); resolve(m); } };
      worker!.on('message', onMsg);
      worker!.once('error', reject);
      worker!.postMessage({ id: job.id, overlay: { ...o, parts } });
    });
    const res = result.error ? { ok: false, problems: [`the checks went wrong: ${result.error}`] } : result.result;
    await db.execute(sql`update catalogue_items set checks = ${JSON.stringify({ version: job.version, ...res, at: new Date().toISOString() })}::jsonb where kind = ${job.kind} and id = ${job.id} and version = ${job.version}`);
    forget();
  }
  // (on start: anything edited whose live checks never finished — a restart mid-way — checked again)
  async function resume() {
    const pending = (await db.execute(sql`select kind, id, version from catalogue_items where set <> '{}'::jsonb and (checks is null or (checks->>'version')::int <> version)`)).rows as any[];
    for (const p of pending) checkLater(p.kind, p.id, p.version);
  }
  async function close() { await worker?.terminate(); worker = null; }

  return { overlay, items, item, edit, setStatus, history, exportCsv, importCsv, resume, close, idle: () => !busy && !queue.length };
}
export type ContentManager = ReturnType<typeof createContentManager>;

function count<T>(list: T[], key: (x: T) => any) { const out: Record<string, number> = {}; for (const x of list) { const k = key(x); if (k != null) out[k] = (out[k] ?? 0) + 1; } return out; }
// the game's data with what's published (the economy's gameDb and anything else that prices or validates for players)
export const publishedGame = (game: any, overlay: any) => withContent(game, overlay);
