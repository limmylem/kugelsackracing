// The deployed game has every folder its code reaches (server/src/clientFiles.ts CLIENT_DIRS: what tools/build-site.mjs
// puts on Cloudflare Pages and the server serves). The local server serves the whole repo, so a folder missing from the
// list works on this computer and breaks online — as locales/ nearly did (Phase 8 Step 4). This walks the game's code:
// every relative import, and every literal path like `/locales/…` or `${base}locales/…`, must land in a listed folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(path.join(root, 'server/src/clientFiles.ts'), 'utf8');
const list = name => JSON.parse(src.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));
const DIRS = new Set(list('CLIENT_DIRS')), FILES = new Set(list('CLIENT_FILES'));
// (folders the game's code names but never loads in the browser: the build's own, the server's, the tests')
const TOP = new Set(fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name));
const NOT_CLIENT = new Set(['node_modules', 'server', 'tests', 'tools', 'docs', 'reports', 'devlog', 'packages', 'blender', 'shared']);

function* walk(dir) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'vendor' && e.name !== 'build' && !e.name.startsWith('.')) yield* walk(rel); }
    else if (/\.(m?js|html)$/.test(e.name)) yield rel;
  }
}

test('every folder the game\'s code imports or fetches is deployed', () => {
  const missing = new Map();
  const note = (dir, from) => { if (!DIRS.has(dir) && !FILES.has(dir) && TOP.has(dir) && !NOT_CLIENT.has(dir)) missing.set(dir, from); };
  const files = [...FILES].filter(f => f.endsWith('.html')).concat(...[...DIRS].filter(d => d !== 'assets' && fs.existsSync(path.join(root, d))).map(d => [...walk(d)]));
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const top = path.relative(root, path.resolve(root, path.dirname(f), m[1])).split(path.sep)[0];
      note(top, f);
    }
    // ('/locales/x', "locales/", `${base}locales/…`: a top-level folder named at the start of a path)
    for (const m of text.matchAll(/['"`](?:\$\{[^}]+\})?\/?([a-z][a-z0-9_-]*)\/[^'"`\s]*/g)) note(m[1], f);
  }
  assert.deepEqual([...missing].map(([d, f]) => `${d}/ (named in ${f})`), [], 'add these to CLIENT_DIRS in server/src/clientFiles.ts, or to NOT_CLIENT here if the browser never loads them');
});
