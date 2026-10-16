// The game's words, checked (Phase 8 Step 4; docs/TRANSLATIONS.md): npm run i18n -- <command>
//   check     every t('key') the game uses is in locales/en.json; every message parses as ICU message format (its
//             plurals and selects have "other"); every language has only keys English has, with the same {arguments};
//             locales/en-US.json is up to date; and no screen has more hard-coded English than it had
//             (data/i18n-baseline.json: the strings each file still has to move into locales/ — it may only go down)
//   us        locales/en-US.json made again from en.json (American spellings: colour → color, tyre → tire, kerb → curb…)
//   baseline  data/i18n-baseline.json written again from what's there now (after moving strings out)
//   report    what's left to move, file by file
//   export    locales/en.json as the translation service takes it (it's already that: flat JSON, ICU) — prints where
// CI runs check (tests/unit/i18n.test.mjs, in npm run test:unit).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMessage } from '../ui/i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const write = (f, o) => fs.writeFileSync(path.join(ROOT, f), JSON.stringify(o, null, 1) + '\n');
// the player-facing code: where t() is used and where hard-coded words are counted
const UI_DIRS = ['ui', 'testtrack', 'play', 'garage', 'account', 'site', 'race', 'quest', 'mp', 'realworld', 'world', 'track', 'route'];
const UI_FILES = ['index.html'];
const SKIP = /(^|\/)(node_modules|\.cache|\.scratch|tests?|dev|editor|admin)\//;
// (the legal pages: translated as whole documents, each language's checked by a lawyer — not message by message;
// docs/TRANSLATIONS.md "Legal pages")
const WHOLE_DOCUMENTS = new Set(['account/terms.html', 'account/privacy.html']);
const BASELINE = 'data/i18n-baseline.json';

function files() {
  const out = [...UI_FILES];
  for (const d of UI_DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir, { recursive: true }).map(String)) if (/\.(js|html)$/.test(f) && !SKIP.test(`${d}/${f}`) && !WHOLE_DOCUMENTS.has(`${d}/${f.split(path.sep).join('/')}`)) out.push(`${d}/${f.split(path.sep).join('/')}`);
  }
  return out.sort();
}

// t('a.b'), t("a.b", …) — and t(`a.${x}.b`): a pattern, some key must match it
export function usedKeys(src) {
  const exact = new Set(), patterns = new Set();
  for (const m of src.matchAll(/\bt\(\s*(['"])([A-Za-z0-9_.-]+)\1/g)) exact.add(m[2]);
  for (const m of src.matchAll(/\bt\(\s*`([^`]*)`/g)) {
    if (!m[1].includes('${')) { exact.add(m[1]); continue; }
    patterns.add('^' + m[1].split(/\$\{[^}]*\}/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[A-Za-z0-9_-]+') + '$');
  }
  for (const m of src.matchAll(/data-i18n="([A-Za-z0-9_.-]+)"/g)) exact.add(m[1]);
  return { exact, patterns };
}

// Words a player reads that aren't in locales/: text between tags in HTML and template strings, and text put in
// textContent / title / placeholder / aria-label / alert() — three letters or more, not code. A rough count, for the
// ratchet: it may only go down.
export function hardCoded(src) {
  const found = [];
  const noCode = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  // (the game's name is the same in every language)
  const word = s => /[A-Za-z]{3,}/.test(s.replace(/Ogni Strada/g, '')) && !/^[\s\w-]*[=:;{}()[\]]/.test(s) && !/^\s*(https?:|\/|#|\.|var\(|calc\()/.test(s);
  // (an element with data-i18n: its words are put in from locales/ — what's in the file is only the fallback)
  // (an icon's ligature name — aria-hidden, or an icon font's class — isn't a word either)
  for (const m of noCode.matchAll(/(<[^<>]*)?>([^<>`]*?)(?=<)/g)) { if (m[1]?.includes('data-i18n') || /aria-hidden="true"|class="[^"]*\b(dk-ic|material-symbols|icon)\b/.test(m[1] ?? '')) continue; const s = m[2].replace(/\$\{[^}]*\}/g, '').trim(); if (s && s.length < 200 && !/[;(){}=?\n'"&|]/.test(s) && word(s) && !/^[\s\W\d]*$/.test(s)) found.push(s); }
  for (const m of noCode.matchAll(/\b(?:textContent|title|placeholder|innerText|alert|confirm|prompt)\s*(?:=|\()\s*(['"`])((?:(?!\1).)*)\1/g)) { const s = m[2].replace(/\$\{[^}]*\}/g, '').trim(); if (word(s)) found.push(s); }
  for (const m of noCode.matchAll(/aria-label="([^"$]*[A-Za-z]{3,}[^"]*)"/g)) found.push(m[1]);
  return found;
}

// ---------- American English from Commonwealth English ----------
const US = [
  ['colour', 'color'], ['Colour', 'Color'], ['tyre', 'tire'], ['Tyre', 'Tire'], ['kerb', 'curb'], ['Kerb', 'Curb'],
  ['centre', 'center'], ['Centre', 'Center'], ['metre', 'meter'], ['litre', 'liter'], ['favourite', 'favorite'], ['Favourite', 'Favorite'],
  ['behaviour', 'behavior'], ['honour', 'honor'], ['licence', 'license'], ['Licence', 'License'], ['practise', 'practice'],
  ['organis', 'organiz'], ['recognis', 'recogniz'], ['customis', 'customiz'], ['Customis', 'Customiz'], ['optimis', 'optimiz'], ['minimis', 'minimiz'], ['maximis', 'maximiz'], ['realis', 'realiz'], ['synchronis', 'synchroniz'], ['personalis', 'personaliz'],
  ['grey', 'gray'], ['Grey', 'Gray'], ['travelling', 'traveling'], ['travelled', 'traveled'], ['cancelled', 'canceled'], ['modelling', 'modeling'], ['labelled', 'labeled'], ['catalogue', 'catalog'], ['Catalogue', 'Catalog'],
  ['programme', 'program'], ['defence', 'defense'], ['offence', 'offense'], ['aluminium', 'aluminum'], ['bonnet', 'hood'], ['Bonnet', 'Hood'], ['boot lid', 'trunk lid'], ['windscreen', 'windshield'], ['Windscreen', 'Windshield'],
  ['petrol', 'gas'], ['Petrol', 'Gas'], ['gearbox', 'transmission'], ['Gearbox', 'Transmission'], ['motorway', 'freeway'], ['car park', 'parking lot'], ['neighbour', 'neighbor'], ['analys', 'analyz'], ['Analys', 'Analyz'],
];
export function americanize(text) {
  // (only inside words a player reads — never inside {arguments} or plural keywords)
  const kept = [];
  const masked = text.replace(/\{\s*[A-Za-z0-9_]+\s*(,\s*[A-Za-z]+\s*(,[^{}]*?(?=[A-Za-z=]+\s*\{|\}))?)?/g, m => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  return US.reduce((s, [gb, us]) => s.replace(new RegExp(`\\b${gb}`, 'g'), us), masked).replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i]);
}
export function usMessages(en) {
  const out = {};
  for (const [k, v] of Object.entries(en)) { const u = americanize(v); if (u !== v) out[k] = u; }
  return out;
}

const args = src => { const out = new Set(); const walk = ps => { for (const p of ps) if (p?.arg) { out.add(p.arg); for (const o of Object.values(p.options ?? {})) walk(o); } }; walk(parseMessage(src)); return [...out].sort().join(','); };

export function check() {
  const problems = [], warnings = [];
  const en = read('locales/en.json');
  for (const [k, v] of Object.entries(en)) { try { parseMessage(v); } catch (e) { problems.push(`locales/en.json ${k}: ${e.message}`); } }
  const all = files(), used = new Set(), patterns = new Set();
  const counts = {};
  for (const f of all) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // (only code that uses the game's t() — other code has functions of its own called t — comments aside)
    const u = /i18n\.js|data-i18n/.test(src) ? usedKeys(src.replace(/^\s*\/\/.*$/gm, '')) : { exact: new Set(), patterns: new Set() };
    for (const k of u.exact) { used.add(k); if (!(k in en)) problems.push(`${f}: t('${k}') isn't in locales/en.json`); }
    for (const p of u.patterns) { patterns.add(p); const re = new RegExp(p); if (!Object.keys(en).some(k => re.test(k))) problems.push(`${f}: no message in locales/en.json matches t(\`${p}\`)`); }
    const n = hardCoded(src).length;
    if (n) counts[f] = n;
  }
  const res = [...patterns].map(p => new RegExp(p));
  const unused = Object.keys(en).filter(k => !used.has(k) && !res.some(r => r.test(k)) && !k.startsWith('common.'));
  if (unused.length) warnings.push(`${unused.length} messages not used anywhere (yet): ${unused.slice(0, 8).join(', ')}${unused.length > 8 ? '…' : ''}`);
  // every other language: only English's keys, the same arguments
  const L = read('data/languages.json');
  for (const { code } of L.languages) {
    if (code === 'en') continue;
    const f = `locales/${code}.json`;
    if (!fs.existsSync(path.join(ROOT, f))) { problems.push(`${f} is missing (data/languages.json lists ${code})`); continue; }
    const own = read(f);
    for (const [k, v] of Object.entries(own)) {
      if (!(k in en)) { problems.push(`${f}: ${k} isn't an English message`); continue; }
      try { if (args(v) !== args(en[k])) problems.push(`${f} ${k}: its {arguments} (${args(v)}) aren't English's (${args(en[k])})`); } catch (e) { problems.push(`${f} ${k}: ${e.message}`); }
    }
  }
  const us = usMessages(en), usNow = fs.existsSync(path.join(ROOT, 'locales/en-US.json')) ? read('locales/en-US.json') : {};
  if (JSON.stringify(us) !== JSON.stringify(usNow)) problems.push('locales/en-US.json is out of date: npm run i18n -- us');
  // the ratchet
  const base = fs.existsSync(path.join(ROOT, BASELINE)) ? read(BASELINE).files ?? {} : {};
  for (const [f, n] of Object.entries(counts)) {
    const was = base[f] ?? 0;
    if (n > was) problems.push(`${f}: ${n} hard-coded strings a player reads (was ${was}) — put new words in locales/en.json and use t() (docs/TRANSLATIONS.md)`);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0), baseTotal = Object.values(base).reduce((a, b) => a + b, 0);
  return { problems, warnings, messages: Object.keys(en).length, used: used.size, hardCoded: total, baseline: baseTotal, counts };
}

const cmd = process.argv[2] ?? 'check';
if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd === 'us') { const us = usMessages(read('locales/en.json')); write('locales/en-US.json', us); console.log(`locales/en-US.json: ${Object.keys(us).length} messages spelled the American way`); }
  else if (cmd === 'baseline') {
    const r = check();
    write(BASELINE, { _note: 'Hard-coded English a player reads, per file, still to move into locales/ (tools/i18n.mjs). It may only go down: npm run i18n -- baseline after moving some out.', total: r.hardCoded, files: Object.fromEntries(Object.entries(r.counts).sort()) });
    console.log(`${BASELINE}: ${r.hardCoded} strings in ${Object.keys(r.counts).length} files`);
  } else if (cmd === 'report') {
    const r = check();
    for (const [f, n] of Object.entries(r.counts).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${f}`);
    console.log(`\n${r.messages} messages in locales/en.json; ${r.hardCoded} hard-coded strings left in ${Object.keys(r.counts).length} files`);
  } else if (cmd === 'export') {
    console.log('locales/en.json is the source file for Crowdin or Lokalise as it is (flat JSON keys, ICU message format); translations come back as locales/<code>.json. docs/TRANSLATIONS.md has the workflow.');
  } else {
    const r = check();
    for (const w of r.warnings) console.log(`  note  ${w}`);
    for (const p of r.problems) console.log(`  FAIL  ${p}`);
    console.log(`${r.messages} messages, ${r.used} used by name; ${r.hardCoded} hard-coded strings still to move (baseline ${r.baseline})${r.problems.length ? `; ${r.problems.length} problems` : ' — ok'}`);
    process.exitCode = r.problems.length ? 1 : 0;
  }
}
