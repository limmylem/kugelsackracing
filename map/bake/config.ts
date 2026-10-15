// A map version's settings: data/map/v4.json, or data/map/v5.json over the file it extends (deep: an object's keys
// replace the base's one by one, anything else — numbers, strings, arrays — replaces it whole). `_note`s are kept from
// the file that sets them.
//
//   const cfg = mapConfig('v5')   // data/map/v4.json with data/map/v5.json over it

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base: any, over: any): any {
  if (!isObj(base) || !isObj(over)) return over;
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

export function mapConfig(version: string, dir = path.join(ROOT, 'data/map')) {
  const read = (f: string): any => {
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!c.extends) return c;
    const { extends: base, ...rest } = c;
    return deepMerge(read(base), rest);
  };
  return read(`${version}.json`);
}
