// What the drivetrain says about the engine (physics/drivetrain.js, physics/engineHealth.js) and the
// mechanical damage (physics/mechanical.js), for the player: the words for each event, and the big warning in the middle of the screen that shows them.
// The test worlds and the real world both use it.

const gearWord = g => ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][g] ?? `gear ${g}`;
const rpmText = r => Math.round(r).toLocaleString('en-GB');

// An event → { text, kind ('bad' | 'warn' | 'ok'), seconds, small } to show, or null
export function newsOf(e, { resetKey = 'B' } = {}) {
  if (e.type === 'overRevShift') return { text: `OVER-REV · ${gearWord(e.gear)}`, kind: 'bad', seconds: 1.6, small: `that puts the engine at ${rpmText(e.rpm)} rpm, ${Math.round(e.over * 100)}% past the redline` };
  if (e.type === 'shiftBlocked') return { text: `${gearWord(e.gear)} would over-rev`, kind: 'warn', seconds: 1.4, small: `rev protection kept it in gear (${rpmText(e.rpm)} rpm)` };
  if (e.type === 'bent') return { text: 'BENT VALVES', kind: 'bad', seconds: 2.5, small: `engine condition ${Math.round(e.condition)}%: it'll misfire until it's repaired` };
  if (e.type === 'blown') return { text: e.cause === 'overheat' ? 'ENGINE SEIZED' : 'ENGINE BLOWN', kind: 'bad', seconds: 4, small: `${e.cause === 'overheat' ? 'it cooked itself · ' : ''}repair it in the garage${resetKey ? ` · ${resetKey} resets the car (development)` : ''}` };
  if (e.type === 'incident' && e.worst === 'float') return { text: 'Valve float', kind: 'warn', seconds: 1.8, small: `engine condition ${Math.round(e.condition)}%` };
  // (mechanical damage: physics/mechanical.js, physics/drivetrain.js)
  if (e.type === 'overheat') return { text: 'ENGINE HOT', kind: 'warn', seconds: 2.2, small: `${Math.round(e.temp)}°C · ease off, or it goes into limp mode` };
  if (e.type === 'limp') return { text: 'LIMP MODE', kind: 'bad', seconds: 3, small: 'overheating: less power and a low rev limit until it cools down' };
  if (e.type === 'cooking') return { text: 'ENGINE COOKING', kind: 'bad', seconds: 2.5, small: 'it\'s losing condition: back right off' };
  if (e.type === 'cooled') return { text: 'Engine cooled', kind: 'ok', seconds: 1.8, small: 'out of limp mode' };
  if (e.type === 'flat') return { text: `FLAT TYRE · ${e.wheel}`, kind: 'bad', seconds: 2.5, small: 'riding on the rim: very little grip' };
  if (e.type === 'wheelOff') return { text: `WHEEL OFF · ${e.wheel}`, kind: 'bad', seconds: 4, small: `the ${e.wheel} corner is on the ground${resetKey ? ` · ${resetKey} resets the car (development)` : ''}` };
  if (e.type === 'missedGear') return { text: `MISSED ${gearWord(e.gear)}`, kind: 'warn', seconds: 1.2, small: 'the damaged gearbox didn\'t take it: trying again' };
  // (the drivetrain: a 4WD's transfer case, diff locks)
  if (e.type === 'transfer') return { text: e.mode, kind: 'ok', seconds: 1.4, small: { '2H': 'rear-wheel drive', '4H': 'four-wheel drive, high range', '4L': 'four-wheel drive, low range: crawling, steep climbs' }[e.mode] };
  if (e.type === 'transferBlocked') return { text: `Not ${e.mode}`, kind: 'warn', seconds: 1.4, small: e.why };
  if (e.type === 'diffLock') return { text: `${e.axle[0].toUpperCase() + e.axle.slice(1)} diff ${e.locked ? 'LOCKED' : 'open'}`, kind: e.locked ? 'warn' : 'ok', seconds: 1.3, small: e.locked ? 'both sides turn together: for loose ground, slowly' : '' };
  if (e.type === 'clutchHot') return { text: 'Clutch overheating', kind: 'warn', seconds: 2, small: 'it\'s wearing: go easier on the launches' };
  return null;
}
// (what an over-rev or overheating did, for the player's save)
export const causeOf = e => e.worst === 'float' ? 'valve float' : e.worst === 'bent' ? 'bent valves' : e.worst === 'cooked' ? 'overheated' : e.cause === 'overheat' ? 'seized (overheated)' : 'blown';

// The warning: show(text, kind, seconds, small print), update(dt) each frame to fade it (styled by
// .engine-flash in index.html)
export function engineFlash() {
  const el = document.createElement('div');
  el.className = 'engine-flash';
  let left = 0;
  const api = {
    el,
    show(text, kind = 'bad', seconds = 2, small = '') {
      el.className = `engine-flash ${kind} show`;
      el.innerHTML = '';
      el.append(text);
      if (small) { const s = document.createElement('small'); s.textContent = small; el.append(s); }
      left = seconds;
    },
    news(e, opts) { const n = newsOf(e, opts); if (n) api.show(n.text, n.kind, n.seconds, n.small); return n; },
    update(dt) { if (left > 0 && (left -= dt) <= 0) el.classList.remove('show'); },
    hide() { left = 0; el.classList.remove('show'); },
  };
  return api;
}
