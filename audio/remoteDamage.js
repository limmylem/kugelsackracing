// Another car's damage sounds (docs/AUDIO.md): steam from its engine bay (a leaking radiator) and a hanging panel
// flapping in the wind — the same sounds as your own car's (audio/crash.js: data/sounds/mechanical.json steam,
// data/sounds/crash.json flap), heard from where it is (into its voice: audio/car.js v.extra — positioned, muffled
// far off and behind buildings, and only while it's heard in full). Nothing is made until it has something to sound:
// an undamaged car costs nothing.
//
//   const D = createRemoteDamage(A, () => voice.extra)
//   D.update({ steam (0..1), flap (loose panels), speed (m/s) }) · D.dispose()

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const finite = (x, or) => Number.isFinite(x) ? x : or;
const configs = new Map();
const load = path => { if (!configs.has(path)) configs.set(path, fetch(path, { cache: 'no-cache' }).then(r => r.json()).catch(() => null)); return configs.get(path); };

export function createRemoteDamage(A, into, { crashPath = 'data/sounds/crash.json', mechPath = 'data/sounds/mechanical.json' } = {}) {
  const { ctx } = A, t = () => ctx.currentTime;
  let made = null, making = false, alive = true, want = null;
  async function make() {
    making = true;
    const [crash, mech] = await Promise.all([load(crashPath), load(mechPath)]);
    const dest = into();
    if (!alive || !dest || !mech?.steam) { making = false; return; }
    const sr = ctx.sampleRate, noiseBuf = ctx.createBuffer(1, sr * 2, sr), nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = new AudioBufferSourceNode(ctx, { buffer: noiseBuf, loop: true }), band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: mech.steam.hz, Q: mech.steam.q }), steam = new GainNode(ctx, { gain: 0 });
    noise.connect(band).connect(steam).connect(dest); noise.start(0, Math.random() * 2);
    const m = { mech, crash, dest, noise, band, steam, flap: null, flapFile: null };
    if (crash?.flap?.file) {
      try {
        const buf = await A.buffer(crash.flap.file);
        if (alive) {
          m.flapFile = crash.flap.file;
          m.flapSrc = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }); m.flap = new GainNode(ctx, { gain: 0 });
          m.flapSrc.connect(m.flap).connect(dest); m.flapSrc.start(0, Math.random() * buf.duration);
        } else A.unbuffer(crash.flap.file);
      } catch { /* (no flap: the steam still) */ }
    }
    made = m; making = false;
    if (!alive) { drop(); return; }
    if (want) apply(want);
  }
  function apply({ steam = 0, flap = 0, speed = 0 }) {
    const m = made, v = Math.abs(finite(speed, 0));
    m.steam.gain.setTargetAtTime(Math.min(1, finite(steam, 0)) * m.mech.steam.gain * (0.85 + 0.15 * Math.random()), t(), 0.12);
    if (m.flap) {
      const F = m.crash.flap, on = flap > 0 ? clamp((v - (F.fromSpeed ?? 6)) / 18, 0, 1) * Math.min(1, flap) : 0;
      m.flap.gain.setTargetAtTime(on * F.gain, t(), 0.1);
      if (on > 0) m.flapSrc.playbackRate.setTargetAtTime(clamp(v * F.perMetre * 0.25, 0.5, 6), t(), 0.1);
    }
  }
  function drop() {
    const m = made; made = null;
    if (!m) return;
    for (const s of [m.noise, m.flapSrc]) { try { s?.stop(); } catch { /* stopped */ } }
    for (const n of [m.noise, m.band, m.steam, m.flapSrc, m.flap]) { try { n?.disconnect(); } catch { /* gone */ } }
    if (m.flapFile) A.unbuffer(m.flapFile);
  }
  return {
    update(x) {
      if (!alive) return;
      want = x;
      if (made) { if (made.dest !== into()) drop(); else { apply(x); return; } }
      if (!making && ((x.steam ?? 0) > 0.01 || (x.flap ?? 0) > 0)) make();
    },
    get made() { return !!made; },
    get levels() { return made ? { steam: made.steam.gain.value, flap: made.flap?.gain.value ?? 0 } : null; },
    dispose() { alive = false; drop(); },
  };
}

// How much steam another car's engine bay gives off (as effects/director.js works out your own's): from its radiator's
// leak while there's coolant left — what it had, less the leak a second since — less the faster it's going
export function remoteSteam({ leak = 0, coolant = 1 }, secondsSince, speed) {
  if (!(leak > 0)) return 0;
  const left = coolant - leak * Math.max(0, secondsSince);
  if (left <= 0.02) return 0;
  return (0.45 + 0.55 * Math.min(1, leak * 40)) * (1 - 0.6 * Math.min(1, Math.abs(speed) / 25));
}
