// The tracks' heavy work, off the server's main thread (a worker: the API keeps answering while a track is
// made): the day's or the week's track (track/events/model.js — the quality-checked search, the same as the
// game's), and a track built from its code (track/build.js — its course and hash, what results are checked
// against). The game's own modules, so the server and every player make the same tracks.
//
//   { id, op: 'day', kind: 'daily' | 'weekly', at: ms }  → { kind, key, code, name, seed, version, preset, info, quality }
//   { id, op: 'build', code }                            → { code, version, hash, course (as stored), info, name, seed }

import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { dailyTrack, weeklyTrack, sharedTrack } from '../../../track/events/model.js';
import { generateTrack } from '../../../track/generate.js';
import { buildTrack } from '../../../track/build.js';
import { trackHash } from '../../../track/events/hash.js';
import { trackInfo } from '../../../track/events/model.js';

const read = (f: string) => JSON.parse(fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8'));
const E = read('data/trackEvents.json'), TC = read('data/tracks.json');

// (the quality report: its scores, not the whole working)
const qualityOf = (q: any) => q ? { gate: q.gate, score: q.score ?? null, grade: q.grade ?? null } : null;

function day(kind: 'daily' | 'weekly', at: number) {
  const t = (kind === 'daily' ? dailyTrack : weeklyTrack)(new Date(at), E, TC);
  return { kind, key: t.key, code: t.code, name: t.name, seed: t.seed, version: t.version, preset: t.preset ?? null, info: t.info, quality: qualityOf(t.quality), skipped: t.skipped?.length ?? 0 };
}
function build(code: string) {
  const gen = generateTrack({ code });
  if (!gen.ok) throw new Error(gen.error ?? 'That code doesn\'t make a track.');
  const data = buildTrack(gen, TC), described = sharedTrack(code);
  return { code: gen.code, version: gen.version, hash: trackHash(data), course: data.course, info: trackInfo(data), name: described.name, seed: described.seed };
}

parentPort!.on('message', (m: { id: number; op: string; kind?: 'daily' | 'weekly'; at?: number; code?: string }) => {
  try {
    const out = m.op === 'day' ? day(m.kind!, m.at!) : m.op === 'build' ? build(m.code!) : (() => { throw new Error(`no op ${m.op}`); })();
    parentPort!.postMessage({ id: m.id, ok: true, out });
  } catch (e: any) {
    parentPort!.postMessage({ id: m.id, ok: false, error: String(e?.message ?? e) });
  }
});
