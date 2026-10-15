// Links that open the game straight to something (Phase 8 Step 4; docs/PHOTO_MODE.md "Sharing"): a route or quest, a
// generated track by its code, a time to beat on a track, a meet, a region — shared with the system's share sheet where
// there is one, else copied. The game reads them when it opens (index.html, testtrack/test-scene.js openDeepLink).
//
//   shareLink({ kind: 'track', code })                    → https://ognistrada.com/?track=CODE
//   shareLink({ kind: 'quest', id })                      → …/?quest=ID
//   shareLink({ kind: 'challenge', code, ms, by, carClass })   → …/?track=CODE&beat=93412&by=Ann&class=C
//   shareLink({ kind: 'region', id }) · ({ kind: 'meet', id }) · ({ kind: 'place', lat, lon })
//   readDeepLink(location.search) → the same object, checked (anything else: null)
//   await share({ url, title, text }) → 'shared' | 'copied' | 'shown'

import { t as tr } from './i18n.js';

const TRACK_CODE = /^[0-9A-Za-z]{10,40}$/, ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const base = () => globalThis.KR_SITE?.game ?? globalThis.location?.origin ?? 'https://ognistrada.com';

export function shareLink(L, origin = base()) {
  const u = new URL('/', origin), q = u.searchParams;
  switch (L.kind) {
    case 'track': q.set('track', L.code); break;
    case 'challenge': q.set('track', L.code); q.set('beat', String(Math.round(L.ms))); if (L.by) q.set('by', String(L.by).slice(0, 30)); if (L.carClass) q.set('class', L.carClass); break;
    case 'quest': q.set('quest', L.id); break;
    case 'region': q.set('region', L.id); break;
    case 'meet': q.set('meet', L.id); break;
    case 'place': q.set('at', `${Number(L.lat).toFixed(5)},${Number(L.lon).toFixed(5)}`); break;
    default: throw new Error(`no link for ${L.kind}`);
  }
  return u.toString();
}

export function readDeepLink(search) {
  const q = new URLSearchParams(search);
  const track = q.get('track');
  if (track && TRACK_CODE.test(track)) {
    const ms = Number(q.get('beat'));
    if (q.has('beat') && Number.isFinite(ms) && ms > 1000 && ms < 3600e3) return { kind: 'challenge', code: track, ms, by: (q.get('by') ?? '').replace(/[<>]/g, '').slice(0, 30) || null, carClass: /^[A-Z]$/.test(q.get('class') ?? '') ? q.get('class') : null };
    return { kind: 'track', code: track };
  }
  for (const kind of ['quest', 'region', 'meet']) { const v = q.get(kind); if (v && ID.test(v)) return { kind, id: v }; }
  const at = q.get('at');
  if (at) { const [lat, lon] = at.split(',').map(Number); if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { kind: 'place', lat, lon }; }
  return null;
}

export async function share({ url, title = 'Ogni Strada', text = '' }, { t = tr } = {}) {
  try {
    if (navigator.share) { await navigator.share({ url, title, text }); return 'shared'; }
  } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  try { await navigator.clipboard.writeText(url); return 'copied'; } catch { /* no clipboard: shown to copy by hand */ }
  prompt(t('share.copyThis'), url);
  return 'shown';
}
