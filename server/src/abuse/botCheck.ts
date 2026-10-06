// The bot check on signing up, signing in and becoming a guest (Phase 6 Step 5; docs/ABUSE.md): Cloudflare
// Turnstile. The page shows its widget (usually nothing to click), which gives a one-use answer; the server asks
// Cloudflare whether that answer is good, from that address, before Better Auth sees the request. Free; off while
// TURNSTILE_SECRET_KEY isn't set (development, and the tests, which pass their own check).
//
//   const check = createBotCheck({ secret })      await check(token, ip) → { ok: true } | { ok: false, reason }
// Cloudflare's test keys (docs/ABUSE.md): secret 1x0000000000000000000000000000000AA always passes,
// 2x0000000000000000000000000000000AA always fails.

export type BotCheck = (token: string | undefined, ip: string) => Promise<{ ok: true } | { ok: false; reason: string }>;

export function createBotCheck({ secret, fetchImpl = globalThis.fetch, timeoutMs = 5000 }: { secret: string; fetchImpl?: typeof fetch; timeoutMs?: number }): BotCheck {
  return async (token, ip) => {
    if (!token || token.length > 2048) return { ok: false, reason: 'missing' };
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    try {
      const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) });
      const j: any = await res.json();
      return j?.success ? { ok: true } : { ok: false, reason: (j?.['error-codes'] ?? ['refused']).join(',') };
    } catch (e: any) {
      // (Cloudflare unreachable: refused, not waved through — a sign-up can wait a minute; a bot flood can't use the gap)
      return { ok: false, reason: `unreachable: ${e?.name ?? 'error'}` };
    }
  };
}

// the paths that need it: making accounts (and guests) and signing in with a password
export const BOT_CHECKED = /^\/api\/auth\/+(sign-up\/email|sign-in\/email|sign-in\/anonymous)\/?$/;
