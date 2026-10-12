// The player's card in the garage (the top bar's level button): who they are, their level as a rev counter
// (the needle at how far to the next level, the rank they're in and the ranks to come — data/economy.json
// quests.tiers), their multiplayer rank (the server's tier from ranked races — data/multiplayer.json rank — and
// their place on the leaderboard), their money and what the garage is worth, and what they've raced.
// Pure: the numbers from the profile (profileStats), then the HTML (profileCard); the garage screen opens it.
//
//   profileStats(profile, db, levels) → { level, xp, from, to, share, rank, next, ranks, money, worth, cars,
//     spare, entered, finished, completed, dnfs, medals: { gold, silver, bronze }, series, since }
//   profileCard({ s, me, price, fresh, mp }) → HTML (me: account/session.js's me, or null; price: n → '$1,234';
//     mp: { state: 'loading' | 'off' | 'ok', tier: { id, name, division, placement? }, races, wins, safety, place })

import { levelProgress } from '../quest/rules.js';
import { carSellValue, sellValue } from './shop.js';

const LEVELS = { levels: { base: 400, growth: 0.25, max: 50 } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const int = n => Math.round(n ?? 0).toLocaleString('en-GB');
const icon = (name, extra = '') => `<span class="icon" ${extra}>${name}</span>`;

export function profileStats(profile, db, levels) {
  const cfg = levels?.levels ? levels : LEVELS, p = levelProgress(profile.xp ?? 0, cfg);
  const ranks = (db.economy?.quests?.tiers ?? []).map(t => ({ name: t.name, level: t.level })).sort((a, b) => a.level - b.level);
  const rank = [...ranks].reverse().find(r => p.level >= r.level) ?? null, next = ranks.find(r => r.level > p.level) ?? null;
  const quests = Object.values(profile.quests ?? {}), sum = k => quests.reduce((a, q) => a + (q[k] ?? 0), 0);
  const medals = { gold: 0, silver: 0, bronze: 0 };
  for (const q of quests) if (q.medal in medals) medals[q.medal]++;
  const cars = Object.keys(profile.cars ?? {});
  const spare = Object.values(profile.parts ?? {}).filter(x => !x.installedOn);
  const worth = cars.reduce((a, id) => a + (carSellValue(db, profile, id)?.total ?? 0), 0) + spare.reduce((a, x) => a + sellValue(db, x), 0);
  return { ...p, max: cfg.levels.max ?? 100, rank, next, ranks, money: profile.money ?? 0, worth, cars: cars.length, spare: spare.length,
    entered: sum('attempts'), finished: sum('finishes'), dnfs: sum('dnfs'), completed: quests.filter(q => q.completed).length,
    medals, series: Object.keys(profile.series ?? {}).length, since: profile.created ?? null };
}

// the rev counter: 270° from bottom left round to bottom right; ticks every tenth, the last stretch the red line
function gauge(s, fresh) {
  const R = 104, C = 130, a0 = 135, sweep = 270, at = t => { const a = (a0 + sweep * t) * Math.PI / 180; return [C + R * Math.cos(a), C + R * Math.sin(a)]; };
  const arc = (t0, t1, r = R) => { const p = t => { const a = (a0 + sweep * t) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; }; const [x0, y0] = p(t0), [x1, y1] = p(t1); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${(t1 - t0) * sweep > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const ticks = Array.from({ length: 41 }, (_, i) => {
    const t = i / 40, a = (a0 + sweep * t) * Math.PI / 180, major = i % 4 === 0, r0 = major ? 80 : 86, r1 = 92, red = t >= 0.85;
    return `<line x1="${(C + r0 * Math.cos(a)).toFixed(1)}" y1="${(C + r0 * Math.sin(a)).toFixed(1)}" x2="${(C + r1 * Math.cos(a)).toFixed(1)}" y2="${(C + r1 * Math.sin(a)).toFixed(1)}" class="${red ? 'red' : ''} ${major ? 'major' : ''} ${t <= s.share ? 'lit' : ''}"/>`;
  }).join('');
  const nums = Array.from({ length: 11 }, (_, i) => { const a = (a0 + sweep * i / 10) * Math.PI / 180; return `<text x="${(C + 68 * Math.cos(a)).toFixed(1)}" y="${(C + 68 * Math.sin(a) + 4).toFixed(1)}">${i}</text>`; }).join('');
  const [tx, ty] = at(s.share), maxed = s.level >= s.max;
  return `<div class="pc-gauge ${fresh ? 'fresh' : ''}" style="--share:${s.share.toFixed(4)};--deg:${(sweep * s.share - 135).toFixed(1)}deg">
    <svg viewBox="0 0 260 260" aria-hidden="true">
      <defs><linearGradient id="pc-rev" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8e0611"/><stop offset=".55" stop-color="#e3121e"/><stop offset="1" stop-color="#ff6a52"/></linearGradient>
        <radialGradient id="pc-face" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#202328"/><stop offset=".7" stop-color="#0b0c0e"/><stop offset="1" stop-color="#050506"/></radialGradient>
        <linearGradient id="pc-bezel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3f5"/><stop offset=".45" stop-color="#5c6168"/><stop offset=".5" stop-color="#16181b"/><stop offset=".62" stop-color="#7d838b"/><stop offset="1" stop-color="#c3c8cf"/></linearGradient>
        <filter id="pc-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter></defs>
      <circle cx="130" cy="130" r="126" fill="url(#pc-bezel)"/><circle cx="130" cy="130" r="120" fill="url(#pc-face)"/>
      <path d="${arc(0, 1)}" class="track"/><path d="${arc(0.85, 1)}" class="redline"/>
      <path d="${arc(0, 1)}" class="rev glow" pathLength="100" filter="url(#pc-glow)"/><path d="${arc(0, 1)}" class="rev" pathLength="100"/>
      <g class="ticks">${ticks}</g><g class="nums">${nums}</g>
      ${s.share > 0.01 ? `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="5" class="tip"/>` : ''}
      <g class="needle"><path d="M130 136 L127 130 L130 44 L133 130 Z"/><circle cx="130" cy="130" r="11" class="hub"/><circle cx="130" cy="130" r="4" class="hub-dot"/></g>
    </svg>
    <div class="pc-readout"><span class="pc-lv-label">Level</span><span class="pc-lv">${s.level}</span><span class="pc-rank">${esc(s.rank?.name ?? 'Rookie')}</span></div>
    <div class="pc-xp">${maxed ? '<b>Max level</b>' : `<b>${int(s.xp - s.from)}</b> / ${int(s.to - s.from)} XP · <span>${int(s.to - s.xp)} to level ${s.level + 1}</span>`}</div>
  </div>`;
}

// the ranks as a road: the ones reached lit, the one you're in glowing, the next with how far
function road(s) {
  if (!s.ranks.length) return '';
  return `<div class="pc-road">${s.ranks.map(r => {
    const reached = s.level >= r.level, here = s.rank?.name === r.name;
    return `<div class="pc-stop ${reached ? 'on' : ''} ${here ? 'here' : ''}"><span class="dot">${reached ? icon('check', 'style="font-size:15px"') : ''}</span><span class="nm">${esc(r.name)}</span><span class="lv">Lv ${r.level}</span></div>`;
  }).join('')}</div>
  ${s.next ? `<div class="pc-next">${icon('lock_open')}<span><b>${esc(s.next.name)}</b> events open at level ${s.next.level} · ${s.next.level - s.level} level${s.next.level - s.level > 1 ? 's' : ''} to go</span></div>` : '<div class="pc-next">' + icon('workspace_premium') + '<span>Every rank of events is open to you.</span></div>'}`;
}

// the multiplayer rank: an emblem in the tier's colours (a chevron for each division climbed), the leaderboard place
const DIV_CHEVRONS = { III: 1, II: 2, I: 3 };
function emblem(tier) {
  const n = tier?.division ? DIV_CHEVRONS[tier.division] : tier?.id === 'unranked' ? 0 : 3;
  const chev = Array.from({ length: n }, (_, i) => `<path d="M30 ${70 - i * 11} L50 ${60 - i * 11} L70 ${70 - i * 11}" />`).join('');
  return `<svg class="pc-emblem" viewBox="0 0 100 112" aria-hidden="true"><path class="shield-edge" d="M50 3 L94 20 V58 C94 84 74 101 50 109 C26 101 6 84 6 58 V20 Z"/>
    <path class="shield" d="M50 11 L86 25 V58 C86 79 70 93 50 100 C30 93 14 79 14 58 V25 Z"/>
    <path class="shine" d="M50 11 L86 25 V44 C70 38 32 36 14 46 V25 Z"/>${tier?.id === 'champion' ? '<path class="crown" d="M34 36 L40 24 L50 33 L60 24 L66 36 Z"/>' : ''}<g class="chev">${chev}</g>
    ${tier?.id === 'unranked' ? '<text x="50" y="66">?</text>' : ''}</svg>`;
}
function ranked(mp) {
  if (!mp || mp.state === 'loading') return `<div class="pc-ranked loading"><div class="pc-emblem-wrap">${emblem({ id: 'unranked' })}</div><div class="pc-r-text"><span class="l">Multiplayer rank</span><span class="v">Checking…</span></div></div>`;
  if (mp.state === 'off') return `<div class="pc-ranked off"><div class="pc-emblem-wrap">${emblem({ id: 'unranked' })}</div><div class="pc-r-text"><span class="l">Multiplayer rank</span><span class="v">Offline</span><span class="sub">${esc(mp.why ?? 'Your rank shows when the game\'s server can be reached.')}</span></div></div>`;
  const t = mp.tier ?? { id: 'unranked', name: 'Unranked' }, unranked = t.id === 'unranked', rate = mp.races ? Math.round(100 * mp.wins / mp.races) : 0;
  return `<div class="pc-ranked t-${esc(t.id)}"><div class="pc-emblem-wrap">${emblem(t)}</div>
    <div class="pc-r-text"><span class="l">Multiplayer rank</span><span class="v">${esc(t.name)}${t.division ? ` <em>${esc(t.division)}</em>` : ''}</span>
      <span class="sub">${unranked ? `${t.placement ?? 0} placement race${t.placement === 1 ? '' : 's'} to go` : mp.place ? `#${mp.place} on the leaderboard` : 'Outside the top 50'}${mp.safety?.tier?.name ? ` · ${esc(mp.safety.tier.name)} driver` : ''}</span></div>
    <div class="pc-r-nums"><div><b>${int(mp.races)}</b><span>Races</span></div><div><b>${int(mp.wins)}</b><span>Wins</span></div><div><b>${rate}%</b><span>Win rate</span></div>${mp.place ? `<div class="place"><b>#${mp.place}</b><span>Place</span></div>` : ''}</div></div>`;
}

const tile = (label, value, ic, cls = '') => `<div class="pc-tile ${cls}">${icon(ic)}<div><span class="v">${value}</span><span class="l">${esc(label)}</span></div></div>`;

export function profileCard({ s, me, price, fresh = false, mp = null }) {
  const name = me?.displayName ?? 'Driver', guest = !me || me.isGuest;
  const initials = name.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || 'D';
  const since = s.since ? new Date(s.since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null;
  const next = typeof location === 'undefined' ? '/' : location.pathname + location.search;
  const finishRate = s.entered ? Math.round(100 * s.finished / s.entered) : 0;
  return `<div class="scrim pc-scrim" data-act="dialog-cancel"><div class="pc ${fresh ? 'fresh' : ''}" role="dialog" aria-modal="true" aria-label="Your account" data-act="">
    <button class="icon-btn flat pc-close" data-act="dialog-cancel" data-key="pc-close" title="Close (Esc)">${icon('close')}</button>
    <header class="pc-head">
      <div class="pc-avatar"><span>${esc(initials)}</span></div>
      <div class="pc-who"><span class="pc-kicker">${guest ? 'Guest driver' : 'Driver'}${since ? ` · since ${esc(since)}` : ''}</span><h2>${esc(name)}</h2></div>
      <a class="btn secondary bar pc-settings" href="/account/?next=${encodeURIComponent(next)}">${icon('manage_accounts')}<span>${guest ? 'Make an account' : 'Account settings'}</span></a>
    </header>
    <div class="pc-body">
      <section class="pc-level">${gauge(s, fresh)}${road(s)}</section>
      <section class="pc-stats">
        ${ranked(mp)}
        <div class="pc-money"><span class="l">Money</span><span class="v">${esc(price(s.money))}</span><span class="sub">Garage worth ${esc(price(s.worth))} to sell</span></div>
        <div class="pc-grid">
          ${tile('Cars', int(s.cars), 'directions_car')}${tile('Spare parts', int(s.spare), 'inventory_2')}
          ${tile('Total XP', int(s.xp), 'bolt', 'accent')}${tile('Series won', int(s.series), 'emoji_events')}
        </div>
        <h3>Racing</h3>
        <div class="pc-grid">
          ${tile('Entered', int(s.entered), 'flag')}${tile('Finished', `${int(s.finished)}<small>${s.entered ? ` · ${finishRate}%` : ''}</small>`, 'sports_score')}
          ${tile('Completed', int(s.completed), 'military_tech')}${tile('Didn\'t finish', int(s.dnfs), 'report')}
        </div>
        <div class="pc-medals">
          <div class="m gold"><span class="disc">1</span><b>${int(s.medals.gold)}</b><span>Gold</span></div>
          <div class="m silver"><span class="disc">2</span><b>${int(s.medals.silver)}</b><span>Silver</span></div>
          <div class="m bronze"><span class="disc">3</span><b>${int(s.medals.bronze)}</b><span>Bronze</span></div>
        </div>
      </section>
    </div>
  </div></div>`;
}
