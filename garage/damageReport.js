// The damage report (the garage's Damage tab): every problem a car has, in plain words, with what it
// does to the car — "Front-left steering bent: the car pulls left", "Radiator leaking: the engine will
// overheat", "Front bumper hanging loose: it drags, and could fall off" — where it is (a zone of the
// car, for the diagram, and the garage camera's view of it), how bad it is, whether it stops the car
// carrying on, what a quick and a full repair of it cost, and the spares in the inventory that could go
// on instead. Pure: the screen shows it, the tests read it.
//
//   carProblems(db, profile, carInstanceId) → { problems: [problem], zones: { zone: worst severity },
//     drivable: { ok, reasons }, quick, full }
//   problem: { id, target (instanceId | 'shell'), scope (garage/repair.js), socket, partId, title, effect,
//     severity: 'minor' | 'major' | 'critical', stops, zone, view, quick, full, spares: [instanceId] }
// Zones: front, rear, left, right, roof, engine, underbody and the corners FL, FR, RL, RR.

import { carWork, cornerWord, drivability, ownedBySocket, severity as sevOf, systemOf } from './repair.js';
import { takes } from './validate.js';

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const pct = x => `${Math.round(x)}%`;
export const ZONES = ['front', 'rear', 'left', 'right', 'roof', 'engine', 'underbody', 'FL', 'FR', 'RL', 'RR'];
// the garage camera's view of each zone (garage/garageScene.js VIEWS)
export const ZONE_VIEW = { front: 'front', rear: 'rear', left: 'side_left', right: 'side_right', roof: 'roof', engine: 'engine_bay', underbody: 'underbody', FL: 'wheel_FL', FR: 'wheel_FR', RL: 'wheel_RL', RR: 'wheel_RR' };
const RANK = { minor: 1, major: 2, critical: 3 };

// A part on a car, in words ("Front bumper", "Left door"): by its slot, else its own name
const SLOT_WORDS = { bumper_front: 'Front bumper', bumper_rear: 'Rear bumper', bonnet: 'Bonnet', boot: 'Boot lid', door_left: 'Left door', door_right: 'Right door', fender_left: 'Left front wing', fender_right: 'Right front wing', skirt_left: 'Left side skirt', skirt_right: 'Right side skirt', mirror_left: 'Left mirror', mirror_right: 'Right mirror', spoiler: 'Rear wing', engine_cover: 'Engine cover', front_lip: 'Front lip', roof: 'Roof', widebody: 'Wide-body kit' };
export function partWords(part, socket) {
  const m = socket?.match(/_(FL|FR|RL|RR)$/);
  if (m && (part.slot === 'wheels' || part.slot === 'tyres' || part.slot === 'spacers')) return `${cap(cornerWord(m[1]))} ${part.slot === 'wheels' ? 'wheel' : part.slot === 'tyres' ? 'tyre' : 'spacer'}`;
  return SLOT_WORDS[part.slot] ?? part.name.replace(/\s*\(stock\)\s*/i, '');
}
// Where a socket is on the car: its zone
function zoneOf(car, socketName, part) {
  const s = car.sockets.find(x => x.name === socketName), m = socketName?.match(/_(FL|FR|RL|RR)$/);
  if (m) return m[1];
  const sys = systemOf(part);
  if (part?.engine || ['radiator', 'intake'].includes(sys) || ['intake', 'turbo', 'intercooler', 'supercharger', 'header', 'pistons', 'ecu'].includes(part?.slot)) return 'engine';
  if (['gearbox', 'differential', 'clutch', 'exhaust'].includes(sys) || ['suspension', 'brakes', 'brake_pads', 'flywheel', 'lift_kit'].includes(part?.slot)) return 'underbody';
  const f = s?.focus ?? '';
  if (f.startsWith('wheel_')) return f.slice(6);
  if (f === 'side_left' || f === 'side_right') return f === 'side_left' ? 'left' : 'right';
  if (f === 'front' || f === 'rear' || f === 'roof') return f;
  const p = s?.position ?? [0, 0, 0];
  return Math.abs(p[0]) > 0.6 ? (p[0] > 0 ? 'left' : 'right') : p[2] > 0.9 ? 'front' : p[2] < -0.9 ? 'rear' : 'roof';
}
// Where most of the body shell's dents are
function shellZone(dents) {
  if (!dents?.length) return 'roof';
  const c = [0, 1, 2].map(k => dents.reduce((a, d) => a + d.p[k] * d.s, 0) / dents.reduce((a, d) => a + d.s, 0));
  return Math.abs(c[0]) > 0.55 && Math.abs(c[0]) > Math.abs(c[2]) * 0.45 ? (c[0] > 0 ? 'left' : 'right') : c[2] > 0.9 ? 'front' : c[2] < -0.9 ? 'rear' : 'roof';
}
const nodeWords = node => {
  const side = /left/.test(node) ? 'left ' : /right/.test(node) ? 'right ' : '';
  if (/windscreen/.test(node)) return { title: 'Windscreen cracked', effect: 'harder to see through', zone: 'front' };
  if (/glass_rear/.test(node)) return { title: 'Rear window smashed', effect: 'looks only', zone: 'rear' };
  if (/glass_side/.test(node)) return { title: `${cap(side)}side window smashed`, effect: 'looks only', zone: side.trim() || 'left' };
  if (/head/.test(node)) return { title: `${cap(side)}headlight smashed`, effect: 'no light there at night', zone: 'front' };
  if (/tail/.test(node)) return { title: `${cap(side)}tail light smashed`, effect: 'no brake light there', zone: 'rear' };
  return { title: `${node.replace(/_/g, ' ')} broken`, effect: 'looks only', zone: 'roof' };
};

// One piece of a part's damage in words: { title, effect }
function words(db, x, part, socket, w) {
  const name = partWords(part, socket), M = db.damage.mechanical, block = x.damage ?? {}, c = x.condition ?? 100;
  if (w.scope === 'attach') {
    if (x.attach === 'detached') return part.slot === 'wheels' ? { title: `${name} torn off`, effect: 'the car can\'t be driven' } : { title: `${name} torn off`, effect: part.aero || part.category === 'aero' ? 'no downforce from it' : part.slot.startsWith('mirror') ? 'looks only' : 'more drag, and it\'s missing' };
    const D = part.detach ?? {};
    return D.looseType === 'hinge' ? { title: `${name} loose`, effect: part.slot === 'bonnet' ? 'it can fly up at speed and block the view' : 'it swings open, adding drag' } : { title: `${name} hanging loose`, effect: 'it drags, and could fall off' };
  }
  if (w.scope === 'condition') {
    const dentsOnly = c >= 99.5;                 // (shown as a whole number: 99.7% reads as 100%)
    if (part.engine) return c <= 0 ? { title: 'Engine blown', effect: 'the car can\'t be driven' } : { title: `Engine damaged (${pct(c)})`, effect: c < 40 ? 'much less power, and it could fail' : 'less power' };
    if (part.category === 'body' || part.category === 'aero') {
      if (dentsOnly) return { title: `${name} dented`, effect: 'looks only' };
      const front = ['bumper_front', 'bonnet', 'fender_left', 'fender_right'].includes(part.slot);
      return { title: `${name} ${c < 50 ? 'crumpled' : 'damaged'} (${pct(c)})`, effect: part.category === 'aero' ? 'less downforce, more drag' : front ? 'more drag, and the front lifts at speed' : 'more drag' };
    }
    const wear = { tyres: 'less grip', brakes: 'the brakes fade sooner', suspension: 'tired dampers: it wallows', clutch: 'it slips sooner', gearbox: 'slower shifts', differential: 'it locks less', wheels: 'looks only' }[part.category] ?? 'it works less well';
    return { title: `${name} ${dentsOnly ? 'dented' : part.category === 'wheels' ? `scuffed (${pct(c)})` : `worn (${pct(c)})`}`, effect: dentsOnly ? 'looks only' : wear };
  }
  if (w.scope.startsWith('corner:')) {
    const k = w.corner, b = block[k] ?? {}, where = cap(cornerWord(k));
    if (w.system === 'brakeLine') return { title: `${where} brake line damaged`, effect: `that wheel brakes ${pct((b.line ?? 0) * 100)} less` };
    const toe = b.toe ?? 0, low = (b.ride ?? 0) >= 0.005 ? `, sits ${Math.round(b.ride * 1000)} mm low` : '';
    if (Math.abs(toe) >= 0.05) return { title: `${where} steering bent`, effect: `the car pulls ${toe > 0 ? 'left' : 'right'}${(b.camber ?? 0) > 1 ? ', and grips less' : ''}` };
    return { title: `${where} suspension bent`, effect: `${(b.camber ?? 0) > 0.3 ? 'less grip' : 'it handles oddly'}${low}${(b.damper ?? 0) > 0.2 ? ', bouncy' : ''}` };
  }
  const where = socket?.match(/_(FL|FR|RL|RR)$/)?.[1], W = where ? cap(cornerWord(where)) : '';
  switch (w.system) {
    case 'rim': return { title: `${W} wheel bent`, effect: (block.bend ?? 0) > 3 ? 'it shakes badly at speed' : 'it vibrates at speed' };
    case 'tyre': {
      const p = block.pressure ?? 1;
      if (p <= M.effects.tyre.flatBelow) return { title: `${W} tyre flat`, effect: 'it\'s on its rim: almost no grip' };
      if ((block.leak ?? 0) > 0) return { title: `${W} tyre punctured`, effect: `it's losing air${p < 1 ? ` (${pct(p * 100)} left)` : ''}` };
      return { title: `${W} tyre low (${pct(p * 100)})`, effect: 'less grip' };
    }
    case 'radiator': return (block.leak ?? 0) > 0 ? { title: 'Radiator leaking', effect: 'the engine will overheat' } : { title: `Coolant low (${pct((block.coolant ?? 1) * 100)})`, effect: 'the engine runs hot' };
    case 'intake': return { title: 'Boost pipe split', effect: `${pct((block.boost ?? 0) * 100)} of the turbo's boost lost: less power` };
    case 'gearbox': return { title: 'Gearbox damaged', effect: (block.gears ?? 0) >= M.effects.gearbox.failFrom ? 'gears grind, and can miss' : 'gears grind going in' };
    case 'differential': return { title: 'Differential damaged', effect: 'it judders under power and pulls to one side' };
    case 'clutch': return { title: `Clutch worn (${pct((block.wear ?? 0) * 100)})`, effect: 'it slips under full power' };
    case 'exhaust': return { title: 'Exhaust holed', effect: 'louder, and a little less power' };
    default: return { title: `${name} damaged`, effect: 'it works less well' };
  }
}

export function carProblems(db, profile, carInstanceId) {
  const car = profile.cars[carInstanceId], def = db.cars[car.carId], work = carWork(db, profile, carInstanceId);
  const owned = ownedBySocket(db, profile, carInstanceId), d = drivability(def, owned, db.damage), stops = new Set(d.blocking.map(b => `${b.target}|${b.scope}`));
  const spares = Object.values(profile.parts).filter(x => !x.installedOn && db.parts[x.partId]);
  const problems = [];
  for (const p of work.parts) {
    const x = profile.parts[p.instanceId], part = db.parts[x.partId], socket = def.sockets.find(s => s.name === p.socket);
    const fits = socket ? spares.filter(s => takes(def, socket, db.parts[s.partId])).sort((a, b) => (b.partId === x.partId) - (a.partId === x.partId) || b.condition - a.condition).map(s => s.instanceId) : [];
    for (const w of p.work) {
      const t = words(db, x, part, p.socket, w), stop = stops.has(`${p.instanceId}|${w.scope}`) || (w.scope === 'attach' && x.attach === 'detached' && part.slot === 'wheels');
      const zone = w.corner ?? zoneOf(def, p.socket, part);
      const sev = stop ? 'critical' : (w.scope === 'attach' && x.attach === 'detached') || (w.scope === 'condition' && (x.condition ?? 100) < 50) || (w.system && sevOf(w.system, w.corner ? x.damage?.[w.corner] : x.damage, db.damage.mechanical) >= 0.4) ? 'major' : 'minor';
      problems.push({ id: `${p.instanceId}|${w.scope}`, target: p.instanceId, scope: w.scope, socket: p.socket, partId: x.partId, ...t, severity: sev, stops: stop, zone, view: ZONE_VIEW[zone], quick: w.quick, full: w.full, spares: w.scope === 'attach' && x.attach === 'detached' ? [] : fits });
    }
  }
  for (const w of work.shell) {
    const dmg = car.damage ?? {};
    if (w.scope === 'body') {
      const c = dmg.condition ?? 100, zone = shellZone(dmg.dents);
      problems.push({ id: 'shell|body', target: 'shell', scope: 'body', socket: null, partId: null, title: c < 100 ? `Bodywork damaged (${pct(c)})` : 'Bodywork dented', effect: c < 100 ? 'dented panels: the longer it\'s left, the more it costs' : 'looks only', severity: c < 60 ? 'major' : 'minor', stops: false, zone, view: ZONE_VIEW[zone], quick: w.quick, full: w.full, spares: [] });
    } else {
      const t = nodeWords(w.node);
      problems.push({ id: `shell|${w.scope}`, target: 'shell', scope: w.scope, socket: null, partId: null, title: t.title, effect: t.effect, severity: 'minor', stops: false, zone: t.zone, view: ZONE_VIEW[t.zone], quick: w.quick, full: w.full, spares: [] });
    }
  }
  problems.sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.full - a.full);
  const zones = {};
  for (const p of problems) if (!zones[p.zone] || RANK[p.severity] > RANK[zones[p.zone]]) zones[p.zone] = p.severity;
  return { problems, zones, drivable: { ok: d.ok, reasons: d.reasons }, quick: work.quick, full: work.full };
}
