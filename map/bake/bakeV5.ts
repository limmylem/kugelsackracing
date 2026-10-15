// Map v5's bake (MAP_README.md; MAP_V5_DIAGNOSIS.md): Map v4's pipeline (map/bake/bakeV4.ts) with data/map/v5.json over
// data/map/v4.json and everything Map v5 adds, into assets/map/<region>/v5/.
//
//   node map/bake/bakeV5.ts --region adelaide                          the whole region
//   node map/bake/bakeV5.ts --region adelaide --area -34.9275,138.6,2  a 2 km square round a place (a slice)
//   node map/bake/bakeV5.ts --region adelaide --out <dir>              somewhere else (the determinism test)

import { bakeV4 } from './bakeV4.ts';

export const bakeV5 = (o: Parameters<typeof bakeV4>[0]) => bakeV4({ ...o, map: 'v5' });

if (process.argv[1]?.endsWith('map/bake/bakeV5.ts')) {
  const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const bt = opt('--block-tiles'), bp = opt('--block-pad');
  bakeV5({ regionId: opt('--region') ?? 'adelaide', area: opt('--area'), out: opt('--out'), blocks: bt || bp ? { tiles: bt ? +bt : undefined, pad: bp ? +bp : undefined } : null }).catch(e => { console.error(e); process.exit(1); });
}
