// The API's line to the real-time server (Phase 7 Step 1), through Redis: a ban or suspension removes the player
// from any room at once (and the real-time server refuses them until it ends), however they joined. Without
// REDIS_URL (tests, the local-only game) it does nothing; the API still refuses them a join ticket.

import { Redis } from 'ioredis';
import { CODES, MESSAGES } from '../../../net/protocol.js';

export type RtBridge = { banned(uid: string, seconds: number | null): Promise<void>; unbanned(uid: string): Promise<void>; close(): Promise<void> };

export function createRtBridge(redisUrl: string | null, log: (m: string, e?: object) => void = () => {}): RtBridge {
  if (!redisUrl) return { async banned() {}, async unbanned() {}, async close() {} };
  const r = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  const safe = async (f: () => Promise<unknown>) => { try { if (r.status === 'wait') await r.connect(); await f(); } catch (e: any) { log('rt bridge failed', { err: e?.message }); } };
  return {
    async banned(uid, seconds) {
      await safe(async () => {
        // (the real-time server checks this on every join; a ban without an end is kept a year, then the API's own
        // check still stands)
        await r.set(`rt:banned:${uid}`, '1', 'EX', Math.max(60, Math.min(seconds ?? 365 * 86400, 365 * 86400)));
        await r.publish('rt:kick', JSON.stringify({ uid, code: CODES.BANNED, message: MESSAGES[CODES.BANNED] }));
      });
    },
    async unbanned(uid) { await safe(() => r.del(`rt:banned:${uid}`)); },
    async close() { r.disconnect(); },
  };
}
