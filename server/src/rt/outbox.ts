// Results never lost (Phase 7 Step 5): what the real-time server hands the API — a race's results, a run handed in, a
// challenge's record, a flag — sent at once, and when that fails (the API restarting for a deploy, the database away a
// moment) tried again with backoff for up to GIVE_UP_MS, in memory. The API takes each once (by its id), so a try
// that got there but whose answer didn't is harmless. A refusal it means (a 4xx: not ours to send, not a race) isn't
// tried again. A server stopping for an update waits for what's left to send (server.ts drain).
//
//   send(what, fn, log, { firstMs, giveUpMs }?) → Promise<fn's result | null>     (null: given up — logged as 'rt result lost')
//   pending() → how many are waiting

const GIVE_UP_MS = 15 * 60e3, FIRST_MS = 2000, MAX_MS = 60e3;
let waiting = 0;

const final = (e: any) => Number.isInteger(e?.status) && e.status >= 400 && e.status < 500 && ![408, 425, 429].includes(e.status);

export async function send<T>(what: string, fn: () => Promise<T>, log: (msg: string, extra?: object) => void = () => {}, { firstMs = FIRST_MS, giveUpMs = GIVE_UP_MS } = {}): Promise<T | null> {
  const t0 = Date.now();
  waiting++;
  try {
    for (let n = 0; ; n++) {
      try { return await fn(); }
      catch (e: any) {
        const wait = Math.min(MAX_MS, firstMs * 2 ** n) * (0.8 + Math.random() * 0.4);
        if (final(e) || Date.now() - t0 + wait > giveUpMs) { log('rt result lost', { what, tries: n + 1, status: e?.status ?? null, err: e?.message }); return null; }
        if (n === 0) log('rt result not sent yet: trying again', { what, status: e?.status ?? null, err: e?.message });
        await new Promise(r => setTimeout(r, wait));
      }
    }
  } finally { waiting--; }
}
export const pending = () => waiting;
