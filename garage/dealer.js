// The dealership: every car for sale, grouped by type (car.json type), each with its class, its price
// (data/economy.json carPrices by class: garage/player/profile.js carPrice) and the key numbers of its
// stock build — power, weight, 0–100 km/h, top speed, grip — as the garage works them out.
//
//   dealerList(db, money) → [{ type, cars: [dealerCar] }]   (types in order of their cheapest car)
//   dealerCar(db, carId, money) → { id, def, name, type, class, price, affordable, hp, nm, kg, zeroTo100,
//                                   top, grip, layout, gears, rating, about }

import { Garage } from './data.js';
import { carPrice } from './player/profile.js';

const STATS = new WeakMap();          // db → carId → the stock build's stats (they only change with the data)

function stockStats(db, carId) {
  if (!STATS.has(db)) STATS.set(db, new Map());
  const m = STATS.get(db);
  if (!m.has(carId)) m.set(carId, new Garage(db, null, carId).stats());
  return m.get(carId);
}

export function dealerCar(db, carId, money = Infinity) {
  const def = db.cars[carId], s = stockStats(db, carId), T = s.totals, R = T?.rating, price = carPrice(db, def);
  return {
    id: carId, def, name: def.name, type: def.type ?? 'Car', class: def.class ?? R?.class ?? '', price, affordable: money >= price,
    hp: T ? Math.round(T.peakPower.hp) : null, nm: T ? Math.round(T.peakTorque.nm) : null, kg: s.spec ? Math.round(s.spec.mass) : null,
    zeroTo100: R?.estimates.zeroTo100 ?? null, top: T?.topSpeed?.kmh ?? R?.estimates.topSpeed ?? null, grip: R?.estimates.grip ?? null,
    layout: def.drivetrain?.layout ?? '', gears: s.spec?.gearbox?.ratios.length ?? null, rating: R?.index ?? null,
    about: def._about && !/^Only what belongs/.test(def._about) ? def._about : null,
  };
}

export function dealerList(db, money = Infinity) {
  const byType = new Map();
  for (const id of Object.keys(db.cars)) {
    const c = dealerCar(db, id, money);
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type).push(c);
  }
  return [...byType].map(([type, cars]) => ({ type, cars: cars.sort((a, b) => a.price - b.price) }))
    .sort((a, b) => a.cars[0].price - b.cars[0].price);
}
