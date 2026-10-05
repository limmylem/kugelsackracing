// Finding quests in the game (Phase 4 Step 5): on the full map (Tab) a panel with "Recommended for you",
// filters (type, difficulty, distance, done or not, medal, suits my car), the quests that pass them in
// every baked region, and the regions themselves — each quest can be shown on the map or travelled to
// (fast travel: the game's loading screen holds until its start is in, then its card opens). While free
// roaming, a small notice now and then when passing near a quest not yet played (it can be switched off
// in the settings). The rules are quest/finder.js and data/quests.json finding.
//
//   const F = createQuestFinder({ w, game, content, regions, notices: () => on? })
//     game: questUi's game (player, economy, config, carSummary, carInstanceId, fastTravel(item), regionId)
//   F.frame(dt, carLatLon, busy)   F.dispose()
//   loadAll(service, regions) → every published quest in the baked regions (no cap: tests/quest-stress.mjs, 50,000)

import { worldContent } from '../content/client.js';
import { FILTERS, defaultFilters, filterQuests, recommend, createNotifier, regionOf } from '../quest/finder.js';
import { TYPES } from '../content/quests.js';
import { starsText } from '../quest/difficulty.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEY = 'driveWorld.questFilters';
const CSS = `
#questFinder{margin-top:12px;font:13px/1.4 Barlow,system-ui,sans-serif;color:#f2f4f7}
#questFinder h4{margin:12px 0 4px;font-size:13px;letter-spacing:.05em;text-transform:uppercase;opacity:.8}
#questFinder .filters{display:grid;grid-template-columns:1fr 1fr;gap:4px}
#questFinder select{font:12px Barlow,system-ui,sans-serif;background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px}
#questFinder .q{display:grid;grid-template-columns:1fr auto;gap:2px 6px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08)}
#questFinder .q small{opacity:.75}#questFinder .stars{color:#ffd166}
#questFinder .q button,#questFinder .r button{font:600 11px Barlow,system-ui,sans-serif;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:2px 8px;cursor:pointer;margin-left:3px}
#questFinder .r{display:flex;justify-content:space-between;align-items:center;padding:3px 0}
#questFinder .here{color:#7ee08a}
#questNotice{position:fixed;top:118px;left:50%;transform:translateX(-50%);z-index:43;background:rgba(14,18,26,.86);color:#f2f4f7;border:1px solid rgba(255,209,102,.45);border-radius:10px;padding:7px 14px;font:600 14px Barlow,system-ui,sans-serif;display:none;pointer-events:none}
#questNotice .stars{color:#ffd166}`;

// every published quest in every baked region, however many (each region's bbox, from its middle)
export async function loadAll(service, regions) {
  const seen = new Map();
  for (const r of regions) {
    const [w0, s0, e0, n0] = r.bbox, mid = { lat: (s0 + n0) / 2, lon: (w0 + e0) / 2 }, km = Math.hypot((e0 - w0) * 111 * Math.cos(mid.lat * Math.PI / 180), (n0 - s0) * 111) / 2 + 1;
    for (const { item } of (await service.query({ ...mid, km, view: 'published', offered: true, kinds: ['quest'], limit: Infinity })).items) seen.set(item.id, item);
  }
  return [...seen.values()];
}
// every published race venue in the baked regions (Phase 5 Step 3: fast travel goes to them too)
export async function loadVenues(service, regions) {
  const seen = new Map();
  for (const r of regions) {
    const [w0, s0, e0, n0] = r.bbox, mid = { lat: (s0 + n0) / 2, lon: (w0 + e0) / 2 }, km = Math.hypot((e0 - w0) * 111 * Math.cos(mid.lat * Math.PI / 180), (n0 - s0) * 111) / 2 + 1;
    for (const { item } of (await service.query({ ...mid, km, view: 'published', kinds: ['venue'], limit: Infinity })).items) seen.set(item.id, item);
  }
  return [...seen.values()];
}

export function createQuestFinder({ w, game, content, regions = [], notices = () => true }) {
  if (!document.getElementById('questFinderCss')) { const s = document.createElement('style'); s.id = 'questFinderCss'; s.textContent = CSS; document.head.appendChild(s); }
  let filters = defaultFilters();
  try { filters = { ...filters, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* the defaults */ }
  let all = [], venues = [], counts = new Map(), loadedAt = 0, panel = null, offOpen = null, at = null, tNotice = 0, check = 0;
  const notice = document.createElement('div'); notice.id = 'questNotice'; document.body.appendChild(notice);
  const ctx = () => ({ profile: game.player.profile, car: game.carSummary(game.carInstanceId()), economy: game.economy, config: game.config, at });
  const notifier = createNotifier({ get profile() { return game.player.profile; }, config: game.config });

  // every published quest in every baked region (asked again when the map opens, at most every 20 s)
  async function load() {
    if (performance.now() - loadedAt < 20000 && all.length) return all;
    const service = (await worldContent()).service;
    all = await loadAll(service, regions); loadedAt = performance.now();
    venues = await loadVenues(service, regions).catch(() => []);
    counts = new Map(regions.map(r => [r.id, 0]));
    for (const q of all) { const r = regionOf(q.location, regions); if (r) counts.set(r.id, counts.get(r.id) + 1); }
    return all;
  }

  const row = (x, buttons = true) => {
    const r = regionOf(x.item.location, regions), here = r?.id === game.regionId?.();
    return `<div class="q"><span><b>${esc(x.item.name)}</b> <span class="stars">${starsText(x.terms?.stars ?? x.item.rating?.stars ?? 2)}</span><br><small>${esc(TYPES[x.item.type]?.label ?? x.item.type)} · ${here && x.km != null ? `${x.km < 1 ? `${Math.round(x.km * 1000)} m` : `${x.km.toFixed(1)} km`}` : esc(r?.name ?? 'not baked')}${x.state && x.state !== 'new' ? ` · ${esc(x.state)}` : ' · new'}${x.medal ? ` · ${esc(x.medal)}` : ''}${x.why?.length ? ` · ${esc(x.why.join(', '))}` : ''}</small></span>
      <span>${buttons ? `${here ? `<button data-show="${esc(x.item.id)}">Show</button>` : ''}<button data-go="${esc(x.item.id)}" ${r ? '' : 'disabled'}>Go</button>` : ''}</span></div>`;
  };
  async function render() {
    if (!panel) return;
    const list = await load(), c = ctx();
    const rec = recommend(list, c), shown = filterQuests(list, filters, c);
    const sel = (k, label) => `<label><small>${label}</small><br><select data-filter="${k}">${FILTERS[k].map(v => `<option value="${esc(v)}" ${filters[k] === v ? 'selected' : ''}>${esc(k === 'type' && v !== 'any' ? TYPES[v]?.label ?? v : k === 'stars' && v !== 'any' ? `${v}★` : k === 'distance' && v !== 'any' ? `within ${v} km` : v)}</option>`).join('')}</select></label>`;
    panel.innerHTML = `<h4>Recommended for you</h4>${rec.length ? rec.map(x => row(x)).join('') : '<small>Nothing right now: the filters below show everything.</small>'}
      <h4>Find quests</h4><div class="filters">${sel('type', 'Type')}${sel('stars', 'Difficulty')}${sel('distance', 'Distance')}${sel('status', 'Done')}${sel('medal', 'Medal')}${sel('car', 'Car')}</div>
      <div>${shown.slice(0, 60).map(x => row(x)).join('') || '<small>No quests match.</small>'}${shown.length > 60 ? `<small>…and ${shown.length - 60} more: narrow the filters.</small>` : ''}</div>
      ${venues.length ? `<h4>Race venues</h4>${venues.map(v => { const r = regionOf(v.location, regions); return `<div class="q"><span><b>${esc(v.name)}</b><br><small>${(v.events ?? []).length} event${(v.events ?? []).length === 1 ? '' : 's'} · ${esc(r?.name ?? 'not baked')}</small></span><span>${r?.id === game.regionId?.() ? `<button data-show="${esc(v.id)}">Show</button>` : ''}<button data-go="${esc(v.id)}" ${r ? '' : 'disabled'}>Go</button></span></div>`; }).join('')}` : ''}
      <h4>Regions</h4>${regions.map(r => `<div class="r"><span class="${r.id === game.regionId?.() ? 'here' : ''}">${esc(r.name)}${r.id === game.regionId?.() ? ' · you\'re here' : ''} <small>${counts.get(r.id) ?? 0} quests</small></span>${r.id === game.regionId?.() ? '' : `<button data-region="${esc(r.id)}">Travel</button>`}</div>`).join('')}`;
  }
  function attach() {
    const maps = w.maps;
    if (!maps?.side || offOpen) return;
    panel = document.createElement('div'); panel.id = 'questFinder';
    maps.side.appendChild(panel);
    offOpen = maps.onOpen(on => { if (on) { render(); game.hint?.('fastTravel'); } });
    panel.addEventListener('change', e => { const k = e.target.dataset?.filter; if (!k) return; filters[k] = e.target.value; try { localStorage.setItem(KEY, JSON.stringify(filters)); } catch { /* not kept */ } render(); });
    panel.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const item = [...all, ...venues].find(q => q.id === (b.dataset.go ?? b.dataset.show));
      if (b.dataset.show && item) maps.flyTo(item.location.lat, item.location.lon);
      if (b.dataset.go && item) { maps.close(); game.fastTravel(item); }
      if (b.dataset.region) { maps.close(); game.travelToRegion?.(b.dataset.region); }
    });
  }

  return {
    get quests() { return all; },
    render,
    frame(dt, carLatLon, busy) {
      at = carLatLon;
      if (!panel) attach();
      // the notice: now and then (checked twice a second), shown for a few seconds
      if ((check += dt) > 0.5) {
        check = 0;
        const hit = notices() && !busy ? notifier.check(content?.items ?? [], at, performance.now() / 1000, busy) : null;
        if (hit) {
          const r = hit.item.rating?.stars ?? 2;
          notice.innerHTML = `Quest nearby: <b>${esc(hit.item.name)}</b> <span class="stars">${'★'.repeat(r)}</span> · ${hit.metres} m · ${esc(TYPES[hit.item.type]?.label ?? '')}`;
          notice.style.display = 'block'; tNotice = 5;
        }
      }
      if (tNotice > 0 && (tNotice -= dt) <= 0) notice.style.display = 'none';
      if (busy) { notice.style.display = 'none'; tNotice = 0; }
    },
    dispose() { offOpen?.(); panel?.remove(); notice.remove(); },
  };
}
