// Cloudflare and Resend, set up as docs/DEPLOYMENT.md describes — by the "infra" workflow (.github/workflows/infra.yml),
// since only GitHub Actions can reach their APIs. Safe to run again and again: each thing is made if it's missing and
// put right if it's different; nothing else in the account is touched (our rules are the ones whose description
// starts "ognistrada:"; everyone else's stay).
//
//   node tools/cloudflare-setup.mjs [--dry-run] [--proxy-api] [--hsts] [--only https,pages,r2,dns,rules,email]
//     --proxy-api  api/rt/staging-api/staging-rt through Cloudflare (after Render has issued their certificates:
//                  until then DNS only, so Render can)
//     --hsts       HTTP Strict Transport Security on every address (once everything works over HTTPS)
//
// Environment:
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   (the token's permissions: docs/DEPLOYMENT.md)
//   RENDER_STAGING_HOST, RENDER_PRODUCTION_HOST   e.g. ognistrada-staging.onrender.com
//   EDGE_SECRET_STAGING, EDGE_SECRET_PRODUCTION   the same values as Render's EDGE_SECRET for each
//   RESEND_API_KEY                                (optional: the email domain and its DNS records)
//   DOMAIN                                        ognistrada.com unless set

const args = process.argv.slice(2), has = n => args.includes(n), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = has('--dry-run'), PROXY_API = has('--proxy-api'), HSTS = has('--hsts');
const ONLY = opt('--only', 'https,pages,r2,dns,rules,email').split(',');
const E = process.env, DOMAIN = E.DOMAIN ?? 'ognistrada.com';
const need = k => { if (!E[k]) { console.error(`${k} is not set`); process.exit(2); } return E[k]; };
const TOKEN = need('CLOUDFLARE_API_TOKEN'), ACCOUNT = need('CLOUDFLARE_ACCOUNT_ID');

// ---------- the plan: every address ----------
const ENVS = {
  production: { game: DOMAIN, api: `api.${DOMAIN}`, rt: `rt.${DOMAIN}`, tiles: `tiles.${DOMAIN}`, pages: 'ognistrada', bucket: 'ognistrada-tiles', render: E.RENDER_PRODUCTION_HOST, edge: E.EDGE_SECRET_PRODUCTION },
  staging: { game: `staging.${DOMAIN}`, api: `staging-api.${DOMAIN}`, rt: `staging-rt.${DOMAIN}`, tiles: `staging-tiles.${DOMAIN}`, pages: 'ognistrada-staging', bucket: 'ognistrada-tiles-staging', render: E.RENDER_STAGING_HOST, edge: E.EDGE_SECRET_STAGING },
};
const TAG = 'ognistrada:';

// ---------- the API ----------
let changes = 0;
async function cf(method, path, body) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) { const e = new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j.errors ?? j).slice(0, 400)}`); e.status = r.status; throw e; }
  return j.result;
}
const write = async (what, fn) => { changes++; if (DRY) { console.log(`  would ${what}`); return null; } console.log(`  ${what}`); return fn(); };
const step = name => console.log(`\n— ${name}`);

const zone = (await cf('GET', `/zones?name=${DOMAIN}`))?.[0];
if (!zone) { console.error(`${DOMAIN} isn't a zone in this Cloudflare account (add the site and move its nameservers first: docs/DEPLOYMENT.md)`); process.exit(1); }
console.log(`${DOMAIN}: zone ${zone.id}, ${zone.status}${zone.status !== 'active' ? ' (the nameservers aren\'t Cloudflare\'s yet: everything is set up, but nothing is served until they are)' : ''}`);
const Z = `/zones/${zone.id}`, A = `/accounts/${ACCOUNT}`;

// ---------- HTTPS for every address ----------
if (ONLY.includes('https')) {
  step('HTTPS');
  const want = { ssl: 'strict', always_use_https: 'on', min_tls_version: '1.2', tls_1_3: 'on', automatic_https_rewrites: 'on' };
  for (const [k, v] of Object.entries(want)) {
    const now = await cf('GET', `${Z}/settings/${k}`);
    if (now.value !== v) await write(`${k}: ${now.value} → ${v}`, () => cf('PATCH', `${Z}/settings/${k}`, { value: v }));
  }
  const sts = { enabled: HSTS, max_age: HSTS ? 31536000 : 0, include_subdomains: HSTS, preload: false, nosniff: true };
  const now = (await cf('GET', `${Z}/settings/security_header`)).value?.strict_transport_security ?? {};
  if (now.enabled !== sts.enabled || (HSTS && (now.max_age !== sts.max_age || !now.include_subdomains))) await write(`HSTS ${HSTS ? 'on (a year, every subdomain)' : 'off'}`, () => cf('PATCH', `${Z}/settings/security_header`, { value: { strict_transport_security: sts } }));
}

// ---------- DNS ----------
async function record(type, name, content, { proxied = false, ttl = 1, priority } = {}) {
  const found = await cf('GET', `${Z}/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
  const want = { type, name, content, proxied, ttl, ...(priority !== undefined ? { priority } : {}), comment: 'ognistrada (tools/cloudflare-setup.mjs)' };
  const same = found.find(r => r.content.replace(/^"|"$/g, '') === content.replace(/^"|"$/g, '') && (type === 'TXT' || r.proxied === proxied));
  if (same) return;
  // (one CNAME a name; TXT records are added alongside others, unless one of ours with the same start is there)
  const ours = type === 'CNAME' ? found[0] : found.find(r => r.content.replace(/^"/, '').split(/[;\s]/)[0] === content.split(/[;\s]/)[0]);
  if (ours) await write(`DNS ${type} ${name} → ${content}${proxied ? ' (proxied)' : ''} (was ${ours.content}${ours.proxied ? ', proxied' : ''})`, () => cf('PUT', `${Z}/dns_records/${ours.id}`, want));
  else await write(`DNS ${type} ${name} → ${content}${proxied ? ' (proxied)' : ''}`, () => cf('POST', `${Z}/dns_records`, want));
}

// ---------- the game: Cloudflare Pages ----------
if (ONLY.includes('pages')) {
  step('the game (Cloudflare Pages)');
  for (const [env, e] of Object.entries(ENVS)) {
    let project = await cf('GET', `${A}/pages/projects/${e.pages}`).catch(x => { if (x.status === 404) return null; throw x; });
    if (!project) project = await write(`Pages project ${e.pages} (${env})`, () => cf('POST', `${A}/pages/projects`, { name: e.pages, production_branch: 'main' }));
    const domains = project ? await cf('GET', `${A}/pages/projects/${e.pages}/domains`) : [];
    if (!domains.some(d => d.name === e.game)) await write(`Pages ${e.pages}: the domain ${e.game}`, () => cf('POST', `${A}/pages/projects/${e.pages}/domains`, { name: e.game }));
    await record('CNAME', e.game, `${e.pages}.pages.dev`, { proxied: true });
  }
  // www → the game (the redirect rule below does the redirecting; the record only has to exist, proxied)
  await record('CNAME', `www.${DOMAIN}`, `${ENVS.production.pages}.pages.dev`, { proxied: true });
}

// ---------- map files and downloads: R2 ----------
if (ONLY.includes('r2')) {
  step('map files (R2)');
  for (const [env, e] of Object.entries(ENVS)) {
    const exists = await cf('GET', `${A}/r2/buckets/${e.bucket}`).then(() => true, x => { if (x.status === 404) return false; throw x; });
    if (!exists) await write(`R2 bucket ${e.bucket} (${env}, Asia-Pacific)`, () => cf('POST', `${A}/r2/buckets`, { name: e.bucket, locationHint: 'apac' }));
    // CORS: our game's and API's addresses only; byte ranges (PMTiles) readable
    const origins = [`https://${e.game}`, `https://${e.api}`];
    const cors = { rules: [{ allowed: { origins, methods: ['GET', 'HEAD'], headers: ['range', 'if-none-match', 'if-modified-since'] }, exposeHeaders: ['Content-Range', 'Content-Length', 'Content-Type', 'ETag', 'Accept-Ranges'], maxAgeSeconds: 86400 }] };
    const now = await cf('GET', `${A}/r2/buckets/${e.bucket}/cors`).catch(() => null);
    if (JSON.stringify(now?.rules?.[0]?.allowed?.origins ?? []) !== JSON.stringify(origins)) await write(`R2 ${e.bucket}: CORS for ${origins.join(', ')}`, () => cf('PUT', `${A}/r2/buckets/${e.bucket}/cors`, cors));
    const domains = (await cf('GET', `${A}/r2/buckets/${e.bucket}/domains/custom`).catch(() => ({ domains: [] }))).domains ?? [];
    if (!domains.some(d => d.domain === e.tiles)) await write(`R2 ${e.bucket}: on ${e.tiles}`, () => cf('POST', `${A}/r2/buckets/${e.bucket}/domains/custom`, { domain: e.tiles, zoneId: zone.id, enabled: true, minTLS: '1.2' }));
  }
}

// ---------- the API and the real-time stand-in: Render ----------
if (ONLY.includes('dns')) {
  step('the API and real time (Render)');
  for (const [env, e] of Object.entries(ENVS)) {
    if (!e.render) { console.log(`  (${env}: RENDER_${env.toUpperCase()}_HOST not set — skipped)`); continue; }
    for (const host of [e.api, e.rt]) await record('CNAME', host, e.render, { proxied: PROXY_API });
  }
}

// ---------- rules: www → the game; the edge's secret; the tiles' CORS; caching the tiles ----------
async function rules(phase, ours) {
  const now = await cf('GET', `${Z}/rulesets/phases/${phase}/entrypoint`).catch(x => { if (x.status === 404) return null; throw x; });
  const keep = (now?.rules ?? []).filter(r => !(r.description ?? '').startsWith(TAG)).map(({ action, action_parameters, expression, description, enabled }) => ({ action, action_parameters, expression, description, enabled }));
  const mine = (now?.rules ?? []).filter(r => (r.description ?? '').startsWith(TAG)).map(({ action, action_parameters, expression, description, enabled }) => ({ action, action_parameters, expression, description, enabled }));
  if (JSON.stringify(mine) === JSON.stringify(ours)) return;
  await write(`${phase}: ${ours.map(r => r.description.slice(TAG.length).trim()).join('; ')}`, () => cf('PUT', `${Z}/rulesets/phases/${phase}/entrypoint`, { rules: [...keep, ...ours] }));
}
const hosts = list => `{${list.map(h => `"${h}"`).join(' ')}}`;
if (ONLY.includes('rules')) {
  step('rules');
  await rules('http_request_dynamic_redirect', [{
    description: `${TAG} www to the game`, enabled: true, action: 'redirect', expression: `(http.host eq "www.${DOMAIN}")`,
    action_parameters: { from_value: { status_code: 301, target_url: { expression: `concat("https://${DOMAIN}", http.request.uri.path)` }, preserve_query_string: true } },
  }]);
  await rules('http_request_late_transform', Object.entries(ENVS).filter(([, e]) => e.edge).map(([env, e]) => ({
    description: `${TAG} the edge's secret to the ${env} API`, enabled: true, action: 'rewrite', expression: `(http.host in ${hosts([e.api, e.rt])})`,
    action_parameters: { headers: { 'x-kr-edge': { operation: 'set', value: e.edge } } },
  })));
  // (R2's own CORS answer is cached with the first visitor's origin: set it on every response — cached or not — for
  // the origin asking, when it's ours)
  await rules('http_response_headers_transform', Object.entries(ENVS).map(([env, e]) => ({
    description: `${TAG} tiles CORS (${env})`, enabled: true, action: 'rewrite',
    expression: `(http.host eq "${e.tiles}" and any(http.request.headers["origin"][*] in ${hosts([`https://${e.game}`, `https://${e.api}`])}))`,
    action_parameters: { headers: {
      'Access-Control-Allow-Origin': { operation: 'set', expression: 'http.request.headers["origin"][0]' },
      'Access-Control-Expose-Headers': { operation: 'set', value: 'Content-Range, Content-Length, Content-Type, ETag, Accept-Ranges' },
      Vary: { operation: 'set', value: 'Origin' },
    } },
  })));
  await rules('http_request_cache_settings', [{
    description: `${TAG} cache the tiles`, enabled: true, action: 'set_cache_settings', expression: `(http.host in ${hosts(Object.values(ENVS).map(e => e.tiles))})`,
    action_parameters: { cache: true, edge_ttl: { mode: 'respect_origin' }, browser_ttl: { mode: 'respect_origin' } },
  }]);
}

// ---------- email: Resend, sending as noreply@<domain> ----------
if (ONLY.includes('email') && E.RESEND_API_KEY) {
  step('email (Resend)');
  const rs = async (method, path, body) => {
    const r = await fetch(`https://api.resend.com${path}`, { method, headers: { authorization: `Bearer ${E.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Resend ${method} ${path}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  };
  let d = (await rs('GET', '/domains')).data?.find(x => x.name === DOMAIN);
  if (!d) d = await write(`Resend: the domain ${DOMAIN} (Tokyo, the nearest region)`, () => rs('POST', '/domains', { name: DOMAIN, region: 'ap-northeast-1' }));
  const full = d ? await rs('GET', `/domains/${d.id}`) : null;
  for (const r of full?.records ?? []) {
    const name = r.name === '@' || !r.name ? DOMAIN : (r.name.endsWith(DOMAIN) ? r.name : `${r.name}.${DOMAIN}`);
    await record(r.type, name, r.type === 'TXT' ? r.value.replace(/^"|"$/g, '') : r.value, { priority: r.priority });
  }
  // DMARC: reporting only at first (p=none); docs/DEPLOYMENT.md says when to tighten it
  await record('TXT', `_dmarc.${DOMAIN}`, 'v=DMARC1; p=none; adkim=r; aspf=r');
  if (full && full.status !== 'verified') await write(`Resend: check ${DOMAIN}'s records (status ${full.status})`, () => rs('POST', `/domains/${full.id}/verify`));
  else if (full) console.log(`  ${DOMAIN}: verified`);
}

console.log(`\n${DRY ? `${changes} change(s) to make (dry run: nothing changed)` : changes ? `${changes} change(s) made` : 'everything as it should be'}`);
