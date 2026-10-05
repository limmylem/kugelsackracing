// A quest's sounds (Phase 4 Step 5 polish): the countdown's beeps and GO, a chime at each checkpoint
// (higher when ahead of your best split, lower when behind), a lap's and a bonus's (and a drift banked),
// a buzz for a missed checkpoint, a jump start or a drift lost, the finish, and on the results screen the
// medal's fanfare (gold the longest), the reward's coins and a level-up. Made with Web Audio as they play (no files to load), quiet under the
// car's own sounds; the game's mute (M) mutes them too.
//
// What plays when is pure (cueOf, resultCues: the Node tests check every event has its sound); the notes
// of each are CUES.
//
//   const snd = createQuestSounds({ muted: () => bool, volume })
//   snd.event(e)   a quest event (quest/session.js's)      snd.results(res)   the results screen's
//   snd.play(name)   snd.dispose()

// notes: f (Hz), at (s from the cue's start), len (s), wave, gain (0..1, before the master volume)
const N = (f, at, len, gain = 0.5, wave = 'triangle') => ({ f, at, len, gain, wave });
export const CUES = {
  count: [N(660, 0, 0.14, 0.55, 'square')],
  go: [N(1320, 0, 0.5, 0.6, 'square')],
  checkpoint: [N(988, 0, 0.12), N(1319, 0.07, 0.2)],
  splitAhead: [N(1175, 0, 0.1), N(1568, 0.07, 0.24)],
  splitBehind: [N(880, 0, 0.1), N(698, 0.08, 0.24)],
  bonus: [N(1047, 0, 0.08), N(1319, 0.06, 0.08), N(1568, 0.12, 0.2)],
  lap: [N(784, 0, 0.1), N(988, 0.09, 0.1), N(1175, 0.18, 0.28)],
  lapBest: [N(784, 0, 0.1), N(988, 0.09, 0.1), N(1175, 0.18, 0.1), N(1568, 0.27, 0.32)],
  wrong: [N(196, 0, 0.32, 0.45, 'sawtooth'), N(185, 0, 0.32, 0.35, 'square')],
  finish: [N(523, 0, 0.7, 0.4), N(659, 0, 0.7, 0.35), N(784, 0, 0.8, 0.35), N(1047, 0.12, 0.8, 0.3)],
  fail: [N(392, 0, 0.22, 0.45), N(330, 0.2, 0.22, 0.45), N(262, 0.4, 0.5, 0.45)],
  medalBronze: [N(659, 0, 0.16), N(988, 0.14, 0.5)],
  medalSilver: [N(659, 0, 0.14), N(831, 0.12, 0.14), N(1319, 0.24, 0.55)],
  medalGold: [N(659, 0, 0.12), N(831, 0.1, 0.12), N(988, 0.2, 0.12), N(1319, 0.3, 0.2), N(1319, 0.5, 0.7), N(1661, 0.5, 0.7, 0.3)],
  reward: [N(1568, 0, 0.07, 0.35, 'square'), N(2093, 0.06, 0.32, 0.35, 'square')],
  levelUp: [N(523, 0, 0.12), N(659, 0.1, 0.12), N(784, 0.2, 0.12), N(1047, 0.3, 0.12), N(1319, 0.4, 0.6)],
  personalBest: [N(1760, 0, 0.08, 0.3, 'sine'), N(2349, 0.07, 0.08, 0.3, 'sine'), N(2637, 0.14, 0.3, 0.3, 'sine')],
};

// a quest event → the cue it plays (null: none)
export function cueOf(e) {
  switch (e?.type) {
    case 'count': return 'count';
    case 'go': return 'go';
    case 'checkpoint': return e.delta == null ? 'checkpoint' : e.delta <= 0 ? 'splitAhead' : 'splitBehind';
    case 'bonus': return 'bonus';
    case 'drift-bank': return e.points > 0 ? 'bonus' : null;
    case 'drift-lost': return 'wrong';
    case 'lap': return e.best ? 'lapBest' : 'lap';
    case 'missed': case 'jump': return 'wrong';
    case 'finish': return 'finish';
    case 'fail': return 'fail';
    default: return null;
  }
}
// the results screen's sounds, one after another: the medal, a personal best, the money, a level-up
export function resultCues(res) {
  const o = res?.outcome ?? {}, pay = res?.pay ?? {}, out = [];
  if (o.status !== 'finished') return out;
  let at = 0;
  const add = (cue, gap) => { out.push({ cue, at }); at += gap; };
  if (o.medal) add(`medal${o.medal[0].toUpperCase()}${o.medal.slice(1)}`, o.medal === 'gold' ? 1.1 : 0.75);
  if (pay.pb) add('personalBest', 0.45);
  if (pay.valid && pay.money > 0) add('reward', 0.5);
  if (pay.levelUp) add('levelUp', 1);
  return out;
}

export function createQuestSounds({ muted = () => false, volume = 0.35 } = {}) {
  let ctx = null, master = null;
  const timers = new Set();
  const audio = () => {
    if (!ctx) {
      const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch { return null; }
      master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };
  function play(name) {
    const notes = CUES[name];
    if (!notes || muted() || !audio()) return false;
    const t0 = ctx.currentTime + 0.01;
    for (const n of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + n.at;
      o.type = n.wave; o.frequency.value = n.f;
      // a quick attack and a decay to silence (no clicks)
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(n.gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n.len);
      o.connect(g).connect(master); o.start(t); o.stop(t + n.len + 0.02);
    }
    return true;
  }
  return {
    play,
    event(e) { const c = cueOf(e); if (c) play(c); },
    results(res) { for (const { cue, at } of resultCues(res)) { const id = setTimeout(() => { timers.delete(id); play(cue); }, at * 1000); timers.add(id); } },
    dispose() { for (const id of timers) clearTimeout(id); timers.clear(); try { ctx?.close(); } catch { /* gone */ } ctx = null; },
  };
}
