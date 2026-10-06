// World content on the server (docs/WORLD_CONTENT.md, the PostGIS design): the same requests as the browser's
// content/service.js, on the content_items table (one row per item and view: draft, published, archived),
// every change in content_history. Every write is checked by the same rules the editor runs (rules.ts);
// what players see changes only through publish / unpublish / archive, which move the published counter
// (the cached responses' version).
//
// Near a point: ST_DWithin on the points as geography (metres on the earth; its own GiST index), nearest
// first by the index's distance order. In a cell or a map tile: the box against the geometry's GiST index.

import crypto from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { contentItems, contentHistory } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { markerOf, type Rules } from './rules.ts';

export const VIEWS = ['draft', 'published', 'archived'] as const;
type View = typeof VIEWS[number];
type Item = Record<string, any>;
type State = { draft: Item | null; published: Item | null; archived: Item | null };
export type Author = { id: string; name: string };

const clone = <T>(x: T): T => x == null ? x : JSON.parse(JSON.stringify(x));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const newId = (kind: string) => `${kind}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
// (a list as one parameter: text[] split on the unit separator — Drizzle would otherwise spread an array into a list)
const textArray = (list: readonly string[]) => sql`string_to_array(${list.join('\u001f')}, chr(31))`;
type Tx = Pick<Db, 'execute' | 'insert' | 'delete'>;

export function createContentService({ db, rules, now = () => new Date().toISOString() }: { db: Db; rules: Rules; now?: () => string }) {
  const { check, rate, blocking, migrate, CONTENT_VERSION } = rules;

  const rowOf = (item: Item, view: View, authorId: string | null) => {
    const lat = Number(item.location?.lat), lon = Number(item.location?.lon);
    return {
      id: String(item.id), view, kind: String(item.kind), version: Number(item.version ?? CONTENT_VERSION), geom: { lon, lat }, heading: Number(item.location?.heading ?? 0),
      cell: rules.cellOf(lat, lon), enabled: item.enabled !== false, data: item, marker: markerOf(item), authorId,
      createdAt: new Date(item.created ?? now()), updatedAt: new Date(item.updated ?? now()), publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
    };
  };
  async function readItem(id: string, view: View, tx: Tx = db): Promise<Item | null> {
    const r = await tx.execute(sql`select data from content_items where id = ${id} and view = ${view}`);
    return (r.rows[0] as any)?.data ?? null;
  }
  async function stateOf(id: string, tx: Tx = db): Promise<State> {
    const out: State = { draft: null, published: null, archived: null };
    for (const r of (await tx.execute(sql`select view, data from content_items where id = ${id}`)).rows as any[]) out[r.view as View] = r.data;
    return out;
  }
  async function putState(tx: Tx, id: string, state: State, authorId: string | null) {
    await tx.execute(sql`delete from content_items where id = ${id}`);
    const rows = VIEWS.filter(v => state[v]).map(v => rowOf(state[v]!, v, authorId));
    if (rows.length) await tx.insert(contentItems).values(rows);
  }
  async function authorOf(id: string, tx: Tx = db): Promise<string | null> {
    return ((await tx.execute(sql`select author_id from content_items where id = ${id} limit 1`)).rows[0] as any)?.author_id ?? null;
  }
  const history = (tx: Tx, id: string, action: string, before: unknown, after: unknown, authorId: string | null) =>
    tx.insert(contentHistory).values({ id, action, before: before as any, after: after as any, authorId });
  const bump = (tx: Tx) => tx.execute(sql`insert into content_meta (key, value) values ('published', 1) on conflict (key) do update set value = content_meta.value + 1`);
  const rated = async (item: Item, tx: Tx = db) => {
    if (item.kind !== 'quest') return item;
    const route = item.route ? (await readItem(item.route, 'draft', tx)) ?? (await readItem(item.route, 'published', tx)) : null;
    return rate(item, { route });
  };
  const shapeOk = (item: Item) => {
    const shape = check.shape(item);
    if (shape.length) throw new AppError(400, 'VALIDATION', shape[0].message, shape);
  };
  const tx = <T>(fn: (t: Tx) => Promise<T>) => db.transaction(fn as any) as Promise<T>;

  const select = (marker: boolean) => marker ? sql`marker` : sql`data`;
  const offeredOnly = (offered: boolean) => offered ? sql`and (kind <> 'quest' or enabled)` : sql``;
  const kindsOnly = (kinds: string[] | null) => kinds?.length ? sql`and kind = any(${textArray(kinds)})` : sql``;
  const inBox = async ([s, w, n, e]: number[], view: View, offered: boolean, marker: boolean) => {
    const rows = (await db.execute(sql`select ${select(marker)} as item from content_items where view = ${view} and geom && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326) ${offeredOnly(offered)}`)).rows as any[];
    return rows.map(r => r.item);
  };

  return {
    readItem, stateOf,
    async epoch(): Promise<number> {
      return Number(((await db.execute(sql`select value from content_meta where key = 'published'`)).rows[0] as any)?.value ?? 0);
    },
    async query({ lat, lon, km, view, kinds, offered, limit, fields }: { lat: number; lon: number; km: number; view: View; kinds: string[] | null; offered: boolean; limit: number; fields: 'marker' | 'full' }) {
      const rows = (await db.execute(sql`
        with p as (select ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography as g)
        select ${select(fields === 'marker')} as item, ST_Distance(c.geom::geography, p.g) / 1000.0 as km
        from content_items c, p
        where c.view = ${view} and ST_DWithin(c.geom::geography, p.g, ${km * 1000}) ${kindsOnly(kinds)} ${offeredOnly(offered)}
        order by c.geom::geography <-> p.g limit ${limit}`)).rows as any[];
      return { ok: true as const, items: rows.map(r => ({ item: r.item, km: Number(r.km) })) };
    },
    async inCell(hash: string, { view, offered, fields }: { view: View; offered: boolean; fields: 'marker' | 'full' }) {
      return { ok: true as const, items: await inBox(rules.decode(hash).box, view, offered, fields === 'marker') };
    },
    async inTile(z: number, x: number, y: number, { view, offered, fields }: { view: View; offered: boolean; fields: 'marker' | 'full' }) {
      return { ok: true as const, items: await inBox(rules.tileBox(z, x, y), view, offered, fields === 'marker') };
    },
    async get(id: string, view: View) { return { ok: true as const, item: await readItem(id, view) }; },
    async getState(id: string) { return { ok: true as const, state: await stateOf(id) }; },

    async create(input: Item, author: Author) {
      return tx(async t => {
        const id = input.id && ID.test(input.id) && !(await stateOf(input.id, t)).draft && !(await authorOf(input.id, t)) ? input.id : newId(input.kind);
        const at = now(), item = await rated({ ...clone(input), id, version: CONTENT_VERSION, status: 'draft', author: author.name, created: at, updated: at, publishedAt: null }, t);
        shapeOk(item);
        await putState(t, id, { draft: item, published: null, archived: null }, author.id);
        await history(t, id, 'create', null, item, author.id);
        return { ok: true as const, item };
      });
    },
    async update(id: string, input: Item, author: Author) {
      return tx(async t => {
        const state = await stateOf(id, t), old = state.draft;
        if (!old) throw state.archived ? new AppError(409, 'CONFLICT', 'It\'s archived: restore it to edit it.') : new AppError(404, 'NOT_FOUND', 'There\'s no such item.');
        const item = await rated({ ...old, ...clone(input), id, kind: old.kind, version: CONTENT_VERSION, created: old.created, author: old.author, status: old.status, publishedAt: old.publishedAt, updated: now() }, t);
        shapeOk(item);
        await putState(t, id, { ...state, draft: item }, (await authorOf(id, t)) ?? author.id);
        await history(t, id, 'update', old, item, author.id);
        return { ok: true as const, item };
      });
    },
    async publish(id: string, author: Author) {
      return tx(async t => {
        const state = await stateOf(id, t), draft = state.draft;
        if (!draft) throw new AppError(404, 'NOT_FOUND', 'There\'s no such draft.');
        const routeId = draft.kind === 'quest' ? draft.route : null;
        const route = routeId ? (await readItem(routeId, 'draft', t)) ?? (await readItem(routeId, 'published', t)) ?? null : undefined;
        const errors = blocking(check(draft, routeId ? { route } : {}));
        if (errors.length) throw new AppError(422, 'UNPUBLISHABLE', `Can't publish "${draft.name || 'it'}" yet: ${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''}`, errors);
        const at = now(), item = { ...(draft.kind === 'quest' ? rate(draft, { route }) : draft), status: 'published', publishedAt: at };
        const owner = (await authorOf(id, t)) ?? author.id;
        await putState(t, id, { ...state, draft: item, published: clone(item) }, owner);
        await history(t, id, 'publish', state.published, item, author.id);
        let routeItem: Item | null = null;
        if (route) {
          const rs = await stateOf(routeId, t), bare = (x: Item | null) => x && { ...x, status: null, publishedAt: null, updated: null };
          if (rs.draft && (!rs.published || !same(bare(rs.draft), bare(rs.published)))) {
            routeItem = { ...rs.draft, status: 'published', publishedAt: at };
            await putState(t, routeId, { ...rs, draft: routeItem, published: clone(routeItem) }, (await authorOf(routeId, t)) ?? author.id);
            await history(t, routeId, 'publish', rs.published, routeItem, author.id);
          }
        }
        await bump(t);
        return { ok: true as const, item, route: routeItem };
      });
    },
    async unpublish(id: string, author: Author) {
      return tx(async t => {
        const state = await stateOf(id, t);
        if (!state.published) throw new AppError(409, 'CONFLICT', 'It isn\'t published.');
        const draft = { ...(state.draft ?? state.published), status: 'draft', publishedAt: null };
        await putState(t, id, { ...state, draft, published: null }, (await authorOf(id, t)) ?? author.id);
        await history(t, id, 'unpublish', state.published, null, author.id);
        await bump(t);
        return { ok: true as const, item: draft };
      });
    },
    async remove(id: string, confirm: boolean, author: Author) {
      return tx(async t => {
        const state = await stateOf(id, t);
        if (!state.draft && !state.published) throw state.archived ? new AppError(409, 'CONFLICT', 'It\'s already archived.') : new AppError(404, 'NOT_FOUND', 'There\'s no such item.');
        if (state.published) {
          if (!confirm) throw new AppError(409, 'NEEDS_CONFIRM', `"${state.published.name}" is published: players can see it. Archive it? (It's kept and can be restored, not destroyed.)`, { needsConfirm: true });
          const archived = { ...(state.draft ?? state.published), status: 'archived', updated: now() };
          await putState(t, id, { draft: null, published: null, archived }, (await authorOf(id, t)) ?? author.id);
          await history(t, id, 'archive', state, archived, author.id);
          await bump(t);
          return { ok: true as const, archived: true };
        }
        await putState(t, id, { draft: null, published: null, archived: state.archived }, (await authorOf(id, t)) ?? author.id);
        await history(t, id, 'delete', state, null, author.id);
        return { ok: true as const, archived: false };
      });
    },
    async restore(id: string, author: Author) {
      return tx(async t => {
        const state = await stateOf(id, t);
        if (!state.archived) throw new AppError(409, 'CONFLICT', 'It isn\'t archived.');
        const draft = { ...state.archived, status: 'draft', publishedAt: null, updated: now() };
        await putState(t, id, { draft, published: null, archived: null }, (await authorOf(id, t)) ?? author.id);
        await history(t, id, 'restore', state.archived, draft, author.id);
        return { ok: true as const, item: draft };
      });
    },
    // (the editor's undo and redo: an item's whole state put back — each view checked)
    async setState(id: string, state: State, author: Author) {
      return tx(async t => {
        for (const v of VIEWS) if (state[v]) { if (state[v]!.id !== id) throw new AppError(400, 'BAD_REQUEST', 'That state is another item\'s.'); shapeOk(state[v]!); }
        const before = await stateOf(id, t);
        await putState(t, id, { draft: state.draft ?? null, published: state.published ?? null, archived: state.archived ?? null }, (await authorOf(id, t)) ?? author.id);
        await history(t, id, 'state', before, state, author.id);
        if (!same(before.published, state.published ?? null)) await bump(t);
        return { ok: true as const };
      });
    },

    async exportContent({ area, cell, views }: { area: { lat: number; lon: number; km: number } | null; cell: string | null; views: View[] }) {
      let where: SQL = sql`true`;
      if (cell) { const [s, w, n, e] = rules.decode(cell).box; where = sql`geom && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)`; }
      else if (area) where = sql`ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${area.lon}, ${area.lat}), 4326)::geography, ${area.km * 1000})`;
      const ids = (await db.execute(sql`select distinct id from content_items where view = any(${textArray(views)}) and ${where} order by id`)).rows.map((r: any) => r.id as string);
      const entries: Item[] = [];
      for (let k = 0; k < ids.length; k += 1000) {
        const rows = (await db.execute(sql`select id, view, data from content_items where id = any(${textArray(ids.slice(k, k + 1000))}) and view = any(${textArray(views)}) order by id`)).rows as any[];
        const byId = new Map<string, Item>();
        for (const r of rows) (byId.get(r.id) ?? byId.set(r.id, {}).get(r.id)!)[r.view] = r.data;
        for (const id of ids.slice(k, k + 1000)) if (byId.has(id)) entries.push(byId.get(id)!);
      }
      return { ok: true as const, format: 'world-content', version: CONTENT_VERSION, exported: now(), area: area ?? cell ?? 'everything', views, count: entries.length, entries };
    },

    // a world content file (the editor's export) brought in: every item migrated to the current version and
    // checked; a bad one skipped with the reason; in batches, each in its own transaction
    async importContent(doc: any, { onConflict }: { onConflict: 'replace' | 'skip' }, author: Author) {
      const t0 = performance.now();
      if (doc?.format !== 'world-content') throw new AppError(400, 'BAD_REQUEST', `That isn't a world content file (its format is "${doc?.format ?? 'missing'}").`);
      if (!(doc.version >= 1)) throw new AppError(400, 'BAD_REQUEST', 'The file doesn\'t say which version of the format it is.');
      if (doc.version > CONTENT_VERSION) throw new AppError(400, 'BAD_REQUEST', `The file was made by a newer version of the game (content version ${doc.version}; this one reads up to ${CONTENT_VERSION}).`);
      if (!Array.isArray(doc.entries)) throw new AppError(400, 'BAD_REQUEST', 'The file has no entries.');
      let imported = 0, migrated = 0;
      const skipped: { id: string; why: string }[] = [], byKind: Record<string, number> = {};
      const states: { id: string; state: State }[] = [];
      // (every route in the file first: a quest's rating needs its route)
      const routes = new Map<string, Item>();
      for (const e of doc.entries) for (const v of ['draft', 'published'] as const) { const it = e?.[v]; if (it?.kind === 'route' && it.id) routes.set(it.id, migrate(it).item ?? it); }
      for (const entry of doc.entries) {
        const any = entry?.draft ?? entry?.published ?? entry?.archived, id = typeof any?.id === 'string' ? any.id : '?';
        if (!ID.test(id)) { skipped.push({ id: String(id).slice(0, 80), why: 'its id isn\'t one the game makes' }); continue; }
        const state: State = { draft: null, published: null, archived: null };
        let bad: string | null = null;
        for (const v of VIEWS) {
          if (!entry[v]) continue;
          const m = migrate(entry[v]);
          if (m.error) { bad = m.error; break; }
          if (m.migrated && v !== 'archived') migrated++;
          if (m.item.id !== id) { bad = 'its views are different items'; break; }
          const shape = check.shape(m.item);
          if (shape.length) { bad = shape[0].message; break; }
          state[v] = m.item;
        }
        if (!bad && state.published && !state.draft) state.draft = clone(state.published);
        if (!bad && state.published) {
          const errs = blocking(check(state.published, state.published.kind === 'quest' && state.published.route ? { route: routes.get(state.published.route) ?? null } : {}));
          if (errs.length) bad = `its published copy has errors: ${errs[0].message}`;
        }
        if (bad) { skipped.push({ id, why: bad }); continue; }
        for (const v of ['draft', 'published'] as const) if (state[v]?.kind === 'quest' && !state[v]!.rating) state[v] = rate(state[v], { route: routes.get(state[v]!.route) ?? null });
        states.push({ id, state });
      }
      for (let k = 0; k < states.length; k += 500) {
        const batch = states.slice(k, k + 500);
        await tx(async t => {
          const ids = batch.map(b => b.id);
          const existing = new Set(((await t.execute(sql`select distinct id from content_items where id = any(${textArray(ids)})`)).rows as any[]).map(r => r.id));
          const take = batch.filter(b => { if (existing.has(b.id) && onConflict === 'skip') { skipped.push({ id: b.id, why: 'already on the server (kept as it is)' }); return false; } return true; });
          if (!take.length) return;
          await t.execute(sql`delete from content_items where id = any(${textArray(take.map(b => b.id))})`);
          const rows = take.flatMap(b => VIEWS.filter(v => b.state[v]).map(v => rowOf(b.state[v]!, v, author.id)));
          for (let r = 0; r < rows.length; r += 1000) await t.insert(contentItems).values(rows.slice(r, r + 1000));
          await t.insert(contentHistory).values(take.map(b => ({ id: b.id, action: 'import', before: null, after: b.state as any, authorId: author.id })));
          for (const b of take) { imported++; const kind = (b.state.draft ?? b.state.published ?? b.state.archived)!.kind; byKind[kind] = (byKind[kind] ?? 0) + 1; }
          if (take.some(b => b.state.published)) await bump(t);
        });
      }
      return { ok: true as const, imported, migrated, skipped, byKind, ms: Math.round(performance.now() - t0) };
    },

    async stats() {
      const r = (await db.execute(sql`select view, count(*)::int as n from content_items group by view`)).rows as any[];
      const n = (v: string) => r.find(x => x.view === v)?.n ?? 0;
      return { ok: true as const, draft: n('draft'), published: n('published'), archived: n('archived') };
    },
  };
}
export type ContentService = ReturnType<typeof createContentService>;
