// The admin page (Phase 6 Step 1): for admins only — the server checks every call (server/src/routes/admin.ts)
// and logs every action with who, whom and why. Find a player by name, email or id; see their account; change
// their role; suspend them for some days, ban them, lift it; sign them out everywhere; read the log.
// Everything a player wrote (names, reasons) goes on the page as text, never as HTML.

import { createApi, ApiError } from '../account/api.js';

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
  showAdmin();
}

async function showSignIn() {
  $('gateWhy').textContent = 'Sign in with an admin account.';
  $('signIn').hidden = false;
  $('signIn').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try { await api.auth('/sign-in/email', { email: f.get('email'), password: f.get('password') }); api.forgetCsrf(); location.reload(); }
    catch (e) { say($('gateMsg'), errText(e)); }
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
function tabs() {
  const nav = document.getElementById('tabs') ?? document.querySelector('header').insertBefore(h('nav', { id: 'tabs', class: 'row', style: 'margin-left:16px' }), $('who'));
  nav.replaceChildren(...[['Players', showAdmin], ['Economy settings', showSettings], ['Economy dashboard', showDashboard]].map(([label, fn]) => h('button', { class: 'btn ghost', onclick: fn }, label)));
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
    h('div', { class: 'row', style: 'align-items:center' }, h('h2', {}, p.displayName), tags(p)),
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
