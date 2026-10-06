// The public status page (Phase 6 Step 5, docs/OPERATIONS.md): served with the game's own files (Cloudflare Pages), so it
// loads even when the game's server is down — and then says so. It asks the server's /api/v1/status (up, the database,
// maintenance and its message, features switched off) every 30 seconds. An external uptime monitor watches the same
// address and alerts the owner (that doesn't depend on anyone having this page open).

import { apiBase } from './urls.js';

const $ = id => document.getElementById(id);
const row = (name, state, text) => { const d = document.createElement('div'); d.className = 'row'; const a = document.createElement('span'); a.textContent = name; const b = document.createElement('span'); b.className = state; b.textContent = `${state === 'ok' ? '✔' : state === 'warn' ? '▲' : '✖'} ${text}`; d.append(a, b); return d; };
const NAMES = { signUp: 'Signing up', guests: 'Playing as a guest', shop: 'The shop', quests: 'Quests', tracks: 'Track results', replays: 'Replays', editor: 'World editing', reports: 'Reports', support: 'Support' };

async function check() {
  const t0 = performance.now();
  let s = null, err = null;
  try { const r = await fetch(`${apiBase}/api/v1/status`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }); s = await r.json(); }
  catch (e) { err = e; }
  const ms = Math.round(performance.now() - t0);
  const parts = [row('The game\'s pages', 'ok', 'up')];
  if (!s) {
    $('overall').className = 'big bad'; $('overall').textContent = '✖ The game\'s server isn\'t answering';
    $('message').textContent = 'Free roam on this device still works; progress and races need the server. We\'ve been alerted.';
    parts.push(row('The game\'s server', 'bad', err?.name === 'TimeoutError' ? 'not answering' : 'unreachable'));
  } else {
    const off = Object.entries(s.features ?? {}).filter(([, on]) => !on).map(([k]) => NAMES[k] ?? k);
    const state = s.maintenance?.on ? 'warn' : s.database !== 'up' ? 'bad' : off.length ? 'warn' : 'ok';
    $('overall').className = `big ${state}`;
    $('overall').textContent = s.maintenance?.on ? '▲ Down for maintenance' : s.database !== 'up' ? '✖ Having problems' : off.length ? '▲ Up, with some features off' : '✔ Everything is working';
    $('message').textContent = s.maintenance?.on ? `${s.maintenance.message || 'Back soon.'}${s.maintenance.until ? ` (back at ${s.maintenance.until})` : ''}` : '';
    parts.push(row('The game\'s server', 'ok', `up (${ms} ms)`), row('Saving progress (database)', s.database === 'up' ? 'ok' : 'bad', s.database === 'up' ? 'up' : 'down'));
    for (const k of off) parts.push(row(k, 'warn', 'switched off for now'));
  }
  $('parts').replaceChildren(...parts);
  $('checked').textContent = `Checked ${new Date().toLocaleTimeString()}.`;
}
check();
setInterval(check, 30_000);
