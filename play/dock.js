// The game's dock: a column of tiles down the left of the screen (the Ogni Strada look) — the way to the garage, racing
// online (the multiplayer menu, F7: its #mpButton is drawn here), free roam (its #roamHud — what you are to the others,
// who's near, the next meet — and its panel, F6), the free-roam chat (Enter; the messages you haven't seen counted),
// the account, and the editor for the accounts that have it. The brand mark at the top folds the dock away (kept in
// this browser). Out of the way in the garage, in a race and in photo mode.
//
//   const D = mountDock({ garage(), editor() })     D.editor(on)  the editor's tile shown (editor accounts)
// Free roam and the multiplayer menu put their own elements in the dock's slots (#krDockRace, #krDockRoam) when it's
// there; free roam hears the chat tile through 'kr:roam-open' ({ tab }) and says what's unread with 'kr:roam-unread'.

const CSS = `
#krDock { --dk-red: #E3121E; position: fixed; left: 14px; bottom: 84px; max-height: calc(100vh - 100px); overflow: visible; z-index: 57; display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  padding: 8px; background: linear-gradient(180deg, rgba(16, 16, 19, .9), rgba(9, 9, 11, .9)); border: 1px solid rgba(255, 255, 255, .09); border-radius: 14px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, .45); backdrop-filter: blur(8px); font: 600 12px/1.1 Barlow, system-ui, sans-serif; color: #F2F4F7; user-select: none; }
#krDock::before { content: ''; position: absolute; left: 12px; right: 12px; top: -1px; height: 3px; border-radius: 0 0 3px 3px; background: linear-gradient(90deg, #E3121E, #FF4A36); }
body.garage-mode #krDock, body.kr-in-race #krDock, body.roamPhoto #krDock { display: none !important; }
#krDock .dk-brand { width: 64px; height: 46px; display: grid; place-items: center; border: 0; background: none; cursor: pointer; padding: 0; border-radius: 10px; }
#krDock .dk-brand:hover { background: rgba(255, 255, 255, .05); }
#krDock .dk-brand svg { width: 38px; height: 38px; filter: drop-shadow(0 0 8px rgba(255, 30, 30, .45)); transition: transform .2s; }
#krDock.folded .dk-brand svg { transform: rotate(-90deg) scale(.9); }
#krDock.folded > :not(.dk-brand) { display: none !important; }
#krDock .dk-sep { height: 1px; margin: 2px 6px; background: rgba(255, 255, 255, .08); }
#krDock .dk-slot:empty { display: none; }
/* a tile: an icon, its name, its key */
#krDock .dk-item, #krDock #mpButton, #krDock #roamHud > button { position: relative; width: 64px; min-height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 7px 2px 6px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: #E9ECEF; font: 600 11px/1.1 Barlow, system-ui, sans-serif; letter-spacing: .02em;
  cursor: pointer; text-decoration: none; transition: background .15s, border-color .15s, color .15s; box-shadow: none; transform: none; left: auto; top: auto; z-index: auto; margin: 0; }
#krDock .dk-item:hover, #krDock #mpButton:hover, #krDock #roamHud > button:hover { background: rgba(255, 255, 255, .06); border-color: rgba(255, 255, 255, .1); }
#krDock .dk-item.on, #krDock #mpButton.on, #krDock #roamHud.on > button { background: linear-gradient(180deg, rgba(227, 18, 30, .28), rgba(227, 18, 30, .12)); border-color: rgba(255, 74, 54, .55); color: #fff; }
#krDock .dk-item.on::after, #krDock #mpButton.on::after, #krDock #roamHud.on > button::after { content: ''; position: absolute; left: -9px; top: 14px; bottom: 14px; width: 3px; border-radius: 0 3px 3px 0; background: #FF4A36; box-shadow: 0 0 8px #FF2A2A; }
#krDock .dk-ic { font-family: 'Material Symbols Outlined'; font-size: 26px; line-height: 1; font-weight: 400; font-style: normal; letter-spacing: 0; text-transform: none; -webkit-font-feature-settings: 'liga'; font-feature-settings: 'liga'; }
#krDock .dk-item:hover .dk-ic, #krDock #mpButton:hover .dk-ic, #krDock #roamHud > button:hover .dk-ic { color: #FF6A52; }
#krDock kbd { position: absolute; top: 4px; right: 4px; font: 700 8px/1 "JetBrains Mono", monospace; color: #8B929B; background: rgba(255, 255, 255, .06); border-radius: 3px; padding: 2px 3px; }
#krDock .dk-badge { position: absolute; top: 2px; left: 6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #E3121E; color: #fff; font: 700 11px/18px Barlow, system-ui, sans-serif; text-align: center; box-shadow: 0 0 10px rgba(255, 30, 30, .6); }
#krDock .dk-badge:empty, #krDock .dk-badge[data-n="0"] { display: none; }
/* the tile's name and key, out to the right, as you point at it */
#krDock [data-tip]:hover::before { content: attr(data-tip); position: absolute; left: calc(100% + 14px); top: 50%; transform: translateY(-50%); white-space: nowrap; pointer-events: none;
  padding: 7px 11px; border-radius: 8px; background: rgba(10, 10, 12, .96); border: 1px solid rgba(255, 255, 255, .12); color: #fff; font: 600 13px Barlow, system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0, 0, 0, .5); z-index: 2; }
/* free roam's status in its tile: what you are to the others, who's near, the next meet */
#krDock #roamHud { position: static; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 0; background: none; border: 0; box-shadow: none; font: inherit; }
#krDock #roamHud .tag { font: 700 8px/1 "JetBrains Mono", monospace; letter-spacing: .06em; padding: 3px 5px; border-radius: 4px; background: #2B2E34; color: #C3C8CF; max-width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#krDock #roamHud .tag.contact { background: #7a2a12; color: #FFD2C4; } #krDock #roamHud .tag.passive { background: #173d5e; color: #CDE7FF; } #krDock #roamHud .tag.ghosted { background: #5e1212; color: #FFC9C9; }
#krDock #roamHud .dk-near { position: absolute; top: 2px; left: 6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #2f7d43; color: #fff; font: 700 11px/18px Barlow, system-ui, sans-serif; text-align: center; }
#krDock #roamHud .dk-near[data-n="0"] { display: none; }
#krDock #roamHud .dk-meet { max-width: 64px; font-size: 9px; color: #FFB02E; text-align: center; line-height: 1.15; }
#krDock [hidden] { display: none !important; }
@media (max-width: 760px) {
  #krDock { left: 8px; top: auto; bottom: 200px; transform: none; padding: 5px; gap: 3px; }
  #krDock .dk-item, #krDock #mpButton, #krDock #roamHud > button { width: 50px; min-height: 48px; font-size: 9.5px; }
  #krDock .dk-ic { font-size: 22px; } #krDock .dk-brand { width: 50px; height: 38px; } #krDock kbd { display: none; }
}
`;

// the brand mark (the symbol of docs/brand: the S over a globe), small
const MARK = `<svg viewBox="-30 -20 300 280" aria-hidden="true"><defs><linearGradient id="dk-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".48" stop-color="#5c6168"/><stop offset=".5" stop-color="#16181b"/><stop offset=".85" stop-color="#f1f3f5"/></linearGradient>
  <linearGradient id="dk-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a52"/><stop offset=".45" stop-color="#e3121e"/><stop offset="1" stop-color="#8e0611"/></linearGradient></defs>
  <g transform="translate(120 120) skewX(-12) translate(-120 -120)" fill="none"><circle cx="120" cy="120" r="84" fill="#121418"/><circle cx="120" cy="120" r="86" stroke="url(#dk-chrome)" stroke-width="14"/>
  <path d="M222 54 C160 28 58 46 74 96 C84 126 166 114 168 150 C172 192 78 204 18 184" stroke="#070708" stroke-width="40"/>
  <path d="M222 54 C160 28 58 46 74 96 C84 126 166 114 168 150 C172 192 78 204 18 184" stroke="url(#dk-chrome)" stroke-width="32"/>
  <path d="M222 54 C160 28 58 46 74 96 C84 126 166 114 168 150 C172 192 78 204 18 184" stroke="url(#dk-red)" stroke-width="22"/></g></svg>`;

const FOLD = 'kr.dock.folded';
const read = () => { try { return localStorage.getItem(FOLD) === '1'; } catch { return false; } };
const keep = on => { try { localStorage.setItem(FOLD, on ? '1' : '0'); } catch { /* not kept */ } };

export function mountDock({ garage, editor } = {}) {
  let dock = document.getElementById('krDock');
  if (dock) return dock.api;
  if (!document.getElementById('krDockCss')) { const s = document.createElement('style'); s.id = 'krDockCss'; s.textContent = CSS; document.head.appendChild(s); }
  const next = encodeURIComponent(location.pathname + location.search);
  dock = document.createElement('nav');
  dock.id = 'krDock'; dock.setAttribute('aria-label', 'Game menu');
  dock.innerHTML = `<button class="dk-brand" data-k="fold" title="Fold the menu away">${MARK}</button>
    <div class="dk-sep"></div>
    <button class="dk-item" data-k="garage" data-tip="Garage: your cars, parts, shop and dealership"><span class="dk-ic">car_repair</span>Garage</button>
    <div class="dk-slot" id="krDockRace"></div>
    <div class="dk-slot" id="krDockRoam"></div>
    <button class="dk-item dk-chat" data-k="chat" data-tip="Chat with drivers near you (Enter)" hidden><span class="dk-ic">forum</span>Chat<kbd>↵</kbd><b class="dk-badge" data-n="0"></b></button>
    <div class="dk-sep"></div>
    <a class="dk-item" data-k="account" href="/account/?next=${next}" data-tip="Your account"><span class="dk-ic">account_circle</span>Account</a>
    <button class="dk-item" data-k="editor" data-tip="World editor (F2)" hidden><span class="dk-ic">edit_road</span>Editor<kbd>F2</kbd></button>`;
  document.body.appendChild(dock);
  dock.classList.toggle('folded', read());
  const badge = dock.querySelector('.dk-badge'), chat = dock.querySelector('.dk-chat'), roamSlot = dock.querySelector('#krDockRoam');
  let unread = 0;
  const setUnread = n => { unread = Math.max(0, n); badge.dataset.n = String(unread); badge.textContent = unread ? String(Math.min(unread, 99)) : ''; };
  dock.addEventListener('click', e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'fold') { const on = !dock.classList.contains('folded'); dock.classList.toggle('folded', on); keep(on); b.blur(); }
    else if (k === 'garage') { b.blur(); garage?.(); }
    else if (k === 'chat') { b.blur(); dispatchEvent(new CustomEvent('kr:roam-open', { detail: { tab: 'chat', toggle: true } })); }
    else if (k === 'editor') { b.blur(); editor?.(); }
  });
  // free roam: the chat tile while it's on (its status sits in the slot), what's unread, which tile is open
  const roamOn = () => { chat.hidden = !roamSlot.firstElementChild; if (chat.hidden) setUnread(0); };
  new MutationObserver(roamOn).observe(roamSlot, { childList: true });
  addEventListener('kr:roam-unread', e => setUnread(e.detail?.reset ? 0 : unread + (e.detail?.n ?? 1)));
  addEventListener('kr:roam-panel', e => {
    const open = !!e.detail?.open, tab = e.detail?.tab;
    chat.classList.toggle('on', open && tab === 'chat');
    roamSlot.firstElementChild?.classList.toggle('on', open && tab !== 'chat');
    if (open && tab === 'chat') setUnread(0);
  });
  // (made before the dock: moved into it)
  for (const [id, slot] of [['mpButton', 'krDockRace'], ['roamHud', 'krDockRoam']]) { const el = document.getElementById(id); if (el && !dock.contains(el)) dock.querySelector(`#${slot}`).appendChild(el); }
  roamOn();
  const api = { el: dock, editor(on) { dock.querySelector('[data-k="editor"]').hidden = !on; } };
  dock.api = api;
  return api;
}

// where free roam and the multiplayer menu put their elements: the dock's slot, or (no dock) the page
export const dockSlot = id => document.getElementById(id) ?? document.body;
