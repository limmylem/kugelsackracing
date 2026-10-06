// What the server sees, minute by minute (Phase 6 Step 5; docs/OPERATIONS.md): requests, errors, how long answers
// take (by kind of request), players active, the busiest accounts — kept in memory for the last few hours, per
// server (with several servers, each reports its own; the dashboard shows this one's, the alerts run on each).
//
//   const M = createMetrics()     M.record({ route, status, ms, userId })     M.window(minutes) → totals and percentiles
//   M.series(minutes) → per minute     M.prometheus() → text for an external scraper

const MINUTES = 6 * 60;
type Minute = { at: number; n: number; s4: number; s5: number; s429: number; ms: number[]; byRoute: Map<string, number[]>; users: Map<string, number> };
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };

// a request's kind, for the times by kind: its route with ids left out
export const routeKind = (method: string, url: string | undefined) => `${method} ${(url ?? '?').split('?')[0].replace(/\/(rp_|ses_|drv_|quest_|route_|series_|poi_)[^/]+/g, '/:id').replace(/\/[0-9a-f-]{20,}|\/\d+(?=\/|$)/g, '/:id')}`;

export function createMetrics({ now = () => Date.now() } = {}) {
  const minutes: Minute[] = [];
  const at = () => Math.floor(now() / 60000);
  const current = () => {
    const m = at();
    let last = minutes.at(-1);
    if (!last || last.at !== m) { last = { at: m, n: 0, s4: 0, s5: 0, s429: 0, ms: [], byRoute: new Map(), users: new Map() }; minutes.push(last); while (minutes.length > MINUTES) minutes.shift(); }
    return last;
  };
  const started = now();
  return {
    record({ route, status, ms, userId }: { route: string; status: number; ms: number; userId?: string | null }) {
      const m = current();
      m.n++; if (status >= 500) m.s5++; else if (status === 429) { m.s429++; m.s4++; } else if (status >= 400) m.s4++;
      if (m.ms.length < 20000) m.ms.push(ms);
      const r = m.byRoute.get(route) ?? []; if (r.length < 5000) r.push(ms); m.byRoute.set(route, r);
      if (userId) m.users.set(userId, (m.users.get(userId) ?? 0) + 1);
    },
    // the last `mins` minutes together
    window(mins: number) {
      const from = at() - mins + 1, ms: number[] = [], routes = new Map<string, number[]>(), users = new Map<string, number>();
      let n = 0, s4 = 0, s5 = 0, s429 = 0, busiest = 0;
      for (const m of minutes) {
        if (m.at < from) continue;
        n += m.n; s4 += m.s4; s5 += m.s5; s429 += m.s429; ms.push(...m.ms);
        for (const [k, v] of m.byRoute) { const r = routes.get(k) ?? []; r.push(...v); routes.set(k, r); }
        for (const [u, c] of m.users) { users.set(u, (users.get(u) ?? 0) + c); busiest = Math.max(busiest, c); }
      }
      const perRoute = [...routes].map(([route, v]) => ({ route, n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), p99: pct(v, 0.99) })).sort((a, b) => b.p95 * b.n - a.p95 * a.n);
      return { minutes: mins, requests: n, clientErrors: s4, serverErrors: s5, rateLimited: s429, errorRate: n ? s5 / n : 0, p50: pct(ms, 0.5), p95: pct(ms, 0.95), p99: pct(ms, 0.99), activePlayers: users.size, busiestPerMinute: busiest, routes: perRoute.slice(0, 25) };
    },
    // per minute, for the dashboard's charts
    series(mins: number) {
      const from = at() - mins + 1, byAt = new Map(minutes.map(m => [m.at, m])), out: { at: string; requests: number; serverErrors: number; p95: number; players: number }[] = [];
      for (let t = from; t <= at(); t++) { const m = byAt.get(t); out.push({ at: new Date(t * 60000).toISOString(), requests: m?.n ?? 0, serverErrors: m?.s5 ?? 0, p95: m ? pct(m.ms, 0.95) : 0, players: m?.users.size ?? 0 }); }
      return out;
    },
    uptimeSec: () => Math.round((now() - started) / 1000),
    // (an external monitor's scrape: Prometheus's text format, the last 5 minutes)
    prometheus(extra: Record<string, number> = {}) {
      const w = this.window(5), lines = [
        ['kr_requests_5m', w.requests], ['kr_server_errors_5m', w.serverErrors], ['kr_rate_limited_5m', w.rateLimited], ['kr_latency_p50_ms', w.p50], ['kr_latency_p95_ms', w.p95], ['kr_latency_p99_ms', w.p99],
        ['kr_active_players_5m', w.activePlayers], ['kr_uptime_seconds', this.uptimeSec()], ...Object.entries(extra),
      ];
      return lines.map(([k, v]) => `${k} ${Number(v)}`).join('\n') + '\n';
    },
  };
}
export type Metrics = ReturnType<typeof createMetrics>;
