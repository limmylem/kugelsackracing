// The game's last few errors, for a feedback message (Phase 7 Step 5; the owner agreed this list: docs/PRIVACY_DATA.md
// "Support and feedback"): the last 20 — uncaught errors, promises nobody caught, and the game's own errors logged with
// console.error (only those that carry an Error: the plain warnings stay out) — each its time, message, where in the
// game's code (file:line:column) and a short stack; a repeat folds into the one before with a count. Web addresses lose
// their query and fragment (no tokens or invite codes), email addresses are blanked, and nothing else of the page is
// read. Kept in this page only: sent with a feedback message if the player leaves the box ticked.
//
//   watchErrors()      start listening (once; account/status.js does it as the chip mounts)
//   recentErrors()     [{ at, kind: 'error' | 'rejection' | 'console', message, source?, stack?, count }] oldest first
//   noteError(e, kind) one by hand (the tests)

const MAX = 20, MESSAGE = 300, SOURCE = 300, STACK = 1500;
const list = [];
let watching = false;

// (an address with a scheme, or a path on this site, loses ?… and #… — but keeps a stack's :line:column)
const keepLine = q => q.match(/(:\d+){1,2}$/)?.[0] ?? '';
export const scrub = (s, max) => String(s ?? '')
  .replace(/\b((?:https?|wss?|blob|file):\/\/[^\s?#()'"<>]*)([?#][^\s()'"<>]*)/gi, (_, u, q) => u + keepLine(q))
  .replace(/(^|[\s('"])(\/[\w.~%/-]*)([?#][^\s()'"<>]+)/g, (_, b, u, q) => b + u + keepLine(q))
  .replace(/\b(token|code|invite|key|secret|password|ticket|sig|session)=[^\s&'"]+/gi, '$1=…')
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '(email)')
  .slice(0, max);

export function noteError(err, kind = 'error', where = null) {
  const e = err instanceof Error ? err : null;
  const message = scrub(e ? `${e.name && e.name !== 'Error' ? `${e.name}: ` : ''}${e.message}` : typeof err === 'string' ? err : (() => { try { return JSON.stringify(err); } catch { return String(err); } })(), MESSAGE);
  if (!message) return;
  // (where: as the browser says for an uncaught one, or the first line of the stack that names a file)
  const stack = e?.stack ? scrub(e.stack, STACK) : '';
  const fromStack = stack.match(/\(?((?:https?|blob|file):\/\/[^\s()]+:\d+:\d+)\)?/)?.[1];
  const source = scrub(where ?? fromStack ?? '', SOURCE);
  const last = list.find(x => x.kind === kind && x.message === message && x.source === (source || undefined));
  const at = new Date().toISOString();
  if (last) { last.count++; last.at = at; list.splice(list.indexOf(last), 1); list.push(last); return; }
  list.push({ at, kind, message, ...(source ? { source } : {}), ...(stack ? { stack } : {}), count: 1 });
  if (list.length > MAX) list.shift();
}

export function watchErrors() {
  if (watching || typeof addEventListener !== 'function') return;
  watching = true;
  addEventListener('error', ev => {
    // (a picture or script that failed to load comes here too, with no message: not the game's error)
    if (!ev.message && !ev.error) return;
    noteError(ev.error ?? ev.message, 'error', ev.filename ? `${ev.filename}:${ev.lineno ?? 0}:${ev.colno ?? 0}` : null);
  });
  addEventListener('unhandledrejection', ev => noteError(ev.reason ?? 'A promise failed with no reason.', 'rejection'));
  const orig = console.error;
  console.error = function (...args) {
    try { const e = args.find(a => a instanceof Error); if (e) noteError(e, 'console'); } catch { /* never in the way */ }
    return orig.apply(this, args);
  };
}

export const recentErrors = () => list.map(x => ({ ...x }));
