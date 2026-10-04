// The world editor (Phase 4 Step 1): a mode of its own over the game (F2), for placing world content —
// quest starts, points of interest, spawn points — anywhere on Earth and filling in their details.
//
//   - Two views of the same content: the map (editor/mapView.js — anywhere on Earth) and 3D
//     (editor/worldView.js — a free-flying camera over the baked world the game drives in). M switches.
//   - Tools along the top: select (V), place a quest start (1), a point of interest (2), a spawn point
//     (3); snap to the nearest road (N), facing along it; undo / redo; publish; import / export; find a
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
import { newItem, withType, rewardsOf, feeLimit, KINDS, TYPES, TYPE_IDS, TIMES, WEATHER } from '../content/quests.js';
import { offset } from '../content/geo.js';
import { createRoadFinder } from './roads.js';
import { createMapView } from './mapView.js';
import { createWorldView } from './worldView.js';
import { findPlaces, bookmarks } from './search.js';
import { editorAccess } from './access.js';

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

  // ---------- setting up (once) ----------
  async function ready() {
    if (C) return;
    C = await worldContent();
    H = createHistory(C.service);
    H.on(() => renderTop());
    region = await (await fetch(REGION, { cache: 'no-cache' })).json().catch(() => null);
    roads = createRoadFinder({ regions: region ? [{ manifestUrl: new URL(REGION, document.baseURI).href }] : [] });
    C.service.on(ev => { if (active) { scheduleRefresh(); if (ev.id && ev.id === selected) loadSelected(); } saving(); });
    build();
  }

  function build() {
    if (!document.getElementById('editorCss')) { const l = document.createElement('link'); l.id = 'editorCss'; l.rel = 'stylesheet'; l.href = new URL('./editor.css', import.meta.url).href; document.head.appendChild(l); }
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
    const a = editorAccess();
    if (!a.allowed) { flash(a.why, true); return false; }
    if (active || loading) return true;
    loading = (async () => {
      await ready();
      const w = await game.ensureRealWorld();
      game.pause(true);
      active = true;
      document.body.classList.add('editor-on');
      root.style.display = '';
      if (w?.stream && !worldView) worldView = createWorldView({ THREE, world: w, canvas: game.canvas() });
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
        if (!mapView.world) flash('The world map can\'t be reached: showing the baked region\'s own map. Search by coordinates still works anywhere.');
        scheduleRefresh();
      } catch (e) { console.error(e); flash(`No map view: ${e.message}`, true); }
      mapMaking = null;
      return mapView;
    })();
  }
  async function exit() {
    if (!active) return;
    await commitTyping();
    await C.service.flush();
    active = false; picking = null;
    cancelAnimationFrame(rafId);
    root.style.display = 'none'; ui.map.style.display = 'none';
    document.body.classList.remove('editor-on');
    game.hooks.frame = null; game.hooks.camera = null; game.hooks.hidden = false;
    worldView?.dispose(); worldView = null;
    const unpublished = items.filter(x => x.item.status === 'draft' || (publishedById.has(x.item.id) && !sameContent(x.item, publishedById.get(x.item.id)))).length;
    game.pause(false);
    if (unpublished) flash(`${unpublished} item${unpublished > 1 ? 's' : ''} here ${unpublished > 1 ? 'have' : 'has'} changes not yet published (kept as drafts).`);
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
      <span class="sep"></span>${t('select', 'Select', 'V')}${t('quest', 'Quest start', '1')}${t('poi', 'Point of interest', '2')}${t('spawn', 'Spawn point', '3')}
      <button data-act="snap" class="${snap ? 'on' : ''}" title="Snap to the nearest road, facing along it (N)">Snap to road<kbd>N</kbd></button>
      <span class="sep"></span>
      <button data-act="undo" ${H?.canUndo ? '' : 'disabled'} title="${esc(H?.undoLabel ? `Undo ${H.undoLabel}` : 'Nothing to undo')} (Ctrl+Z)">↶ Undo</button>
      <button data-act="redo" ${H?.canRedo ? '' : 'disabled'} title="${esc(H?.redoLabel ? `Redo ${H.redoLabel}` : 'Nothing to redo')} (Ctrl+Shift+Z)">↷ Redo</button>
      <span class="sep"></span>
      <button data-act="publish" class="go" ${sel ? '' : 'disabled'} title="Publish the selected item: players see it">Publish</button>
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
    else if (act === 'bookmarks') bookmarkMenu(b);
    else if (act === 'exit') exit();
  }
  function setTool(t) { tool = t; picking = null; ui.pick.style.display = 'none'; renderTop(); ui.tip.textContent = t === 'select' ? 'Click a marker to select it; drag the selected one to move it' : `Click the ${view === '3d' ? 'world' : 'map'} to place a ${KINDS[t].label.toLowerCase()}${snap ? ' (snapped to the nearest road)' : ''}`; }

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
    ui.filters.innerHTML = ['all', 'quest', 'poi', 'spawn'].map(f => `<button data-f="${f}" class="${filter === f ? 'on' : ''}">${f === 'all' ? 'All' : KINDS[f].label}</button>`).join('') + `<label style="font-size:11px;margin-left:4px"><input type="checkbox" id="edArch" ${showArchived ? 'checked' : ''}> archived</label>`;
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
    renderProps();
    // which road it's on, and the nearest intersection (asked of the road data, not stored unless snapped)
    if (current && !current.road) { const id = current.id, r = await roads.describe(current.location.lat, current.location.lon); if (current?.id === id) { roadNote = r; renderRoad(); } }
  }
  function deselect() { selected = null; current = null; published = null; renderProps(); refresh(); }

  // ---------- the properties panel ----------
  const input = (path, value, type = 'text', extra = '') => `<input data-field="${path}" type="${type}" value="${esc(value ?? '')}" ${extra}>`;
  const num = (path, value, extra = '') => input(path, value, 'number', `step="any" ${extra}`);
  const select = (path, value, options) => `<select data-field="${path}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  function renderProps() {
    if (!ui.right) return;
    const it = current;
    if (!it) { ui.right.innerHTML = `<h3>Nothing selected</h3><p class="hint">Pick a tool along the top — <b>1</b> a quest start, <b>2</b> a point of interest, <b>3</b> a spawn point — and click the ${view === '3d' ? 'world' : 'map'} to place one. Click a marker to select it.</p><p class="hint">Find any place on Earth with the search box (or type <i>lat, lon</i>). The 3D view (M) flies over the baked world: <b>W A S D</b>, <b>Q / E</b> down and up, right-drag to look, the wheel for speed.</p>`; return; }
    const archived = it.status === 'archived', pub = published, changed = pub && !sameContent(it, pub);
    const problems = C.check(it), errors = problems.filter(p => p.level === 'error');
    const L = it.location;
    let html = `<h3>${esc(KINDS[it.kind].label)} ${archived ? '<span class="ed-badge archived">archived</span>' : !pub ? '<span class="ed-badge draft">draft</span>' : changed ? '<span class="ed-badge changed">changed since published</span>' : '<span class="ed-badge published">published</span>'}</h3>
      <div class="hint">${esc(it.id)} · by ${esc(it.author)} · edited ${esc(new Date(it.updated).toLocaleString())}${pub ? ` · published ${esc(new Date(pub.publishedAt).toLocaleString())}` : ''}</div>
      <fieldset ${archived ? 'disabled' : ''} style="border:0;padding:0;margin:0">
      <label>Name</label>${input('name', it.name, 'text', 'maxlength="80"')}
      <label>Description</label><textarea data-field="description" rows="2" maxlength="2000">${esc(it.description ?? '')}</textarea>
      <div class="section"><b>Place</b>
        <div class="row2"><div><label>Latitude</label>${num('location.lat', L.lat.toFixed(7))}</div><div><label>Longitude</label>${num('location.lon', L.lon.toFixed(7))}</div></div>
        <div class="row2"><div><label>Height (m above sea level)</label>${num('location.alt', L.alt)}</div><div><label>Facing (° from north)</label>${num('location.heading', L.heading, 'min="0" max="359.9"')}</div></div>
        <div class="hint">Height from ${esc({ road: 'the road surface', ground: 'the ground (3D view)', terrain: 'the map\'s terrain', estimate: 'nothing: a guess' }[L.altFrom] ?? 'what was there')}.</div>
        <div id="edRoad"></div>
        <div class="actions"><button data-act="snapNow">Snap to road</button><button data-act="faceRoad">Face along road</button><button data-act="turnL">⟲ 15°</button><button data-act="turnR">⟳ 15°</button><button data-act="goto">Show</button></div>
      </div>`;
    if (it.kind === 'quest') html += questFields(it);
    html += `</fieldset><div id="edProblems">${problems.length ? problems.map(p => `<div class="p ${p.level}" data-goto="${esc(p.field)}">${p.level === 'error' ? '✖' : '⚠'} ${esc(p.message)}</div>`).join('') : '<div class="ok">✔ Ready to publish.</div>'}</div>
      <div class="actions">${archived ? '<button data-act="restore" class="go">Restore as a draft</button>' : `<button data-act="publish" class="go" ${errors.length ? 'disabled title="Fix the errors first"' : ''}>${pub ? (changed ? 'Publish changes' : 'Published ✔') : 'Publish'}</button>${pub ? '<button data-act="unpublish">Unpublish</button>' : ''}<button data-act="duplicate">Duplicate <kbd>Ctrl+D</kbd></button><button data-act="delete" class="warn">${pub ? 'Archive' : 'Delete'} <kbd>Del</kbd></button>`}</div>`;
    ui.right.innerHTML = html;
    for (const p of errors) ui.right.querySelector(`[data-field="${CSS.escape(p.field)}"]`)?.classList.add('field-error');
    renderRoad();
  }
  function questFields(it) {
    const T = TYPES[it.type], r = rewardsOf(it, C.economy), cur = C.economy.currency ?? '$', E = it.entry;
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
      else h += num(path, v ?? '', `${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}`);
    }
    h += `<label>Route</label><div class="hint">${it.route ? esc(it.route) : 'None yet (routes come in Step 2)'}</div></div>
      <div class="section"><b>Entry</b>
        <label>Car classes (none ticked: any)</label><div>${C.classes.map(c => `<label style="display:inline;margin-right:8px;text-transform:none"><input type="checkbox" data-class="${c.class}" ${E.classes?.includes(c.class) ? 'checked' : ''}> ${c.class}</label>`).join('')}</div>
        <div class="row2"><div><label>Max power (kW)</label>${num('entry.maxPowerKw', E.maxPowerKw ?? '')}</div><div><label>Max kW / tonne</label>${num('entry.maxKwPerTonne', E.maxKwPerTonne ?? '')}</div></div>
        <div class="row2"><div><label>Min weight (kg)</label>${num('entry.minWeightKg', E.minWeightKg ?? '')}</div><div><label>Max weight (kg)</label>${num('entry.maxWeightKg', E.maxWeightKg ?? '')}</div></div>
        <label>Minimum player level</label>${num('entry.minLevel', E.minLevel ?? 1, 'min="1" max="100"')}
      </div>
      <div class="section"><b>Money</b>
        <div class="row2"><div><label>Reward tier</label>${select('rewards.tier', it.rewards?.tier, Object.keys(C.economy.quests.tiers).map(t => [t, t]))}</div><div><label>Entry fee (${esc(cur)})</label>${num('fee', it.fee, 'min="0"')}</div></div>
        <div class="money">${it.type === 'pink_slip' ? `Winner takes ${esc(C.cars[it.params?.opponentCar]?.name ?? 'the rival\'s car')}` : `Reward ${esc(cur)}${r.money.toLocaleString('en-GB')} · ${r.xp} xp`}</div>
        <div class="hint">${it.type === 'pink_slip' ? 'No entry fee: the cars are the stakes.' : `From the economy's rules (class ${esc(r.rewardClass)}, ${esc(it.rewards?.tier)} tier). Entry fee at most ${esc(cur)}${feeLimit(it, C.economy).toLocaleString('en-GB')}.`}</div>
      </div>
      <div class="section"><b>Conditions</b>
        <div class="row2"><div><label>Time of day</label>${select('conditions.timeOfDay', it.conditions?.timeOfDay ?? 'any', TIMES.map(t => [t, t]))}</div><div><label>Weather</label>${select('conditions.weather', it.conditions?.weather ?? 'any', WEATHER.map(t => [t, t]))}</div></div>
        <label style="text-transform:none"><input type="checkbox" data-field="enabled" ${it.enabled ? 'checked' : ''}> Offered to players once published</label>
        <label>Rivals and traffic</label><div class="hint">Set in Step 4.</div>
      </div>`;
    return h;
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
    if (el.dataset.class) { const set = new Set(current.entry.classes ?? []); el.checked ? set.add(el.dataset.class) : set.delete(el.dataset.class); const classes = C.classes.map(c => c.class).filter(c => set.has(c)); return edit('Entry classes', it => { it.entry.classes = classes; }); }
    const path = el.dataset.field; if (!path) return;
    if (el.tagName !== 'SELECT' && el.type !== 'checkbox' && (el.type === 'text' || el.tagName === 'TEXTAREA')) return commitTyping();
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = v === '' ? null : Number(v);
    if (path === 'type') return edit('Change type', it => Object.assign(it, withType(it, v)), { type: v });
    if (path === 'location.heading' && v != null) v = wrap360(v);
    if (path.startsWith('location.') && v == null) return renderProps();
    if (['fee', 'entry.minLevel'].includes(path) && v == null) v = path === 'fee' ? 0 : 1;
    if (path === 'entry.minLevel' && v != null) v = Math.round(v);
    if (path === 'params.opponentCar' && v === '') v = null;
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
    const b = e.target.closest('button, [data-goto]'); if (!b) return;
    if (b.dataset.goto) { const f = ui.right.querySelector(`[data-field="${CSS.escape(b.dataset.goto)}"]`) ?? ui.right.querySelector(`[data-pick="${CSS.escape(b.dataset.goto)}"]`); f?.scrollIntoView({ block: 'center' }); f?.focus(); return; }
    b.blur();
    if (b.dataset.pick) { picking = { path: b.dataset.pick, append: !!b.dataset.append }; ui.pick.textContent = `Click the ${view === '3d' ? 'world' : 'map'} to set: ${b.closest('.section')?.querySelector('b')?.textContent ?? ''} ${b.dataset.pick.split('.').at(-1)} (Esc cancels)`; ui.pick.style.display = 'block'; return; }
    if (b.dataset.clear) return edit('Clear place', it => setPath(it, b.dataset.clear, null));
    if (b.dataset.remove) return edit('Remove checkpoint', it => getPath(it, b.dataset.remove).splice(+b.dataset.k, 1));
    const act = b.dataset.act;
    if (act === 'publish') publish(); else if (act === 'unpublish') unpublish(); else if (act === 'duplicate') duplicate(); else if (act === 'delete') remove(); else if (act === 'restore') restore();
    else if (act === 'turnL') turn(-15); else if (act === 'turnR') turn(15);
    else if (act === 'goto') focusOn(current.location);
    else if (act === 'snapNow' || act === 'faceRoad') {
      const s = await roads.snap(current.location.lat, current.location.lon, { heading: current.location.heading });
      if (!s || s.error) return flash(s?.error ?? 'No road within 60 m.', true);
      if (act === 'faceRoad') return edit('Face along road', it => { it.location.heading = s.heading; });
      edit('Snap to road', it => { it.location = { ...it.location, lat: s.lat, lon: s.lon, heading: s.heading, ...(s.alt != null ? { alt: s.alt, altFrom: s.altFrom } : {}) }; it.road = s.road; });
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
    if (picking) return setPicked(at);
    if (tool === 'select') { deselect(); return; }
    const kind = tool, { location, road } = await settle(at, cameraHeading());
    const { author: _, id: _id, ...item } = newItem(kind, { location, type: lastType });      // (the service names and signs it)
    item.road = road;
    const r = await H.run(`Place ${KINDS[kind].label.toLowerCase()}`, [], () => C.service.create(item));
    if (!r.ok) return flash(r.error, true);
    selected = r.item.id; current = r.item; published = null;
    renderProps(); renderTop(); refresh();
    flash(`Placed ${r.item.name}${road?.name ? ` on ${road.name}` : ''}.`);
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
    if (k === 'Escape') { if (picking) { picking = null; ui.pick.style.display = 'none'; } else if (tool !== 'select') setTool('select'); else deselect(); }
    else if (k === 'KeyV') setTool('select'); else if (k === 'Digit1') setTool('quest'); else if (k === 'Digit2') setTool('poi'); else if (k === 'Digit3') setTool('spawn');
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
  };
}
