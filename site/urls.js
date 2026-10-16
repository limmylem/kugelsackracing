// The game's parts at their own addresses (docs/DEPLOYMENT.md; site/config.js says where): the map files and
// other downloads on the tiles address, the API on its own, the editor's code from the API (for editor accounts
// only). Everything stays as it was when the page is served from one address.
//
//   assetUrl(url)          a /assets/… address on this page's own host → the same file on the tiles address
//   apiBase                '' or the API's address
//   importTool(path)       a module of the editor's, from the API's address with the session (site/tool.js in a
//                          <script> with crossorigin="use-credentials": the server serves it to editor accounts only;
//                          refused because two-factor is due again, the terms or a sign-in: to the account page for it)

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
    // (refused: the import inside site/tool.js fails — why asked for, and the account page for it: refused())
    globalThis[key] = { resolve, reject: () => void refused(url).then(reject) };
    // (a file of the game's own that does the import — an inline script is refused by the content security policy)
    s.src = new URL(`/site/tool.js?u=${encodeURIComponent(url)}&k=${key}`, here()).href;
    s.onload = () => s.remove();
    s.onerror = () => { s.remove(); void refused(url).then(reject); };
    document.head.appendChild(s);
  });
}
// (a tool's file refused: asked again to read why — the server answers a tool's files with the reason, not a redirect.
// Signed out, the terms to accept, or two-factor due again (editor and admin accounts every few hours): to the account
// page for that step, then back here)
async function refused(url) {
  let status = 0, code = null, message = null;
  try { const r = await fetch(url, { credentials: 'include', cache: 'no-store' }); status = r.status; const b = r.ok ? null : await r.json().catch(() => null); code = b?.error?.code ?? null; message = b?.error?.message ?? null; } catch { /* offline, or the server's down */ }
  const mode = code === 'MFA_REQUIRED' ? 'mfa' : code === 'TERMS_REQUIRED' ? 'terms' : status === 401 ? 'sign-in' : null;
  const err = Object.assign(new Error(message ?? `Couldn't load ${url}`), { code, status });
  if (mode && globalThis.location) {
    const back = `${location.pathname}${location.search}${location.hash}`;
    err.signIn = `${SITE.game || location.origin}/account/?${new URLSearchParams({ ...(mode !== 'sign-in' ? { mode } : {}), next: back })}`;
    location.assign(err.signIn);
  }
  return err;
}
