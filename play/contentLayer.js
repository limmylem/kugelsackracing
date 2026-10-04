// Published world content in play (Phase 4 Step 1): quest starts, points of interest and spawn points
// near the player, in the world (editor/markers3d.js: the same markers the editor draws, fading with
// distance) and on the minimap and the full map (clustered when zoomed out). Only what's published, and
// quests switched on; asked of the world content service by area (its geohash cells), again as the player
// moves on and whenever something's published, so nothing far away is kept.
//
// Driving up to one (or clicking it, on the map or in the world) shows its card: what it is, what it
// asks of the car and what it pays. Starting a quest comes in Phase 4 Step 3.
//
//   const L = createContentLayer({ THREE, world, carNow })    world: the game's Map v3 world
//   L.frame(dt, carPos (sim frame), canvas)   L.show(on)   L.dispose()

import { worldContent } from '../content/client.js';
import { createMarkers3d } from '../editor/markers3d.js';
import { KINDS, TYPES, rewardsOf, entryCheck } from '../content/quests.js';
import { distanceKm } from '../content/geo.js';

const RADIUS_KM = 3, REQUERY_M = 250, CARD_M = 22, CARD_LEAVE_M = 60;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
#contentCard { position: fixed; left: 50%; bottom: 120px; transform: translateX(-50%); z-index: 44; width: min(420px, 92vw); color: #f2f4f7; background: rgba(14, 18, 26, .92); border: 1px solid rgba(255, 255, 255, .1); border-radius: 12px; padding: 12px 14px 10px; font: 13px/1.45 Barlow, system-ui, sans-serif; box-shadow: 0 8px 26px rgba(0, 0, 0, .45); display: none; }
#contentCard h4 { margin: 0 0 2px; font-size: 17px; }
#contentCard .kind { font: 700 10px "JetBrains Mono", monospace; letter-spacing: .08em; text-transform: uppercase; opacity: .75; }
#contentCard .money { font: 600 13px "JetBrains Mono", monospace; color: #9be38f; }
#contentCard ul { margin: 6px 0; padding-left: 0; list-style: none; }
#contentCard li { margin: 2px 0; }
#contentCard li.ok::before { content: '✔ '; color: #8fe08a; } #contentCard li.no::before { content: '✖ '; color: #ff8a7a; } #contentCard li.unknown::before { content: '• '; opacity: .6; }
#contentCard .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 11px; opacity: .7; }
#contentCard button { font: 600 12px Barlow, system-ui, sans-serif; color: #fff; background: rgba(255, 255, 255, .1); border: 1px solid rgba(255, 255, 255, .15); border-radius: 7px; padding: 4px 10px; cursor: pointer; }`;

export function createContentLayer({ THREE, world: w, carNow = () => null }) {
  const S = w.stream, P = S.projection;
  let C = null, items = [], byId = new Map(), queriedAt = null, querying = false, dirty = true, shown = true, card = null, cardFor = null, cardDismissed = null;
  const markers = createMarkers3d({ THREE, parent: S.world, place: it => { const [x, z] = P.toXZ(it.location.lat, it.location.lon); return [x, it.location.alt ?? 0, z]; }, far: 1800, labels: 8, labelDist: 300 });
  worldContent().then(c => { C = c; c.service.on(ev => { if (['publish', 'unpublish', 'archive', 'restore', 'state', 'import'].includes(ev.type)) dirty = true; }); }).catch(e => console.warn(`No world content: ${e.message}`));

  if (!document.getElementById('contentCardCss')) { const s = document.createElement('style'); s.id = 'contentCardCss'; s.textContent = CSS; document.head.appendChild(s); }
  card = document.createElement('div'); card.id = 'contentCard'; document.body.appendChild(card);
  card.addEventListener('click', e => { if (e.target.closest('[data-close]')) { cardDismissed = cardFor; hideCard(); } });

  async function query(lat, lon) {
    if (!C || querying) return;
    querying = true;
    try {
      const r = await C.service.query({ lat, lon, km: RADIUS_KM, view: 'published', offered: true, limit: 2000 });
      items = r.items.map(x => x.item); byId = new Map(items.map(it => [it.id, it]));
      markers.setItems(items);
      toMaps();
      queriedAt = { lat, lon }; dirty = false;
      if (cardFor && !byId.has(cardFor)) hideCard();
    } finally { querying = false; }
  }

  // (on the minimap and the full map: again whenever the maps are new — they load after the world)
  let mapsFed = null;
  function toMaps() {
    if (!w.maps) return;
    mapsFed = w.maps;
    w.maps.setContent(items.map(it => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [it.location.lon, it.location.lat] }, properties: { id: it.id, kind: it.kind, name: it.name, status: 'published' } })), id => showCard(byId.get(id), true));
  }

  function showCard(it, pinned = false) {
    if (!it) return;
    cardFor = it.id;
    const car = carNow(), r = C && it.kind === 'quest' ? rewardsOf(it, C.economy) : null, cur = C?.economy.currency ?? '$';
    const req = it.kind === 'quest' ? entryCheck(it, car) : [];
    card.innerHTML = `<div class="kind">${esc(it.kind === 'quest' ? `Quest · ${TYPES[it.type]?.label ?? it.type}` : KINDS[it.kind]?.label)}</div><h4>${esc(it.name)}</h4>
      ${it.description ? `<div>${esc(it.description)}</div>` : ''}
      ${it.kind === 'quest' ? `
        <ul>${req.length ? req.map(x => `<li class="${x.ok === true ? 'ok' : x.ok === false ? 'no' : 'unknown'}">${esc(x.text)}</li>`).join('') : '<li class="ok">Any car</li>'}</ul>
        <div class="money">${it.type === 'pink_slip' ? `Winner takes ${esc(C?.cars[it.params?.opponentCar]?.name ?? 'the rival\'s car')}` : `Reward ${esc(cur)}${(r?.money ?? 0).toLocaleString('en-GB')} · ${r?.xp ?? 0} xp`}${it.fee > 0 ? ` · entry ${esc(cur)}${it.fee.toLocaleString('en-GB')}` : ''}</div>
        ${it.conditions && (it.conditions.timeOfDay !== 'any' || it.conditions.weather !== 'any') ? `<div style="font-size:12px;opacity:.75">${esc([it.conditions.timeOfDay !== 'any' ? it.conditions.timeOfDay : null, it.conditions.weather !== 'any' ? it.conditions.weather : null].filter(Boolean).join(' · '))}</div>` : ''}` : ''}
      <div class="foot"><span>${it.kind === 'quest' ? 'Starting quests comes soon' : esc(it.road?.name ?? '')}</span><button data-close>Close</button></div>`;
    card.style.display = shown ? 'block' : 'none';
    card.dataset.pinned = pinned ? '1' : '';
  }
  function hideCard() { cardFor = null; card.style.display = 'none'; }

  // clicking a marker in the world shows its card
  const raycaster = new THREE.Raycaster();
  function click(e, camera, canvas) {
    if (!shown || e.target !== canvas) return;
    raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
    const id = markers.pick(raycaster);
    if (id) showCard(byId.get(id), true);
  }

  return {
    markers,
    get items() { return items; },
    frame(dt, pos, camera) {
      if (!shown) return;
      const [wx, wz] = S.toWorld(pos[0], pos[2]), [lat, lon] = P.toLatLon(wx, wz);
      if (dirty || !queriedAt || distanceKm(queriedAt, { lat, lon }) * 1000 > REQUERY_M) query(lat, lon);
      if (w.maps && w.maps !== mapsFed && queriedAt) toMaps();
      const cam = camera ? S.toWorld(camera.position.x, camera.position.z) : [wx, wz];
      markers.update({ x: cam[0], y: camera?.position.y ?? pos[1], z: cam[1] });
      // driving up to one: its card (until driven away from, or closed)
      let near = null, nd = Infinity;
      for (const it of items) { const [x, z] = P.toXZ(it.location.lat, it.location.lon), d = Math.hypot(x - wx, z - wz); if (d < nd) { nd = d; near = it; } }
      if (near && nd < CARD_M && cardFor !== near.id && cardDismissed !== near.id) showCard(near);
      if (cardFor && card.dataset.pinned !== '1') { const it = byId.get(cardFor), [x, z] = it ? P.toXZ(it.location.lat, it.location.lon) : [Infinity, Infinity]; if (Math.hypot(x - wx, z - wz) > CARD_LEAVE_M) hideCard(); }
      if (cardDismissed && (near?.id !== cardDismissed || nd > CARD_LEAVE_M)) cardDismissed = null;
    },
    click,
    show(on) { shown = on; markers.group.visible = on; if (!on) card.style.display = 'none'; else if (cardFor) card.style.display = 'block'; },
    dispose() { markers.dispose(); card.remove(); },
  };
}
