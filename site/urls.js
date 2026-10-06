// The game's parts at their own addresses (docs/DEPLOYMENT.md; site/config.js says where): the map files and
// other downloads on the tiles address, the API on its own, the editor's code from the API (for editor accounts
// only). Everything stays as it was when the page is served from one address.
//
//   assetUrl(url)          a /assets/… address on this page's own host → the same file on the tiles address
//   apiBase                '' or the API's address
//   importTool(path)       a module of the editor's, from the API's address with the session (a <script> with
//                          crossorigin="use-credentials": the server serves it to editor accounts only)

export const SITE = globalThis.KR_SITE ?? { env: 'local', api: '', game: '', tiles: '', rt: '' };
export const apiBase = SITE.api ?? '';

const here = () => globalThis.document?.baseURI ?? globalThis.location?.href ?? 'http://localhost/';
export function assetUrl(url) {
  if (!SITE.tiles || !url) return url;
  const base = here(), abs = new URL(url, base);
  return abs.origin === new URL(base).origin && abs.pathname.startsWith('/assets/') ? `${SITE.tiles}${abs.pathname}${abs.search}` : url;
}

let n = 0;
export function importTool(path) {
  if (!SITE.api) return import(new URL(path, here()).href);
  const url = `${SITE.api}/${path.replace(/^\.?\//, '')}`, key = `__krTool${++n}`;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.type = 'module'; s.crossOrigin = 'use-credentials';
    globalThis[key] = { resolve, reject };
    s.textContent = `import(${JSON.stringify(url)}).then(m => globalThis.${key}.resolve(m), e => globalThis.${key}.reject(e)).finally(() => { delete globalThis.${key}; });`;
    s.onerror = () => reject(new Error(`Couldn't load ${url}`));
    document.head.appendChild(s);
    s.remove();
  });
}
