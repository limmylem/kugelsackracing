// Anonymous play statistics, only with the player's consent (Phase 8 Step 4; docs/ANALYTICS.md). Our own: sent to our
// own server (POST /api/v1/analytics), never to anyone else. Nothing is collected or sent until the player says yes
// (settings.privacy.analytics === true); saying no, or not answering, sends nothing at all.
// What's sent: a random id this browser made for the statistics alone (not the account's, not the device id the
// abuse checks use; the server hashes it again), a session id, the game's version, the kind of device (its graphics
// tier, browser and system, a phone or not, the screen size, the language), and events: the tutorial's steps, the first
// steps, the driving school, quests and tracks started and finished, purchases and repairs (what, never how much
// money a player has), where a player stops, the frame rate now and then, and errors (their message, never a page's
// content). Never a name, email, IP address or where on the map.
//
//   const stats = startAnalytics({ settings, version })
//   stats.track(kind, name, props)    // a no-op without consent
//   stats.consent(true | false)       // the answer (the settings' privacy.analytics); false clears what's waiting
//   askConsent({ t, onAnswer })       // the question, once (a small card, not a wall)

import { t as tr } from './i18n.js';
import { trapFocus } from './accessibility.js';

const ID = 'ognistrada.stats.id';
const KINDS = new Set(['session_start', 'session_end', 'screen', 'tutorial', 'first_step', 'school', 'quest_start', 'quest_end', 'track_start', 'track_end', 'race_end', 'purchase', 'repair', 'perf', 'error', 'quit', 'setting', 'photo', 'share']);
const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');

export function deviceInfo(tier = null) {
  const ua = navigator.userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'other';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'other';
  return { ...(tier ? { tier } : {}), browser, os, mobile: !!globalThis.matchMedia?.('(pointer: coarse)').matches, memory: navigator.deviceMemory, cores: navigator.hardwareConcurrency, screen: `${screen.width}x${screen.height}`, language: navigator.language };
}

export function startAnalytics({ settings, version = globalThis.KR_SITE?.version ?? 'local', base = globalThis.KR_SITE?.api ?? '', flushMs = 20_000, tier = () => null } = {}) {
  let queue = [], timer = null;
  const session = rand(8);
  const allowed = () => settings?.privacy?.analytics === true;
  const anon = () => { try { let id = localStorage.getItem(ID); if (!id) { id = rand(16); localStorage.setItem(ID, id); } return id; } catch { return `s-${session}`; } };
  async function flush({ beacon = false } = {}) {
    clearTimeout(timer); timer = null;
    if (!allowed() || !queue.length) return;
    const events = queue.splice(0, 60);
    const body = JSON.stringify({ consent: true, anon: anon(), session, version, device: deviceInfo(tier()), events });
    const url = `${base}/api/v1/analytics`;
    try {
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      else await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'omit', keepalive: true });
    } catch { /* lost: statistics, not records */ }
    if (queue.length) flush({ beacon });
  }
  const S = {
    track(kind, name = null, props = undefined) {
      if (!allowed() || !KINDS.has(kind)) return;
      queue.push({ kind, ...(name ? { name: String(name).slice(0, 80) } : {}), at: Date.now(), ...(props ? { props } : {}) });
      if (queue.length >= 40) flush(); else timer ??= setTimeout(flush, flushMs);
    },
    consent(on) { if (!on) queue = []; else S.track('session_start'); },
    screen: null,             // (the screen the player is on, set by the game: sent as where they were if they leave)
    flush,
    get allowed() { return allowed(); },
  };
  // (errors: their message and where, never a page's content; the frame rate a minute, as the profiler has it)
  addEventListener('error', e => S.track('error', `${e.message ?? 'error'}`.slice(0, 80), { where: String(e.filename ?? '').split('/').slice(-1)[0], line: e.lineno, fatal: false }));
  addEventListener('unhandledrejection', e => S.track('error', String(e.reason?.message ?? e.reason ?? 'rejection').slice(0, 80), { fatal: false }));
  // (a crash, for a game in a browser: the picture lost — the graphics context gone — or something saying it's fatal)
  addEventListener('webglcontextlost', () => S.track('error', 'WebGL context lost', { fatal: true }), true);
  addEventListener('kr:fatal', e => S.track('error', String(e.detail?.message ?? 'fatal').slice(0, 80), { fatal: true }));
  addEventListener('pagehide', () => { S.track('quit', S.screen); S.track('session_end'); flush({ beacon: true }); });
  S.track('session_start');
  return S;
}

// The question: once, small and plain, with yes and no just as easy (and changeable in Settings → Privacy)
export function askConsent({ t = tr, onAnswer }) {
  const d = document.createElement('div');
  d.className = 'consentCard';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-labelledby', 'consentTitle');
  d.setAttribute('aria-describedby', 'consentText');
  d.innerHTML = `<h2 id="consentTitle">${t('consent.title')}</h2><p id="consentText">${t('consent.text')}</p>
    <p class="small">${t('consent.never')} <a href="/account/privacy.html#statistics" target="_blank" rel="noopener">${t('consent.more')}</a></p>
    <div class="buttons"><button type="button" data-a="yes">${t('consent.yes')}</button><button type="button" data-a="no">${t('consent.no')}</button></div>`;
  document.body.append(d);
  const release = trapFocus(d, { onEscape: () => answer(false) });
  function answer(v) { release(); d.remove(); onAnswer(v); }
  d.addEventListener('click', e => { const b = e.target.closest('button'); if (b) answer(b.dataset.a === 'yes'); });
  return d;
}
