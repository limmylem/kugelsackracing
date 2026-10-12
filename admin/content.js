// The admin page's content manager (Phase 8 Step 3; docs/CONTENT_PIPELINE.md; server/src/content/manager.ts): every
// part and car — search and filter by slot, family, tier, status and problems; pick many for a bulk change (status,
// price, unlock level, tier); one in full: its checks, its stats with their allowed ranges (edit them, its price,
// tier, unlock level, name), its versions and history, and a 3D preview on any car it fits; CSV out and back in.
// Every change asks why (it goes in the log). Only published content reaches players; publishing needs passing checks.

export function createContentTools({ api, h, say, when, errText, main }) {
  const ask = (text, min = 3) => { const v = prompt(`${text}\n\nWhy? (required: it goes in the log)`); return v && v.trim().length >= min ? v.trim() : null; };
  const money = n => n == null ? '—' : `$${Number(n).toLocaleString('en-GB')}`;
  const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
  const STATUS_KIND = { draft: '', review: 'editor', published: 'admin' };
  const iconUrl = p => p ? (p.startsWith('/') ? p : `/${p}`) : null;
  const q = { kind: 'part', q: '', slot: '', family: '', tier: '', status: '', problems: '', offset: 0 };
  let picked = new Set(), shown = null, facets = null, preview = null;

  async function showContent() {
    const box = main();
    box.style.gridTemplateColumns = 'minmax(0, 1.25fr) minmax(0, 1fr)';
    const msg = h('div'), list = h('div', { class: 'list' }), detail = h('section', { id: 'contentDetail' }, h('h2', {}, 'One item'), h('p', { class: 'muted' }, 'Pick one to see its checks, stats, history and a 3D preview.'));
    const sel = (key, label, options) => h('label', {}, label, h('select', { onchange: e => { q[key] = e.target.value; q.offset = 0; load(); } }, h('option', { value: '' }, 'any'), ...options.map(([v, t]) => h('option', { value: v, selected: q[key] === v }, t))));
    const filters = h('div', { class: 'row' });
    const bulk = h('div', { class: 'row' });
    const file = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: () => importCsv(file.files[0]) });
    box.replaceChildren(
      h('section', {}, h('h2', {}, 'Content'),
        h('p', { class: 'muted' }, 'Parts and cars, made by the content pipeline (npm run content). A draft or one in review isn\'t in the game; publishing needs its checks passed. An edit is a new version, a draft, checked again — players keep the published version until the new one is published.'),
        filters, bulk, msg, list),
      detail);
    const drawFilters = () => {
      const opts = o => Object.entries(o ?? {}).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, n]) => [k, `${k} (${n})`]);
      const search = h('input', { type: 'search', placeholder: 'Name, id or family', value: q.q, maxlength: 80, onkeydown: e => { if (e.key === 'Enter') { q.q = e.target.value; q.offset = 0; load(); } } });
      filters.replaceChildren(
        h('label', {}, 'Show', h('select', { onchange: e => { q.kind = e.target.value; Object.assign(q, { slot: '', family: '', tier: '', offset: 0 }); load(); } }, ...[['part', 'Parts'], ['car', 'Cars']].map(([v, t]) => h('option', { value: v, selected: q.kind === v }, t)))),
        h('label', {}, 'Find', search),
        sel('status', 'Status', [['draft', 'draft'], ['review', 'review'], ['published', 'published'], ['live', 'in the game']]),
        q.kind === 'part' && sel('slot', 'Slot', opts(facets?.slot)),
        sel('family', q.kind === 'part' ? 'Family' : 'Made from', opts(facets?.family)),
        sel('tier', q.kind === 'part' ? 'Tier' : 'Class', opts(facets?.tier)),
        sel('problems', 'Checks', [['none', 'passing'], ['any', 'failing'], ...Object.keys(facets?.problems ?? {}).filter(k => k !== 'none').map(k => [k, `failing: ${k}`])]),
        h('button', { class: 'btn ghost', onclick: () => { location.href = `${api.base ?? ''}/api/v1/admin/content/export.csv?${new URLSearchParams(Object.entries(q).filter(([k, v]) => v !== '' && !['offset'].includes(k)))}`; } }, 'Export CSV'),
        h('button', { class: 'btn ghost', onclick: () => file.click() }, 'Import CSV'), file);
    };
    const drawBulk = () => {
      const n = picked.size, items = [...picked].map(k => { const [kind, id] = k.split(':'); return { kind, id }; }), parts = items.filter(x => x.kind === 'part').map(x => x.id);
      const status = s => async () => { const why = ask(`${s === 'published' ? 'Publish' : `Move to ${s}`}: ${n} item${n > 1 ? 's' : ''}?`); if (!why) return; try { const r = await api.post('/admin/content/status', { items, status: s, reason: why }); say(msg, `${r.done.length} now ${s}${r.refused.length ? `; ${r.refused.length} left as they were — ${r.refused.slice(0, 3).map(x => `${x.id}: ${x.why}`).join('; ')}${r.refused.length > 3 ? '…' : ''}` : ''}.`, !r.refused.length); load(); } catch (e) { say(msg, errText(e)); } };
      const edit = (label, changes) => async () => { const c = changes(); if (!c) return; const why = ask(`${label}: ${parts.length} part${parts.length > 1 ? 's' : ''}?`); if (!why) return; try { const r = await api.post('/admin/content/edit', { ids: parts, changes: c, reason: why }); say(msg, `${r.changed.length} changed: new draft versions, being checked.`, true); load(); } catch (e) { say(msg, `${errText(e)}${e.details?.length ? ` — ${e.details.slice(0, 3).map(d => `${d.id}: ${d.problems[0]}`).join('; ')}` : ''}`); } };
      bulk.replaceChildren(...(n ? [
        h('span', { class: 'muted' }, `${n} picked`),
        h('button', { class: 'btn primary', onclick: status('published') }, 'Publish'),
        h('button', { class: 'btn secondary', onclick: status('review') }, 'To review'),
        h('button', { class: 'btn ghost', onclick: status('draft') }, 'Back to draft'),
        parts.length && h('button', { class: 'btn ghost', onclick: edit('Change the price', () => { const v = prompt('Price × (e.g. 1.1 for 10% dearer)', '1.1'); const k = Number(v); return v && k > 0 ? { priceTimes: k } : null; }) }, 'Price ×'),
        parts.length && h('button', { class: 'btn ghost', onclick: edit('Set the unlock level', () => { const v = prompt('Unlock level (1–50; empty: its tier\'s)', ''); return v === null ? null : { unlockLevel: v.trim() ? Number(v) : null }; }) }, 'Unlock level'),
        parts.length && h('button', { class: 'btn ghost', onclick: edit('Set the tier', () => { const v = prompt('Tier: street, sport or race', 'sport'); return v ? { tier: v.trim() } : null; }) }, 'Tier'),
        h('button', { class: 'btn ghost', onclick: () => { picked.clear(); draw(); } }, 'Clear'),
      ] : [h('span', { class: 'muted' }, 'Tick items to change many at once.')]));
    };
    let last = null;
    const draw = () => {
      drawBulk();
      if (!last) return;
      const all = last.items, allPicked = all.length && all.every(x => picked.has(`${x.kind}:${x.id}`));
      list.replaceChildren(
        h('div', { class: 'muted' }, `${last.total.toLocaleString('en-GB')} ${q.kind === 'part' ? 'parts' : 'cars'}${last.total > all.length ? `, ${q.offset + 1}–${q.offset + all.length} shown` : ''}`),
        h('table', {}, h('tr', {}, h('th', {}, h('input', { type: 'checkbox', checked: allPicked, onchange: e => { for (const x of all) e.target.checked ? picked.add(`${x.kind}:${x.id}`) : picked.delete(`${x.kind}:${x.id}`); draw(); } })), h('th', {}, ''), h('th', {}, 'Name'), h('th', {}, q.kind === 'part' ? 'Tier' : 'Class'), h('th', {}, 'Price'), h('th', {}, 'Status'), h('th', {}, 'Checks')),
          ...all.map(x => h('tr', { style: shown === `${x.kind}:${x.id}` ? 'background:var(--c-raised)' : '' },
            h('td', {}, h('input', { type: 'checkbox', checked: picked.has(`${x.kind}:${x.id}`), onchange: e => { e.target.checked ? picked.add(`${x.kind}:${x.id}`) : picked.delete(`${x.kind}:${x.id}`); drawBulk(); } })),
            h('td', {}, x.thumb ? h('img', { src: iconUrl(x.thumb), width: 64, height: 40, loading: 'lazy', alt: '', style: 'object-fit:cover;border-radius:3px' }) : x.icon ? h('img', { src: iconUrl(x.icon), width: 40, height: 40, loading: 'lazy', alt: '' }) : ''),
            h('td', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); open(x.kind, x.id); } }, x.name), h('div', { class: 'muted' }, `${x.id}${x.family ? ` · ${x.family}` : ''}${x.slot ? ` · ${x.slot}` : ''}`)),
            h('td', {}, x.tier ?? '—'), h('td', {}, money(x.price)),
            h('td', {}, badge(x.status, STATUS_KIND[x.status]), x.live && x.status !== 'published' ? h('div', { class: 'muted' }, 'an older version is in the game') : '', x.edited ? h('div', { class: 'muted' }, `edited (v${x.version})`) : ''),
            h('td', {}, x.checksOk ? h('span', { style: 'color:var(--c-good)' }, '✔ passing') : h('span', { style: 'color:var(--c-bad-soft)', title: x.problems.join('\n') }, `✘ ${x.failing.join(', ')}`))))),
        h('div', { class: 'row' },
          q.offset > 0 && h('button', { class: 'btn ghost', onclick: () => { q.offset = Math.max(0, q.offset - 200); load(); } }, 'Earlier'),
          q.offset + all.length < last.total && h('button', { class: 'btn ghost', onclick: () => { q.offset += 200; load(); } }, 'More')));
    };
    async function load() {
      try {
        const params = new URLSearchParams(Object.entries({ ...q, limit: 200 }).filter(([, v]) => v !== '' && v != null));
        last = await api.get(`/admin/content/items?${params}`);
        facets = last.facets;
        drawFilters(); draw();
      } catch (e) { say(msg, errText(e)); }
    }
    async function importCsv(f) {
      if (!f) return;
      const csv = await f.text();
      try {
        const dry = await api.post('/admin/content/import', { csv, reason: 'checking a spreadsheet first', dryRun: true });
        if (dry.problems.length) { say(msg, `Nothing changed — ${dry.problems.length} row${dry.problems.length > 1 ? 's' : ''} can't be used: ${dry.problems.slice(0, 4).map(p => `line ${p.line} (${p.id}): ${p.problem}`).join('; ')}`); return; }
        const why = ask(`The spreadsheet changes ${dry.edits} part${dry.edits === 1 ? '' : 's'} and ${dry.statuses} status${dry.statuses === 1 ? '' : 'es'}. Go ahead?`);
        if (!why) return;
        const r = await api.post('/admin/content/import', { csv, reason: why });
        say(msg, `Done: ${r.edits} edited (new draft versions, being checked), ${r.statuses} status changes${r.refused?.length ? `; ${r.refused.length} not published — ${r.refused.slice(0, 3).map(x => `${x.id}: ${x.why}`).join('; ')}` : ''}.`, !r.refused?.length);
        load();
      } catch (e) { say(msg, errText(e)); } finally { file.value = ''; }
    }
    async function open(kind, id, note = null) {
      shown = `${kind}:${id}`; draw();
      detail.replaceChildren(h('h2', {}, 'Loading…'));
      let x;
      try { x = await api.get(`/admin/content/items/${kind}/${id}`); } catch (e) { detail.replaceChildren(h('h2', {}, 'One item'), h('div', { class: 'msg bad' }, errText(e))); return; }
      const dmsg = h('div'), statusBtn = (s, label, cls) => h('button', { class: `btn ${cls}`, onclick: async () => { const why = ask(`${label}: ${x.name}?`); if (!why) return; try { const r = await api.post('/admin/content/status', { items: [{ kind, id }], status: s, reason: why }); if (r.refused.length) say(dmsg, `Not ${s}: ${r.refused[0].why}`); else { load(); open(kind, id, `Now ${s}.`); } } catch (e) { say(dmsg, errText(e)); } } }, label);
      const checkRows = [];
      const C = x.checks ?? {};
      if (kind === 'part') for (const k of ['fit', 'drive', 'crash', 'sound', 'budget', 'economy', 'classes']) {
        const c = C[k]; if (!c) continue;
        // (a known problem kept until it's fixed: data/content/check-rules.json fit.known)
        const known = Object.entries(c.cars ?? {}).filter(([, r]) => r.known).map(([car, r]) => `${car}: ${r.known}`);
        checkRows.push(h('tr', {}, h('td', {}, k), h('td', {}, c.ok ? h('span', { style: 'color:var(--c-good)' }, known.length ? '✔ (known)' : '✔') : h('span', { style: 'color:var(--c-bad-soft)' }, '✘')), h('td', {}, [...(c.problems ?? []).slice(0, 6), ...known].join(' · ') || (c.cars ? `${Object.keys(c.cars).length} car${Object.keys(c.cars).length > 1 ? 's' : ''}` : c.note ?? ''))));
      } else if (C.max) checkRows.push(h('tr', {}, h('td', {}, 'classes'), h('td', {}, C.ok ? '✔' : '✘'), h('td', {}, `stock ${C.stock?.class} (${C.stock?.index}), fully upgraded ${C.max.class} (${C.max.index})${(C.problems ?? []).length ? ` — ${C.problems.join('; ')}` : ''}`)));
      if (x.liveChecks) checkRows.push(h('tr', {}, h('td', {}, `live (v${x.liveChecks.version})`), h('td', {}, x.liveChecks.ok ? '✔' : '✘'), h('td', {}, (x.liveChecks.problems ?? []).join(' · ') || 'its tier and the class limits, with this version')));
      // the edit form: name, tier, price, unlock level and its family's stats (each with its allowed range)
      const f = { name: h('input', { value: x.name, maxlength: 80 }), tier: h('select', {}, ...['street', 'sport', 'race'].map(t => h('option', { value: t, selected: x.tier === t }, t))), price: h('input', { type: 'number', value: x.price ?? '', min: 1, step: 10 }), unlock: h('input', { type: 'number', value: x.unlockLevel ?? '', min: 1, max: 50, placeholder: 'its tier\'s' }) };
      const statInputs = x.stats.map(s => ({ s, el: h('input', { type: 'number', value: s.value ?? '', step: 'any', min: s.range[0], max: s.range[1] }) }));
      const save = async () => {
        const changes = {};
        if (f.name.value.trim() !== x.name) changes.name = f.name.value.trim();
        if (f.tier.value !== x.tier) changes.tier = f.tier.value;
        if (Number(f.price.value) !== x.price) changes.price = Math.round(Number(f.price.value));
        if (String(f.unlock.value) !== String(x.unlockLevel ?? '')) changes.unlockLevel = f.unlock.value ? Number(f.unlock.value) : null;
        const stats = {}; for (const { s, el } of statInputs) if (el.value !== '' && Number(el.value) !== s.value) stats[s.key] = Number(el.value);
        if (Object.keys(stats).length) changes.stats = stats;
        if (!Object.keys(changes).length) { say(dmsg, 'Nothing changed.'); return; }
        const why = ask(`Save a new version of ${x.name} (a draft, checked again)?`); if (!why) return;
        try { await api.post('/admin/content/edit', { ids: [id], changes, reason: why }); load(); open(kind, id, 'Saved: a new draft version, being checked (open it again in a moment for the live checks).'); }
        catch (e) { say(dmsg, `${errText(e)}${e.details?.length ? ` — ${e.details[0].problems.join('; ')}` : ''}`); }
      };
      const view3d = h('div', { style: 'position:relative;height:320px;border-radius:var(--r-card);overflow:hidden;background:#15191d' });
      const carSel = h('select', { onchange: () => show3d(carSel.value) }, ...x.cars.map(c => h('option', { value: c.id }, c.name)));
      const why3d = h('div', { class: 'muted' });
      detail.replaceChildren(
        h('div', { class: 'row', style: 'align-items:center' }, x.thumb ? h('img', { src: iconUrl(x.thumb), width: 180, height: 112, alt: 'Studio thumbnail', style: 'border-radius:4px' }) : x.icon ? h('img', { src: iconUrl(x.icon), width: 72, height: 72, alt: '' }) : '', h('div', {}, h('h2', {}, x.name), h('div', { class: 'muted' }, `${x.id}${x.family ? ` · ${x.family}` : ''} · version ${x.version}`))),
        h('div', { class: 'row' }, badge(x.status, STATUS_KIND[x.status]), x.live ? badge('in the game') : badge('not in the game'), x.edited ? badge('edited here') : ''),
        h('div', { class: 'row' }, statusBtn('published', 'Publish', 'primary'), statusBtn('review', 'To review', 'secondary'), statusBtn('draft', 'Back to draft', 'ghost')),
        dmsg,
        kind === 'part' && x.cars.length ? h('div', { class: 'list' }, h('h3', {}, 'On a car'), h('label', {}, 'Car', carSel), view3d, why3d) : '',
        h('h3', {}, 'Checks'), checkRows.length ? h('table', {}, ...checkRows) : h('p', { class: 'muted' }, 'No checks yet: npm run content -- check'),
        kind === 'part' ? h('div', { class: 'list' }, h('h3', {}, 'Change it'),
          h('div', { class: 'row' }, h('label', {}, 'Name', f.name)), h('div', { class: 'row' }, h('label', {}, 'Tier', f.tier), h('label', {}, 'Price ($)', f.price), h('label', {}, 'Unlock level', f.unlock)),
          statInputs.length ? h('div', { class: 'row' }, ...statInputs.map(({ s, el }) => h('label', { title: `${s.range[0]}–${s.range[1]}${s.unit ? ` ${s.unit}` : ''}` }, `${s.label}${s.unit ? ` (${s.unit})` : ''} ${s.range[0]}–${s.range[1]}`, el))) : h('p', { class: 'muted' }, 'Not a family\'s part: its price, tier, unlock level and name can change here; its stats in its file.'),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Save a new version'))) : '',
        h('h3', {}, 'History'),
        x.history.length ? h('table', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'What'), h('th', {}, 'Who'), h('th', {}, 'Why')), ...x.history.map(e => h('tr', {}, h('td', { class: 'when' }, when(e.at)), h('td', {}, `v${e.version} ${e.action}${e.edits && Object.keys(e.edits).length && e.action === 'edit' ? `: ${Object.entries(e.edits).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')}` : ''}`), h('td', {}, e.actor ?? '—'), h('td', {}, e.reason ?? '')))) : h('p', { class: 'muted' }, 'Nothing changed here yet: it\'s as its file says.'),
      );
      if (note) say(dmsg, note, true);
      if (kind === 'part' && x.cars.length) show3d(x.cars[0].id);
      async function show3d(carId) {
        why3d.textContent = 'Loading…';
        try {
          preview ??= await makePreview(view3d);
          if (preview.el.parentNode !== view3d) view3d.replaceChildren(preview.el);
          const p = await api.get(`/admin/content/preview/${carId}/${id}`);
          await preview.show(p, id);
          why3d.textContent = p.fitted ? (p.with.length ? `Fitted with what it needs: ${p.with.join(', ')}.` : 'Fitted as the shop fits it.') : `It wouldn't go on as the car is: ${p.why}`;
        } catch (e) { why3d.textContent = `No preview: ${errText(e)}`; }
      }
    }
    load();
  }

  // ---------- the 3D preview (garage/visual.js, as the game draws a car) ----------
  async function makePreview() {
    const THREE = await import('three'), { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const V = await import('../garage/visual.js'), { assetUrl } = await import('../site/urls.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true }), el = renderer.domElement;
    el.style.width = '100%'; el.style.height = '100%';
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    scene.background = new THREE.Color('#15191d');
    const env = V.skyEnvironment(renderer); V.setEnvironment(env); scene.environment = env;
    scene.add(new THREE.HemisphereLight('#dfe8f0', '#2a2d31', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(3, 6, 4); scene.add(sun);
    scene.add(new THREE.GridHelper(10, 40, '#3a424b', '#262c33'));
    const controls = new OrbitControls(camera, el); controls.enableDamping = true;
    const models = new V.ModelCache(), url = k => k.startsWith('tyre:') ? k : assetUrl(k.startsWith('/') ? k : `/${k}`);
    let visual = null;
    const loop = () => { if (!el.isConnected) { renderer.setAnimationLoop(null); return; } const w = el.clientWidth, hgt = el.clientHeight; if (w && hgt && (el.width !== Math.round(w * renderer.getPixelRatio()))) { renderer.setSize(w, hgt, false); camera.aspect = w / hgt; camera.updateProjectionMatrix(); } controls.update(); renderer.render(scene, camera); };
    renderer.setAnimationLoop(loop);
    return {
      el,
      async show({ car, finishes, build, owned, parts }, partId) {
        if (!renderer.getAnimationLoop?.()) renderer.setAnimationLoop(loop);
        visual?.dispose(); visual = null;
        const v = await V.createCarVisual({ car: { ...car, model: { ...car.model, file: url(car.model.file) } }, finishes, models: { acquire: (k, make) => models.acquire(url(k), make), release: k => models.release(url(k)) }, paint: car.paint ?? null });
        await v.applyBuild(build, { parts, owned });
        visual = v; scene.add(v.group);
        // (looking at the part from its own side of the car — a wing from behind, a bumper from the front — the car round it)
        const sockets = Object.entries(build.sockets).filter(([, iid]) => iid && owned[iid]?.partId === partId).map(([s]) => s);
        const box = new THREE.Box3(), car3 = new THREE.Box3().setFromObject(v.group);
        for (const s of sockets) { const o = v.partObject(s); if (o) box.expandByObject(o); }
        if (box.isEmpty()) box.copy(car3);
        const p = box.getCenter(new THREE.Vector3()), c = car3.getCenter(new THREE.Vector3()), R = car3.getSize(new THREE.Vector3()).length() / 2;
        const dir = p.clone().sub(c).setY(0);
        if (dir.length() < 0.2) dir.set(0.8, 0, 1);
        dir.normalize().add(new THREE.Vector3(0.35, 0.45, 0.35).multiply(new THREE.Vector3(Math.sign(dir.x || 1), 1, Math.sign(dir.z || 1)))).normalize();
        controls.target.copy(p.clone().lerp(c, 0.25));
        camera.position.copy(controls.target).add(dir.multiplyScalar(R * 1.55));
        camera.near = 0.05; camera.far = R * 20; camera.updateProjectionMatrix();
      },
    };
  }

  return { showContent };
}
