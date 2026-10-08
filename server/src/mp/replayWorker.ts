// The replay worker (./replay.ts): a multiplayer run driven again from its inputs, pushes and car changes on its
// generated track (mp/verify.js replayRun), and where it went compared with the trail the run claims.
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { REPO_DIR } from '../config.ts';
import { replayRun, compareTrails, trackFor } from '../../../mp/verify.js';
import { socketsFromGlb } from '../../../physics/sockets.js';
import { installDetMath } from '../../../physics/detmath.js';

installDetMath();
await RAPIER.init();
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, f), 'utf8'));
const settings = json('physics/settings.json'), tracksCfg = json('data/tracks.json'), contact = json('data/multiplayer.json').contact;
const tracks = new Map<string, any>(), glbs = new Map<string, ArrayBuffer>();
const trackOf = (code: string) => { if (!tracks.has(code)) { tracks.set(code, trackFor(code, tracksCfg)); if (tracks.size > 8) tracks.delete(tracks.keys().next().value!); } return tracks.get(code); };
const glbOf = (file: string) => { if (!glbs.has(file)) { const b = fs.readFileSync(path.join(REPO_DIR, file)); glbs.set(file, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); } return glbs.get(file)!; };

parentPort!.on('message', (job: any) => {
  const t0 = performance.now();
  try {
    const T = trackOf(job.code), spec = job.spec, sockets = socketsFromGlb(glbOf(spec.model.file), spec.model);
    const r = replayRun({ RAPIER, settings, spec, sockets, track: T.track, run: job.run });
    parentPort!.postMessage({ id: job.id, problems: compareTrails(job.run.trail, r.trail, contact.verify.replayTolM), ms: performance.now() - t0 });
  } catch (e: any) {
    parentPort!.postMessage({ id: job.id, problems: [], skipped: `couldn't drive it again: ${e?.message ?? e}` });
  }
});
