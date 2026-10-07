// Interest management (Phase 7 Step 1; docs/MULTIPLAYER.md): each player is sent only the cars near them, and the
// further ones less often. The room's players go into a grid of square cells each tick; a player's neighbours are
// read from the cells within the outermost ring, and each is given its ring's rate (every tick, every 3rd, every
// 10th…). Ready for big free-roam areas (Step 4): the work a tick grows with the cars near each player, not with
// the room.
//
//   const G = createGrid(NET.interest)
//   G.rebuild(players)           players: [{ id, pos: [x, y, z] }] (world frame); without a position: left out
//   G.near(p) → [{ id, d, every }]  everyone within the rings round p (not p)

type Ring = { within: number; every: number };
type P = { id: number; pos: number[] | null };

export function createGrid({ cell, rings }: { cell: number; rings: Ring[] }) {
  const cells = new Map<string, P[]>(), reach = rings[rings.length - 1].within, span = Math.ceil(reach / cell);
  const key = (i: number, j: number) => `${i},${j}`;
  return {
    rebuild(players: P[]) {
      cells.clear();
      for (const p of players) {
        if (!p.pos) continue;
        const k = key(Math.floor(p.pos[0] / cell), Math.floor(p.pos[2] / cell));
        let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(p);
      }
    },
    near(me: P) {
      const out: { id: number; d: number; every: number }[] = [];
      if (!me.pos) return out;
      const ci = Math.floor(me.pos[0] / cell), cj = Math.floor(me.pos[2] / cell);
      for (let i = ci - span; i <= ci + span; i++) for (let j = cj - span; j <= cj + span; j++) {
        const c = cells.get(key(i, j));
        if (!c) continue;
        for (const o of c) {
          if (o.id === me.id || !o.pos) continue;
          const d = Math.hypot(o.pos[0] - me.pos[0], o.pos[2] - me.pos[2]);
          const r = rings.find(x => d <= x.within);
          if (r) out.push({ id: o.id, d, every: r.every });
        }
      }
      return out;
    },
  };
}
