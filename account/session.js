// Who's playing (Phase 6 Step 1): the page's one account — signed in, a guest, or nobody — and whether the
// game's server can be reached. The session itself is the server's (an httpOnly cookie this page never
// sees); this only asks the server who it is and keeps the answer.
//
//   const A = await account()
//     A.me          { id, displayName, role, isGuest, needsTerms, … } or null (signed out)
//     A.online      the server answers now (offline: free roam only — no quests, events or rewards)
//     A.server      there's a server at all (a page served without one: the old local-only game)
//     A.state       'online' · 'waking' · 'retrying' · 'offline'      A.on(fn) → off   (fn(A) on any change)
//     A.profileKey  where this account's save is kept in this browser ('profile:<id>')
//     A.canEdit     an editor or admin account (the editor opens; the server checks every call anyway)
//     A.refresh()   ask again    A.signOut()    A.api: account/api.js, for everything else
//
// The last account seen here is remembered (only its id, name and whether it was a guest — never anything
// secret): offline, its save is the one free roam drives; a guest who signed up keeps their save.

import { createApi, ApiError } from './api.js';

const LAST = 'kr.account.last';
const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST) || 'null'); } catch { return null; } };
const writeLast = v => { try { if (v) localStorage.setItem(LAST, JSON.stringify(v)); else localStorage.removeItem(LAST); } catch { /* not kept */ } };

let made = null;
export function account(opts) { return made ??= start(opts); }

async function start({ api = createApi(), heartbeatMs = 60_000 } = {}) {
  // (not a browser page — the Node tests: no server, the game as it was)
  if (typeof location === 'undefined' || typeof document === 'undefined') return { api, me: null, config: null, server: false, previous: null, state: 'offline', online: false, questsAllowed: true, canEdit: false, profileKey: 'profile', upgradedFrom: null, on: () => () => {}, refresh: async () => null, signOut: async () => {} };
  const listeners = new Set();
  const A = {
    api, me: null, config: null, server: false, previous: readLast(),
    get state() { return A.server ? api.state : 'offline'; },
    get online() { return A.server && api.state !== 'offline'; },
    get profileKey() { const id = A.me?.id ?? A.previous?.id; return id ? `profile:${id}` : 'profile:nobody'; },
    // quests, events and their rewards: with the server (offline: free roam only); a page with no server
    // at all is the old local game, where they're its own
    get questsAllowed() { return !A.server || A.online; },
    get canEdit() { return !!A.me && !A.me.isGuest && ['editor', 'admin'].includes(A.me.role); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async refresh() {
      try {
        A.me = (await api.get('/me', { retries: 1 })).user;
        const was = readLast();
        writeLast({ id: A.me.id, name: A.me.displayName, isGuest: A.me.isGuest, ...(was?.isGuest && was.id !== A.me.id && !A.me.isGuest ? { from: was.id } : was?.from && was.id === A.me.id ? { from: was.from } : {}) });
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'UNAUTHENTICATED' || e.code === 'BANNED')) { A.me = null; A.banned = e.code === 'BANNED'; }
        else if (!(e instanceof ApiError) || e.code !== 'OFFLINE') throw e;
      }
      emit();
      return A.me;
    },
    async signOut() { try { await api.auth('/sign-out', {}); } finally { api.forgetCsrf(); A.me = null; emit(); } },
    // (a guest who signed up in this browser: the guest's id, whose save becomes theirs)
    get upgradedFrom() { const l = readLast(); return l && A.me && l.id === A.me.id && l.from ? l.from : null; },
  };
  const emit = () => { for (const f of listeners) try { f(A); } catch (e) { console.error(e); } };
  api.on(() => emit());

  // is there a server? (a page served on its own, by a plain file server, has none: the game as it was)
  // (the page came from the server a moment ago: no answer now is the server waking or the connection
  // gone — offline; only a "not found" means a page served without one)
  try { A.config = await api.get('/client-config', { retries: 1 }); A.server = true; }
  catch (e) { A.server = e instanceof ApiError && e.status !== 404; }
  if (A.config) import('./sentry.js').then(m => m.initSentry(A.config)).catch(() => {});
  if (A.server && A.config) await A.refresh().catch(e => console.warn(`Couldn't ask the server who's playing: ${e.message}`));
  // (still there? now and then while the page is open — and back when the connection is)
  if (A.server && heartbeatMs && typeof document !== 'undefined') {
    setInterval(() => { if (document.visibilityState === 'visible') api.get('/health', { retries: 0 }).catch(() => {}); }, heartbeatMs);
    addEventListener('online', () => { api.get('/health', { retries: 1 }).then(() => A.refresh()).catch(() => {}); });
    addEventListener('offline', () => api.watch());
    api.on(s => { if (s === 'online' && !A.me) (A.config ? Promise.resolve() : api.get('/client-config').then(c => { A.config = c; })).then(() => A.refresh()).catch(() => {}); });
  }
  return A;
}
