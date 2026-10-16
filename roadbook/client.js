// The ROADBOOK in the game (docs/ROADBOOK.md): what the server says — the season, the player's progress, Expeditions,
// Season Tokens, the shop, what they own and their Personal History — kept here for every screen that shows it. The
// server decides everything; this only asks and shows. With no server, or nobody signed in: no ROADBOOK (view null).
//
//   const R = roadbook()
//   R.view                 the last GET /roadbook (null: none)        R.on(fn) → off   (fn(view) on any change)
//   await R.refresh()      ask again
//   R.owns(kind, id)       an unlock the player has: kind 'finishes' | 'photoFilters' | 'badges'
//   R.lockedBy(kind, id)   the shop item that unlocks it ({ id, name, price, season }) or null — for a lock's label
//   await R.buy(itemId)    await R.startExpedition(id)    await R.ping(samples, carInstanceId)
//   R.dev.event(type, data) · R.dev.tokens(n) · R.dev.endSeason() · R.dev.nextTarget() · R.dev.arrive(lat, lon)
//   (development commands: anyone on a development server, admins on the live one)

import { account } from '../account/session.js';

let made = null;
export function roadbook() { return made ??= create(); }

function create() {
  let view = null, A = null, catalogue = null, asking = null;
  const listeners = new Set();
  const emit = () => { for (const f of listeners) try { f(view); } catch (e) { console.error(e); } };
  async function ready() {
    A ??= await account().catch(() => null);
    return !!(A?.server && A.me && !A.me.needsTerms);
  }
  async function refresh() {
    if (asking) return asking;
    asking = (async () => {
      try {
        if (!await ready()) { view = null; return null; }
        view = await A.api.get('/roadbook', { retries: 1 });
        return view;
      } catch (e) { console.warn(`The ROADBOOK couldn't be fetched: ${e.message}`); return view; }
      finally { asking = null; emit(); }
    })();
    return asking;
  }
  // (the shop's items in every season the player has seen — the current season's from the view; which item unlocks
  // what comes from the data files, read once)
  async function grantsCatalogue() {
    if (catalogue) return catalogue;
    try {
      const get = async f => (await fetch(new URL(`../${f}`, import.meta.url))).json();
      const index = await get('data/seasons/index.json'), out = [];
      for (const s of index.seasons ?? []) { const shop = await get(`data/seasons/${s}/shop.json`).catch(() => ({ items: [] })); for (const it of shop.items ?? []) out.push({ ...it, season: s }); }
      catalogue = out;
    } catch { catalogue = []; }
    return catalogue;
  }
  void grantsCatalogue();
  const post = async (path, body) => { if (!await ready()) throw new Error('Sign in to use the ROADBOOK.'); return A.api.post(path, body); };
  const R = {
    get view() { return view; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    refresh,
    owns(kind, id) { return !!view?.owned?.unlocks?.[kind]?.includes(id); },
    lockedBy(kind, id) { const it = (catalogue ?? []).find(x => x.grants?.[kind]?.includes(id)); return it ? { id: it.id, name: it.name, price: it.price, season: it.season } : null; },
    async buy(itemId) { const r = await post('/roadbook/shop/buy', { itemId }); await refresh(); return r; },
    async startExpedition(id) { const r = await post(`/roadbook/expeditions/${encodeURIComponent(id)}/start`, {}); await refresh(); return r; },
    // (a ping: the positions since the last one; its answer has what it found — refreshed when something was)
    async ping(samples, carInstanceId = null) {
      if (!await ready()) return null;
      const r = await A.api.post('/roadbook/ping', { samples, carInstanceId }, { retries: 0 });
      if (r.awards?.length || r.events?.length) await refresh();
      else if (view && r.expeditions) { view = { ...view, expeditions: r.expeditions }; emit(); }
      return r;
    },
    dev: {
      async event(type, data = {}) { const r = await post('/roadbook/dev/event', { type, data }); view = r.roadbook ?? view; emit(); return r; },
      async tokens(amount) { const r = await post('/roadbook/dev/tokens', { amount }); await refresh(); return r; },
      async endSeason() { const r = await post('/roadbook/dev/end-season', {}); await refresh(); return r; },
      async nextTarget() { if (!await ready()) return null; return (await A.api.get('/roadbook/dev/next-target')).target; },
      // (arriving as if driven there: a teleport alone never counts)
      async arrive(lat, lon) { const r = await post('/roadbook/dev/arrive', { lat, lon }); await refresh(); return r; },
    },
    grantsCatalogue,
  };
  return R;
}
