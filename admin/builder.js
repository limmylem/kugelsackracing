// The family builder (the admin page's Builder tab; docs/CONTENT_PIPELINE.md "A family from the admin page";
// server/src/content/builder.ts): families, engines and cars made and changed by picking options.
//  - New family, step by step: what it is (or start from a family or a preset), its name (suggested, checked against
//    real brands), its settings (only what's allowed: each shown with its range), its shape (with a live 3D preview),
//    finishes, an aim, the cars it fits — and, as you go, every part it'll make with its stats, tier, price and unlock
//    level, and what to look at (the build's own numbers, before anything is made)
//  - Preview a few parts (models, thumbnails, on a car); Make the family: its file as a draft, then built and checked
//    as a job (progress, log, cancel); then the Content tab shows its parts and their checks
//  - Change a family: the same form, with what will change (added, changed, retired — and who owns those)
//  - Presets and variations; New engine (a live torque curve, the cars it fits and why not); New car
// Every change asks why (it goes in the history and the admins' log). Nothing is published here.

export function createBuilder({ api, h, say, when, errText, main, ask, makePreview, showFamily }) {
  const P = '/admin/builder';
  const money = n => n == null ? '—' : `$${Math.round(n).toLocaleString('en-GB')}`;
  const debounce = (fn, ms) => { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
  const pill = (text, on, onclick, title = null) => h('button', { type: 'button', class: `btn ${on ? 'primary' : 'ghost'}`, style: 'height:30px;padding:0 10px;font-size:13px !important', onclick, title }, text);
  const fmt = (v, unit = '') => v == null ? 'auto' : typeof v === 'number' ? `${+v.toPrecision(4)}${unit ? (/^[°"]/.test(unit) ? unit : ` ${unit}`) : ''}` : String(v);
  let overview = null, preview3d = null;
  async function load() { overview = await api.get(P); return overview; }
  function page(left, right, cols = 'minmax(0, 1fr) minmax(0, 1.15fr)') {
    const box = main();
    box.style.gridTemplateColumns = cols;
    box.replaceChildren(h('section', {}, ...left), h('section', {}, ...right));
    return box;
  }
  function unavailable(why) {
    const box = main();
    box.className = 'narrow';
    box.replaceChildren(h('section', {}, h('h2', {}, 'Family builder'), h('div', { class: 'msg bad' }, why), h('button', { class: 'btn ghost', onclick: () => showHome() }, 'Back to Builder')));
  }
  // (the Builder tab: what it does, whether it works on this server, and a way into each part of it)
  async function showHome() {
    const ov = await load().catch(e => ({ available: false, why: errText(e) }));
    const box = main();
    box.className = 'narrow';
    box.style.gridTemplateColumns = 'minmax(320px, 900px)';
    const go = (label, fn, cls = 'secondary') => h('button', { class: `btn ${cls}`, disabled: !ov.available, onclick: fn }, label);
    const kinds = ov.available ? h('div', { class: 'list' }, ...ov.kinds.map(k => h('div', { class: 'action' }, h('strong', {}, k.label), ' · ',
      ...(k.families.length ? k.families.flatMap((f, i) => [i ? ', ' : '', h('a', { href: '#', onclick: e => { e.preventDefault(); editFamily(f.id); } }, f.name ?? f.id)]) : [h('span', { class: 'muted' }, 'no family yet')])))) : null;
    box.replaceChildren(h('section', {}, h('h2', {}, 'Builder'),
      h('p', { class: 'muted' }, 'Families of parts, engines and cars made and changed by picking options: every part a family would make listed with its stats, tier and price before anything is made, previews, then built and checked as a job. What it makes are drafts in the Content tab, published there.'),
      ov.available ? null : h('div', { class: 'msg bad' }, ov.why),
      h('div', { class: 'row' }, go('New family', () => newFamily(), 'primary'), go('New engine', () => newEngine()), go('New car', () => newCar()), go('Presets & variations', () => variations(), 'ghost'), go('Jobs', () => showJobs(), 'ghost')),
      kinds ? h('h3', {}, 'Change a family') : null, kinds));
  }
  async function ready() { const ov = await load().catch(e => ({ available: false, why: errText(e) })); if (!ov.available) { unavailable(ov.why); return null; } return ov; }

  // ---------- a family: the form ----------
  // (the form's state from a family file: each setting's values, each shape setting fixed or varied)
  function fromDef(def, opts) {
    const st = { settings: {}, shape: {}, explicit: new Set() };
    for (const s of opts.settings) {
      const v = def?.settings?.[s.key];
      st.settings[s.key] = v && typeof v === 'object' && !Array.isArray(v) && 'from' in v ? { mode: 'step', ...v, list: [] } : { mode: 'list', list: v === undefined ? [] : Array.isArray(v) ? [...v] : [v] };
    }
    for (const s of opts.shape) {
      let v = def?.shape?.[s.key];
      const entryOf = x => s.type === 'table' && x && typeof x === 'object' ? s.entries.find(e => Object.entries(x).every(([k, y]) => e[k] === y))?.id ?? null : x;
      if (Array.isArray(v) && v.length > 1) st.shape[s.key] = { vary: true, list: v.map(entryOf) };
      else { if (Array.isArray(v)) v = v[0]; st.shape[s.key] = { vary: false, value: v === undefined ? s.default : entryOf(v) }; }
      if (v !== undefined) st.explicit.add(s.key);
    }
    return st;
  }
  // (the family file the form says: what goes to the server, checked there against the kind)
  function toDef(st, opts) {
    const settings = {}, shape = {};
    for (const s of opts.settings) {
      const x = st.settings[s.key];
      if (x.mode === 'step' && [x.from, x.to, x.step].every(n => n !== '' && n != null && Number.isFinite(+n))) settings[s.key] = { from: +x.from, to: +x.to, step: +x.step };
      else if (x.list.length) settings[s.key] = x.list.length === 1 ? x.list[0] : x.list;
    }
    for (const s of opts.shape) {
      const x = st.shape[s.key];
      if (x.vary && x.list.length) shape[s.key] = x.list.length === 1 ? x.list[0] : x.list;
      else if (!x.vary && st.explicit.has(s.key) && x.value !== undefined) shape[s.key] = x.value;
    }
    const aim = {};
    if (st.aim.tiers?.length) aim.tiers = st.aim.tiers;
    for (const k of ['price', 'unlock']) if (st.aim[k]?.some(v => v !== '' && v != null)) aim[k] = st.aim[k].map(v => v === '' || v == null ? null : +v);
    return { kind: st.kind, name: st.name.trim(), settings, ...(Object.keys(shape).length && { shape }), finishes: st.finishes, ...(st.skip.length && { skip: st.skip }), ...(Object.keys(st.leaveOff).length && { leaveOff: st.leaveOff }), ...(Object.keys(aim).length && { aim }) };
  }

  async function newFamily(start = null) { return familyForm({ editing: null, def: start }); }
  async function editFamily(id) {
    if (!await ready()) return;
    let f;
    try { f = await api.get(`${P}/families/${id}`); } catch (e) { unavailable(errText(e)); return; }
    return familyForm({ editing: id, def: f.def, history: f.history });
  }
  async function editSource(id) {
    const ov = await ready();
    if (!ov) return;
    if (ov.engines.some(e => e.id === id)) return engineForm(id);
    return editFamily(id);
  }

  async function familyForm({ editing, def, history = [] }) {
    const ov = await ready();
    if (!ov) return;
    const st = { step: def?.kind ? 1 : 0, kind: def?.kind ?? null, name: editing ? def.name : def?.name ?? '', finishes: [...(def?.finishes ?? [])], aim: { tiers: [...(def?.aim?.tiers ?? [])], price: [...(def?.aim?.price ?? ['', ''])], unlock: [...(def?.aim?.unlock ?? ['', ''])] }, leaveOff: { ...(def?.leaveOff ?? {}) }, skip: [...(def?.skip ?? [])], settings: {}, shape: {}, explicit: new Set() };
    if (editing) st.step = 2;
    let opts = null, last = null, seed = 1, shapePart = null, job = null;
    const formEl = h('div', { class: 'list' }), stepsEl = h('div', { class: 'row' }), msg = h('div');
    const sumEl = h('div', { class: 'list' }), viewEl = h('div', { style: 'position:relative;height:300px;border-radius:var(--r-card);overflow:hidden;background:#15191d' }), viewWhy = h('div', { class: 'muted' }), jobEl = h('div', { class: 'list' }), previewEl = h('div', { class: 'list' });
    const title = h('h2', {}, editing ? `Change family: ${def.name}` : 'New family');
    page([title, stepsEl, msg, formEl, h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => go(st.step - 1) }, 'Back'), h('button', { class: 'btn secondary', onclick: () => go(st.step + 1) }, 'Next'),
      h('button', { class: 'btn secondary', onclick: () => doPreview() }, 'Preview'),
      h('button', { class: 'btn primary', onclick: () => doMake() }, editing ? 'Save the changes' : 'Make the family'),
      h('button', { class: 'btn ghost', onclick: () => savePreset() }, 'Save as preset'),
      h('button', { class: 'btn ghost', onclick: () => showFamily(editing ?? null) }, 'Close'))],
    [h('h2', {}, 'What it will make'), jobEl, previewEl, sumEl]);
    const shapeBox = h('div', { class: 'list' }, h('h3', {}, 'Its shape'), viewEl, viewWhy);
    const STEPS = ['What it is', 'Name', 'Settings', 'Shape', 'Finishes', 'Aim', 'Fits'];
    async function setKind(kind, from = null) {
      st.kind = kind;
      try { opts = await api.get(`${P}/kinds/${kind}`); } catch (e) { say(msg, errText(e)); return; }
      Object.assign(st, fromDef(from ?? (editing ? def : null), opts));
      if (from) { st.finishes = [...(from.finishes ?? [])]; st.skip = [...(from.skip ?? [])]; st.leaveOff = { ...(from.leaveOff ?? {}) }; if (from.aim) st.aim = { tiers: [...(from.aim.tiers ?? [])], price: [...(from.aim.price ?? ['', ''])], unlock: [...(from.aim.unlock ?? ['', ''])] }; }
      if (!st.finishes.length) st.finishes = [opts.finishes[0].id];
    }
    if (st.kind) await setKind(st.kind, def);
    function go(n) { say(msg, ''); st.step = Math.max(0, Math.min(STEPS.length - 1, n)); if (st.step > 0 && !opts) { st.step = 0; say(msg, 'Pick what it is first.'); } draw(); if (st.step === 3) refreshShape(); }
    const changed = () => { draw(); refresh(); };
    function draw() {
      stepsEl.replaceChildren(...STEPS.map((s, i) => pill(`${i + 1}. ${s}`, st.step === i, () => go(i))));
      formEl.replaceChildren(...[stepKind, stepName, stepSettings, stepShape, stepFinishes, stepAim, stepFits][st.step]());
      // (the shape step: its live 3D model beside its settings)
      if (st.step === 3) formEl.prepend(shapeBox);
    }
    // 1. what it is
    function stepKind() {
      const fromSel = h('select', { onchange: async e => { const v = e.target.value; if (!v) return; const [type, id] = v.split(':'); let from; if (type === 'family') from = (await api.get(`${P}/families/${id}`)).def; else from = ov.presets.find(p => p.file === id); if (!from) return; await setKind(from.kind, { ...from, name: '' }); say(msg, `Started from ${type === 'family' ? 'the family' : 'the preset'} ${from.name}: change what you like.`, true); changed(); } },
        h('option', { value: '' }, '—'), ...ov.kinds.flatMap(k => k.families.map(f => h('option', { value: `family:${f.id}` }, `${f.name} (${k.label} family)`))), ...ov.presets.map(p => h('option', { value: `preset:${p.file}` }, `${p.name} (preset, ${p.kind})`)));
      return [
        h('p', { class: 'muted' }, editing ? 'A family\'s kind doesn\'t change: make a new family for another kind.' : 'Pick the kind of part: its settings, shape settings and finishes come from data/content/formulas.json.'),
        h('div', { class: 'actions' }, ...ov.kinds.map(k => h('button', { type: 'button', class: 'action', disabled: !!editing, style: `text-align:left;cursor:pointer;border:1px solid ${st.kind === k.kind ? 'var(--c-accent)' : 'transparent'}`, onclick: async () => { await setKind(k.kind); changed(); } },
          h('b', {}, `${k.label[0].toUpperCase()}${k.label.slice(1)}`), h('span', { class: 'muted' }, `${k.slot} slot · by ${k.maker}${k.fitted ? ' · fitted to each car' : ''}${k.perCar ? ' · one per car' : ''}`), h('span', { class: 'muted' }, k.families.length ? `families: ${k.families.map(f => f.name).join(', ')}` : 'no families yet')))),
        !editing && h('label', {}, 'Or start from an existing family or a preset', fromSel),
      ];
    }
    // 2. name and id
    function stepName() {
      const check = h('div', { class: 'muted' }), sugg = h('div', { class: 'row' });
      const input = h('input', { value: st.name, maxlength: 24, placeholder: 'Like Streetline, Mesh-10, Aerofoil', disabled: !!editing, oninput: debounce(async e => { st.name = e.target.value; await checkName(); refresh(); }, 300) });
      async function checkName() {
        if (!st.name.trim()) { check.textContent = 'Type a name, or press Suggest names.'; return; }
        try { const r = await api.post(`${P}/name`, { name: st.name }); check.replaceChildren(r.problem ? h('span', { style: 'color:var(--c-bad-soft)' }, r.problem) : h('span', { style: 'color:var(--c-good)' }, `✔ Its id: ${editing ?? st.name.trim().toLowerCase().replace(/[-'’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`)); } catch (e) { check.textContent = errText(e); }
      }
      checkName();
      return [
        h('label', {}, 'Name', input), check,
        editing ? h('p', { class: 'muted' }, 'A family\'s name and id stay as they are: its parts\' ids come from it, and players own them.') : h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: async () => { try { const r = await api.post(`${P}/names`, { kind: st.kind, seed: seed++ }); sugg.replaceChildren(...r.names.map(n => pill(n, n === st.name, () => { st.name = n; input.value = n; checkName(); refresh(); draw(); }))); } catch (e) { say(msg, errText(e)); } } }, 'Suggest names'), sugg),
        h('p', { class: 'muted' }, 'Everything in the game is made up: a name like a real make, model or part brand (data/content/real-names.json) is refused.'),
      ];
    }
    // a setting's (or shape setting's) values: tick boxes, or numbers within its range (each value, or from, to, step)
    function valuesControl(s, x, { onChange }) {
      if (s.type === 'values' || s.type === 'table' || s.type === 'cars' || s.type === 'kit') {
        const items = s.type === 'table' ? s.entries.map(e => [e.id, e.label, Object.entries(e).filter(([k]) => !['id', 'label'].includes(k)).map(([k, v]) => `${k} ${v}`).join(', ')]) : s.type === 'cars' ? s.values.map(c => [c.id, c.name, '']) : s.values.map(v => [v, String(v), '']);
        return h('div', { class: 'row' }, ...items.map(([v, label, more]) => pill(label, x.list.some(y => y === v), () => { x.list = x.list.some(y => y === v) ? x.list.filter(y => y !== v) : [...x.list, v]; onChange(); }, more || null)));
      }
      if (s.type !== 'range') return h('span', { class: 'muted' }, 'nothing to pick');
      const [lo, hi] = s.range, wrap = h('div', { class: 'list' });
      const mode = h('select', { onchange: e => { x.mode = e.target.value; if (x.mode === 'step') Object.assign(x, { from: x.from ?? lo, to: x.to ?? hi, step: x.step ?? s.step }); onChange(); } }, h('option', { value: 'list', selected: x.mode !== 'step' }, 'values'), h('option', { value: 'step', selected: x.mode === 'step' }, 'from, to, step'));
      const num = (val, set) => h('input', { type: 'number', value: val ?? '', min: lo, max: hi, step: s.integer ? 1 : 'any', style: 'width:110px', onchange: e => { const n = +e.target.value; if (e.target.value === '' || !Number.isFinite(n) || n < lo || n > hi || (s.integer && !Number.isInteger(n))) { e.target.value = val ?? ''; say(msg, `${s.label}: ${lo}–${hi}${s.unit ? ` ${s.unit}` : ''}${s.integer ? ', whole numbers' : ''}.`); return; } set(n); onChange(); } });
      if (x.mode === 'step') {
        const count = [x.from, x.to, x.step].every(Number.isFinite) && x.step > 0 ? Math.floor((x.to - x.from) / x.step + 1e-9) + 1 : 0;
        wrap.append(h('div', { class: 'row' }, mode, h('label', {}, 'from', num(x.from, n => x.from = n)), h('label', {}, 'to', num(x.to, n => x.to = n)), h('label', {}, 'step', h('input', { type: 'number', value: x.step ?? '', min: s.integer ? 1 : 0, step: 'any', style: 'width:90px', onchange: e => { const n = +e.target.value; if (!(n > 0)) { e.target.value = x.step ?? ''; return; } x.step = n; onChange(); } })), h('span', { class: 'muted' }, `${count} value${count === 1 ? '' : 's'}`)));
      } else {
        const add = num(null, n => { if (!x.list.includes(n)) x.list = [...x.list, n].sort((a, b) => a - b); });
        wrap.append(h('div', { class: 'row' }, mode, ...x.list.map(v => pill(`${fmt(v, s.unit)} ✕`, true, () => { x.list = x.list.filter(y => y !== v); onChange(); })), h('label', {}, 'add a value', add)));
      }
      return wrap;
    }
    const rangeWords = s => s.type === 'range' ? `${s.range[0]}–${s.range[1]}${s.unit ? ` ${s.unit}` : ''}${s.integer ? ', whole' : ''}` : s.type === 'table' ? `${s.entries.length} to pick from` : s.type === 'kit' ? `kit pieces: ${s.values.join(', ')}` : s.type === 'cars' ? 'one per car' : `${s.values.length} to pick from`;
    // 3. settings
    function stepSettings() {
      return [h('p', { class: 'muted' }, 'A part for every combination of the values picked. Only values inside the allowed ranges can be picked. A setting left empty takes its default.'),
        ...opts.settings.map(s => h('div', { class: 'action' }, h('div', {}, h('b', {}, s.label), ' ', h('span', { class: 'muted' }, `allowed: ${rangeWords(s)}${s.default != null ? ` · default ${fmt(s.default, s.unit)}` : s.defaultFormula ? ` · default from ${s.defaultFormula}` : ''}${s.shapes ? ' · changes the model' : ''}`)), valuesControl(s, st.settings[s.key], { onChange: changed })))];
    }
    // 4. shape
    function stepShape() {
      return [h('p', { class: 'muted' }, 'How it looks (the model generator\'s shape settings, data/content/formulas.json shapeSettings). Each fixed for the whole family, or varied — each value makes more parts. Those marked "changes its stats" change what it does too.'),
        ...opts.shape.map(s => {
          const x = st.shape[s.key], set = v => { x.value = v; st.explicit.add(s.key); changed(); };
          let control;
          if (x.vary) control = valuesControl(s.type === 'kit' ? { ...s, type: 'values' } : s, x, { onChange: () => { st.explicit.add(s.key); changed(); } });
          else if (s.type === 'range') {
            const [lo, hi] = s.range;
            control = h('div', { class: 'row', style: 'align-items:center' },
              h('input', { type: 'range', min: lo, max: hi, step: s.step, value: x.value ?? s.default ?? lo, style: 'flex:1', oninput: e => { x.value = +e.target.value; st.explicit.add(s.key); valueEl.textContent = fmt(x.value, s.unit); refreshShape(); }, onchange: () => changed() }),
              s.default == null && pill('auto', x.value == null, () => set(null), 'left to the generator: worked out from the part'));
            const valueEl = h('span', { class: 'muted' }, fmt(x.value, s.unit));
            control.append(valueEl);
          } else {
            const items = s.type === 'table' ? s.entries.map(e => [e.id, e.label]) : s.values.map(v => [v, String(v)]);
            control = h('select', { onchange: e => set(items.find(([v]) => String(v) === e.target.value)?.[0]) }, ...items.map(([v, l]) => h('option', { value: String(v), selected: x.value === v }, l)));
          }
          return h('div', { class: 'action' }, h('div', { class: 'row', style: 'align-items:center' }, h('b', {}, s.label), h('span', { class: 'muted' }, `allowed: ${rangeWords(s)} · default ${fmt(s.default, s.unit)}${s.stats ? ' · changes its stats' : ''}`),
            pill(x.vary ? 'varied' : 'fixed', x.vary, () => { x.vary = !x.vary; if (x.vary && !x.list?.length) x.list = x.value != null ? [x.value] : []; changed(); }, 'fixed for the whole family, or varied: a part for each value')), control);
        })];
    }
    // 5. finishes
    function stepFinishes() {
      return [h('p', { class: 'muted' }, 'Each finish is a variant of every part: the same shape and stats, its own look, its price × (kept in the tier\'s band) and, where the finish is what it\'s made of, its mass ×.'),
        h('div', { class: 'row' }, ...opts.finishes.map(f => pill(`${f.label} (price × ${f.price}${f.mass !== 1 ? `, mass × ${f.mass}` : ''})`, st.finishes.includes(f.id), () => { st.finishes = st.finishes.includes(f.id) ? st.finishes.filter(x => x !== f.id) : [...st.finishes, f.id]; changed(); })))];
    }
    // 6. aim
    function stepAim() {
      const num = (k, i, ph) => h('input', { type: 'number', value: st.aim[k][i] ?? '', placeholder: ph, style: 'width:120px', onchange: e => { st.aim[k][i] = e.target.value === '' ? '' : +e.target.value; changed(); } });
      return [h('p', { class: 'muted' }, 'Optional: what you want it to be. The summary warns when the settings won\'t land there, and suggests which to change.'),
        h('div', { class: 'row' }, ...opts.tiers.map(t => pill(`${t.tier} (${money(t.price[0])}–${money(t.price[1])}, levels ${t.unlock?.join('–') ?? '1'})`, st.aim.tiers.includes(t.tier), () => { st.aim.tiers = st.aim.tiers.includes(t.tier) ? st.aim.tiers.filter(x => x !== t.tier) : [...st.aim.tiers, t.tier]; changed(); }))),
        h('div', { class: 'row' }, h('label', {}, 'Price from ($)', num('price', 0, 'any')), h('label', {}, 'to', num('price', 1, 'any')), h('label', {}, 'Unlock level from', num('unlock', 0, 'any')), h('label', {}, 'to', num('unlock', 1, 'any')))];
    }
    // 7. fits
    function stepFits() {
      const f = last?.fits;
      if (!f) return [h('p', { class: 'muted' }, 'Pick its settings first: the cars it fits come from them.')];
      return [h('p', { class: 'muted' }, `It goes on ${f.total} of ${f.cars.length} cars, by the standards its parts need (its settings decide them: a wing's mounting, a seat's rails, a wheel's size). Leave a car out if it shouldn't have it.`),
        h('table', {}, h('tr', {}, h('th', {}, 'Car'), h('th', {}, 'Parts that fit'), h('th', {}, 'Leave it off')), ...f.cars.map(c => h('tr', {}, h('td', {}, c.name), h('td', {}, String(c.parts)),
          h('td', {}, h('input', { type: 'checkbox', checked: !!st.leaveOff[c.id], onchange: e => { if (e.target.checked) { const why = prompt(`Why leave it off the ${c.name}? (it goes in the family file)`, 'it doesn\'t suit it'); if (!why) { e.target.checked = false; return; } st.leaveOff[c.id] = why; } else delete st.leaveOff[c.id]; changed(); } }))))),
        h('h3', {}, 'Standards'), h('table', {}, ...f.standards.map(s => h('tr', {}, h('td', {}, s.tag), h('td', {}, `${s.cars.length} car${s.cars.length === 1 ? '' : 's'}: ${s.cars.join(', ') || 'none'}`))))];
    }

    // the live summary: every part it'd make, what stops it, what to look at
    const refresh = debounce(async () => {
      if (!opts) { sumEl.replaceChildren(h('p', { class: 'muted' }, 'Pick what it is to start.')); return; }
      try { last = await api.post(`${P}/summary`, { family: toDef(st, opts), editing }); }
      catch (e) { sumEl.replaceChildren(h('div', { class: 'msg bad' }, errText(e), ...(e.details ?? []).slice(1, 6).map(d => h('div', {}, d.problem ?? JSON.stringify(d))))); return; }
      drawSummary();
      if (st.step === 6) draw();
      refreshShape();
    }, 350);
    function drawSummary() {
      const s = last, made = s.parts.filter(p => p.made), prices = made.map(p => p.price);
      const statKeys = opts.stats.map(x => x.key), varying = [...new Set(s.parts.flatMap(p => [...Object.keys(p.settings), ...Object.keys(p.shape)]))];
      sumEl.replaceChildren(
        h('div', { class: 'row', style: 'align-items:center' }, h('b', { style: 'font-size:20px' }, `${s.count} part${s.count === 1 ? '' : 's'}`), ...Object.entries(s.byTier).map(([t, n]) => badge(`${n} ${t}`)), prices.length ? h('span', { class: 'muted' }, `${money(Math.min(...prices))}–${money(Math.max(...prices))}`) : ''),
        ...s.problems.map(p => h('div', { class: 'msg bad' }, p)),
        s.notMade.length ? h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: () => { for (const n of s.notMade) { const p = s.parts.find(x => x.id === n.id); if (p) st.skip.push({ ...p.settings, ...p.shape, finish: p.finish }); } changed(); } }, `Skip the ${s.notMade.length} that can't be made`)) : '',
        ...s.warnings.map(w => h('div', { class: 'msg', style: 'background:var(--c-raised);color:var(--c-text-2)' }, w)),
        ...(s.suggestions ?? []).map(x => h('div', { class: 'msg good' }, `To hit the aim — ${x.words}`)),
        s.changes ? changesView(s.changes) : '',
        h('div', { style: 'max-height:420px;overflow:auto' }, h('table', { style: 'font-size:12px;white-space:nowrap' }, h('tr', {}, h('th', {}, 'Part'), ...varying.map(k => h('th', {}, k)), h('th', {}, 'finish'), h('th', {}, 'Tier'), h('th', {}, 'Price'), h('th', {}, 'Level'), ...statKeys.map(k => { const x = opts.stats.find(y => y.key === k); return h('th', { title: x.label }, x.label.length > 14 ? `${x.label.slice(0, 13)}…` : x.label); })),
          ...s.parts.slice(0, 400).map(p => h('tr', { style: p.made ? '' : 'opacity:.55' }, h('td', { title: p.name }, p.id, p.made ? '' : h('div', { style: 'color:var(--c-bad-soft);white-space:normal' }, p.why)), ...varying.map(k => h('td', {}, fmt(p.settings[k] ?? p.shape[k]))), h('td', {}, p.finish), h('td', {}, p.tier ?? '—'), h('td', {}, money(p.price)), h('td', {}, p.unlock ?? '—'),
            ...statKeys.map(k => { const x = p.stats[k]; const out = x?.range && (x.value < x.range[0] || x.value > x.range[1]); return h('td', { style: out ? 'color:var(--c-bad-soft)' : '' }, x?.words ?? '—'); }))))),
        s.parts.length > 400 ? h('p', { class: 'muted' }, `… and ${s.parts.length - 400} more`) : '',
        h('details', {}, h('summary', {}, `The file it writes: data/families/${s.id}.json`), h('pre', { style: 'white-space:pre-wrap;font:12px var(--f-mono)' }, s.text)),
      );
    }
    function changesView(c) {
      const line = (title, list, fn) => list.length ? h('div', {}, h('b', {}, `${title} (${list.length})`), h('div', { class: 'muted' }, list.slice(0, 30).map(fn).join(' · '), list.length > 30 ? ` … and ${list.length - 30} more` : '')) : '';
      return h('div', { class: 'action' }, h('b', {}, 'What saving changes'),
        line('Added', c.added, x => `${x.id}${x.back ? ' (back again)' : ''}`),
        line('Changed', c.changed, x => `${x.id}: ${x.changes.map(ch => ch.field === 'model' ? 'its model' : `${ch.field} ${fmt(ch.from)} → ${fmt(ch.to)}`).join(', ')}`),
        line('Retired (not sold; players keep theirs)', c.retired, x => `${x.id} — ${x.players} player${x.players === 1 ? '' : 's'} own${x.players === 1 ? 's' : ''} one`),
        h('div', { class: 'muted' }, `${c.same.length} the same. Ids don't change for parts it still makes; players keep the published version of a changed part until it's published again.`));
    }
    // the live 3D shape: one part's model as it is now
    const refreshShape = debounce(async () => {
      if (!opts || !last || last.problems.some(p => /can't be made|isn't one there is|outside/.test(p))) return;
      const ids = last.parts.filter(p => p.made).map(p => p.id);
      if (!shapePart || !ids.includes(shapePart)) shapePart = last.previewPicks?.[0] ?? ids[0] ?? null;
      viewWhy.replaceChildren(h('span', {}, 'Making its model…'));
      try {
        const m = await api.post(`${P}/shape`, { family: toDef(st, opts), part: shapePart, editing });
        preview3d ??= await shapeViewer();
        if (preview3d.el.parentNode !== viewEl) viewEl.replaceChildren(preview3d.el);
        await preview3d.show(m.glb);
        const pick = h('select', { onchange: e => { shapePart = e.target.value; refreshShape(); } }, ...[...new Set([...(last.previewPicks ?? []), ...ids.slice(0, 40)])].map(id => h('option', { value: id, selected: id === m.id }, id)));
        viewWhy.replaceChildren(h('div', { class: 'row', style: 'align-items:center' }, h('label', {}, 'Part', pick), h('span', {}, `${m.triangles.toLocaleString('en-GB')} triangles (budget ${m.budget.toLocaleString('en-GB')})${m.fitted ? ' — on its own: made to fit each car when it\'s built' : ''}`)), ...m.findings.map(f => h('div', { style: `color:var(--c-${f.level === 'fail' ? 'bad-soft' : 'text-2'})` }, `${f.level}: ${f.text}`)));
      } catch (e) { viewWhy.textContent = `No shape preview: ${errText(e)}`; }
    }, 450);

    // preview a few parts (a job): their models, thumbnails, and each on a car
    async function doPreview() {
      if (!opts) return say(msg, 'Pick what it is first.');
      try {
        const r = await api.post(`${P}/preview`, { family: toDef(st, opts), editing, reason: 'previewing a family in the builder' });
        previewEl.replaceChildren(h('h3', {}, 'Preview'), h('p', { class: 'muted' }, `Making ${r.picks.length} part${r.picks.length === 1 ? '' : 's'}' models: ${r.picks.join(', ')}. Nothing is saved as a part.`));
        const done = await follow(r.job.id, previewEl);
        if (done?.state === 'done') showPreview(done, previewEl);
      } catch (e) { say(msg, `${errText(e)}${e.details?.length ? ` — ${e.details.slice(1, 4).map(d => d.problem).join('; ')}` : ''}`); }
    }
    async function doMake() {
      if (!opts) return say(msg, 'Pick what it is first.');
      const fam = toDef(st, opts);
      let s;
      try { s = await api.post(`${P}/summary`, { family: fam, editing }); } catch (e) { return say(msg, errText(e)); }
      if (s.problems.length) return say(msg, `It can't be made yet: ${s.problems[0]}`);
      const c = s.changes, words = editing ? `Save the changes to ${def.name}: ${c.added.length} added, ${c.changed.length} changed, ${c.retired.length} retired${c.retired.some(x => x.players) ? ` (${c.retired.reduce((n, x) => n + x.players, 0)} players own retired ones: they keep them)` : ''}. Its file is written, then it's built and checked (a job).` : `Make ${fam.name}: ${s.count} draft parts. Its file is written, then it's built and checked (a job).`;
      const why = ask(words);
      if (!why) return;
      try {
        const r = editing ? await api.put(`${P}/families/${editing}`, { family: fam, reason: why }) : await api.post(`${P}/families`, { family: fam, reason: why });
        say(msg, `Writing ${r.file} and building it…`, true);
        jobEl.replaceChildren(h('details', { open: true }, h('summary', {}, `The file: ${r.file}`), h('pre', { style: 'white-space:pre-wrap;font:12px var(--f-mono)' }, r.text)));
        const done = await follow(r.job.id, jobEl, { keep: true });
        if (done?.state === 'done') { say(msg, `Made: ${done.result.words} Showing its parts.`, true); setTimeout(() => showFamily(done.target), 1500); }
        else if (done) say(msg, `${done.state === 'cancelled' ? 'Cancelled' : 'It failed'}: nothing it did is kept. ${done.error ?? ''}`);
      } catch (e) { say(msg, `${errText(e)}${e.details?.length ? ` — ${e.details.slice(1, 4).map(d => d.problem).join('; ')}` : ''}`); }
    }
    async function savePreset() {
      if (!opts) return say(msg, 'Pick what it is first.');
      const name = prompt('The preset\'s name (data/content/presets/<name>.json):', st.name ? `${st.name} setup` : `${opts.label} setup`);
      if (!name) return;
      const why = ask(`Save the preset "${name}"?`);
      if (!why) return;
      try { const r = await api.post(`${P}/presets`, { name, family: toDef(st, opts), reason: why }); say(msg, `Saved ${r.file}.`, true); } catch (e) { say(msg, errText(e)); }
    }
    if (history.length) sumEl.append(h('p', { class: 'muted' }, `Last changed ${when(history[0].at)} by ${history[0].actor ?? '—'}: ${history[0].action} (${history[0].reason})`));
    draw(); refresh();
  }

  // ---------- jobs ----------
  // A job's progress, log and result, followed until it ends (→ the job as it ended)
  async function follow(id, el, { keep = false } = {}) {
    const box = h('div', { class: 'action' });
    if (keep) el.append(box); else el.append(box);
    for (;;) {
      let j;
      try { j = await api.get(`${P}/jobs/${id}`); } catch (e) { box.replaceChildren(h('div', { class: 'msg bad' }, errText(e))); return null; }
      box.replaceChildren(...jobView(j, { full: true }));
      if (!['waiting', 'running'].includes(j.state)) return j;
      await new Promise(r => setTimeout(r, 1200));
    }
  }
  function jobView(j, { full = false } = {}) {
    const kind = { done: 'editor', failed: 'banned', cancelled: '', running: 'admin', waiting: '' }[j.state];
    const pct = j.progress?.total ? Math.round(100 * j.progress.done / j.progress.total) : null;
    const logLines = (full ? j.log.slice(-40) : j.log.slice(-3));
    return [
      h('div', { class: 'row', style: 'align-items:center' }, h('b', {}, j.title), badge(j.state, kind), j.step ? h('span', { class: 'muted' }, j.step) : '', j.waitingFor ? h('span', { class: 'muted' }, `waiting for: ${j.waitingFor}`) : '',
        ['waiting', 'running'].includes(j.state) && h('button', { class: 'btn ghost', onclick: async () => { const why = ask(`Cancel "${j.title}"? Nothing it did is kept.`); if (!why) return; try { await api.post(`${P}/jobs/${j.id}/cancel`, { reason: why }); } catch (e) { alert(errText(e)); } } }, 'Cancel')),
      pct != null && j.state === 'running' ? h('div', { style: 'height:6px;background:var(--c-raised);border-radius:3px' }, h('div', { style: `height:6px;width:${pct}%;background:var(--c-accent);border-radius:3px` })) : '',
      h('div', { class: 'muted' }, `${j.by?.name ?? '—'} · ${when(j.created)}${j.reason ? ` · why: ${j.reason}` : ''}`),
      h('pre', { style: 'white-space:pre-wrap;font:12px var(--f-mono);max-height:260px;overflow:auto;margin:0' }, logLines.map(l => l.text).join('\n')),
      j.error ? h('div', { class: 'msg bad' }, j.error, ...(j.problems ?? []).slice(0, 8).map(p => h('div', {}, p))) : '',
      j.result?.words ? h('div', { class: 'msg good' }, j.result.words) : '',
      j.result?.failingDrafts?.length ? h('div', { class: 'muted' }, `Failing a check (fix them before review): ${j.result.failingDrafts.map(d => `${d.id}: ${d.problems[0]}`).slice(0, 6).join(' · ')}`) : '',
      j.state === 'done' && j.type !== 'preview' && j.type !== 'car' ? h('button', { class: 'btn secondary', onclick: () => showFamily(j.type === 'build' ? j.target.split(',')[0] : j.target) }, 'Show its parts') : '',
      j.state === 'done' && j.type === 'car' ? h('button', { class: 'btn secondary', onclick: () => carView(j.target) }, 'Show the car') : '',
    ];
  }
  async function showJobs() {
    const ov = await ready();
    if (!ov) return;
    const list = h('div', { class: 'list' });
    page([h('h2', {}, 'Jobs'), h('p', { class: 'muted' }, 'Build and check, run in the background on this server (tools/content/jobs.mjs): one per family at a time; a failed or cancelled job puts everything back as it was.'), list, h('button', { class: 'btn ghost', onclick: () => showHome() }, 'Back to Builder')], [h('h2', {}, 'Presets'), presetList(ov.presets)], 'minmax(0, 1.4fr) minmax(0, 1fr)');
    for (;;) {
      if (!list.isConnected) return;
      let jobs;
      try { jobs = (await api.get(`${P}/jobs`)).jobs; } catch (e) { list.replaceChildren(h('div', { class: 'msg bad' }, errText(e))); return; }
      list.replaceChildren(...(jobs.length ? jobs.map(j => h('div', { class: 'action' }, ...jobView(j))) : [h('p', { class: 'muted' }, 'No jobs since the server started.')]));
      await new Promise(r => setTimeout(r, jobs.some(j => ['waiting', 'running'].includes(j.state)) ? 1500 : 5000));
    }
  }

  // ---------- previews ----------
  function showPreview(j, el) {
    const parts = j.result.parts, file = f => `/api/v1${P}/files/${j.id}/${f.split('/').pop()}`;
    const view = h('div', { style: 'position:relative;height:320px;border-radius:var(--r-card);overflow:hidden;background:#15191d' }), why = h('div', { class: 'muted' });
    let shown = null;
    async function onCar(p, car) {
      why.textContent = 'Loading…';
      try {
        const r = await api.get(`${P}/preview/${j.id}/${p.id}/${car}`);
        shown ??= await makePreview();
        if (shown.el.parentNode !== view) view.replaceChildren(shown.el);
        await shown.show(r, p.id);
        why.textContent = r.fitted ? (r.with.length ? `Fitted with what it needs: ${r.with.join(', ')}.` : 'Fitted as the shop fits it.') : `It wouldn't go on as the car is: ${r.why}`;
      } catch (e) { why.textContent = `No preview: ${errText(e)}`; }
    }
    // (a fitted kind's: the cars its models were fitted to; the others': every car it goes on)
    const carsFor = p => p.car ? [p.car, ...Object.keys(p.byCar ?? {})] : p.cars ?? [];
    el.append(view, why,
      h('div', { class: 'actions' }, ...parts.map(p => h('div', { class: 'action' },
        p.thumb ? h('img', { src: file(p.thumb), width: 240, height: 150, alt: 'Studio thumbnail', style: 'border-radius:4px;object-fit:cover' }) : p.icon ? h('img', { src: file(p.icon), width: 72, height: 72, alt: '' }) : '',
        h('b', {}, p.name), h('span', { class: 'muted' }, `${p.id} · ${p.triangles?.toLocaleString('en-GB') ?? '?'} triangles${Object.keys(p.fit ?? {}).length ? ` · fitted to ${Object.entries(p.fit).map(([c, n]) => `${c}${n ? ` (${n} clashes)` : ''}`).join(', ')}` : ''}`),
        ...p.findings.map(f => h('div', { style: `color:var(--c-${f.level === 'fail' ? 'bad-soft' : 'text-2'})` }, `${f.level}: ${f.text}`)),
        (() => { const sel = h('select', {}, ...carsFor(p).map(c => h('option', { value: c }, c))); return h('div', { class: 'row' }, h('label', {}, 'On a car', sel), h('button', { class: 'btn ghost', onclick: () => onCar(p, sel.value) }, 'Show it')); })()))));
  }

  // ---------- presets and variations ----------
  function presetList(presets) {
    return h('div', { class: 'list' }, ...(presets.length ? presets.map(p => h('div', { class: 'action' }, h('b', {}, p.name), h('span', { class: 'muted' }, `${p.kind} · ${p.file}`),
      h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: () => newFamily({ ...p, name: '' }) }, 'New family from it'), h('button', { class: 'btn ghost', onclick: () => variations({ preset: p.name }) }, 'Make variations'),
        h('button', { class: 'btn ghost', onclick: async () => { const why = ask(`Delete the preset ${p.name} (${p.file})?`); if (!why) return; try { await api.del(`${P}/presets/${encodeURIComponent(p.name)}`, { reason: why }); showJobs(); } catch (e) { alert(errText(e)); } } }, 'Delete')))) : [h('p', { class: 'muted' }, 'No presets yet: in the family form, Save as preset.')]));
  }
  async function variations(from = null) {
    const ov = await ready();
    if (!ov) return;
    const msg = h('div'), keysEl = h('div', { class: 'row' }), out = h('div', { class: 'list' }), st = { from, vary: [], count: 4, seed: 1, plan: [], picked: new Set() };
    const src = h('select', { onchange: async e => { const [t, id] = e.target.value.split(':'); st.from = t === 'family' ? { family: id } : t === 'preset' ? { preset: id } : null; st.vary = []; await drawKeys(); } }, h('option', { value: '' }, '—'),
      ...ov.kinds.flatMap(k => k.families.map(f => h('option', { value: `family:${f.id}`, selected: from?.family === f.id }, `${f.name} (family)`))), ...ov.presets.map(p => h('option', { value: `preset:${p.name}`, selected: from?.preset === p.name }, `${p.name} (preset)`)));
    const kindOf = () => st.from?.family ? ov.kinds.find(k => k.families.some(f => f.id === st.from.family))?.kind : st.from?.preset ? ov.presets.find(p => p.name === st.from.preset)?.kind : null;
    async function drawKeys() {
      const k = kindOf();
      if (!k) { keysEl.replaceChildren(h('span', { class: 'muted' }, 'Pick a family or a preset to start from.')); return; }
      const o = await api.get(`${P}/kinds/${k}`);
      keysEl.replaceChildren(...[...o.settings.filter(s => s.type !== 'cars').map(s => [s.key, `${s.label}`]), ...o.shape.map(s => [s.key, `${s.label} (shape)`])].map(([key, label]) => pill(label, st.vary.includes(key), () => { st.vary = st.vary.includes(key) ? st.vary.filter(x => x !== key) : [...st.vary, key]; drawKeys(); })));
    }
    async function plan() {
      if (!st.from || !st.vary.length) return say(msg, 'Pick what to start from and what to vary.');
      try { st.plan = (await api.post(`${P}/variations/plan`, { from: st.from, vary: st.vary, count: st.count, seed: st.seed })).variations; st.picked = new Set(st.plan.map((_, i) => i).filter(i => !st.plan[i].summary.problems.length)); drawPlan(); }
      catch (e) { say(msg, errText(e)); }
    }
    function drawPlan() {
      out.replaceChildren(...st.plan.map((v, i) => {
        const prev = h('div', { class: 'list' });
        return h('div', { class: 'action' },
          h('div', { class: 'row', style: 'align-items:center' }, h('input', { type: 'checkbox', checked: st.picked.has(i), onchange: e => { e.target.checked ? st.picked.add(i) : st.picked.delete(i); } }),
            h('input', { value: v.def?.name ?? '', maxlength: 24, onchange: e => { v.def.name = e.target.value; delete v.def.id; } }), h('span', { class: 'muted' }, Object.entries(v.varied).map(([k, x]) => `${k} ${fmt(x)}`).join(', '))),
          h('div', { class: 'muted' }, `${v.summary.count} parts · ${Object.entries(v.summary.byTier).map(([t, n]) => `${n} ${t}`).join(', ')}${v.summary.price ? ` · ${money(v.summary.price[0])}–${money(v.summary.price[1])}` : ''}${v.summary.unlock ? ` · levels ${v.summary.unlock.join('–')}` : ''}`),
          ...v.summary.problems.map(p => h('div', { style: 'color:var(--c-bad-soft)' }, p)), ...v.summary.warnings.slice(0, 3).map(w => h('div', { class: 'muted' }, w)),
          h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: async () => { try { const r = await api.post(`${P}/preview`, { family: v.def, reason: 'previewing a variation' }); const d = await follow(r.job.id, prev); if (d?.state === 'done') showPreview(d, prev); } catch (e) { say(msg, errText(e)); } } }, 'Preview'),
            h('button', { class: 'btn ghost', onclick: () => newFamily(v.def) }, 'Open in the form')), prev);
      }), st.plan.length ? h('button', { class: 'btn primary', onclick: makeThem }, 'Make the ticked ones') : '');
    }
    async function makeThem() {
      const picked = [...st.picked].map(i => st.plan[i].def).filter(Boolean);
      if (!picked.length) return say(msg, 'Tick the ones to make.');
      const why = ask(`Make ${picked.length} new draft famil${picked.length === 1 ? 'y' : 'ies'}: ${picked.map(d => d.name).join(', ')}? Each is written, then built and checked (a job each).`);
      if (!why) return;
      try { const r = await api.post(`${P}/variations`, { families: picked.map(({ _note, id, status, ...d }) => d), reason: why }); say(msg, `${r.made.length} jobs started.`, true); showJobs(); }
      catch (e) { say(msg, `${errText(e)}${e.details?.length ? ` — ${e.details.slice(1, 4).map(d => d.problem).join('; ')}` : ''}`); }
    }
    page([h('h2', {}, 'Make variations'), h('p', { class: 'muted' }, 'Several new draft families at once, from a preset or a family: the same but for the settings and shape settings you pick (new materials, a budget, middle and top build, new designs). Each gets an invented name, checked against real brands; preview any before making.'),
      h('label', {}, 'Start from', src), h('h3', {}, 'Vary'), keysEl,
      h('div', { class: 'row' }, h('label', {}, 'How many', h('input', { type: 'number', value: st.count, min: 1, max: ov.config.variations.max, onchange: e => { st.count = Math.max(1, Math.min(ov.config.variations.max, +e.target.value || 1)); } })), h('label', {}, 'Mix (seed)', h('input', { type: 'number', value: st.seed, min: 0, onchange: e => { st.seed = +e.target.value || 0; } })), h('button', { class: 'btn secondary', onclick: plan }, 'Plan them')),
      msg, h('button', { class: 'btn ghost', onclick: () => showHome() }, 'Back to Builder')],
    [h('h2', {}, 'The variations'), out, h('h3', {}, 'Presets'), presetList(ov.presets)]);
    drawKeys();
  }

  // ---------- engines ----------
  async function newEngine() { return engineForm(null); }
  async function engineForm(editing) {
    const ov = await ready();
    if (!ov) return;
    const o = await api.get(`${P}/engines`), cur = editing ? (await api.get(`${P}/engines/${editing}`)).def : { maker: o.makers[0], layout: 'inline', cylinders: 4, displacement: 2, aspiration: 'natural', idle: 850, redline: 7000, character: 0.5, mount: 'long', sound: 'i4', colour: 'grey' };
    const e = { ...cur, id: editing ?? cur.id ?? '' }, msg = h('div'), sum = h('div', { class: 'list' });
    const R = o.ranges, field = (k, label, input) => h('label', {}, label, input);
    const num = (k, range, step = 'any') => h('input', { type: 'number', value: e[k] ?? '', min: range?.[0], max: range?.[1], step, onchange: ev => { e[k] = ev.target.value === '' ? undefined : +ev.target.value; refresh(); } });
    const sel = (k, items) => h('select', { onchange: ev => { e[k] = ev.target.value; refresh(); } }, ...items.map(([v, l]) => h('option', { value: v, selected: e[k] === v }, l)));
    const refresh = debounce(async () => {
      try { const s = await api.post(`${P}/engines/summary`, { engine: clean(), editing }); drawSum(s); } catch (err) { sum.replaceChildren(h('div', { class: 'msg bad' }, errText(err))); }
    }, 300);
    const clean = () => { const x = { ...e }; for (const k of Object.keys(x)) if (x[k] === undefined || x[k] === '') delete x[k]; if (x.aspiration === 'natural') delete x.boost; delete x._note; return x; };
    function drawSum(s) {
      sum.replaceChildren(...s.problems.map(p => h('div', { class: 'msg bad' }, p)),
        s.part ? h('div', { class: 'row', style: 'align-items:center' }, h('b', { style: 'font-size:18px' }, s.name), badge(s.part.tier), h('span', {}, `${money(s.part.price)} · level ${s.part.unlock}`)) : '',
        s.curve ? curveChart(s.curve, e.redline) : '',
        s.part ? h('dl', {}, h('dt', {}, 'Power'), h('dd', {}, `${s.power} hp`), h('dt', {}, 'Torque'), h('dd', {}, `${s.torque} N·m`), h('dt', {}, 'Mass'), h('dd', {}, `${s.mass} kg`), h('dt', {}, 'Size'), h('dd', {}, `${s.size.join(' × ')} m: a ${s.bay} bay or bigger`), h('dt', {}, 'Needs'), h('dd', {}, s.part.requires.join(', ') || 'nothing else')) : '',
        s.cars ? h('table', {}, h('tr', {}, h('th', {}, 'Car'), h('th', {}, 'It goes in?')), ...s.cars.map(c => h('tr', {}, h('td', {}, c.name), h('td', { style: c.fits ? 'color:var(--c-good)' : 'color:var(--c-text-3)' }, c.fits ? '✔' : c.why)))) : '',
        s.note ? h('p', { class: 'muted' }, s.note) : '',
        h('details', {}, h('summary', {}, `The file it writes: data/engines/${s.def?.id ?? '…'}.json`), h('pre', { style: 'white-space:pre-wrap;font:12px var(--f-mono)' }, s.text ?? '')));
    }
    async function make() {
      const why = ask(`${editing ? 'Save the changes to' : 'Make'} the engine ${e.id}? Its file is written, then its crate engine is built and checked (a job).`);
      if (!why) return;
      try {
        const r = editing ? await api.put(`${P}/engines/${editing}`, { engine: clean(), reason: why }) : await api.post(`${P}/engines`, { engine: clean(), reason: why });
        const jobs = h('div', { class: 'list' }); sum.prepend(jobs);
        const done = await follow(r.job.id, jobs);
        if (done?.state === 'done') { say(msg, `Made: ${done.result.words}`, true); setTimeout(() => showFamily(done.target), 1500); }
      } catch (err) { say(msg, `${errText(err)}${err.details?.length ? ` — ${err.details.slice(1, 4).map(d => d.problem).join('; ')}` : ''}`); }
    }
    page([h('h2', {}, editing ? `Change engine: ${editing}` : 'New engine'), h('p', { class: 'muted' }, 'Everything in data/engines/<id>.json. Its torque curve, mass, size (its bay class) and price are worked out (data/content/formulas.json engines); its crate engine goes in every car with the same mount and a big enough bay.'),
      h('div', { class: 'row' }, field('id', 'Id', h('input', { value: e.id, disabled: !!editing, placeholder: 'like vmc_i6_30', onchange: ev => { e.id = ev.target.value.trim(); refresh(); } })), field('maker', 'Maker (made up)', sel('maker', o.makers.map(m => [m, m]))), field('name', 'Name (optional)', h('input', { value: e.name ?? '', onchange: ev => { e.name = ev.target.value.trim() || undefined; refresh(); } }))),
      h('div', { class: 'row' }, field('layout', 'Layout', sel('layout', o.layouts.map(l => [l.id, l.label]))), field('cylinders', `Cylinders (${R.cylinders.join('–')})`, num('cylinders', R.cylinders, 1)), field('displacement', `Displacement, L (${R.displacement.join('–')})`, num('displacement', R.displacement, 0.1))),
      h('div', { class: 'row' }, field('aspiration', 'Aspiration', sel('aspiration', o.aspirations.map(a => [a.id, a.label]))), field('boost', `Boost, bar (${R.boost.join('–')}, forced only)`, num('boost', R.boost, 0.05))),
      h('div', { class: 'row' }, field('idle', `Idle, rpm (${R.idle.join('–')})`, num('idle', R.idle, 10)), field('redline', `Redline, rpm (${R.redline.join('–')})`, num('redline', R.redline, 50)), field('character', 'Character (0 torquey … 1 peaky)', num('character', R.character, 0.05))),
      h('div', { class: 'row' }, field('mount', 'Mount', sel('mount', o.mounts.map(m => [m.id, m.label]))), field('sound', 'Sound', sel('sound', o.sounds.map(s => [s.id, `${s.id}${s.cylinders ? ` (${s.cylinders} cyl.)` : ''}`]))), field('colour', 'Colour', sel('colour', o.colours.map(c => [c, c])))),
      msg, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: make }, editing ? 'Save the changes' : 'Make the engine'), h('button', { class: 'btn ghost', onclick: () => showHome() }, 'Close'))],
    [h('h2', {}, 'What it comes to'), sum]);
    refresh();
  }
  // (the full-throttle torque curve, and the power from it)
  function curveChart(curve, redline) {
    const W = 520, H = 200, pad = 34, maxR = Math.max(...curve.map(p => p[0])), maxT = Math.max(...curve.map(p => p[1])), hp = curve.map(([r, t]) => [r, t * r / 7127]), maxP = Math.max(...hp.map(p => p[1]));
    const x = r => pad + (W - pad * 2) * r / maxR, y = (v, m) => H - pad - (H - pad * 2) * v / m;
    const ns = 'http://www.w3.org/2000/svg', el = (t, a) => { const n = document.createElementNS(ns, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Torque and power against rpm' });
    svg.append(el('line', { x1: pad, y1: H - pad, x2: W - pad, y2: H - pad, stroke: '#3a424b' }), el('line', { x1: x(redline), y1: pad / 2, x2: x(redline), y2: H - pad, stroke: '#ff5a5f', 'stroke-dasharray': '4 4' }));
    svg.append(el('polyline', { points: curve.map(([r, t]) => `${x(r)},${y(t, maxT)}`).join(' '), fill: 'none', stroke: '#36b3f5', 'stroke-width': 2.5 }), el('polyline', { points: hp.map(([r, p]) => `${x(r)},${y(p, maxP)}`).join(' '), fill: 'none', stroke: '#3dd68c', 'stroke-width': 2.5 }));
    for (const [t, cx, col] of [[`${Math.round(maxT)} N·m`, pad, '#36b3f5'], [`${Math.round(maxP)} hp`, W / 2, '#3dd68c'], [`${maxR} rpm`, W - pad - 60, '#8a939c']]) { const tx = el('text', { x: cx, y: 16, fill: col, 'font-size': 13 }); tx.textContent = t; svg.append(tx); }
    return svg;
  }

  // ---------- cars ----------
  async function newCar() {
    const ov = await ready();
    if (!ov) return;
    const c = { id: '', type: ov.carTypes[0]?.type, name: '' }, msg = h('div'), right = h('div', { class: 'list' });
    let model = null;
    const fileIn = h('input', { type: 'file', accept: '.glb,model/gltf-binary', onchange: async () => { const f = fileIn.files[0]; if (!f) { model = null; return; } const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); model = btoa(s); say(msg, `${f.name}: ${(b.length / 1e6).toFixed(1)} MB, checked by the import when it's made.`, true); } });
    async function make() {
      const why = ask(`Make the car ${c.id} (a ${c.type}${model ? ', from the model' : ', a placeholder in its proportions'})?`);
      if (!why) return;
      try { const r = await api.post(`${P}/cars`, { ...c, name: c.name || undefined, model, reason: why }); const done = await follow(r.job.id, right); if (done?.state === 'done') carView(done.target, right); }
      catch (e) { say(msg, `${errText(e)}${e.details?.length ? ` — ${e.details.slice(1, 4).map(d => d.problem).join('; ')}` : ''}`); }
    }
    page([h('h2', {}, 'New car'), h('p', { class: 'muted' }, 'npm run content -- new-car as a form: it starts from its type\'s body template (its proportions, sockets and standards: parts made to them fit it). Without a model it\'s a placeholder in the type\'s proportions — drive it straight away; the real model can come later (npm run import -- incoming/car_<id>.glb).'),
      h('div', { class: 'row' }, h('label', {}, 'Id', h('input', { placeholder: 'like comet_gt', onchange: e => { c.id = e.target.value.trim(); } })), h('label', {}, 'Type', h('select', { onchange: e => { c.type = e.target.value; } }, ...ov.carTypes.map(t => h('option', { value: t.type }, `${t.label} (from the ${t.donor})`)))), h('label', {}, 'Name (optional)', h('input', { onchange: e => { c.name = e.target.value.trim(); } }))),
      h('label', {}, 'Model (optional): car_<id>.glb, every socket of its template\'s car', fileIn), msg,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: make }, 'Make the car'), h('button', { class: 'btn ghost', onclick: () => showHome() }, 'Close'))],
    [h('h2', {}, 'The car'), right]);
  }
  async function carView(id, el = null) {
    const box = el ?? page([h('h2', {}, `The ${id}`), h('button', { class: 'btn ghost', onclick: () => showHome() }, 'Back to Builder')], []).children[1];
    const view = h('div', { style: 'position:relative;height:360px;border-radius:var(--r-card);overflow:hidden;background:#15191d' });
    box.append(view, h('p', { class: 'muted' }, `A draft: drive it at the test track (/?car=${id}), fill in its to-dos (price, physics), check, then publish it in the Content tab.`));
    try { const r = await api.get(`${P}/cars/${id}/preview`); const v = await makePreview(); view.replaceChildren(v.el); await v.show(r, null); } catch (e) { box.append(h('div', { class: 'msg bad' }, errText(e))); }
  }

  // ---------- the live shape preview's viewer: a model on its own (three.js) ----------
  async function shapeViewer() {
    const THREE = await import('three'), { OrbitControls } = await import('three/addons/controls/OrbitControls.js'), { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true }), el = renderer.domElement;
    el.style.width = '100%'; el.style.height = '100%';
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
    scene.background = new THREE.Color('#15191d');
    // (the game's sky as the environment: chrome and polished metal look as they do in the game, not black)
    try { const V = await import('../garage/visual.js'); scene.environment = V.skyEnvironment(renderer); } catch { /* lit by the lights alone */ }
    scene.add(new THREE.HemisphereLight('#dfe8f0', '#2a2d31', 1.4));
    const sun = new THREE.DirectionalLight('#ffffff', 2); sun.position.set(2, 4, 3); scene.add(sun);
    const controls = new OrbitControls(camera, el); controls.enableDamping = true;
    let current = null, framed = false;
    const loop = () => { if (!el.isConnected) return; const w = el.clientWidth, hh = el.clientHeight; if (w && hh && el.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix(); } controls.update(); renderer.render(scene, camera); };
    renderer.setAnimationLoop(loop);
    const loader = new GLTFLoader();
    return {
      el,
      async show(b64) {
        if (!renderer.getAnimationLoop?.()) renderer.setAnimationLoop(loop);
        const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
        const gltf = await loader.parseAsync(bin.buffer, '');
        if (current) scene.remove(current);
        current = gltf.scene; scene.add(current);
        // (framed once, so changing a setting doesn't move the camera — then kept)
        const box = new THREE.Box3().setFromObject(current), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 0.5;
        if (!framed) { controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(r * 1.6, r * 1.1, r * 2.2)); framed = true; }
        camera.near = r / 100; camera.far = r * 100; camera.updateProjectionMatrix();
      },
    };
  }

  return { showHome, newFamily, editFamily, editSource, newEngine, newCar, variations, showJobs };
}
