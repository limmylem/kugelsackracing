// What a build sounds like (Phase 8 Step 1; docs/AUDIO.md): every fitted part's `sound` block (data/parts, its
// schema: part.schema.json sound) merged in socket order into spec.audio, which the game's sound plays
// (audio/mix.js engineVoiceConfig, audio/dsp.js EngineVoice). Swap a part and the sound changes with nothing else to
// do; take it off (or a crash tears it off) and its sound goes with it.
//
//   exhaust { level, tone, rasp, pops }   how loud (×) and how open (× the tone's low-pass) the engine is; rasp (a
//                                         hard, torn edge, 0..1) and pops (crackles and bangs lifting off, on the
//                                         limiter and changing up, 0..1) — headers and cat-backs, an ECU's crackle map
//   intake { roar, tone }                 induction roar at high throttle (×), its pitch (×)
//   whistle                               the turbo's (a turbo part's, else the engine's own: testtrack/soundMix.js TurboSpool)
//   blowoff { kind, gain, hz, seconds }   the turbo letting go when the throttle shuts: a blow-off valve's hiss
//                                         ('valve') or, with none, the compressor's flutter ('flutter')
//   supercharger { kind, gain, ratio, lobes }   its whine: twin-screw, roots or centrifugal
//   gears { whine, teeth, cut }           a straight-cut gearbox's whine (and cut: an ignition cut on each upshift)
//   limiter { hz, depth }                 how the rev limiter bounces (an ECU's: harder and faster)
//   idle { lope, lopeHz }                 a cammy idle
//   from: [{ part, name, keys }]          which parts made it, for the garage and the test page
//
// Levels, tones and roar multiply; rasp and pops add up as shares (1 − (1 − a)(1 − b): two halves make three
// quarters, never past 1); the rest is the last part's that has one.

const MULTIPLY = { exhaust: ['level', 'tone'], intake: ['roar', 'tone'] }, SHARES = { exhaust: ['rasp', 'pops'] };
const SETS = ['whistle', 'blowoff', 'supercharger', 'gears', 'limiter', 'idle'];
export const SOUND_KEYS = ['exhaust', 'intake', ...SETS];

export function emptySound() {
  return { exhaust: { level: 1, tone: 1, rasp: 0, pops: 0 }, intake: { roar: 1, tone: 1 }, whistle: null, blowoff: null, supercharger: null, gears: null, limiter: null, idle: null, from: [] };
}

// sounds: each fitted part's sound block (in socket order), with { part, name } — or a list of parts
export function mergeSound(parts) {
  const out = emptySound();
  for (const p of parts) {
    const S = p.sound;
    if (!S) continue;
    const keys = [];
    for (const [group, list] of Object.entries(MULTIPLY)) for (const k of list) if (S[group]?.[k] != null) { out[group][k] *= S[group][k]; keys.push(`${group}.${k}`); }
    for (const [group, list] of Object.entries(SHARES)) for (const k of list) if (S[group]?.[k] != null) { out[group][k] = 1 - (1 - out[group][k]) * (1 - Math.min(1, Math.max(0, S[group][k]))); keys.push(`${group}.${k}`); }
    for (const k of SETS) if (S[k]) { out[k] = strip(S[k]); keys.push(k); }
    if (keys.length) out.from.push({ part: p.id, name: p.name, keys });
  }
  return out;
}
const strip = x => Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith('_')));

// The build's sound (garage/stats.js): the fitted parts' (torn-off ones aren't fitted), and the engine's own turbo's
// whistle and blow-off when no turbo part brings its own
export function soundOf(fitted, spec) {
  const out = mergeSound(fitted.map(f => ({ id: f.part.id, name: f.part.name, sound: f.part.sound })));
  const own = spec.engine?.turbo?.sound;
  if (own?.whistle && !out.whistle) out.whistle = strip(own.whistle);
  if (own?.blowoff && !out.blowoff && spec.turbo?.part === fitted.find(f => f.part.engine)?.part.id) out.blowoff = strip(own.blowoff);
  if (!spec.turbo) { out.whistle = null; out.blowoff = null; }
  return out;
}
