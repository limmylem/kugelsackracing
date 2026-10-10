// The world editor (Phase 4 Steps 1 and 2): a mode of its own over the game (F2), for placing world content —
// quest starts, points of interest, spawn points — anywhere on Earth and filling in their details, and for
// drawing routes on the region's real roads (editor/routeTool.js: the route tool, 4) and test-driving them.
//
//   - Two views of the same content: the map (editor/mapView.js — anywhere on Earth) and 3D
//     (editor/worldView.js — a free-flying camera over the baked world the game drives in). M switches.
//   - Tools along the top: select (V), place a quest start (1), a point of interest (2), a spawn point
//     (3), draw a route (4); snap to the nearest road (N), facing along it; undo / redo; publish; import / export; find a
//     place (or type coordinates); bookmarks.
//   - Left: the content round the camera. Right: the selected item's properties, and what it still
//     needs in plain words (errors stop publishing).
//   - Select by clicking; drag the selected marker to move it; [ ] turn it (Shift: a degree at a time);
//     Ctrl+D duplicate; Delete; Ctrl+Z / Ctrl+Shift+Z undo / redo.
//
// Every change goes through the world content service (content/service.js: kept as drafts as they're
// made; the game only sees what's published) and the history (content/history.js: every action undoes).
// Entering pauses play (testtrack/test-scene.js editorPause); leaving carries on where it was.
//
//   const E = createEditor({ game })   E.toggle() / E.enter() / E.exit()   E.active

import * as THREE from 'three';
import { worldContent, localStorageGet, localStorageSet } from '../content/client.js';
import { createHistory } from '../content/history.js';
import { newItem, withType, rewardsOf, KINDS, TYPES, TYPE_IDS, TIMES, WEATHER, RIVAL_TYPES } from '../content/quests.js';
// track events at race venues (Phase 5 Step 3): the designer, a track event's panel, its AI test race
import { newDesigner, rollSeed, previewTrack, designerPanel, newEventFrom, trackSection, runTrackAiTest } from './trackEvent.js';
import { THEMES } from '../track/code.js';
import { medalTargets } from '../quest/rules.js';
import { seriesBonus } from '../garage/player/quests.js';
import { applyTemplate } from '../content/templates.js';
import { validateAll } from '../content/bulk.js';
import { suggestRoutes } from '../route/suggest.js';
import { offset } from '../content/geo.js';
import { createRoadFinder } from './roads.js';
import { createMapView } from './mapView.js';
import { createWorldView } from './worldView.js';
import { findPlaces, bookmarks } from './search.js';
import { editorAccessNow } from './access.js';
import { createRouteTool } from './routeTool.js';
import { assetUrl } from '../site/urls.js';

const REGION = 'assets/map/sf/manifest.json';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) a = a[k] ??= {}; a[ks.at(-1)] = v; return o; };
const wrap360 = d => Math.round((((d % 360) + 360) % 360) * 10) / 10 % 360;
const sameContent = (a, b) => { if (!a || !b) return false; const strip = x => ({ ...x, status: 0, publishedAt: 0, updated: 0 }); return JSON.stringify(strip(a)) === JSON.stringify(strip(b)); };
const fmtLL = l => `${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}`;

export function createEditor({ game }) {
  let C = null, H = null, roads = null, region = null, mapView = null, worldView = null, root = null, ui = {};
  let active = false, view = 'map', tool = 'select', snap = localStorageGet('kugelsack.editor.snap') !== 'off', selected = null, current = null, published = null;
  let items = [], publishedById = new Map(), showArchived = false, filter = 'all', picking = null, lastType = 'sprint', roadNote = null, typing = null, refreshTimer = null, rafId = 0, lastT = 0, loading = null;
  let questRoute;            // the selected quest's route item (null: none by its id; undefined: not looked up)
  let npcCfg = null, npcLoading = null;   // data/npc.json (the rivals' roster and settings)
  let td = null, tracksCfg = null, trackAiBusy = false;   // the track-event designer (at a venue), data/tracks.json
  const loadTracksCfg = async () => tracksCfg ??= await (await fetch('data/tracks.json', { cache: 'no-cache' })).json();
  const loadNpcCfg = () => npcLoading ??= fetch('data/npc.json', { cache: 'no-cache' }).then(r => r.json()).then(j => { npcCfg = j; return j; });
  // the route tool: drawn on the map and in 3D, its edits through edit() like every other
  const routeTool = createRouteTool({ THREE, api: {
    regionManifest: () => region, regionBase: () => new URL(REGION, document.baseURI).href,
    flash: (t, bad) => flash(t, bad), renderProps: () => renderProps(),
    editCourse: (label, fn, opts) => editCourse(label, fn, opts),
    testDrive: (it, o) => testDrive(it, o),
    cars: () => C?.cars ?? {},
  } });

  // ---------- setting up (once) ----------
  async function ready() {
    if (C) return;
    C = await worldContent();
    H = createHistory(C.service);
    H.on(() => renderTop());
    region = await (await fetch(REGION, { cache: 'no-cache' })).json().catch(() => null);
    roads = createRoadFinder({ regions: region ? [{ manifestUrl: new URL(assetUrl(REGION), document.baseURI).href }] : [] });
    C.service.on(ev => { if (active) { scheduleRefresh(); if (ev.id && ev.id === selected) loadSelected(); } saving(); });
    build();
  }

  function build() {
    if (!document.getElementById('editorCss')) { const l = document.createElement('link'); l.id = 'editorCss'; l.rel = 'stylesheet'; l.crossOrigin = 'use-credentials'; l.href = new URL('./editor.css', import.meta.url).href; document.head.appendChild(l); }
    const mapEl = document.createElement('div'); mapEl.id = 'edMap'; document.body.appendChild(mapEl);
    root = document.createElement('div'); root.id = 'editor'; root.style.display = 'none';
    root.innerHTML = `
      <div class="ed-frame"></div><div class="ed-banner">EDITOR MODE · PLAY PAUSED · F2 TO LEAVE</div>
      <div id="edTop" class="ed-panel"></div>
      <div id="edLeft" class="ed-panel"><header>In this area <span id="edCount" class="hint"></span></header><div class="filters"></div><div id="edList"></div></div>
      <div id="edRight" class="ed-panel"></div>
      <div id="edStatus" class="ed-panel"><span id="edSave" class="saved">All changes saved</span><span id="edHist"></span><span class="tip" id="edTip"></span></div>
      <div id="edPickNote"></div><div id="edToast"></div>`;
    document.body.appendChild(root);
    ui = { map: mapEl, top: root.querySelector('#edTop'), list: root.querySelector('#edList'), filters: root.querySelector('#edLeft .filters'), count: root.querySelector('#edCount'), right: root.querySelector('#edRight'), save: root.querySelector('#edSave'), hist: root.querySelector('#edHist'), tip: root.querySelector('#edTip'), pick: root.querySelector('#edPickNote'), toast: root.querySelector('#edToast') };
    ui.right.addEventListener('change', onField);
    ui.right.addEventListener('input', onTyping);
    ui.right.addEventListener('click', onRightClick);
    addEventListener('keydown', onKey, true);
    addEventListener('beforeunload', e => { if (C?.service.pending || typing) { e.preventDefault(); e.returnValue = 'Unsaved editor changes'; } });
    // (the page going away or hidden: save what's waiting, as far as there's time to)
    addEventListener('pagehide', () => { commitTyping(); C?.service.flush(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { commitTyping(); C?.service.flush(); } });
    renderFilters();
  }

  // ---------- entering and leaving ----------
  async function enter() {
    const a = await editorAccessNow();
    if (!a.allowed) { flash(a.why, true); return false; }
    if (active || loading) return true;
    loading = (async () => {
      await ready();
      const w = await game.ensureRealWorld();
      game.pause(true);
      active = true;
      document.body.classList.add('editor-on');
      root.style.display = '';
      if (w?.stream && !worldView) { worldView = createWorldView({ THREE, world: w, canvas: game.canvas() }); routeTool.attachWorld(worldView, w.stream); }
      if (worldView) game.hooks.camera = worldView.camera;
      game.hooks.frame = (_w, dt) => { if (view === '3d' && worldView) worldView.frame(dt); };
      // (the map view comes in the background when there's a 3D view to start in)
      const mapReady = mapNow();
      if (!worldView) await mapReady;
      setView(worldView ? '3d' : 'map');
      ui.tip.textContent = `${a.how === 'editor flag' ? 'Editor flag on' : 'Development build'} · ${C.persistent ? 'saved in this browser' : 'not kept after closing (no IndexedDB)'}`;
      cancelAnimationFrame(rafId); lastT = performance.now(); rafId = requestAnimationFrame(tick);
      renderTop(); scheduleRefresh(); renderProps();
    })();
    try { await loading; } finally { loading = null; }
    return true;
  }
  let mapMaking = null;
  function mapNow() {
    if (mapView) return Promise.resolve(mapView);
    return mapMaking ??= (async () => {
      try {
        const start = worldView ? { ...worldView.where(), zoom: 16 } : null;
        mapView = await createMapView({ container: ui.map, regionManifest: region, regionBase: new URL(REGION, document.baseURI).href, start, onClick: onMapClick, onPick: id => pickItem(id), onDrag: (id, at, done) => dragTo(id, at, done), onMove: scheduleRefresh });
        mapView.show(active && view === 'map');
        routeTool.attachMap(mapView.map);
        if (!mapView.world) flash('The world map can\'t be reached: showing the baked region\'s own map. Search by coordinates still works anywhere.');
        scheduleRefresh();
      } catch (e) { console.error(e); flash(`No map view: ${e.message}`, true); }
      mapMaking = null;
      return mapView;
    })();
  }
  async function exit({ quiet = false } = {}) {
    if (!active) return;
    await commitTyping();
    await C.service.flush();
    active = false; picking = null;
    cancelAnimationFrame(rafId);
    root.style.display = 'none'; ui.map.style.display = 'none';
    document.body.classList.remove('editor-on');
    game.hooks.frame = null; game.hooks.camera = null; game.hooks.hidden = false;
    routeTool.attachWorld(null); worldView?.dispose(); worldView = null;
    const unpublished = items.filter(x => x.item.status === 'draft' || (publishedById.has(x.item.id) && !sameContent(x.item, publishedById.get(x.item.id)))).length;
    game.pause(false);
    if (unpublished && !quiet) flash(`${unpublished} item${unpublished > 1 ? 's' : ''} here ${unpublished > 1 ? 'have' : 'has'} changes not yet published (kept as drafts).`);
  }
  const toggle = () => active ? exit() : enter();

  function tick(t) {
    if (!active) return;
    const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
    if (view === 'map') mapView?.frame(dt);
    // the 3D view: the list follows the camera (now and then)
    if (view === '3d' && worldView && (t % 1000) < 17) scheduleRefresh();
    const at = view === '3d' && worldView ? worldView.where() : mapView?.where();
    if (at) ui.top.querySelector('#edWhere').textContent = `${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}${view === '3d' ? ` · ${Math.round(at.alt)} m · ${worldView.speed.toFixed(0)} m/s` : ` · z${at.zoom.toFixed(1)}`}`;
    rafId = requestAnimationFrame(tick);
  }

  function setView(v) {
    if (v === '3d' && !worldView) { flash('The 3D view is the baked world (San Francisco for now): use the map view elsewhere.', true); v = 'map'; }
    if (v === 'map' && !mapView) { flash('The map is loading…'); mapNow().then(m => { if (m && active) setView('map'); }); return; }
    // (the same place in the other view)
    if (v === '3d' && view === 'map' && mapView) { const m = mapView.where(); if (worldView.covers(m.lat, m.lon)) worldView.lookAt(m.lat, m.lon); }
    if (v === 'map' && view === '3d' && worldView && mapView) { const w = worldView.where(); mapView.jumpTo(w.lat, w.lon, 16.5); }
    view = v;
    mapView?.show(v === 'map');
    game.hooks.hidden = v === 'map';
    const canvas = game.canvas();
    if (canvas) canvas.style.cursor = v === '3d' ? 'crosshair' : '';
    renderTop(); scheduleRefresh();
  }

  // ---------- the toolbar ----------
  function renderTop() {
    if (!ui.top) return;
    const t = (id, label, key) => `<button data-tool="${id}" class="${tool === id ? 'on' : ''}" title="${label} (${key})">${label}<kbd>${key}</kbd></button>`;
    const sel = current && current.status !== 'archived';
    ui.top.innerHTML = `
      <button data-view="map" class="${view === 'map' ? 'on' : ''}" title="The whole Earth (M)">Map</button><button data-view="3d" class="${view === '3d' ? 'on' : ''}" ${worldView ? '' : 'disabled'} title="The baked world in 3D (M)">3D</button>
      <span class="sep"></span>${t('select', 'Select', 'V')}${t('quest', 'Quest start', '1')}${t('poi', 'Point of interest', '2')}${t('spawn', 'Spawn point', '3')}${t('route', 'Route', '4')}${t('series', 'Series', '5')}${t('venue', 'Race venue', '6')}${t('meet', 'Meet spot', '7')}
      <button data-act="snap" class="${snap ? 'on' : ''}" title="Snap to the nearest road, facing along it (N)">Snap to road<kbd>N</kbd></button>
      <span class="sep"></span>
      <button data-act="undo" ${H?.canUndo ? '' : 'disabled'} title="${esc(H?.undoLabel ? `Undo ${H.undoLabel}` : 'Nothing to undo')} (Ctrl+Z)">↶ Undo</button>
      <button data-act="redo" ${H?.canRedo ? '' : 'disabled'} title="${esc(H?.redoLabel ? `Redo ${H.redoLabel}` : 'Nothing to redo')} (Ctrl+Shift+Z)">↷ Redo</button>
      <span class="sep"></span>
      <button data-act="publish" class="go" ${sel ? '' : 'disabled'} title="Publish the selected item: players see it">Publish</button>
      <button data-act="suggest" title="Good racing roads near here, from the road graph: make them into draft routes and quests">Suggest routes</button><button data-act="checkAll" title="Check every quest, route and series again (after a rebake or a rules change)">Check everything</button>
      <button data-act="export" title="Save content as a JSON file">Export ▾</button><button data-act="import" title="Load content from a JSON file">Import</button>
      <span class="sep"></span>
      <input id="edSearch" placeholder="Find a place, or lat, lon…" autocomplete="off"><button data-act="bookmarks" title="Bookmarks">★ ▾</button>
      <span id="edWhere"></span>
      <button data-act="exit" class="warn" title="Back to play (F2)">Leave editor<kbd>F2</kbd></button>`;
    ui.top.onclick = onTopClick;
    ui.top.querySelector('#edSearch').onkeydown = e => { if (e.key === 'Enter') search(e.target.value, e.target); if (e.key === 'Escape') e.target.blur(); };
    ui.hist.textContent = H?.undoLabel ? `Last: ${H.undoLabel}` : '';
    // (the panels start under the toolbar, however many rows it wraps to)
    root.style.setProperty('--edTop', `${ui.top.offsetTop + ui.top.offsetHeight + 8}px`);
  }
  async function onTopClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    b.blur();
    if (b.dataset.view) return setView(b.dataset.view);
    if (b.dataset.tool) return setTool(b.dataset.tool);
    const act = b.dataset.act;
    if (act === 'snap') { snap = !snap; localStorageSet('kugelsack.editor.snap', snap ? 'on' : 'off'); renderTop(); }
    else if (act === 'undo') undo(); else if (act === 'redo') redo();
    else if (act === 'publish') publish();
    else if (act === 'export') menu(b, [
      { label: 'This area', detail: 'everything within the view', fn: () => exportContent('area') },
      { label: 'Everything', detail: 'all content, drafts, published and archived', fn: () => exportContent('all') },
      { label: 'Published only', detail: 'what players see', fn: () => exportContent('published') },
    ]);
    else if (act === 'import') importContent();
    else if (act === 'suggest') suggestHere();
    else if (act === 'checkAll') checkEverything();
    else if (act === 'bookmarks') bookmarkMenu(b);
    else if (act === 'exit') exit();
  }
  function setTool(t) {
    tool = t; picking = null; ui.pick.style.display = 'none'; renderTop();
    ui.tip.textContent = t === 'select' ? 'Click a marker to select it; drag the selected one to move it'
      : t === 'route' ? (current?.kind === 'route' ? `Click the ${view === '3d' ? 'world' : 'map'} to add waypoints to "${current.name}"; drag them on the map; L locks a road` : `Click the ${view === '3d' ? 'world' : 'map'} where a new route starts, then click on along it`)
      : `Click the ${view === '3d' ? 'world' : 'map'} to place a ${KINDS[t].label.toLowerCase()}${snap ? ' (snapped to the nearest road)' : ''}`;
  }

  // ---------- the area's content ----------
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); }
  async function refresh() {
    if (!active || !C) return;
    const at = view === '3d' && worldView ? { ...worldView.where(), km: 3 } : mapView?.where();
    if (!at) return;
    const km = Math.max(0.3, Math.min(view === '3d' ? 3 : 80, at.km));
    const [d, p, a] = await Promise.all([C.service.query({ lat: at.lat, lon: at.lon, km, view: 'draft', limit: 4000 }), C.service.query({ lat: at.lat, lon: at.lon, km, view: 'published', limit: 4000 }), showArchived ? C.service.query({ lat: at.lat, lon: at.lon, km, view: 'archived', limit: 1000 }) : { items: [] }]);
    publishedById = new Map(p.items.map(x => [x.item.id, x.item]));
    items = [...d.items, ...a.items];
    renderList();
    const shown = items.filter(x => filter === 'all' || x.item.kind === filter).map(x => x.item);
    mapView?.setItems(shown.map(it => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [it.location.lon, it.location.lat] }, properties: { id: it.id, kind: it.kind, name: it.name, status: it.status, selected: it.id === selected } })), selected);
    worldView?.setItems(shown); worldView?.select(selected);
  }
  function renderFilters() {
    ui.filters.innerHTML = ['all', 'quest', 'series', 'venue', 'meet', 'route', 'poi', 'spawn'].map(f => `<button data-f="${f}" class="${filter === f ? 'on' : ''}">${f === 'all' ? 'All' : KINDS[f].label}</button>`).join('') + `<label style="font-size:11px;margin-left:4px"><input type="checkbox" id="edArch" ${showArchived ? 'checked' : ''}> archived</label>`;
    ui.filters.onclick = e => { const b = e.target.closest('button'); if (b) { filter = b.dataset.f; renderFilters(); refresh(); } };
    ui.filters.querySelector('#edArch').onchange = e => { showArchived = e.target.checked; refresh(); };
  }
  function badge(it) {
    if (it.status === 'archived') return '<span class="ed-badge archived">archived</span>';
    const pub = publishedById.get(it.id);
    if (!pub) return '<span class="ed-badge draft">draft</span>';
    return sameContent(it, pub) ? '<span class="ed-badge published">live</span>' : '<span class="ed-badge changed">changed</span>';
  }
  function renderList() {
    const list = items.filter(x => filter === 'all' || x.item.kind === filter);
    ui.count.textContent = `(${list.length}${list.length >= 4000 ? '+' : ''})`;
    ui.list.innerHTML = list.slice(0, 400).map(({ item: it, km }) => `<div class="row ${it.id === selected ? 'sel' : ''}" data-id="${esc(it.id)}"><span class="dot" style="background:${KINDS[it.kind]?.colour ?? '#ccc'}"></span><span class="name">${esc(it.name || '(no name)')}<br><span class="meta">${esc(it.kind === 'quest' ? TYPES[it.type]?.label ?? it.type : KINDS[it.kind].label)} · ${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}</span></span>${badge(it)}</div>`).join('') || '<div class="hint" style="padding:8px">Nothing here yet. Pick a tool (1, 2, 3) and click to place something.</div>';
    ui.list.onclick = e => { const r = e.target.closest('.row'); if (r) { pickItem(r.dataset.id); const it = items.find(x => x.item.id === r.dataset.id)?.item; if (it) focusOn(it.location); } };
  }
  function focusOn(loc) {
    if (view === '3d' && worldView?.covers(loc.lat, loc.lon)) worldView.lookAt(loc.lat, loc.lon, loc.alt);
    else { if (view === '3d') setView('map'); mapView?.flyTo(loc.lat, loc.lon, Math.max(mapView.where().zoom, 16)); }
  }

  // ---------- selecting ----------
  async function pickItem(id) {
    if (picking) return;
    await commitTyping();
    selected = id; tool = 'select';
    await loadSelected();
    renderTop(); refresh();
  }
  async function loadSelected() {
    if (!selected) { current = null; published = null; renderProps(); return; }
    const [d, p, a] = await Promise.all([C.service.get(selected), C.service.get(selected, { view: 'published' }), C.service.get(selected, { view: 'archived' })]);
    current = d.item ?? a.item; published = p.item;
    if (!current) { selected = null; }
    roadNote = null;
    // (a quest's route: looked up for its checks and shown faintly on the map)
    questRoute = undefined;
    if (current?.kind === 'quest' && current.route) questRoute = (await C.service.get(current.route)).item ?? (await C.service.get(current.route, { view: 'published' })).item ?? null;
    routeTool.show(current, questRoute);
    renderProps();
    // which road it's on, and the nearest intersection (asked of the road data, not stored unless snapped)
    if (current && !current.road) { const id = current.id, r = await roads.describe(current.location.lat, current.location.lon); if (current?.id === id) { roadNote = r; renderRoad(); } }
  }
  function deselect() { selected = null; current = null; published = null; questRoute = undefined; routeTool.show(null); renderProps(); refresh(); }

  // ---------- the properties panel ----------
  const input = (path, value, type = 'text', extra = '') => `<input data-field="${path}" type="${type}" value="${esc(value ?? '')}" ${extra}>`;
  const num = (path, value, extra = '') => input(path, value, 'number', `step="any" ${extra}`);
  const select = (path, value, options) => `<select data-field="${path}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  function renderProps() {
    if (!ui.right) return;
    if (toolsPanel && !current) return renderToolsPanel();
    const it = current;
    if (!it) { ui.right.innerHTML = `<h3>Nothing selected</h3><p class="hint">Pick a tool along the top — <b>1</b> a quest start, <b>2</b> a point of interest, <b>3</b> a spawn point — and click the ${view === '3d' ? 'world' : 'map'} to place one. Click a marker to select it.</p><p class="hint">Find any place on Earth with the search box (or type <i>lat, lon</i>). The 3D view (M) flies over the baked world: <b>W A S D</b>, <b>Q / E</b> down and up, right-drag to look, the wheel for speed.</p>`; return; }
    const archived = it.status === 'archived', pub = published, changed = pub && !sameContent(it, pub);
    const problems = C.check(it, it.kind === 'quest' && it.route && questRoute !== undefined ? { route: questRoute } : {}), errors = problems.filter(p => p.level === 'error');
    const L = it.location;
    let html = `<h3>${esc(KINDS[it.kind].label)} ${archived ? '<span class="ed-badge archived">archived</span>' : !pub ? '<span class="ed-badge draft">draft</span>' : changed ? '<span class="ed-badge changed">changed since published</span>' : '<span class="ed-badge published">published</span>'}</h3>
      <div class="hint">${esc(it.id)} · by ${esc(it.author)} · edited ${esc(new Date(it.updated).toLocaleString())}${pub ? ` · published ${esc(new Date(pub.publishedAt).toLocaleString())}` : ''}</div>
      <fieldset ${archived ? 'disabled' : ''} style="border:0;padding:0;margin:0">
      <label>Name</label>${input('name', it.name, 'text', 'maxlength="80"')}
      <label>Description</label><textarea data-field="description" rows="2" maxlength="2000">${esc(it.description ?? '')}</textarea>
      ${it.kind === 'route' ? `<div class="hint" style="margin-top:6px">Its place on the map is its start line (${esc(fmtLL(L))}).</div>` : `<div class="section"><b>Place</b>
        <div class="row2"><div><label>Latitude</label>${num('location.lat', L.lat.toFixed(7))}</div><div><label>Longitude</label>${num('location.lon', L.lon.toFixed(7))}</div></div>
        <div class="row2"><div><label>Height (m above sea level)</label>${num('location.alt', L.alt)}</div><div><label>Facing (° from north)</label>${num('location.heading', L.heading, 'min="0" max="359.9"')}</div></div>
        <div class="hint">Height from ${esc({ road: 'the road surface', ground: 'the ground (3D view)', terrain: 'the map\'s terrain', estimate: 'nothing: a guess' }[L.altFrom] ?? 'what was there')}.</div>
        <div id="edRoad"></div>
        <div class="actions"><button data-act="snapNow">Snap to road</button><button data-act="faceRoad">Face along road</button><button data-act="turnL">⟲ 15°</button><button data-act="turnR">⟳ 15°</button><button data-act="goto">Show</button></div>
      </div>`}`;
    if (it.kind === 'quest') html += questFields(it);
    if (it.kind === 'route') html += routeTool.panel(it);
    if (it.kind === 'series') html += seriesFields(it);
    if (it.kind === 'venue') html += venueFields(it);
    if (it.kind === 'meet') html += meetFields(it);
    html += `</fieldset><div id="edProblems">${problems.length ? problems.map(p => `<div class="p ${p.level}" data-goto="${esc(p.field)}">${p.level === 'error' ? '✖' : '⚠'} ${esc(p.message)}</div>`).join('') : '<div class="ok">✔ Ready to publish.</div>'}</div>
      <div class="actions">${archived ? '<button data-act="restore" class="go">Restore as a draft</button>' : `<button data-act="publish" class="go" ${errors.length ? 'disabled title="Fix the errors first"' : ''}>${pub ? (changed ? 'Publish changes' : 'Published ✔') : 'Publish'}</button>${pub ? '<button data-act="unpublish">Unpublish</button>' : ''}<button data-act="duplicate">Duplicate <kbd>Ctrl+D</kbd></button><button data-act="delete" class="warn">${pub ? 'Archive' : 'Delete'} <kbd>Del</kbd></button>`}</div>`;
    ui.right.innerHTML = html;
    for (const p of errors) ui.right.querySelector(`[data-field="${CSS.escape(p.field)}"]`)?.classList.add('field-error');
    renderRoad();
  }
  // A race venue (Phase 5 Step 3): its track events (driving up to it in the game lists them), and the
  // track-event designer — a preset, a theme, a seed (roll on until it's right), previewed, test-driven,
  // named and made into an event here
  // A meet spot (Phase 7 Step 4): its parking — how many places and how many to a row, laid out from the marker
  // facing its heading (snap it to the car park and face it along the bays). Scheduled meets are made on the admin page.
  function meetFields(it) {
    const m = it.meet ?? { spots: 24, perRow: 8 };
    return `<div class="section"><b>Parking</b><div class="row2"><div><label>Spots</label>${num('meet.spots', m.spots, 'min="2" max="200" step="1"')}</div><div><label>Spots a row</label>${num('meet.perRow', m.perRow, 'min="1" max="20" step="1"')}</div></div>
      <div class="hint">Rows of ${esc(m.perRow)} facing the marker's heading (alternate rows face each other across the aisle). Players near the meet park in the nearest free spot; scheduled meet events are made on the admin page.</div></div>`;
  }
  function venueFields(it) {
    const near = new Map(items.map(x => [x.item.id, x.item]));
    const evs = (it.events ?? []).map(id => near.get(id) ?? { id, name: `${id} (not loaded)`, missing: true });
    let h = `<div class="section"><b>Track events (${evs.length})</b>
      ${evs.map((q, k) => `<div class="row2"><span class="hint">${k + 1}. ${esc(q.name)}${q.missing ? '' : ` · ${esc(TYPES[q.type]?.label ?? q.type)} · ${esc(q.track?.name ?? '')}${q.track?.check?.aiFinished ? ' · AI ✔' : ' · AI test to run'}${publishedById.has(q.id) ? ' · live' : ' · draft'}`}</span><span><button data-ev="open" data-k="${k}">Open</button><button data-ev="up" data-k="${k}" ${k ? '' : 'disabled'}>↑</button><button data-ev="remove" data-k="${k}">Remove</button></span></div>`).join('') || '<div class="hint">None yet.</div>'}
      ${td ? '' : '<div class="actions"><button data-act="tdOpen" class="go">Create a track event…</button></div>'}</div>`;
    if (td) h += tracksCfg ? designerPanel(td, { presets: tracksCfg.presets, themes: THEMES, esc }) : (loadTracksCfg().then(() => renderProps()), '<div class="hint">Loading…</div>');
    return h + '<div class="hint">Publish each event as well as the venue: players see the published ones on the venue\'s card.</div>';
  }
  async function createTrackEvent() {
    if (!td?.code || current?.kind !== 'venue') return;
    const venue = current, item = newEventFrom(td, { venue });
    const r = await H.run(`Track event — ${item.name}`, [], () => C.service.create(item));
    if (!r.ok) return flash(r.error, true);
    const fresh = (await C.service.get(venue.id)).item;
    await H.run(`Attach ${r.item.name}`, [venue.id], () => C.service.update(venue.id, { ...fresh, events: [...(fresh.events ?? []), r.item.id] }));
    td = null;
    flash(`Made ${r.item.name}: run its AI test race, then publish it.`);
    pickItem(r.item.id);
  }
  // the AI test race on a track event's track (editor/trackEvent.js): its check, hash, rating and reference
  // times kept with it (one undoable step)
  async function runTrackTest(fast) {
    if (trackAiBusy || !current?.track) return;
    trackAiBusy = true; renderProps();
    const id = current.id, say = html => { const el = ui.right?.querySelector('#edAiTest'); if (el && current?.id === id) el.innerHTML = html; };
    try {
      const out = await runTrackAiTest({ item: clone(current), fast, onUpdate: u => say(`<div class="hint">${esc(u.text)}${u.spots ? ` · ${u.spots} problem spot${u.spots > 1 ? 's' : ''}` : ''}</div>`) });
      const fresh = (await C.service.get(id)).item;
      await H.run(`AI test race — ${fresh.name}`, [id], () => C.service.update(id, { ...fresh, track: { ...fresh.track, check: out.check, hash: out.hash }, rating: out.rating ?? fresh.rating }));
      flash(out.check.aiFinished && out.check.trackOk ? 'AI test race done: the AI finished it.' : 'AI test race done: see the problems.', !(out.check.aiFinished && out.check.trackOk));
    } catch (e) { flash(`The AI test race failed: ${e.message}`, true); console.error(e); }
    finally { trackAiBusy = false; if (current?.id === id) loadSelected(); }
  }
  // A quest series (Phase 4 Step 5): 3–6 quests near it, in order; finishing them all pays a bonus
  // (data/economy.json series). Quests are added from those near it (the list on the left), and must be
  // published for players to see the series.
  function seriesFields(it) {
    const near = items.map(x => x.item).filter(q => q.kind === 'quest' && q.status !== 'archived');
    const byId = Object.fromEntries(near.map(q => [q.id, q])), mine = (it.quests ?? []).map(id => byId[id] ?? { id, name: `${id} (not near)`, missing: true });
    const B = seriesBonus({ item: it, quests: mine.filter(q => !q.missing) }, C.economy), cur = C.economy.currency ?? '$';
    const choices = near.filter(q => !(it.quests ?? []).includes(q.id));
    return `<div class="section"><b>Quests in the series (${mine.length}, 3–6)</b>
      ${mine.map((q, k) => `<div class="row2"><span class="hint">${k + 1}. ${esc(q.name)}${q.missing ? '' : ` · ${'★'.repeat(rewardsOf(q, C.economy).stars ?? 2)}`}${q.status === 'draft' ? ' · draft' : ''}</span><span><button data-sq="up" data-k="${k}" ${k ? '' : 'disabled'}>↑</button><button data-sq="remove" data-k="${k}">Remove</button></span></div>`).join('') || '<div class="hint">None yet.</div>'}
      ${(it.quests ?? []).length < 6 ? `<label>Add a quest near it</label>${select('_seriesAdd', '', [['', '— choose —'], ...choices.map(q => [q.id, `${q.name} · ${TYPES[q.type]?.label ?? q.type}`])])}` : ''}
      <div class="money">Bonus for finishing them all: ${esc(cur)}${B.money.toLocaleString('en-GB')} · ${B.xp} xp</div>
      <div class="hint">Half of what the quests' gold medals pay, together (data/economy.json series). Players see the series on its quests' cards.</div></div>`;
  }
  function questFields(it) {
    const T = TYPES[it.type], r = rewardsOf(it, C.economy), cur = C.economy.currency ?? '$', E = it.entry;
    // (a template: its type, rivals and fields in one go — loaded the first time it's needed)
    const tplSelect = templates ? `<label>Apply a template</label>${select('_template', '', [['', '— choose —'], ...templates.map(t => [t.id, t.name])])}` : (loadTemplates().then(() => renderProps()), '');
    // (the medal times it gets with no times of its own: the AI's, else the route's estimate)
    const medalsNow = questRoute?.course && C.quests ? medalTargets({ ...it, params: { ...it.params, medalTimes: null } }, { ...questRoute.course, loop: questRoute.course.kind === 'loop' }, C.quests) : null;
    let h = `<div class="section"><b>Quest</b>
      <label>Type</label>${select('type', it.type, TYPE_IDS.map(t => [t, TYPES[t].label]))}<div class="hint">${esc(T.blurb)}</div>`;
    for (const f of T.fields) {
      const v = getPath(it.params, f.key), path = `params.${f.key}`;
      h += `<label>${esc(f.label)}</label>`;
      if (f.kind === 'place') h += `<div class="row2"><span class="hint">${v ? esc(fmtLL(v)) : 'not set'}</span><span><button data-pick="${path}">Pick on ${view === '3d' ? 'world' : 'map'}</button>${v ? ` <button data-clear="${path}">Clear</button>` : ''}</span></div>`;
      else if (f.kind === 'places') h += `${(v ?? []).map((p, k) => `<div class="row2"><span class="hint">${k + 1}. ${esc(fmtLL(p))}</span><span><button data-remove="${path}" data-k="${k}">Remove</button></span></div>`).join('')}<button data-pick="${path}" data-append="1">Add one (pick on ${view === '3d' ? 'world' : 'map'})</button>`;
      else if (f.kind === 'bool') h += `<input type="checkbox" data-field="${path}" ${v ? 'checked' : ''}>`;
      else if (f.kind === 'car') h += select(path, v ?? '', [['', '— choose a car —'], ...Object.entries(C.cars).map(([id, c]) => [id, c.name])]);
      else if (f.kind === 'text') h += input(path, v);
      else if (f.kind === 'choice') h += select(path, v ?? f.options[0], f.options.map(o => [o, o.replace(/_/g, ' ')]));
      else h += num(path, v ?? '', `${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}`);
    }
    const routes = items.map(x => x.item).filter(r => r.kind === 'route' && r.status !== 'archived');
    if (it.route && !routes.some(r => r.id === it.route)) routes.unshift(questRoute ?? { id: it.route, name: `${it.route} (not near)` });
    h += tplSelect;
    // (a track event: its generated track in place of a route — editor/trackEvent.js)
    if (it.track) h += `</div>${trackSection(it, { esc, busy: trackAiBusy })}<div style="display:none">`;
    h += `<label>Route</label>${select('route', it.route ?? '', [['', '— none —'], ...routes.map(r => [r.id, `${r.name}${r.course ? ` · ${r.course.kind === 'loop' ? 'loop' : 'A to B'} · ${((r.course.length ?? 0) / 1000).toFixed(1)} km` : ''}`])])}
      <div class="hint">${questRoute ? `${esc(questRoute.name)}: ${questRoute.course?.kind === 'loop' ? 'a loop' : 'point to point'}, ${((questRoute.course?.length ?? 0) / 1000).toFixed(2)} km (faint on the map). <button data-act="openRoute">Open the route</button>` : 'Draw one with the route tool (4), then pick it here. One route can serve several quests.'}</div></div>
      <div class="section"><b>Entry</b>
        <label>Car classes (none ticked: any)</label><div>${C.classes.map(c => `<label style="display:inline;margin-right:8px;text-transform:none"><input type="checkbox" data-class="${c.class}" ${E.classes?.includes(c.class) ? 'checked' : ''}> ${c.class}</label>`).join('')}</div>
        <div class="row2"><div><label>Max power (kW)</label>${num('entry.maxPowerKw', E.maxPowerKw ?? '')}</div><div><label>Max kW / tonne</label>${num('entry.maxKwPerTonne', E.maxKwPerTonne ?? '')}</div></div>
        <div class="row2"><div><label>Min weight (kg)</label>${num('entry.minWeightKg', E.minWeightKg ?? '')}</div><div><label>Max weight (kg)</label>${num('entry.maxWeightKg', E.maxWeightKg ?? '')}</div></div>
        <label>Minimum player level</label>${num('entry.minLevel', E.minLevel ?? 1, 'min="1" max="100"')}
      </div>
      <div class="section"><b>Difficulty and money</b>
        <div class="money">${'★'.repeat(r.stars ?? 2)}${'☆'.repeat(5 - (r.stars ?? 2))} · ${esc(r.tierName ?? '')} tier (level ${r.unlockLevel ?? 1}) · ${it.type === 'pink_slip' ? `winner takes ${esc(C.cars[it.params?.opponentCar]?.name ?? 'the rival\'s car')} · stakes up to class ${esc(r.stakeMaxClass ?? '?')}` : `reward ${esc(cur)}${r.money.toLocaleString('en-GB')} · ${r.xp} xp · entry ${r.fee > 0 ? `${esc(cur)}${r.fee.toLocaleString('en-GB')}` : 'free'}`}</div>
        <div class="hint">${it.rating ? `Worked out from the route and the rivals (${(it.rating.parts ?? []).map(x => `${esc(x.what)} ${x.points}`).join(', ') || 'an easy one'}; ${it.rating.km} km). Recommended car: rating ${Math.round(it.rating.recommended)}${it.rating.recommendedClass ? ` (class ${esc(it.rating.recommendedClass)})` : ''}.` : 'Not rated yet: pick a route and it\'s worked out as you save.'} Nothing here is set by hand: data/economy.json quests and data/quests.json difficulty.</div>
        ${it.type === 'drift' ? '' : `<label>Medal times (s; empty: from the AI reference times, else the route's estimate)</label>
        <div class="row3">${['gold', 'silver', 'bronze'].map(t => `<div>${num(`params.medalTimes.${t}`, it.params?.medalTimes?.[t] ?? '', 'min="1"')}<span class="hint">${t}${medalsNow?.[t] ? ` (now ${medalsNow[t].toFixed(1)})` : ''}</span></div>`).join('')}</div>`}
      </div>
      <div class="section"><b>Conditions</b>
        <div class="row2"><div><label>Time of day</label>${select('conditions.timeOfDay', it.conditions?.timeOfDay ?? 'any', TIMES.map(t => [t, t]))}</div><div><label>Weather</label>${select('conditions.weather', it.conditions?.weather ?? 'any', WEATHER.map(t => [t, t]))}</div></div>
        <label style="text-transform:none"><input type="checkbox" data-field="enabled" ${it.enabled ? 'checked' : ''}> Offered to players once published</label>
      </div>${rivalFields(it)}`;
    return h;
  }
  // Rivals (Phase 4 Step 4: race/setup.js): how many NPCs, their skill range, who (picked or at random),
  // their cars' class, aggression, rubber-banding; and the AI test race (race/aiTest.js)
  function rivalFields(it) {
    if (!RIVAL_TYPES.includes(it.type)) return `<div class="section"><b>Rivals</b><div class="hint">Rivals race in sprints, circuit races, hillclimbs and endurance races (and pink slips, one rival).</div></div>`;
    const cfg = npcCfg, N = { ...(cfg?.defaults ?? {}), ...(it.npc ?? {}) }, pink = it.type === 'pink_slip';
    if (!cfg) { loadNpcCfg().then(() => renderProps()); return '<div class="section"><b>Rivals</b><div class="hint">Loading…</div></div>'; }
    const picked = Array.isArray(N.drivers) ? N.drivers : [], course = questRoute?.course;
    const times = course?.aiTimes ? Object.entries(course.aiTimes).map(([k, v]) => `${k} ${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, '0')}`).join(' · ') : null;
    return `<div class="section"><b>Rivals</b>
      <div class="row2"><div><label>How many (0–${cfg.race.maxNpcs})</label>${pink ? '<div class="hint">1 (head to head)</div>' : num('npc.count', N.count ?? 0, `min="0" max="${cfg.race.maxNpcs}"`)}</div>
        <div><label>Car class</label>${select('npc.carClass', N.carClass ?? '', [['', 'the quest\'s'], ...C.classes.map(c => [c.class, c.class])])}</div></div>
      <div class="row2"><div><label>Skill from (0–1)</label>${num('npc.skill.0', N.skill?.[0] ?? 0.4, 'min="0" max="1" step="0.05"')}</div><div><label>to</label>${num('npc.skill.1', N.skill?.[1] ?? 0.8, 'min="0" max="1" step="0.05"')}</div></div>
      <div class="row2"><div><label>Aggression (empty: each driver's own)</label>${num('npc.aggression', N.aggression ?? '', 'min="0" max="1" step="0.05"')}</div>
        <div><label style="text-transform:none;margin-top:18px"><input type="checkbox" data-field="npc.rubberBand" ${N.rubberBand && !pink ? 'checked' : ''} ${pink ? 'disabled' : ''}> Rubber-banding</label></div></div>
      <label>Drivers (none ticked: random)</label><div>${cfg.drivers.map(d => `<label style="display:inline-block;margin-right:8px;text-transform:none" title="${esc(d.bio ?? '')}"><input type="checkbox" data-driver="${esc(d.id)}" ${picked.includes(d.id) ? 'checked' : ''}> ${esc(d.name)} <span class="hint">${Math.round(d.skill * 100)}</span></label>`).join('')}</div>
      ${it.track ? '' : `<div class="actions"><button data-act="aiTest" ${questRoute ? '' : 'disabled title="Pick a route first"'}>AI test race</button><button data-act="aiTestFast" ${questRoute ? '' : 'disabled'}>AI test race (fast)</button></div>`}
      <div class="hint">${times ? `AI reference times: ${esc(times)} (medal targets use them)` : 'An AI test race sets the AI reference times per skill (used for the medal times) and marks any spot where the AIs crash, leave the route or get stuck.'}</div>
      <div id="edAiTest"></div></div>`;
  }
  // The AI test race (editor/aiTestRace.js): on the map, then the route's AI reference times saved
  // (one undoable step) and the problem spots listed (click: go there)
  let aiRun = null;
  async function runAiTest(fast) {
    aiRun?.stop(); aiRun = null;
    if (view !== 'map') setView('map');
    const quest = clone(current), route = clone(questRoute), out = () => ui.right?.querySelector('#edAiTest');
    const say = html => { const el = out(); if (el) el.innerHTML = html; };
    say('<div class="hint">Loading the route\'s world and building the rivals\' cars…</div>');
    try {
      const { startAiTestRace } = await import('./aiTestRace.js');
      aiRun = await startAiTestRace({ map: mapView.map, quest, route, manifest: region, base: new URL(REGION, document.baseURI).href, fast,
        onUpdate: ({ phase, report, cars }) => say(`<div class="hint">${phase === 'race' ? `Racing${fast ? ' (fast)' : ''}: ${cars.map(c => `${c.place}. ${esc(c.name)}`).join(' · ')}` : 'Reference laps (low, medium, high skill)…'}${report.spots.length ? ` · ${report.spots.length} problem spot${report.spots.length > 1 ? 's' : ''}` : ''}</div>`),
        onDone: async rep => {
          const times = rep.aiTimes, cls = rep.carClass;
          if (Object.keys(times).length) {
            const fresh = (await C.service.get(route.id)).item ?? route;
            await H.run(`AI reference times — ${fresh.name || fresh.id}`, [fresh.id], () => C.service.update(fresh.id, { ...fresh, course: { ...fresh.course, aiTimes: { ...(fresh.course.aiTimes ?? {}), [cls]: times } } }));
            questRoute = (await C.service.get(route.id)).item ?? questRoute;
          }
          aiRun?.clearCars();
          renderProps();
          const t = v => v == null ? '—' : `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, '0')}`;
          say(`<div class="hint"><b>AI test race done.</b> ${rep.standings.map(f => `${f.place}. ${esc(f.name)} ${f.status === 'retired' ? 'DNF' : t(f.time)}`).join(' · ')}<br>
            Reference times (class ${esc(cls)}): low ${t(times.low)} · medium ${t(times.medium)} · high ${t(times.high)}</div>
            ${rep.spots.length ? rep.spots.map(s => `<div class="p warning" data-spot="${s.lat},${s.lon}">⚠ ${esc(s.message)}</div>`).join('') : '<div class="ok">✔ No problem spots: no AI crashed, left the route or got stuck.</div>'}`);
          out()?.querySelectorAll('[data-spot]').forEach(el => el.onclick = () => { const [lat, lon] = el.dataset.spot.split(',').map(Number); mapView.flyTo(lat, lon, 18); });
        } });
    } catch (e) { say(`<div class="p error">✖ The AI test race couldn't run: ${esc(e.message)}</div>`); console.error(e); }
  }
  function renderRoad() {
    const el = ui.right?.querySelector('#edRoad'); if (!el || !current) return;
    const r = current.road ?? roadNote;
    el.innerHTML = r ? `<div class="road">On <b>${esc(r.name ?? `an unnamed ${r.class ?? 'road'}`)}</b>${r.class ? ` <span class="hint">(${esc(r.class)})</span>` : ''}${r.intersection ? `<br>Nearest intersection: <b>${esc(r.intersection.name)}</b>, ${r.intersection.distanceM} m` : ''}<br><span class="hint">${current.road ? 'snapped' : 'nearest road'} · ${r.source === 'graph' ? 'the baked road graph' : 'OpenStreetMap map tiles'}</span></div>` : '<div class="road hint">No road within 40 m.</div>';
  }

  // field edits: a change is one undoable step (typing: one step per pause)
  async function onField(e) {
    const el = e.target;
    if (!current || current.status === 'archived') return;
    if (el.dataset.rt) return routeTool.action(el.dataset.rt, el);
    if (el.dataset.driver) { const set = new Set(Array.isArray(current.npc?.drivers) ? current.npc.drivers : []); el.checked ? set.add(el.dataset.driver) : set.delete(el.dataset.driver); const ids = npcCfg.drivers.map(d => d.id).filter(d => set.has(d)); return edit('Rival drivers', it => { it.npc = { ...(it.npc ?? {}), drivers: ids.length ? ids : 'random' }; }); }
    if (el.dataset.field?.startsWith('npc.')) {
      const path = el.dataset.field, key = path.split('.')[1];
      let v = el.type === 'checkbox' ? el.checked : el.value === '' ? null : Number(el.value);
      return edit(`Rivals: ${key}`, it => {
        const N = it.npc = { ...(npcCfg?.defaults ?? {}), ...(it.npc ?? {}) };
        if (key === 'skill') { const i = +path.split('.')[2], sk = [...(N.skill ?? [0.4, 0.8])]; sk[i] = Math.max(0, Math.min(1, v ?? sk[i])); if (sk[0] > sk[1]) sk.reverse(); N.skill = sk; }
        else if (key === 'carClass') N.carClass = el.value || null;
        else if (key === 'count') N.count = Math.max(0, Math.min(npcCfg.race.maxNpcs, Math.round(v ?? 0)));
        else N[key] = v;
      }, { merge: `edit:${current.id}:${path}` });
    }
    if (el.dataset.class) { const set = new Set(current.entry.classes ?? []); el.checked ? set.add(el.dataset.class) : set.delete(el.dataset.class); const classes = C.classes.map(c => c.class).filter(c => set.has(c)); return edit('Entry classes', it => { it.entry.classes = classes; }); }
    const path = el.dataset.field; if (!path) return;
    // (the track-event designer's own fields: not the item's)
    if (path.startsWith('_td.') && td) {
      const k = path.slice(4);
      td[k] = k === 'seed' ? (Number(el.value) >>> 0) : el.value;
      if (['preset', 'theme', 'seed'].includes(k)) { previewTrack(td, await loadTracksCfg()); renderProps(); }
      return;
    }
    if (el.tagName !== 'SELECT' && el.type !== 'checkbox' && (el.type === 'text' || el.tagName === 'TEXTAREA')) return commitTyping();
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = v === '' ? null : Number(v);
    if (path === 'type') return edit('Change type', it => Object.assign(it, withType(it, v)), { type: v });
    if (path === 'location.heading' && v != null) v = wrap360(v);
    if (path.startsWith('location.') && v == null) return renderProps();
    if (path === 'entry.minLevel' && v == null) v = 1;
    if (path === 'entry.minLevel' && v != null) v = Math.round(v);
    if (path === 'params.opponentCar' && v === '') v = null;
    if (path === 'route') { await edit('Pick route', it => { it.route = v || null; }); return loadSelected(); }
    if (path === '_template') { const t = templates?.find(x => x.id === v); if (t) await edit(`Template: ${t.name}`, it => Object.assign(it, applyTemplate(it, t, { road: questRoute?.course?.stats?.roads?.[0] ?? it.road?.name ?? null }))); return; }
    if (path === '_sugTemplate') { sugTemplate = v; return; }
    if (path === '_seriesAdd') { if (v) await edit('Add quest to series', it => { it.quests = [...(it.quests ?? []), v]; }); return; }
    await edit(`Edit ${path.split('.').at(-1)}`, it => setPath(it, path, v), { merge: `edit:${current.id}:${path}` });
    if (path === 'location.lat' || path === 'location.lon') { refresh(); }
  }
  function onTyping(e) {
    const el = e.target;
    if (!(el.dataset.field && (el.type === 'text' || el.tagName === 'TEXTAREA'))) return;
    clearTimeout(typing?.timer);
    typing = { path: el.dataset.field, value: el.value, id: current?.id, timer: setTimeout(commitTyping, 500) };
  }
  async function commitTyping() {
    if (!typing) return;
    const t = typing; typing = null; clearTimeout(t.timer);
    if (!current || current.id !== t.id || getPath(current, t.path) === t.value) return;
    await edit(`Edit ${t.path}`, it => setPath(it, t.path, t.value), { merge: `edit:${t.id}:${t.path}`, keepFocus: true });
  }
  async function edit(label, change, { merge = null, keepFocus = false, type = null } = {}) {
    const id = current.id, it = clone(current);
    change(it);
    if (type) lastType = type;
    const r = await H.run(`${label} — ${current.name || id}`, [id], () => C.service.update(id, it), { merge });
    if (!r.ok) { flash(r.error, true); return renderProps(); }
    current = r.item;
    if (keepFocus) { const f = document.activeElement, path = f?.dataset?.field, pos = f?.selectionStart; renderProps(); if (path) { const g = ui.right.querySelector(`[data-field="${CSS.escape(path)}"]`); g?.focus(); try { g?.setSelectionRange(pos, pos); } catch { /* not text */ } } }
    else renderProps();
  }
  async function onRightClick(e) {
    const row = e.target.closest('[data-cp]');
    if (row && !e.target.closest('input, button, label')) return routeTool.pickCheckpoint(row.dataset.cp);
    const b = e.target.closest('button, [data-goto]'); if (!b) return;
    if (b.dataset.rt) { b.blur(); return routeTool.action(b.dataset.rt, b); }
    if (b.dataset.goto) { const f = ui.right.querySelector(`[data-field="${CSS.escape(b.dataset.goto)}"]`) ?? ui.right.querySelector(`[data-pick="${CSS.escape(b.dataset.goto)}"]`); f?.scrollIntoView({ block: 'center' }); f?.focus(); return; }
    b.blur();
    if (b.dataset.pick) { picking = { path: b.dataset.pick, append: !!b.dataset.append }; ui.pick.textContent = `Click the ${view === '3d' ? 'world' : 'map'} to set: ${b.closest('.section')?.querySelector('b')?.textContent ?? ''} ${b.dataset.pick.split('.').at(-1)} (Esc cancels)`; ui.pick.style.display = 'block'; return; }
    if (b.dataset.clear) return edit('Clear place', it => setPath(it, b.dataset.clear, null));
    if (b.dataset.remove) return edit('Remove checkpoint', it => getPath(it, b.dataset.remove).splice(+b.dataset.k, 1));
    if (b.dataset.sq === 'remove') return edit('Remove quest from series', it => { it.quests.splice(+b.dataset.k, 1); });
    if (b.dataset.ev === 'remove') return edit('Remove event from venue', it => { it.events.splice(+b.dataset.k, 1); });
    if (b.dataset.ev === 'up') return edit('Move event up', it => { const k = +b.dataset.k; [it.events[k - 1], it.events[k]] = [it.events[k], it.events[k - 1]]; });
    if (b.dataset.ev === 'open') return pickItem(current.events[+b.dataset.k]);
    if (b.dataset.sq === 'up') return edit('Move quest up', it => { const k = +b.dataset.k; [it.quests[k - 1], it.quests[k]] = [it.quests[k], it.quests[k - 1]]; });
    if (b.dataset.sug != null) return makeFromSuggestion(+b.dataset.sug, b.dataset.with === 'quest');
    if (b.dataset.check) return pickItem(b.dataset.check);
    if (b.dataset.tools === 'close') { toolsPanel = null; routeTool.showSuggestions([]); return renderProps(); }
    const act = b.dataset.act;
    if (act === 'publish') publish(); else if (act === 'unpublish') unpublish(); else if (act === 'duplicate') duplicate(); else if (act === 'delete') remove(); else if (act === 'restore') restore();
    else if (act === 'turnL') turn(-15); else if (act === 'turnR') turn(15);
    else if (act === 'goto') focusOn(current.location);
    else if (act === 'openRoute' && questRoute) pickItem(questRoute.id);
    else if (act === 'tdOpen') { td = newDesigner((await loadTracksCfg()).presets); previewTrack(td, tracksCfg); renderProps(); }
    else if (act === 'tdClose') { td = null; renderProps(); }
    else if (act === 'tdRoll' && td) { rollSeed(td); previewTrack(td, await loadTracksCfg()); renderProps(); }
    else if (act === 'tdPreview' && td) { previewTrack(td, await loadTracksCfg()); renderProps(); }
    else if (act === 'tdTestDrive' && td?.code) testDriveTrack(td.code);
    else if (act === 'tdCreate') createTrackEvent();
    else if (act === 'trackTestDrive' && current?.track) testDriveTrack(current.track.code);
    else if ((act === 'trackAi' || act === 'trackAiFast') && current?.track) runTrackTest(act === 'trackAiFast');
    else if (act === 'openVenue' && current?.venue) pickItem(current.venue);
    else if ((act === 'aiTest' || act === 'aiTestFast') && questRoute && current?.kind === 'quest') runAiTest(act === 'aiTestFast');
    else if (act === 'snapNow' || act === 'faceRoad') {
      const s = await roads.snap(current.location.lat, current.location.lon, { heading: current.location.heading });
      if (!s || s.error) return flash(s?.error ?? 'No road within 60 m.', true);
      if (act === 'faceRoad') return edit('Face along road', it => { it.location.heading = s.heading; });
      edit('Snap to road', it => { it.location = { ...it.location, lat: s.lat, lon: s.lon, heading: s.heading, ...(s.alt != null ? { alt: s.alt, altFrom: s.altFrom } : {}) }; it.road = s.road; });
    }
  }

  // ---------- content tools (Phase 4 Step 5): templates, route suggestions, checking everything ----------
  let templates = null, toolsPanel = null, sugTemplate = 'mountain_sprint';
  const loadTemplates = async () => { templates ??= (await (await fetch('data/content/quest-templates.json', { cache: 'no-cache' })).json()).templates; return templates; };
  // route suggestions: the loaded region's road graph scanned for good racing roads (route/suggest.js),
  // each made into a draft route — and a draft quest from a template — only when asked (never published)
  async function suggestHere() {
    let N = routeTool.N;
    if (!N) { try { N = await routeTool.network(); } catch (e) { return flash(`Suggestions come from a baked region's road graph: ${e.message}`, true); } }
    flash('Looking for good roads…');
    await loadTemplates();
    const list = suggestRoutes(N, { count: 12 });
    deselect(); toolsPanel = { kind: 'suggest', list, region: N.region }; renderProps();
    routeTool.showSuggestions(list.map(x => x.line));
  }
  async function makeFromSuggestion(k, withQuest) {
    const sgg = toolsPanel?.list?.[k], N = routeTool.N;
    if (!sgg || !N) return;
    const start = sgg.waypoints[0], base = newItem('route', { location: { ...start, alt: 0, heading: 0 }, region: N.region });
    const { author: _, id: _id, ...route } = base;
    route.name = `${sgg.roads[0] ?? 'Road'} route`; route.course.waypoints = sgg.waypoints;
    const saved = routeTool.save(route.course);
    route.course = saved.course; if (saved.location) route.location = saved.location;
    const r = await H.run(`Suggested route: ${route.name}`, [], () => C.service.create(route));
    if (!r.ok) return flash(r.error, true);
    let made = r.item;
    if (withQuest) {
      const t = templates?.find(x => x.id === sugTemplate) ?? templates?.[0];
      const { author: _a, id: _i, ...q0 } = newItem('quest', { location: made.location, type: 'sprint' });
      const q = { ...applyTemplate(q0, t, { road: sgg.roads[0] }), route: made.id };
      const rq = await H.run(`Suggested quest: ${q.name}`, [], () => C.service.create(q));
      if (!rq.ok) return flash(rq.error, true);
      made = rq.item;
    }
    toolsPanel.made = [...(toolsPanel.made ?? []), k];
    flash(`Made a draft: ${made.name}. Review it, test drive it and publish when it's right.`);
    refresh(); renderProps();
  }
  // check everything: every item exported, checked again (content/bulk.js), the list of what needs a look
  async function checkEverything() {
    await commitTyping(); await C.service.flush();
    // (the items as they are, not one JSON string: tens of thousands of routes are too much for one)
    const doc = await C.service.exportContent({ as: 'entries' }), N = routeTool.N;
    const list = validateAll(doc.entries ?? [], { check: C.check, rate: C.rate, networks: N ? { [N.region]: N } : {} });
    deselect(); toolsPanel = { kind: 'check', list, count: doc.entries?.length ?? 0 }; renderProps();
  }
  function renderToolsPanel() {
    const T = toolsPanel;
    if (T.kind === 'suggest') {
      ui.right.innerHTML = `<h3>Suggested routes · ${esc(T.region)}</h3><p class="hint">Twisty roads with few junctions and a good length, best first, from the road graph. Each becomes a draft only when you ask: review it, test drive it, then publish.</p>
        <label>Quest template</label>${select('_sugTemplate', sugTemplate, (templates ?? []).map(t => [t.id, t.name]))}
        ${T.list.map((x, k) => `<div class="section"><b>${k + 1}. ${esc(x.roads.slice(0, 2).join(' / ') || 'Unnamed road')}</b> <span class="hint">score ${x.score}</span><div class="hint">${esc(x.why.join(' · '))}</div>
          <div class="actions">${T.made?.includes(k) ? '<span class="hint">✔ made</span>' : `<button data-sug="${k}">Draft route</button><button data-sug="${k}" data-with="quest">Draft route + quest</button>`}</div></div>`).join('') || '<p class="hint">No good racing roads found here.</p>'}
        <div class="actions"><button data-tools="close">Close</button></div>`;
    } else {
      const icon = l => l === 'error' ? '✖' : l === 'warning' ? '⚠' : '·';
      ui.right.innerHTML = `<h3>Check everything</h3><p class="hint">${T.count} item${T.count === 1 ? '' : 's'} checked: ${T.list.length ? `${T.list.length} need a look` : 'nothing needs a look'}. Routes in other regions than the one loaded aren't checked against their roads (npm run validate-content checks every region).</p>
        ${T.list.map(x => `<div class="section"><b>${esc(x.name || x.id)}</b> <span class="hint">${esc(x.kind)} · ${esc(x.view)}</span>${x.reasons.map(r => `<div class="p ${r.level}">${icon(r.level)} ${esc(r.text)}</div>`).join('')}<div class="actions"><button data-check="${esc(x.id)}">Open</button></div></div>`).join('')}
        <div class="actions"><button data-tools="close">Close</button></div>`;
    }
  }

  // ---------- placing, moving, turning ----------
  // where a click lands, settled: snapped to the road (if on), its height from the best there is — the
  // 3D world, the region's roads, the map's terrain, else a guess (said so)
  async function settle(at, heading) {
    let loc = { lat: at.lat, lon: at.lon, alt: at.alt ?? null, heading: wrap360(heading ?? 0), altFrom: at.altFrom ?? null }, road = null;
    if (snap) {
      const s = await roads.snap(at.lat, at.lon, { heading: loc.heading });
      if (s && !s.error) { loc = { lat: s.lat, lon: s.lon, alt: s.alt ?? null, heading: s.heading, altFrom: s.altFrom ?? null }; road = s.road; }
      else flash(s?.error ?? 'No road within 60 m: placed where you clicked.');
    }
    if (loc.alt == null && worldView?.covers(loc.lat, loc.lon)) { const g = worldView.groundAt(loc.lat, loc.lon); if (g) { loc.alt = g.alt; loc.altFrom = g.altFrom; } }
    if (loc.alt == null) { const h = await roads.heightAt(loc.lat, loc.lon); if (h) { loc.alt = h.alt; loc.altFrom = h.altFrom; } }
    if (loc.alt == null && mapView) { const h = await mapView.heightAt(loc.lat, loc.lon).catch(() => null); if (h != null) { loc.alt = h; loc.altFrom = 'terrain'; } }
    if (loc.alt == null) { loc.alt = 0; loc.altFrom = 'estimate'; }
    return { location: loc, road };
  }
  const cameraHeading = () => view === '3d' && worldView ? worldView.where().heading : (mapView?.where().bearing ?? 0);

  async function placeAt(at) {
    if (routeTool.takeConsumed()) return;
    if (picking) return setPicked(at);
    if (tool === 'route' && current?.kind === 'route') { await routeTool.click(at); return; }
    if (tool === 'select') { deselect(); return; }
    const kind = tool, { location, road } = await settle(at, cameraHeading());
    const { author: _, id: _id, ...item } = newItem(kind, { location, type: lastType, region: region?.region ?? region?.id ?? null });      // (the service names and signs it)
    if (kind === 'route') { item.course.waypoints = [{ lat: Math.round(at.lat * 1e7) / 1e7, lon: Math.round(at.lon * 1e7) / 1e7 }]; item.road = null; }
    item.road = road;
    const r = await H.run(`Place ${KINDS[kind].label.toLowerCase()}`, [], () => C.service.create(item));
    if (!r.ok) return flash(r.error, true);
    selected = r.item.id; current = r.item; published = null; questRoute = undefined;
    routeTool.show(current);
    renderProps(); renderTop(); refresh();
    flash(kind === 'route' ? 'Route started: click on along the roads to add waypoints.' : `Placed ${r.item.name}${road?.name ? ` on ${road.name}` : ''}.`);
  }
  async function setPicked(at) {
    const p = picking; picking = null; ui.pick.style.display = 'none';
    const { location } = await settle(at, cameraHeading());
    const place = { lat: location.lat, lon: location.lon, alt: location.alt, heading: location.heading };
    await edit(`Set ${p.path.split('.').at(-1)}`, it => { if (p.append) { const l = getPath(it, p.path) ?? []; l.push(place); setPath(it, p.path, l); } else setPath(it, p.path, place); });
  }
  // dragging the selected marker: moved as it goes (one undo step), settled where it's let go
  let dragBusy = false, dragNext = null;
  async function dragTo(id, at, done) {
    if (!current || current.id !== id || current.status === 'archived') return;
    if (!done) {
      dragNext = at;
      if (dragBusy) return;
      dragBusy = true;
      while (dragNext) { const a = dragNext; dragNext = null; const r = await H.run(`Move ${current.name}`, [id], () => C.service.update(id, { location: { ...current.location, lat: a.lat, lon: a.lon, ...(a.alt != null ? { alt: a.alt, altFrom: a.altFrom } : {}) }, road: null }), { merge: `move:${id}` }); if (r.ok) current = r.item; refresh(); }
      dragBusy = false;
      return;
    }
    while (dragBusy) await new Promise(r => setTimeout(r, 10));
    const { location, road } = await settle(at, current.location.heading);
    const r = await H.run(`Move ${current.name}`, [id], () => C.service.update(id, { location, road }), { merge: `move:${id}` });
    if (r.ok) { current = r.item; renderProps(); refresh(); }
  }
  const turn = deg => current && current.status !== 'archived' && edit(`Turn ${current.name}`, it => { it.location.heading = wrap360(it.location.heading + deg); }, { merge: `turn:${current.id}` });

  // a route's course changed: worked out again on the region's roads (route/model.js saveCourse) and saved
  async function editCourse(label, fn, { raw = false, merge = null } = {}) {
    if (!current || current.kind !== 'route' || current.status === 'archived') return;
    await routeTool.network();
    await edit(label, it => {
      const c = clone(it.course); fn(c);
      if (raw) { it.course = c; return; }
      const s = routeTool.save(c);
      it.course = s.course;
      if (s.location) it.location = s.location;
    }, { merge });
    routeTool.show(current);
  }
  // a test drive of the selected route: the game's (testtrack/test-scene.js), back here with F2
  async function testDrive(it, { carId = null, autopilot = false } = {}) {
    await commitTyping(); await C.service.flush();
    const c = routeTool.compiled;
    if (!c || c.line.length < 2) return flash('Draw the route first (at least two waypoints).', true);
    if (c.problems.some(p => p.level === 'error')) return flash(`Fix the route's errors first: ${c.problems.find(p => p.level === 'error').message}`, true);
    if (!game.testDriveRoute) return flash('Test drives need the game.', true);
    const back = { view, camera: view === '3d' && worldView ? worldView.pose() : mapView?.where(), selected };
    await exit({ quiet: true });
    game.testDriveRoute({ item: it, compiled: c, carId, autopilot, onDone: async result => {
      await enter();
      // (the same view, and the camera just where it was)
      if (back.view !== view) setView(back.view);
      if (back.view === '3d' && worldView && back.camera) worldView.setPose(back.camera); else if (back.camera && mapView) mapView.jumpTo(back.camera.lat, back.camera.lon, back.camera.zoom);
      if (back.selected) await pickItem(back.selected);
      scheduleRefresh();
      if (result) { routeTool.setRun(result); flash(result.finished ? `Test drive: ${result.time.toFixed(1)} s${result.resets ? `, ${result.resets} reset${result.resets > 1 ? 's' : ''}` : ''}. Its line is on the map, coloured by speed.` : 'Test drive ended before the finish.'); }
    } });
  }

  // a test drive of a generated track: the game's Track world on its code (back to the real world and the
  // editor: F2 — the editor goes there first)
  async function testDriveTrack(code) {
    if (!game.testDriveTrack) return flash('Test drives need the game.', true);
    await commitTyping(); await C.service.flush();
    await exit({ quiet: true });
    game.testDriveTrack(code);
  }

  async function duplicate() {
    if (!current || current.status === 'archived') return;
    const at = offset(current.location, 0.012, (current.location.heading + 90) % 360), { author: _, id: _id, ...copy } = { ...clone(current), name: `${current.name} (copy)`, location: { ...current.location, lat: at.lat, lon: at.lon }, road: null };
    const r = await H.run(`Duplicate ${current.name}`, [], () => C.service.create(copy));
    if (!r.ok) return flash(r.error, true);
    selected = r.item.id; current = r.item; published = null; renderProps(); refresh();
  }
  async function remove() {
    if (!current || current.status === 'archived') return;
    const id = current.id, name = current.name;
    // (a published one: asked first — it's archived, kept, not destroyed)
    if (published && !confirm(`"${name}" is published: players can see it. Archive it? It's kept and can be restored, not destroyed.`)) return;
    const r = await H.run(`${published ? 'Archive' : 'Delete'} ${name}`, [id], () => C.service.remove(id, { confirm: !!published }));
    if (!r.ok) return flash(r.error, true);
    flash(r.archived ? `Archived "${name}" (kept: show archived to restore it).` : `Deleted "${name}" (Ctrl+Z brings it back).`);
    deselect();
  }
  async function restore() { const r = await H.run(`Restore ${current.name}`, [current.id], () => C.service.restore(current.id)); if (!r.ok) return flash(r.error, true); await loadSelected(); refresh(); }
  async function publish() {
    if (!current) return;
    await commitTyping();
    const r = await H.run(`Publish ${current.name}`, [current.id], () => C.service.publish(current.id));
    if (!r.ok) { flash(r.error, true); return renderProps(); }
    flash(`Published "${r.item.name}": players can see it now.`);
    await loadSelected(); refresh(); renderTop();
  }
  async function unpublish() { const r = await H.run(`Unpublish ${current.name}`, [current.id], () => C.service.unpublish(current.id)); if (!r.ok) return flash(r.error, true); await loadSelected(); refresh(); }
  async function undo() { await commitTyping(); const r = await H.undo(); if (!r.ok) return flash(r.error); flash(`Undid ${r.label}`); if (selected && !r.ids.includes(selected)) { /* keep */ } await loadSelected(); refresh(); }
  async function redo() { const r = await H.redo(); if (!r.ok) return flash(r.error); flash(`Redid ${r.label}`); await loadSelected(); refresh(); }

  // ---------- clicks in the views ----------
  function onMapClick(at) { placeAt({ ...at, alt: null }); }
  // 3D: a click picks a marker or places; a drag from the selected marker moves it
  let down = null;
  addEventListener('pointerdown', e => {
    if (!active || view !== '3d' || e.button !== 0 || e.target !== game.canvas()) return;
    down = { x: e.clientX, y: e.clientY, id: worldView.pick(e.clientX, e.clientY), dragging: false };
  });
  addEventListener('pointermove', e => {
    if (!down || !active) return;
    if (!down.dragging && down.id && down.id === selected && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.dragging = true;
    if (down.dragging) { const at = worldView.ray(e.clientX, e.clientY); if (at) dragTo(selected, at, false); }
  });
  addEventListener('pointerup', e => {
    if (!down || !active) return;
    const d = down; down = null;
    if (d.dragging) { const at = worldView.ray(e.clientX, e.clientY); if (at) dragTo(selected, at, true); return; }
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    if (d.id && !picking) return pickItem(d.id);
    const at = worldView.ray(e.clientX, e.clientY);
    if (at) placeAt(at); else flash('Nothing there to place on (the world is still loading, or it\'s the sky).');
  });

  // ---------- keys ----------
  function onKey(e) {
    if (!active) return;
    const typingNow = e.target?.closest?.('input, textarea, select');
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); if (!typingNow) e.shiftKey ? redo() : undo(); return; }
    if (ctrl && e.code === 'KeyY') { e.preventDefault(); if (!typingNow) redo(); return; }
    if (ctrl && e.code === 'KeyS') { e.preventDefault(); commitTyping().then(() => C.service.flush()).then(() => flash('Saved.')); return; }
    if (typingNow) { if (e.code === 'Escape') e.target.blur(); return; }
    if (ctrl && e.code === 'KeyD') { e.preventDefault(); duplicate(); return; }
    if (ctrl) return;
    const k = e.code;
    if (current?.kind === 'route' && routeTool.key(k)) { e.stopPropagation(); return; }
    if (k === 'KeyT' && current?.kind === 'route') { testDrive(current); e.stopPropagation(); return; }
    if (k === 'Escape') { if (picking) { picking = null; ui.pick.style.display = 'none'; } else if (tool !== 'select') setTool('select'); else deselect(); }
    else if (k === 'KeyV') setTool('select'); else if (k === 'Digit1') setTool('quest'); else if (k === 'Digit2') setTool('poi'); else if (k === 'Digit3') setTool('spawn'); else if (k === 'Digit4') setTool('route'); else if (k === 'Digit5') setTool('series'); else if (k === 'Digit6') setTool('venue'); else if (k === 'Digit7') setTool('meet');
    else if (k === 'KeyN') { snap = !snap; localStorageSet('kugelsack.editor.snap', snap ? 'on' : 'off'); renderTop(); flash(snap ? 'Snap to road: on' : 'Snap to road: off'); }
    else if (k === 'KeyM') setView(view === 'map' ? '3d' : 'map');
    else if (k === 'Delete' || k === 'Backspace') remove();
    else if (k === 'BracketLeft') turn(e.shiftKey ? -1 : -15); else if (k === 'BracketRight') turn(e.shiftKey ? 1 : 15);
    else return;
    // (the game's own keys don't see editor keys)
    e.stopPropagation();
  }

  // ---------- finding places, bookmarks ----------
  async function search(text, el) {
    const P = region ? (await import('../map/build/format/projection.js')).transverseMercator(region.projection.lat0, region.projection.lon0) : null;
    const found = await findPlaces(text, { regionManifest: region, projection: P });
    if (!found.length) return flash(`Nothing found for "${text}".`);
    if (found.length === 1 && found[0].lat != null) return goTo(found[0]);
    menu(el, found.map(f => ({ label: f.name, detail: f.detail, fn: () => f.lat != null && goTo(f) })));
  }
  function goTo(p) {
    if (view === '3d' && worldView?.covers(p.lat, p.lon)) worldView.lookAt(p.lat, p.lon);
    else { if (view === '3d') setView('map'); mapView?.flyTo(p.lat, p.lon, p.zoom ?? 16); }
    scheduleRefresh();
  }
  function bookmarkMenu(el) {
    const list = bookmarks.list();
    menu(el, [
      { label: '★ Bookmark this place', detail: 'saved in this browser', fn: () => { const at = view === '3d' && worldView ? worldView.where() : mapView.where(), name = prompt('Name this bookmark:', current?.name ?? `${at.lat.toFixed(4)}, ${at.lon.toFixed(4)}`); if (name) { bookmarks.add({ name, lat: at.lat, lon: at.lon, zoom: at.zoom ?? 17, view }); flash(`Bookmarked "${name}".`); } } },
      ...list.map((b, i) => ({ label: b.name, detail: `${b.lat.toFixed(4)}, ${b.lon.toFixed(4)} · right-click to remove`, fn: () => goTo(b), remove: () => { bookmarks.remove(i); flash(`Removed "${b.name}".`); } })),
    ]);
  }
  function menu(anchor, entries) {
    document.getElementById('edMenu')?.remove();
    const m = document.createElement('div'); m.id = 'edMenu'; m.className = 'ed-panel';
    m.innerHTML = entries.map((x, i) => `<div class="item" data-i="${i}">${esc(x.label)}${x.detail ? `<small>${esc(x.detail)}</small>` : ''}</div>`).join('');
    const r = anchor.getBoundingClientRect();
    Object.assign(m.style, { left: `${Math.min(r.left, innerWidth - 300)}px`, top: `${r.bottom + 4}px` });
    root.appendChild(m);
    m.onclick = e => { const it = e.target.closest('.item'); if (it) { m.remove(); entries[+it.dataset.i].fn(); } };
    m.oncontextmenu = e => { e.preventDefault(); const it = e.target.closest('.item'); if (it && entries[+it.dataset.i].remove) { m.remove(); entries[+it.dataset.i].remove(); } };
    setTimeout(() => addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off); } }), 0);
  }

  // ---------- export and import ----------
  async function exportContent(scope) {
    await commitTyping(); await C.service.flush();
    const at = view === '3d' && worldView ? { ...worldView.where(), km: 3 } : mapView.where();
    const r = await C.service.exportContent(scope === 'area' ? { area: { lat: at.lat, lon: at.lon, km: Math.max(0.3, Math.min(200, at.km)) } } : scope === 'published' ? { views: ['published'] } : {});
    if (!r.ok) return flash(r.error, true);
    const blob = new Blob([r.json], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `world-content-${scope}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    flash(`Exported ${r.count} item${r.count === 1 ? '' : 's'}.`);
  }
  function importContent() {
    const f = document.createElement('input'); f.type = 'file'; f.accept = '.json,application/json';
    f.onchange = async () => {
      const file = f.files?.[0]; if (!file) return;
      const replace = confirm('Items already here with the same id: replace them with the file\'s? (Cancel keeps yours and skips those.)');
      const r = await C.service.importContent(await file.text(), { onConflict: replace ? 'replace' : 'skip' });
      if (!r.ok) return flash(r.error, true);
      H.clear();
      flash(`Imported ${r.imported}${r.migrated ? ` (${r.migrated} brought up from an older version)` : ''}${r.skipped.length ? `; skipped ${r.skipped.length}: ${r.skipped.slice(0, 2).map(s => `${s.id} — ${s.why}`).join('; ')}` : ''}.`, r.skipped.length > 0);
      refresh(); loadSelected();
    };
    f.click();
  }

  // ---------- saving, messages ----------
  let saveTimer = null;
  function saving() {
    if (!ui.save) return;
    ui.save.className = 'saving'; ui.save.textContent = 'Saving…';
    clearTimeout(saveTimer);
    const poll = () => { if (C.service.pending) { saveTimer = setTimeout(poll, 300); return; } ui.save.className = 'saved'; ui.save.textContent = C.persistent ? 'All changes saved' : 'Changes kept until this page closes'; };
    saveTimer = setTimeout(poll, 300);
  }
  let toastTimer = null;
  function flash(text, bad = false) {
    if (!ui.toast) { console.log(text); return; }
    ui.toast.textContent = text; ui.toast.className = `show${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast.className = ''; }, bad ? 5000 : 2600);
  }

  return {
    get active() { return active; }, enter, exit, toggle,
    // (for the browser tests and the console)
    get state() { return { view, tool, snap, selected, current, items: items.length, history: H?.size ?? 0 }; },
    get service() { return C?.service; }, get history() { return H; },
    placeAt, dragTo, pickItem, publish, undo, redo, setTool, setView, goTo, edit: (label, fn) => edit(label, fn),
    routeTool, editCourse, testDrive,
  };
}
