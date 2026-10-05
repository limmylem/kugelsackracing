// The editor's track events (Phase 5 Step 3): at a race venue (a content item of kind 'venue', the venue
// tool, 6), a track event is made from a generated track — a preset, a theme and a seed (roll seeds until
// one's right), previewed (its map, length, corners, its checks), test-driven in the game's Track world,
// named and attached to the venue with its settings (type, laps, rivals, start, collisions, entry). Then the
// AI test race on it (race/aiTest.js on the track: the rivals' race, a solo lap at each skill for the
// reference times), problem corners flagged; an event can't be published until its track passes its checks
// and the AI can finish it (content/quests.js trackLinkProblems, track/events/checks.js).
//
//   designerPanel(td, { presets, themes, esc }) → html          rollSeed(td)   previewTrack(td, cfg) → td
//   trackSection(item, { esc, busy, report }) → html            (a track event's own panel)
//   newEventFrom(td, { venue, type, name }) → a draft quest item (no id: the service names it)
//   runTrackAiTest({ item, fast, onUpdate }) → Promise<{ report, check, rating, hash }>

import { generateTrack } from '../track/generate.js';
import { trackInfo, trackName } from '../track/events/model.js';
import { trackChecks, eventCheck } from '../track/events/checks.js';
import { newItem, TYPES, TRACK_TYPES } from '../content/quests.js';

const MEDALS = ['high', 'medium', 'low'];
const fmt = t => t == null ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export function newDesigner(presets) { return { preset: presets[0]?.id ?? 'mixed_gp', theme: 'auto', seed: (Math.random() * 1e9) >>> 0, code: null, info: null, svg: null, problems: null, name: '', type: 'circuit_race' }; }
export function rollSeed(td) { td.seed = (Math.random() * 2 ** 32) >>> 0; td.code = null; td.info = null; td.svg = null; td.problems = null; return td; }

// the track the designer's preset, theme and seed make: its code, map, stats, and its checks
export function previewTrack(td, cfg) {
  const preset = cfg.presets.find(p => p.id === td.preset) ?? cfg.presets[0];
  const gen = generateTrack({ seed: td.seed, params: { ...preset.params, theme: td.theme } });
  if (!gen.ok) { Object.assign(td, { code: null, info: null, svg: null, problems: [gen.error] }); return td; }
  const T = gen.track, xs = Array.from(T.x), zs = Array.from(T.z), x0 = Math.min(...xs), z0 = Math.min(...zs), s = Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0) || 1;
  const pts = []; for (let i = 0; i < T.n; i += Math.max(1, Math.floor(T.n / 200))) pts.push(`${(8 + (T.x[i] - x0) / s * 224).toFixed(1)},${(8 + (T.z[i] - z0) / s * 144).toFixed(1)}`);
  td.code = gen.code; td.info = trackInfo(gen); td.gen = gen;
  td.svg = `<svg viewBox="0 0 240 160" style="width:100%;background:rgba(255,255,255,.04);border-radius:8px"><polyline points="${pts.join(' ')}${T.closed ? ` ${pts[0]}` : ''}" fill="none" stroke="#ffb02e" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${pts[0].split(',')[0]}" cy="${pts[0].split(',')[1]}" r="4" fill="#fff"/></svg>`;
  td.problems = trackChecks(gen, cfg).problems;
  if (!td.name) td.name = trackName(gen.seed, { theme: td.info.theme, layout: td.info.layout });
  if (!TRACK_TYPES.includes(td.type) || (td.info.layout === 'p2p') !== (td.type === 'hillclimb')) td.type = td.info.layout === 'p2p' ? 'hillclimb' : 'circuit_race';
  return td;
}

export function designerPanel(td, { presets, themes, esc }) {
  const sel = (path, value, opts) => `<select data-field="${path}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const types = TRACK_TYPES.filter(t => !td.info || (td.info.layout === 'p2p' ? t === 'hillclimb' : t !== 'hillclimb'));
  return `<div class="section"><b>New track event</b>
    <div class="row2"><div><label>Preset</label>${sel('_td.preset', td.preset, presets.map(p => [p.id, p.id.replace(/_/g, ' ')]))}</div><div><label>Theme</label>${sel('_td.theme', td.theme, [['auto', 'auto (from the seed)'], ...themes.map(t => [t, t])])}</div></div>
    <div class="row2"><div><label>Seed</label><input data-field="_td.seed" type="number" value="${td.seed}"></div><div style="padding-top:18px"><button data-act="tdRoll">🎲 Roll another seed</button></div></div>
    <div class="actions"><button data-act="tdPreview">Preview</button><button data-act="tdTestDrive" ${td.code ? '' : 'disabled'}>Test drive</button></div>
    ${td.svg ? `${td.svg}<div class="hint">${esc(td.code)} · ${td.info.km} km · ${td.info.corners} corners · ${esc(td.info.theme)} · ${td.info.layout === 'loop' ? 'circuit' : 'point to point'}${td.info.pitLane ? ' · pit lane' : ''}</div>
      ${td.problems?.length ? `<div class="p error">✖ The track fails its checks: ${esc(td.problems[0])}</div>` : '<div class="ok">✔ The track passes its checks.</div>'}` : td.problems?.length ? `<div class="p error">✖ ${esc(td.problems[0])}</div>` : '<div class="hint">Pick a preset and a theme, roll seeds and preview until the track\'s right.</div>'}
    <label>Track name</label><input data-field="_td.name" type="text" maxlength="60" value="${esc(td.name)}">
    <label>Event</label>${sel('_td.type', td.type, types.map(t => [t, TYPES[t].label]))}
    <div class="actions"><button data-act="tdCreate" class="go" ${td.code && !td.problems?.length ? '' : 'disabled title="Preview a track that passes its checks first"'}>Create the event here</button><button data-act="tdClose">Cancel</button></div>
    <div class="hint">The event is a draft attached to this venue: set its laps, rivals and entry, run the AI test race on it, then publish it.</div></div>`;
}

export function newEventFrom(td, { venue, type = td.type, name = null }) {
  const { author: _, id: _id, ...item } = newItem('quest', { location: { ...venue.location }, type });
  item.name = name ?? `${td.name} ${TYPES[type].label.toLowerCase()}`;
  item.route = null;
  item.venue = venue.id;
  item.track = { code: td.code, kind: 'official', name: td.name, hash: null, layout: td.info.layout, gridSlots: 8, km: td.info.km, corners: td.info.corners, theme: td.info.theme, version: td.info.version, check: null };
  if (TYPES[type].params.laps != null && td.info.layout === 'loop') item.params.laps = TYPES[type].params.laps;
  if (['circuit_race', 'hillclimb', 'endurance'].includes(type)) item.npc = { count: type === 'hillclimb' ? 0 : 5, skill: [0.4, 0.8], drivers: 'random' };
  return item;
}

// a track event's own panel: its track, its checks, the AI test race's results
export function trackSection(item, { esc, busy = false }) {
  const t = item.track, C = t.check, times = C?.aiTimes ? MEDALS.filter(k => C.aiTimes[k]).map(k => `${k} ${fmt(C.aiTimes[k])}`).join(' · ') : null;
  return `<div class="section"><b>Track</b>
    <div class="hint">${esc(t.name ?? '')} · <span style="font-family:monospace;user-select:all">${esc(t.code)}</span> · ${t.km ?? '?'} km · ${t.corners ?? '?'} corners · ${esc(t.theme ?? '')} · ${t.layout === 'p2p' ? 'point to point' : 'circuit'} · ${esc(t.kind ?? 'official')}</div>
    <label>Track name</label><input data-field="track.name" type="text" maxlength="60" value="${esc(t.name ?? '')}">
    <div class="actions"><button data-act="trackTestDrive">Test drive</button><button data-act="trackAi" ${busy ? 'disabled' : ''}>AI test race</button><button data-act="trackAiFast" ${busy ? 'disabled' : ''}>AI test race (fast)</button>${item.venue ? '<button data-act="openVenue">Open the venue</button>' : ''}</div>
    ${C ? `<div class="${C.trackOk ? 'ok' : 'p error'}">${C.trackOk ? '✔ The track passes its checks.' : `✖ The track fails its checks: ${esc(C.problems?.[0] ?? '')}`}</div>
      <div class="${C.aiFinished ? 'ok' : 'p error'}">${C.aiFinished ? `✔ The AI finished it (${C.finishers ?? '?'} of ${C.field ?? '?'} in the race; every skill's reference lap).` : '✖ The AI couldn\'t finish it.'}</div>
      ${times ? `<div class="hint">AI reference times (a lap): ${esc(times)} — the medal targets use them.</div>` : ''}
      ${C.spots?.length ? `<div class="p warning">⚠ Problem corners:</div>${C.spots.map((s, k) => `<div class="hint" data-spot="${k}">• ${esc(s.message)}</div>`).join('')}` : ''}
      <div class="hint">Tested ${esc(new Date(C.at).toLocaleString())}${C.hash ? ` · hash ${esc(C.hash)}` : ''}.</div>`
    : '<div class="hint">Run the AI test race: an event can\'t be published until the track passes its checks and the AI can finish it.</div>'}
    <div id="edAiTest"></div></div>`;
}

// The AI test race on a track event's track, in the page: the track made (or from the cache), the rivals
// racing it in a physics world of its own, then the reference laps; → its check (kept with the event)
export async function runTrackAiTest({ item, fast = true, onUpdate = () => {} }) {
  const [{ default: RAPIER }, { loadTrack }, { createAiTest }, { viewCourse }, { trackProjection, trackWorld }, { createSimulation }, { socketsFromGlb }, { garageSession }, { nearestOnTrack }, { rateEvent }] = await Promise.all([
    import('@dimforge/rapier3d-compat'), import('../track/client.js'), import('../race/aiTest.js'), import('../route/model.js'), import('../track/build.js'), import('../physics/sim.js'), import('../physics/sockets.js'), import('../garage/session.js'), import('../track/scene.js'), import('../track/events/prepare.js')]);
  await RAPIER.init();
  const json = async u => (await fetch(u, { cache: 'no-cache' })).json();
  const [settings, npcCfg, qcfg, tracksCfg] = await Promise.all(['physics/settings.json', 'data/npc.json', 'data/quests.json', 'data/tracks.json'].map(json));
  const session = await garageSession(), db = session.db;
  onUpdate({ phase: 'track', text: 'Making the track…' });
  const data = await loadTrack({ code: item.track.code });
  const course = viewCourse(data.course, trackProjection), world = trackWorld(data);
  const glbs = new Map(), socketsOf = async spec => { if (!glbs.has(spec.model.file)) glbs.set(spec.model.file, fetch(spec.model.file).then(r => r.arrayBuffer())); return socketsFromGlb(await glbs.get(spec.model.file), spec.model); };
  const makeSim = async spec => {
    const sim = createSimulation(RAPIER, { settings, spec, sockets: await socketsOf(spec), track: world });
    sim.vehicle.body.enableCcd(true);
    const reset = sim.resetCar.bind(sim);
    sim.resetCar = pose => { const [x, y, z] = pose.position; reset({ ...pose, position: [x, nearestOnTrack(data, x, z, y || null).h + 0.6, z] }); };
    return { sim, frame: { toWorld: (x, z) => [x, z], toSim: (x, z) => [x, z], probeAbove: data.crossing ? 4 : null }, free: () => sim.vehicle.world.free() };
  };
  const quest = { ...item, type: item.type === 'hot_lap' ? 'circuit_race' : item.type, npc: { ...(item.npc ?? {}), count: Math.max(3, item.npc?.count ?? 0) } };
  const test = createAiTest({ makeSim, socketsOf, course, quest, db, cfg: npcCfg, qcfg, sessionRules: db.sessions, seed: 4242, count: Math.max(3, Math.min(7, item.npc?.count ?? 5)), soloLaps: course.loop ? 2 : 1 });
  await test.start();
  while (!test.done) {
    await test.step(1 / 60, { fast, budgetMs: 30 });
    const rep = test.report();
    onUpdate({ phase: test.phase, text: test.phase === 'race' ? `Racing${fast ? ' (fast)' : ''}: ${test.cars().map(c => `${c.place}. ${c.name}`).join(' · ')}` : 'Reference laps (low, medium, high skill)…', spots: rep.spots.length });
    await new Promise(r => setTimeout(r, 0));
  }
  const report = test.report();
  test.dispose();
  const gen = generateTrack({ code: item.track.code });
  const check = eventCheck({ gen, data, report, cfg: tracksCfg });
  // (the reference laps as the medal targets read them: the standing lap, then the flying one)
  const R = { finished: Object.keys(report.aiLaps ?? {}).length >= 3, perLap: course.loop, standing: Object.fromEntries(Object.entries(report.aiLaps ?? {}).map(([k, l]) => [k, Math.round(l[0] * 10) / 10])), flying: Object.fromEntries(Object.entries(report.aiLaps ?? {}).map(([k, l]) => [k, Math.round((l[1] ?? l[0]) * 10) / 10])) };
  check.aiTimes = R.flying;
  const rating = rateEvent(item, data, R, { config: qcfg });
  return { report, check, rating, hash: check.hash };
}
