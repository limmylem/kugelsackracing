// The garage in the page (one for the whole page: the test worlds and the real world share it):
//  - loads every car and part and checks them against the schemas at startup (problems go to the
//    console and `problems`);
//  - the player's garage (owned parts, cars and builds), kept in this browser;
//  - `spec`: the current car's physics spec, one live object every car drives on: fitting or
//    removing a part rebuilds it in place and tells the listeners (onChange) so the cars re-derive;
//  - onLook: any change to what the car looks like (a part fitted or taken off, even one the car can't
//    drive without, the paint, a part's own colour), for the drawing (garage/visual.js);
//  - changes to the build, a part's condition or its tuning go through gates the game sets
//    (addChangeGate: normal play only allows them while the car is stopped; debugMode allows them
//    while driving); drivable says whether the car can be driven now, and if not, why;
//  - the debug console: window.garage.install('cold_air_intake'), .remove(…), .stats(), .paint(…),
//    .help() … (the game adds its own: debug(name, fn, help));
//  - saveEdits: tuning-panel edits written back to the car or part file each value comes from.

import { Garage, loadGarageData } from './data.js';
import { recordStore } from '../quest/recordStore.js';
import { changes, changesText, explain, labelOf, num, totalsText } from './report.js';
import { getPath } from './stats.js';
import { LocalPlayerService } from './player/service.js';
import { IdbStorage, MemoryStorage } from './player/storage.js';
import { garageStateOf, inInventory, carName, sellPrice } from './player/profile.js';
import { PLAYTEST_TESTS, PlaytestLog } from './playtest.js';
import { crashOutcome } from './carDamage.js';
import { CORNERS, DEBUG_KINDS, damageReport, mechanicalLayout, prune, setMechanical, strikeMechanical } from './mechanical.js';
import { fingerprint } from './fingerprint.js';

// (a value that isn't there stays not there: JSON has no undefined, and parsing nothing throws)
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
let session = null;

export function garageSession() { return session ??= create(); }

// Copy every value of source into target in place (the physics keeps holding the same objects), and
// drop what source no longer has (a turbo taken off: no spec.turbo)
export function assignDeep(target, source) {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const [k, v] of Object.entries(source)) {
    if (Array.isArray(v) && Array.isArray(target[k])) { target[k].length = v.length; v.forEach((x, i) => { if (x && typeof x === 'object') { if (typeof target[k][i] !== 'object' || target[k][i] === null || Array.isArray(target[k][i]) !== Array.isArray(x)) target[k][i] = Array.isArray(x) ? [] : {}; assignDeep(target[k][i], x); } else target[k][i] = x; }); }
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) assignDeep(target[k], v);
    else target[k] = clone(v);
  }
  return target;
}

async function create() {
  const readJson = async p => { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };
  const { db, problems } = await loadGarageData(readJson);
  if (problems.length) console.warn(`The car and part data has ${problems.length} problem(s) (npm run check):\n${problems.map(p => `  ${p.file} ${p.path}: ${p.message}`).join('\n')}`);

  // the player's profile (money, cars, parts, setups), kept in this browser by the player service —
  // the only thing that changes it (garage/player)
  // (quests: their rules, and the best runs' recordings kept apart from the save — quest/recordStore.js)
  const quests = { config: await readJson('data/quests.json'), recordings: recordStore() };
  let player = new LocalPlayerService({ db, storage: new IdbStorage(), quests }), loaded;
  try { loaded = await player.init(); }
  catch (err) {
    console.warn(`The save in this browser can't be opened (${err.message ?? err}): playing without saving this time.`);
    player = new LocalPlayerService({ db, storage: new MemoryStorage(), quests });
    loaded = await player.init();
  }
  if (loaded.notices.length) console.warn(`Your save was brought up to date:\n${loaded.notices.map(n => `  · ${n}`).join('\n')}`);
  const garage = new Garage(db, garageStateOf(loaded.updatedState, db));
  // playtest mode: the upgrade log (garage/playtest.js), kept in this browser; on or off in the garage's
  // settings (or player.playtest(true)), with the Step 6 tests run in the background for each build
  const PLAYTEST_ON = 'driveWorld.playtest.on', store = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
  const playtest = new PlaytestLog({ service: player, db, store, runTests: spec => import('./playtestRunner.js').then(m => m.runPlaytestTests(spec, PLAYTEST_TESTS)) });
  const playtestOn = () => { try { return store?.getItem(PLAYTEST_ON) === '1'; } catch { return false; } };
  if (playtestOn()) playtest.start();
  // development: unlimited money (kept in this browser, not in the save)
  const UNLIMITED = 'driveWorld.dev.unlimitedMoney';
  try { if (store?.getItem(UNLIMITED) === '1') player.setUnlimitedMoney(true); } catch { /* not kept */ }
  // parts shaken loose or torn off (garage/detach.js): { socket: { state, stress, perf } } — perf: it
  // counts for the car's performance (full damage: kept in the save too, on the part, until a repair or
  // a session's reset puts it back; visual only: for this drive). Every change also an event. pending:
  // sockets whose change is on its way to the save (the save's word doesn't count for them till it's there)
  const attach = { states: {}, events: [], listeners: new Set(), pending: new Map() };
  // a test drive (the dealership): a dealer's stock car in place of the player's, driven and not kept —
  // { carId, name } while one's on (testDrive(), endTestDrive())
  let trial = null;
  // (the build the car drives as: the drive's own states say what's off — the save's are in them)
  const attachBuild = () => {
    const a = Object.fromEntries(Object.entries(attach.states).filter(([, x]) => x.perf && x.state !== 'attached').map(([k, x]) => [k, x.state])), { attach: _, ...build } = garage.build;
    return Object.keys(a).length ? { ...build, attach: a } : build;
  };
  let current = garage.stats(attachBuild());
  const spec = clone(current.spec), listeners = new Set(), lookListeners = new Set();
  const applyStats = () => { current = garage.stats(attachBuild()); if (current.spec) { assignDeep(spec, current.spec); for (const fn of listeners) fn(spec, current); } };
  const lookChanged = () => { for (const fn of lookListeners) fn(garage); };
  // (what the car looks like: its build, paint and parts' looks, its dents — buying a part doesn't change it)
  // (mechanical damage doesn't change the look: the build's fingerprint without it)
  const lookPrint = () => fingerprint(garage.build, Object.fromEntries(Object.entries(garage.state.parts).map(([id, x]) => [id, x.damage ? { ...x, damage: undefined } : x])));
  const lookOf = () => JSON.stringify([garage.state.current, lookPrint(), garage.state.cars[garage.state.current]?.paint ?? null, Object.values(garage.build.sockets).map(id => garage.state.parts[id]?.paint ?? null), damageOf()]);
  // the car driven's crash damage, for the drawing: { shell: { condition, dents, broken }, parts: { socket: dents } }
  function damageOf() {
    const p = player.profile, car = !trial && p?.cars[p.currentCar];
    if (!car) return { shell: null, parts: {} };
    const parts = {};
    for (const [socket, id] of Object.entries(garage.build.sockets)) if (id && p.parts[id]?.dents?.length) parts[socket] = p.parts[id].dents;
    return { shell: car.damage ?? null, parts };
  }
  let look = lookOf(), fingerprintNow = garage.build.fingerprint;
  player.on(({ profile }) => {
    if (trial) return;                    // (the player's own car is back when the test drive ends)
    garage.state = garageStateOf(profile, db);
    const moved = syncAttach('save');
    if (moved || garage.build.fingerprint !== fingerprintNow || look !== lookOf()) { fingerprintNow = garage.build.fingerprint; applyStats(); }
    if (look !== lookOf()) { look = lookOf(); lookChanged(); }
  });
  // The save's parts loose or off into the drive's states (and a part the save has back on — repaired, a
  // session's reset — back on here), but for those with a change of their own on the way
  function syncAttach(reason) {
    if (trial) return false;
    const p = player.profile, want = {};
    for (const [socket, id] of Object.entries(garage.build.sockets)) { const a = id && p.parts[id]?.attach; if (a) want[socket] = a; }
    let moved = false;
    for (const socket of new Set([...Object.keys(want), ...Object.keys(attach.states)])) {
      const have = attach.states[socket], to = want[socket] ?? 'attached', was = have?.state ?? 'attached';
      if (attach.pending.has(socket) || was === to || (to === 'attached' && !have?.perf)) continue;
      if (to === 'attached') delete attach.states[socket]; else attach.states[socket] = { state: to, stress: have?.stress ?? 0, perf: true };
      note(socket, was, to, reason);
      moved = true;
    }
    return moved;
  }
  // (an attach change: an event, for the listeners and syncing)
  function note(socket, from, state, reason) {
    const id = garage.build.sockets[socket], e = { time: new Date().toISOString(), car: carNow(), socket, instanceId: id, partId: garage.state.parts[id]?.partId ?? null, from, state, reason };
    attach.events.push(e);
    if (attach.events.length > 500) attach.events.splice(0, attach.events.length - 500);
    for (const fn of attach.listeners) fn(e);
    return e;
  }
  // (every part back on in the drive only: a dealer's car coming or going — the save's stay as they are)
  function clearAttach(reason) {
    for (const socket of Object.keys(attach.states)) { const was = attach.states[socket].state; delete attach.states[socket]; note(socket, was, 'attached', reason); }
  }
  // (an attach change on its way to the save)
  function pend(sockets, promise) {
    const mark = {};
    for (const s of sockets) attach.pending.set(s, mark);
    return promise.then(r => { for (const s of sockets) if (attach.pending.get(s) === mark) attach.pending.delete(s); if (syncAttach('save')) applyStats(); return r; });
  }

  // print what a change did
  const report = (title, r, before) => {
    const lines = [`${r.ok ? '✔' : '✘'} ${title}`];
    if (r.error) lines.push(`   ✘ ${r.error}`);
    for (const w of r.warnings ?? []) lines.push(`   ! ${w}`);
    if (r.ok && before) {
      const after = garage.stats();
      lines.push('', changesText(changes(before, after).filter(c => !c.path.startsWith('centreOfMass')), after));
      if (after.totals) lines.push('', `   now: ${totalsText(after.totals)}`, `   was: ${totalsText(before.totals)}`);
    }
    console.log(lines.join('\n'));
  };
  // (the game's rule for when the build may change: returns why not, or nothing)
  const gates = [() => trial ? `You're test driving the ${trial.name}: buy it in the dealership to change it.` : null];
  let debugMode = false;
  const blocked = (title, quiet) => {
    const why = debugMode ? null : gates.map(g => g()).find(Boolean);
    if (!why) return null;
    if (!quiet) console.log(`✘ ${title}\n   ✘ ${why}`);
    return { ok: false, errors: [why], warnings: [] };
  };
  // a change asked of the player service (from the console, or the game's keys)
  const change = async (title, ask, quiet) => {
    const no = blocked(title, quiet);
    if (no) return no;
    const before = garage.stats(), r = await ask();
    if (!quiet) report(title, r, before);
    return { ok: r.ok, errors: r.error ? [r.error] : [], warnings: r.warnings ?? [], result: r };
  };
  const profile = () => player.profile, carNow = () => profile().currentCar;
  const copiesIn = which => garage.fittedIn(which).map(f => f.instance.instanceId);
  // the copy of a part to fit: a copy's own id, or the player's best spare copy of a part
  const spareCopy = id => profile().parts[id] ? id : inInventory(profile()).filter(p => p.partId === id).sort((a, b) => b.condition - a.condition)[0]?.instanceId ?? null;

  // ---------- mechanical damage (garage/mechanical.js) ----------
  // (blocks sent to the save but maybe not in it yet: the next change works from them, not the old ones)
  const pendingDamage = new Map();
  const wheelSockets = () => CORNERS.map(k => garage.car.model.sockets[k]).filter(Boolean);
  const mechanical = {
    layout() {
      const torn = Object.fromEntries(Object.entries(attach.states).filter(([, x]) => x.state === 'detached').map(([k]) => [k, 'detached']));
      return mechanicalLayout({ car: garage.car, build: { ...garage.build, attach: torn }, db: garage.view });
    },
    state() {
      const p = player.profile, out = {};
      for (const id of Object.values(garage.build.sockets)) if (id) out[id] = pendingDamage.get(id) ?? p.parts[id]?.damage ?? {};
      return out;
    },
    // (a save under way: its blocks count until it's done)
    save(promise, blocks) {
      for (const [id, b] of Object.entries(blocks)) pendingDamage.set(id, b);
      return promise.then(r => { for (const [id, b] of Object.entries(blocks)) if (pendingDamage.get(id) === b) pendingDamage.delete(id); return r; });
    },
    write(blocks, cause) {
      if (!Object.keys(blocks).length || trial) return Promise.resolve(null);      // (a test drive keeps nothing)
      const parts = Object.fromEntries(Object.entries(blocks).map(([id, b]) => [id, { damage: b }]));
      return mechanical.save(player.damageCar(carNow(), { parts }, { cause }), blocks);
    },
    // a wheel torn off: for this drive (the reset or the garage puts it back), bent and flat
    tearOff(corners, mode, reason) {
      const L = mechanical.layout(), blocks = {}, R = db.damage.mechanical;
      for (const k of corners) {
        const socket = garage.car.model.sockets[k];
        if (!api.attach.set(socket, 'detached', { mode, reason })) continue;
        const rim = L.carriers.rim[k], tyre = L.carriers.tyre[k], st = mechanical.state();
        if (rim) blocks[rim] = prune({ ...(st[rim] ?? {}), bend: R.systems.rim.max });
        if (tyre) blocks[tyre] = prune({ ...(st[tyre] ?? {}), pressure: 0, leak: 0 });
      }
      return blocks;
    },
    strike(corner, strength, { mode = 'full', kind = 'kerb', tearOff = true } = {}) {
      const r = strikeMechanical(mechanical.state(), corner, strength, mechanical.layout(), db.damage?.mechanical, { mode, kind });
      if (r.wheelOff.length && tearOff) Object.assign(r.damage, mechanical.tearOff(r.wheelOff, mode, `a ${kind} at ${strength.toFixed(0)} m/s`));
      return { ...r, saved: mechanical.write(r.damage, `${kind} strike`) };
    },
    // the physics' live values (physics/mechanical.js changes()): { pressure: { FL: … }, coolant, clutch }
    writeBack(live) {
      if (!live) return Promise.resolve(null);
      const L = mechanical.layout(), st = mechanical.state(), blocks = {};
      for (const [k, p] of Object.entries(live.pressure ?? {})) { const id = L.carriers.tyre[k]; if (id && !L.off[k]) blocks[id] = prune({ ...(st[id] ?? {}), pressure: p }); }
      if (live.coolant != null && L.carriers.radiator) blocks[L.carriers.radiator] = prune({ ...(st[L.carriers.radiator] ?? {}), coolant: live.coolant });
      if (live.clutch != null && L.carriers.clutch) blocks[L.carriers.clutch] = prune({ ...(st[L.carriers.clutch] ?? {}), wear: live.clutch });
      return mechanical.write(blocks, 'driving');
    },
    // a money shift (an over-rev downshift): its toll on the gearbox
    gearboxWear(amount, { mode = 'full' } = {}) {
      const id = mechanical.layout().carriers.gearbox, R = db.damage?.mechanical;
      if (mode !== 'full' || !id || !(amount > 0) || !R) return Promise.resolve(null);
      const b = mechanical.state()[id] ?? {}, gears = Math.min(R.systems.gearbox.max, +((b.gears ?? 0) + amount).toFixed(4));
      return mechanical.write({ [id]: prune({ ...b, gears }) }, 'over-rev downshift');
    },
    // (debug) one system's damage straight: kind (DEBUG_KINDS), value (null: fine), corner
    set(kind, value, corner) {
      const r = setMechanical(mechanical.state(), kind, value, corner, mechanical.layout());
      if (r.error) return Promise.resolve({ ok: false, errors: [r.error] });
      return mechanical.write(r.damage, 'debug').then(x => ({ ok: !!x?.ok, errors: x?.error ? [x.error] : [] }));
    },
  };

  // (the drive starts with the save's parts loose or off)
  syncAttach('save');
  applyStats();

  const api = {
    db, garage, spec, problems, player,
    playtest: {
      log: playtest,
      get on() { return playtest.running; },
      set(on) { try { store?.setItem(PLAYTEST_ON, on ? '1' : '0'); } catch { /* not kept */ } if (on) playtest.start(); else playtest.stop(); },
    },
    // development switches: unlimited money (nothing costs anything; kept in this browser)
    dev: {
      get unlimitedMoney() { return !!player.unlimited; },
      setUnlimitedMoney(on) { try { store?.setItem(UNLIMITED, on ? '1' : '0'); } catch { /* not kept */ } return player.setUnlimitedMoney(on); },
    },
    get stats() { return current; },
    get paint() { return garage.paint; },
    get notices() { return loaded.notices; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onLook(fn) { lookListeners.add(fn); return () => lookListeners.delete(fn); },

    // Changes to the car driven, through the player service (so only parts the player owns; each
    // answers a promise of { ok, errors, warnings }):
    //  the paint: a colour (#rrggbb) and a paint finish (gloss, matte, metallic, pearl), or nothing for
    //  the factory paint; a fitted part's own colour / finish (which: a socket, group or part id)
    setPaint(colour, finish) {
      const f = finish ?? garage.paint?.finish ?? 'gloss';
      return change(colour == null ? 'factory paint' : `paint ${colour} ${f}`, () => player.setPaint(carNow(), colour == null ? null : { colour, finish: f }), true);
    },
    paintPart(which, look) {
      const ids = copiesIn(which);
      if (!ids.length) return Promise.resolve({ ok: false, errors: [`Nothing called "${which}" is fitted to ${garage.car.name}.`], warnings: [] });
      return change(`look of ${which}`, () => player.setPartFinish(ids, look), true);
    },
    //  fit a part the player has (a copy's id, or a part id: their best spare copy)
    install(id, opts = {}) {
      const copy = spareCopy(id), name = db.parts[profile().parts[id]?.partId ?? id]?.name ?? id;
      if (!copy) { const r = { ok: false, errors: [`You don't have a spare ${name}: buy one in the shop (or player.givePart("${id}")).`], warnings: [] }; if (!opts.quiet) console.log(`✘ fit ${name}\n   ✘ ${r.errors[0]}`); return Promise.resolve(r); }
      return change(`fit ${name}`, () => player.installPart(carNow(), copy, { socket: opts.socket, auto: opts.auto }), opts.quiet);
    },
    remove(x, opts = {}) { return change(`take off ${x}`, () => player.removePart(carNow(), x, { auto: opts.auto }), opts.quiet); },
    reset() { console.log('To go back to stock: the setups in the garage (every car starts with a "Stock" setup), or player.reset() to start the whole profile again.'); return Promise.resolve({ ok: false, errors: ['use the setups'], warnings: [] }); },
    //  damage from driving to the car driven's engine (an over-rev: bent valves, blown): written to the
    //  player's profile at once, whatever the gates say (it happened on the road); the engine's condition
    //  only goes down this way, a repair in the garage brings it back
    wearEngine(condition, cause) {
      const id = Object.values(garage.build.sockets).find(i => i && db.parts[garage.state.parts[i]?.partId]?.engine);
      if (trial && id) { garage.state.parts[id].condition = condition; applyStats(); return Promise.resolve({ ok: true, errors: [], warnings: ['a test drive: not kept'] }); }
      if (!id) return Promise.resolve({ ok: false, errors: ['No engine fitted.'], warnings: [] });
      return player.wearPart(id, condition, { cause }).then(r => ({ ok: r.ok, errors: r.error ? [r.error] : [], warnings: [], result: r }));
    },
    //  development: every part on the car back to 100% (a blown engine running again), dents out, the
    //  body as new, free, whatever the gates say (the test worlds' reset-car key)
    restoreCar() {
      api.attach.reattachAll('restored');
      if (trial) { for (const x of Object.values(garage.state.parts)) { x.condition = 100; delete x.damage; delete x.dents; } applyStats(); lookChanged(); return Promise.resolve({ ok: true, errors: [], warnings: [] }); }
      return player.restoreCar(carNow()).then(r => ({ ok: r.ok, errors: r.error ? [r.error] : [], warnings: [] }));
    },
    //  the car driven's crash damage (for the drawing), and what a crash does to it: impact from
    //  physics/impacts.js, mode 'full' | 'visual' | 'off', boxes: the body's glass and lights
    //  (physics/sockets.js nodeBoxes), scale: the share of it the car takes (reduced damage from other
    //  cars: physics/carCollisions.js). Worked out as every car's is (garage/carDamage.js) and written to
    //  the player's car at once, whatever the gates say (it happened on the road): the hits that dented
    //  each part, conditions, mechanical damage, parts loose or off. Returns the impact's result (what was
    //  hit, dents, losses, broken, attach, mechanical) and next (the body damage after)
    get damage() { return damageOf(); },
    crash(impact, { mode = 'full', boxes = {}, detach = true, scale = 1 } = {}) {
      const hit = scale === 1 ? impact : { ...impact, strength: impact.strength * scale, closing: (impact.closing ?? impact.strength) * scale };
      const p = player.profile, sockets = garage.build.sockets, car = !trial && p.cars[carNow()];
      const out = crashOutcome({
        car: garage.car, build: garage.build, view: garage.view, boxes, rules: db.damage, attach: attach.states, mech: mechanical.state(),
        damage: { shell: car ? car.damage ?? null : null, parts: Object.fromEntries(Object.values(sockets).filter(Boolean).map(id => [id, { condition: garage.state.parts[id]?.condition ?? 100, dents: (car && p.parts[id]?.dents) || [] }])) },
      }, hit, { mode, detach });
      const { result, mech, next } = out;
      // (parts shaken loose or torn off — a wheel too: kept in the save, with full damage)
      for (const c of out.changes) api.attach.set(c.socket, c.to, { mode, reason: c.reason, stress: c.stress });
      result.attach = out.changes;
      result.mechanical = mech;
      if (mode === 'off' || trial || (!result.dents.length && !result.losses.length && !result.broken.length && !Object.keys(mech.damage).length)) return { result, next, saved: Promise.resolve(null) };
      const parts = {}, hitsOf = target => result.dents.filter(d => d.target === target).map(({ target: _, ...d }) => d);
      for (const id of out.touched) { const socket = Object.keys(sockets).find(k => sockets[k] === id); parts[id] = { condition: next.parts[id].condition, ...(socket && { hits: hitsOf(socket) }) }; }
      for (const [id, block] of Object.entries(mech.damage)) parts[id] = { ...(parts[id] ?? {}), damage: block };
      const shell = { condition: next.shell.condition, hits: hitsOf('shell'), broken: next.shell.broken };
      const saved = mechanical.save(player.damageCar(carNow(), { parts, shell }, { cause: `${result.class} into ${result.material}` }), mech.damage);
      return { result, next, saved };
    },
    //  mechanical damage (garage/mechanical.js): what the car carries, a kerb strike or heavy landing
    //  (the physics' strike events), what's changed while driving written back (the physics' live tyre
    //  pressures, coolant and clutch wear), money shifts' toll on the gearbox, and debug settings
    mechanical: {
      get layout() { return mechanical.layout(); },
      report: live => damageReport(api.spec.damage, live),
      strike: (corner, strength, opts) => mechanical.strike(corner, strength, opts),
      writeBack: live => mechanical.writeBack(live),
      gearboxWear: (amount, opts) => mechanical.gearboxWear(amount, opts),
      set: (kind, value, corner) => mechanical.set(kind, value, corner),
      kinds: Object.keys(DEBUG_KINDS),
    },
    //  parts shaken loose or torn off in a crash (for this drive: a reset, the garage, puts them back on
    //  as they are, dents and all): states, the events (for syncing), set one, all back on, and onChange
    attach: {
      get states() { return attach.states; },
      get events() { return attach.events; },
      stateOf: socket => attach.states[socket]?.state ?? 'attached',
      on(fn) { attach.listeners.add(fn); return () => attach.listeners.delete(fn); },
      // (mode: the damage setting — full: it counts for the performance, and it's kept in the save; visual:
      // looks only, for this drive; off: nothing)
      set(socket, state, { mode = 'full', reason = null, stress } = {}) {
        const had = attach.states[socket], was = had?.state ?? 'attached', id = garage.build.sockets[socket], part = id && db.parts[garage.state.parts[id]?.partId];
        if (mode === 'off' || !part || state === was) return false;
        if (state !== 'attached' && !part.detach?.detachable && !wheelSockets().includes(socket)) return false;   // (a wheel: torn off by a huge hit)
        if (state === 'attached') delete attach.states[socket];
        else attach.states[socket] = { state, stress: stress ?? had?.stress ?? 0, perf: mode === 'full' || !!had?.perf };
        // (into the save: off further with full damage; back on — the debug commands — free)
        if (!trial && (state === 'attached' ? had?.perf : mode === 'full')) pend([socket], state === 'attached' ? player.setAttach(carNow(), { [socket]: 'attached' }) : player.damageCar(carNow(), { parts: { [id]: { attach: state } } }, { cause: reason ?? 'crash' }));
        note(socket, was, state, reason);
        applyStats();
        return true;
      },
      // Back on the road (or a test drive starting): what a session's reset puts back on (kind: data/
      // sessions.json — a test drive: every part; a race: only a wheel torn off), in the drive and the save,
      // free. Returns how many came back on
      reattachAll(reason = 'reset', { kind = 'test' } = {}) {
        const wheels = wheelSockets(), back = Object.keys(attach.states).filter(s => db.sessions?.kinds[kind]?.reset !== 'wheels' || wheels.includes(s));
        for (const socket of back) { const was = attach.states[socket].state; delete attach.states[socket]; note(socket, was, 'attached', reason); }
        if (back.length && !trial) pend(back, player.sessionReset(carNow(), { kind }));
        if (back.length) applyStats();
        return back.length;
      },
      // Into the garage: what came loose or off with visual-only damage (looks, for that drive) back on;
      // with full damage it stays as it is, for the damage report and the repairs
      dropTransient(reason = 'garage') {
        const back = Object.entries(attach.states).filter(([, x]) => !x.perf).map(([s]) => s);
        for (const socket of back) { const was = attach.states[socket].state; delete attach.states[socket]; note(socket, was, 'attached', reason); }
        if (back.length) applyStats();
        return back.length;
      },
      // (the save's states into the drive: after a repair, a reset or another car)
      sync: () => { const moved = syncAttach('save'); if (moved) applyStats(); return moved; },
    },
    //  a fitted part's condition (0–100) and its settings (which: a socket, socket group or part id)
    setCondition(which, value, opts = {}) { return change(`condition of ${which} → ${value}`, () => player.setCondition(copiesIn(which), value), opts.quiet); },
    tune(which, setting, value, opts = {}) {
      const ids = copiesIn(which).filter(id => db.parts[profile().parts[id].partId].tuning);
      if (!ids.length) return Promise.resolve({ ok: false, errors: [`Nothing tunable called "${which}" is fitted.`], warnings: [] });
      return change(`tune ${which}: ${setting} → ${value ?? 'default'}`, async () => { let r; for (const id of ids) r = await player.setTuning(id, { [setting]: value }); return r; }, opts.quiet);
    },
    get drivable() { return garage.drivable(); },
    // A test drive: the dealer's `carId`, stock, in place of the player's car until endTestDrive() —
    // nothing on it changes (a gate says why) and nothing it does is kept (damage, wear)
    testDrive(carId) {
      if (!db.cars[carId]) return { ok: false, errors: [`There's no car "${carId}".`] };
      clearAttach('test drive');
      trial = { carId, name: db.cars[carId].name };
      garage.state = Garage.freshState(db, carId);
      fingerprintNow = garage.build.fingerprint; look = lookOf();
      applyStats(); lookChanged();
      return { ok: true, errors: [] };
    },
    // A route's test drive from the editor: the player's own car as it is now (or a dealer's car, stock),
    // on a trial like the dealer's — whatever happens to it isn't kept — and the player's car as it was
    // after endTestDrive()
    testDriveOwn() {
      const p = player.profile, carId = p?.currentCar;
      if (!carId) return { ok: false, errors: ['No car to drive.'] };
      const state = clone(garage.state);
      clearAttach('test drive');
      trial = { carId, name: p.cars[carId]?.name ?? db.cars[p.cars[carId]?.model]?.name ?? 'your car', own: true };
      garage.state = state;
      fingerprintNow = garage.build.fingerprint; look = lookOf();
      applyStats(); lookChanged();
      return { ok: true, errors: [] };
    },
    endTestDrive() {
      if (!trial) return { ok: false, errors: ['Not on a test drive.'] };
      clearAttach('test drive over');
      trial = null;
      garage.state = garageStateOf(player.profile, db);
      fingerprintNow = garage.build.fingerprint; look = lookOf();
      syncAttach('save');
      applyStats(); lookChanged();
      return { ok: true, errors: [] };
    },
    get testDriving() { return trial ? { ...trial } : null; },
    get state() { return clone(garage.state); },
    get fingerprint() { return garage.build.fingerprint; },
    // the game's rules for when the build may change (each returns why not, or nothing)
    addChangeGate(fn) { gates.push(fn); },
    get debugMode() { return debugMode; },
    set debugMode(on) { debugMode = !!on; },
    isFitted(partId) { return Object.values(garage.build.sockets).some(id => id && garage.state.parts[id]?.partId === partId); },

    // Tuning-panel edits → the files they come from: a car's own values into its car.json, a part's
    // block into that part's file (mass and centre of mass into the chassis, so the whole car comes out
    // as edited). Values a modifier changes can't be saved this way (the file holds the value before
    // the modifier): those are listed. put(path, object) → Promise<bool> writes a file.
    async saveEdits(edited, put) {
      const s = garage.stats(), car = garage.car, files = new Map(), refused = [];
      const file = (rel, obj) => { if (!files.has(rel)) files.set(rel, { obj: clone(obj), n: 0 }); return files.get(rel); };
      const carFile = `data/cars/${car.id}/car.json`;
      const CAR_PATHS = { bodyCollider: 'dimensions.bodyCollider', spawnHeight: 'dimensions.spawnHeight' };
      const leaves = (v, p, out = []) => { if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${p}.${i}`, out)); else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) if (!k.startsWith('_') && k !== 'aeroParts') leaves(x, p ? `${p}.${k}` : k, out); } else out.push([p, v]); return out; };
      const set = (o, path, value) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = value; };
      let massEdited = false;
      const TENSOR = ['xx', 'yy', 'zz', 'xy', 'xz', 'yz'];
      for (const [path, value] of leaves(edited, '')) {
        if (value === getPath(s.spec, path)) continue;
        if (path === 'mass' || path.startsWith('centreOfMass')) { massEdited = true; continue; }
        if (path.startsWith('inertiaTensor.')) {
          // the chassis takes up the difference
          const k = TENSOR[+path.split('.')[1]], f = file(carFile, car);
          f.obj.chassis.inertia[k] += value - getPath(s.spec, path); f.n++;
          continue;
        }
        const steps = s.breakdown[path] || [], mods = steps.filter(x => ['add', 'multiply', 'boost', 'set', 'tune', 'condition'].includes(x.step));
        if (steps.some(x => x.step === 'wheels')) { refused.push(`${labelOf(path, s.spec)} (from the rims and tyres fitted)`); continue; }
        if (mods.length) { refused.push(`${labelOf(path, s.spec)} (changed by ${[...new Set(mods.map(m => m.step === 'tune' ? `${m.source.name}'s ${m.note}` : m.step === 'condition' ? `${m.source.name}'s ${m.note}` : m.source.name))].join(', ')})`); continue; }
        const src = steps[0]?.source;
        if (!src) { refused.push(labelOf(path, s.spec)); continue; }
        if (src.kind === 'car') { const top = path.split('.')[0], rest = path.slice(top.length); const f = file(carFile, car); set(f.obj, (CAR_PATHS[top] ?? top) + rest, value); f.n++; }
        else { const p = db.parts[src.id], f = file(`data/parts/${p.category}/${p.id}.json`, p); set(f.obj, path, value); f.n++; }
      }
      if (massEdited) {
        // the chassis takes up the difference, so the car's total mass and centre of mass come out as edited
        const f = file(carFile, car), partsMass = s.spec.mass - car.chassis.mass;
        const moment = [0, 1, 2].map(k => s.spec.centreOfMass[k] * s.spec.mass - car.chassis.centreOfMass[k] * car.chassis.mass);
        const chassisMass = edited.mass - partsMass;
        if (chassisMass <= 0) refused.push(`total mass ${num(edited.mass)} kg (the parts alone weigh ${num(partsMass)} kg)`);
        else { f.obj.chassis.mass = chassisMass; f.obj.chassis.centreOfMass = [0, 1, 2].map(k => (edited.centreOfMass[k] * edited.mass - moment[k]) / chassisMass); f.n++; }
      }
      const saved = [], failed = [];
      for (const [rel, f] of files) {
        if (await put(rel, f.obj)) {
          saved.push(`${f.n} to ${rel.split('/').slice(-2).join('/')}`);
          if (rel === carFile) db.cars[car.id] = f.obj; else db.parts[f.obj.id] = f.obj;
        } else failed.push(rel);
      }
      if (saved.length) { current = garage.stats(); for (const fn of listeners) fn(spec, current); }
      return { saved, failed, refused };
    },
  };

  const paintFinishes = () => Object.entries(db.finishes).filter(([, f]) => f.paint).map(([k]) => k);
  const partSockets = which => {
    const b = garage.build.sockets, car = garage.car;
    if (car.socketGroups?.[which]) return car.socketGroups[which].filter(s => b[s]);
    if (which in b) return b[which] ? [which] : [];
    return Object.keys(b).filter(s => b[s] && garage.state.parts[b[s]]?.partId === which);
  };

  // ---------- the debug console ----------
  const tableOfParts = filter => Object.values(db.parts).filter(p => !filter || `${p.id} ${p.name} ${p.slot} ${p.category}`.toLowerCase().includes(filter.toLowerCase()))
    .map(p => ({ id: p.id, name: p.name, slot: p.slot, kind: p.kind, price: p.price, kg: p.mass, fitted: Object.entries(garage.build.sockets).filter(([, i]) => i && garage.state.parts[i]?.partId === p.id).map(([s]) => s).join(' ') }));
  window.garage = {
    help() {
      console.log([
        'garage — fit and remove parts on the car you drive (it changes straight away):',
        '  garage.parts("intake")         the parts there are (a filter is optional)',
        '  garage.build()                 what\'s in every socket now',
        '  garage.install("cold_air_intake")          fit a part (in its socket; wheels and tyres on all four)',
        '  garage.install("cold_air_intake", { socket: "socket_intake", auto: false })   one socket; don\'t take things off that are in the way',
        '  garage.remove("socket_turbo")  or  garage.remove("turbo_kit")',
        '  garage.stats()                 totals and every number that isn\'t stock, with where it came from',
        '  garage.explain("engine.torqueCurve.8.1")   one number, step by step',
        '  garage.validate()              check the build',
        '  (parts come from the shop: player.help() for money, spare parts and the save)',
        `  garage.paint("#c8452f", "metallic")        paint the car (${paintFinishes().join(', ')}); garage.paint() for the factory paint`,
        '  garage.tuning()                the settings of the fitted tunable parts',
        '  garage.tune("sport_suspension", "rideHeight", -30)   a setting (outside its range: clamped; null: its default)',
        '  garage.condition("tyres", 40)  a fitted part\'s condition, 0–100 (a socket, group or part id)',
        '  garage.drivable()              whether the car can be driven, and why not',
        '  garage.debugMode(true)         let parts, tuning and condition change while driving (normally only when stopped)',
        '  garage.paintPart("wheels", { finish: "chrome" })   a fitted part\'s own colour / finish (a socket, group or part id; null: none)',
        ...extra.map(e => `  ${e.help}`),
        'Test parts: cold_air_intake, sport_suspension, front_mount_intercooler, turbo_kit (needs the intercooler), basic_wing (a placeholder),',
        '  wheel_15_chrome, wheel_15_matte_black, wheel_15_bronze_wide, tyre_195_50r15, tyre_215_40r15, bonnet_carbon (player.givePart(id) to have one).',
      ].join('\n'));
    },
    paint(colour, finish) { return api.setPaint(colour, finish).then(r => { console.log(r.ok ? `painted ${garage.paint?.colour ?? 'factory'} ${garage.paint?.finish ?? ''}` : `✘ ${r.errors.join(' ')}`); return r; }); },
    paintPart(which, look) { return api.paintPart(which, look).then(r => { console.log(r.ok ? `${which}: ${look ? JSON.stringify(look) : 'its own look taken off'}` : `✘ ${r.errors.join(' ')}`); return r; }); },
    parts(filter) { console.table(tableOfParts(filter)); },
    build() {
      const b = garage.build;
      console.table(garage.car.sockets.map(s => ({ socket: s.name, slot: s.slot, required: s.required, part: db.parts[garage.state.parts[b.sockets[s.name]]?.partId]?.id ?? '—', instance: b.sockets[s.name] ?? '' })));
    },
    install: (id, opts) => api.install(id, opts),
    remove: (x, opts) => api.remove(x, opts),
    reset: opts => api.reset(opts),
    condition: (which, value) => api.setCondition(which, value),
    tune: (which, setting, value) => api.tune(which, setting, value),
    tuning() {
      const rows = garage.tunable();
      if (!rows.length) console.log('No tunable parts fitted. Try sport_suspension, basic_wing, ecu_standalone, lsd_sport or gearbox_close_ratio.');
      else console.table(rows.map(r => ({ socket: r.socket, part: r.part, setting: r.setting, value: `${r.value} ${r.unit}`, range: `${r.min}–${r.max} (step ${r.step})`, default: r.default })));
      return rows;
    },
    drivable() { const d = garage.drivable(); console.log(d.ok ? '✔ the car can be driven' : `✘ the car can't be driven:\n${d.reasons.map(r => `   · ${r}`).join('\n')}`); return d; },
    debugMode(on = true) { api.debugMode = on; console.log(on ? 'debug mode: parts, tuning and condition change while driving' : 'normal: parts, tuning and condition only change with the car stopped'); return api.debugMode; },
    stats() {
      const stock = new Garage(db).stats(), now = garage.stats(), r = now.totals?.rating, rs = stock.totals?.rating;
      const rating = t => t?.rating ? `rating ${t.rating.index} (class ${t.rating.class})` : 'no rating';
      console.log(`${car().name}: ${totalsText(now.totals)}\n   ${rating(now.totals)} · fingerprint ${garage.build.fingerprint}\nstock:            ${totalsText(stock.totals)}\n   ${rating(stock.totals)}\n\nNot stock:\n${changesText(changes(stock, now).filter(c => !c.path.startsWith('centreOfMass') && !c.path.startsWith('inertiaTensor')), now)}${r && rs ? `\n\nrating estimates: 0–100 ${num(r.estimates.zeroTo100)} s (stock ${num(rs.estimates.zeroTo100)}) · top ${num(r.estimates.topSpeed)} km/h (${num(rs.estimates.topSpeed)}) · grip ${num(r.estimates.grip)} g (${num(rs.estimates.grip)}) · 100–0 ${num(r.estimates.braking)} m (${num(rs.estimates.braking)})` : ''}\n\n(garage.explain("path") for any one number)`);
    },
    explain(path) { console.log(explain(garage.stats(), path)); },
    validate() {
      const r = garage.validate();
      console.log(r.ok && !r.warnings.length ? '✔ the build is fine' : [...r.errors.map(e => `✘ ${e.message}`), ...r.warnings.map(w => `! ${w.message}`)].join('\n'));
      return { ok: r.ok, errors: r.errors.map(e => e.message), warnings: r.warnings.map(w => w.message) };
    },
  };
  const car = () => garage.car;

  // ---------- the player's profile, for development (window.player) ----------
  const money = n => `${db.economy.currency}${Math.round(n).toLocaleString('en-GB')}`;
  const done = (title, promise) => promise.then(r => { console.log(r.ok ? `✔ ${title}${r.amount != null ? ` (${money(r.amount)})` : ''} · money ${money(r.updatedState.money)}` : `✘ ${title}: ${r.error}`); return r; });
  window.player = {
    help() {
      console.log([
        'player — the profile (money, cars, parts, setups), kept in this browser; every change goes through the player service:',
        '  player.profile()               all of it',
        '  player.inventory()             the parts not on a car',
        '  player.addMoney(10000)         (development)',
        '  player.unlimitedMoney(true)    (development) nothing costs anything, until player.unlimitedMoney(false)',
        '  player.givePart("turbo_kit")   a new copy (wheels and tyres: a set); player.giveAll() one of everything',
        '  player.condition("socket_intake", 40)   a part\'s condition (a socket, group or part id on the car, or a copy\'s id)',
        '  player.reset()                 start again: the starting car and money',
        '  player.save() · player.export() (the save as JSON) · player.import(json)',
        '  player.playtest(true)          playtest mode: log every upgrade, with the rating and Step 6 results (dev/playtest.html shows it)',
      ].join('\n'));
    },
    profile() { return clone(profile()); },
    get money() { return profile().money; },
    inventory() { console.table(inInventory(profile()).map(p => ({ copy: p.instanceId, part: p.partId, condition: p.condition, sells: money(sellPrice(db, p)) }))); },
    addMoney: n => done(`added ${money(n)}`, player.addMoney(n)),
    unlimitedMoney: (on = true) => api.dev.setUnlimitedMoney(on).then(r => { console.log(on ? 'unlimited money: on — nothing costs anything (kept in this browser; player.unlimitedMoney(false) to stop)' : 'unlimited money: off'); return r; }),
    givePart: (id, n) => done(`given ${id}`, player.givePart(id, n)),
    giveAll: () => done('given one of everything', player.giveAllParts()),
    condition: (which, value) => done(`condition ${value}`, player.setCondition(profile().parts[which] ? [which] : copiesIn(which), value)),
    reset: () => done('a new profile', player.resetProfile()),
    save: () => done('saved', player.save()),
    export: () => player.exportSave().then(r => r.json),
    import: json => done('save imported', player.importSave(json)),
    playtest(on = true) { api.playtest.set(on); console.log(`playtest log ${on ? 'on' : 'off'} (${playtest.entries.length} entries): dev/playtest.html`); },
    cars() { console.table(Object.values(profile().cars).map(c => ({ car: c.carInstanceId, name: carName(profile(), db, c.carInstanceId), setup: c.setups[c.activeSetup]?.name ?? '—', driving: c.carInstanceId === profile().currentCar }))); },
  };
  // the game's own commands (what's drawn, the socket gizmos…): garage.<name>, with a line in help()
  const extra = [];
  api.debug = (name, fn, help) => { window.garage[name] = fn; extra.push({ name, help }); };
  return api;
}
