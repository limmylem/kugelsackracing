// Join tickets (Phase 7 Step 1; docs/MULTIPLAYER.md "Joining"): how a player's account reaches the real-time server.
// The API, which has the session cookie, checks the player (signed in, not banned, terms accepted, a guest only where
// guests may play) and signs a ticket that lasts a minute. The real-time server — another process, another address,
// no database — checks the signature and the expiry, and takes each ticket once. Nothing in it is secret; it just
// can't be made or changed without RT_SECRET.
//
//   signTicket(secret, { uid, name, role, guest }, ttlSec) → 'payload.signature' (base64url)
//   verifyTicket(secret, ticket, now?) → { uid, name, role, guest, jti, exp } or null

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type Ticket = { uid: string; name: string; role: string; guest: boolean; jti: string; exp: number };

const b64 = (b: Buffer) => b.toString('base64url');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest();

export function signTicket(secret: string, who: { uid: string; name: string; role: string; guest: boolean }, ttlSec: number, now = Date.now()): string {
  const t: Ticket = { ...who, jti: b64(randomBytes(12)), exp: Math.floor(now / 1000) + ttlSec };
  const body = b64(Buffer.from(JSON.stringify(t)));
  return `${body}.${b64(mac(secret, body))}`;
}

export function verifyTicket(secret: string, ticket: unknown, now = Date.now()): Ticket | null {
  if (typeof ticket !== 'string' || ticket.length > 2048) return null;
  const [body, sig, extra] = ticket.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(secret, body), got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let t: Ticket;
  try { t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!t || typeof t.uid !== 'string' || typeof t.exp !== 'number' || typeof t.jti !== 'string') return null;
  if (t.exp * 1000 < now) return null;
  return t;
}
