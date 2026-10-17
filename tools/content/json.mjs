// Writing the data files in their layout (short arrays on one line, like the hand-written files)

import fs from 'node:fs';
import path from 'node:path';

export function formatJson(v, ind = '') {
  const flat = x => Array.isArray(x) && x.every(y => typeof y === 'number' || typeof y === 'string' || (Array.isArray(y) && y.every(z => typeof z === 'number')));
  // (a space after each item's comma — not the commas inside a string, which stay as they are)
  if (flat(v)) return `[${v.map(y => Array.isArray(y) ? `[${y.map(z => JSON.stringify(z)).join(', ')}]` : JSON.stringify(y)).join(', ')}]`;
  if (Array.isArray(v)) return v.length ? `[\n${v.map(x => ind + '  ' + formatJson(x, ind + '  ')).join(',\n')}\n${ind}]` : '[]';
  if (v && typeof v === 'object') { const e = Object.entries(v).filter(([, x]) => x !== undefined); return e.length ? `{\n${e.map(([k, x]) => `${ind}  ${JSON.stringify(k)}: ${formatJson(x, ind + '  ')}`).join(',\n')}\n${ind}}` : '{}'; }
  return JSON.stringify(v);
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatJson(value) + '\n');
}
export function editJson(file, edit) {
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(obj);
  writeJson(file, obj);
  return obj;
}
