// The race server's side of car-to-car contact (Phase 7 Step 3; docs/CONTACT.md): the referee. Each player's game
// reports the contacts it saw (mp/contactClient.js); this pairs the two reports of one contact, checks a one-sided one
// against its own log of both cars, and sends everyone one agreed result (mp/contact.js agree) — the impulse each car
// gets, the damage, and who caused it (blame). It ghosts cars automatically (lag, jitter, a reset, a rejoin, the wrong
// way, the pit lane …), keeps the race's incidents (penalties, repeat offenders, ramming — the victim offered a one-tap
// report with the replay of both cars), and hands the race record its contact log and each player's incidents (the
// API moves their safety rating, and checks each run's pushes against this log).

import { agree, blame, ghostState, createIncidents, footprintOf, overlap, closingAt, yawOf } from '../../../mp/contact.js';
import { project } from '../../../route/geometry.js';

type Car = { uid: string; name: string; mass: number; box: any };
type Snap = { t: number; pos: number[]; rot: number[]; vel: number[]; ang: number[]; arrival: number; s?: number; d?: number };
type Pending = { key: string; a: string; b: string; reports: any[]; first: number; due: number };

const HISTORY_SEC = 15;

export function createReferee({ cfg, mode, now, course, pit = null, car, isRacer, raceOf, send, broadcast, penalize, saveEvidence, raceId }: {
  cfg: any; mode: () => string; now: () => number; course: any; pit?: any;
  car: (uid: string) => Car | null; isRacer: (uid: string) => boolean; raceOf: (uid: string) => { lap?: number; u?: number; status?: string } | null;
  send: (uid: string, msg: any) => void; broadcast: (msg: any) => void; penalize: (uid: string, sec: number, why: string) => void;
  saveEvidence: (e: any) => Promise<any>; raceId: () => string | null;
}) {
  const history = new Map<string, Snap[]>();
  const lags = new Map<string, number[]>();
  const marks = new Map<string, { resetAt: number | null; rejoinAt: number | null; wrong: number; right: number; wasWrong: boolean; lastT: number | null; inPit: boolean; offender: boolean }>();
  const pending = new Map<string, Pending>();
  const contacts: any[] = [];
  const rejected: { uid: string; ep: number; why: string; t?: number; me?: any; them?: any; server?: any }[] = [];
  const trails = new Map<string, number[][]>();          // uid → [[t, x, z, vx, vz]] a second apart (the verifier's)
  const incidents = createIncidents(cfg);
  const reportsAt = new Map<string, number[]>();
  let ghostsSent = '';
  let nextCid = 1;
  const markOf = (uid: string) => { let m = marks.get(uid); if (!m) marks.set(uid, m = { resetAt: null, rejoinAt: null, wrong: 0, right: 99, wasWrong: false, lastT: null, inPit: false, offender: false }); return m; };

  // ---------- each car's states, as the server accepted them ----------
  function onState(uid: string, f: any, at: number) {
    const h = history.get(uid) ?? [];
    const proj: any = course?.line ? project(course.line, f.pos[0], f.pos[2]) : null;
    h.push({ t: f.time, pos: f.pos, rot: f.rot, vel: f.vel, ang: f.ang ?? [0, 0, 0], arrival: at, s: proj?.s, d: proj?.d });
    while (h.length && h[0].t < f.time - HISTORY_SEC * 1000) h.shift();
    history.set(uid, h);
    const l = lags.get(uid) ?? []; l.push(at - f.time); while (l.length > 150) l.shift(); lags.set(uid, l);
    const tr = trails.get(uid) ?? []; if (!tr.length || f.time - tr.at(-1)![0] >= 500) { tr.push([Math.round(f.time), ...[f.pos[0], f.pos[2], f.vel[0], f.vel[2]].map(v => Math.round(v * 100) / 100)]); if (tr.length > 20000) tr.shift(); trails.set(uid, tr); }
    // the wrong way: its velocity against the course's direction there (and how long it's been going which way)
    const m = markOf(uid), dt = m.lastT != null ? Math.max(0, Math.min(0.5, (f.time - m.lastT) / 1000)) : 0;
    m.lastT = f.time;
    if (proj && course?.line) {
      const along = (f.vel[0] * proj.dx + f.vel[2] * proj.dz) / (Math.hypot(proj.dx, proj.dz) || 1);
      if (along < -cfg.ghost.wrongWaySpeed) { m.wrong += dt; m.right = 0; if (m.wrong >= cfg.ghost.wrongWaySec) m.wasWrong = true; }
      else if (along > cfg.ghost.wrongWaySpeed) { m.right += dt; m.wrong = 0; if (m.right >= cfg.ghost.rightWaySec) m.wasWrong = false; }
      m.inPit = !!pit && proj.s >= pit.from && proj.s <= pit.to && Math.sign(proj.d) === pit.side && Math.abs(proj.d) > pit.edge;
    }
  }
  const onReset = (uid: string) => { markOf(uid).resetAt = now(); };
  const onRejoin = (uid: string) => { markOf(uid).rejoinAt = now(); };
  // a car's state at room time t, between the two kept either side (or the nearest)
  function stateAt(uid: string, t: number) {
    const h = history.get(uid);
    if (!h?.length) return null;
    let i = h.findIndex(x => x.t >= t);
    if (i < 0) { const x = h.at(-1)!; const dt = Math.min(0.25, (t - x.t) / 1000); return { ...x, pos: [x.pos[0] + x.vel[0] * dt, x.pos[1], x.pos[2] + x.vel[2] * dt], t }; }
    if (i === 0) return h[0];
    const a = h[i - 1], b = h[i], u = (t - a.t) / Math.max(1, b.t - a.t), L = (p: number[], q: number[]) => p.map((v, k) => v + (q[k] - v) * u);
    return { ...b, pos: L(a.pos, b.pos), vel: L(a.vel, b.vel), rot: u < 0.5 ? a.rot : b.rot, t };
  }
  const fpOf = (uid: string, s: any) => { const c = car(uid); return c && s ? footprintOf({ pos: s.pos, rot: s.rot, vel: s.vel, ang: s.ang }, c.box, { mass: c.mass }) : null; };
  // the server's own view of two cars at a moment: how far apart, how fast closing, which way
  function serverView(a: string, b: string, t: number) {
    const fa = fpOf(a, stateAt(a, t)), fb = fpOf(b, stateAt(b, t));
    if (!fa || !fb) return null;
    const o = overlap(fa, fb);
    return { gap: Math.max(0, o.gap), closing: Math.max(0, closingAt(fa, fb, o.n, o.point)), n: o.n, point: o.point, fa, fb };
  }

  // ---------- reports ----------
  function report(uid: string, m: any) {
    const t = now();
    const times = (reportsAt.get(uid) ?? []).filter(x => t - x < 1000);
    if (times.length >= cfg.agree.maxReportsPerSec) return;
    times.push(t); reportsAt.set(uid, times);
    const other = typeof m?.other === 'string' ? m.other : null;
    const num = (x: any) => Number.isFinite(x) ? Number(x) : null, vec = (v: any) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? v.map(Number) : null;
    const r = { pid: uid, other, ep: Number.isInteger(m?.ep) ? m.ep : null, t: num(m?.at), kind: m?.kind === 'hit' ? 'hit' : 'rub', closing: Math.max(0, Math.min(80, num(m?.closing) ?? 0)), n: vec(m?.n), point: vec(m?.point), J: vec(m?.J) ?? [0, 0],
      me: m?.me ?? null, them: m?.them ?? null, predictMs: num(m?.predictMs) ?? 0, track: Array.isArray(m?.track) ? m.track.slice(0, 40) : [] };
    if (!other || other === uid || r.t == null || !r.n || !r.point || !car(uid) || !car(other) || !isRacer(uid) || !isRacer(other)) return;
    if (Math.abs(r.t - t) > 5000) return;
    const [a, b] = [uid, other].sort(), key = `${a}|${b}`;
    // the other player's report of the same contact (within the pairing window), or a new one waiting for it
    // (each game sees the contact begin a little apart — more so the more lag either has: the window widens by their lag)
    const window = cfg.agree.pairWindowMs + Math.min(cfg.agree.pairWindowMs, lagOf(a) + lagOf(b));
    let p = [...pending.values()].find(x => x.key === key && Math.abs(x.first - r.t!) <= window && !x.reports.some(y => y.pid === uid));
    if (!p) {
      const pings = (lagOf(a) + lagOf(b)) * 2;
      p = { key, a, b, reports: [], first: r.t, due: t + cfg.agree.waitMs + Math.min(1000, pings) };
      pending.set(`${key}#${nextCid++}`, p);
    }
    p.reports.push(r);
    if (p.reports.length >= 2) resolve(p);
  }
  const lagOf = (uid: string) => { const l = [...(lags.get(uid) ?? [])].sort((x, y) => x - y); return l.length ? l[Math.floor(l.length / 2)] : 0; };
  const jitterOf = (uid: string) => { const l = lags.get(uid) ?? []; if (l.length < 5) return 0; const m = l.reduce((s, x) => s + x, 0) / l.length; return Math.sqrt(l.reduce((s, x) => s + (x - m) ** 2, 0) / l.length); };

  function resolve(p: Pending) {
    for (const [k, v] of pending) if (v === p) pending.delete(k);
    const A = car(p.a)!, B = car(p.b)!, t = Math.min(...p.reports.map(r => r.t));
    const view = serverView(p.a, p.b, t);
    // (ghosted either side at that moment: it doesn't count — the games' pushes undone)
    const g = ghostList();
    const md = g[p.a]?.ghost || g[p.b]?.ghost ? 'ghost' : mode();
    const res: any = agree(p.reports, { a: { pid: p.a, mass: A.mass, box: A.box }, b: { pid: p.b, mass: B.mass, box: B.box }, serverView: view as any, mode: md, cfg });
    if (!res.ok) {
      // (kept with the race: what the game said it saw, and where the server had the two cars then)
      const at = (f: any) => f ? [f.x, f.z, f.yaw].map((v: number) => Math.round(v * 100) / 100) : null;
      for (const r of p.reports) { send(r.pid, { t: 'contact-rejected', ep: r.ep, why: res.why }); if (r.ep != null) rejected.push({ uid: r.pid, ep: r.ep, why: res.why, t: r.t, me: r.me, them: r.them, server: view ? { [p.a]: at(view.fa), [p.b]: at(view.fb) } : null }); }
      if (rejected.length > 2000) rejected.shift();
      return;
    }
    const cid = `c${nextCid++}`;
    // blame: from the server's log (the second before), the footprints as the server had them at the contact
    const histOf = (uid: string) => (history.get(uid) ?? []).filter(x => x.t >= t - cfg.blame.lookSec * 1000 - 200 && x.t <= t).map(x => ({ t: x.t, pos: x.pos, vel: x.vel, yaw: yawOf(x.rot), u: x.s }));
    const fa = view?.fa ?? fpOf(p.a, stateAt(p.a, t)), fb = view?.fb ?? fpOf(p.b, stateAt(p.b, t));
    const bl = fa && fb ? blame({ a: { pid: p.a, name: A.name, mass: A.mass, box: A.box }, b: { pid: p.b, name: B.name, mass: B.mass, box: B.box }, result: res, history: { [p.a]: histOf(p.a), [p.b]: histOf(p.b) }, cfg, footprints: { [p.a]: fa, [p.b]: fb } })
      : { shares: { [p.a]: 0.5, [p.b]: 0.5 }, fault: null, share: 0.5, careless: false, strength: 0, reasons: ['no states'] };
    res.otherMass = undefined;
    const eps = Object.fromEntries(p.reports.map(r => [r.pid, r.ep]));
    const msg = { t: 'contact', cid, result: { ...res, cars: Object.fromEntries(Object.entries(res.cars).map(([uid, c]: any) => [uid, { ...c, otherMass: uid === p.a ? B.mass : A.mass }])) }, eps, other: { [p.a]: p.b, [p.b]: p.a }, blame: { fault: bl.fault, shares: bl.shares, careless: bl.careless, reasons: bl.reasons.slice(0, 4) } };
    broadcast(msg);
    contacts.push({ cid, t, kind: res.kind, closing: res.closing, J: res.J, gentler: res.gentler, sources: res.sources, cars: msg.result.cars, blame: msg.blame,
      reports: p.reports.map(r => ({ pid: r.pid, closing: r.closing, n: r.n, point: r.point, J: r.J, predictMs: r.predictMs, me: r.me, them: r.them, track: r.track })),
      server: view ? { gap: view.gap, closing: view.closing, a: [view.fa.x, view.fa.z, view.fa.yaw], b: [view.fb.x, view.fb.z, view.fb.yaw] } : null,
      eps, srv: { [p.a]: around(p.a, t), [p.b]: around(p.b, t) } });
    if (contacts.length > 2000) contacts.shift();
    // the race's incidents: a penalty, ghosting a repeat offender, ramming
    for (const act of incidents.add(res, bl, t, { a: { pid: p.a }, b: { pid: p.b } })) {
      if (act.type === 'penalty') { penalize(act.pid, act.seconds, act.why); send(act.pid, { t: 'notice', text: `+${act.seconds} s: ${act.why}` }); }
      if (act.type === 'ghost') { markOf(act.pid).offender = true; send(act.pid, { t: 'notice', text: act.why }); }
      if (act.type === 'ramming') void ramming(act, t);
    }
  }

  // (both cars as the server had them round a contact: what the verifier checks each run's pushes against)
  const around = (uid: string, t: number) => (history.get(uid) ?? []).filter(x => x.t >= t - 600 && x.t <= t + 1500)
    .map(x => [Math.round(x.t), ...[x.pos[0], x.pos[2], yawOf(x.rot), x.vel[0], x.vel[2]].map(v => Math.round(v * 1000) / 1000)]);
  // ramming: what the server saw of both cars (the last replaySec, and a moment after), kept for the victim's report
  async function ramming(act: any, t: number) {
    const R = cfg.ramming, id = `ev-${raceId() ?? 'race'}-${act.pid}-${act.victim}-${Math.round(t)}`.slice(0, 80);
    await new Promise(r => setTimeout(r, 2000));
    const slice = (uid: string) => (history.get(uid) ?? []).filter(x => x.t >= t - R.replaySec * 1000 && x.t <= t + 2000).filter((_, i) => i % 2 === 0)
      .map(x => ({ t: Math.round(x.t), pos: x.pos.map(v => Math.round(v * 100) / 100), yaw: Math.round(yawOf(x.rot) * 1000) / 1000, vel: x.vel.map(v => Math.round(v * 10) / 10) }));
    const hits = incidents.list.filter(x => x.fault === act.pid && x.victim === act.victim).map(x => ({ t: x.t, share: x.share, strength: x.strength }));
    try {
      await saveEvidence({ id, raceId: raceId(), kind: 'ramming', fault: act.pid, victim: act.victim, data: { cars: { [act.pid]: slice(act.pid), [act.victim]: slice(act.victim) }, hits, boxes: { [act.pid]: car(act.pid)?.box, [act.victim]: car(act.victim)?.box }, names: { [act.pid]: car(act.pid)?.name, [act.victim]: car(act.victim)?.name } } });
      send(act.victim, { t: 'ramming', evidenceId: id, by: act.pid, name: car(act.pid)?.name ?? 'Another player', hits: act.hits, why: act.why });
    } catch { /* the evidence couldn't be kept: no report offered */ }
  }

  // ---------- every tick: one-sided reports due, the ghosts ----------
  function tick() {
    const t = now();
    for (const p of [...pending.values()]) if (t >= p.due) resolve(p);
    const g = ghostList();
    const key = JSON.stringify(g);
    if (key !== ghostsSent) { ghostsSent = key; broadcast({ t: 'ghosts', list: g }); }
  }
  function ghostList() {
    const out: Record<string, { ghost: boolean; reasons: string[] }> = {};
    const t = now();
    for (const uid of history.keys()) {
      if (!isRacer(uid)) continue;
      const m = markOf(uid), r = raceOf(uid);
      out[uid] = ghostState({ pingMs: lagOf(uid) * 2, jitterMs: jitterOf(uid), resetAt: m.resetAt, rejoinAt: m.rejoinAt, wrongWay: m.wrong, rightWay: m.right, wasWrong: m.wasWrong, inPit: m.inPit, lap: r?.lap, u: r?.u, offender: m.offender }, t, cfg, { mode: mode() });
    }
    return out;
  }

  return {
    onState, onReset, onRejoin, report, tick, ghostList, serverView, stateAt,
    get contacts() { return contacts; },
    get incidents() { return incidents; },
    // (for the race record: the agreed contacts, each player's at-fault incidents)
    forRecord(uids: string[]) { return { contacts, rejected, trails: Object.fromEntries(uids.map(u => [u, trails.get(u) ?? []])), incidents: Object.fromEntries(uids.map(u => [u, incidents.of(u)])) }; },
    reset() { history.clear(); lags.clear(); marks.clear(); pending.clear(); contacts.length = 0; ghostsSent = ''; },
  };
}
