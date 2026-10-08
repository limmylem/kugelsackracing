// The economy simulation's report: each target (data/economy.json simulation.targets) checked against the
// bots' runs, as plain text and as an HTML page with charts (money over time, income an hour by quest
// type, where the money goes, which quests pay too much or too little).
//
//   evaluate(runs: { low, medium, high }, economy, { payRuns }) → [{ id, name, pass, detail }]   (payRuns: the quest pay
//     check's — the runs over simulation.payCheckSeeds)
//   questPay(runs, economy) → [{ type, tier, perHour, runs, ratio, flag }]
//   textReport(runs, checks, economy) → string      htmlReport(runs, checks, economy) → string

const h = s => s == null ? 'never' : `${(s / 3600).toFixed(2)} h`;
const money = (n, E) => `${E.currency ?? '$'}${Math.round(n).toLocaleString('en-GB')}`;
const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : 0; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// income an hour for each quest type at each tier (all the bots' runs together), against the median of
// the types at that tier
export function questPay(runs, economy) {
  const T = economy.simulation.targets.questPay, by = {};
  for (const R of Object.values(runs)) for (const x of Object.values(R.income)) { const k = `${x.type}·${x.tier}`; const o = by[k] ??= { type: x.type, tier: x.tier, money: 0, seconds: 0, runs: 0 }; o.money += x.money; o.seconds += x.seconds; o.runs += x.runs; }
  const rows = Object.values(by).filter(x => x.runs >= 3).map(x => ({ ...x, perHour: x.money / x.seconds * 3600 }));
  for (const t of new Set(rows.map(x => x.tier))) {
    const at = rows.filter(x => x.tier === t), m = median(at.map(x => x.perHour));
    for (const x of at) { x.ratio = m ? x.perHour / m : 1; x.flag = at.length < 2 ? null : x.ratio > T.high ? 'pays too much' : x.ratio < T.low ? 'pays too little' : null; }
  }
  return rows.sort((a, b) => a.tier - b.tier || b.perHour - a.perHour);
}

export function evaluate(runs, economy, { payRuns = runs } = {}) {
  const T = economy.simulation.targets, M = runs.medium, out = [];
  const add = (id, name, pass, detail) => out.push({ id, name, pass, detail });
  add('firstUpgrade', `First meaningful upgrade (+${T.meaningfulGain} rating) within ${T.firstUpgradeMinutes} min`, M.firstUpgrade != null && M.firstUpgrade <= T.firstUpgradeMinutes * 60,
    `medium skill: ${M.firstUpgrade == null ? 'never' : `${Math.round(M.firstUpgrade / 60)} min`} (low ${runs.low.firstUpgrade == null ? 'never' : `${Math.round(runs.low.firstUpgrade / 60)} min`}, high ${runs.high.firstUpgrade == null ? 'never' : `${Math.round(runs.high.firstUpgrade / 60)} min`})`);
  add('secondCar', `Second car within ${T.secondCarHours.min}–${T.secondCarHours.max} h`, M.secondCar != null && M.secondCar >= T.secondCarHours.min * 3600 && M.secondCar <= T.secondCarHours.max * 3600,
    `medium skill: ${h(M.secondCar)} (low ${h(runs.low.secondCar)}, high ${h(runs.high.secondCar)})`);
  const shares = Object.fromEntries(Object.entries(runs).map(([k, R]) => [k, R.crashes.map(c => c.share)]));
  const worst = Math.max(0, ...Object.values(shares).flat()), avg = Math.max(...Object.values(shares).map(mean));
  add('repairs', `Repairs: a crash's full repair on average at most ${Math.round(T.repairs.mean * 100)}% of a typical race reward, never more than ${Math.round(T.repairs.max * 100)}%`, avg <= T.repairs.mean && worst <= T.repairs.max,
    Object.entries(shares).map(([k, s]) => `${k}: ${s.length} crashes, mean ${Math.round(mean(s) * 100)}%, worst ${Math.round(Math.max(0, ...s) * 100)}%`).join(' · '));
  const ratio = runs.high.earned / Math.max(1, M.earned);
  add('skill', `A skilled player earns ${T.skilledVsAverage.min}–${T.skilledVsAverage.max}× an average one`, ratio >= T.skilledVsAverage.min && ratio <= T.skilledVsAverage.max,
    `high ${money(runs.high.earned, economy)} vs medium ${money(M.earned, economy)}: ${ratio.toFixed(2)}× (low ${money(runs.low.earned, economy)})`);
  const stuck = Object.entries(runs).map(([k, R]) => `${k} ${R.stuck}`).join(', '), anyStuck = Object.values(runs).reduce((a, R) => a + R.stuck, 0);
  add('stuck', 'No player gets stuck with no way to earn', anyStuck <= T.stuck, `times with no quest it could enter and afford: ${stuck}; free basic repairs: ${Object.entries(runs).map(([k, R]) => `${k} ${R.safetyNet}`).join(', ')}`);
  const pay = questPay(payRuns, economy), flagged = pay.filter(x => x.flag);
  add('questPay', `Every quest type pays ${T.questPay.low}–${T.questPay.high}× the median of its tier an hour`, !flagged.length,
    flagged.length ? flagged.map(x => `${x.type} (tier ${x.tier}) ${x.flag}: ${x.ratio.toFixed(2)}×`).join(' · ') : `${pay.length} type × tier rows within range`);
  add('levels', `A medium player reaches level ${T.levels.min}–${T.levels.max} in ${M.hours} h`, M.level >= T.levels.min && M.level <= T.levels.max, `medium level ${M.level} (low ${runs.low.level}, high ${runs.high.level})`);
  // multiplayer quick races (Phase 7 Step 2): an hour of racing people against an hour of quests, for the same player
  if (T.multiplayerPay && Object.values(runs).every(R => R.mp?.races)) {
    const rows = Object.entries(runs).map(([k, R]) => ({ k, ...mpVsQuests(R) }));
    add('multiplayerPay', `Multiplayer races pay ${T.multiplayerPay.min}–${T.multiplayerPay.max}× an hour of quests`, rows.every(x => x.ratio >= T.multiplayerPay.min && x.ratio <= T.multiplayerPay.max),
      rows.map(x => `${x.k}: ${money(x.mp, economy)}/h racing vs ${money(x.quests, economy)}/h on quests, ${x.ratio.toFixed(2)}×`).join(' · '));
  }
  return out;
}

// what an hour of multiplayer races paid a bot, against an hour of its quests
export function mpVsQuests(R) {
  const q = Object.values(R.income), qs = q.reduce((a, x) => a + x.seconds, 0), qm = q.reduce((a, x) => a + x.money, 0);
  const mp = R.mp.seconds ? R.mp.money / R.mp.seconds * 3600 : 0, quests = qs ? qm / qs * 3600 : 0;
  return { mp, quests, ratio: quests ? mp / quests : 0 };
}

export function textReport(runs, checks, economy, { payRuns = runs } = {}) {
  const L = [], S = economy.simulation;
  L.push(`Economy simulation: ${S.hours} h of play at each skill (${Object.entries(S.skills).map(([k, v]) => `${k} ${v}`).join(', ')}), seed ${S.seed}`, '');
  for (const c of checks) L.push(`${c.pass ? '  ok  ' : ' FAIL '} ${c.name}`, `        ${c.detail}`);
  L.push('');
  for (const [k, R] of Object.entries(runs)) {
    const sp = R.spend, tot = sp.repairs + sp.parts + sp.cars + sp.fees || 1;
    L.push(`${k} (skill ${R.skill}): ${R.runs} quests, level ${R.level}, earned ${money(R.earned, economy)}, has ${money(R.money, economy)}; cars ${R.cars.map(c => `${c.carId} (${c.cls} ${c.rating})`).join(', ')}; ${R.series} series`);
    if (R.mp?.races) { const v = mpVsQuests(R), pl = R.mp.places; L.push(`    multiplayer: ${R.mp.races} quick races (${R.mp.dnfs} DNF), average place ${pl.length ? (pl.reduce((a, b) => a + b, 0) / pl.length).toFixed(1) : '—'}, paid ${money(R.mp.money, economy)} and ${R.mp.xp} xp: ${money(v.mp, economy)}/h (quests ${money(v.quests, economy)}/h)`); }
    L.push(`    spent: repairs ${money(sp.repairs, economy)} (${Math.round(sp.repairs / tot * 100)}%), parts ${money(sp.parts, economy)} (${Math.round(sp.parts / tot * 100)}%), cars ${money(sp.cars, economy)} (${Math.round(sp.cars / tot * 100)}%), entry fees ${money(sp.fees, economy)} (${Math.round(sp.fees / tot * 100)}%)`);
  }
  L.push('', `Income an hour by quest type and tier (all skills${economy.simulation.payCheckSeeds?.length ? `, seeds ${economy.simulation.payCheckSeeds.join(', ')}` : ''}):`);
  for (const x of questPay(payRuns, economy)) L.push(`  tier ${x.tier} ${x.type.padEnd(11)} ${money(x.perHour, economy).padStart(9)}/h · ${String(x.runs).padStart(3)} runs · ${x.ratio.toFixed(2)}× its tier's median${x.flag ? `  ✘ ${x.flag}` : ''}`);
  const failed = checks.filter(c => !c.pass).length;
  L.push('', failed ? `${failed} target${failed > 1 ? 's' : ''} not met.` : 'Every target met.');
  return L.join('\n');
}

// ---------- the HTML page: inline SVG charts, light and dark ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function lineChart(runs, economy) {
  const W = 720, H = 300, P = { l: 64, r: 90, t: 16, b: 34 }, keys = Object.keys(runs);
  const maxT = Math.max(...keys.map(k => runs[k].samples.at(-1).t)), top = Math.max(1, ...keys.flatMap(k => runs[k].samples.map(s => s.money)));
  // (round steps: 1, 2, 2.5 or 5 × a power of ten, four or so up the axis)
  const raw = top / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(x => x >= raw), maxM = Math.ceil(top / step) * step;
  const x = t => P.l + (W - P.l - P.r) * t / maxT, y = m => H - P.b - (H - P.t - P.b) * m / maxM;
  const ticks = Array.from({ length: Math.round(maxM / step) + 1 }, (_, i) => i * step), hours = Array.from({ length: Math.floor(maxT / 3600) + 1 }, (_, i) => i);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" data-chart="money" role="img" aria-label="Money over time for each skill">`;
  svg += ticks.map(m => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(m)}" y2="${y(m)}" class="grid"/><text x="${P.l - 8}" y="${y(m) + 4}" class="axis" text-anchor="end">${esc(money(m, economy))}</text>`).join('');
  svg += hours.map(hr => `<text x="${x(hr * 3600)}" y="${H - 12}" class="axis" text-anchor="middle">${hr} h</text>`).join('');
  keys.forEach((k, i) => {
    const pts = runs[k].samples.map(s => `${x(s.t).toFixed(1)},${y(s.money).toFixed(1)}`).join(' '), last = runs[k].samples.at(-1);
    svg += `<polyline points="${pts}" fill="none" stroke="var(--series-${i + 1})" stroke-width="2" stroke-linejoin="round"/>`;
    svg += `<text x="${x(last.t) + 6}" y="${y(last.money) + 4}" class="label">${esc(k)}</text>`;
  });
  svg += `<line class="cross" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" style="display:none"/></svg>`;
  return { svg, data: Object.fromEntries(keys.map(k => [k, runs[k].samples.map(s => [s.t, s.money])])), geo: { W, H, P, maxT, maxM } };
}
function barChart(rows, economy) {
  const W = 720, rowH = 26, P = { l: 170, r: 90, t: 8 }, H = P.t + rows.length * rowH + 8, max = Math.max(1, ...rows.map(r => r.perHour));
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Income an hour by quest type and tier">`;
  rows.forEach((r, i) => {
    const y = P.t + i * rowH, w = Math.max(2, (W - P.l - P.r) * r.perHour / max);
    svg += `<text x="${P.l - 8}" y="${y + 17}" class="axis" text-anchor="end">tier ${r.tier} · ${esc(r.type)}</text>`;
    svg += `<rect x="${P.l}" y="${y + 4}" width="${w}" height="${rowH - 8}" rx="4" fill="var(--series-1)"><title>${esc(`${r.type}, tier ${r.tier}: ${money(r.perHour, economy)} an hour over ${r.runs} runs (${r.ratio.toFixed(2)}× its tier's median)`)}</title></rect>`;
    svg += `<text x="${P.l + w + 6}" y="${y + 17}" class="label">${esc(money(r.perHour, economy))}/h${r.flag ? ` ⚠ ${esc(r.flag)}` : ''}</text>`;
  });
  return svg + '</svg>';
}
function spendChart(runs, economy) {
  const kinds = ['repairs', 'parts', 'cars', 'fees'], W = 720, rowH = 34, P = { l: 90, r: 20, t: 8 }, keys = Object.keys(runs), H = P.t + keys.length * rowH + 8;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Spending split by skill">`;
  keys.forEach((k, i) => {
    const sp = runs[k].spend, tot = kinds.reduce((a, q) => a + sp[q], 0) || 1, y = P.t + i * rowH;
    let x0 = P.l;
    svg += `<text x="${P.l - 8}" y="${y + 21}" class="axis" text-anchor="end">${esc(k)}</text>`;
    kinds.forEach((q, j) => {
      const w = (W - P.l - P.r) * sp[q] / tot;
      if (w > 0.5) svg += `<rect x="${x0}" y="${y + 6}" width="${Math.max(0, w - 2)}" height="${rowH - 12}" rx="${j === kinds.length - 1 || x0 + w >= W - P.r - 1 ? 4 : 0}" fill="var(--series-${j + 1})"><title>${esc(`${k}: ${q} ${money(sp[q], economy)} (${Math.round(sp[q] / tot * 100)}%)`)}</title></rect>`;
      x0 += w;
    });
  });
  return svg + '</svg>';
}

export function htmlReport(runs, checks, economy, { payRuns = runs } = {}) {
  const L = lineChart(runs, economy), pay = questPay(payRuns, economy);
  const legend = keys => keys.map((k, i) => `<span class="key"><i style="background:var(--series-${i + 1})"></i>${esc(k)}</span>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Economy Balance Report</title>
<style>
:root{color-scheme:light;--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--grid:#e4e3df;--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--good:#008300;--bad:#c4302b}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--surface-1:#1a1a19;--text-primary:#fff;--text-secondary:#c3c2b7;--grid:#34332f;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--good:#5cc95c;--bad:#ff7a6a}}
:root[data-theme="dark"]{color-scheme:dark;--surface-1:#1a1a19;--text-primary:#fff;--text-secondary:#c3c2b7;--grid:#34332f;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--good:#5cc95c;--bad:#ff7a6a}
body{margin:0;background:var(--surface-1);color:var(--text-primary);font:15px/1.5 system-ui,sans-serif}
main{max-width:780px;margin:0 auto;padding:24px 16px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}
.sub{color:var(--text-secondary)}
.chart{width:100%;height:auto;display:block}.grid{stroke:var(--grid);stroke-width:1}.axis{fill:var(--text-secondary);font-size:12px}.label{fill:var(--text-primary);font-size:12px}
.cross{stroke:var(--text-secondary);stroke-width:1}
.key{display:inline-flex;align-items:center;gap:6px;margin-right:14px;color:var(--text-secondary);font-size:13px}.key i{width:12px;height:12px;border-radius:3px;display:inline-block}
.checks div{display:grid;grid-template-columns:60px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--grid)}
.ok{color:var(--good);font-weight:700}.fail{color:var(--bad);font-weight:700}.detail{color:var(--text-secondary);font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:4px 6px;border-bottom:1px solid var(--grid);text-align:left}td.n{text-align:right;font-variant-numeric:tabular-nums}
#tip{position:fixed;pointer-events:none;background:var(--surface-1);border:1px solid var(--grid);border-radius:6px;padding:6px 8px;font-size:12px;display:none;box-shadow:0 4px 12px rgba(0,0,0,.15)}
.wrap{overflow-x:auto}
</style></head><body><main>
<h1>Economy balance</h1><div class="sub">${economy.simulation.hours} h of simulated play at three skill levels · tools/economy-sim.mjs · ${checks.every(c => c.pass) ? 'every target met' : `${checks.filter(c => !c.pass).length} target(s) not met`}</div>
<h2>Targets</h2><div class="checks">${checks.map(c => `<div><span class="${c.pass ? 'ok' : 'fail'}">${c.pass ? '✔ pass' : '✘ fail'}</span><span>${esc(c.name)}<br><span class="detail">${esc(c.detail)}</span></span></div>`).join('')}</div>
<h2>Money over time</h2><div>${legend(Object.keys(runs))}</div><div class="wrap">${L.svg}</div>
<h2>Income an hour by quest type</h2><div class="sub">All three bots' runs, after entry fees. ⚠ marks a type paying outside ${economy.simulation.targets.questPay.low}–${economy.simulation.targets.questPay.high}× its tier's median.</div><div class="wrap">${barChart(pay, economy)}</div>
<h2>Where the money goes</h2><div>${legend(['repairs', 'parts', 'cars', 'entry fees'])}</div><div class="wrap">${spendChart(runs, economy)}</div>
<h2>The numbers</h2><div class="wrap"><table><tr><th>Skill</th><th>Quests</th><th>Level</th><th>Earned</th><th>Repairs</th><th>Parts</th><th>Cars</th><th>Fees</th><th>Second car</th></tr>
${Object.entries(runs).map(([k, R]) => `<tr><td>${esc(k)}</td><td class="n">${R.runs}</td><td class="n">${R.level}</td><td class="n">${esc(money(R.earned, economy))}</td><td class="n">${esc(money(R.spend.repairs, economy))}</td><td class="n">${esc(money(R.spend.parts, economy))}</td><td class="n">${esc(money(R.spend.cars, economy))}</td><td class="n">${esc(money(R.spend.fees, economy))}</td><td class="n">${esc(h(R.secondCar))}</td></tr>`).join('')}</table></div>
<div id="tip"></div>
<script>
const D = ${JSON.stringify(L.data)}, G = ${JSON.stringify(L.geo)}, cur = ${JSON.stringify(economy.currency ?? '$')};
const svg = document.querySelector('[data-chart=money]'), cross = svg.querySelector('.cross'), tip = document.getElementById('tip');
svg.addEventListener('mousemove', e => {
  const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * G.W, t = Math.max(0, Math.min(G.maxT, (px - G.P.l) / (G.W - G.P.l - G.P.r) * G.maxT));
  cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.style.display = '';
  const rows = Object.entries(D).map(([k, s]) => { let v = s[0][1]; for (const [st, m] of s) { if (st > t) break; v = m; } return '<div>' + k + ': ' + cur + Math.round(v).toLocaleString('en-GB') + '</div>'; });
  tip.innerHTML = '<b>' + (t / 3600).toFixed(1) + ' h</b>' + rows.join(''); tip.style.display = 'block'; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 10) + 'px';
});
svg.addEventListener('mouseleave', () => { cross.style.display = 'none'; tip.style.display = 'none'; });
</script></main></body></html>`;
}
