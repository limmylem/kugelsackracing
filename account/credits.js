// The credits and licences screen (Phase 6 Step 5): account/credits.json, made by tools/credits.mjs from the baked
// regions' manifests and the packages the server runs. Shown as text (nothing in it is HTML).

const $ = id => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const link = (text, url) => url && /^https:\/\//.test(url) ? h('a', { href: url, rel: 'noopener', target: '_blank' }, text) : text;
const table = (head, rows) => h('table', {}, h('tr', {}, ...head.map(x => h('th', {}, x))), ...rows.map(r => h('tr', {}, ...r.map(c => h('td', {}, c ?? '')))));

try {
  const C = await (await fetch('credits.json', { cache: 'no-cache' })).json();
  $('list').replaceChildren(
    h('h2', {}, 'The world'),
    h('p', {}, 'The roads, buildings, land and heights of the real places in the game come from open data. Thank you to everyone who maps.'),
    table(['Data', 'Licence', 'Where'], C.data.map(d => [h('div', {}, link(d.name, d.url), d.text ? h('div', { class: 'muted' }, d.text) : null), d.licence, d.regions.join(', ')])),
    h('p', { class: 'muted' }, 'Map data © OpenStreetMap contributors, available under the Open Database License (ODbL): openstreetmap.org/copyright. Baked with ', C.tools.map(t => `${t.name} (${t.licence})`).join(', '), '.'),
    h('h2', {}, 'In your browser'),
    table(['Library', 'Version', 'Licence', 'By'], C.browser.map(b => [link(b.name, b.url), b.version ?? '', b.licence, b.by])),
    h('h2', {}, 'Fonts'),
    table(['Font', 'Licence', 'By'], C.fonts.map(f => [link(f.name, f.url), f.licence, f.by])),
    h('h2', {}, 'Made for the game'),
    h('ul', {}, ...C.own.map(o => h('li', {}, h('b', {}, o.name), ': ', o.note))),
    h('h2', {}, 'The server'),
    h('p', {}, `The game's server runs on Node.js with ${C.server.count} open-source packages: `, Object.entries(C.server.byLicence).map(([k, n]) => `${n} ${k}`).join(', '), '.'),
    h('details', {}, h('summary', {}, 'Every package'), table(['Package', 'Version', 'Licence'], C.server.packages.map(p => [p.name, p.version, p.licence]))));
} catch (e) { $('list').replaceChildren(h('p', {}, `The list couldn't be loaded: ${e.message}`)); }
