// The game as a static site for Cloudflare Pages (docs/DEPLOYMENT.md): the game's own files (server/src/clientFiles.ts)
// as committed, for one environment —
//   - without the map files, cars, parts and sounds (assets/: on the tiles address — R2) and without the admin
//     page and the editor's code (the API's address serves those, to their roles only; editor/access.js stays:
//     it only decides whether the editor's button shows), and without the development pages in production
//   - site/config.js saying where the API, the tiles and the real-time server are
//   - the main page's import map pointing the editor's imports of the game's modules back here (the editor's
//     code comes from the API's address, the modules it shares with the game from this one: loaded once)
//   - _headers (security headers, the content security policy, caching) and _redirects (assets/ → the tiles
//     address, admin/ → the API's; nothing for editor/: Pages redirects even a file it has, and editor/access.js
//     is here — the editor's own code is loaded from the API's address by site/urls.js)
//
//   node tools/build-site.mjs --env staging|production --game URL --api URL --tiles URL --rt WSS_URL [--hsts] [--out dir] [--local]
//   (the shared package's browser bundle must be built first: npm run build:shared)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLIENT_DIRS, CLIENT_FILES, inlineScriptHashes } from '../server/src/clientFiles.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const env = opt('--env', null), local = args.includes('--local');
if (!['staging', 'production'].includes(env)) { console.error('--env staging|production'); process.exit(2); }
const url = (name) => {
  const v = opt(`--${name}`, null);
  if (!v) { console.error(`--${name} URL`); process.exit(2); }
  const u = new URL(v);
  // (--local: http and ws, for the local test of the whole setup — server/tools/deploy-browser.ts)
  const ok = name === 'rt' ? u.protocol === 'wss:' || (local && u.protocol === 'ws:') : u.protocol === 'https:' || (local && u.protocol === 'http:');
  if (!ok) { console.error(`--${name} must be ${name === 'rt' ? 'wss' : 'https'}://`); process.exit(2); }
  return v.replace(/\/$/, '');
};
const SITE = { env, api: url('api'), game: url('game'), tiles: url('tiles'), rt: url('rt') };
const out = path.resolve(opt('--out', path.join(root, '.cache/site', env)));
const LEAVE_OUT = new Set(['assets', 'admin', 'editor', ...(env === 'production' ? ['dev'] : [])]);
const KEEP = new Set(['editor/access.js']);

// ---------- the files ----------
fs.rmSync(out, { recursive: true, force: true });
const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const wanted = tracked.filter(f => {
  const top = f.split('/')[0];
  if (KEEP.has(f)) return true;
  if (f.includes('/')) return CLIENT_DIRS.includes(top) && !LEAVE_OUT.has(top);
  return CLIENT_FILES.includes(f);
});
const shared = 'packages/shared/dist/shared.browser.js';
if (!fs.existsSync(path.join(root, shared))) { console.error(`${shared} is missing: npm run build:shared`); process.exit(1); }
wanted.push(shared);
let bytes = 0, biggest = { f: '', n: 0 };
for (const f of wanted) {
  const from = path.join(root, f), to = path.join(out, f);
  if (!fs.existsSync(from)) continue;                    // (deleted, not yet committed)
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const n = fs.statSync(from).size;
  bytes += n; if (n > biggest.n) biggest = { f, n };
}
// (Cloudflare Pages: at most 25 MiB a file, 20,000 files)
if (biggest.n > 25 * 1024 * 1024) { console.error(`${biggest.f} is over Pages' 25 MiB a file`); process.exit(1); }
if (wanted.length > 19000) { console.error(`${wanted.length} files: over Pages' 20,000`); process.exit(1); }

// ---------- where everything is ----------
fs.mkdirSync(path.join(out, 'site'), { recursive: true });
fs.writeFileSync(path.join(out, 'site/config.js'), `// (written by tools/build-site.mjs for ${env}: docs/DEPLOYMENT.md)\nglobalThis.KR_SITE = Object.freeze(${JSON.stringify(SITE)});\n`);

// ---------- the editor's imports of the game's modules: back to this address ----------
const index = path.join(out, 'index.html');
let html = fs.readFileSync(index, 'utf8');
const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
if (!m) { console.error('index.html has no import map'); process.exit(1); }
const map = JSON.parse(m[1]);
for (const dir of CLIENT_DIRS.filter(d => !['assets', 'admin', 'editor'].includes(d))) map.imports[`${SITE.api}/${dir}/`] = `/${dir}/`;
map.imports[`${SITE.api}/packages/`] = '/packages/';
html = html.replace(m[0], `<script type="importmap">\n${JSON.stringify(map, null, 1)}\n</script>`);
fs.writeFileSync(index, html);

// ---------- headers and redirects ----------
const origin = u => new URL(u.replace(/^wss:/, 'https:')).origin;
// (Phase 6 Step 5: the inline scripts of the pages as built — import maps, start-up scripts — by their hashes, not
// 'unsafe-inline': a script injected into a page doesn't run. The server's inlineScriptHashes does the same.)
const scriptHashes = inlineScriptHashes(out).join(' ');
const csp = [
  "default-src 'self'",
  // (the game's modules, inline module scripts and import maps; three.js, Rapier and Cesium from jsDelivr; Rapier's
  // WebAssembly; the editor's code from the API's address)
  `script-src 'self' ${scriptHashes} 'wasm-unsafe-eval' https://cdn.jsdelivr.net blob: ${origin(SITE.api)}`,
  "worker-src 'self' blob: https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  // (the API, the tiles, the real-time server; the photoreal world's and the minimap's own hosts)
  `connect-src 'self' https: data: blob: ${new URL(SITE.rt).origin}`,
  `media-src 'self' data: blob: ${origin(SITE.tiles)}`,
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(local ? [] : ['upgrade-insecure-requests']),
].join('; ');
const hsts = args.includes('--hsts') ? '\n  Strict-Transport-Security: max-age=31536000; includeSubDomains' : '';
fs.writeFileSync(path.join(out, '_headers'), `# (written by tools/build-site.mjs for ${env}: docs/DEPLOYMENT.md)
/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()${hsts}
/site/config.js
  Cache-Control: no-cache
/data/*
  Cache-Control: no-cache
/scenes/*
  Cache-Control: no-cache
`);
fs.writeFileSync(path.join(out, '_redirects'), `# (written by tools/build-site.mjs for ${env}: docs/DEPLOYMENT.md)
/assets/* ${SITE.tiles}/assets/:splat 302
/admin ${SITE.api}/admin/ 302
/admin/* ${SITE.api}/admin/:splat 302
`);
console.log(`${env}: ${wanted.length} files, ${(bytes / 1048576).toFixed(1)} MB (the largest ${biggest.f}, ${(biggest.n / 1048576).toFixed(1)} MB) → ${path.relative(root, out)}`);
