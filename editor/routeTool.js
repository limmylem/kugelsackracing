// The editor's route tool (Phase 4 Step 2): drawing a route on the region's real roads, and its grid,
// checkpoints and shortcuts, on the map (editor/mapView.js) and in 3D (editor/worldView.js). Everything a
// route works out comes from route/ (routing, grid, checkpoints, shortcuts, checks); this draws it and turns
// the mouse into edits (each one undoable, through the editor's history).
//
// On the map, with a route selected:
//   click: a waypoint at the end (route tool: 4)           drag a waypoint: the route follows as it moves
//   drag the dot halfway along a leg: a new waypoint there   right-click a waypoint (or Delete): it's gone
//   L then click a road: that road is driven end to end (a locked waypoint)
//   drag a checkpoint along the route; right-click it to delete it; click it for its settings
//   drag a grid slot to nudge it; the start line moves with "Move start" in the panel
//
//   const T = createRouteTool({ THREE, api })   api: the editor's — see editor.js
//   T.network() → the region's road network (loaded once)      T.show(item) the selected item (route or quest)
//   T.attachMap(map)   T.attachWorld(worldView, stream)   T.click(at) → consumed?   T.panel(item) → html
//   T.action(name, el)   T.key(code) → consumed?   T.setRun(run) a test drive's line, coloured by speed

import { createNetwork } from '../route/network.js';
import { compileRoute, saveCourse, reviewRoute, lineOf, GUIDES } from '../route/model.js';
import { buildRoute } from '../route/build.js';
import { at, project, decodeLine, withS } from '../route/geometry.js';
import { STARTER_CAR } from '../route/stats.js';
import { racingLine, speedPlan, STARTER_CAPS } from '../route/racingLine.js';
import { transverseMercator } from '../map/build/format/projection.js';
import { gunzipJson } from './roads.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const km = m => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const mmss = t => t == null ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const LAYERS = ['rt-wp', 'rt-mid', 'rt-gate', 'rt-slot'];
const OPTIONS = [['reverseOneway', 'One-way streets backwards'], ['motorways', 'Motorways'], ['unpaved', 'Unpaved roads'], ['tunnels', 'Tunnels'], ['offRoad', 'Off-road legs (straight lines)']];

export function createRouteTool({ THREE, api }) {
  let N = null, loading = null, P = null, manifest = null;
  let item = null, compiled = null, compiledKey = null, preview = null;   // preview: a course being dragged (not saved)
  let selWp = null, selCp = null, lockMode = false, map = null, drag = null, run = null, quietRoute = null, testCar = '';
  let world = null, group = null;
  let consumed = false, racingFor = null;      // (the racing line drawn, for the route as it was)
  let suggestions = [];                        // (route suggestions shown on the map: lines, numbered)

  // ---------- the road network (the region's graph) ----------
  async function network() {
    if (N) return N;
    return loading ??= (async () => {
      manifest = api.regionManifest();
      if (!manifest) throw new Error('no baked region to draw routes on');
      P = transverseMercator(manifest.projection.lat0, manifest.projection.lon0);
      const G = await gunzipJson(await fetch(new URL(manifest.files.graph, api.regionBase()).href));
      N = createNetwork(G, { P, region: manifest.region ?? manifest.id ?? 'sf', version: manifest.version, bbox: manifest.bbox ?? null });
      N.osmDate = manifest.sources?.osm?.date ?? null;
      return N;
    })();
  }
  const keyOf = c => JSON.stringify([c.kind, c.waypoints, c.options, c.grid, c.checkpointMode, c.spacing, c.checkpointMode === 'manual' ? c.checkpoints : null]);
  function compile(course) {
    const k = keyOf(course);
    if (k === compiledKey && compiled) return compiled;
    compiled = compileRoute(N, course); compiledKey = k;
    return compiled;
  }
  const ll = (x, z) => { const [lat, lon] = P.toLatLon(x, z); return [lon, lat]; };

  // ---------- what's shown ----------
  async function show(it, routeOfQuest = null) {
    item = it?.kind === 'route' ? it : null;
    quietRoute = !item && routeOfQuest?.kind === 'route' ? routeOfQuest : null;
    if (!item) { selWp = null; selCp = null; lockMode = false; }
    if (!item && !quietRoute) { draw(); return; }
    try { await network(); } catch (e) { api.flash(`Routes need the region's road map: ${e.message}`, true); return; }
    // (opened: the roads under it checked against today's map — changed, it needs a review)
    if (item && item.course?.roadData && !item.course.review?.needed) {
      const r = reviewRoute(N, item.course);
      if (r.review?.needed) { api.flash(`The roads under "${item.name}" changed in the map data: it needs a review (the changed roads are orange).`, true); await api.editCourse('Mark for review', c => { c.review = r.review; }, { raw: true }); return; }
    }
    draw();
  }
  function current() { return preview ?? item?.course ?? quietRoute?.course ?? null; }

  function features() {
    const course = current();
    const F = { path: [], review: [], racing: [], test: [], cut: [], gate: [], slot: [], mid: [], wp: [], sug: [], sugn: [] };
    if (N) suggestions.forEach((line, n) => {
      F.sug.push({ type: 'Feature', properties: { n: n + 1 }, geometry: { type: 'LineString', coordinates: line.map(p => ll(p.x, p.z)) } });
      const m = line[Math.floor(line.length / 2)];
      F.sugn.push({ type: 'Feature', properties: { n: String(n + 1) }, geometry: { type: 'Point', coordinates: ll(m.x, m.z) } });
    });
    if (!course || !N) return F;
    const quiet = !item;
    // (while dragging: just the route — the grid, checkpoints and shortcuts are worked out when let go)
    const c = quiet ? null : preview ? (() => { const b = buildRoute(N, { kind: course.kind, waypoints: course.waypoints, options: course.options }); return { built: b, line: b.line, length: b.length, loop: b.loop, grid: null }; })() : compile(course);
    const line = c ? c.line : lineOf(course, P);
    if (line.length > 1) F.path.push({ type: 'Feature', properties: { quiet }, geometry: { type: 'LineString', coordinates: line.map(p => ll(p.x, p.z)) } });
    if (quiet) return F;
    // the roads that changed under it (still on today's map: their shapes)
    for (const k of course.review?.segments ?? []) { const sg = N.byKey.get(k); if (sg) { const coords = []; for (let i = 0; i < sg.points.length; i += 3) coords.push(ll(sg.points[i], sg.points[i + 1])); F.review.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }); } }
    // the waypoints, and the middle of each leg (drag it: a new waypoint)
    course.waypoints.forEach((w, i) => F.wp.push({ type: 'Feature', properties: { i, sel: i === selWp, lock: !!w.lock, off: !!w.offRoad, end: i === 0 ? 'first' : i === course.waypoints.length - 1 && course.kind !== 'loop' ? 'last' : 'mid' }, geometry: { type: 'Point', coordinates: [w.lon, w.lat] } }));
    if (c.line.length > 1 && c.built.legs.length) {
      const total = c.built.legs.reduce((a, l) => a + (l.length ?? 0), 0) || 1;
      let acc = 0;
      c.built.legs.forEach((l, k) => { const mid = (acc + (l.length ?? 0) / 2) / total * c.length; acc += l.length ?? 0; if (!l.length) return; const p = at(c.line, mid, c.loop); F.mid.push({ type: 'Feature', properties: { leg: k }, geometry: { type: 'Point', coordinates: ll(p.x, p.z) } }); });
    }
    if (!c.grid) return F;
    // the grid, the start and finish, the checkpoints
    for (const s of c.grid.slots) F.slot.push({ type: 'Feature', properties: { i: s.i, bad: c.problems.some(p => p.field === `grid.${s.i}`) }, geometry: { type: 'Point', coordinates: ll(s.x, s.z) } });
    const gate = (g, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: [ll(g.x1, g.z1), ll(g.x2, g.z2)] } });
    F.gate.push(gate(c.start, { kind: c.loop ? 'startfinish' : 'start' }));
    if (!c.loop) F.gate.push(gate(c.finish, { kind: 'finish' }));
    c.gates.forEach((g, k) => F.gate.push(gate(g, { kind: g.required ? 'cp' : 'bonus', id: g.id, n: k + 1, sel: g.id === selCp })));
    // the shortcuts: a dashed line across the gap (red: nothing stops it)
    for (const cut of c.shortcuts) { const a = at(c.line, cut.a, c.loop), b = at(c.line, cut.b, c.loop); F.cut.push({ type: 'Feature', properties: { covered: !!cut.covered, kind: cut.kind }, geometry: { type: 'LineString', coordinates: [ll(a.x, a.z), ll(b.x, b.z)] } }); }
    // the racing line and its speeds (made again when the route changes)
    const rk = keyOf(course);
    if (racingFor?.key !== rk) {
      const rl = racingLine(c.line, { loop: c.loop }), v = speedPlan(rl, STARTER_CAPS, { loop: c.loop, corner: 0.88, braking: 0.83 });
      racingFor = { key: rk, rl, v };
    }
    for (let k = 3; k < racingFor.rl.points.length; k += 3) { const p = racingFor.rl.points[k - 3], q = racingFor.rl.points[k]; F.racing.push({ type: 'Feature', properties: { v: racingFor.v[k] * 3.6 }, geometry: { type: 'LineString', coordinates: [ll(p.x, p.z), ll(q.x, q.z)] } }); }
    // a test drive's line, coloured by speed
    if (run?.line?.length > 1) for (let k = 1; k < run.line.length; k++) { const p = run.line[k - 1], q = run.line[k]; F.test.push({ type: 'Feature', properties: { v: q.v * 3.6 }, geometry: { type: 'LineString', coordinates: [ll(p.x, p.z), ll(q.x, q.z)] } }); }
    return F;
  }

  // ---------- the map ----------
  function attachMap(m) {
    if (map === m) return;
    map = m;
    const add = () => {
      if (map.getSource('rt-path')) return;
      for (const s of ['sug', 'sugn', 'path', 'review', 'racing', 'test', 'cut', 'gate', 'slot', 'mid', 'wp']) map.addSource(`rt-${s}`, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      // route suggestions (editor tools): drafts to look at, numbered as in the panel
      map.addLayer({ id: 'rt-sug', type: 'line', source: 'rt-sug', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1f9bd1', 'line-width': 5, 'line-opacity': 0.75, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'rt-sugn', type: 'circle', source: 'rt-sugn', paint: { 'circle-radius': 10, 'circle-color': '#1f9bd1', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      if (map.getStyle()?.glyphs) map.addLayer({ id: 'rt-sugn-label', type: 'symbol', source: 'rt-sugn', layout: { 'text-field': ['get', 'n'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
      map.addLayer({ id: 'rt-path-casing', type: 'line', source: 'rt-path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['case', ['get', 'quiet'], 5, 9], 'line-opacity': 0.85 } });
      map.addLayer({ id: 'rt-path', type: 'line', source: 'rt-path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#b23cd9', 'line-width': ['case', ['get', 'quiet'], 3, 5], 'line-opacity': ['case', ['get', 'quiet'], 0.6, 0.95] } });
      // the racing line (route/racingLine.js), coloured by the speed the starter car can carry (medium skill)
      map.addLayer({ id: 'rt-racing', type: 'line', source: 'rt-racing', layout: { 'line-cap': 'round' }, paint: { 'line-width': 2.5, 'line-opacity': 0.9, 'line-color': ['interpolate', ['linear'], ['get', 'v'], 0, '#2c7bb6', 40, '#00c2a0', 80, '#ffd400', 120, '#ff7a1a', 180, '#e0002a'] } });
      map.addLayer({ id: 'rt-review', type: 'line', source: 'rt-review', paint: { 'line-color': '#ff8c1a', 'line-width': 9, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'rt-test', type: 'line', source: 'rt-test', layout: { 'line-cap': 'round' }, paint: { 'line-width': 4, 'line-color': ['interpolate', ['linear'], ['get', 'v'], 0, '#2c7bb6', 40, '#00c2a0', 80, '#ffd400', 120, '#ff7a1a', 180, '#e0002a'] } });
      map.addLayer({ id: 'rt-cut', type: 'line', source: 'rt-cut', paint: { 'line-color': ['case', ['get', 'covered'], '#9aa3ad', '#ff2d2d'], 'line-width': 3, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'rt-gate', type: 'line', source: 'rt-gate', layout: { 'line-cap': 'round' }, paint: { 'line-width': ['case', ['boolean', ['get', 'sel'], false], 9, 6], 'line-color': ['match', ['get', 'kind'], 'cp', '#ffd400', 'bonus', '#38e1ff', 'start', '#2ee06a', 'finish', '#ff3d3d', 'startfinish', '#ffffff', '#ccc'] } });
      map.addLayer({ id: 'rt-slot', type: 'circle', source: 'rt-slot', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2, 19, 6], 'circle-color': ['case', ['get', 'bad'], '#ff3d3d', '#ffffff'], 'circle-stroke-color': '#222', 'circle-stroke-width': 1 } });
      map.addLayer({ id: 'rt-mid', type: 'circle', source: 'rt-mid', paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-opacity': 0.55, 'circle-stroke-color': '#b23cd9', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'rt-wp', type: 'circle', source: 'rt-wp', paint: { 'circle-radius': ['case', ['get', 'sel'], 10, 8], 'circle-color': ['match', ['get', 'end'], 'first', '#2ee06a', 'last', '#ff3d3d', '#b23cd9'], 'circle-stroke-color': ['case', ['get', 'lock'], '#ffd400', ['get', 'off'], '#ff8c1a', '#ffffff'], 'circle-stroke-width': ['case', ['get', 'sel'], 4, 2.5] } });
      for (const l of LAYERS) { map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'grab'; }); map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; }); }
      draw();
    };
    if (map.isStyleLoaded()) add(); else map.once('load', add);
    map.on('styledata', () => { if (map.isStyleLoaded() && !map.getSource('rt-path')) add(); });
    // pressing on a waypoint, a leg's middle, a checkpoint or a slot: dragging it
    map.on('mousedown', e => {
      consumed = false;
      if (!item || e.originalEvent.button !== 0) return;
      const f = hit(e.point);
      if (!f) return;
      consumed = true;
      const L = f.layer.id, p = f.properties;
      if (L === 'rt-wp') { selWp = p.i; selCp = null; drag = { kind: 'wp', i: p.i, moved: false }; }
      else if (L === 'rt-mid') drag = { kind: 'mid', leg: p.leg, moved: false };
      else if (L === 'rt-gate' && p.id) { selCp = p.id; selWp = null; drag = { kind: 'cp', id: p.id, moved: false }; }
      else if (L === 'rt-slot') drag = { kind: 'slot', i: p.i, moved: false };
      else return;
      map.dragPan.disable(); e.preventDefault();
      draw(); api.renderProps();
    });
    map.on('mousemove', e => { if (drag && !drag.done) { drag.moved = true; dragTo({ lat: e.lngLat.lat, lon: e.lngLat.lng }, false); } });
    // (a drag ends with no click after it: nothing to swallow)
    map.on('mouseup', e => { if (!drag) return; const d = drag; map.dragPan.enable(); d.done = true; if (d.moved) { consumed = false; dragTo({ lat: e.lngLat.lat, lon: e.lngLat.lng }, true).finally(() => { drag = null; }); } else drag = null; });
    map.on('contextmenu', e => {
      if (!item) return;
      const f = hit(e.point); if (!f) return;
      e.preventDefault();
      if (f.layer.id === 'rt-wp') removeWaypoint(f.properties.i);
      else if (f.layer.id === 'rt-gate' && f.properties.id) removeCheckpoint(f.properties.id);
    });
  }
  function hit(point) {
    if (!map) return null;
    // (what's under the pointer, the handles first: a waypoint, a leg's middle, a checkpoint, a slot)
    const box = [[point.x - 5, point.y - 5], [point.x + 5, point.y + 5]];
    for (const l of LAYERS) {
      if (!map.getLayer(l)) continue;
      const f = map.queryRenderedFeatures(box, { layers: [l] }).find(x => l !== 'rt-gate' || x.properties.id);
      if (f) return f;
    }
    return null;
  }
  function draw() {
    const F = features();
    if (map?.getSource('rt-path')) for (const [k, list] of Object.entries(F)) map.getSource(`rt-${k}`)?.setData({ type: 'FeatureCollection', features: list });
    if (!preview) draw3d();          // (3D: when let go)
  }

  // ---------- dragging: the route follows (worked out as it goes, saved when let go) ----------
  let busy = false, pending = null;
  async function dragTo(at_, done) {
    if (!item) return;
    const course = clone(item.course);
    const [x, z] = P.toXZ(at_.lat, at_.lon);
    if (drag.kind === 'wp') course.waypoints[drag.i] = { ...course.waypoints[drag.i], lat: at_.lat, lon: at_.lon, lock: undefined };
    else if (drag.kind === 'mid') { if (!drag.inserted) { drag.inserted = drag.leg + 1; } course.waypoints.splice(drag.inserted, 0, { lat: at_.lat, lon: at_.lon }); }
    else if (drag.kind === 'cp' || drag.kind === 'slot') {
      const c = compile(item.course), p = project(c.line, x, z);
      if (!p) return;
      if (drag.kind === 'cp') {
        course.checkpointMode = 'manual';
        course.checkpoints = c.checkpoints.map(cp => { const g = c.gates.find(q => q.id === cp.id), [lat, lon] = P.toLatLon(g.x, g.z); return { ...cp, lat, lon, auto: false }; });
        const cp = course.checkpoints.find(q => q.id === drag.id);
        if (cp) { const [lat, lon] = P.toLatLon(p.x, p.z); Object.assign(cp, { s: p.s, lat, lon }); }
      } else {
        const slot = c.grid.slots[drag.i], adj = course.grid.adjust ??= {};
        adj[drag.i] = { s: Math.round((p.s - slot.s + (adj[drag.i]?.s ?? 0)) * 10) / 10, d: Math.round((p.d - slot.d + (adj[drag.i]?.d ?? 0)) * 10) / 10 };
      }
    }
    for (const w of course.waypoints) if (w.lock === undefined) delete w.lock;
    if (!done) {
      // (as fast as the routing allows: the latest place only)
      pending = course;
      if (busy) return;
      busy = true;
      while (pending) { const c2 = pending; pending = null; preview = c2; draw(); await new Promise(r => setTimeout(r, 0)); }
      busy = false;
      return;
    }
    while (busy) await new Promise(r => setTimeout(r, 5));
    preview = null;
    const label = { wp: 'Move waypoint', mid: 'Add waypoint', cp: 'Move checkpoint', slot: 'Nudge grid slot' }[drag.kind];
    if (drag.kind === 'mid') selWp = drag.inserted;
    await api.editCourse(label, c => Object.assign(c, course));
  }

  // ---------- clicks and keys ----------
  // (a press on one of the route's own handles: the map's click that follows isn't a place)
  function takeConsumed() { const c = consumed; consumed = false; return c; }
  async function click(at_) {
    if (!item || item.status === 'archived') return false;
    await network();
    const [x, z] = P.toXZ(at_.lat, at_.lon);
    if (lockMode) {
      lockMode = false; api.renderProps();
      const near = N.nearest(x, z, item.course.options, 40);
      if (!near) { api.flash('No road a route may use within 40 m there.', true); return true; }
      const dir = N.allowed(near.seg, true, item.course.options) ? 1 : -1, p = N.pointOn(near.seg, near.seg.length / 2), [lat, lon] = P.toLatLon(p.x, p.z);
      await api.editCourse(`Lock ${near.seg.name ?? 'a road'}`, c => { c.waypoints.push({ lat, lon, lock: { key: N.keyOf(near.seg), dir, name: near.seg.name ?? null } }); });
      selWp = item.course.waypoints.length - 1;
      return true;
    }
    await api.editCourse('Add waypoint', c => { c.waypoints.push({ lat: Math.round(at_.lat * 1e7) / 1e7, lon: Math.round(at_.lon * 1e7) / 1e7 }); });
    selWp = item.course.waypoints.length - 1;
    draw();
    return true;
  }
  async function removeWaypoint(i) {
    if (!item || i == null) return;
    await api.editCourse(`Remove waypoint ${i + 1}`, c => { c.waypoints.splice(i, 1); });
    selWp = null; draw();
  }
  async function removeCheckpoint(id) {
    const c0 = compile(item.course);
    await api.editCourse('Delete checkpoint', c => { c.checkpointMode = 'manual'; c.checkpoints = c0.checkpoints.filter(cp => cp.id !== id).map(cp => { const g = c0.gates.find(q => q.id === cp.id), [lat, lon] = P.toLatLon(g.x, g.z); return { ...cp, lat, lon, auto: false }; }); });
    selCp = null; draw();
  }
  function key(code) {
    if (!item) return false;
    if ((code === 'Delete' || code === 'Backspace') && selWp != null) { removeWaypoint(selWp); return true; }
    if ((code === 'Delete' || code === 'Backspace') && selCp != null) { removeCheckpoint(selCp); return true; }
    if (code === 'KeyL') { lockMode = !lockMode; api.flash(lockMode ? 'Click a road: the route drives all of it (Esc cancels).' : 'Lock cancelled.'); api.renderProps(); return true; }
    if (code === 'Escape' && (selWp != null || selCp != null || lockMode)) { selWp = null; selCp = null; lockMode = false; draw(); api.renderProps(); return true; }
    return false;
  }

  // ---------- the properties panel ----------
  function panel(it) {
    const c = it.course, cc = N ? compile(c) : null, S = cc?.stats ?? c.stats, R = c.review;
    const opt = c.options ?? {}, g = c.guides ?? GUIDES;
    const cpRows = (cc?.checkpoints ?? c.checkpoints ?? []).map((cp, k) => `<div class="cp ${cp.id === selCp ? 'sel' : ''}" data-cp="${esc(cp.id)}"><span>${k + 1}. ${km(cp.s)}${cp.reason === 'shortcut' ? ' · stops a shortcut' : ''}</span>
      <label><input type="checkbox" data-rt="cpReq" data-id="${esc(cp.id)}" ${cp.required !== false ? 'checked' : ''}> required</label>
      <input type="number" min="0" step="1" data-rt="cpExt" data-id="${esc(cp.id)}" value="${cp.timeExtension ?? 0}" title="Time added (s)" style="width:52px">
      <input type="number" min="4" step="1" data-rt="cpWidth" data-id="${esc(cp.id)}" value="${cp.width ?? ''}" placeholder="width" title="Gate width (m): empty is the road's width and a margin" style="width:58px">
      <button data-rt="cpDel" data-id="${esc(cp.id)}" title="Delete">✕</button></div>`).join('');
    return `<div class="section"><b>Route</b>
      ${R?.needed ? `<div class="p error" style="margin:6px 0">The roads under this route changed in the map data${R.missing?.length ? ` — ${R.missing.length} gone` : ''}${R.altered?.length ? ` — ${R.altered.length} changed shape` : ''} (orange on the map). Check it, then <button data-rt="reviewed">Re-route on today's roads</button></div>` : ''}
      <div class="row2"><div><label>Kind</label><select data-rt="kind"><option value="p2p" ${c.kind === 'p2p' ? 'selected' : ''}>Point to point</option><option value="loop" ${c.kind === 'loop' ? 'selected' : ''}>Loop (laps: the quest's setting)</option></select></div>
        <div><label>Waypoints</label><div class="hint">${c.waypoints.length}${selWp != null ? ` · <b>${selWp + 1}</b> selected <button data-rt="wpDel">Remove</button>` : ''}</div></div></div>
      <div class="hint">Click the map to add waypoints; drag them; drag a leg's middle dot for a new one; right-click (or Delete) removes. <button data-rt="lock" class="${lockMode ? 'on' : ''}">Lock a road <kbd>L</kbd></button></div>
      <label>Roads it may use</label><div>${OPTIONS.map(([k, l]) => `<label style="display:block;text-transform:none;opacity:1"><input type="checkbox" data-rt="opt" data-k="${k}" ${opt[k] ? 'checked' : ''}> ${l}</label>`).join('')}<span class="hint">Ferries: never.</span></div>
      ${S ? `<div class="stats">${km(S.length)} · ${S.turns} turns${S.sharpest ? ` · sharpest ${Math.round(S.sharpest.radius)} m ${S.sharpest.way}` : ''} · ↑${S.climb} m ↓${S.descent} m (max ${S.maxGrade}%)<br>About ${mmss(S.estimatedTime)} in the ${esc(STARTER_CAR.name ?? 'starter car')}${c.referenceTime ? ` · reference ${mmss(c.referenceTime)}` : ''}<br><span class="hint">${esc((S.roads ?? []).slice(0, 8).join(' → '))}${(S.roads?.length ?? 0) > 8 ? ' …' : ''}</span></div>` : ''}
    </div>
    <div class="section"><b>Start grid</b>
      <div class="row2"><div><label>Slots</label><input type="number" min="1" max="16" data-rt="gridCount" value="${c.grid?.count ?? 8}"></div><div><label>Start line (m along)</label><input type="number" min="0" step="1" data-rt="gridStart" value="${c.grid?.startS != null ? Math.round(c.grid.startS) : ''}" placeholder="${cc?.grid ? Math.round(cc.grid.startS) : 'auto'}"></div></div>
      <div class="hint">${cc?.grid ? `${cc.grid.columns === 2 ? 'Two abreast' : 'Single file'}, ${cc.grid.rows} rows. ` : ''}Drag a slot on the map to nudge it. <button data-rt="gridReset">Put slots back</button></div>
    </div>
    <div class="section"><b>Checkpoints</b> <span class="hint">${(c.checkpointMode ?? 'auto') === 'auto' ? 'placed by the editor' : 'placed by hand'}</span>
      <div class="row2"><div><label>Spacing (m)</label><input type="number" min="0" step="50" data-rt="spacing" value="${c.spacing ?? 500}"></div><div><label>&nbsp;</label><button data-rt="regen">Place them again</button></div></div>
      <div class="cps">${cpRows || '<div class="hint">None.</div>'}</div>
      ${cc?.shortcuts?.length ? `<div class="hint">${cc.shortcuts.filter(s => !s.covered).length} shortcut${cc.shortcuts.filter(s => !s.covered).length === 1 ? '' : 's'} with no checkpoint to stop ${cc.shortcuts.filter(s => !s.covered).length === 1 ? 'it' : 'them'} (red dashes), ${cc.shortcuts.filter(s => s.covered).length} stopped (grey).</div>` : ''}
    </div>
    <div class="section"><b>On the road</b>
      <div>${[['arrows', 'Racing-line arrows'], ['signs', 'Corner warning signs'], ['gates', 'Checkpoint gates'], ['arch', 'Finish arch']].map(([k, l]) => `<label style="display:inline-block;text-transform:none;opacity:1;margin-right:10px"><input type="checkbox" data-rt="guide" data-k="${k}" ${g[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="row2"><div><label>Roads</label><select data-rt="roads"><option value="closed" ${c.roads !== 'open' ? 'selected' : ''}>Closed (no traffic)</option><option value="open" ${c.roads === 'open' ? 'selected' : ''}>Open (traffic: Step 4)</option></select></div>
        <div><label>Off-route margin (m)</label><input type="number" min="2" max="60" data-rt="margin" value="${c.corridor?.margin ?? 8}"></div></div>
    </div>
    <div class="section"><b>Test drive</b>
 <label>Car</label><select data-rt="testCar"><option value="">Your car, as it is</option>${Object.entries(api.cars?.() ?? {}).map(([id, car]) => `<option value="${esc(id)}" ${testCar === id ? 'selected' : ''}>${esc(car.name)} (stock)</option>`).join('')}</select>
      <div class="actions"><button data-rt="test" class="go" ${cc?.line?.length > 1 && !cc.problems.some(p => p.level === 'error') ? '' : 'disabled title="Fix the errors first"'}>▶ Test drive <kbd>T</kbd></button>${run ? `<button data-rt="setRef">Use ${mmss(run.time)} as the reference time</button><button data-rt="clearRun">Hide the line</button>` : ''}</div>
      <div class="hint">From grid slot 1, in your car, checkpoints and timing on. Nothing is earned or spent, and no damage is kept. F2 comes back here.${run ? ` Last: ${run.finished ? mmss(run.time) : 'not finished'}${run.resets ? `, ${run.resets} reset${run.resets > 1 ? 's' : ''}` : ''} — the line on the map, coloured by speed.` : ''}</div>
    </div>`;
  }
  async function action(name, el) {
    if (!item) return;
    const c0 = N ? compile(item.course) : null, id = el?.dataset?.id;
    const freeze = c => { c.checkpointMode = 'manual'; c.checkpoints = c0.checkpoints.map(cp => { const g = c0.gates.find(q => q.id === cp.id), [lat, lon] = P.toLatLon(g.x, g.z); return { ...cp, lat, lon, auto: false }; }); };
    const v = el?.type === 'checkbox' ? el.checked : el?.value;
    switch (name) {
      case 'kind': return api.editCourse('Route kind', c => { c.kind = v; });
      case 'opt': return api.editCourse('Road options', c => { c.options = { ...c.options, [el.dataset.k]: v }; });
      case 'guide': return api.editCourse('Guides', c => { c.guides = { ...(c.guides ?? GUIDES), [el.dataset.k]: v }; });
      case 'roads': return api.editCourse('Roads', c => { c.roads = v; });
      case 'margin': return api.editCourse('Off-route margin', c => { c.corridor = { ...c.corridor, margin: Math.max(2, Math.min(60, Number(v) || 8)) }; });
      case 'gridCount': return api.editCourse('Grid slots', c => { c.grid = { ...c.grid, count: Math.max(1, Math.min(16, Math.round(Number(v) || 8))) }; });
      case 'gridStart': return api.editCourse('Move start', c => { c.grid = { ...c.grid, startS: v === '' ? null : Math.max(0, Number(v)) }; });
      case 'gridReset': return api.editCourse('Grid slots back', c => { c.grid = { ...c.grid, adjust: {} }; });
      case 'spacing': return api.editCourse('Checkpoint spacing', c => { c.spacing = Math.max(0, Number(v) || 0); c.checkpointMode = 'auto'; });
      case 'regen': return api.editCourse('Place checkpoints', c => { c.checkpointMode = 'auto'; c.checkpoints = []; });
      case 'cpReq': return api.editCourse('Checkpoint required', c => { freeze(c); c.checkpoints.find(q => q.id === id).required = v; });
      case 'cpExt': return api.editCourse('Checkpoint time', c => { freeze(c); c.checkpoints.find(q => q.id === id).timeExtension = Math.max(0, Number(v) || 0); });
      case 'cpWidth': return api.editCourse('Checkpoint width', c => { freeze(c); c.checkpoints.find(q => q.id === id).width = v === '' ? null : Math.max(4, Number(v)); });
      case 'cpDel': return removeCheckpoint(id);
      case 'wpDel': return removeWaypoint(selWp);
      case 'lock': return key('KeyL');
      case 'reviewed': return api.editCourse('Re-route on today\'s roads', c => { c.review = null; });
      case 'testCar': testCar = v; return;
      case 'test': return api.testDrive(item, { carId: testCar || null });
      case 'setRef': return run && api.editCourse('Reference time', c => { c.referenceTime = Math.round(run.time * 10) / 10; c.referenceLine = run.encoded ?? null; });
      case 'clearRun': run = null; draw(); return api.renderProps();
    }
  }
  // a cp row clicked: selected (shown on the map)
  function pickCheckpoint(id) { selCp = id; selWp = null; draw(); }

  // ---------- 3D: the route on the world (a ribbon over the road, waypoints, gates) ----------
  function attachWorld(wv, stream) {
    if (group) { group.parent?.remove(group); dispose3d(); }
    world = wv ? stream : null;
    if (!world) return;
    group = new THREE.Group(); group.name = 'editor-route';
    world.world.add(group);
    draw3d();
  }
  function dispose3d() { group?.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); group?.clear(); }
  function draw3d() {
    if (!group || !N) return;
    dispose3d();
    const course = current();
    if (!course) return;
    const c = item ? compile(course) : null, line = c ? c.line : lineOf(course, P);
    if (line.length < 2) return;
    // (a ribbon a little over the road, the route's colour)
    const pos = [], idx = [];
    for (let k = 0; k < line.length; k++) {
      const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = dz / l, nz = -dx / l, w = 0.9;
      pos.push(line[k].x + nx * w, line[k].h + 0.18, line[k].z + nz * w, line[k].x - nx * w, line[k].h + 0.18, line[k].z - nz * w);
      if (k) { const i = k * 2; idx.push(i - 2, i - 1, i, i - 1, i + 1, i); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xb23cd9, transparent: true, opacity: item ? 0.8 : 0.45, side: THREE.DoubleSide, depthWrite: false })));
    if (!c) return;
    const ball = new THREE.SphereGeometry(1.4, 12, 8);
    course.waypoints.forEach((w, i) => { const [x, z] = P.toXZ(w.lat, w.lon), p = project(line, x, z), m = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color: i === selWp ? 0xff3d3d : i === 0 ? 0x2ee06a : 0xb23cd9 })); m.position.set(x, (p ? line[p.k].h : 0) + 2, z); group.add(m); });
    if (!c.grid) return;
    const gate = (g, colour) => { const m = new THREE.Mesh(new THREE.BoxGeometry(g.width, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: colour })); m.position.set(g.x, g.h + 4, g.z); m.rotation.y = Math.atan2(g.dx, g.dz) + Math.PI / 2; group.add(m); };
    gate(c.start, c.loop ? 0xffffff : 0x2ee06a); if (!c.loop) gate(c.finish, 0xff3d3d);
    c.gates.forEach(g => gate(g, g.required ? 0xffd400 : 0x38e1ff));
    const slot = new THREE.BoxGeometry(1.9, 0.1, 4.2);
    for (const s of c.grid.slots) { const m = new THREE.Mesh(slot, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })); m.position.set(s.x, s.h + 0.12, s.z); m.rotation.y = s.heading * Math.PI / 180; group.add(m); }
  }

  return {
    network, show, attachMap, attachWorld, click, takeConsumed, key, panel, action, pickCheckpoint, draw,
    compile: course => compile(course),
    save: course => saveCourse(N, course),
    setRun(r) { run = r; draw(); api.renderProps(); },
    // route suggestions on the map (lines of {x, z}); [] clears them
    showSuggestions(lines) { suggestions = lines ?? []; draw(); if (map && suggestions.length) { let w = 180, s = 90, e = -180, n = -90; for (const l of suggestions) for (const p of l) { const [lon, lat] = ll(p.x, p.z); w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); } map.fitBounds([[w, s], [e, n]], { padding: 60, duration: 600 }); } },
    get run() { return run; },
    get item() { return item; },
    get N() { return N; }, get P() { return P; },
    get selectedWaypoint() { return selWp; }, get lockMode() { return lockMode; }, get map() { return map; },
    // (for the browser tests)
    get compiled() { return item ? compile(current()) : null; },
  };
}

// a test drive's line (from the tracker's samples), compact for keeping as the reference line
export function encodeRun(samples, P, encodeLine) {
  return encodeLine(samples.map(p => { const [lat, lon] = P.toLatLon(p.x, p.z); return { lat, lon, h: p.v, w: 0 }; }));
}
export function decodeRun(enc, P) {
  return withS(decodeLine(enc).map(p => { const [x, z] = P.toXZ(p.lat, p.lon); return { x, z, v: p.h }; }));
}
