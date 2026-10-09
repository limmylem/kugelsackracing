// Errors to Sentry (when SENTRY_DSN is set): only the unexpected ones (a 5xx, a response that broke its
// schema), with no personal data — no cookies, no headers that carry secrets, no request bodies, query values
// that are secrets redacted (the same rule as the logs: app.ts scrubUrl), the account only as its id.
// (Phase 7 Step 5) the real-time server too (startSentry: it has no requests, and the same rules), and a crash in either
// process — exitOnCrash: one JSON line in the log, to Sentry, then out with 1, for Docker to start it again.
//
//   initSentry(config, scrubUrl) → report(err, req?) | null        (the API: app.ts scrubUrl)
//   startSentry({ dsn, env, release }) → report(err, context?) | null      (the real-time server: no app.ts in that process)
//   exitOnCrash(name, report)      flushSentry()

import * as Sentry from '@sentry/node';
import type { Config } from './config.ts';

export function startSentry({ dsn, env, release, scrubUrl = (u: string) => u.split('?')[0] }: { dsn: string | null | undefined; env: string; release?: string | null; scrubUrl?: (url: string) => string }) {
  if (!dsn) return null;
  Sentry.init({
    dsn, environment: env, release: release ?? undefined,
    // (nothing personal collected at all; beforeSend clears anything that got through)
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false },
    // (crashes are exitOnCrash's: logged, sent, then out — Sentry's own handlers would send them twice)
    tracesSampleRate: 0, defaultIntegrations: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.contextLinesIntegration()],
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies; delete event.request.data;
        if (event.request.headers) for (const k of Object.keys(event.request.headers)) if (/cookie|authorization|csrf|token|idempotency|internal/i.test(k)) delete event.request.headers[k];
        if (event.request.url) event.request.url = scrubUrl(event.request.url);
        delete event.request.query_string;
      }
      if (event.user) event.user = { id: event.user.id };
      return event;
    },
  });
  return (err: unknown, context?: Record<string, unknown>) => { Sentry.withScope(scope => { if (context) scope.setContext('context', context); Sentry.captureException(err); }); };
}

export function initSentry(config: Config, scrubUrl: (url: string) => string) {
  const report = startSentry({ dsn: config.sentryDsn, env: config.env, release: config.version, scrubUrl });
  if (!report) return null;
  return (err: unknown, req?: { id?: string; method?: string; url?: string }) => {
    Sentry.withScope(scope => {
      if (req) { scope.setTag('request_id', String(req.id ?? '')); scope.setContext('request', { method: req.method, url: scrubUrl(req.url ?? '') }); }
      Sentry.captureException(err);
    });
  };
}
export const flushSentry = () => Sentry.flush(2000).catch(() => false);

// an exception nothing caught, or a promise rejected that nobody handled: the process can't be trusted any more — said
// once, sent on, and out (exit 1: Docker's restart policy starts it again)
export function exitOnCrash(name: string, report: ((err: unknown) => void) | null) {
  let crashed = false;
  const crash = (kind: string) => (err: unknown) => {
    if (crashed) return;
    crashed = true;
    const e = err as any;
    try { console.error(JSON.stringify({ time: new Date().toISOString(), level: 'fatal', msg: `${name} crashed`, kind, err: { message: String(e?.message ?? e), name: e?.name ?? null, stack: typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 12).join('\n') : null } })); } catch { /* the log itself */ }
    try { report?.(err); } catch { /* Sentry */ }
    setTimeout(() => process.exit(1), 3000).unref();
    void flushSentry().finally(() => process.exit(1));
  };
  process.on('uncaughtException', crash('uncaughtException'));
  process.on('unhandledRejection', crash('unhandledRejection'));
}
