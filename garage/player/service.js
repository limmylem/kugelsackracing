// The player's money, cars, parts and setups change here and nowhere else. The garage, inventory and
// shop screens (and the debug console) only ever ask a PlayerService; it checks each request (enough
// money, the part is theirs, it isn't on another car, the build still holds together), makes the
// change, saves, and answers { ok, error, updatedState } — error: plain words for the player,
// updatedState: the whole profile as it now is. Listeners (on) hear of every change.
//
// LocalPlayerService keeps the profile in this browser (storage.js: IndexedDB). A RemotePlayerService
// (remote.js) will ask the game's server the same questions instead, with nothing else changing.
//
// Crash damage comes in through damageCar (the game reports what a crash did: never better than it was,
// dents as the hits that made them — the service folds them, garage/damageLog.js) and goes out through
// the repairs, which cost money (garage/repair.js: a piece at a time or all of it, quick or full, a spare
// fitted instead, or — for a player who can't afford to make their car drivable — a basic repair free).
// A session's reset (sessionReset) puts parts back on by the session's rules (data/sessions.json), free;
// so a server can own all of it later.

import { addCar, addPart, applyGarage, buildOf, carName, carPrice, checkProfile, cleanDamage, cleanDents, clone, garageFor, needsRepair, newProfile, packProfile, priceOf, repairCost, sellPrice, setDents, setSize, shellRepairCost, unpackProfile } from './profile.js';
import { migrate } from './migrations.js';
import { validateBuild } from '../validate.js';
import { appendHits } from '../damageLog.js';
import { startAttempt, refundAttempt, finishAttempt, failAttempt } from './quests.js';
import { entryReasons, CAR_CODES } from '../../quest/rules.js';
import { basicRepair, drivability, ownedBySocket, partWork, repairPart, repairShell, shellWork, workCost } from '../repair.js';

const ATTACH = ['attached', 'loose', 'detached'];
// (JSON with every object's keys in order: two saves the same whatever order their keys came in)
const canonical = x => JSON.stringify(x, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(j => [j, v[j]])) : v);

// Every request a player service answers (all async, all → { ok, error, updatedState, …details }):
export const METHODS = {
  getProfile: 'the profile, and any notices from loading it',
  buyPart: '(partId, { quantity }) a new copy at 100% (a part for a group of sockets: a set)',
  sellPart: '(instanceId) a copy that isn\'t on a car, for its sell price',
  repairPart: '(instanceId) back to 100%, its dents out, its mechanical damage put right and bolted back on, for its repair cost',
  repairParts: '([instanceId]) several at once (repair all)',
  repairBody: '(carInstanceId) the body shell: condition, dents, broken glass and lights, for its repair cost',
  repairCar: '(carInstanceId, { kind: \'quick\' | \'full\', items: [{ target: instanceId | \'shell\', scope: \'all\' | a piece of its damage }] }) repair pieces of a car\'s damage (no items: all of it), quick or full (garage/repair.js), for what they cost',
  replaceWithSpare: '(carInstanceId, socket, instanceId) fit a spare copy from the inventory in place of a damaged part (which goes to the inventory, as it is)',
  basicRepair: '(carInstanceId) the safety net: a car that can\'t be driven, whose player can\'t afford to make it drivable, made just drivable, free',
  damageCar: '(carInstanceId, { parts: { instanceId: { condition, hits, damage, attach } }, shell: { condition, hits, broken } }, { cause }) crash damage from driving (hits: the dents a crash made, garage/damage.js; damage: a part\'s mechanical damage block as it is now, garage/mechanical.js; attach: loose or detached): conditions only go down, parts only come further off; allowed while driving',
  sessionReset: '(carInstanceId, { kind: \'test\' | \'race\' }) back on the road in a session: what comes back on by its rules (data/sessions.json reset), free',
  markHint: '(id) a first-time hint seen (garage/hints.js): it isn\'t shown again',
  wearPart: '(instanceId, condition, { cause }) damage from driving (an over-revved engine): the condition only goes down; allowed while driving',
  installPart: '(carInstanceId, instanceId, { socket, auto }) fit a copy the player has (auto: what\'s in the way comes off and goes back)',
  removePart: '(carInstanceId, socket | group | partId, { auto }) take a part off, into the inventory',
  buyAndInstall: '(carInstanceId, partId, { socket, auto }) buy and fit in one go (nothing is bought if it can\'t go on)',
  setBuild: '(carInstanceId, { sockets, tuning, paint, partPaint, activeSetup }) a whole build as it was, in the setup it was in (undo / redo)',
  setTuning: '(instanceId, { setting: value | null }) a copy\'s settings (null: back to the default)',
  setPaint: '(carInstanceId, { colour, finish } | null) the car\'s paint (null: factory paint)',
  setPartFinish: '([instanceId], { colour?, finish? } | null) copies\' own look',
  selectCar: '(carInstanceId) the car to drive',
  buyCar: '(carId) a new car from the dealer, with its stock parts',
  saveSetup: '(carInstanceId, { name, setupId }) the build as a setup (a new one, or over setupId)',
  renameSetup: '(carInstanceId, setupId, name)',
  deleteSetup: '(carInstanceId, setupId)',
  switchSetup: '(carInstanceId, setupId, { force }) a saved setup onto the car (parts it needs that are gone or on another car: listed, or with force, stock / empty)',
  startQuest: '(quest, { carInstanceId, car: { className, kw, kg }, restart }) the entry fee taken and the attempt counted, if the player may enter (→ attemptId, fee); config.restart.free: a restart is free',
  refundQuest: '(attemptId) the game couldn\'t start the quest: the fee back, the attempt not counted',
  finishQuest: '(result, { quest, course, recording }) a finished run checked (quest/validate.js) and paid (once per medal tier, then a repeat); an invalid one pays nothing and is logged; the best run\'s recording kept',
  failQuest: '(attemptId, { questId, status, reason }) a run that didn\'t finish (quit: a DNF, wrecked, out of time): counted, nothing paid',
  getRecording: '(recordingId) → { recording } a best run kept for ghost replays',
  forfeitCar: '(carInstanceId, { attemptId }) a pink slip lost: the car and everything on it gone (only with a pink-slip run under way)',
  awardCar: '(carId, { attemptId }) a pink slip won: the rival\'s car, stock (only with a pink-slip run under way)',
  save: 'save now (every change is saved anyway)',
  exportSave: '→ { json } the save as a file',
  importSave: '(json) a save file in place of this one',
  // for development (window.player in the console)
  addMoney: '(amount)', setUnlimitedMoney: '(on) nothing costs anything (for testing: money isn\'t checked or taken)', givePart: '(partId, quantity)', giveAllParts: '()', setCondition: '(instanceIds, condition)', restoreCar: '(carInstanceId) every part on it and its body as new, and back on, free', setAttach: '(carInstanceId, { socket: \'attached\' | \'loose\' | \'detached\' }) parts on or off, free', resetHints: '() every hint shown again', resetProfile: '() start again',
};

export class PlayerService {
  constructor() { this.listeners = new Set(); }
  // hear about every change: fn({ what, profile })
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(change) { for (const fn of this.listeners) fn(change); }
}
for (const name of Object.keys(METHODS)) PlayerService.prototype[name] = async function () { throw new Error(`${this.constructor.name} can't ${name} yet`); };

export class LocalPlayerService extends PlayerService {
  // db: loadGarageData's (cars, parts, finishes, economy); storage: storage.js; migrations: for tests
  // quests: { config (data/quests.json), recordings (quest/recordStore.js) }
  constructor({ db, storage, now = () => new Date().toISOString(), migrations, quests = null } = {}) {
    super();
    this.db = db; this.storage = storage; this.now = now; this.migrations = migrations;
    this.quests = quests;
    this.profile = null; this.notices = []; this.queue = Promise.resolve();
    this.unlimited = false;       // (development: unlimited money)
  }
  // Paying for something: not enough money is an error (nothing's changed); with unlimited money, free
  #pay(p, cost, what) {
    if (this.unlimited) return null;
    if (p.money < cost) return { error: `Not enough money: ${what} ${this.#money(cost)} and you have ${this.#money(p.money)}.` };
    p.money -= cost;
    return null;
  }
  // development: unlimited money on or off (not saved in the profile)
  setUnlimitedMoney(on) { this.unlimited = !!on; this.emit({ what: 'dev', profile: this.profile }); return Promise.resolve({ ok: true, error: null, updatedState: clone(this.profile), unlimited: this.unlimited }); }
  // Load (bringing an old save up to date, and putting right what no longer fits the game), or start
  // a new profile. Notices: what was put right, in plain words
  async init() {
    const saved = await this.storage.load();
    let changed = true;
    if (!saved) { this.profile = newProfile(this.db, this.now()); this.notices = []; }
    else {
      const { profile, notices } = this.#bringIn(saved);
      this.profile = profile; this.notices = notices;
      changed = notices.length > 0 || canonical(packProfile(profile)) !== canonical(saved);
    }
    // (written back only if loading changed it: a new profile, an old save brought up to date, something put right)
    if (changed) { this.profile.saved = this.now(); await this.storage.save(packProfile(this.profile)); }
    return { ok: true, error: null, updatedState: clone(this.profile), notices: this.notices };
  }
  // (a save as stored: brought up to date, its dent logs unpacked, then checked — which folds the logs
  // into dents again)
  #bringIn(saved) {
    const { save } = migrate(saved, { ...(this.migrations ?? {}), context: { db: this.db } });
    return checkProfile(unpackProfile(save), this.db);
  }
  async getProfile() { return { ok: true, error: null, updatedState: clone(this.profile), notices: this.notices }; }

  // One change at a time: worked out on a copy, kept (and saved) only if it all went through
  #change(what, fn) {
    const run = async () => {
      const before = this.profile, draft = clone(before);
      let out;
      try { out = fn(draft) ?? {}; } catch (err) { out = { error: `Something went wrong: ${err.message}` }; }
      if (out.error) return { ok: false, error: out.error, updatedState: clone(before), ...(out.detail ?? {}) };
      // (a part off every car isn't hanging off anything)
      for (const x of Object.values(draft.parts)) if (!x.installedOn) delete x.attach;
      draft.saved = this.now();
      this.profile = draft;
      try { await this.storage.save(packProfile(draft)); }
      catch (err) { this.profile = before; return { ok: false, error: `Couldn't save: ${err.message ?? err}`, updatedState: clone(before) }; }
      this.emit({ what, profile: this.profile });
      return { ok: true, error: null, updatedState: clone(draft), ...(out.result ?? {}) };
    };
    return (this.queue = this.queue.then(run, run));
  }
  #money(n) { return `${this.db.economy.currency}${Math.round(n).toLocaleString('en-GB')}`; }
  #name(p) { return this.db.parts[p.partId]?.name ?? p.partId; }
  #car(profile, carInstanceId) { return profile.cars[carInstanceId] ? null : { error: 'That car isn\'t yours.' }; }

  // ---------- buying, selling, repairing ----------
  #buy(p, partId, quantity) {
    const part = this.db.parts[partId];
    if (!part) return { error: `There's no part "${partId}".` };
    if (part.retired) return { error: `${part.name} isn't sold any more.` };
    if (part.todo?.length) return { error: `${part.name} isn't for sale yet: its ${part.todo.join(', ')} ${part.todo.length > 1 ? 'are' : 'is'} still to be filled in.` };
    const n = quantity ?? setSize(this.db, part, p.cars[p.currentCar]?.carId);
    if (!Number.isInteger(n) || n < 1 || n > 20) return { error: 'You can buy 1 to 20 at a time.' };
    const cost = part.price * n;
    const unpaid = this.#pay(p, cost, `${n > 1 ? `${n} × ` : ''}${part.name} cost${n > 1 ? '' : 's'}`);
    if (unpaid) return unpaid;
    return { result: { instanceIds: Array.from({ length: n }, () => addPart(p, this.db, partId)), cost } };
  }
  buyPart(partId, { quantity } = {}) { return this.#change('buy', p => this.#buy(p, partId, quantity)); }
  sellPart(instanceId) {
    return this.#change('sell', p => {
      const part = p.parts[instanceId];
      if (!part) return { error: 'That part isn\'t yours.' };
      if (part.installedOn) return { error: `${this.#name(part)} is on your ${carName(p, this.db, part.installedOn.car)}: take it off before you sell it.` };
      const amount = sellPrice(this.db, part);
      p.money += amount;
      delete p.parts[instanceId];
      return { result: { amount } };
    });
  }
  // Repairs (garage/repair.js): items [{ target: instanceId | 'shell', scope }] on a car (target's
  // copies anywhere: a spare in the inventory too), each priced by its pieces; kind quick or full
  #repair(p, items, kind = 'full', carInstanceId = null) {
    const car = carInstanceId && p.cars[carInstanceId], todo = [];
    if (carInstanceId && !car) return { error: 'That car isn\'t yours.' };
    for (const it of items) {
      if (it.target === 'shell') {
        if (!car) return { error: 'Which car\'s bodywork?' };
        const work = shellWork(this.db, car).filter(w => it.scope === 'all' || w.scope === it.scope);
        if (work.length) todo.push({ shell: true, scope: it.scope, cost: workCost(work, kind) });
        continue;
      }
      const x = p.parts[it.target];
      if (!x) return { error: 'That part isn\'t yours.' };
      if (car && x.installedOn?.car !== carInstanceId) return { error: `${this.#name(x)} isn't on your ${carName(p, this.db, carInstanceId)}.` };
      const work = partWork(this.db, x).filter(w => it.scope === 'all' || w.scope === it.scope);
      if (work.length) todo.push({ x, scope: it.scope, cost: workCost(work, kind) });
    }
    if (!todo.length) return { error: items.length > 1 || !items.length ? 'Everything\'s in perfect condition already.' : items[0].target === 'shell' ? 'The bodywork is perfect already.' : `${this.#name(p.parts[items[0].target])} is in perfect condition already.` };
    const cost = todo.reduce((a, t) => a + t.cost, 0), unpaid = this.#pay(p, cost, `the ${kind === 'quick' ? 'quick ' : ''}repair${todo.length > 1 ? 's' : ''} cost${todo.length > 1 ? '' : 's'}`);
    if (unpaid) return unpaid;
    for (const t of todo) {
      if (t.shell) { const d = repairShell(this.db, car.damage, { scope: t.scope, kind }); if (d) { car.damage = { condition: d.condition, ...(d.broken?.length && { broken: d.broken }) }; setDents(car.damage, { base: d.dents }, this.db.damage); } else delete car.damage; }
      else this.#apply(t.x, repairPart(this.db, t.x, { scope: t.scope, kind }));
    }
    return { result: { cost, repaired: todo.length, kind } };
  }
  // (a repair's fields onto a copy: dents start a new log from what's left)
  #apply(x, f) {
    if (f.condition !== undefined) x.condition = f.condition;
    if (f.dents !== undefined) setDents(x, { base: f.dents }, this.db.damage);
    if (f.damage !== undefined) { if (Object.keys(f.damage).length) x.damage = f.damage; else delete x.damage; }
    if (f.attach !== undefined) { if (f.attach && f.attach !== 'attached') x.attach = f.attach; else delete x.attach; }
  }
  repairCar(carInstanceId, { kind = 'full', items = null } = {}) {
    return this.#change('repair', p => {
      if (!p.cars[carInstanceId]) return { error: 'That car isn\'t yours.' };
      if (kind !== 'quick' && kind !== 'full') return { error: `"${kind}" isn't a kind of repair: quick or full.` };
      const all = items ?? [...Object.values(p.parts).filter(x => x.installedOn?.car === carInstanceId && needsRepair(x)).map(x => ({ target: x.instanceId, scope: 'all' })), { target: 'shell', scope: 'all' }];
      return this.#repair(p, all.map(it => ({ target: it.target, scope: it.scope ?? 'all' })), kind, carInstanceId);
    });
  }
  // The body shell: back to 100%, dents out, glass and lights new
  repairBody(carInstanceId) {
    return this.#change('repair', p => {
      const car = p.cars[carInstanceId];
      if (!car) return { error: 'That car isn\'t yours.' };
      if (!shellRepairCost(this.db, car)) return { error: `Your ${carName(p, this.db, carInstanceId)}'s bodywork is perfect already.` };
      return this.#repair(p, [{ target: 'shell', scope: 'all' }], 'full', carInstanceId);
    });
  }
  // A spare from the inventory in place of a damaged part: fitted like any part (free); the damaged one
  // goes to the inventory as it is, to repair or sell
  replaceWithSpare(carInstanceId, socket, instanceId) {
    return this.#change('install', p => {
      const bad = this.#car(p, carInstanceId);
      if (bad) return bad;
      const spare = p.parts[instanceId], old = buildOf(p, this.db, carInstanceId)[socket];
      if (!spare) return { error: 'That part isn\'t yours.' };
      if (spare.installedOn) return { error: `${this.#name(spare)} isn't a spare: it's on your ${carName(p, this.db, spare.installedOn.car)}.` };
      if (!old) return { error: 'Nothing\'s fitted there to replace.' };
      const fitted = this.#install(p, carInstanceId, instanceId, { socket, auto: true });
      if (fitted.error) return fitted;
      return { result: { ...fitted.result, replaced: old, cost: 0 } };
    });
  }
  // The safety net: a car that can't carry on (garage/repair.js drivability) whose player can't afford the
  // quick repairs that would make it drivable, made just drivable — free (data/economy.json safetyNet)
  basicRepair(carInstanceId) {
    return this.#change('repair', p => {
      const car = p.cars[carInstanceId], N = this.db.economy.safetyNet;
      if (!car) return { error: 'That car isn\'t yours.' };
      if (!N?.enabled) return { error: 'There are no free repairs.' };
      const owned = ownedBySocket(this.db, p, carInstanceId), def = this.db.cars[car.carId], d = drivability(def, owned, this.db.damage);
      if (d.ok) return { error: `Your ${carName(p, this.db, carInstanceId)} can be driven already.` };
      const cost = this.quickFixCost(p, carInstanceId);
      if (this.unlimited || p.money >= cost) return { error: `You can afford to make it drivable: quick repairs of what stops it cost ${this.#money(cost)}.` };
      const plan = basicRepair(this.db, def, owned, this.db.damage);
      for (const step of plan) this.#apply(p.parts[step.target], step.fields);
      return { result: { free: true, fixed: plan.length, worth: cost, reasons: d.reasons } };
    });
  }
  // What the quick repairs that would make a car drivable cost (the pieces that stop it)
  quickFixCost(p = this.profile, carInstanceId = p.currentCar) {
    const car = p.cars[carInstanceId], owned = ownedBySocket(this.db, p, carInstanceId), { blocking } = drivability(this.db.cars[car.carId], owned, this.db.damage);
    const seen = new Set();
    return blocking.reduce((a, b) => { const key = `${b.target}|${b.scope}`; if (seen.has(key)) return a; seen.add(key); return a + workCost(partWork(this.db, p.parts[b.target]), 'quick', [b.scope]); }, 0);
  }
  // Crash damage (the game works it out: garage/carDamage.js): the parts on this car and its body shell —
  // their new conditions (never up), the hits that dented them (folded into their dents here; a whole
  // dent list instead, as dents, starts a new log), mechanical damage blocks as they are now, parts come
  // loose or off (never back on: a repair or a session's reset does that) — and glass and lights broken.
  // Free: the repair costs
  damageCar(carInstanceId, { parts = {}, shell = null } = {}, { cause } = {}) {
    return this.#change('damage', p => {
      const car = p.cars[carInstanceId], most = this.db.damage?.dent.maxPerPart ?? 16, rules = this.db.damage;
      if (!car) return { error: 'That car isn\'t yours.' };
      const dents = (target, d) => {
        if (d.hits !== undefined) setDents(target, appendHits(target.dentLog ?? { base: target.dents }, cleanDents(d.hits, 256), rules), rules);
        else if (d.dents !== undefined) setDents(target, { base: cleanDents(d.dents, most) }, rules);
      };
      for (const [id, d] of Object.entries(parts)) {
        const x = p.parts[id];
        if (!x || x.installedOn?.car !== carInstanceId) return { error: `${x ? this.#name(x) : `"${id}"`} isn't on that car.` };
        if (d.condition !== undefined) {
          if (!(d.condition >= 0 && d.condition <= 100)) return { error: 'Condition goes from 0 to 100.' };
          x.condition = Math.min(x.condition, Math.round(d.condition * 10) / 10);
        }
        dents(x, d);
        // (mechanical damage: the part's whole block as it is now — garage/mechanical.js works it out)
        if (d.damage !== undefined) { const m = cleanDamage(d.damage); if (Object.keys(m).length) x.damage = m; else delete x.damage; }
        if (d.attach !== undefined) {
          const part = this.db.parts[x.partId];
          if (!ATTACH.includes(d.attach)) return { error: `"${d.attach}" isn't how a part can be: attached, loose or detached.` };
          if (d.attach !== 'attached' && !part.detach?.detachable && part.slot !== 'wheels') return { error: `${part.name} can't come off.` };
          if (ATTACH.indexOf(d.attach) > ATTACH.indexOf(x.attach ?? 'attached')) x.attach = d.attach;
        }
      }
      if (shell) {
        const was = car.damage ?? { condition: 100 }, names = new Set((this.db.cars[car.carId].model.breakables ?? []).map(b => b.node));
        const condition = shell.condition !== undefined ? Math.min(was.condition ?? 100, Math.max(0, Math.round(shell.condition * 10) / 10)) : was.condition ?? 100;
        const next = { condition, dentLog: was.dentLog, dents: was.dents };
        dents(next, shell);
        if (!next.dentLog) delete next.dentLog;
        if (!next.dents) delete next.dents;
        const broken = [...new Set([...(was.broken ?? []), ...(shell.broken ?? []).filter(n => names.has(n))])];
        if (condition < 100 || next.dents?.length || broken.length) car.damage = { ...next, ...(broken.length && { broken }) };
      }
      return { result: { cause: cause ?? null } };
    });
  }
  // Back on the road in a session (data/sessions.json kinds): a test drive puts every part that came
  // loose or off back on, a race only a wheel torn off (bent and flat, as it came off). Free
  sessionReset(carInstanceId, { kind = 'test' } = {}) {
    return this.#change('reset', p => {
      if (!p.cars[carInstanceId]) return { error: 'That car isn\'t yours.' };
      const rule = this.db.sessions?.kinds[kind]?.reset;
      if (!rule) return { error: `There's no session "${kind}".` };
      const back = [];
      for (const x of Object.values(p.parts)) {
        if (x.installedOn?.car !== carInstanceId || !x.attach) continue;
        if (rule === 'wheels' && this.db.parts[x.partId]?.slot !== 'wheels') continue;
        delete x.attach;
        back.push(x.installedOn.socket);
      }
      return { result: { reattached: back } };
    });
  }
  // ---------- quests (garage/player/quests.js) ----------
  // Starting a quest: may the player enter (the car rules, their level, the fee), then the fee's taken
  startQuest(quest, { carInstanceId, car = null, restart = false, attemptId = null } = {}) {
    return this.#change('quest', p => {
      const cfg = this.quests?.config;
      if (!cfg) return { error: 'Quests aren\'t set up.' };
      const bad = this.#car(p, carInstanceId ?? p.currentCar);
      if (bad) return bad;
      if (p.questPending) delete p.questPending;    // (one left over: its fee's spent, as a quit's is)
      const fee = restart && cfg.restart?.free ? 0 : Math.max(0, quest.fee ?? 0);
      const id = carInstanceId ?? p.currentCar, own = p.cars[id];
      const drivable = drivability(this.db.cars[own.carId], ownedBySocket(this.db, p, id), this.db.damage);
      const reasons = entryReasons({ quest, car: { ...(car ?? {}), drivable }, player: { money: p.money, xp: p.xp ?? 0, unlimited: this.unlimited }, fee, config: cfg, economy: this.db.economy })
        .filter(r => car || !CAR_CODES.has(r.code) || r.code === 'damage');
      if (reasons.length) return { error: reasons[0].text, detail: { reasons } };
      const unpaid = this.#pay(p, fee, 'the entry fee is');
      if (unpaid) return unpaid;
      const aid = attemptId ?? `att_${String(p.nextId++).padStart(6, '0')}`;
      startAttempt(p, { quest, fee: this.unlimited ? 0 : fee, attemptId: aid, now: this.now() });
      return { result: { attemptId: aid, fee: this.unlimited ? 0 : fee } };
    });
  }
  refundQuest(attemptId) {
    return this.#change('quest', p => { const r = refundAttempt(p, attemptId); return r.error ? r : { result: r }; });
  }
  async finishQuest(result, { quest, course, recording = null } = {}) {
    const cfg = this.quests?.config;
    // (the recording goes in its own store first: the save only keeps its id, if it's the best run)
    const recordingId = recording ? `rec_${quest.id}_${result.attemptId}` : null;
    const old = this.profile.quests?.[quest.id]?.recording ?? null;
    const out = await this.#change('quest', p => ({ result: finishAttempt(p, { result: { ...result, recording: recordingId }, quest, course, config: cfg, economy: this.db.economy, now: this.now(), recordingId }) }));
    const store = this.quests?.recordings;
    if (out.ok && out.valid && out.pb && recording && store) {
      await store.put(recordingId, recording);
      if (old && old !== recordingId) await store.delete(old);
    }
    return out;
  }
  failQuest(attemptId, { questId, status = 'dnf', reason = null } = {}) {
    return this.#change('quest', p => { failAttempt(p, { attemptId, questId, status, reason, now: this.now() }); return {}; });
  }
  async getRecording(recordingId) {
    const rec = recordingId ? await this.quests?.recordings?.get(recordingId) : null;
    return { ok: !!rec, error: rec ? null : 'There\'s no recording of that run.', updatedState: clone(this.profile), recording: rec };
  }
  // A pink slip's stake changing hands (only with a pink-slip run under way: Phase 4 Step 4's rivals)
  forfeitCar(carInstanceId, { attemptId } = {}) {
    return this.#change('car', p => {
      if (!p.questPending?.pinkSlip || p.questPending.attemptId !== attemptId) return { error: 'A car only changes hands in a pink-slip race.' };
      if (!p.cars[carInstanceId]) return { error: 'That car isn\'t yours.' };
      if (p.cars[carInstanceId].carId === this.db.economy.startingCar) return { error: 'The starter car can\'t be staked.' };
      if (Object.keys(p.cars).length < 2) return { error: 'You can\'t race your only car for pink slips.' };
      for (const [id, x] of Object.entries(p.parts)) if (x.installedOn?.car === carInstanceId) delete p.parts[id];
      delete p.cars[carInstanceId];
      if (p.currentCar === carInstanceId) p.currentCar = Object.keys(p.cars)[0];
      return { result: { lost: carInstanceId } };
    });
  }
  // (parts: the rival's upgrades, fitted as they were on its car)
  awardCar(carId, { attemptId, parts = [] } = {}) {
    return this.#change('car', p => {
      if (!p.questPending?.pinkSlip || p.questPending.attemptId !== attemptId) return { error: 'A car only changes hands in a pink-slip race.' };
      if (!this.db.cars[carId]) return { error: `There's no car "${carId}".` };
      const id = addCar(p, this.db, carId), fitted = [];
      for (const partId of parts) {
        if (!this.db.parts[partId]) continue;
        const copy = addPart(p, this.db, partId), g = garageFor(p, this.db, id);
        if (g.install(copy, { auto: true }).ok && !applyGarage(p, g, id).length) fitted.push(partId);
      }
      return { result: { won: id, fitted } };
    });
  }
  // A first-time hint seen (garage/hints.js): kept, so it isn't shown again
  markHint(id) {
    return this.#change('hint', p => {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_]+$/.test(id)) return { error: 'A hint id, please.' };
      if (p.hints?.includes(id)) return {};
      p.hints = [...(p.hints ?? []), id];
      return {};
    });
  }
  repairPart(instanceId) { return this.#change('repair', p => this.#repair(p, [{ target: instanceId, scope: 'all' }])); }
  // Damage from driving (the game reports it: an over-rev bent the valves, blew the engine): the
  // condition only ever goes down this way, and it's free — the repair is what costs
  wearPart(instanceId, condition, { cause } = {}) {
    return this.#change('wear', p => {
      const x = p.parts[instanceId];
      if (!x) return { error: `There's no part copy "${instanceId}".` };
      if (!(condition >= 0 && condition <= 100)) return { error: 'Condition goes from 0 to 100.' };
      if (condition > x.condition) return { error: `Driving doesn't mend a part: ${this.#name(x)} is at ${x.condition}.` };
      const from = x.condition;
      x.condition = Math.round(condition * 10) / 10;
      return { result: { from, condition: x.condition, cause: cause ?? null, blown: x.condition <= 0 && !!this.db.parts[x.partId]?.engine } };
    });
  }
  repairParts(instanceIds) { return this.#change('repair', p => this.#repair(p, [...new Set(instanceIds)].map(id => ({ target: id, scope: 'all' })))); }

  // ---------- fitting parts ----------
  #install(p, carInstanceId, instanceId, { socket, auto = true } = {}) {
    const bad = this.#car(p, carInstanceId);
    if (bad) return bad;
    const copy = p.parts[instanceId];
    if (!copy) return { error: 'That part isn\'t yours.' };
    if (copy.installedOn && copy.installedOn.car !== carInstanceId) return { error: `${this.#name(copy)} is on your ${carName(p, this.db, copy.installedOn.car)}: take it off there first.` };
    const part = this.db.parts[copy.partId], def = this.db.cars[p.cars[carInstanceId].carId], group = !socket && def.socketGroups?.[part.slot];
    if (group) {
      const here = new Set(group.map(s => buildOf(p, this.db, carInstanceId)[s]).filter(Boolean));
      const have = Object.values(p.parts).filter(x => x.partId === copy.partId && (!x.installedOn || here.has(x.instanceId))).length;
      if (have < group.length) return { error: `${part.name} goes on all ${group.length} at once and you have ${have}: buy ${group.length - have} more (a set of ${group.length} in the shop).` };
    }
    const g = garageFor(p, this.db, carInstanceId), r = g.install(instanceId, { socket, auto });
    if (!r.ok) return { error: r.errors[0]?.message ?? 'It can\'t go on.' };
    if (applyGarage(p, g, carInstanceId).length) return { error: `You don't have enough ${part.name} for that.` };
    return { result: { ops: r.ops, warnings: r.warnings.map(w => w.message) } };
  }
  installPart(carInstanceId, instanceId, opts) { return this.#change('install', p => this.#install(p, carInstanceId, instanceId, opts)); }
  removePart(carInstanceId, which, { auto = true } = {}) {
    return this.#change('remove', p => {
      const bad = this.#car(p, carInstanceId);
      if (bad) return bad;
      const g = garageFor(p, this.db, carInstanceId), r = g.remove(which, { auto });
      if (!r.ok) return { error: r.errors[0]?.message ?? 'It can\'t come off.' };
      applyGarage(p, g, carInstanceId);
      return { result: { ops: r.ops, warnings: r.warnings.map(w => w.message) } };
    });
  }
  buyAndInstall(carInstanceId, partId, { socket, auto = true } = {}) {
    return this.#change('buy', p => {
      const bad = this.#car(p, carInstanceId);
      if (bad) return bad;
      const part = this.db.parts[partId], def = this.db.cars[p.cars[carInstanceId].carId];
      if (!part) return { error: `There's no part "${partId}".` };
      const bought = this.#buy(p, partId, def.socketGroups?.[part.slot] && !socket ? def.socketGroups[part.slot].length : 1);
      if (bought.error) return bought;
      const fitted = this.#install(p, carInstanceId, bought.result.instanceIds[0], { socket, auto });
      if (fitted.error) return fitted;           // (and nothing was bought)
      return { result: { ...fitted.result, ...bought.result } };
    });
  }
  // A whole build as it was — which copy in each socket, their settings and looks, the car's paint —
  // as long as every copy is still the player's and not on another car (undo / redo)
  setBuild(carInstanceId, { sockets, tuning = {}, partPaint = {}, paint, activeSetup } = {}) {
    return this.#change('build', p => {
      const bad = this.#car(p, carInstanceId);
      if (bad) return bad;
      const def = this.db.cars[p.cars[carInstanceId].carId];
      for (const [socket, id] of Object.entries(sockets ?? {})) {
        if (!id) continue;
        const copy = p.parts[id];
        if (!def.sockets.some(s => s.name === socket)) return { error: `${def.name} has no socket "${socket}".` };
        if (!copy) return { error: 'A part that build had isn\'t yours any more.' };
        if (copy.installedOn && copy.installedOn.car !== carInstanceId) return { error: `${this.#name(copy)} is on your ${carName(p, this.db, copy.installedOn.car)} now.` };
      }
      if (sockets) {
        for (const x of Object.values(p.parts)) if (x.installedOn?.car === carInstanceId) x.installedOn = null;
        for (const [socket, id] of Object.entries(sockets)) if (id) p.parts[id].installedOn = { car: carInstanceId, socket };
      }
      for (const [id, t] of Object.entries(tuning)) if (p.parts[id]) { if (t && Object.keys(t).length) p.parts[id].tuning = clone(t); else delete p.parts[id].tuning; }
      for (const [id, look] of Object.entries(partPaint)) if (p.parts[id]) { if (look) p.parts[id].paint = clone(look); else delete p.parts[id].paint; }
      if (paint !== undefined) { if (paint) p.cars[carInstanceId].paint = clone(paint); else delete p.cars[carInstanceId].paint; }
      // (the setup it was in, if it's still there)
      if (activeSetup !== undefined && (activeSetup === null || p.cars[carInstanceId].setups[activeSetup])) p.cars[carInstanceId].activeSetup = activeSetup;
      const g = garageFor(p, this.db, carInstanceId), r = validateBuild(g.build, g.view), wrong = r.errors.find(e => e.code !== 'required_empty');
      if (wrong) return { error: wrong.message };
      return {};
    });
  }

  // ---------- settings and looks ----------
  setTuning(instanceId, settings) {
    return this.#change('tune', p => {
      const copy = p.parts[instanceId], part = copy && this.db.parts[copy.partId];
      if (!copy) return { error: 'That part isn\'t yours.' };
      for (const [k, v] of Object.entries(settings ?? {})) {
        const t = part.tuning?.[k];
        if (!t) return { error: `${part.name} has no setting "${k}".` };
        if (v !== null && !Number.isFinite(v)) return { error: `${t.label} needs a number.` };
        copy.tuning ??= {};
        if (v === null) delete copy.tuning[k]; else copy.tuning[k] = Math.min(t.max, Math.max(t.min, v));
      }
      if (copy.tuning && !Object.keys(copy.tuning).length) delete copy.tuning;
      return {};
    });
  }
  setPaint(carInstanceId, paint) {
    return this.#change('paint', p => {
      const bad = this.#car(p, carInstanceId);
      if (bad) return bad;
      if (!paint) { delete p.cars[carInstanceId].paint; return {}; }
      if (!/^#[0-9a-fA-F]{6}$/.test(paint.colour ?? '')) return { error: `"${paint.colour}" isn't a colour.` };
      if (!this.db.finishes[paint.finish]?.paint) return { error: `"${paint.finish}" isn't a paint finish.` };
      p.cars[carInstanceId].paint = { colour: paint.colour.toLowerCase(), finish: paint.finish };
      return {};
    });
  }
  setPartFinish(instanceIds, look) {
    return this.#change('paint', p => {
      for (const id of [].concat(instanceIds)) {
        const copy = p.parts[id];
        if (!copy) return { error: 'That part isn\'t yours.' };
        if (look?.finish && !this.db.finishes[look.finish]) return { error: `There's no finish "${look.finish}".` };
        if (look?.colour && !/^#[0-9a-fA-F]{6}$/.test(look.colour)) return { error: `"${look.colour}" isn't a colour.` };
        if (!look || (!look.colour && !look.finish)) delete copy.paint;
        else copy.paint = { ...(look.colour ? { colour: look.colour.toLowerCase() } : {}), ...(look.finish ? { finish: look.finish } : {}) };
      }
      return {};
    });
  }

  // ---------- cars ----------
  selectCar(carInstanceId) { return this.#change('car', p => this.#car(p, carInstanceId) ?? (p.currentCar = carInstanceId, {})); }
  buyCar(carId) {
    return this.#change('car', p => {
      const def = this.db.cars[carId];
      if (!def) return { error: `There's no car "${carId}".` };
      const price = carPrice(this.db, def);
      const unpaid = this.#pay(p, price, `the ${def.name} costs`);
      if (unpaid) return unpaid;
      return { result: { carInstanceId: addCar(p, this.db, carId, price), cost: price } };
    });
  }

  // ---------- setups ----------
  #setupName(car, name, except) {
    const n = String(name ?? '').trim();
    if (!n) return { error: 'A setup needs a name.' };
    if (n.length > 40) return { error: 'That name is too long (40 letters at most).' };
    if (Object.values(car.setups).some(s => s.setupId !== except && s.name.toLowerCase() === n.toLowerCase())) return { error: `There's a setup called "${n}" already.` };
    return { name: n };
  }
  saveSetup(carInstanceId, { name, setupId } = {}) {
    return this.#change('setup', p => {
      const bad = this.#car(p, carInstanceId);
      if (bad) return bad;
      const car = p.cars[carInstanceId], sockets = buildOf(p, this.db, carInstanceId);
      const partIds = Object.fromEntries(Object.entries(sockets).filter(([, id]) => id).map(([s, id]) => [s, p.parts[id].partId]));
      if (setupId) {
        const s = car.setups[setupId];
        if (!s) return { error: 'There\'s no such setup.' };
        if (name !== undefined) { const n = this.#setupName(car, name, setupId); if (n.error) return n; s.name = n.name; }
        Object.assign(s, { sockets, partIds });
      } else {
        if (Object.keys(car.setups).length >= 20) return { error: 'You have 20 setups for this car already: delete one first.' };
        const n = this.#setupName(car, name);
        if (n.error) return n;
        setupId = `setup_${String(p.nextId++).padStart(6, '0')}`;
        car.setups[setupId] = { setupId, name: n.name, sockets, partIds };
      }
      car.activeSetup = setupId;
      return { result: { setupId } };
    });
  }
  renameSetup(carInstanceId, setupId, name) {
    return this.#change('setup', p => {
      const car = p.cars[carInstanceId], s = car?.setups[setupId];
      if (!s) return { error: 'There\'s no such setup.' };
      const n = this.#setupName(car, name, setupId);
      if (n.error) return n;
      s.name = n.name;
      return {};
    });
  }
  deleteSetup(carInstanceId, setupId) {
    return this.#change('setup', p => {
      const car = p.cars[carInstanceId];
      if (!car?.setups[setupId]) return { error: 'There\'s no such setup.' };
      delete car.setups[setupId];
      if (car.activeSetup === setupId) car.activeSetup = null;
      return {};
    });
  }
  // What switching to a setup would take: the parts it needs that are gone or on another car
  // (conflicts), and the build it would come to (those sockets stock, if there's a spare stock copy,
  // else empty)
  planSwitch(p, carInstanceId, setupId) {
    const car = p.cars[carInstanceId], setup = car?.setups[setupId], def = car && this.db.cars[car.carId];
    if (!setup) return { error: 'There\'s no such setup.' };
    const conflicts = [], target = {}, used = new Set();
    for (const s of def.sockets) {
      const id = setup.sockets[s.name] ?? null, copy = id && p.parts[id];
      if (id && !copy) conflicts.push({ socket: s.name, partId: setup.partIds?.[s.name] ?? null, reason: 'gone' });
      else if (copy && copy.installedOn && copy.installedOn.car !== carInstanceId) conflicts.push({ socket: s.name, partId: copy.partId, reason: 'elsewhere', car: carName(p, this.db, copy.installedOn.car) });
      else { target[s.name] = id; if (id) used.add(id); continue; }
      target[s.name] = null;
    }
    // stand-ins for what's missing: a spare stock copy (not on a car, not in the setup), else empty
    for (const c of conflicts) {
      const stock = def.sockets.find(s => s.name === c.socket).stock?.[0];
      const spare = stock && Object.values(p.parts).find(x => x.partId === stock && !used.has(x.instanceId) && (!x.installedOn || x.installedOn.car === carInstanceId));
      if (spare) { target[c.socket] = spare.instanceId; used.add(spare.instanceId); c.standIn = stock; }
    }
    return { conflicts, target };
  }
  switchSetup(carInstanceId, setupId, { force = false } = {}) {
    return this.#change('setup', p => {
      const plan = this.planSwitch(p, carInstanceId, setupId);
      if (plan.error) return plan;
      if (plan.conflicts.length && !force) return { error: 'Some of the parts in that setup aren\'t available.', detail: { conflicts: plan.conflicts } };
      for (const x of Object.values(p.parts)) if (x.installedOn?.car === carInstanceId) x.installedOn = null;
      for (const [socket, id] of Object.entries(plan.target)) if (id) p.parts[id].installedOn = { car: carInstanceId, socket };
      // (what can't go on without a part that's missing, stays off)
      const leftOff = [];
      for (let round = 0; round < 12; round++) {
        const g = garageFor(p, this.db, carInstanceId), r = validateBuild(g.build, g.view), wrong = r.errors.find(e => e.code !== 'required_empty' && e.socket && g.build.sockets[e.socket]);
        if (!wrong) break;
        const copy = p.parts[g.build.sockets[wrong.socket]];
        leftOff.push({ socket: wrong.socket, partId: copy.partId, reason: wrong.message });
        copy.installedOn = null;
      }
      p.cars[carInstanceId].activeSetup = setupId;
      return { result: { conflicts: plan.conflicts, leftOff } };
    });
  }

  // ---------- the save ----------
  save() { return this.#change('save', () => ({})); }
  async exportSave() {
    return { ok: true, error: null, updatedState: clone(this.profile), json: JSON.stringify({ game: 'drive-world', exported: this.now(), profile: packProfile(this.profile) }, null, 2) };
  }
  importSave(json) {
    return this.#change('import', p => {
      let data;
      try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { return { error: 'That isn\'t a save file (it isn\'t JSON).' }; }
      const save = data?.profile ?? data;
      if (!save || typeof save !== 'object' || !save.parts || !save.cars) return { error: 'That isn\'t a save file.' };
      let brought;
      try { brought = this.#bringIn(save); } catch (err) { return { error: `That save can't be read: ${err.message}` }; }
      for (const k of Object.keys(p)) delete p[k];
      Object.assign(p, brought.profile);
      return { result: { notices: brought.notices } };
    });
  }

  // ---------- development ----------
  addMoney(amount) { return this.#change('dev', p => Number.isFinite(amount) ? (p.money = Math.max(0, p.money + amount), {}) : { error: 'An amount of money, please.' }); }
  givePart(partId, quantity) {
    return this.#change('dev', p => {
      const part = this.db.parts[partId];
      if (!part) return { error: `There's no part "${partId}".` };
      const n = quantity ?? setSize(this.db, part, p.cars[p.currentCar]?.carId);
      return { result: { instanceIds: Array.from({ length: n }, () => addPart(p, this.db, partId)) } };
    });
  }
  giveAllParts() {
    return this.#change('dev', p => {
      const ids = [];
      for (const part of Object.values(this.db.parts)) for (let i = 0; i < setSize(this.db, part, p.cars[p.currentCar]?.carId); i++) ids.push(addPart(p, this.db, part.id));
      return { result: { instanceIds: ids } };
    });
  }
  // development: every part on a car at 100% with no dents, back on, and its body shell as new
  restoreCar(carInstanceId) {
    return this.#change('dev', p => {
      const car = p.cars[carInstanceId];
      if (!car) return { error: 'That car isn\'t yours.' };
      for (const x of Object.values(p.parts)) if (x.installedOn?.car === carInstanceId) { x.condition = 100; delete x.dents; delete x.dentLog; delete x.damage; delete x.attach; }
      delete car.damage;
      return {};
    });
  }
  // development: parts on a car on or off, free (the test worlds' debug commands): { socket: state }
  setAttach(carInstanceId, states) {
    return this.#change('dev', p => {
      if (!p.cars[carInstanceId]) return { error: 'That car isn\'t yours.' };
      const build = buildOf(p, this.db, carInstanceId);
      for (const [socket, state] of Object.entries(states ?? {})) {
        const x = p.parts[build[socket]];
        if (!x) return { error: `Nothing's fitted in ${socket}.` };
        if (!ATTACH.includes(state)) return { error: `"${state}" isn't how a part can be: attached, loose or detached.` };
        if (state === 'attached') delete x.attach; else x.attach = state;
      }
      return {};
    });
  }
  resetHints() { return this.#change('dev', p => { delete p.hints; return {}; }); }
  setCondition(instanceIds, condition) {
    return this.#change('dev', p => {
      if (!(condition >= 0 && condition <= 100)) return { error: 'Condition goes from 0 to 100.' };
      for (const id of [].concat(instanceIds)) { if (!p.parts[id]) return { error: `There's no part copy "${id}".` }; p.parts[id].condition = condition; }
      return {};
    });
  }
  resetProfile() {
    return this.#change('reset', p => { const fresh = newProfile(this.db, this.now()); for (const k of Object.keys(p)) delete p[k]; Object.assign(p, fresh); return {}; });
  }
}

// (What a copy fetches and what it costs to repair, for the screens: the same sums the service uses)
export { sellPrice, repairCost, shellRepairCost, priceOf, setSize, needsRepair };
