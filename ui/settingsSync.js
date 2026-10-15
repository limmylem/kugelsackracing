// Settings that follow the player between devices (Phase 8 Step 4; docs/ACCESSIBILITY.md): with an account (a guest's
// too), the settings are kept on the server as well as in this browser. On start, the newer copy wins (each change is
// stamped with when it was made); after a change, the account's copy is updated a moment later (changes in a burst are
// sent once). Offline, they're kept here and sent when the connection's back. The graphics stay on each device (their
// own benchmark chose them): testtrack/settings.js DEVICE_ONLY.
//
//   const sync = startSettingsSync({ A, settings, apply })   // apply(settings): after the account's newer copy came in
//   sync.status()  → 'local' | 'saving' | 'synced' | 'offline'

import { onSave, portable, saveSettings, mergeSettings } from '../testtrack/settings.js';

export function startSettingsSync({ A, settings, apply = () => {}, delayMs = 1500 }) {
  let state = 'local', timer = null, pending = false, who = null;
  const signedIn = () => !!A?.me && A.online;
  async function pull() {
    if (!signedIn()) { state = A?.me ? 'offline' : 'local'; return; }
    try {
      const r = await A.api.get('/player/settings');
      if (r.data && r.changedAt > (settings.updatedAt ?? 0)) {
        // the account's are newer: they're the settings now (this device's graphics kept)
        mergeSettings(settings, { ...r.data, graphics: undefined, updatedAt: r.changedAt });
        saveSettings(settings, { touched: false });
        apply(settings);
      } else if (!r.data || r.changedAt < (settings.updatedAt ?? 0)) await push();
      state = 'synced';
    } catch { state = 'offline'; }
  }
  async function push() {
    if (!signedIn()) { state = A?.me ? 'offline' : 'local'; pending = !!A?.me; return; }
    state = 'saving'; pending = false;
    try {
      const r = await A.api.put('/player/settings', { data: portable(settings), changedAt: settings.updatedAt || Date.now() });
      if (!r.saved && r.newer) { mergeSettings(settings, { ...r.newer.data, graphics: undefined, updatedAt: r.newer.changedAt }); saveSettings(settings, { touched: false }); apply(settings); }
      state = 'synced';
    } catch { state = 'offline'; pending = true; }
  }
  const off = onSave(() => { clearTimeout(timer); timer = setTimeout(push, delayMs); });
  // (someone signs in, or the connection's back: their copy, and anything waiting sent)
  const offA = A?.on?.(() => {
    const id = A.me?.id ?? null;
    if (id !== who) { who = id; pull(); }
    else if (pending && signedIn()) push();
  });
  who = A?.me?.id ?? null;
  pull();
  return { status: () => state, pull, push, stop() { off(); offA?.(); clearTimeout(timer); } };
}
