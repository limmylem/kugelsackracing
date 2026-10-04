// Who may open the world editor: a development build (the game served from this computer — npm start —
// or opened with ?dev in the address), or an account with the editor flag. Accounts are local for now, so
// the flag is a setting in this browser (localStorage 'kugelsack.editor' = 'on'; 'off' turns it off even
// in a development build). When there's a server, it decides (and checks every write) instead.

import { localStorageGet, localStorageSet } from '../content/client.js';

const FLAG = 'kugelsack.editor';

export function editorAccess(loc = globalThis.location) {
  const flag = localStorageGet(FLAG);
  if (flag === 'off') return { allowed: false, why: 'The editor is switched off in this browser (localStorage kugelsack.editor = off).' };
  if (flag === 'on') return { allowed: true, how: 'editor flag' };
  const host = loc?.hostname ?? '', dev = ['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(host) || loc?.protocol === 'file:' || new URLSearchParams(loc?.search ?? '').has('dev');
  return dev ? { allowed: true, how: 'development build' } : { allowed: false, why: 'The world editor is for development builds and editor accounts.' };
}
export const setEditorFlag = on => localStorageSet(FLAG, on == null ? null : on ? 'on' : 'off');
