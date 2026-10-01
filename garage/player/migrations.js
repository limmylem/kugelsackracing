// Saves from older versions of the game, brought up to date one version at a time on load. Each
// migration takes a save of version n and returns it as version n + 1; migrate() runs them in turn.
//
// To change the save format: bump CURRENT_VERSION (and PROFILE_VERSION in profile.js), add
// MIGRATIONS[old version], and a test that an old save still loads.

import { PROFILE_VERSION, clone } from './profile.js';

export const CURRENT_VERSION = PROFILE_VERSION;

export const MIGRATIONS = {
  // 1 → 2: the garage state kept in this browser before the shop (Phase 2 Steps 1–5): builds of
  // socket → part per car. Now: money (the starting amount), every part knows where it's installed,
  // and each car's build is saved as its first setup
  1(save, { db }) {
    const out = { version: 2, money: db.economy.startingMoney, nextId: save.nextId ?? 1, currentCar: save.current ?? null, created: new Date().toISOString(), cars: {}, parts: {} };
    for (const p of Object.values(save.parts ?? {})) {
      out.parts[p.instanceId] = { instanceId: p.instanceId, partId: p.partId, condition: p.condition ?? 100, price: db.parts[p.partId]?.price ?? 0, installedOn: null,
        ...(p.tuning ? { tuning: p.tuning } : {}), ...(p.paint ? { paint: p.paint } : {}) };
    }
    for (const c of Object.values(save.cars ?? {})) {
      const sockets = { ...(c.build?.sockets ?? {}) }, partIds = {};
      for (const [socket, id] of Object.entries(sockets)) {
        if (!id || !out.parts[id]) { sockets[socket] = null; continue; }
        if (out.parts[id].installedOn) { sockets[socket] = null; continue; }     // (in two places: the first keeps it)
        out.parts[id].installedOn = { car: c.carInstanceId, socket };
        partIds[socket] = out.parts[id].partId;
      }
      const setupId = `setup_${String(out.nextId++).padStart(6, '0')}`;
      out.cars[c.carInstanceId] = { carInstanceId: c.carInstanceId, carId: c.carId, price: db.cars[c.carId]?.price ?? 0, ...(c.paint ? { paint: c.paint } : {}),
        activeSetup: setupId, setups: { [setupId]: { setupId, name: 'My setup', sockets, partIds } } };
    }
    return out;
  },
};

// A save of any version brought up to `current`: { save, steps: ['1 → 2', …] }. A save from a newer
// version of the game than this one can't be read (throws).
export function migrate(input, { migrations = MIGRATIONS, current = CURRENT_VERSION, context = {} } = {}) {
  let save = clone(input), version = Number.isInteger(save?.version) ? save.version : 1;
  const steps = [];
  if (version > current) throw new Error(`this save is from a newer version of the game (save version ${version}; this game reads up to ${current})`);
  while (version < current) {
    const step = migrations[version];
    if (!step) throw new Error(`there's no way to bring a version ${version} save up to date`);
    save = step(save, context);
    save.version = version + 1;
    steps.push(`${version} → ${version + 1}`);
    version++;
  }
  return { save, steps };
}
