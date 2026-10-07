// One error format for every failure (@kr/shared ErrorBody): { error: { code, message, details?, requestId } }.
// Routes throw AppError; validation, body-size, media-type, rate-limit and unexpected errors are turned into
// the same shape here. A 5xx never says more than "something went wrong" (the details go to the log and to
// error tracking, with the request id to find them).

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import type { ErrorCode } from '@kr/shared';

export class AppError extends Error {
  status: number; code: ErrorCode; details?: unknown; headers?: Record<string, string>;
  constructor(status: number, code: ErrorCode, message: string, details?: unknown, headers?: Record<string, string>) {
    super(message); this.status = status; this.code = code; this.details = details; this.headers = headers;
  }
}
export const notFound = (what = 'That') => new AppError(404, 'NOT_FOUND', `${what} doesn't exist.`);
export const forbidden = (message = 'You can\'t do that.') => new AppError(403, 'FORBIDDEN', message);
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);

export function sendError(reply: FastifyReply, request: FastifyRequest, status: number, code: ErrorCode, message: string, details?: unknown) {
  return reply.status(status).header('content-type', 'application/json; charset=utf-8').send({ error: { code, message, ...(details !== undefined ? { details } : {}), requestId: request.id } });
}

export function installErrors(app: FastifyInstance, { onUnexpected }: { onUnexpected?: (err: unknown, req: FastifyRequest) => void } = {}) {
  app.setErrorHandler((err: FastifyError & { statusCode?: number }, request, reply) => {
    if (err instanceof AppError) { if (err.headers) reply.headers(err.headers); return sendError(reply, request, err.status, err.code, err.message, err.details); }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const details = err.validation.map(v => ({ path: v.instancePath || (v.params as any)?.issue?.path?.join('.') || '', message: v.message }));
      return sendError(reply, request, 400, 'VALIDATION', `That request isn't right: ${details[0]?.path ? `${details[0].path}: ` : ''}${details[0]?.message ?? 'invalid'}`, details);
    }
    if (isResponseSerializationError(err)) {
      request.log.error({ err }, 'response did not match its schema');
      onUnexpected?.(err, request);
      return sendError(reply, request, 500, 'INTERNAL', 'Something went wrong on the server. Please try again.');
    }
    const s = err.statusCode ?? 500;
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || s === 413) return sendError(reply, request, 413, 'PAYLOAD_TOO_LARGE', 'That request is too big.');
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || s === 415) return sendError(reply, request, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON (Content-Type: application/json).');
    if (s === 429) return sendError(reply, request, 429, 'RATE_LIMITED', 'Too many requests: wait a moment and try again.');
    if (err.code === 'FST_CSRF_INVALID_TOKEN' || err.code === 'FST_CSRF_MISSING_SECRET') return sendError(reply, request, 403, 'CSRF', 'This request didn\'t come from the game: reload and try again.');
    if (s >= 400 && s < 500) return sendError(reply, request, s, s === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', s === 404 ? 'Not found.' : `That request isn't right${err.message ? `: ${err.message}` : ''}.`);
    // (every database connection busy for its whole wait: not a bug, a busy moment — 503 and when to retry, which the
    // game does by itself, rather than a failure; the load test's finding, docs/KNOWN_ISSUES.md)
    if (/timeout exceeded when trying to connect|too many clients|remaining connection slots/i.test(`${err.message} ${(err as any).cause?.message ?? ''}`)) {
      request.log.warn({ err: err.message }, 'database busy');
      reply.header('retry-after', '2');
      return sendError(reply, request, 503, 'BUSY', 'The server is very busy this moment: trying again…');
    }
    request.log.error({ err }, 'unexpected error');
    onUnexpected?.(err, request);
    return sendError(reply, request, 500, 'INTERNAL', 'Something went wrong on the server. Please try again.');
  });
  app.setNotFoundHandler((request, reply) => sendError(reply, request, 404, 'NOT_FOUND', 'There\'s nothing here.'));
}
