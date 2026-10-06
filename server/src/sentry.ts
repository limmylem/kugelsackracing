// Errors to Sentry (when SENTRY_DSN is set): only the unexpected ones (a 5xx, a response that broke its
// schema), with no personal data — no cookies, no headers that carry secrets, no request bodies, query values
// that are secrets redacted (the same rule as the logs: app.ts scrubUrl), the account only as its id.

import * as Sentry from '@sentry/node';
import type { Config } from './config.ts';
import { scrubUrl } from './app.ts';

export function initSentry(config: Config) {
  if (!config.sentryDsn) return null;
  Sentry.init({
    dsn: config.sentryDsn, environment: config.env, release: config.version ?? undefined,
    // (nothing personal collected at all; beforeSend clears anything that got through)
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false },
    tracesSampleRate: 0, defaultIntegrations: false,
    integrations: [Sentry.onUncaughtExceptionIntegration(), Sentry.onUnhandledRejectionIntegration(), Sentry.linkedErrorsIntegration(), Sentry.contextLinesIntegration()],
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies; delete event.request.data;
        if (event.request.headers) for (const k of Object.keys(event.request.headers)) if (/cookie|authorization|csrf|token|idempotency/i.test(k)) delete event.request.headers[k];
        if (event.request.url) event.request.url = scrubUrl(event.request.url);
        delete event.request.query_string;
      }
      if (event.user) event.user = { id: event.user.id };
      return event;
    },
  });
  return (err: unknown, req?: { id?: string; method?: string; url?: string }) => {
    Sentry.withScope(scope => {
      if (req) { scope.setTag('request_id', String(req.id ?? '')); scope.setContext('request', { method: req.method, url: scrubUrl(req.url ?? '') }); }
      Sentry.captureException(err);
    });
  };
}
export const flushSentry = () => Sentry.flush(2000).catch(() => false);
