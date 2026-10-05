// Making a track off the page's thread (Phase 5 Step 1): generate it (track/generate.js), build its world
// (track/build.js), and hand it back, its big arrays moved rather than copied. Progress as it goes.
//
//   post { id, spec }  →  { id, progress: { step, share } }…  then  { id, ok, data } | { id, ok: false, error, attempts }

import { generateTrack } from './generate.js';
import { buildTrack } from './build.js';

let cfg = null;
self.onmessage = async e => {
  const { id, spec } = e.data;
  try {
    cfg ??= await (await fetch(new URL('../data/tracks.json', import.meta.url), { cache: 'no-cache' })).json();
    self.postMessage({ id, progress: { step: 'layout', share: 0.05 } });
    const gen = generateTrack(spec);
    if (!gen.ok) { self.postMessage({ id, ok: false, error: gen.error, attempts: gen.attempts, code: gen.code }); return; }
    self.postMessage({ id, progress: { step: 'layout', share: 0.2, attempts: gen.attempts.length } });
    const data = buildTrack(gen, cfg, { progress: (step, share) => self.postMessage({ id, progress: { step, share: 0.2 + 0.8 * share } }) });
    self.postMessage({ id, ok: true, data }, transfers(data));
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message ?? String(err) });
  }
};

export function transfers(d) {
  return [d.road.positions.buffer, d.road.indices.buffer, d.road.colours.buffer, d.terrain.heights.buffer, d.centre.x.buffer, d.centre.z.buffer, d.centre.h.buffer, d.centre.bank.buffer];
}
