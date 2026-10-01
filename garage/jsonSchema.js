// A small JSON Schema validator (no dependencies, runs in the page and in Node), covering the parts
// of the standard the data schemas use: type, enum, const, required, properties,
// additionalProperties, patternProperties, propertyNames, items, minItems / maxItems, minimum / maximum,
// exclusiveMinimum, minLength, pattern, oneOf / anyOf / allOf / not, if / then / else, $ref (within a
// schema, "#/$defs/x", or to another loaded schema, "other.schema.json#/$defs/x") and $defs.
//
// createValidator(schemas) takes schemas keyed by their $id (their file name); validate(id, data)
// returns a list of errors [{ path, message }] (empty: valid).

const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
const isType = (v, t) => t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t;

export function createValidator(schemas) {
  const byId = new Map(Object.entries(schemas));

  function resolve(ref, base) {
    const [file, pointer = ''] = ref.split('#');
    const root = file ? byId.get(file) : base;
    if (!root) throw new Error(`schema ${file} not loaded`);
    const node = pointer.split('/').filter(Boolean).reduce((n, k) => n?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    if (!node) throw new Error(`no ${ref}`);
    return { node, root };
  }

  function check(schema, data, path, root, errors) {
    if (schema === true) return;
    if (schema === false) { errors.push({ path, message: 'is not allowed here' }); return; }
    if (schema.$ref) { const r = resolve(schema.$ref, root); check(r.node, data, path, r.root, errors); }
    if (schema.type) {
      const types = [].concat(schema.type);
      if (!types.some(t => isType(data, t))) { errors.push({ path, message: `should be ${types.join(' or ')}, not ${typeOf(data)}` }); return; }
    }
    if (schema.const !== undefined && JSON.stringify(data) !== JSON.stringify(schema.const)) errors.push({ path, message: `should be ${JSON.stringify(schema.const)}` });
    if (schema.enum && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(data))) errors.push({ path, message: `should be one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')}` });
    if (typeof data === 'number') {
      if (schema.minimum !== undefined && data < schema.minimum) errors.push({ path, message: `should be at least ${schema.minimum}` });
      if (schema.maximum !== undefined && data > schema.maximum) errors.push({ path, message: `should be at most ${schema.maximum}` });
      if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) errors.push({ path, message: `should be more than ${schema.exclusiveMinimum}` });
    }
    if (typeof data === 'string') {
      if (schema.minLength !== undefined && data.length < schema.minLength) errors.push({ path, message: schema.minLength === 1 ? 'should not be empty' : `should be at least ${schema.minLength} characters` });
      if (schema.pattern && !new RegExp(schema.pattern).test(data)) errors.push({ path, message: `should match ${schema.pattern}` });
    }
    if (Array.isArray(data)) {
      if (schema.minItems !== undefined && data.length < schema.minItems) errors.push({ path, message: `should have at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}` });
      if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push({ path, message: `should have at most ${schema.maxItems} items` });
      if (schema.items) data.forEach((x, i) => check(schema.items, x, `${path}[${i}]`, root, errors));
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const k of schema.required || []) if (!(k in data)) errors.push({ path, message: `is missing "${k}"` });
      if (schema.propertyNames) for (const k of Object.keys(data)) for (const e of (() => { const x = []; check(schema.propertyNames, k, `${path ? path + '.' : ''}${k}`, root, x); return x; })()) errors.push({ ...e, message: `(the name) ${e.message}` });
      const props = schema.properties || {}, patterns = Object.entries(schema.patternProperties || {}).map(([p, s]) => [new RegExp(p), s]);
      for (const [k, v] of Object.entries(data)) {
        const sub = `${path ? path + '.' : ''}${k}`;
        let known = false;
        if (k in props) { known = true; check(props[k], v, sub, root, errors); }
        for (const [re, s] of patterns) if (re.test(k)) { known = true; check(s, v, sub, root, errors); }
        if (!known && schema.additionalProperties !== undefined) {
          if (schema.additionalProperties === false) errors.push({ path: sub, message: `isn't a known field${closest(k, Object.keys(props))}` });
          else check(schema.additionalProperties, v, sub, root, errors);
        }
      }
    }
    if (schema.allOf) for (const s of schema.allOf) check(s, data, path, root, errors);
    if (schema.anyOf && !schema.anyOf.some(s => valid(s, data, path, root))) {
      // say what's wrong against the closest of the allowed forms
      const tries = schema.anyOf.map(s => { const e = []; check(s, data, path, root, e); return e; }).sort((a, b) => a.length - b.length);
      if (schema.errorMessage || !tries[0].length) errors.push({ path, message: schema.errorMessage || 'doesn\'t match any of the allowed forms' });
      else errors.push(...tries[0]);
    }
    if (schema.oneOf) {
      const n = schema.oneOf.filter(s => valid(s, data, path, root)).length;
      if (n !== 1) {
        // (report the errors of the closest alternative, which is usually what was meant)
        const tries = schema.oneOf.map(s => { const e = []; check(s, data, path, root, e); return e; }).sort((a, b) => a.length - b.length);
        if (n === 0) errors.push(...tries[0]); else errors.push({ path, message: 'matches more than one of the allowed forms' });
      }
    }
    if (schema.not && valid(schema.not, data, path, root)) errors.push({ path, message: schema.errorMessage || 'has something that isn\'t allowed here' });
    if (schema.if) {
      if (valid(schema.if, data, path, root)) { if (schema.then) check(schema.then, data, path, root, errors); }
      else if (schema.else) check(schema.else, data, path, root, errors);
    }
  }
  const valid = (s, d, p, r) => { const e = []; check(s, d, p, r, e); return !e.length; };

  return {
    validate(id, data) {
      const schema = byId.get(id);
      if (!schema) throw new Error(`no schema ${id}`);
      const errors = [];
      check(schema, data, '', schema, errors);
      return errors;
    },
  };
}

// " (did you mean …?)" for a mistyped field name
function closest(k, names) {
  const d = (a, b) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  };
  const best = names.map(n => [n, d(k.toLowerCase(), n.toLowerCase())]).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(2, k.length / 3) ? ` (did you mean "${best[0]}"?)` : '';
}
