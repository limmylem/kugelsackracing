// The game's words in the player's language (Phase 8 Step 4; docs/TRANSLATIONS.md). Every player-facing string is a
// message in locales/<language>.json, looked up by its key and written in ICU message format — the format Crowdin and
// Lokalise read — so a translation can put words in its own order, and plurals follow each language's own rules:
//
//   "garage.parts": "{count, plural, =0 {No parts} one {# part} other {# parts}}"
//   t('garage.parts', { count: 3 })                → "3 parts"
//   "race.place": "{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}"
//   "hud.welcome": "Welcome back, {name}"           ({name}: as given)
//   "{when, date, medium}", "{n, number}", "{d, select, rain {Wet} other {Dry}}", '' an apostrophe, '{' a brace
//
// Languages: English (en) for launch, with its regions' own words and formats (en-AU, en-GB, en-US: data/
// languages.json); en-XA, a pseudo-translation (every letter accented, every message a third longer, in [brackets]) that
// shows text that's hard-coded or overflows; ar-XB, a right-to-left pseudo-translation for checking the layout mirrors.
// A message missing from a language falls back to English (en), then to its key.
//
//   import { t, setLanguage, i18n } from '/ui/i18n.js';
//   await setLanguage('en-AU');      // loads locales/en.json (+ en-AU.json's own), sets <html lang dir>
//   t('settings.title')              // "Settings"
//   i18n.number(1234.5) / i18n.date(d, 'medium') / i18n.money(1500) / i18n.dir ('ltr' | 'rtl')

const RTL = new Set(['ar', 'he', 'fa', 'ur']);
// (the game's own money: its symbol, whatever the language — only the digits' grouping is the language's)
const MONEY = '$';

// ---------- ICU message format: parsed once into parts ----------
const HASH = Object.freeze({ hash: true });
// A part: a string; { arg }; { arg, type: 'number'|'date'|'time', style }; { arg, type: 'plural'|'selectordinal'|
// 'select', offset, options: { key: parts } }; or '#' (the plural's number)
export function parseMessage(src) {
  let i = 0;
  const fail = what => { throw new Error(`${what} at ${i} in "${src}"`); };
  function parts(inPlural, depth) {
    const out = []; let text = '';
    const flush = () => { if (text) { out.push(text); text = ''; } };
    while (i < src.length) {
      const c = src[i];
      if (c === "'") {
        // ('' is an apostrophe; '{…}' or '#' quoted are literal)
        if (src[i + 1] === "'") { text += "'"; i += 2; continue; }
        const next = src[i + 1];
        if (next === '{' || next === '}' || (inPlural && next === '#')) {
          const end = src.indexOf("'", i + 1);
          if (end < 0) { text += src.slice(i + 1); i = src.length; continue; }
          text += src.slice(i + 1, end); i = end + 1; continue;
        }
        text += c; i++; continue;
      }
      if (c === '{') { flush(); i++; out.push(argument(depth)); continue; }
      if (c === '}') { if (depth === 0) fail('an unmatched }'); break; }
      if (c === '#' && inPlural) { flush(); out.push(HASH); i++; continue; }
      text += c; i++;
    }
    flush();
    return out;
  }
  const space = () => { while (/\s/.test(src[i] ?? '')) i++; };
  const word = () => { space(); const m = /^[^\s,{}]+/.exec(src.slice(i)); if (!m) fail('a name expected'); i += m[0].length; space(); return m[0]; };
  function argument(depth) {
    const arg = word();
    if (src[i] === '}') { i++; return { arg }; }
    if (src[i] !== ',') fail(', or } expected');
    i++;
    const type = word();
    if (src[i] === '}') { i++; return { arg, type }; }
    if (src[i] !== ',') fail(', or } expected');
    i++;
    if (type === 'plural' || type === 'selectordinal' || type === 'select') {
      const options = {}; let offset = 0;
      space();
      if (src.startsWith('offset:', i)) { i += 7; offset = Number(word()); }
      while (true) {
        space();
        if (src[i] === '}') { i++; break; }
        const key = word();
        if (src[i] !== '{') fail(`{ expected after ${key}`);
        i++;
        options[key] = parts(type !== 'select', depth + 1);
        if (src[i] !== '}') fail('} expected');
        i++;
      }
      if (!options.other) fail(`${arg}'s ${type} has no "other"`);
      return { arg, type, offset, options };
    }
    // (number / date / time with a style: up to the closing brace)
    const end = src.indexOf('}', i);
    if (end < 0) fail('} expected');
    const style = src.slice(i, end).trim(); i = end + 1;
    return { arg, type, style };
  }
  const out = parts(false, 0);
  if (i < src.length) fail('unexpected }');
  return out;
}

// ---------- a language ----------
export function createI18n({ locale = 'en', messages = {}, fallback = {} } = {}) {
  const parsed = new Map();
  let plural, ordinal, numberFmt, lang;
  const I = {
    locale, messages, fallback,
    get dir() { return RTL.has(lang) ? 'rtl' : 'ltr'; },
    setMessages(loc, own, base = {}) {
      I.locale = loc; I.messages = own; I.fallback = base; parsed.clear();
      lang = loc.split('-')[0];
      const real = intlLocale(loc);
      plural = new Intl.PluralRules(real); ordinal = new Intl.PluralRules(real, { type: 'ordinal' }); numberFmt = new Intl.NumberFormat(real);
    },
    has: key => key in I.messages || key in I.fallback,
    t(key, vars = {}) {
      let p = parsed.get(key);
      if (!p) {
        const src = I.messages[key] ?? I.fallback[key];
        if (src == null) { missing(key); return key; }
        try { p = parseMessage(src); } catch (err) { console.warn(`[i18n] ${key}: ${err.message}`); p = [src]; }
        parsed.set(key, p);
      }
      return render(p, vars, null);
    },
    number: (n, o) => (o ? new Intl.NumberFormat(intlLocale(I.locale), o) : numberFmt).format(n),
    date: (d, style = 'medium') => new Intl.DateTimeFormat(intlLocale(I.locale), dateStyle(style)).format(d instanceof Date ? d : new Date(d)),
    time: (d, style = 'short') => new Intl.DateTimeFormat(intlLocale(I.locale), { timeStyle: style }).format(d instanceof Date ? d : new Date(d)),
    // the game's money: its own symbol, the language's digit grouping (and a minus where it puts one)
    money: (n, { cents = false } = {}) => `${n < 0 ? '−' : ''}${MONEY}${new Intl.NumberFormat(intlLocale(I.locale), { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }).format(Math.abs(n))}`,
    relative: (value, unit) => new Intl.RelativeTimeFormat(intlLocale(I.locale), { numeric: 'auto' }).format(value, unit),
    list: (items, type = 'conjunction') => new Intl.ListFormat(intlLocale(I.locale), { type }).format(items),
  };
  const seenMissing = new Set();
  function missing(key) { if (!seenMissing.has(key)) { seenMissing.add(key); I.onMissing?.(key); } }
  function render(parts, vars, num) {
    let out = '';
    for (const p of parts) {
      if (typeof p === 'string') { out += I.transform ? I.transform(p) : p; continue; }
      if (p === HASH) { out += num == null ? '#' : numberFmt.format(num); continue; }
      const v = vars[p.arg];
      if (!p.type) { out += v == null ? `{${p.arg}}` : typeof v === 'number' ? numberFmt.format(v) : String(v); continue; }
      if (p.type === 'number') { out += formatNumberStyle(v, p.style); continue; }
      if (p.type === 'date') { out += v == null ? '' : I.date(v, p.style || 'medium'); continue; }
      if (p.type === 'time') { out += v == null ? '' : I.time(v, p.style || 'short'); continue; }
      if (p.type === 'select') { out += render(p.options[String(v)] ?? p.options.other, vars, num); continue; }
      // plural / selectordinal: an exact =n first, then the language's category
      const n = Number(v) - (p.offset || 0);
      const exact = p.options[`=${Number(v)}`];
      const cat = (p.type === 'plural' ? plural : ordinal).select(n);
      out += render(exact ?? p.options[cat] ?? p.options.other, vars, n);
    }
    return out;
  }
  function formatNumberStyle(v, style) {
    if (v == null) return '';
    const loc = intlLocale(I.locale);
    if (style === 'percent') return new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 0 }).format(v);
    if (style === 'integer') return new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(v);
    const m = /^::\s*\.(0+|#+)$/.exec(style ?? '');          // (::.0 → one decimal, ::.00 two)
    if (m) return new Intl.NumberFormat(loc, { minimumFractionDigits: m[1][0] === '0' ? m[1].length : 0, maximumFractionDigits: m[1].length }).format(v);
    return numberFmt.format(v);
  }
  I.setMessages(locale, messages, fallback);
  return I;
}
const dateStyle = s => ['short', 'medium', 'long', 'full'].includes(s) ? { dateStyle: s } : s === 'datetime' ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
// (the pseudo-languages format numbers and dates as English does; a right-to-left one as Arabic would read its text,
// with Latin digits so the layout's what's checked)
function intlLocale(loc) { return loc === 'en-XA' ? 'en-GB' : loc === 'ar-XB' ? 'en-GB' : loc; }

// ---------- pseudo-translations ----------
const ACCENTS = { a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ó', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž', A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž' };
export const pseudoText = s => s.replace(/[A-Za-z]/g, c => ACCENTS[c] ?? c);
// each message: accented, a third longer, bracketed — the brackets show where a message is cut off
export function pseudoMessages(en, { rtl = false } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(en)) out[k] = rtl ? `‫${v}‬` : `[${v} ${'~'.repeat(Math.max(2, Math.round(visibleLength(v) / 3)))}]`;
  return out;
}
const visibleLength = v => v.replace(/\{[^{}]*\}/g, 'xxxx').length;

// ---------- the game's language, shared by every screen ----------
export const i18n = createI18n();
export const t = (key, vars) => i18n.t(key, vars);
let languages = null;
export async function loadLanguages(base = '/') {
  languages ??= await fetch(`${base}data/languages.json`).then(r => r.json()).catch(() => ({ default: 'en', languages: [{ code: 'en', name: 'English' }] }));
  return languages;
}
const fetchJson = (base, code) => fetch(`${base}locales/${code}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}));
// The language: 'auto' (the browser's, if the game has it), or a code from data/languages.json
export async function setLanguage(code = 'auto', { base = '/', messages = null } = {}) {
  const L = await loadLanguages(base);
  const resolved = resolveLanguage(code, L, typeof navigator !== 'undefined' ? navigator.languages : []);
  const en = messages?.en ?? await fetchJson(base, 'en');
  let own = {};
  if (resolved === 'en-XA') own = pseudoMessages(en);
  else if (resolved === 'ar-XB') own = pseudoMessages(en, { rtl: true });
  else if (resolved !== 'en') {
    const lang = resolved.split('-')[0];
    own = { ...(lang !== 'en' && lang !== resolved ? messages?.[lang] ?? await fetchJson(base, lang) : {}), ...(messages?.[resolved] ?? await fetchJson(base, resolved)) };
  }
  i18n.setMessages(resolved, own, en);
  i18n.transform = resolved === 'en-XA' ? pseudoText : null;
  if (typeof document !== 'undefined') { document.documentElement.lang = resolved; document.documentElement.dir = i18n.dir; translatePage(document); }
  for (const f of listeners) try { f(resolved); } catch { /* a screen's own problem */ }
  return resolved;
}
export function resolveLanguage(code, L, browser = []) {
  const codes = new Set(L.languages.map(l => l.code));
  if (code && code !== 'auto' && (codes.has(code) || code === 'en-XA' || code === 'ar-XB')) return code;
  for (const b of browser ?? []) {
    if (codes.has(b)) return b;
    const lang = b.split('-')[0];
    // (English from a region the game has no words of its own for: the nearest it has — Commonwealth English, else US)
    if (lang === 'en') return codes.has(`en-${b.split('-')[1]}`) ? `en-${b.split('-')[1]}` : (/^en-(US|PR|PH)$/.test(b) ? 'en-US' : codes.has('en-GB') ? 'en-GB' : 'en');
    const same = L.languages.find(l => l.code.split('-')[0] === lang);
    if (same) return same.code;
  }
  return L.default ?? 'en';
}
const listeners = new Set();
export const onLanguage = f => { listeners.add(f); return () => listeners.delete(f); };

// Static pages' words: elements with data-i18n="key" (their text), data-i18n-attr="placeholder:key,aria-label:key"
export function translatePage(root) {
  for (const el of root.querySelectorAll?.('[data-i18n]') ?? []) if (i18n.has(el.dataset.i18n)) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll?.('[data-i18n-attr]') ?? []) {
    for (const pair of el.dataset.i18nAttr.split(',')) { const [attr, key] = pair.split(':').map(s => s.trim()); if (i18n.has(key)) el.setAttribute(attr, t(key)); }
  }
}
// (text put into HTML: < > & " escaped)
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
