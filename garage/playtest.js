// The playtest log: what happens on an upgrade journey, change by change — parts bought, sold,
// fitted, taken off, repaired and tuned, setups and cars switched, money spent — with the car's
// performance rating and (when a runner is given) its Step 6 results after each change, to review how
// the journey feels. Worked out by comparing the player's profile before and after each change the
// player service makes, so it doesn't matter where the change came from (the garage, the console).
// The same in the page (dev/playtest.html shows it) and in Node (npm run playtest).
//
//   const log = new PlaytestLog({ service, db, store: localStorage, runTests: spec => … })
//   log.start() · log.stop() · log.entries · log.on(fn) · log.clear() · log.csv()

import { hasDamage } from './mechanical.js';
import { Garage } from './data.js';
import { carPrice, garageStateOf } from './player/profile.js';

const KEY = 'driveWorld.playtest.log';
export const PLAYTEST_TESTS = ['zeroTo100', 'braking', 'skidpad', 'lap'];

export class PlaytestLog {
  // store: something with getItem / setItem (localStorage; none: only in memory); runTests(spec) →
  // Promise<{ zeroTo100, braking, skidpad, lap }> (values), run once per build
  constructor({ service, db, store = null, runTests = null, key = KEY }) {
    this.service = service; this.db = db; this.store = store; this.runTests = runTests; this.key = key;
    this.listeners = new Set(); this.results = new Map(); this.queue = Promise.resolve();
    this.entries = this.#load();
    this.last = null; this.unlisten = null;
  }
  get running() { return !!this.unlisten; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit() { for (const fn of this.listeners) fn(this.entries); }

  // Start recording (an entry for how things stand now), stop
  start() {
    if (this.unlisten) return;
    this.last = clone(this.service.profile);
    this.#add(this.last, [{ kind: 'start', text: this.entries.length ? 'Log picked up again' : 'Playtest started' }]);
    this.unlisten = this.service.on(({ profile }) => {
      const now = clone(profile), what = describe(this.last, now, this.db);
      this.last = now;
      if (what.length) this.#add(now, what);
    });
  }
  stop() { this.unlisten?.(); this.unlisten = null; }
  clear() { this.entries = []; this.#save(); this.#emit(); }

  #add(profile, what) {
    const car = profile.currentCar, g = new Garage(this.db, garageStateOf(profile, this.db)), s = g.stats();
    const r = s.totals?.rating, prev = this.entries.at(-1);
    const moneyIn = what.filter(w => w.money > 0).reduce((a, w) => a + w.money, 0), moneyOut = -what.filter(w => w.money < 0).reduce((a, w) => a + w.money, 0);
    const entry = {
      n: (prev?.n ?? 0) + 1, at: new Date().toISOString(), kinds: [...new Set(what.map(w => w.kind))], text: what.map(w => w.text).join('; '),
      money: profile.money, spent: (prev?.spent ?? 0) + moneyOut, earned: (prev?.earned ?? 0) + moneyIn,
      car, carName: this.db.cars[profile.cars[car]?.carId]?.name ?? car, fingerprint: g.build.fingerprint,
      rating: r ? { index: r.index, class: r.class } : null,
      estimates: r ? { zeroTo100: round(r.estimates.zeroTo100, 2), topSpeed: round(r.estimates.topSpeed, 1), grip: round(r.estimates.grip, 3), braking: round(r.estimates.braking, 1) } : null,
      power: s.totals ? round(s.totals.peakPower.hp, 1) : null, mass: s.spec ? round(s.spec.mass, 1) : null,
      upgrades: fittedUpgrades(profile, this.db, car),
      tests: this.results.get(g.build.fingerprint) ?? null,
    };
    this.entries.push(entry);
    this.#save(); this.#emit();
    // the Step 6 tests for a build not run yet (one at a time, in the background)
    if (this.runTests && s.spec && !entry.tests) {
      const fp = g.build.fingerprint, spec = s.spec;
      this.queue = this.queue.then(async () => {
        if (!this.results.has(fp)) { try { this.results.set(fp, await this.runTests(spec)); } catch (err) { this.results.set(fp, { error: String(err?.message ?? err) }); } }
        for (const e of this.entries) if (e.fingerprint === fp && !e.tests) e.tests = this.results.get(fp);
        this.#save(); this.#emit();
      });
    }
  }
  // (all done: every queued test run finished)
  settled() { return this.queue; }

  #load() { try { return JSON.parse(this.store?.getItem(this.key) ?? '[]'); } catch { return []; } }
  #save() { try { this.store?.setItem(this.key, JSON.stringify(this.entries)); } catch { /* not kept */ } }

  csv() { return toCsv(this.entries); }
}

export const CSV_COLUMNS = ['n', 'at', 'text', 'money', 'spent', 'earned', 'carName', 'rating', 'class', 'power', 'mass', 'est0to100', 'estTop', 'estGrip', 'estBraking', 'zeroTo100', 'braking', 'skidpad', 'lap', 'upgrades'];
export function toCsv(entries) {
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const row = e => [e.n, e.at, e.text, e.money, e.spent, e.earned, e.carName, e.rating?.index, e.rating?.class, e.power, e.mass, e.estimates?.zeroTo100, e.estimates?.topSpeed, e.estimates?.grip, e.estimates?.braking,
    e.tests?.zeroTo100, e.tests?.braking, e.tests?.skidpad, e.tests?.lap, (e.upgrades ?? []).join(' ')];
  return [CSV_COLUMNS.join(','), ...entries.map(e => row(e).map(cell).join(','))].join('\n') + '\n';
}

// ---------- what changed between two profiles, in words ----------

export function describe(a, b, db) {
  const out = [], name = id => db.parts[id]?.name ?? id, money = n => `$${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
  const count = list => { const m = new Map(); for (const p of list) m.set(p.partId, (m.get(p.partId) ?? 0) + 1); return [...m]; };
  const pa = a.parts, pb = b.parts, spend = b.money - a.money;
  const bought = Object.values(pb).filter(p => !pa[p.instanceId]), gone = Object.values(pa).filter(p => !pb[p.instanceId]);
  const newCars = Object.keys(b.cars).filter(c => !a.cars[c]);
  // money goes with what it was for: bought (or a car), sold, repaired
  let left = spend;
  for (const c of newCars) { const price = carPrice(db, db.cars[b.cars[c].carId]); out.push({ kind: 'car', text: `bought a ${db.cars[b.cars[c].carId]?.name ?? 'car'}`, money: -price }); left += price; }
  for (const [id, n] of count(bought.filter(p => !newCars.includes(p.installedOn?.car)))) { const cost = (db.parts[id]?.price ?? 0) * n; out.push({ kind: 'buy', text: `bought ${n > 1 ? `${n} × ` : ''}${name(id)}`, money: -cost }); left += cost; }
  for (const [id, n] of count(gone)) { out.push({ kind: 'sell', text: `sold ${n > 1 ? `${n} × ` : ''}${name(id)}`, money: 0 }); }
  const repaired = Object.values(pb).filter(p => pa[p.instanceId] && (p.condition > pa[p.instanceId].condition || (hasDamage(pa[p.instanceId].damage) && !hasDamage(p.damage))));
  for (const [id, n] of count(repaired)) out.push({ kind: 'repair', text: `repaired ${n > 1 ? `${n} × ` : ''}${name(id)}`, money: 0 });
  // (worn: damage from driving, an over-revved engine)
  for (const p of Object.values(pb).filter(p => pa[p.instanceId] && p.condition < pa[p.instanceId].condition))
    out.push({ kind: 'damage', text: p.condition <= 0 && db.parts[p.partId]?.engine ? `blew the ${name(p.partId)}` : `${name(p.partId)} damaged (condition ${pa[p.instanceId].condition} → ${p.condition})`, money: 0 });
  // (mechanical damage: bent, leaking, worn — garage/mechanical.js)
  for (const p of Object.values(pb).filter(p => pa[p.instanceId] && hasDamage(p.damage) && !hasDamage(pa[p.instanceId].damage)))
    out.push({ kind: 'damage', text: `${name(p.partId)} damaged (${Object.keys(p.damage).join(', ')})`, money: 0 });
  // (what's left of the money change: sales in, repairs out — split between them)
  const sells = out.filter(o => o.kind === 'sell'), repairs = out.filter(o => o.kind === 'repair');
  if (left > 0 && sells.length) { sells[0].money = left; sells[0].text += ` for ${money(left)}`; left = 0; }
  if (left < 0 && repairs.length) { repairs[0].money = left; repairs[0].text += ` (${money(left)})`; left = 0; }
  if (left) out.push({ kind: 'money', text: `${left > 0 ? 'earned' : 'spent'} ${money(left)}`, money: left });
  // fitted and taken off (on cars the player already had)
  const fittedTo = p => p?.installedOn ? `${p.installedOn.car}|${p.installedOn.socket}` : null;
  const on = [], off = [];
  for (const p of Object.values(pb)) if (!newCars.includes(p.installedOn?.car) && fittedTo(p) !== fittedTo(pa[p.instanceId]) && p.installedOn) on.push(p);
  for (const p of Object.values(pa)) if (fittedTo(p) && fittedTo(pb[p.instanceId]) !== fittedTo(p) && !pb[p.instanceId]?.installedOn) off.push(p);
  const switched = Object.keys(b.cars).some(c => a.cars[c] && b.cars[c].activeSetup !== a.cars[c].activeSetup && (on.length || off.length));
  if (switched) { const c = Object.keys(b.cars).find(c => a.cars[c] && b.cars[c].activeSetup !== a.cars[c].activeSetup); out.push({ kind: 'setup', text: `switched to the setup "${b.cars[c].setups[b.cars[c].activeSetup]?.name ?? '?'}"` }); }
  else {
    for (const [id, n] of count(on)) out.push({ kind: 'install', text: `fitted ${n > 1 ? `${n} × ` : ''}${name(id)}` });
    for (const [id, n] of count(off.filter(p => pb[p.instanceId]))) out.push({ kind: 'remove', text: `took off ${n > 1 ? `${n} × ` : ''}${name(id)}` });
  }
  // tuning
  for (const p of Object.values(pb)) {
    const was = pa[p.instanceId]?.tuning ?? {}, now = p.tuning ?? {};
    for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) if (was[k] !== now[k] && pa[p.instanceId]) {
      const t = db.parts[p.partId]?.tuning?.[k];
      out.push({ kind: 'tune', text: `tuned ${name(p.partId)}: ${t?.label ?? k} ${now[k] ?? `${t?.default} (default)`}${t?.unit && now[k] != null ? ` ${t.unit}` : ''}` });
    }
  }
  if (b.currentCar !== a.currentCar && !newCars.includes(b.currentCar)) out.push({ kind: 'car', text: `drove the ${db.cars[b.cars[b.currentCar]?.carId]?.name ?? 'car'} (${b.currentCar})` });
  for (const c of Object.keys(b.cars)) if (a.cars[c] && JSON.stringify(a.cars[c].paint ?? null) !== JSON.stringify(b.cars[c].paint ?? null)) out.push({ kind: 'paint', text: `painted it ${b.cars[c].paint?.colour ?? 'back to the factory colour'}` });
  return out;
}

// the non-stock parts on a car
function fittedUpgrades(profile, db, car) {
  const def = db.cars[profile.cars[car]?.carId], stock = new Set(def?.sockets.flatMap(s => s.stock) ?? []);
  return [...new Set(Object.values(profile.parts).filter(p => p.installedOn?.car === car && !stock.has(p.partId)).map(p => p.partId))].sort();
}
const clone = x => JSON.parse(JSON.stringify(x));
const round = (v, d) => v == null ? null : +v.toFixed(d);
