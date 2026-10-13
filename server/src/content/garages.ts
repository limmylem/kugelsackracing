// The starting garages (data/world/garages.json, made by tools/place-garages.mjs): drive-through garage buildings in
// each baked region, published when the server starts if they've never been there — once there they're the editors'
// like any other content (moved, renamed, archived or deleted: that stands; nothing here puts them back).

import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { REPO_DIR } from '../config.ts';
import { newItem } from '../../../content/quests.js';
import type { Db } from '../db/index.ts';

const AUTHOR = { id: null as unknown as string, name: 'Ogni Strada' };

export function startingGarages(): any[] {
  try { return JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/world/garages.json'), 'utf8')).garages ?? []; }
  catch { return []; }
}

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
  return made;
}
