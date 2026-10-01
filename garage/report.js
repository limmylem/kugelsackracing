// Readable text from the stats calculator: what a number is, where it came from (explain), what a
// change to the build did (changes), and the totals. Used by the debug console and the test runner.

import { getPath } from './stats.js';

const words = k => k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
export const num = x => typeof x !== 'number' ? String(x) : Math.abs(x) >= 1000 ? x.toFixed(0) : Math.abs(x) >= 10 ? +x.toFixed(2) + '' : +x.toPrecision(4) + '';

// "engine.torqueCurve.8.1" → "engine torque at 5000 rpm", "gearbox.ratios.2" → "gearbox ratio (3rd)"
export function labelOf(path, spec) {
  const m = path.match(/^engine\.torqueCurve\.(\d+)\.1$/);
  if (m && spec) return `engine torque at ${getPath(spec, `engine.torqueCurve.${m[1]}.0`)} rpm`;
  const g = path.match(/^gearbox\.ratios\.(\d+)$/);
  if (g) return `gearbox ratio (${['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][+g[1]]})`;
  return path.split('.').map(p => /^\d+$/.test(p) ? `[${p}]` : words(p)).join(' · ').replace(/ · \[/g, ' [');
}
const who = s => s.kind === 'car' ? `the car (${s.id})` : `${s.name}${s.count > 1 ? ` ×${s.count}` : ''} in ${s.socket}`;
const stepText = st => ({
  base: `${who(st.source)}: ${num(st.to)}`,
  component: `${who(st.source)}: ${num(st.to)}`,
  add: `${who(st.source)}: ${st.to - st.from >= 0 ? '+' : '−'}${num(Math.abs(st.to - st.from))} → ${num(st.to)}`,
  multiply: `${who(st.source)}: ×${num(st.to / st.from)} → ${num(st.to)}`,
  boost: `${who(st.source)}: boost ×${num(st.to / st.from)} → ${num(st.to)}`,
  set: `${who(st.source)}: set to ${num(st.to)}`,
  tune: `${who(st.source)}: its ${st.note} setting → ${num(st.to)}`,
  condition: `${who(st.source)}: ${st.note}: ×${num(st.to / st.from)} → ${num(st.to)}`,
  wheels: `${who(st.source)}: ${num(st.to)} (${st.note})`,
  mass: `${who(st.source)}: ${num(st.to)} (${st.note})`,
})[st.step] + (st.note && ['add', 'multiply'].includes(st.step) ? ` (${st.note})` : '');

// Where one number came from, step by step
export function explain(stats, path) {
  const steps = stats.breakdown[path];
  if (!steps) return `${path}: not in the spec`;
  return `${labelOf(path, stats.spec)} = ${num(getPath(stats.spec, path))}\n${steps.map(st => `   ${st.step.padEnd(9)} ${stepText(st)}`).join('\n')}`;
}

// Everything that differs between two stats (before → after), with the parts whose part in it changed
// (fitted: a name; taken off: "without" a name)
export function changes(before, after) {
  if (!before?.spec || !after?.spec) return [];
  const out = [], seen = new Set([...Object.keys(before?.breakdown || {}), ...Object.keys(after?.breakdown || {})]);
  const key = st => `${st.step}|${st.source.kind}|${st.source.id}|${st.source.socket}`;
  const massParts = st => (st?.breakdown.mass || []).filter(x => x.source.kind === 'part').map(x => `${x.source.id}@${x.source.socket}`);
  for (const path of seen) {
    const a = before?.spec ? getPath(before.spec, path) : undefined, b = after?.spec ? getPath(after.spec, path) : undefined;
    if (a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-12)) continue;
    let by;
    if (path === 'mass' || path.startsWith('centreOfMass')) {
      // mass: the parts that came or went
      const was = massParts(before), now = massParts(after), name = id => [...(after?.breakdown.mass || []), ...(before?.breakdown.mass || [])].find(x => `${x.source.id}@${x.source.socket}` === id)?.source.name;
      by = [...now.filter(x => !was.includes(x)).map(name), ...was.filter(x => !now.includes(x)).map(x => `without ${name(x)}`)];
    } else {
      const was = new Set((before?.breakdown[path] || []).map(key));
      by = (after?.breakdown[path] || []).filter(st => st.source.kind === 'part' && !was.has(key(st))).map(st => st.source.name);
    }
    out.push({ path, label: labelOf(path, after?.spec ?? before?.spec), from: a, to: b, by: [...new Set(by)] });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path, undefined, { numeric: true }));
}

export function totalsText(t) {
  if (!t) return 'the car can\'t be built like this (see the errors)';
  return `${num(t.mass)} kg · ${num(t.peakPower.hp)} hp (${num(t.peakPower.kw)} kW) at ${t.peakPower.rpm} rpm · ${num(t.peakTorque.nm)} N·m at ${t.peakTorque.rpm} rpm · top speed about ${num(t.topSpeed.kmh)} km/h (gear ${t.topSpeed.gear})${t.wheel ? ` · ${t.wheel.label} wheels, ${num(t.wheel.radius * 1000)} mm radius` : ''}`;
}

export function changesText(list, after) {
  if (after && !after.spec) return `   The car can't be driven like this: ${after.errors.join('; ')}.`;
  if (!list.length) return '   (no numbers changed)';
  const pct = c => { const p = (c.to / c.from - 1) * 100; return ` (${p >= 0 ? '+' : '−'}${num(Math.abs(p))}%)`; };
  return list.map(c => `   ${c.label}: ${num(c.from)} → ${num(c.to)}${typeof c.from === 'number' && typeof c.to === 'number' && c.from && !c.path.startsWith('centreOfMass') ? pct(c) : ''}${c.by.length ? ` · ${c.by.join(', ')}` : ''}`).join('\n');
}
