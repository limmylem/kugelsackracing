// Formulas from the content config (data/content/formulas.json; docs/CONTENT_PIPELINE.md): a part family's or an
// engine's stats worked out from its settings — a turbo's size → its boost and spool, an exhaust's diameter → its
// torque, a wheel's size and build → its weight — written as plain arithmetic in the config, not in code:
//
//   "boost": { "formula": "0.3 + (size - 40) * 0.022", "range": [0.3, 1.2], "unit": "bar", "label": "peak boost" }
//
// Numbers, names (the settings, the stats worked out before this one, and a table's fields: construction.mass),
// + − × ÷ ^ and brackets, comparisons (< <= > >= == !=: 1 or 0) joined by && and ||, and the functions below. No
// other code runs.
//
//   evaluate('0.3 + (size - 40) * 0.022', { size: 56 }) → 0.652
//   evalStats(spec, inputs) → { stats: { name: value }, problems: ['peak boost 1.4 bar is outside 0.3–1.2 bar', …] }
//
// No browser or Node APIs.

const FUNCS = {
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, log: Math.log, floor: Math.floor, ceil: Math.ceil,
  pow: (a, b) => a ** b,
  clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
  lerp: (a, b, t) => a + (b - a) * t,
  // (where x is between a and b, 0..1, eased at both ends)
  smoothstep: (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); },
  // (to the nearest step: round(x, 10))
  round: (x, step = 1) => Math.round(x / step) * step,
  // (c ? a : b)
  iff: (c, a, b) => c ? a : b,
};
export const FUNCTIONS = Object.keys(FUNCS);

// ---------- parsing (to a small tree, once per formula) ----------
const TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_0-9][A-Za-z0-9_]*)*)|(<=|>=|==|!=|&&|\|\||[-+*/^(),<>]))/y;
function tokens(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  let at = 0;
  while (at < src.length) {
    if (/^\s*$/.test(src.slice(at))) break;
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`"${src.slice(at).trim().slice(0, 12)}" isn't something a formula can have`);
    out.push(m[1] != null ? { k: 'num', v: +m[1] } : m[2] != null ? { k: 'name', v: m[2] } : { k: 'op', v: m[3] });
    at = TOKEN.lastIndex;
  }
  return out;
}
const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '^': 8 };
function parse(src) {
  const t = tokens(src);
  let i = 0;
  const peek = () => t[i], take = () => t[i++];
  const expect = v => { const x = take(); if (x?.v !== v) throw new Error(`expected "${v}"${x ? ` but found "${x.v}"` : ' at the end'}`); };
  function primary() {
    const x = take();
    if (!x) throw new Error('it ends too soon');
    if (x.k === 'num') return { n: x.v };
    if (x.k === 'op' && x.v === '(') { const e = expr(0); expect(')'); return e; }
    if (x.k === 'op' && x.v === '-') return { neg: expr(PREC['^'] - 1) };       // (−x^2 is −(x^2))
    if (x.k === 'op' && x.v === '+') return expr(PREC['^'] - 1);
    if (x.k === 'name') {
      if (peek()?.v === '(') {
        take();
        if (!FUNCS[x.v]) throw new Error(`there's no function "${x.v}" (there are: ${FUNCTIONS.join(', ')})`);
        const args = [];
        if (peek()?.v !== ')') for (;;) { args.push(expr(0)); if (peek()?.v === ',') { take(); continue; } break; }
        expect(')');
        return { call: x.v, args };
      }
      return { name: x.v };
    }
    throw new Error(`"${x.v}" can't go there`);
  }
  function unary() { return primary(); }
  function expr(min) {
    let left = unary();
    for (;;) {
      const op = peek();
      if (!op || op.k !== 'op' || !(op.v in PREC) || PREC[op.v] < min) return left;
      take();
      const right = expr(op.v === '^' ? PREC[op.v] : PREC[op.v] + 1);      // (^ binds right to left)
      left = { op: op.v, a: left, b: right };
    }
  }
  const e = expr(0);
  if (i < t.length) throw new Error(`"${t[i].v}" is left over`);
  return e;
}
const CACHE = new Map();
export function compile(src) {
  if (typeof src === 'number') return { n: src };
  if (!CACHE.has(src)) CACHE.set(src, parse(String(src)));
  return CACHE.get(src);
}
// the names a formula uses (to say which are missing)
export function namesIn(src) {
  const out = new Set(), walk = e => { if (e.name) out.add(e.name); if (e.neg) walk(e.neg); if (e.a) { walk(e.a); walk(e.b); } if (e.args) e.args.forEach(walk); };
  walk(compile(src));
  return [...out];
}

// ---------- evaluating ----------
const lookup = (ctx, name) => name.split('.').reduce((o, k) => o == null ? undefined : o[k], ctx);
function run(e, ctx) {
  if ('n' in e) return e.n;
  if (e.name) {
    const v = lookup(ctx, e.name);
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(v === undefined ? `"${e.name}" isn't known here` : `"${e.name}" is ${JSON.stringify(v)}, not a number`);
    return v;
  }
  if (e.neg) return -run(e.neg, ctx);
  if (e.call) return FUNCS[e.call](...e.args.map(a => run(a, ctx)));
  const a = run(e.a, ctx), b = run(e.b, ctx);
  switch (e.op) {
    case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '^': return a ** b;
    case '&&': return +(!!a && !!b); case '||': return +(!!a || !!b);
    case '<': return +(a < b); case '<=': return +(a <= b); case '>': return +(a > b); case '>=': return +(a >= b); case '==': return +(a === b); case '!=': return +(a !== b);
  }
  throw new Error(`no operator "${e.op}"`);
}
export function evaluate(src, ctx = {}) {
  const v = run(compile(src), ctx);
  if (!Number.isFinite(v)) throw new Error(`it comes to ${v} (a division by nothing?)`);
  return v;
}

// A number in words, for messages: 1.4 bar, 12.5 kg, 7%
const sig = v => Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-GB') : +v.toPrecision(3);
export const said = (v, unit = '') => unit === '%' ? `${sig(v * 100)}%` : `${sig(v)}${unit ? (/^[°"]/.test(unit) ? unit : ` ${unit}`) : ''}`;
export const between = (lo, hi, unit = '') => unit === '%' ? `${said(lo, unit)}–${said(hi, unit)}` : `${sig(lo)}–${said(hi, unit)}`;

// A set of stats from their formulas, in order (each can use the ones before it), each kept within its allowed
// range — outside it, a problem in words and the value left as worked out (so nothing out of range is made).
//   spec: { stat: { formula, range?: [min, max], unit?, label?, digits? } }, inputs: { name: value | table entry }
//   → { stats, problems }
export function evalStats(spec, inputs, { what = 'it' } = {}) {
  const stats = {}, problems = [], ctx = { ...inputs };
  for (const [name, s] of Object.entries(spec ?? {})) {
    if (name.startsWith('_')) continue;
    const S = typeof s === 'object' ? s : { formula: s };
    let v;
    try { v = evaluate(S.formula, ctx); }
    catch (err) { problems.push(`${what}: the formula for ${S.label ?? name} (${S.formula}) doesn't work: ${err.message}`); continue; }
    if (S.digits != null) v = +v.toFixed(S.digits);
    stats[name] = ctx[name] = v;
    const [lo, hi] = S.range ?? [-Infinity, Infinity];
    if (v < lo - 1e-9 || v > hi + 1e-9) problems.push(`${what}: ${S.label ?? name} ${said(v, S.unit)} is outside what's allowed (${between(lo, hi, S.unit)})`);
  }
  return { stats, problems };
}

// Whether a value is within a stat's allowed range (for an edit): null, or the problem in words
export function rangeProblem(S, v, name = 'it') {
  if (!S?.range) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${S.label ?? name} must be a number`;
  const [lo, hi] = S.range;
  return v < lo - 1e-9 || v > hi + 1e-9 ? `${S.label ?? name} ${said(v, S.unit)} is outside what's allowed (${between(lo, hi, S.unit)})` : null;
}
