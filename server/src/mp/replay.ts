// Driving a multiplayer run again (Phase 7 Step 3; docs/CONTACT.md "Verification"), off the API's own thread: a worker
// (./replayWorker.ts) with the physics, the generated tracks it has built and the car models. One job at a time;
// a job that takes too long is given up (and the run judged on the other checks).
//
//   const R = createReplayer()     await R.check({ run, code, spec }) → { problems, skipped? }     R.close()

import { Worker } from 'node:worker_threads';

export function createReplayer({ timeoutMs = 120000 } = {}) {
  let w: Worker | null = null, next = 1;
  const waiting = new Map<number, (m: any) => void>();
  const worker = () => {
    if (w) return w;
    w = new Worker(new URL('./replayWorker.ts', import.meta.url));
    w.on('message', (m: any) => { const f = waiting.get(m.id); waiting.delete(m.id); f?.(m); });
    w.on('error', (e: any) => { for (const f of waiting.values()) f({ problems: [], skipped: `the replay failed: ${e?.message ?? e}` }); waiting.clear(); w = null; });
    w.on('exit', () => { w = null; });
    w.unref();
    return w;
  };
  return {
    check(job: { run: any; code: string; spec: any }): Promise<{ problems: string[]; skipped?: string; ms?: number }> {
      return new Promise(res => {
        const id = next++;
        const t = setTimeout(() => { waiting.delete(id); res({ problems: [], skipped: 'the replay took too long' }); }, timeoutMs);
        t.unref?.();
        waiting.set(id, m => { clearTimeout(t); res({ problems: m.problems ?? [], skipped: m.skipped, ms: m.ms }); });
        worker().postMessage({ id, ...job });
      });
    },
    close() { void w?.terminate(); w = null; },
  };
}
