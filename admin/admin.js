// The admin page (Phase 6 Step 1; the shop: Phase 6 Step 4): for admins only — the server checks every call (server/src/routes/admin.ts)
// and logs every action with who, whom and why. Find a player by name, email or id; see their account; change
// their role; suspend them for some days, ban them, lift it; sign them out everywhere; read the log.
// Everything a player wrote (names, reasons) goes on the page as text, never as HTML.

import { createApi, ApiError } from '../account/api.js';
import { SITE } from '../site/urls.js';
import { createBotCheck } from '../account/botCheck.js';
import { createLaunchTools } from './launch.js';
import { openContactReplay } from '../mp/contactReplay.js';

const api = createApi();
const $ = id => document.getElementById(id);
// an element: h('div', { class: 'x', onclick }, child, 'text', …) — strings become text nodes
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const when = iso => iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const say = (where, text, good = false) => { where.replaceChildren(text ? h('div', { class: `msg ${good ? 'good' : 'bad'}` }, text) : ''); };
const errText = e => e instanceof ApiError ? `${e.message}${e.requestId ? ` (request ${e.requestId.slice(0, 8)})` : ''}` : String(e?.message ?? e);
const ACTIONS = { 'set-role': 'Role changed', 'owner-admin': 'Made admin (the server\'s owner)', suspend: 'Suspended', ban: 'Banned', unban: 'Ban lifted', 'sign-out-everywhere': 'Signed out everywhere', 'view-player': 'Viewed' };

let me = null, picked = null, research = async () => {};

async function start() {
  try { me = (await api.get('/me')).user; }
  catch (e) {
    if (e.code === 'UNAUTHENTICATED') return showSignIn();
    $('gateWhy').textContent = `Can't reach the server: ${errText(e)}`;
    return;
  }
  $('who').textContent = `${me.displayName} · ${me.role}`;
  $('signOut').hidden = false;
  if (me.role !== 'admin') {
    $('gateWhy').textContent = `This page is for admins. You're signed in as ${me.displayName}, ${me.isGuest ? 'a guest' : `with the ${me.role} role`}.`;
    return;
  }
  // (Phase 6 Step 5: an admin's session needs two-factor sign-in, recently — the account page asks for the code, or
  // turns it on, then comes back here)
  try { await api.get('/admin/audit?limit=1'); }
  catch (e) { if (e.code === 'MFA_REQUIRED') return toTwoFactor(); throw e; }
  showAdmin();
}
function toTwoFactor() {
  const back = SITE.api ? `${SITE.api}/admin/` : '/admin/';
  location.href = `${SITE.game || ''}/account/?${new URLSearchParams({ mode: 'mfa', next: back })}`;
}

let bot = { headers: async () => ({}), reset() {} };
async function showSignIn() {
  $('gateWhy').textContent = 'Sign in with an admin account.';
  $('signIn').hidden = false;
  try { bot = createBotCheck(await api.get('/client-config')); $('signIn').querySelector('button[type=submit], button')?.before(bot.el); } catch { /* the server says when it needs it */ }
  $('signIn').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try { const r = await api.auth('/sign-in/email', { email: f.get('email'), password: f.get('password') }, { headers: await bot.headers() }); api.forgetCsrf(); if (r?.twoFactorRedirect) return toTwoFactor(); location.reload(); }
    catch (e) { bot.reset(); say($('gateMsg'), errText(e)); }
  };
  try {
    const cfg = await api.get('/client-config');
    for (const p of cfg.social) $('social').append(h('button', { class: 'btn secondary', type: 'button', onclick: async () => {
      try { const r = await api.auth('/sign-in/social', { provider: p, callbackURL: '/admin/' }); if (r?.url) location.href = r.url; }
      catch (e) { say($('gateMsg'), errText(e)); }
    } }, `Sign in with ${p[0].toUpperCase()}${p.slice(1)}`));
  } catch { /* email only */ }
}

$('signOut').onclick = async () => { try { await api.auth('/sign-out', {}); } finally { location.reload(); } };

// ---------- the admin's view: search on the left, the player on the right, the log under it ----------
// (the page's views: players — with their economy — the economy's settings, the dashboard)
// (Phase 6 Step 5: reports and flags, support, the launch switches and a player's whole history — admin/launch.js)
let launch = null;
const launchTools = () => launch ??= createLaunchTools({ api, h, say, when, errText,
  main: () => { tabs(); const m = $('main'); m.className = ''; m.replaceChildren(); return m; },
  pickPlayer: id => { showAdmin(); pick(id); }, replayEvidence: id => replayEvidence(id) });
function tabs() {
  const nav = document.getElementById('tabs') ?? document.querySelector('header').insertBefore(h('nav', { id: 'tabs', class: 'row', style: 'margin-left:16px' }), $('who'));
  nav.replaceChildren(...[['Players', showAdmin], ['Reports & flags', () => launchTools().showReports()], ['Support', () => launchTools().showSupport()], ['Launch', () => launchTools().showLaunch()],
    ['Monitoring', () => launchTools().showMonitoring()], ['Contacts', showContacts], ['Economy settings', showSettings], ['Economy dashboard', showDashboard], ['Shop', showShop], ['Shop dashboard', showShopDashboard]].map(([label, fn]) => h('button', { class: 'btn ghost', onclick: fn }, label)));
}
function showAdmin() {
  tabs();
  const main = $('main');
  main.className = '';
  const results = h('div', { class: 'list' }), searchMsg = h('div');
  const q = h('input', { type: 'search', placeholder: 'Name, email or id', autofocus: true, maxlength: 100 });
  const search = async () => {
    const text = q.value.trim();
    if (!text) return;
    try {
      const r = await api.get(`/admin/players?q=${encodeURIComponent(text)}&limit=50`);
      say(searchMsg, r.players.length ? '' : 'Nobody matches that.');
      results.replaceChildren(...r.players.map(p => h('button', { class: `player${picked === p.id ? ' on' : ''}`, onclick: () => pick(p.id) },
        h('span', { class: 'name' }, p.displayName), tags(p), h('span', { class: 'mail' }, p.isGuest ? 'guest' : p.email ?? ''), h('span', { class: 'muted' }, `since ${when(p.createdAt).split(',')[0]}`))));
    } catch (e) { say(searchMsg, errText(e)); }
  };
  q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  research = search;
  main.replaceChildren(
    h('section', {}, h('h2', {}, 'Players'), h('div', { class: 'row' }, h('label', {}, 'Find', q), h('button', { class: 'btn primary', onclick: search }, 'Find')), searchMsg, results),
    h('section', { id: 'detail' }, h('h2', {}, 'A player'), h('p', { class: 'muted' }, 'Find someone and pick them to see their account.')),
    h('section', { style: 'grid-column: 1 / -1' }, h('h2', {}, 'Recent admin actions'), h('div', { id: 'log' })),
  );
  loadLog($('log'));
}

function tags(p) {
  return h('span', { class: 'tags' },
    p.role !== 'player' && h('span', { class: `badge ${p.role}` }, p.role),
    p.isGuest && h('span', { class: 'badge' }, 'guest'),
    p.banned && h('span', { class: 'badge banned' }, p.banExpires ? 'suspended' : 'banned'));
}

async function loadLog(el, targetId = null) {
  try {
    const r = await api.get(`/admin/audit?limit=${targetId ? 100 : 30}${targetId ? `&targetId=${encodeURIComponent(targetId)}` : ''}`);
    if (!r.entries.length) return el.replaceChildren(h('p', { class: 'muted' }, 'Nothing yet.'));
    el.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'What'), !targetId && h('th', {}, 'Whom'), h('th', {}, 'Why'))),
      h('tbody', {}, ...r.entries.map(e => h('tr', {},
        h('td', { class: 'when' }, when(e.at)), h('td', {}, e.actorName ?? (e.actorId ? 'a deleted account' : 'the server')),
        h('td', {}, ACTIONS[e.action] ?? e.action, e.details?.to ? ` → ${e.details.to}` : '', e.details?.days ? ` for ${e.details.days} days` : ''),
        !targetId && h('td', {}, e.targetId ? h('a', { href: '#', onclick: ev => { ev.preventDefault(); pick(e.targetId); } }, e.targetName ?? `${e.targetId.slice(0, 10)} (deleted)`) : '—'),
        h('td', {}, e.reason ?? ''))))));
  } catch (e) { say(el, errText(e)); }
}

async function pick(id) {
  picked = id;
  for (const b of document.querySelectorAll('.player')) b.classList.remove('on');
  const box = $('detail');
  let p;
  try { p = await api.get(`/admin/players/${encodeURIComponent(id)}`); }
  catch (e) { return box.replaceChildren(h('h2', {}, 'A player'), h('div', { class: 'msg bad' }, errText(e))); }
  const msg = h('div', { class: 'msg-slot' }), self = p.id === me.id;
  const reason = ph => h('input', { placeholder: ph, maxlength: 500, minlength: 3, required: true });
  // an action: a confirm, the call, then everything shown again
  const act = (label, why, fn, confirmText) => async () => {
    if (why.value.trim().length < 3) { say(msg, 'Say why first (a few words): it goes in the log.'); why.focus(); return; }
    if (confirmText && !confirm(confirmText)) return;
    try { await fn(); await Promise.all([pick(id), loadLog($('log')), research()]); say($('detail').querySelector('.msg-slot'), `${label}: done.`, true); }
    catch (e) { say(msg, errText(e)); }
  };
  const role = h('select', {}, ...['player', 'editor', 'admin'].map(r => h('option', { value: r, selected: r === p.role }, r)));
  const roleWhy = reason('Why (required)'), days = h('input', { type: 'number', min: 1, max: 365, value: 7 }), suspendWhy = reason('Why (required)');
  const banWhy = reason('Why (required)'), unbanWhy = reason('Why (required)'), outWhy = reason('Why (required)');
  const log = h('div');
  box.replaceChildren(
    h('div', { class: 'row', style: 'align-items:center' }, h('h2', {}, p.displayName), tags(p), h('button', { class: 'btn ghost', onclick: () => launchTools().history(p.id) }, 'Full history')),
    h('dl', {},
      h('dt', {}, 'Email'), h('dd', {}, p.isGuest ? 'a guest (no email)' : `${p.email}${p.emailVerified ? ' · verified' : ' · not verified'}`),
      h('dt', {}, 'Id'), h('dd', {}, p.id),
      h('dt', {}, 'Signs in with'), h('dd', {}, p.providers.join(', ') || '—'),
      h('dt', {}, 'Joined'), h('dd', {}, when(p.createdAt)),
      h('dt', {}, 'Last seen'), h('dd', {}, when(p.lastSeen)),
      h('dt', {}, 'Signed in on'), h('dd', {}, `${p.sessions} device${p.sessions === 1 ? '' : 's'}`),
      h('dt', {}, 'Terms'), h('dd', {}, p.termsVersion ?? 'not accepted yet'),
      h('dt', {}, 'Records · replays · content'), h('dd', {}, `${p.records} · ${p.replays} · ${p.content}`),
      p.banned && h('dt', {}, p.banExpires ? 'Suspended until' : 'Banned'), p.banned && h('dd', {}, `${p.banExpires ? when(p.banExpires) : 'for good'} — ${p.banReason ?? 'no reason given'}`)),
    msg,
    h('h3', {}, 'Actions'),
    h('div', { class: 'actions' },
      h('div', { class: 'action' }, h('label', {}, 'Role', role), roleWhy,
        h('button', { class: 'btn primary', disabled: p.isGuest, onclick: act('Role changed', roleWhy, () => api.post(`/admin/players/${encodeURIComponent(id)}/role`, { role: role.value, reason: roleWhy.value }), `Change ${p.displayName}'s role to ${role.value}?`) }, 'Change role'),
        p.isGuest && h('span', { class: 'muted' }, 'A guest needs a full account first.')),
      !self && (p.banned
        ? h('div', { class: 'action' }, h('label', {}, 'Lift the ban', unbanWhy), h('button', { class: 'btn secondary', onclick: act('Ban lifted', unbanWhy, () => api.post(`/admin/players/${encodeURIComponent(id)}/unban`, { reason: unbanWhy.value })) }, 'Lift it'))
        : h('div', { class: 'action' }, h('label', {}, 'Suspend for days', days), suspendWhy,
          h('button', { class: 'btn secondary', onclick: act('Suspended', suspendWhy, () => api.post(`/admin/players/${encodeURIComponent(id)}/suspend`, { days: Number(days.value), reason: suspendWhy.value }), `Suspend ${p.displayName} for ${days.value} days? They'll be signed out.`) }, 'Suspend'))),
      !self && !p.banned && h('div', { class: 'action' }, h('label', {}, 'Ban for good', banWhy),
        h('button', { class: 'btn danger', onclick: act('Banned', banWhy, () => api.post(`/admin/players/${encodeURIComponent(id)}/ban`, { reason: banWhy.value }), `Ban ${p.displayName} for good? They'll be signed out and can't sign in.`) }, 'Ban')),
      h('div', { class: 'action' }, h('label', {}, 'Sign out everywhere', outWhy),
        h('button', { class: 'btn secondary', onclick: act('Signed out everywhere', outWhy, () => api.post(`/admin/players/${encodeURIComponent(id)}/sign-out`, { reason: outWhy.value }), `Sign ${p.displayName} out on every device?`) }, 'Sign them out'))),
    h('h3', {}, 'Their log'), log,
    h('h3', {}, 'Their economy'), economyOf(id));
  loadLog(log, id);
}

start();


// ---------- a player's economy: their books, cars, parts and builds; putting things right ----------
const money = n => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-GB')}`;
function economyOf(id) {
  const box = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  const load = async () => {
    let e;
    try { e = await api.get(`/admin/players/${encodeURIComponent(id)}/economy`); } catch (err) { return box.replaceChildren(h('div', { class: 'msg bad' }, errText(err))); }
    if (!e.economy) return box.replaceChildren(h('p', { class: 'muted' }, 'They haven\'t played yet: no economy.'));
    const msg = h('div');
    const ask = (text, fn) => async () => { const why = prompt(`${text}\n\nWhy? (required: it goes in the log)`); if (!why || why.trim().length < 3) return; try { await fn(why.trim()); say(msg, 'Done.', true); load(); } catch (err) { say(msg, errText(err)); } };
    const amount = h('input', { type: 'number', step: 1, placeholder: 'e.g. 500 or -500' }), amountWhy = h('input', { placeholder: 'Why (required)', maxlength: 500 });
    const item = h('input', { placeholder: 'part id (or car id)', maxlength: 80 }), itemWhy = h('input', { placeholder: 'Why (required)', maxlength: 500 });
    const history = h('div');
    const showHistory = async iid => {
      const r = await api.get(`/admin/players/${encodeURIComponent(id)}/items/${encodeURIComponent(iid)}/history`);
      history.replaceChildren(h('h3', {}, `History of ${iid}`), h('table', {}, h('tbody', {}, ...r.history.map(x => h('tr', {}, h('td', { class: 'when' }, when(x.at)), h('td', {}, x.event), h('td', {}, JSON.stringify(x.details)), h('td', {}, x.ledgerId ? `ledger #${x.ledgerId}` : ''))))));
    };
    const partsOn = car => e.parts.filter(p => p.car === car);
    box.replaceChildren(
      h('dl', {}, h('dt', {}, 'Money'), h('dd', {}, money(e.economy.balance)), h('dt', {}, 'XP · level'), h('dd', {}, `${e.economy.xp.toLocaleString('en-GB')} · ${e.economy.level}`), h('dt', {}, 'Changes'), h('dd', {}, String(e.economy.rev))),
      msg,
      h('div', { class: 'actions' },
        h('div', { class: 'action' }, h('label', {}, 'Give or take money', amount), amountWhy,
          h('button', { class: 'btn secondary', onclick: async () => { const n = Math.round(Number(amount.value)); if (!n || amountWhy.value.trim().length < 3) return say(msg, 'An amount (not zero) and a reason.'); if (!confirm(`${n > 0 ? 'Give' : 'Take'} ${money(Math.abs(n))}?`)) return; try { await api.post(`/admin/players/${encodeURIComponent(id)}/money`, { amount: n, reason: amountWhy.value.trim() }); say(msg, 'Done.', true); load(); } catch (err) { say(msg, errText(err)); } } }, 'Apply')),
        h('div', { class: 'action' }, h('label', {}, 'Give a part or a car', item), itemWhy,
          h('button', { class: 'btn secondary', onclick: async () => { const v = item.value.trim(); if (!v || itemWhy.value.trim().length < 3) return say(msg, 'An id and a reason.'); const body = { give: /_car$|^(kaze_gt|hana_roadster|ridgeback_4x4|vortex_r|brute_500|strada_evo|apex_v8|starter_car)$/.test(v) ? { carId: v } : { partId: v }, reason: itemWhy.value.trim() }; try { await api.post(`/admin/players/${encodeURIComponent(id)}/items`, body); say(msg, 'Given.', true); load(); } catch (err) { say(msg, errText(err)); } } }, 'Give'))),
      h('h3', {}, 'Cars and their builds'),
      ...e.cars.map(c => h('div', { class: 'action', style: 'margin-bottom:8px' },
        h('div', { class: 'row', style: 'align-items:center' }, h('b', {}, `${c.carId} `), h('span', { class: 'muted' }, `${c.instanceId} · paid ${money(c.price)} · body ${c.damage?.condition ?? 100}%`),
          h('button', { class: 'btn ghost', onclick: () => showHistory(c.instanceId) }, 'History'),
          h('button', { class: 'btn danger', onclick: ask(`Take away ${c.carId} (${c.instanceId}) and everything on it?`, why => api.post(`/admin/players/${encodeURIComponent(id)}/items`, { remove: { carInstanceId: c.instanceId }, reason: why })) }, 'Take away')),
        h('table', {}, h('tbody', {}, ...partsOn(c.instanceId).map(p => h('tr', {}, h('td', {}, p.socket), h('td', {}, p.partId), h('td', {}, `${p.condition}%${p.attach ? ` · ${p.attach}` : ''}${p.mechanical ? ' · damaged' : ''}`), h('td', {}, h('a', { href: '#', onclick: ev => { ev.preventDefault(); showHistory(p.instanceId); } }, p.instanceId)))))))),
      h('h3', {}, 'Spare parts'),
      h('table', {}, h('tbody', {}, ...partsOn(null).map(p => h('tr', {}, h('td', {}, p.partId), h('td', {}, `${p.condition}%`), h('td', {}, h('a', { href: '#', onclick: ev => { ev.preventDefault(); showHistory(p.instanceId); } }, p.instanceId)),
        h('td', {}, h('button', { class: 'btn ghost', onclick: ask(`Take away ${p.partId} (${p.instanceId})?`, why => api.post(`/admin/players/${encodeURIComponent(id)}/items`, { remove: { instanceId: p.instanceId }, reason: why })) }, 'Take away')))))),
      history,
      h('h3', {}, 'Ledger (every money change, newest first)'),
      h('table', {}, h('thead', {}, h('tr', {}, ...['#', 'When', 'Amount', 'Balance', 'What', 'By', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, ...e.ledger.map(r => h('tr', {}, h('td', {}, String(r.id)), h('td', { class: 'when' }, when(r.at)), h('td', { style: `color:var(--c-${r.amount < 0 ? 'bad' : 'good'})` }, money(r.amount)), h('td', {}, money(r.balanceAfter)),
          h('td', {}, `${r.kind}: ${r.reason}${r.reverses ? ` (reverses #${r.reverses})` : ''}${r.reversed ? ' — reversed' : ''}`), h('td', {}, r.actor ?? ''),
          h('td', {}, !r.reversed && r.kind !== 'reversal' ? h('button', { class: 'btn ghost', onclick: ask(`Reverse #${r.id} (${money(r.amount)}: ${r.reason})?`, why => api.post(`/admin/ledger/${r.id}/reverse`, { reason: why })) }, 'Reverse') : ''))))),
    );
  };
  load();
  return box;
}

// ---------- the economy's settings: every version, a change (who, why), a rollback ----------
async function showSettings() {
  tabs();
  const main = $('main'); main.className = 'narrow'; main.style.gridTemplateColumns = 'minmax(320px, 1100px)';
  const msg = h('div'), area = h('textarea', { rows: 28, spellcheck: false, style: 'width:100%;font:12px var(--f-mono)' }), why = h('input', { placeholder: 'Why this change (required: it goes in the history)', maxlength: 500 });
  let cfg;
  const load = async () => {
    cfg = await api.get('/admin/economy/config');
    area.value = JSON.stringify(cfg.current.data, null, 2);
    hist.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ...['Version', 'When', 'Who', 'Why', ''].map(t => h('th', {}, t)))), h('tbody', {}, ...cfg.history.map(v => h('tr', {},
      h('td', {}, `${v.version}${v.active ? ' (active)' : ''}`), h('td', { class: 'when' }, when(v.createdAt)), h('td', {}, v.actorId ?? 'the game\'s files'), h('td', {}, v.reason),
      h('td', {}, v.active ? '' : h('button', { class: 'btn ghost', onclick: async () => { const r = prompt(`Roll back to version ${v.version}? Every price and reward goes back to its values.\n\nWhy? (required)`); if (!r || r.trim().length < 3) return; try { await api.post(`/admin/economy/config/${v.version}/rollback`, { reason: r.trim() }); say(msg, `Back to version ${v.version}'s values (a new version).`, true); load(); } catch (e) { say(msg, errText(e)); } } }, 'Roll back to this')))))));
  };
  const hist = h('div');
  main.replaceChildren(h('section', {}, h('h2', {}, 'Economy settings'),
    h('p', { class: 'muted' }, 'Prices, repairs, rewards, fees and anti-farming: the server charges and pays by the active version, and the game shows it. Every change is a new version with who made it and why; any version can be rolled back to.'),
    msg, area, why,
    h('button', { class: 'btn primary', onclick: async () => {
      let data; try { data = JSON.parse(area.value); } catch (e) { return say(msg, `That isn't valid JSON: ${e.message}`); }
      if (why.value.trim().length < 3) return say(msg, 'Say why first: it goes in the history.');
      if (!confirm('Change the game\'s economy for every player now?')) return;
      try { const r = await api.post('/admin/economy/config', { data, reason: why.value.trim(), basedOn: cfg.active }); say(msg, `Saved as version ${r.version}: active now.`, true); why.value = ''; load(); } catch (e) { say(msg, errText(e)); }
    } }, 'Save as a new version'),
    h('h3', {}, 'History'), hist));
  load().catch(e => say(msg, errText(e)));
}

// ---------- the dashboard ----------
async function showDashboard() {
  tabs();
  const main = $('main'); main.className = 'narrow'; main.style.gridTemplateColumns = 'minmax(320px, 1100px)';
  const box = h('section', {}, h('h2', {}, 'Economy dashboard'), h('p', { class: 'muted' }, 'Loading…'));
  main.replaceChildren(box);
  try {
    const d = await api.get('/admin/economy/dashboard?days=14');
    const byDay = new Map();
    for (const r of d.days) { const x = byDay.get(r.day) ?? byDay.set(r.day, { earned: 0, spent: 0, sources: [] }).get(r.day); x.earned += r.earned; x.spent += r.spent; x.sources.push(r); }
    box.replaceChildren(h('h2', {}, 'Economy dashboard'),
      h('dl', {}, h('dt', {}, 'All the money in the game'), h('dd', {}, money(d.totalMoney)), h('dt', {}, 'Players'), h('dd', {}, String(d.players)), h('dt', {}, 'Average balance'), h('dd', {}, money(d.averageBalance)),
        h('dt', {}, 'Ledger checks'), h('dd', { style: `color:var(--c-${d.ledgerMismatches ? 'bad' : 'good'})` }, d.ledgerMismatches ? `${d.ledgerMismatches} balances don't match their ledgers!` : 'every balance matches its ledger')),
      h('h3', {}, 'Alerts'), d.alerts.length ? h('ul', {}, ...d.alerts.map(a => h('li', {}, h('a', { href: '#', onclick: ev => { ev.preventDefault(); showAdmin(); pick(a.playerId); } }, a.text)))) : h('p', { class: 'muted' }, 'Nothing unusual.'),
      h('h3', {}, 'Earned and spent a day, by where it came from'),
      h('table', {}, h('thead', {}, h('tr', {}, ...['Day', 'Earned', 'Spent', 'By source'].map(t => h('th', {}, t)))), h('tbody', {}, ...[...byDay].reverse().map(([day, x]) => h('tr', {}, h('td', { class: 'when' }, day), h('td', {}, money(x.earned)), h('td', {}, money(x.spent)),
        h('td', {}, x.sources.map(r => `${r.source} ${r.earned ? `+${money(r.earned)}` : ''}${r.spent ? ` −${money(r.spent)}` : ''} (${r.count})`).join(' · ')))))),
      h('h3', {}, 'Average balance by level'),
      h('table', {}, h('thead', {}, h('tr', {}, ...['Level', 'Players', 'Average balance'].map(t => h('th', {}, t)))), h('tbody', {}, ...d.byLevel.map(r => h('tr', {}, h('td', {}, String(r.level)), h('td', {}, String(r.players)), h('td', {}, money(r.averageBalance)))))));
  } catch (e) { box.replaceChildren(h('h2', {}, 'Economy dashboard'), h('div', { class: 'msg bad' }, errText(e))); }
}

// ---------- the shop (Phase 6 Step 4): the catalogue, kits, sales, level locks, the used lot ----------
// Every change is a new version of the economy's settings (who, why — in the log; rolled back from Economy settings)
const isoLocal = iso => iso ? new Date(iso).toISOString().slice(0, 16) : '';
const fromLocal = v => v ? new Date(`${v}:00Z`).toISOString() : null;
async function showShop() {
  tabs();
  const main = $('main'); main.className = 'narrow'; main.style.gridTemplateColumns = 'minmax(320px, 1280px)';
  const msg = h('div'), box = h('div', { class: 'list' });
  main.replaceChildren(h('section', {}, h('h2', {}, 'Shop'),
    h('p', { class: 'muted' }, 'Prices, makers, what\'s for sale and to whom, kits, sales and the used lot. Each change is a new version of the economy\'s settings with your reason; any of them can be rolled back to from Economy settings. Times are UTC.'), msg, box));
  let cat;
  const change = async (c, what) => {
    const why = prompt(`${what}\n\nWhy? (required: it goes in the history)`);
    if (!why || why.trim().length < 3) return false;
    try { const r = await api.post('/admin/shop/catalogue', { change: c, reason: why.trim(), basedOn: cat.version }); say(msg, `Saved as version ${r.version}: active now.`, true); await load(); return true; }
    catch (e) { say(msg, errText(e)); return false; }
  };
  const load = async () => {
    cat = await api.get('/admin/shop/catalogue');
    const filter = h('input', { type: 'search', placeholder: 'Filter parts: name, id, category, maker', maxlength: 60 });
    const partsBody = h('tbody');
    const priceCell = (kind, it) => { const inp = h('input', { type: 'number', min: 0, step: 10, value: it.own.price ?? '', placeholder: String(it.base ?? it.list), style: 'width:110px' }); return [inp, () => inp.value === '' ? null : Math.round(Number(inp.value))]; };
    const row = (kind, it) => {
      const [price, priceOf] = priceCell(kind, it);
      const hidden = h('input', { type: 'checkbox', ...(it.own.hidden ? { checked: true } : {}) });
      const level = h('input', { type: 'number', min: 1, max: 100, value: it.own.unlock?.level ?? '', placeholder: it.unlock?.level ? `${it.unlock.level} (default)` : '—', style: 'width:90px' });
      const until = h('input', { type: 'datetime-local', value: isoLocal(it.own.until) });
      const maker = kind === 'part' ? h('input', { value: it.own.maker ?? '', placeholder: it.maker ?? '', style: 'width:140px', maxlength: 60 }) : null;
      const save = () => change({ op: 'item', kind, id: it.id, set: { price: priceOf(), hidden: hidden.checked ? true : null, unlock: level.value ? { level: Number(level.value) } : null, until: fromLocal(until.value), ...(maker ? { maker: maker.value.trim() || null } : {}) } }, `Change ${it.name}?`);
      return h('tr', { 'data-text': `${it.name} ${it.id} ${it.category ?? ''} ${it.maker ?? ''}`.toLowerCase() },
        h('td', {}, h('b', {}, it.name), h('div', { class: 'muted' }, `${it.id}${it.category ? ` · ${it.category} · ${it.tier}` : ` · class ${it.class}`}`)),
        h('td', {}, money(it.price), it.sale ? h('div', { class: 'muted' }, `${it.sale.name} −${Math.round(it.sale.discount * 100)}%`) : '', !it.forSale ? h('div', { class: 'muted' }, it.why) : ''),
        h('td', {}, price), maker ? h('td', {}, maker) : null, h('td', {}, hidden), h('td', {}, level), h('td', {}, until), h('td', {}, h('button', { class: 'btn secondary', onclick: save }, 'Save')));
    };
    const head = (cols) => h('thead', {}, h('tr', {}, ...cols.map(t => h('th', {}, t))));
    partsBody.replaceChildren(...cat.parts.map(p => row('part', p)));
    filter.oninput = () => { const q = filter.value.trim().toLowerCase(); for (const tr of partsBody.children) tr.hidden = !!q && !tr.dataset.text.includes(q); };
    // kits
    const kitForm = (b = {}) => {
      const id = h('input', { value: b.id ?? '', placeholder: 'kit_id', maxlength: 60 }), name = h('input', { value: b.name ?? '', placeholder: 'Name', maxlength: 80 }), parts = h('input', { value: (b.parts ?? []).join(', '), placeholder: 'part ids, comma separated', style: 'min-width:320px' }), disc = h('input', { type: 'number', min: 0, max: 50, step: 1, value: b.discount != null ? Math.round(b.discount * 100) : 8, style: 'width:80px' }), car = h('input', { value: b.car ?? '', placeholder: 'car id (any)', maxlength: 60 });
      return h('div', { class: 'row' }, h('label', {}, 'Id', id), h('label', {}, 'Name', name), h('label', {}, 'Parts', parts), h('label', {}, 'Off %', disc), h('label', {}, 'For car', car),
        h('button', { class: 'btn secondary', onclick: () => change({ op: 'bundle', bundle: { id: id.value.trim(), name: name.value.trim(), parts: parts.value.split(',').map(x => x.trim()).filter(Boolean), discount: Number(disc.value) / 100, ...(car.value.trim() ? { car: car.value.trim() } : {}) } }, `Save the kit ${name.value}?`) }, 'Save kit'),
        b.id ? h('button', { class: 'btn ghost', onclick: () => change({ op: 'bundle-remove', id: b.id }, `Remove the kit ${b.name}?`) }, 'Remove') : null);
    };
    // sales
    const saleForm = () => {
      const id = h('input', { placeholder: 'sale_id', maxlength: 60 }), name = h('input', { placeholder: 'Name, e.g. Weekend brake sale', maxlength: 80 }), starts = h('input', { type: 'datetime-local' }), ends = h('input', { type: 'datetime-local' }), disc = h('input', { type: 'number', min: 1, max: 90, value: 15, style: 'width:80px' });
      const what = h('select', {}, ...[['all', 'Everything'], ['categories', 'Categories'], ['tiers', 'Tiers'], ['parts', 'Parts'], ['cars', 'Cars'], ['classes', 'Car classes']].map(([v, t]) => h('option', { value: v }, t))), list = h('input', { placeholder: 'ids, comma separated (not for Everything)', style: 'min-width:260px' });
      return h('div', { class: 'row' }, h('label', {}, 'Id', id), h('label', {}, 'Name', name), h('label', {}, 'Starts (UTC)', starts), h('label', {}, 'Ends (UTC)', ends), h('label', {}, 'Off %', disc), h('label', {}, 'On', what), h('label', {}, 'Which', list),
        h('button', { class: 'btn primary', onclick: () => { const ids = list.value.split(',').map(x => x.trim()).filter(Boolean); return change({ op: 'sale', sale: { id: id.value.trim(), name: name.value.trim(), starts: fromLocal(starts.value), ends: fromLocal(ends.value), discount: Number(disc.value) / 100, ...(what.value === 'all' ? { all: true } : { [what.value]: ids }) } }, `Schedule ${name.value}?`); } }, 'Schedule sale'));
    };
    const salesTable = h('table', {}, head(['Sale', 'When', 'Off', 'On', '']), h('tbody', {}, ...cat.sales.map(x => h('tr', {}, h('td', {}, h('b', {}, x.name), h('div', { class: 'muted' }, `${x.id}${x.on ? ' · ON NOW' : x.over ? ' · over' : ' · scheduled'}`)), h('td', { class: 'when' }, `${when(x.starts)} → ${when(x.ends)}`), h('td', {}, `${Math.round(x.discount * 100)}%`),
      h('td', {}, x.all ? 'everything' : ['categories', 'tiers', 'parts', 'cars', 'classes'].filter(k => x[k]?.length).map(k => `${k}: ${x[k].join(', ')}`).join(' · ')),
      h('td', {}, x.on ? h('button', { class: 'btn secondary', onclick: () => change({ op: 'sale', sale: { ...Object.fromEntries(Object.entries(x).filter(([k]) => !['on', 'over'].includes(k))), ends: new Date().toISOString() } }, `End ${x.name} now?`) }, 'End now') : '', h('button', { class: 'btn ghost', onclick: () => change({ op: 'sale-remove', id: x.id }, `Remove ${x.name}?`) }, 'Remove'))))));
    // level locks and the used lot
    const locks = h('textarea', { rows: 6, spellcheck: false, style: 'width:100%;font:12px var(--f-mono)' }); locks.value = JSON.stringify(cat.unlock, null, 1);
    const lot = h('textarea', { rows: 14, spellcheck: false, style: 'width:100%;font:12px var(--f-mono)' }); lot.value = JSON.stringify(cat.usedLot, null, 1);
    const preview = h('div'), day = h('input', { type: 'date' });
    const showPreview = async () => {
      let settings; try { settings = JSON.parse(lot.value); } catch (e) { return say(msg, `The used lot settings aren't valid JSON: ${e.message}`); }
      try {
        const r = await api.post('/admin/shop/used-lot/preview', { settings, ...(day.value ? { day: day.value } : {}) });
        preview.replaceChildren(h('h3', {}, `The lot on ${r.day}${day.value ? '' : ' (tomorrow)'}`), h('table', {}, head(['Car', 'Year · km', 'Body', 'Aftermarket', 'Price', 'New']), h('tbody', {}, ...r.listings.map(l => h('tr', {}, h('td', {}, `${l.name} (${l.rating?.class ?? l.class} ${l.rating?.index ?? ''})`), h('td', {}, `${l.year} · ${l.mileage.toLocaleString('en-GB')} km`), h('td', {}, `${l.condition}%${l.damage.broken?.length ? ' · glass broken' : ''}`), h('td', {}, l.aftermarket.join(', ') || '—'), h('td', {}, money(l.price)), h('td', { class: 'muted' }, money(l.newPrice)))))));
      } catch (e) { say(msg, errText(e)); }
    };
    box.replaceChildren(
      h('h3', {}, `Parts · ${cat.parts.length} (prices: blank is its own; settings version ${cat.version})`), filter,
      h('div', { style: 'max-height:60vh;overflow:auto' }, h('table', {}, head(['Part', 'Now', 'Price', 'Maker', 'Hidden', 'Unlock level', 'Sold until (UTC)', '']), partsBody)),
      h('h3', {}, 'Cars'), h('table', {}, head(['Car', 'Now', 'Price', 'Hidden', 'Unlock level', 'Sold until (UTC)', '']), h('tbody', {}, ...cat.cars.map(c => row('car', c)))),
      h('h3', {}, 'Kits'), ...cat.bundles.map(b => h('div', { class: 'action' }, kitForm(b), h('div', { class: 'muted' }, b.quote ? `${money(b.quote.price)} (saves ${money(b.quote.saving)})${b.quote.forSale ? '' : ` · not for sale: ${b.quote.why ?? ''}`}` : ''))), h('div', { class: 'action' }, h('b', {}, 'A new kit'), kitForm()),
      h('h3', {}, 'Sales'), salesTable, h('div', { class: 'action' }, h('b', {}, 'Schedule a sale'), saleForm()),
      h('h3', {}, 'Level locks (by part tier and car class)'), locks,
      h('button', { class: 'btn secondary', onclick: () => { let v; try { v = JSON.parse(locks.value); } catch (e) { return say(msg, `Not valid JSON: ${e.message}`); } return change({ op: 'unlock', settings: v }, 'Change the level locks?'); } }, 'Save the locks'),
      h('h3', {}, 'The used car lot'), lot, h('div', { class: 'row' }, h('label', {}, 'Day (blank: tomorrow)', day), h('button', { class: 'btn secondary', onclick: showPreview }, 'Preview the lot'),
        h('button', { class: 'btn primary', onclick: () => { let v; try { v = JSON.parse(lot.value); } catch (e) { return say(msg, `Not valid JSON: ${e.message}`); } return change({ op: 'usedLot', settings: v }, 'Save the used lot settings? (Today\'s lot changes too.)'); } }, 'Save the lot settings')),
      preview);
    showPreview();
  };
  load().catch(e => say(msg, errText(e)));
}
async function showShopDashboard() {
  tabs();
  const main = $('main'); main.className = 'narrow'; main.style.gridTemplateColumns = 'minmax(320px, 1100px)';
  const box = h('section', {}, h('h2', {}, 'Shop dashboard'), h('p', { class: 'muted' }, 'Loading…'));
  main.replaceChildren(box);
  try {
    const d = await api.get('/admin/shop/dashboard?days=30');
    const head = cols => h('thead', {}, h('tr', {}, ...cols.map(t => h('th', {}, t))));
    box.replaceChildren(h('h2', {}, 'Shop dashboard · last 30 days'),
      h('dl', {}, h('dt', {}, 'Spent in the shop'), h('dd', {}, money(d.spent)), h('dt', {}, 'Paid out for things sold'), h('dd', {}, money(d.sold)), h('dt', {}, 'Refunds'), h('dd', {}, `${d.refunds} · ${money(d.refunded)}`)),
      h('h3', {}, 'Top sellers'), d.top.length ? h('table', {}, head(['What', 'Kind', 'Bought', 'Spent']), h('tbody', {}, ...d.top.map(t => h('tr', {}, h('td', {}, t.name), h('td', {}, t.kind), h('td', {}, String(t.count)), h('td', {}, money(t.money)))))) : h('p', { class: 'muted' }, 'Nothing bought yet.'),
      h('h3', {}, 'Spend by category'), h('table', {}, head(['Category', 'Spent']), h('tbody', {}, ...d.byCategory.map(c => h('tr', {}, h('td', {}, c.category), h('td', {}, money(c.money)))))),
      h('h3', {}, `Parts nobody bought · ${d.neverBought.count} of ${d.neverBought.of} for sale (dearest first)`),
      h('table', {}, head(['Part', 'Category', 'Tier', 'Price']), h('tbody', {}, ...d.neverBought.items.map(p => h('tr', {}, h('td', {}, `${p.name} (${p.id})`), h('td', {}, p.category), h('td', {}, p.tier ?? ''), h('td', {}, money(p.price)))))),
      h('h3', {}, 'Cars nobody bought'), h('p', {}, d.carsNeverBought.map(c => c.name).join(', ') || 'Every car has sold.'));
  } catch (e) { box.replaceChildren(h('h2', {}, 'Shop dashboard'), h('div', { class: 'msg bad' }, errText(e))); }
}

// ---------- car-to-car contact (Phase 7 Step 3; docs/CONTACT.md "Debug tools") ----------
// a race's contacts as its server logged them — each one's reports, the agreed result, the blame — any of them replayed
// from both players' views side by side; and ramming evidence (the race server's record of both cars)
async function replayEvidence(id) {
  try {
    const e = await api.get(`/admin/mp/evidence/${encodeURIComponent(id)}`);
    openContactReplay({ cid: e.id, kind: 'ramming', cars: e.data.cars, blame: { fault: e.fault, shares: {}, reasons: [`${e.data.hits?.length ?? 0} hits`] } }, { names: e.data.names ?? {}, boxes: e.data.boxes ?? {} });
  } catch (err) { alert(errText(err)); }
}
function showContacts() {
  tabs();
  const main = $('main');
  main.className = '';
  const msg = h('div'), list = h('div');
  const race = h('input', { type: 'search', placeholder: 'A race\'s id', maxlength: 80 }), ev = h('input', { type: 'search', placeholder: 'Evidence id (from a ramming report)', maxlength: 80 });
  const load = async () => {
    const id = race.value.trim(); if (!id) return;
    try {
      const r = await api.get(`/admin/mp/races/${encodeURIComponent(id)}/contacts`);
      say(msg, r.contacts.length ? `${r.contacts.length} contacts, ${r.rejected.length} reports refused` : 'No contacts in that race.');
      const names = {};
      list.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ...['Contact', 'When', 'What', 'Reports', 'Agreed', 'Blame', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, ...r.contacts.map(c => h('tr', {},
          h('td', {}, c.cid), h('td', { class: 'when' }, `${(c.t / 1000).toFixed(1)} s`),
          h('td', {}, `${c.kind} at ${Number(c.closing).toFixed(1)} m/s${c.gentler ? ' (gentler)' : ''}`),
          h('td', {}, ...(c.reports ?? []).map(x => h('div', { class: 'muted' }, `${x.pid.slice(-6)}: ${Number(x.closing).toFixed(1)} m/s, predicted ${x.predictMs} ms, pushed ${Math.round(Math.hypot(...(x.J ?? [0, 0])))} N s`))),
          h('td', {}, ...Object.entries(c.cars ?? {}).map(([pid, x]) => h('div', { class: 'muted' }, `${pid.slice(-6)}: ${Math.round(Math.hypot(...x.impulse))} N s, damage ${Number(x.strength).toFixed(1)}×${x.scale}`))),
          h('td', {}, c.blame?.fault ? `${c.blame.fault.slice(-6)} ${Math.round((c.blame.shares?.[c.blame.fault] ?? 0) * 100)}%${c.blame.careless ? ' careless' : ''}` : '—', h('div', { class: 'muted' }, (c.blame?.reasons ?? []).join('; '))),
          h('td', {}, h('button', { class: 'btn ghost', onclick: () => openContactReplay(c, { names }) }, 'Replay')))))));
    } catch (e) { say(msg, errText(e)); }
  };
  race.addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  ev.addEventListener('keydown', e => { if (e.key === 'Enter' && ev.value.trim()) replayEvidence(ev.value.trim()); });
  main.replaceChildren(h('section', { style: 'grid-column: 1 / -1' }, h('h2', {}, 'Car-to-car contact'),
    h('div', { class: 'row' }, h('label', {}, 'Race', race), h('button', { class: 'btn primary', onclick: load }, 'Show its contacts'), h('label', {}, 'Evidence', ev), h('button', { class: 'btn', onclick: () => ev.value.trim() && replayEvidence(ev.value.trim()) }, 'Replay it')),
    msg, list));
}
