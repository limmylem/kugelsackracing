// The starting garages (data/world/garages.json, made by tools/place-garages.mjs): drive-through garage buildings in
// each baked region, published when the server starts if they've never been there — once there they're the editors'
// like any other content (moved, renamed, archived or deleted: that stands; nothing here puts them back). Earlier
// starting garages since replaced (garages.json retired) are archived, unless an editor has changed them.

import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { REPO_DIR } from '../config.ts';
import { newItem } from '../../../content/quests.js';
import type { Db } from '../db/index.ts';

const AUTHOR = { id: null as unknown as string, name: 'Ogni Strada' };

function file(): { garages?: any[]; retired?: string[] } {
  try { return JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/world/garages.json'), 'utf8')); }
  catch { return {}; }
}
export function startingGarages(): any[] { return file().garages ?? []; }
// (earlier starting garages, since replaced: archived if all they've had is the start's create and publish)
export function retiredGarages(): string[] { return file().retired ?? []; }

// → the ids published now (none: every one's been there before)
export async function ensureStartingGarages(db: Db, content: any, log: (o: object, m: string) => void = () => {}) {
  const made: string[] = [];
  for (const g of startingGarages()) {
    // (ever there — its history: an editor's had it since, whatever they did with it)
    const seen = (await db.execute(sql`select 1 from content_history where id = ${g.id} limit 1`)).rows.length || (await db.execute(sql`select 1 from content_items where id = ${g.id} limit 1`)).rows.length;
    if (seen) continue;
    try {
      const item = { ...(newItem as any)('garage', { id: g.id, location: g.location, name: g.name, author: AUTHOR.name }), road: g.road ?? null, description: 'A drive-through garage: drive in under the canopy for your cars, parts and repairs.' };
      const r = await content.create(item, AUTHOR);
      if (r.item.id !== g.id) { log({ id: g.id, got: r.item.id }, 'starting garage made with another id'); continue; }
      await content.publish(g.id, AUTHOR);
      made.push(g.id);
    } catch (e: any) { log({ id: g.id, err: e?.message ?? String(e) }, 'starting garage not made'); }
  }
  if (made.length) log({ garages: made.length }, 'starting garages published');
  const retired: string[] = [];
  for (const id of retiredGarages()) {
    const h = (await db.execute(sql`select action, author_id from content_history where id = ${id}`)).rows as any[];
    if (!h.length || h.some(r => r.author_id != null || !['create', 'publish'].includes(r.action))) continue;
    try { await content.remove(id, true, AUTHOR); retired.push(id); }
    catch (e: any) { log({ id, err: e?.message ?? String(e) }, 'earlier starting garage not archived'); }
  }
  if (retired.length) log({ garages: retired.length }, 'earlier starting garages archived');
  return made;
}
