// The ROADBOOK's screen (docs/ROADBOOK.md): a driver's journal — the season's chapters and their challenges (how far each
// has got), the Expeditions (their stages, the one under way, starting one), the Season Shop (prices up front; buying;
// every token earned and spent) and the Personal History (what never resets). Everything is the server's: this shows it
// and asks (roadbook/client.js).
//
//   openRoadbook({ tab })      closeRoadbook()       (also: the dock's ROADBOOK tile, kr.roadbook.show())

import { roadbook } from '../roadbook/client.js';
import { fmtTime } from '../quest/timing.js';

const CSS = `
/* (the page's own styles for sections, buttons, chips… don't reach in: everything here is set below) */
#rbBook, #rbBook * { all: revert; box-sizing: border-box; }
#rbBook { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; background: rgba(6, 4, 10, .66); backdrop-filter: blur(3px); font: 500 14px/1.45 Barlow, system-ui, sans-serif; }
#rbBook .cover { position: relative; width: min(1040px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); display: grid; grid-template-columns: 170px 1fr; border-radius: 16px;
  background: linear-gradient(135deg, #2a1d14, #1a120c); padding: 14px; box-shadow: 0 30px 80px rgba(0, 0, 0, .6), inset 0 0 0 2px rgba(255, 220, 170, .08); }
#rbBook .tabs { display: flex; flex-direction: column; gap: 8px; padding: 18px 10px 18px 4px; }
#rbBook .tabs button { position: relative; text-align: left; padding: 10px 12px; border: 0; border-radius: 8px 0 0 8px; background: #3a2a1d; color: #e9dcc6; font: 700 15px Barlow, system-ui, sans-serif; cursor: pointer; display: flex; gap: 8px; align-items: center; }
#rbBook .tabs button .ic, #rbBook .ic { font-family: 'Material Symbols Outlined'; font-weight: 400; font-size: 20px; line-height: 1; }
#rbBook .tabs button.on { background: #f3ead6; color: #2a1d14; margin-right: -14px; box-shadow: -4px 3px 10px rgba(0, 0, 0, .3); }
#rbBook .tabs .season { margin-top: auto; color: #c9b8a0; font-size: 12px; line-height: 1.4; }
#rbBook .tabs .season b { display: block; font: 700 22px/1.1 Caveat, 'Segoe Print', cursive; color: #f3ead6; }
#rbBook .page { position: relative; overflow: auto; border-radius: 4px 12px 12px 4px; padding: 26px 34px 30px 44px; color: #2d241b;
  background: repeating-linear-gradient(180deg, transparent 0 27px, rgba(80, 110, 160, .14) 27px 28px), linear-gradient(90deg, rgba(200, 60, 60, .22) 0 2px, transparent 2px) 28px 0 / 100% 100% no-repeat, #f3ead6; }
#rbBook .close { position: absolute; top: 10px; right: 14px; z-index: 2; border: 0; background: none; font-family: 'Material Symbols Outlined'; font-size: 26px; color: #7a6650; cursor: pointer; }
#rbBook h1, #rbBook h2, #rbBook h3 { font-family: Caveat, 'Segoe Print', cursive; font-weight: 700; color: #2a1d14; margin: 0; }
#rbBook h1 { font-size: 40px; line-height: 1; } #rbBook h2 { font-size: 30px; margin-top: 18px; } #rbBook h3 { font-size: 24px; }
#rbBook .sub { color: #6d5a45; margin: 2px 0 12px; }
#rbBook .meters { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0 6px; }
#rbBook .meter { padding: 6px 12px; border-radius: 8px; background: rgba(42, 29, 20, .07); border: 1px dashed rgba(42, 29, 20, .25); }
#rbBook .meter b { font-size: 20px; color: #2a1d14; }
#rbBook .warn { margin: 8px 0; padding: 8px 12px; border-radius: 8px; background: #ffe2b8; border: 1px solid #e0a050; color: #5a3608; }
#rbBook .note { color: #6d5a45; font-style: italic; }
#rbBook .chapter { margin: 16px 0 6px; padding: 10px 14px; border-radius: 10px; background: rgba(255, 255, 255, .45); border: 1px solid rgba(42, 29, 20, .15); }
#rbBook .chapter.locked { opacity: .72; }
#rbBook .chapter header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
#rbBook .chapter header .tag { margin-left: auto; font-size: 12px; padding: 2px 8px; border-radius: 10px; background: #2a1d14; color: #f3ead6; }
#rbBook .chapter header .tag.open { background: #4f7a3a; } #rbBook .chapter header .tag.done { background: #8a5cff; }
#rbBook .ch { display: grid; grid-template-columns: 26px 1fr auto; gap: 4px 10px; align-items: center; padding: 8px 0; border-top: 1px dashed rgba(42, 29, 20, .18); }
#rbBook .ch:first-of-type { border-top: 0; }
#rbBook .ch .ic { color: #8a5cff; } #rbBook .ch.done .ic { color: #4f7a3a; }
#rbBook .ch .name { font-weight: 700; } #rbBook .ch.done .name { text-decoration: line-through; text-decoration-color: rgba(79, 122, 58, .7); }
#rbBook .ch .what { grid-column: 2; color: #5d4c3a; font-size: 13px; }
#rbBook .ch .gain { grid-row: 1 / span 2; grid-column: 3; text-align: right; font-size: 12px; color: #5d4c3a; }
#rbBook .bar { grid-column: 2; height: 6px; border-radius: 3px; background: rgba(42, 29, 20, .12); overflow: hidden; }
#rbBook .bar i { display: block; height: 100%; background: linear-gradient(90deg, #8a5cff, #c06cff); }
#rbBook .exp { margin: 12px 0; padding: 12px 14px; border-radius: 10px; background: rgba(255, 255, 255, .5); border: 1px solid rgba(42, 29, 20, .15); }
#rbBook .stages { list-style: none; padding: 0; margin: 8px 0; display: grid; gap: 4px; }
#rbBook .stages li { display: flex; gap: 8px; align-items: center; }
#rbBook .stages li.done { color: #4f7a3a; } #rbBook .stages li.current { font-weight: 700; color: #2a1d14; } #rbBook .stages li.todo { color: #8d7a65; }
#rbBook .card { margin-top: 8px; padding: 10px 12px; border-left: 4px solid #8a5cff; background: rgba(138, 92, 255, .08); border-radius: 0 8px 8px 0; }
#rbBook .clue { font: 600 20px/1.25 Caveat, 'Segoe Print', cursive; color: #3b2a6b; }
#rbBook .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; border: 0; background: #2a1d14; color: #f3ead6; font: 700 14px Barlow, system-ui, sans-serif; cursor: pointer; }
#rbBook .btn.violet { background: #6b3fe0; } #rbBook .btn:disabled { opacity: .45; cursor: default; }
#rbBook .shop { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 10px; }
#rbBook .item { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 10px; background: rgba(255, 255, 255, .6); border: 1px solid rgba(42, 29, 20, .15); }
#rbBook .item .ic { font-size: 30px; color: #6b3fe0; } #rbBook .item .price { font-weight: 800; font-size: 18px; } #rbBook .item p { margin: 0; color: #5d4c3a; font-size: 13px; flex: 1; }
#rbBook .item.owned { border-color: #4f7a3a; } #rbBook .item.owned .price { color: #4f7a3a; }
#rbBook table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
#rbBook td { padding: 4px 6px; border-top: 1px dashed rgba(42, 29, 20, .18); } #rbBook td.n { text-align: right; font-weight: 700; white-space: nowrap; }
#rbBook td.plus { color: #4f7a3a; } #rbBook td.minus { color: #a0402a; }
#rbBook .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 10px; }
#rbBook .stat { padding: 10px 12px; border-radius: 10px; background: rgba(255, 255, 255, .55); border: 1px solid rgba(42, 29, 20, .15); }
#rbBook .stat b { display: block; font: 700 28px/1.1 Caveat, 'Segoe Print', cursive; color: #2a1d14; } #rbBook .stat span { color: #6d5a45; font-size: 12px; }
#rbBook .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; } #rbBook .chip { padding: 3px 9px; border-radius: 12px; background: rgba(42, 29, 20, .08); font-size: 12px; }
#rbBook .err { color: #a0402a; font-weight: 600; }
@media (max-width: 720px) { #rbBook .cover { grid-template-columns: 1fr; grid-template-rows: auto 1fr; padding: 8px; } #rbBook .tabs { flex-direction: row; overflow-x: auto; padding: 4px; } #rbBook .tabs button { border-radius: 8px 8px 0 0; } #rbBook .tabs button.on { margin: 0 0 -8px; } #rbBook .tabs .season { display: none; } #rbBook .page { padding: 18px 16px 20px 22px; } }
`;
const TABS = [['chapters', 'menu_book', 'Chapters'], ['expeditions', 'explore', 'Expeditions'], ['shop', 'storefront', 'Season Shop'], ['history', 'history_edu', 'My history']];
const STYLE_ICON = { racing: 'sports_score', building: 'build', exploring: 'explore' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n = x => Number(x ?? 0).toLocaleString('en-AU');
const dateOf = iso => iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const daysLeft = iso => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
const timeOf = ms => ms == null ? '' : `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(2).padStart(5, '0')}`;
const pretty = id => String(id ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

let el = null, tab = 'chapters', off = null, error = '';
const carNames = new Map();

export function openRoadbook(opts = {}) {
  if (opts.tab) tab = opts.tab;
  if (!document.getElementById('rbBookCss')) {
    const s = document.createElement('style'); s.id = 'rbBookCss'; s.textContent = CSS; document.head.append(s);
    if (!document.querySelector('link[href*="family=Caveat"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&display=swap'; document.head.append(l); }
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'rbBook'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'ROADBOOK');
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeRoadbook(); } });
    document.body.append(el);
    off = roadbook().on(() => draw());
    void roadbook().refresh();
  }
  draw();
  el.querySelector('.close')?.focus();
}
export function closeRoadbook() { off?.(); off = null; el?.remove(); el = null; error = ''; }
export const roadbookOpen = () => !!el;

async function onClick(e) {
  if (e.target === el) return closeRoadbook();
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const [act, arg] = b.dataset.act.split(':');
  const R = roadbook();
  error = '';
  try {
    if (act === 'close') return closeRoadbook();
    if (act === 'tab') { tab = arg; return draw(); }
    if (act === 'start') { b.disabled = true; await R.startExpedition(arg); }
    if (act === 'buy') {
      const it = R.view?.shop?.find(x => x.id === arg);
      if (!it || !confirm(`Buy the ${it.name} for ${n(it.price)} Season Tokens?\n\nIt's yours for good. Tokens can't be given back.`)) return;
      b.disabled = true; await R.buy(arg);
    }
  } catch (err) { error = err?.message ?? String(err); }
  draw();
}

function draw() {
  if (!el) return;
  const v = roadbook().view, S = v?.season;
  const side = `<nav class="tabs">${TABS.map(([k, ic, name]) => `<button data-act="tab:${k}" class="${tab === k ? 'on' : ''}"><span class="ic" aria-hidden="true">${ic}</span>${name}</button>`).join('')}
    <div class="season">${S ? `<b>${esc(S.name)}</b>${esc(S.tagline ?? '')}` : ''}</div></nav>`;
  let body;
  if (!v) body = `<h1>ROADBOOK</h1><p class="sub">Your driver's journal: the season's challenges and Expeditions, the Season Shop and everything you've done.</p><p class="note">Sign in (the account tile) to keep a ROADBOOK. It lives on the game's server.</p>`;
  else if (tab === 'history') body = history(v);
  else if (!S) body = `<h1>ROADBOOK</h1><p class="sub">No season is on right now. Your history is kept: see <a href="#" data-act="tab:history">My history</a>.</p>`;
  else body = tab === 'expeditions' ? expeditions(v) : tab === 'shop' ? shop(v) : chapters(v);
  el.innerHTML = `<div class="cover">${side}<article class="page"><button class="close" data-act="close" aria-label="Close">close</button>${error ? `<p class="err">${esc(error)}</p>` : ''}${body}</article></div>`;
}

// the season's head: its name, dates, points and tokens; the warning before it ends
function head(v, title) {
  const S = v.season;
  const status = S.status === 'testing' ? '<span class="chip">Testing: only admins and editors see it until the open beta</span>' : S.status === 'ended' ? `<span class="chip">Ended ${dateOf(S.endsAt)}</span>` : S.endsAt ? `<span class="chip">${daysLeft(S.endsAt)} days left · ends ${dateOf(S.endsAt)}</span>` : '';
  const warn = S.warning ? `<div class="warn"><b>The season ends in ${daysLeft(S.endsAt)} day${daysLeft(S.endsAt) === 1 ? '' : 's'}.</b> Season Tokens don't carry over: any you haven't spent become cash at <b>$${n(S.conversion.cashPerToken)} each</b> (you'd get $${n(v.tokens * S.conversion.cashPerToken)} for your ${n(v.tokens)}).</div>` : '';
  return `<h1>${esc(title)}</h1><p class="sub">${esc(S.name)} — ${esc(S.tagline ?? '')} ${status}</p>
    <div class="meters"><span class="meter"><b>${n(v.points)}</b> ROADBOOK points</span><span class="meter"><b>${n(v.tokens)}</b> Season Tokens</span></div>${warn}`;
}

function chapters(v) {
  const out = [head(v, 'Chapters'), '<p class="note">Points open the next chapter: you don\'t need every challenge. Every challenge stays open all season, and anything you do before a chapter opens still counts.</p>'];
  for (const c of v.chapters) {
    const mine = v.challenges.filter(x => x.chapter === c.id), done = mine.filter(x => x.done).length;
    const tag = c.milestone ? '<span class="tag done">Finished</span>' : c.open ? '<span class="tag open">Open</span>' : `<span class="tag">Opens at ${n(c.unlockAt)} points (${n(Math.max(0, c.unlockAt - v.points))} to go)</span>`;
    out.push(`<div class="chapter ${c.open ? '' : 'locked'}"><header><h3>${esc(c.name)}</h3><span class="note">${done} of ${mine.length} done${c.milestoneTokens ? ` · finish them all: +${n(c.milestoneTokens)} tokens` : ''}</span>${tag}</header>
      <p class="sub">${esc(c.blurb ?? '')}</p>
      ${mine.map(ch => `<div class="ch ${ch.done ? 'done' : ''}"><span class="ic" aria-hidden="true">${ch.done ? 'task_alt' : STYLE_ICON[ch.style] ?? 'flag'}</span><span class="name">${esc(ch.name)}</span>
        <span class="gain">${n(ch.points)} pts${ch.tokens ? `<br>+${n(ch.tokens)} tokens` : ''}</span>
        <span class="what">${esc(ch.description)} ${ch.need > 1 ? `<b>${ch.need >= 1000 ? `${(ch.have / 1000).toFixed(1)} of ${n(ch.need / 1000)} km` : `${n(ch.have)} of ${n(ch.need)}`}</b>` : ''}</span>
        ${ch.need > 1 && !ch.done ? `<span class="bar"><i style="width:${Math.round(100 * ch.have / ch.need)}%"></i></span>` : ''}</div>`).join('')}
    </div>`);
  }
  return out.join('');
}

function expeditions(v) {
  const out = [head(v, 'Expeditions'), '<p class="note">Adventures out in the open world: drive to each place for real. Your progress is saved after every stage, so you can do one today and the next tomorrow.</p>'];
  for (const x of v.expeditions) {
    const stages = x.stages.map((s, i) => `<li class="${s.done ? 'done' : s.current ? 'current' : 'todo'}"><span class="ic" aria-hidden="true">${s.done ? 'check_circle' : s.current ? 'radio_button_checked' : 'radio_button_unchecked'}</span>${i + 1}. ${esc(s.name)}${s.finale ? ' (the finale)' : ''}<span class="note" style="margin-left:auto">${s.tokens ? `+${n(s.tokens)} tokens` : ''}</span></li>`).join('');
    const st = x.stage;
    const card = !x.started ? `<p><button class="btn violet" data-act="start:${esc(x.id)}"><span class="ic" aria-hidden="true">flag</span>Start the Expedition</button></p>`
      : x.done ? `<div class="card"><b>Done ${dateOf(x.doneAt)}.</b>${x.times?.hill_run || Object.keys(x.times ?? {}).length ? ` Times: ${Object.entries(x.times).map(([k, t]) => `${esc(pretty(k))} ${timeOf(t)}`).join(', ')}` : ''}</div>`
      : `<div class="card"><h3>Now: ${esc(st.name)}</h3><p>${esc(st.text)}</p>${st.clue ? `<p class="clue">${esc(st.clue)}</p>` : ''}${st.hint ? `<p><b>Hint:</b> ${esc(st.hint)}</p>` : st.hintIn ? `<p class="note">A hint comes in ${Math.ceil(st.hintIn / 60)} minutes.</p>` : ''}
          ${st.items ? `<p>Picked up ${st.collected.length} of ${st.items}.</p>` : ''}${st.timeLimitSec ? `<p>Time limit ${Math.floor(st.timeLimitSec / 60)}:${String(st.timeLimitSec % 60).padStart(2, '0')}, from the start line. Out of time and you start again.</p>` : ''}
          <p class="note">${st.targets?.length ? 'A beam of violet light marks where to go; the panel on the right of the screen points the way.' : 'No marker for this one: follow the clue.'}</p></div>`;
    out.push(`<div class="exp"><h2 style="margin-top:0">${esc(x.name)}</h2><p class="sub">${esc(x.blurb ?? '')}</p><ul class="stages">${stages}</ul>${card}</div>`);
  }
  if (!v.expeditions.length) out.push('<p class="note">No Expeditions this season.</p>');
  return out.join('');
}

function shop(v) {
  const S = v.season, closed = S.status === 'ended';
  const items = v.shop.map(it => {
    const short = Math.max(0, it.price - v.tokens);
    const action = it.owned ? '<span class="chip">Yours, for good</span>' : closed ? '<span class="chip">The shop has closed</span>'
      : `<button class="btn violet" data-act="buy:${esc(it.id)}" ${short ? 'disabled' : ''}>${short ? `Save up: ${n(short)} more` : 'Buy'}</button>`;
    return `<div class="item ${it.owned ? 'owned' : ''}"><span class="ic" aria-hidden="true">${esc(it.icon ?? 'redeem')}</span><b>${esc(it.name)}</b><p>${esc(it.description)}</p><span class="price">${n(it.price)} tokens</span>${action}</div>`;
  }).join('');
  const log = (v.tokenHistory ?? []).map(t => `<tr><td>${dateOf(t.at)}</td><td>${esc(t.reason)}</td><td class="n ${t.amount > 0 ? 'plus' : 'minus'}">${t.amount > 0 ? '+' : ''}${n(t.amount)}</td><td class="n">${n(t.balance)}</td></tr>`).join('');
  return `${head(v, 'Season Shop')}<p class="note">Looks only: nothing here makes a car faster. Every price is shown up front and nothing is random. What you buy is yours for good. Tokens only buy things in this season's shop; at the end of the season any left become cash at $${n(S.conversion.cashPerToken)} each.</p>
    <div class="shop">${items}</div><h2>Every token</h2>${log ? `<table><tbody>${log}</tbody></table>` : '<p class="note">None yet: challenges, Expeditions and hidden places all earn them.</p>'}`;
}

function history(v) {
  const h = v.history ?? {};
  const most = h.mostUsedCar ? carName(h.mostUsedCar.carId) : null;
  const tiles = [
    [`${n(h.distanceKm)} km`, 'driven'], [n(h.racesEntered), 'races entered'], [n(h.wins), 'wins'],
    [`${n(h.medals?.gold)} · ${n(h.medals?.silver)} · ${n(h.medals?.bronze)}`, 'gold · silver · bronze medals'],
    [n(h.cars?.bought), 'cars bought'], [n(h.cars?.won), 'cars won'], [n(h.cars?.sold), 'cars sold'], [n(h.cars?.partsFitted), 'parts fitted'],
    [`${n(h.places?.length)} of ${n(h.placesTotal)}`, 'places discovered'], [n(h.expeditions?.length), 'Expeditions completed'],
    ...(most ? [[esc(most), `most driven (${n(h.mostUsedCar.km)} km)`]] : []),
  ];
  const recs = (h.personalRecords ?? []).map(r => `<tr><td>${r.kind === 'track' ? `Track ${esc(r.id)}${r.carClass ? ` (class ${esc(r.carClass)})` : ''}` : `Quest ${esc(pretty(r.id))}`}</td><td class="n">${r.time != null ? fmtTime(r.time) : r.score != null ? `${n(Math.round(r.score))} pts` : ''}</td><td>${r.medal ? esc(r.medal) : ''}</td></tr>`).join('');
  return `<h1>My history</h1><p class="sub">Everything you've done, for good: it never resets when a season ends.</p>
    <div class="stats">${tiles.map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('')}</div>
    <h2>Places discovered</h2>${h.places?.length ? `<div class="chips">${h.places.map(p => `<span class="chip" title="${esc(dateOf(p.at))}">${esc(p.name)}</span>`).join('')}</div>` : '<p class="note">Drive somewhere new: the city\'s landmarks, and a few hidden places.</p>'}
    <h2>Expeditions</h2>${h.expeditions?.length ? `<div class="chips">${h.expeditions.map(x => `<span class="chip">${esc(pretty(x.id))} · ${esc(pretty(x.season))} · ${dateOf(x.at)}</span>`).join('')}</div>` : '<p class="note">None finished yet.</p>'}
    <h2>Personal records</h2>${recs ? `<table><tbody>${recs}</tbody></table>` : '<p class="note">Set a time in a quest or a track event.</p>'}
    ${h.winsNote ? `<p class="note">${esc(h.winsNote)}</p>` : ''}`;
}

// a car's name, from its data file (fetched once; the id until then)
function carName(id) {
  if (!id) return '';
  if (carNames.has(id)) return carNames.get(id);
  carNames.set(id, pretty(id));
  fetch(new URL(`../data/cars/${encodeURIComponent(id)}/car.json`, import.meta.url)).then(r => r.json()).then(c => { if (c?.name) { carNames.set(id, c.name); draw(); } }).catch(() => {});
  return carNames.get(id);
}
