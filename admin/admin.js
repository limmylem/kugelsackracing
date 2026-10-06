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
function showAdmin() {
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
    h('h3', {}, 'Their log'), log);
  loadLog(log, id);
}

start();
