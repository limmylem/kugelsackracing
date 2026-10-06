// The game's one way to its server (Phase 6 Step 1, docs/SERVER.md). Same origin, so the session is the
// server's httpOnly cookie, never seen here. Every write to /api/v1 carries:
//   - the CSRF token (GET /api/v1/csrf; fetched again once if the server says it's stale)
//   - an Idempotency-Key, the same one on every retry of that write: the server applies it once
// Errors come back in the server's one format as an ApiError { status, code, message, details, requestId };
// no connection is an ApiError with code OFFLINE. A dropped connection, or the server waking up (a free
// server sleeps when nobody's played for a while: its first answer can take most of a minute), is retried
// with growing waits. The connection's state is for the indicator: 'online' · 'waking' (a slow first
// answer) · 'retrying' · 'offline'; watch() keeps checking while offline and says when it's back.
//
//   const api = createApi();      api.on(state => …)      await api.get('/me')      await api.post('/me/terms', body)
//   await api.auth('/sign-in/email', { email, password })   (Better Auth's own endpoints, /api/auth)

export const API = '/api/v1', AUTH = '/api/auth';
const RETRY_STATUS = new Set([502, 503, 504]);

export class ApiError extends Error {
  constructor(status, code, message, details = null, requestId = null) {
    super(message);
    this.name = 'ApiError'; this.status = status; this.code = code; this.details = details; this.requestId = requestId;
  }
}
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

export function createApi({ base = '', fetchImpl = (...a) => globalThis.fetch(...a), retries = 4, slowMs = 4000, timeoutMs = 90_000 } = {}) {
  let csrf = null, state = 'online', watching = null;
  const listeners = new Set();
  const setState = s => { if (s !== state) { state = s; for (const f of listeners) try { f(s); } catch (e) { console.error(e); } } };

  async function once(method, url, { body, headers = {}, signal } = {}) {
    const ctl = new AbortController(), slow = setTimeout(() => setState('waking'), slowMs), dead = setTimeout(() => ctl.abort(), timeoutMs);
    signal?.addEventListener('abort', () => ctl.abort(), { once: true });
    try {
      const h = { accept: 'application/json', ...headers };
      if (body !== undefined) h['content-type'] = 'application/json';
      return await fetchImpl(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: ctl.signal });
    } finally { clearTimeout(slow); clearTimeout(dead); }
  }
  async function readError(res) {
    let j = null;
    try { j = await res.json(); } catch { /* not JSON */ }
    const e = j?.error;
    return new ApiError(res.status, e?.code ?? (res.status === 401 ? 'UNAUTHENTICATED' : res.status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'), e?.message ?? `The server said ${res.status}.`, e?.details ?? null, e?.requestId ?? res.headers.get('x-request-id'));
  }
  async function token(fresh = false) {
    if (!csrf || fresh) {
      const res = await once('GET', `${API}/csrf`);
      if (!res.ok) throw await readError(res);
      csrf = (await res.json()).token;
    }
    return csrf;
  }

  // a request: retried when the connection drops or the server's waking (a write keeps its key, so it's
  // applied once however many times it's sent)
  async function request(method, path, { body, key = null, signal, raw = false } = {}) {
    const write = !['GET', 'HEAD'].includes(method), url = path.startsWith('/api/') ? path : API + path;
    const headers = {};
    if (write && url.startsWith(API)) headers['idempotency-key'] = key ?? uuid();
    let csrfRetried = false;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        if (write && url.startsWith(API)) headers['x-csrf-token'] = await token();
        res = await once(method, url, { body, headers, signal });
      } catch (e) {
        if (signal?.aborted) throw e;
        if (e instanceof ApiError && !RETRY_STATUS.has(e.status)) throw e;
        if (attempt >= retries) { setState('offline'); watch(); throw new ApiError(0, 'OFFLINE', 'Can\'t reach the server: check your connection.'); }
        setState('retrying'); await wait(1000 * 2 ** attempt); continue;
      }
      if (RETRY_STATUS.has(res.status) && attempt < retries) { setState('retrying'); await wait(1000 * 2 ** attempt); continue; }
      // (the same write still being applied — sent again after a dropped connection: its answer shortly)
      if (res.status === 409 && write) {
        const err = await readError(res);
        if (err.code === 'IDEMPOTENCY_IN_PROGRESS' && attempt < retries) { await wait(500 * 2 ** attempt); continue; }
        setState('online'); throw err;
      }
      if (res.status === 429 && attempt < 1) { const s = Number(res.headers.get('retry-after')); if (s > 0 && s <= 10) { await wait(s * 1000); continue; } }
      setState('online');
      if (res.status === 403 && !csrfRetried && write) {
        const err = await readError(res);
        if (err.code !== 'CSRF') throw err;
        csrfRetried = true; await token(true); attempt--; continue;
      }
      if (!res.ok) throw await readError(res);
      if (raw) return res;
      if (res.status === 204) return null;
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  }

  // while offline: the health check now and then, until the server answers
  function watch(everyMs = 5000) {
    if (watching) return;
    watching = setInterval(async () => {
      try { const r = await once('GET', `${API}/health`); if (r.ok) { clearInterval(watching); watching = null; setState('online'); } } catch { /* still offline */ }
    }, everyMs);
  }

  return {
    request,
    get: (p, o) => request('GET', p, o),
    post: (p, body, o) => request('POST', p, { ...o, body: body ?? {} }),
    put: (p, body, o) => request('PUT', p, { ...o, body: body ?? {} }),
    patch: (p, body, o) => request('PATCH', p, { ...o, body: body ?? {} }),
    del: (p, body, o) => request('DELETE', p, { ...o, body }),
    // Better Auth's endpoints (sign in, sign up, sign out…): it checks the page's origin itself
    auth: (p, body) => request(body === undefined ? 'GET' : 'POST', AUTH + p, { body }),
    get state() { return state; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    watch,
    forgetCsrf() { csrf = null; },
  };
}
