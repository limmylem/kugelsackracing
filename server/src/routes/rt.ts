// Joining the real-time server (Phase 7 Step 1; docs/MULTIPLAYER.md "Joining"):
//   POST /rt/ticket → { ticket, url, protocol, expiresIn }   a ticket for the player signed in (a minute, used once)
//   POST /rt/ticket { player: 'A' }   development only (config rt.devPlayers): a guest of its own for this window,
//                                    "Player A", signed in or not — two windows of one browser share its sign-in, and
//                                    one account joining twice replaces itself (ELSEWHERE), so each window says which
//                                    player it is (?mp&player=A, ?mp&player=B). Refused anywhere else. (Phase 7 Step 2:
//                                    a guest account of its own, made on first use, so its races count — its rating,
//                                    its pay — like anyone's.)
// Each ticket carries what the races need to know (Phase 7 Step 2, mp/service.ts ticketClaims): the player's rating,
// their cars (class and performance rating, worked out here), who they've blocked, and any queue cooldown.
// The rules are the API's, checked here where the session is: signed in, terms accepted, not banned (403 BANNED);
// a guest only where config.rt.allowGuests. The real-time server checks the ticket and the protocol version.
//
// The load test's bots (Phase 7 Step 5; server/tools/online-bots.ts): with LOADTEST_TOKEN set, a request carrying it in
// x-kr-loadtest (compared in constant time) and { bot: n } (1–200) gets a ticket for a made-up guest, "loadtest-<n>"
// ("Bot <n>"), with no account behind it — closed beta or not, no bot check, and not counted by the per-address limits
// (app.ts asks isLoadtest). Without the token, or with a wrong one, the route is as it was: nothing says it's there.
// Their races count nothing (mp/service.ts: a player with no account is the race server's word alone, unrated, unpaid).

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import crypto from 'node:crypto';
import { API_PREFIX, z } from '@kr/shared';
import type { Config } from '../config.ts';
import type { Guards } from '../session.ts';
import { AppError } from '../errors.ts';
import { signTicket, LOADTEST_PREFIX } from '../rt/tickets.ts';
import { PROTOCOL } from '../../../net/protocol.js';

const TicketBody = z.object({ player: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/).optional() }).strict().optional();
const LoadtestBody = z.object({ bot: z.number().int().min(1).max(200) }).strict();
const TicketReply = z.object({ ticket: z.string(), url: z.string().nullable(), protocol: z.number(), expiresIn: z.number() });

export const LOADTEST_HEADER = 'x-kr-loadtest';
const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
// a load-test bot's request for a ticket: the token right (hashed first, so the compare takes the same time whatever's sent)
export function isLoadtest(token: string | null | undefined, req: { method: string; url: string; headers: Record<string, unknown> }) {
  if (!token || req.method !== 'POST' || req.url.split('?')[0].replace(/\/{2,}/g, '/') !== `${API_PREFIX}/rt/ticket`) return false;
  const sent = req.headers[LOADTEST_HEADER];
  return typeof sent === 'string' && crypto.timingSafeEqual(digest(sent), digest(token));
}

export async function rtRoutes(api: FastifyInstance, { config, G, mp }: { config: Config; G: Guards; mp?: any }) {
  const app = api.withTypeProvider<ZodTypeProvider>();
  let loadtestUses = 0;
  // (before the body's checked against the route's own: a bot's { bot } taken off it here — anyone else's goes on as it was)
  const loadtest = async (req: any) => {
    if (!isLoadtest(config.loadtestToken, req)) return;
    const b = LoadtestBody.safeParse(req.body);
    if (!b.success) throw new AppError(400, 'BAD_REQUEST', 'A load-test ticket needs { bot: 1–200 }.');
    req.loadtestBot = b.data.bot; req.body = {};
  };
  app.post('/rt/ticket', { preValidation: loadtest, schema: { body: TicketBody, response: { 200: TicketReply } } }, async req => {
    const bot = (req as any).loadtestBot as number | undefined;
    if (bot) {
      // (a guest of no account: an ordinary player's claims, nothing of anyone's — its starter car the race server's default)
      const mpClaims = { rating: { mu: 25, sigma: 25 / 3, races: 0 }, cars: [], blocked: [], cooldownUntil: null, friends: [], roam: null };
      const ticket = signTicket(config.rtSecret, { uid: `${LOADTEST_PREFIX}${bot}`, name: `Bot ${bot}`, role: 'player', guest: true, mp: mpClaims }, config.rt.ticketSec);
      loadtestUses++;
      req.log.info({ bot, uses: loadtestUses }, 'load-test ticket');
      return { ticket, url: config.rtUrl, protocol: PROTOCOL, expiresIn: config.rt.ticketSec };
    }
    const player = req.body?.player;
    if (player) {
      if (!config.rt.devPlayers) throw new AppError(403, 'FORBIDDEN', '?player= is for development only.');
      const u = mp ? await mp.devPlayer(player) : { id: `dev-player:${player}`, name: `Player ${player}` };
      const ticket = signTicket(config.rtSecret, { uid: u.id, name: u.name, role: 'player', guest: true, ...(mp ? { mp: await mp.ticketClaims(u) } : {}) }, config.rt.ticketSec);
      return { ticket, url: config.rtUrl, protocol: PROTOCOL, expiresIn: config.rt.ticketSec };
    }
    const s = await G.requireTerms(req);
    if (s.user.isAnonymous && !config.rt.allowGuests) throw new AppError(403, 'FORBIDDEN', 'Make a full account to play online (your progress comes with you).');
    const ticket = signTicket(config.rtSecret, { uid: s.user.id, name: s.user.name, role: s.user.role, guest: s.user.isAnonymous, ...(mp ? { mp: await mp.ticketClaims(s.user) } : {}) }, config.rt.ticketSec);
    return { ticket, url: config.rtUrl, protocol: PROTOCOL, expiresIn: config.rt.ticketSec };
  });
}
