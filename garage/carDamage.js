// A crash, start to finish, for any car: what one impact (physics/impacts.js) does to its body (dents,
// condition, glass and lights: garage/damage.js), which parts it shakes loose or tears off
// (garage/detach.js), and its mechanicals (bent, leaking, a wheel torn off: garage/mechanical.js). Pure:
// the player's car (garage/session.js, which writes the outcome to the save), the AI cars in the test
// worlds, the crash test suite (garage/crashSuite.js) and — later — other players' cars all work a
// crash out the same way.
//
//   crashOutcome(ctx, impact, { mode, detach }) → { result, changes, states, mech, next, touched }
//     ctx: { car, build, view (the garage's view: parts, owned), boxes (physics/sockets.js nodeBoxes:
//     the body shell, its glass and lights), rules (data/damage.json), attach ({ socket: { state,
//     stress } }), mech ({ instanceId: damage block }), damage ({ shell, parts: { instanceId: { condition,
//     dents } } }), layouts (a Map to keep the layouts in between hits, if the build won't change) }
//     result: impactDamage's (what was hit, the dents, losses, stress, broken) · changes: parts that came
//     loose or off ([{ socket, from, to, stress, reason }], wheels too) · states: the attach states after ·
//     mech: impactMechanical's ({ damage: { id: block } changed, effects, wheelOff }) · next: the body
//     damage after (applyDamage) · touched: the part copies whose condition or dents changed
//
// CarDamage keeps all of that in memory for a car that isn't the player's (an AI car, a crash test):
// hit(impact) applies an impact, view is what to draw, drivable() whether it can carry on.

import { applyDamage, damageLayout, impactDamage } from './damage.js';
import { attachAfterImpact } from './detach.js';
import { CORNERS, impactMechanical, mechanicalLayout, prune } from './mechanical.js';

const clone = x => JSON.parse(JSON.stringify(x));
const torn = attach => Object.fromEntries(Object.entries(attach ?? {}).filter(([, x]) => x.state === 'detached').map(([k]) => [k, 'detached']));

export function crashOutcome(ctx, impact, { mode = 'full', detach = true } = {}) {
  const { car, build, view, boxes = {}, rules } = ctx, attach = ctx.attach ?? {}, off = torn(attach);
  // (where everything is: the same till a part comes off — ctx.layouts, a Map, keeps them between hits)
  const key = Object.keys(off).sort().join(','), layout = (kind, make) => {
    if (!ctx.layouts) return make();
    const k = `${kind}|${key}`;
    if (!ctx.layouts.has(k)) ctx.layouts.set(k, make());
    return ctx.layouts.get(k);
  };
  const result = impactDamage(impact, layout('damage', () => damageLayout({ car, build: { ...build, attach: off }, db: view, boxes }, rules)), rules, { mode });
  // parts shaken loose or torn off: only those still on the car count, and only those that can come off
  const bySocket = {};
  for (const [socket, id] of Object.entries(build.sockets)) if (id && attach[socket]?.state !== 'detached') bySocket[socket] = view.parts[view.owned[id]?.partId];
  const states = { ...attach }, changes = [];
  if (detach && mode !== 'off') {
    const r = attachAfterImpact(attach, result.stress, bySocket, { mode });
    for (const c of r.changes) { states[c.socket] = r.states[c.socket]; changes.push(c); }
  }
  // the mechanicals in the zones it reached (full damage only): bent, leaking, a wheel torn off (its rim
  // bent right over, its tyre flat)
  const none = { damage: {}, effects: [], wheelOff: [], hits: [] };
  let mech = none;
  if (mode === 'full' && rules.mechanical) {
    const L = layout('mechanical', () => mechanicalLayout({ car, build: { ...build, attach: off }, db: view }));
    const wheelAt = Object.fromEntries(CORNERS.map(k => [k, car.sockets.find(s => s.name === car.model.sockets[k])?.position]).filter(([, p]) => p));
    mech = impactMechanical(ctx.mech ?? {}, { ...impact, depth: result.depth }, L, rules.mechanical, { mode, wheelAt });
    if (detach) for (const k of mech.wheelOff) {
      const socket = car.model.sockets[k];
      if (!socket || states[socket]?.state === 'detached') continue;
      changes.push({ socket, from: states[socket]?.state ?? 'attached', to: 'detached', stress: 0, reason: `a ${result.strength.toFixed(0)} m/s hit` });
      states[socket] = { state: 'detached', stress: states[socket]?.stress ?? 0 };
      const R = rules.mechanical.systems, block = id => mech.damage[id] ?? ctx.mech?.[id] ?? {};
      const rim = L.carriers.rim[k], tyre = L.carriers.tyre[k];
      if (rim) mech.damage[rim] = prune({ ...block(rim), bend: R.rim.max });
      if (tyre) mech.damage[tyre] = prune({ ...block(tyre), pressure: 0, leak: 0 });
    }
  }
  const before = ctx.damage ?? { shell: null, parts: {} };
  const next = applyDamage({ shell: before.shell, parts: Object.fromEntries(Object.values(build.sockets).filter(Boolean).map(id => [id, { condition: before.parts?.[id]?.condition ?? view.owned[id]?.condition ?? 100, dents: before.parts?.[id]?.dents ?? [] }])) }, result, rules, build.sockets);
  const touched = [...new Set([...result.dents.map(d => build.sockets[d.target]), ...result.losses.map(l => l.instanceId)].filter(Boolean))];
  return { result, changes, states, mech, next, touched };
}

// A car's crash damage in memory (not the player's: nothing's saved). build / view as the garage has
// them (an AI car on the player's spec: the player's build); boxes as for crashOutcome
export class CarDamage {
  constructor({ car, build, view, boxes, rules, mode = 'full' }) {
    Object.assign(this, { car, build, view, boxes, rules, mode });
    this.layouts = new Map();          // (the car's layouts, by what's torn off: its build never changes)
    this.reset();
  }
  // as new
  reset() {
    this.attach = {};
    this.mech = {};
    this.damage = { shell: null, parts: {} };
    this.conditions = Object.fromEntries(Object.values(this.build.sockets).filter(Boolean).map(id => [id, this.view.owned[id]?.condition ?? 100]));
    this.log = [];
  }
  // an impact (scale: a share of it, e.g. reduced damage from other cars) → crashOutcome's, applied
  hit(impact, { scale = 1, detach = true } = {}) {
    const hit = scale === 1 ? impact : { ...impact, strength: impact.strength * scale, closing: impact.closing * scale };
    const out = crashOutcome({ car: this.car, build: this.build, view: this.view, boxes: this.boxes, rules: this.rules, attach: this.attach, mech: this.mech, damage: this.damage, layouts: this.layouts }, hit, { mode: this.mode, detach });
    this.attach = out.states;
    Object.assign(this.mech, clone(out.mech.damage));
    this.damage = out.next;
    for (const [id, p] of Object.entries(out.next.parts)) this.conditions[id] = p.condition;
    this.log.push(out);
    if (this.log.length > 16) this.log.shift();          // (the last few: an AI car crashes all race)
    return out;
  }
  // what to draw (garage/visual.js setDamage): { shell, parts: { socket: dents } }
  get view3d() {
    const parts = {};
    for (const [socket, id] of Object.entries(this.build.sockets)) if (id && this.damage.parts[id]?.dents?.length) parts[socket] = this.damage.parts[id].dents;
    return { shell: this.damage.shell, parts };
  }
  // the parts' copies as they are now ({ id: { partId, condition, dents, damage, attach } }) — what a
  // repair would cost is worked out from these (garage/repair.js)
  get owned() {
    const out = {};
    for (const [socket, id] of Object.entries(this.build.sockets)) {
      if (!id) continue;
      const o = this.view.owned[id], a = this.attach[socket]?.state;
      out[id] = { instanceId: id, partId: o.partId, condition: this.conditions[id] ?? o.condition ?? 100, price: this.view.parts[o.partId]?.price ?? 0, installedOn: { socket },
        ...(this.damage.parts[id]?.dents?.length && { dents: this.damage.parts[id].dents }), ...(Object.keys(this.mech[id] ?? {}).length && { damage: this.mech[id] }), ...(a && a !== 'attached' && { attach: a }) };
    }
    return out;
  }
}
