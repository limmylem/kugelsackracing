// Units the player reads (Phase 8 Step 4; docs/TRANSLATIONS.md): metric or imperial — the player's choice in the
// settings, else their region's (the US, Liberia and Myanmar imperial; the UK metric but with miles and mph on the
// road). Everything inside the game stays metric (SI); only what's shown changes.
//
//   const U = units({ system: 'auto', locale: 'en-US' })
//   U.speed(27.8)        → { value: 62, unit: 'mph', text: '62 mph' }    (from m/s)
//   U.speedKmh(100)      → same, from km/h
//   U.distance(1609)     → '1.0 mi'      (short ones in feet or metres: U.distance(30) → '98 ft' / '30 m')
//   U.temperature(90)    → '194 °F'  ·  U.mass(1250) → '2,756 lb'  ·  U.pressure(2.2) → '32 psi' (bar)
//   U.power(150) (kW)    → '201 hp'  ·  U.torque(300) → '221 lb⋅ft'

import { i18n } from './i18n.js';

const IMPERIAL = /^[a-z]{2,3}-(US|LR|MM)$/i;
const ROAD_MILES = /^[a-z]{2,3}-(GB)$/i;          // (the UK: metric, but miles and mph on the road)
export function systemFor(locale = 'en', choice = 'auto') {
  if (choice === 'metric' || choice === 'imperial') return { distance: choice, other: choice };
  if (IMPERIAL.test(locale)) return { distance: 'imperial', other: 'imperial' };
  if (ROAD_MILES.test(locale)) return { distance: 'imperial', other: 'metric' };
  return { distance: 'metric', other: 'metric' };
}

export function units({ system = 'auto', locale = i18n.locale } = {}) {
  const S = systemFor(locale, system), mi = S.distance === 'imperial', imp = S.other === 'imperial';
  const n = (v, d = 0) => i18n.number(Number(v.toFixed(d)), { minimumFractionDigits: d, maximumFractionDigits: d });
  const out = (value, unit, d = 0) => ({ value: Number(value.toFixed(d)), unit, text: `${n(value, d)} ${unit}` });
  const U = {
    system: S,
    speedUnit: mi ? 'mph' : 'km/h',
    speed: ms => out(mi ? ms * 2.236936 : ms * 3.6, mi ? 'mph' : 'km/h'),
    speedKmh: kmh => out(mi ? kmh / 1.609344 : kmh, mi ? 'mph' : 'km/h'),
    // a speed in the player's unit back to km/h (a speed they type in)
    toKmh: v => mi ? v * 1.609344 : v,
    distance(m) {
      if (mi) return m < 0.1 * 1609.344 ? out(m * 3.28084, 'ft') : out(m / 1609.344, 'mi', m < 16093 ? 1 : 0);
      return m < 1000 ? out(m, 'm') : out(m / 1000, 'km', m < 10000 ? 1 : 0);
    },
    length: m => imp ? out(m * 3.28084, 'ft', 1) : out(m, 'm', 1),
    height: m => mi ? out(m * 3.28084, 'ft') : out(m, 'm'),
    temperature: c => imp ? out(c * 9 / 5 + 32, '°F') : out(c, '°C'),
    mass: kg => imp ? out(kg * 2.204623, 'lb') : out(kg, 'kg'),
    pressure: bar => imp ? out(bar * 14.50377, 'psi') : out(bar, 'bar', 2),
    power: kw => imp ? out(kw * 1.341022, 'hp') : out(kw, 'kW'),
    torque: nm => imp ? out(nm * 0.737562, 'lb⋅ft') : out(nm, 'N⋅m'),
    volume: l => imp ? out(l * 0.264172, 'gal', 1) : out(l, 'L', 1),
  };
  return U;
}

// the player's own units, from their saved settings (testtrack/settings.js) and the language — for screens that
// aren't handed the settings (the quest HUD, the driving school); made again only when the setting or language changes
let mine = null, mineKey = '';
export function playerUnits() {
  let system = 'auto';
  try { system = JSON.parse(globalThis.localStorage?.getItem('driveWorld.settings.v1') ?? '{}')?.units ?? 'auto'; } catch { /* auto */ }
  const key = `${system}|${i18n.locale}`;
  if (key !== mineKey || !mine) { mine = units({ system }); mineKey = key; }
  return mine;
}
