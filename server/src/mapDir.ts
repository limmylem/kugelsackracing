// The folder of the bake the game plays in a region — data/map/baked.json's manifest for it: Map v5's (v5/), Map v4's
// (v4/) or Map v3's (the region's own folder) — so the road graphs and frames the server checks the game's against are
// the same ones. A region the list doesn't name (or whose bake isn't there): its Map v4 bake if it has one, else its own.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_DIR } from './config.ts';

let listed: Record<string, string> | null = null;
export function gameMapDir(region: string): string {
  const id = region.replace(/[^a-z0-9_-]/gi, ''), base = path.join(REPO_DIR, 'assets/map', id);
  listed ??= (() => { try { return Object.fromEntries(JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/map/baked.json'), 'utf8')).regions.map((r: any) => [r.id, path.join(REPO_DIR, path.dirname(r.manifest))])); } catch { return {}; } })();
  const dir = listed[id];
  if (dir && fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  return fs.existsSync(path.join(base, 'v4', 'manifest.json')) ? path.join(base, 'v4') : base;
}
