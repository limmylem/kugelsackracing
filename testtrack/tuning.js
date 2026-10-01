// Live tuning panel (P). Three tabs:
//  - Setup: a slider (and a box for exact numbers) for every value in the car spec, grouped
//    (chassis, suspension, tyres, steering, engine, gearbox, diff, brakes, aero, aids, camera).
//    Changes apply at once, while driving. Save writes each changed value back to the file it comes
//    from — the car's own car.json or the part that sets it (through the dev server, tools/serve.mjs);
//    a value a modifier part changes is listed instead. Reset goes back to what was last saved, and ⇄
//    swaps with the setup you had before the last load / reset.
//  - Presets: named setups kept in this browser (and in data/presets/ when the dev server is running),
//    to load, compare with what you're driving, or delete.
//  - Tests: the automated test suite at the test centre, on the setup you're driving; each result
//    against its target range, and the run before it to compare.
// The panel edits the spec object in place and tells the game (onChange) so it can re-derive things.

const PRESETS = 'driveWorld.presets.v1';
const clone = x => JSON.parse(JSON.stringify(x));

const GROUPS = [
  ['Chassis', ['mass', 'centreOfMass', 'inertiaTensor', 'bodyCollider', 'spawnHeight']],
  ['Suspension', ['suspension']],
  ['Wheels and tyres', ['wheels', 'tyre']],
  ['Steering', ['steering']],
  ['Pedals (keyboard)', ['pedals']],
  ['Engine', ['engine']],
  ['Clutch', ['clutch']],
  ['Gearbox', ['gearbox']],
  ['Differential and drive', ['differential', 'drivetrain']],
  ['Brakes', ['brakes']],
  ['Aerodynamics', ['aero']],
  ['Driver aids', ['assists']],
  ['Camera', ['camera']],
];
const OPTIONS = { 'drivetrain.layout': ['RWD', 'FWD', 'AWD', '4WD'], 'gearbox.mode': ['auto', 'sequential'], 'differential.type': ['open', 'locked', 'lsd'], 'frontDifferential.type': ['open', 'locked', 'lsd'], 'centreDifferential.type': ['open', 'viscous', 'lsd', 'locked'], 'transferCase.mode': ['2H', '4H', '4L'], 'engine.induction': ['natural', 'turbo', 'supercharged'] };
// Slider ranges where the rule of thumb (0 to 2.5 × the value) doesn't fit
const RANGES = [
  [/^mass$/, 600, 2500], [/^centreOfMass\.1$/, 0.2, 0.8], [/^centreOfMass\.[02]$/, -0.4, 0.4],
  [/(bias|efficiency|\.lock|Share|liftLoss|maxDragCut|maxDownforceLoss|throttleCut|strength|muAtFull|reapplyAt|minPressure|\.sway|rearGripLoss|ofPeakSlip)$/, 0, 1],
  [/tyre\.(longitudinal|lateral)\.D$/, 0.5, 1.4], [/tyre\.(longitudinal|lateral)\.C$/, 1, 2], [/tyre\.(longitudinal|lateral)\.E$/, -2, 1],
  [/\.(point|position)\.[02]$/, -2.5, 2.5], [/\.(point|position)\.1$/, 0, 2], [/^aero\.wind\.\d$/, -20, 20],
  [/liftCoefficient$/, -1, 1], [/ackermann$/, 0, 1], [/fov$/, 30, 100], [/fovAtSpeed$/, 0, 30], [/\.pitch$/, -10, 20],
  [/gearbox\.ratios\.\d$/, 0.5, 4.5], [/finalDrive$/, 2.5, 6], [/gearbox\.auto\.\w+$/, 0, 8000],
];
const UNITS = [
  [/mass$/, 'kg'], [/stiffness$/, 'N/m'], [/damping$/, 'N·s/m'], [/(inertia)$|inertiaTensor\.\d$/, 'kg·m²'], [/Rpm$|upLight|upFull|downLight|downFull|downMargin|launchRpm|engageAbove|hysteresis/, 'rpm'],
  [/Temp$|ambient$/, '°C'], [/fov|pitch|maxWheelRotation|fovAtSpeed/, '°'], [/Torque$|preload|\.torque$/, 'N·m'], [/Time$|Interval$|lookAhead$|holdTime$|positionLag|headingLag|handbrakeHold/, 's'],
  [/(radius|Radius|restLength|travel|distance|height|Height|Trail|reach|peak|width|spread|minGap|headSway|point\.\d|position\.\d|centreOfMass\.\d|inertiaBox\.\d|halfExtents\.\d|centre\.\d)$/, 'm'],
  [/Speed$|minSpeed|belowSpeed/, 'm/s'], [/fovSpeed|shakeFrom/, 'km/h'], [/maxPressureBar/, 'bar'], [/pistonArea/, 'm²'], [/heatCapacity/, 'J/K'],
];
const AXES = ['x (left)', 'y (up)', 'z (forward)'], GEAR = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
// Values the physics divides by, or that make no sense at nothing (a massless car, a wheel with no
// inertia): they stay above zero. Everything that starts positive stays at zero or above.
const MUST_BE_POSITIVE = /(^mass|inertia$|inertiaBox\.\d|inertiaTensor\.[012]|radius|Radius|restLength|frontalArea|heatCapacity|ratio|ratios\.\d|finalDrive|maxWheelRotation|Time$|[fF]alloffSpeed|characteristicSpeed|[wW]indow$|idleRpm|redlineRpm|minSlipSpeed|maxTorque|pistonArea|maxPressureBar|torqueCurve\.\d+\.1|fullTemp|\.D$|\.B$|\.C$)$/;
function lowest(e, saved) {
  if (!(saved > 0)) return -Infinity;
  return MUST_BE_POSITIVE.test(e.path) ? saved * 0.01 : 0;
}
const words = k => k.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();

// Every value in the spec the panel can edit: { path, label, kind: 'number' | 'bool' | 'option', group }
function entries(spec) {
  const out = [];
  const walk = (o, path, labels, group) => {
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_')) continue;
      const p = path ? `${path}.${k}` : k;
      if (OPTIONS[p]) { out.push({ path: p, label: [...labels, words(k)].join(' · '), kind: 'option', group }); continue; }
      if (typeof v === 'boolean') out.push({ path: p, label: [...labels, words(k)].join(' · '), kind: 'bool', group });
      else if (typeof v === 'number') out.push({ path: p, label: [...labels, words(k)].join(' · '), kind: 'number', group });
      else if (Array.isArray(v)) {
        if (k === 'torqueCurve') v.forEach((pt, i) => out.push({ path: `${p}.${i}.1`, label: [...labels, `torque at ${pt[0]} rpm`].join(' · '), kind: 'number', group, unit: 'N·m' }));
        else if (v.every(x => typeof x === 'number')) v.forEach((x, i) => out.push({ path: `${p}.${i}`, label: [...labels, `${words(k)} ${k === 'ratios' ? GEAR[i] : v.length === 3 ? AXES[i] : i + 1}`].join(' · '), kind: 'number', group }));
      } else if (v && typeof v === 'object') walk(v, p, [...labels, words(k)], group);
    }
  };
  for (const [group, keys] of GROUPS) for (const key of keys) {
    if (!(key in spec)) continue;
    const v = spec[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key, [], group);
    else walk({ [key]: v }, '', [], group);
  }
  return out;
}

export const getPath = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, path, value) { const ks = path.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = value; }

// Copy every value of `source` into `target` in place (so objects the physics holds stay the same)
export function assignDeep(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (Array.isArray(v) && Array.isArray(target[k])) { target[k].length = v.length; v.forEach((x, i) => { if (x && typeof x === 'object') { if (typeof target[k][i] !== 'object' || target[k][i] === null) target[k][i] = Array.isArray(x) ? [] : {}; assignDeep(target[k][i], x); } else target[k][i] = x; }); }
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') assignDeep(target[k], v);
    else target[k] = clone(v);
  }
  return target;
}

// JSON as the car files are written: two-space indents, lists of numbers on one line
export function formatJson(v, ind = '') {
  const flat = x => Array.isArray(x) && x.every(y => typeof y === 'number' || typeof y === 'string' || (Array.isArray(y) && y.every(z => typeof z === 'number')));
  if (flat(v)) return JSON.stringify(v).replace(/,/g, ', ').replace(/\], \[/g, '], [');
  if (Array.isArray(v)) return `[\n${v.map(x => ind + '  ' + formatJson(x, ind + '  ')).join(',\n')}\n${ind}]`;
  if (v && typeof v === 'object') return `{\n${Object.entries(v).map(([k, x]) => `${ind}  ${JSON.stringify(k)}: ${formatJson(x, ind + '  ')}`).join(',\n')}\n${ind}}`;
  return JSON.stringify(v);
}

function rangeOf(e, value, floor = -Infinity) {
  const r = RANGES.find(([re]) => re.test(e.path));
  let [lo, hi] = r ? [r[1], r[2]] : value > 0 ? [0, value * 2.5] : value < 0 ? [value * 2.5, -value * 2.5] : [-1, 1];
  lo = Math.max(floor, Math.min(lo, value)); hi = Math.max(hi, value);
  const raw = (hi - lo) / 200, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw);
  return { lo, hi, step };
}
const unitOf = e => e.unit ?? UNITS.find(([re]) => re.test(e.path))?.[1] ?? '';
const show = x => typeof x !== 'number' ? String(x) : Math.abs(x) >= 1000 ? x.toFixed(0) : +x.toPrecision(4) + '';

// spec: the live car spec (edited in place); carId: the car it's a spec of; save(spec, put) → { saved,
// failed, refused } writes the edits back to the car and part files (put(path, object) → Promise<bool>);
// onChange(path) after an edit; tests: { list, run(ids, { watch, speed }), stop(), crash(kmh, target) }
export function createTuningPanel({ spec, carId, save: saveEdits, onChange, tests }) {
  let saved = clone(spec), previous = null, tab = 'setup', filter = '', changedOnly = false, status = '', compareWith = null;
  let testView = { results: {}, running: null, targets: {} };
  const list = entries(spec);
  const el = document.createElement('div');
  el.id = 'tuning';
  el.hidden = true;
  const presets = () => { try { return JSON.parse(localStorage.getItem(PRESETS) || '{}'); } catch { return {}; } };
  const storePresets = p => { try { localStorage.setItem(PRESETS, JSON.stringify(p)); } catch { status = 'This browser won’t keep presets'; } };
  const changed = e => JSON.stringify(getPath(spec, e.path)) !== JSON.stringify(getPath(saved, e.path));
  // (a setup never changes which model the car is: presets saved before a model change keep working)
  const applyAll = (next, why) => { previous = clone(spec); const { model, ...setup } = next; assignDeep(spec, setup); onChange(null); status = why; render(); };

  function row(e) {
    const v = getPath(spec, e.path), mod = changed(e) ? ' modified' : '';
    const undo = `<button class="undo" data-undo="${e.path}" title="back to the saved ${show(getPath(saved, e.path))}">↺</button>`;
    if (e.kind === 'bool') return `<label class="trow${mod}"><span class="name" title="${e.path}">${e.label}</span><input type="checkbox" data-path="${e.path}" ${v ? 'checked' : ''}>${undo}</label>`;
    if (e.kind === 'option') return `<label class="trow${mod}"><span class="name" title="${e.path}">${e.label}</span><select data-path="${e.path}">${OPTIONS[e.path].map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>${undo}</label>`;
    const { lo, hi, step } = rangeOf(e, v, lowest(e, getPath(saved, e.path)));
    return `<div class="trow${mod}"><span class="name" title="${e.path}">${e.label}</span><input type="range" data-path="${e.path}" min="${lo}" max="${hi}" step="${step}" value="${v}"><input type="number" data-path="${e.path}" step="any" value="${show(v)}"><span class="unit">${unitOf(e)}</span>${undo}</div>`;
  }

  function setupTab() {
    const f = filter.toLowerCase();
    const shown = list.filter(e => (!f || e.label.toLowerCase().includes(f) || e.path.toLowerCase().includes(f)) && (!changedOnly || changed(e)));
    const count = list.filter(changed).length;
    return `<div class="tbar"><input type="search" data-filter placeholder="find a setting…" value="${filter}"><label><input type="checkbox" data-changed ${changedOnly ? 'checked' : ''}> changed only (<span data-count>${count}</span>)</label></div>
      <div class="groups">${GROUPS.map(([g, keys]) => {
        const rows = shown.filter(e => e.group === g);
        if (!rows.length) return '';
        const note = keys.map(k => spec[k]?._note).filter(Boolean)[0];
        return `<details ${f || changedOnly ? 'open' : ''} data-group="${g}"><summary>${g} <small>${rows.length}</small></summary>${note ? `<p class="note">${note}</p>` : ''}${rows.map(row).join('')}</details>`;
      }).join('')}</div>
      <div class="tfoot"><button data-save title="write each changed value back to the car or part file it comes from">Save to the car's files</button><button data-revert ${count ? '' : 'disabled'}>Reset to saved</button><button data-swap ${previous ? '' : 'disabled'} title="swap with the setup before the last load or reset">⇄ previous</button><span class="status">${status}</span></div>`;
  }

  function presetsTab() {
    const P = presets(), names = Object.keys(P).sort();
    const diff = compareWith && P[compareWith] ? list.filter(e => JSON.stringify(getPath(P[compareWith].spec, e.path)) !== JSON.stringify(getPath(spec, e.path))) : null;
    return `<div class="tbar"><input type="text" data-name placeholder="preset name, e.g. soft rear"><button data-store>Save current setup</button></div>
      ${names.length ? `<table class="presets">${names.map(n => `<tr><td><b>${n}</b><small>${new Date(P[n].when).toLocaleString()}</small></td><td><button data-load="${n}">Load</button><button data-compare="${n}">${compareWith === n ? 'Hide' : 'Compare'}</button><button data-delete="${n}">Delete</button></td></tr>`).join('')}</table>` : '<p class="note">No presets yet. Save the setup you’re driving under a name, change things, save another, then load them in turn (they apply straight away) to compare.</p>'}
      ${diff ? `<h4>${compareWith} vs what you’re driving: ${diff.length ? `${diff.length} difference${diff.length > 1 ? 's' : ''}` : 'the same'}</h4><table class="diff">${diff.map(e => `<tr><td>${e.group} · ${e.label}</td><td>${show(getPath(P[compareWith].spec, e.path))}</td><td>→ ${show(getPath(spec, e.path))}</td></tr>`).join('')}</table>` : ''}
      <p class="note">Presets are kept in this browser${' '}and, with the dev server (npm start), also written to data/presets/ so the headless tests can run them: <code>npm test -- --car data/presets/NAME.json</code></p>
      <div class="tfoot"><span class="status">${status}</span></div>`;
  }

  function testsTab() {
    const { results, running, targets } = testView;
    const fmt = (r, t) => r?.value == null ? (r ? '—' : '') : t.check && !t.unit ? (r.value ? 'yes' : 'no') : r.value.toFixed(t.digits ?? 2);
    const range = (t, g) => !g ? '' : t.check && !t.unit ? '' : g.min != null && g.max != null ? `${g.min}–${g.max}` : g.max != null ? `≤ ${g.max}` : `≥ ${g.min}`;
    return `<div class="tbar"><button data-runall ${running ? 'disabled' : ''}>Run all</button><label>watch at <select data-speed>${[1, 2, 4, 8].map(s => `<option value="${s}" ${s === testView.speed ? 'selected' : ''}>${s}×</option>`).join('')}</select></label>${running ? '<button data-stop>Stop</button>' : ''}</div>
      ${running ? `<div class="running"><b>${running.name}</b> ${running.status}<div class="progress"><div style="width:${Math.round(running.progress * 100)}%"></div></div></div>` : ''}
      <table class="tests"><tr><th>test</th><th>result</th><th>target</th><th>before</th><th></th></tr>
      ${tests.list.map(t => {
        const r = results[t.id], cur = r?.last, prev = r?.prev, g = targets[t.id];
        const cls = !cur ? '' : cur.pass ? 'pass' : 'fail';
        return `<tr class="${cls}" title="${cur?.detail ?? t.about}"><td>${t.name}<small>${cur?.detail ?? t.about}</small></td><td class="num">${fmt(cur, t)} ${cur && t.unit ? `<small>${t.unit}</small>` : ''}</td><td class="num">${range(t, g)}</td><td class="num dim">${fmt(prev, t)}</td>
          <td><button data-run="${t.id}" ${running ? 'disabled' : ''}>Run</button><button data-watch="${t.id}" ${running || t.check ? 'disabled' : ''}>Watch</button></td></tr>`;
      }).join('')}</table>
      ${tests.crash ? `<div class="tbar"><label>crash test <select data-crashspeed>${[5, 15, 30, 60, 90].map(k => `<option value="${k}" ${k === (testView.crashSpeed ?? 60) ? 'selected' : ''}>${k} km/h</option>`).join('')}</select></label><label>into <select data-crashtarget>${[['wall', 'the wall'], ['barrier', 'the barrier'], ['guardrail', 'along the guardrail']].map(([v, n]) => `<option value="${v}" ${v === (testView.crashTarget ?? 'wall') ? 'selected' : ''}>${n}</option>`).join('')}</select></label><button data-crash ${running ? 'disabled' : ''}>Crash</button></div>` : ''}
      <p class="note">Tests drive a copy of the car at the test centre on the setup you have now (a robot driver on a steering wheel, the car’s ABS, traction and stability control on). Targets: tests/targets/&lt;car&gt;.json. From a terminal: <code>npm test</code>.</p>`;
  }

  function render() {
    const scroll = el.querySelector('.body')?.scrollTop ?? 0;
    const open = new Set([...el.querySelectorAll('details[open]')].map(d => d.dataset.group));
    el.innerHTML = `<div class="head"><b>Tuning</b> <span>${spec.name}</span><span class="keys"><kbd>P</kbd> close · the car keeps driving</span></div>
      <div class="tabs">${[['setup', 'Setup'], ['presets', 'Presets'], ['tests', 'Tests']].map(([id, n]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="body">${tab === 'setup' ? setupTab() : tab === 'presets' ? presetsTab() : testsTab()}</div>`;
    for (const d of el.querySelectorAll('details')) if (open.has(d.dataset.group)) d.open = true;
    el.querySelector('.body').scrollTop = scroll;
  }

  const numberAt = (path, raw) => { const x = parseFloat(raw); return Number.isFinite(x) ? x : null; };
  function edit(path, value) {
    setPath(spec, path, value);
    onChange(path);
    const e = list.find(x => x.path === path), r = el.querySelector(`.trow [data-path="${CSS.escape(path)}"]`)?.closest('.trow');
    if (r && e) r.classList.toggle('modified', changed(e));
    // the footer and the count follow along
    const count = list.filter(changed).length, revert = el.querySelector('[data-revert]'), label = el.querySelector('[data-count]');
    if (revert) revert.disabled = !count;
    if (label) label.textContent = count;
  }
  el.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.filter !== undefined) { filter = t.value; render(); const f = el.querySelector('[data-filter]'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); return; }
    if (!t.dataset.path) return;
    if (t.type === 'range') { const x = +t.value; edit(t.dataset.path, x); const box = t.parentElement.querySelector('input[type=number]'); if (box) box.value = show(x); }
  });
  el.addEventListener('change', ev => {
    const t = ev.target, path = t.dataset.path;
    if (t.dataset.changed !== undefined) { changedOnly = t.checked; render(); return; }
    if (t.dataset.speed !== undefined) { testView.speed = +t.value; t.blur(); return; }
    if (t.dataset.crashspeed !== undefined) { testView.crashSpeed = +t.value; t.blur(); return; }
    if (t.dataset.crashtarget !== undefined) { testView.crashTarget = t.value; t.blur(); return; }
    if (!path) return;
    if (t.type === 'checkbox') edit(path, t.checked);
    else if (t.tagName === 'SELECT') edit(path, t.value);
    else if (t.type === 'number') {
      let x = numberAt(path, t.value);
      if (x === null) { t.value = show(getPath(spec, path)); return; }
      // nothing the physics can't run (a negative inertia, a zero radius…)
      const e = list.find(z => z.path === path), floor = e ? lowest(e, getPath(saved, path)) : -Infinity;
      if (x < floor) {
        x = floor > 0 ? +floor.toPrecision(2) : 0;
        t.value = show(x);
        const st = el.querySelector('.status');
        if (st) st.textContent = `${e.label}: ${floor > 0 ? 'has to stay above zero' : "can't go below zero"} — set to ${show(x)}`;
      }
      edit(path, x);
      const s = t.parentElement.querySelector('input[type=range]');
      if (s) { if (x < +s.min) s.min = x; if (x > +s.max) s.max = x; s.value = x; }
    }
    // hand the keyboard back to the car (the sliders would take the arrow keys)
    if (t.type !== 'number' && t.type !== 'text') t.blur();
  });
  el.addEventListener('pointerup', ev => { if (ev.target.type === 'range') ev.target.blur(); });
  el.addEventListener('click', async ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    b.blur();
    const d = b.dataset;
    if (d.tab) { tab = d.tab; status = ''; render(); return; }
    if (d.undo) { edit(d.undo, clone(getPath(saved, d.undo))); render(); return; }
    if (d.revert !== undefined) { applyAll(saved, 'Back to the saved setup'); return; }
    if (d.swap !== undefined && previous) { const p = previous; applyAll(p, 'Swapped with the previous setup'); return; }
    if (d.save !== undefined) { await save(); render(); return; }
    if (d.store !== undefined) {
      const name = el.querySelector('[data-name]').value.trim().replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 40);
      if (!name) { status = 'Give the preset a name first'; render(); return; }
      const P = presets();
      P[name] = { spec: clone(spec), when: Date.now() };
      storePresets(P);
      const onDisk = await put(`data/presets/${name}.json`, { ...clone(spec), _base: carId });
      status = `Saved “${name}”${onDisk ? ' (and to data/presets/)' : ''}`;
      render();
      return;
    }
    if (d.load) { const P = presets()[d.load]; if (P) applyAll(P.spec, `Loaded “${d.load}” — driving it now`); return; }
    if (d.compare) { compareWith = compareWith === d.compare ? null : d.compare; render(); return; }
    if (d.delete) { const P = presets(); delete P[d.delete]; storePresets(P); if (compareWith === d.delete) compareWith = null; status = `Deleted “${d.delete}” from this browser`; render(); return; }
    if (d.runall !== undefined) tests.run(tests.list.map(t => t.id), { watch: false });
    if (d.run) tests.run([d.run], { watch: false });
    if (d.watch) tests.run([d.watch], { watch: true, speed: testView.speed });
    if (d.stop !== undefined) tests.stop();
    if (d.crash !== undefined) tests.crash(+(el.querySelector('[data-crashspeed]')?.value ?? 60), el.querySelector('[data-crashtarget]')?.value ?? 'wall');
  });

  async function put(path, obj) {
    try { return (await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: formatJson(obj) + '\n' })).ok; } catch { return false; }
  }
  async function save() {
    const r = await saveEdits(spec, put);
    const parts = [];
    if (r.saved.length) parts.push(`Saved ${r.saved.join(', ')}`);
    if (r.failed.length) parts.push(`This server can’t write files (start it with npm start): nothing saved to ${r.failed.join(', ')}`);
    if (r.refused.length) parts.push(`Not saved — changed by a part, so edit that part instead: ${r.refused.join('; ')}`);
    if (!r.saved.length && !r.failed.length && !r.refused.length) parts.push('Nothing to save');
    if (!r.failed.length && !r.refused.length) saved = clone(spec);
    status = parts.join(' · ');
  }

  testView.speed = 1;
  return {
    el,
    get open() { return !el.hidden; },
    toggle() { el.hidden = !el.hidden; if (!el.hidden) render(); },
    hide() { el.hidden = true; },
    showTests() { tab = 'tests'; el.hidden = false; render(); },
    // the game updates the Tests tab: { results: { id: { last, prev } }, running: { name, status, progress } | null, targets }
    setTests(view) { Object.assign(testView, view); if (!el.hidden && tab === 'tests') render(); },
    // refresh the values shown (e.g. a linked setting changed elsewhere)
    refresh() { if (!el.hidden && tab === 'setup') render(); },
    // the car's parts changed: what it now is counts as saved
    rebase() { saved = clone(spec); previous = null; if (!el.hidden) render(); },
  };
}
