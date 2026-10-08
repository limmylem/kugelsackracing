// @ts-nocheck — (the map's own TypeScript, loaded at run time: it isn't part of the server's typecheck)
// Official multiplayer routes (Phase 7 Step 2; docs/MULTIPLAYER.md "Venues"): one real-road route in each baked region
// (tests/map/realRoutes.ts — the routes every route test drives), compiled on the region's road network and published
// as world content, so quick races and lobbies on "random" have real-world routes to race. Ids route_mp<region>:
// running it again brings them up to date.
//
//   DATABASE_URL=… node server/tools/seed-mp-routes.ts [--regions mk,sf]
//   seedMpRoutes(content, { regions }) → [{ id, region, name, km, loop }]    (the tests seed their own database)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// (their names: data/multiplayer.json venues.routes — the lobby offers the same list)
const MP = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/multiplayer.json'), 'utf8'));
const NAMES: Record<string, string> = Object.fromEntries(MP.venues.routes.map((r: any) => [r.region, r.name]));

// (extra: routes of the tests' own — [{ id, region, name, kind, waypoints: [[lat, lon], …] }])
export async function seedMpRoutes(content: any, { regions, extra = [] }: { regions?: string[]; extra?: any[] } = {}) {
  // (the map's own TypeScript, loaded at run time: not part of the server's typecheck)
  const realRoutes = '../../tests/map/realRoutes.ts', harness = '../../tests/map/harness.ts';
  const { REAL_ROUTES } = await import(realRoutes);
  const { mapHarness } = await import(harness);
  regions ??= Object.keys(REAL_ROUTES);
  const { createNetwork } = await import('../../route/network.js');
  const { bakeRoute, newRoute } = await import('../../route/model.js');
  const { newItem } = await import('../../content/quests.js');
  const author = { id: null, name: 'Kugelsack Racing' };
  const out = [];
  const todo = [...regions.filter(r => REAL_ROUTES[r]).map(region => ({ id: `route_mp${region}`, region, name: NAMES[region] ?? `${region} route`, ...REAL_ROUTES[region] })), ...extra];
  const nets = new Map();
  for (const R of todo) {
    const region = R.region;
    if (!nets.has(region)) { const M = await mapHarness(region); nets.set(region, createNetwork(M.graph(), { P: M.P, region, version: M.manifest.version })); }
    const N = nets.get(region);
    const course = bakeRoute(N, { ...newRoute(region, R.kind), waypoints: R.waypoints.map(([lat, lon]: number[]) => ({ lat, lon })), grid: { count: 8 } });
    const id = R.id, [lat, lon] = R.waypoints[0];
    const item = { ...newItem('route', { id, location: { lat, lon }, name: R.name, region, routeKind: R.kind, author: author.name }), course, description: `Multiplayer: ${R.what ?? 'a test route'}.` };
    const state = (await content.getState(id)).state;
    if (state.draft || state.published) await content.update(id, item, author); else await content.create(item, author);
    await content.publish(id, author);
    out.push({ id, region, name: item.name, km: Math.round(course.length / 100) / 10, loop: R.kind === 'loop' });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { openDb } = await import('../src/db/index.ts');
  const { createContentService } = await import('../src/content/service.ts');
  const { loadRules } = await import('../src/content/rules.ts');
  const i = process.argv.indexOf('--regions'), regions = i > 0 ? process.argv[i + 1].split(',') : undefined;
  const { db, pool } = openDb(process.env.DATABASE_URL ?? 'postgres://kr:kr@localhost:5432/kr_dev', { max: 2 });
  const content = createContentService({ db, rules: loadRules() });
  const made = await seedMpRoutes(content, { regions });
  for (const r of made) console.log(`  ${r.id}  ${r.name} (${r.region}, ${r.km} km${r.loop ? ', a loop' : ''})`);
  await pool.end();
}
