// A run recorded for ghost replays, pure and deterministic: the car's state every 1/hz s of simulated time
// (from the clock's zero), quantised — position in cm, rotation as four int16s, velocity in cm/s — each
// channel delta-coded from the sample before, zigzagged and written as varints, then base64. The same run
// always gives the same string, and a minute at 20 Hz is around 10 kB.
//
//   const R = createRecorder({ hz })
//   R.sample(t, { x, y, z, q: [x, y, z, w], vx, vy, vz })   every physics tick (t: the clock); keeps the
//        ones on the beat
//   R.finish(meta) → { format, version, hz, frames, origin, data, meta }
//   decodeRecording(rec) → [{ t, x, y, z, q, vx, vy, vz }]
//
// Versions (migrateRecording brings an old one up to date as it's read): 1 ('kr-ghost-1', Phase 4 Step 3)
// the samples alone; 2 ('kr-ghost-2', Phase 4 Step 5) the same samples, and meta: { questId, routeVersion,
// car, time, score, recorded } — what it's a run of, so a ghost is only raced on the route it was driven on.

export const FORMAT = 'kr-ghost-2';
export const RECORDING_VERSION = 2;
const META = { questId: null, routeVersion: null, car: null, time: null, score: null, recorded: null };
const CH = 10;

function zig(n) { return n >= 0 ? n * 2 : -n * 2 - 1; }
function unzig(n) { return n % 2 ? -(n + 1) / 2 : n / 2; }
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0, n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}
export function fromBase64(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map(j => s[i + j] === '=' || s[i + j] === undefined ? -1 : B64.indexOf(s[i + j]));
    const n = ((v[0] << 18) | (v[1] << 12) | (Math.max(0, v[2]) << 6) | Math.max(0, v[3])) >>> 0;
    out.push((n >> 16) & 255);
    if (v[2] >= 0) out.push((n >> 8) & 255);
    if (v[3] >= 0) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

function quantise(s, origin) {
  // (the rotation's sign picked so w ≥ 0: q and −q are the same rotation, and this keeps deltas small)
  let [qx, qy, qz, qw] = s.q ?? [0, 0, 0, 1];
  if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
  const q16 = v => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
  return [Math.round((s.x - origin[0]) * 100), Math.round((s.y - origin[1]) * 100), Math.round((s.z - origin[2]) * 100),
    q16(qx), q16(qy), q16(qz), q16(qw), Math.round((s.vx ?? 0) * 100), Math.round((s.vy ?? 0) * 100), Math.round((s.vz ?? 0) * 100)];
}

export function createRecorder({ hz = 20 } = {}) {
  const bytes = [], last = new Array(CH).fill(0);
  let origin = null, frames = 0;
  const put = n => { let u = zig(n); while (u >= 128) { bytes.push((u % 128) | 128); u = Math.floor(u / 128); } bytes.push(u); };
  return {
    get frames() { return frames; },
    sample(t, s) {
      // the frame on the beat: the first tick at or after it (ticks are fixed, so the same ticks every time)
      if (t < frames / hz - 1e-9) return false;
      origin ??= [Math.round(s.x * 100) / 100, Math.round(s.y * 100) / 100, Math.round(s.z * 100) / 100];
      const v = quantise(s, origin);
      for (let i = 0; i < CH; i++) { put(v[i] - last[i]); last[i] = v[i]; }
      frames++;
      return true;
    },
    finish(meta = {}) { return { format: FORMAT, version: RECORDING_VERSION, hz, frames, origin: origin ?? [0, 0, 0], data: toBase64(bytes), meta: { ...META, ...meta } }; },
  };
}

// A recording of any version brought up to this one (the samples are the same in every version so far)
export function migrateRecording(rec) {
  if (rec?.format === FORMAT) return { ...rec, meta: { ...META, ...(rec.meta ?? {}) } };
  if (rec?.format === 'kr-ghost-1') return { format: FORMAT, version: RECORDING_VERSION, hz: rec.hz, frames: rec.frames, origin: rec.origin, data: rec.data, meta: { ...META } };
  throw new Error(`not a recording this game reads (${rec?.format})`);
}
// Whether a recording is a run of this version of the route (one of unknown version is taken as it is)
export const recordingFits = (rec, routeVersion) => !rec?.meta?.routeVersion || !routeVersion || rec.meta.routeVersion === routeVersion;

export function decodeRecording(input) {
  const rec = migrateRecording(input);
  const b = fromBase64(rec.data), out = [], v = new Array(CH).fill(0);
  let i = 0;
  const get = () => { let n = 0, m = 1, c; do { c = b[i++]; n += (c & 127) * m; m *= 128; } while (c & 128); return unzig(n); };
  for (let f = 0; f < rec.frames; f++) {
    for (let c = 0; c < CH; c++) v[c] += get();
    out.push({ t: f / rec.hz, x: rec.origin[0] + v[0] / 100, y: rec.origin[1] + v[1] / 100, z: rec.origin[2] + v[2] / 100, q: [v[3] / 32767, v[4] / 32767, v[5] / 32767, v[6] / 32767], vx: v[7] / 100, vy: v[8] / 100, vz: v[9] / 100 });
  }
  return out;
}
