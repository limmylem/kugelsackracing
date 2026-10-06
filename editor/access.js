// Who may open the world editor (Phase 6 Step 1): an editor or admin account — the role is the server's,
// and the server checks it again on every editor request (server/src/routes/content.ts), so this only
// decides whether the editor opens. A page served without a server (the local-only game) opens it on a
// development build (this computer, or a file), where the content stays in this browser.
// (The old localStorage editor flag is gone: a browser setting can't make anyone an editor.)
//
//   editorAccess(A, loc) → { allowed, how | why }      A: account/session.js's account (or null)
//   await editorAccessNow() → the same, for this page's account

import { account } from '../account/session.js';

export function editorAccess(A, loc = globalThis.location) {
  if (A?.server) {
    const me = A.me;
    if (!me) return { allowed: false, why: 'Sign in with an editor account to open the world editor.' };
    if (me.isGuest || !['editor', 'admin'].includes(me.role)) return { allowed: false, why: 'The world editor is for editor accounts: an admin can make yours one.' };
    if (me.needsTerms) return { allowed: false, why: 'Accept the terms first (the account page).' };
    // (Phase 6 Step 5: the server refuses an editor's requests without two-factor sign-in — said here first)
    if (me.twoFactor?.required && !me.twoFactor.enabled) return { allowed: false, why: 'Editor accounts need two-factor sign-in: turn it on from your account page.', fix: '/account/?mode=mfa' };
    if (!A.online) return { allowed: false, why: 'The world editor needs the game\'s server: you\'re offline.' };
    return { allowed: true, how: `${me.role} account` };
  }
  const host = loc?.hostname ?? '', dev = ['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(host) || loc?.protocol === 'file:';
  return dev ? { allowed: true, how: 'development build (no server: content kept in this browser)' } : { allowed: false, why: 'The world editor is for editor accounts.' };
}
export async function editorAccessNow() { return editorAccess(await account().catch(() => null)); }
