// Repair tokens (data/economy.json repairTokens): one token repairs everything on a car in full, whatever it would
// cost, so a big crash doesn't take all of a player's money. A new player has start of them; while there are fewer
// than refill.upTo, one more comes free every refill.everyHours; a win (a race won, a quest's gold) earns earn.win
// (at most earn.winsPerDay of those a day) and each level gained earn.levelUp; never more than max held. Out of
// tokens: the repair is paid with money as before (and the free basic repair, safetyNet, still gets anyone broke
// going again).
//
//   profile.repairTokens   { count, at (when the refill clock started), day, won (tokens won that day) }   none: start
//   tokensNow(p, cfg, now) → { count, max, nextAt (ISO, or null: no refill coming), enabled }
//   settleTokens(p, cfg, now)          the refills due so far added to the profile; → the same as tokensNow
//   spendToken(p, cfg, now)            → { error } | { count } one taken
//   earnTokens(p, cfg, { wins, levels }, now) → the tokens given (capped as above)
//   checkTokens(p, cfg)                a save's tokens as they should be (checkProfile)
// Pure (tests/unit/repairTokens.test.mjs). The time is the service's clock: the server's, for a player online.

const HOUR = 3600e3;
const ms = t => typeof t === 'number' ? t : Date.parse(t);
const iso = t => new Date(t).toISOString();
const dayOf = t => iso(t).slice(0, 10);
export const tokensOn = cfg => !!cfg && cfg.enabled !== false;

function state(p, cfg, now) {
  const s = p.repairTokens;
  return s && Number.isFinite(s.count) ? s : { count: cfg.start ?? 0, at: iso(ms(now)) };
}
// (the refills due: the clock runs only while there are fewer than upTo; full, it starts again from now)
function refilled(s, cfg, now) {
  const t = ms(now), upTo = Math.min(cfg.refill?.upTo ?? 0, cfg.max), every = (cfg.refill?.everyHours ?? 0) * HOUR;
  let count = s.count, at = Number.isFinite(ms(s.at)) ? ms(s.at) : t;
  if (every > 0 && count < upTo) {
    const n = Math.max(0, Math.floor((t - at) / every));
    count = Math.min(upTo, count + n);
    at = count >= upTo ? t : at + n * every;
  } else at = t;
  return { count, at, nextAt: every > 0 && count < upTo ? iso(at + every) : null };
}

export function tokensNow(p, cfg, now) {
  if (!tokensOn(cfg)) return { enabled: false, count: 0, max: 0, nextAt: null };
  const r = refilled(state(p, cfg, now), cfg, now);
  return { enabled: true, count: r.count, max: cfg.max, nextAt: r.nextAt };
}
export function settleTokens(p, cfg, now) {
  if (!tokensOn(cfg)) return tokensNow(p, cfg, now);
  const s = state(p, cfg, now), r = refilled(s, cfg, now);
  p.repairTokens = { ...s, count: r.count, at: iso(r.at) };
  return { enabled: true, count: r.count, max: cfg.max, nextAt: r.nextAt };
}
export function spendToken(p, cfg, now) {
  if (!tokensOn(cfg)) return { error: 'There are no repair tokens.' };
  const t = settleTokens(p, cfg, now);
  if (t.count < 1) return { error: 'You\'re out of repair tokens.', nextAt: t.nextAt };
  p.repairTokens.count = t.count - 1;
  // (the refill clock starts when the count drops below upTo: from now, not from when it was last full)
  return { count: t.count - 1 };
}
export function earnTokens(p, cfg, { wins = 0, levels = 0 } = {}, now) {
  if (!tokensOn(cfg) || (wins <= 0 && levels <= 0)) return 0;
  settleTokens(p, cfg, now);
  const s = p.repairTokens, today = dayOf(ms(now)), E = cfg.earn ?? {};
  if (s.day !== today) { s.day = today; s.won = 0; }
  const fromWins = Math.max(0, Math.min(wins * (E.win ?? 0), (E.winsPerDay ?? Infinity) - (s.won ?? 0)));
  const want = fromWins + Math.max(0, levels) * (E.levelUp ?? 0), given = Math.max(0, Math.min(want, cfg.max - s.count));
  s.count += given;
  s.won = (s.won ?? 0) + Math.min(fromWins, given);
  return given;
}
export function checkTokens(p, cfg) {
  const s = p.repairTokens;
  if (s === undefined) return;
  if (!s || typeof s !== 'object' || !Number.isFinite(s.count)) { delete p.repairTokens; return; }
  const max = cfg?.max ?? 0, out = { count: Math.max(0, Math.min(max, Math.floor(s.count))), at: Number.isFinite(Date.parse(s.at)) ? s.at : iso(Date.now()) };
  if (typeof s.day === 'string' && /^\d{4}-\d\d-\d\d$/.test(s.day)) { out.day = s.day; out.won = Math.max(0, Math.floor(Number(s.won) || 0)); }
  p.repairTokens = out;
}
