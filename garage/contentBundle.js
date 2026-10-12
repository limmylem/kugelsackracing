// The game's content as versioned bundles (Phase 8 Step 3; docs/CONTENT_PIPELINE.md, docs/DEPLOYMENT.md). The site
// build (tools/build-site.mjs → tools/content/bundle.mjs) writes:
//   data/bundle.json            the manifest (never cached: always asked for) — { version, data: the data bundle's
//                               address, models: { 'assets/…glb': its content's hash, … } }
//   bundles/data-<hash>.json    every car and part file and what they're checked against, in one file named by
//                               its content: cached for good, a new name when anything in it changes
// The game reads its data from the bundle (one download, not 700), and asks for each model (a car's, a part's, a
// thumbnail) only when it's drawn, at an address with its hash (?v=…), kept in the browser's cache (the Cache API)
// under that address — so a model is downloaded once, until it changes. What the manifest no longer names is let go.
// Served without a bundle (npm start, the tests): every file as it is, as before.
//
//   await openBundle()          → the manifest, or null (no bundle: files one by one)
//   bundled(path)               → that data file's contents from the bundle, or undefined
//   modelUrl(path)              → its address with its version (and on the tiles address: site/urls.js)
//   cachedFetch(url)            → a Response, from the cache if it's there (versioned addresses only)

import { assetUrl } from '../site/urls.js';

export const CACHE_NAME = 'ognistrada-content';
let manifest = null, files = null;

export async function openBundle({ fetchImpl = globalThis.fetch, base = '' } = {}) {
  try {
    const r = await fetchImpl(`${base}data/bundle.json`, { cache: 'no-cache' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    const m = await r.json();
    const data = await (await cachedFetch(`${base}${m.data}`, { fetchImpl, always: true })).json();
    manifest = m; files = data.files;
    prune().catch(() => {});
    return manifest;
  } catch (err) {
    console.warn(`No content bundle (${err.message}): the files one by one`);
    manifest = files = null;
    return null;
  }
}

export function bundled(path) {
  if (!files) return undefined;
  const v = files[path.replace(/^\.?\//, '')];
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function modelUrl(path) {
  const key = path.replace(/^\.?\//, '').replace(/^.*?(?=assets\/)/, ''), v = manifest?.models?.[key];
  const url = assetUrl(path);
  return v ? `${url}${url.includes('?') ? '&' : '?'}v=${v}` : url;
}

// (only an address with its version in it, or the data bundle — named by its content — is kept: anything else could
// change under the same address)
export async function cachedFetch(url, { fetchImpl = globalThis.fetch, always = false } = {}) {
  const keep = always || /[?&]v=[0-9a-f]+/.test(url);
  if (!keep || !globalThis.caches) return fetchImpl(url);
  let cache;
  try { cache = await caches.open(CACHE_NAME); } catch { return fetchImpl(url); }       // (no cache here: a private window, an insecure page)
  const hit = await cache.match(url);
  if (hit) return hit;
  const r = await fetchImpl(url);
  if (r.ok) await cache.put(url, r.clone()).catch(() => {});
  return r;
}

// What the manifest no longer names (an older version of a model, an older data bundle): let go
async function prune() {
  if (!globalThis.caches || !manifest) return;
  const cache = await caches.open(CACHE_NAME), want = new Set(Object.values(manifest.models ?? {}));
  for (const req of await cache.keys()) {
    const u = new URL(req.url), v = u.searchParams.get('v');
    const stale = v ? !want.has(v) : /\/bundles\/data-/.test(u.pathname) && !u.pathname.endsWith(manifest.data.replace(/^.*\//, ''));
    if (stale) await cache.delete(req);
  }
}

export const bundleInfo = () => manifest ? { version: manifest.version, models: Object.keys(manifest.models ?? {}).length, files: Object.keys(files ?? {}).length } : null;
