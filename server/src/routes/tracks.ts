// Generated tracks' endpoints (tracks/service.ts; docs/SERVER.md):
//   GET    /tracks/today                    the day's and the week's tracks and their events (anyone)
//   POST   /tracks/results                  a run handed in → checked, kept; the record, the leaderboard place
//   GET    /tracks/leaderboard?eventId      an event's leaderboard (anyone; your place too if signed in)
//   GET    /tracks/records?code             your records
//   POST   /replays · GET /replays · GET /replays/:id · DELETE /replays/:id     race replays
// Handing in a run, keeping a replay: a signed-in player (a guest counts) who has accepted the terms.

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { LIMITS, Leaderboard, LeaderboardQuery, Ok, RecordEntry, RecordsQuery, ReplayMeta, ReplayResponse, ReplayUpload, TrackResultBody, TrackResultResponse, TracksToday, z } from '@kr/shared';
import type { Config } from '../config.ts';
import type { Guards } from '../session.ts';
import { sessionOf } from '../session.ts';
import type { Auth } from '../auth.ts';
import type { TrackService } from '../tracks/service.ts';

export async function trackRoutes(app0: FastifyInstance, { tracks, G, auth }: { config: Config; tracks: TrackService; G: Guards; auth: Auth }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();

  app.get('/tracks/today', { schema: { response: { 200: TracksToday } } }, async (_req, reply) => {
    const out = await tracks.today();
    // (cached until the day's track changes: at most a minute, so a new day shows promptly)
    const left = Math.max(0, Math.floor((Date.parse(out.daily.endsAt) - Date.now()) / 1000));
    reply.header('cache-control', `public, max-age=${Math.min(60, left)}, s-maxage=${Math.min(300, left)}`);
    return out;
  });

  app.post('/tracks/results', { bodyLimit: LIMITS.resultBytes, schema: { body: TrackResultBody, response: { 200: TrackResultResponse } } }, async req => {
    const s = await G.requireTerms(req);
    return tracks.submit({ id: s.user.id, name: s.user.name }, req.body);
  });

  app.get('/tracks/leaderboard', { schema: { querystring: LeaderboardQuery, response: { 200: Leaderboard } } }, async (req, reply) => {
    const s = await sessionOf(auth, req);
    reply.header('cache-control', s ? 'private, max-age=5' : 'public, max-age=15, s-maxage=15');
    return tracks.leaderboard(req.query.eventId, req.query.limit, s?.user.id ?? null);
  });

  app.get('/tracks/records', { schema: { querystring: RecordsQuery, response: { 200: z.object({ records: z.array(RecordEntry) }) } } }, async (req, reply) => {
    const s = await G.requireUser(req);
    reply.header('cache-control', 'private, no-store');
    return tracks.records(s.user.id, req.query.code ?? null) as any;
  });

  // ---------- replays ----------
  const ReplayId = z.object({ id: z.string().regex(/^rp_[A-Za-z0-9_-]{8,40}$/, 'not a replay id') });
  app.post('/replays', { bodyLimit: LIMITS.replayUploadBytes, schema: { body: ReplayUpload, response: { 200: ReplayMeta } } }, async req => {
    const s = await G.requireTerms(req);
    return tracks.saveReplay({ id: s.user.id, name: s.user.name }, req.body);
  });
  app.get('/replays', { schema: { response: { 200: z.object({ replays: z.array(ReplayMeta) }) } } }, async (req, reply) => {
    const s = await G.requireUser(req);
    reply.header('cache-control', 'private, no-store');
    return tracks.myReplays(s.user.id);
  });
  app.get('/replays/:id', { schema: { params: ReplayId, response: { 200: ReplayResponse } } }, async (req, reply) => {
    const s = await sessionOf(auth, req);
    // (a replay never changes; anyone with its id may watch it — a leaderboard links its record's)
    reply.header('cache-control', 'private, max-age=3600');
    return tracks.replay(req.params.id, s?.user.id ?? null) as any;
  });
  app.delete('/replays/:id', { schema: { params: ReplayId, response: { 200: Ok } } }, async req => {
    const s = await G.requireUser(req);
    return tracks.deleteReplay(req.params.id, s.user.id);
  });
}
