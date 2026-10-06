// The game's errors to Sentry (Phase 6 Step 1), when the server's client config names a DSN: the browser
// SDK from jsDelivr (the page's CSP allows it), nothing personal — no user, no cookies, no request bodies,
// no query strings, no breadcrumbs of what was typed. If it can't load, the game goes on without it.
//
//   initSentry(config)   (config: GET /api/v1/client-config)

const VERSION = '11.4.0';
let started = false;

export async function initSentry(config) {
  if (started || !config?.sentryDsn) return false;
  started = true;
  try {
    const Sentry = await import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/@sentry/browser@${VERSION}/+esm`);
    Sentry.init({
      dsn: config.sentryDsn, environment: config.env, tracesSampleRate: 0, sendDefaultPii: false, maxBreadcrumbs: 20,
      beforeBreadcrumb: b => (b.category === 'ui.input' ? null : b),
      beforeSend(event) {
        delete event.user;
        if (event.request) { delete event.request.cookies; delete event.request.data; delete event.request.query_string; if (event.request.url) event.request.url = event.request.url.split('?')[0]; if (event.request.headers) event.request.headers = {}; }
        return event;
      },
    });
    return true;
  } catch (e) { console.warn(`Error reporting is off: ${e.message}`); return false; }
}
