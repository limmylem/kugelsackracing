// The editor's (and admin's) code, imported from the API's address with the session (site/urls.js importTool): this
// file is loaded as <script type="module" crossorigin="use-credentials" src="/site/tool.js?u=…&k=…">, so its import()
// sends the cookie too — a file of the game's own, not an inline script, which the content security policy refuses.
const q = new URL(import.meta.url).searchParams, done = globalThis[q.get('k')];
import(q.get('u')).then(m => done?.resolve(m), e => done?.reject(e)).finally(() => { delete globalThis[q.get('k')]; });
