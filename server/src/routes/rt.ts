// Joining the real-time server (Phase 7 Step 1; docs/MULTIPLAYER.md "Joining"):
//   POST /rt/ticket → { ticket, url, protocol, expiresIn }   a ticket for the player signed in (a minute, used once)
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

const TicketReply = z.object({ ticket: z.string(), url: z.string().nullable(), protocol: z.number(), expiresIn: z.number() });

export async function rtRoutes(api: FastifyInstance, { config, G }: { config: Config; G: Guards }) {
  const app = api.withTypeProvider<ZodTypeProvider>();
  app.post('/rt/ticket', { schema: { response: { 200: TicketReply } } }, async req => {
    const s = await G.requireTerms(req);
    if (s.user.isAnonymous && !config.rt.allowGuests) throw new AppError(403, 'FORBIDDEN', 'Make a full account to play online (your progress comes with you).');
    const ticket = signTicket(config.rtSecret, { uid: s.user.id, name: s.user.name, role: s.user.role, guest: s.user.isAnonymous }, config.rt.ticketSec);
    return { ticket, url: config.rtUrl, protocol: PROTOCOL, expiresIn: config.rt.ticketSec };
  });
}
