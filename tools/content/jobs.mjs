// Content jobs (docs/CONTENT_PIPELINE.md "A family from the admin page"): build and check, run in the background — the
// admin page's family builder starts them on the server, each in a worker thread (tools/content/jobWorker.mjs) that
// calls the pipeline's own modules, as npm run content does: never a shell command. Each job has its steps, its progress,
// a log in the words the command line uses, and its result; it can be cancelled.
//
//  - one job per family (engine, car) at a time; at most jobs.maxRunning running and jobs.maxQueued waiting
//    (data/content/builder.json)
//  - a job that writes has the pipeline's files to itself for its whole run (the parts' index, the checks' results and
//    thumbnails are shared): the others that write wait their turn; previews write to a folder of their own and run
//    alongside
//  - before it writes, a job copies everything it can touch (data/.backup/jobs/<job>/); failed, cancelled or timed out,
//    all of it is put back as it was and anything it added is removed — then it says why
//
//   const jobs = createJobs({ root, onChange, onFinish });   jobs.start(spec) → job;   jobs.cancel(id);   jobs.list()
//   spec: { type: 'family' | 'engine' | 'car' | 'build' | 'preview', target, title, payload, by: { id, name }, reason }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { ROOT, readJson } from './rules.mjs';

const WRITES = new Set(['family', 'engine', 'car', 'build']);
const now = () => new Date().toISOString();

// ---------- what a job can touch, and putting it back ----------

// The files a job can change: [{ dir, prefix?, suffix?, deep? } | { file }] (paths from the root)
export function touchesOf(spec, root = ROOT) {
  const shared = [{ file: 'data/parts/index.json' }, { file: 'data/content/checks.json' }, { file: 'data/content/thumbs.json' }];
  const partDirs = () => fs.readdirSync(path.join(root, 'data/parts'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => `data/parts/${e.name}`);
  if (spec.type === 'family' || spec.type === 'build') {
    const ids = spec.type === 'family' ? [spec.target] : spec.payload.ids;
    const F = readJson('data/content/formulas.json', root), out = [...shared];
    for (const id of ids) {
      const engine = fs.existsSync(path.join(root, `data/engines/${id}.json`)) || spec.payload?.engines?.includes(id);
      if (engine) { out.push(...touchesOf({ type: 'engine', target: id }, root).filter(t => !t.file || !shared.some(s => s.file === t.file))); continue; }
      const def = spec.type === 'family' ? spec.payload.def : fs.existsSync(path.join(root, `data/families/${id}.json`)) ? readJson(`data/families/${id}.json`, root) : null;
      const category = F.families[def?.kind]?.category;
      out.push({ file: `data/families/${id}.json` }, ...partDirs().map(dir => ({ dir, prefix: `${id}_`, suffix: '.json' })), { dir: 'assets/icons/parts', prefix: `${id}_` }, { dir: 'assets/thumbs', prefix: `${id}_` });
      if (category) out.push({ dir: `assets/parts/${category}/${id}`, deep: true });
    }
    return out;
  }
  if (spec.type === 'engine') {
    const c = `crate_${spec.target}`;
    return [...shared, { file: `data/engines/${spec.target}.json` }, { dir: 'data/parts/engine', prefix: `${c}.` }, { dir: 'assets/parts/engine', prefix: `${c}.` }, { dir: 'assets/icons/parts', prefix: `${c}.` }, { dir: 'assets/thumbs', prefix: `${c}.` }];
  }
  if (spec.type === 'car') {
    const id = spec.target;
    return [...shared, { file: 'data/cars/index.json' }, { dir: `data/cars/${id}`, deep: true }, ...partDirs().map(dir => ({ dir, suffix: `_${id}.json` })), { dir: `assets/cars/${id}`, deep: true }, { dir: `assets/parts/stock/${id}`, deep: true },
      { file: `assets/icons/cars/${id}.png` }, { file: `incoming/car_${id}.glb` }, { file: `incoming/imported/car_${id}.glb` }];
  }
  return [];
}
function matching(root, t) {
  if (t.file) return fs.existsSync(path.join(root, t.file)) ? [t.file] : [];
  const full = path.join(root, t.dir);
  if (!fs.existsSync(full)) return [];
  const names = t.deep ? fs.readdirSync(full, { recursive: true }).map(String).filter(f => fs.statSync(path.join(full, f)).isFile()) : fs.readdirSync(full).filter(f => fs.statSync(path.join(full, f)).isFile());
  return names.filter(f => (!t.prefix || path.basename(f).startsWith(t.prefix)) && (!t.suffix || f.endsWith(t.suffix))).map(f => path.posix.join(t.dir, f.split(path.sep).join('/')));
}
// A copy of everything a job can touch → { restore() (back as it was), drop() (no longer needed) }
export function snapshot(root, touches, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const had = new Set();
  for (const t of touches) for (const f of matching(root, t)) { if (had.has(f)) continue; had.add(f); const to = path.join(dir, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(root, f), to); }
  return {
    files: had.size,
    restore() {
      const removed = [], restored = [];
      for (const t of touches) for (const f of matching(root, t)) if (!had.has(f)) { fs.rmSync(path.join(root, f), { force: true }); removed.push(f); }
      for (const f of had) {
        const from = path.join(dir, f), to = path.join(root, f);
        if (!fs.existsSync(to) || !fs.readFileSync(to).equals(fs.readFileSync(from))) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); restored.push(f); }
      }
      // (folders it made and left empty)
      for (const t of touches) if (t.dir && t.deep) { const full = path.join(root, t.dir); if (fs.existsSync(full) && !fs.readdirSync(full, { recursive: true }).some(f => fs.statSync(path.join(full, String(f))).isFile())) fs.rmSync(full, { recursive: true, force: true }); }
      return { removed, restored };
    },
    drop() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

// ---------- the jobs ----------

export function createJobs({ root = ROOT, config = null, onChange = () => {}, onFinish = async () => {}, workerUrl = new URL('./jobWorker.mjs', import.meta.url) } = {}) {
  const C = () => config ?? readJson('data/content/builder.json', root).jobs;
  const jobs = new Map(), live = new Map();
  let writer = null, closed = false;
  const view = j => ({ id: j.id, type: j.type, target: j.target, title: j.title, state: j.state, step: j.step, progress: j.progress, log: j.log, result: j.result, error: j.error, problems: j.problems ?? [], by: j.by, reason: j.reason, created: j.created, started: j.started, finished: j.finished, writes: j.writes, waitingFor: j.state === 'waiting' ? (j.writes && writer ? jobs.get(writer)?.title ?? null : null) : null, undone: j.undone ?? null });
  const changed = j => { try { onChange(view(j)); } catch { /* (a listener's problem isn't the job's) */ } };
  const say = (j, text, kind = '') => { j.log.push({ at: now(), text, kind }); if (j.log.length > 2000) j.log.splice(0, j.log.length - 2000); changed(j); };

  function start(spec) {
    if (closed) throw new Error('The server is closing: no new jobs.');
    if (!spec?.type || !spec.target) throw new Error('A job needs its type and what it\'s for.');
    const busy = [...jobs.values()].find(j => j.target === spec.target && ['waiting', 'running'].includes(j.state));
    if (busy) throw Object.assign(new Error(`There's a job for ${spec.target} already (${busy.title}, ${busy.state}): one at a time. Wait for it, or cancel it.`), { code: 'JOB_BUSY', job: busy.id });
    const waiting = [...jobs.values()].filter(j => j.state === 'waiting').length;
    if (waiting >= C().maxQueued) throw Object.assign(new Error(`${waiting} jobs are waiting already, the most there may be (data/content/builder.json jobs.maxQueued): wait for some to finish.`), { code: 'JOBS_FULL' });
    const j = { id: `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`, type: spec.type, target: spec.target, title: spec.title ?? `${spec.type} ${spec.target}`, payload: spec.payload ?? {}, by: spec.by ?? null, reason: spec.reason ?? '',
      writes: WRITES.has(spec.type), state: 'waiting', step: null, progress: null, log: [], result: null, error: null, created: now(), started: null, finished: null };
    jobs.set(j.id, j);
    say(j, `Waiting to start (${C().maxRunning} at most at once${j.writes ? '; one that writes files at a time' : ''}).`);
    prune();
    queueMicrotask(pump);
    return view(j);
  }
  function pump() {
    if (closed) return;
    for (const j of [...jobs.values()].filter(x => x.state === 'waiting').sort((a, b) => a.created.localeCompare(b.created))) {
      const running = [...jobs.values()].filter(x => x.state === 'running').length;
      if (running >= C().maxRunning) return;
      if (j.writes && writer) continue;
      run(j);
    }
  }
  function run(j) {
    j.state = 'running'; j.started = now();
    let snap = null;
    if (j.writes) {
      writer = j.id;
      try { snap = snapshot(root, touchesOf(j, root), path.join(root, 'data/.backup/jobs', j.id)); say(j, `Copied the ${snap.files} file${snap.files === 1 ? '' : 's'} it can change, to put back if it fails.`); }
      catch (err) { writer = null; finish(j, 'failed', { error: `It couldn't copy the files it would change first, so it didn't start: ${err.message}` }); return; }
    }
    const w = new Worker(workerUrl, { workerData: { root, job: { id: j.id, type: j.type, target: j.target, payload: j.payload } } });
    w.unref?.();
    const timer = setTimeout(() => { if (j.state === 'running') { say(j, `It ran for more than ${C().timeoutMinutes} minutes (data/content/builder.json jobs.timeoutMinutes): stopped.`, 'bad'); stop('failed', `It took too long (over ${C().timeoutMinutes} minutes) and was stopped.`); } }, C().timeoutMinutes * 60_000);
    timer.unref?.();
    live.set(j.id, { worker: w, stop });
    let ended = false;
    async function stop(state, error, extra = {}) {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      live.delete(j.id);
      await w.terminate().catch(() => {});
      if (snap) {
        if (state === 'done') snap.drop();
        else {
          try { const u = snap.restore(); j.undone = u; say(j, `Put everything back as it was: ${u.restored.length} file${u.restored.length === 1 ? '' : 's'} restored, ${u.removed.length} it added removed.`); snap.drop(); }
          catch (err) { say(j, `Putting the files back went wrong: ${err.message} (the copies are in data/.backup/jobs/${j.id}).`, 'bad'); }
        }
      }
      if (writer === j.id) writer = null;
      finish(j, state, { error, ...extra });
    }
    w.on('message', m => {
      if (m.type === 'log') say(j, m.text, m.kind ?? '');
      else if (m.type === 'step') { j.step = m.step; j.progress = null; say(j, m.text ?? m.step, 'step'); }
      else if (m.type === 'progress') { j.progress = { done: m.done, total: m.total }; changed(j); }
      else if (m.type === 'done') void stop('done', null, { result: m.result });
      else if (m.type === 'failed') void stop('failed', m.error, { problems: m.problems ?? [], result: m.result ?? null });
    });
    w.on('error', err => void stop('failed', `It went wrong: ${err.message}`));
    w.on('exit', code => { if (!ended) void stop(j.cancelling ? 'cancelled' : 'failed', j.cancelling ? null : `The job's worker stopped (${code}).`); });
    changed(j);
  }
  function finish(j, state, { error = null, result = null, problems = [] } = {}) {
    j.state = state; j.finished = now(); j.error = error ?? null; j.result = result ?? j.result; j.problems = problems;
    say(j, state === 'done' ? 'Done.' : state === 'cancelled' ? 'Cancelled: nothing it did is kept.' : `Failed: ${error}`, state === 'done' ? 'good' : 'bad');
    Promise.resolve().then(() => onFinish(view(j))).catch(() => {}).finally(pump);
  }
  function cancel(id) {
    const j = jobs.get(id);
    if (!j) return null;
    if (j.state === 'waiting') { finish(j, 'cancelled'); return view(j); }
    if (j.state === 'running') { j.cancelling = true; say(j, 'Cancelling…'); live.get(id)?.stop('cancelled', null); return view(j); }
    return view(j);
  }
  function prune() {
    const done = [...jobs.values()].filter(j => !['waiting', 'running'].includes(j.state)).sort((a, b) => b.created.localeCompare(a.created));
    for (const j of done.slice(C().keepFinished)) jobs.delete(j.id);
  }
  return {
    start, cancel,
    get: id => jobs.has(id) ? view(jobs.get(id)) : null,
    list: () => [...jobs.values()].sort((a, b) => b.created.localeCompare(a.created)).map(view),
    busy: () => [...jobs.values()].some(j => ['waiting', 'running'].includes(j.state)),
    async close() { closed = true; for (const j of jobs.values()) if (j.state === 'waiting') finish(j, 'cancelled'); await Promise.all([...live.values()].map(l => l.stop('cancelled', null))); },
  };
}
