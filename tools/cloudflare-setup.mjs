// Cloudflare and Resend for the game online (docs/DEPLOYMENT.md; the owner's part: docs/GO_LIVE.md) — run by the
// "infra" workflow (.github/workflows/infra.yml), since only GitHub Actions holds the setup token. Production only.
// Safe to run again and again: each thing is made if it's missing and put right if it's different; nothing else in
// the account is touched (our rules are the ones whose description starts "ognistrada:", our DNS records carry the
// comment below). The only records of anyone else's it deletes are A, AAAA and CNAME records standing on one of our
// names (Namecheap's parking page, say) — never MX or TXT records that aren't ours.
//
//   node tools/cloudflare-setup.mjs [--dry-run] [--hsts] [--only https,pages,r2,tunnel,dns,rules,email]
//     --dry-run  only say what would change (it still reads everything, so it needs the token)
//     --hsts     HTTP Strict Transport Security on every address (once everything works over HTTPS)
//     --only     some of the steps; they always run in the order below (dns first: it clears the way for the
//                records the others make)
//
// Environment:
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   the setup token (its permissions: docs/GO_LIVE.md Part 1 step 7)
//   EDGE_SECRET                                   the same value as the server's (the rules step)
//   RESEND_API_KEY                                full access (the email step's Resend part; without it, skipped)
//   DOMAIN                                        ognistrada.com unless set
// (The pure parts are exported for tests/unit/cloudflareSetup.test.mjs; importing this file runs nothing.)

import { pathToFileURL } from 'node:url';

export const STEPS = ['https', 'dns', 'pages', 'r2', 'tunnel', 'rules', 'email'];
export const TAG = 'ognistrada:';
export const COMMENT = 'ognistrada (tools/cloudflare-setup.mjs)';
export const BACKUP_DAYS = 35;

// ---------- the plan: every address and what's behind it ----------
export function plan(domain) {
  return {
    game: domain, www: `www.${domain}`, api: `api.${domain}`, rt: `rt.${domain}`, tiles: `tiles.${domain}`,
    pages: 'ognistrada', tilesBucket: 'ognistrada-tiles', backupsBucket: 'ognistrada-backups', tunnel: 'ognistrada',
    // (the tunnel's routes to the server's containers: docker-compose's service names)
    ingress: [{ hostname: `api.${domain}`, service: 'http://api:8787' }, { hostname: `rt.${domain}`, service: 'http://rt:2567' }, { service: 'http_status:404' }],
  };
}

// ---------- pure: what stands in the way, what a refusal means ----------
const sameName = (a, b) => String(a).replace(/\.$/, '').toLowerCase() === String(b).replace(/\.$/, '').toLowerCase();

// The records already on one of our names that are in the way of the one we want there (want: { type: 'CNAME',
// content } — content null when it isn't known yet; 'R2' — the name kept free for R2's own record; 'TXT' or 'MX').
// An A or AAAA record, or a CNAME pointing anywhere else, is deleted (del); MX, TXT and the rest never are: where a
// CNAME can't share its name with them (anywhere but the domain itself) they're only reported. Read-only records
// (R2's and Workers' own) are left alone.
export function inTheWay(found, want, { apex = false } = {}) {
  const del = [], report = [];
  for (const r of found) {
    if (r.meta?.read_only || r.locked) continue;
    if (want.type === 'TXT' || want.type === 'MX') { if (r.type === 'CNAME') del.push(r); continue; }
    if (r.type === 'A' || r.type === 'AAAA') del.push(r);
    else if (r.type === 'CNAME') { if (!(want.type === 'CNAME' && want.content && sameName(r.content, want.content))) del.push(r); }
    else if (!apex) report.push(r);
  }
  return { del, report };
}

// What a refused call probably means, in the owner's words (the setup token's permissions are listed in
// docs/GO_LIVE.md Part 1 step 7)
const PERMISSIONS = [
  [/^\/zones\?/, 'Zone → Zone → Read (with Zone Resources: Include → Specific zone → the domain)'],
  [/\/settings\//, 'Zone → Zone Settings → Edit'],
  [/\/dns_records/, 'Zone → DNS → Edit'],
  [/http_request_dynamic_redirect/, 'Zone → Single Redirect → Edit'],
  [/http_request_late_transform|http_response_headers_transform/, 'Zone → Transform Rules → Edit'],
  [/http_request_cache_settings/, 'Zone → Cache Rules → Edit'],
  [/\/pages\//, 'Account → Cloudflare Pages → Edit'],
  [/\/r2\//, 'Account → Workers R2 Storage → Edit'],
  [/\/cfd_tunnel/, 'Account → Cloudflare Tunnel → Edit'],
];
export function hintFor(path, status, errors = []) {
  const codes = (errors ?? []).map(e => e?.code);
  if (codes.includes(10042)) return 'R2 isn\'t switched on for the account yet: R2 Object Storage → enable it and add a card (docs/GO_LIVE.md Part 1 step 4)';
  if (codes.some(c => [81053, 81054, 81057].includes(c))) return 'another record already has this name: the dns step deletes the ones in the way (--only dns), or delete it by hand';
  if (codes.some(c => [1000, 6003, 6111, 9106].includes(c))) return 'CLOUDFLARE_API_TOKEN isn\'t a valid token (copied whole? expired? docs/GO_LIVE.md Part 1 step 7)';
  if (status !== 403 && !codes.includes(10000) && !codes.includes(9109)) return null;
  const perm = PERMISSIONS.find(([re]) => re.test(path))?.[1];
  return `the setup token is probably missing ${perm ?? 'a permission'} (its permissions: docs/GO_LIVE.md Part 1 step 7)${path.startsWith('/accounts/') ? ', or CLOUDFLARE_ACCOUNT_ID isn\'t the token\'s account' : ''}`;
}

// the tunnel's routes as Cloudflare keeps them, without the extras it adds (per-route originRequest)
export const ingressOf = config => (config?.ingress ?? []).map(({ hostname, service }) => (hostname ? { hostname, service } : { service }));

// the backups bucket's lifecycle rules with ours (delete after BACKUP_DAYS) in, anyone else's kept
export function lifecycleWith(rules = []) {
  const ours = { id: `${TAG} delete backups after ${BACKUP_DAYS} days`, enabled: true, conditions: { prefix: '' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: BACKUP_DAYS * 86400 } } };
  const mine = rules.filter(r => String(r.id ?? '').startsWith(TAG)), others = rules.filter(r => !String(r.id ?? '').startsWith(TAG));
  const m = mine[0], same = mine.length === 1 && m.enabled && !m.conditions?.prefix && m.deleteObjectsTransition?.condition?.type === 'Age' && m.deleteObjectsTransition.condition.maxAge === ours.deleteObjectsTransition.condition.maxAge;
  return { same, rules: [...others, ours] };
}

// the name a Resend record goes on ('send', 'resend._domainkey', '@' or the whole name)
export const resendName = (name, domain) => (!name || name === '@' ? domain : sameName(name, domain) || String(name).toLowerCase().endsWith(`.${domain}`) ? name : `${name}.${domain}`);

// ---------- the run ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

async function main() {
  const args = process.argv.slice(2), has = n => args.includes(n), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const DRY = has('--dry-run'), HSTS = has('--hsts');
  const ONLY = opt('--only', STEPS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
  const unknown = ONLY.filter(s => !STEPS.includes(s));
  if (unknown.length) { console.error(`--only: ${unknown.join(', ')}? The steps: ${STEPS.join(', ')}`); process.exit(2); }
  const E = process.env, DOMAIN = E.DOMAIN || 'ognistrada.com', P = plan(DOMAIN);
  const need = k => { if (!E[k]) { console.error(`${k} is not set`); process.exit(2); } return E[k]; };
  const TOKEN = need('CLOUDFLARE_API_TOKEN'), ACCOUNT = need('CLOUDFLARE_ACCOUNT_ID');

  let changes = 0, failed = 0;
  const gone = new Set();          // (records deleted — or, in a dry run, that would be — so later steps don't count them)
  async function cf(method, path, body) {
    const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw Object.assign(new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j.errors ?? j).slice(0, 400)}`), { status: r.status, hint: hintFor(path, r.status, j.errors) });
    return j.result;
  }
  const orNull = p => p.catch(x => { if (x.status === 404) return null; throw x; });
  const write = async (what, fn) => { if (DRY) { changes++; console.log(`  would ${what}`); return null; } console.log(`  ${what}`); const out = await fn(); changes++; return out; };

  // ---------- the zone (a pending one — nameservers not switched yet — doesn't stop anything) ----------
  const zone = (await cf('GET', `/zones?name=${DOMAIN}`).catch(e => { console.error(`${e.message}${e.hint ? `\n  → ${e.hint}` : ''}`); process.exit(1); }))?.[0];
  if (!zone) { console.error(`${DOMAIN} isn't a zone this token can see: add the site in Cloudflare (docs/GO_LIVE.md Part 1), and check the token has Zone → Zone → Read with Zone Resources including ${DOMAIN}`); process.exit(1); }
  const Z = `/zones/${zone.id}`, A = `/accounts/${ACCOUNT}`;
  console.log(`${DOMAIN}: zone ${zone.id}, ${zone.status}${DRY ? ' — dry run: nothing is changed' : ''}`);
  if (zone.status !== 'active') console.log(`  (not active yet: the nameservers at Namecheap aren't Cloudflare's ${(zone.name_servers ?? []).join(' and ') || ''} yet — docs/GO_LIVE.md Part 1 step 3. Carrying on: everything can be set up now, and is served once the zone is active.)`);

  // ---------- DNS records ----------
  async function record(type, name, content, { proxied = false, priority } = {}) {
    const found = (await cf('GET', `${Z}/dns_records?type=${type}&name=${encodeURIComponent(name)}`)).filter(r => !gone.has(r.id));
    const proxiable = ['A', 'AAAA', 'CNAME'].includes(type);
    const want = { type, name, content, ttl: 1, ...(proxiable ? { proxied } : {}), ...(priority !== undefined ? { priority } : {}), comment: COMMENT };
    const unq = s => String(s).replace(/^"|"$/g, '');
    if (found.some(r => unq(r.content) === unq(content) && (!proxiable || r.proxied === proxied) && (priority === undefined || r.priority === priority))) return;
    // (one CNAME a name; an SPF or DMARC record is put right in place — a name can have only one — and other TXT and
    // MX records are added alongside anyone else's)
    const ours = type === 'CNAME' ? found[0] : type === 'TXT' ? found.find(r => /^v=(spf1|DMARC1)\b/.test(unq(content)) && unq(r.content).split(/[;\s]/)[0] === unq(content).split(/[;\s]/)[0]) : found.find(r => r.comment === COMMENT && unq(r.content) === unq(content));
    const shown = `${type} ${name} → ${content.length > 60 ? `${content.slice(0, 57)}…` : content}${proxied ? ' (proxied)' : ''}`;
    if (ours) await write(`put right DNS ${shown} (was ${unq(ours.content).slice(0, 60)}${ours.proxied ? ', proxied' : ''})`, () => cf('PUT', `${Z}/dns_records/${ours.id}`, want));
    else await write(`add DNS ${shown}`, () => cf('POST', `${Z}/dns_records`, want));
  }
  async function findTunnel() {
    const list = await cf('GET', `${A}/cfd_tunnel?name=${encodeURIComponent(P.tunnel)}&is_deleted=false`);
    return (list ?? []).find(t => t.name === P.tunnel && !t.deleted_at) ?? null;
  }
  const tunnelHost = t => `${t?.id ?? '<the new tunnel\'s id>'}.cfargotunnel.com`;

  const run = {
    // ---------- HTTPS for every address ----------
    async https() {
      const want = { ssl: 'strict', always_use_https: 'on', min_tls_version: '1.2', tls_1_3: 'on', automatic_https_rewrites: 'on', websockets: 'on' };
      for (const [k, v] of Object.entries(want)) {
        const now = await cf('GET', `${Z}/settings/${k}`);
        if (now.value !== v) await write(`set ${k}: ${now.value} → ${v}`, () => cf('PATCH', `${Z}/settings/${k}`, { value: v }));
      }
      const sts = { enabled: HSTS, max_age: HSTS ? 31536000 : 0, include_subdomains: HSTS, preload: false, nosniff: true };
      const now = (await cf('GET', `${Z}/settings/security_header`)).value?.strict_transport_security ?? {};
      if (!!now.enabled !== sts.enabled || (HSTS && (now.max_age !== sts.max_age || !now.include_subdomains))) await write(`set HSTS ${HSTS ? 'on (a year, every subdomain)' : 'off'}`, () => cf('PATCH', `${Z}/settings/security_header`, { value: { strict_transport_security: sts } }));
    },

    // ---------- records in the way of ours (Namecheap's parking page, an old host) ----------
    async dns() {
      const tunnel = await findTunnel();
      const tilesOn = ((await orNull(cf('GET', `${A}/r2/buckets/${P.tilesBucket}/domains/custom`)))?.domains ?? []).some(d => d.domain === P.tiles);
      const wants = [
        { name: P.game, type: 'CNAME', content: `${P.pages}.pages.dev`, what: 'the game (Pages)' },
        { name: P.www, type: 'CNAME', content: `${P.pages}.pages.dev`, what: 'www (redirected to the game)' },
        { name: P.api, type: 'CNAME', content: tunnel ? tunnelHost(tunnel) : null, what: 'the API (the tunnel)' },
        { name: P.rt, type: 'CNAME', content: tunnel ? tunnelHost(tunnel) : null, what: 'real time (the tunnel)' },
        // (once R2 has the address its own record is there, and nothing else can be)
        ...(tilesOn ? [] : [{ name: P.tiles, type: 'R2', what: 'the tiles (R2)' }]),
        { name: `_dmarc.${DOMAIN}`, type: 'TXT', what: 'DMARC' },
        // (Resend's names: its SPF and bounce address, its DKIM key)
        { name: `send.${DOMAIN}`, type: 'TXT', what: 'email (Resend)' }, { name: `resend._domainkey.${DOMAIN}`, type: 'TXT', what: 'email (Resend)' },
      ];
      let clear = true;
      for (const w of wants) {
        const found = await cf('GET', `${Z}/dns_records?name=${encodeURIComponent(w.name)}&per_page=100`);
        const { del, report } = inTheWay(found, w, { apex: w.name === DOMAIN });
        for (const r of del) { clear = false; gone.add(r.id); await write(`delete DNS ${r.type} ${r.name} → ${r.content}${r.proxied ? ' (proxied)' : ''}: in the way of ${w.what}`, () => cf('DELETE', `${Z}/dns_records/${r.id}`)); }
        for (const r of report) { clear = false; console.log(`  left alone: ${r.type} ${r.name} → ${r.content} (not ours to delete; if ${w.what}'s record is refused, delete this one by hand)`); }
      }
      if (clear) console.log('  nothing in the way');
    },

    // ---------- the game: Cloudflare Pages, on the domain itself; www → the game ----------
    async pages() {
      let project = await orNull(cf('GET', `${A}/pages/projects/${P.pages}`));
      if (!project) project = await write(`make the Pages project ${P.pages} (production branch main)`, () => cf('POST', `${A}/pages/projects`, { name: P.pages, production_branch: 'main' }));
      else if (project.production_branch !== 'main') await write(`set Pages ${P.pages}'s production branch: ${project.production_branch} → main`, () => cf('PATCH', `${A}/pages/projects/${P.pages}`, { production_branch: 'main' }));
      const domains = project ? await cf('GET', `${A}/pages/projects/${P.pages}/domains`) : [];
      const d = domains.find(x => x.name === P.game);
      if (!d) await write(`add ${P.game} to Pages ${P.pages}`, () => cf('POST', `${A}/pages/projects/${P.pages}/domains`, { name: P.game }));
      else if (d.status !== 'active') console.log(`  (Pages ${P.pages}: ${P.game} is ${d.status} — it turns active by itself once the zone is active and the record below is in place)`);
      await record('CNAME', P.game, `${P.pages}.pages.dev`, { proxied: true });
      // (www only has to exist, proxied: the rules step's redirect answers it)
      await record('CNAME', P.www, `${P.pages}.pages.dev`, { proxied: true });
    },

    // ---------- R2: the map files on tiles.<domain>; the backups, private, deleted after 35 days ----------
    async r2() {
      for (const bucket of [P.tilesBucket, P.backupsBucket]) {
        const exists = !!(await orNull(cf('GET', `${A}/r2/buckets/${bucket}`)));
        // (the location is only a hint: Oceania, near the players and the server)
        if (!exists) await write(`make the R2 bucket ${bucket} (Oceania)`, () => cf('POST', `${A}/r2/buckets`, { name: bucket, locationHint: 'oc' }));
        if (!exists && DRY) continue;
        if (bucket === P.tilesBucket) {
          // CORS: our game's and API's addresses only; byte ranges (PMTiles) readable
          const origins = [`https://${P.game}`, `https://${P.api}`];
          const cors = { rules: [{ allowed: { origins, methods: ['GET', 'HEAD'], headers: ['range', 'if-none-match', 'if-modified-since'] }, exposeHeaders: ['Content-Range', 'Content-Length', 'Content-Type', 'ETag', 'Accept-Ranges'], maxAgeSeconds: 86400 }] };
          const now = await orNull(cf('GET', `${A}/r2/buckets/${bucket}/cors`));
          if (JSON.stringify(now?.rules?.[0]?.allowed?.origins ?? []) !== JSON.stringify(origins)) await write(`set R2 ${bucket}'s CORS: ${origins.join(', ')}`, () => cf('PUT', `${A}/r2/buckets/${bucket}/cors`, cors));
          const domains = (await orNull(cf('GET', `${A}/r2/buckets/${bucket}/domains/custom`)))?.domains ?? [];
          if (!domains.some(d => d.domain === P.tiles)) await write(`put R2 ${bucket} on ${P.tiles}`, () => cf('POST', `${A}/r2/buckets/${bucket}/domains/custom`, { domain: P.tiles, zoneId: zone.id, enabled: true, minTLS: '1.2' }));
        } else {
          // private: no r2.dev address, no custom domain (the backups workflow reaches it with the R2 keys only)
          const managed = await orNull(cf('GET', `${A}/r2/buckets/${bucket}/domains/managed`));
          if (managed?.enabled) await write(`switch off R2 ${bucket}'s public r2.dev address`, () => cf('PUT', `${A}/r2/buckets/${bucket}/domains/managed`, { enabled: false }));
          for (const d of (await orNull(cf('GET', `${A}/r2/buckets/${bucket}/domains/custom`)))?.domains ?? []) await write(`remove the address ${d.domain} from R2 ${bucket} (the backups stay private)`, () => cf('DELETE', `${A}/r2/buckets/${bucket}/domains/custom/${d.domain}`));
          const life = lifecycleWith((await orNull(cf('GET', `${A}/r2/buckets/${bucket}/lifecycle`)))?.rules ?? []);
          if (!life.same) await write(`set R2 ${bucket}'s lifecycle: every object deleted ${BACKUP_DAYS} days after it's made`, () => cf('PUT', `${A}/r2/buckets/${bucket}/lifecycle`, { rules: life.rules }));
        }
      }
    },

    // ---------- the tunnel: api. and rt. to the server's containers (the server only connects out) ----------
    async tunnel() {
      let t = await findTunnel();
      if (t && t.remote_config === false) throw new Error(`the tunnel ${P.tunnel} is set up from a file on a machine (cloudflared tunnel create), not from Cloudflare: delete it (Zero Trust → Networks → Tunnels) and run this again`);
      if (!t) t = await write(`make the tunnel ${P.tunnel} (its settings kept in Cloudflare)`, () => cf('POST', `${A}/cfd_tunnel`, { name: P.tunnel, config_src: 'cloudflare' }));
      else console.log(`  tunnel ${P.tunnel}: ${t.id}, ${t.status ?? 'status unknown'}${t.status === 'inactive' ? ' (until the server\'s cloudflared connects: the server-setup workflow and the first deploy)' : ''}`);
      const now = t ? await orNull(cf('GET', `${A}/cfd_tunnel/${t.id}/configurations`)) : null;
      if (JSON.stringify(ingressOf(now?.config)) !== JSON.stringify(P.ingress)) {
        await write(`route the tunnel: ${P.ingress.map(r => r.hostname ? `${r.hostname} → ${r.service}` : `anything else → ${r.service.replace('http_status:', '')}`).join(', ')}`,
          () => cf('PUT', `${A}/cfd_tunnel/${t.id}/configurations`, { config: { ...(now?.config ?? {}), ingress: P.ingress } }));
      }
      for (const host of [P.api, P.rt]) await record('CNAME', host, tunnelHost(t), { proxied: true });
    },

    // ---------- rules: www → the game; the edge's secret; the tiles' CORS; caching the tiles ----------
    async rules() {
      const edge = E.EDGE_SECRET;
      if (!edge || edge.length < 24) throw new Error('EDGE_SECRET is not set (or under 24 characters): the same value as the server\'s, from GitHub\'s secrets');
      const hosts = list => `{${list.map(h => `"${h}"`).join(' ')}}`;
      async function rules(phase, ours) {
        const now = await orNull(cf('GET', `${Z}/rulesets/phases/${phase}/entrypoint`));
        const pick = ({ action, action_parameters, expression, description, enabled }) => ({ action, action_parameters, expression, description, enabled });
        const keep = (now?.rules ?? []).filter(r => !(r.description ?? '').startsWith(TAG)).map(pick);
        const mine = (now?.rules ?? []).filter(r => (r.description ?? '').startsWith(TAG)).map(pick);
        if (JSON.stringify(mine) === JSON.stringify(ours)) return;
        await write(`set the ${phase} rules: ${ours.map(r => r.description.slice(TAG.length).trim()).join('; ')}`, () => cf('PUT', `${Z}/rulesets/phases/${phase}/entrypoint`, { rules: [...keep, ...ours] }));
      }
      await rules('http_request_dynamic_redirect', [{
        description: `${TAG} www to the game`, enabled: true, action: 'redirect', expression: `(http.host eq "${P.www}")`,
        action_parameters: { from_value: { status_code: 301, target_url: { expression: `concat("https://${P.game}", http.request.uri.path)` }, preserve_query_string: true } },
      }]);
      // (the server believes CF-Connecting-IP only from a request carrying this: through the tunnel every request
      // arrives from the cloudflared container)
      await rules('http_request_late_transform', [{
        description: `${TAG} the edge's secret to the API and real time`, enabled: true, action: 'rewrite', expression: `(http.host in ${hosts([P.api, P.rt])})`,
        action_parameters: { headers: { 'x-kr-edge': { operation: 'set', value: edge } } },
      }]);
      // (R2's own CORS answer is cached with the first visitor's origin: set it on every response — cached or not — for
      // the origin asking, when it's ours)
      await rules('http_response_headers_transform', [{
        description: `${TAG} tiles CORS`, enabled: true, action: 'rewrite',
        expression: `(http.host eq "${P.tiles}" and any(http.request.headers["origin"][*] in ${hosts([`https://${P.game}`, `https://${P.api}`])}))`,
        action_parameters: { headers: {
          'Access-Control-Allow-Origin': { operation: 'set', expression: 'http.request.headers["origin"][0]' },
          'Access-Control-Expose-Headers': { operation: 'set', value: 'Content-Range, Content-Length, Content-Type, ETag, Accept-Ranges' },
          Vary: { operation: 'set', value: 'Origin' },
        } },
      }]);
      await rules('http_request_cache_settings', [{
        description: `${TAG} cache the tiles`, enabled: true, action: 'set_cache_settings', expression: `(http.host eq "${P.tiles}")`,
        action_parameters: { cache: true, edge_ttl: { mode: 'respect_origin' }, browser_ttl: { mode: 'respect_origin' } },
      }]);
    },

    // ---------- email: Resend (Tokyo), sending as noreply@<domain>; its records never proxied ----------
    async email() {
      // DMARC: reporting only at first (p=none); docs/DEPLOYMENT.md says when to tighten it
      await record('TXT', `_dmarc.${DOMAIN}`, 'v=DMARC1; p=none; adkim=r; aspf=r');
      if (!E.RESEND_API_KEY) { console.log('  (RESEND_API_KEY isn\'t set: Resend\'s domain and records skipped)'); return; }
      const rs = async (method, path, body) => {
        const r = await fetch(`https://api.resend.com${path}`, { method, headers: { authorization: `Bearer ${E.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(`Resend ${method} ${path}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`), { hint: r.status === 401 || r.status === 403 ? 'RESEND_API_KEY needs Full access (docs/GO_LIVE.md Part 4)' : null });
        return j;
      };
      let d = (await rs('GET', '/domains')).data?.find(x => x.name === DOMAIN);
      if (!d) d = await write(`add the domain ${DOMAIN} to Resend (Tokyo, ap-northeast-1)`, () => rs('POST', '/domains', { name: DOMAIN, region: 'ap-northeast-1' }));
      else if (d.region && d.region !== 'ap-northeast-1') console.log(`  (Resend has ${DOMAIN} in ${d.region}, not Tokyo: it works; to move it, delete it in Resend and run this again)`);
      if (!d) { console.log('  (its SPF and DKIM records are added on the real run, once Resend has made them)'); return; }
      const full = await rs('GET', `/domains/${d.id}`);
      for (const r of full.records ?? []) {
        const name = resendName(r.name, DOMAIN);
        // (an MX on the domain itself would take its incoming mail: we only send)
        if (r.type === 'MX' && sameName(name, DOMAIN)) { console.log(`  (skipped Resend's MX for ${DOMAIN} itself: receiving isn't used)`); continue; }
        await record(r.type, name, r.type === 'TXT' ? String(r.value).replace(/^"|"$/g, '') : r.value, { priority: r.priority });
      }
      if (full.status !== 'verified') await write(`ask Resend to check ${DOMAIN}'s records (status ${full.status}; DNS can take a while to spread — run --only email again later if it doesn't turn verified)`, () => rs('POST', `/domains/${full.id}/verify`));
      else console.log(`  ${DOMAIN}: verified in Resend`);
    },
  };

  const TITLES = { https: 'HTTPS', dns: 'DNS: records in the way of ours', pages: 'the game (Cloudflare Pages)', r2: 'R2: map files and backups', tunnel: 'the tunnel (api. and rt. → the server)', rules: 'rules', email: 'email (Resend)' };
  for (const s of STEPS) {
    if (!ONLY.includes(s)) continue;
    console.log(`\n— ${TITLES[s]}`);
    try { await run[s](); }
    catch (e) {
      failed++;
      console.log(`  FAILED: ${e.message}`);
      if (e.hint) console.log(`  → ${e.hint}`);
      else if (zone.status !== 'active') console.log('  → (the zone isn\'t active yet: if this is why, run it again once Cloudflare says it is)');
    }
  }
  console.log(`\n${DRY ? `${changes} change(s) to make (dry run: nothing changed)` : `${changes} change(s) made${changes ? '' : ' (everything as it should be)'}`}${failed ? `; ${failed} step(s) failed (above)` : ''}`);
  process.exitCode = failed ? 1 : 0;
}
