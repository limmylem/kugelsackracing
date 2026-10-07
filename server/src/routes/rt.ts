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

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from '@kr/shared';
import type { Config } from '../config.ts';
import type { Guards } from '../session.ts';
import { AppError } from '../errors.ts';
import { signTicket } from '../rt/tickets.ts';
import { PROTOCOL } from '../../../net/protocol.js';

const TicketBody = z.object({ player: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/).optional() }).strict().optional();
const TicketReply = z.object({ ticket: z.string(), url: z.string().nullable(), protocol: z.number(), expiresIn: z.number() });

export async function rtRoutes(api: FastifyInstance, { config, G, mp }: { config: Config; G: Guards; mp?: any }) {
  const app = api.withTypeProvider<ZodTypeProvider>();
  app.post('/rt/ticket', { schema: { body: TicketBody, response: { 200: TicketReply } } }, async req => {
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
