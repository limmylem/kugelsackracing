// Monster engines: the Builder's engines up to 2,000 hp (data/content/formulas.json engines) — what they need fitted
// (a triple-plate clutch past 1,400 N·m), their price (race, at the top of its band: the engines up to 900 hp priced as
// they were), the cars they're left off (leaveOff: those they'd take past their class limits), and the physics turning
// the power into speed (traction control past twice the tyres' grip: physics/vehicle.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, load } from '../harness.mjs';
import { cratePart, engineDesign } from '../../garage/engines.js';

const H = await harness();
const F = load('data/content/formulas.json'), S = load('data/content/standards.json'), tiers = load('data/content/tiers.json');
const monster = { id: 'test_hyper_v12', maker: 'Ognistrada Engines', layout: 'v', cylinders: 12, displacement: 8, aspiration: 'turbo', boost: 2.4, idle: 900, redline: 8500, character: 0.8, mount: 'long', sound: 'v12', colour: 'silver' };

test('an engine of nearly 2,000 hp can be made: it needs the triple-plate clutch, it\'s race at the top of the band; past 2,000 hp it can\'t', () => {
  const r = cratePart(monster, { formulas: F, standards: S, tiers });
  assert.deepEqual(r.problems, []);
  assert.ok(r.part.engineSpec.peakPower > 1500 && r.part.engineSpec.peakPower <= 2000, `${r.part.engineSpec.peakPower} hp, ${r.part.engineSpec.peakTorque} N·m`);
  assert.ok(r.part.requires.includes('clutch_rating:triple'));
  assert.equal(r.part.tier, 'race');
  assert.equal(r.part.price, Math.round(tiers.slots.engine.street * tiers.tiers.race.price[1] / 10) * 10);
  assert.ok(H.db.parts.clutch_triple.provides.includes('clutch_rating:triple'));
  // (the engines there were before priced as they were)
  const v8 = load('data/engines/kmw_v8_57.json');
  assert.equal(cratePart(v8, { formulas: F, standards: S, tiers }).part.price, H.db.parts.crate_kmw_v8_57.price);
  assert.ok(engineDesign({ ...monster, boost: 3 }, F, S).problems.some(p => /peak power/.test(p)), 'over 2,000 hp: not made');
});

test('an engine left off a car (its class limit) doesn\'t fit it', () => {
  const r = cratePart({ ...monster, leaveOff: { starter_car: 'it would take it past its class limit' } }, { formulas: F, standards: S, tiers });
  assert.deepEqual(r.part.conflicts, ['car:starter_car']);
});

test('triple the Apex V8\'s power: faster at the top, no slower off the line — traction control holds the wheels at a car\'s own spin', () => {
  const stock = H.garage(null, 'apex_v8').stats().spec, big = H.garage(null, 'apex_v8').stats().spec;
  big.engine.torqueCurve = big.engine.torqueCurve.map(([r, t]) => [r, t * 3]);
  big.clutch.maxTorque = 2800;
  const a = H.run(stock, ['zeroTo100', 'topSpeed']), b = H.run(big, ['zeroTo100', 'topSpeed']);
  assert.ok(b.topSpeed.value > a.topSpeed.value + 20, `top speed: ${a.topSpeed.value.toFixed(0)} → ${b.topSpeed.value.toFixed(0)} km/h (${b.topSpeed.detail})`);
  assert.ok(b.zeroTo100.value < a.zeroTo100.value + 0.4, `0–100: ${a.zeroTo100.value.toFixed(2)} → ${b.zeroTo100.value.toFixed(2)} s`);
});
