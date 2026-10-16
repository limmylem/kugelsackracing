// A co-op police pursuit (docs/PURSUIT.md), each player's own session: as a pursuit (quest/types/pursuit.js) — free
// driving, the HUD's heat and cooldown — but the race server decides (server/src/rt/pursuit.ts runs the director and
// the mission, pursuit/coop.js): S.pursuitNow carries its word, coop: { done, me: { state, respawnIn }, … }. Busted, you
// respawn or watch (the run goes on: it's the party's); it's over when the server says so, and the server pays
// (serverPays: the game asks it, not PlayerService — play/questController.js).
import pursuit from './pursuit.js';

export default {
  ...pursuit,
  id: 'pursuit_coop',
  serverPays: true,
  next: S => { const me = S.pursuitNow?.coop?.me; return me?.drop ?? (S.quest.params?.objective === 'destination' && S.quest.params?.kind !== 'split' ? S.course.finish : null); },
  tick(S, I, emit, end) {
    const D = S.pursuitNow, C = D?.coop, me = C?.me;
    if (!D) return;
    const R = S.chase;
    R.heatMax = Math.max(R.heatMax, D.level);
    if (D.phase !== R.phase) {
      if (D.phase === 'cooldown') emit({ type: 'pursuit-lost', cooldown: D.cooldown });
      if (D.phase === 'pursuit' && R.phase === 'cooldown') emit({ type: 'pursuit-spotted' });
      if (D.phase === 'escaped') { R.escaped = true; emit({ type: 'pursuit-escaped', level: D.level }); }
      R.phase = D.phase;
    }
    if (me && me.state !== R.myState) { emit({ type: 'coop-state', state: me.state, respawnIn: me.respawnIn }); R.myState = me.state; }
    S.score = Math.round(C?.score ?? 0);
    if (C?.done) { R.reached = C.done.reason === 'delivered' || C.done.reason?.includes('drop'); end(C.done.status === 'finished' ? 'finished' : 'failed', { reason: C.done.status === 'finished' ? null : C.done.reason === 'all busted' ? 'busted' : C.done.reason, text: C.done.status === 'finished' ? null : C.done.reason === 'all busted' ? 'Busted: the whole party' : C.done.reason }); }
  },
  hud(S) { const h = pursuit.hud(S), C = S.pursuitNow?.coop; return { ...h, coop: C ? { kind: C.kind, me: C.me, carrier: C.carrier, mine: C.carrier != null && C.carrier === C.me?.id, goods: C.goods, players: C.players } : null }; },
};
